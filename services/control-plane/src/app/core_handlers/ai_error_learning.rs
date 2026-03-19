#[derive(Debug, Clone, Deserialize, Default)]
struct AdminUpstreamErrorTemplatesQuery {
    status: Option<UpstreamErrorTemplateStatus>,
}

fn upstream_error_template_not_found() -> (StatusCode, Json<ErrorEnvelope>) {
    (
        StatusCode::NOT_FOUND,
        Json(ErrorEnvelope::new("not_found", "resource not found")),
    )
}

fn parse_builtin_error_template_kind(
    raw: &str,
) -> Result<BuiltinErrorTemplateKind, (StatusCode, Json<ErrorEnvelope>)> {
    match raw.trim() {
        "gateway_error" => Ok(BuiltinErrorTemplateKind::GatewayError),
        "heuristic_upstream" => Ok(BuiltinErrorTemplateKind::HeuristicUpstream),
        _ => Err(invalid_request_error("invalid builtin error template kind")),
    }
}

async fn builtin_error_template_or_404(
    state: &AppState,
    kind: BuiltinErrorTemplateKind,
    code: &str,
) -> Result<BuiltinErrorTemplateRecord, (StatusCode, Json<ErrorEnvelope>)> {
    state
        .store
        .builtin_error_template(kind, code)
        .await
        .map_err(map_tenant_error)?
        .ok_or_else(upstream_error_template_not_found)
}

fn all_supported_error_template_locales() -> Vec<String> {
    vec![
        "en".to_string(),
        "zh-CN".to_string(),
        "zh-TW".to_string(),
        "ja".to_string(),
        "ru".to_string(),
    ]
}

fn merge_localized_templates(
    target: &mut LocalizedErrorTemplates,
    generated: &LocalizedErrorTemplates,
) {
    if generated.en.is_some() {
        target.en = generated.en.clone();
    }
    if generated.zh_cn.is_some() {
        target.zh_cn = generated.zh_cn.clone();
    }
    if generated.zh_tw.is_some() {
        target.zh_tw = generated.zh_tw.clone();
    }
    if generated.ja.is_some() {
        target.ja = generated.ja.clone();
    }
    if generated.ru.is_some() {
        target.ru = generated.ru.clone();
    }
}

fn locale_is_present(templates: &LocalizedErrorTemplates, locale: &str) -> bool {
    match locale {
        "en" => templates.en.is_some(),
        "zh-CN" | "zh-cn" | "zh_cn" => templates.zh_cn.is_some(),
        "zh-TW" | "zh-tw" | "zh_tw" => templates.zh_tw.is_some(),
        "ja" => templates.ja.is_some(),
        "ru" => templates.ru.is_some(),
        _ => false,
    }
}

fn is_generic_upstream_sample(sample: &str) -> bool {
    matches!(
        sample.trim().to_ascii_lowercase().as_str(),
        "unknown upstream error" | "unknown upstream request failure" | "upstream request failed"
    )
}

fn representative_sample_from_resolve_request(req: &ResolveUpstreamErrorTemplateRequest) -> String {
    let normalized = req.normalized_upstream_message.trim();
    if !normalized.is_empty() && !is_generic_upstream_sample(normalized) {
        return normalized.to_string();
    }
    if let Some(raw) = req
        .sanitized_upstream_raw
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return raw.to_string();
    }
    normalized.to_string()
}

fn template_generation_context_from_record(
    template: &UpstreamErrorTemplateRecord,
) -> crate::upstream_error_learning::TemplateGenerationContext {
    crate::upstream_error_learning::TemplateGenerationContext {
        fingerprint: template.fingerprint.clone(),
        provider: template.provider.clone(),
        normalized_status_code: template.normalized_status_code,
        normalized_upstream_message: template
            .representative_samples
            .first()
            .cloned()
            .unwrap_or_else(|| template.fingerprint.clone()),
        sanitized_upstream_raw: None,
        model: None,
    }
}

