#![cfg_attr(not(feature = "postgres-backend"), allow(dead_code, unused_imports))]

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use crate::edition_migration::query_window;
use crate::store::normalize_sqlite_database_url;
#[cfg(feature = "postgres-backend")]
use crate::store::postgres::PostgresStore;
use crate::usage::clickhouse_repo::UsageQueryRepository;
use crate::usage::{aggregate_by_hour, RequestLogQuery, RequestLogRow, UsageAggregationEvent};
use sqlx_core::pool::PoolOptions;
use sqlx_sqlite::Sqlite;

#[cfg(feature = "postgres-backend")]
use super::postgres_repo::PostgresUsageRepo;
use super::sqlite_repo::SqliteUsageRepo;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageMigrationBundle {
    pub request_logs: Vec<RequestLogRow>,
}

fn bundle_to_events(bundle: &UsageMigrationBundle) -> Vec<UsageAggregationEvent> {
    bundle
        .request_logs
        .iter()
        .map(|row| UsageAggregationEvent {
            account_id: row.account_id,
            tenant_id: row.tenant_id,
            api_key_id: row.api_key_id,
            created_at: row.created_at,
        })
        .collect()
}

async fn query_all_request_logs<R>(repo: &R) -> Result<Vec<RequestLogRow>>
where
    R: UsageQueryRepository,
{
    let (start_ts, end_ts) = query_window();
    repo.query_request_logs(RequestLogQuery {
        start_ts,
        end_ts,
        limit: u32::MAX,
        tenant_id: None,
        api_key_id: None,
        status_code: None,
        request_id: None,
        keyword: None,
    })
    .await
}

pub async fn export_sqlite_usage_bundle(
    pool: &sqlx_sqlite::SqlitePool,
) -> Result<UsageMigrationBundle> {
    let repo = SqliteUsageRepo::new(pool.clone()).await?;
    let mut request_logs = query_all_request_logs(&repo).await?;
    request_logs.sort_by_key(|row| (row.created_at, row.id));
    Ok(UsageMigrationBundle { request_logs })
}

#[cfg(feature = "postgres-backend")]
pub async fn export_postgres_usage_bundle(database_url: &str) -> Result<UsageMigrationBundle> {
    let store = PostgresStore::connect(database_url).await?;
    let repo = PostgresUsageRepo::new(store.clone_pool());
    let mut request_logs = query_all_request_logs(&repo).await?;
    request_logs.sort_by_key(|row| (row.created_at, row.id));
    Ok(UsageMigrationBundle { request_logs })
}

