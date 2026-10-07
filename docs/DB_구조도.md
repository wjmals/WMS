# WMS 데이터베이스 구조도

PostgreSQL 16을 사용하며 Rust Axum API가 SQLx로 접근한다. 이 문서는 주요 컬럼과 관계를 설명한다. 전체 컬럼 타입·기본값·인덱스의 단일 기준은 [schema.sql](../rust-backend/schema.sql)이다.

## 관계

```mermaid
erDiagram
    warehouses ||--o{ inventory_items : contains
    inventory_items ||--o{ inventory_movements : records
    inventory_movement_import_batches ||--o{ inventory_movement_import_rows : stages
    inventory_items ||--o{ inventory_movement_import_rows : identifies
    warehouses ||--o{ inventory_movement_import_batches : reviews
    warehouses ||--o{ inventory_vision_estimates : reviews
    warehouses ||--o{ warehouse_zones : contains
    warehouses ||--o{ item_references : contains
    warehouses ||--o{ monitor_logs : records
    warehouses ||--o{ delivery_tracking : tracks
    warehouses o|--o{ users : assigns

    warehouses { text id PK }
    users { uuid id PK, text email UK, text warehouse_id FK }
    inventory_items { uuid id PK, text warehouse_id FK, text name, text barcode, numeric current, numeric safe, text unit, text package_unit, numeric package_size, timestamptz archived_at }
    inventory_movements { uuid id PK, text warehouse_id FK, uuid inventory_item_id FK, text movement_type, numeric quantity_delta, numeric balance_after, text source, text actor_email }
    inventory_audit_events { uuid id PK, text warehouse_id FK, text actor_email, text action, jsonb before_data, jsonb after_data, text reason }
    inventory_movement_import_batches { uuid id PK, text warehouse_id FK, text status, text submitted_email }
    inventory_vision_estimates { uuid id PK, text warehouse_id FK, numeric estimated_quantity, text status, integer confidence }
    warehouse_zones { text warehouse_id PK, text id PK, text name, numeric capacity, text capacity_unit }
    item_references { uuid id PK, text warehouse_id FK, text name, text thumbnail }
    monitor_logs { uuid id PK, text warehouse_id FK, text item_name, numeric estimated_quantity }
    warehouse_access_requests { uuid id PK, text user_email, text admin_email, text status }
    delivery_tracking { uuid id PK, text warehouse_id FK, text invoice_no, text status_code, jsonb tracking_details }
```

`delivery_tracking`은 창고 외래 키로 격리된다. `warehouse_access_requests`는 관리자 이메일 기준으로 기록한다.

## 테이블 요약

| 테이블 | 저장 내용 | 주요 관계 |
|---|---|---|
| `warehouses` | 창고 ID, 이름 | 창고 마스터 |
| `users` | 계정, 역할, 승인 상태, 비밀번호 해시 | 선택적 `warehouse_id` |
| `inventory_items` | 현재·안전 재고, 서버 계산 상태 | 창고별 |
| `inventory_movements` | 기초 잔액 및 입고·출고·조정 장부 | 품목·창고별, 담당자·출처·사유 포함, 물리 삭제 제한 |
| `inventory_audit_events` | 엔터티 변경 전후, 수행자, 출처, 필수 사유 | 창고·시각별 |
| `inventory_movement_import_batches`, `inventory_movement_import_rows` | 승인 전 과거 거래 임시 보관 및 검토 이력 | 품목·창고별, 승인 시에만 장부 반영 |
| `inventory_vision_estimates` | 사람의 검토를 기다리는 이미지 수량 추정 | 창고·품목별 |
| `warehouse_zones` | 구역, 상태, 온도, 용량과 용량 단위, 품목 JSON | PK `(warehouse_id, id)` |
| `warehouse_access_requests` | 창고 접근 요청 | 이메일 기준 |
| `item_references` | 비전 비교 이미지 | 창고별 |
| `monitor_logs` | 분석 결과와 일부 이미지 스냅샷 | 창고별, 추정 수량 `NUMERIC(20,6)` |
| `inventory_vision_estimates` | 승인 대기 추정치와 검토 상태 | 창고별, 품목 FK는 선택적 |
| `delivery_tracking` | 창고별 운송장과 배송 상태 이력 | `warehouse_id` 외래 키 |

## 주요 컬럼

### `warehouses`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | text, PK | 창고 식별자. 초기 데이터는 `wh_wjmals` |
| `name` | text | 표시용 창고 이름 |
| `created_at` | timestamptz | 생성 시각 |

### `users`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid, PK | 계정 ID |
| `username` | text, unique nullable | 로그인용 아이디 |
| `email` | text, unique | 이메일 및 승인 대상 식별자 |
| `password_hash` | text | Argon2 해시. API 응답에는 반환하지 않음 |
| `name`, `role`, `status` | text | 표시명, 역할, 승인 상태 |
| `warehouse_id` | text, nullable FK | 승인된 창고. 창고 삭제 시 NULL |
| `admin_email`, `requested_admin_email` | text, nullable | 담당 관리자 및 접근 요청 정보 |
| `created_at`, `approved_at` | timestamptz | 가입·승인 시각 |

서버 관리자 계정은 코드의 환경 설정으로 인증하며 DB `users` 행에 저장되지 않는다. 일반 사용자는 JWT 인증 뒤 API가 DB의 계정 상태와 창고 배정을 재확인한다.

