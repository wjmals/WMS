use argon2::{password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
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
    #[serde(alias = "warehouseId")]
    warehouse_id: Option<String>,
}

#[derive(Deserialize)]
struct CreateInventoryItem {
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    name: String,
    current: i64,
    safe: i64,
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
    capacity: i64,
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
    capacity: Option<i64>,
}

#[derive(Deserialize)]
struct UpdateInventoryItem {
    id: Uuid,
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
    current: i64,
    safe: Option<i64>,
}

#[derive(Deserialize)]
struct DeleteInventoryQuery {
    id: Uuid,
    #[serde(alias = "warehouseId")]
    warehouse_id: String,
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

#[derive(Debug, Serialize, FromRow)]
struct DeliveryRecord {
    id: Uuid,
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
    estimated_quantity: i64,
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
        .route("/api/users", get(get_users).post(users_action).delete(delete_user))
        .route("/api/zones", get(list_zones).post(save_zone).delete(delete_zone))
        .route("/api/vision", get(list_references).post(create_reference).delete(delete_reference))
        .route("/api/delivery", get(list_delivery).post(create_delivery).delete(delete_delivery).put(advance_delivery))
        .route("/api/monitor", get(list_monitor_logs).post(analyze_monitor_image))
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
            Ok(Json(serde_json::json!({ "success": true, "user": user })))
        }
        "login" => {
            let login = input.username.or(input.email).ok_or_else(|| (StatusCode::BAD_REQUEST, "email이 필요합니다.".to_string()))?;
            let password = required(input.password, "password")?;

            if login == "wjmals" || login == "wjmals@wms-smartstock.ai" {
                if password != "wjdals99!" {
                    return Err((StatusCode::UNAUTHORIZED, "비밀번호가 일치하지 않습니다.".to_string()));
                }
                return Ok(Json(serde_json::json!({
                    "success": true,
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
            let display_username = row.1.clone().unwrap_or_else(|| row.2.split('@').next().unwrap_or("user").to_string());
            Ok(Json(serde_json::json!({
                "success": true,
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
            // 관리자의 실제 warehouse_id 조회
            let warehouse_id = {
                let wid = sqlx::query_scalar::<_, Option<String>>("SELECT warehouse_id FROM users WHERE email = $1")
                    .bind(&admin).fetch_optional(&db).await.map_err(internal_error)?;
                wid.flatten().unwrap_or_else(|| format!("wh_{}", admin.split('@').next().unwrap_or("wms")))
            };
            // 창고가 없으면 생성
            sqlx::query("INSERT INTO warehouses (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING")
                .bind(&warehouse_id).bind(&format!("{} 창고", warehouse_id.trim_start_matches("wh_")))
                .execute(&db).await.map_err(internal_error)?;
            sqlx::query("UPDATE users SET status = 'APPROVED', admin_email = $1, warehouse_id = $2, approved_at = now(), requested_admin_email = NULL WHERE email = $3")
                .bind(&admin).bind(&warehouse_id).bind(&target).execute(&db).await.map_err(internal_error)?;
            sqlx::query("UPDATE warehouse_access_requests SET status = 'APPROVED' WHERE user_email = $1 AND status = 'PENDING'")
                .bind(&target).execute(&db).await.map_err(internal_error)?;
            Ok(Json(serde_json::json!({ "success": true, "targetEmail": target, "warehouseId": warehouse_id })))
        }
        "approve_admin" => {
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
            // 창고 관리자가 창고지기를 직접 초대/즉시 승인
            let target = required(input.target_email, "targetEmail")?;
            let admin = required(input.admin_email, "adminEmail")?;
            let warehouse_id = {
                let row = sqlx::query_scalar::<_, Option<String>>("SELECT warehouse_id FROM users WHERE email = $1")
                    .bind(&admin).fetch_optional(&db).await.map_err(internal_error)?;
                row.flatten().unwrap_or_else(|| format!("wh_{}", admin.split('@').next().unwrap_or("wms")))
            };
            // 이미 존재하면 업데이트, 없으면 새로 생성
            let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users WHERE email = $1")
                .bind(&target).fetch_one(&db).await.map_err(internal_error)?;
            if exists > 0 {
                sqlx::query("UPDATE users SET status = 'APPROVED', admin_email = $1, warehouse_id = $2, approved_at = now() WHERE email = $3")
                    .bind(&admin).bind(&warehouse_id).bind(&target).execute(&db).await.map_err(internal_error)?;
            } else {
                let uname = target.split('@').next().unwrap_or("user").to_string();
                let salt = SaltString::generate(&mut rand::thread_rng());
                let phash = Argon2::default().hash_password("123456".as_bytes(), &salt)
                    .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "hash fail".to_string()))?.to_string();
                sqlx::query("INSERT INTO users (username, email, password_hash, name, role, status, admin_email, warehouse_id, approved_at) VALUES ($1,$2,$3,$4,'창고지기','APPROVED',$5,$6,now())")
                    .bind(&uname).bind(&target).bind(phash).bind(&uname).bind(&admin).bind(&warehouse_id)
                    .execute(&db).await.map_err(internal_error)?;
            }
            Ok(Json(serde_json::json!({ "success": true, "message": format!("'{}' 창고지기가 이 창고로 승인 등록되었습니다.", target) })))
        }
        "delete_user" => {
            let target = required(input.target_email, "targetEmail")?;
            if target == "wjmals" || target == "wjmals@wms-smartstock.ai" {
                return Err((StatusCode::FORBIDDEN, "총괄 서버 관리자 계정은 삭제할 수 없습니다.".to_string()));
            }
            let result = sqlx::query("DELETE FROM users WHERE email = $1")
                .bind(&target).execute(&db).await.map_err(internal_error)?;
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
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let action = query.action.unwrap_or_else(|| "list".to_string());
    if action == "get_user" {
        let email = required(query.email, "email")?;
        let user = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users WHERE email = $1 OR username = $1")
            .bind(email).fetch_optional(&db).await.map_err(internal_error)?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "사용자를 찾을 수 없습니다.".to_string()))?;
        return Ok(Json(serde_json::to_value(user).unwrap_or(Value::Null)));
    }
    if action == "list_requests" {
        let admin = required(query.admin_email, "adminEmail")?;
        let requests = sqlx::query_as::<_, (Uuid, String, String, DateTime<Utc>)>(
            "SELECT id, user_email, user_name, requested_at FROM warehouse_access_requests WHERE admin_email = $1 AND status = 'PENDING' ORDER BY requested_at",
        ).bind(&admin).fetch_all(&db).await.map_err(internal_error)?;
        let pending = requests.into_iter().map(|r| serde_json::json!({ "id": r.0, "userEmail": r.1, "userName": r.2, "requestedAt": r.3 })).collect::<Vec<_>>();
        let members = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users WHERE admin_email = $1 AND status = 'APPROVED' ORDER BY name")
            .bind(admin).fetch_all(&db).await.map_err(internal_error)?;
        return Ok(Json(serde_json::json!({ "pendingRequests": pending, "teamMembers": members })));
    }
    if action == "list_admin_requests" {
        let users = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users WHERE (role = '관리자' AND status <> 'APPROVED') OR status = 'PENDING_ADMIN' ORDER BY created_at")
            .fetch_all(&db).await.map_err(internal_error)?;
        return Ok(Json(serde_json::to_value(users).unwrap_or(Value::Null)));
    }
    let users = sqlx::query_as::<_, UserRecord>("SELECT id, username, email, name, role, status, warehouse_id, admin_email, requested_admin_email, created_at, approved_at FROM users ORDER BY created_at")
        .fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(serde_json::to_value(users).unwrap_or(Value::Null)))
}

async fn delete_user(
    State(state): State<AppState>,
    Query(query): Query<UserQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
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

async fn list_delivery(
    State(state): State<AppState>,
) -> Result<Json<Vec<DeliveryRecord>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let rows = sqlx::query_as::<_, DeliveryRecord>(
        "SELECT id, invoice_no, carrier_code, carrier_name, item_name, sender_name, receiver_name, status, status_code, current_location, delivered_at, tracking_details, created_at, updated_at
         FROM delivery_tracking WHERE delivered_at IS NULL OR delivered_at > now() - interval '24 hours' ORDER BY created_at DESC",
    ).fetch_all(&db).await.map_err(internal_error)?;
    Ok(Json(rows))
}

async fn create_delivery(
    State(state): State<AppState>,
    Json(input): Json<CreateDelivery>,
) -> Result<(StatusCode, Json<DeliveryRecord>), (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let invoice = input.invoice_no.chars().filter(|c| c.is_ascii_digit()).collect::<String>();
    if invoice.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "운송장 번호를 입력해주세요.".to_string()));
    }
    let row = sqlx::query_as::<_, DeliveryRecord>(
        "INSERT INTO delivery_tracking (invoice_no, carrier_code, carrier_name, item_name, sender_name, receiver_name, status, status_code, current_location)
         VALUES ($1, COALESCE($2, '04'), COALESCE($3, 'CJ대한통운'), COALESCE($4, '물류 출고건'), COALESCE($5, 'WMS 스마트 물류센터'), COALESCE($6, '고객님'), '상품인수', 'AT_PICKUP', '배송 접수처')
         RETURNING id, invoice_no, carrier_code, carrier_name, item_name, sender_name, receiver_name, status, status_code, current_location, delivered_at, tracking_details, created_at, updated_at",
    ).bind(invoice).bind(input.carrier_code).bind(input.carrier_name).bind(input.item_name).bind(input.sender_name).bind(input.receiver_name)
    .fetch_one(&db).await.map_err(internal_error)?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn delete_delivery(
    State(state): State<AppState>,
    Query(query): Query<DeliveryQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let id = query.id.ok_or_else(|| (StatusCode::BAD_REQUEST, "id가 필요합니다.".to_string()))?;
    sqlx::query("DELETE FROM delivery_tracking WHERE id = $1").bind(id).execute(&db).await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "success": true })))
}

