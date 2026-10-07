# WMS Rust API

Backend API for the WMS, serving all `/api/*` routes proxied from the Next.js frontend.

## Requirements

- Rust stable
- PostgreSQL 16 (PostgreSQL 14+ may work; CI/live verification target is PostgreSQL 16)

## Local setup

```bash
docker compose up -d postgres
export DATABASE_URL=postgres://wms:wms_password@localhost:5432/wms
cargo run
```

The API listens on `http://localhost:8080` by default.

On startup, the API applies data-preserving compatibility migrations for existing databases, including Decimal inventory columns, package units, audit/approval tables, and ledger deletion restrictions. These migrations preserve existing inventory rows; do not reset the database to upgrade it.

Build a portable container image:

```bash
docker build -t wms-api ./rust-backend
docker run --rm -p 8080:8080 \
  -e DATABASE_URL="postgres://wms:wms_password@host.docker.internal:5432/wms" \
  -e JWT_SECRET="<long-random-secret>" \
  -e SUPER_ADMIN_PASSWORD="<admin-password>" \
  wms-api
```

Stop the local database with:

```bash
docker compose down
```

The existing Next.js frontend proxies its `/api/*` requests to this service via `RUST_API_URL` in the Next.js runtime environment.

## Endpoints

```text
GET  /health
GET|POST|PATCH|DELETE /api/inventory
GET  /api/inventory/movements
GET  /api/inventory/ledger
POST /api/inventory/import
GET  /api/inventory/imports
POST /api/inventory/imports/review
GET|POST /api/users
GET|POST|DELETE /api/zones
GET|POST|DELETE /api/vision
POST /api/vision/import
GET  /api/vision/estimates
POST /api/vision/estimates/review
GET|POST|PUT|DELETE /api/delivery
POST /api/delivery/track
GET|POST /api/monitor
```

See `docs/API_명세서.md` for full request/response details.

## Environment variables

- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: HTTP port, defaults to `8080`
- `RUST_LOG`: tracing filter
- `JWT_SECRET`: stable random signing key; required for persistent sessions
- `SUPER_ADMIN_PASSWORD`: required for the built-in server administrator login
- `FRONTEND_ORIGINS`: comma-separated allowed browser origins
- `GROQ_API_KEY`: required for `POST /api/monitor`; estimate results are queued for human review
- `SWEET_TRACKER_API_KEY`: required for successful external delivery tracking

Do not put database credentials in the frontend or commit `.env` files.

## Verification

```bash
cargo test
cargo check
```

Inventory and movement Decimal values use PostgreSQL `NUMERIC(20,6)`. The API serializes Rust Decimal values as JSON decimal strings to preserve precision; clients should parse designated quantity fields before arithmetic.
