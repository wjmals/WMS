# WMS 데이터셋 및 데이터베이스 구조

이 문서는 현재 저장소에 포함된 샘플 데이터와 실행 코드가 사용하는 런타임 데이터 구조를 정리한 것입니다.

## 1. 데이터 저장소 개요

| 구분 | 위치 | 역할 | 상태 |
| --- | --- | --- | --- |
| 초기 재고 샘플 | `frontend/data/inventory.json` | 개발 및 초기화용 재고 목록 | 정적 JSON |
| 초기 사용자 샘플 | `frontend/data/users.json` | 로컬 사용자 fallback 및 서버 관리자 기본 계정 | 정적 JSON |
| 운영 재고/구역/비전 데이터 | Firebase Firestore | 창고별 실제 런타임 데이터 | 운영 저장소 |
| 사용자 및 승인 데이터 | Firebase Firestore + `frontend/data/users.json` fallback | 로그인, 역할, 승인 상태 | 혼합 구조 |
| 배송 데이터 | Firestore `delivery_tracking` | 운송장 및 배송 상태 | 운영 저장소 |
| CV 카메라 상태 | Firebase Realtime Database | Python CV 클라이언트의 구역 상태 | 별도 런타임 저장소 |
| CV 이미지 | Firebase Storage | 상태 변화 시 카메라 이미지 | 파일 저장소 |

## 2. 정적 초기 데이터

### 2.1 재고 샘플: `frontend/data/inventory.json`

최상위 값은 재고 문서 배열입니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 재고 품목 식별자. 예: `SEA-2026-001` |
| `name` | string | 품목명 |
| `status` | `shortage` \| `safe` \| `overstock` | 재고 상태 코드 |
| `statusLabel` | string | 화면 표시용 상태명 |
| `current` | number | 현재 재고량. 기본 단위는 톤 |
| `safe` | number | 안전 재고 기준량 |
| `diffText` | string | 차이 표시용 문장 |
| `recommendation` | string | 상태에 따른 권고 문장 |
| `cycle` | string | 재고 관리 주기. 예: `월간` |
| `date` | ISO 날짜 문자열 | 데이터 기준일 |

현재 샘플에는 수산물 10개 품목이 포함되어 있습니다. 이 JSON은 `seed_db.js`, `seed_mysql.js`에서 SQLite/MySQL 초기 데이터로도 사용됩니다.

### 2.2 사용자 샘플: `frontend/data/users.json`

현재 정적 파일에는 기본 서버 관리자 계정이 포함되어 있습니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 사용자 ID |
| `username` | string | 관리자 로그인용 사용자명 |
| `email` | string | 이메일 |
| `password` | string | 현재 구현에서는 평문 fallback 비밀번호. 운영 환경 사용 금지 |
| `name` | string | 표시 이름 |
| `role` | string | `서버 관리자`, `관리자`, `창고지기` |
| `status` | string | `APPROVED`, `PENDING_ADMIN`, `PENDING_WAREHOUSE` |
| `warehouseId` | string/null | 소속 창고 ID |

운영 사용자 데이터는 Firestore `users` 컬렉션과 합쳐지며, Firestore 데이터가 같은 이메일의 로컬 데이터보다 우선합니다.

## 3. Firestore 구조

### 3.1 창고별 하위 컬렉션

운영 웹 API가 사용하는 기본 경로는 다음과 같습니다.

```text
warehouses/{warehouseId}/inventory_items/{itemId}
warehouses/{warehouseId}/warehouse_zones/{zoneId}
warehouses/{warehouseId}/item_references/{referenceId}
warehouses/{warehouseId}/monitor_logs/{logId}
```

기본 창고 ID는 `wh_wjmals`입니다.

### 3.2 `inventory_items`

재고 품목 하나를 문서 하나로 저장합니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 샘플 데이터의 논리적 ID. Firestore 문서 ID와 다를 수 있음 |
| `name` | string | 품목명 |
| `current` | number | 현재 재고량 |
| `safe` | number | 안전 재고량 |
| `status` | string | `shortage`, `safe`, `overstock` |
| `statusLabel` | string | 상태 표시명 |
| `diffText` | string | 현재량과 안전량의 차이 |
| `recommendation` | string | 발주/출하 권고 |
| `cycle` | string | 관리 주기 |
| `date` | string | 기준일 |
| `createdAt` | timestamp 또는 ISO 문자열 | 생성 시각 |
| `updatedAt` / `updated_at` | timestamp 또는 ISO 문자열 | 수정 시각 |

재고 상태 판정 기준은 API에서 다음과 같이 사용됩니다.

- `current < safe * 0.5`: `shortage`
- `current > safe * 2`: `overstock`
- 그 사이: `safe`

