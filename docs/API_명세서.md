# WMS API 명세서

- 버전: 1.0
- 갱신일: 2026-09-23
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

### 인증 관련 주의사항

현재 Rust API에는 베어러 토큰이나 세션 쿠키 미들웨어가 없다. 로그인 응답은 브라우저 `localStorage`의 `wms_auth_user`에 저장되며, 프론트엔드 라우트 접근은 `AuthGuard`가 제어한다. 운영 환경에서는 API 역할 검사를 보안 경계로 취급하기 전에 서버 측 세션/JWT 검증을 추가해야 한다.

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

성공 응답:

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
  "current": 120,
  "safe": 100,
  "cycle": "월간"
}
```

`201`을 반환한다. `current`, `safe`는 0 이상이어야 한다.

### `PATCH /api/inventory`

```json
{
  "id": "uuid",
  "warehouseId": "wh_wjmals",
  "current": 80,
  "safe": 100
}
```

재고 상태와 권고사항을 다시 계산한다.

### `DELETE /api/inventory?id=<uuid>&warehouseId=<id>`

### 재고 상태 판정 기준

- `shortage`: `current < safe * 0.5`
- `safe`: `safe * 0.5 <= current <= safe * 2.0`
- `overstock`: `current > safe * 2.0`

## 5. 창고 구역

### `GET /api/zones?warehouseId=<id>`

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
  "capacity": 100000
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

## 7. 배송

### `GET /api/delivery`

미배송 건과 최근 24시간 이내 배송 완료 건을 반환한다.

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

### `PUT /api/delivery`

```json
{ "id": "uuid" }
```

상태 전이 순서: `AT_PICKUP` -> `IN_TRANSIT` -> `OUT_FOR_DELIVERY` -> `DELIVERED`.

### `DELETE /api/delivery?id=<uuid>`

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

`GROQ_API_KEY`가 필요하다. 서버는 해당 창고의 `item_references`에서 레퍼런스 이미지를 최대 3개까지 불러오고(`itemName`이 정확히 일치하는 레퍼런스를 우선 사용), 현재 카메라 이미지와 함께 Groq 비전 모델로 전송한 뒤 모니터 로그를 저장하고 창고·품목명이 일치하는 재고를 갱신한다. 이는 요청 시점의 레퍼런스 기반 추론이며, 모델을 파인튜닝하는 것은 아니다.

실패 동작: `GROQ_API_KEY` 미설정 시 `503`, 외부 제공자 오류나 파싱 실패 시 `502`를 반환한다.

## 9. 데이터베이스 엔터티

| 테이블 | 용도 |
|---|---|
| `warehouses` | 창고 마스터 데이터 |
| `users` | 계정, 역할, 승인 상태, 비밀번호 해시 |
| `inventory_items` | 현재/안전 재고와 계산된 상태 |
| `warehouse_zones` | 창고 구역, 용량, 상태, 품목 JSON |
| `warehouse_access_requests` | 창고지기 접근 요청 |
| `item_references` | 비전 레퍼런스 이미지 |
| `monitor_logs` | AI 모니터링 결과 |
| `delivery_tracking` | 배송 상태 및 이력 |

## 10. 운영 환경 설정

```env
DATABASE_URL=postgres://wms:wms_password@localhost:5432/wms
PORT=8080
GROQ_API_KEY=<POST /api/monitor에 필요>
RUST_API_URL=http://localhost:8080
```

저장소의 Docker Compose PostgreSQL 서비스는 `5432` 포트, `wms` 데이터베이스, `wms` 사용자를 사용하며, 새 볼륨 생성 시 `rust-backend/schema.sql`로 초기화된다.
