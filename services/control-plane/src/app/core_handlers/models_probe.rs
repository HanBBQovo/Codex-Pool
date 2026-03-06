fn build_admin_models_response(
    state: &AppState,
    official_catalog: Vec<crate::tenant::OpenAiModelCatalogItem>,
    pricing_overrides: Vec<crate::tenant::ModelPricingItem>,
) -> AdminModelsResponse {
    let pricing_overrides_by_model = pricing_overrides
        .into_iter()
        .map(|item| (item.model.clone(), item))
        .collect::<std::collections::HashMap<_, _>>();

    let (cache_updated_at, cache_source_label, cache_entries) = {
        let cache = state
            .model_probe_cache
            .read()
            .expect("model_probe_cache lock poisoned");
        (
            cache.updated_at,
            cache.source_account_label.clone(),
            cache.entries.clone(),
        )
    };

    let catalog_last_error = state
        .model_catalog_last_error
        .read()
        .expect("model_catalog_last_error lock poisoned")
        .clone();

    let catalog_synced_at = official_catalog.iter().map(|item| item.synced_at).max();

    let mut data = official_catalog
        .into_iter()
        .map(|item| {
            let override_pricing = pricing_overrides_by_model.get(&item.model_id).cloned();
            let effective_pricing = if let Some(override_item) = override_pricing.as_ref() {
                AdminModelPricingView {
                    input_price_microcredits: Some(override_item.input_price_microcredits),
                    cached_input_price_microcredits: Some(
                        override_item.cached_input_price_microcredits,
                    ),
                    output_price_microcredits: Some(override_item.output_price_microcredits),
                    source: "manual_override".to_string(),
                }
            } else {
                AdminModelPricingView {
                    input_price_microcredits: item.input_price_microcredits,
                    cached_input_price_microcredits: item.cached_input_price_microcredits,
                    output_price_microcredits: item.output_price_microcredits,
                    source: "official_sync".to_string(),
                }
            };
            let probe = cache_entries.get(&item.model_id);
            AdminModelItem {
                id: item.model_id.clone(),
                owned_by: item.owned_by.clone(),
                availability_status: probe
                    .map(|entry| entry.status.clone())
                    .unwrap_or(AdminModelAvailabilityStatus::Unknown),
                availability_checked_at: probe.map(|entry| entry.checked_at),
                availability_http_status: probe.and_then(|entry| entry.http_status),
                availability_error: probe.and_then(|entry| entry.error.clone()),
                official: AdminModelOfficialInfo {
                    title: item.title,
                    description: item.description,
                    context_window_tokens: item.context_window_tokens,
                    max_output_tokens: item.max_output_tokens,
                    knowledge_cutoff: item.knowledge_cutoff,
                    reasoning_token_support: item.reasoning_token_support,
                    pricing_notes: item.pricing_notes,
                    input_modalities: item.input_modalities,
                    output_modalities: item.output_modalities,
                    endpoints: item.endpoints,
                    source_url: item.source_url,
                    synced_at: item.synced_at,
                    raw_text: item.raw_text,
                },
                override_pricing,
                effective_pricing,
            }
        })
        .collect::<Vec<_>>();
    data.sort_by(|left, right| left.id.cmp(&right.id));

    let now = Utc::now();
    let probe_cache_stale = cache_updated_at
        .map(|checked_at| now.signed_duration_since(checked_at).num_seconds() >= MODEL_PROBE_CACHE_TTL_SEC)
        .unwrap_or(true);

    AdminModelsResponse {
        object: "list".to_string(),
        data,
        meta: AdminModelsMeta {
            probe_cache_ttl_sec: MODEL_PROBE_CACHE_TTL_SEC,
            probe_cache_stale,
            probe_cache_updated_at: cache_updated_at,
            probe_source_account_label: cache_source_label,
            catalog_synced_at,
            catalog_sync_required: catalog_synced_at.is_none(),
            catalog_last_error,
        },
    }
}

fn normalize_requested_model_ids(models: Vec<String>) -> Vec<String> {
    let mut ids = models
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

fn extract_probe_error_message(body: &str) -> Option<String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(detail) = value.get("detail").and_then(|item| item.as_str()) {
            let detail = detail.trim();
            if !detail.is_empty() {
                return Some(detail.to_string());
            }
        }
        if let Some(message) = value
            .get("error")
            .and_then(|item| item.get("message"))
            .and_then(|item| item.as_str())
        {
            let message = message.trim();
            if !message.is_empty() {
                return Some(message.to_string());
            }
        }
        if let Some(message) = value.get("message").and_then(|item| item.as_str()) {
            let message = message.trim();
            if !message.is_empty() {
                return Some(message.to_string());
            }
        }
    }
    Some(trimmed.chars().take(240).collect())
}

async fn probe_single_model(
    client: &reqwest::Client,
    responses_url: &str,
    account: &UpstreamAccount,
    model_id: &str,
) -> ModelProbeCacheEntry {
    let payload = serde_json::json!({
        "model": model_id,
        "store": false,
        "stream": true,
        "instructions": "You are concise.",
        "input": [
            {
                "role": "user",
                "content": [
                    { "type": "input_text", "text": "reply with pong" }
                ]
            }
        ]
    });

    let mut request = client
        .post(responses_url)
        .header("authorization", format!("Bearer {}", account.bearer_token))
        .header("content-type", "application/json")
        .json(&payload);
    if let Some(account_id) = account.chatgpt_account_id.as_deref() {
        request = request.header("chatgpt-account-id", account_id);
    }

    let checked_at = Utc::now();
    match request.send().await {
        Ok(response) if response.status().is_success() => ModelProbeCacheEntry {
            status: AdminModelAvailabilityStatus::Available,
            checked_at,
            http_status: Some(response.status().as_u16()),
            error: None,
        },
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            ModelProbeCacheEntry {
                status: AdminModelAvailabilityStatus::Unavailable,
                checked_at,
                http_status: Some(status.as_u16()),
                error: extract_probe_error_message(&body),
            }
        }
        Err(err) => ModelProbeCacheEntry {
            status: AdminModelAvailabilityStatus::Unavailable,
            checked_at,
            http_status: None,
            error: Some(err.to_string()),
        },
    }
}

