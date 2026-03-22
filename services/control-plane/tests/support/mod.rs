use anyhow::Result;
use async_trait::async_trait;
use base64::Engine;
use std::sync::Arc;
use std::sync::{LazyLock, Mutex, Once};

use codex_pool_core::events::RequestLogEvent;
use control_plane::contracts::{
    AccountUsageLeaderboardItem, ApiKeyUsageLeaderboardItem, HourlyAccountUsagePoint,
    HourlyTenantApiKeyUsagePoint, HourlyTenantUsageTotalPoint, HourlyUsageTotalPoint,
    TenantUsageLeaderboardItem, UsageSummaryQueryResponse,
};
use control_plane::usage::{
    RequestLogQuery, RequestLogRow, UsageIngestRepository, UsageQueryRepository,
};
use uuid::Uuid;

const TEST_ADMIN_USERNAME: &str = "admin";
const TEST_ADMIN_PASSWORD: &str = "admin123456";
const TEST_ADMIN_JWT_SECRET: &str = "control-plane-test-jwt-secret";
const TEST_INTERNAL_AUTH_TOKEN: &str = "cp-internal-test-token";

static ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static INIT: Once = Once::new();

pub fn ensure_test_security_env() {
    let _guard = ENV_LOCK.lock().expect("test env lock poisoned");
    INIT.call_once(|| {
        std::env::set_var("ADMIN_USERNAME", TEST_ADMIN_USERNAME);
        std::env::set_var("ADMIN_PASSWORD", TEST_ADMIN_PASSWORD);
        std::env::set_var("ADMIN_JWT_SECRET", TEST_ADMIN_JWT_SECRET);
        std::env::set_var(
            "CONTROL_PLANE_INTERNAL_AUTH_TOKEN",
            TEST_INTERNAL_AUTH_TOKEN,
        );
        let hmac_key = base64::engine::general_purpose::STANDARD.encode([7_u8; 32]);
        std::env::set_var(
            "CONTROL_PLANE_API_KEY_HMAC_KEYS",
            format!("test:{hmac_key}"),
        );
    });
}

#[allow(dead_code)]
pub fn internal_service_token() -> String {
    ensure_test_security_env();
    TEST_INTERNAL_AUTH_TOKEN.to_string()
}

pub fn available_usage_repo() -> Arc<dyn UsageQueryRepository> {
    Arc::new(AvailableUsageRepo)
}

pub fn available_usage_ingest_repo() -> Arc<dyn UsageIngestRepository> {
    Arc::new(AvailableUsageIngestRepo)
}

struct AvailableUsageRepo;
struct AvailableUsageIngestRepo;

#[async_trait]
impl UsageQueryRepository for AvailableUsageRepo {
    async fn query_hourly_accounts(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _account_id: Option<Uuid>,
    ) -> Result<Vec<HourlyAccountUsagePoint>> {
        Ok(Vec::new())
    }

    async fn query_hourly_tenant_api_keys(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _tenant_id: Option<Uuid>,
        _api_key_id: Option<Uuid>,
    ) -> Result<Vec<HourlyTenantApiKeyUsagePoint>> {
        Ok(Vec::new())
    }

    async fn query_hourly_account_totals(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _account_id: Option<Uuid>,
    ) -> Result<Vec<HourlyUsageTotalPoint>> {
        Ok(Vec::new())
    }

    async fn query_hourly_tenant_api_key_totals(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _tenant_id: Option<Uuid>,
        _api_key_id: Option<Uuid>,
    ) -> Result<Vec<HourlyUsageTotalPoint>> {
        Ok(Vec::new())
    }

    async fn query_hourly_tenant_totals(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _tenant_id: Option<Uuid>,
        _api_key_id: Option<Uuid>,
    ) -> Result<Vec<HourlyTenantUsageTotalPoint>> {
        Ok(Vec::new())
    }

    async fn query_summary(
        &self,
        start_ts: i64,
        end_ts: i64,
        _tenant_id: Option<Uuid>,
        _account_id: Option<Uuid>,
        _api_key_id: Option<Uuid>,
    ) -> Result<UsageSummaryQueryResponse> {
        Ok(UsageSummaryQueryResponse {
            start_ts,
            end_ts,
            account_total_requests: 0,
            tenant_api_key_total_requests: 0,
            unique_account_count: 0,
            unique_tenant_api_key_count: 0,
            estimated_cost_microusd: None,
            dashboard_metrics: None,
        })
    }

    async fn query_tenant_leaderboard(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _tenant_id: Option<Uuid>,
    ) -> Result<Vec<TenantUsageLeaderboardItem>> {
        Ok(Vec::new())
    }

    async fn query_account_leaderboard(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _account_id: Option<Uuid>,
    ) -> Result<Vec<AccountUsageLeaderboardItem>> {
        Ok(Vec::new())
    }

    async fn query_api_key_leaderboard(
        &self,
        _start_ts: i64,
        _end_ts: i64,
        _limit: u32,
        _tenant_id: Option<Uuid>,
        _api_key_id: Option<Uuid>,
    ) -> Result<Vec<ApiKeyUsageLeaderboardItem>> {
        Ok(Vec::new())
    }

    async fn query_request_logs(&self, _query: RequestLogQuery) -> Result<Vec<RequestLogRow>> {
        Ok(Vec::new())
    }
}

#[async_trait]
impl UsageIngestRepository for AvailableUsageIngestRepo {
    async fn ingest_request_log(&self, _event: RequestLogEvent) -> Result<()> {
        Ok(())
    }
}