async fn apply_builtin_heuristic_template_if_known(
    state: &AppState,
    template: &mut UpstreamErrorTemplateRecord,
) -> Result<(), (StatusCode, Json<ErrorEnvelope>)> {
    let Some(builtin) = state
        .store
        .builtin_error_template(
            BuiltinErrorTemplateKind::HeuristicUpstream,
            &template.semantic_error_code,
        )
        .await
        .map_err(map_tenant_error)?
    else {
        return Ok(());
    };
    if let Some(action) = builtin.action {
        template.action = action;
    }
    if let Some(retry_scope) = builtin.retry_scope {
        template.retry_scope = retry_scope;
    }
    template.templates = builtin.templates;
    Ok(())
}

async fn get_admin_upstream_error_learning_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<AiErrorLearningSettingsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let _principal = require_admin_principal(&state, &headers)?;
    let settings = state
        .store
        .upstream_error_learning_settings()
        .await
        .map_err(map_tenant_error)?;
    Ok(Json(AiErrorLearningSettingsResponse { settings }))
}

async fn update_admin_upstream_error_learning_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Result<Json<UpdateAiErrorLearningSettingsRequest>, JsonRejection>,
) -> Result<Json<AiErrorLearningSettingsResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let Json(req) =
        payload.map_err(|_| invalid_request_error("invalid upstream error learning settings"))?;
    let settings = state
        .store
        .update_upstream_error_learning_settings(req)
        .await
        .map_err(map_tenant_error)?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.error_learning.settings.update".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("upstream_error_learning_settings".to_string()),
            target_id: Some("singleton".to_string()),
            payload_json: json!({
                "enabled": settings.enabled,
                "first_seen_timeout_ms": settings.first_seen_timeout_ms,
                "review_hit_threshold": settings.review_hit_threshold,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(AiErrorLearningSettingsResponse { settings }))
}

async fn list_admin_upstream_error_templates(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AdminUpstreamErrorTemplatesQuery>,
) -> Result<Json<UpstreamErrorTemplatesResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let _principal = require_admin_principal(&state, &headers)?;
    let templates = state
        .store
        .list_upstream_error_templates(query.status)
        .await
        .map_err(map_tenant_error)?;
    Ok(Json(UpstreamErrorTemplatesResponse { templates }))
}

async fn list_admin_builtin_error_templates(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<BuiltinErrorTemplatesResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let _principal = require_admin_principal(&state, &headers)?;
    let templates = state
        .store
        .list_builtin_error_templates()
        .await
        .map_err(map_tenant_error)?;
    Ok(Json(BuiltinErrorTemplatesResponse { templates }))
}

async fn update_admin_upstream_error_template(
    Path(template_id): Path<Uuid>,
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Result<Json<UpdateUpstreamErrorTemplateRequest>, JsonRejection>,
) -> Result<Json<UpstreamErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let Json(req) = payload.map_err(|_| invalid_request_error("invalid upstream error template"))?;
    let Some(mut template) = state
        .store
        .upstream_error_template_by_id(template_id)
        .await
        .map_err(map_tenant_error)?
    else {
        return Err(upstream_error_template_not_found());
    };
    template.semantic_error_code = req.semantic_error_code;
    template.action = req.action;
    template.retry_scope = req.retry_scope;
    template.templates = req.templates;
    template.updated_at = Utc::now();
    let template = state
        .store
        .save_upstream_error_template(template)
        .await
        .map_err(map_tenant_error)?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.error_learning.template.update".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("upstream_error_template".to_string()),
            target_id: Some(template_id.to_string()),
            payload_json: json!({
                "semantic_error_code": template.semantic_error_code,
                "action": template.action,
                "retry_scope": template.retry_scope,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(UpstreamErrorTemplateResponse { template }))
}

async fn update_admin_builtin_error_template(
    Path((template_kind, template_code)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Result<Json<UpdateBuiltinErrorTemplateRequest>, JsonRejection>,
) -> Result<Json<BuiltinErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let kind = parse_builtin_error_template_kind(&template_kind)?;
    let Json(req) =
        payload.map_err(|_| invalid_request_error("invalid builtin error template"))?;
    let template = builtin_error_template_or_404(&state, kind, &template_code).await?;
    let updated_at = Utc::now();
    state
        .store
        .save_builtin_error_template_override(BuiltinErrorTemplateOverrideRecord {
            kind,
            code: template.code.clone(),
            templates: req.templates,
            updated_at,
        })
        .await
        .map_err(map_tenant_error)?;
    let template = builtin_error_template_or_404(&state, kind, &template_code).await?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.builtin_error_template.update".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("builtin_error_template".to_string()),
            target_id: Some(format!("{template_kind}:{template_code}")),
            payload_json: json!({
                "kind": kind,
                "code": template.code,
            }),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(BuiltinErrorTemplateResponse { template }))
}

