# WMS API 명세서

- 버전: 1.1
- 갱신일: 2026-10-07
- 백엔드: Rust, Axum, SQLx, PostgreSQL 16
- 프론트엔드 프록시: Next.js `/api/*` -> Rust API
- 기본 Rust URL: `http://localhost:8080`
- 기본 창고: `wh_wjmals`

## 1. 공통 규칙

### 기본 URL

- Rust API 직접 호출: `http://localhost:8080`
- 브라우저에서 사용하는 API: `http://localhost:3000/api`
- `frontend/app/api/` 아래의 Next.js 라우트가 Rust API로 요청을 프록시한다.

### 헤더

JSON 요청에는 다음 헤더를 포함해야 한다.

```http
Content-Type: application/json
```

### 공통 상태 코드

| 상태 코드 | 의미 |
|---|---|
| 200 | 요청 성공 |
| 201 | 리소스 생성 |
| 400 | 입력값 누락 또는 잘못됨 |
| 404 | 리소스 또는 계정을 찾을 수 없음 |
| 422 | JSON 형식 오류 |
| 500 | DB 또는 서버 내부 오류 |
| 502 | 외부 AI 제공자 오류 |
| 503 | DB 또는 필수 외부 설정 미구성 |

### 인증 및 창고 인가

`POST /api/users`의 `login`, `signup`만 공개다. 나머지 API는 `Authorization: Bearer <JWT>`를 요구하며, 직접 호출에도 동일한 검사가 적용된다. JWT는 12시간 후 만료된다. Next.js는 로그인 응답의 토큰을 `HttpOnly`, `SameSite=Lax`, `/api` 범위 쿠키에 저장하고 프록시에서 Rust API로 전달한다. 로그아웃은 쿠키를 삭제한다.

일반 사용자의 권한은 JWT만으로 결정하지 않는다. Rust API가 매 요청마다 DB에서 계정 ID, 역할, 승인 상태, 창고 배정을 다시 확인한다. 재고·구역·비전·모니터·배송 데이터는 로그인된 창고로 한정되며 요청의 다른 `warehouseId`는 거부된다. 서버 관리자 전역 작업은 서버 관리자 토큰만 허용한다. 승인 대기 상태는 계정 정보 확인과 접근 요청 외의 업무 API를 사용할 수 없다.

Next.js 경유 요청은 자동으로 쿠키 세션을 전달한다. Rust API 직접 호출은 로그인 응답의 토큰을 Bearer 헤더에 명시해야 한다. `/health`는 인증 없이 사용할 수 있다.

재고·장부·용량의 `NUMERIC(20,6)` 값은 Rust `Decimal` 정밀도를 보존하기 위해 JSON 십진수 문자열로 반환될 수 있다(예: `"120.500000"`). 클라이언트는 수량 계산 전에 숫자로 변환하고, 다시 저장할 때는 반올림 없이 허용 정밀도를 지켜야 한다. PostgreSQL에는 정확한 `NUMERIC` 값으로 저장한다.

## 2. Health

### `GET /health`

```json
{
  "status": "ok",
  "database": "configured"
}
```

`DATABASE_URL`이 없으면 `database`는 `not_configured`가 된다. 이 경우 프로세스는 health-only 모드로 시작할 수 있지만, 데이터 관련 엔드포인트는 `503`을 반환한다.

## 3. 사용자 및 인증

### `POST /api/users`

`action` 필드로 동작을 선택한다.

#### 로그인

```json
{
  "action": "login",
  "username": "user@example.com",
  "password": "password"
}
```

`username`에는 이메일 또는 아이디를 사용할 수 있고, `email`로도 대체 가능하다.

내장 서버 관리자: 아이디 `wjmals`, 이메일 `wjmals@wms-smartstock.ai`. 비밀번호는 현재 Rust 구현에 하드코딩되어 있으며 `users` 테이블에는 저장되지 않는다.

비밀번호는 `SUPER_ADMIN_PASSWORD` 환경변수에서만 읽는다. 안전한 배포 비밀로 설정해야 하며 설정되지 않으면 서버 관리자 로그인은 `503`으로 거부된다. JWT 서명 키는 `JWT_SECRET` 환경변수에 충분히 무작위인 고정 값으로 설정한다. 로컬 개발에서 생략하면 프로세스 시작 때 임시 키를 생성하므로 API 재시작 후 기존 세션은 무효화된다.

