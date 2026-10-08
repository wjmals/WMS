use argon2::{password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{
    body::{to_bytes, Body},
    extract::{Query, State},
    http::{header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE}, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use rust_decimal::{prelude::ToPrimitive, Decimal};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use std::{env, net::SocketAddr};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;
use rand::RngCore;

#[derive(Clone)]
struct AppState {
    db: Option<PgPool>,
    jwt_secret: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SessionClaims {
    sub: String,
    email: String,
    role: String,
    status: String,
    warehouse_id: Option<String>,
    exp: usize,
}

#[derive(Clone, Debug)]
struct AuthenticatedUser {
    id: String,
    email: String,
    role: String,
    status: String,
    warehouse_id: Option<String>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    database: &'static str,
}

#[derive(Debug, Serialize, FromRow)]
struct InventoryItem {
    id: Uuid,
    #[serde(rename = "warehouseId")]
    warehouse_id: String,
    name: String,
    barcode: Option<String>,
    current: Decimal,
    safe: Decimal,
    unit: String,
    #[serde(rename = "packageUnit")]
    package_unit: Option<String>,
    #[serde(rename = "packageSize")]
    package_size: Decimal,
    status: String,
    #[serde(rename = "statusLabel")]
    status_label: String,
    #[serde(rename = "diffText")]
    diff_text: String,
    recommendation: String,
    cycle: String,
    date: Option<chrono::NaiveDate>,
    #[serde(rename = "createdAt")]
    created_at: DateTime<Utc>,
    #[serde(rename = "updatedAt")]
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct InventoryQuery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
}

#[derive(Deserialize)]
struct CreateInventoryItem {
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    name: String,
    barcode: Option<String>,
    current: Decimal,
    safe: Decimal,
    unit: Option<String>,
    #[serde(alias = "packageUnit")]
    package_unit: Option<String>,
    #[serde(alias = "packageSize")]
    package_size: Option<Decimal>,
    note: Option<String>,
    cycle: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct UserRecord {
    id: Uuid,
    username: Option<String>,
    email: String,
    name: String,
    role: String,
    status: String,
    #[serde(rename = "warehouseId")]
    warehouse_id: Option<String>,
    #[serde(rename = "adminEmail")]
    admin_email: Option<String>,
    #[serde(rename = "requestedAdminEmail")]
    requested_admin_email: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: DateTime<Utc>,
    #[serde(rename = "approvedAt")]
    approved_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize)]
struct UserAction {
    action: String,
    email: Option<String>,
    username: Option<String>,
    password: Option<String>,
    name: Option<String>,
    role: Option<String>,
    #[serde(alias = "adminEmail")]
    admin_email: Option<String>,
    #[serde(alias = "targetEmail")]
    target_email: Option<String>,
}

#[derive(Deserialize)]
struct UserQuery {
    action: Option<String>,
    email: Option<String>,
    #[serde(alias = "adminEmail")]
    admin_email: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct ZoneRecord {
    id: String,
    #[serde(rename = "warehouseId")]
    warehouse_id: String,
    name: String,
    state: String,
    #[serde(rename = "stateLabel")]
    state_label: String,
    temp: String,
    items: Value,
    capacity: Decimal,
    #[serde(rename = "capacityUnit")]
    capacity_unit: String,
    #[serde(rename = "currentStockSum")]
    current_stock_sum: Decimal,
    #[serde(rename = "emptyRatio")]
    empty_ratio: f64,
    #[serde(rename = "updatedAt")]
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct ZoneQuery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
}

#[derive(Deserialize)]
struct SaveZone {
    id: String,
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    name: String,
    state: Option<String>,
    state_label: Option<String>,
    temp: Option<String>,
    items: Option<Value>,
    capacity: Option<Decimal>,
    #[serde(alias = "capacityUnit")]
    capacity_unit: Option<String>,
}

#[derive(Deserialize)]
struct UpdateInventoryItem {
    id: Uuid,
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    current: Option<Decimal>,
    quantity: Option<Decimal>,
    #[serde(alias = "quantityUnit")]
    quantity_unit: Option<String>,
    safe: Option<Decimal>,
    #[serde(alias = "movementType")]
    movement_type: Option<String>,
    note: Option<String>,
    source: Option<String>,
}

#[derive(Deserialize)]
struct MovementQuery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
    days: Option<i32>,
}

#[derive(Deserialize)]
struct ForecastQuery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
    history_days: Option<i32>,
}

#[derive(Deserialize)]
struct HistoricalMovementImport {
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    #[serde(alias = "sourceName")]
    source_name: String,
    #[serde(default, alias = "newItems")]
    new_items: Vec<HistoricalInventorySeed>,
    rows: Vec<HistoricalMovementRow>,
}

#[derive(Deserialize)]
struct HistoricalInventorySeed {
    name: String,
    current: Decimal,
    safe: Option<Decimal>,
    unit: String,
    barcode: Option<String>,
}

#[derive(Deserialize)]
struct HistoricalMovementRow {
    #[serde(alias = "sourceRow")]
    source_row: Option<usize>,
    #[serde(alias = "inventoryItemId")]
    inventory_item_id: Option<Uuid>,
    #[serde(alias = "itemName")]
    item_name: Option<String>,
    #[serde(alias = "occurredAt")]
    occurred_at: DateTime<Utc>,
    #[serde(alias = "movementType")]
    movement_type: String,
    quantity: Decimal,
    #[serde(alias = "quantityUnit")]
    quantity_unit: Option<String>,
    note: String,
    reference: Option<String>,
}

#[derive(Deserialize)]
struct MovementImportQuery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
}

#[derive(Deserialize)]
struct ReviewMovementImport {
    id: Uuid,
    approve: bool,
    note: Option<String>,
}

#[derive(Deserialize)]
struct VisionEstimateQuery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
}

#[derive(Deserialize)]
struct ReviewVisionEstimate {
    id: Uuid,
    approve: bool,
    #[serde(alias = "inventoryItemId")]
    inventory_item_id: Option<Uuid>,
    note: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
struct InventoryMovementDay {
    day: chrono::NaiveDate,
    inbound: Decimal,
    outbound: Decimal,
    adjustments: Decimal,
    movement_count: i64,
}

#[derive(Deserialize)]
struct DeleteInventoryQuery {
    id: Uuid,
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct DeleteZoneQuery {
    id: String,
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
}

#[derive(Debug, Serialize, FromRow)]
struct ItemReference {
    id: Uuid,
    #[serde(rename = "warehouseId")]
    warehouse_id: String,
    name: String,
    description: String,
    thumbnail: String,
    #[serde(rename = "createdAt")]
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct ReferenceQuery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
    id: Option<Uuid>,
}

#[derive(Deserialize)]
struct CreateReference {
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    image: String,
    name: String,
    description: Option<String>,
}

#[derive(Deserialize)]
struct ImportReferences {
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    items: Vec<ImportReferenceItem>,
}

#[derive(Deserialize)]
struct ImportReferenceItem {
    name: String,
    image: String,
    description: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct DeliveryRecord {
    id: Uuid,
    #[serde(rename = "warehouseId")]
    warehouse_id: String,
    invoice_no: String,
    carrier_code: String,
    carrier_name: String,
    item_name: String,
    sender_name: String,
    receiver_name: String,
    status: String,
    status_code: String,
    current_location: String,
    delivered_at: Option<DateTime<Utc>>,
    tracking_details: Value,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateDelivery {
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
    invoice_no: String,
    carrier_code: Option<String>,
    carrier_name: Option<String>,
    item_name: Option<String>,
    sender_name: Option<String>,
    receiver_name: Option<String>,
}

#[derive(Deserialize)]
struct DeliveryQuery {
    id: Option<Uuid>,
}

#[derive(Deserialize)]
struct TrackDeliveryInput {
    id: Uuid,
}

#[derive(Deserialize)]
struct MonitorInput {
    image: String,
    #[serde(alias = "itemName")]
    item_name: Option<String>,
    #[serde(alias = "cameraUrl")]
    camera_url: Option<String>,
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct AnalysisResult {
    #[serde(rename = "itemName")]
    item_name: String,
    #[serde(rename = "estimatedQuantity")]
    estimated_quantity: Decimal,
    unit: String,
    status: String,
    #[serde(rename = "statusLabel")]
    status_label: String,
    confidence: i32,
    recommendation: String,
    reason: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::from_filename(".env.local").ok();
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt::init();

    let database_url = env::var("DATABASE_URL").ok();
    let db = match database_url {
        Some(url) => Some(
            PgPoolOptions::new()
                .max_connections(5)
                .connect(&url)
                .await?,
        ),
        None => {
            tracing::warn!("DATABASE_URL is not set; starting in health-only mode");
            None
        }
    };
    if let Some(pool) = &db {
        let schema_sql = include_str!("../schema.sql");
        sqlx::raw_sql(schema_sql).execute(pool).await?;
        sqlx::query("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS barcode TEXT")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT '톤', ADD COLUMN IF NOT EXISTS package_unit TEXT, ADD COLUMN IF NOT EXISTS package_size NUMERIC(20,6) NOT NULL DEFAULT 1, ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE inventory_items ALTER COLUMN current TYPE NUMERIC(20,6) USING current::numeric, ALTER COLUMN safe TYPE NUMERIC(20,6) USING safe::numeric, ALTER COLUMN package_size TYPE NUMERIC(20,6) USING package_size::numeric")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE warehouse_zones ALTER COLUMN capacity TYPE NUMERIC(20,6) USING capacity::numeric")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE warehouse_zones ADD COLUMN IF NOT EXISTS capacity_unit TEXT NOT NULL DEFAULT '톤'")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE monitor_logs ALTER COLUMN estimated_quantity TYPE NUMERIC(20,6) USING estimated_quantity::numeric")
            .execute(pool).await?;
        sqlx::query("DROP INDEX IF EXISTS inventory_items_warehouse_barcode_key")
            .execute(pool).await?;
        sqlx::query("CREATE UNIQUE INDEX inventory_items_warehouse_barcode_key ON inventory_items (warehouse_id, barcode) WHERE barcode IS NOT NULL AND archived_at IS NULL")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE delivery_tracking ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES warehouses(id) ON DELETE CASCADE")
            .execute(pool).await?;
        sqlx::query("UPDATE delivery_tracking SET warehouse_id = 'wh_wjmals' WHERE warehouse_id IS NULL")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE delivery_tracking ALTER COLUMN warehouse_id SET NOT NULL")
            .execute(pool).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS inventory_movements (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE, inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE, item_name TEXT NOT NULL, movement_type TEXT NOT NULL CHECK (movement_type IN ('initial', 'inbound', 'outbound', 'adjustment', 'vision_estimate')), quantity_delta BIGINT NOT NULL, balance_after BIGINT NOT NULL CHECK (balance_after >= 0), note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual', ADD COLUMN IF NOT EXISTS actor_id TEXT, ADD COLUMN IF NOT EXISTS actor_email TEXT")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE inventory_movements ALTER COLUMN quantity_delta TYPE NUMERIC(20,6) USING quantity_delta::numeric, ALTER COLUMN balance_after TYPE NUMERIC(20,6) USING balance_after::numeric")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check, DROP CONSTRAINT IF EXISTS inventory_movements_inventory_item_id_fkey")
            .execute(pool).await?;
        sqlx::query("ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN ('initial','inbound','outbound','adjustment','vision_estimate','historical_import')), ADD CONSTRAINT inventory_movements_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id) ON DELETE RESTRICT")
            .execute(pool).await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS inventory_movements_warehouse_created_idx ON inventory_movements (warehouse_id, created_at DESC)")
            .execute(pool).await?;
        sqlx::query("INSERT INTO inventory_movements (warehouse_id, inventory_item_id, item_name, movement_type, quantity_delta, balance_after, note) SELECT i.warehouse_id, i.id, i.name, 'initial', i.current, i.current, 'inventory ledger initialization' FROM inventory_items i WHERE NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.inventory_item_id = i.id)")
            .execute(pool).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS inventory_audit_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE, actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, before_data JSONB, after_data JSONB, reason TEXT NOT NULL, source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            .execute(pool).await?;
        sqlx::query("CREATE INDEX IF NOT EXISTS inventory_audit_events_warehouse_created_idx ON inventory_audit_events (warehouse_id, created_at DESC)")
            .execute(pool).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS inventory_movement_import_batches (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE, submitted_by TEXT NOT NULL, submitted_email TEXT NOT NULL, source_name TEXT NOT NULL, row_count INTEGER NOT NULL CHECK (row_count > 0), status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')), reviewed_by TEXT, reviewed_email TEXT, reviewed_at TIMESTAMPTZ, review_note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            .execute(pool).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS inventory_movement_import_rows (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), batch_id UUID NOT NULL REFERENCES inventory_movement_import_batches(id) ON DELETE CASCADE, inventory_item_id UUID NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT, item_name TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL, movement_type TEXT NOT NULL CHECK (movement_type IN ('inbound','outbound','adjustment')), quantity_delta NUMERIC(20,6) NOT NULL CHECK (quantity_delta <> 0), note TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '')")
            .execute(pool).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS inventory_vision_estimates (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE, inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE RESTRICT, item_name TEXT NOT NULL, estimated_quantity NUMERIC(20,6) NOT NULL CHECK (estimated_quantity >= 0), unit TEXT NOT NULL, confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100), recommendation TEXT NOT NULL, reason TEXT NOT NULL, image_snapshot TEXT, submitted_by TEXT NOT NULL, submitted_email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')), reviewed_by TEXT, reviewed_email TEXT, reviewed_at TIMESTAMPTZ, review_note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            .execute(pool).await?;
    }

    let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| {
        let mut bytes = [0_u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        tracing::warn!("JWT_SECRET is unset; using a temporary process secret (sessions reset on restart)");
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    });
    let state = AppState { db, jwt_secret };
    let protected_routes = Router::new()
        .route("/health", get(health))
        .route("/api/inventory", get(list_inventory).post(create_inventory).patch(update_inventory).delete(delete_inventory))
        .route("/api/inventory/movements", get(list_inventory_movements))
        .route("/api/inventory/forecast", get(list_inventory_forecast))
        .route("/api/inventory/ledger", get(list_inventory_ledger))
        .route("/api/inventory/import", axum::routing::post(submit_movement_import))
        .route("/api/inventory/imports", get(list_movement_imports))
        .route("/api/inventory/imports/review", axum::routing::post(review_movement_import))
        .route("/api/users", get(get_users).post(users_action).delete(delete_user))
        .route("/api/zones", get(list_zones).post(save_zone).delete(delete_zone))
        .route("/api/vision", get(list_references).post(create_reference).delete(delete_reference))
        .route("/api/vision/import", axum::routing::post(import_references))
        .route("/api/vision/estimates", get(list_vision_estimates))
        .route("/api/vision/estimates/review", axum::routing::post(review_vision_estimate))
        .route("/api/delivery", get(list_delivery).post(create_delivery).delete(delete_delivery).put(advance_delivery))
        .route("/api/delivery/track", axum::routing::post(track_delivery))
        .route("/api/monitor", get(list_monitor_logs).post(analyze_monitor_image))
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate_request));
    let allowed_origins = env::var("FRONTEND_ORIGINS").unwrap_or_else(|_| "http://localhost:3000,http://127.0.0.1:3000".to_string())
        .split(',').filter_map(|origin| HeaderValue::from_str(origin.trim()).ok()).collect::<Vec<_>>();
    let cors = CorsLayer::new()
        .allow_origin(allowed_origins)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::PUT, Method::DELETE])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE])
        .allow_credentials(true);
    let app = Router::new()
        .merge(protected_routes)
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);
    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "WMS Rust API listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn authenticate_request(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<axum::response::Response, (StatusCode, String)> {
    let (mut parts, body) = request.into_parts();
    let bytes = to_bytes(body, 25 * 1024 * 1024)
        .await
        .map_err(|_| (StatusCode::PAYLOAD_TOO_LARGE, "request body is too large".to_string()))?;
    let mut body_value = serde_json::from_slice::<Value>(&bytes).ok();

    let public_auth = parts.uri.path() == "/api/users"
        && parts.method == axum::http::Method::POST
        && body_value.as_ref().and_then(|body| body.get("action")).and_then(Value::as_str)
            .is_some_and(|action| matches!(action, "login" | "signup"));
    if parts.uri.path() == "/health" || public_auth {
        return Ok(next.run(Request::from_parts(parts, Body::from(bytes))).await);
    }

    let unauthorized = || (StatusCode::UNAUTHORIZED, "유효한 로그인 세션이 필요합니다.".to_string());
    let token = parts.headers.get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(unauthorized)?;
    let claims = decode::<SessionClaims>(token, &DecodingKey::from_secret(state.jwt_secret.as_bytes()), &Validation::default())
        .map_err(|_| unauthorized())?.claims;

    let current_user = if claims.role == "서버 관리자" && claims.email == "wjmals@wms-smartstock.ai" {
        AuthenticatedUser {
            id: claims.sub.clone(),
            email: claims.email.clone(),
            role: claims.role.clone(),
            status: "APPROVED".to_string(),
            warehouse_id: claims.warehouse_id.clone(),
        }
    } else {
        let db = state.db.as_ref().ok_or_else(database_not_configured)?;
        let row = sqlx::query_as::<_, (Uuid, String, String, String, Option<String>)>(
            "SELECT id, email, role, status, warehouse_id FROM users WHERE email = $1",
        ).bind(&claims.email).fetch_optional(db).await.map_err(internal_error)?
            .ok_or_else(unauthorized)?;
        if row.0.to_string() != claims.sub {
            return Err(unauthorized());
        }
        AuthenticatedUser { id: row.0.to_string(), email: row.1, role: row.2, status: row.3, warehouse_id: row.4 }
    };

    if current_user.status != "APPROVED" {
        let is_account_refresh = parts.uri.path() == "/api/users"
            && parts.method == Method::GET
            && parts.uri.query().is_some_and(|query| query.split('&').any(|pair| pair == "action=get_user"));
        let is_access_request = parts.uri.path() == "/api/users"
            && parts.method == Method::POST
            && body_value.as_ref().and_then(|body| body.get("action")).and_then(Value::as_str) == Some("request_access")
            && current_user.role == "창고지기";
        if !is_account_refresh && !is_access_request {
            return Err((StatusCode::FORBIDDEN, "승인 대기 계정은 본인 정보 확인과 창고 접근 요청만 할 수 있습니다.".to_string()));
        }
    }

    let path = parts.uri.path();
    let scoped_path = path.starts_with("/api/inventory") || path == "/api/zones" || path.starts_with("/api/vision") || path == "/api/monitor";
    if scoped_path && current_user.role != "서버 관리자" {
        let warehouse_id = current_user.warehouse_id.as_deref()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| (StatusCode::FORBIDDEN, "계정에 배정된 창고가 없습니다.".to_string()))?;
        let query_pairs: Vec<(String, String)> = parts.uri.query().map(|query| {
            url::form_urlencoded::parse(query.as_bytes()).map(|(key, value)| (key.into_owned(), value.into_owned())).collect()
        }).unwrap_or_default();
        let requested_warehouse = query_pairs.iter().find(|(key, _)| key == "warehouseId" || key == "warehouse_id").map(|(_, value)| value.as_str());
        if requested_warehouse.is_some_and(|requested| requested != warehouse_id) {
            return Err((StatusCode::FORBIDDEN, "다른 창고에는 접근할 수 없습니다.".to_string()));
        }
        if parts.uri.query().is_some() || parts.method == axum::http::Method::GET || parts.method == axum::http::Method::DELETE {
            if !query_pairs.iter().any(|(key, _)| key == "warehouseId" || key == "warehouse_id") {
                let mut pairs = query_pairs;
                pairs.push(("warehouseId".to_string(), warehouse_id.to_string()));
                let query = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish();
                let path = parts.uri.path().to_string();
                parts.uri = format!("{path}?{query}").parse().map_err(|_| (StatusCode::BAD_REQUEST, "invalid request URL".to_string()))?;
            }
        } else if let Some(value) = body_value.as_mut().and_then(Value::as_object_mut) {
            if value.get("warehouseId").or_else(|| value.get("warehouse_id")).and_then(Value::as_str).is_some_and(|requested| requested != warehouse_id) {
                return Err((StatusCode::FORBIDDEN, "다른 창고에는 접근할 수 없습니다.".to_string()));
            }
            value.insert("warehouseId".to_string(), Value::String(warehouse_id.to_string()));
        }
        let bytes = if let Some(value) = body_value { serde_json::to_vec(&value).unwrap_or_default() } else { bytes.to_vec() };
        parts.headers.remove(CONTENT_LENGTH);
        parts.extensions.insert(current_user);
        return Ok(next.run(Request::from_parts(parts, Body::from(bytes))).await);
    }

    let bytes = body_value.map(|value| serde_json::to_vec(&value).unwrap_or_default()).unwrap_or_else(|| bytes.to_vec());
    parts.headers.remove(CONTENT_LENGTH);
    parts.extensions.insert(current_user);
    Ok(next.run(Request::from_parts(parts, Body::from(bytes))).await)
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        database: if state.db.is_some() { "configured" } else { "not_configured" },
    })
}

