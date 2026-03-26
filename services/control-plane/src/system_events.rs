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
use std::sync::Arc;
use uuid::Uuid;

use crate::contracts::{
    SystemEventCorrelationResponse, SystemEventListResponse,
    SystemEventRecord, SystemEventSummaryCategoryCount, SystemEventSummaryReasonCount,
    SystemEventSummaryResponse, SystemEventSummarySeverityCount, SystemEventSummaryTypeCount,
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

#[async_trait]
pub trait SystemEventRepository: Send + Sync {
    async fn insert_event(&self, event: SystemEventWrite) -> Result<SystemEventRecord>;
    async fn list_events(&self, query: SystemEventQuery) -> Result<SystemEventListResponse>;
    async fn get_event(&self, event_id: Uuid) -> Result<Option<SystemEventRecord>>;
    async fn summarize_events(&self, query: SystemEventQuery) -> Result<SystemEventSummaryResponse>;
    async fn correlate_request(
        &self,
        request_id: &str,
        query: SystemEventQuery,
    ) -> Result<SystemEventCorrelationResponse>;
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
            if let Some(request_id) = query.request_id.as_ref().filter(|value| !value.trim().is_empty()) {
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
            if let Some(event_type) = query.event_type.as_ref().filter(|value| !value.trim().is_empty()) {
                builder.push(" AND event_type = ");
                builder.push_bind(event_type.trim().to_string());
            }
            if let Some(severity) = query.severity {
                builder.push(" AND severity = ");
                builder.push_bind(severity_to_db(severity));
            }
            if let Some(reason_code) = query.reason_code.as_ref().filter(|value| !value.trim().is_empty()) {
                builder.push(" AND reason_code = ");
                builder.push_bind(reason_code.trim().to_string());
            }
            if let Some(keyword) = query.keyword.as_ref().filter(|value| !value.trim().is_empty()) {
                let pattern = format!("%{}%", keyword.trim());
                builder.push(" AND (");
                for (idx, field) in ["message", "preview_text", "event_type", "source", "account_label", "request_id", "reason_code"].iter().enumerate() {
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

        async fn summarize_events(&self, query: SystemEventQuery) -> Result<SystemEventSummaryResponse> {
            let mut total_builder =
                QueryBuilder::<Sqlite>::new("SELECT COUNT(*) AS count FROM system_event_logs WHERE 1=1");
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
            if let Some(request_id) = query.request_id.as_ref().filter(|value| !value.trim().is_empty()) {
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
            if let Some(event_type) = query.event_type.as_ref().filter(|value| !value.trim().is_empty()) {
                builder.push(" AND event_type = ");
                builder.push_bind(event_type.trim().to_string());
            }
            if let Some(severity) = query.severity {
                builder.push(" AND severity = ");
                builder.push_bind(severity_to_db(severity));
            }
            if let Some(reason_code) = query.reason_code.as_ref().filter(|value| !value.trim().is_empty()) {
                builder.push(" AND reason_code = ");
                builder.push_bind(reason_code.trim().to_string());
            }
            if let Some(keyword) = query.keyword.as_ref().filter(|value| !value.trim().is_empty()) {
                let pattern = format!("%{}%", keyword.trim());
                builder.push(" AND (");
                for (idx, field) in ["message", "preview_text", "event_type", "source", "account_label", "request_id", "reason_code"].iter().enumerate() {
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
    }
}

fn map_sqlite_system_event_row(row: SqliteRow) -> Result<SystemEventRecord> {
    Ok(SystemEventRecord {
        id: Uuid::parse_str(&row.try_get::<String, _>("id")?)
            .context("invalid system event id")?,
        ts: row.try_get("ts")?,
        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
        event_type: row.try_get("event_type")?,
        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
        source: row.try_get("source")?,
        tenant_id: parse_optional_uuid(row.try_get("tenant_id")?)?,
        account_id: parse_optional_uuid(row.try_get("account_id")?)?,
        request_id: row.try_get("request_id")?,
        trace_request_id: row.try_get("trace_request_id")?,
        job_id: parse_optional_uuid(row.try_get("job_id")?)?,
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
        selected_account_id: parse_optional_uuid(row.try_get("selected_account_id")?)?,
        selected_proxy_id: parse_optional_uuid(row.try_get("selected_proxy_id")?)?,
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
        id: Uuid::parse_str(&row.try_get::<String, _>("id")?)
            .context("invalid system event id")?,
        ts: row.try_get("ts")?,
        category: parse_category(row.try_get::<String, _>("category")?.as_str())?,
        event_type: row.try_get("event_type")?,
        severity: parse_severity(row.try_get::<String, _>("severity")?.as_str())?,
        source: row.try_get("source")?,
        tenant_id: parse_optional_uuid(row.try_get("tenant_id")?)?,
        account_id: parse_optional_uuid(row.try_get("account_id")?)?,
        request_id: row.try_get("request_id")?,
        trace_request_id: row.try_get("trace_request_id")?,
        job_id: parse_optional_uuid(row.try_get("job_id")?)?,
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
        selected_account_id: parse_optional_uuid(row.try_get("selected_account_id")?)?,
        selected_proxy_id: parse_optional_uuid(row.try_get("selected_proxy_id")?)?,
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
            .try_get::<Option<Value>, _>("payload_json")?,
        secret_preview: row.try_get("secret_preview")?,
    })
}

fn parse_optional_uuid(raw: Option<String>) -> Result<Option<Uuid>> {
    raw.map(|value| Uuid::parse_str(&value).context("invalid uuid in system event row"))
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
        Value::String(raw) => Value::String(secret_preview(&raw).unwrap_or_else(|| REDACTED_TEXT.to_string())),
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
    ["token", "secret", "authorization", "api_key", "bearer", "cookie", "password"]
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
        Value::Object(map) => map.values().find_map(|value| derive_secret_preview(Some(value))),
        Value::Array(items) => items
            .iter()
            .find_map(|value| derive_secret_preview(Some(value))),
        Value::String(raw) => looks_like_secret(raw).then(|| secret_preview(raw)).flatten(),
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
