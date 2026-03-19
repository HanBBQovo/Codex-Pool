async fn internal_metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<(StatusCode, HeaderMap, String), (StatusCode, Json<ErrorEnvelope>)> {
    require_internal_service_token(&state, &headers)?;

    let billing_runtime = crate::tenant::billing_reconcile_runtime_snapshot();
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
    );

    let mut body = String::new();
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_started_at_unix",
        state.started_at.timestamp() as f64,
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_usage_repo_available",
        bool_to_metric_value(state.usage_repo.is_some()),
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_usage_ingest_repo_available",
        bool_to_metric_value(state.usage_ingest_repo.is_some()),
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_auth_validate_cache_ttl_sec",
        state.auth_validate_cache_ttl_sec as f64,
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_system_capability_multi_tenant",
        bool_to_metric_value(state.system_capabilities.allows_multi_tenant()),
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_system_capability_credit_billing",
        bool_to_metric_value(state.system_capabilities.allows_credit_billing()),
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_billing_reconcile_scanned_total",
        billing_runtime.billing_reconcile_scanned_total as f64,
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_billing_reconcile_adjust_total",
        billing_runtime.billing_reconcile_adjust_total as f64,
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_billing_reconcile_failed_total",
        billing_runtime.billing_reconcile_failed_total as f64,
    );
    append_control_plane_metric_line(
        &mut body,
        "codex_control_plane_billing_reconcile_released_total",
        billing_runtime.billing_reconcile_released_total as f64,
    );

    Ok((StatusCode::OK, response_headers, body))
}

fn append_control_plane_metric_line(body: &mut String, name: &str, value: f64) {
    use std::fmt::Write as _;

    let _ = writeln!(body, "{name} {value}");
}

fn bool_to_metric_value(value: bool) -> f64 {
    if value { 1.0 } else { 0.0 }
}
