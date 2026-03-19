use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use crate::crypto::CREDENTIALS_ENCRYPTION_KEY_ENV;

const DEFAULT_CONFIG_FILE_PATH: &str = "config.toml";
const GLOBAL_CONFIG_FILE_ENV: &str = "CODEX_POOL_CONFIG_FILE";
const CONTROL_PLANE_CONFIG_FILE_ENV: &str = "CONTROL_PLANE_CONFIG_FILE";
const USAGE_WORKER_CONFIG_FILE_ENV: &str = "USAGE_WORKER_CONFIG_FILE";
const DEFAULT_LISTEN_ADDR: &str = "0.0.0.0:8090";
const DEFAULT_CLICKHOUSE_DATABASE: &str = "default";
const DEFAULT_CLICKHOUSE_ACCOUNT_TABLE: &str = "usage_account_hourly";
const DEFAULT_CLICKHOUSE_TENANT_APIKEY_TABLE: &str = "usage_tenant_api_key_hourly";
const DEFAULT_CLICKHOUSE_TENANT_ACCOUNT_TABLE: &str = "usage_tenant_account_hourly";
const DEFAULT_CLICKHOUSE_REQUEST_LOG_TABLE: &str = "request_log_events";
const DEFAULT_OAUTH_REFRESH_INTERVAL_SEC: u64 = 5;
const DEFAULT_OAUTH_REFRESH_ENABLED: bool = true;

#[derive(Debug, Clone)]
pub struct ControlPlaneConfig {
    pub listen_addr: SocketAddr,
    pub database_url: Option<String>,
    pub auth_validate_cache_ttl_sec: u64,
    pub clickhouse_url: Option<String>,
    pub clickhouse_database: String,
    pub clickhouse_account_table: String,
    pub clickhouse_tenant_apikey_table: String,
    pub clickhouse_tenant_account_table: String,
    pub clickhouse_request_log_table: String,
    pub credentials_encryption_key: Option<String>,
    pub control_plane_public_base_url: Option<String>,
    pub openai_oauth_token_url: Option<String>,
    pub openai_oauth_authorize_url: Option<String>,
    pub openai_oauth_client_id: Option<String>,
    pub openai_oauth_timeout_sec: Option<u64>,
    pub oauth_refresh_enabled: bool,
    pub oauth_refresh_interval_sec: u64,
    pub admin_username: Option<String>,
    pub admin_password: Option<String>,
    pub admin_jwt_secret: Option<String>,
    pub admin_jwt_ttl_sec: Option<u64>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
    pub smtp_from_name: Option<String>,
    pub smtp_timeout_sec: Option<u64>,
    pub smtp_insecure: Option<bool>,
}