async fn list_inventory(
    State(state): State<AppState>,
    Query(query): Query<InventoryQuery>,
) -> Result<Json<Vec<InventoryItem>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(|| database_not_configured())?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let items = sqlx::query_as::<_, InventoryItem>(
        "SELECT id,warehouse_id,name,barcode,current,safe,unit,package_unit,package_size,status,status_label,diff_text,recommendation,cycle,date,created_at,updated_at
         FROM inventory_items WHERE warehouse_id=$1 AND archived_at IS NULL ORDER BY name",
    )
    .bind(warehouse_id)
    .fetch_all(&db)
    .await
    .map_err(internal_error)?;

    Ok(Json(items))
}

async fn create_inventory(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<CreateInventoryItem>,
) -> Result<(StatusCode, Json<InventoryItem>), (StatusCode, String)> {
    let package_size = input.package_size.unwrap_or(Decimal::ONE);
    let unit = input.unit.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or("톤");
    if input.name.trim().is_empty() || input.current < Decimal::ZERO || input.safe < Decimal::ZERO || package_size <= Decimal::ZERO {
        return Err((StatusCode::BAD_REQUEST, "name, current, safe, and packageSize are invalid".to_string()));
    }
    if unit.chars().count() > 16 || input.package_unit.as_deref().is_some_and(|value| value.trim().is_empty() || value.chars().count() > 16) {
        return Err((StatusCode::BAD_REQUEST, "unit names must contain 1 to 16 characters".to_string()));
    }

    let db = state.db.ok_or_else(database_not_configured)?;
    let mut transaction = db.begin().await.map_err(internal_error)?;
    let (status, status_label, diff_text, recommendation) = classify_stock(input.current, input.safe, unit);
    let item = sqlx::query_as::<_, InventoryItem>(
        "INSERT INTO inventory_items (warehouse_id,name,barcode,unit,package_unit,package_size,current,safe,status,status_label,diff_text,recommendation,cycle,date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_DATE)
         RETURNING id,warehouse_id,name,barcode,current,safe,unit,package_unit,package_size,status,status_label,diff_text,recommendation,cycle,date,created_at,updated_at",
    ).bind(&input.warehouse_id).bind(input.name.trim())
        .bind(input.barcode.as_deref().filter(|value| !value.trim().is_empty()))
        .bind(unit).bind(input.package_unit.as_deref().filter(|value| !value.trim().is_empty())).bind(package_size)
        .bind(input.current).bind(input.safe).bind(status).bind(status_label).bind(diff_text).bind(recommendation)
        .bind(input.cycle.unwrap_or_else(|| "월간".to_string()))
        .fetch_one(&mut *transaction).await.map_err(internal_error)?;
    let reason = input.note.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or("초기 재고 등록");
    sqlx::query("INSERT INTO inventory_movements (warehouse_id,inventory_item_id,item_name,movement_type,quantity_delta,balance_after,note,source,actor_id,actor_email) VALUES ($1,$2,$3,'initial',$4,$4,$5,'manual',$6,$7)")
        .bind(&item.warehouse_id).bind(item.id).bind(&item.name).bind(item.current).bind(reason).bind(&user.id).bind(&user.email).execute(&mut *transaction).await.map_err(internal_error)?;
    sqlx::query("INSERT INTO inventory_audit_events (warehouse_id,actor_id,actor_email,action,entity_type,entity_id,after_data,reason,source) VALUES ($1,$2,$3,'create','inventory_item',$4,$5,$6,'manual')")
        .bind(&item.warehouse_id).bind(&user.id).bind(&user.email).bind(item.id.to_string())
        .bind(serde_json::json!({"name": &item.name,"barcode": &item.barcode,"current": item.current,"safe": item.safe,"unit": &item.unit,"packageUnit": &item.package_unit,"packageSize": item.package_size}))
        .bind(reason).execute(&mut *transaction).await.map_err(internal_error)?;
    transaction.commit().await.map_err(internal_error)?;

    Ok((StatusCode::CREATED, Json(item)))
}

