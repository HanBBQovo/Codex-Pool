use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use codex_pool_core::events::{SystemEventCategory, SystemEventSeverity, SystemEventWrite};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx_core::query_builder::QueryBuilder;
#[cfg(feature = "postgres-backend")]
use sqlx_postgres::{PgPool, PgRow, Postgres};
use sqlx_sqlite::{Sqlite, SqlitePool, SqliteRow};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::contracts::{
    AccountSignalHeatmapBucket, AccountSignalHeatmapDetail, AccountSignalHeatmapSummary,
    SystemEventCorrelationResponse, SystemEventListResponse, SystemEventRecord,
    SystemEventSummaryCategoryCount, SystemEventSummaryReasonCount, SystemEventSummaryResponse,
    SystemEventSummarySeverityCount, SystemEventSummaryTypeCount,
};
use crate::Row;

const DEFAULT_EVENT_QUERY_LIMIT: u32 = 200;
const MAX_EVENT_QUERY_LIMIT: u32 = 1_000;
const MAX_PREVIEW_TEXT_CHARS: usize = 240;
const MAX_PAYLOAD_STRING_CHARS: usize = 240;
const REDACTED_TEXT: &str = "[redacted]";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SystemEventQuery {
    pub start_ts: Option<i64>,
    pub end_ts: Option<i64>,
    pub account_id: Option<Uuid>,
    pub request_id: Option<String>,
    pub job_id: Option<Uuid>,
    pub tenant_id: Option<Uuid>,
    pub category: Option<SystemEventCategory>,
    pub event_type: Option<String>,
    pub severity: Option<SystemEventSeverity>,
    pub reason_code: Option<String>,
    pub keyword: Option<String>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

impl SystemEventQuery {
    pub fn normalized_limit(&self) -> u32 {
        self.limit
            .unwrap_or(DEFAULT_EVENT_QUERY_LIMIT)
            .clamp(1, MAX_EVENT_QUERY_LIMIT)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ParsedCursor {
    ts_epoch_ms: i64,
    id: Uuid,
}

#[derive(Debug, Clone)]
struct AccountSignalEventRow {
    ts_epoch_ms: i64,
    category: SystemEventCategory,
    event_type: String,
    severity: SystemEventSeverity,
    status_code: Option<u16>,
    account_id: Option<Uuid>,
    selected_account_id: Option<Uuid>,
}

#[async_trait]
pub trait SystemEventRepository: Send + Sync {
    async fn insert_event(&self, event: SystemEventWrite) -> Result<SystemEventRecord>;
    async fn list_events(&self, query: SystemEventQuery) -> Result<SystemEventListResponse>;
    async fn get_event(&self, event_id: Uuid) -> Result<Option<SystemEventRecord>>;
    async fn summarize_events(&self, query: SystemEventQuery)
        -> Result<SystemEventSummaryResponse>;
    async fn correlate_request(
        &self,
        request_id: &str,
        query: SystemEventQuery,
    ) -> Result<SystemEventCorrelationResponse>;
    async fn summarize_account_signal_heatmaps(
        &self,
        account_ids: &[Uuid],
        now: DateTime<Utc>,
        window_minutes: u16,
        bucket_minutes: u16,
    ) -> Result<HashMap<Uuid, AccountSignalHeatmapSummary>>;
    async fn account_signal_heatmap_detail(
        &self,
        account_id: Uuid,
        now: DateTime<Utc>,
        window_minutes: u16,
        bucket_minutes: u16,
    ) -> Result<Option<AccountSignalHeatmapDetail>>;
}

#[derive(Clone)]
pub struct SystemEventLogRuntime {
    repo: Arc<dyn SystemEventRepository>,
}

impl SystemEventLogRuntime {
    pub fn new(repo: Arc<dyn SystemEventRepository>) -> Self {
        Self { repo }
    }

    pub fn repo(&self) -> Arc<dyn SystemEventRepository> {
        self.repo.clone()
    }

    pub fn emit_best_effort(&self, event: SystemEventWrite) {
        let repo = self.repo.clone();
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => {
                handle.spawn(async move {
                    if let Err(error) = repo.insert_event(event).await {
                        tracing::warn!(error = %error, "failed to persist system event");
                    }
                });
            }
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "system event runtime unavailable while emitting event"
                );
            }
        }
    }
}

fn signal_heatmap_window_bounds(
    now: DateTime<Utc>,
    window_minutes: u16,
    bucket_minutes: u16,
) -> Result<(DateTime<Utc>, i64, i64, i64, usize)> {
    if bucket_minutes == 0 {
        return Err(anyhow!("bucket_minutes must be greater than zero"));
    }
    if window_minutes == 0 {
        return Err(anyhow!("window_minutes must be greater than zero"));
    }

    let bucket_ms = i64::from(bucket_minutes) * 60_000;
    let window_ms = i64::from(window_minutes) * 60_000;
    if window_ms % bucket_ms != 0 {
        return Err(anyhow!("window_minutes must align with bucket_minutes"));
    }

    let aligned_start_ms = now.timestamp_millis().div_euclid(bucket_ms) * bucket_ms;
    let end_epoch_ms = aligned_start_ms + bucket_ms;
    let start_epoch_ms = end_epoch_ms - window_ms;
    let bucket_count = (window_ms / bucket_ms) as usize;
    let window_start = DateTime::<Utc>::from_timestamp_millis(start_epoch_ms)
        .ok_or_else(|| anyhow!("failed to build signal heatmap window start"))?;
    Ok((
        window_start,
        start_epoch_ms,
        end_epoch_ms,
        bucket_ms,
        bucket_count,
    ))
}

fn signal_intensity_level(signal_count: u32) -> u8 {
    match signal_count {
        0 => 0,
        1 => 1,
        2 | 3 => 2,
        _ => 3,
    }
}

fn classify_signal_category(category: SystemEventCategory) -> Option<bool> {
    match category {
        SystemEventCategory::Request => Some(true),
        SystemEventCategory::AccountPool | SystemEventCategory::Patrol => Some(false),
        SystemEventCategory::Import
        | SystemEventCategory::Infra
        | SystemEventCategory::AdminAction => None,
    }
}

fn classify_signal_outcome(row: &AccountSignalEventRow) -> Option<bool> {
    match row.category {
        SystemEventCategory::Request => {
            if row.event_type == "request_failed" {
                Some(false)
            } else if row.status_code.is_some_and(|status| status >= 400) {
                Some(false)
            } else {
                Some(true)
            }
        }
        SystemEventCategory::AccountPool | SystemEventCategory::Patrol => match row.severity {
            SystemEventSeverity::Debug | SystemEventSeverity::Info => Some(true),
            SystemEventSeverity::Warn | SystemEventSeverity::Error => Some(false),
        },
        SystemEventCategory::Import
        | SystemEventCategory::Infra
        | SystemEventCategory::AdminAction => None,
    }
}

fn build_account_signal_heatmap_details(
    account_ids: &[Uuid],
    rows: &[AccountSignalEventRow],
    now: DateTime<Utc>,
    window_minutes: u16,
    bucket_minutes: u16,
) -> Result<HashMap<Uuid, AccountSignalHeatmapDetail>> {
    let (window_start, start_epoch_ms, _end_epoch_ms, bucket_ms, bucket_count) =
        signal_heatmap_window_bounds(now, window_minutes, bucket_minutes)?;
    let tracked_ids = account_ids
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>();
    let mut bucket_map = account_ids
        .iter()
        .copied()
        .map(|account_id| {
            (
                account_id,
                vec![(0_u32, 0_u32, 0_u32, 0_u32, 0_u32); bucket_count],
            )
        })
        .collect::<HashMap<_, _>>();

    for row in rows {
        if row.ts_epoch_ms < start_epoch_ms {
            continue;
        }
        let bucket_index = ((row.ts_epoch_ms - start_epoch_ms) / bucket_ms) as usize;
        if bucket_index >= bucket_count {
            continue;
        }
        let Some(is_active_signal) = classify_signal_category(row.category) else {
            continue;
        };
        let Some(is_success_signal) = classify_signal_outcome(row) else {
            continue;
        };

        let mut matched_ids = Vec::with_capacity(2);
        if let Some(account_id) = row.account_id.filter(|value| tracked_ids.contains(value)) {
            matched_ids.push(account_id);
        }
        if let Some(selected_account_id) = row
            .selected_account_id
            .filter(|value| tracked_ids.contains(value))
        {
            if !matched_ids.contains(&selected_account_id) {
                matched_ids.push(selected_account_id);
            }
        }

        for account_id in matched_ids {
            let bucket = &mut bucket_map
                .get_mut(&account_id)
                .expect("tracked account should have preallocated buckets")[bucket_index];
            bucket.0 += 1;
            if is_active_signal {
                bucket.1 += 1;
            } else {
                bucket.2 += 1;
            }
            if is_success_signal {
                bucket.3 += 1;
            } else {
                bucket.4 += 1;
            }
        }
    }

    Ok(bucket_map
        .into_iter()
        .map(|(account_id, buckets)| {
            let buckets = buckets
                .into_iter()
                .enumerate()
                .map(
                    |(
                        index,
                        (signal_count, active_count, passive_count, success_count, error_count),
                    )| {
                        let start_at = DateTime::<Utc>::from_timestamp_millis(
                            start_epoch_ms + (index as i64 * bucket_ms),
                        )
                        .expect("bucket start should be representable");
                        AccountSignalHeatmapBucket {
                            start_at,
                            signal_count,
                            intensity: signal_intensity_level(signal_count),
                            active_count,
                            passive_count,
                            success_count,
                            error_count,
                        }
                    },
                )
                .collect::<Vec<_>>();
            (
                account_id,
                AccountSignalHeatmapDetail {
                    record_id: account_id,
                    bucket_minutes,
                    window_minutes,
                    window_start,
                    buckets,
                    latest_signal_at: None,
                    latest_signal_source: None,
                },
            )
        })
        .collect())
}

