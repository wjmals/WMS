use argon2::{password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use std::{env, net::SocketAddr};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: Option<PgPool>,
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
    current: i64,
    safe: i64,
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
    warehouse_id: Option<String>,
}

#[derive(Deserialize)]
struct CreateInventoryItem {
    warehouse_id: String,
    name: String,
    current: i64,
    safe: i64,
    cycle: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
struct UserRecord {
    id: Uuid,
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
    admin_email: Option<String>,
    target_email: Option<String>,
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
    capacity: i64,
    #[serde(rename = "updatedAt")]
    updated_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct ZoneQuery {
    warehouse_id: Option<String>,
}

#[derive(Deserialize)]
struct SaveZone {
    id: String,
    warehouse_id: String,
    name: String,
    state: Option<String>,
    state_label: Option<String>,
    temp: Option<String>,
    items: Option<Value>,
    capacity: Option<i64>,
}

#[derive(Deserialize)]
struct UpdateInventoryItem {
    id: Uuid,
    warehouse_id: String,
    current: i64,
    safe: Option<i64>,
}

#[derive(Deserialize)]
struct DeleteInventoryQuery {
    id: Uuid,
    warehouse_id: String,
}

#[derive(Deserialize)]
struct DeleteZoneQuery {
    id: String,
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
    warehouse_id: Option<String>,
    id: Option<Uuid>,
}

#[derive(Deserialize)]
struct CreateReference {
    warehouse_id: String,
    image: String,
    name: String,
    description: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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

    let state = AppState { db };
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/inventory", get(list_inventory).post(create_inventory).patch(update_inventory).delete(delete_inventory))
        .route("/api/users", post(users_action))
        .route("/api/zones", get(list_zones).post(save_zone).delete(delete_zone))
        .route("/api/vision", get(list_references).post(create_reference).delete(delete_reference))
        .with_state(state)
        .layer(CorsLayer::permissive())
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
        "SELECT id, warehouse_id, name, current, safe, status, status_label, diff_text, recommendation, cycle, date, created_at, updated_at
         FROM inventory_items WHERE warehouse_id = $1 ORDER BY name",
    )
    .bind(warehouse_id)
    .fetch_all(&db)
    .await
    .map_err(internal_error)?;

    Ok(Json(items))
}

async fn create_inventory(
    State(state): State<AppState>,
    Json(input): Json<CreateInventoryItem>,
) -> Result<(StatusCode, Json<InventoryItem>), (StatusCode, String)> {
    if input.name.trim().is_empty() || input.current < 0 || input.safe < 0 {
        return Err((StatusCode::BAD_REQUEST, "name, current, and safe are invalid".to_string()));
    }

    let db = state.db.ok_or_else(|| database_not_configured())?;
    let (status, status_label, diff_text, recommendation) = classify_stock(input.current, input.safe);
    let item = sqlx::query_as::<_, InventoryItem>(
        "INSERT INTO inventory_items (warehouse_id, name, current, safe, status, status_label, diff_text, recommendation, cycle, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)
         RETURNING id, warehouse_id, name, current, safe, status, status_label, diff_text, recommendation, cycle, date, created_at, updated_at",
    )
    .bind(input.warehouse_id)
    .bind(input.name.trim())
    .bind(input.current)
    .bind(input.safe)
    .bind(status)
    .bind(status_label)
    .bind(diff_text)
    .bind(recommendation)
    .bind(input.cycle.unwrap_or_else(|| "월간".to_string()))
    .fetch_one(&db)
    .await
    .map_err(internal_error)?;

    Ok((StatusCode::CREATED, Json(item)))
}

async fn update_inventory(
    State(state): State<AppState>,
    Json(input): Json<UpdateInventoryItem>,
) -> Result<Json<InventoryItem>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    if input.current < 0 {
        return Err((StatusCode::BAD_REQUEST, "current must be non-negative".to_string()));
    }
    let safe = input.safe.unwrap_or(10000);
    let (status, status_label, diff_text, recommendation) = classify_stock(input.current, safe);
    let item = sqlx::query_as::<_, InventoryItem>(
        "UPDATE inventory_items SET current = $1, safe = $2, status = $3, status_label = $4, diff_text = $5, recommendation = $6, updated_at = now()
         WHERE id = $7 AND warehouse_id = $8
         RETURNING id, warehouse_id, name, current, safe, status, status_label, diff_text, recommendation, cycle, date, created_at, updated_at",
    ).bind(input.current).bind(safe).bind(status).bind(status_label).bind(diff_text).bind(recommendation)
    .bind(input.id).bind(input.warehouse_id).fetch_optional(&db).await.map_err(internal_error)?
    .ok_or_else(|| (StatusCode::NOT_FOUND, "해당 아이템을 찾을 수 없습니다.".to_string()))?;
    Ok(Json(item))
}