async fn update_inventory(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<UpdateInventoryItem>,
) -> Result<Json<InventoryItem>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let mut transaction = db.begin().await.map_err(internal_error)?;
    let existing = sqlx::query_as::<_, (String, String, Decimal, Decimal, String, Option<String>, Decimal)>("SELECT warehouse_id,name,current,safe,unit,package_unit,package_size FROM inventory_items WHERE id=$1 AND warehouse_id=$2 AND archived_at IS NULL FOR UPDATE")
        .bind(input.id).bind(&input.warehouse_id).fetch_optional(&mut *transaction).await.map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "해당 아이템을 찾을 수 없습니다.".to_string()))?;
    let reason = input.note.as_deref().filter(|value| !value.trim().is_empty()).ok_or_else(|| (StatusCode::BAD_REQUEST, "변동 또는 수정 사유를 입력해야 합니다.".to_string()))?;
    let source = input.source.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or("manual");
    let movement_type = input.movement_type.unwrap_or_else(|| "adjustment".to_string());
    if !matches!(movement_type.as_str(), "inbound" | "outbound" | "adjustment") {
        return Err((StatusCode::BAD_REQUEST, "movementType does not match the stock change".to_string()));
    }
    let delta = if let Some(target) = input.current {
        target - existing.2
    } else {
        let quantity = input.quantity.ok_or_else(|| (StatusCode::BAD_REQUEST, "current or quantity is required".to_string()))?;
        if quantity <= Decimal::ZERO { return Err((StatusCode::BAD_REQUEST, "quantity must be greater than zero".to_string())); }
        let entered_unit = input.quantity_unit.as_deref().unwrap_or(&existing.4);
        let multiplier = if entered_unit == existing.4 { Decimal::ONE }
            else if existing.5.as_deref() == Some(entered_unit) { existing.6 }
            else { return Err((StatusCode::BAD_REQUEST, "quantityUnit must match the item's base or package unit".to_string())); };
        let converted = quantity * multiplier;
        if movement_type == "outbound" { -converted } else { converted }
    };
    if (movement_type == "inbound" && delta < Decimal::ZERO) || (movement_type == "outbound" && delta >= Decimal::ZERO) {
        return Err((StatusCode::BAD_REQUEST, "movementType does not match the stock change".to_string()));
    }
    let current = existing.2 + delta;
    if current < Decimal::ZERO { return Err((StatusCode::BAD_REQUEST, "current must be non-negative".to_string())); }
    let safe = input.safe.unwrap_or(existing.3);
    if safe < Decimal::ZERO {
        return Err((StatusCode::BAD_REQUEST, "safe must be non-negative".to_string()));
    }
    let (status, status_label, diff_text, recommendation) = classify_stock(current, safe, &existing.4);
    let item = sqlx::query_as::<_, InventoryItem>(
        "UPDATE inventory_items SET current=$1,safe=$2,status=$3,status_label=$4,diff_text=$5,recommendation=$6,updated_at=now()
         WHERE id=$7 AND warehouse_id=$8
         RETURNING id,warehouse_id,name,barcode,current,safe,unit,package_unit,package_size,status,status_label,diff_text,recommendation,cycle,date,created_at,updated_at",
    ).bind(current).bind(safe).bind(status).bind(status_label).bind(diff_text).bind(recommendation)
    .bind(input.id).bind(input.warehouse_id).fetch_optional(&mut *transaction).await.map_err(internal_error)?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "해당 아이템을 찾을 수 없습니다.".to_string()))?;
    if delta != Decimal::ZERO {
        sqlx::query("INSERT INTO inventory_movements (warehouse_id,inventory_item_id,item_name,movement_type,quantity_delta,balance_after,note,source,actor_id,actor_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(&existing.0).bind(item.id).bind(&existing.1).bind(&movement_type).bind(delta).bind(item.current).bind(reason).bind(source).bind(&user.id).bind(&user.email)
            .execute(&mut *transaction).await.map_err(internal_error)?;
    }
    sqlx::query("INSERT INTO inventory_audit_events (warehouse_id,actor_id,actor_email,action,entity_type,entity_id,before_data,after_data,reason,source) VALUES ($1,$2,$3,$4,'inventory_item',$5,$6,$7,$8,$9)")
        .bind(&existing.0).bind(&user.id).bind(&user.email).bind(if delta.is_zero() { "update" } else { movement_type.as_str() }).bind(item.id.to_string())
        .bind(serde_json::json!({"current": existing.2, "safe": existing.3}))
        .bind(serde_json::json!({"current": item.current, "safe": item.safe, "delta": delta}))
        .bind(reason).bind(source).execute(&mut *transaction).await.map_err(internal_error)?;
    transaction.commit().await.map_err(internal_error)?;
    Ok(Json(item))
}

async fn delete_inventory(
    State(state): State<AppState>,
    Query(query): Query<DeleteInventoryQuery>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let reason = query.reason.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or("재고 품목 보관 처리");
    let mut transaction = db.begin().await.map_err(internal_error)?;
    let item = sqlx::query_as::<_, (String, Decimal, Decimal)>("SELECT name,current,safe FROM inventory_items WHERE id=$1 AND warehouse_id=$2 AND archived_at IS NULL FOR UPDATE")
        .bind(query.id).bind(&query.warehouse_id).fetch_optional(&mut *transaction).await.map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "활성 재고 품목을 찾을 수 없습니다.".to_string()))?;
    sqlx::query("UPDATE inventory_items SET archived_at=now(),updated_at=now() WHERE id=$1 AND warehouse_id=$2")
        .bind(query.id).bind(&query.warehouse_id).execute(&mut *transaction).await.map_err(internal_error)?;
    sqlx::query("INSERT INTO inventory_audit_events (warehouse_id,actor_id,actor_email,action,entity_type,entity_id,before_data,after_data,reason,source) VALUES ($1,$2,$3,'archive','inventory_item',$4,$5,$6,$7,'api')")
        .bind(&query.warehouse_id).bind(&user.id).bind(&user.email).bind(query.id.to_string())
        .bind(serde_json::json!({"name": item.0, "current": item.1, "safe": item.2}))
        .bind(serde_json::json!({"archived": true})).bind(reason).execute(&mut *transaction).await.map_err(internal_error)?;
    transaction.commit().await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "success": true, "archived": true, "archivedId": query.id })))
}

async fn submit_movement_import(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<HistoricalMovementImport>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    if input.rows.len() > 5000 || input.new_items.len() > 5000 || (input.rows.is_empty() && input.new_items.is_empty()) || input.source_name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "sourceName and up to 5000 rows or new items are required".to_string()));
    }
    let warehouse_id = if user.role == "서버 관리자" {
        input.warehouse_id.clone()
    } else {
        let assigned = user.warehouse_id.as_deref().ok_or_else(|| (StatusCode::FORBIDDEN, "계정에 배정된 창고가 없습니다.".to_string()))?;
        if assigned != input.warehouse_id { return Err((StatusCode::FORBIDDEN, "다른 창고에는 거래를 가져올 수 없습니다.".to_string())); }
        assigned.to_string()
    };
    let db = state.db.ok_or_else(database_not_configured)?;
    let mut transaction = db.begin().await.map_err(internal_error)?;
    let mut created_items = 0;
    for item in input.new_items {
        let name = item.name.trim();
        let unit = item.unit.trim();
        let barcode = item.barcode.as_deref().map(str::trim).filter(|value| !value.is_empty());
        let safe = item.safe.unwrap_or(Decimal::ZERO);
        if name.is_empty() || name.chars().count() > 200 || unit.is_empty() || unit.chars().count() > 16 || item.current < Decimal::ZERO || safe < Decimal::ZERO {
            return Err((StatusCode::BAD_REQUEST, format!("new inventory item '{}' has invalid name, unit, current, or safe stock", name)));
        }
        if sqlx::query_scalar::<_, Uuid>("SELECT id FROM inventory_items WHERE warehouse_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1")
            .bind(&warehouse_id).bind(name).fetch_optional(&mut *transaction).await.map_err(internal_error)?.is_some() {
            continue;
        }
        let (status, status_label, diff_text, recommendation) = classify_stock(item.current, safe, unit);
        let created = sqlx::query_as::<_, (Uuid, String)>(
            "INSERT INTO inventory_items (warehouse_id,name,barcode,unit,current,safe,status,status_label,diff_text,recommendation,cycle,date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'월간',CURRENT_DATE)
             RETURNING id,name",
        ).bind(&warehouse_id).bind(name).bind(barcode).bind(unit).bind(item.current).bind(safe)
            .bind(status).bind(status_label).bind(diff_text).bind(recommendation)
            .fetch_one(&mut *transaction).await.map_err(internal_error)?;
        sqlx::query("INSERT INTO inventory_movements (warehouse_id,inventory_item_id,item_name,movement_type,quantity_delta,balance_after,note,source,actor_id,actor_email) VALUES ($1,$2,$3,'initial',$4,$4,'Excel initial stock','historical_import',$5,$6)")
            .bind(&warehouse_id).bind(created.0).bind(&created.1).bind(item.current).bind(&user.id).bind(&user.email)
            .execute(&mut *transaction).await.map_err(internal_error)?;
        sqlx::query("INSERT INTO inventory_audit_events (warehouse_id,actor_id,actor_email,action,entity_type,entity_id,after_data,reason,source) VALUES ($1,$2,$3,'create','inventory_item',$4,$5,'Excel initial stock','historical_import')")
            .bind(&warehouse_id).bind(&user.id).bind(&user.email).bind(created.0.to_string())
            .bind(serde_json::json!({"name":created.1,"current":item.current,"safe":safe,"unit":unit}))
            .execute(&mut *transaction).await.map_err(internal_error)?;
        created_items += 1;
    }

    let row_count = input.rows.len();
    let batch_id = if row_count > 0 {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO inventory_movement_import_batches (id,warehouse_id,submitted_by,submitted_email,source_name,row_count) VALUES ($1,$2,$3,$4,$5,$6)")
            .bind(id).bind(&warehouse_id).bind(&user.id).bind(&user.email).bind(input.source_name.trim()).bind(row_count as i32)
            .execute(&mut *transaction).await.map_err(internal_error)?;
        Some(id)
    } else { None };
    for (row_index, row) in input.rows.into_iter().enumerate() {
        let source_row = row.source_row.unwrap_or(row_index + 2);
        if !matches!(row.movement_type.as_str(), "inbound" | "outbound" | "adjustment") {
            return Err((StatusCode::BAD_REQUEST, format!("{}행: 거래 유형 '{}'은 inbound, outbound, adjustment 중 하나여야 합니다.", source_row, row.movement_type)));
        }
        if row.quantity.is_zero() {
            return Err((StatusCode::BAD_REQUEST, format!("{}행: 거래 수량은 0일 수 없습니다. 0 수량 행은 최신 화면에서 자동 제외되어야 합니다. 화면을 새로고침하고 다시 업로드하세요.", source_row)));
        }
        if row.occurred_at >= Utc::now() {
            return Err((StatusCode::BAD_REQUEST, format!("{}행: 거래일은 현재보다 과거여야 합니다.", source_row)));
        }
        if row.note.trim().is_empty() {
            return Err((StatusCode::BAD_REQUEST, format!("{}행: 거래 사유(note)가 비어 있습니다.", source_row)));
        }
        let item = if let Some(item_id) = row.inventory_item_id {
            sqlx::query_as::<_, (Uuid, String, String, Option<String>, Decimal)>("SELECT id,name,unit,package_unit,package_size FROM inventory_items WHERE id=$1 AND warehouse_id=$2 AND archived_at IS NULL")
                .bind(item_id).bind(&warehouse_id).fetch_optional(&mut *transaction).await.map_err(internal_error)?
        } else if let Some(item_name) = row.item_name.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            sqlx::query_as::<_, (Uuid, String, String, Option<String>, Decimal)>("SELECT id,name,unit,package_unit,package_size FROM inventory_items WHERE warehouse_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1")
                .bind(&warehouse_id).bind(item_name).fetch_optional(&mut *transaction).await.map_err(internal_error)?
        } else { None }
            .ok_or_else(|| (StatusCode::BAD_REQUEST, "inventory item is unavailable in this warehouse".to_string()))?;
        let entered_unit = row.quantity_unit.as_deref().unwrap_or(&item.2);
        let multiplier = if entered_unit == item.2 { Decimal::ONE }
            else if item.3.as_deref() == Some(entered_unit) { item.4 }
            else { return Err((StatusCode::BAD_REQUEST, format!("unit '{}' does not match item '{}'", entered_unit, item.1))); };
        let magnitude = row.quantity.abs() * multiplier;
        let delta = match row.movement_type.as_str() {
            "inbound" => magnitude,
            "outbound" => -magnitude,
            _ => row.quantity * multiplier,
        };
        sqlx::query("INSERT INTO inventory_movement_import_rows (batch_id,inventory_item_id,item_name,occurred_at,movement_type,quantity_delta,note,reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)")
            .bind(batch_id.unwrap()).bind(item.0).bind(item.1).bind(row.occurred_at).bind(row.movement_type).bind(delta).bind(row.note.trim()).bind(row.reference.unwrap_or_default())
            .execute(&mut *transaction).await.map_err(internal_error)?;
    }
    transaction.commit().await.map_err(internal_error)?;
    Ok((StatusCode::ACCEPTED, Json(serde_json::json!({"batchId":batch_id,"status":if batch_id.is_some(){"PENDING"}else{"IMPORTED"},"rows":row_count,"createdItems":created_items}))))
}

async fn list_inventory_ledger(
    State(state): State<AppState>,
    Query(query): Query<MovementQuery>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let limit = query.days.unwrap_or(90).clamp(1, 365) as i64 * 50;
    let rows = sqlx::query_as::<_, (Uuid, String, String, Decimal, Decimal, String, String, Option<String>, DateTime<Utc>)>(
        "SELECT id,item_name,movement_type,quantity_delta,balance_after,note,source,actor_email,created_at FROM inventory_movements WHERE warehouse_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2",
    ).bind(warehouse_id).bind(limit).fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(rows.into_iter().map(|row| serde_json::json!({"id":row.0,"itemName":row.1,"movementType":row.2,"quantityDelta":row.3,"balanceAfter":row.4,"reason":row.5,"source":row.6,"operator":row.7,"occurredAt":row.8})).collect()))
}

async fn list_movement_imports(
    State(state): State<AppState>,
    Query(query): Query<MovementImportQuery>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let warehouse_id = if user.role == "서버 관리자" { query.warehouse_id } else { user.warehouse_id };
    let warehouse_id = warehouse_id.ok_or_else(|| (StatusCode::BAD_REQUEST, "warehouseId is required".to_string()))?;
    let db = state.db.ok_or_else(database_not_configured)?;
    let batches = sqlx::query_as::<_, (Uuid, String, String, String, i32, String, DateTime<Utc>, Option<String>, Option<DateTime<Utc>>, String)>(
        "SELECT id,source_name,submitted_by,submitted_email,row_count,status,created_at,reviewed_email,reviewed_at,review_note FROM inventory_movement_import_batches WHERE warehouse_id=$1 ORDER BY created_at DESC LIMIT 100",
    ).bind(warehouse_id).fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(batches.into_iter().map(|batch| serde_json::json!({"id":batch.0,"sourceName":batch.1,"submittedBy":batch.2,"submittedEmail":batch.3,"rowCount":batch.4,"status":batch.5,"createdAt":batch.6,"reviewedEmail":batch.7,"reviewedAt":batch.8,"reviewNote":batch.9})).collect()))
}