fn summarize_account_signal_heatmap_details(
    details: HashMap<Uuid, AccountSignalHeatmapDetail>,
) -> HashMap<Uuid, AccountSignalHeatmapSummary> {
    details
        .into_iter()
        .map(|(account_id, detail)| {
            (
                account_id,
                AccountSignalHeatmapSummary {
                    bucket_minutes: detail.bucket_minutes,
                    window_minutes: detail.window_minutes,
                    window_start: detail.window_start,
                    intensity_levels: detail
                        .buckets
                        .iter()
                        .map(|bucket| bucket.intensity)
                        .collect(),
                    active_counts: detail
                        .buckets
                        .iter()
                        .map(|bucket| bucket.active_count)
                        .collect(),
                    passive_counts: detail
                        .buckets
                        .iter()
                        .map(|bucket| bucket.passive_count)
                        .collect(),
                    success_counts: detail
                        .buckets
                        .iter()
                        .map(|bucket| bucket.success_count)
                        .collect(),
                    error_counts: detail
                        .buckets
                        .iter()
                        .map(|bucket| bucket.error_count)
                        .collect(),
                    latest_signal_at: detail.latest_signal_at,
                    latest_signal_source: detail.latest_signal_source,
                },
            )
        })
        .collect()
}

pub mod sqlite_repo {
    use super::*;

    #[derive(Clone)]
    pub struct SqliteSystemEventRepo {
        pool: SqlitePool,
    }

    impl SqliteSystemEventRepo {
        pub async fn new(pool: SqlitePool) -> Result<Self> {
            Self::initialize_schema(&pool).await?;
            Ok(Self { pool })
        }

        async fn initialize_schema(pool: &SqlitePool) -> Result<()> {
            sqlx::query(
                r#"
                CREATE TABLE IF NOT EXISTS system_event_logs (
                    id TEXT PRIMARY KEY,
                    ts TEXT NOT NULL,
                    ts_epoch_ms INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    source TEXT NOT NULL,
                    tenant_id TEXT NULL,
                    account_id TEXT NULL,
                    request_id TEXT NULL,
                    trace_request_id TEXT NULL,
                    job_id TEXT NULL,
                    account_label TEXT NULL,
                    auth_provider TEXT NULL,
                    operator_state_from TEXT NULL,
                    operator_state_to TEXT NULL,
                    reason_class TEXT NULL,
                    reason_code TEXT NULL,
                    next_action_at TEXT NULL,
                    path TEXT NULL,
                    method TEXT NULL,
                    model TEXT NULL,
                    selected_account_id TEXT NULL,
                    selected_proxy_id TEXT NULL,
                    routing_decision TEXT NULL,
                    failover_scope TEXT NULL,
                    status_code INTEGER NULL,
                    upstream_status_code INTEGER NULL,
                    latency_ms INTEGER NULL,
                    message TEXT NULL,
                    preview_text TEXT NULL,
                    payload_json TEXT NULL,
                    secret_preview TEXT NULL
                )
                "#,
            )
            .execute(pool)
            .await
            .context("failed to create sqlite system_event_logs table")?;

            for statement in [
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_ts ON system_event_logs (ts_epoch_ms DESC, id DESC)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_request_id ON system_event_logs (request_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_account_id ON system_event_logs (account_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_selected_account_id ON system_event_logs (selected_account_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_job_id ON system_event_logs (job_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_category ON system_event_logs (category, ts_epoch_ms DESC)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_reason_code ON system_event_logs (reason_code, ts_epoch_ms DESC)",
            ] {
                sqlx::query(statement)
                    .execute(pool)
                    .await
                    .with_context(|| format!("failed to execute sqlite index statement: {statement}"))?;
            }

            Ok(())
        }

        fn base_select() -> &'static str {
            "SELECT id, ts, ts_epoch_ms, category, event_type, severity, source, \
             tenant_id, account_id, request_id, trace_request_id, job_id, \
             account_label, auth_provider, operator_state_from, operator_state_to, \
             reason_class, reason_code, next_action_at, path, method, model, \
             selected_account_id, selected_proxy_id, routing_decision, failover_scope, \
             status_code, upstream_status_code, latency_ms, message, preview_text, \
             payload_json, secret_preview \
             FROM system_event_logs WHERE 1=1"
        }

        fn apply_query_filters(
            builder: &mut QueryBuilder<'_, Sqlite>,
            query: &SystemEventQuery,
        ) -> Result<()> {
            if let Some(start_ts) = query.start_ts {
                builder.push(" AND ts_epoch_ms >= ");
                builder.push_bind(start_ts.saturating_mul(1000));
            }
            if let Some(end_ts) = query.end_ts {
                builder.push(" AND ts_epoch_ms <= ");
                builder.push_bind(end_ts.saturating_mul(1000));
            }
            if let Some(account_id) = query.account_id {
                builder.push(" AND account_id = ");
                builder.push_bind(account_id.to_string());
            }
            if let Some(request_id) = query
                .request_id
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                builder.push(" AND request_id = ");
                builder.push_bind(request_id.trim().to_string());
            }
            if let Some(job_id) = query.job_id {
                builder.push(" AND job_id = ");
                builder.push_bind(job_id.to_string());
            }
            if let Some(tenant_id) = query.tenant_id {
                builder.push(" AND tenant_id = ");
                builder.push_bind(tenant_id.to_string());
            }
            if let Some(category) = query.category {
                builder.push(" AND category = ");
                builder.push_bind(category_to_db(category));
            }
            if let Some(event_type) = query
                .event_type
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                builder.push(" AND event_type = ");
                builder.push_bind(event_type.trim().to_string());
            }
            if let Some(severity) = query.severity {
                builder.push(" AND severity = ");
                builder.push_bind(severity_to_db(severity));
            }
            if let Some(reason_code) = query
                .reason_code
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                builder.push(" AND reason_code = ");
                builder.push_bind(reason_code.trim().to_string());
            }
            if let Some(keyword) = query
                .keyword
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                let pattern = format!("%{}%", keyword.trim());
                builder.push(" AND (");
                for (idx, field) in [
                    "message",
                    "preview_text",
                    "event_type",
                    "source",
                    "account_label",
                    "request_id",
                    "reason_code",
                ]
                .iter()
                .enumerate()
                {
                    if idx > 0 {
                        builder.push(" OR ");
                    }
                    builder.push(*field);
                    builder.push(" LIKE ");
                    builder.push_bind(pattern.clone());
                }
                builder.push(")");
            }
            if let Some(cursor) = query.cursor.as_deref().and_then(parse_cursor) {
                builder.push(" AND (ts_epoch_ms < ");
                builder.push_bind(cursor.ts_epoch_ms);
                builder.push(" OR (ts_epoch_ms = ");
                builder.push_bind(cursor.ts_epoch_ms);
                builder.push(" AND id < ");
                builder.push_bind(cursor.id.to_string());
                builder.push("))");
            }
            Ok(())
        }