async fn advance_delivery(
    State(state): State<AppState>,
    Json(query): Json<DeliveryQuery>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let id = query.id.ok_or_else(|| (StatusCode::BAD_REQUEST, "id가 필요합니다.".to_string()))?;
    let current = sqlx::query_as::<_, (String, String)>("SELECT status_code, status FROM delivery_tracking WHERE id = $1")
        .bind(id).fetch_optional(&db).await.map_err(internal_error)?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "배송 항목 없음".to_string()))?;
    let (next_code, next_status, delivered) = match current.0.as_str() {
        "AT_PICKUP" => ("IN_TRANSIT", "허브터미널 이동중", false),
        "IN_TRANSIT" => ("OUT_FOR_DELIVERY", "배달출발", false),
        _ => ("DELIVERED", "배송완료", true),
    };
    sqlx::query("UPDATE delivery_tracking SET status_code = $1, status = $2, current_location = $3, delivered_at = CASE WHEN $4 THEN now() ELSE NULL END, updated_at = now() WHERE id = $5")
        .bind(next_code).bind(next_status).bind(if delivered { "고객 지정장소 (문 앞 배송완료)" } else { "배송 이동 중" }).bind(delivered).bind(id)
        .execute(&db).await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "success": true, "status": next_status, "statusCode": next_code })))
}

