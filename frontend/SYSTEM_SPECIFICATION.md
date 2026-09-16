# SmartStock AI WMS - 시스템 기술 명세서 (Technical Specification)

본 문서는 **AI Native Smart Warehouse Management System (WMS)** 프로젝트에 적용된 기술 스택, AI 모델/API, 데이터베이스, 보안 인증 및 안전재고 산출 메커니즘을 정밀하게 정리한 문서입니다.

---

## 🛠 1. 주요 기술 스택 & 개발 언어 (Technical Stack)

| 구분 | 적용 기술 및 라이브러리 | 상세 내용 |
| :--- | :--- | :--- |
| **개발 언어 (Languages)** | **TypeScript / JavaScript** | Type-safe 프론트엔드 및 서버리스 API 로직 작성 |
| **프레임워크 (Framework)** | **Next.js 14 (App Router)** | React 18 기반 SSR/CSR 혼합, Edge & Serverless API Routes |
| **UI 및 스타일링** | **Tailwind CSS & Framer Motion** | Apple 스타일 모던 UI Design, 반응형 레이아웃, 트랜지션 애니메이션 |
| **데이터 시각화** | **Recharts** | 최근 30일 시계열 수요예측 및 소비 동향 인터랙티브 그래프 |
| **아이콘 팩** | **Lucide React (`lucide-react`)** | 모던 벡터 아이콘 셋 적용 |
| **데이터베이스 (DB)** | **Google Firebase Firestore** | Real-time NoSQL 데이터베이스 (재고, 구역, CCTV 이력, 배송 정보 저장) |
| **배포 및 인프라** | **Vercel Platform & GitHub** | Vercel Serverless Cloud 호스팅, Git 버전 관리 및 CI/CD 자동화 |

---

## 🤖 2. 인공지능 (AI) 모델 & API 기술

### 1) Groq LLaMA-4 Scout Vision AI Engine
* **적용 모델**: `meta-llama/llama-4-scout-17b-16e-instruct` (via Groq Cloud SDK `groq-sdk`)
* **주요 역할**:
  * 실시간 CCTV 및 스마트폰 IP 카메라 영상 프레임 분석
  * 사전에 등록된 학습 레퍼런스 이미지 (`item_references`)와 실시간 카메라 화면을 시각적으로 대조하여 수산물/품목 자동 식별
  * 선반 및 보관 상태를 판단하여 추정 재고 수량, 상태 (안전/부족/과다) 및 AI 조치 가이드 생성
  * 분석 결과를 DB(`inventory_items` 및 `monitor_logs`)에 실시간 반영 및 창고 공실률 연동

### 2) 30일 시계열 AI 수요 예측 엔진 (Time-Series Forecasting)
* **주요 역할**:
  * 과거 출고 트렌드 데이터를 시계열 알고리즘으로 분석하여 일평균 소진 속도 산출
  * 안전재고 하한선 도달 예상 시점 (**D-Day 결품 위험 경고**) 자동 파악
  * 수급 불균형 방지를 위한 **AI 권장 긴급 발주량(톤)** 자동 계산

---

## 🔒 3. 보안 인증 및 사용자 역할 체계 (2-Tier RBAC)

* **보안 가드 (`AuthGuard.tsx`)**:
  * 비로그인 사용자의 모든 서비스 데이터 및 대시보드 접근 완벽 차단 (`/login` 자동 이동)
* **2단계 전용 권한 구조**:
  1. **총괄 관리자 (`관리자`)**: 전체 기능 이용, 품목/배송건 삭제 권한, 창고 구역 배치 설정 및 AI 학습 데이터 제어 권한.
  2. **창고지기**: 실시간 재고 조회, 현장 바코드 스캔, 입출고 수량 조정(+/- 톤) 및 AI 리포트 조회 권한 (삭제 및 시스템 설정 제한).

---

## 📊 4. 시스템 내 안전재고(Safe Stock) 파악 및 산출 메커니즘

### 1) 안전재고(Safe Stock)의 정의
안전재고란 급격한 수요 증가, 입고 지연 또는 자연 감소 등 불확실성에 대비하여 **창고에 항상 유지해야 하는 최저 기준 재고량(톤)**입니다.

### 2) 상태 자동 판정 알고리즘
시스템은 각 품목의 **현재 실재고량(`current`)**과 **설정된 안전재고 기준(`safe`)**을 비교하여 실시간으로 상태를 자동 판정합니다:

$$\text{상태 판정 기준}$$

* 🔴 **재고 부족 (`shortage`)**: $\text{current} < \text{safe} \times 0.5$
  * 안전재고 하한선의 50% 미만으로 떨어진 상태.
  * **조치**: 긴급 추가 발주 알림 및 권장 발주량 제시.
* 🟢 **안전 재고 (`safe`)**: $\text{safe} \times 0.5 \le \text{current} \le \text{safe} \times 2.0$
  * 적정 유통 수급 범위 내에 유지되는 정상 상태.
  * **조치**: 현 유통/출하 계획 유지.
* 🟡 **재고 과다 (`overstock`)**: $\text{current} > \text{safe} \times 2.0$
  * 안전재고 기준의 2배를 초과하여 창고 점유율이 너무 높은 상태.
  * **조치**: 프로모션 추진 및 조기 출하 권고.

### 3) 안전재고 파악 방법 (어디서 확인하는가?)
1. **메인 대시보드 (`/`)**:
   * 상단 KPI 카드를 통해 전체 품목 중 **안전 재고 수량**, **재고 부족 품목 수**, **과다 재고 품목 수**를 즉시 확인.
   * 창고 구역 모니터링 카드에서 실재고 용량 기준 **공실률(emptyRatio %)** 실시간 파악.
2. **스마트 바코드 스캐너 (`/barcode`)**:
   * 카메라 스캔 또는 품목 검색 시 해당 품목의 **현재 재고량, 안전 재고량, 부족/초과 톤수** 및 AI 조치 가이드 팝업.
3. **AI 리포트 (`/report`)**:
   * 30일 시계열 소진 속도 기준 결품 위험 예상일(**D-N**) 및 AI 권장 발주량 확인.
4. **실시간 CCTV 모니터링 (`/monitor`)**:
   * AI 비전 감지로 재고 감소 시 즉시 경고 알림 발동 및 DB 자동 갱신.