        async fn query_rows(&self, query: SystemEventQuery) -> Result<SystemEventListResponse> {
            let limit = i64::from(query.normalized_limit());
            let mut builder = QueryBuilder::<Sqlite>::new(Self::base_select());
            Self::apply_query_filters(&mut builder, &query)?;
            builder.push(" ORDER BY ts_epoch_ms DESC, id DESC LIMIT ");
            builder.push_bind(limit + 1);
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to query sqlite system_event_logs")?;
            let mut items = rows
                .into_iter()
                .map(map_sqlite_system_event_row)
                .collect::<Result<Vec<_>>>()?;
            let next_cursor = if items.len() as i64 > limit {
                let extra = items.pop().expect("items should contain extra cursor row");
                Some(encode_cursor(extra.ts, extra.id))
            } else {
                None
            };
            Ok(SystemEventListResponse { items, next_cursor })
        }

        async fn count_group_by_category(
            &self,
            query: &SystemEventQuery,
        ) -> Result<Vec<SystemEventSummaryCategoryCount>> {
            let mut builder = QueryBuilder::<Sqlite>::new(
                "SELECT category, COUNT(*) AS count FROM system_event_logs WHERE 1=1",
            );
            Self::apply_query_filters(&mut builder, query)?;
            builder.push(" GROUP BY category ORDER BY count DESC, category ASC");
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to summarize sqlite event categories")?;
            rows.into_iter()
                .map(|row| {
                    Ok(SystemEventSummaryCategoryCount {
                        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
                        count: row.try_get::<i64, _>("count")?.max(0) as u64,
                    })
                })
                .collect()
        }

        async fn count_group_by_string(
            &self,
            query: &SystemEventQuery,
            field: &'static str,
        ) -> Result<Vec<(String, u64)>> {
            let mut builder = QueryBuilder::<Sqlite>::new(
                format!(
                    "SELECT {field}, COUNT(*) AS count FROM system_event_logs WHERE 1=1 AND {field} IS NOT NULL AND {field} != ''"
                )
                .as_str(),
            );
            Self::apply_query_filters(&mut builder, query)?;
            builder.push(format!(" GROUP BY {field} ORDER BY count DESC, {field} ASC").as_str());
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .with_context(|| format!("failed to summarize sqlite event field {field}"))?;
            rows.into_iter()
                .map(|row| {
                    Ok((
                        row.try_get::<String, _>(field)?,
                        row.try_get::<i64, _>("count")?.max(0) as u64,
                    ))
                })
                .collect()
        }

        async fn count_group_by_severity(
            &self,
            query: &SystemEventQuery,
        ) -> Result<Vec<SystemEventSummarySeverityCount>> {
            let mut builder = QueryBuilder::<Sqlite>::new(
                "SELECT severity, COUNT(*) AS count FROM system_event_logs WHERE 1=1",
            );
            Self::apply_query_filters(&mut builder, query)?;
            builder.push(" GROUP BY severity ORDER BY count DESC, severity ASC");
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to summarize sqlite event severities")?;
            rows.into_iter()
                .map(|row| {
                    Ok(SystemEventSummarySeverityCount {
                        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
                        count: row.try_get::<i64, _>("count")?.max(0) as u64,
                    })
                })
                .collect()
        }

        async fn account_signal_rows(
            &self,
            account_ids: &[Uuid],
            start_epoch_ms: i64,
            end_epoch_ms: i64,
        ) -> Result<Vec<AccountSignalEventRow>> {
            if account_ids.is_empty() {
                return Ok(Vec::new());
            }

            let account_ids = account_ids.iter().map(Uuid::to_string).collect::<Vec<_>>();
            let mut builder = QueryBuilder::<Sqlite>::new(
                "SELECT ts_epoch_ms, category, event_type, severity, status_code, account_id, selected_account_id \
                 FROM system_event_logs WHERE ts_epoch_ms >= ",
            );
            builder.push_bind(start_epoch_ms);
            builder.push(" AND ts_epoch_ms < ");
            builder.push_bind(end_epoch_ms);
            builder.push(" AND category IN (");
            {
                let mut categories = builder.separated(", ");
                for category in [
                    SystemEventCategory::Request,
                    SystemEventCategory::AccountPool,
                    SystemEventCategory::Patrol,
                ] {
                    categories.push_bind(category_to_db(category));
                }
                categories.push_unseparated(")");
            }
            builder.push(" AND (account_id IN (");
            {
                let mut ids = builder.separated(", ");
                for account_id in &account_ids {
                    ids.push_bind(account_id.clone());
                }
                ids.push_unseparated(")");
            }
            builder.push(" OR selected_account_id IN (");
            {
                let mut ids = builder.separated(", ");
                for account_id in &account_ids {
                    ids.push_bind(account_id.clone());
                }
                ids.push_unseparated(")");
            }
            builder.push(") ORDER BY ts_epoch_ms ASC");
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to query sqlite account signal rows")?;
            rows.into_iter()
                .map(|row| {
                    Ok(AccountSignalEventRow {
                        ts_epoch_ms: row.try_get::<i64, _>("ts_epoch_ms")?,
                        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
                        event_type: row.try_get::<String, _>("event_type")?,
                        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
                        status_code: row
                            .try_get::<Option<i64>, _>("status_code")?
                            .map(|value| u16::try_from(value).unwrap_or_default()),
                        account_id: parse_optional_uuid(
                            row.try_get::<Option<String>, _>("account_id")?,
                            "account_id",
                        )?,
                        selected_account_id: parse_optional_uuid(
                            row.try_get::<Option<String>, _>("selected_account_id")?,
                            "selected_account_id",
                        )?,
                    })
                })
                .collect()
        }
    }

    #[async_trait]
    impl SystemEventRepository for SqliteSystemEventRepo {
        async fn insert_event(&self, event: SystemEventWrite) -> Result<SystemEventRecord> {
            let record = sanitize_event(event);
            sqlx::query(
                r#"
                INSERT INTO system_event_logs (
                    id, ts, ts_epoch_ms, category, event_type, severity, source,
                    tenant_id, account_id, request_id, trace_request_id, job_id,
                    account_label, auth_provider, operator_state_from, operator_state_to,
                    reason_class, reason_code, next_action_at, path, method, model,
                    selected_account_id, selected_proxy_id, routing_decision, failover_scope,
                    status_code, upstream_status_code, latency_ms, message, preview_text,
                    payload_json, secret_preview
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                    ?8, ?9, ?10, ?11, ?12,
                    ?13, ?14, ?15, ?16,
                    ?17, ?18, ?19, ?20, ?21, ?22,
                    ?23, ?24, ?25, ?26,
                    ?27, ?28, ?29, ?30, ?31,
                    ?32, ?33
                )
                "#,
            )
            .bind(record.id.to_string())
            .bind(record.ts)
            .bind(record.ts.timestamp_millis())
            .bind(category_to_db(record.category))
            .bind(record.event_type.clone())
            .bind(severity_to_db(record.severity))
            .bind(record.source.clone())
            .bind(record.tenant_id.map(|value| value.to_string()))
            .bind(record.account_id.map(|value| value.to_string()))
            .bind(record.request_id.clone())
            .bind(record.trace_request_id.clone())
            .bind(record.job_id.map(|value| value.to_string()))
            .bind(record.account_label.clone())
            .bind(record.auth_provider.clone())
            .bind(record.operator_state_from.clone())
            .bind(record.operator_state_to.clone())
            .bind(record.reason_class.clone())
            .bind(record.reason_code.clone())
            .bind(record.next_action_at)
            .bind(record.path.clone())
            .bind(record.method.clone())
            .bind(record.model.clone())
            .bind(record.selected_account_id.map(|value| value.to_string()))
            .bind(record.selected_proxy_id.map(|value| value.to_string()))
            .bind(record.routing_decision.clone())
            .bind(record.failover_scope.clone())
            .bind(record.status_code.map(i64::from))
            .bind(record.upstream_status_code.map(i64::from))
            .bind(record.latency_ms.map(|value| value as i64))
            .bind(record.message.clone())
            .bind(record.preview_text.clone())
            .bind(record.payload_json.as_ref().map(Value::to_string))
            .bind(record.secret_preview.clone())
            .execute(&self.pool)
            .await
            .context("failed to insert sqlite system event")?;
            Ok(record)
        }

        async fn list_events(&self, query: SystemEventQuery) -> Result<SystemEventListResponse> {
            self.query_rows(query).await
        }

        async fn get_event(&self, event_id: Uuid) -> Result<Option<SystemEventRecord>> {
            let row = sqlx::query(format!("{} AND id = ?1", Self::base_select()).as_str())
                .bind(event_id.to_string())
                .fetch_optional(&self.pool)
                .await
                .context("failed to load sqlite system event detail")?;
            row.map(map_sqlite_system_event_row).transpose()
        }

        async fn summarize_events(
            &self,
            query: SystemEventQuery,
        ) -> Result<SystemEventSummaryResponse> {
            let mut total_builder = QueryBuilder::<Sqlite>::new(
                "SELECT COUNT(*) AS count FROM system_event_logs WHERE 1=1",
            );
            Self::apply_query_filters(&mut total_builder, &query)?;
            let total = total_builder
                .build()
                .fetch_one(&self.pool)
                .await
                .context("failed to count sqlite system events")?
                .try_get::<i64, _>("count")?
                .max(0) as u64;

            let by_category = self.count_group_by_category(&query).await?;
            let by_event_type = self
                .count_group_by_string(&query, "event_type")
                .await?
                .into_iter()
                .map(|(event_type, count)| SystemEventSummaryTypeCount { event_type, count })
                .collect();
            let by_reason_code = self
                .count_group_by_string(&query, "reason_code")
                .await?
                .into_iter()
                .map(|(reason_code, count)| SystemEventSummaryReasonCount { reason_code, count })
                .collect();
            let by_severity = self.count_group_by_severity(&query).await?;

            Ok(SystemEventSummaryResponse {
                total,
                by_category,
                by_event_type,
                by_reason_code,
                by_severity,
            })
        }

        async fn correlate_request(
            &self,
            request_id: &str,
            mut query: SystemEventQuery,
        ) -> Result<SystemEventCorrelationResponse> {
            query.request_id = Some(request_id.trim().to_string());
            query.cursor = None;
            let items = self.query_rows(query).await?.items;
            Ok(SystemEventCorrelationResponse {
                request_id: request_id.trim().to_string(),
                items,
            })
        }

        async fn summarize_account_signal_heatmaps(
            &self,
            account_ids: &[Uuid],
            now: DateTime<Utc>,
            window_minutes: u16,
            bucket_minutes: u16,
        ) -> Result<HashMap<Uuid, AccountSignalHeatmapSummary>> {
            if account_ids.is_empty() {
                return Ok(HashMap::new());
            }
            let (_, start_epoch_ms, end_epoch_ms, _, _) =
                signal_heatmap_window_bounds(now, window_minutes, bucket_minutes)?;
            let rows = self
                .account_signal_rows(account_ids, start_epoch_ms, end_epoch_ms)
                .await?;
            let details = build_account_signal_heatmap_details(
                account_ids,
                &rows,
                now,
                window_minutes,
                bucket_minutes,
            )?;
            Ok(summarize_account_signal_heatmap_details(details))
        }

        async fn account_signal_heatmap_detail(
            &self,
            account_id: Uuid,
            now: DateTime<Utc>,
            window_minutes: u16,
            bucket_minutes: u16,
        ) -> Result<Option<AccountSignalHeatmapDetail>> {
            let (_, start_epoch_ms, end_epoch_ms, _, _) =
                signal_heatmap_window_bounds(now, window_minutes, bucket_minutes)?;
            let rows = self
                .account_signal_rows(&[account_id], start_epoch_ms, end_epoch_ms)
                .await?;
            let mut details = build_account_signal_heatmap_details(
                &[account_id],
                &rows,
                now,
                window_minutes,
                bucket_minutes,
            )?;
            Ok(details.remove(&account_id))
        }
    }
}