async fn review_movement_import(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<ReviewMovementImport>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if user.role != "관리자" && user.role != "서버 관리자" {
        return Err((StatusCode::FORBIDDEN, "관리자만 과거 거래를 검토할 수 있습니다.".to_string()));
    }
    let db = state.db.ok_or_else(database_not_configured)?;
    let mut transaction = db.begin().await.map_err(internal_error)?;
    let batch = sqlx::query_as::<_, (String, String)>("SELECT warehouse_id,status FROM inventory_movement_import_batches WHERE id=$1 FOR UPDATE")
        .bind(input.id).fetch_optional(&mut *transaction).await.map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "가져오기 배치를 찾을 수 없습니다.".to_string()))?;
    if user.role != "서버 관리자" && user.warehouse_id.as_deref() != Some(batch.0.as_str()) {
        return Err((StatusCode::FORBIDDEN, "다른 창고의 거래는 검토할 수 없습니다.".to_string()));
    }
    if batch.1 != "PENDING" { return Err((StatusCode::CONFLICT, "이미 검토된 가져오기 배치입니다.".to_string())); }
    let review_note = input.note.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or(if input.approve { "관리자 승인" } else { "관리자 반려" });
    if input.approve {
        let rows = sqlx::query_as::<_, (Uuid, String, DateTime<Utc>, String, Decimal, String, String)>("SELECT inventory_item_id,item_name,occurred_at,movement_type,quantity_delta,note,reference FROM inventory_movement_import_rows WHERE batch_id=$1 ORDER BY inventory_item_id,occurred_at,id")
            .bind(input.id).fetch_all(&mut *transaction).await.map_err(internal_error)?;
        let mut grouped: std::collections::BTreeMap<Uuid, Vec<(String, DateTime<Utc>, String, Decimal, String, String)>> = std::collections::BTreeMap::new();
        for row in rows { grouped.entry(row.0).or_default().push((row.1,row.2,row.3,row.4,row.5,row.6)); }
        for (item_id, item_rows) in grouped {
            let baseline = sqlx::query_as::<_, (DateTime<Utc>, Decimal)>("SELECT created_at,balance_after FROM inventory_movements WHERE inventory_item_id=$1 ORDER BY created_at,id LIMIT 1")
                .bind(item_id).fetch_optional(&mut *transaction).await.map_err(internal_error)?
                .ok_or_else(|| (StatusCode::CONFLICT, "품목에 기준 장부가 없어 가져올 수 없습니다.".to_string()))?;
            if item_rows.iter().any(|row| row.1 >= baseline.0) {
                return Err((StatusCode::CONFLICT, "기존 최초 장부보다 오래된 거래만 가져올 수 있습니다.".to_string()));
            }
            let imported_delta = item_rows.iter().map(|row| row.3).sum::<Decimal>();
            let mut balance = baseline.1 - imported_delta;
            if balance < Decimal::ZERO { return Err((StatusCode::CONFLICT, "가져온 내역을 역산하면 기초 재고가 음수가 됩니다.".to_string())); }
            for row in item_rows {
                balance += row.3;
                if balance < Decimal::ZERO { return Err((StatusCode::CONFLICT, "과거 거래 중 재고가 음수가 되는 시점이 있습니다.".to_string())); }
                sqlx::query("INSERT INTO inventory_movements (warehouse_id,inventory_item_id,item_name,movement_type,quantity_delta,balance_after,note,source,actor_id,actor_email,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
                    .bind(&batch.0).bind(item_id).bind(row.0).bind(row.2).bind(row.3).bind(balance).bind(format!("{}{}",row.4,if row.5.is_empty(){String::new()}else{format!(" (참조: {})",row.5)})).bind(format!("historical_import:{}",input.id)).bind(&user.id).bind(&user.email).bind(row.1)
                    .execute(&mut *transaction).await.map_err(internal_error)?;
            }
            if balance != baseline.1 { return Err((StatusCode::CONFLICT, "과거 거래 잔액 검증에 실패했습니다.".to_string())); }
        }
    }
    let status = if input.approve { "APPROVED" } else { "REJECTED" };
    sqlx::query("UPDATE inventory_movement_import_batches SET status=$1,reviewed_by=$2,reviewed_email=$3,reviewed_at=now(),review_note=$4 WHERE id=$5")
        .bind(status).bind(&user.id).bind(&user.email).bind(review_note).bind(input.id).execute(&mut *transaction).await.map_err(internal_error)?;
    sqlx::query("INSERT INTO inventory_audit_events (warehouse_id,actor_id,actor_email,action,entity_type,entity_id,after_data,reason,source) VALUES ($1,$2,$3,$4,'movement_import_batch',$5,$6,$7,'historical_import')")
        .bind(&batch.0).bind(&user.id).bind(&user.email).bind(status.to_lowercase()).bind(input.id.to_string()).bind(serde_json::json!({"status":status})).bind(review_note)
        .execute(&mut *transaction).await.map_err(internal_error)?;
    transaction.commit().await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({"success":true,"status":status,"batchId":input.id})))
}

async fn list_inventory_movements(
    State(state): State<AppState>,
    Query(query): Query<MovementQuery>,
) -> Result<Json<Vec<InventoryMovementDay>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let days = query.days.unwrap_or(30).clamp(1, 365);
    let rows = sqlx::query_as::<_, InventoryMovementDay>(
        "SELECT day::date AS day,
                COALESCE(SUM(CASE WHEN m.movement_type = 'inbound' THEN m.quantity_delta ELSE 0 END), 0)::numeric AS inbound,
                COALESCE(SUM(CASE WHEN m.movement_type = 'outbound' THEN -m.quantity_delta ELSE 0 END), 0)::numeric AS outbound,
                COALESCE(SUM(CASE WHEN m.movement_type IN ('adjustment', 'vision_estimate') THEN m.quantity_delta ELSE 0 END), 0)::numeric AS adjustments,
                  COUNT(m.id) FILTER (WHERE m.movement_type <> 'initial')::bigint AS movement_count
              FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') AS calendar(day)
              LEFT JOIN inventory_movements m ON m.warehouse_id = $1 AND m.created_at >= calendar.day AND m.created_at < calendar.day + interval '1 day'
         GROUP BY day ORDER BY day",
    ).bind(warehouse_id).bind(days).fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(rows))
}

async fn list_inventory_forecast(
    State(state): State<AppState>,
    Query(query): Query<ForecastQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    const TRAINING_DAYS: usize = 28;
    const HOLDOUT_DAYS: usize = 7;
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let history_days = query.history_days.unwrap_or(90).clamp(35, 365);
    let rows = sqlx::query_as::<_, (Uuid, String, String, Decimal, chrono::NaiveDate, Decimal)>(
        "WITH item_coverage AS (
            SELECT i.id, i.name, i.unit, i.safe,
                   GREATEST(i.created_at::date, COALESCE(MIN(m.created_at)::date, i.created_at::date)) AS coverage_start
              FROM inventory_items i
              LEFT JOIN inventory_movements m ON m.inventory_item_id = i.id
             WHERE i.warehouse_id = $1 AND i.archived_at IS NULL
             GROUP BY i.id
         )
         SELECT c.id, c.name, c.unit, c.safe, calendar.day::date AS day,
                COALESCE(SUM(CASE WHEN m.movement_type = 'outbound' THEN -m.quantity_delta ELSE 0 END), 0)::numeric AS outbound
           FROM item_coverage c
           CROSS JOIN LATERAL generate_series(
               GREATEST(c.coverage_start, current_date - ($2::int - 1)),
               current_date - interval '1 day',
               interval '1 day'
           ) AS calendar(day)
           LEFT JOIN inventory_movements m ON m.inventory_item_id = c.id
                AND m.created_at >= calendar.day
                AND m.created_at < calendar.day + interval '1 day'
          GROUP BY c.id, c.name, c.unit, c.safe, calendar.day
          ORDER BY c.name, calendar.day",
    ).bind(&warehouse_id).bind(history_days).fetch_all(&db).await.map_err(internal_error)?;

    let mut grouped: std::collections::BTreeMap<Uuid, (String, String, Decimal, Vec<Decimal>)> = std::collections::BTreeMap::new();
    for row in rows {
        grouped.entry(row.0).or_insert_with(|| (row.1, row.2, row.3, Vec::new())).3.push(row.5);
    }
    let mut aggregate_percentage_error = Decimal::ZERO;
    let mut aggregate_samples = 0_usize;
    let mut eligible_items = 0_usize;
    let items = grouped.into_iter().map(|(id, (name, unit, safe, daily_outbound))| {
        let history_count = daily_outbound.len();
        let Some((forecast_total, mape, sample_days)) = evaluate_moving_average(&daily_outbound, TRAINING_DAYS, HOLDOUT_DAYS) else {
            return serde_json::json!({
                "itemId": id,
                "itemName": name,
                "unit": unit,
                "safe": safe,
                "historyDays": history_count,
                "status": "insufficient_data",
                "requiredDays": TRAINING_DAYS + HOLDOUT_DAYS,
                "forecastOutflow7d": Value::Null,
                "mapePct": Value::Null,
                "accuracyPct": Value::Null,
                "mapeSampleDays": 0
            });
        };
        if let Some(item_mape) = mape {
            eligible_items += 1;
            aggregate_percentage_error += item_mape * Decimal::from(sample_days as u64);
            aggregate_samples += sample_days;
        }
        serde_json::json!({
            "itemId": id,
            "itemName": name,
            "unit": unit,
            "safe": safe,
            "historyDays": history_count,
            "status": if mape.is_some() { "backtest_available" } else { "no_nonzero_backtest_days" },
            "forecastOutflow7d": forecast_total,
            "mapePct": mape,
            "accuracyPct": mape.map(|value| (Decimal::from(100u32) - value).max(Decimal::ZERO)),
            "mapeSampleDays": sample_days
        })
    }).collect::<Vec<_>>();

    let overall_mape = if aggregate_samples == 0 { None } else {
        Some(aggregate_percentage_error / Decimal::from(aggregate_samples as u64))
    };
    let sufficient = overall_mape.is_some();
    Ok(Json(serde_json::json!({
        "model": "28-day moving-average baseline",
        "forecastHorizonDays": HOLDOUT_DAYS,
        "backtestHorizonDays": HOLDOUT_DAYS,
        "minimumHistoryDays": TRAINING_DAYS + HOLDOUT_DAYS,
        "historyDaysRequested": history_days,
        "status": if sufficient { "measured" } else { "insufficient_data" },
        "itemsWithEvaluableMape": eligible_items,
        "mapePct": overall_mape,
        "accuracyPct": overall_mape.map(|value| (Decimal::from(100u32) - value).max(Decimal::ZERO)),
        "targetAccuracyPct": 92,
        "targetMet": overall_mape.is_some_and(|value| Decimal::from(100u32) - value >= Decimal::from(92u32)),
        "stockoutRatePct": Value::Null,
        "stockoutMetricStatus": "not_measurable",
        "stockoutMetricReason": "unmet demand and stockout attempts are not recorded; outbound ledger alone cannot measure the stockout rate",
        "items": items
    })))
}

fn classify_stock(current: Decimal, safe: Decimal, unit: &str) -> (&'static str, &'static str, String, &'static str) {
    let diff = current - safe;
    if current < safe * Decimal::new(5, 1) {
        (
            "shortage",
            "재고 부족",
            format!("부족분: {diff}{unit}"),
            "재고 하한선 이탈 -> 즉시 추가 발주 필요",
        )
    } else if current > safe * Decimal::from(2u32) {
        (
            "overstock",
            "재고 과다",
            format!("초과분: +{diff}{unit}"),
            "창고 점유율 초과 -> 출하량 증대 필요",
        )
    } else {
        ("safe", "안전 재고", "적정 범위 유지".to_string(), "수요 안정적 -> 현 유통 계획 유지")
    }
}

fn evaluate_moving_average(values: &[Decimal], window: usize, horizon: usize) -> Option<(Decimal, Option<Decimal>, usize)> {
    if window == 0 || horizon == 0 || values.len() < window + horizon {
        return None;
    }
    let test_start = values.len() - horizon;
    let mut percentage_error_sum = Decimal::ZERO;
    let mut observed_days = 0_usize;
    for index in test_start..values.len() {
        let training_start = index.saturating_sub(window);
        let training = &values[training_start..index];
        if training.len() != window { return None; }
        let predicted = training.iter().copied().sum::<Decimal>() / Decimal::from(window as u64);
        let actual = values[index];
        if actual > Decimal::ZERO {
            percentage_error_sum += (predicted - actual).abs() / actual;
            observed_days += 1;
        }
    }
    let recent = &values[values.len() - window..];
    let daily_baseline = recent.iter().copied().sum::<Decimal>() / Decimal::from(window as u64);
    let horizon_total = daily_baseline * Decimal::from(horizon as u64);
    let mape = if observed_days == 0 { None } else {
        Some(percentage_error_sum * Decimal::from(100u32) / Decimal::from(observed_days as u64))
    };
    Some((horizon_total, mape, observed_days))
}

