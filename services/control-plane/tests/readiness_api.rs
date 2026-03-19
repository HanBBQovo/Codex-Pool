use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use control_plane::app::{
    build_app as cp_build_app,
    build_app_with_store_ttl_and_usage_repo as cp_build_app_with_store_ttl_and_usage_repo,
    DEFAULT_AUTH_VALIDATE_CACHE_TTL_SEC,
};
use control_plane::store::{ControlPlaneStore, InMemoryStore};
use control_plane::usage::UsageQueryRepository;
use serde_json::Value;
use tower::ServiceExt;

use crate::support;

fn build_app() -> axum::Router {
    support::ensure_test_security_env();
    cp_build_app()
}

fn build_app_with_store_ttl_and_usage_repo(
    store: Arc<dyn ControlPlaneStore>,
    auth_validate_cache_ttl_sec: u64,
    usage_repo: Option<Arc<dyn UsageQueryRepository>>,
) -> axum::Router {
    support::ensure_test_security_env();
    cp_build_app_with_store_ttl_and_usage_repo(store, auth_validate_cache_ttl_sec, usage_repo)
}

#[tokio::test]
async fn readyz_returns_200_and_reports_usage_repo_unavailable_when_usage_repo_is_missing() {
    let app = build_app();

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["usage_repo_available"], false);
    assert_eq!(
        json["auth_validate_cache_ttl_sec"],
        DEFAULT_AUTH_VALIDATE_CACHE_TTL_SEC
    );
}

#[tokio::test]
async fn readyz_returns_200_and_reports_usage_repo_available_when_usage_repo_is_configured() {
    let store: Arc<dyn ControlPlaneStore> = Arc::new(InMemoryStore::default());
    let usage_repo = support::available_usage_repo();
    let app = build_app_with_store_ttl_and_usage_repo(store, 99, Some(usage_repo));

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let json: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["usage_repo_available"], true);
    assert_eq!(json["auth_validate_cache_ttl_sec"], 99);
}