로컬에서는 Git 제외 파일 `rust-backend/.env.local`에 `JWT_SECRET`, `SUPER_ADMIN_PASSWORD`를 지정할 수 있다. 애플리케이션은 이 파일을 일반 `.env`보다 먼저 읽는다.

Rust API의 성공 응답에는 `token`이 포함된다. Next.js 브라우저 프록시는 토큰을 HttpOnly 쿠키로 옮기고 JSON 응답에서는 제거한다. 사용자 정보 응답 예:

```json
{
  "success": true,
  "user": {
    "id": "uuid-or-usr_wjmals",
    "username": "user",
    "email": "user@example.com",
    "name": "User",
    "role": "관리자",
    "status": "APPROVED",
    "warehouseId": "wh_example",
    "adminEmail": null,
    "requestedAdminEmail": null,
    "createdAt": "2026-09-23T00:00:00Z",
    "approvedAt": "2026-09-23T00:00:00Z"
  }
}
```

#### 회원가입 (관리자)

```json
{
  "action": "signup",
  "username": "manager",
  "email": "manager@example.com",
  "password": "password",
  "name": "Warehouse Manager",
  "role": "관리자"
}
```

`PENDING_ADMIN` 상태로 시작한다.

#### 회원가입 (창고지기)

```json
{
  "action": "signup",
  "username": "worker",
  "email": "worker@example.com",
  "password": "password",
  "name": "Warehouse Worker",
  "role": "창고지기",
  "adminEmail": "manager@example.com"
}
```

`PENDING_WAREHOUSE` 상태로 시작한다. 창고지기는 `adminEmail`이 필수다.

#### 관리자 승인

```json
{ "action": "approve_admin", "targetEmail": "manager@example.com" }
```

필요 시 `wh_<이메일 앞부분>` 창고를 생성하고 관리자를 `APPROVED`로 변경한다.

#### 창고지기 승인

```json
{
  "action": "approve_user",
  "targetEmail": "worker@example.com",
  "adminEmail": "manager@example.com"
}
```

창고지기를 관리자의 창고에 배정하고 `APPROVED`로 변경한다.

#### 창고 접근 요청

```json
{
  "action": "request_access",
  "email": "worker@example.com",
  "adminEmail": "manager@example.com"
}
```

#### 기본 비밀번호로 창고지기 초대

```json
{
  "action": "invite_user",
  "targetEmail": "worker@example.com",
  "adminEmail": "manager@example.com"
}
```

대상 창고지기가 없으면 기본 비밀번호 `123456`으로 계정을 생성한다. 운영 배포 전 반드시 교체해야 한다.

#### 사용자 삭제

```json
{ "action": "delete_user", "targetEmail": "worker@example.com" }
```

내장 서버 관리자 계정은 이 동작으로 삭제할 수 없다.

### `GET /api/users`

| 쿼리 | 결과 |
|---|---|
| 없음 | 전체 사용자 |
| `action=get_user&email=<이메일 또는 아이디>` | 단일 사용자 |
| `action=list_requests&adminEmail=<이메일>` | 대기 중인 창고지기 요청과 승인된 팀원 목록 |
| `action=list_admin_requests` | 관리자 승인 요청 목록 |

## 4. 재고

### `GET /api/inventory?warehouseId=<id>`

품목명 순으로 재고 목록을 반환한다. 기본값은 `wh_wjmals`.

### `POST /api/inventory`

```json
{
  "warehouseId": "wh_wjmals",
  "name": "Frozen Fish",
  "barcode": "8801234567890",
  "current": 120.5,
  "safe": 100.25,
  "unit": "kg",
  "packageUnit": "상자",
  "packageSize": 12.5,
  "note": "초기 실사 등록",
  "cycle": "월간"
}
```

`201`을 반환한다. 수량은 `NUMERIC(20,6)` 소수이며 잔량과 안전재고는 0 이상이어야 한다. `unit`은 기준 단위, `packageUnit`은 선택 포장 단위, `packageSize`는 포장 하나에 해당하는 기준 단위 수량이다. 선택 필드 `barcode`는 창고 내에서 고유하다. 초기 수량은 담당자·출처·사유와 함께 `initial` 장부 및 감사 이벤트로 기록된다.

### `PATCH /api/inventory`

