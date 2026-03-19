use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use codex_pool_core::events::RequestLogEvent;
use control_plane::usage::worker::{
    ConsumerGroupBacklog, RequestLogStreamReader, StreamMessage, StreamReadResult,
    UsageAggregationRepository, UsageAggregationWorker, UsageWorkerConfig,
    UsageWorkerRuntimeMetrics,
};
use control_plane::usage::{
    HourlyAccountUsageRow, HourlyTenantAccountUsageRow, HourlyTenantApiKeyUsageRow, RequestLogRow,
};
use tokio::sync::{oneshot, Notify};
use tokio::time::{sleep, timeout};
use uuid::Uuid;

#[derive(Clone)]
struct RecordingStreamReader {
    state: Arc<Mutex<ReaderState>>,
}

#[derive(Default)]
struct ReaderState {
    calls: Vec<String>,
    reclaim_response: StreamReadResult,
    read_response: StreamReadResult,
    backlog: ConsumerGroupBacklog,
    read_args: Vec<(usize, Duration)>,
    reclaim_args: Vec<(usize, Duration)>,
    acked: Vec<Vec<String>>,
}

impl RecordingStreamReader {
    fn with_responses(
        reclaim_response: Vec<StreamMessage>,
        read_response: Vec<StreamMessage>,
    ) -> Self {
        Self::with_read_results(
            stream_read_result(reclaim_response, 0),
            stream_read_result(read_response, 0),
        )
    }

    fn with_read_results(
        reclaim_response: StreamReadResult,
        read_response: StreamReadResult,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(ReaderState {
                reclaim_response,
                read_response,
                ..ReaderState::default()
            })),
        }
    }

    fn with_backlog(self, backlog: ConsumerGroupBacklog) -> Self {
        self.state.lock().unwrap().backlog = backlog;
        self
    }

    fn snapshot(&self) -> ReaderStateSnapshot {
        let state = self.state.lock().unwrap();
        ReaderStateSnapshot {
            calls: state.calls.clone(),
            read_args: state.read_args.clone(),
            reclaim_args: state.reclaim_args.clone(),
            acked: state.acked.clone(),
        }
    }
}

struct ReaderStateSnapshot {
    calls: Vec<String>,
    read_args: Vec<(usize, Duration)>,
    reclaim_args: Vec<(usize, Duration)>,
    acked: Vec<Vec<String>>,
}

#[derive(Clone)]
struct SequencedStreamReader {
    state: Arc<Mutex<SequencedReaderState>>,
    pause_on_empty_read: Option<Arc<Notify>>,
}

#[derive(Default)]
struct SequencedReaderState {
    calls: Vec<String>,
    reclaim_batches: VecDeque<StreamReadResult>,
    read_batches: VecDeque<StreamReadResult>,
    acked: Vec<Vec<String>>,
}

impl SequencedStreamReader {
    fn new(
        reclaim_batches: Vec<Vec<StreamMessage>>,
        read_batches: Vec<Vec<StreamMessage>>,
    ) -> Self {
        let reclaim_batches = reclaim_batches
            .into_iter()
            .map(|messages| stream_read_result(messages, 0))
            .collect::<VecDeque<_>>();
        let read_batches = read_batches
            .into_iter()
            .map(|messages| stream_read_result(messages, 0))
            .collect::<VecDeque<_>>();

        Self {
            state: Arc::new(Mutex::new(SequencedReaderState {
                reclaim_batches,
                read_batches,
                ..SequencedReaderState::default()
            })),
            pause_on_empty_read: None,
        }
    }

    fn with_pause_on_empty_read(mut self, pause_on_empty_read: Arc<Notify>) -> Self {
        self.pause_on_empty_read = Some(pause_on_empty_read);
        self
    }

    fn snapshot(&self) -> SequencedReaderSnapshot {
        let state = self.state.lock().unwrap();
        SequencedReaderSnapshot {
            calls: state.calls.clone(),
            acked: state.acked.clone(),
        }
    }
}

struct SequencedReaderSnapshot {
    calls: Vec<String>,
    acked: Vec<Vec<String>>,
}

#[derive(Clone)]
struct ErrorSequenceStreamReader {
    state: Arc<Mutex<ErrorSequenceReaderState>>,
}

#[derive(Default)]
struct ErrorSequenceReaderState {
    calls: Vec<String>,
    reclaim_results: VecDeque<anyhow::Result<StreamReadResult>>,
    read_results: VecDeque<anyhow::Result<StreamReadResult>>,
    ack_results: VecDeque<anyhow::Result<()>>,
    acked: Vec<Vec<String>>,
}

