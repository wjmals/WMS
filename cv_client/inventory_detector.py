import cv2
import time
import json
import firebase_admin
from firebase_admin import credentials, db, storage
from ultralytics import YOLO
from shapely.geometry import Polygon, box
import os
import datetime

# 1. Initialize Firebase Admin
# NOTE: Ensure WMS_FIREBASE_KEY_PATH is set in environment or replace with path
cred_path = os.environ.get("WMS_FIREBASE_KEY_PATH", "serviceAccountKey.json")
if os.path.exists(cred_path):
    cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {
        'databaseURL': 'https://your-project-id-default-rtdb.firebaseio.com/',
        'storageBucket': 'your-project-id.appspot.com'
    })
else:
    print(f"Warning: {cred_path} not found. Firebase features will fail.")

# 2. Load YOLOv8 Model
# Using yolov8n.pt for general object detection (boxes/packages can be fine-tuned later)
model = YOLO('yolov8n.pt')

# 3. Define ROIs (Region of Interest)
# In a real scenario, this is configured via a GUI or JSON file.
# Represented as a list of points: [x, y]
ZONES = {
    "zone_A1": {
        "polygon": Polygon([(100, 100), (400, 100), (400, 400), (100, 400)]),
        "name": "A-1 Shelf"
    },
    "zone_A2": {
        "polygon": Polygon([(500, 100), (800, 100), (800, 400), (500, 400)]),
        "name": "A-2 Shelf"
    }
}

def upload_image_to_storage(image, zone_id):
    if not firebase_admin._apps:
        return ""
    
    timestamp = datetime.datetime.now().strftime("%Y%md%H%M%S")
    filename = f"cv_logs/{zone_id}_{timestamp}.jpg"
    
    # Save temp image
    temp_path = f"/tmp/{zone_id}_temp.jpg"
    cv2.imwrite(temp_path, image)
    
    # Upload
    bucket = storage.bucket()
    blob = bucket.blob(filename)
    blob.upload_from_filename(temp_path, content_type='image/jpeg')
    
    # Make public (or get signed url)
    blob.make_public()
    return blob.public_url

def process_frame(frame):
    # Detect objects
    results = model(frame, verbose=False)
    detections = results[0].boxes
    
    # Convert detections to shapely boxes
    detected_polygons = []
    for d in detections:
        x1, y1, x2, y2 = d.xyxy[0].tolist()
        detected_polygons.append(box(x1, y1, x2, y2))
        # Draw bounding box for visualization
        cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (255, 0, 0), 2)
        
    for zone_id, zone_data in ZONES.items():
        roi_poly = zone_data["polygon"]
        
        # Calculate intersection area
        total_intersection = 0
        for det_poly in detected_polygons:
            if roi_poly.intersects(det_poly):
                intersection = roi_poly.intersection(det_poly)
                total_intersection += intersection.area
                
        roi_area = roi_poly.area
        occupied_ratio = min(total_intersection / roi_area, 1.0)
        empty_ratio = 1.0 - occupied_ratio
        
        # Determine State
        if empty_ratio <= 0.4:
            state = "normal"
            color = (0, 255, 0)
        elif empty_ratio <= 0.7:
            state = "low"
            color = (0, 165, 255)
        else:
            state = "empty"
            color = (0, 0, 255)
            
        # Draw ROI polygon
        pts = list(roi_poly.exterior.coords)
        pts_np = [(int(p[0]), int(p[1])) for p in pts]
        cv2.polylines(frame, [__import__('numpy').array(pts_np)], True, color, 3)
        cv2.putText(frame, f"{zone_id}: {state}", (pts_np[0][0], pts_np[0][1] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
        
        # Update Firebase RTDB if available
        if firebase_admin._apps:
            ref = db.reference(f'/inventory/camera_zones/{zone_id}')
            current_data = ref.get()
            
            # If state changed to low or empty, upload image
            image_url = current_data.get('lastImageUrl', '') if current_data else ''
            if state in ['low', 'empty'] and (not current_data or current_data.get('state') == 'normal'):
                image_url = upload_image_to_storage(frame, zone_id)
                
            ref.update({
                'state': state,
                'emptyRatio': round(empty_ratio, 2),
                'lastUpdate': int(time.time() * 1000),
                'zoneName': zone_data['name'],
                'lastImageUrl': image_url
            })
            
    return frame

def run():
    print("Starting Inventory CV Client...")
    cap = cv2.VideoCapture(0) # Use 0 for webcam, or video path/rtsp url
    
    if not cap.isOpened():
        print("Error: Cannot open camera.")
        return
        
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            frame = process_frame(frame)
            
            # If running in environment with display
            if os.environ.get("DISPLAY"):
                cv2.imshow('WMS Inventory Detection', frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break
                    
            # Process every 30 seconds
            time.sleep(30)
            
    except KeyboardInterrupt:
        print("Client stopped by user.")
    finally:
        cap.release()
        cv2.destroyAllWindows()

if __name__ == "__main__":
    run()