fn next_delivery_state(current: &str) -> Result<(&'static str, &'static str, bool), ()> {
    match current {
        "AT_PICKUP" => Ok(("IN_TRANSIT", "허브터미널 이동중", false)),
        "IN_TRANSIT" => Ok(("OUT_FOR_DELIVERY", "배달출발", false)),
        "OUT_FOR_DELIVERY" => Ok(("DELIVERED", "배송완료", true)),
        _ => Err(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{calculate_zone_occupancy, classify_stock, delivery_warehouse_scope, evaluate_moving_average, next_delivery_state, AuthenticatedUser};
    use rust_decimal::Decimal;

    #[test]
    fn stock_status_respects_shortage_and_overstock_boundaries() {
        assert_eq!(classify_stock(Decimal::from(49), Decimal::from(100), "톤").0, "shortage");
        assert_eq!(classify_stock(Decimal::from(50), Decimal::from(100), "톤").0, "safe");
        assert_eq!(classify_stock(Decimal::from(200), Decimal::from(100), "톤").0, "safe");
        assert_eq!(classify_stock(Decimal::from(201), Decimal::from(100), "톤").0, "overstock");
    }

    #[test]
    fn delivery_progression_stops_after_delivered() {
        assert_eq!(next_delivery_state("AT_PICKUP").unwrap().0, "IN_TRANSIT");
        assert_eq!(next_delivery_state("IN_TRANSIT").unwrap().0, "OUT_FOR_DELIVERY");
        assert_eq!(next_delivery_state("OUT_FOR_DELIVERY").unwrap().0, "DELIVERED");
        assert!(next_delivery_state("DELIVERED").is_err());
    }

    #[test]
    fn delivery_scope_never_treats_unassigned_users_as_global() {
        let manager_without_warehouse = AuthenticatedUser {
            id: "manager-1".to_string(),
            email: "manager@example.test".to_string(),
            role: "관리자".to_string(),
            status: "APPROVED".to_string(),
            warehouse_id: None,
        };
        assert!(delivery_warehouse_scope(&manager_without_warehouse).is_err());

        let worker = AuthenticatedUser {
            warehouse_id: Some("wh_alpha".to_string()),
            ..manager_without_warehouse.clone()
        };
        assert_eq!(delivery_warehouse_scope(&worker).unwrap().as_deref(), Some("wh_alpha"));

        let server_admin = AuthenticatedUser {
            role: "서버 관리자".to_string(),
            warehouse_id: Some("wh_alpha".to_string()),
            ..manager_without_warehouse
        };
        assert_eq!(delivery_warehouse_scope(&server_admin).unwrap(), None);
    }

    #[test]
    fn zone_occupancy_handles_empty_capacity_and_overflow() {
        assert_eq!(calculate_zone_occupancy(Decimal::ZERO, Decimal::from(100)), (1.0, "empty", "비어 있음"));
        let (empty_ratio, state, _) = calculate_zone_occupancy(Decimal::from(25), Decimal::from(100));
        assert!((empty_ratio - 0.75).abs() < f64::EPSILON);
        assert_eq!(state, "normal");
        assert_eq!(calculate_zone_occupancy(Decimal::from(120), Decimal::from(100)), (0.0, "warning", "용량 초과"));
        assert_eq!(calculate_zone_occupancy(Decimal::from(3), Decimal::ZERO), (0.0, "warning", "용량 초과"));
    }

    #[test]
    fn moving_average_backtest_requires_history_and_measures_nonzero_days() {
        let mut values = vec![Decimal::from(10); 28];
        values.extend(vec![Decimal::from(10); 7]);
        let (next_week, mape, sample_days) = evaluate_moving_average(&values, 28, 7).unwrap();
        assert_eq!(next_week, Decimal::from(70));
        assert_eq!(mape, Some(Decimal::ZERO));
        assert_eq!(sample_days, 7);
        assert!(evaluate_moving_average(&values[..34], 28, 7).is_none());

        let mut changing = vec![Decimal::from(10); 28];
        changing.extend(vec![Decimal::from(20); 7]);
        let (_, changing_mape, changing_samples) = evaluate_moving_average(&changing, 28, 7).unwrap();
        assert!(changing_mape.is_some_and(|value| value > Decimal::ZERO && value < Decimal::from(100u32)));
        assert_eq!(changing_samples, 7);

        let zero_history = vec![Decimal::ZERO; 35];
        let (forecast, no_mape, no_samples) = evaluate_moving_average(&zero_history, 28, 7).unwrap();
        assert_eq!(forecast, Decimal::ZERO);
        assert_eq!(no_mape, None);
        assert_eq!(no_samples, 0);
    }
}

fn database_not_configured() -> (StatusCode, String) {
    (StatusCode::SERVICE_UNAVAILABLE, "DATABASE_URL is not configured".to_string())
}

fn internal_error(error: sqlx::Error) -> (StatusCode, String) {
    tracing::error!(%error, "database request failed");
    (StatusCode::INTERNAL_SERVER_ERROR, "database request failed".to_string())
}

async fn users_action(
    State(state): State<AppState>,
    auth: Option<axum::Extension<AuthenticatedUser>>,
    Json(input): Json<UserAction>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.clone().ok_or_else(database_not_configured)?;
    match input.action.as_str() {
        "signup" => {
            let email = required(input.email, "email")?;
            let password = required(input.password, "password")?;
            let name = required(input.name, "name")?;
            let role = input.role.unwrap_or_else(|| "창고지기".to_string());
            if role != "관리자" && role != "창고지기" {
                return Err((StatusCode::BAD_REQUEST, "가입할 수 없는 역할입니다.".to_string()));
            }
            let username = input.username.clone().unwrap_or_else(|| email.split('@').next().unwrap_or("user").to_string());
            let admin_email = if role == "관리자" { None } else { input.admin_email };
            if role != "관리자" && admin_email.is_none() {
                return Err((StatusCode::BAD_REQUEST, "창고 관리자 이메일이 필요합니다.".to_string()));
            }
            let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1 OR username = $2")
                .bind(&email).bind(&username).fetch_one(&db).await.map_err(internal_error)?;
            if existing > 0 {
                return Err((StatusCode::BAD_REQUEST, "이미 존재하는 이메일입니다.".to_string()));
            }
            let salt = SaltString::generate(&mut rand::thread_rng());
            let password_hash = Argon2::default().hash_password(password.as_bytes(), &salt)
                .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "비밀번호 해시 생성 실패".to_string()))?
                .to_string();
            let status = if role == "관리자" { "PENDING_ADMIN" } else { "PENDING_WAREHOUSE" };
            let user = sqlx::query_as::<_, UserRecord>(
                "INSERT INTO users (username, email, password_hash, name, role, status, admin_email)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at",
            ).bind(&username).bind(&email).bind(password_hash).bind(name).bind(role).bind(status).bind(admin_email)
            .fetch_one(&db).await.map_err(internal_error)?;
            if user.role == "창고지기" {
                sqlx::query("INSERT INTO warehouse_access_requests (user_email, user_name, admin_email) VALUES ($1, $2, $3)")
                    .bind(&user.email).bind(&user.name).bind(&user.admin_email)
                    .execute(&db).await.map_err(internal_error)?;
            }
            Ok(Json(serde_json::json!({ "success": true, "user": user })))
        }
        "login" => {
            let login = input.username.or(input.email).ok_or_else(|| (StatusCode::BAD_REQUEST, "email이 필요합니다.".to_string()))?;
            let password = required(input.password, "password")?;

            if login == "wjmals" || login == "wjmals@wms-smartstock.ai" {
                let expected_password = env::var("SUPER_ADMIN_PASSWORD").map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "SUPER_ADMIN_PASSWORD is not configured".to_string()))?;
                if password != expected_password {
                    return Err((StatusCode::UNAUTHORIZED, "비밀번호가 일치하지 않습니다.".to_string()));
                }
                let token = create_session_token(&state, "usr_wjmals", "wjmals@wms-smartstock.ai", "서버 관리자", "APPROVED", Some("wh_wjmals".to_string()))?;
                return Ok(Json(serde_json::json!({
                    "success": true,
                    "token": token,
                    "user": {
                        "id": "usr_wjmals",
                        "username": "wjmals",
                        "email": "wjmals@wms-smartstock.ai",
                        "name": "wjmals (총괄/서버 관리자)",
                        "role": "서버 관리자",
                        "status": "APPROVED",
                        "warehouseId": "wh_wjmals",
                        "adminEmail": null,
                        "requestedAdminEmail": null,
                        "createdAt": "2026-09-20T00:00:00Z",
                        "approvedAt": "2026-09-20T00:00:00Z"
                    }
                })));
            }

            // SELECT: id, username(nullable), email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at, password_hash
            let row = sqlx::query_as::<_, (Uuid, Option<String>, String, String, String, String, Option<String>, Option<String>, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>, String)>(
                "SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at, password_hash FROM users WHERE email = $1 OR username = $1",
            ).bind(&login).fetch_optional(&db).await.map_err(internal_error)?
                .ok_or_else(|| (StatusCode::NOT_FOUND, "등록되지 않은 계정입니다.".to_string()))?;
            let verified = PasswordHash::new(&row.11)
                .ok()
                .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
                .unwrap_or(false);
            if !verified {
                return Err((StatusCode::UNAUTHORIZED, "비밀번호가 일치하지 않습니다.".to_string()));
            }
            let token = create_session_token(&state, &row.0.to_string(), &row.2, &row.4, &row.5, row.6.clone())?;
            let display_username = row.1.clone().unwrap_or_else(|| row.2.split('@').next().unwrap_or("user").to_string());
            Ok(Json(serde_json::json!({
                "success": true,
                "token": token,
                "user": {
                    "id": row.0,
                    "username": display_username,
                    "email": row.2,
                    "name": row.3,
                    "role": row.4,
                    "status": row.5,
                    "warehouseId": row.6,
                    "adminEmail": row.7,
                    "requestedAdminEmail": row.8,
                    "createdAt": row.9,
                    "approvedAt": row.10
                }
            })))
        }
        "request_access" => {
            let user = auth.as_ref().ok_or_else(|| (StatusCode::UNAUTHORIZED, "로그인이 필요합니다.".to_string()))?;
            let email = required(input.email, "email")?;
            let admin_email = required(input.admin_email, "adminEmail")?;
            if user.0.email != email || user.0.role != "창고지기" {
                return Err((StatusCode::FORBIDDEN, "본인 창고 접근 요청만 제출할 수 있습니다.".to_string()));
            }
            sqlx::query("UPDATE users SET requested_admin_email = $1 WHERE email = $2")
                .bind(&admin_email).bind(&email).execute(&db).await.map_err(internal_error)?;
            sqlx::query("DELETE FROM warehouse_access_requests WHERE user_email = $1 AND status = 'PENDING'")
                .bind(&email).execute(&db).await.map_err(internal_error)?;
            sqlx::query("INSERT INTO warehouse_access_requests (user_email, user_name, admin_email) SELECT email, name, $1 FROM users WHERE email = $2")
                .bind(&admin_email).bind(&email).execute(&db).await.map_err(internal_error)?;
            Ok(Json(serde_json::json!({ "success": true, "message": format!("'{}' 관리자에게 권한 요청을 보냈습니다.", admin_email) })))
        }
        "approve_user" => {
            let user = auth.as_ref().ok_or_else(|| (StatusCode::UNAUTHORIZED, "로그인이 필요합니다.".to_string()))?;
            if user.0.role != "관리자" && user.0.role != "서버 관리자" {
                return Err((StatusCode::FORBIDDEN, "관리자만 창고지기를 승인할 수 있습니다.".to_string()));
            }
            let target = required(input.target_email, "targetEmail")?;
            let admin = if user.0.role == "서버 관리자" { required(input.admin_email, "adminEmail")? } else { user.0.email.clone() };
            // 관리자의 실제 warehouse_id 조회
            let warehouse_id = if user.0.role == "서버 관리자" {
                let wid = sqlx::query_scalar::<_, Option<String>>("SELECT warehouse_id FROM users WHERE email = $1")
                    .bind(&admin).fetch_optional(&db).await.map_err(internal_error)?;
                wid.flatten().unwrap_or_else(|| format!("wh_{}", admin.split('@').next().unwrap_or("wms")))
            } else {
                user.0.warehouse_id.clone().ok_or_else(|| (StatusCode::FORBIDDEN, "관리자 창고가 배정되지 않았습니다.".to_string()))?
            };
            // 창고가 없으면 생성
            sqlx::query("INSERT INTO warehouses (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING")
                .bind(&warehouse_id).bind(&format!("{} 창고", warehouse_id.trim_start_matches("wh_")))
                .execute(&db).await.map_err(internal_error)?;
            let updated = sqlx::query("UPDATE users SET status = 'APPROVED', admin_email = $1, warehouse_id = $2, approved_at = now(), requested_admin_email = NULL WHERE email = $3 AND role = '창고지기' AND status = 'PENDING_WAREHOUSE' AND ($1 = 'wjmals@wms-smartstock.ai' OR admin_email = $1)")
                .bind(&admin).bind(&warehouse_id).bind(&target).execute(&db).await.map_err(internal_error)?;
            if updated.rows_affected() == 0 {
                return Err((StatusCode::NOT_FOUND, "승인 대기 중인 담당 창고지기를 찾을 수 없습니다.".to_string()));
            }
            sqlx::query("UPDATE warehouse_access_requests SET status = 'APPROVED' WHERE user_email = $1 AND status = 'PENDING'")
                .bind(&target).execute(&db).await.map_err(internal_error)?;
            Ok(Json(serde_json::json!({ "success": true, "targetEmail": target, "warehouseId": warehouse_id })))
        }
        "approve_admin" => {
            let user = auth.as_ref().ok_or_else(|| (StatusCode::UNAUTHORIZED, "로그인이 필요합니다.".to_string()))?;
            if user.0.role != "서버 관리자" {
                return Err((StatusCode::FORBIDDEN, "서버 관리자만 관리자를 승인할 수 있습니다.".to_string()));
            }
            // 서버 관리자가 창고 관리자 신청을 승인
            let target = required(input.target_email, "targetEmail")?;
            let name_part = target.split('@').next().unwrap_or("wms");
            let warehouse_id = format!("wh_{}", name_part);
            let warehouse_name = format!("{} 창고", name_part);
            // 창고가 없으면 먼저 생성
            sqlx::query(
                "INSERT INTO warehouses (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING"
            ).bind(&warehouse_id).bind(&warehouse_name).execute(&db).await.map_err(internal_error)?;
            let rows = sqlx::query(
                "UPDATE users SET role = '관리자', status = 'APPROVED', warehouse_id = $1, approved_at = now() WHERE email = $2"
            ).bind(&warehouse_id).bind(&target).execute(&db).await.map_err(internal_error)?;
            if rows.rows_affected() == 0 {
                return Err((StatusCode::NOT_FOUND, "사용자를 찾을 수 없습니다.".to_string()));
            }
            Ok(Json(serde_json::json!({ "success": true, "targetEmail": target, "warehouseId": warehouse_id })))
        }
        "invite_user" => {
            let user = auth.as_ref().ok_or_else(|| (StatusCode::UNAUTHORIZED, "로그인이 필요합니다.".to_string()))?;
            if user.0.role != "관리자" && user.0.role != "서버 관리자" {
                return Err((StatusCode::FORBIDDEN, "관리자만 창고지기를 초대할 수 있습니다.".to_string()));
            }
            // Approve a previously registered keeper for this manager's warehouse.
            let target = required(input.target_email, "targetEmail")?;
            let admin = if user.0.role == "서버 관리자" { required(input.admin_email, "adminEmail")? } else { user.0.email.clone() };
            if target == "wjmals" || target == "wjmals@wms-smartstock.ai" {
                return Err((StatusCode::FORBIDDEN, "서버 관리자 계정은 초대할 수 없습니다.".to_string()));
            }
            let warehouse_id = {
                let row = sqlx::query_scalar::<_, Option<String>>("SELECT warehouse_id FROM users WHERE email = $1")
                    .bind(&admin).fetch_optional(&db).await.map_err(internal_error)?;
                row.flatten().unwrap_or_else(|| format!("wh_{}", admin.split('@').next().unwrap_or("wms")))
            };
            // 이미 존재하면 업데이트, 없으면 새로 생성
            let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
                .bind(&target).fetch_one(&db).await.map_err(internal_error)?;
            if exists > 0 {
                let result = sqlx::query("UPDATE users SET status = 'APPROVED', admin_email = $1, warehouse_id = $2, approved_at = now() WHERE email = $3 AND role = '창고지기' AND status = 'PENDING_WAREHOUSE' AND admin_email = $1")
                    .bind(&admin).bind(&warehouse_id).bind(&target).execute(&db).await.map_err(internal_error)?;
                if result.rows_affected() == 0 {
                    return Err((StatusCode::FORBIDDEN, "창고지기 계정만 이 창고에 초대할 수 있습니다.".to_string()));
                }
            } else {
                return Err((StatusCode::NOT_FOUND, "먼저 창고지기로 가입한 계정만 초대할 수 있습니다.".to_string()));
            }
            Ok(Json(serde_json::json!({ "success": true, "message": format!("'{}' 창고지기가 이 창고로 승인 등록되었습니다.", target) })))
        }
        "delete_user" => {
            let user = auth.as_ref().ok_or_else(|| (StatusCode::UNAUTHORIZED, "로그인이 필요합니다.".to_string()))?;
            let target = required(input.target_email, "targetEmail")?;
            if target == "wjmals" || target == "wjmals@wms-smartstock.ai" {
                return Err((StatusCode::FORBIDDEN, "총괄 서버 관리자 계정은 삭제할 수 없습니다.".to_string()));
            }
            let result = if user.0.role == "서버 관리자" {
                sqlx::query("DELETE FROM users WHERE email = $1").bind(&target).execute(&db).await.map_err(internal_error)?
            } else if user.0.role == "관리자" {
                sqlx::query("DELETE FROM users WHERE email = $1 AND admin_email = $2 AND role = '창고지기'")
                    .bind(&target).bind(&user.0.email).execute(&db).await.map_err(internal_error)?
            } else {
                return Err((StatusCode::FORBIDDEN, "관리자 권한이 필요합니다.".to_string()));
            };
            if result.rows_affected() == 0 {
                return Err((StatusCode::NOT_FOUND, "사용자를 찾을 수 없습니다.".to_string()));
            }
            Ok(Json(serde_json::json!({ "success": true, "deletedEmail": target })))
        }
        _ => Err((StatusCode::BAD_REQUEST, "유효하지 않은 요청입니다.".to_string())),
    }
}

