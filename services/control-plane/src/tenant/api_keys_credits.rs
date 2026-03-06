impl TenantAuthService {
    pub async fn list_tenant_api_keys(&self, tenant_id: Uuid) -> Result<Vec<TenantApiKeyRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT
                k.id,
                k.tenant_id,
                k.name,
                k.key_prefix,
                k.enabled,
                k.created_at,
                k.ip_allowlist,
                k.model_allowlist,
                g.id AS group_id,
                g.name AS group_name,
                g.description AS group_description,
                g.is_default AS group_is_default,
                g.enabled AS group_enabled,
                g.allow_all_models AS group_allow_all_models,
                g.deleted_at AS group_deleted_at
            FROM api_keys k
            INNER JOIN api_key_groups g ON g.id = k.group_id
            WHERE k.tenant_id = $1
            ORDER BY created_at ASC
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .context("failed to list tenant api keys")?;

        rows.into_iter().map(parse_tenant_api_key_row).collect()
    }

    pub async fn create_tenant_api_key(
        &self,
        tenant_id: Uuid,
        req: TenantCreateApiKeyRequest,
    ) -> Result<TenantCreateApiKeyResponse> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(anyhow!("name must not be empty"));
        }
        let group_id = if let Some(group_id) = req.group_id {
            let group = self
                .fetch_api_key_group_record(group_id)
                .await?
                .ok_or_else(|| anyhow!("api key group not found"))?;
            ensure_api_key_group_is_usable(&group)?;
            group.id
        } else {
            self.fetch_default_api_key_group_record().await?.id
        };
        let ip_allowlist = normalize_str_list(req.ip_allowlist);
        let model_allowlist = normalize_str_list(req.model_allowlist);
        let plaintext_key = format!("cp_{}", Uuid::new_v4().simple());
        let key_hash = crate::security::hash_api_key_token(&plaintext_key);
        let key_prefix: String = plaintext_key.chars().take(12).collect();
        let id = Uuid::new_v4();
        let created_at = Utc::now();
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to start tenant api key transaction")?;
        let _inserted = sqlx::query(
            r#"
            INSERT INTO api_keys (
                id, tenant_id, group_id, name, key_prefix, key_hash, enabled, created_at, ip_allowlist, model_allowlist
            )
            VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $9)
            RETURNING id
            "#,
        )
        .bind(id)
        .bind(tenant_id)
        .bind(group_id)
        .bind(name)
        .bind(key_prefix)
        .bind(&key_hash)
        .bind(created_at)
        .bind(json!(ip_allowlist))
        .bind(json!(model_allowlist))
        .fetch_one(tx.as_mut())
        .await
        .context("failed to insert tenant api key")?;
        sqlx::query("INSERT INTO api_key_tokens (token, api_key_id) VALUES ($1, $2)")
            .bind(&key_hash)
            .bind(id)
            .execute(tx.as_mut())
            .await
            .context("failed to insert tenant api key token")?;
        let row = sqlx::query(
            r#"
            SELECT
                k.id,
                k.tenant_id,
                k.name,
                k.key_prefix,
                k.enabled,
                k.created_at,
                k.ip_allowlist,
                k.model_allowlist,
                g.id AS group_id,
                g.name AS group_name,
                g.description AS group_description,
                g.is_default AS group_is_default,
                g.enabled AS group_enabled,
                g.allow_all_models AS group_allow_all_models,
                g.deleted_at AS group_deleted_at
            FROM api_keys k
            INNER JOIN api_key_groups g ON g.id = k.group_id
            WHERE k.id = $1
            "#,
        )
        .bind(id)
        .fetch_one(tx.as_mut())
        .await
        .context("failed to reload tenant api key with group")?;
        tx.commit()
            .await
            .context("failed to commit tenant api key transaction")?;

        Ok(TenantCreateApiKeyResponse {
            record: parse_tenant_api_key_row(row)?,
            plaintext_key,
        })
    }

    pub async fn patch_tenant_api_key(
        &self,
        tenant_id: Uuid,
        key_id: Uuid,
        req: TenantPatchApiKeyRequest,
    ) -> Result<TenantApiKeyRecord> {
        let ip_allowlist = req.ip_allowlist.map(normalize_str_list);
        let model_allowlist = req.model_allowlist.map(normalize_str_list);
        let group_id = if let Some(group_id) = req.group_id {
            let group = self
                .fetch_api_key_group_record(group_id)
                .await?
                .ok_or_else(|| anyhow!("api key group not found"))?;
            ensure_api_key_group_is_usable(&group)?;
            Some(group.id)
        } else {
            None
        };
        let _updated = sqlx::query(
            r#"
            UPDATE api_keys
            SET
                enabled = COALESCE($3, enabled),
                ip_allowlist = COALESCE($4, ip_allowlist),
                model_allowlist = COALESCE($5, model_allowlist),
                group_id = COALESCE($6, group_id)
            WHERE id = $1 AND tenant_id = $2
            RETURNING id
            "#,
        )
        .bind(key_id)
        .bind(tenant_id)
        .bind(req.enabled)
        .bind(ip_allowlist.map(|v| json!(v)))
        .bind(model_allowlist.map(|v| json!(v)))
        .bind(group_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to patch tenant api key")?
        .ok_or_else(|| anyhow!("api key not found"))?;
        let row = sqlx::query(
            r#"
            SELECT
                k.id,
                k.tenant_id,
                k.name,
                k.key_prefix,
                k.enabled,
                k.created_at,
                k.ip_allowlist,
                k.model_allowlist,
                g.id AS group_id,
                g.name AS group_name,
                g.description AS group_description,
                g.is_default AS group_is_default,
                g.enabled AS group_enabled,
                g.allow_all_models AS group_allow_all_models,
                g.deleted_at AS group_deleted_at
            FROM api_keys k
            INNER JOIN api_key_groups g ON g.id = k.group_id
            WHERE k.id = $1 AND k.tenant_id = $2
            "#,
        )
        .bind(key_id)
        .bind(tenant_id)
        .fetch_one(&self.pool)
        .await
        .context("failed to reload patched tenant api key with group")?;
        parse_tenant_api_key_row(row)
    }

    pub async fn delete_tenant_api_key(&self, tenant_id: Uuid, key_id: Uuid) -> Result<()> {
        let affected = sqlx::query("DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2")
            .bind(key_id)
            .bind(tenant_id)
            .execute(&self.pool)
            .await
            .context("failed to delete tenant api key")?
            .rows_affected();
        if affected == 0 {
            return Err(anyhow!("api key not found"));
        }
        Ok(())
    }

    pub async fn get_credit_balance(&self, tenant_id: Uuid) -> Result<TenantCreditBalanceResponse> {
        let row = sqlx::query(
            r#"
            SELECT tenant_id, balance_microcredits, updated_at
            FROM tenant_credit_accounts
            WHERE tenant_id = $1
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to query tenant credit balance")?;
        if let Some(row) = row {
            return Ok(TenantCreditBalanceResponse {
                tenant_id: row.try_get("tenant_id")?,
                balance_microcredits: row.try_get("balance_microcredits")?,
                updated_at: row.try_get("updated_at")?,
            });
        }

        let now = Utc::now();
        sqlx::query(
            r#"
            INSERT INTO tenant_credit_accounts (tenant_id, balance_microcredits, updated_at)
            VALUES ($1, 0, $2)
            ON CONFLICT (tenant_id) DO NOTHING
            "#,
        )
        .bind(tenant_id)
        .bind(now)
        .execute(&self.pool)
        .await
        .context("failed to initialize tenant credit account")?;
        Ok(TenantCreditBalanceResponse {
            tenant_id,
            balance_microcredits: 0,
            updated_at: now,
        })
    }

    pub async fn get_credit_summary(&self, tenant_id: Uuid) -> Result<TenantCreditSummaryResponse> {
        let balance = self.get_credit_balance(tenant_id).await?;
        let row = sqlx::query(
            r#"
            WITH ledger_scored AS (
                SELECT
                    created_at,
                    delta_microcredits,
                    lower(event_type) AS event_type,
                    CASE
                        WHEN jsonb_typeof(meta_json) = 'object'
                            AND jsonb_typeof(meta_json -> 'charged_microcredits') = 'number'
                        THEN (meta_json ->> 'charged_microcredits')::bigint
                        ELSE 0
                    END AS charged_microcredits
                FROM tenant_credit_ledger
                WHERE tenant_id = $1
                    AND created_at >= date_trunc('month', now())
            ),
            consumed AS (
                SELECT
                    created_at,
                    CASE
                        WHEN event_type = 'capture' THEN
                            CASE
                                WHEN charged_microcredits > 0 THEN charged_microcredits
                                WHEN delta_microcredits < 0 THEN -delta_microcredits
                                ELSE 0
                            END
                        WHEN event_type IN ('adjust', 'consume') AND delta_microcredits < 0
                            THEN -delta_microcredits
                        ELSE 0
                    END AS consumed_microcredits
                FROM ledger_scored
            )
            SELECT
                COALESCE(
                    SUM(
                        CASE
                            WHEN created_at >= date_trunc('day', now()) THEN consumed_microcredits
                            ELSE 0
                        END
                    ),
                    0
                )::bigint AS today_consumed_microcredits,
                COALESCE(SUM(consumed_microcredits), 0)::bigint AS month_consumed_microcredits
            FROM consumed
            "#,
        )
        .bind(tenant_id)
        .fetch_one(&self.pool)
        .await
        .context("failed to summarize tenant credit usage")?;

        Ok(TenantCreditSummaryResponse {
            tenant_id,
            balance_microcredits: balance.balance_microcredits,
            today_consumed_microcredits: row.try_get("today_consumed_microcredits")?,
            month_consumed_microcredits: row.try_get("month_consumed_microcredits")?,
            updated_at: balance.updated_at,
        })
    }

    pub async fn list_credit_ledger(
        &self,
        tenant_id: Uuid,
        limit: usize,
    ) -> Result<TenantCreditLedgerResponse> {
        let safe_limit = limit.clamp(1, 500) as i64;
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                event_type,
                api_key_id,
                request_id,
                delta_microcredits,
                balance_after_microcredits,
                model,
                unit_price_microcredits,
                input_tokens,
                output_tokens,
                meta_json,
                created_at
            FROM tenant_credit_ledger
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(tenant_id)
        .bind(safe_limit)
        .fetch_all(&self.pool)
        .await
        .context("failed to list tenant credit ledger")?;
        let items = rows
            .into_iter()
            .map(|row| -> Result<TenantCreditLedgerItem> {
                Ok(TenantCreditLedgerItem {
                    id: row.try_get("id")?,
                    event_type: row.try_get("event_type")?,
                    api_key_id: row.try_get("api_key_id")?,
                    request_id: row.try_get("request_id")?,
                    delta_microcredits: row.try_get("delta_microcredits")?,
                    balance_after_microcredits: row.try_get("balance_after_microcredits")?,
                    model: row.try_get("model")?,
                    unit_price_microcredits: row.try_get("unit_price_microcredits")?,
                    input_tokens: row.try_get("input_tokens")?,
                    output_tokens: row.try_get("output_tokens")?,
                    meta_json: normalize_ledger_meta_json(row.try_get("meta_json")?),
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(TenantCreditLedgerResponse { items })
    }

    pub async fn daily_checkin(&self, tenant_id: Uuid) -> Result<TenantDailyCheckinResponse> {
        let now = Utc::now();
        let local_date = now.date_naive();
        let reward_microcredits = deterministic_daily_reward_microcredits(tenant_id, local_date);
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to start daily checkin transaction")?;
        let existing = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT reward_microcredits
            FROM tenant_daily_checkins
            WHERE tenant_id = $1 AND local_date = $2
            "#,
        )
        .bind(tenant_id)
        .bind(local_date)
        .fetch_optional(tx.as_mut())
        .await
        .context("failed to query existing tenant daily checkin")?;
        if existing.is_some() {
            return Err(anyhow!("daily checkin already claimed"));
        }

        sqlx::query(
            r#"
            INSERT INTO tenant_daily_checkins (tenant_id, local_date, reward_microcredits, created_at)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(tenant_id)
        .bind(local_date)
        .bind(reward_microcredits)
        .bind(now)
        .execute(tx.as_mut())
        .await
        .context("failed to insert tenant daily checkin record")?;

        let balance_after = self
            .apply_credit_delta_inner(
                &mut tx,
                CreditDeltaParams {
                    tenant_id,
                    api_key_id: None,
                    event_type: "checkin",
                    delta_microcredits: reward_microcredits,
                    request_id: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                    meta_json: Some(json!({"local_date": local_date.to_string()})),
                    now,
                },
            )
            .await?;

        tx.commit()
            .await
            .context("failed to commit tenant daily checkin transaction")?;

        Ok(TenantDailyCheckinResponse {
            tenant_id,
            local_date,
            reward_microcredits,
            balance_microcredits: balance_after,
        })
    }
}

fn normalize_ledger_meta_json(value: serde_json::Value) -> Option<serde_json::Value> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::Object(map) if map.is_empty() => None,
        other => Some(other),
    }
}
