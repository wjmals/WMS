# SmartStock AI WMS

창고별 재고, 구역, 배송과 이미지 모니터링을 관리하는 웹 애플리케이션입니다. 운영 데이터는 Rust API와 PostgreSQL에 저장됩니다.

## 현재 기능

- 사용자 가입, 로그인, 관리자·창고지기 승인
- Decimal 재고·안전재고, 기준/포장 단위 환산, 상태 분류
- 카메라 바코드/SKU 판독, 품목 검색, 인쇄 가능한 라벨, 입고·출고 장부
- 담당자·출처·사유가 포함된 감사 기록과 품목 논리 보관
- 승인 검토가 가능한 과거 거래 가져오기와 비전 추정 대기열
- 단위 일치 품목 기준 구역 점유량·공실률 계산
- 배송 등록, SweetTracker 실제 배송 조회 및 타임라인 저장, 완료 24시간 후 목록 제외
- 창고별 비전 레퍼런스와 Groq Vision 모니터링. 분석 결과는 관리자 승인 전 재고에 반영되지 않음

대시보드는 충분한 장부가 있는 품목에 한해 28일 이동평균 출고 기준선과 최근 7일 rolling MAPE 백테스트를 표시합니다. 2026-10-07 기준 운영 DB 장부가 비어 있어 현재 실측 MAPE/품절률은 없습니다. 기준선은 학습형 AI 수요예측이나 발주 권고가 아니며, 미충족 주문을 기록하지 않아 품절률 KPI는 산출할 수 없습니다. 실제 장부가 부족하면 수치를 숨기고 `insufficient_data`로 표시합니다.

### 화면

| 경로 | 용도 |
|---|---|
| `/` | 대시보드 및 재고 요약 |
| `/login`, `/signup` | 로그인 및 역할별 가입 |
| `/barcode` | 카메라 바코드/SKU 판독, 품목 검색, 입고·출고 기록 |
| `/delivery` | 배송 등록과 상태 전이 |
| `/monitor` | 이미지 분석, 레퍼런스 관리와 이력 조회 |
| `/report` | 현재 저장된 재고 위험 정보 |

## 기술 구성

```text
Browser -> Next.js frontend -> Rust Axum API -> PostgreSQL
                                             -> Groq Vision (모니터 분석)
```

- `frontend/`: Next.js 16, React 19, TypeScript
- `rust-backend/`: Axum, SQLx, PostgreSQL 16
- `admin_console/`, `cv_client/`: 별도 Python 도구

주요 코드 위치는 `frontend/app/`(화면 및 Next.js API 프록시), `rust-backend/src/main.rs`(API와 로직), `rust-backend/schema.sql`(DB 정의)입니다. API 요청·응답 예시는 [API 명세서](docs/API_명세서.md)에 있습니다.

## 로컬 실행

사전 조건: Docker, Node.js/npm, Rust/Cargo가 설치되어 있어야 합니다.

1. 프런트엔드 의존성을 설치합니다.

   ```bash
   cd frontend
   npm install
   cd ..
   ```

2. PostgreSQL을 시작합니다. 새 볼륨은 `rust-backend/schema.sql`로 초기화됩니다. 기존 DB에는 Rust API 시작 시 추가 컬럼·테이블과 NUMERIC 형 변환 마이그레이션이 적용됩니다. DB를 초기화할 필요는 없습니다.

   ```bash
   docker compose up -d postgres
   ```

3. Rust API를 별도 터미널에서 실행합니다.

   ```bash
   cd rust-backend
   DATABASE_URL=postgres://wms:wms_password@localhost:5432/wms cargo run
   ```

4. 프런트엔드를 저장소 루트에서 실행합니다.

   ```bash
   npm run dev
   ```

5. 브라우저에서 `http://localhost:3000`을 엽니다.

## Vercel 배포

Vercel 프로젝트는 Next.js 프런트엔드만 빌드합니다. Rust API와 PostgreSQL은 Vercel 함수 안에서 실행되지 않으므로, 별도 컨테이너 호스팅 서비스와 관리형 PostgreSQL에 배포하고 공개 HTTPS 주소를 준비해야 합니다.

Vercel 프로젝트의 **Settings → Environment Variables**에서 Production(필요하면 Preview에도)에 다음을 설정한 뒤 재배포합니다.

- `RUST_API_URL`: Rust API의 공개 HTTPS origin만 입력합니다. 예: `https://wms-api.example.com` (끝에 `/api`를 붙이지 않음)

Rust API 호스팅 환경에는 다음을 설정합니다.