async fn get_users(
    State(state): State<AppState>,
    Query(query): Query<UserQuery>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let action = query.action.unwrap_or_else(|| "list".to_string());
    if action == "get_user" {
        let email = required(query.email, "email")?;
        if user.role != "서버 관리자" && user.email != email && user.id != email {
            return Err((StatusCode::FORBIDDEN, "본인 계정 정보만 조회할 수 있습니다.".to_string()));
        }
        if user.role == "서버 관리자" && (email == "wjmals" || email == user.email) {
            return Ok(Json(serde_json::json!({
                "id": user.id,
                "username": "wjmals",
                "email": user.email,
                "name": "wjmals (총괄/서버 관리자)",
                "role": "서버 관리자",
                "status": "APPROVED",
                "warehouseId": user.warehouse_id,
                "adminEmail": null,
                "requestedAdminEmail": null,
                "createdAt": "2026-09-20T00:00:00Z",
                "approvedAt": "2026-09-20T00:00:00Z"
            })));
        }
        let user = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users WHERE email = $1 OR username = $1")
            .bind(email).fetch_optional(&db).await.map_err(internal_error)?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "사용자를 찾을 수 없습니다.".to_string()))?;
        return Ok(Json(serde_json::to_value(user).unwrap_or(Value::Null)));
    }
    if action == "list_requests" {
        let admin = required(query.admin_email, "adminEmail")?;
        if user.role != "서버 관리자" && (user.role != "관리자" || user.email != admin) {
            return Err((StatusCode::FORBIDDEN, "본인 창고 요청만 조회할 수 있습니다.".to_string()));
        }
        let requests = sqlx::query_as::<_, (Uuid, String, String, DateTime<Utc>)>(
            "SELECT id, user_email, user_name, requested_at FROM warehouse_access_requests WHERE admin_email = $1 AND status = 'PENDING' ORDER BY requested_at",
        ).bind(&admin).fetch_all(&db).await.map_err(internal_error)?;
        let pending = requests.into_iter().map(|r| serde_json::json!({ "id": r.0, "userEmail": r.1, "userName": r.2, "requestedAt": r.3 })).collect::<Vec<_>>();
        let members = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users WHERE admin_email = $1 AND status = 'APPROVED' ORDER BY name")
            .bind(admin).fetch_all(&db).await.map_err(internal_error)?;
        return Ok(Json(serde_json::json!({ "pendingRequests": pending, "teamMembers": members })));
    }
    if action == "list_admin_requests" {
        if user.role != "서버 관리자" {
            return Err((StatusCode::FORBIDDEN, "서버 관리자 권한이 필요합니다.".to_string()));
        }
        let users = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users WHERE (role = '관리자' AND status <> 'APPROVED') OR status = 'PENDING_ADMIN' ORDER BY created_at")
            .fetch_all(&db).await.map_err(internal_error)?;
        return Ok(Json(serde_json::to_value(users).unwrap_or(Value::Null)));
    }
    if user.role != "서버 관리자" {
        return Err((StatusCode::FORBIDDEN, "사용자 전체 목록 조회 권한이 없습니다.".to_string()));
    }
    let users = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users ORDER BY created_at")
        .fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(serde_json::to_value(users).unwrap_or(Value::Null)))
}

async fn delete_user(
    State(state): State<AppState>,
    Query(query): Query<UserQuery>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if user.role != "서버 관리자" {
        return Err((StatusCode::FORBIDDEN, "서버 관리자만 사용자를 삭제할 수 있습니다.".to_string()));
    }
    let db = state.db.ok_or_else(database_not_configured)?;
    let email = required(query.email, "email")?;
    let result = sqlx::query("DELETE FROM users WHERE email = $1").bind(&email).execute(&db).await.map_err(internal_error)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "사용자를 찾을 수 없습니다.".to_string()));
    }
    Ok(Json(serde_json::json!({ "success": true, "deletedEmail": email })))
}

async fn list_zones(
    State(state): State<AppState>,
    Query(query): Query<ZoneQuery>,
) -> Result<Json<Vec<ZoneRecord>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, Value, Decimal, String, DateTime<Utc>)>(
        "SELECT id,warehouse_id,name,state,state_label,temp,items,capacity,capacity_unit,updated_at FROM warehouse_zones WHERE warehouse_id=$1 ORDER BY id",
    ).bind(&warehouse_id).fetch_all(&db).await.map_err(internal_error)?;
    let inventory = sqlx::query_as::<_, (String, Decimal, String)>("SELECT name,current,unit FROM inventory_items WHERE warehouse_id=$1 AND archived_at IS NULL")
        .bind(&warehouse_id).fetch_all(&db).await.map_err(internal_error)?;
    let zones = rows.into_iter().map(|row| {
        let assigned = row.6.as_array().cloned().unwrap_or_default().into_iter().filter_map(|value| value.as_str().map(str::to_owned)).collect::<Vec<_>>();
        let current_stock_sum = inventory.iter().filter(|(name, _, unit)| *unit == row.8 && assigned.iter().any(|item| item.eq_ignore_ascii_case(name))).map(|(_, current, _)| *current).sum::<Decimal>();
        let capacity = row.7.max(Decimal::ZERO);
        let (empty_ratio, state, state_label) = calculate_zone_occupancy(current_stock_sum, capacity);
        ZoneRecord { id: row.0, warehouse_id: row.1, name: row.2, state: state.to_string(), state_label: state_label.to_string(), temp: row.5, items: row.6, capacity, capacity_unit: row.8, current_stock_sum, empty_ratio, updated_at: row.9 }
    }).collect::<Vec<_>>();
    Ok(Json(zones))
}

async fn save_zone(
    State(state): State<AppState>,
    Json(input): Json<SaveZone>,
) -> Result<Json<ZoneRecord>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    if input.id.trim().is_empty() || input.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "id와 name은 필수입니다.".to_string()));
    }
    let zone = sqlx::query_as::<_, ZoneRecord>(
           "INSERT INTO warehouse_zones (id,warehouse_id,name,state,state_label,temp,items,capacity,capacity_unit)
            VALUES ($1,$2,$3,COALESCE($4,'normal'),COALESCE($5,'정상'),COALESCE($6,'-20°C'),COALESCE($7,'[]'::jsonb),COALESCE($8,100000),COALESCE($9,'톤'))
            ON CONFLICT (warehouse_id,id) DO UPDATE SET name=EXCLUDED.name,state=EXCLUDED.state,state_label=EXCLUDED.state_label,temp=EXCLUDED.temp,items=EXCLUDED.items,capacity=EXCLUDED.capacity,capacity_unit=EXCLUDED.capacity_unit,updated_at=now()
            RETURNING id,warehouse_id,name,state,state_label,temp,items,capacity,capacity_unit,0::numeric AS current_stock_sum,1.0::float8 AS empty_ratio,updated_at",
        ).bind(input.id).bind(input.warehouse_id).bind(input.name).bind(input.state).bind(input.state_label).bind(input.temp).bind(input.items).bind(input.capacity).bind(input.capacity_unit)
    .fetch_one(&db).await.map_err(internal_error)?;
    Ok(Json(zone))
}

async fn delete_zone(
    State(state): State<AppState>,
    Query(query): Query<DeleteZoneQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let result = sqlx::query("DELETE FROM warehouse_zones WHERE id = $1 AND warehouse_id = $2")
        .bind(&query.id).bind(&query.warehouse_id).execute(&db).await.map_err(internal_error)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "해당 구역을 찾을 수 없습니다.".to_string()));
    }
    Ok(Json(serde_json::json!({ "success": true, "deletedId": query.id })))
}

async fn list_references(
    State(state): State<AppState>,
    Query(query): Query<ReferenceQuery>,
) -> Result<Json<Vec<ItemReference>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let references = sqlx::query_as::<_, ItemReference>(
        "SELECT id, warehouse_id, name, description, thumbnail, created_at FROM item_references WHERE warehouse_id = $1 ORDER BY created_at DESC",
    ).bind(warehouse_id).fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(references))
}

async fn create_reference(
    State(state): State<AppState>,
    Json(input): Json<CreateReference>,
) -> Result<(StatusCode, Json<ItemReference>), (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    if input.image.is_empty() || input.name.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "이미지와 품목명은 필수입니다.".to_string()));
    }
    if input.image.len() > 50_000 {
        return Err((StatusCode::PAYLOAD_TOO_LARGE, "이미지는 압축 후 50,000자 이하여야 합니다.".to_string()));
    }
    let reference = sqlx::query_as::<_, ItemReference>(
        "INSERT INTO item_references (warehouse_id, name, description, thumbnail)
         VALUES ($1, $2, $3, $4)
         RETURNING id, warehouse_id, name, description, thumbnail, created_at",
    ).bind(input.warehouse_id).bind(input.name.trim()).bind(input.description.unwrap_or_default()).bind(input.image)
    .fetch_one(&db).await.map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(reference)))
}

