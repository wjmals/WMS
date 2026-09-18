const admin = require('firebase-admin');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const warehouseId = process.env.MIGRATION_WAREHOUSE_ID || 'wh_wjmals';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS must point to a Firebase service-account JSON file');
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const firestore = admin.firestore();
const postgres = new Client({ connectionString: process.env.DATABASE_URL });

async function getDocs(path) {
  const snapshot = await firestore.collection(path).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value._seconds) return new Date(value._seconds * 1000);
  return new Date(value);
}

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function upsertWarehouse() {
  await postgres.query(
    `INSERT INTO warehouses (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [warehouseId, `Migrated warehouse ${warehouseId}`],
  );
}

async function migrateUsers() {
  const users = await getDocs('users');
  for (const user of users) {
    if (!user.email || !user.password) {
      console.warn(`Skipping user without email/password: ${user.id}`);
      continue;
    }

     const passwordHash = bcrypt.hashSync(user.password, 12);
    await postgres.query(
      `INSERT INTO users (email, password_hash, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, status = EXCLUDED.status,
         warehouse_id = EXCLUDED.warehouse_id, admin_email = EXCLUDED.admin_email,
         requested_admin_email = EXCLUDED.requested_admin_email, approved_at = EXCLUDED.approved_at`,
      [
        user.email,
        passwordHash,
        user.name || user.email.split('@')[0],
        user.role || '창고지기',
        user.status || 'PENDING_WAREHOUSE',
        user.warehouseId || null,
        user.adminEmail || null,
        user.requestedAdminEmail || null,
        asDate(user.createdAt),
        asDate(user.approvedAt),
      ],
    );
  }
}

async function migrateWarehouseCollections() {
  const inventory = await getDocs(`warehouses/${warehouseId}/inventory_items`);
  for (const item of inventory) {
    await postgres.query(
      `INSERT INTO inventory_items (warehouse_id, name, current, safe, status, status_label, diff_text, recommendation, cycle, date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, now()))`,
      [
        warehouseId,
        item.name || '이름 없는 품목',
        numberOr(item.current),
        numberOr(item.safe),
        item.status || 'safe',
        item.statusLabel || '안전 재고',
        item.diffText || '적정 범위 유지',
        item.recommendation || '',
        item.cycle || '월간',
        item.date || null,
        asDate(item.createdAt),
      ],
    );
  }

  const zones = await getDocs(`warehouses/${warehouseId}/warehouse_zones`);
  for (const zone of zones) {
    await postgres.query(
      `INSERT INTO warehouse_zones (id, warehouse_id, name, state, state_label, temp, items, capacity, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, COALESCE($9, now()))
       ON CONFLICT (warehouse_id, id) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state,
         state_label = EXCLUDED.state_label, temp = EXCLUDED.temp, items = EXCLUDED.items,
         capacity = EXCLUDED.capacity, updated_at = EXCLUDED.updated_at`,
      [
        zone.id,
        warehouseId,
        zone.name || zone.id,
        zone.state || 'normal',
        zone.stateLabel || '정상',
        zone.temp || '-20°C',
        JSON.stringify(Array.isArray(zone.items) ? zone.items : []),
        numberOr(zone.capacity, 100000),
        asDate(zone.updated_at),
      ],
    );
  }

  const references = await getDocs(`warehouses/${warehouseId}/item_references`);
  for (const reference of references) {
    await postgres.query(
      `INSERT INTO item_references (warehouse_id, name, description, thumbnail, created_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, now()))`,
      [warehouseId, reference.name || '이름 없는 품목', reference.description || '', reference.thumbnail || '', asDate(reference.createdAt)],
    );
  }

  const logs = await getDocs(`warehouses/${warehouseId}/monitor_logs`);
  for (const log of logs) {
    await postgres.query(
      `INSERT INTO monitor_logs (warehouse_id, camera_url, item_name, status, status_label, estimated_quantity, unit, confidence, recommendation, reason, image_snapshot, analyzed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, now()))`,
      [
        warehouseId,
        log.camera_url || 'webcam',
        log.item_name || '알 수 없는 품목',
        log.status || 'safe',
        log.status_label || '안전 재고',
        numberOr(log.estimated_quantity),
        log.unit || '개',
        numberOr(log.confidence),
        log.recommendation || '',
        log.reason || '',
        log.image_snapshot || null,
        asDate(log.analyzed_at),
      ],
    );
  }
}

async function migrateRootCollections() {
  const requests = await getDocs('warehouse_access_requests');
  for (const request of requests) {
    await postgres.query(
      `INSERT INTO warehouse_access_requests (user_email, user_name, admin_email, status, requested_at)
       VALUES ($1, $2, $3, $4, COALESCE($5, now()))`,
      [request.userEmail, request.userName || request.userEmail, request.adminEmail, request.status || 'PENDING', asDate(request.requestedAt)],
    );
  }

  const deliveries = await getDocs('delivery_tracking');
  for (const delivery of deliveries) {
    await postgres.query(
      `INSERT INTO delivery_tracking (invoice_no, carrier_code, carrier_name, item_name, sender_name, receiver_name, status, status_code, current_location, delivered_at, tracking_details, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, COALESCE($12, now()), COALESCE($13, now()))`,
      [
        delivery.invoice_no,
        delivery.carrier_code || '',
        delivery.carrier_name || '',
        delivery.item_name || '물류 출고건',
        delivery.sender_name || '',
        delivery.receiver_name || '',
        delivery.status || '',
        delivery.status_code || 'AT_PICKUP',
        delivery.current_location || '',
        asDate(delivery.delivered_at),
        JSON.stringify(Array.isArray(delivery.tracking_details) ? delivery.tracking_details : []),
        asDate(delivery.created_at),
        asDate(delivery.updated_at),
      ],
    );
  }
}

async function main() {
  await postgres.connect();
  await upsertWarehouse();
  await migrateUsers();
  await migrateWarehouseCollections();
  await migrateRootCollections();
  console.log(`Migration completed for warehouse ${warehouseId}`);
  await postgres.end();
  await admin.app().delete();
}

main().catch(async (error) => {
  console.error('Migration failed:', error);
  await postgres.end().catch(() => {});
  process.exitCode = 1;
});