impl ControlPlaneConfig {
    pub fn from_env(default_auth_validate_cache_ttl_sec: u64) -> anyhow::Result<Self> {
        let config_path = resolve_config_path(CONTROL_PLANE_CONFIG_FILE_ENV);
        let file_config = load_file_config(&config_path)?;

        let listen_addr = parse_listen_addr(
            std::env::var("CONTROL_PLANE_LISTEN")
                .ok()
                .as_deref()
                .or(file_config.listen.as_deref()),
        )?;
        let database_url = std::env::var("CONTROL_PLANE_DATABASE_URL")
            .ok()
            .or(file_config.database_url);
        let auth_validate_cache_ttl_sec = parse_u64_env_with_fallback(
            "AUTH_VALIDATE_CACHE_TTL_SEC",
            file_config.auth_validate_cache_ttl_sec,
            default_auth_validate_cache_ttl_sec,
        );

        let clickhouse_url = std::env::var("CLICKHOUSE_URL")
            .ok()
            .or(file_config.clickhouse_url);
        let clickhouse_database = std::env::var("CLICKHOUSE_DATABASE")
            .ok()
            .or(file_config.clickhouse_database)
            .unwrap_or_else(|| DEFAULT_CLICKHOUSE_DATABASE.to_string());
        let legacy_usage_table = std::env::var("CLICKHOUSE_USAGE_TABLE")
            .ok()
            .or(file_config.clickhouse_usage_table);
        let clickhouse_account_table = std::env::var("CLICKHOUSE_ACCOUNT_TABLE")
            .ok()
            .or(file_config.clickhouse_account_table)
            .or(legacy_usage_table)
            .unwrap_or_else(|| DEFAULT_CLICKHOUSE_ACCOUNT_TABLE.to_string());
        let clickhouse_tenant_apikey_table = std::env::var("CLICKHOUSE_TENANT_APIKEY_TABLE")
            .ok()
            .or(file_config.clickhouse_tenant_apikey_table)
            .unwrap_or_else(|| DEFAULT_CLICKHOUSE_TENANT_APIKEY_TABLE.to_string());
        let clickhouse_tenant_account_table = std::env::var("CLICKHOUSE_TENANT_ACCOUNT_TABLE")
            .ok()
            .or(file_config.clickhouse_tenant_account_table)
            .unwrap_or_else(|| DEFAULT_CLICKHOUSE_TENANT_ACCOUNT_TABLE.to_string());
        let clickhouse_request_log_table = std::env::var("CLICKHOUSE_REQUEST_LOG_TABLE")
            .ok()
            .or(file_config.clickhouse_request_log_table)
            .unwrap_or_else(|| DEFAULT_CLICKHOUSE_REQUEST_LOG_TABLE.to_string());

        let credentials_encryption_key = std::env::var(CREDENTIALS_ENCRYPTION_KEY_ENV)
            .ok()
            .or(file_config.credentials_encryption_key);
        let control_plane_public_base_url = std::env::var("CONTROL_PLANE_PUBLIC_BASE_URL")
            .ok()
            .or(file_config.control_plane_public_base_url);
        let openai_oauth_token_url = std::env::var("OPENAI_OAUTH_TOKEN_URL")
            .ok()
            .or(file_config.openai_oauth_token_url);
        let openai_oauth_authorize_url = std::env::var("OPENAI_OAUTH_AUTHORIZE_URL")
            .ok()
            .or(file_config.openai_oauth_authorize_url);
        let openai_oauth_client_id = std::env::var("OPENAI_OAUTH_CLIENT_ID")
            .ok()
            .or(file_config.openai_oauth_client_id);
        let openai_oauth_timeout_sec = std::env::var("OPENAI_OAUTH_TIMEOUT_SEC")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .or(file_config.openai_oauth_timeout_sec);
        let oauth_refresh_enabled = parse_bool_env_with_fallback(
            "CONTROL_PLANE_OAUTH_REFRESH_ENABLED",
            file_config.oauth_refresh_enabled,
            DEFAULT_OAUTH_REFRESH_ENABLED,
        );
        let oauth_refresh_interval_sec = parse_u64_env_with_fallback(
            "CONTROL_PLANE_OAUTH_REFRESH_INTERVAL_SEC",
            file_config.oauth_refresh_interval_sec,
            DEFAULT_OAUTH_REFRESH_INTERVAL_SEC,
        );
        let admin_username = std::env::var("ADMIN_USERNAME")
            .ok()
            .or(file_config.admin_username);
        let admin_password = std::env::var("ADMIN_PASSWORD")
            .ok()
            .or(file_config.admin_password);
        let admin_jwt_secret = std::env::var("ADMIN_JWT_SECRET")
            .ok()
            .or(file_config.admin_jwt_secret);
        let admin_jwt_ttl_sec = std::env::var("ADMIN_JWT_TTL_SEC")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .or(file_config.admin_jwt_ttl_sec);
        let smtp_host = std::env::var("SMTP_HOST").ok().or(file_config.smtp_host);
        let smtp_port = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|raw| raw.parse::<u16>().ok())
            .or(file_config.smtp_port);
        let smtp_username = std::env::var("SMTP_USERNAME")
            .ok()
            .or(file_config.smtp_username);
        let smtp_password = std::env::var("SMTP_PASSWORD")
            .ok()
            .or(file_config.smtp_password);
        let smtp_from = std::env::var("SMTP_FROM").ok().or(file_config.smtp_from);
        let smtp_from_name = std::env::var("SMTP_FROM_NAME")
            .ok()
            .or(file_config.smtp_from_name);
        let smtp_timeout_sec = std::env::var("SMTP_TIMEOUT_SEC")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .or(file_config.smtp_timeout_sec);
        let smtp_insecure = std::env::var("SMTP_INSECURE")
            .ok()
            .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
                "1" | "true" | "yes" | "on" => Some(true),
                "0" | "false" | "no" | "off" => Some(false),
                _ => None,
            })
            .or(file_config.smtp_insecure);

        Ok(Self {
            listen_addr,
            database_url,
            auth_validate_cache_ttl_sec,
            clickhouse_url,
            clickhouse_database,
            clickhouse_account_table,
            clickhouse_tenant_apikey_table,
            clickhouse_tenant_account_table,
            clickhouse_request_log_table,
            credentials_encryption_key,
            control_plane_public_base_url,
            openai_oauth_token_url,
            openai_oauth_authorize_url,
            openai_oauth_client_id,
            openai_oauth_timeout_sec,
            oauth_refresh_enabled,
            oauth_refresh_interval_sec,
            admin_username,
            admin_password,
            admin_jwt_secret,
            admin_jwt_ttl_sec,
            smtp_host,
            smtp_port,
            smtp_username,
            smtp_password,
            smtp_from,
            smtp_from_name,
            smtp_timeout_sec,
            smtp_insecure,
        })
    }

    pub fn apply_runtime_env_defaults(&self) {
        set_env_if_absent(
            CREDENTIALS_ENCRYPTION_KEY_ENV,
            self.credentials_encryption_key.clone(),
        );
        set_env_if_absent(
            "CONTROL_PLANE_PUBLIC_BASE_URL",
            self.control_plane_public_base_url.clone(),
        );
        set_env_if_absent(
            "OPENAI_OAUTH_TOKEN_URL",
            self.openai_oauth_token_url.clone(),
        );
        set_env_if_absent(
            "OPENAI_OAUTH_AUTHORIZE_URL",
            self.openai_oauth_authorize_url.clone(),
        );
        set_env_if_absent(
            "OPENAI_OAUTH_CLIENT_ID",
            self.openai_oauth_client_id.clone(),
        );
        set_env_if_absent(
            "OPENAI_OAUTH_TIMEOUT_SEC",
            self.openai_oauth_timeout_sec.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "CONTROL_PLANE_OAUTH_REFRESH_ENABLED",
            Some(self.oauth_refresh_enabled.to_string()),
        );
        set_env_if_absent(
            "CONTROL_PLANE_OAUTH_REFRESH_INTERVAL_SEC",
            Some(self.oauth_refresh_interval_sec.to_string()),
        );
        set_env_if_absent("ADMIN_USERNAME", self.admin_username.clone());
        set_env_if_absent("ADMIN_PASSWORD", self.admin_password.clone());
        set_env_if_absent("ADMIN_JWT_SECRET", self.admin_jwt_secret.clone());
        set_env_if_absent(
            "ADMIN_JWT_TTL_SEC",
            self.admin_jwt_ttl_sec.map(|value| value.to_string()),
        );
        set_env_if_absent("SMTP_HOST", self.smtp_host.clone());
        set_env_if_absent("SMTP_PORT", self.smtp_port.map(|value| value.to_string()));
        set_env_if_absent("SMTP_USERNAME", self.smtp_username.clone());
        set_env_if_absent("SMTP_PASSWORD", self.smtp_password.clone());
        set_env_if_absent("SMTP_FROM", self.smtp_from.clone());
        set_env_if_absent("SMTP_FROM_NAME", self.smtp_from_name.clone());
        set_env_if_absent(
            "SMTP_TIMEOUT_SEC",
            self.smtp_timeout_sec.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "SMTP_INSECURE",
            self.smtp_insecure.map(|value| value.to_string()),
        );
    }
}