async fn list_monitor_logs(
    State(state): State<AppState>,
    Query(query): Query<ZoneQuery>,
) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let warehouse_id = query.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
    let rows = sqlx::query_as::<_, (Uuid, String, String, String, String, i64, String, i32, String, String, Option<String>, DateTime<Utc>)>(
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
    Json(input): Json<MonitorInput>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let db = state.db.ok_or_else(database_not_configured)?;
    let api_key = env::var("GROQ_API_KEY").map_err(|_| (StatusCode::SERVICE_UNAVAILABLE, "GROQ_API_KEY is not configured".to_string()))?;
    let warehouse_id = input.warehouse_id.unwrap_or_else(|| "wh_wjmals".to_string());
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
    let prompt = format!("당신은 창고 재고 관리 AI입니다. 현재 이미지의 품목과 재고 상태를 분석하고 JSON만 반환하세요. 아래 레퍼런스 이미지가 있으면 현재 이미지와 비교하여 품목을 식별하세요. 레퍼런스는 학습 데이터가 아니라 이번 분석을 위한 참고 자료입니다. 우선 품목: {}. 필드: itemName, estimatedQuantity, unit, status(shortage|safe|overstock), statusLabel, confidence(0-100), recommendation, reason.", input.item_name.as_deref().unwrap_or("없음"));
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
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "messages": [{ "role": "user", "content": content }],
        "max_tokens": 512,
        "temperature": 0.1
    });
    let response = reqwest::Client::new().post("https://api.groq.com/openai/v1/chat/completions")
        .bearer_auth(api_key).json(&payload).send().await
        .map_err(|error| (StatusCode::BAD_GATEWAY, error.to_string()))?;
    if !response.status().is_success() {
        return Err((StatusCode::BAD_GATEWAY, format!("Groq API returned {}", response.status())));
    }
    let body: Value = response.json().await.map_err(|error| (StatusCode::BAD_GATEWAY, error.to_string()))?;
    let content = body["choices"][0]["message"]["content"].as_str().unwrap_or("");
    let json_text = content.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();
    let result: AnalysisResult = serde_json::from_str(json_text)
        .map_err(|error| (StatusCode::BAD_GATEWAY, format!("AI response JSON parse failed: {}", error)))?;
    sqlx::query("INSERT INTO monitor_logs (warehouse_id, camera_url, item_name, status, status_label, estimated_quantity, unit, confidence, recommendation, reason, image_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(&warehouse_id).bind(input.camera_url.unwrap_or_else(|| "webcam".to_string())).bind(&result.item_name).bind(&result.status).bind(&result.status_label).bind(result.estimated_quantity).bind(&result.unit).bind(result.confidence).bind(&result.recommendation).bind(&result.reason).bind(input.image.chars().take(1000).collect::<String>())
        .execute(&db).await.map_err(internal_error)?;
    sqlx::query("UPDATE inventory_items SET current = $1, status = $2, status_label = $3, updated_at = now() WHERE warehouse_id = $4 AND name = $5")
        .bind(result.estimated_quantity).bind(&result.status).bind(&result.status_label).bind(&warehouse_id).bind(&result.item_name)
        .execute(&db).await.map_err(internal_error)?;
    Ok(Json(serde_json::json!({ "itemName": result.item_name, "estimatedQuantity": result.estimated_quantity, "unit": result.unit, "status": result.status, "statusLabel": result.status_label, "confidence": result.confidence, "recommendation": result.recommendation, "reason": result.reason, "savedToDb": true })))
}

fn required(value: Option<String>, name: &str) -> Result<String, (StatusCode, String)> {
    value.filter(|item| !item.trim().is_empty()).ok_or_else(|| (StatusCode::BAD_REQUEST, format!("{} is required", name)))
}