impl ErrorSequenceStreamReader {
    fn new(
        reclaim_results: Vec<anyhow::Result<Vec<StreamMessage>>>,
        read_results: Vec<anyhow::Result<Vec<StreamMessage>>>,
        ack_results: Vec<anyhow::Result<()>>,
    ) -> Self {
        let reclaim_results = reclaim_results
            .into_iter()
            .map(|result| result.map(|messages| stream_read_result(messages, 0)))
            .collect::<VecDeque<_>>();
        let read_results = read_results
            .into_iter()
            .map(|result| result.map(|messages| stream_read_result(messages, 0)))
            .collect::<VecDeque<_>>();

        Self {
            state: Arc::new(Mutex::new(ErrorSequenceReaderState {
                reclaim_results,
                read_results,
                ack_results: VecDeque::from(ack_results),
                ..ErrorSequenceReaderState::default()
            })),
        }
    }

    fn snapshot(&self) -> ErrorSequenceReaderSnapshot {
        let state = self.state.lock().unwrap();
        ErrorSequenceReaderSnapshot {
            calls: state.calls.clone(),
            acked: state.acked.clone(),
        }
    }
}

struct ErrorSequenceReaderSnapshot {
    calls: Vec<String>,
    acked: Vec<Vec<String>>,
}

#[async_trait]
impl RequestLogStreamReader for SequencedStreamReader {
    async fn ensure_consumer_group(&self) -> anyhow::Result<()> {
        self.state.lock().unwrap().calls.push("ensure".to_string());
        Ok(())
    }

    async fn reclaim_pending(
        &self,
        _count: usize,
        _min_idle: Duration,
    ) -> anyhow::Result<StreamReadResult> {
        let mut state = self.state.lock().unwrap();
        state.calls.push("reclaim".to_string());
        Ok(state.reclaim_batches.pop_front().unwrap_or_default())
    }

    async fn read_group(&self, _count: usize, block: Duration) -> anyhow::Result<StreamReadResult> {
        let maybe_batch = {
            let mut state = self.state.lock().unwrap();
            state.calls.push("read".to_string());
            state.read_batches.pop_front()
        };

        if let Some(batch) = maybe_batch {
            return Ok(batch);
        }

        if let Some(pause_on_empty_read) = &self.pause_on_empty_read {
            pause_on_empty_read.notified().await;
        } else {
            sleep(block).await;
        }

        Ok(StreamReadResult::default())
    }

    async fn ack(&self, message_ids: &[String]) -> anyhow::Result<()> {
        let mut state = self.state.lock().unwrap();
        state.calls.push("ack".to_string());
        state.acked.push(message_ids.to_vec());

        Ok(())
    }

    async fn consumer_group_backlog(&self) -> anyhow::Result<ConsumerGroupBacklog> {
        Ok(ConsumerGroupBacklog::default())
    }
}

#[async_trait]
impl RequestLogStreamReader for RecordingStreamReader {
    async fn ensure_consumer_group(&self) -> anyhow::Result<()> {
        self.state.lock().unwrap().calls.push("ensure".to_string());
        Ok(())
    }

    async fn reclaim_pending(
        &self,
        count: usize,
        min_idle: Duration,
    ) -> anyhow::Result<StreamReadResult> {
        let mut state = self.state.lock().unwrap();
        state.calls.push("reclaim".to_string());
        state.reclaim_args.push((count, min_idle));
        Ok(std::mem::take(&mut state.reclaim_response))
    }

    async fn read_group(&self, count: usize, block: Duration) -> anyhow::Result<StreamReadResult> {
        let mut state = self.state.lock().unwrap();
        state.calls.push("read".to_string());
        state.read_args.push((count, block));
        Ok(std::mem::take(&mut state.read_response))
    }

    async fn ack(&self, message_ids: &[String]) -> anyhow::Result<()> {
        let mut state = self.state.lock().unwrap();
        state.calls.push("ack".to_string());
        state.acked.push(message_ids.to_vec());
        Ok(())
    }

    async fn consumer_group_backlog(&self) -> anyhow::Result<ConsumerGroupBacklog> {
        Ok(self.state.lock().unwrap().backlog)
    }
}

#[async_trait]
impl RequestLogStreamReader for ErrorSequenceStreamReader {
    async fn ensure_consumer_group(&self) -> anyhow::Result<()> {
        self.state.lock().unwrap().calls.push("ensure".to_string());
        Ok(())
    }