### `inventory_items`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid, PK | 품목 레코드 ID |
| `warehouse_id` | text, FK | 소속 창고 |
| `name` | text | 품목명 |
| `barcode` | text, nullable | 카메라 또는 리더기에서 판독하는 SKU/바코드. 창고 내 중복은 허용되지 않는다. |
| `current`, `safe` | numeric(20,6) | 기준 단위의 현재 수량과 안전재고. 둘 다 0 이상 |
| `unit` | text | 기준 단위 |
| `package_unit` | text, nullable | 선택 포장 단위 |
| `package_size` | numeric(20,6) | 한 포장의 기준 단위 수량, 0 초과 |
| `archived_at` | timestamptz, nullable | 논리 보관 시각. 보관 품목은 일반 조회에서 제외 |
| `status`, `status_label` | text | 상태 코드와 화면 표시 라벨 |
| `diff_text`, `recommendation` | text | 차이 표시와 조치 권고 |
| `cycle`, `date` | text, date nullable | 점검 주기와 기준일 |
| `created_at`, `updated_at` | timestamptz | 생성·갱신 시각 |

상태 코드는 `shortage`, `safe`, `overstock`만 허용된다. `barcode`는 창고 내 활성 품목의 중복을 막는 부분 고유 인덱스를 사용한다. 실제 경계 계산은 API 코드의 Decimal 규칙을 따른다. 포장 수량은 `package_size`를 곱해 기준 단위로 저장한다.

### `warehouse_zones`

복합 기본 키 `(warehouse_id, id)`로 창고 안에서 구역 ID를 유일하게 한다. `state`/`state_label`은 구역 상태, `temp`는 보관 온도, `items`는 배정 품목 이름 배열(JSONB), `capacity`는 Decimal 용량, `capacity_unit`은 그 기준 단위다. API는 배정 품목 중 용량 단위가 같은 품목만 합산해 점유량·공실률·용량 초과 상태를 계산한다.

### `item_references`와 `monitor_logs`

`item_references`는 창고 ID, 품목명, 설명, `thumbnail`을 저장한다. `thumbnail`은 이미지 파일 경로가 아니라 data URL/base64 텍스트이며 API 저장 길이는 최대 50,000자다. 분석 시 해당 창고의 레퍼런스를 최대 3개까지 사용하고 품목명이 정확히 일치하는 항목을 우선한다.

`monitor_logs`는 창고 ID, 카메라 식별자, 감지 품목명, 상태, `NUMERIC(20,6)` 추정 수량·단위, 신뢰도, 권고, 판단 근거와 분석 시각을 기록한다. `image_snapshot`은 원본 이미지 전체 보관이 아니라 일부 base64 문자열(최대 1,000자)이다. 로그 조회는 최근 50건으로 제한된다. 별도 `inventory_vision_estimates` 행이 승인 대기·검토자·결정 사유를 보관하며, 승인 전에는 현재 재고를 변경하지 않는다.

### `warehouse_access_requests`와 `delivery_tracking`

접근 요청은 `user_email`, `user_name`, `admin_email`, `status`, `requested_at`을 기록하며 창고 외래 키가 없다. 배송은 `warehouse_id`, `invoice_no`, 택배사, 품목, 발신·수신자, `status`/`status_code`, 위치, 완료 시각 및 `tracking_details` JSONB를 저장한다. SweetTracker 조회가 성공하면 외부 실제 단계와 상세 이력으로 업데이트한다. 조회는 세션 창고 기준이며 미완료 또는 완료 후 24시간 이내 건을 반환한다. 기존 DB의 누락된 `warehouse_id`는 Rust API 기동 시 기본 창고에 귀속된다.

## 제약과 동작

- 재고의 `current`, `safe`는 `NUMERIC(20,6)` 0 이상이며 상태 코드는 `shortage`, `safe`, `overstock` 중 하나다.
- 사용자 이메일은 유일하다. NULL이 아닌 사용자명도 유일하다.
- 품목 UI 삭제는 `archived_at` 논리 보관이며 장부 FK는 `ON DELETE RESTRICT`로 물리 삭제를 막는다. 감사/장부 보존 권한은 운영 DB에서도 별도 통제해야 한다.
- 창고 자체 삭제 시 창고 FK에 `CASCADE`가 정의된 하위 데이터는 연쇄 삭제될 수 있으므로 운영 중 창고 물리 삭제는 제한한다. 사용자의 `warehouse_id`는 NULL이 된다.
- 재고 조회 인덱스는 `inventory_items.warehouse_id`에 있다.
- 기본 창고 `wh_wjmals`는 스키마 초기화 시 삽입된다.
- 레퍼런스와 모니터 스냅샷은 이미지 파일이 아니라 텍스트 컬럼에 저장된다.
- `warehouse_zones.items`, `delivery_tracking.tracking_details`는 JSONB 자유 형식이므로 사용 측에서 데이터 모양을 합의해야 한다.
- `inventory_movements`는 NUMERIC 기초 잔액, 입고·출고·조정, 관리자 승인 비전 반영과 승인된 과거 거래를 누적한다. 과거 거래 가져오기는 현재 잔액을 변경하지 않으며 승인 시 시간순 잔량을 검증한다.
- 기존 설치 DB는 Rust API 시작 시 정수 수량 컬럼을 NUMERIC으로 바꾸고 단위, 아카이브, 감사 및 승인 테이블을 추가한다. 원본 데이터 삭제 없이 형 변환한다.
