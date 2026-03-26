#[derive(Clone)]
pub struct OAuthImportJobManager {
    data_store: Arc<dyn ControlPlaneStore>,
    job_store: Arc<dyn OAuthImportJobStore>,
    system_event_repo: Option<Arc<dyn crate::system_events::SystemEventRepository>>,
    concurrency: usize,
    claim_batch_size: usize,
}

#[derive(Debug, Deserialize)]
struct CredentialRecord {
    refresh_token: Option<String>,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    bearer_token: Option<String>,
    #[serde(default, rename = "type", alias = "typo")]
    record_type: Option<String>,
    #[serde(default)]
    exp: Option<i64>,
    #[serde(default)]
    expired: Option<String>,
    #[serde(default)]
    chatgpt_plan_type: Option<String>,
    #[serde(default, rename = "https://api.openai.com/auth")]
    openai_auth: Option<CredentialOpenAiAuth>,
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    chatgpt_account_id: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    priority: Option<i32>,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    token_info: Option<CredentialTokenInfo>,
}

#[derive(Debug, Deserialize)]
struct CredentialTokenInfo {
    #[serde(default)]
    chatgpt_account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CredentialOpenAiAuth {
    #[serde(default)]
    chatgpt_plan_type: Option<String>,
}

impl OAuthImportJobManager {
    pub fn new(
        data_store: Arc<dyn ControlPlaneStore>,
        job_store: Arc<dyn OAuthImportJobStore>,
        system_event_repo: Option<Arc<dyn crate::system_events::SystemEventRepository>>,
        concurrency: usize,
        claim_batch_size: usize,
    ) -> Self {
        Self {
            data_store,
            job_store,
            system_event_repo,
            concurrency: concurrency.max(1),
            claim_batch_size: claim_batch_size.max(1),
        }
    }

    pub async fn create_job(
        &self,
        files: Vec<ImportUploadFile>,
        options: CreateOAuthImportJobOptions,
    ) -> Result<OAuthImportJobSummary> {
        if files.is_empty() {
            return Err(anyhow!("no files uploaded"));
        }

        let mut items = Vec::new();
        let mut item_id: u64 = 0;

        for file in files {
            let parsed_items = parse_file_records(&file, &options)
                .with_context(|| format!("failed to parse file {}", file.file_name))?;
            for mut state in parsed_items {
                item_id = item_id.saturating_add(1);
                state.item.item_id = item_id;
                items.push(state);
            }
        }

        let now = Utc::now();
        let mut summary = OAuthImportJobSummary {
            job_id: Uuid::new_v4(),
            status: OAuthImportJobStatus::Queued,
            total: items.len() as u64,
            processed: 0,
            created_count: 0,
            updated_count: 0,
            failed_count: 0,
            skipped_count: 0,
            started_at: None,
            finished_at: None,
            created_at: now,
            throughput_per_min: None,
            error_summary: Vec::new(),
            admission_counts: crate::contracts::OAuthImportAdmissionCounts::default(),
        };
        refresh_summary_counts(&mut summary, &items, false);

        self.job_store.create_job(summary.clone(), items).await?;
        self.emit_import_job_event(
            "import_job_created",
            codex_pool_core::events::SystemEventSeverity::Info,
            &summary,
            Some("created oauth import job"),
        )
        .await;
        self.spawn_job(summary.job_id);
        self.job_store.get_job_summary(summary.job_id).await
    }

    pub async fn create_manual_refresh_job(&self, account_id: Uuid) -> Result<OAuthImportJobSummary> {
        let now = Utc::now();
        let request = ImportTaskRequest::ManualRefreshAccount(ManualRefreshTaskRequest { account_id });
        let item = OAuthImportJobItem {
            item_id: 1,
            source_file: "manual_refresh".to_string(),
            line_no: 1,
            status: OAuthImportItemStatus::Pending,
            label: format!("manual-refresh-{account_id}"),
            email: None,
            chatgpt_account_id: None,
            account_id: Some(account_id),
            error_code: None,
            error_message: None,
            admission_status: None,
            admission_source: None,
            admission_reason: None,
            failure_stage: None,
            attempt_count: 0,
            transient_retry_count: 0,
            next_retry_at: None,
            retryable: false,
            terminal_reason: None,
        };
        let mut persisted = PersistedImportItem {
            item,
            request: Some(request.clone()),
            raw_record: Some(serde_json::json!({
                "kind": "manual_refresh_account",
                "account_id": account_id
            })),
            normalized_record: None,
            retry_count: 0,
        };
        persisted.normalized_record = Some(serde_json::to_value(&request)?);

        let mut summary = OAuthImportJobSummary {
            job_id: Uuid::new_v4(),
            status: OAuthImportJobStatus::Queued,
            total: 1,
            processed: 0,
            created_count: 0,
            updated_count: 0,
            failed_count: 0,
            skipped_count: 0,
            started_at: None,
            finished_at: None,
            created_at: now,
            throughput_per_min: None,
            error_summary: Vec::new(),
            admission_counts: crate::contracts::OAuthImportAdmissionCounts::default(),
        };
        refresh_summary_counts(&mut summary, &[persisted.clone()], false);

        self.job_store.create_job(summary.clone(), vec![persisted]).await?;
        self.emit_import_job_event(
            "import_job_created",
            codex_pool_core::events::SystemEventSeverity::Info,
            &summary,
            Some("created manual refresh import job"),
        )
        .await;
        self.spawn_job(summary.job_id);
        self.job_store.get_job_summary(summary.job_id).await
    }

