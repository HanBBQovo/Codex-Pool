#[derive(Debug, Clone, Deserialize)]
struct RequestCorrelationQuery {
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    limit: Option<u32>,
    tenant_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
struct RequestCorrelationResponse {
    request_id: String,
    start_ts: i64,
    end_ts: i64,
    request_logs: Vec<RequestLogItemResponse>,
    audit_logs: Vec<crate::tenant::AuditLogListItem>,
    audit_logs_available: bool,
}

type RequestCorrelationWindow = (i64, i64, u32, Option<Uuid>);
type ApiHandlerError = (StatusCode, Json<ErrorEnvelope>);

fn resolve_request_correlation_window(
    query: RequestCorrelationQuery,
) -> Result<RequestCorrelationWindow, ApiHandlerError> {
    let end_ts = query.end_ts.unwrap_or_else(|| Utc::now().timestamp());
    let start_ts = query
        .start_ts
        .unwrap_or_else(|| end_ts.saturating_sub(24 * 60 * 60));
    validate_usage_range(start_ts, end_ts)?;
    Ok((
        start_ts,
        end_ts,
        query
            .limit
            .unwrap_or(DEFAULT_USAGE_QUERY_LIMIT)
            .min(MAX_USAGE_QUERY_LIMIT),
        query.tenant_id,
    ))
}

async fn list_admin_request_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RequestLogsQuery>,
) -> Result<Json<RequestLogsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;
    let request_query = resolve_request_logs_query(query)?;
    let request_query_for_audit = request_query.clone();
    let items = usage_repo
        .query_request_logs(request_query)
        .await
        .map_err(internal_error)?;
    let item_count = items.len();
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: request_query_for_audit.tenant_id,
            action: "admin.request_logs.list".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("request_logs".to_string()),
            target_id: None,
            payload_json: json!({
                "start_ts": request_query_for_audit.start_ts,
                "end_ts": request_query_for_audit.end_ts,
                "limit": request_query_for_audit.limit,
                "tenant_id": request_query_for_audit.tenant_id,
                "api_key_id": request_query_for_audit.api_key_id,
                "status_code": request_query_for_audit.status_code,
                "request_id": request_query_for_audit.request_id,
                "keyword": request_query_for_audit.keyword,
                "item_count": item_count,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(RequestLogsResponse {
        items: items.into_iter().map(map_request_log_row).collect(),
    }))
}

async fn get_admin_request_correlation(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<RequestCorrelationQuery>,
) -> Result<Json<RequestCorrelationResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return Err(invalid_request_error("request_id must not be empty"));
    }

    let (start_ts, end_ts, limit, tenant_id) = resolve_request_correlation_window(query)?;
    let request_query = crate::usage::RequestLogQuery {
        start_ts,
        end_ts,
        limit,
        tenant_id,
        api_key_id: None,
        status_code: None,
        request_id: Some(request_id.clone()),
        keyword: None,
    };
    let request_logs = usage_repo
        .query_request_logs(request_query)
        .await
        .map_err(internal_error)?;

    let start_at = DateTime::<Utc>::from_timestamp(start_ts, 0)
        .ok_or_else(|| invalid_request_error("invalid start_ts"))?;
    let end_at = DateTime::<Utc>::from_timestamp(end_ts, 0)
        .ok_or_else(|| invalid_request_error("invalid end_ts"))?;

    let (audit_logs, audit_logs_available) =
        if let Some(tenant_auth_service) = state.tenant_auth_service.as_ref() {
            let query = crate::tenant::AuditLogListQuery {
                start_at,
                end_at,
                limit: limit as usize,
                tenant_id,
                actor_type: None,
                actor_id: None,
                action: None,
                result_status: None,
                keyword: Some(request_id.clone()),
            };
            let response = tenant_auth_service
                .list_audit_logs(query)
                .await
                .map_err(internal_error)?;
            (response.items, true)
        } else {
            (Vec::new(), false)
        };

    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id,
            action: "admin.request_correlation.get".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("request_correlation".to_string()),
            target_id: Some(request_id.clone()),
            payload_json: json!({
                "request_id": request_id.clone(),
                "start_ts": start_ts,
                "end_ts": end_ts,
                "limit": limit,
                "tenant_id": tenant_id,
                "request_log_count": request_logs.len(),
                "audit_log_count": audit_logs.len(),
                "audit_logs_available": audit_logs_available,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;

    Ok(Json(RequestCorrelationResponse {
        request_id,
        start_ts,
        end_ts,
        request_logs: request_logs.into_iter().map(map_request_log_row).collect(),
        audit_logs,
        audit_logs_available,
    }))
}

async fn list_tenant_request_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<RequestLogsQuery>,
) -> Result<Json<RequestLogsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_tenant_principal(&state, &headers).await?;
    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;
    let mut request_query = resolve_request_logs_query(query)?;
    request_query.tenant_id = Some(principal.tenant_id);
    let request_query_for_audit = request_query.clone();
    let items = usage_repo
        .query_request_logs(request_query)
        .await
        .map_err(internal_error)?;
    let item_count = items.len();
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "tenant_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: Some(principal.tenant_id),
            action: "tenant.request_logs.list".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("request_logs".to_string()),
            target_id: None,
            payload_json: json!({
                "start_ts": request_query_for_audit.start_ts,
                "end_ts": request_query_for_audit.end_ts,
                "limit": request_query_for_audit.limit,
                "api_key_id": request_query_for_audit.api_key_id,
                "status_code": request_query_for_audit.status_code,
                "request_id": request_query_for_audit.request_id,
                "keyword": request_query_for_audit.keyword,
                "item_count": item_count,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(RequestLogsResponse {
        items: items.into_iter().map(map_request_log_row).collect(),
    }))
}

