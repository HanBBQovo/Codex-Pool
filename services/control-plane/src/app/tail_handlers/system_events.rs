use codex_pool_core::events::{SystemEventCategory, SystemEventSeverity, SystemEventWrite};
use crate::contracts::{SystemEventCorrelationResponse, SystemEventDetailResponse, SystemEventListResponse, SystemEventSummaryResponse};
use crate::system_events::SystemEventQuery;

#[derive(Debug, Clone, Deserialize)]
struct SystemEventListQuery {
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    account_id: Option<Uuid>,
    request_id: Option<String>,
    job_id: Option<Uuid>,
    tenant_id: Option<Uuid>,
    category: Option<SystemEventCategory>,
    event_type: Option<String>,
    severity: Option<SystemEventSeverity>,
    reason_code: Option<String>,
    keyword: Option<String>,
    limit: Option<u32>,
    cursor: Option<String>,
}

impl From<SystemEventListQuery> for SystemEventQuery {
    fn from(value: SystemEventListQuery) -> Self {
        Self {
            start_ts: value.start_ts,
            end_ts: value.end_ts,
            account_id: value.account_id,
            request_id: value.request_id,
            job_id: value.job_id,
            tenant_id: value.tenant_id,
            category: value.category,
            event_type: value.event_type,
            severity: value.severity,
            reason_code: value.reason_code,
            keyword: value.keyword,
            limit: value.limit,
            cursor: value.cursor,
        }
    }
}

async fn list_admin_system_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SystemEventListQuery>,
) -> Result<Json<SystemEventListResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    require_admin_principal(&state, &headers)?;
    let repo = state
        .system_event_repo
        .as_ref()
        .ok_or_else(system_event_repo_unavailable_error)?;
    let response = repo.list_events(query.into()).await.map_err(internal_error)?;
    Ok(Json(response))
}

async fn get_admin_system_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(event_id): Path<Uuid>,
) -> Result<Json<SystemEventDetailResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    require_admin_principal(&state, &headers)?;
    let repo = state
        .system_event_repo
        .as_ref()
        .ok_or_else(system_event_repo_unavailable_error)?;
    let item = repo
        .get_event(event_id)
        .await
        .map_err(internal_error)?
        .ok_or_else(system_event_not_found_error)?;
    Ok(Json(SystemEventDetailResponse { item }))
}

async fn summarize_admin_system_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<SystemEventListQuery>,
) -> Result<Json<SystemEventSummaryResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    require_admin_principal(&state, &headers)?;
    let repo = state
        .system_event_repo
        .as_ref()
        .ok_or_else(system_event_repo_unavailable_error)?;
    let response = repo
        .summarize_events(query.into())
        .await
        .map_err(internal_error)?;
    Ok(Json(response))
}

async fn correlate_admin_system_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Query(query): Query<SystemEventListQuery>,
) -> Result<Json<SystemEventCorrelationResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    require_admin_principal(&state, &headers)?;
    let repo = state
        .system_event_repo
        .as_ref()
        .ok_or_else(system_event_repo_unavailable_error)?;
    let response = repo
        .correlate_request(&request_id, query.into())
        .await
        .map_err(internal_error)?;
    Ok(Json(response))
}

async fn internal_ingest_system_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(event): Json<SystemEventWrite>,
) -> Result<StatusCode, (StatusCode, Json<ErrorEnvelope>)> {
    require_internal_service_token(&state, &headers)?;
    let repo = state
        .system_event_repo
        .as_ref()
        .ok_or_else(system_event_repo_unavailable_error)?;
    repo.insert_event(event).await.map_err(internal_error)?;
    Ok(StatusCode::NO_CONTENT)
}

fn system_event_repo_unavailable_error() -> (StatusCode, Json<ErrorEnvelope>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorEnvelope::new(
            "system_event_repo_unavailable",
            "system event repository is not available",
        )),
    )
}

fn system_event_not_found_error() -> (StatusCode, Json<ErrorEnvelope>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorEnvelope::new(
            "system_event_not_found",
            "system event not found",
        )),
    )
}