```json
{
  "id": "uuid",
  "warehouseId": "wh_wjmals",
  "quantity": 2.5,
  "quantityUnit": "상자",
  "movementType": "inbound",
  "safe": 100.25,
  "note": "발주서 PO-2026-19 입고",
  "source": "barcode"
}
```

`quantity`/`quantityUnit` 입력은 기준 단위나 등록된 포장 단위여야 한다. 포장 입력은 `packageSize`로 기준 단위에 환산한다. 기존 클라이언트 호환을 위해 새 절대 잔량 `current` 방식도 받을 수 있다. `movementType`은 증감 부호와 일치해야 한다. 사유는 필수다. 서버는 잔량·상태·장부·감사 이벤트를 한 트랜잭션으로 저장한다.

### `DELETE /api/inventory?id=<uuid>&warehouseId=<id>`

물리 삭제가 아니라 보관 처리다. 선택 쿼리 `reason`에 보관 사유를 전달한다. `archived_at`을 설정하고 담당자/사유 감사 이벤트를 기록하며 해당 품목의 장부는 보존된다.

### `GET /api/inventory/movements?warehouseId=<id>&days=30`

반환 기간은 1~365일로 제한된다. 응답은 매일의 실입고량, 실출고량, 기타 조정량, 변동 건수다. 창고 사용자는 세션에 배정된 창고만 조회할 수 있다. 기존 재고는 최초 마이그레이션 시 기초 잔액으로 기록하며 실제 과거 입출고 데이터인 것처럼 계산하지 않는다.

재고 생성은 `initial` 잔액으로, `PATCH /api/inventory`는 `movementType`(`inbound`, `outbound`, `adjustment`)와 `note`로 변동을 기록한다. 재고 변경과 변동 로그는 같은 DB 트랜잭션에 저장된다.

### `GET /api/inventory/forecast?warehouseId=<id>&historyDays=90`

투명한 기준선 모델로 품목별 다음 7일 출고량을 계산하고, 마지막 7일을 하루씩 앞당기는 rolling-origin 백테스트 MAPE를 반환한다. 모델은 직전 28개 완료 일자의 평균 출고량을 다음 날 예측값으로 사용한다. 오늘 진행 중인 날짜는 학습과 평가에서 제외한다. 최소 28일 학습 + 7일 검증 이력이 없는 품목에는 `insufficient_data`, `forecastOutflow7d: null`, `mapePct: null`을 반환한다. 실제 출고가 0인 검증일은 MAPE 표본에서 제외하며, 비영 출고 검증일이 없으면 MAPE는 측정 불가다.

응답의 전체 `mapePct`는 품목별 비영 출고 검증일 수로 가중한 값이다. `accuracyPct`는 UI 참고용 `max(0, 100 - MAPE)` 변환치이며 정확도 보증이 아니다. `targetMet`은 92% 기준을 참고로 평가한다. 품절률은 재고가 없어 미충족된 주문/수요가 DB에 기록되지 않으므로 항상 `null`이며 `stockoutMetricStatus`는 `not_measurable`이다. 출고량 기준선은 실제 수요 예측이나 발주 권고를 뜻하지 않는다.

### `GET /api/inventory/ledger?warehouseId=<id>&days=90`

감사 확인용 원시 장부를 최근 순으로 반환한다. 행에는 품목, 변동 유형, 소수 증감량, 변경 후 잔량, 담당자, 출처, 사유, 발생 시각이 포함된다. `days`는 조회 한도를 정하는 1~365일 값이다.

### `POST /api/inventory/import`

과거 거래 배치를 검증하고 승인 대기로 저장한다. `warehouseId`, `sourceName`, `rows`를 받는다. 한 요청은 1~5,000행이며 행마다 `inventoryItemId`, 과거 `occurredAt`, `movementType`, `quantity`, 선택 `quantityUnit`, 필수 `note`, 선택 `reference`가 필요하다. 기준 단위/포장 단위를 환산하되 현재 잔량은 변경하지 않는다. 응답은 `202`와 `batchId`, `PENDING`을 반환한다.

### `GET /api/inventory/imports?warehouseId=<id>`

해당 창고의 최근 가져오기 배치, 제출자, 행 수, 승인 상태와 검토 사유를 반환한다.

### `POST /api/inventory/imports/review`

창고 관리자 또는 서버 관리자가 배치를 한 번만 승인/반려한다.

