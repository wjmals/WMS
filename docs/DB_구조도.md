# WMS 데이터베이스 구조도

PostgreSQL 16을 사용하며 Rust Axum API가 SQLx로 접근한다. 이 문서는 주요 컬럼과 관계를 설명한다. 전체 컬럼 타입·기본값·인덱스의 단일 기준은 [schema.sql](../rust-backend/schema.sql)이다.

## 관계

```mermaid
erDiagram
    warehouses ||--o{ inventory_items : contains
    warehouses ||--o{ warehouse_zones : contains
    warehouses ||--o{ item_references : contains
    warehouses ||--o{ monitor_logs : records
    warehouses o|--o{ users : assigns

    warehouses { text id PK }
    users { uuid id PK, text email UK, text warehouse_id FK }
    inventory_items { uuid id PK, text warehouse_id FK, text name, bigint current, bigint safe }
    warehouse_zones { text warehouse_id PK, text id PK, text name }
    item_references { uuid id PK, text warehouse_id FK, text name, text thumbnail }
    monitor_logs { uuid id PK, text warehouse_id FK, text item_name, bigint estimated_quantity }
    warehouse_access_requests { uuid id PK, text user_email, text admin_email, text status }
    delivery_tracking { uuid id PK, text invoice_no, text status_code, jsonb tracking_details }
```

`delivery_tracking`과 `warehouse_access_requests`는 창고 외래 키를 갖지 않는다. 배송은 시스템 전역 데이터이며 접근 요청은 이메일 기준으로 기록한다.

## 테이블 요약

| 테이블 | 저장 내용 | 주요 관계 |
|---|---|---|
| `warehouses` | 창고 ID, 이름 | 창고 마스터 |
| `users` | 계정, 역할, 승인 상태, 비밀번호 해시 | 선택적 `warehouse_id` |
| `inventory_items` | 현재·안전 재고, 서버 계산 상태 | 창고별 |
| `warehouse_zones` | 구역, 상태, 온도, 용량, 품목 JSON | PK `(warehouse_id, id)` |
| `warehouse_access_requests` | 창고 접근 요청 | 이메일 기준 |
| `item_references` | 비전 비교 이미지 | 창고별 |
| `monitor_logs` | 분석 결과와 일부 이미지 스냅샷 | 창고별 |
| `delivery_tracking` | 운송장과 배송 상태 이력 | 전역 |

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

서버 관리자 계정은 현재 코드에 정의되어 DB `users` 행에 저장되지 않는다. 현재 API에는 서버 측 인증 세션이 없으므로 이 스키마 관계만으로 사용자의 권한이 강제되지는 않는다.

### `inventory_items`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid, PK | 품목 레코드 ID |
| `warehouse_id` | text, FK | 소속 창고 |
| `name` | text | 품목명 |
| `current`, `safe` | bigint | 현재 수량과 안전재고. 둘 다 0 이상 |
| `status`, `status_label` | text | 상태 코드와 화면 표시 라벨 |
| `diff_text`, `recommendation` | text | 차이 표시와 조치 권고 |
| `cycle`, `date` | text, date nullable | 점검 주기와 기준일 |
| `created_at`, `updated_at` | timestamptz | 생성·갱신 시각 |

상태 코드는 `shortage`, `safe`, `overstock`만 허용된다. 실제 경계 계산은 API 코드의 규칙을 따르며 DB가 수량으로 상태를 자동 계산하는 트리거는 없다.

### `warehouse_zones`

복합 기본 키 `(warehouse_id, id)`로 창고 안에서 구역 ID를 유일하게 한다. `state`/`state_label`은 상태 코드와 표시 라벨, `temp`는 보관 온도, `items`는 고정 JSON 스키마가 없는 JSONB 메타데이터, `capacity`는 구역 용량이다. 이 테이블만으로 실제 공실률이 자동 계산되는 것은 아니다.

### `item_references`와 `monitor_logs`

`item_references`는 창고 ID, 품목명, 설명, `thumbnail`을 저장한다. `thumbnail`은 이미지 파일 경로가 아니라 data URL/base64 텍스트이며 API 저장 길이는 최대 50,000자다. 분석 시 해당 창고의 레퍼런스를 최대 3개까지 사용하고 품목명이 정확히 일치하는 항목을 우선한다.

`monitor_logs`는 창고 ID, 카메라 식별자, 감지 품목명, 상태, 추정 수량·단위, 신뢰도, 권고, 판단 근거와 분석 시각을 기록한다. `image_snapshot`은 원본 이미지 전체 보관이 아니라 일부 base64 문자열(최대 1,000자)이다. 로그 조회는 최근 50건으로 제한된다.

### `warehouse_access_requests`와 `delivery_tracking`

접근 요청은 `user_email`, `user_name`, `admin_email`, `status`, `requested_at`을 기록하며 창고 외래 키가 없다. 배송은 `invoice_no`, 택배사, 품목, 발신·수신자, `status`/`status_code`, 위치, 완료 시각 및 `tracking_details` JSONB를 저장한다. 배송 테이블에도 창고 외래 키가 없고, 현재 조회는 미완료 또는 완료 후 24시간 이내 건을 반환한다.

## 제약과 동작

- 재고의 `current`, `safe`는 0 이상이며 상태 코드는 `shortage`, `safe`, `overstock` 중 하나다.
- 사용자 이메일은 유일하다. NULL이 아닌 사용자명도 유일하다.
- 창고 삭제 시 재고·구역·레퍼런스·모니터 로그는 연쇄 삭제되고, 사용자의 `warehouse_id`는 NULL이 된다.
- 재고 조회 인덱스는 `inventory_items.warehouse_id`에 있다.
- 기본 창고 `wh_wjmals`는 스키마 초기화 시 삽입된다.
- 레퍼런스와 모니터 스냅샷은 이미지 파일이 아니라 텍스트 컬럼에 저장된다.
- `warehouse_zones.items`, `delivery_tracking.tracking_details`는 JSONB 자유 형식이므로 사용 측에서 데이터 모양을 합의해야 한다.
- `delivery_tracking`에는 창고 격리 키가 없다. 창고 단위 배송 이력이 필요하면 스키마/API 변경이 필요하다.
