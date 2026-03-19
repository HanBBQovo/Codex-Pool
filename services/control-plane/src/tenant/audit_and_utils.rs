impl TenantAuthService {
    pub async fn billing_pricing(
        &self,
        req: BillingPricingRequest,
    ) -> Result<BillingPricingResponse> {
        let model = req.model.trim();
        if model.is_empty() {
            return Err(anyhow!("model must not be empty"));
        }
        let service_tier = normalize_billing_service_tier(req.service_tier.as_deref());
        let base = self
            .resolve_model_pricing(model, Some(service_tier.as_str()))
            .await?;
        let resolved = if let Some(api_key_id) = req.api_key_id {
            self.resolve_api_key_group_pricing(api_key_id, model, &base)
                .await?
                .final_pricing
        } else {
            base
        };
        Ok(BillingPricingResponse {
            model: model.to_string(),
            input_price_microcredits: resolved.input_price_microcredits,
            cached_input_price_microcredits: resolved.cached_input_price_microcredits,
            output_price_microcredits: resolved.output_price_microcredits,
            source: resolved.source,
        })
    }

    pub async fn write_audit_log(&self, entry: AuditLogWriteRequest) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO audit_logs (
                id, actor_type, actor_id, tenant_id, action, reason, request_ip, user_agent,
                target_type, target_id, payload_json, result_status, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(entry.actor_type)
        .bind(entry.actor_id)
        .bind(entry.tenant_id)
        .bind(entry.action)
        .bind(entry.reason)
        .bind(entry.request_ip)
        .bind(entry.user_agent)
        .bind(entry.target_type)
        .bind(entry.target_id)
        .bind(entry.payload_json)
        .bind(entry.result_status)
        .bind(Utc::now())
        .execute(&self.pool)
        .await
        .context("failed to write audit log")?;
        Ok(())
    }

    pub async fn list_audit_logs(&self, query: AuditLogListQuery) -> Result<AuditLogListResponse> {
        let safe_limit = query.limit.clamp(1, 500) as i64;
        let keyword_like = query.keyword.map(|value| format!("%{}%", value.trim()));
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                actor_type,
                actor_id,
                tenant_id,
                action,
                reason,
                request_ip,
                user_agent,
                target_type,
                target_id,
                payload_json,
                result_status,
                created_at
            FROM audit_logs
            WHERE created_at >= $1
              AND created_at <= $2
              AND ($3::UUID IS NULL OR tenant_id = $3)
              AND ($4::TEXT IS NULL OR actor_type = $4)
              AND ($5::UUID IS NULL OR actor_id = $5)
              AND ($6::TEXT IS NULL OR action = $6)
              AND ($7::TEXT IS NULL OR result_status = $7)
              AND (
                $8::TEXT IS NULL
                OR action ILIKE $8
                OR COALESCE(reason, '') ILIKE $8
                OR COALESCE(target_type, '') ILIKE $8
                OR COALESCE(target_id, '') ILIKE $8
                OR COALESCE(request_ip, '') ILIKE $8
                OR COALESCE(user_agent, '') ILIKE $8
                OR payload_json::TEXT ILIKE $8
              )
            ORDER BY created_at DESC
            LIMIT $9
            "#,
        )
        .bind(query.start_at)
        .bind(query.end_at)
        .bind(query.tenant_id)
        .bind(query.actor_type)
        .bind(query.actor_id)
        .bind(query.action)
        .bind(query.result_status)
        .bind(keyword_like)
        .bind(safe_limit)
        .fetch_all(&self.pool)
        .await
        .context("failed to list audit logs")?;

        let items = rows
            .into_iter()
            .map(|row| -> Result<AuditLogListItem> {
                Ok(AuditLogListItem {
                    id: row.try_get("id")?,
                    actor_type: row.try_get("actor_type")?,
                    actor_id: row.try_get("actor_id")?,
                    tenant_id: row.try_get("tenant_id")?,
                    action: row.try_get("action")?,
                    reason: row.try_get("reason")?,
                    request_ip: row.try_get("request_ip")?,
                    user_agent: row.try_get("user_agent")?,
                    target_type: row.try_get("target_type")?,
                    target_id: row.try_get("target_id")?,
                    payload_json: row.try_get("payload_json")?,
                    result_status: row.try_get("result_status")?,
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(AuditLogListResponse { items })
    }

    fn issue_token(
        &self,
        user_id: Uuid,
        tenant_id: Uuid,
        email: &str,
        impersonated_admin_user_id: Option<Uuid>,
        impersonation_session_id: Option<Uuid>,
        impersonation_reason: Option<String>,
    ) -> Result<String> {
        let now = current_ts_sec()?;
        let claims = TenantClaims {
            sub: user_id.to_string(),
            tenant_id: tenant_id.to_string(),
            email: email.to_string(),
            iat: now,
            exp: now.saturating_add(self.token_ttl_sec),
            impersonated_admin_user_id: impersonated_admin_user_id.map(|id| id.to_string()),
            impersonation_session_id: impersonation_session_id.map(|id| id.to_string()),
            impersonation_reason,
        };
        encode(&Header::default(), &claims, &self.encoding_key).context("failed to sign tenant jwt")
    }

    async fn insert_code_inner(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        params: InsertCodeParams<'_>,
    ) -> Result<()> {
        let InsertCodeParams {
            tenant_id,
            tenant_user_id,
            purpose,
            code_hash,
            expires_at,
            now,
        } = params;
        sqlx::query(
            r#"
            INSERT INTO tenant_email_verification_codes (
                id, tenant_id, tenant_user_id, purpose, code_hash, expires_at, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(tenant_id)
        .bind(tenant_user_id)
        .bind(purpose)
        .bind(code_hash)
        .bind(expires_at)
        .bind(now)
        .execute(tx.as_mut())
        .await
        .context("failed to insert tenant email verification code")?;
        Ok(())
    }

    async fn consume_code_inner(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        tenant_user_id: Uuid,
        purpose: &str,
        code_hash: &str,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let row = sqlx::query(
            r#"
            SELECT id, code_hash, expires_at, consumed_at, attempt_count, max_attempts
            FROM tenant_email_verification_codes
            WHERE tenant_user_id = $1 AND purpose = $2
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
            "#,
        )
        .bind(tenant_user_id)
        .bind(purpose)
        .fetch_optional(tx.as_mut())
        .await
        .context("failed to query tenant email verification code")?
        .ok_or_else(|| anyhow!("email or code is invalid"))?;
        let id: Uuid = row.try_get("id")?;
        let stored_hash: String = row.try_get("code_hash")?;
        let expires_at: DateTime<Utc> = row.try_get("expires_at")?;
        let consumed_at: Option<DateTime<Utc>> = row.try_get("consumed_at")?;
        let attempt_count: i32 = row.try_get("attempt_count")?;
        let max_attempts: i32 = row.try_get("max_attempts")?;
        if consumed_at.is_some() || expires_at <= now || attempt_count >= max_attempts {
            return Err(anyhow!("email or code is invalid"));
        }
        if stored_hash != code_hash {
            sqlx::query(
                r#"
                UPDATE tenant_email_verification_codes
                SET attempt_count = attempt_count + 1
                WHERE id = $1
                "#,
            )
            .bind(id)
            .execute(tx.as_mut())
            .await
            .context("failed to increment verification code attempt count")?;
            return Err(anyhow!("email or code is invalid"));
        }

        sqlx::query(
            r#"
            UPDATE tenant_email_verification_codes
            SET consumed_at = $2
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(now)
        .execute(tx.as_mut())
        .await
        .context("failed to mark verification code as consumed")?;
        Ok(())
    }

    async fn fetch_authorization_for_update(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        tenant_id: Uuid,
        request_id: &str,
    ) -> Result<Option<BillingAuthorizationRecord>> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                tenant_id,
                api_key_id,
                request_id,
                model,
                reserved_microcredits,
                captured_microcredits,
                status,
                expires_at,
                meta_json
            FROM tenant_credit_authorizations
            WHERE tenant_id = $1 AND request_id = $2
            FOR UPDATE
            "#,
        )
        .bind(tenant_id)
        .bind(request_id)
        .fetch_optional(tx.as_mut())
        .await
        .context("failed to query billing authorization")?;

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(BillingAuthorizationRecord {
            id: row.try_get("id")?,
            tenant_id: row.try_get("tenant_id")?,
            request_id: row.try_get("request_id")?,
            api_key_id: row.try_get("api_key_id")?,
            model: row.try_get("model")?,
            reserved_microcredits: row.try_get("reserved_microcredits")?,
            captured_microcredits: row.try_get("captured_microcredits")?,
            status: row.try_get("status")?,
            expires_at: row.try_get("expires_at")?,
            meta_json: Some(row.try_get("meta_json")?),
        }))
    }

    async fn fetch_authorization(
        &self,
        tenant_id: Uuid,
        request_id: &str,
    ) -> Result<Option<BillingAuthorizationRecord>> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                tenant_id,
                api_key_id,
                request_id,
                model,
                reserved_microcredits,
                captured_microcredits,
                status,
                expires_at
            FROM tenant_credit_authorizations
            WHERE tenant_id = $1 AND request_id = $2
            "#,
        )
        .bind(tenant_id)
        .bind(request_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to query billing authorization")?;

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(BillingAuthorizationRecord {
            id: row.try_get("id")?,
            tenant_id: row.try_get("tenant_id")?,
            request_id: row.try_get("request_id")?,
            api_key_id: row.try_get("api_key_id")?,
            model: row.try_get("model")?,
            reserved_microcredits: row.try_get("reserved_microcredits")?,
            captured_microcredits: row.try_get("captured_microcredits")?,
            status: row.try_get("status")?,
            expires_at: row.try_get("expires_at")?,
            meta_json: Some(row.try_get("meta_json")?),
        }))
    }

    async fn current_credit_balance_for_update(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        tenant_id: Uuid,
    ) -> Result<i64> {
        sqlx::query_scalar(
            r#"
            SELECT COALESCE(balance_microcredits, 0)
            FROM tenant_credit_accounts
            WHERE tenant_id = $1
            FOR UPDATE
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(tx.as_mut())
        .await
        .context("failed to lock tenant credit account for billing balance lookup")
        .map(|value| value.unwrap_or(0))
    }

    async fn resolve_base_model_pricing(
        &self,
        model: &str,
        service_tier: Option<&str>,
    ) -> Result<BillingPricingResolved> {
        if model.trim().is_empty() {
            return Err(anyhow!("model must not be empty"));
        }

        let normalized_service_tier = normalize_billing_service_tier(service_tier);
        for lookup_tier in pricing_override_lookup_tiers(&normalized_service_tier) {
            if let Some(row) = sqlx::query(
                r#"
                SELECT input_price_microcredits, cached_input_price_microcredits, output_price_microcredits
                FROM model_pricing_overrides
                WHERE model = $1 AND service_tier = $2 AND enabled = true
                "#,
            )
            .bind(model)
            .bind(lookup_tier)
            .fetch_optional(&self.pool)
            .await
            .context("failed to query exact model pricing override")?
            {
                let input_price_microcredits: i64 = row.try_get("input_price_microcredits")?;
                let cached_input_price_microcredits = normalize_cached_input_price_microcredits(
                    input_price_microcredits,
                    row.try_get("cached_input_price_microcredits")?,
                );
                return Ok(BillingPricingResolved {
                    input_price_microcredits,
                    cached_input_price_microcredits,
                    output_price_microcredits: row.try_get("output_price_microcredits")?,
                    source: format!("manual_override:{lookup_tier}"),
                });
            }
        }

        if let Some(row) = sqlx::query(
            r#"
            SELECT
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits
            FROM openai_models_catalog
            WHERE model_id = $1
            "#,
        )
        .bind(model)
        .fetch_optional(&self.pool)
        .await
        .context("failed to query official model pricing")?
        {
            return Ok(BillingPricingResolved {
                input_price_microcredits: row.try_get("input_price_microcredits")?,
                cached_input_price_microcredits: row.try_get("cached_input_price_microcredits")?,
                output_price_microcredits: row.try_get("output_price_microcredits")?,
                source: "official_sync".to_string(),
            });
        }

        if billing_pricing_fallback_enabled() {
            if let (Some(input), Some(output)) = (
                billing_default_input_price_microcredits(),
                billing_default_output_price_microcredits(),
            ) {
                let cached_input =
                    billing_default_cached_input_price_microcredits().unwrap_or(input / 10);
                return Ok(BillingPricingResolved {
                    input_price_microcredits: input,
                    cached_input_price_microcredits: cached_input.max(0),
                    output_price_microcredits: output,
                    source: "default_fallback".to_string(),
                });
            }
        }

        Err(anyhow!("model pricing is not configured"))
    }

    async fn resolve_model_pricing(
        &self,
        model: &str,
        service_tier: Option<&str>,
    ) -> Result<BillingPricingResolved> {
        self.resolve_base_model_pricing(model, service_tier).await
    }

    async fn resolve_model_pricing_for_request(
        &self,
        model: &str,
        context: BillingPricingRequestContext<'_>,
    ) -> Result<BillingPricingDecision> {
        let base = self
            .resolve_base_model_pricing(model, context.service_tier)
            .await?;
        let rules = self
            .list_matching_billing_pricing_rules(model, context.request_kind)
            .await?;
        let mut resolved = resolve_effective_pricing_for_band(
            &base,
            &rules,
            model,
            context.request_kind,
            context.persisted_band,
            context.actual_input_tokens,
            context.phase,
        );
        if let Some(api_key_id) = context.api_key_id {
            resolved.pricing = self
                .resolve_api_key_group_pricing(api_key_id, model, &resolved.pricing)
                .await?
                .final_pricing;
        }
        Ok(resolved)
    }

    async fn list_matching_billing_pricing_rules(
        &self,
        model: &str,
        request_kind: BillingRequestKind,
    ) -> Result<Vec<BillingPricingRuleRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                model_pattern,
                request_kind,
                scope,
                threshold_input_tokens,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm
            FROM billing_pricing_rules
            WHERE enabled = true
            ORDER BY priority DESC, threshold_input_tokens DESC NULLS LAST, created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to query billing pricing rules")?;

        let mut rules = rows
            .into_iter()
            .map(|row| -> Result<BillingPricingRuleRecord> {
                Ok(BillingPricingRuleRecord {
                    id: row.try_get("id")?,
                    model_pattern: row.try_get("model_pattern")?,
                    request_kind: row.try_get("request_kind")?,
                    scope: row.try_get("scope")?,
                    threshold_input_tokens: row.try_get("threshold_input_tokens")?,
                    input_multiplier_ppm: row.try_get("input_multiplier_ppm")?,
                    cached_input_multiplier_ppm: row.try_get("cached_input_multiplier_ppm")?,
                    output_multiplier_ppm: row.try_get("output_multiplier_ppm")?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        rules.retain(|rule| {
            billing_rule_matches_model(&rule.model_pattern, model)
                && billing_rule_matches_request_kind(&rule.request_kind, request_kind)
        });
        Ok(rules)
    }

    async fn fetch_billing_session_for_update(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        tenant_id: Uuid,
        session_key: &str,
    ) -> Result<Option<BillingSessionRecord>> {
        let normalized_session_key = session_key.trim();
        if normalized_session_key.is_empty() {
            return Ok(None);
        }

        let row = sqlx::query(
            r#"
            SELECT pricing_band
            FROM billing_sessions
            WHERE tenant_id = $1 AND session_key = $2 AND expires_at > $3
            FOR UPDATE
            "#,
        )
        .bind(tenant_id)
        .bind(normalized_session_key)
        .bind(Utc::now())
        .fetch_optional(tx.as_mut())
        .await
        .context("failed to query billing session")?;

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(BillingSessionRecord {
            pricing_band: row.try_get("pricing_band")?,
        }))
    }

    async fn upsert_billing_session(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        tenant_id: Uuid,
        session_key: &str,
        model: &str,
        band: BillingPricingBand,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let normalized_session_key = session_key.trim();
        if normalized_session_key.is_empty() {
            return Ok(());
        }

        let expires_at = now + chrono::Duration::seconds(DEFAULT_BILLING_SESSION_TTL_SEC as i64);
        sqlx::query(
            r#"
            INSERT INTO billing_sessions (
                tenant_id,
                session_key,
                model,
                pricing_band,
                entered_band_at,
                last_seen_at,
                expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $5, $6)
            ON CONFLICT (tenant_id, session_key) DO UPDATE
            SET model = EXCLUDED.model,
                pricing_band = EXCLUDED.pricing_band,
                entered_band_at = CASE
                    WHEN billing_sessions.pricing_band = EXCLUDED.pricing_band
                    THEN billing_sessions.entered_band_at
                    ELSE EXCLUDED.entered_band_at
                END,
                last_seen_at = EXCLUDED.last_seen_at,
                expires_at = EXCLUDED.expires_at
            "#,
        )
        .bind(tenant_id)
        .bind(normalized_session_key)
        .bind(model)
        .bind(band.as_str())
        .bind(now)
        .bind(expires_at)
        .execute(tx.as_mut())
        .await
        .context("failed to upsert billing session")?;
        Ok(())
    }

    async fn apply_credit_delta_inner(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        params: CreditDeltaParams<'_>,
    ) -> Result<i64> {
        let CreditDeltaParams {
            tenant_id,
            api_key_id,
            event_type,
            delta_microcredits,
            request_id,
            model,
            input_tokens,
            output_tokens,
            meta_json,
            now,
        } = params;
        let existing_balance = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT balance_microcredits
            FROM tenant_credit_accounts
            WHERE tenant_id = $1
            FOR UPDATE
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(tx.as_mut())
        .await
        .context("failed to lock tenant credit account for delta apply")?
        .unwrap_or(0);
        let next_balance = existing_balance.saturating_add(delta_microcredits);
        if next_balance < 0 {
            return Err(anyhow!("insufficient credits"));
        }
        sqlx::query(
            r#"
            INSERT INTO tenant_credit_accounts (tenant_id, balance_microcredits, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (tenant_id)
            DO UPDATE SET balance_microcredits = EXCLUDED.balance_microcredits, updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(tenant_id)
        .bind(next_balance)
        .bind(now)
        .execute(tx.as_mut())
        .await
        .context("failed to upsert tenant credit account")?;

        let result = sqlx::query(
            r#"
            INSERT INTO tenant_credit_ledger (
                id, tenant_id, api_key_id, request_id, event_type, delta_microcredits, balance_after_microcredits,
                unit_price_microcredits, input_tokens, output_tokens, model, meta_json, created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, $11, $12)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(tenant_id)
        .bind(api_key_id)
        .bind(request_id)
        .bind(event_type)
        .bind(delta_microcredits)
        .bind(next_balance)
        .bind(input_tokens)
        .bind(output_tokens)
        .bind(model)
        .bind(meta_json.unwrap_or_else(|| json!({})))
        .bind(now)
        .execute(tx.as_mut())
        .await;
        if let Err(err) = result {
            if err
                .as_database_error()
                .and_then(|dbe| dbe.code())
                .is_some_and(|code| code == "23505")
            {
                return Ok(existing_balance);
            }
            return Err(anyhow!(err)).context("failed to insert tenant credit ledger");
        }
        Ok(next_balance)
    }

    async fn dispatch_email_code(&self, email: &str, purpose: &str, code: &str) {
        let smtp_host = std::env::var("SMTP_HOST")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        if smtp_host.is_none() {
            tracing::warn!(
                email,
                purpose,
                "SMTP_HOST is not configured, skip sending email code"
            );
            if self.expose_debug_code {
                tracing::info!(email, purpose, code, "tenant email code (debug expose)");
            }
            return;
        }

        let smtp_host = smtp_host.unwrap_or_default();
        let smtp_port = std::env::var("SMTP_PORT")
            .ok()
            .and_then(|raw| raw.parse::<u16>().ok())
            .unwrap_or(587);
        let smtp_username = std::env::var("SMTP_USERNAME")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        let smtp_password = std::env::var("SMTP_PASSWORD")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        let smtp_from = std::env::var("SMTP_FROM")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .or_else(|| smtp_username.clone());
        let smtp_from_name = std::env::var("SMTP_FROM_NAME")
            .ok()
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty());
        let smtp_timeout_sec = std::env::var("SMTP_TIMEOUT_SEC")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .unwrap_or(10)
            .max(1);
        let smtp_insecure = parse_bool_env("SMTP_INSECURE").unwrap_or(false);

        let Some(smtp_from) = smtp_from else {
            tracing::warn!(
                email,
                purpose,
                "SMTP_FROM/SMTP_USERNAME is not configured, skip sending email code"
            );
            if self.expose_debug_code {
                tracing::info!(email, purpose, code, "tenant email code (debug expose)");
            }
            return;
        };

        let from_mailbox: Mailbox = match smtp_from_name {
            Some(display_name) => match format!("{display_name} <{smtp_from}>").parse() {
                Ok(mailbox) => mailbox,
                Err(err) => {
                    tracing::warn!(
                        email,
                        purpose,
                        from = %smtp_from,
                        error = %err,
                        "invalid SMTP_FROM/SMTP_FROM_NAME mailbox, skip sending email code"
                    );
                    return;
                }
            },
            None => match smtp_from.parse() {
                Ok(mailbox) => mailbox,
                Err(err) => {
                    tracing::warn!(
                        email,
                        purpose,
                        from = %smtp_from,
                        error = %err,
                        "invalid SMTP_FROM mailbox, skip sending email code"
                    );
                    return;
                }
            },
        };

        let to_mailbox: Mailbox = match email.parse() {
            Ok(mailbox) => mailbox,
            Err(err) => {
                tracing::warn!(
                    email,
                    purpose,
                    error = %err,
                    "invalid tenant email mailbox, skip sending email code"
                );
                return;
            }
        };

        let (subject, action_text, ttl_minutes) = match purpose {
            CODE_PURPOSE_EMAIL_VERIFY => {
                ("Codex Pool - Verify Your Email", "verify your email", 15)
            }
            CODE_PURPOSE_PASSWORD_RESET => (
                "Codex Pool - Reset Your Password",
                "reset your password",
                10,
            ),
            _ => ("Codex Pool - Verification Code", "complete your action", 15),
        };
        let body = format!(
            "Your verification code is: {code}\n\nUse this code to {action_text}.\nThis code expires in {ttl_minutes} minutes.\n\nIf you did not request this email, please ignore it."
        );

        let message = match Message::builder()
            .from(from_mailbox)
            .to(to_mailbox)
            .subject(subject)
            .body(body)
        {
            Ok(message) => message,
            Err(err) => {
                tracing::warn!(
                    email,
                    purpose,
                    error = %err,
                    "failed to build tenant email message"
                );
                return;
            }
        };

        let mut builder = if smtp_insecure {
            AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(smtp_host.clone())
        } else {
            match AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host) {
                Ok(builder) => builder,
                Err(err) => {
                    tracing::warn!(
                        email,
                        purpose,
                        host = %smtp_host,
                        error = %err,
                        "failed to initialize SMTP relay transport"
                    );
                    return;
                }
            }
        };
        builder = builder
            .port(smtp_port)
            .timeout(Some(StdDuration::from_secs(smtp_timeout_sec)));
        if let Some(username) = smtp_username {
            builder = builder.credentials(Credentials::new(
                username,
                smtp_password.unwrap_or_default(),
            ));
        }
        let mailer = builder.build();
        if let Err(err) = mailer.send(message).await {
            tracing::warn!(
                email,
                purpose,
                host = %smtp_host,
                error = %err,
                "failed to dispatch tenant email code via SMTP"
            );
        } else {
            tracing::info!(
                email,
                purpose,
                host = %smtp_host,
                "tenant email code sent via SMTP"
            );
        }
        if self.expose_debug_code {
            tracing::info!(email, purpose, code, "tenant email code (debug expose)");
        }
    }

    async fn is_rate_limited(&self, email: &str, request_ip: Option<&str>) -> bool {
        let key = format!("{}|{}", email, request_ip.unwrap_or("-"));
        let mut guard = self.login_attempts.lock().await;
        let bucket = guard.entry(key).or_default();
        let now = Instant::now();
        bucket.retain(|attempt| now.duration_since(*attempt) <= self.login_rate_limit_window);
        bucket.len() >= self.login_rate_limit_max_attempts
    }

    async fn record_login_failure(&self, email: &str, request_ip: Option<&str>) {
        let key = format!("{}|{}", email, request_ip.unwrap_or("-"));
        let mut guard = self.login_attempts.lock().await;
        guard.entry(key).or_default().push(Instant::now());
    }

    async fn clear_login_failures(&self, email: &str, request_ip: Option<&str>) {
        let key = format!("{}|{}", email, request_ip.unwrap_or("-"));
        let mut guard = self.login_attempts.lock().await;
        guard.remove(&key);
    }
}

pub fn extract_client_ip(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|raw| raw.split(',').next())
        .map(str::trim)
        .filter(|raw| !raw.is_empty())
        .map(ToString::to_string)
}

fn parse_bool_env(key: &str) -> Option<bool> {
    std::env::var(key).ok().and_then(|raw| {
        let normalized = raw.trim().to_ascii_lowercase();
        match normalized.as_str() {
            "1" | "true" | "yes" | "on" => Some(true),
            "0" | "false" | "no" | "off" => Some(false),
            _ => None,
        }
    })
}

fn default_billing_authorization_ttl_sec() -> u64 {
    std::env::var("BILLING_AUTHORIZATION_TTL_SEC")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .unwrap_or(DEFAULT_BILLING_AUTHORIZATION_TTL_SEC)
}

fn billing_pricing_fallback_enabled() -> bool {
    parse_bool_env("BILLING_PRICING_FALLBACK_ENABLED").unwrap_or(true)
}

fn billing_default_input_price_microcredits() -> Option<i64> {
    parse_i64_env_positive("BILLING_DEFAULT_INPUT_PRICE_MICROCREDITS")
}

fn billing_default_output_price_microcredits() -> Option<i64> {
    parse_i64_env_positive("BILLING_DEFAULT_OUTPUT_PRICE_MICROCREDITS")
}

fn billing_default_cached_input_price_microcredits() -> Option<i64> {
    parse_i64_env_non_negative("BILLING_DEFAULT_CACHED_INPUT_PRICE_MICROCREDITS")
}

fn parse_i64_env_positive(key: &str) -> Option<i64> {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value > 0)
}

fn parse_i64_env_non_negative(key: &str) -> Option<i64> {
    std::env::var(key)
        .ok()
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value >= 0)
}

fn normalize_cached_input_price_microcredits(input_price: i64, cached_input_price: i64) -> i64 {
    if cached_input_price <= 0 {
        return input_price.max(0);
    }
    cached_input_price
}

fn normalize_billing_service_tier(raw: Option<&str>) -> String {
    match raw
        .unwrap_or("default")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "priority" | "fast" => "priority".to_string(),
        "flex" => "flex".to_string(),
        _ => "default".to_string(),
    }
}

fn pricing_override_lookup_tiers(service_tier: &str) -> Vec<&str> {
    match service_tier {
        "priority" => vec!["priority", "default"],
        "flex" => vec!["flex", "default"],
        _ => vec!["default"],
    }
}

fn resolve_effective_pricing_for_band(
    base: &BillingPricingResolved,
    rules: &[BillingPricingRuleRecord],
    model: &str,
    request_kind: BillingRequestKind,
    persisted_band: Option<BillingPricingBand>,
    actual_input_tokens: Option<i64>,
    phase: BillingResolutionPhase,
) -> BillingPricingDecision {
    let normalized_input_tokens = actual_input_tokens.map(|value| value.max(0));
    let matching_rules = rules
        .iter()
        .filter(|rule| {
            billing_rule_matches_model(&rule.model_pattern, model)
                && billing_rule_matches_request_kind(&rule.request_kind, request_kind)
        })
        .collect::<Vec<_>>();

    let band = match persisted_band {
        Some(BillingPricingBand::LongContext) => BillingPricingBand::LongContext,
        _ => matching_rules
            .iter()
            .find(|rule| {
                let threshold = rule.threshold_input_tokens.unwrap_or(0).max(0);
                let threshold_reached = normalized_input_tokens.unwrap_or(0) >= threshold;
                match BillingPricingRuleScope::from_str(&rule.scope) {
                    BillingPricingRuleScope::Session => {
                        phase == BillingResolutionPhase::Capture && threshold_reached
                    }
                    BillingPricingRuleScope::Request => threshold_reached,
                }
            })
            .map(|_| BillingPricingBand::LongContext)
            .unwrap_or(BillingPricingBand::Base),
    };

    let matched_rule = if band == BillingPricingBand::LongContext {
        matching_rules.first().copied()
    } else {
        None
    };

    let pricing = if let Some(rule) = matched_rule {
        BillingPricingResolved {
            input_price_microcredits: apply_multiplier_ppm(
                base.input_price_microcredits,
                rule.input_multiplier_ppm,
            ),
            cached_input_price_microcredits: apply_multiplier_ppm(
                base.cached_input_price_microcredits,
                rule.cached_input_multiplier_ppm,
            ),
            output_price_microcredits: apply_multiplier_ppm(
                base.output_price_microcredits,
                rule.output_multiplier_ppm,
            ),
            source: format!("{}+rule:{}", base.source, rule.id),
        }
    } else {
        base.clone()
    };

    BillingPricingDecision {
        pricing,
        band,
        matched_rule_id: matched_rule.map(|rule| rule.id),
    }
}

fn billing_rule_matches_model(model_pattern: &str, model: &str) -> bool {
    let normalized_pattern = model_pattern.trim();
    if normalized_pattern.is_empty() {
        return false;
    }
    if normalized_pattern == model {
        return true;
    }
    normalized_pattern
        .strip_suffix('*')
        .map(|prefix| !prefix.is_empty() && model.starts_with(prefix))
        .unwrap_or(false)
}

fn billing_rule_matches_request_kind(
    rule_request_kind: &str,
    request_kind: BillingRequestKind,
) -> bool {
    let rule_kind = BillingRequestKind::from_optional(Some(rule_request_kind));
    rule_kind == BillingRequestKind::Any || rule_kind == request_kind
}

fn apply_multiplier_ppm(price_microcredits: i64, multiplier_ppm: i64) -> i64 {
    let numerator = (price_microcredits.max(0) as i128)
        .saturating_mul(multiplier_ppm.max(0) as i128)
        .saturating_add((BILLING_MULTIPLIER_PPM_ONE / 2) as i128);
    (numerator / BILLING_MULTIPLIER_PPM_ONE as i128).clamp(0, i64::MAX as i128) as i64
}

fn policy_has_absolute_pricing(policy: Option<&ApiKeyGroupModelPolicyRecord>) -> bool {
    policy.is_some_and(|item| {
        item.input_price_microcredits.is_some()
            && item.cached_input_price_microcredits.is_some()
            && item.output_price_microcredits.is_some()
    })
}

fn apply_api_key_group_model_pricing(
    base: &BillingPricingResolved,
    group: &ApiKeyGroupRecord,
    policy: Option<&ApiKeyGroupModelPolicyRecord>,
) -> ApiKeyGroupResolvedPricing {
    let formula = BillingPricingResolved {
        input_price_microcredits: apply_multiplier_ppm(
            apply_multiplier_ppm(base.input_price_microcredits, group.input_multiplier_ppm),
            policy
                .map(|item| item.input_multiplier_ppm)
                .unwrap_or(BILLING_MULTIPLIER_PPM_ONE),
        ),
        cached_input_price_microcredits: apply_multiplier_ppm(
            apply_multiplier_ppm(
                base.cached_input_price_microcredits,
                group.cached_input_multiplier_ppm,
            ),
            policy
                .map(|item| item.cached_input_multiplier_ppm)
                .unwrap_or(BILLING_MULTIPLIER_PPM_ONE),
        ),
        output_price_microcredits: apply_multiplier_ppm(
            apply_multiplier_ppm(base.output_price_microcredits, group.output_multiplier_ppm),
            policy
                .map(|item| item.output_multiplier_ppm)
                .unwrap_or(BILLING_MULTIPLIER_PPM_ONE),
        ),
        source: format!("{}+group_formula:{}", base.source, group.id),
    };

    if let Some(item) = policy.filter(|_| policy_has_absolute_pricing(policy)) {
        return ApiKeyGroupResolvedPricing {
            formula,
            final_pricing: BillingPricingResolved {
                input_price_microcredits: item.input_price_microcredits.unwrap_or(0),
                cached_input_price_microcredits: item
                    .cached_input_price_microcredits
                    .unwrap_or(0),
                output_price_microcredits: item.output_price_microcredits.unwrap_or(0),
                source: format!("{}+group_absolute:{}", base.source, item.id),
            },
            uses_absolute_pricing: true,
        };
    }

    ApiKeyGroupResolvedPricing {
        formula: formula.clone(),
        final_pricing: formula,
        uses_absolute_pricing: false,
    }
}

fn authorization_meta_string(meta_json: Option<&serde_json::Value>, key: &str) -> Option<String> {
    meta_json
        .and_then(|value| value.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn authorization_pricing_band(meta_json: Option<&serde_json::Value>) -> Option<BillingPricingBand> {
    authorization_meta_string(meta_json, "pricing_band")
        .map(|raw| BillingPricingBand::from_optional(Some(raw.as_str())))
}

fn authorization_request_kind(meta_json: Option<&serde_json::Value>) -> Option<BillingRequestKind> {
    let request_kind = BillingRequestKind::from_optional(
        authorization_meta_string(meta_json, "request_kind").as_deref(),
    );
    if request_kind == BillingRequestKind::Unknown {
        None
    } else {
        Some(request_kind)
    }
}

fn authorization_session_key(meta_json: Option<&serde_json::Value>) -> Option<String> {
    authorization_meta_string(meta_json, "session_key")
}

fn authorization_service_tier(meta_json: Option<&serde_json::Value>) -> Option<String> {
    authorization_meta_string(meta_json, "service_tier")
        .map(|raw| normalize_billing_service_tier(Some(raw.as_str())))
}

fn normalize_email(raw: &str) -> Result<String> {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.is_empty() || !normalized.contains('@') || normalized.len() > 320 {
        return Err(anyhow!("invalid email"));
    }
    Ok(normalized)
}

fn validate_password(password: &str) -> Result<()> {
    if password.len() < 8 {
        return Err(anyhow!("password must be at least 8 characters"));
    }
    Ok(())
}

fn normalize_str_list(items: Vec<String>) -> Vec<String> {
    let mut values = items
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

fn generate_email_code() -> String {
    let mut rng = rand::rng();
    format!("{:06}", rng.random_range(0..1_000_000))
}

fn sha256_hex(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

fn parse_tenant_api_key_row(row: sqlx_postgres::PgRow) -> Result<TenantApiKeyRecord> {
    let ip_allowlist = row
        .try_get::<serde_json::Value, _>("ip_allowlist")?
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let model_allowlist = row
        .try_get::<serde_json::Value, _>("model_allowlist")?
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let group_deleted = row
        .try_get::<Option<DateTime<Utc>>, _>("group_deleted_at")?
        .is_some();
    let group = ApiKeyGroupBindingItem {
        id: row.try_get("group_id")?,
        name: row.try_get("group_name")?,
        is_default: row.try_get("group_is_default")?,
        enabled: row.try_get("group_enabled")?,
        allow_all_models: row.try_get("group_allow_all_models")?,
        deleted: group_deleted,
        description: row.try_get::<Option<String>, _>("group_description")?,
    };
    Ok(TenantApiKeyRecord {
        id: row.try_get("id")?,
        tenant_id: row.try_get("tenant_id")?,
        name: row.try_get("name")?,
        key_prefix: row.try_get("key_prefix")?,
        enabled: row.try_get("enabled")?,
        created_at: row.try_get("created_at")?,
        ip_allowlist,
        model_allowlist,
        group_id: group.id,
        group,
    })
}

fn deterministic_daily_reward_microcredits(tenant_id: Uuid, date: NaiveDate) -> i64 {
    let seed = format!("{tenant_id}:{}", date.format("%Y-%m-%d"));
    let hash = sha256_hex(&seed);
    let value = u64::from_str_radix(&hash[..16], 16).unwrap_or(0);
    let span = (CHECKIN_REWARD_MAX - CHECKIN_REWARD_MIN + 1) as u64;
    CHECKIN_REWARD_MIN + (value % span) as i64
}

fn current_ts_sec() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock before unix epoch")?
        .as_secs())
}

pub fn map_api_key_response_to_tenant_record(
    response: CreateApiKeyResponse,
    ip_allowlist: Vec<String>,
    model_allowlist: Vec<String>,
    group: ApiKeyGroupBindingItem,
) -> TenantCreateApiKeyResponse {
    let record = response.record;
    TenantCreateApiKeyResponse {
        record: TenantApiKeyRecord {
            id: record.id,
            tenant_id: record.tenant_id,
            name: record.name,
            key_prefix: record.key_prefix,
            enabled: record.enabled,
            created_at: record.created_at,
            ip_allowlist,
            model_allowlist,
            group_id: group.id,
            group,
        },
        plaintext_key: response.plaintext_key,
    }
}

pub fn map_api_key_to_tenant_record(
    api_key: ApiKey,
    ip_allowlist: Vec<String>,
    model_allowlist: Vec<String>,
    group: ApiKeyGroupBindingItem,
) -> TenantApiKeyRecord {
    TenantApiKeyRecord {
        id: api_key.id,
        tenant_id: api_key.tenant_id,
        name: api_key.name,
        key_prefix: api_key.key_prefix,
        enabled: api_key.enabled,
        created_at: api_key.created_at,
        ip_allowlist,
        model_allowlist,
        group_id: group.id,
        group,
    }
}


#[cfg(test)]
mod billing_pricing_rule_tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn stays_on_base_band_below_long_context_threshold() {
        let base = BillingPricingResolved {
            input_price_microcredits: 2_500_000,
            cached_input_price_microcredits: 250_000,
            output_price_microcredits: 15_000_000,
            source: "exact".to_string(),
        };
        let rules = vec![BillingPricingRuleRecord {
            id: Uuid::new_v4(),
            model_pattern: "gpt-5.4".to_string(),
            request_kind: BillingRequestKind::Any.as_str().to_string(),
            scope: BillingPricingRuleScope::Session.as_str().to_string(),
            threshold_input_tokens: Some(272_000),
            input_multiplier_ppm: 2_000_000,
            cached_input_multiplier_ppm: 1_000_000,
            output_multiplier_ppm: 1_500_000,
        }];

        let resolved = resolve_effective_pricing_for_band(
            &base,
            &rules,
            "gpt-5.4",
            BillingRequestKind::Response,
            None,
            Some(100_000),
            BillingResolutionPhase::Capture,
        );

        assert_eq!(resolved.band, BillingPricingBand::Base);
        assert_eq!(resolved.pricing.input_price_microcredits, 2_500_000);
        assert_eq!(resolved.pricing.output_price_microcredits, 15_000_000);
    }

    #[test]
    fn locked_long_context_band_keeps_multipliers_for_later_requests() {
        let base = BillingPricingResolved {
            input_price_microcredits: 2_500_000,
            cached_input_price_microcredits: 250_000,
            output_price_microcredits: 15_000_000,
            source: "exact".to_string(),
        };
        let rules = vec![BillingPricingRuleRecord {
            id: Uuid::new_v4(),
            model_pattern: "gpt-5.4".to_string(),
            request_kind: BillingRequestKind::Any.as_str().to_string(),
            scope: BillingPricingRuleScope::Session.as_str().to_string(),
            threshold_input_tokens: Some(272_000),
            input_multiplier_ppm: 2_000_000,
            cached_input_multiplier_ppm: 1_000_000,
            output_multiplier_ppm: 1_500_000,
        }];

        let resolved = resolve_effective_pricing_for_band(
            &base,
            &rules,
            "gpt-5.4",
            BillingRequestKind::Compact,
            Some(BillingPricingBand::LongContext),
            Some(32_000),
            BillingResolutionPhase::Capture,
        );

        assert_eq!(resolved.band, BillingPricingBand::LongContext);
        assert_eq!(resolved.pricing.input_price_microcredits, 5_000_000);
        assert_eq!(resolved.pricing.cached_input_price_microcredits, 250_000);
        assert_eq!(resolved.pricing.output_price_microcredits, 22_500_000);
    }

    #[test]
    fn api_key_group_formula_pricing_applies_group_and_model_multipliers() {
        let base = BillingPricingResolved {
            input_price_microcredits: 2_000_000,
            cached_input_price_microcredits: 200_000,
            output_price_microcredits: 8_000_000,
            source: "manual_override".to_string(),
        };
        let group = ApiKeyGroupRecord {
            id: Uuid::new_v4(),
            name: "starter".to_string(),
            description: None,
            is_default: false,
            enabled: true,
            allow_all_models: false,
            input_multiplier_ppm: 1_500_000,
            cached_input_multiplier_ppm: 2_000_000,
            output_multiplier_ppm: 1_250_000,
            deleted_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let policy = ApiKeyGroupModelPolicyRecord {
            id: Uuid::new_v4(),
            _group_id: group.id,
            model_id: "gpt-5.4".to_string(),
            enabled: true,
            input_multiplier_ppm: 2_000_000,
            cached_input_multiplier_ppm: 500_000,
            output_multiplier_ppm: 3_000_000,
            input_price_microcredits: None,
            cached_input_price_microcredits: None,
            output_price_microcredits: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let resolved = apply_api_key_group_model_pricing(&base, &group, Some(&policy));

        assert!(!resolved.uses_absolute_pricing);
        assert_eq!(resolved.formula.input_price_microcredits, 6_000_000);
        assert_eq!(resolved.formula.cached_input_price_microcredits, 200_000);
        assert_eq!(resolved.formula.output_price_microcredits, 30_000_000);
        assert_eq!(resolved.final_pricing.input_price_microcredits, 6_000_000);
        assert_eq!(resolved.final_pricing.cached_input_price_microcredits, 200_000);
        assert_eq!(resolved.final_pricing.output_price_microcredits, 30_000_000);
    }

    #[test]
    fn api_key_group_absolute_pricing_overrides_formula_pricing() {
        let base = BillingPricingResolved {
            input_price_microcredits: 1_000_000,
            cached_input_price_microcredits: 100_000,
            output_price_microcredits: 4_000_000,
            source: "official_sync".to_string(),
        };
        let group = ApiKeyGroupRecord {
            id: Uuid::new_v4(),
            name: "pro".to_string(),
            description: None,
            is_default: false,
            enabled: true,
            allow_all_models: false,
            input_multiplier_ppm: 2_000_000,
            cached_input_multiplier_ppm: 2_000_000,
            output_multiplier_ppm: 2_000_000,
            deleted_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let policy = ApiKeyGroupModelPolicyRecord {
            id: Uuid::new_v4(),
            _group_id: group.id,
            model_id: "gpt-5.4".to_string(),
            enabled: true,
            input_multiplier_ppm: 1_000_000,
            cached_input_multiplier_ppm: 1_000_000,
            output_multiplier_ppm: 1_000_000,
            input_price_microcredits: Some(9_000_000),
            cached_input_price_microcredits: Some(900_000),
            output_price_microcredits: Some(36_000_000),
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let resolved = apply_api_key_group_model_pricing(&base, &group, Some(&policy));

        assert!(resolved.uses_absolute_pricing);
        assert_eq!(resolved.formula.input_price_microcredits, 2_000_000);
        assert_eq!(resolved.formula.cached_input_price_microcredits, 200_000);
        assert_eq!(resolved.formula.output_price_microcredits, 8_000_000);
        assert_eq!(resolved.final_pricing.input_price_microcredits, 9_000_000);
        assert_eq!(resolved.final_pricing.cached_input_price_microcredits, 900_000);
        assert_eq!(resolved.final_pricing.output_price_microcredits, 36_000_000);
    }

    #[test]
    fn normalize_billing_service_tier_maps_unknown_values_to_default() {
        assert_eq!(normalize_billing_service_tier(Some("priority")), "priority");
        assert_eq!(normalize_billing_service_tier(Some("fast")), "priority");
        assert_eq!(normalize_billing_service_tier(Some("flex")), "flex");
        assert_eq!(normalize_billing_service_tier(Some("auto")), "default");
        assert_eq!(normalize_billing_service_tier(Some("anything-else")), "default");
        assert_eq!(normalize_billing_service_tier(None), "default");
    }

    #[test]
    fn pricing_override_lookup_tiers_falls_back_to_default() {
        assert_eq!(pricing_override_lookup_tiers("priority"), vec!["priority", "default"]);
        assert_eq!(pricing_override_lookup_tiers("flex"), vec!["flex", "default"]);
        assert_eq!(pricing_override_lookup_tiers("default"), vec!["default"]);
    }
}