#[cfg(feature = "postgres-backend")]
pub mod postgres_repo {
    use super::*;

    #[derive(Clone)]
    pub struct PostgresSystemEventRepo {
        pool: PgPool,
    }

    impl PostgresSystemEventRepo {
        pub async fn new(pool: PgPool) -> Result<Self> {
            Self::initialize_schema(&pool).await?;
            Ok(Self { pool })
        }

        async fn initialize_schema(pool: &PgPool) -> Result<()> {
            sqlx::query(
                r#"
                CREATE TABLE IF NOT EXISTS system_event_logs (
                    id TEXT PRIMARY KEY,
                    ts TIMESTAMPTZ NOT NULL,
                    ts_epoch_ms BIGINT NOT NULL,
                    category TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    source TEXT NOT NULL,
                    tenant_id TEXT NULL,
                    account_id TEXT NULL,
                    request_id TEXT NULL,
                    trace_request_id TEXT NULL,
                    job_id TEXT NULL,
                    account_label TEXT NULL,
                    auth_provider TEXT NULL,
                    operator_state_from TEXT NULL,
                    operator_state_to TEXT NULL,
                    reason_class TEXT NULL,
                    reason_code TEXT NULL,
                    next_action_at TIMESTAMPTZ NULL,
                    path TEXT NULL,
                    method TEXT NULL,
                    model TEXT NULL,
                    selected_account_id TEXT NULL,
                    selected_proxy_id TEXT NULL,
                    routing_decision TEXT NULL,
                    failover_scope TEXT NULL,
                    status_code INTEGER NULL,
                    upstream_status_code INTEGER NULL,
                    latency_ms BIGINT NULL,
                    message TEXT NULL,
                    preview_text TEXT NULL,
                    payload_json JSONB NULL,
                    secret_preview TEXT NULL
                )
                "#,
            )
            .execute(pool)
            .await
            .context("failed to create postgres system_event_logs table")?;

            for statement in [
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_ts ON system_event_logs (ts_epoch_ms DESC, id DESC)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_request_id ON system_event_logs (request_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_account_id ON system_event_logs (account_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_selected_account_id ON system_event_logs (selected_account_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_job_id ON system_event_logs (job_id)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_category ON system_event_logs (category, ts_epoch_ms DESC)",
                "CREATE INDEX IF NOT EXISTS idx_system_event_logs_reason_code ON system_event_logs (reason_code, ts_epoch_ms DESC)",
            ] {
                sqlx::query(statement)
                    .execute(pool)
                    .await
                    .with_context(|| {
                        format!("failed to execute postgres index statement: {statement}")
                    })?;
            }

            Ok(())
        }

        fn base_select() -> &'static str {
            "SELECT id, ts, ts_epoch_ms, category, event_type, severity, source, \
             tenant_id, account_id, request_id, trace_request_id, job_id, \
             account_label, auth_provider, operator_state_from, operator_state_to, \
             reason_class, reason_code, next_action_at, path, method, model, \
             selected_account_id, selected_proxy_id, routing_decision, failover_scope, \
             status_code, upstream_status_code, latency_ms, message, preview_text, \
             payload_json, secret_preview \
             FROM system_event_logs WHERE 1=1"
        }

        fn apply_query_filters(
            builder: &mut QueryBuilder<'_, Postgres>,
            query: &SystemEventQuery,
        ) -> Result<()> {
            if let Some(start_ts) = query.start_ts {
                builder.push(" AND ts_epoch_ms >= ");
                builder.push_bind(start_ts.saturating_mul(1000));
            }
            if let Some(end_ts) = query.end_ts {
                builder.push(" AND ts_epoch_ms <= ");
                builder.push_bind(end_ts.saturating_mul(1000));
            }
            if let Some(account_id) = query.account_id {
                builder.push(" AND account_id = ");
                builder.push_bind(account_id.to_string());
            }
            if let Some(request_id) = query
                .request_id
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                builder.push(" AND request_id = ");
                builder.push_bind(request_id.trim().to_string());
            }
            if let Some(job_id) = query.job_id {
                builder.push(" AND job_id = ");
                builder.push_bind(job_id.to_string());
            }
            if let Some(tenant_id) = query.tenant_id {
                builder.push(" AND tenant_id = ");
                builder.push_bind(tenant_id.to_string());
            }
            if let Some(category) = query.category {
                builder.push(" AND category = ");
                builder.push_bind(category_to_db(category));
            }
            if let Some(event_type) = query
                .event_type
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                builder.push(" AND event_type = ");
                builder.push_bind(event_type.trim().to_string());
            }
            if let Some(severity) = query.severity {
                builder.push(" AND severity = ");
                builder.push_bind(severity_to_db(severity));
            }
            if let Some(reason_code) = query
                .reason_code
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                builder.push(" AND reason_code = ");
                builder.push_bind(reason_code.trim().to_string());
            }
            if let Some(keyword) = query
                .keyword
                .as_ref()
                .filter(|value| !value.trim().is_empty())
            {
                let pattern = format!("%{}%", keyword.trim());
                builder.push(" AND (");
                for (idx, field) in [
                    "message",
                    "preview_text",
                    "event_type",
                    "source",
                    "account_label",
                    "request_id",
                    "reason_code",
                ]
                .iter()
                .enumerate()
                {
                    if idx > 0 {
                        builder.push(" OR ");
                    }
                    builder.push(*field);
                    builder.push(" ILIKE ");
                    builder.push_bind(pattern.clone());
                }
                builder.push(")");
            }
            if let Some(cursor) = query.cursor.as_deref().and_then(parse_cursor) {
                builder.push(" AND (ts_epoch_ms < ");
                builder.push_bind(cursor.ts_epoch_ms);
                builder.push(" OR (ts_epoch_ms = ");
                builder.push_bind(cursor.ts_epoch_ms);
                builder.push(" AND id < ");
                builder.push_bind(cursor.id.to_string());
                builder.push("))");
            }
            Ok(())
        }