pub async fn import_sqlite_usage_bundle(
    database_url: &str,
    bundle: &UsageMigrationBundle,
) -> Result<()> {
    let normalized = normalize_sqlite_database_url(database_url);
    let pool = PoolOptions::<Sqlite>::new()
        .max_connections(1)
        .connect(&normalized)
        .await
        .with_context(|| format!("failed to connect sqlite usage db at {normalized}"))?;
    let _repo = SqliteUsageRepo::new(pool.clone()).await?;

    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usage_request_logs")
        .fetch_one(&pool)
        .await
        .context("failed to inspect sqlite usage_request_logs")?;
    if existing > 0 {
        bail!("sqlite usage target already contains request logs");
    }

    for row in &bundle.request_logs {
        sqlx::query(
            r#"
            INSERT INTO usage_request_logs (
                id, account_id, tenant_id, api_key_id, request_id, path, method, model, service_tier,
                input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
                first_token_latency_ms, status_code, latency_ms, is_stream, error_code,
                billing_phase, authorization_id, capture_status, estimated_cost_microusd,
                created_at, created_at_ts, hour_start_ts, event_version
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(row.id.to_string())
        .bind(row.account_id.to_string())
        .bind(row.tenant_id.map(|value| value.to_string()))
        .bind(row.api_key_id.map(|value| value.to_string()))
        .bind(&row.request_id)
        .bind(&row.path)
        .bind(&row.method)
        .bind(&row.model)
        .bind(&row.service_tier)
        .bind(row.input_tokens)
        .bind(row.cached_input_tokens)
        .bind(row.output_tokens)
        .bind(row.reasoning_tokens)
        .bind(
            row.first_token_latency_ms
                .map(|value| i64::try_from(value).unwrap_or(i64::MAX)),
        )
        .bind(i64::from(row.status_code))
        .bind(i64::try_from(row.latency_ms).context("latency_ms overflow")?)
        .bind(row.is_stream)
        .bind(&row.error_code)
        .bind(&row.billing_phase)
        .bind(row.authorization_id.map(|value| value.to_string()))
        .bind(&row.capture_status)
        .bind(row.estimated_cost_microusd)
        .bind(row.created_at.to_rfc3339())
        .bind(row.created_at.timestamp())
        .bind(row.created_at.timestamp() - row.created_at.timestamp().rem_euclid(3600))
        .bind(i64::from(row.event_version))
        .execute(&pool)
        .await
        .context("failed to import sqlite request log row")?;
    }

    Ok(())
}

#[cfg(feature = "postgres-backend")]
pub async fn import_postgres_usage_bundle(
    database_url: &str,
    bundle: &UsageMigrationBundle,
) -> Result<()> {
    let store = PostgresStore::connect(database_url).await?;
    let pool = store.clone_pool();

    let existing: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM usage_request_logs")
        .fetch_one(&pool)
        .await
        .context("failed to inspect postgres usage_request_logs")?;
    if existing > 0 {
        bail!("postgres usage target already contains request logs");
    }

    let hourly_rows = aggregate_by_hour(bundle_to_events(bundle));
    let mut tx = pool
        .begin()
        .await
        .context("failed to start postgres usage migration transaction")?;

    for row in &bundle.request_logs {
        sqlx::query(
            r#"
            INSERT INTO usage_request_logs (
                id, account_id, tenant_id, api_key_id, request_id, path, method, model, service_tier,
                input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, first_token_latency_ms,
                status_code, latency_ms, is_stream, error_code, billing_phase, authorization_id,
                capture_status, estimated_cost_microusd, created_at, event_version
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9,
                $10, $11, $12, $13, $14, $15, $16, $17,
                $18, $19, $20, $21, $22, $23, $24
            )
            "#,
        )
        .bind(row.id)
        .bind(row.account_id)
        .bind(row.tenant_id)
        .bind(row.api_key_id)
        .bind(&row.request_id)
        .bind(&row.path)
        .bind(&row.method)
        .bind(&row.model)
        .bind(&row.service_tier)
        .bind(row.input_tokens)
        .bind(row.cached_input_tokens)
        .bind(row.output_tokens)
        .bind(row.reasoning_tokens)
        .bind(
            row.first_token_latency_ms
                .map(|value| i64::try_from(value).unwrap_or(i64::MAX)),
        )
        .bind(i32::from(row.status_code))
        .bind(i64::try_from(row.latency_ms).context("latency_ms overflow")?)
        .bind(row.is_stream)
        .bind(&row.error_code)
        .bind(&row.billing_phase)
        .bind(row.authorization_id)
        .bind(&row.capture_status)
        .bind(row.estimated_cost_microusd)
        .bind(row.created_at)
        .bind(i32::from(row.event_version))
        .execute(tx.as_mut())
        .await
        .context("failed to import postgres request log row")?;
    }

    for row in hourly_rows.account_rows {
        sqlx::query(
            "INSERT INTO usage_hourly_account (account_id, hour_start, request_count) VALUES ($1, $2, $3)",
        )
        .bind(row.account_id)
        .bind(row.hour_start)
        .bind(i64::try_from(row.request_count).context("hourly account request_count overflow")?)
        .execute(tx.as_mut())
        .await
        .context("failed to import usage_hourly_account row")?;
    }

    for row in hourly_rows.tenant_api_key_rows {
        sqlx::query(
            "INSERT INTO usage_hourly_tenant_api_key (tenant_id, api_key_id, hour_start, request_count) VALUES ($1, $2, $3, $4)",
        )
        .bind(row.tenant_id)
        .bind(row.api_key_id)
        .bind(row.hour_start)
        .bind(i64::try_from(row.request_count).context("hourly tenant api key request_count overflow")?)
        .execute(tx.as_mut())
        .await
        .context("failed to import usage_hourly_tenant_api_key row")?;
    }

    for row in hourly_rows.tenant_account_rows {
        sqlx::query(
            "INSERT INTO usage_hourly_tenant_account (tenant_id, account_id, hour_start, request_count) VALUES ($1, $2, $3, $4)",
        )
        .bind(row.tenant_id)
        .bind(row.account_id)
        .bind(row.hour_start)
        .bind(i64::try_from(row.request_count).context("hourly tenant account request_count overflow")?)
        .execute(tx.as_mut())
        .await
        .context("failed to import usage_hourly_tenant_account row")?;
    }

    tx.commit()
        .await
        .context("failed to commit postgres usage migration transaction")?;
    Ok(())
}
