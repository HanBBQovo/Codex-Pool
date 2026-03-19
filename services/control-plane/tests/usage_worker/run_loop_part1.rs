#[tokio::test]
async fn worker_applies_stream_block_and_count_from_config() {
    let reader = RecordingStreamReader::with_responses(vec![], vec![]);
    let repo = RecordingRepo::default();
    let config = UsageWorkerConfig {
        stream_read_count: 17,
        stream_block: Duration::from_millis(1300),
        reclaim_count: 9,
        reclaim_min_idle: Duration::from_millis(42000),
        flush_min_batch: 1,
        flush_interval: Duration::from_secs(1),
        metrics_log_interval: Duration::from_secs(10),
        error_backoff: Duration::from_millis(1000),
        error_backoff_factor: 2,
        error_backoff_max: Duration::from_millis(10000),
        error_backoff_jitter_pct: 0,
        error_backoff_jitter_seed: None,
        max_consecutive_errors: 0,
    };

    let worker = UsageAggregationWorker::with_config(reader.clone(), repo, config);
    worker.run_once().await.unwrap();

    let snapshot = reader.snapshot();
    assert_eq!(snapshot.read_args, vec![(17, Duration::from_millis(1300))]);
    assert_eq!(
        snapshot.reclaim_args,
        vec![(9, Duration::from_millis(42000))]
    );
}

#[tokio::test]
async fn worker_reclaims_pending_before_reading_new_messages() {
    let account_id = Uuid::new_v4();
    let reclaim_message = StreamMessage {
        message_id: "1708260000000-0".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 23, 1).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };
    let reader = RecordingStreamReader::with_responses(vec![reclaim_message], vec![]);
    let repo = RecordingRepo::default();

    let worker = UsageAggregationWorker::new(reader.clone(), repo.clone());
    worker.run_once().await.unwrap();

    let snapshot = reader.snapshot();
    assert_eq!(snapshot.calls, vec!["reclaim", "read", "ack"]);
    assert_eq!(snapshot.acked, vec![vec!["1708260000000-0".to_string()]]);

    let rows = repo.account_rows.lock().unwrap().clone();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].request_count, 1);
}

#[tokio::test]
async fn run_once_with_stats_reports_extended_counts() {
    let account_id = Uuid::new_v4();
    let reclaim_message = StreamMessage {
        message_id: "1708260000000-10".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 23, 1).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };
    let read_message_one = StreamMessage {
        message_id: "1708260000000-11".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 25, 17).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };
    let read_message_two = StreamMessage {
        message_id: "1708260000000-12".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 32, 42).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };

    let reader = RecordingStreamReader::with_responses(
        vec![reclaim_message],
        vec![read_message_one, read_message_two],
    );
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader.clone(), repo);

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.processed_count, 3);
    assert_eq!(stats.reclaimed_count, 1);
    assert_eq!(stats.fresh_read_count, 2);
    assert_eq!(stats.reclaimed_message_count, 1);
    assert_eq!(stats.fresh_message_count, 2);
    assert_eq!(stats.malformed_acked_count, 0);
    assert_eq!(stats.malformed_missing_event_count, 0);
    assert_eq!(stats.malformed_invalid_json_count, 0);
    assert_eq!(stats.malformed_other_count, 0);
    assert_eq!(stats.malformed_raw_event_bytes_total, 0);
    assert_eq!(stats.dead_letter_relay_attempt_count, 0);
    assert_eq!(stats.dead_letter_relay_skipped_count, 0);
    assert_eq!(stats.dead_letter_relay_success_count, 0);
    assert_eq!(stats.dead_letter_relay_failed_count, 0);
    assert_eq!(stats.flush_count, 1);
    assert_eq!(stats.ack_count, 3);
    assert_eq!(stats.error_count, 0);
    assert_eq!(stats.pending_count, 0);
    assert_eq!(stats.lag_count, None);
    assert_eq!(stats.last_backoff_ms, 0);
    assert_eq!(stats.consecutive_errors, 0);
    assert_eq!(
        stats.processed_count,
        stats.reclaimed_count + stats.fresh_read_count
    );
    assert_eq!(
        stats.processed_count,
        stats.reclaimed_message_count + stats.fresh_message_count
    );

    let snapshot = reader.snapshot();
    assert_eq!(snapshot.acked.len(), 1);
    assert_eq!(snapshot.acked[0].len(), 3);
}