    async fn reclaim_pending(
        &self,
        _count: usize,
        _min_idle: Duration,
    ) -> anyhow::Result<StreamReadResult> {
        let result = {
            let mut state = self.state.lock().unwrap();
            state.calls.push("reclaim".to_string());
            state
                .reclaim_results
                .pop_front()
                .unwrap_or_else(|| Ok(StreamReadResult::default()))
        };
        result
    }

    async fn read_group(
        &self,
        _count: usize,
        _block: Duration,
    ) -> anyhow::Result<StreamReadResult> {
        let result = {
            let mut state = self.state.lock().unwrap();
            state.calls.push("read".to_string());
            state
                .read_results
                .pop_front()
                .unwrap_or_else(|| Ok(StreamReadResult::default()))
        };
        result
    }

    async fn ack(&self, message_ids: &[String]) -> anyhow::Result<()> {
        let result = {
            let mut state = self.state.lock().unwrap();
            state.calls.push("ack".to_string());
            state.acked.push(message_ids.to_vec());
            state.ack_results.pop_front().unwrap_or(Ok(()))
        };
        result
    }

    async fn consumer_group_backlog(&self) -> anyhow::Result<ConsumerGroupBacklog> {
        Ok(ConsumerGroupBacklog::default())
    }
}

#[derive(Clone, Default)]
struct RecordingRepo {
    account_rows: Arc<Mutex<Vec<HourlyAccountUsageRow>>>,
    tenant_api_key_rows: Arc<Mutex<Vec<HourlyTenantApiKeyUsageRow>>>,
    tenant_account_rows: Arc<Mutex<Vec<HourlyTenantAccountUsageRow>>>,
    request_rows: Arc<Mutex<Vec<RequestLogRow>>>,
}

#[async_trait]
impl UsageAggregationRepository for RecordingRepo {
    async fn upsert_hourly(
        &self,
        account_rows: Vec<HourlyAccountUsageRow>,
        tenant_api_key_rows: Vec<HourlyTenantApiKeyUsageRow>,
        tenant_account_rows: Vec<HourlyTenantAccountUsageRow>,
    ) -> anyhow::Result<()> {
        self.account_rows.lock().unwrap().extend(account_rows);
        self.tenant_api_key_rows
            .lock()
            .unwrap()
            .extend(tenant_api_key_rows);
        self.tenant_account_rows
            .lock()
            .unwrap()
            .extend(tenant_account_rows);
        Ok(())
    }

    async fn upsert_request_logs(&self, rows: Vec<RequestLogRow>) -> anyhow::Result<()> {
        self.request_rows.lock().unwrap().extend(rows);
        Ok(())
    }
}

fn sample_event(account_id: Uuid, created_at: DateTime<Utc>) -> RequestLogEvent {
    RequestLogEvent {
        id: Uuid::new_v4(),
        account_id,
        tenant_id: None,
        api_key_id: None,
        event_version: 2,
        path: "/v1/responses".to_string(),
        method: "POST".to_string(),
        status_code: 200,
        latency_ms: 120,
        is_stream: false,
        error_code: None,
        request_id: Some("req-worker-test".to_string()),
        model: Some("gpt-5.3-codex".to_string()),
        service_tier: Some("default".to_string()),
        input_tokens: None,
        cached_input_tokens: None,
        output_tokens: None,
        reasoning_tokens: None,
        first_token_latency_ms: None,
        billing_phase: None,
        authorization_id: None,
        capture_status: None,
        created_at,
    }
}