async fn internal_ingest_request_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(event): Json<codex_pool_core::events::RequestLogEvent>,
) -> Result<StatusCode, (StatusCode, Json<ErrorEnvelope>)> {
    require_internal_service_token(&state, &headers)?;
    let system_event = request_log_event_to_system_event(&event);
    let usage_ingest_repo = state
        .usage_ingest_repo
        .as_ref()
        .ok_or_else(usage_ingest_repo_unavailable_error)?;
    usage_ingest_repo
        .ingest_request_log(event)
        .await
        .map_err(internal_error)?;
    if let Some(system_event_repo) = state.system_event_repo.as_ref() {
        system_event_repo
            .insert_event(system_event)
            .await
            .map_err(internal_error)?;
    }
    Ok(StatusCode::NO_CONTENT)
}

fn request_log_event_to_system_event(
    event: &codex_pool_core::events::RequestLogEvent,
) -> codex_pool_core::events::SystemEventWrite {
    let severity = if event.status_code >= 500 {
        codex_pool_core::events::SystemEventSeverity::Error
    } else if event.status_code >= 400 {
        codex_pool_core::events::SystemEventSeverity::Warn
    } else {
        codex_pool_core::events::SystemEventSeverity::Info
    };
    let event_type = if event.status_code >= 400 {
        "request_failed"
    } else {
        "request_completed"
    };
    codex_pool_core::events::SystemEventWrite {
        event_id: Some(event.id),
        ts: Some(event.created_at),
        category: codex_pool_core::events::SystemEventCategory::Request,
        event_type: event_type.to_string(),
        severity,
        source: "data_plane.request_log".to_string(),
        tenant_id: event.tenant_id,
        account_id: Some(event.account_id),
        request_id: event.request_id.clone(),
        trace_request_id: event.request_id.clone(),
        job_id: None,
        account_label: None,
        auth_provider: None,
        operator_state_from: None,
        operator_state_to: None,
        reason_class: event
            .error_code
            .as_ref()
            .map(|code| request_log_reason_class_name(code).to_string()),
        reason_code: event.error_code.clone(),
        next_action_at: None,
        path: Some(event.path.clone()),
        method: Some(event.method.clone()),
        model: event.model.clone(),
        selected_account_id: Some(event.account_id),
        selected_proxy_id: None,
        routing_decision: Some(if event.is_stream {
            "stream".to_string()
        } else {
            "http".to_string()
        }),
        failover_scope: None,
        status_code: Some(event.status_code),
        upstream_status_code: Some(event.status_code),
        latency_ms: Some(event.latency_ms),
        message: event
            .error_code
            .as_ref()
            .map(|code| format!("request finished with code {code}"))
            .or_else(|| Some("request completed".to_string())),
        preview_text: None,
        payload_json: Some(json!({
            "is_stream": event.is_stream,
            "service_tier": event.service_tier,
            "input_tokens": event.input_tokens,
            "cached_input_tokens": event.cached_input_tokens,
            "output_tokens": event.output_tokens,
            "reasoning_tokens": event.reasoning_tokens,
            "first_token_latency_ms": event.first_token_latency_ms,
            "billing_phase": event.billing_phase,
            "capture_status": event.capture_status,
        })),
        secret_preview: None,
    }
}