pub fn apply_usage_worker_runtime_env_defaults_from_config() -> anyhow::Result<()> {
    let config_path = resolve_config_path(USAGE_WORKER_CONFIG_FILE_ENV);
    let file_config = load_usage_worker_file_config(&config_path)?;
    file_config.apply_runtime_env_defaults();
    Ok(())
}

#[derive(Debug, Default, serde::Deserialize)]
struct ControlPlaneTomlRoot {
    #[serde(default)]
    control_plane: ControlPlaneTomlConfig,
}

#[derive(Debug, Default, serde::Deserialize)]
struct ControlPlaneTomlConfig {
    #[serde(default)]
    listen: Option<String>,
    #[serde(default)]
    database_url: Option<String>,
    #[serde(default)]
    auth_validate_cache_ttl_sec: Option<u64>,
    #[serde(default)]
    clickhouse_url: Option<String>,
    #[serde(default)]
    clickhouse_database: Option<String>,
    #[serde(default)]
    clickhouse_usage_table: Option<String>,
    #[serde(default)]
    clickhouse_account_table: Option<String>,
    #[serde(default)]
    clickhouse_tenant_apikey_table: Option<String>,
    #[serde(default)]
    clickhouse_tenant_account_table: Option<String>,
    #[serde(default)]
    clickhouse_request_log_table: Option<String>,
    #[serde(default)]
    credentials_encryption_key: Option<String>,
    #[serde(default)]
    control_plane_public_base_url: Option<String>,
    #[serde(default)]
    openai_oauth_token_url: Option<String>,
    #[serde(default)]
    openai_oauth_authorize_url: Option<String>,
    #[serde(default)]
    openai_oauth_client_id: Option<String>,
    #[serde(default)]
    openai_oauth_timeout_sec: Option<u64>,
    #[serde(default)]
    oauth_refresh_enabled: Option<bool>,
    #[serde(default)]
    oauth_refresh_interval_sec: Option<u64>,
    #[serde(default)]
    admin_username: Option<String>,
    #[serde(default)]
    admin_password: Option<String>,
    #[serde(default)]
    admin_jwt_secret: Option<String>,
    #[serde(default)]
    admin_jwt_ttl_sec: Option<u64>,
    #[serde(default)]
    smtp_host: Option<String>,
    #[serde(default)]
    smtp_port: Option<u16>,
    #[serde(default)]
    smtp_username: Option<String>,
    #[serde(default)]
    smtp_password: Option<String>,
    #[serde(default)]
    smtp_from: Option<String>,
    #[serde(default)]
    smtp_from_name: Option<String>,
    #[serde(default)]
    smtp_timeout_sec: Option<u64>,
    #[serde(default)]
    smtp_insecure: Option<bool>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct UsageWorkerTomlRoot {
    #[serde(default)]
    usage_worker: UsageWorkerTomlConfig,
}

#[derive(Debug, Default, serde::Deserialize)]
struct UsageWorkerTomlConfig {
    #[serde(default)]
    redis_url: Option<String>,
    #[serde(default)]
    clickhouse_url: Option<String>,
    #[serde(default)]
    usage_worker_mode: Option<String>,
    #[serde(default)]
    usage_worker_report_json: Option<bool>,
    #[serde(default)]
    usage_worker_report_path: Option<String>,
    #[serde(default)]
    request_log_stream: Option<String>,
    #[serde(default)]
    request_log_dead_letter_stream: Option<String>,
    #[serde(default)]
    request_log_consumer_group: Option<String>,
    #[serde(default)]
    request_log_consumer_name: Option<String>,
    #[serde(default)]
    stream_read_count: Option<u64>,
    #[serde(default)]
    stream_block_ms: Option<u64>,
    #[serde(default)]
    reclaim_count: Option<u64>,
    #[serde(default)]
    reclaim_min_idle_ms: Option<u64>,
    #[serde(default)]
    flush_min_batch: Option<u64>,
    #[serde(default)]
    flush_interval_ms: Option<u64>,
    #[serde(default)]
    metrics_log_interval_ms: Option<u64>,
    #[serde(default)]
    error_backoff_ms: Option<u64>,
    #[serde(default)]
    error_backoff_factor: Option<u32>,
    #[serde(default)]
    error_backoff_max_ms: Option<u64>,
    #[serde(default)]
    error_backoff_jitter_pct: Option<u32>,
    #[serde(default)]
    error_backoff_jitter_seed: Option<u64>,
    #[serde(default)]
    max_consecutive_errors: Option<u32>,
    #[serde(default)]
    clickhouse_database: Option<String>,
    #[serde(default)]
    clickhouse_account_table: Option<String>,
    #[serde(default)]
    clickhouse_tenant_apikey_table: Option<String>,
    #[serde(default)]
    clickhouse_tenant_account_table: Option<String>,
    #[serde(default)]
    clickhouse_request_log_table: Option<String>,
    #[serde(default)]
    clickhouse_usage_table: Option<String>,
}

impl UsageWorkerTomlConfig {
    fn apply_runtime_env_defaults(&self) {
        set_env_if_absent("REDIS_URL", self.redis_url.clone());
        set_env_if_absent("CLICKHOUSE_URL", self.clickhouse_url.clone());
        set_env_if_absent("USAGE_WORKER_MODE", self.usage_worker_mode.clone());
        set_env_if_absent(
            "USAGE_WORKER_REPORT_JSON",
            self.usage_worker_report_json.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "USAGE_WORKER_REPORT_PATH",
            self.usage_worker_report_path.clone(),
        );
        set_env_if_absent("REQUEST_LOG_STREAM", self.request_log_stream.clone());
        set_env_if_absent(
            "REQUEST_LOG_DEAD_LETTER_STREAM",
            self.request_log_dead_letter_stream.clone(),
        );
        set_env_if_absent(
            "REQUEST_LOG_CONSUMER_GROUP",
            self.request_log_consumer_group.clone(),
        );
        set_env_if_absent(
            "REQUEST_LOG_CONSUMER_NAME",
            self.request_log_consumer_name.clone(),
        );
        set_env_if_absent(
            "STREAM_READ_COUNT",
            self.stream_read_count.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "STREAM_BLOCK_MS",
            self.stream_block_ms.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "RECLAIM_COUNT",
            self.reclaim_count.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "RECLAIM_MIN_IDLE_MS",
            self.reclaim_min_idle_ms.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "FLUSH_MIN_BATCH",
            self.flush_min_batch.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "FLUSH_INTERVAL_MS",
            self.flush_interval_ms.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "METRICS_LOG_INTERVAL_MS",
            self.metrics_log_interval_ms.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "ERROR_BACKOFF_MS",
            self.error_backoff_ms.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "ERROR_BACKOFF_FACTOR",
            self.error_backoff_factor.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "ERROR_BACKOFF_MAX_MS",
            self.error_backoff_max_ms.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "ERROR_BACKOFF_JITTER_PCT",
            self.error_backoff_jitter_pct.map(|value| value.to_string()),
        );
        set_env_if_absent(
            "ERROR_BACKOFF_JITTER_SEED",
            self.error_backoff_jitter_seed
                .map(|value| value.to_string()),
        );
        set_env_if_absent(
            "MAX_CONSECUTIVE_ERRORS",
            self.max_consecutive_errors.map(|value| value.to_string()),
        );
        set_env_if_absent("CLICKHOUSE_DATABASE", self.clickhouse_database.clone());
        set_env_if_absent(
            "CLICKHOUSE_ACCOUNT_TABLE",
            self.clickhouse_account_table.clone(),
        );
        set_env_if_absent(
            "CLICKHOUSE_TENANT_APIKEY_TABLE",
            self.clickhouse_tenant_apikey_table.clone(),
        );
        set_env_if_absent(
            "CLICKHOUSE_TENANT_ACCOUNT_TABLE",
            self.clickhouse_tenant_account_table.clone(),
        );
        set_env_if_absent(
            "CLICKHOUSE_REQUEST_LOG_TABLE",
            self.clickhouse_request_log_table.clone(),
        );
        set_env_if_absent(
            "CLICKHOUSE_USAGE_TABLE",
            self.clickhouse_usage_table.clone(),
        );
    }
}

fn resolve_config_path(service_override_env: &str) -> PathBuf {
    std::env::var(service_override_env)
        .ok()
        .or_else(|| std::env::var(GLOBAL_CONFIG_FILE_ENV).ok())
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_CONFIG_FILE_PATH))
}