async fn run_model_probe_cycle(
    state: &AppState,
    requested_models: Vec<String>,
    force: bool,
    trigger: &str,
) -> anyhow::Result<()> {
    let requested_models = normalize_requested_model_ids(requested_models);
    let cache_is_fresh = {
        let cache = state
            .model_probe_cache
            .read()
            .expect("model_probe_cache lock poisoned");
        cache
            .updated_at
            .map(|updated_at| {
                Utc::now()
                    .signed_duration_since(updated_at)
                    .num_seconds()
                    < MODEL_PROBE_CACHE_TTL_SEC
            })
            .unwrap_or(false)
    };
    if !force && requested_models.is_empty() && cache_is_fresh {
        return Ok(());
    }

    let tenant_auth = state
        .tenant_auth_service
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("tenant auth service is not available"))?;
    let official_catalog = tenant_auth
        .admin_list_openai_model_catalog()
        .await
        .context("failed to load official models catalog for probing")?;
    if official_catalog.is_empty() {
        return Err(anyhow::anyhow!("official models catalog is empty; sync OpenAI catalog first"));
    }

    let snapshot = state.store.snapshot().await.context("failed to load upstream account snapshot")?;
    let mut accounts = snapshot
        .accounts
        .into_iter()
        .filter(|account| account.enabled)
        .collect::<Vec<_>>();
    accounts.sort_by(|left, right| left.label.cmp(&right.label));
    let preferred_label = state
        .model_probe_cache
        .read()
        .expect("model_probe_cache lock poisoned")
        .source_account_label
        .clone();
    if let Some(preferred_label) = preferred_label.as_deref() {
        if let Some(index) = accounts.iter().position(|account| account.label == preferred_label) {
            accounts.swap(0, index);
        }
    }
    let account = accounts
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("no enabled upstream account is available for probe"))?;
    let responses_url = crate::upstream_api::build_upstream_responses_url(
        &account.base_url,
        &account.mode,
    )?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(MODEL_PROBE_REQUEST_TIMEOUT_SEC))
        .build()?;

    let official_model_ids = official_catalog
        .iter()
        .map(|item| item.model_id.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let mut candidate_ids = std::collections::BTreeSet::<String>::new();
    for model_id in &official_model_ids {
        candidate_ids.insert(model_id.clone());
    }
    for item in requested_models {
        if official_model_ids.contains(&item) {
            candidate_ids.insert(item);
        }
    }
    {
        let cache = state
            .model_probe_cache
            .read()
            .expect("model_probe_cache lock poisoned");
        for model_id in cache.entries.keys() {
            if official_model_ids.contains(model_id) {
                candidate_ids.insert(model_id.clone());
            }
        }
    }

    let mut entries = HashMap::new();
    let mut available = 0usize;
    let tested = candidate_ids.len();
    for model_id in candidate_ids {
        let probe = probe_single_model(&client, &responses_url, &account, &model_id).await;
        if probe.status == AdminModelAvailabilityStatus::Available {
            available += 1;
        }
        entries.insert(model_id, probe);
    }

    if !force && tested > 0 && available == 0 {
        let (previous_available, previous_updated_at) = {
            let cache = state
                .model_probe_cache
                .read()
                .expect("model_probe_cache lock poisoned");
            let previous_available = cache
                .entries
                .values()
                .filter(|entry| entry.status == AdminModelAvailabilityStatus::Available)
                .count();
            (previous_available, cache.updated_at)
        };
        let previous_is_recent = previous_updated_at
            .map(|updated_at| {
                Utc::now().signed_duration_since(updated_at).num_seconds()
                    < MODEL_PROBE_CACHE_TTL_SEC.saturating_mul(2)
            })
            .unwrap_or(false);
        if previous_available > 0 && previous_is_recent {
            tracing::warn!(
                trigger = %trigger,
                tested,
                previous_available,
                source_account_label = %account.label,
                "model probe produced zero available models; keeping previous probe cache"
            );
            return Ok(());
        }
    }

    {
        let mut cache = state
            .model_probe_cache
            .write()
            .expect("model_probe_cache lock poisoned");
        cache.updated_at = Some(Utc::now());
        cache.source_account_label = Some(account.label.clone());
        cache.entries = entries;
    }

    push_admin_log(
        state,
        "info",
        "admin.models.probe",
        format!(
            "model probe ({trigger}) tested {tested} models via account {} (available={available}, unavailable={})",
            account.label,
            tested.saturating_sub(available)
        ),
    );
    Ok(())
}

#[cfg_attr(test, allow(dead_code))]
fn spawn_model_probe_loop(state: AppState) {
    let interval_sec = state.model_probe_interval_sec.max(60);
    tokio::spawn(async move {
        if let Err(err) = run_model_probe_cycle(&state, Vec::new(), true, "startup").await {
            tracing::warn!(error = %err, "initial model probe failed");
        }

        let mut ticker = tokio::time::interval(Duration::from_secs(interval_sec));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let _ = ticker.tick().await;
        loop {
            let _ = ticker.tick().await;
            if let Err(err) = run_model_probe_cycle(&state, Vec::new(), false, "auto").await {
                tracing::warn!(error = %err, "scheduled model probe failed");
            }
        }
    });
    tracing::info!(interval_sec, "model probe loop started");
}

