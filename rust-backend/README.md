# WMS Rust API

Backend API for the WMS, serving all `/api/*` routes proxied from the Next.js frontend.

## Requirements

- Rust stable
- PostgreSQL 14+

## Local setup

```bash
docker compose up -d postgres
export DATABASE_URL=postgres://wms:wms_password@localhost:5432/wms
cargo run
```

The API listens on `http://localhost:8080` by default.

Build a portable container image:

```bash
docker build -t wms-api ./rust-backend
docker run --rm -p 8080:8080 \
  -e DATABASE_URL="postgres://wms:wms_password@host.docker.internal:5432/wms" \
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
GET|POST /api/users
GET|POST|DELETE /api/zones
GET|POST|DELETE /api/vision
GET|POST|PUT|DELETE /api/delivery
GET|POST /api/monitor
```

See `docs/API_명세서.md` for full request/response details.

## Environment variables

- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: HTTP port, defaults to `8080`
- `RUST_LOG`: tracing filter
- `GROQ_API_KEY`: required for `POST /api/monitor`

Do not put database credentials in the frontend or commit `.env` files.