async fn delete_inventory(
    State(state): State<AppState>,
    Query(query): Query<DeleteInventoryQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let result = sqlx::query("DELETE FROM inventory_items WHERE id = $1 AND warehouse_id = $2")
        .bind(query.id).bind(query.warehouse_id).execute(&db).await.map_err(internal_error)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "해당 아이템을 찾을 수 없습니다.".to_string()));
    }
    Ok(Json(serde_json::json!({ "success": true, "deletedId": query.id })))
}

fn classify_stock(current: i64, safe: i64) -> (&'static str, &'static str, String, &'static str) {
    let diff = current - safe;
    if (current as f64) < (safe as f64) * 0.5 {
        (
            "shortage",
            "재고 부족",
            format!("부족분: {diff}톤"),
            "재고 하한선 이탈 -> 즉시 추가 발주 필요",
        )
    } else if (current as f64) > (safe as f64) * 2.0 {
        (
            "overstock",
            "재고 과다",
            format!("초과분: +{diff}톤"),
            "창고 점유율 초과 -> 출하량 증대 필요",
        )
    } else {
        ("safe", "안전 재고", "적정 범위 유지".to_string(), "수요 안정적 -> 현 유통 계획 유지")
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
    Json(input): Json<UserAction>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    match input.action.as_str() {
        "signup" => {
            let email = required(input.email, "email")?;
            let password = required(input.password, "password")?;
            let name = required(input.name, "name")?;
            let role = input.role.unwrap_or_else(|| "창고지기".to_string());
            let admin_email = if role == "관리자" { None } else { input.admin_email };
            if role != "관리자" && admin_email.is_none() {
                return Err((StatusCode::BAD_REQUEST, "창고 관리자 이메일이 필요합니다.".to_string()));
            }
            let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
                .bind(&email).fetch_one(&db).await.map_err(internal_error)?;
            if existing > 0 {
                return Err((StatusCode::BAD_REQUEST, "이미 존재하는 이메일입니다.".to_string()));
            }
            let salt = SaltString::generate(&mut rand::thread_rng());
            let password_hash = Argon2::default().hash_password(password.as_bytes(), &salt)
                .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "비밀번호 해시 생성 실패".to_string()))?
                .to_string();
            let status = if role == "관리자" { "PENDING_ADMIN" } else { "PENDING_WAREHOUSE" };
            let user = sqlx::query_as::<_, UserRecord>(
                "INSERT INTO users (email, password_hash, name, role, status, admin_email)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at",
            ).bind(&email).bind(password_hash).bind(name).bind(role).bind(status).bind(admin_email)
            .fetch_one(&db).await.map_err(internal_error)?;
            Ok(Json(serde_json::json!({ "success": true, "user": user })))
        }
        "login" => {
            let login = input.username.or(input.email).ok_or_else(|| (StatusCode::BAD_REQUEST, "email이 필요합니다.".to_string()))?;
            let password = required(input.password, "password")?;
            let row = sqlx::query_as::<_, (Uuid, String, String, String, String, Option<String>, Option<String>, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>, String)>(
                "SELECT id, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at, password_hash FROM users WHERE email = $1",
            ).bind(&login).fetch_optional(&db).await.map_err(internal_error)?
                .ok_or_else(|| (StatusCode::NOT_FOUND, "등록되지 않은 계정입니다.".to_string()))?;
            let parsed = PasswordHash::new(&row.10).map_err(|_| (StatusCode::UNAUTHORIZED, "비밀번호가 일치하지 않습니다.".to_string()))?;
            Argon2::default().verify_password(password.as_bytes(), &parsed)
                .map_err(|_| (StatusCode::UNAUTHORIZED, "비밀번호가 일치하지 않습니다.".to_string()))?;
            Ok(Json(serde_json::json!({
                "success": true,
                "user": { "id": row.0, "email": row.1, "name": row.2, "role": row.3, "status": row.4, "warehouseId": row.5, "adminEmail": row.6, "requestedAdminEmail": row.7, "createdAt": row.8, "approvedAt": row.9 }
            })))
        }
        "request_access" => {
            let email = required(input.email, "email")?;
            let admin_email = required(input.admin_email, "adminEmail")?;
            sqlx::query("UPDATE users SET requested_admin_email = $1 WHERE email = $2")
                .bind(&admin_email).bind(&email).execute(&db).await.map_err(internal_error)?;
            sqlx::query("INSERT INTO warehouse_access_requests (user_email, user_name, admin_email) SELECT email, name, $1 FROM users WHERE email = $2")
                .bind(&admin_email).bind(&email).execute(&db).await.map_err(internal_error)?;
            Ok(Json(serde_json::json!({ "success": true, "message": format!("'{}' 관리자에게 권한 요청을 보냈습니다.", admin_email) })))
        }
        "approve_user" => {
            let target = required(input.target_email, "targetEmail")?;
            let admin = required(input.admin_email, "adminEmail")?;
            let warehouse_id = format!("wh_{}", admin.split('@').next().unwrap_or("wms"));
            sqlx::query("UPDATE users SET status = 'APPROVED', admin_email = $1, warehouse_id = $2, approved_at = now(), requested_admin_email = NULL WHERE email = $3")
                .bind(&admin).bind(&warehouse_id).bind(&target).execute(&db).await.map_err(internal_error)?;
            sqlx::query("UPDATE warehouse_access_requests SET status = 'APPROVED' WHERE user_email = $1 AND status = 'PENDING'")
                .bind(&target).execute(&db).await.map_err(internal_error)?;
            Ok(Json(serde_json::json!({ "success": true, "targetEmail": target, "warehouseId": warehouse_id })))
        }
        _ => Err((StatusCode::BAD_REQUEST, "유효하지 않은 요청입니다.".to_string())),
    }
}

