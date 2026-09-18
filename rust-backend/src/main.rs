use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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
    warehouse_id: String,
    name: String,
    current: i64,
    safe: i64,
    status: String,
    status_label: String,
    diff_text: String,
    recommendation: String,
    cycle: String,
    date: Option<chrono::NaiveDate>,
    created_at: DateTime<Utc>,
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
        .route("/api/inventory", get(list_inventory).post(create_inventory))
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