#[tokio::test]
async fn runtime_metrics_snapshot_tracks_latest_worker_stats() {
    let account_id = Uuid::new_v4();
    let read_message = StreamMessage {
        message_id: "1708260000000-13".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 29, 17).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };

    let reader = RecordingStreamReader::with_responses(vec![], vec![read_message]).with_backlog(
        ConsumerGroupBacklog {
            pending_count: 4,
            lag_count: Some(9),
        },
    );
    let repo = RecordingRepo::default();
    let runtime_metrics = Arc::new(UsageWorkerRuntimeMetrics::new());
    let worker = UsageAggregationWorker::new(reader, repo).with_runtime_metrics(runtime_metrics.clone());

    let stats = worker.run_once_with_stats().await.unwrap();
    let snapshot = runtime_metrics.snapshot();

    assert_eq!(snapshot.processed_count, stats.processed_count);
    assert_eq!(snapshot.pending_count, 4);
    assert_eq!(snapshot.lag_count, Some(9));
    assert_eq!(snapshot.ack_count, stats.ack_count);
    assert_eq!(snapshot.flush_count, stats.flush_count);
    assert_eq!(snapshot.error_count, 0);
    assert_eq!(snapshot.buffered_count, 0);
    assert!(snapshot.last_update_unix >= snapshot.started_at_unix);
}

#[tokio::test]
async fn run_once_with_stats_counts_malformed_acked_when_all_messages_are_malformed() {
    let reader = RecordingStreamReader::with_read_results(
        stream_read_result_with_reason_breakdown(Vec::new(), 2, 1, 1, 0),
        stream_read_result_with_reason_breakdown(Vec::new(), 3, 0, 1, 2),
    );
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader.clone(), repo.clone());

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.processed_count, 0);
    assert_eq!(stats.malformed_acked_count, 5);
    assert_eq!(stats.malformed_missing_event_count, 1);
    assert_eq!(stats.malformed_invalid_json_count, 2);
    assert_eq!(stats.malformed_other_count, 2);
    assert_eq!(stats.malformed_raw_event_bytes_total, 0);
    assert_eq!(stats.dead_letter_relay_attempt_count, 0);
    assert_eq!(stats.dead_letter_relay_skipped_count, 0);
    assert_eq!(stats.dead_letter_relay_success_count, 0);
    assert_eq!(stats.dead_letter_relay_failed_count, 0);
    assert_eq!(stats.flush_count, 0);
    assert_eq!(stats.ack_count, 0);

    let snapshot = reader.snapshot();
    assert!(snapshot.acked.is_empty());
    assert!(repo.account_rows.lock().unwrap().is_empty());
    assert!(repo.tenant_api_key_rows.lock().unwrap().is_empty());
}

#[tokio::test]
async fn run_once_with_stats_counts_processed_and_malformed_acked_when_messages_are_mixed() {
    let account_id = Uuid::new_v4();
    let reclaim_message = StreamMessage {
        message_id: "1708260000000-20".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 23, 1).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };
    let read_message_one = StreamMessage {
        message_id: "1708260000000-21".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 25, 17).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };
    let read_message_two = StreamMessage {
        message_id: "1708260000000-22".to_string(),
        event: sample_event(
            account_id,
            Utc.with_ymd_and_hms(2026, 2, 18, 14, 32, 42).unwrap(),
        ),
        tenant_id: None,
        api_key_id: None,
    };

    let reader = RecordingStreamReader::with_read_results(
        stream_read_result_with_reason_breakdown(vec![reclaim_message], 2, 1, 0, 1),
        stream_read_result_with_reason_breakdown(
            vec![read_message_one, read_message_two],
            1,
            0,
            1,
            0,
        ),
    );
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader, repo);

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.processed_count, 3);
    assert_eq!(stats.malformed_acked_count, 3);
    assert_eq!(stats.malformed_missing_event_count, 1);
    assert_eq!(stats.malformed_invalid_json_count, 1);
    assert_eq!(stats.malformed_other_count, 1);
    assert_eq!(stats.malformed_raw_event_bytes_total, 0);
    assert_eq!(stats.dead_letter_relay_attempt_count, 0);
    assert_eq!(stats.dead_letter_relay_skipped_count, 0);
    assert_eq!(stats.dead_letter_relay_success_count, 0);
    assert_eq!(stats.dead_letter_relay_failed_count, 0);
    assert_eq!(stats.reclaimed_count, 1);
    assert_eq!(stats.fresh_read_count, 2);
    assert_eq!(stats.reclaimed_message_count, 1);
    assert_eq!(stats.fresh_message_count, 2);
    assert_eq!(stats.ack_count, 3);
}

