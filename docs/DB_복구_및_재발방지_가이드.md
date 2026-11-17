# DB 복구 및 재발 방지 가이드

## 1. 현재 문제 원인

이 프로젝트는 로컬 개발용 Postgres와 운영용 DB를 분리해 두고, 앱의 시작 시점에 데이터베이스 스키마를 보장합니다.

문제 발생 원인으로 가장 흔한 것은 다음입니다.

- Docker volume이 삭제되거나 재생성됨
- `docker compose down -v` 또는 비슷한 초기화 명령 실행
- Render/Neon 등 외부 DB와 연결 주소가 바뀌었음
- 로컬 환경에서 새 PostgreSQL이 가동되면서 빈 DB에 연결됨

이 경우에는 `inventory_items`, `inventory_movements`, `users`, `warehouse_zones` 등의 핵심 테이블이 비어 있거나, `warehouses`만 남는 상태가 됩니다.

## 2. 즉시 점검 checklist

### 로컬 환경

- `docker compose ps`로 postgres 컨테이너가 실제로 떠 있는지 확인
- `docker compose exec -T postgres psql -U wms -d wms -c "SELECT count(*) FROM inventory_items;"` 로 row 수 확인
- `docker volume ls` 로 기존 앱 데이터 volume이 유지되고 있는지 확인

### 배포 환경

- Render / Neon / Vercel 환경변수에서 `DATABASE_URL`이 실제 운영 DB를 가리키는지 확인
- `RUST_API_URL`이 실제 Rust API 주소를 가리키는지 확인
- `JWT_SECRET`, `SUPER_ADMIN_PASSWORD`가 의도한 값인지 확인

## 3. 데이터 복구 시 우선 순위

1. 가장 최근 DB dump, snapshot, Neon backup, Render backup 확인
2. 복구 대상 DB 연결 주소를 확인
3. 데이터 복구 전 현재 연결 DB를 반드시 백업
4. 복구 후 `inventory_items`, `inventory_movements`, `users`, `warehouse_zones` row 수 확인
5. 로그인, 재고 목록, 대시보드 화면 실제 로드 검증

## 4. 재발 방지 조치

### 필수

- 운영 환경에서는 `DATABASE_URL`을 고정값으로 두고, 개발용 DB와 분리
- `docker compose down` 시 volume이 삭제되지 않도록 주의
- `docker compose down -v` 금지
- 기존 production DB는 정기 dump 또는 snapshot 저장

### 코드 보안

- `ALLOW_EMPTY_DATABASE=false` 를 기본값으로 유지
- 앱 시작 시 핵심 테이블이 비어 있으면 경고 로그를 남기고 서버를 중단하도록 구성
- 생산 환경에서 빈 데이터베이스로 부팅하는 것을 차단

## 5. 현재 프로젝트 적용 규칙

이 프로젝트는 `rust-backend/src/main.rs` 시작 시점에서 핵심 테이블이 비어 있으면 종료 또는 경고를 내도록 설계되어 있습니다. 이는 빈 DB가 실제 운영 데이터처럼 보이는 사고를 막기 위한 보호 장치입니다.

다음 명령으로 새 DB를 장비에 연결하는 상황을 막을 수 있습니다.

```bash
export DATABASE_URL="postgres://..."
export ALLOW_EMPTY_DATABASE=false
cargo run
```

기본값은 false이며, 진짜 로컬 bootstrap이 필요할 때만 true를 명시적으로 켜야 합니다.

## 6. 운영 체크 기준

다음 값이 모두 0이 아닌지 점검합니다.

- `SELECT count(*) FROM warehouses;`
- `SELECT count(*) FROM inventory_items;`
- `SELECT count(*) FROM inventory_movements;`
- `SELECT count(*) FROM users;`
- `SELECT count(*) FROM warehouse_zones;`

모든 값이 0이면, 데이터 복구가 필요한 상태입니다.