fn request_log_reason_class_name(code: &str) -> &'static str {
    let normalized = code.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "token_invalidated"
        | "account_deactivated"
        | "invalid_refresh_token"
        | "refresh_token_revoked"
        | "refresh_token_reused"
        | "terminal_invalid"
        | "credential_cipher_missing" => "fatal",
        "rate_limited" | "quota_exhausted" | "no_quota" => "quota",
        "upstream_unavailable" | "transport_error" | "overloaded" | "upstream_network_error" => {
            "transient"
        }
        _ => "transient",
    }
}

async fn list_admin_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditLogsQuery>,
) -> Result<Json<crate::tenant::AuditLogListResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let tenant_auth = require_tenant_auth_service(&state)?;
    let audit_query = resolve_audit_logs_query(query)?;
    let audit_query_for_write = audit_query.clone();
    let response = tenant_auth
        .list_audit_logs(audit_query)
        .await
        .map_err(internal_error)?;
    let item_count = response.items.len();
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: audit_query_for_write.tenant_id,
            action: "admin.audit_logs.list".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("audit_logs".to_string()),
            target_id: None,
            payload_json: json!({
                "start_at": audit_query_for_write.start_at,
                "end_at": audit_query_for_write.end_at,
                "limit": audit_query_for_write.limit,
                "tenant_id": audit_query_for_write.tenant_id,
                "actor_type": audit_query_for_write.actor_type,
                "actor_id": audit_query_for_write.actor_id,
                "action_filter": audit_query_for_write.action,
                "result_status": audit_query_for_write.result_status,
                "keyword": audit_query_for_write.keyword,
                "item_count": item_count,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(response))
}

async fn list_tenant_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditLogsQuery>,
) -> Result<Json<crate::tenant::AuditLogListResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_tenant_principal(&state, &headers).await?;
    let tenant_auth = require_tenant_auth_service(&state)?;
    let mut audit_query = resolve_audit_logs_query(query)?;
    audit_query.tenant_id = Some(principal.tenant_id);
    let audit_query_for_write = audit_query.clone();
    let response = tenant_auth
        .list_audit_logs(audit_query)
        .await
        .map_err(internal_error)?;
    let item_count = response.items.len();
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "tenant_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: Some(principal.tenant_id),
            action: "tenant.audit_logs.list".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("audit_logs".to_string()),
            target_id: None,
            payload_json: json!({
                "start_at": audit_query_for_write.start_at,
                "end_at": audit_query_for_write.end_at,
                "limit": audit_query_for_write.limit,
                "actor_type": audit_query_for_write.actor_type,
                "actor_id": audit_query_for_write.actor_id,
                "action_filter": audit_query_for_write.action,
                "result_status": audit_query_for_write.result_status,
                "keyword": audit_query_for_write.keyword,
                "item_count": item_count,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(response))
}

async fn list_hourly_account_usage(
    State(state): State<AppState>,
    Query(query): Query<UsageHourlyAccountQuery>,
) -> Result<Json<UsageQueryResponse<HourlyAccountUsagePoint>>, (StatusCode, Json<ErrorEnvelope>)> {
    let usage = validate_usage_query(query.start_ts, query.end_ts, query.limit)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    usage_repo
        .query_hourly_accounts(usage.start_ts, usage.end_ts, usage.limit, query.account_id)
        .await
        .map(|items| Json(UsageQueryResponse { items }))
        .map_err(internal_error)
}

async fn list_hourly_tenant_api_key_usage(
    State(state): State<AppState>,
    Query(query): Query<UsageHourlyTenantApiKeyQuery>,
) -> Result<Json<UsageQueryResponse<HourlyTenantApiKeyUsagePoint>>, (StatusCode, Json<ErrorEnvelope>)>
{
    let usage = validate_usage_query(query.start_ts, query.end_ts, query.limit)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    usage_repo
        .query_hourly_tenant_api_keys(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            query.tenant_id,
            query.api_key_id,
        )
        .await
        .map(|items| Json(UsageQueryResponse { items }))
        .map_err(internal_error)
}

async fn get_usage_summary(
    State(state): State<AppState>,
    Query(query): Query<UsageSummaryQuery>,
) -> Result<Json<UsageSummaryQueryResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    usage_repo
        .query_summary(
            query.start_ts,
            query.end_ts,
            query.tenant_id,
            query.account_id,
            query.api_key_id,
        )
        .await
        .map(Json)
        .map_err(internal_error)
}