```json
{ "id": "batch-uuid", "approve": true, "note": "원본 전표 확인 완료" }
```

승인은 행이 기존 최초 장부보다 과거이고, 역산 기초 잔량과 시간순 중간 잔량이 음수가 아닐 때만 전체 성공한다. 과거 장부만 추가하며 현재 잔량은 바꾸지 않는다. 다른 창고의 배치를 검토할 수 없다.

### 재고 상태 판정 기준

- `shortage`: `current < safe * 0.5`
- `safe`: `safe * 0.5 <= current <= safe * 2.0`
- `overstock`: `current > safe * 2.0`

## 5. 창고 구역

### `GET /api/zones?warehouseId=<id>`

각 구역의 `items`에 배정된 품목 중 `capacityUnit`과 기준 단위가 같은 항목만 합산해 `currentStockSum`으로 반환하고, `capacity` 대비 `emptyRatio`를 계산한다. 재고 0은 `empty`, 용량 초과는 `warning`, 그 외는 `normal` 상태다. 단위 간 자동 환산은 하지 않는다.

### `POST /api/zones`

`(warehouseId, id)`를 충돌 키로 사용해 구역을 생성 또는 갱신한다.

```json
{
  "id": "A-01",
  "warehouseId": "wh_wjmals",
  "name": "냉동 보관 A-01",
  "state": "normal",
  "stateLabel": "정상",
  "temp": "-20°C",
  "items": [],
  "capacity": 100000,
  "capacityUnit": "kg"
}
```

`id`, `warehouseId`, `name`은 필수다.

### `DELETE /api/zones?id=<zone-id>&warehouseId=<id>`

## 6. 비전 레퍼런스

### `GET /api/vision?warehouseId=<id>`

해당 창고에 등록된 레퍼런스 이미지를 반환한다.

### `POST /api/vision`

```json
{
  "warehouseId": "wh_wjmals",
  "image": "data:image/jpeg;base64,...",
  "name": "Frozen Fish",
  "description": "Reference image"
}
```

이미지는 썸네일 문자열로 저장되며 최대 50,000자로 제한된다.

### `DELETE /api/vision?id=<uuid>`

`warehouseId`도 전달해야 하며 세션의 창고 범위 안에서만 삭제된다.

### `GET /api/vision/estimates?warehouseId=<id>`

창고별 승인 대기 비전 추정치, 모델 신뢰도와 판단 근거를 반환한다.

### `POST /api/vision/estimates/review`

창고 관리자 또는 서버 관리자가 추정치를 승인 또는 반려한다. 승인 시 `id`, `approve: true`, 대상 `inventoryItemId`, 사유 `note`를 전달한다. 등록된 기준/포장 단위에 맞지 않는 추정은 거부한다. 승인 전에는 현재 잔량을 변경하지 않는다.

### `POST /api/vision/import`

엑셀에서 읽은 레퍼런스를 원자적으로 일괄 등록한다. 최대 500개이며 각 이미지는 50,000자 이하 data URL이어야 한다. 일반 사용자의 `warehouseId`는 세션에서 확인한 창고와 일치해야 한다.

```json
{
  "warehouseId": "wh_example",
  "items": [
    { "name": "Frozen Fish", "description": "은빛 비늘", "image": "data:image/jpeg;base64,..." }
  ]
}
```

한 항목이라도 검증에 실패하면 트랜잭션 전체가 롤백된다. 응답은 등록 건수를 반환한다. 프런트엔드 일괄 요청 크기 제한은 20MB다.

## 7. 배송

### `GET /api/delivery`

세션 사용자의 창고에 속한 미배송 건과 최근 24시간 이내 배송 완료 건을 반환한다. 서버 관리자는 전체 목록을 조회할 수 있다.

### `POST /api/delivery`

```json
{
  "invoice_no": "1234567890",
  "carrier_code": "04",
  "carrier_name": "CJ대한통운",
  "item_name": "Frozen Fish",
  "sender_name": "WMS 스마트 물류센터",
  "receiver_name": "고객님"
}
```

Rust DTO는 snake_case 필드명을 사용한다. Next 라우트는 요청 본문을 그대로 전달한다. 운송장 번호는 숫자만 남기고 정규화된다.
서버가 창고 ID를 세션에서 정하며, 요청 본문으로 다른 창고를 지정할 수 없다.

