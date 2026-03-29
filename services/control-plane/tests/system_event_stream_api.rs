use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use codex_pool_core::events::{
    RequestLogEvent, SystemEventCategory, SystemEventSeverity, SystemEventWrite,
};
use control_plane::admin_auth::AdminAuthService;
use control_plane::app::{
    build_app_with_store_and_services, AppBuildServices, DEFAULT_AUTH_VALIDATE_CACHE_TTL_SEC,
};
use control_plane::contracts::{
    SystemEventCorrelationResponse, SystemEventDetailResponse, SystemEventListResponse,
    SystemEventSummaryResponse,
};
use control_plane::import_jobs::InMemoryOAuthImportJobStore;
use control_plane::outbound_proxy_runtime::OutboundProxyRuntime;
use control_plane::store::{ControlPlaneStore, InMemoryStore};
use control_plane::system_events::{sqlite_repo::SqliteSystemEventRepo, SystemEventRepository};
use control_plane::usage::sqlite_repo::SqliteUsageRepo;
use serde_json::json;
#[cfg(feature = "postgres-backend")]
use sqlx_core::query::query;
#[cfg(feature = "postgres-backend")]
use sqlx_postgres::PgPoolOptions;
use sqlx_sqlite::SqlitePool;
use tower::ServiceExt;
use uuid::Uuid;

use crate::support;

async fn login_admin_token(app: &axum::Router) -> String {
    let login_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/admin/auth/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "username": "admin",
                        "password": "admin123456"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login_response.status(), StatusCode::OK);
    let login_body = to_bytes(login_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let login_json: serde_json::Value = serde_json::from_slice(&login_body).unwrap();
    login_json["access_token"].as_str().unwrap().to_string()
}

fn build_app_with_event_repo(
    store: Arc<dyn ControlPlaneStore>,
    sqlite_usage_repo: Arc<SqliteUsageRepo>,
    event_repo: Arc<dyn SystemEventRepository>,
) -> axum::Router {
    support::ensure_test_security_env();
    build_app_with_store_and_services(
        store,
        AppBuildServices {
            auth_validate_cache_ttl_sec: DEFAULT_AUTH_VALIDATE_CACHE_TTL_SEC,
            usage_repo: Some(sqlite_usage_repo.clone()),
            usage_ingest_repo: Some(sqlite_usage_repo),
            import_job_store: Arc::new(InMemoryOAuthImportJobStore::default()),
            admin_auth: AdminAuthService::from_env().unwrap(),
            system_capabilities: codex_pool_core::api::SystemCapabilitiesResponse::for_edition(
                codex_pool_core::api::ProductEdition::Personal,
            ),
            tenant_auth_service: None,
            sqlite_usage_repo: None,
            outbound_proxy_runtime: Arc::new(OutboundProxyRuntime::new()),
            system_event_repo: Some(event_repo),
        },
    )
}

#[cfg(feature = "postgres-backend")]
fn test_db_url() -> Option<String> {
    std::env::var("CONTROL_PLANE_DATABASE_URL")
        .ok()
        .or_else(|| std::env::var("DATABASE_URL").ok())
}

#[cfg(feature = "postgres-backend")]
fn admin_db_url(database_url: &str) -> String {
    let mut parsed = reqwest::Url::parse(database_url).expect("valid postgres database url");
    parsed.set_path("/postgres");
    parsed.to_string()
}

#[cfg(feature = "postgres-backend")]
fn quoted_database_identifier(database_name: &str) -> String {
    assert!(
        database_name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '_'),
        "database name must stay ASCII-safe for quoted SQL identifiers"
    );
    format!("\"{database_name}\"")
}

#[cfg(feature = "postgres-backend")]
fn child_database_url(database_url: &str, database_name: &str) -> String {
    let mut parsed = reqwest::Url::parse(database_url).expect("valid postgres database url");
    parsed.set_path(&format!("/{database_name}"));
    parsed.to_string()
}

#[cfg(feature = "postgres-backend")]
async fn create_temp_database(database_url: &str, database_name: &str) {
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_db_url(database_url))
        .await
        .expect("connect admin postgres");
    let quoted_name = quoted_database_identifier(database_name);
    query(&format!("DROP DATABASE IF EXISTS {quoted_name}"))
        .execute(&admin_pool)
        .await
        .expect("drop leftover temp database");
    query(&format!("CREATE DATABASE {quoted_name}"))
        .execute(&admin_pool)
        .await
        .expect("create temp database");
    admin_pool.close().await;
}

