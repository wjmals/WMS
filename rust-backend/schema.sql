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
    barcode TEXT,
    unit TEXT NOT NULL DEFAULT '톤',
    package_unit TEXT,
    package_size NUMERIC(20,6) NOT NULL DEFAULT 1 CHECK (package_size > 0),
    current NUMERIC(20,6) NOT NULL CHECK (current >= 0),
    safe NUMERIC(20,6) NOT NULL CHECK (safe >= 0),
    status TEXT NOT NULL CHECK (status IN ('shortage', 'safe', 'overstock')),
    status_label TEXT NOT NULL,
    diff_text TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    cycle TEXT NOT NULL DEFAULT '월간',
    date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS inventory_items_warehouse_idx
    ON inventory_items (warehouse_id);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_warehouse_barcode_key
    ON inventory_items (warehouse_id, barcode) WHERE barcode IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    item_name TEXT NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('initial', 'inbound', 'outbound', 'adjustment', 'vision_estimate', 'historical_import')),
    quantity_delta NUMERIC(20,6) NOT NULL,
    balance_after NUMERIC(20,6) NOT NULL CHECK (balance_after >= 0),
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    actor_id TEXT,
    actor_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_movements_warehouse_created_idx
    ON inventory_movements (warehouse_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_movement_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    submitted_by TEXT NOT NULL,
    submitted_email TEXT NOT NULL,
    source_name TEXT NOT NULL,
    row_count INTEGER NOT NULL CHECK (row_count > 0),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by TEXT,
    reviewed_email TEXT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_movement_import_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES inventory_movement_import_batches(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    item_name TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('inbound', 'outbound', 'adjustment')),
    quantity_delta NUMERIC(20,6) NOT NULL CHECK (quantity_delta <> 0),
    note TEXT NOT NULL,
    reference TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inventory_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL,
    actor_email TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_data JSONB,
    after_data JSONB,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_audit_events_warehouse_created_idx
    ON inventory_audit_events (warehouse_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_vision_estimates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE RESTRICT,
    item_name TEXT NOT NULL,
    estimated_quantity NUMERIC(20,6) NOT NULL CHECK (estimated_quantity >= 0),
    unit TEXT NOT NULL,
    confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    recommendation TEXT NOT NULL,
    reason TEXT NOT NULL,
    image_snapshot TEXT,
    submitted_by TEXT NOT NULL,
    submitted_email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_by TEXT,
    reviewed_email TEXT,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT,
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

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key ON users(username) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouse_zones (
    id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'normal',
    state_label TEXT NOT NULL DEFAULT '정상',
    temp TEXT NOT NULL DEFAULT '-20°C',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    capacity NUMERIC(20,6) NOT NULL DEFAULT 100000,
    capacity_unit TEXT NOT NULL DEFAULT '톤',
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
    estimated_quantity NUMERIC(20,6) NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '개',
    confidence INTEGER NOT NULL DEFAULT 0,
    recommendation TEXT NOT NULL,
    reason TEXT NOT NULL,
    image_snapshot TEXT,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS delivery_tracking_warehouse_idx
    ON delivery_tracking (warehouse_id, created_at DESC);

INSERT INTO warehouses (id, name)
VALUES ('wh_wjmals', 'WMS 기본 창고')
ON CONFLICT (id) DO NOTHING;