async fn get_tenant_usage_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UsageSummaryQuery>,
) -> Result<Json<UsageSummaryQueryResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_tenant_principal(&state, &headers).await?;
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let summary = usage_repo
        .query_summary(
            query.start_ts,
            query.end_ts,
            Some(principal.tenant_id),
            query.account_id,
            query.api_key_id,
        )
        .await
        .map_err(internal_error)?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "tenant_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: Some(principal.tenant_id),
            action: "tenant.usage.summary.get".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("usage_summary".to_string()),
            target_id: None,
            payload_json: json!({
                "start_ts": query.start_ts,
                "end_ts": query.end_ts,
                "account_id": query.account_id,
                "api_key_id": query.api_key_id,
                "account_total_requests": summary.account_total_requests,
                "tenant_api_key_total_requests": summary.tenant_api_key_total_requests,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(summary))
}

async fn get_usage_hourly_trends(
    State(state): State<AppState>,
    Query(query): Query<UsageHourlyTrendsQuery>,
) -> Result<Json<UsageHourlyTrendsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let usage = validate_usage_query(query.start_ts, query.end_ts, query.limit)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let (account_totals, tenant_api_key_totals, summary) = tokio::try_join!(
        usage_repo.query_hourly_account_totals(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            query.account_id,
        ),
        usage_repo.query_hourly_tenant_api_key_totals(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            query.tenant_id,
            query.api_key_id,
        ),
        usage_repo.query_summary(
            usage.start_ts,
            usage.end_ts,
            query.tenant_id,
            query.account_id,
            query.api_key_id,
        ),
    )
    .map_err(internal_error)?;

    Ok(Json(UsageHourlyTrendsResponse {
        start_ts: usage.start_ts,
        end_ts: usage.end_ts,
        account_totals,
        tenant_api_key_totals,
        dashboard_metrics: summary.dashboard_metrics,
    }))
}

async fn get_tenant_usage_hourly_trends(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UsageHourlyTrendsQuery>,
) -> Result<Json<UsageHourlyTrendsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_tenant_principal(&state, &headers).await?;
    let usage = validate_usage_query(query.start_ts, query.end_ts, query.limit)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let (account_totals, tenant_api_key_totals, summary) = tokio::try_join!(
        usage_repo.query_hourly_account_totals(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            query.account_id,
        ),
        usage_repo.query_hourly_tenant_api_key_totals(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            Some(principal.tenant_id),
            query.api_key_id,
        ),
        usage_repo.query_summary(
            usage.start_ts,
            usage.end_ts,
            Some(principal.tenant_id),
            query.account_id,
            query.api_key_id,
        ),
    )
    .map_err(internal_error)?;
    let response = UsageHourlyTrendsResponse {
        start_ts: usage.start_ts,
        end_ts: usage.end_ts,
        account_totals: account_totals.clone(),
        tenant_api_key_totals: tenant_api_key_totals.clone(),
        dashboard_metrics: summary.dashboard_metrics,
    };
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "tenant_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: Some(principal.tenant_id),
            action: "tenant.usage.trends.hourly.get".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("usage_trends_hourly".to_string()),
            target_id: None,
            payload_json: json!({
                "start_ts": usage.start_ts,
                "end_ts": usage.end_ts,
                "limit": usage.limit,
                "account_id": query.account_id,
                "api_key_id": query.api_key_id,
                "account_series_points": response.account_totals.len(),
                "tenant_api_key_series_points": response.tenant_api_key_totals.len(),
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(response))
}

async fn get_admin_usage_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UsageSummaryQuery>,
) -> Result<Json<UsageSummaryQueryResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let summary = usage_repo
        .query_summary(
            query.start_ts,
            query.end_ts,
            query.tenant_id,
            query.account_id,
            query.api_key_id,
        )
        .await
        .map_err(internal_error)?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: query.tenant_id,
            action: "admin.usage.summary.get".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("usage_summary".to_string()),
            target_id: None,
            payload_json: json!({
                "start_ts": query.start_ts,
                "end_ts": query.end_ts,
                "tenant_id": query.tenant_id,
                "account_id": query.account_id,
                "api_key_id": query.api_key_id,
                "account_total_requests": summary.account_total_requests,
                "tenant_api_key_total_requests": summary.tenant_api_key_total_requests,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(summary))
}