async fn approve_admin_upstream_error_template(
    Path(template_id): Path<Uuid>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UpstreamErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let Some(mut template) = state
        .store
        .upstream_error_template_by_id(template_id)
        .await
        .map_err(map_tenant_error)?
    else {
        return Err(upstream_error_template_not_found());
    };
    template.status = UpstreamErrorTemplateStatus::Approved;
    template.updated_at = Utc::now();
    let template = state
        .store
        .save_upstream_error_template(template)
        .await
        .map_err(map_tenant_error)?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.error_learning.template.approve".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("upstream_error_template".to_string()),
            target_id: Some(template_id.to_string()),
            payload_json: json!({}),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(UpstreamErrorTemplateResponse { template }))
}

async fn reject_admin_upstream_error_template(
    Path(template_id): Path<Uuid>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UpstreamErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let Some(mut template) = state
        .store
        .upstream_error_template_by_id(template_id)
        .await
        .map_err(map_tenant_error)?
    else {
        return Err(upstream_error_template_not_found());
    };
    template.status = UpstreamErrorTemplateStatus::Rejected;
    template.updated_at = Utc::now();
    let template = state
        .store
        .save_upstream_error_template(template)
        .await
        .map_err(map_tenant_error)?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.error_learning.template.reject".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("upstream_error_template".to_string()),
            target_id: Some(template_id.to_string()),
            payload_json: json!({}),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(UpstreamErrorTemplateResponse { template }))
}

async fn rewrite_admin_upstream_error_template(
    Path(template_id): Path<Uuid>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<UpstreamErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let Some(mut template) = state
        .store
        .upstream_error_template_by_id(template_id)
        .await
        .map_err(map_tenant_error)?
    else {
        return Err(upstream_error_template_not_found());
    };
    let generated = state
        .upstream_error_learning_runtime
        .generate_for_locales(
            &template_generation_context_from_record(&template),
            &all_supported_error_template_locales(),
            false,
        )
        .await;
    template.semantic_error_code = generated.semantic_error_code;
    template.action = generated.action;
    template.retry_scope = generated.retry_scope;
    template.templates = generated.templates;
    template.updated_at = Utc::now();
    let template = state
        .store
        .save_upstream_error_template(template)
        .await
        .map_err(map_tenant_error)?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.error_learning.template.rewrite".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("upstream_error_template".to_string()),
            target_id: Some(template_id.to_string()),
            payload_json: json!({}),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(UpstreamErrorTemplateResponse { template }))
}

async fn rewrite_admin_builtin_error_template(
    Path((template_kind, template_code)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<BuiltinErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let kind = parse_builtin_error_template_kind(&template_kind)?;
    let template = builtin_error_template_or_404(&state, kind, &template_code).await?;
    let generated = state
        .upstream_error_learning_runtime
        .rewrite_builtin_templates(&template, &all_supported_error_template_locales())
        .await;
    state
        .store
        .save_builtin_error_template_override(BuiltinErrorTemplateOverrideRecord {
            kind,
            code: template.code.clone(),
            templates: generated,
            updated_at: Utc::now(),
        })
        .await
        .map_err(map_tenant_error)?;
    let template = builtin_error_template_or_404(&state, kind, &template_code).await?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.builtin_error_template.rewrite".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("builtin_error_template".to_string()),
            target_id: Some(format!("{template_kind}:{template_code}")),
            payload_json: json!({}),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(BuiltinErrorTemplateResponse { template }))
}

