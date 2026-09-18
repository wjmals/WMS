# WMS Rust API

Portable backend foundation for running the WMS without Vercel API routes or Firebase Functions.

## Requirements

- Rust stable
- PostgreSQL 14+

## Local setup

```bash
createdb wms
export DATABASE_URL=postgres://wms:wms_password@localhost:5432/wms
psql "$DATABASE_URL" -f schema.sql
cargo run
```

The API listens on `http://localhost:8080` by default.

## Endpoints

```text
GET  /health
GET  /api/inventory?warehouse_id=wh_wjmals
POST /api/inventory
```

Example request:

```json
{
  "warehouse_id": "wh_wjmals",
  "name": "고등어(식용)",
  "current": 12000,
  "safe": 8000,
  "cycle": "월간"
}
```

## Environment variables

- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: HTTP port, defaults to `8080`
- `RUST_LOG`: tracing filter

## Migration status

This is the first migration slice. The existing Next.js API routes still serve the web app. Move the remaining contracts one at a time before changing the frontend API base URL:

- users and approval workflow
- warehouse zones
- vision references and monitor logs
- delivery tracking
- authentication and password hashing

Do not put database credentials in the frontend or commit `.env` files.