async fn delete_reference(
    State(state): State<AppState>,
    Query(query): Query<ReferenceQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let id = query.id.ok_or_else(|| (StatusCode::BAD_REQUEST, "id가 필요합니다.".to_string()))?;
    let warehouse_id = query.warehouse_id.ok_or_else(|| (StatusCode::BAD_REQUEST, "warehouseId가 필요합니다.".to_string()))?;
    let result = sqlx::query("DELETE FROM item_references WHERE id = $1 AND warehouse_id = $2")
        .bind(id).bind(warehouse_id).execute(&db).await.map_err(internal_error)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "학습 데이터를 찾을 수 없습니다.".to_string()));
    }
    Ok(Json(serde_json::json!({ "success": true, "deletedId": id })))
}

async fn import_references(
    State(state): State<AppState>,
    Json(input): Json<ImportReferences>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    if input.items.is_empty() || input.items.len() > 500 {
        return Err((StatusCode::BAD_REQUEST, "한 번에 1~500개 레퍼런스를 가져올 수 있습니다.".to_string()));
    }
    let mut transaction = db.begin().await.map_err(internal_error)?;
    let mut inserted = 0_usize;
    for item in input.items {
        if item.name.trim().is_empty() || item.image.is_empty() || item.image.len() > 50_000 {
            return Err((StatusCode::BAD_REQUEST, "품목명과 이미지가 필요하며 이미지당 최대 50,000자까지 등록할 수 있습니다.".to_string()));
        }
        sqlx::query("INSERT INTO item_references (warehouse_id, name, description, thumbnail) VALUES ($1, $2, $3, $4)")
            .bind(&input.warehouse_id).bind(item.name.trim()).bind(item.description.unwrap_or_default()).bind(item.image)
            .execute(&mut *transaction).await.map_err(internal_error)?;
        inserted += 1;
    }
    transaction.commit().await.map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(serde_json::json!({ "success": true, "imported": inserted }))))
}

async fn list_delivery(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<Vec<DeliveryRecord>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_scope = delivery_warehouse_scope(&user)?;
    let rows = sqlx::query_as::<_, DeliveryRecord>(
        "SELECT id, warehouse_id, invoice_no, carrier_code, carrier_name, item_name, sender_name, receiver_name, status, status_code, current_location, delivered_at, tracking_details, created_at, updated_at
         FROM delivery_tracking WHERE ($1::text IS NULL OR warehouse_id = $1) AND (delivered_at IS NULL OR delivered_at > now() - interval '24 hours') ORDER BY created_at DESC",
    ).bind(warehouse_scope).fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(rows))
}

fn delivery_warehouse_scope(user: &AuthenticatedUser) -> Result<Option<String>, (StatusCode, String)> {
    if user.role == "서버 관리자" {
        Ok(None)
    } else {
        user.warehouse_id.clone().map(Some)
            .ok_or_else(|| (StatusCode::FORBIDDEN, "계정에 배정된 창고가 없습니다.".to_string()))
    }
}

async fn create_delivery(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<CreateDelivery>,
) -> Result<(StatusCode, Json<DeliveryRecord>), (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let invoice = input.invoice_no.chars().filter(|c| c.is_ascii_digit()).collect::<String>();
    if invoice.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "운송장 번호를 입력해주세요.".to_string()));
    }
    let warehouse_id = if user.role == "서버 관리자" {
        input.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string())
    } else {
        user.warehouse_id.ok_or_else(|| (StatusCode::FORBIDDEN, "계정에 배정된 창고가 없습니다.".to_string()))?
    };
    let row = sqlx::query_as::<_, DeliveryRecord>(
        "INSERT INTO delivery_tracking (warehouse_id, invoice_no, carrier_code, carrier_name, item_name, sender_name, receiver_name, status, status_code, current_location)
         VALUES ($1, $2, COALESCE($3, '04'), COALESCE($4, 'CJ대한통운'), COALESCE($5, '물류 출고건'), COALESCE($6, 'WMS 스마트 물류센터'), COALESCE($7, '고객님'), '상품인수', 'AT_PICKUP', '배송 접수처')
         RETURNING id, warehouse_id, invoice_no, carrier_code, carrier_name, item_name, sender_name, receiver_name, status, status_code, current_location, delivered_at, tracking_details, created_at, updated_at",
    ).bind(warehouse_id).bind(invoice).bind(input.carrier_code).bind(input.carrier_name).bind(input.item_name).bind(input.sender_name).bind(input.receiver_name)
    .fetch_one(&db).await.map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn delete_delivery(
    State(state): State<AppState>,
    Query(query): Query<DeliveryQuery>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let id = query.id.ok_or_else(|| (StatusCode::BAD_REQUEST, "id가 필요합니다.".to_string()))?;
    let warehouse_scope = delivery_warehouse_scope(&user)?;
    let result = sqlx::query("DELETE FROM delivery_tracking WHERE id = $1 AND ($2::text IS NULL OR warehouse_id = $2)")
        .bind(id).bind(warehouse_scope).execute(&db).await.map_err(internal_error)?;
    if result.rows_affected() == 0 { return Err((StatusCode::NOT_FOUND, "배송 항목을 찾을 수 없습니다.".to_string())); }
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn advance_delivery(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(query): Json<DeliveryQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let id = query.id.ok_or_else(|| (StatusCode::BAD_REQUEST, "id가 필요합니다.".to_string()))?;
    let warehouse_id = delivery_warehouse_scope(&user)?;
    let current = sqlx::query_as::<_, (String, String)>("SELECT status_code, status FROM delivery_tracking WHERE id = $1 AND ($2::text IS NULL OR warehouse_id = $2)")
        .bind(id).bind(&warehouse_id).fetch_optional(&db).await.map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "배송 항목 없음".to_string()))?;
    let (next_code, next_status, delivered) = next_delivery_state(&current.0)
        .map_err(|_| (StatusCode::CONFLICT, "이미 배송 완료된 항목은 상태를 변경할 수 없습니다.".to_string()))?;
    sqlx::query("UPDATE delivery_tracking SET status_code = $1, status = $2, current_location = $3, delivered_at = CASE WHEN $4 THEN now() ELSE NULL END, updated_at = now() WHERE id = $5 AND ($6::text IS NULL OR warehouse_id = $6)")
        .bind(next_code).bind(next_status).bind(if delivered { "고객 지정장소 (문 앞 배송완료)" } else { "배송 이동 중" }).bind(delivered).bind(id).bind(warehouse_id)
        .execute(&db).await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "success": true, "status": next_status, "statusCode": next_code })))
}

async fn track_delivery(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<TrackDeliveryInput>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = delivery_warehouse_scope(&user)?;
    let delivery = sqlx::query_as::<_, (String, String, String)>(
        "SELECT carrier_code, invoice_no, warehouse_id FROM delivery_tracking WHERE id = $1 AND ($2::text IS NULL OR warehouse_id = $2)",
    ).bind(input.id).bind(warehouse_id).fetch_optional(&db).await.map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "배송 항목을 찾을 수 없습니다.".to_string()))?;

    // 택배사 코드 → apis.tracker.delivery carrier ID 매핑
    let carrier_id = match delivery.0.as_str() {
        "01" => "kr.epost",
        "04" => "kr.cjlogistics",
        "05" => "kr.hanjin",
        "06" => "kr.logen",
        "08" => "kr.lotte",
        "11" => "kr.ilyanglogis",
        "23" => "kr.kdexp",
        "22" => "kr.daesin",
        "32" => "kr.hdexp",
        "24" => "kr.cvsnet",
        _ => "kr.cjlogistics",
    };

    let url = format!("https://apis.tracker.delivery/carriers/{}/tracks/{}", carrier_id, delivery.1);
    let response = reqwest::Client::new()
        .get(&url)
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(8))
        .send().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("배송 조회 연결 실패: {}", e)))?;

    if !response.status().is_success() {
        return Err((StatusCode::BAD_GATEWAY, format!("배송사 조회 실패 ({})", response.status())));
    }

    let body: Value = response.json().await
        .map_err(|e| (StatusCode::BAD_GATEWAY, format!("응답 파싱 실패: {}", e)))?;

    // apis.tracker.delivery 응답 파싱
    let state_id = body.get("state").and_then(|s| s.get("id")).and_then(Value::as_str).unwrap_or("unknown");
    let (status_code, is_delivered) = match state_id {
        "delivered" => ("DELIVERED", true),
        "out_for_delivery" => ("OUT_FOR_DELIVERY", false),
        "at_pickup" | "information_received" => ("AT_PICKUP", false),
        _ => ("IN_TRANSIT", false),
    };
    let status_label = body.get("state").and_then(|s| s.get("text")).and_then(Value::as_str)
        .unwrap_or(match status_code { "DELIVERED" => "배송완료", "OUT_FOR_DELIVERY" => "배달출발", "AT_PICKUP" => "상품인수", _ => "이동중" })
        .to_string();

    let progresses = body.get("progresses").and_then(Value::as_array).cloned().unwrap_or_default();
    let details: Vec<Value> = progresses.iter().map(|p| {
        let time = p.get("time").and_then(Value::as_str).unwrap_or("").to_string();
        let location = p.get("location").and_then(|l| l.get("name")).and_then(Value::as_str).unwrap_or("").to_string();
        let kind = p.get("description").and_then(Value::as_str)
            .or_else(|| p.get("status").and_then(|s| s.get("text")).and_then(Value::as_str))
            .unwrap_or("").to_string();
        serde_json::json!({ "time": time, "where": location, "kind": kind })
    }).collect();

    let current_location = details.last()
        .and_then(|d| d.get("where")).and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| {
            let kind = details.last().and_then(|d| d.get("kind")).and_then(Value::as_str).unwrap_or("");
            if kind.is_empty() { s.to_string() } else { format!("{} ({})", s, kind) }
        })
        .unwrap_or_else(|| status_label.clone());

    let details_json = Value::Array(details);
    let result = sqlx::query("UPDATE delivery_tracking SET tracking_details = $1, current_location = $2, status = $3, status_code = $4, delivered_at = CASE WHEN $5 THEN COALESCE(delivered_at, now()) ELSE NULL END, updated_at = now() WHERE id = $6 AND warehouse_id = $7")
        .bind(&details_json).bind(&current_location).bind(&status_label).bind(status_code).bind(is_delivered).bind(input.id).bind(&delivery.2)
        .execute(&db).await.map_err(internal_error)?;

    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "배송 항목을 찾을 수 없습니다.".to_string()));
    }
    Ok(Json(serde_json::json!({
        "success": true,
        "status": status_label,
        "statusCode": status_code,
        "currentLocation": current_location,
        "trackingDetails": details_json,
        "updatedAt": Utc::now()
    })))
}

fn calculate_zone_occupancy(current_stock: Decimal, capacity: Decimal) -> (f64, &'static str, &'static str) {
    let capacity = capacity.max(Decimal::ZERO);
    let current_stock = current_stock.max(Decimal::ZERO);
    let empty_ratio = if capacity.is_zero() {
        if current_stock.is_zero() { 1.0 } else { 0.0 }
    } else {
        (1.0 - current_stock.to_f64().unwrap_or(0.0) / capacity.to_f64().unwrap_or(1.0)).clamp(0.0, 1.0)
    };
    let (state, label) = if current_stock.is_zero() {
        ("empty", "비어 있음")
    } else if current_stock > capacity {
        ("warning", "용량 초과")
    } else {
        ("normal", "정상")
    };
    (empty_ratio, state, label)
}

async fn list_monitor_logs(
    State(state): State<AppState>,
    Query(query): Query<ZoneQuery>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let rows = sqlx::query_as::<_, (Uuid, String, String, String, String, Decimal, String, i32, String, String, Option<String>, DateTime<Utc>)>(
        "SELECT id, camera_url, item_name, status, status_label, estimated_quantity, unit, confidence, recommendation, reason, image_snapshot, analyzed_at
         FROM monitor_logs WHERE warehouse_id = $1 ORDER BY analyzed_at DESC LIMIT 50",
    ).bind(warehouse_id).fetch_all(&db).await.map_err(internal_error)?;
    let values = rows.into_iter().map(|row| serde_json::json!({
        "id": row.0, "camera_url": row.1, "item_name": row.2, "status": row.3, "status_label": row.4,
        "estimated_quantity": row.5, "unit": row.6, "confidence": row.7, "recommendation": row.8,
        "reason": row.9, "image_snapshot": row.10, "analyzed_at": row.11
    })).collect();
    Ok(Json(values))
}