- `DATABASE_URL`: 관리형 PostgreSQL 접속 URL. `localhost`나 로컬 Docker 주소는 사용할 수 없습니다.
- `JWT_SECRET`: 재시작 후에도 유지되는 안전한 무작위 비밀값
- `SUPER_ADMIN_PASSWORD`: 서버 관리자 비밀번호
- `FRONTEND_ORIGINS`: 배포한 프런트엔드 origin. 예: `https://wms.example.com`
- `GROQ_API_KEY`, `GROQ_VISION_MODEL`: 이미지 분석을 사용하는 경우 설정하며, 선택 모델은 계정에서 이미지 입력이 허용되어야 합니다.
- `SWEET_TRACKER_API_KEY`: 실제 배송 조회를 사용하는 경우 설정합니다.

배포 후 `https://<rust-api-origin>/health`가 `{"status":"ok","database":"configured"}`를 반환하는지 확인한 다음, 배포 프런트엔드에서 회원가입을 시험합니다. 프로덕션에서 `RUST_API_URL`이 누락되면 프록시는 `localhost:8080`으로 잘못 요청하지 않고 필요한 환경변수 이름을 `503` 오류로 안내합니다.

### 검증

```bash
cargo test --manifest-path rust-backend/Cargo.toml
cargo check --manifest-path rust-backend/Cargo.toml
npm --prefix frontend run build
npm --prefix frontend audit
```

### 환경 설정

- `DATABASE_URL`: Rust API PostgreSQL 연결 문자열. 로컬 Compose 기본값은 `postgres://wms:wms_password@localhost:5432/wms`입니다.
- `RUST_API_URL`: Next.js 프록시의 Rust API 주소. 기본값은 `http://localhost:8080`입니다.
- `JWT_SECRET`: Rust API의 JWT 서명용 무작위 비밀값. 운영에서는 고정된 비밀 저장소 값으로 설정합니다.
- `SUPER_ADMIN_PASSWORD`: 서버 관리자 로그인의 비밀번호. 설정하지 않으면 서버 관리자 로그인이 거부됩니다.
- `FRONTEND_ORIGINS`: Rust API가 허용할 프런트엔드 origin 목록. 쉼표로 여러 origin을 지정할 수 있습니다.
- `GROQ_API_KEY`: `/api/monitor` 이미지 분석에 필요하며, 계정이 호출 모델을 사용할 수 있어야 합니다.
- `GROQ_VISION_MODEL`: 비전 모델 ID. 기본값은 `qwen/qwen3.8-27b`이며 해당 계정에서 이미지 입력 권한이 있어야 합니다.
- `SWEET_TRACKER_API_KEY`: 배송 화면의 실시간 택배사 조회에 필요하며 Rust API의 비밀 설정에 둡니다. 이용권이나 키가 없으면 조회는 오류로 표시됩니다.

Groq Vision은 2026-10-07에 설정된 계정 모델을 합성 이미지로 API 경유 확인했습니다. SweetTracker 키는 현재 미설정입니다. 외부 제공자 오류는 성공으로 가장하지 않고 오류 응답을 반환합니다. 카메라와 라벨은 실제 브라우저·기기·프린터에서 별도 현장 확인이 필요합니다.

Rust 로컬 비밀은 Git에서 제외되는 `rust-backend/.env.local`에 둘 수 있습니다. 이 파일은 `.env`보다 먼저 읽히며 저장소에 올리지 마십시오. 템플릿은 `rust-backend/.env.example`을 참고하십시오.

`start-wms.sh`는 저장소 위치 기준으로 실행하며 Rust 비밀은 Git에서 제외되는 `rust-backend/.env.local`에서 읽습니다. 이 파일에 `SUPER_ADMIN_PASSWORD`를 설정해야 총괄 관리자 로그인과 서버 시작이 가능합니다.

## 문서

- [프로젝트 제안서](docs/프로젝트_제안서.md): 현재 구현과 검증 범위
- [기능 명세서](docs/기능_명세서.md): 구현 기능과 주요 제한사항
- [API 명세서](docs/API_명세서.md): 엔드포인트와 요청 형식
- [재고 데이터 수집 및 저장](docs/재고_데이터_수집_및_저장.md): 초기 등록, 바코드 입출고, AI 추정, PostgreSQL 저장·이력 흐름
- [데이터 수집 및 레퍼런스 안내](docs/데이터_수집_및_레퍼런스_안내.md): 이미지 수집, 엑셀 일괄 등록·내보내기
- [DB 구조도](docs/DB_구조도.md): 테이블 관계, 주요 컬럼과 제약
- [파일 구조도](docs/파일_구조도.md): 주요 디렉터리와 코드 위치
- 실제 DB 정의: `rust-backend/schema.sql`