### 3.3 `warehouse_zones`

창고 보관 구역 하나를 문서 하나로 저장합니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 구역 ID. 예: `zone_A1` |
| `name` | string | 구역명 |
| `state` | string | `normal`, `warning`, `shortage`, `empty` |
| `stateLabel` | string | 계산된 화면 표시 상태 |
| `temp` | string | 보관 온도. 예: `-22°C` |
| `items` | string[] | 해당 구역에 배치된 품목명 배열 |
| `capacity` | number | 수용 용량 |
| `currentStockSum` | number | 연결된 품목의 현재량 합계. 조회 시 계산 |
| `emptyRatio` | number | 공실률 0~1. 조회 시 계산 |
| `updated_at` | string | 수정 시각 |

`currentStockSum`과 `emptyRatio`는 저장된 원본값이 아니라 재고와 구역을 조합해 GET 요청마다 계산되는 파생 데이터입니다.

### 3.4 `item_references`

비전 분석용 품목 레퍼런스 이미지 문서입니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `name` | string | 레퍼런스 품목명 |
| `description` | string | 시각적 특징 설명 |
| `thumbnail` | string | base64 이미지 문자열. 현재 최대 50,000자 저장 |
| `createdAt` | Firestore timestamp | 등록 시각 |

모니터링 분석 시 최대 3개의 레퍼런스 이미지가 Llama 4 Vision 프롬프트에 함께 전송됩니다.

### 3.5 `monitor_logs`

카메라 AI 분석 1회당 로그 문서 하나를 저장합니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `camera_url` | string | 카메라 식별자 또는 URL |
| `item_name` | string | AI가 식별한 품목명 |
| `status` | string | `shortage`, `safe`, `overstock` |
| `status_label` | string | 상태 표시명 |
| `estimated_quantity` | number | AI 추정 수량 |
| `unit` | string | `톤`, `개`, `박스`, `kg` |
| `confidence` | number | AI 신뢰도 0~100 |
| `recommendation` | string | AI 권고 |
| `reason` | string | 판단 근거 |
| `image_snapshot` | string | 이미지 data URL의 앞부분 최대 1,000자 |
| `analyzed_at` | Firestore timestamp | 분석 시각 |

조회 API는 `analyzed_at` 내림차순으로 최대 50건을 반환합니다.

### 3.6 `users`

사용자와 승인 상태를 저장하는 루트 Firestore 컬렉션입니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `id` | string | 애플리케이션 사용자 ID |
| `username` | string | 선택적 사용자명 |
| `email` | string | 로그인 및 승인 연결 키 |
| `password` | string | 현재 구현은 평문 저장. 운영 환경에서는 해시 저장 필요 |
| `name` | string | 사용자 이름 |
| `role` | string | `서버 관리자`, `관리자`, `창고지기` |
| `status` | string | `APPROVED`, `PENDING_ADMIN`, `PENDING_WAREHOUSE` |
| `warehouseId` | string/null | 소속 창고 |
| `adminEmail` | string/null | 승인 담당 관리자 이메일 |
| `requestedAdminEmail` | string/null | 로그인 후 별도 권한 요청으로 지정한 관리자 |
| `createdAt` | ISO 문자열 | 가입 시각 |
| `approvedAt` | ISO 문자열 | 승인 시각 |

### 3.7 `warehouse_access_requests`

창고지기 권한 요청을 별도로 기록하는 루트 컬렉션입니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `userEmail` | string | 요청 사용자 이메일 |
| `userName` | string | 요청 사용자 이름 |
| `adminEmail` | string | 승인 담당 관리자 |
| `status` | string | 현재는 `PENDING` 중심으로 사용 |
| `requestedAt` | ISO 문자열 | 요청 시각 |

회원가입 시 `users.adminEmail`에 먼저 저장되고, 로그인 후 별도 권한 요청을 보내면 이 컬렉션에도 문서가 생성됩니다.

### 3.8 `delivery_tracking`

루트 컬렉션에 운송장 하나당 문서 하나를 저장합니다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `invoice_no` | string | 숫자만 남긴 운송장 번호 |
| `carrier_code` | string | 택배사 코드 |
| `carrier_name` | string | 택배사명 |
| `item_name` | string | 배송 품목명 |
| `sender_name` | string | 발송인 |
| `receiver_name` | string | 수취인 |
| `status` | string | 배송 상태 표시명 |
| `status_code` | string | `AT_PICKUP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED` |
| `current_location` | string | 현재 위치 |
| `delivered_at` | string/null | 배송 완료 시각 |
| `tracking_details` | object[] 또는 string | 배송 이력 |
| `created_at` | string | 등록 시각 |
| `updated_at` | string | 마지막 동기화 시각 |