#[cfg(feature = "postgres-backend")]
async fn drop_temp_database(database_url: &str, database_name: &str) {
    let admin_pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_db_url(database_url))
        .await
        .expect("connect admin postgres");
    query(
        r#"
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
        "#,
    )
    .bind(database_name)
    .execute(&admin_pool)
    .await
    .expect("terminate temp database connections");
    let quoted_name = quoted_database_identifier(database_name);
    query(&format!("DROP DATABASE IF EXISTS {quoted_name}"))
        .execute(&admin_pool)
        .await
        .expect("drop temp database");
    admin_pool.close().await;
}

fn sample_event(request_id: &str) -> SystemEventWrite {
    SystemEventWrite {
        event_id: Some(Uuid::new_v4()),
        ts: Some(Utc::now()),
        category: SystemEventCategory::Request,
        event_type: "request_completed".to_string(),
        severity: SystemEventSeverity::Info,
        source: "data_plane.http".to_string(),
        tenant_id: None,
        account_id: Some(Uuid::new_v4()),
        request_id: Some(request_id.to_string()),
        trace_request_id: Some("trace-1".to_string()),
        job_id: Some(Uuid::new_v4()),
        account_label: Some("oauth-test@example.com".to_string()),
        auth_provider: Some("legacy_bearer".to_string()),
        operator_state_from: Some("routable".to_string()),
        operator_state_to: Some("routable".to_string()),
        reason_class: Some("healthy".to_string()),
        reason_code: Some("request_completed".to_string()),
        next_action_at: Some(Utc::now() + Duration::minutes(5)),
        path: Some("/v1/responses".to_string()),
        method: Some("POST".to_string()),
        model: Some("gpt-5.4".to_string()),
        selected_account_id: Some(Uuid::new_v4()),
        selected_proxy_id: Some(Uuid::new_v4()),
        routing_decision: Some("recent_success".to_string()),
        failover_scope: Some("none".to_string()),
        status_code: Some(200),
        upstream_status_code: Some(200),
        latency_ms: Some(1234),
        message: Some("request completed".to_string()),
        preview_text: Some("tool call preview".to_string()),
        payload_json: Some(json!({
            "secret": "cp_super_secret_value_should_not_leak",
            "upstream_body": "response.created with too much content"
        })),
        secret_preview: Some("cp_sup...eak".to_string()),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn admin_event_stream_lists_details_summary_and_correlation() {
    support::ensure_test_security_env();
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    let usage_repo = Arc::new(SqliteUsageRepo::new(pool.clone()).await.unwrap());
    let event_repo = Arc::new(SqliteSystemEventRepo::new(pool).await.unwrap());
    let request_id = "req-event-stream-1";
    let inserted = event_repo
        .insert_event(sample_event(request_id))
        .await
        .unwrap();

    let app = build_app_with_event_repo(
        Arc::new(InMemoryStore::default()),
        usage_repo,
        event_repo.clone(),
    );
    let admin_token = login_admin_token(&app).await;

    let list_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/v1/admin/event-stream?request_id={request_id}&category=request"
                ))
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(list_response.status(), StatusCode::OK);
    let list_body = to_bytes(list_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let list_json: SystemEventListResponse = serde_json::from_slice(&list_body).unwrap();
    assert_eq!(list_json.items.len(), 1);
    assert_eq!(list_json.items[0].id, inserted.id);
    assert_eq!(list_json.items[0].request_id.as_deref(), Some(request_id));

    let detail_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/v1/admin/event-stream/{}", inserted.id))
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(detail_response.status(), StatusCode::OK);
    let detail_body = to_bytes(detail_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let detail_json: SystemEventDetailResponse = serde_json::from_slice(&detail_body).unwrap();
    assert_eq!(detail_json.item.id, inserted.id);
    assert_eq!(
        detail_json.item.secret_preview.as_deref(),
        Some("cp_sup...eak")
    );

    let summary_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/v1/admin/event-stream/summary")
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(summary_response.status(), StatusCode::OK);
    let summary_body = to_bytes(summary_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let summary_json: SystemEventSummaryResponse = serde_json::from_slice(&summary_body).unwrap();
    assert!(summary_json
        .by_category
        .iter()
        .any(|item| item.category == SystemEventCategory::Request && item.count >= 1));

    let correlation_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!(
                    "/api/v1/admin/event-stream/correlation/{request_id}"
                ))
                .header("authorization", format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(correlation_response.status(), StatusCode::OK);
    let correlation_body = to_bytes(correlation_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let correlation_json: SystemEventCorrelationResponse =
        serde_json::from_slice(&correlation_body).unwrap();
    assert_eq!(correlation_json.request_id, request_id);
    assert_eq!(correlation_json.items.len(), 1);
}

#[tokio::test(flavor = "current_thread")]
async fn sqlite_system_event_repo_redacts_payload_preview_fields() {
    support::ensure_test_security_env();
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    let repo = SqliteSystemEventRepo::new(pool).await.unwrap();

    let stored = repo
        .insert_event(SystemEventWrite {
            message: Some("failed to use key cp_abcdefghijklmnopqrstuvwxyz".to_string()),
            preview_text: Some("Authorization: Bearer sk-super-secret-value".to_string()),
            payload_json: Some(json!({
                "api_key": "cp_abcdefghijklmnopqrstuvwxyz",
                "access_token": "sk-super-secret-value",
                "nested": {
                    "prompt": "very long prompt that should only remain as preview"
                }
            })),
            ..sample_event("req-redact-1")
        })
        .await
        .unwrap();

    assert_eq!(stored.secret_preview.as_deref(), Some("cp_sup...eak"));
    let payload = stored.payload_json.expect("payload should remain");
    assert_ne!(
        payload["api_key"].as_str(),
        Some("cp_abcdefghijklmnopqrstuvwxyz")
    );
    assert_ne!(
        payload["access_token"].as_str(),
        Some("sk-super-secret-value")
    );
}

#[tokio::test(flavor = "current_thread")]
async fn internal_request_log_ingest_also_writes_system_event() {
    support::ensure_test_security_env();
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    let usage_repo = Arc::new(SqliteUsageRepo::new(pool.clone()).await.unwrap());
    let event_repo = Arc::new(SqliteSystemEventRepo::new(pool).await.unwrap());
    let app = build_app_with_event_repo(
        Arc::new(InMemoryStore::default()),
        usage_repo,
        event_repo.clone(),
    );
    let request_id = "req-system-event-from-request-log";
    let payload = RequestLogEvent {
        id: Uuid::new_v4(),
        account_id: Uuid::new_v4(),
        tenant_id: Some(Uuid::new_v4()),
        api_key_id: Some(Uuid::new_v4()),
        event_version: 2,
        path: "/v1/responses".to_string(),
        method: "POST".to_string(),
        status_code: 429,
        latency_ms: 4567,
        is_stream: true,
        error_code: Some("rate_limited".to_string()),
        request_id: Some(request_id.to_string()),
        model: Some("gpt-5.4".to_string()),
        service_tier: Some("priority".to_string()),
        input_tokens: Some(120),
        cached_input_tokens: Some(4),
        output_tokens: Some(42),
        reasoning_tokens: Some(3),
        first_token_latency_ms: Some(400),
        billing_phase: Some("captured".to_string()),
        authorization_id: None,
        capture_status: Some("captured".to_string()),
        created_at: Utc::now(),
    };

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/v1/usage/request-logs")
                .header(
                    "authorization",
                    format!("Bearer {}", support::internal_service_token()),
                )
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&payload).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);

    let stored = event_repo
        .correlate_request(
            request_id,
            control_plane::system_events::SystemEventQuery {
                category: Some(SystemEventCategory::Request),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(stored.items.len(), 1);
    let event = &stored.items[0];
    assert_eq!(event.event_type, "request_failed");
    assert_eq!(event.reason_class.as_deref(), Some("quota"));
    assert_eq!(event.reason_code.as_deref(), Some("rate_limited"));
    assert_eq!(event.status_code, Some(429));
    assert_eq!(event.latency_ms, Some(4567));
}

#[cfg(feature = "postgres-backend")]
#[tokio::test(flavor = "current_thread")]
async fn admin_event_stream_works_with_postgres_repository() {
    use control_plane::system_events::postgres_repo::PostgresSystemEventRepo;

    let Some(base_url) = test_db_url() else {
        eprintln!(
            "skip admin_event_stream_works_with_postgres_repository: set CONTROL_PLANE_DATABASE_URL"
        );
        return;
    };

    let database_name = format!("cp_event_stream_{}", Uuid::new_v4().simple());
    create_temp_database(&base_url, &database_name).await;
    let db_url = child_database_url(&base_url, &database_name);

    let result = async {
        let usage_pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let usage_repo = Arc::new(SqliteUsageRepo::new(usage_pool).await.unwrap());
        let event_pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&db_url)
            .await
            .unwrap();
        let event_repo = Arc::new(PostgresSystemEventRepo::new(event_pool).await.unwrap());
        let request_id = "req-event-stream-pg-1";
        let inserted = event_repo
            .insert_event(sample_event(request_id))
            .await
            .unwrap();

        let app = build_app_with_event_repo(
            Arc::new(InMemoryStore::default()),
            usage_repo,
            event_repo.clone(),
        );
        let admin_token = login_admin_token(&app).await;

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/api/v1/admin/event-stream/{}", inserted.id))
                    .header("authorization", format!("Bearer {admin_token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let detail_json: SystemEventDetailResponse = serde_json::from_slice(&body).unwrap();
        assert_eq!(detail_json.item.id, inserted.id);
        assert_eq!(detail_json.item.request_id.as_deref(), Some(request_id));
    }
    .await;

    drop_temp_database(&base_url, &database_name).await;
    result
}