        async fn query_rows(&self, query: SystemEventQuery) -> Result<SystemEventListResponse> {
            let limit = i64::from(query.normalized_limit());
            let mut builder = QueryBuilder::<Postgres>::new(Self::base_select());
            Self::apply_query_filters(&mut builder, &query)?;
            builder.push(" ORDER BY ts_epoch_ms DESC, id DESC LIMIT ");
            builder.push_bind(limit + 1);
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to query postgres system_event_logs")?;
            let mut items = rows
                .into_iter()
                .map(map_postgres_system_event_row)
                .collect::<Result<Vec<_>>>()?;
            let next_cursor = if items.len() as i64 > limit {
                let extra = items.pop().expect("items should contain extra cursor row");
                Some(encode_cursor(extra.ts, extra.id))
            } else {
                None
            };
            Ok(SystemEventListResponse { items, next_cursor })
        }

        async fn count_group_by_category(
            &self,
            query: &SystemEventQuery,
        ) -> Result<Vec<SystemEventSummaryCategoryCount>> {
            let mut builder = QueryBuilder::<Postgres>::new(
                "SELECT category, COUNT(*) AS count FROM system_event_logs WHERE 1=1",
            );
            Self::apply_query_filters(&mut builder, query)?;
            builder.push(" GROUP BY category ORDER BY count DESC, category ASC");
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to summarize postgres event categories")?;
            rows.into_iter()
                .map(|row| {
                    Ok(SystemEventSummaryCategoryCount {
                        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
                        count: row.try_get::<i64, _>("count")?.max(0) as u64,
                    })
                })
                .collect()
        }

        async fn count_group_by_string(
            &self,
            query: &SystemEventQuery,
            field: &'static str,
        ) -> Result<Vec<(String, u64)>> {
            let mut builder = QueryBuilder::<Postgres>::new(
                format!(
                    "SELECT {field}, COUNT(*) AS count FROM system_event_logs WHERE 1=1 AND {field} IS NOT NULL AND {field} != ''"
                )
                .as_str(),
            );
            Self::apply_query_filters(&mut builder, query)?;
            builder.push(format!(" GROUP BY {field} ORDER BY count DESC, {field} ASC").as_str());
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .with_context(|| format!("failed to summarize postgres event field {field}"))?;
            rows.into_iter()
                .map(|row| {
                    Ok((
                        row.try_get::<String, _>(field)?,
                        row.try_get::<i64, _>("count")?.max(0) as u64,
                    ))
                })
                .collect()
        }

        async fn count_group_by_severity(
            &self,
            query: &SystemEventQuery,
        ) -> Result<Vec<SystemEventSummarySeverityCount>> {
            let mut builder = QueryBuilder::<Postgres>::new(
                "SELECT severity, COUNT(*) AS count FROM system_event_logs WHERE 1=1",
            );
            Self::apply_query_filters(&mut builder, query)?;
            builder.push(" GROUP BY severity ORDER BY count DESC, severity ASC");
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to summarize postgres event severities")?;
            rows.into_iter()
                .map(|row| {
                    Ok(SystemEventSummarySeverityCount {
                        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
                        count: row.try_get::<i64, _>("count")?.max(0) as u64,
                    })
                })
                .collect()
        }