#[tokio::test]
async fn worker_persists_raw_request_log_rows_before_ack() {
    let account_id = Uuid::new_v4();
    let tenant_id = Uuid::new_v4();
    let api_key_id = Uuid::new_v4();
    let created_at = Utc.with_ymd_and_hms(2026, 2, 24, 12, 0, 0).unwrap();
    let reader = RecordingStreamReader::with_responses(
        vec![],
        vec![StreamMessage {
            message_id: "m-1".to_string(),
            event: RequestLogEvent {
                id: Uuid::new_v4(),
                account_id,
                tenant_id: Some(tenant_id),
                api_key_id: Some(api_key_id),
                event_version: 2,
                path: "/v1/responses".to_string(),
                method: "POST".to_string(),
                status_code: 429,
                latency_ms: 88,
                is_stream: false,
                error_code: Some("429".to_string()),
                request_id: Some("req-red-green".to_string()),
                model: Some("gpt-5.3-codex".to_string()),
                service_tier: Some("priority".to_string()),
                input_tokens: Some(321),
                cached_input_tokens: None,
                output_tokens: Some(654),
                reasoning_tokens: None,
                first_token_latency_ms: None,
                billing_phase: Some("captured".to_string()),
                authorization_id: Some(Uuid::new_v4()),
                capture_status: Some("captured".to_string()),
                created_at,
            },
            tenant_id: Some(tenant_id),
            api_key_id: Some(api_key_id),
        }],
    );
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader.clone(), repo.clone());

    worker.run_once().await.unwrap();

    let request_rows = repo.request_rows.lock().unwrap().clone();
    assert_eq!(request_rows.len(), 1);
    let row = &request_rows[0];
    assert_eq!(row.account_id, account_id);
    assert_eq!(row.tenant_id, Some(tenant_id));
    assert_eq!(row.api_key_id, Some(api_key_id));
    assert_eq!(row.request_id.as_deref(), Some("req-red-green"));
    assert_eq!(row.model.as_deref(), Some("gpt-5.3-codex"));
    assert_eq!(row.service_tier.as_deref(), Some("priority"));
    assert_eq!(row.input_tokens, Some(321));
    assert_eq!(row.output_tokens, Some(654));
    assert_eq!(row.path, "/v1/responses");
    assert_eq!(row.method, "POST");
    assert_eq!(row.status_code, 429);
    assert_eq!(row.latency_ms, 88);
    assert_eq!(row.error_code.as_deref(), Some("429"));
    assert_eq!(row.billing_phase.as_deref(), Some("captured"));
    assert_eq!(row.capture_status.as_deref(), Some("captured"));
    assert!(row.authorization_id.is_some());
    assert_eq!(row.created_at, created_at);

    let snapshot = reader.snapshot();
    assert_eq!(snapshot.acked, vec![vec!["m-1".to_string()]]);
}

fn stream_read_result(
    messages: Vec<StreamMessage>,
    malformed_acked_count: u64,
) -> StreamReadResult {
    stream_read_result_with_reason_breakdown(messages, malformed_acked_count, 0, 0, 0)
}

fn stream_read_result_with_reason_breakdown(
    messages: Vec<StreamMessage>,
    malformed_acked_count: u64,
    malformed_missing_event_count: u64,
    malformed_invalid_json_count: u64,
    malformed_other_count: u64,
) -> StreamReadResult {
    stream_read_result_with_reason_breakdown_and_raw_bytes(
        messages,
        malformed_acked_count,
        malformed_missing_event_count,
        malformed_invalid_json_count,
        malformed_other_count,
        0,
    )
}

fn stream_read_result_with_reason_breakdown_and_raw_bytes(
    messages: Vec<StreamMessage>,
    malformed_acked_count: u64,
    malformed_missing_event_count: u64,
    malformed_invalid_json_count: u64,
    malformed_other_count: u64,
    malformed_raw_event_bytes_total: u64,
) -> StreamReadResult {
    stream_read_result_with_reason_breakdown_and_raw_bytes_and_dead_letter_outcomes(
        messages,
        malformed_acked_count,
        malformed_missing_event_count,
        malformed_invalid_json_count,
        malformed_other_count,
        malformed_raw_event_bytes_total,
        0,
        0,
    )
}

#[allow(clippy::too_many_arguments)]
fn stream_read_result_with_reason_breakdown_and_raw_bytes_and_dead_letter_outcomes(
    messages: Vec<StreamMessage>,
    malformed_acked_count: u64,
    malformed_missing_event_count: u64,
    malformed_invalid_json_count: u64,
    malformed_other_count: u64,
    malformed_raw_event_bytes_total: u64,
    dead_letter_relay_success_count: u64,
    dead_letter_relay_failed_count: u64,
) -> StreamReadResult {
    stream_read_result_with_reason_breakdown_and_raw_bytes_and_dead_letter_stats(
        messages,
        malformed_acked_count,
        malformed_missing_event_count,
        malformed_invalid_json_count,
        malformed_other_count,
        malformed_raw_event_bytes_total,
        0,
        0,
        dead_letter_relay_success_count,
        dead_letter_relay_failed_count,
    )
}

#[allow(clippy::too_many_arguments)]
fn stream_read_result_with_reason_breakdown_and_raw_bytes_and_dead_letter_stats(
    messages: Vec<StreamMessage>,
    malformed_acked_count: u64,
    malformed_missing_event_count: u64,
    malformed_invalid_json_count: u64,
    malformed_other_count: u64,
    malformed_raw_event_bytes_total: u64,
    dead_letter_relay_attempt_count: u64,
    dead_letter_relay_skipped_count: u64,
    dead_letter_relay_success_count: u64,
    dead_letter_relay_failed_count: u64,
) -> StreamReadResult {
    StreamReadResult {
        messages,
        malformed_acked_count,
        malformed_missing_event_count,
        malformed_invalid_json_count,
        malformed_other_count,
        malformed_raw_event_bytes_total,
        dead_letter_relay_attempt_count,
        dead_letter_relay_skipped_count,
        dead_letter_relay_success_count,
        dead_letter_relay_failed_count,
    }
}