    pub async fn job_summary(&self, job_id: Uuid) -> Result<OAuthImportJobSummary> {
        self.job_store.get_job_summary(job_id).await
    }

    pub async fn job_items(
        &self,
        job_id: Uuid,
        status: Option<OAuthImportItemStatus>,
        cursor: Option<u64>,
        limit: u64,
    ) -> Result<OAuthImportJobItemsResponse> {
        self.job_store
            .get_job_items(job_id, status, cursor, limit)
            .await
    }

    pub async fn cancel_job(&self, job_id: Uuid) -> Result<OAuthImportJobActionResponse> {
        self.job_store.cancel_job(job_id).await
    }

    pub async fn pause_job(&self, job_id: Uuid) -> Result<OAuthImportJobActionResponse> {
        self.job_store.pause_job(job_id).await
    }

    pub async fn resume_job(&self, job_id: Uuid) -> Result<OAuthImportJobActionResponse> {
        let response = self.job_store.resume_job(job_id).await?;
        if response.accepted {
            self.spawn_job(job_id);
        }
        Ok(response)
    }

    pub async fn retry_failed(&self, job_id: Uuid) -> Result<OAuthImportJobActionResponse> {
        let response = self.job_store.retry_failed(job_id).await?;
        if response.accepted {
            self.spawn_job(job_id);
        }
        Ok(response)
    }

    pub fn resume_recoverable_jobs(&self) {
        let this = self.clone();
        tokio::spawn(async move {
            match this.job_store.recoverable_job_ids().await {
                Ok(job_ids) => {
                    for job_id in job_ids {
                        this.spawn_job(job_id);
                    }
                }
                Err(err) => {
                    tracing::warn!(error = %err, "failed to recover oauth import jobs");
                }
            }
        });
    }

    fn spawn_job(&self, job_id: Uuid) {
        let this = self.clone();
        tokio::spawn(async move {
            let _ = this.run_job(job_id).await;
        });
    }

    async fn emit_import_job_event(
        &self,
        event_type: &str,
        severity: codex_pool_core::events::SystemEventSeverity,
        summary: &OAuthImportJobSummary,
        message: Option<&str>,
    ) {
        let Some(repo) = self.system_event_repo.as_ref() else {
            return;
        };

        let reason_code = match summary.status {
            OAuthImportJobStatus::Queued => "queued",
            OAuthImportJobStatus::Running => "running",
            OAuthImportJobStatus::Paused => "paused",
            OAuthImportJobStatus::Completed => "completed",
            OAuthImportJobStatus::Failed => "failed",
            OAuthImportJobStatus::Cancelled => "cancelled",
        };

        let event = codex_pool_core::events::SystemEventWrite {
            event_id: None,
            ts: None,
            category: codex_pool_core::events::SystemEventCategory::Import,
            event_type: event_type.to_string(),
            severity,
            source: "control-plane".to_string(),
            tenant_id: None,
            account_id: None,
            request_id: None,
            trace_request_id: None,
            job_id: Some(summary.job_id),
            account_label: None,
            auth_provider: None,
            operator_state_from: None,
            operator_state_to: None,
            reason_class: Some("job".to_string()),
            reason_code: Some(reason_code.to_string()),
            next_action_at: None,
            path: None,
            method: None,
            model: None,
            selected_account_id: None,
            selected_proxy_id: None,
            routing_decision: None,
            failover_scope: None,
            status_code: None,
            upstream_status_code: None,
            latency_ms: None,
            message: message.map(ToString::to_string),
            preview_text: None,
            payload_json: Some(serde_json::json!({
                "status": reason_code,
                "total": summary.total,
                "processed": summary.processed,
                "created_count": summary.created_count,
                "updated_count": summary.updated_count,
                "failed_count": summary.failed_count,
                "skipped_count": summary.skipped_count,
                "started_at": summary.started_at,
                "finished_at": summary.finished_at,
                "admission_counts": summary.admission_counts,
            })),
            secret_preview: None,
        };

        if let Err(error) = repo.insert_event(event).await {
            tracing::warn!(
                error = %error,
                job_id = %summary.job_id,
                event_type,
                "failed to persist oauth import job system event"
            );
        }
    }

