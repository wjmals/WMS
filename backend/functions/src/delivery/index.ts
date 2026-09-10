// Backend delivery functions using Firebase Firestore
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import axios from "axios";

admin.initializeApp();
const db = admin.firestore();

const SWEETTRACKER_API_KEY = process.env.SWEETTRACKER_API_KEY || "YOUR_TEST_KEY";

export const addShipment = onRequest(async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    const { tracking_number, sender_name, receiver_name } = req.body;
    if (!tracking_number) {
      res.status(400).send("tracking_number is required");
      return;
    }
    // Auto-detect courier
    const companyRes = await axios.get(`http://info.sweettracker.co.kr/api/v1/companylist?t_key=${SWEETTRACKER_API_KEY}`);
    let courier_code = "04"; // Default CJ
    let courier_name = "CJ대한통운";
    if (companyRes.data && companyRes.data.Company) {
      try {
        const recommendRes = await axios.get(`http://info.sweettracker.co.kr/api/v1/recommend/companylist?t_key=${SWEETTRACKER_API_KEY}&t_invoice=${tracking_number}`);
        if (recommendRes.data && recommendRes.data.Recommend && recommendRes.data.Recommend.length > 0) {
          courier_code = recommendRes.data.Recommend[0].Code;
          courier_name = recommendRes.data.Recommend[0].Name;
        }
      } catch (e) {
        console.warn("Auto-detect failed, using default.");
      }
    }
    // Insert shipment into Firestore
    const docRef = await db.collection("shipments").add({
      tracking_number,
      courier_code,
      courier_name,
      sender_name: sender_name || "",
      receiver_name: receiver_name || "",
      status: "배송중",
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.status(200).json({ success: true, id: docRef.id, tracking_number, courier_code, courier_name });
  } catch (error: any) {
    console.error("addShipment error:", error);
    res.status(500).json({ error: error.message });
  }
});

export const listShipments = onRequest(async (req, res) => {
  try {
    const snapshot = await db.collection("shipments").orderBy("created_at", "desc").limit(50).get();
    const shipments: any[] = [];
    const now = new Date();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const lastSynced = data.last_api_synced_at ? data.last_api_synced_at.toDate() : new Date(0);
      const diffHours = (now.getTime() - lastSynced.getTime()) / (1000 * 60 * 60);
      if (diffHours > 2 && data.status !== "배송완료") {
        try {
          const trackRes = await axios.get(`http://info.sweettracker.co.kr/api/v1/trackingInfo?t_key=${SWEETTRACKER_API_KEY}&t_code=${data.courier_code}&t_invoice=${data.tracking_number}`);
          if (trackRes.data && !trackRes.data.status && trackRes.data.level) {
            const newStatus = trackRes.data.level === 6 ? "배송완료" : "배송중";
            await doc.ref.update({ status: newStatus, last_api_synced_at: admin.firestore.FieldValue.serverTimestamp() });
            data.status = newStatus;
            if (trackRes.data.trackingDetails && trackRes.data.trackingDetails.length > 0) {
              const lastDetail = trackRes.data.trackingDetails[trackRes.data.trackingDetails.length - 1];
              await doc.ref.collection("history").add({
                time_string: lastDetail.timeString,
                location: lastDetail.where,
                status_detail: lastDetail.kind,
                created_at: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          }
        } catch (e) {
          console.error(`Tracking API failed for ${data.tracking_number}`);
        }
      }
      shipments.push({ id: doc.id, ...data });
    }
    res.status(200).json(shipments);
  } catch (error: any) {
    console.error("listShipments error:", error);
    res.status(500).json({ error: error.message });
  }
});