async fn list_zones(
    State(state): State<AppState>,
    Query(query): Query<ZoneQuery>,
) -> Result<Json<Vec<ZoneRecord>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let zones = sqlx::query_as::<_, ZoneRecord>("SELECT id, warehouse_id, name, state, state_label, temp, items, capacity, updated_at FROM warehouse_zones WHERE warehouse_id = $1 ORDER BY id")
        .bind(warehouse_id).fetch_all(&db).await.map_err(internal_error)?;
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
        "INSERT INTO warehouse_zones (id, warehouse_id, name, state, state_label, temp, items, capacity)
         VALUES ($1, $2, $3, COALESCE($4, 'normal'), COALESCE($5, '정상'), COALESCE($6, '-20°C'), COALESCE($7, '[]'::jsonb), COALESCE($8, 100000))
         ON CONFLICT (warehouse_id, id) DO UPDATE SET name = EXCLUDED.name, state = EXCLUDED.state, state_label = EXCLUDED.state_label, temp = EXCLUDED.temp, items = EXCLUDED.items, capacity = EXCLUDED.capacity, updated_at = now()
         RETURNING id, warehouse_id, name, state, state_label, temp, items, capacity, updated_at",
    ).bind(input.id).bind(input.warehouse_id).bind(input.name).bind(input.state).bind(input.state_label).bind(input.temp).bind(input.items).bind(input.capacity)
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
    let thumbnail = input.image.chars().take(50_000).collect::<String>();
    let reference = sqlx::query_as::<_, ItemReference>(
        "INSERT INTO item_references (warehouse_id, name, description, thumbnail)
         VALUES ($1, $2, $3, $4)
         RETURNING id, warehouse_id, name, description, thumbnail, created_at",
    ).bind(input.warehouse_id).bind(input.name.trim()).bind(input.description.unwrap_or_default()).bind(thumbnail)
    .fetch_one(&db).await.map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(reference)))
}

async fn delete_reference(
    State(state): State<AppState>,
    Query(query): Query<ReferenceQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let id = query.id.ok_or_else(|| (StatusCode::BAD_REQUEST, "id가 필요합니다.".to_string()))?;
    let result = sqlx::query("DELETE FROM item_references WHERE id = $1")
        .bind(id).execute(&db).await.map_err(internal_error)?;
    if result.rows_affected() == 0 {
        return Err((StatusCode::NOT_FOUND, "학습 데이터를 찾을 수 없습니다.".to_string()));
    }
    Ok(Json(serde_json::json!({ "success": true, "deletedId": id })))
}

fn required(value: Option<String>, name: &str) -> Result<String, (StatusCode, String)> {
    value.filter(|item| !item.trim().is_empty()).ok_or_else(|| (StatusCode::BAD_REQUEST, format!("{} is required", name)))
}