### `PUT /api/delivery`

외부 추적을 호출하지 않고 수동 상태를 한 단계 전이한다. 자동 배송 조회에는 아래 추적 엔드포인트를 사용한다.

```json
{ "id": "uuid" }
```

상태 전이 순서: `AT_PICKUP` -> `IN_TRANSIT` -> `OUT_FOR_DELIVERY` -> `DELIVERED`.

### `DELETE /api/delivery?id=<uuid>`

### `POST /api/delivery/track`

```json
{ "id": "uuid" }
```

서버가 `SWEET_TRACKER_API_KEY`를 사용해 SweetTracker `POST /api/v1/trackingInfo`에 택배사 코드(`t_code`)와 운송장 번호(`t_invoice`)를 전달한다. 실제 응답의 배송 단계, 위치, 상세 시각을 창고에 격리된 배송 행에 저장한다. API 키 미설정 시 `503`, 제공자 오류 시 `502`, 배송 이력이 없으면 `404`다. 이 API 키는 브라우저에 노출하지 않는다.

## 8. 모니터링 및 AI 비전

### `GET /api/monitor?warehouseId=<id>`

해당 창고의 최근 모니터 로그 50건을 반환한다.

### `POST /api/monitor`

```json
{
  "image": "data:image/jpeg;base64,...",
  "itemName": "Frozen Fish",
  "cameraUrl": "webcam",
  "warehouseId": "wh_wjmals"
}
```

`GROQ_API_KEY`가 필요하다. `GROQ_VISION_MODEL`은 이미지 입력이 가능한 계정 모델 ID이며 기본값은 `qwen/qwen3.8-27b`다. 서버는 해당 창고의 `item_references`에서 레퍼런스 이미지를 최대 3개까지 불러오고(`itemName`이 정확히 일치하는 레퍼런스를 우선 사용), 현재 카메라 이미지와 함께 Groq 비전 모델로 전송한 뒤 모니터 로그와 `PENDING` 추정 레코드를 저장한다. 일치 품목이 있을 경우 기준/포장 단위를 프롬프트에 제공한다. 추정 결과만으로 현재 재고를 갱신하지 않으며, 관리자 승인 후에만 장부에 반영한다. 이는 요청 시점의 레퍼런스 기반 추론이며 모델 파인튜닝이 아니다.

실패 동작: `GROQ_API_KEY` 미설정 시 `503`, 외부 제공자 오류나 파싱 실패 시 `502`를 반환한다.

## 9. 데이터베이스 엔터티

| 테이블 | 용도 |
|---|---|
| `warehouses` | 창고 마스터 데이터 |
| `users` | 계정, 역할, 승인 상태, 비밀번호 해시 |
| `inventory_items` | 현재/안전 재고와 계산된 상태 |
| `inventory_movements` | 기초 잔액, 실제 입고·출고·조정 장부 |
| `inventory_audit_events` | 담당자, 사유, 출처, 재고 변경 전후와 보관 감사 이력 |
| `inventory_movement_import_batches` / `inventory_movement_import_rows` | 승인 대기 과거 거래 가져오기 |
| `inventory_vision_estimates` | 관리자 검토 대기 비전 추정치 |
| `warehouse_zones` | 창고 구역, 용량, 상태, 품목 JSON |
| `warehouse_access_requests` | 창고지기 접근 요청 |
| `item_references` | 비전 레퍼런스 이미지 |
| `monitor_logs` | AI 모니터링 결과 |
| `delivery_tracking` | 배송 상태 및 이력 |

## 10. 운영 환경 설정

```env
DATABASE_URL=postgres://wms:wms_password@localhost:5432/wms
PORT=8080
JWT_SECRET=<long-random-secret>
SUPER_ADMIN_PASSWORD=<unique-admin-password>
FRONTEND_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
GROQ_API_KEY=<POST /api/monitor에 필요>
SWEET_TRACKER_API_KEY=<POST /api/delivery/track에 필요> # 실제 추적을 위해 SweetTracker API 키가 필요합니다.
RUST_API_URL=http://localhost:8080
```

저장소의 Docker Compose PostgreSQL 서비스는 `5432` 포트, `wms` 데이터베이스, `wms` 사용자를 사용하며, 새 볼륨 생성 시 `rust-backend/schema.sql`로 초기화된다.