        async fn account_signal_rows(
            &self,
            account_ids: &[Uuid],
            start_epoch_ms: i64,
            end_epoch_ms: i64,
        ) -> Result<Vec<AccountSignalEventRow>> {
            if account_ids.is_empty() {
                return Ok(Vec::new());
            }

            let account_ids = account_ids.iter().map(Uuid::to_string).collect::<Vec<_>>();
            let mut builder = QueryBuilder::<Postgres>::new(
                "SELECT ts_epoch_ms, category, event_type, severity, status_code, account_id, selected_account_id \
                 FROM system_event_logs WHERE ts_epoch_ms >= ",
            );
            builder.push_bind(start_epoch_ms);
            builder.push(" AND ts_epoch_ms < ");
            builder.push_bind(end_epoch_ms);
            builder.push(" AND category IN (");
            {
                let mut categories = builder.separated(", ");
                for category in [
                    SystemEventCategory::Request,
                    SystemEventCategory::AccountPool,
                    SystemEventCategory::Patrol,
                ] {
                    categories.push_bind(category_to_db(category));
                }
                categories.push_unseparated(")");
            }
            builder.push(" AND (account_id IN (");
            {
                let mut ids = builder.separated(", ");
                for account_id in &account_ids {
                    ids.push_bind(account_id.clone());
                }
                ids.push_unseparated(")");
            }
            builder.push(" OR selected_account_id IN (");
            {
                let mut ids = builder.separated(", ");
                for account_id in &account_ids {
                    ids.push_bind(account_id.clone());
                }
                ids.push_unseparated(")");
            }
            builder.push(") ORDER BY ts_epoch_ms ASC");
            let rows = builder
                .build()
                .fetch_all(&self.pool)
                .await
                .context("failed to query postgres account signal rows")?;
            rows.into_iter()
                .map(|row| {
                    Ok(AccountSignalEventRow {
                        ts_epoch_ms: row.try_get::<i64, _>("ts_epoch_ms")?,
                        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
                        event_type: row.try_get::<String, _>("event_type")?,
                        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
                        status_code: row
                            .try_get::<Option<i64>, _>("status_code")?
                            .map(|value| u16::try_from(value).unwrap_or_default()),
                        account_id: parse_optional_uuid(
                            row.try_get::<Option<String>, _>("account_id")?,
                            "account_id",
                        )?,
                        selected_account_id: parse_optional_uuid(
                            row.try_get::<Option<String>, _>("selected_account_id")?,
                            "selected_account_id",
                        )?,
                    })
                })
                .collect()
        }
    }

    #[async_trait]
    impl SystemEventRepository for PostgresSystemEventRepo {
        async fn insert_event(&self, event: SystemEventWrite) -> Result<SystemEventRecord> {
            let record = sanitize_event(event);
            sqlx::query(
                r#"
                INSERT INTO system_event_logs (
                    id, ts, ts_epoch_ms, category, event_type, severity, source,
                    tenant_id, account_id, request_id, trace_request_id, job_id,
                    account_label, auth_provider, operator_state_from, operator_state_to,
                    reason_class, reason_code, next_action_at, path, method, model,
                    selected_account_id, selected_proxy_id, routing_decision, failover_scope,
                    status_code, upstream_status_code, latency_ms, message, preview_text,
                    payload_json, secret_preview
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10, $11, $12,
                    $13, $14, $15, $16,
                    $17, $18, $19, $20, $21, $22,
                    $23, $24, $25, $26,
                    $27, $28, $29, $30, $31,
                    $32, $33
                )
                "#,
            )
            .bind(record.id.to_string())
            .bind(record.ts)
            .bind(record.ts.timestamp_millis())
            .bind(category_to_db(record.category))
            .bind(record.event_type.clone())
            .bind(severity_to_db(record.severity))
            .bind(record.source.clone())
            .bind(record.tenant_id.map(|value| value.to_string()))
            .bind(record.account_id.map(|value| value.to_string()))
            .bind(record.request_id.clone())
            .bind(record.trace_request_id.clone())
            .bind(record.job_id.map(|value| value.to_string()))
            .bind(record.account_label.clone())
            .bind(record.auth_provider.clone())
            .bind(record.operator_state_from.clone())
            .bind(record.operator_state_to.clone())
            .bind(record.reason_class.clone())
            .bind(record.reason_code.clone())
            .bind(record.next_action_at)
            .bind(record.path.clone())
            .bind(record.method.clone())
            .bind(record.model.clone())
            .bind(record.selected_account_id.map(|value| value.to_string()))
            .bind(record.selected_proxy_id.map(|value| value.to_string()))
            .bind(record.routing_decision.clone())
            .bind(record.failover_scope.clone())
            .bind(record.status_code.map(i32::from))
            .bind(record.upstream_status_code.map(i32::from))
            .bind(record.latency_ms.map(|value| value as i64))
            .bind(record.message.clone())
            .bind(record.preview_text.clone())
            .bind(record.payload_json.clone())
            .bind(record.secret_preview.clone())
            .execute(&self.pool)
            .await
            .context("failed to insert postgres system event")?;
            Ok(record)
        }

        async fn list_events(&self, query: SystemEventQuery) -> Result<SystemEventListResponse> {
            self.query_rows(query).await
        }

        async fn get_event(&self, event_id: Uuid) -> Result<Option<SystemEventRecord>> {
            let row = sqlx::query(format!("{} AND id = $1", Self::base_select()).as_str())
                .bind(event_id.to_string())
                .fetch_optional(&self.pool)
                .await
                .context("failed to load postgres system event detail")?;
            row.map(map_postgres_system_event_row).transpose()
        }

        async fn summarize_events(
            &self,
            query: SystemEventQuery,
        ) -> Result<SystemEventSummaryResponse> {
            let mut total_builder = QueryBuilder::<Postgres>::new(
                "SELECT COUNT(*) AS count FROM system_event_logs WHERE 1=1",
            );
            Self::apply_query_filters(&mut total_builder, &query)?;
            let total = total_builder
                .build()
                .fetch_one(&self.pool)
                .await
                .context("failed to count postgres system events")?
                .try_get::<i64, _>("count")?
                .max(0) as u64;

            let by_category = self.count_group_by_category(&query).await?;
            let by_event_type = self
                .count_group_by_string(&query, "event_type")
                .await?
                .into_iter()
                .map(|(event_type, count)| SystemEventSummaryTypeCount { event_type, count })
                .collect();
            let by_reason_code = self
                .count_group_by_string(&query, "reason_code")
                .await?
                .into_iter()
                .map(|(reason_code, count)| SystemEventSummaryReasonCount { reason_code, count })
                .collect();
            let by_severity = self.count_group_by_severity(&query).await?;

            Ok(SystemEventSummaryResponse {
                total,
                by_category,
                by_event_type,
                by_reason_code,
                by_severity,
            })
        }

        async fn correlate_request(
            &self,
            request_id: &str,
            mut query: SystemEventQuery,
        ) -> Result<SystemEventCorrelationResponse> {
            query.request_id = Some(request_id.trim().to_string());
            query.cursor = None;
            let items = self.query_rows(query).await?.items;
            Ok(SystemEventCorrelationResponse {
                request_id: request_id.trim().to_string(),
                items,
            })
        }

        async fn summarize_account_signal_heatmaps(
            &self,
            account_ids: &[Uuid],
            now: DateTime<Utc>,
            window_minutes: u16,
            bucket_minutes: u16,
        ) -> Result<HashMap<Uuid, AccountSignalHeatmapSummary>> {
            if account_ids.is_empty() {
                return Ok(HashMap::new());
            }
            let (_, start_epoch_ms, end_epoch_ms, _, _) =
                signal_heatmap_window_bounds(now, window_minutes, bucket_minutes)?;
            let rows = self
                .account_signal_rows(account_ids, start_epoch_ms, end_epoch_ms)
                .await?;
            let details = build_account_signal_heatmap_details(
                account_ids,
                &rows,
                now,
                window_minutes,
                bucket_minutes,
            )?;
            Ok(summarize_account_signal_heatmap_details(details))
        }

        async fn account_signal_heatmap_detail(
            &self,
            account_id: Uuid,
            now: DateTime<Utc>,
            window_minutes: u16,
            bucket_minutes: u16,
        ) -> Result<Option<AccountSignalHeatmapDetail>> {
            let (_, start_epoch_ms, end_epoch_ms, _, _) =
                signal_heatmap_window_bounds(now, window_minutes, bucket_minutes)?;
            let rows = self
                .account_signal_rows(&[account_id], start_epoch_ms, end_epoch_ms)
                .await?;
            let mut details = build_account_signal_heatmap_details(
                &[account_id],
                &rows,
                now,
                window_minutes,
                bucket_minutes,
            )?;
            Ok(details.remove(&account_id))
        }
    }
}

fn map_sqlite_system_event_row(row: SqliteRow) -> Result<SystemEventRecord> {
    Ok(SystemEventRecord {
        id: Uuid::parse_str(&row.try_get::<String, _>("id")?).context("invalid system event id")?,
        ts: row.try_get("ts")?,
        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
        event_type: row.try_get("event_type")?,
        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
        source: row.try_get("source")?,
        tenant_id: parse_optional_uuid(row.try_get("tenant_id")?, "tenant_id")?,
        account_id: parse_optional_uuid(row.try_get("account_id")?, "account_id")?,
        request_id: row.try_get("request_id")?,
        trace_request_id: row.try_get("trace_request_id")?,
        job_id: parse_optional_uuid(row.try_get("job_id")?, "job_id")?,
        account_label: row.try_get("account_label")?,
        auth_provider: row.try_get("auth_provider")?,
        operator_state_from: row.try_get("operator_state_from")?,
        operator_state_to: row.try_get("operator_state_to")?,
        reason_class: row.try_get("reason_class")?,
        reason_code: row.try_get("reason_code")?,
        next_action_at: row.try_get("next_action_at")?,
        path: row.try_get("path")?,
        method: row.try_get("method")?,
        model: row.try_get("model")?,
        selected_account_id: parse_optional_uuid(
            row.try_get("selected_account_id")?,
            "selected_account_id",
        )?,
        selected_proxy_id: parse_optional_uuid(
            row.try_get("selected_proxy_id")?,
            "selected_proxy_id",
        )?,
        routing_decision: row.try_get("routing_decision")?,
        failover_scope: row.try_get("failover_scope")?,
        status_code: row
            .try_get::<Option<i64>, _>("status_code")?
            .map(|value| u16::try_from(value.max(0)).ok())
            .flatten(),
        upstream_status_code: row
            .try_get::<Option<i64>, _>("upstream_status_code")?
            .map(|value| u16::try_from(value.max(0)).ok())
            .flatten(),
        latency_ms: row
            .try_get::<Option<i64>, _>("latency_ms")?
            .map(|value| value.max(0) as u64),
        message: row.try_get("message")?,
        preview_text: row.try_get("preview_text")?,
        payload_json: row
            .try_get::<Option<String>, _>("payload_json")?
            .map(|raw| serde_json::from_str::<Value>(&raw))
            .transpose()
            .context("invalid system event payload json")?,
        secret_preview: row.try_get("secret_preview")?,
    })
}

#[cfg(feature = "postgres-backend")]
fn map_postgres_system_event_row(row: PgRow) -> Result<SystemEventRecord> {
    Ok(SystemEventRecord {
        id: Uuid::parse_str(&row.try_get::<String, _>("id")?).context("invalid system event id")?,
        ts: row.try_get("ts")?,
        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
        event_type: row.try_get("event_type")?,
        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
        source: row.try_get("source")?,
        tenant_id: parse_optional_uuid(row.try_get("tenant_id")?, "tenant_id")?,
        account_id: parse_optional_uuid(row.try_get("account_id")?, "account_id")?,
        request_id: row.try_get("request_id")?,
        trace_request_id: row.try_get("trace_request_id")?,
        job_id: parse_optional_uuid(row.try_get("job_id")?, "job_id")?,
        account_label: row.try_get("account_label")?,
        auth_provider: row.try_get("auth_provider")?,
        operator_state_from: row.try_get("operator_state_from")?,
        operator_state_to: row.try_get("operator_state_to")?,
        reason_class: row.try_get("reason_class")?,
        reason_code: row.try_get("reason_code")?,
        next_action_at: row.try_get("next_action_at")?,
        path: row.try_get("path")?,
        method: row.try_get("method")?,
        model: row.try_get("model")?,
        selected_account_id: parse_optional_uuid(
            row.try_get("selected_account_id")?,
            "selected_account_id",
        )?,
        selected_proxy_id: parse_optional_uuid(
            row.try_get("selected_proxy_id")?,
            "selected_proxy_id",
        )?,
        routing_decision: row.try_get("routing_decision")?,
        failover_scope: row.try_get("failover_scope")?,
        status_code: row
            .try_get::<Option<i64>, _>("status_code")?
            .map(|value| u16::try_from(value.max(0)).ok())
            .flatten(),
        upstream_status_code: row
            .try_get::<Option<i64>, _>("upstream_status_code")?
            .map(|value| u16::try_from(value.max(0)).ok())
            .flatten(),
        latency_ms: row
            .try_get::<Option<i64>, _>("latency_ms")?
            .map(|value| value.max(0) as u64),
        message: row.try_get("message")?,
        preview_text: row.try_get("preview_text")?,
        payload_json: row.try_get::<Option<Value>, _>("payload_json")?,
        secret_preview: row.try_get("secret_preview")?,
    })
}

