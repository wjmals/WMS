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

The existing Next.js frontend can proxy its `/api/*` requests to this service by setting `RUST_API_URL` in the Next.js runtime environment. Leave it unset until all required API routes have been migrated.

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

## Firebase data migration

The one-time migration script is `backend/functions/scripts/migrate-firestore-to-postgres.js`.
It reads Firestore with a service account and writes the PostgreSQL schema created by `schema.sql`.

Run it only after taking a PostgreSQL backup and reviewing the target database:

```bash
cd backend/functions
npm install
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/serviceAccountKey.json"
export DATABASE_URL="postgres://user:password@host:5432/wms"
export MIGRATION_WAREHOUSE_ID="wh_wjmals"
npm run migrate:postgres
```

The script is intentionally not run automatically. It imports passwords as bcrypt hashes; new Rust-created accounts use Argon2, and the Rust login API supports both formats during the migration period.
