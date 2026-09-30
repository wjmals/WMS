# SmartStock AI WMS

창고별 재고, 구역, 배송과 이미지 모니터링을 관리하는 웹 애플리케이션입니다. 운영 데이터는 Rust API와 PostgreSQL에 저장됩니다.

## 현재 기능

- 사용자 가입, 로그인, 관리자·창고지기 승인
- 현재 재고와 안전재고 조회·수정, 상태 분류
- 품목명 또는 ID 검색과 수량 조정
- 창고 구역 생성·조회·수정·삭제
- 배송 등록, 상태 전이, 완료 24시간 후 목록 제외
- 창고별 비전 레퍼런스와 Groq Vision 모니터링

바코드 화면의 카메라는 미리보기 용도이며 영상의 실제 바코드 판독은 구현되어 있지 않습니다. 리포트와 AI 결과는 운영 성과나 예측 정확도가 검증된 것을 의미하지 않습니다.

### 화면

| 경로 | 용도 |
|---|---|
| `/` | 대시보드 및 재고 요약 |
| `/login`, `/signup` | 로그인 및 역할별 가입 |
| `/barcode` | 품목 ID/이름 검색, 재고 조회와 수량 조정 |
| `/delivery` | 배송 등록과 상태 전이 |
| `/monitor` | 이미지 분석, 레퍼런스 관리와 이력 조회 |
| `/report` | 현재 저장된 재고 위험 정보 |

## 기술 구성

```text
Browser -> Next.js frontend -> Rust Axum API -> PostgreSQL
                                             -> Groq Vision (모니터 분석)
```

- `frontend/`: Next.js 14, React 18, TypeScript
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

2. PostgreSQL을 시작합니다. 새 볼륨은 `rust-backend/schema.sql`로 초기화됩니다.

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

### 환경 설정

- `DATABASE_URL`: Rust API PostgreSQL 연결 문자열. 로컬 Compose 기본값은 `postgres://wms:wms_password@localhost:5432/wms`입니다.
- `RUST_API_URL`: Next.js 프록시의 Rust API 주소. 기본값은 `http://localhost:8080`입니다.
- `GROQ_API_KEY`: `/api/monitor` 이미지 분석에 필요하며, 계정이 호출 모델을 사용할 수 있어야 합니다.

`start-wms.sh`는 특정 로컬 경로와 빌드된 Rust 실행 파일을 가정합니다. 다른 환경에서는 위 단계를 따라 실행하거나 스크립트의 경로를 조정하십시오.

## 문서

- [프로젝트 제안서](docs/프로젝트_제안서.md): 6면 제안서
- [기능 명세서](docs/기능_명세서.md): 구현 기능과 주요 제한사항
- [API 명세서](docs/API_명세서.md): 엔드포인트와 요청 형식
- [DB 구조도](docs/DB_구조도.md): 테이블 관계, 주요 컬럼과 제약
- [파일 구조도](docs/파일_구조도.md): 주요 디렉터리와 코드 위치
- 실제 DB 정의: `rust-backend/schema.sql`