async fn get_admin_usage_hourly_trends(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UsageHourlyTrendsQuery>,
) -> Result<Json<UsageHourlyTrendsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let usage = validate_usage_query(query.start_ts, query.end_ts, query.limit)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let (account_totals, tenant_api_key_totals, summary) = tokio::try_join!(
        usage_repo.query_hourly_account_totals(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            query.account_id,
        ),
        usage_repo.query_hourly_tenant_api_key_totals(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            query.tenant_id,
            query.api_key_id,
        ),
        usage_repo.query_summary(
            usage.start_ts,
            usage.end_ts,
            query.tenant_id,
            query.account_id,
            query.api_key_id,
        ),
    )
    .map_err(internal_error)?;
    let response = UsageHourlyTrendsResponse {
        start_ts: usage.start_ts,
        end_ts: usage.end_ts,
        account_totals: account_totals.clone(),
        tenant_api_key_totals: tenant_api_key_totals.clone(),
        dashboard_metrics: summary.dashboard_metrics,
    };
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: query.tenant_id,
            action: "admin.usage.trends.hourly.get".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("usage_trends_hourly".to_string()),
            target_id: None,
            payload_json: json!({
                "start_ts": usage.start_ts,
                "end_ts": usage.end_ts,
                "limit": usage.limit,
                "tenant_id": query.tenant_id,
                "account_id": query.account_id,
                "api_key_id": query.api_key_id,
                "account_series_points": response.account_totals.len(),
                "tenant_api_key_series_points": response.tenant_api_key_totals.len(),
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(response))
}

async fn get_usage_hourly_tenant_trends(
    State(state): State<AppState>,
    Query(query): Query<UsageHourlyTenantTrendsQuery>,
) -> Result<Json<UsageHourlyTenantTrendsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let usage = validate_usage_query(query.start_ts, query.end_ts, query.limit)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    usage_repo
        .query_hourly_tenant_totals(
            usage.start_ts,
            usage.end_ts,
            usage.limit,
            query.tenant_id,
            query.api_key_id,
        )
        .await
        .map(|items| {
            Json(UsageHourlyTenantTrendsResponse {
                start_ts: usage.start_ts,
                end_ts: usage.end_ts,
                items,
            })
        })
        .map_err(internal_error)
}

async fn get_tenant_usage_leaderboard(
    State(state): State<AppState>,
    Query(query): Query<UsageTenantLeaderboardQuery>,
) -> Result<Json<TenantUsageLeaderboardResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let limit = query.limit.min(MAX_USAGE_LEADERBOARD_LIMIT);

    usage_repo
        .query_tenant_leaderboard(query.start_ts, query.end_ts, limit, query.tenant_id)
        .await
        .map(|items| {
            Json(TenantUsageLeaderboardResponse {
                start_ts: query.start_ts,
                end_ts: query.end_ts,
                items,
            })
        })
        .map_err(internal_error)
}

async fn get_tenant_scope_tenant_usage_leaderboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UsageTenantLeaderboardQuery>,
) -> Result<Json<TenantUsageLeaderboardResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_tenant_principal(&state, &headers).await?;
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;
    let limit = query.limit.min(MAX_USAGE_LEADERBOARD_LIMIT);

    usage_repo
        .query_tenant_leaderboard(
            query.start_ts,
            query.end_ts,
            limit,
            Some(principal.tenant_id),
        )
        .await
        .map(|items| {
            Json(TenantUsageLeaderboardResponse {
                start_ts: query.start_ts,
                end_ts: query.end_ts,
                items,
            })
        })
        .map_err(internal_error)
}

async fn get_account_usage_leaderboard(
    State(state): State<AppState>,
    Query(query): Query<UsageAccountLeaderboardQuery>,
) -> Result<Json<AccountUsageLeaderboardResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let limit = query.limit.min(MAX_USAGE_LEADERBOARD_LIMIT);

    usage_repo
        .query_account_leaderboard(query.start_ts, query.end_ts, limit, query.account_id)
        .await
        .map(|items| {
            Json(AccountUsageLeaderboardResponse {
                start_ts: query.start_ts,
                end_ts: query.end_ts,
                items,
            })
        })
        .map_err(internal_error)
}

async fn get_tenant_scope_account_usage_leaderboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UsageAccountLeaderboardQuery>,
) -> Result<Json<AccountUsageLeaderboardResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_tenant_principal(&state, &headers).await?;
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;
    let limit = query.limit.min(MAX_USAGE_LEADERBOARD_LIMIT);

    usage_repo
        .query_tenant_scoped_account_leaderboard(
            query.start_ts,
            query.end_ts,
            limit,
            principal.tenant_id,
            query.account_id,
        )
        .await
        .map(|items| {
            Json(AccountUsageLeaderboardResponse {
                start_ts: query.start_ts,
                end_ts: query.end_ts,
                items,
            })
        })
        .map_err(internal_error)
}

