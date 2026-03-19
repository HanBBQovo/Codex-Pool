use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use control_plane::admin_auth::AdminAuthService;
use control_plane::app::build_app_with_store_ttl_usage_repos_import_store_and_admin_auth;
use control_plane::import_jobs::InMemoryOAuthImportJobStore;
use control_plane::store::{ControlPlaneStore, InMemoryStore};
use tower::ServiceExt;

use crate::support;

fn build_app_with_usage_repos(
    usage_repo_enabled: bool,
    usage_ingest_repo_enabled: bool,
) -> axum::Router {
    support::ensure_test_security_env();
    let store: Arc<dyn ControlPlaneStore> = Arc::new(InMemoryStore::default());
    let usage_repo = usage_repo_enabled.then(support::available_usage_repo);
    let usage_ingest_repo = usage_ingest_repo_enabled.then(support::available_usage_ingest_repo);
    let admin_auth = AdminAuthService::from_env().expect("admin auth from env");

    build_app_with_store_ttl_usage_repos_import_store_and_admin_auth(
        store,
        77,
        usage_repo,
        usage_ingest_repo,
        Arc::new(InMemoryOAuthImportJobStore::default()),
        admin_auth,
    )
}

#[tokio::test]
async fn internal_metrics_requires_internal_bearer_token() {
    let app = build_app_with_usage_repos(false, false);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/internal/v1/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn internal_metrics_returns_prometheus_payload() {
    let app = build_app_with_usage_repos(true, true);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/internal/v1/metrics")
                .header(
                    "authorization",
                    format!("Bearer {}", support::internal_service_token()),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(content_type.contains("text/plain"));

    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload = String::from_utf8(body.to_vec()).unwrap();
    assert!(payload.contains("codex_control_plane_started_at_unix "));
    assert!(payload.contains("codex_control_plane_usage_repo_available 1"));
    assert!(payload.contains("codex_control_plane_usage_ingest_repo_available 1"));
    assert!(payload.contains("codex_control_plane_auth_validate_cache_ttl_sec 77"));
    assert!(payload.contains("codex_control_plane_system_capability_multi_tenant"));
    assert!(payload.contains("codex_control_plane_system_capability_credit_billing"));
    assert!(payload.contains("codex_control_plane_billing_reconcile_scanned_total 0"));
    assert!(payload.contains("codex_control_plane_billing_reconcile_adjust_total 0"));
    assert!(payload.contains("codex_control_plane_billing_reconcile_failed_total 0"));
    assert!(payload.contains("codex_control_plane_billing_reconcile_released_total 0"));
}