fn load_file_config(path: &Path) -> anyhow::Result<ControlPlaneTomlConfig> {
    if !path.exists() {
        return Ok(ControlPlaneTomlConfig::default());
    }

    let raw = std::fs::read_to_string(path)?;
    let parsed: ControlPlaneTomlRoot = toml::from_str(&raw)?;
    Ok(parsed.control_plane)
}

fn load_usage_worker_file_config(path: &Path) -> anyhow::Result<UsageWorkerTomlConfig> {
    if !path.exists() {
        return Ok(UsageWorkerTomlConfig::default());
    }

    let raw = std::fs::read_to_string(path)?;
    let parsed: UsageWorkerTomlRoot = toml::from_str(&raw)?;
    Ok(parsed.usage_worker)
}

fn parse_listen_addr(raw: Option<&str>) -> anyhow::Result<SocketAddr> {
    Ok(raw.unwrap_or(DEFAULT_LISTEN_ADDR).parse()?)
}

fn parse_u64_env_with_fallback(key: &str, fallback: Option<u64>, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .or(fallback)
        .unwrap_or(default)
}

fn parse_bool_env_with_fallback(key: &str, fallback: Option<bool>, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .and_then(|raw| match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        })
        .or(fallback)
        .unwrap_or(default)
}

fn set_env_if_absent(key: &str, value: Option<String>) {
    if std::env::var_os(key).is_some() {
        return;
    }

    if let Some(value) = value.filter(|item| !item.trim().is_empty()) {
        std::env::set_var(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_usage_worker_runtime_env_defaults_from_config, ControlPlaneConfig};
    use crate::test_support::{set_env, ENV_LOCK};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{}-{nanos}.toml", std::process::id()))
    }

    #[test]
    fn reads_control_plane_toml_and_respects_env_priority() {
        let _guard = ENV_LOCK.blocking_lock();
        let path = unique_temp_path("control-plane-config");
        std::fs::write(
            &path,
            r#"
[control_plane]
listen = "127.0.0.1:19090"
database_url = "postgres://toml"
auth_validate_cache_ttl_sec = 55
clickhouse_url = "http://127.0.0.1:8123"
clickhouse_database = "toml_db"
clickhouse_account_table = "account_toml"
clickhouse_tenant_apikey_table = "tenant_toml"
clickhouse_tenant_account_table = "tenant_account_toml"
control_plane_public_base_url = "https://cp.toml.example.com"
openai_oauth_authorize_url = "https://auth.toml.example.com/oauth/authorize"
openai_oauth_client_id = "client-from-toml"
oauth_refresh_enabled = false
oauth_refresh_interval_sec = 45
admin_username = "admin-from-toml"
admin_password = "password-from-toml"
admin_jwt_secret = "jwt-secret-from-toml"
admin_jwt_ttl_sec = 600
"#,
        )
        .expect("write toml");

        let old_config_file = set_env(
            "CONTROL_PLANE_CONFIG_FILE",
            Some(path.display().to_string().as_str()),
        );
        let old_listen = set_env("CONTROL_PLANE_LISTEN", Some("127.0.0.1:29090"));
        let old_clickhouse_database = set_env("CLICKHOUSE_DATABASE", Some("env_db"));
        let old_admin_username = set_env("ADMIN_USERNAME", Some("admin-from-env"));
        let old_admin_password = set_env("ADMIN_PASSWORD", None);
        let old_admin_jwt_secret = set_env("ADMIN_JWT_SECRET", None);
        let old_admin_jwt_ttl = set_env("ADMIN_JWT_TTL_SEC", None);
        let old_oauth_refresh_enabled = set_env("CONTROL_PLANE_OAUTH_REFRESH_ENABLED", None);
        let old_oauth_refresh_interval = set_env("CONTROL_PLANE_OAUTH_REFRESH_INTERVAL_SEC", None);

        let cfg = ControlPlaneConfig::from_env(30).expect("load config");

        set_env("CONTROL_PLANE_CONFIG_FILE", old_config_file.as_deref());
        set_env("CONTROL_PLANE_LISTEN", old_listen.as_deref());
        set_env("CLICKHOUSE_DATABASE", old_clickhouse_database.as_deref());
        set_env("ADMIN_USERNAME", old_admin_username.as_deref());
        set_env("ADMIN_PASSWORD", old_admin_password.as_deref());
        set_env("ADMIN_JWT_SECRET", old_admin_jwt_secret.as_deref());
        set_env("ADMIN_JWT_TTL_SEC", old_admin_jwt_ttl.as_deref());
        set_env(
            "CONTROL_PLANE_OAUTH_REFRESH_ENABLED",
            old_oauth_refresh_enabled.as_deref(),
        );
        set_env(
            "CONTROL_PLANE_OAUTH_REFRESH_INTERVAL_SEC",
            old_oauth_refresh_interval.as_deref(),
        );
        std::fs::remove_file(path).expect("cleanup toml");

        assert_eq!(cfg.listen_addr, "127.0.0.1:29090".parse().unwrap());
        assert_eq!(cfg.database_url.as_deref(), Some("postgres://toml"));
        assert_eq!(cfg.auth_validate_cache_ttl_sec, 55);
        assert_eq!(cfg.clickhouse_database, "env_db");
        assert_eq!(cfg.clickhouse_account_table, "account_toml");
        assert_eq!(cfg.clickhouse_tenant_apikey_table, "tenant_toml");
        assert_eq!(cfg.clickhouse_tenant_account_table, "tenant_account_toml");
        assert_eq!(
            cfg.control_plane_public_base_url.as_deref(),
            Some("https://cp.toml.example.com")
        );
        assert_eq!(
            cfg.openai_oauth_authorize_url.as_deref(),
            Some("https://auth.toml.example.com/oauth/authorize")
        );
        assert_eq!(
            cfg.openai_oauth_client_id.as_deref(),
            Some("client-from-toml")
        );
        assert!(!cfg.oauth_refresh_enabled);
        assert_eq!(cfg.oauth_refresh_interval_sec, 45);
        assert_eq!(cfg.admin_username.as_deref(), Some("admin-from-env"));
        assert_eq!(cfg.admin_password.as_deref(), Some("password-from-toml"));
        assert_eq!(
            cfg.admin_jwt_secret.as_deref(),
            Some("jwt-secret-from-toml")
        );
        assert_eq!(cfg.admin_jwt_ttl_sec, Some(600));
    }

    #[test]
    fn control_plane_toml_applies_admin_runtime_defaults_without_overriding_env() {
        let _guard = ENV_LOCK.blocking_lock();
        let path = unique_temp_path("control-plane-admin-config");
        std::fs::write(
            &path,
            r#"
[control_plane]
admin_username = "admin-from-toml"
admin_password = "password-from-toml"
admin_jwt_secret = "jwt-secret-from-toml"
admin_jwt_ttl_sec = 900
"#,
        )
        .expect("write toml");

        let old_config_file = set_env(
            "CONTROL_PLANE_CONFIG_FILE",
            Some(path.display().to_string().as_str()),
        );
        let old_admin_username = set_env("ADMIN_USERNAME", None);
        let old_admin_password = set_env("ADMIN_PASSWORD", Some("password-from-env"));
        let old_admin_jwt_secret = set_env("ADMIN_JWT_SECRET", None);
        let old_admin_jwt_ttl = set_env("ADMIN_JWT_TTL_SEC", None);
        let old_oauth_refresh_enabled = set_env("CONTROL_PLANE_OAUTH_REFRESH_ENABLED", None);
        let old_oauth_refresh_interval = set_env("CONTROL_PLANE_OAUTH_REFRESH_INTERVAL_SEC", None);

        let cfg = ControlPlaneConfig::from_env(30).expect("load config");
        cfg.apply_runtime_env_defaults();

        assert_eq!(
            std::env::var("ADMIN_USERNAME").ok().as_deref(),
            Some("admin-from-toml"),
        );
        assert_eq!(
            std::env::var("ADMIN_PASSWORD").ok().as_deref(),
            Some("password-from-env"),
        );
        assert_eq!(
            std::env::var("ADMIN_JWT_SECRET").ok().as_deref(),
            Some("jwt-secret-from-toml"),
        );
        assert_eq!(
            std::env::var("ADMIN_JWT_TTL_SEC").ok().as_deref(),
            Some("900"),
        );

        set_env("CONTROL_PLANE_CONFIG_FILE", old_config_file.as_deref());
        set_env("ADMIN_USERNAME", old_admin_username.as_deref());
        set_env("ADMIN_PASSWORD", old_admin_password.as_deref());
        set_env("ADMIN_JWT_SECRET", old_admin_jwt_secret.as_deref());
        set_env("ADMIN_JWT_TTL_SEC", old_admin_jwt_ttl.as_deref());
        set_env(
            "CONTROL_PLANE_OAUTH_REFRESH_ENABLED",
            old_oauth_refresh_enabled.as_deref(),
        );
        set_env(
            "CONTROL_PLANE_OAUTH_REFRESH_INTERVAL_SEC",
            old_oauth_refresh_interval.as_deref(),
        );
        std::fs::remove_file(path).expect("cleanup toml");
    }

    #[test]
    fn usage_worker_toml_sets_runtime_defaults_without_overriding_env() {
        let _guard = ENV_LOCK.blocking_lock();
        let path = unique_temp_path("usage-worker-config");
        std::fs::write(
            &path,
            r#"
[usage_worker]
redis_url = "redis://toml:6379"
clickhouse_url = "http://127.0.0.1:8123"
request_log_stream = "stream.request_log.toml"
stream_read_count = 222
"#,
        )
        .expect("write toml");

        let old_config_file = set_env(
            "USAGE_WORKER_CONFIG_FILE",
            Some(path.display().to_string().as_str()),
        );
        let old_redis_url = set_env("REDIS_URL", Some("redis://env:6379"));
        let old_clickhouse_url = set_env("CLICKHOUSE_URL", None);
        let old_request_log_stream = set_env("REQUEST_LOG_STREAM", None);
        let old_stream_read_count = set_env("STREAM_READ_COUNT", None);

        apply_usage_worker_runtime_env_defaults_from_config().expect("apply config defaults");

        assert_eq!(
            std::env::var("REDIS_URL").ok().as_deref(),
            Some("redis://env:6379"),
        );
        assert_eq!(
            std::env::var("CLICKHOUSE_URL").ok().as_deref(),
            Some("http://127.0.0.1:8123"),
        );
        assert_eq!(
            std::env::var("REQUEST_LOG_STREAM").ok().as_deref(),
            Some("stream.request_log.toml"),
        );
        assert_eq!(
            std::env::var("STREAM_READ_COUNT").ok().as_deref(),
            Some("222")
        );

        set_env("USAGE_WORKER_CONFIG_FILE", old_config_file.as_deref());
        set_env("REDIS_URL", old_redis_url.as_deref());
        set_env("CLICKHOUSE_URL", old_clickhouse_url.as_deref());
        set_env("REQUEST_LOG_STREAM", old_request_log_stream.as_deref());
        set_env("STREAM_READ_COUNT", old_stream_read_count.as_deref());
        std::fs::remove_file(path).expect("cleanup toml");
    }
}