async fn get_api_key_usage_leaderboard(
    State(state): State<AppState>,
    Query(query): Query<UsageApiKeyLeaderboardQuery>,
) -> Result<Json<ApiKeyUsageLeaderboardResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let limit = query.limit.min(MAX_USAGE_LEADERBOARD_LIMIT);

    usage_repo
        .query_api_key_leaderboard(
            query.start_ts,
            query.end_ts,
            limit,
            query.tenant_id,
            query.api_key_id,
        )
        .await
        .map(|items| {
            Json(ApiKeyUsageLeaderboardResponse {
                start_ts: query.start_ts,
                end_ts: query.end_ts,
                items,
            })
        })
        .map_err(internal_error)
}

async fn get_tenant_scope_api_key_usage_leaderboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<UsageApiKeyLeaderboardQuery>,
) -> Result<Json<ApiKeyUsageLeaderboardResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_tenant_principal(&state, &headers).await?;
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;
    let limit = query.limit.min(MAX_USAGE_LEADERBOARD_LIMIT);

    usage_repo
        .query_api_key_leaderboard(
            query.start_ts,
            query.end_ts,
            limit,
            Some(principal.tenant_id),
            query.api_key_id,
        )
        .await
        .map(|items| {
            Json(ApiKeyUsageLeaderboardResponse {
                start_ts: query.start_ts,
                end_ts: query.end_ts,
                items,
            })
        })
        .map_err(internal_error)
}

async fn get_usage_leaderboard_overview(
    State(state): State<AppState>,
    Query(query): Query<UsageLeaderboardOverviewQuery>,
) -> Result<Json<UsageLeaderboardOverviewResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    validate_usage_range(query.start_ts, query.end_ts)?;

    let usage_repo = state
        .usage_repo
        .as_ref()
        .ok_or_else(usage_repo_unavailable_error)?;

    let global_limit = query.limit.min(MAX_USAGE_LEADERBOARD_LIMIT);
    let tenant_limit = query
        .tenant_limit
        .unwrap_or(global_limit)
        .min(MAX_USAGE_LEADERBOARD_LIMIT);
    let account_limit = query
        .account_limit
        .unwrap_or(global_limit)
        .min(MAX_USAGE_LEADERBOARD_LIMIT);
    let api_key_limit = query
        .api_key_limit
        .unwrap_or(global_limit)
        .min(MAX_USAGE_LEADERBOARD_LIMIT);

    let (tenants, accounts, api_keys, summary) = if query.include_summary {
        let (tenants, accounts, api_keys, summary) = tokio::try_join!(
            usage_repo.query_tenant_leaderboard(
                query.start_ts,
                query.end_ts,
                tenant_limit,
                query.tenant_id
            ),
            usage_repo.query_account_leaderboard(
                query.start_ts,
                query.end_ts,
                account_limit,
                query.account_id
            ),
            usage_repo.query_api_key_leaderboard(
                query.start_ts,
                query.end_ts,
                api_key_limit,
                query.api_key_tenant_id,
                query.api_key_id,
            ),
            usage_repo.query_summary(
                query.start_ts,
                query.end_ts,
                query.api_key_tenant_id.or(query.tenant_id),
                query.account_id,
                query.api_key_id,
            ),
        )
        .map_err(internal_error)?;

        (tenants, accounts, api_keys, Some(summary))
    } else {
        let (tenants, accounts, api_keys) = tokio::try_join!(
            usage_repo.query_tenant_leaderboard(
                query.start_ts,
                query.end_ts,
                tenant_limit,
                query.tenant_id
            ),
            usage_repo.query_account_leaderboard(
                query.start_ts,
                query.end_ts,
                account_limit,
                query.account_id
            ),
            usage_repo.query_api_key_leaderboard(
                query.start_ts,
                query.end_ts,
                api_key_limit,
                query.api_key_tenant_id,
                query.api_key_id,
            ),
        )
        .map_err(internal_error)?;

        (tenants, accounts, api_keys, None)
    };

    Ok(Json(UsageLeaderboardOverviewResponse {
        start_ts: query.start_ts,
        end_ts: query.end_ts,
        tenants,
        accounts,
        api_keys,
        summary,
    }))
}