배송 완료 후 24시간이 지나면 조회 과정에서 자동 삭제됩니다. 배송 API 데이터가 실시간으로 갱신되지 않으면 화면에 마지막 저장 상태가 표시될 수 있습니다.

## 4. 컴퓨터 비전 클라이언트 데이터

`cv_client/inventory_detector.py`는 웹 API와 별도의 Python 프로세스입니다.

### 입력

- OpenCV 웹캠 프레임
- YOLOv8 `yolov8n.pt` 모델의 객체 감지 결과
- 코드에 정의된 ROI 다각형: `zone_A1`, `zone_A2`

### 계산 결과

| 필드 | 설명 |
| --- | --- |
| `state` | `normal`, `low`, `empty` |
| `emptyRatio` | ROI 기준 공실률 0~1 |
| `lastUpdate` | Unix milliseconds |
| `zoneName` | ROI 구역명 |
| `lastImageUrl` | 상태 변화 시 업로드한 Firebase Storage 이미지 URL |

### Realtime Database 경로

```text
/inventory/camera_zones/{zoneId}
```

상태가 `normal`에서 `low` 또는 `empty`로 바뀌면 Firebase Functions가 `admin_alerts` FCM 토픽으로 알림을 보내고, Firestore `inventory_alerts`에 기록합니다.

## 5. Firebase Functions 수요 예측 스키마

`backend/functions/src/inventory/index.ts`도 웹 API와 같은 창고별 재고 컬렉션을 사용합니다.

```text
warehouses/{warehouseId}/inventory_items/{itemId}/history/{historyId}
```

### `history` 문서

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `date` | timestamp/date | 소비 기록 날짜 |
| `consumed` | number | 해당 날짜 소비량 |

함수는 최근 30일의 `consumed` 값을 이용해 평균 소비량과 선형 추세를 계산하고, 재고 문서의 `current`, `leadTime`, `reorderAlertSent`, `daysUntilDepletion` 필드를 사용합니다.

현재 기본 Functions 실행 대상은 `wh_wjmals`입니다. 다른 창고를 지원할 때는 함수 입력 또는 스케줄 설정에서 `warehouseId` 범위를 명시해야 합니다.

## 6. 데이터 관계

```text
users.adminEmail -> 승인 담당 관리자
users.warehouseId -> warehouses/{warehouseId}
warehouses/{warehouseId}/inventory_items -> warehouse_zones.items의 품목명
warehouses/{warehouseId}/item_references -> monitor_logs 및 Llama Vision 입력
monitor_logs 결과 -> inventory_items.current/status 갱신
warehouse_zones + inventory_items -> currentStockSum/emptyRatio 계산
```

## 7. 현재 구조의 주의사항

1. `frontend/app/api/inventory/route.ts`는 `frontend/data/inventory.json`을 초기화 기준으로 사용합니다.
2. 사용자 비밀번호가 JSON과 Firestore에 평문으로 저장됩니다. 상용 서비스에서는 반드시 해시 기반 인증으로 교체해야 합니다.
3. Python CV 클라이언트는 카메라 텔레메트리 전용으로 Realtime Database를 사용하고, 웹 모니터링 API는 분석 결과와 재고를 Firestore에 저장합니다. 서로 다른 데이터 종류이므로 분리되어 있습니다.
5. `warehouse_zones.items`가 품목 ID가 아닌 품목명으로 연결됩니다. 품목명 변경 시 구역 연결이 끊길 수 있으므로 운영 데이터에서는 품목 ID 참조가 더 안전합니다.
6. base64 이미지와 CCTV 데이터는 크기가 커질 수 있으므로 보관 기간, 접근 권한, 삭제 정책을 별도로 두어야 합니다.
7. Firestore timestamp와 ISO 문자열 필드가 혼용되어 있습니다. 날짜 필드 형식을 통일하는 것이 좋습니다.

## 8. 관련 코드 위치

- 초기 재고: `frontend/data/inventory.json`
- 초기 사용자: `frontend/data/users.json`
- 재고 API: `frontend/app/api/inventory/route.ts`
- 구역 API: `frontend/app/api/zones/route.ts`
- 사용자/승인 API: `frontend/app/api/users/route.ts`
- 배송 API: `frontend/app/api/delivery/route.ts`
- 비전 레퍼런스 API: `frontend/app/api/vision/route.ts`
- AI 모니터링 API: `frontend/app/api/monitor/route.ts`
- Python CV 클라이언트: `cv_client/inventory_detector.py`
- 수요 예측 Functions: `backend/functions/src/inventory/index.ts`