#[tokio::test]
async fn run_once_with_stats_reports_malformed_reason_breakdown_counts() {
    let reader = RecordingStreamReader::with_read_results(
        stream_read_result_with_reason_breakdown(Vec::new(), 6, 1, 2, 3),
        stream_read_result_with_reason_breakdown(Vec::new(), 15, 4, 5, 6),
    );
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader, repo);

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.processed_count, 0);
    assert_eq!(stats.malformed_acked_count, 21);
    assert_eq!(stats.malformed_missing_event_count, 5);
    assert_eq!(stats.malformed_invalid_json_count, 7);
    assert_eq!(stats.malformed_other_count, 9);
    assert_eq!(stats.malformed_raw_event_bytes_total, 0);
    assert_eq!(stats.dead_letter_relay_attempt_count, 0);
    assert_eq!(stats.dead_letter_relay_skipped_count, 0);
    assert_eq!(stats.dead_letter_relay_success_count, 0);
    assert_eq!(stats.dead_letter_relay_failed_count, 0);
}

#[tokio::test]
async fn run_once_with_stats_accumulates_malformed_raw_event_bytes_total() {
    let reader = RecordingStreamReader::with_read_results(
        stream_read_result_with_reason_breakdown_and_raw_bytes(Vec::new(), 6, 1, 2, 3, 13),
        stream_read_result_with_reason_breakdown_and_raw_bytes(Vec::new(), 15, 4, 5, 6, 29),
    );
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader, repo);

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.processed_count, 0);
    assert_eq!(stats.malformed_raw_event_bytes_total, 42);
    assert_eq!(stats.dead_letter_relay_attempt_count, 0);
    assert_eq!(stats.dead_letter_relay_skipped_count, 0);
    assert_eq!(stats.dead_letter_relay_success_count, 0);
    assert_eq!(stats.dead_letter_relay_failed_count, 0);
}

#[tokio::test]
async fn run_once_with_stats_accumulates_dead_letter_relay_outcome_counts() {
    let reader = RecordingStreamReader::with_read_results(
        stream_read_result_with_reason_breakdown_and_raw_bytes_and_dead_letter_stats(
            Vec::new(),
            2,
            1,
            1,
            0,
            0,
            2,
            0,
            3,
            1,
        ),
        stream_read_result_with_reason_breakdown_and_raw_bytes_and_dead_letter_stats(
            Vec::new(),
            4,
            2,
            1,
            1,
            0,
            0,
            4,
            5,
            2,
        ),
    );
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader, repo);

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.processed_count, 0);
    assert_eq!(stats.malformed_acked_count, 6);
    assert_eq!(stats.dead_letter_relay_attempt_count, 2);
    assert_eq!(stats.dead_letter_relay_skipped_count, 4);
    assert_eq!(stats.dead_letter_relay_success_count, 8);
    assert_eq!(stats.dead_letter_relay_failed_count, 3);
}

#[tokio::test]
async fn run_once_with_stats_reports_run_duration_ms() {
    let reader = SequencedStreamReader::new(vec![], vec![]);
    let repo = RecordingRepo::default();
    let config = UsageWorkerConfig {
        stream_block: Duration::from_millis(12),
        ..UsageWorkerConfig::default()
    };
    let worker = UsageAggregationWorker::with_config(reader, repo, config);

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.processed_count, 0);
    assert_eq!(stats.reclaimed_count, 0);
    assert_eq!(stats.fresh_read_count, 0);
    assert_eq!(stats.reclaimed_message_count, 0);
    assert_eq!(stats.fresh_message_count, 0);
    assert_eq!(stats.malformed_acked_count, 0);
    assert_eq!(stats.malformed_missing_event_count, 0);
    assert_eq!(stats.malformed_invalid_json_count, 0);
    assert_eq!(stats.malformed_other_count, 0);
    assert_eq!(stats.malformed_raw_event_bytes_total, 0);
    assert_eq!(stats.dead_letter_relay_attempt_count, 0);
    assert_eq!(stats.dead_letter_relay_skipped_count, 0);
    assert_eq!(stats.dead_letter_relay_success_count, 0);
    assert_eq!(stats.dead_letter_relay_failed_count, 0);
    assert_eq!(stats.pending_count, 0);
    assert_eq!(stats.lag_count, None);
    assert_eq!(stats.last_backoff_ms, 0);
    assert_eq!(stats.consecutive_errors, 0);
    assert!(
        stats.run_duration_ms >= 10,
        "run_duration_ms={}",
        stats.run_duration_ms
    );
}

#[tokio::test]
async fn run_once_with_stats_reports_consumer_group_backlog_snapshot() {
    let reader =
        RecordingStreamReader::with_responses(vec![], vec![]).with_backlog(ConsumerGroupBacklog {
            pending_count: 17,
            lag_count: Some(42),
        });
    let repo = RecordingRepo::default();
    let worker = UsageAggregationWorker::new(reader, repo);

    let stats = worker.run_once_with_stats().await.unwrap();

    assert_eq!(stats.pending_count, 17);
    assert_eq!(stats.lag_count, Some(42));
    assert_eq!(stats.last_backoff_ms, 0);
    assert_eq!(stats.consecutive_errors, 0);
}
