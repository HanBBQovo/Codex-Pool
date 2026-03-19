use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use axum::body::Body;
use axum::http::header::{self, HeaderValue};
use axum::http::{Response, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::Router;
use codex_pool_core::events::RequestLogEvent;
use data_plane::app::{
    build_app_without_status_or_internal_metrics_routes,
    build_embedded_app_with_event_sink_without_status_or_internal_metrics_routes,
};
use data_plane::config::DataPlaneConfig;
use data_plane::event::EventSink;
use include_dir::{include_dir, Dir, File};

use crate::store::{ControlPlaneStore, SqliteBackedStore};
use crate::usage::UsageIngestRepository;

const CONTROL_PLANE_LISTEN_ENV: &str = "CONTROL_PLANE_LISTEN";
const CODEX_OAUTH_CALLBACK_LISTEN_ENV: &str = "CODEX_OAUTH_CALLBACK_LISTEN";
const CODEX_OAUTH_CALLBACK_LISTEN_MODE_ENV: &str = "CODEX_OAUTH_CALLBACK_LISTEN_MODE";
const CONTROL_PLANE_BASE_URL_ENV: &str = "CONTROL_PLANE_BASE_URL";
const AUTH_VALIDATE_URL_ENV: &str = "AUTH_VALIDATE_URL";
const AUTH_VALIDATE_PATH: &str = "/internal/v1/auth/validate";

static PERSONAL_FRONTEND_DIR: Dir<'_> = include_dir!("$OUT_DIR/personal_frontend");

struct EmbeddedUsageIngestEventSink {
    repo: Arc<dyn UsageIngestRepository>,
}

#[async_trait]
impl EventSink for EmbeddedUsageIngestEventSink {
    async fn emit_request_log(&self, event: RequestLogEvent) {
        if let Err(error) = self.repo.ingest_request_log(event).await {
            tracing::warn!(error = %error, "personal runtime request log ingest failed");
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SingleBinaryRuntimeEnvDefaults {
    pub control_plane_listen: String,
    pub codex_oauth_callback_listen: String,
    pub control_plane_base_url: String,
    pub auth_validate_url: String,
}

pub fn apply_single_binary_runtime_env_defaults(
    listen_addr: SocketAddr,
) -> SingleBinaryRuntimeEnvDefaults {
    let defaults = single_binary_runtime_env_defaults(listen_addr);
    std::env::set_var(CONTROL_PLANE_LISTEN_ENV, &defaults.control_plane_listen);
    std::env::set_var(
        CODEX_OAUTH_CALLBACK_LISTEN_ENV,
        &defaults.codex_oauth_callback_listen,
    );
    std::env::set_var(CODEX_OAUTH_CALLBACK_LISTEN_MODE_ENV, "always");
    std::env::set_var(CONTROL_PLANE_BASE_URL_ENV, &defaults.control_plane_base_url);
    std::env::set_var(AUTH_VALIDATE_URL_ENV, &defaults.auth_validate_url);
    defaults
}

pub async fn merge_single_binary_app(control_plane_app: Router) -> Result<Router> {
    let data_plane_config = DataPlaneConfig::from_env()?;
    let data_plane_app =
        build_app_without_status_or_internal_metrics_routes(data_plane_config).await?;
    Ok(control_plane_app
        .merge(data_plane_app)
        .fallback(single_binary_frontend_fallback))
}

pub async fn merge_personal_single_binary_app(
    control_plane_app: Router,
    sqlite_store: Arc<SqliteBackedStore>,
    usage_ingest_repo: Arc<dyn UsageIngestRepository>,
) -> Result<Router> {
    let data_plane_config = DataPlaneConfig::from_env()?;
    let event_sink: Arc<dyn EventSink> = Arc::new(EmbeddedUsageIngestEventSink {
        repo: usage_ingest_repo,
    });
    let (data_plane_app, data_plane_state) =
        build_embedded_app_with_event_sink_without_status_or_internal_metrics_routes(
            data_plane_config,
            event_sink,
        )
        .await?;
    let initial_snapshot = sqlite_store.snapshot().await?;
    data_plane_state.apply_snapshot(initial_snapshot);

    let mut revision_rx = sqlite_store.subscribe_revisions();
    let sync_store = sqlite_store.clone();
    let sync_state = data_plane_state.clone();
    tokio::spawn(async move {
        let mut last_revision = *revision_rx.borrow();
        loop {
            if revision_rx.changed().await.is_err() {
                break;
            }

            let revision = *revision_rx.borrow();
            if revision <= last_revision {
                continue;
            }
            last_revision = revision;

            match sync_store.snapshot().await {
                Ok(snapshot) => sync_state.apply_snapshot(snapshot),
                Err(error) => {
                    tracing::warn!(error = %error, revision, "personal runtime snapshot sync failed");
                }
            }
        }
    });

    Ok(control_plane_app
        .merge(data_plane_app)
        .fallback(single_binary_frontend_fallback))
}

fn single_binary_runtime_env_defaults(listen_addr: SocketAddr) -> SingleBinaryRuntimeEnvDefaults {
    let origin = single_binary_loopback_origin(listen_addr);
    let listen = listen_addr.to_string();

    SingleBinaryRuntimeEnvDefaults {
        control_plane_listen: listen.clone(),
        codex_oauth_callback_listen: listen,
        control_plane_base_url: origin.clone(),
        auth_validate_url: format!("{origin}{AUTH_VALIDATE_PATH}"),
    }
}

fn single_binary_loopback_origin(listen_addr: SocketAddr) -> String {
    let host = match listen_addr {
        SocketAddr::V4(addr) => {
            let ip = if addr.ip().is_unspecified() {
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            } else {
                IpAddr::V4(*addr.ip())
            };
            ip.to_string()
        }
        SocketAddr::V6(addr) => {
            let ip = if addr.ip().is_unspecified() {
                IpAddr::V6(Ipv6Addr::LOCALHOST)
            } else {
                IpAddr::V6(*addr.ip())
            };
            format!("[{ip}]")
        }
    };

    format!("http://{host}:{}", listen_addr.port())
}

async fn single_binary_frontend_fallback(uri: Uri) -> Response<Body> {
    single_binary_frontend_response(uri.path())
}

fn single_binary_frontend_response(path: &str) -> Response<Body> {
    if is_backend_route(path) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let normalized = normalize_frontend_asset_path(path);
    if let Some(file) = PERSONAL_FRONTEND_DIR.get_file(&normalized) {
        return file_response(file);
    }

    if should_fallback_to_html_shell(path) {
        if let Some(index_file) = PERSONAL_FRONTEND_DIR.get_file("index.html") {
            return file_response(index_file);
        }
    }

    StatusCode::NOT_FOUND.into_response()
}

fn normalize_frontend_asset_path(path: &str) -> String {
    let trimmed = path.trim_start_matches('/');
    if trimmed.is_empty() {
        "index.html".to_string()
    } else {
        trimmed.to_string()
    }
}

fn should_fallback_to_html_shell(path: &str) -> bool {
    let trimmed = path.trim_start_matches('/');
    trimmed.is_empty() || Path::new(trimmed).extension().is_none()
}

fn is_backend_route(path: &str) -> bool {
    [
        "/api/",
        "/internal/",
        "/v1/",
        "/backend-api/",
        "/health",
        "/livez",
        "/readyz",
    ]
    .into_iter()
    .any(|prefix| path == prefix.trim_end_matches('/') || path.starts_with(prefix))
}

fn file_response(file: &File<'_>) -> Response<Body> {
    let mut response = Response::new(Body::from(file.contents().to_vec()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(content_type_for(file.path())),
    );
    response
}

fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js") => "application/javascript; charset=utf-8",
        Some("json") | Some("map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("webp") => "image/webp",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_single_binary_runtime_env_defaults, merge_personal_single_binary_app,
        merge_single_binary_app, single_binary_frontend_response,
        single_binary_runtime_env_defaults,
    };
    use std::sync::Arc;

    use axum::body::to_bytes;
    use axum::http::Request;
    use axum::http::{header, StatusCode};
    use axum::Router;
    use codex_pool_core::api::{CreateUpstreamAccountRequest, UsageSummary};
    use codex_pool_core::model::{UpstreamAuthProvider, UpstreamMode};
    use tower::util::ServiceExt;

    use crate::store::{normalize_sqlite_database_url, ControlPlaneStore, SqliteBackedStore};
    use crate::usage::sqlite_repo::SqliteUsageRepo;

    #[test]
    fn single_binary_runtime_env_defaults_force_loopback_for_unspecified_v4() {
        let defaults = single_binary_runtime_env_defaults("0.0.0.0:8090".parse().unwrap());

        assert_eq!(defaults.control_plane_listen, "0.0.0.0:8090");
        assert_eq!(defaults.codex_oauth_callback_listen, "0.0.0.0:8090");
        assert_eq!(defaults.control_plane_base_url, "http://127.0.0.1:8090");
        assert_eq!(
            defaults.auth_validate_url,
            "http://127.0.0.1:8090/internal/v1/auth/validate"
        );
    }

    #[test]
    fn single_binary_frontend_response_rejects_backend_like_paths() {
        let response = single_binary_frontend_response("/api/v1/unknown");

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn single_binary_frontend_response_serves_html_shell_for_spa_routes() {
        let response = single_binary_frontend_response("/accounts");

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read frontend body");
        assert!(!body.is_empty());
    }

    #[tokio::test]
    async fn merged_personal_app_exposes_control_plane_data_plane_and_frontend_shell() {
        assert_merged_single_binary_app("personal").await;
    }

    #[tokio::test]
    async fn merged_team_app_exposes_control_plane_data_plane_and_frontend_shell() {
        assert_merged_single_binary_app("team").await;
    }

    #[tokio::test]
    async fn merged_personal_app_tracks_store_updates_without_http_snapshot_poller() {
        let _guard = crate::test_support::ENV_LOCK.lock().await;
        let old_admin_username = crate::test_support::set_env("ADMIN_USERNAME", Some("admin"));
        let old_admin_password = crate::test_support::set_env("ADMIN_PASSWORD", Some("password"));
        let old_admin_secret =
            crate::test_support::set_env("ADMIN_JWT_SECRET", Some("test-secret-123"));
        let old_internal_auth = crate::test_support::set_env(
            "CONTROL_PLANE_INTERNAL_AUTH_TOKEN",
            Some("test-internal-token"),
        );
        let old_edition = crate::test_support::set_env("CODEX_POOL_EDITION", Some("personal"));
        let old_control_plane_listen = crate::test_support::set_env("CONTROL_PLANE_LISTEN", None);
        let old_callback_listen = crate::test_support::set_env("CODEX_OAUTH_CALLBACK_LISTEN", None);
        let old_callback_mode =
            crate::test_support::set_env("CODEX_OAUTH_CALLBACK_LISTEN_MODE", None);
        let old_control_plane_base_url =
            crate::test_support::set_env("CONTROL_PLANE_BASE_URL", None);
        let old_auth_validate_url = crate::test_support::set_env("AUTH_VALIDATE_URL", None);
        let db_path = std::env::temp_dir().join(format!(
            "codex-pool-personal-runtime-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let db_url = normalize_sqlite_database_url(&db_path.display().to_string());
        let old_database_url =
            crate::test_support::set_env("CONTROL_PLANE_DATABASE_URL", Some(&db_url));
        let missing_config = std::env::temp_dir().join(format!(
            "codex-pool-personal-runtime-config-{}.toml",
            uuid::Uuid::new_v4()
        ));
        let old_config_file = crate::test_support::set_env(
            "CODEX_POOL_CONFIG_FILE",
            Some(missing_config.to_string_lossy().as_ref()),
        );
        let old_data_plane_config_file = crate::test_support::set_env(
            "DATA_PLANE_CONFIG_FILE",
            Some(missing_config.to_string_lossy().as_ref()),
        );

        apply_single_binary_runtime_env_defaults("127.0.0.1:8090".parse().unwrap());
        let store = Arc::new(
            SqliteBackedStore::connect(&db_url)
                .await
                .expect("connect sqlite store"),
        );
        let usage_repo = Arc::new(
            SqliteUsageRepo::new(store.clone_pool())
                .await
                .expect("connect sqlite usage repo"),
        );
        let app = crate::app::build_app_with_store(store.clone());
        let merged = merge_personal_single_binary_app(app, store.clone(), usage_repo)
            .await
            .expect("merge personal single-binary app");

        let initial_usage = fetch_usage_summary(&merged).await;
        assert_eq!(initial_usage.account_total, 0);

        store
            .create_upstream_account(CreateUpstreamAccountRequest {
                label: "personal-upstream".to_string(),
                mode: UpstreamMode::OpenAiApiKey,
                base_url: "https://api.openai.com".to_string(),
                bearer_token: "test-token".to_string(),
                chatgpt_account_id: None,
                auth_provider: Some(UpstreamAuthProvider::LegacyBearer),
                enabled: Some(true),
                priority: Some(10),
            })
            .await
            .expect("create upstream account");

        let usage = wait_for_usage_account_total(&merged, 1).await;
        assert_eq!(usage.account_total, 1);
        assert_eq!(usage.active_account_total, 1);

        crate::test_support::set_env("ADMIN_USERNAME", old_admin_username.as_deref());
        crate::test_support::set_env("ADMIN_PASSWORD", old_admin_password.as_deref());
        crate::test_support::set_env("ADMIN_JWT_SECRET", old_admin_secret.as_deref());
        crate::test_support::set_env(
            "CONTROL_PLANE_INTERNAL_AUTH_TOKEN",
            old_internal_auth.as_deref(),
        );
        crate::test_support::set_env("CODEX_POOL_EDITION", old_edition.as_deref());
        crate::test_support::set_env("CONTROL_PLANE_LISTEN", old_control_plane_listen.as_deref());
        crate::test_support::set_env(
            "CODEX_OAUTH_CALLBACK_LISTEN",
            old_callback_listen.as_deref(),
        );
        crate::test_support::set_env(
            "CODEX_OAUTH_CALLBACK_LISTEN_MODE",
            old_callback_mode.as_deref(),
        );
        crate::test_support::set_env(
            "CONTROL_PLANE_BASE_URL",
            old_control_plane_base_url.as_deref(),
        );
        crate::test_support::set_env("AUTH_VALIDATE_URL", old_auth_validate_url.as_deref());
        crate::test_support::set_env("CONTROL_PLANE_DATABASE_URL", old_database_url.as_deref());
        crate::test_support::set_env("CODEX_POOL_CONFIG_FILE", old_config_file.as_deref());
        crate::test_support::set_env(
            "DATA_PLANE_CONFIG_FILE",
            old_data_plane_config_file.as_deref(),
        );
    }

    async fn assert_merged_single_binary_app(edition: &str) {
        let _guard = crate::test_support::ENV_LOCK.lock().await;
        let missing_config = std::env::temp_dir().join(format!(
            "codex-pool-personal-missing-{}.toml",
            uuid::Uuid::new_v4()
        ));
        let old_admin_username = crate::test_support::set_env("ADMIN_USERNAME", Some("admin"));
        let old_admin_password = crate::test_support::set_env("ADMIN_PASSWORD", Some("password"));
        let old_admin_secret =
            crate::test_support::set_env("ADMIN_JWT_SECRET", Some("test-secret-123"));
        let old_internal_auth = crate::test_support::set_env(
            "CONTROL_PLANE_INTERNAL_AUTH_TOKEN",
            Some("test-internal-token"),
        );
        let old_edition = crate::test_support::set_env("CODEX_POOL_EDITION", Some(edition));
        let old_control_plane_listen = crate::test_support::set_env("CONTROL_PLANE_LISTEN", None);
        let old_callback_listen = crate::test_support::set_env("CODEX_OAUTH_CALLBACK_LISTEN", None);
        let old_callback_mode =
            crate::test_support::set_env("CODEX_OAUTH_CALLBACK_LISTEN_MODE", None);
        let old_control_plane_base_url =
            crate::test_support::set_env("CONTROL_PLANE_BASE_URL", None);
        let old_auth_validate_url = crate::test_support::set_env("AUTH_VALIDATE_URL", None);
        let old_config_file = crate::test_support::set_env(
            "CODEX_POOL_CONFIG_FILE",
            Some(missing_config.to_string_lossy().as_ref()),
        );
        let old_data_plane_config_file = crate::test_support::set_env(
            "DATA_PLANE_CONFIG_FILE",
            Some(missing_config.to_string_lossy().as_ref()),
        );

        apply_single_binary_runtime_env_defaults("127.0.0.1:8090".parse().unwrap());
        let app = crate::app::build_app();
        let merged = merge_single_binary_app(app)
            .await
            .expect("merge single-binary app");

        let health = merged
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .expect("health response");
        assert_eq!(health.status(), StatusCode::OK);

        let models = merged
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/models")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .expect("models response");
        assert_eq!(models.status(), StatusCode::UNAUTHORIZED);

        let shell = merged
            .oneshot(
                Request::builder()
                    .uri("/")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .expect("shell response");
        assert_eq!(shell.status(), StatusCode::OK);
        assert_eq!(
            shell.headers().get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );

        crate::test_support::set_env("ADMIN_USERNAME", old_admin_username.as_deref());
        crate::test_support::set_env("ADMIN_PASSWORD", old_admin_password.as_deref());
        crate::test_support::set_env("ADMIN_JWT_SECRET", old_admin_secret.as_deref());
        crate::test_support::set_env(
            "CONTROL_PLANE_INTERNAL_AUTH_TOKEN",
            old_internal_auth.as_deref(),
        );
        crate::test_support::set_env("CODEX_POOL_EDITION", old_edition.as_deref());
        crate::test_support::set_env("CONTROL_PLANE_LISTEN", old_control_plane_listen.as_deref());
        crate::test_support::set_env(
            "CODEX_OAUTH_CALLBACK_LISTEN",
            old_callback_listen.as_deref(),
        );
        crate::test_support::set_env(
            "CODEX_OAUTH_CALLBACK_LISTEN_MODE",
            old_callback_mode.as_deref(),
        );
        crate::test_support::set_env(
            "CONTROL_PLANE_BASE_URL",
            old_control_plane_base_url.as_deref(),
        );
        crate::test_support::set_env("AUTH_VALIDATE_URL", old_auth_validate_url.as_deref());
        crate::test_support::set_env("CODEX_POOL_CONFIG_FILE", old_config_file.as_deref());
        crate::test_support::set_env(
            "DATA_PLANE_CONFIG_FILE",
            old_data_plane_config_file.as_deref(),
        );
    }

    async fn wait_for_usage_account_total(app: &Router, expected_total: usize) -> UsageSummary {
        for _ in 0..20 {
            let usage = fetch_usage_summary(app).await;
            if usage.account_total == expected_total {
                return usage;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        fetch_usage_summary(app).await
    }

    async fn fetch_usage_summary(app: &Router) -> UsageSummary {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/codex/usage")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .expect("usage response");
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read usage body");
        serde_json::from_slice(&body).expect("decode usage summary")
    }
}