async fn analyze_monitor_image(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<MonitorInput>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let api_key = env::var("GROQ_API_KEY").map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "GROQ_API_KEY is not configured".to_string()))?;
    let vision_model = env::var("GROQ_VISION_MODEL").unwrap_or_else(|_| "qwen/qwen3.8-27b".to_string());
    let warehouse_id = if user.role == "서버 관리자" { input.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string()) }
        else { user.warehouse_id.clone().ok_or_else(|| (StatusCode::FORBIDDEN, "계정에 배정된 창고가 없습니다.".to_string()))? };
    let image_url = if input.image.starts_with("data:") { input.image.clone() } else { format!("data:image/jpeg;base64,{}", input.image) };
    let references = if let Some(item_name) = input.item_name.as_deref() {
        let matching = sqlx::query_as::<_, (String, String, String)>(
            "SELECT name, description, thumbnail FROM item_references WHERE warehouse_id = $1 AND lower(name) = lower($2) ORDER BY created_at DESC LIMIT 3",
        )
        .bind(&warehouse_id)
        .bind(item_name)
        .fetch_all(&db)
        .await
        .map_err(internal_error)?;
        if matching.is_empty() {
            sqlx::query_as::<_, (String, String, String)>(
                "SELECT name, description, thumbnail FROM item_references WHERE warehouse_id = $1 ORDER BY created_at DESC LIMIT 3",
            )
            .bind(&warehouse_id)
            .fetch_all(&db)
            .await
            .map_err(internal_error)?
        } else {
            matching
        }
    } else {
        sqlx::query_as::<_, (String, String, String)>(
            "SELECT name, description, thumbnail FROM item_references WHERE warehouse_id = $1 ORDER BY created_at DESC LIMIT 3",
        )
        .bind(&warehouse_id)
        .fetch_all(&db)
        .await
        .map_err(internal_error)?
    };
    let expected_unit = if let Some(item_name) = input.item_name.as_deref() {
        sqlx::query_as::<_, (String, Option<String>)>("SELECT unit,package_unit FROM inventory_items WHERE warehouse_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1")
            .bind(&warehouse_id).bind(item_name).fetch_optional(&db).await.map_err(internal_error)?
    } else { None };
    let unit_instruction = expected_unit.as_ref().map(|(unit, package_unit)| format!(
        "기존 재고 품목 단위 제약: 기준 단위는 '{}', 등록된 포장 단위는 '{}'. 이미지에서 수량을 판독할 수 있더라도 unit 필드에는 이 둘 중 하나만 반환하세요. 해당 단위로 신뢰성 있게 환산할 수 없으면 추정 수량을 억지로 만들지 말고 낮은 confidence와 사유를 반환하세요.",
        unit, package_unit.as_deref().unwrap_or("없음")
    )).unwrap_or_else(|| "단위는 이미지에서 확인 가능한 명확한 단위를 사용하세요.".to_string());
    let prompt = format!("당신은 창고 재고 관리 AI입니다. 현재 이미지는 실물 재고 참고 이미지이며, 식별 가능한 사실만 분석하고 JSON만 반환하세요. 아래 레퍼런스 이미지는 이번 분석의 참고 자료일 뿐 학습이나 실측 보증이 아닙니다. 우선 품목: {}. {} 반환 필드: itemName, estimatedQuantity (0 이상 숫자), unit, status(shortage|safe|overstock), statusLabel, confidence(0-100 정수), recommendation, reason. 수량을 확신할 수 없으면 confidence를 낮추고 추정 한계를 reason에 밝히세요.", input.item_name.as_deref().unwrap_or("없음"), unit_instruction);
    let mut content = vec![serde_json::json!({ "type": "text", "text": prompt })];
    for (name, description, thumbnail) in references {
        if thumbnail.trim().is_empty() {
            continue;
        }
        content.push(serde_json::json!({
            "type": "text",
            "text": format!("레퍼런스 품목: {}\n설명: {}", name, description),
        }));
        content.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": thumbnail },
        }));
    }
    content.push(serde_json::json!({
        "type": "text",
        "text": "이제 분석할 현재 카메라 이미지입니다.",
    }));
    content.push(serde_json::json!({
        "type": "image_url",
        "image_url": { "url": image_url },
    }));
    let payload = serde_json::json!({
        "model": vision_model,
        "messages": [{ "role": "user", "content": content }],
        "max_tokens": 512,
        "temperature": 0.1
    });
    let response = reqwest::Client::new().post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(api_key).json(&payload).send().await
        .map_err(|error| (StatusCode::BAD_GATEWAY, error.to_string()))?;
    if !response.status().is_success() {
        let status = response.status();
        let details = response.text().await.unwrap_or_default();
        return Err((StatusCode::BAD_GATEWAY, format!("Groq model '{}' returned {}: {}", vision_model, status, details.chars().take(300).collect::<String>())));
    }
    let body: Value = response.json().await.map_err(|error| (StatusCode::BAD_GATEWAY, error.to_string()))?;
    let content = body["choices"][0]["message"]["content"].as_str().unwrap_or("");
    let json_text = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    let result: AnalysisResult = serde_json::from_str(json_text)
        .map_err(|error| (StatusCode::BAD_GATEWAY, format!("AI response JSON parse failed: {}", error)))?;
    if result.estimated_quantity < Decimal::ZERO {
        return Err((StatusCode::BAD_GATEWAY, "AI returned a negative quantity".to_string()));
    }
    if !(0..=100).contains(&result.confidence) {
        return Err((StatusCode::BAD_GATEWAY, "AI returned an invalid confidence score".to_string()));
    }
    sqlx::query("INSERT INTO monitor_logs (warehouse_id, camera_url, item_name, status, status_label, estimated_quantity, unit, confidence, recommendation, reason, image_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(&warehouse_id).bind(input.camera_url.unwrap_or_else(|| "webcam".to_string())).bind(&result.item_name).bind(&result.status).bind(&result.status_label).bind(result.estimated_quantity).bind(&result.unit).bind(result.confidence).bind(&result.recommendation).bind(&result.reason).bind(input.image.chars().take(1000).collect::<String>())
        .execute(&db).await.map_err(internal_error)?;
    let item_id = sqlx::query_scalar::<_, Uuid>("SELECT id FROM inventory_items WHERE warehouse_id=$1 AND lower(name)=lower($2) AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1")
        .bind(&warehouse_id).bind(&result.item_name).fetch_optional(&db).await.map_err(internal_error)?;
    let estimate_id = Uuid::new_v4();
    sqlx::query("INSERT INTO inventory_vision_estimates (id,warehouse_id,inventory_item_id,item_name,estimated_quantity,unit,confidence,recommendation,reason,image_snapshot,submitted_by,submitted_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(estimate_id).bind(&warehouse_id).bind(item_id).bind(&result.item_name).bind(result.estimated_quantity).bind(&result.unit).bind(result.confidence).bind(&result.recommendation).bind(&result.reason).bind(input.image.chars().take(50_000).collect::<String>()).bind(&user.id).bind(&user.email)
        .execute(&db).await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "estimateId":estimate_id,"itemName":result.item_name,"estimatedQuantity":result.estimated_quantity,"unit":result.unit,"status":result.status,"statusLabel":result.status_label,"confidence":result.confidence,"recommendation":result.recommendation,"reason":result.reason,"reviewStatus":"PENDING","savedToDb":false })))
}

async fn list_vision_estimates(
    State(state): State<AppState>,
    Query(query): Query<VisionEstimateQuery>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let warehouse_id = if user.role == "서버 관리자" { query.warehouse_id } else { user.warehouse_id };
    let warehouse_id = warehouse_id.ok_or_else(|| (StatusCode::BAD_REQUEST, "warehouseId is required".to_string()))?;
    let db = state.db.ok_or_else(database_not_configured)?;
    let rows = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, Decimal, String, i32, String, String, String, DateTime<Utc>)>(
        "SELECT id,inventory_item_id,item_name,estimated_quantity,unit,confidence,recommendation,reason,submitted_email,created_at FROM inventory_vision_estimates WHERE warehouse_id=$1 AND status='PENDING' ORDER BY created_at DESC LIMIT 100",
    ).bind(warehouse_id).fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(rows.into_iter().map(|row| serde_json::json!({"id":row.0,"inventoryItemId":row.1,"itemName":row.2,"estimatedQuantity":row.3,"unit":row.4,"confidence":row.5,"recommendation":row.6,"reason":row.7,"submittedEmail":row.8,"createdAt":row.9})).collect()))
}

async fn review_vision_estimate(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<AuthenticatedUser>,
    Json(input): Json<ReviewVisionEstimate>,
) -> Result<Json<Value>, (StatusCode, String)> {
    if user.role != "관리자" && user.role != "서버 관리자" {
        return Err((StatusCode::FORBIDDEN, "관리자만 비전 추정치를 검토할 수 있습니다.".to_string()));
    }
    let db = state.db.ok_or_else(database_not_configured)?;
    let mut transaction = db.begin().await.map_err(internal_error)?;
    let estimate = sqlx::query_as::<_, (String, Option<Uuid>, String, Decimal, String, i32, String)>("SELECT warehouse_id,inventory_item_id,item_name,estimated_quantity,unit,confidence,reason FROM inventory_vision_estimates WHERE id=$1 AND status='PENDING' FOR UPDATE")
        .bind(input.id).fetch_optional(&mut *transaction).await.map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "검토 대기 비전 추정치를 찾을 수 없습니다.".to_string()))?;
    if user.role != "서버 관리자" && user.warehouse_id.as_deref() != Some(estimate.0.as_str()) {
        return Err((StatusCode::FORBIDDEN, "다른 창고의 추정치는 검토할 수 없습니다.".to_string()));
    }
    let note = input.note.as_deref().filter(|value| !value.trim().is_empty()).unwrap_or(if input.approve { "관리자 승인" } else { "관리자 반려" });
    if input.approve {
        let item_id = input.inventory_item_id.or(estimate.1).ok_or_else(|| (StatusCode::BAD_REQUEST, "승인할 재고 품목을 선택해야 합니다.".to_string()))?;
        let item = sqlx::query_as::<_, (String, Decimal, Decimal, String, Option<String>, Decimal)>("SELECT name,current,safe,unit,package_unit,package_size FROM inventory_items WHERE id=$1 AND warehouse_id=$2 AND archived_at IS NULL FOR UPDATE")
            .bind(item_id).bind(&estimate.0).fetch_optional(&mut *transaction).await.map_err(internal_error)?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "활성 재고 품목을 찾을 수 없습니다.".to_string()))?;
        let quantity = if estimate.4 == item.3 { estimate.3 }
            else if item.4.as_deref() == Some(estimate.4.as_str()) { estimate.3 * item.5 }
            else { return Err((StatusCode::BAD_REQUEST, "비전 단위가 품목의 기준/포장 단위와 일치하지 않습니다.".to_string())); };
        let (status,status_label,diff_text,recommendation) = classify_stock(quantity,item.2,&item.3);
        sqlx::query("UPDATE inventory_items SET current=$1,status=$2,status_label=$3,diff_text=$4,recommendation=$5,updated_at=now() WHERE id=$6")
            .bind(quantity).bind(status).bind(status_label).bind(diff_text).bind(recommendation).bind(item_id).execute(&mut *transaction).await.map_err(internal_error)?;
        let delta = quantity - item.1;
        if !delta.is_zero() {
            sqlx::query("INSERT INTO inventory_movements (warehouse_id,inventory_item_id,item_name,movement_type,quantity_delta,balance_after,note,source,actor_id,actor_email) VALUES ($1,$2,$3,'vision_estimate',$4,$5,$6,'groq_vision_approved',$7,$8)")
                .bind(&estimate.0).bind(item_id).bind(&item.0).bind(delta).bind(quantity).bind(format!("AI 신뢰도 {}%, 검토자 사유: {}. 분석 근거: {}",estimate.5,note,estimate.6)).bind(&user.id).bind(&user.email).execute(&mut *transaction).await.map_err(internal_error)?;
        }
        sqlx::query("INSERT INTO inventory_audit_events (warehouse_id,actor_id,actor_email,action,entity_type,entity_id,before_data,after_data,reason,source) VALUES ($1,$2,$3,'approve','vision_estimate',$4,$5,$6,$7,'groq_vision')")
            .bind(&estimate.0).bind(&user.id).bind(&user.email).bind(input.id.to_string())
            .bind(serde_json::json!({"current":item.1,"inventoryItemId":item_id}))
            .bind(serde_json::json!({"current":quantity,"delta":delta,"confidence":estimate.5})).bind(note).execute(&mut *transaction).await.map_err(internal_error)?;
    } else {
        sqlx::query("INSERT INTO inventory_audit_events (warehouse_id,actor_id,actor_email,action,entity_type,entity_id,after_data,reason,source) VALUES ($1,$2,$3,'reject','vision_estimate',$4,$5,$6,'groq_vision')")
            .bind(&estimate.0).bind(&user.id).bind(&user.email).bind(input.id.to_string()).bind(serde_json::json!({"itemName":estimate.2,"estimatedQuantity":estimate.3,"unit":estimate.4})).bind(note).execute(&mut *transaction).await.map_err(internal_error)?;
    }
    let status = if input.approve { "APPROVED" } else { "REJECTED" };
    sqlx::query("UPDATE inventory_vision_estimates SET inventory_item_id=COALESCE($1,inventory_item_id),status=$2,reviewed_by=$3,reviewed_email=$4,reviewed_at=now(),review_note=$5 WHERE id=$6")
        .bind(input.inventory_item_id.or(estimate.1)).bind(status).bind(&user.id).bind(&user.email).bind(note).bind(input.id).execute(&mut *transaction).await.map_err(internal_error)?;
    transaction.commit().await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({"success":true,"status":status,"estimateId":input.id})))
}

fn create_session_token(
    state: &AppState,
    id: &str,
    email: &str,
    role: &str,
    status: &str,
    warehouse_id: Option<String>,
) -> Result<String, (StatusCode, String)> {
    let claims = SessionClaims {
        sub: id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        status: status.to_string(),
        warehouse_id,
        exp: (Utc::now().timestamp() + 12 * 60 * 60) as usize,
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(state.jwt_secret.as_bytes()))
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "세션 토큰 생성에 실패했습니다.".to_string()))
}

fn required(value: Option<String>, name: &str) -> Result<String, (StatusCode, String)> {
    value.filter(|item| !item.trim().is_empty()).ok_or_else(|| (StatusCode::BAD_REQUEST, format!("{} is required", name)))
}