fn parse_optional_uuid(raw: Option<String>, field: &'static str) -> Result<Option<Uuid>> {
    raw.map(|value| {
        Uuid::parse_str(&value)
            .with_context(|| format!("invalid uuid stored in system_event_logs.{field}"))
    })
    .transpose()
}

fn category_to_db(category: SystemEventCategory) -> &'static str {
    match category {
        SystemEventCategory::Request => "request",
        SystemEventCategory::AccountPool => "account_pool",
        SystemEventCategory::Patrol => "patrol",
        SystemEventCategory::Import => "import",
        SystemEventCategory::Infra => "infra",
        SystemEventCategory::AdminAction => "admin_action",
    }
}

fn parse_category(raw: &str) -> Result<SystemEventCategory> {
    match raw {
        "request" => Ok(SystemEventCategory::Request),
        "account_pool" => Ok(SystemEventCategory::AccountPool),
        "patrol" => Ok(SystemEventCategory::Patrol),
        "import" => Ok(SystemEventCategory::Import),
        "infra" => Ok(SystemEventCategory::Infra),
        "admin_action" => Ok(SystemEventCategory::AdminAction),
        _ => Err(anyhow!("unsupported system event category: {raw}")),
    }
}

fn severity_to_db(severity: SystemEventSeverity) -> &'static str {
    match severity {
        SystemEventSeverity::Debug => "debug",
        SystemEventSeverity::Info => "info",
        SystemEventSeverity::Warn => "warn",
        SystemEventSeverity::Error => "error",
    }
}

fn parse_severity(raw: &str) -> Result<SystemEventSeverity> {
    match raw {
        "debug" => Ok(SystemEventSeverity::Debug),
        "info" => Ok(SystemEventSeverity::Info),
        "warn" => Ok(SystemEventSeverity::Warn),
        "error" => Ok(SystemEventSeverity::Error),
        _ => Err(anyhow!("unsupported system event severity: {raw}")),
    }
}

fn encode_cursor(ts: DateTime<Utc>, id: Uuid) -> String {
    format!("{}|{}", ts.timestamp_millis(), id)
}

fn parse_cursor(raw: &str) -> Option<ParsedCursor> {
    let trimmed = raw.trim();
    let (ts_raw, id_raw) = trimmed.split_once('|')?;
    Some(ParsedCursor {
        ts_epoch_ms: ts_raw.parse::<i64>().ok()?,
        id: Uuid::parse_str(id_raw).ok()?,
    })
}

fn sanitize_event(mut event: SystemEventWrite) -> SystemEventRecord {
    let id = event.event_id.unwrap_or_else(Uuid::new_v4);
    let ts = event.ts.unwrap_or_else(Utc::now);
    let payload_json = event.payload_json.take().map(sanitize_payload_json);
    let secret_preview = event
        .secret_preview
        .take()
        .and_then(|value| secret_preview(&value))
        .or_else(|| derive_secret_preview(payload_json.as_ref()));

    SystemEventRecord {
        id,
        ts,
        category: event.category,
        event_type: normalize_optional_string(Some(event.event_type))
            .unwrap_or_else(|| "unknown".to_string()),
        severity: event.severity,
        source: normalize_optional_string(Some(event.source))
            .unwrap_or_else(|| "unknown".to_string()),
        tenant_id: event.tenant_id,
        account_id: event.account_id,
        request_id: normalize_optional_string(event.request_id),
        trace_request_id: normalize_optional_string(event.trace_request_id),
        job_id: event.job_id,
        account_label: normalize_optional_string(event.account_label),
        auth_provider: normalize_optional_string(event.auth_provider),
        operator_state_from: normalize_optional_string(event.operator_state_from),
        operator_state_to: normalize_optional_string(event.operator_state_to),
        reason_class: normalize_optional_string(event.reason_class),
        reason_code: normalize_optional_string(event.reason_code),
        next_action_at: event.next_action_at,
        path: normalize_optional_string(event.path),
        method: normalize_optional_string(event.method),
        model: normalize_optional_string(event.model),
        selected_account_id: event.selected_account_id,
        selected_proxy_id: event.selected_proxy_id,
        routing_decision: normalize_optional_string(event.routing_decision),
        failover_scope: normalize_optional_string(event.failover_scope),
        status_code: event.status_code,
        upstream_status_code: event.upstream_status_code,
        latency_ms: event.latency_ms,
        message: sanitize_preview_text(event.message),
        preview_text: sanitize_preview_text(event.preview_text),
        payload_json,
        secret_preview,
    }
}

fn sanitize_payload_json(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sanitized = serde_json::Map::with_capacity(map.len());
            for (key, value) in map {
                let lowered = key.to_ascii_lowercase();
                let next_value = if is_sensitive_field_name(&lowered) {
                    redact_value(value)
                } else {
                    sanitize_payload_json(value)
                };
                sanitized.insert(key, next_value);
            }
            Value::Object(sanitized)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sanitize_payload_json).collect()),
        Value::String(value) => Value::String(sanitize_payload_string(&value)),
        other => other,
    }
}

fn redact_value(value: Value) -> Value {
    match value {
        Value::String(raw) => {
            Value::String(secret_preview(&raw).unwrap_or_else(|| REDACTED_TEXT.to_string()))
        }
        Value::Null => Value::Null,
        _ => Value::String(REDACTED_TEXT.to_string()),
    }
}

fn sanitize_payload_string(raw: &str) -> String {
    if let Some(summary) = summarize_upstream_event_payload(raw) {
        return summary;
    }
    if looks_like_secret(raw) {
        return secret_preview(raw).unwrap_or_else(|| REDACTED_TEXT.to_string());
    }
    truncate_chars(raw.trim(), MAX_PAYLOAD_STRING_CHARS)
}

fn sanitize_preview_text(value: Option<String>) -> Option<String> {
    normalize_optional_string(value).map(|raw| {
        if let Some(summary) = summarize_upstream_event_payload(&raw) {
            return summary;
        }
        let maybe_redacted = if looks_like_secret(&raw) {
            secret_preview(&raw).unwrap_or_else(|| REDACTED_TEXT.to_string())
        } else {
            raw
        };
        truncate_chars(&maybe_redacted, MAX_PREVIEW_TEXT_CHARS)
    })
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn truncate_chars(raw: &str, max_chars: usize) -> String {
    let chars = raw.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        return raw.to_string();
    }
    chars.into_iter().take(max_chars).collect::<String>() + "..."
}

fn is_sensitive_field_name(raw: &str) -> bool {
    [
        "token",
        "secret",
        "authorization",
        "api_key",
        "bearer",
        "cookie",
        "password",
    ]
    .iter()
    .any(|needle| raw.contains(needle))
}

fn looks_like_secret(raw: &str) -> bool {
    let trimmed = raw.trim();
    trimmed.starts_with("cp_")
        || trimmed.starts_with("sk-")
        || trimmed.contains("Bearer ")
        || trimmed.len() > 20
            && trimmed
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
}

fn secret_preview(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains("...") {
        return Some(truncate_chars(trimmed, MAX_PREVIEW_TEXT_CHARS));
    }
    let chars = trimmed.chars().collect::<Vec<_>>();
    if chars.len() <= 12 {
        return Some(REDACTED_TEXT.to_string());
    }
    let prefix = chars.iter().take(6).collect::<String>();
    let suffix = chars
        .iter()
        .rev()
        .take(4)
        .copied()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    Some(format!("{prefix}...{suffix}"))
}