    async fn run_job(&self, job_id: Uuid) -> Result<()> {
        loop {
            let tasks = self
                .job_store
                .start_job(job_id, self.claim_batch_size)
                .await?;
            if tasks.is_empty() {
                let summary = self.job_store.get_job_summary(job_id).await?;
                if summary.status == OAuthImportJobStatus::Paused {
                    return Ok(());
                }
                break;
            }

            let data_store = self.data_store.clone();
            let job_store = self.job_store.clone();

            stream::iter(tasks)
                .map(|task| {
                    let data_store = data_store.clone();
                    async move {
                        let result = execute_import_with_retry(data_store, task.request).await;
                        (task.item_id, result)
                    }
                })
                .buffer_unordered(self.concurrency)
                .for_each(|(item_id, result)| {
                    let job_store = job_store.clone();
                    async move {
                        match result {
                            Ok(outcome) => {
                                let _ = job_store
                                    .mark_item_success(job_id, item_id, &outcome)
                                    .await;
                            }
                            Err(err) => {
                                let raw_message = err.to_string();
                                let error_code = classify_import_failure_code(&raw_message);
                                let _ = job_store
                                    .mark_item_failed(
                                        job_id,
                                        item_id,
                                        error_code,
                                        &truncate_error_message(raw_message),
                                    )
                                    .await;
                            }
                        }
                    }
                })
                .await;
        }

        let summary = self.job_store.finish_job(job_id).await?;
        let (event_type, severity, message) = match summary.status {
            OAuthImportJobStatus::Completed => (
                "import_job_completed",
                codex_pool_core::events::SystemEventSeverity::Info,
                "oauth import job completed",
            ),
            OAuthImportJobStatus::Failed => (
                "import_job_failed",
                codex_pool_core::events::SystemEventSeverity::Error,
                "oauth import job failed",
            ),
            OAuthImportJobStatus::Cancelled => (
                "import_job_cancelled",
                codex_pool_core::events::SystemEventSeverity::Warn,
                "oauth import job cancelled",
            ),
            OAuthImportJobStatus::Paused => (
                "import_job_paused",
                codex_pool_core::events::SystemEventSeverity::Warn,
                "oauth import job paused",
            ),
            OAuthImportJobStatus::Running | OAuthImportJobStatus::Queued => (
                "import_job_finished",
                codex_pool_core::events::SystemEventSeverity::Info,
                "oauth import job finished",
            ),
        };
        self.emit_import_job_event(event_type, severity, &summary, Some(message))
            .await;
        Ok(())
    }
}

#[cfg(test)]
mod manager_core_tests {
    use super::*;
    use bytes::Bytes;
    use codex_pool_core::events::SystemEventCategory;
    use codex_pool_core::model::UpstreamMode;
    use sqlx_sqlite::SqlitePool;
    use tokio::time::{sleep, Duration};

    use crate::import_jobs::{CreateOAuthImportJobOptions, ImportCredentialMode, ImportUploadFile, InMemoryOAuthImportJobStore};
    use crate::store::InMemoryStore;
    use crate::system_events::{
        sqlite_repo::SqliteSystemEventRepo, SystemEventLogRuntime, SystemEventQuery,
        SystemEventRepository,
    };

    #[tokio::test(flavor = "current_thread")]
    async fn create_job_emits_import_created_and_completed_events() {
        let event_pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create sqlite event repo pool");
        let event_repo = Arc::new(
            SqliteSystemEventRepo::new(event_pool)
                .await
                .expect("create sqlite event repo"),
        );
        let store = Arc::new(InMemoryStore::default());
        store
            .configure_system_event_runtime(Some(Arc::new(SystemEventLogRuntime::new(
                event_repo.clone(),
            ))))
            .await
            .expect("configure system event runtime");

        let manager = OAuthImportJobManager::new(
            store,
            Arc::new(InMemoryOAuthImportJobStore::default()),
            Some(event_repo.clone()),
            1,
            10,
        );

        let summary = manager
            .create_job(
                vec![ImportUploadFile {
                    file_name: "ak-only.jsonl".to_string(),
                    content: Bytes::from(
                        r#"{"type":"codex","email":"event-test@example.com","access_token":"ak_test_event","account_id":"acct_event_test"}"#,
                    ),
                }],
                CreateOAuthImportJobOptions {
                    default_mode: UpstreamMode::CodexOauth,
                    credential_mode: ImportCredentialMode::AccessToken,
                    ..CreateOAuthImportJobOptions::default()
                },
            )
            .await
            .expect("create import job");

        let mut final_summary = summary.clone();
        for _ in 0..20 {
            final_summary = manager
                .job_summary(summary.job_id)
                .await
                .expect("read import job summary");
            if matches!(
                final_summary.status,
                OAuthImportJobStatus::Completed | OAuthImportJobStatus::Failed | OAuthImportJobStatus::Cancelled
            ) {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(final_summary.status, OAuthImportJobStatus::Completed);

        let events = event_repo
            .list_events(SystemEventQuery {
                job_id: Some(summary.job_id),
                category: Some(SystemEventCategory::Import),
                ..Default::default()
            })
            .await
            .expect("list import system events");
        let event_types = events
            .items
            .iter()
            .map(|item| item.event_type.as_str())
            .collect::<Vec<_>>();
        assert!(
            event_types.contains(&"import_job_created"),
            "import_job_created event should be present"
        );
        assert!(
            event_types.contains(&"import_job_completed"),
            "import_job_completed event should be present"
        );
    }
}
