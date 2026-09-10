# 📦 AI-Native 범용 스마트 물류 및 창고 관리 시스템 (Universal Smart WMS)

> 모든 물류창고(일반 상온 공산품, 이커머스 풀필먼트, 의류, 전자부품, 신선/콜드체인 등)에 즉시 도입 가능한 차세대 범용 스마트 물류 관리 플랫폼입니다. 실시간 재고 관리, 국내 전 택배사 100% 자동 감지 및 실시간 배송 추적, AI 기반 물동량 예측 리포트, 지능형 작업장 CCTV 모니터링을 통합 제공합니다.

> 💡 **참고 (Sample Data 안내)**:  
> 현재 기본 연동된 샘플 데이터셋은 온도 관리가 요구되는 **콜드체인(수산물/신선식품) 물류 데이터**를 예시로 탑재하고 있습니다. 본 시스템의 데이터 스키마와 비즈니스 로직은 **모든 산업군의 상온·저온 창고 및 풀필먼트 센터에 100% 범용적으로 적용**할 수 있도록 설계되었습니다.

---

## 🌟 주요 기능 (Key Features)

### 1. 📦 범용 실시간 재고 관리 (`/`)
- **다목적 보관 구역 관리**: 메인 1창고, 고밀도 랙 보관소, 항온/항습실, 특수 저온실 등 창고 환경에 맞춘 구역별 실시간 재고 추적.
- **핵심 물류 KPI 대시보드**: 총 보관 수량/중량, 창고 가동률, 실시간 출고 대기 건수, 안전 재고(Safety Stock) 미달 및 결품 위험 알림.
- **지능형 재고 상태 추적**: 안전 재고 / 부족 / 과다 상태를 시각화하여 최적의 창고 회전율 유지.

### 2. 🚚 스마트 배송 관리 시스템 (`/delivery`)
- **국내 전 택배사 100% 자동 감지**:
  - 운송장 번호만 입력하면 우체국, CJ대한통운, 롯데택배, 한진택배, 로젠택배, 경동택배, 대신택배, 일양로지스 등 국내 모든 택배사를 번호 체계와 추천 엔진으로 실시간 자동 판별.
  - 사용자가 택배사를 일일이 찾아 선택할 필요가 전혀 없음.
- **실시간 택배 전산(API) 동기화 & 자동 단계 전진**:
  - 수동 버튼 조작 없이 백엔드 API 연동을 통해 실시간 이동 현황을 자동 수집.
  - 배송 진행 단계를 시간 및 상태에 따라 순차 전진 (`1. 상품인수` ➔ `2. 이동중` ➔ `3. 배송출발` ➔ `4. 배송완료`).
- **단계순 정렬 & 타임라인 가시성**:
  - 배송 진행 상태를 첫 단계(상품인수)부터 순서대로 정렬하여 출고 후 배송 흐름을 한눈에 파악.
- **배송 완료 24시간 자동 정리**:
  - 배송 완료 시점으로부터 1일(24시간) 경과 시 데이터 자동 보관 및 화면 자동 정리.

### 3. 📊 AI 인텔리전스 리포트 (`/report`)
- **일일 AI 종합 진단 브리핑**: 입출고량, 결품 위험율, 창고 가동률을 AI가 종합 분석하여 일일 브리핑 제공.
- **물동량 예측 & 자동 발주 제안**: 주간/월간 소비 트렌드 및 재고 소진 속도를 분석하여 최적 안전 재고량 및 긴급 발주 권고.
- **인터랙티브 리포트 상세 분석**: 모달 팝업을 통한 세부 지표 분석 및 리포트 내보내기 지원.

### 4. 📹 실시간 스마트 CCTV 모니터링 (`/monitor`)
- **애플 라이트 테마 기반 고시인성 UI**: 밝은 물류 현장 작업 환경에서도 또렷하게 식별 가능한 라이트 글래스모피즘 디자인.
- **멀티 채널 실시간 관제**: 하역장, 메인 보관 랙, 패킹 라인 등 구역별 실시간 스트리밍 모니터링.
- **AI 비전 이상 감지 로그**: 작업자 안전 장비 착용 여부, 지게차 동선 안전 거리 침범, 시설 이상 등을 AI 비전 모델이 실시간 감지하여 경보 발생.

---

## 🛠 기술 스택 (Tech Stack)

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript, React 18
- **Styling**: Tailwind CSS, Lucide React (Icons), Glassmorphism UI

### Backend & Database
- **API Engine**: Next.js API Routes (Serverless / Node.js)
- **Database**: MySQL 8.0+ / MariaDB (Connection Pooling via `mysql2/promise`)
- **Logistics Integration**: 스마트택배 배송조회 API 및 국내 택배사별 식별 알고리즘
- **Data Engine**: JSON-DB & MySQL 이중 백업 및 Fallback 시스템

---

## 🚀 빠른 시작 (Getting Started)

### 1. 저장소 클론 및 이동
```bash
git clone https://github.com/wjmals/WMS.git
cd WMS/wms/frontend
```

### 2. 패키지 설치
```bash
npm install
```

### 3. 환경 변수 설정
`wms/frontend/.env.local` 파일 생성 후 데이터베이스 정보 입력:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=wms_inventory
```

### 4. 개발 서버 실행
```bash
npm run dev
```
브라우저에서 [http://localhost:3000](http://localhost:3000) 접속.

---

## 📂 디렉토리 구조 (Project Structure)

```
WMS/
├── wms/
│   ├── frontend/
│   │   ├── app/
│   │   │   ├── page.tsx               # 범용 실시간 재고 현황 메인 대시보드
│   │   │   ├── delivery/page.tsx      # 스마트 배송 관리 (전 택배사 자동 감지)
│   │   │   ├── report/page.tsx        # AI 인텔리전스 수요예측 리포트
│   │   │   ├── monitor/page.tsx       # 실시간 CCTV 관제 (애플 라이트 테마)
│   │   │   └── api/                   # 백엔드 API (재고, 배송, 모니터링, AI)
│   │   ├── components/                # 공통 UI 컴포넌트
│   │   ├── lib/db.js                  # MySQL 커넥션 풀
│   │   └── public/                    # 정적 에셋
│   ├── db/                            # DB 스키마 및 마이그레이션 SQL
│   └── cv_client/                     # 비전 AI 감지 클라이언트 (Python)
└── README.md                          # 프로젝트 공식 문서
```

---

## 📄 라이선스 (License)
This project is licensed under the MIT License.