fn derive_secret_preview(payload_json: Option<&Value>) -> Option<String> {
    let payload = payload_json?;
    match payload {
        Value::Object(map) => map
            .values()
            .find_map(|value| derive_secret_preview(Some(value))),
        Value::Array(items) => items
            .iter()
            .find_map(|value| derive_secret_preview(Some(value))),
        Value::String(raw) => looks_like_secret(raw)
            .then(|| secret_preview(raw))
            .flatten(),
        _ => None,
    }
}

fn summarize_upstream_event_payload(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if !(trimmed.starts_with('{') && trimmed.contains("\"type\"")) {
        return None;
    }
    let value = serde_json::from_str::<Value>(trimmed).ok()?;
    let event_type = value.get("type")?.as_str()?;
    Some(format!("upstream_event:{event_type}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use codex_pool_core::events::{SystemEventCategory, SystemEventSeverity, SystemEventWrite};

    fn system_event_write(
        ts: DateTime<Utc>,
        category: SystemEventCategory,
        account_id: Option<Uuid>,
        selected_account_id: Option<Uuid>,
        event_type: &str,
        severity: SystemEventSeverity,
        status_code: Option<u16>,
    ) -> SystemEventWrite {
        SystemEventWrite {
            event_id: Some(Uuid::new_v4()),
            ts: Some(ts),
            category,
            event_type: event_type.to_string(),
            severity,
            source: "account-signal-test".to_string(),
            tenant_id: None,
            account_id,
            request_id: None,
            trace_request_id: None,
            job_id: None,
            account_label: None,
            auth_provider: None,
            operator_state_from: None,
            operator_state_to: None,
            reason_class: None,
            reason_code: None,
            next_action_at: None,
            path: None,
            method: None,
            model: None,
            selected_account_id,
            selected_proxy_id: None,
            routing_decision: None,
            failover_scope: None,
            status_code,
            upstream_status_code: status_code,
            latency_ms: None,
            message: None,
            preview_text: None,
            payload_json: None,
            secret_preview: None,
        }
    }

    #[tokio::test]
    async fn sqlite_repo_summarizes_account_signal_heatmaps_with_selected_account_ids() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let repo = sqlite_repo::SqliteSystemEventRepo::new(pool).await.unwrap();
        let tracked_account_id = Uuid::new_v4();
        let other_account_id = Uuid::new_v4();
        let now = DateTime::<Utc>::from_timestamp(1_774_703_640, 0).unwrap();

        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_140, 0).unwrap(),
            SystemEventCategory::Request,
            None,
            Some(tracked_account_id),
            "request_completed",
            SystemEventSeverity::Info,
            Some(200),
        ))
        .await
        .unwrap();
        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_702_960, 0).unwrap(),
            SystemEventCategory::Patrol,
            Some(tracked_account_id),
            None,
            "patrol_succeeded",
            SystemEventSeverity::Info,
            None,
        ))
        .await
        .unwrap();
        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_700_920, 0).unwrap(),
            SystemEventCategory::AccountPool,
            Some(tracked_account_id),
            None,
            "account_pool_succeeded",
            SystemEventSeverity::Info,
            None,
        ))
        .await
        .unwrap();
        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_020, 0).unwrap(),
            SystemEventCategory::Request,
            Some(other_account_id),
            None,
            "request_completed",
            SystemEventSeverity::Info,
            Some(200),
        ))
        .await
        .unwrap();

        let summaries = repo
            .summarize_account_signal_heatmaps(&[tracked_account_id], now, 120, 10)
            .await
            .unwrap();
        let summary = summaries
            .get(&tracked_account_id)
            .expect("summary should exist");

        assert_eq!(summary.intensity_levels.len(), 12);
        assert_eq!(summary.success_counts.len(), 12);
        assert_eq!(summary.error_counts.len(), 12);
        assert_eq!(summary.active_counts.len(), 12);
        assert_eq!(summary.passive_counts.len(), 12);
        assert_eq!(summary.intensity_levels[6], 1);
        assert_eq!(summary.intensity_levels[10], 2);
        assert_eq!(summary.intensity_levels[11], 0);
        assert_eq!(summary.success_counts[6], 1);
        assert_eq!(summary.error_counts[6], 0);
        assert_eq!(summary.success_counts[10], 2);
        assert_eq!(summary.error_counts[10], 0);
        assert_eq!(summary.active_counts[6], 0);
        assert_eq!(summary.passive_counts[6], 1);
        assert_eq!(summary.active_counts[10], 1);
        assert_eq!(summary.passive_counts[10], 1);
    }

    #[tokio::test]
    async fn sqlite_repo_builds_account_signal_heatmap_detail_counts() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let repo = sqlite_repo::SqliteSystemEventRepo::new(pool).await.unwrap();
        let tracked_account_id = Uuid::new_v4();
        let now = DateTime::<Utc>::from_timestamp(1_774_703_640, 0).unwrap();

        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_140, 0).unwrap(),
            SystemEventCategory::Request,
            Some(tracked_account_id),
            None,
            "request_completed",
            SystemEventSeverity::Info,
            Some(200),
        ))
        .await
        .unwrap();
        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_080, 0).unwrap(),
            SystemEventCategory::Patrol,
            None,
            Some(tracked_account_id),
            "patrol_succeeded",
            SystemEventSeverity::Info,
            None,
        ))
        .await
        .unwrap();

        let detail = repo
            .account_signal_heatmap_detail(tracked_account_id, now, 60, 10)
            .await
            .unwrap()
            .expect("detail should exist");
        let bucket = detail
            .buckets
            .iter()
            .find(|bucket| bucket.signal_count > 0)
            .expect("signal bucket should exist");

        assert_eq!(bucket.signal_count, 2);
        assert_eq!(bucket.active_count, 1);
        assert_eq!(bucket.passive_count, 1);
        assert_eq!(bucket.success_count, 2);
        assert_eq!(bucket.error_count, 0);
        assert_eq!(bucket.intensity, 2);
    }

    #[tokio::test]
    async fn sqlite_repo_tracks_request_success_and_error_counts_per_bucket() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let repo = sqlite_repo::SqliteSystemEventRepo::new(pool).await.unwrap();
        let tracked_account_id = Uuid::new_v4();
        let now = DateTime::<Utc>::from_timestamp(1_774_703_640, 0).unwrap();

        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_140, 0).unwrap(),
            SystemEventCategory::Request,
            Some(tracked_account_id),
            None,
            "request_completed",
            SystemEventSeverity::Info,
            Some(200),
        ))
        .await
        .unwrap();
        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_120, 0).unwrap(),
            SystemEventCategory::Request,
            Some(tracked_account_id),
            None,
            "request_failed",
            SystemEventSeverity::Warn,
            Some(429),
        ))
        .await
        .unwrap();

        let detail = repo
            .account_signal_heatmap_detail(tracked_account_id, now, 60, 10)
            .await
            .unwrap()
            .expect("detail should exist");
        let bucket = detail
            .buckets
            .iter()
            .find(|bucket| bucket.signal_count == 2)
            .expect("signal bucket should exist");

        assert_eq!(bucket.active_count, 2);
        assert_eq!(bucket.passive_count, 0);
        assert_eq!(bucket.success_count, 1);
        assert_eq!(bucket.error_count, 1);
    }

    #[tokio::test]
    async fn sqlite_repo_uses_severity_for_non_request_signal_outcomes() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let repo = sqlite_repo::SqliteSystemEventRepo::new(pool).await.unwrap();
        let tracked_account_id = Uuid::new_v4();
        let now = DateTime::<Utc>::from_timestamp(1_774_703_640, 0).unwrap();

        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_140, 0).unwrap(),
            SystemEventCategory::Patrol,
            Some(tracked_account_id),
            None,
            "patrol_completed",
            SystemEventSeverity::Info,
            None,
        ))
        .await
        .unwrap();
        repo.insert_event(system_event_write(
            DateTime::<Utc>::from_timestamp(1_774_703_120, 0).unwrap(),
            SystemEventCategory::AccountPool,
            None,
            Some(tracked_account_id),
            "account_pool_failed",
            SystemEventSeverity::Error,
            None,
        ))
        .await
        .unwrap();

        let detail = repo
            .account_signal_heatmap_detail(tracked_account_id, now, 60, 10)
            .await
            .unwrap()
            .expect("detail should exist");
        let bucket = detail
            .buckets
            .iter()
            .find(|bucket| bucket.signal_count == 2)
            .expect("signal bucket should exist");

        assert_eq!(bucket.active_count, 0);
        assert_eq!(bucket.passive_count, 2);
        assert_eq!(bucket.success_count, 1);
        assert_eq!(bucket.error_count, 1);
    }
}