async fn reset_admin_builtin_error_template(
    Path((template_kind, template_code)): Path<(String, String)>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<BuiltinErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    let principal = require_admin_principal(&state, &headers)?;
    let kind = parse_builtin_error_template_kind(&template_kind)?;
    let _template = builtin_error_template_or_404(&state, kind, &template_code).await?;
    state
        .store
        .delete_builtin_error_template_override(kind, &template_code)
        .await
        .map_err(map_tenant_error)?;
    let template = builtin_error_template_or_404(&state, kind, &template_code).await?;
    write_audit_log_best_effort(
        &state,
        crate::tenant::AuditLogWriteRequest {
            actor_type: "admin_user".to_string(),
            actor_id: Some(principal.user_id),
            tenant_id: None,
            action: "admin.model_routing.builtin_error_template.reset".to_string(),
            reason: None,
            request_ip: crate::tenant::extract_client_ip(&headers),
            user_agent: extract_user_agent(&headers),
            target_type: Some("builtin_error_template".to_string()),
            target_id: Some(format!("{template_kind}:{template_code}")),
            payload_json: json!({}),
            result_status: "ok".to_string(),
        },
    )
    .await;
    Ok(Json(BuiltinErrorTemplateResponse { template }))
}

async fn internal_resolve_upstream_error_template(
    State(state): State<AppState>,
    headers: HeaderMap,
    payload: Result<Json<ResolveUpstreamErrorTemplateRequest>, JsonRejection>,
) -> Result<Json<ResolveUpstreamErrorTemplateResponse>, (StatusCode, Json<ErrorEnvelope>)> {
    require_internal_service_token(&state, &headers)?;
    let Json(req) =
        payload.map_err(|_| invalid_request_error("invalid upstream error resolve payload"))?;

    let lock = state
        .upstream_error_learning_runtime
        .lock_for_fingerprint(&req.fingerprint)
        .await;
    let _guard = lock.lock().await;

    let settings = state
        .store
        .upstream_error_learning_settings()
        .await
        .map_err(internal_error)?;
    let now = Utc::now();
    let mut created = false;
    let representative_sample = representative_sample_from_resolve_request(&req);
    let mut template = match state
        .store
        .upstream_error_template_by_fingerprint(&req.fingerprint)
        .await
        .map_err(internal_error)?
    {
        Some(existing) => existing,
        None => {
            created = true;
            let generated = state
                .upstream_error_learning_runtime
                .generate_for_locales(
                    &crate::upstream_error_learning::context_from_resolve_request(&req),
                    std::slice::from_ref(&req.target_locale),
                    true,
                )
                .await;
            let mut template = UpstreamErrorTemplateRecord {
                id: Uuid::new_v4(),
                fingerprint: req.fingerprint.clone(),
                provider: req.provider.clone(),
                normalized_status_code: req.normalized_status_code,
                semantic_error_code: generated.semantic_error_code,
                action: generated.action,
                retry_scope: generated.retry_scope,
                status: UpstreamErrorTemplateStatus::ProvisionalLive,
                templates: generated.templates,
                representative_samples: vec![representative_sample.clone()],
                hit_count: 0,
                first_seen_at: now,
                last_seen_at: now,
                updated_at: now,
            };
            apply_builtin_heuristic_template_if_known(&state, &mut template).await?;
            template
        }
    };

    template.hit_count = template.hit_count.saturating_add(1);
    template.last_seen_at = now;
    template.updated_at = now;
    if !template
        .representative_samples
        .iter()
        .any(|item| item == &representative_sample)
        && template.representative_samples.len() < 3
    {
        template
            .representative_samples
            .push(representative_sample);
    }

    if !locale_is_present(&template.templates, &req.target_locale)
        && template.status != UpstreamErrorTemplateStatus::Rejected
    {
        let generated = state
            .upstream_error_learning_runtime
            .generate_for_locales(
                &crate::upstream_error_learning::context_from_resolve_request(&req),
                std::slice::from_ref(&req.target_locale),
                false,
            )
            .await;
        if template.semantic_error_code.trim().is_empty() {
            template.semantic_error_code = generated.semantic_error_code;
        }
        template.action = generated.action;
        template.retry_scope = generated.retry_scope;
        merge_localized_templates(&mut template.templates, &generated.templates);
        apply_builtin_heuristic_template_if_known(&state, &mut template).await?;
    }

    if template.status == UpstreamErrorTemplateStatus::ProvisionalLive
        && template.hit_count >= u64::from(settings.review_hit_threshold)
    {
        template.status = UpstreamErrorTemplateStatus::ReviewPending;
    }

    let template = state
        .store
        .save_upstream_error_template(template)
        .await
        .map_err(internal_error)?;

    Ok(Json(ResolveUpstreamErrorTemplateResponse {
        template,
        created,
    }))
}