#[test]
fn error_backoff_grows_exponentially() {
    let config = UsageWorkerConfig::default();

    assert_eq!(config.compute_backoff(1), Duration::from_millis(1000));
    assert_eq!(config.compute_backoff(2), Duration::from_millis(2000));
    assert_eq!(config.compute_backoff(3), Duration::from_millis(4000));
}

#[test]
fn error_backoff_is_capped_by_maximum() {
    let config = UsageWorkerConfig::default();

    assert_eq!(config.compute_backoff(4), Duration::from_millis(8000));
    assert_eq!(config.compute_backoff(5), Duration::from_millis(10000));
    assert_eq!(config.compute_backoff(8), Duration::from_millis(10000));
}

#[test]
fn error_backoff_with_jitter_stays_within_expected_range() {
    let config = UsageWorkerConfig {
        error_backoff_jitter_pct: 20,
        ..UsageWorkerConfig::default()
    };

    for _ in 0..128 {
        let backoff = config.compute_backoff(3);
        assert!(
            (3200..=4800).contains(&backoff.as_millis()),
            "backoff out of range: {}",
            backoff.as_millis()
        );
    }
}

#[test]
fn error_backoff_with_jitter_never_exceeds_maximum() {
    let config = UsageWorkerConfig {
        error_backoff: Duration::from_millis(1000),
        error_backoff_factor: 2,
        error_backoff_max: Duration::from_millis(1500),
        error_backoff_jitter_pct: 100,
        ..UsageWorkerConfig::default()
    };

    for _ in 0..128 {
        let backoff = config.compute_backoff(2);
        assert!(backoff <= Duration::from_millis(1500));
    }
}

#[test]
fn seeded_error_backoff_produces_reproducible_sequence() {
    let config = UsageWorkerConfig {
        error_backoff_jitter_pct: 100,
        error_backoff_jitter_seed: Some(7),
        ..UsageWorkerConfig::default()
    };

    let first = (1..=12)
        .map(|consecutive_errors| config.compute_backoff(consecutive_errors))
        .collect::<Vec<_>>();
    let second = (1..=12)
        .map(|consecutive_errors| config.compute_backoff(consecutive_errors))
        .collect::<Vec<_>>();

    assert_eq!(first, second);
}

#[test]
fn seeded_error_backoff_differs_for_different_seeds() {
    let first_seed = UsageWorkerConfig {
        error_backoff_jitter_pct: 100,
        error_backoff_jitter_seed: Some(7),
        ..UsageWorkerConfig::default()
    };
    let second_seed = UsageWorkerConfig {
        error_backoff_jitter_pct: 100,
        error_backoff_jitter_seed: Some(11),
        ..UsageWorkerConfig::default()
    };

    let first_sequence = (1..=12)
        .map(|consecutive_errors| first_seed.compute_backoff(consecutive_errors))
        .collect::<Vec<_>>();
    let second_sequence = (1..=12)
        .map(|consecutive_errors| second_seed.compute_backoff(consecutive_errors))
        .collect::<Vec<_>>();

    assert_ne!(first_sequence, second_sequence);
}

#[test]
fn seeded_error_backoff_is_still_capped_by_maximum() {
    let config = UsageWorkerConfig {
        error_backoff: Duration::from_millis(1000),
        error_backoff_factor: 2,
        error_backoff_max: Duration::from_millis(1500),
        error_backoff_jitter_pct: 100,
        error_backoff_jitter_seed: Some(123),
        ..UsageWorkerConfig::default()
    };

    for consecutive_errors in 1..=16 {
        let backoff = config.compute_backoff(consecutive_errors);
        assert!(backoff <= Duration::from_millis(1500));
    }
}

#[test]
fn error_backoff_resets_after_successful_round() {
    let config = UsageWorkerConfig::default();
    let mut consecutive_errors = 0_u32;

    consecutive_errors += 1;
    assert_eq!(
        config.compute_backoff(consecutive_errors),
        Duration::from_millis(1000)
    );

    consecutive_errors += 1;
    assert_eq!(
        config.compute_backoff(consecutive_errors),
        Duration::from_millis(2000)
    );

    consecutive_errors = 0;
    consecutive_errors += 1;
    assert_eq!(
        config.compute_backoff(consecutive_errors),
        Duration::from_millis(1000)
    );
}
