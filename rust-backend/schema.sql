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

INSERT INTO warehouses (id, name)
VALUES ('wh_wjmals', 'WMS 기본 창고')
ON CONFLICT (id) DO NOTHING;
