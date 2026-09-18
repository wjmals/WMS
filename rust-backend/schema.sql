CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    current BIGINT NOT NULL CHECK (current >= 0),
    safe BIGINT NOT NULL CHECK (safe >= 0),
    status TEXT NOT NULL CHECK (status IN ('shortage', 'safe', 'overstock')),
    status_label TEXT NOT NULL,
    diff_text TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    cycle TEXT NOT NULL DEFAULT '월간',
    date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_items_warehouse_idx
    ON inventory_items (warehouse_id);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '창고지기',
    status TEXT NOT NULL DEFAULT 'PENDING_WAREHOUSE',
    warehouse_id TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
    admin_email TEXT,
    requested_admin_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS warehouse_zones (
    id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'normal',
    state_label TEXT NOT NULL DEFAULT '정상',
    temp TEXT NOT NULL DEFAULT '-20°C',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    capacity BIGINT NOT NULL DEFAULT 100000,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (warehouse_id, id)
);

CREATE TABLE IF NOT EXISTS warehouse_access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email TEXT NOT NULL,
    user_name TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS item_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    thumbnail TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitor_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    camera_url TEXT NOT NULL,
    item_name TEXT NOT NULL,
    status TEXT NOT NULL,
    status_label TEXT NOT NULL,
    estimated_quantity BIGINT NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '개',
    confidence INTEGER NOT NULL DEFAULT 0,
    recommendation TEXT NOT NULL,
    reason TEXT NOT NULL,
    image_snapshot TEXT,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_no TEXT NOT NULL,
    carrier_code TEXT NOT NULL,
    carrier_name TEXT NOT NULL,
    item_name TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    receiver_name TEXT NOT NULL,
    status TEXT NOT NULL,
    status_code TEXT NOT NULL,
    current_location TEXT NOT NULL,
    delivered_at TIMESTAMPTZ,
    tracking_details JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO warehouses (id, name)
VALUES ('wh_wjmals', 'WMS 기본 창고')
ON CONFLICT (id) DO NOTHING;
