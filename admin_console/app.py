import streamlit as st
import requests
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore
import datetime
import numpy as np
import matplotlib.pyplot as plt

st.set_page_config(page_title="WMS Admin Console", layout="wide")

# --- Firebase Initialization ---
@st.cache_resource
def init_firebase():
    if not firebase_admin._apps:
        # Use secrets
        cred = credentials.Certificate({
            "type": "service_account",
            "project_id": st.secrets["firebase"]["project_id"],
            "private_key": st.secrets["firebase"]["private_key"],
            "client_email": st.secrets["firebase"]["client_email"],
            "token_uri": "https://oauth2.googleapis.com/token",
        })
        # For demo purposes, catching error if secrets are invalid
        try:
            firebase_admin.initialize_app(cred)
        except Exception as e:
            st.sidebar.error(f"Firebase Init Error: {e}")
    return firestore.client() if firebase_admin._apps else None

db = init_firebase()

# --- App Layout ---
st.title("AI Native WMS - 내부 운영 콘솔")

tab1, tab2 = st.tabs(["📦 배송 관리 (Delivery)", "🧪 수요예측 실험실 (Inventory AI)"])

# --- TAB 1: 배송 관리 ---
with tab1:
    st.header("운송장 관리")
    
    API_URL = st.secrets["api"].get("delivery_api_url", "http://localhost:5001/wms/us-central1")
    
    col1, col2 = st.columns([1, 2])
    with col1:
        st.subheader("신규 배송 등록")
        with st.form("add_shipment_form"):
            tracking_number = st.text_input("운송장 번호")
            sender_name = st.text_input("보내는 사람")
            receiver_name = st.text_input("받는 사람")
            submit = st.form_submit_button("등록")
            
            if submit:
                try:
                    res = requests.post(f"{API_URL}/addShipment", json={
                        "tracking_number": tracking_number,
                        "sender_name": sender_name,
                        "receiver_name": receiver_name
                    })
                    if res.status_code == 200:
                        st.success(f"성공적으로 등록되었습니다! (택배사: {res.json().get('courier_name')})")
                    else:
                        st.error(f"등록 실패: {res.text}")
                except Exception as e:
                    st.error(f"API 호출 오류: {e}")

    with col2:
        st.subheader("최근 배송 목록")
        if st.button("목록 새로고침"):
            try:
                res = requests.get(f"{API_URL}/listShipments")
                if res.status_code == 200:
                    df = pd.DataFrame(res.json())
                    st.dataframe(df)
                else:
                    st.error(f"목록 로드 실패: {res.text}")
            except Exception as e:
                st.error(f"API 호출 오류: {e}")

# --- TAB 2: 수요예측 실험실 ---
with tab2:
    st.header("수요예측 실험실")
    st.markdown("Firebase의 실제 30일 소비 이력을 바탕으로 **선형회귀 알고리즘**을 시뮬레이션합니다.")
    
    if db is None:
        st.warning("Firebase Admin이 초기화되지 않아 Mock 데이터를 사용합니다.")
        # Generate mock data
        dates = pd.date_range(end=datetime.datetime.now(), periods=30)
        np.random.seed(42)
        trend = np.linspace(5, 15, 30)
        noise = np.random.normal(0, 2, 30)
        history_df = pd.DataFrame({'date': dates, 'consumed': np.maximum(0, trend + noise)})
        current_stock = 150
    else:
        st.info("실제 Firestore 연동 기능은 제품 ID를 선택하여 구현할 수 있습니다. (현재는 Mock 데이터로 시연)")
        # Real integration would fetch from db.collection('inventory_items')...
        dates = pd.date_range(end=datetime.datetime.now(), periods=30)
        history_df = pd.DataFrame({'date': dates, 'consumed': np.linspace(5, 15, 30) + np.random.normal(0, 2, 30)})
        current_stock = 150
        
    colA, colB = st.columns([1, 2])
    
    with colA:
        st.subheader("파라미터 설정")
        lead_time = st.slider("리드타임 (일)", min_value=1, max_value=14, value=7)
        safety_stock = st.slider("안전재고 설정", min_value=0, max_value=100, value=20)
        
    with colB:
        st.subheader("시뮬레이션 결과")
        
        # 1. Linear Regression
        x = np.arange(len(history_df))
        y = history_df['consumed'].values
        m, b = np.polyfit(x, y, 1)
        
        avg_consumption = np.mean(y)
        projected_daily = max(avg_consumption + m * 5, 0.1) # 5일 후 예측 소비량
        
        days_until_depletion = (current_stock - safety_stock) / projected_daily
        reorder_day = days_until_depletion - lead_time
        
        # Display Metrics
        m1, m2, m3 = st.columns(3)
        m1.metric("현재 재고", f"{current_stock} 개")
        m2.metric("예상 일평균 소진", f"{projected_daily:.1f} 개")
        
        if reorder_day <= 0:
            m3.metric("권장 재주문 시점", "즉시 발주 필요!", delta="-경고", delta_color="inverse")
        else:
            m3.metric("권장 재주문 시점", f"약 {int(reorder_day)}일 후", delta="여유")
            
        # Chart
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.plot(history_df['date'], y, label="실제 소비량", marker='o')
        ax.plot(history_df['date'], m*x + b, color='red', linestyle='--', label="선형회귀 트렌드")
        ax.set_title("최근 30일 소비 트렌드")
        ax.legend()
        st.pyplot(fig)
