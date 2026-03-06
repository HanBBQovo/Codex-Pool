const DEFAULT_ADMIN_TENANT_LOGIN_EMAIL_ENV: &str = "DEFAULT_ADMIN_TENANT_LOGIN_EMAIL";
const DEFAULT_ADMIN_TENANT_LOGIN_PASSWORD_ENV: &str = "DEFAULT_ADMIN_TENANT_LOGIN_PASSWORD";
const DEFAULT_ADMIN_TENANT_LOGIN_EMAIL: &str = "admin@tenant.local";
const DEFAULT_ADMIN_TENANT_LOGIN_PASSWORD: &str = "admin123456";

impl TenantAuthService {
    pub async fn admin_create_tenant(
        &self,
        req: AdminTenantCreateRequest,
    ) -> Result<AdminTenantItem> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(anyhow!("name must not be empty"));
        }
        let now = Utc::now();
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to start admin create tenant transaction")?;
        let row = sqlx::query(
            r#"
            INSERT INTO tenants (id, name, status, plan, expires_at, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $6)
            RETURNING id, name, status, plan, expires_at, created_at, updated_at
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(name)
        .bind(
            req.status
                .as_deref()
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .unwrap_or("active")
                .to_ascii_lowercase(),
        )
        .bind(
            req.plan
                .as_deref()
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .unwrap_or("credit")
                .to_ascii_lowercase(),
        )
        .bind(req.expires_at)
        .bind(now)
        .fetch_one(tx.as_mut())
        .await
        .context("failed to create tenant")?;
        let tenant_id: Uuid = row.try_get("id")?;
        sqlx::query(
            r#"
            INSERT INTO tenant_credit_accounts (tenant_id, balance_microcredits, updated_at)
            VALUES ($1, 0, $2)
            ON CONFLICT (tenant_id) DO NOTHING
            "#,
        )
        .bind(tenant_id)
        .bind(now)
        .execute(tx.as_mut())
        .await
        .context("failed to initialize tenant credit account for admin-created tenant")?;
        tx.commit()
            .await
            .context("failed to commit admin create tenant transaction")?;
        Ok(AdminTenantItem {
            id: tenant_id,
            name: row.try_get("name")?,
            status: row.try_get("status")?,
            plan: row.try_get("plan")?,
            expires_at: row.try_get("expires_at")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn admin_list_tenants(&self) -> Result<Vec<AdminTenantItem>> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, status, plan, expires_at, created_at, updated_at
            FROM tenants
            ORDER BY created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list admin tenants")?;
        rows.into_iter()
            .map(|row| -> Result<AdminTenantItem> {
                Ok(AdminTenantItem {
                    id: row.try_get("id")?,
                    name: row.try_get("name")?,
                    status: row.try_get("status")?,
                    plan: row.try_get("plan")?,
                    expires_at: row.try_get("expires_at")?,
                    created_at: row.try_get("created_at")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect()
    }

    pub async fn admin_ensure_default_tenant(&self) -> Result<AdminTenantItem> {
        if let Some(row) = sqlx::query(
            r#"
            SELECT id, name, status, plan, expires_at, created_at, updated_at
            FROM tenants
            WHERE lower(name) = lower('admin')
            ORDER BY created_at ASC
            LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to query default admin tenant")?
        {
            let tenant = AdminTenantItem {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                status: row.try_get("status")?,
                plan: row.try_get("plan")?,
                expires_at: row.try_get("expires_at")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
            };
            self.ensure_default_admin_tenant_login(tenant.id).await?;
            return Ok(tenant);
        }

        let tenant = self
            .admin_create_tenant(AdminTenantCreateRequest {
            name: "admin".to_string(),
            status: Some("active".to_string()),
            plan: Some("credit".to_string()),
            expires_at: None,
        })
        .await?;
        self.ensure_default_admin_tenant_login(tenant.id).await?;
        Ok(tenant)
    }

    pub async fn admin_patch_tenant(
        &self,
        tenant_id: Uuid,
        req: AdminTenantPatchRequest,
    ) -> Result<AdminTenantItem> {
        let row = sqlx::query(
            r#"
            UPDATE tenants
            SET
                status = COALESCE($2, status),
                plan = COALESCE($3, plan),
                expires_at = CASE WHEN $4 IS NULL THEN expires_at ELSE $4 END,
                updated_at = $5
            WHERE id = $1
            RETURNING id, name, status, plan, expires_at, created_at, updated_at
            "#,
        )
        .bind(tenant_id)
        .bind(req.status.map(|v| v.trim().to_ascii_lowercase()))
        .bind(req.plan.map(|v| v.trim().to_ascii_lowercase()))
        .bind(req.expires_at)
        .bind(Utc::now())
        .fetch_optional(&self.pool)
        .await
        .context("failed to patch tenant")?
        .ok_or_else(|| anyhow!("tenant not found"))?;
        Ok(AdminTenantItem {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            status: row.try_get("status")?,
            plan: row.try_get("plan")?,
            expires_at: row.try_get("expires_at")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn admin_recharge_tenant(
        &self,
        tenant_id: Uuid,
        req: AdminRechargeRequest,
    ) -> Result<AdminRechargeResponse> {
        if req.amount_microcredits <= 0 {
            return Err(anyhow!("amount_microcredits must be positive"));
        }
        let now = Utc::now();
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to start tenant recharge transaction")?;
        let balance_after = self
            .apply_credit_delta_inner(
                &mut tx,
                CreditDeltaParams {
                    tenant_id,
                    api_key_id: None,
                    event_type: "recharge",
                    delta_microcredits: req.amount_microcredits,
                    request_id: None,
                    model: None,
                    input_tokens: None,
                    output_tokens: None,
                    meta_json: Some(
                        json!({"reason": req.reason.unwrap_or_else(|| "admin recharge".to_string())}),
                    ),
                    now,
                },
            )
            .await?;
        tx.commit()
            .await
            .context("failed to commit tenant recharge transaction")?;
        Ok(AdminRechargeResponse {
            tenant_id,
            amount_microcredits: req.amount_microcredits,
            balance_microcredits: balance_after,
        })
    }

    pub async fn admin_list_model_pricing(&self) -> Result<Vec<ModelPricingItem>> {
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                model,
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits,
                enabled,
                created_at,
                updated_at
            FROM model_pricing_overrides
            ORDER BY model ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list model pricing overrides")?;
        rows.into_iter()
            .map(|row| -> Result<ModelPricingItem> {
                Ok(ModelPricingItem {
                    id: row.try_get("id")?,
                    model: row.try_get("model")?,
                    input_price_microcredits: row.try_get("input_price_microcredits")?,
                    cached_input_price_microcredits: row
                        .try_get("cached_input_price_microcredits")?,
                    output_price_microcredits: row.try_get("output_price_microcredits")?,
                    enabled: row.try_get("enabled")?,
                    created_at: row.try_get("created_at")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect()
    }

    pub async fn admin_upsert_model_pricing(
        &self,
        req: ModelPricingUpsertRequest,
    ) -> Result<ModelPricingItem> {
        let model = req.model.trim();
        if model.is_empty() {
            return Err(anyhow!("model must not be empty"));
        }
        let exists = sqlx::query_scalar::<_, i64>(
            r#"SELECT COUNT(*) FROM openai_models_catalog WHERE model_id = $1"#,
        )
        .bind(model)
        .fetch_one(&self.pool)
        .await
        .context("failed to validate official model id for price override")?;
        if exists == 0 {
            return Err(anyhow!("model must exist in official catalog before creating an override"));
        }
        let cached_input_price_microcredits = req
            .cached_input_price_microcredits
            .unwrap_or_else(|| (req.input_price_microcredits / 10).max(0));

        if req.input_price_microcredits < 0
            || cached_input_price_microcredits < 0
            || req.output_price_microcredits < 0
        {
            return Err(anyhow!(
                "input_price_microcredits/cached_input_price_microcredits/output_price_microcredits must be >= 0"
            ));
        }
        let now = Utc::now();
        let row = sqlx::query(
            r#"
            INSERT INTO model_pricing_overrides (
                id, model, input_price_microcredits, cached_input_price_microcredits, output_price_microcredits, enabled, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
            ON CONFLICT (model)
            DO UPDATE SET
                input_price_microcredits = EXCLUDED.input_price_microcredits,
                cached_input_price_microcredits = EXCLUDED.cached_input_price_microcredits,
                output_price_microcredits = EXCLUDED.output_price_microcredits,
                enabled = EXCLUDED.enabled,
                updated_at = EXCLUDED.updated_at
            RETURNING
                id,
                model,
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits,
                enabled,
                created_at,
                updated_at
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(model)
        .bind(req.input_price_microcredits)
        .bind(cached_input_price_microcredits)
        .bind(req.output_price_microcredits)
        .bind(req.enabled)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .context("failed to upsert model pricing override")?;
        Ok(ModelPricingItem {
            id: row.try_get("id")?,
            model: row.try_get("model")?,
            input_price_microcredits: row.try_get("input_price_microcredits")?,
            cached_input_price_microcredits: row.try_get("cached_input_price_microcredits")?,
            output_price_microcredits: row.try_get("output_price_microcredits")?,
            enabled: row.try_get("enabled")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn admin_delete_model_pricing(&self, pricing_id: Uuid) -> Result<()> {
        let result = sqlx::query(
            r#"
            DELETE FROM model_pricing_overrides
            WHERE id = $1
            "#,
        )
        .bind(pricing_id)
        .execute(&self.pool)
        .await
        .context("failed to delete model pricing override")?;

        if result.rows_affected() == 0 {
            return Err(anyhow!("model pricing not found"));
        }

        Ok(())
    }

    pub async fn admin_list_billing_pricing_rules(&self) -> Result<Vec<BillingPricingRuleItem>> {
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
                output_multiplier_ppm,
                priority,
                enabled,
                created_at,
                updated_at
            FROM billing_pricing_rules
            ORDER BY model_pattern ASC, priority DESC, threshold_input_tokens DESC NULLS LAST, created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list billing pricing rules")?;
        rows.into_iter()
            .map(|row| -> Result<BillingPricingRuleItem> {
                Ok(BillingPricingRuleItem {
                    id: row.try_get("id")?,
                    model_pattern: row.try_get("model_pattern")?,
                    request_kind: row.try_get("request_kind")?,
                    scope: row.try_get("scope")?,
                    threshold_input_tokens: row.try_get("threshold_input_tokens")?,
                    input_multiplier_ppm: row.try_get("input_multiplier_ppm")?,
                    cached_input_multiplier_ppm: row.try_get("cached_input_multiplier_ppm")?,
                    output_multiplier_ppm: row.try_get("output_multiplier_ppm")?,
                    priority: row.try_get("priority")?,
                    enabled: row.try_get("enabled")?,
                    created_at: row.try_get("created_at")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect()
    }

    pub async fn admin_upsert_billing_pricing_rule(
        &self,
        req: BillingPricingRuleUpsertRequest,
    ) -> Result<BillingPricingRuleItem> {
        let model_pattern = req.model_pattern.trim();
        if model_pattern.is_empty() {
            return Err(anyhow!("model_pattern must not be empty"));
        }
        let request_kind = req.request_kind.trim().to_ascii_lowercase();
        if request_kind.is_empty() {
            return Err(anyhow!("request_kind must not be empty"));
        }
        let scope = req.scope.trim().to_ascii_lowercase();
        if scope != "request" && scope != "session" {
            return Err(anyhow!("scope must be request or session"));
        }
        let threshold_input_tokens = req.threshold_input_tokens.map(|value| value.max(0));
        if req.input_multiplier_ppm < 0
            || req.cached_input_multiplier_ppm < 0
            || req.output_multiplier_ppm < 0
        {
            return Err(anyhow!("pricing multipliers must be >= 0"));
        }

        let now = Utc::now();
        let rule_id = req.id.unwrap_or_else(Uuid::new_v4);
        let row = sqlx::query(
            r#"
            INSERT INTO billing_pricing_rules (
                id,
                model_pattern,
                request_kind,
                scope,
                threshold_input_tokens,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                priority,
                enabled,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
            ON CONFLICT (id)
            DO UPDATE SET
                model_pattern = EXCLUDED.model_pattern,
                request_kind = EXCLUDED.request_kind,
                scope = EXCLUDED.scope,
                threshold_input_tokens = EXCLUDED.threshold_input_tokens,
                input_multiplier_ppm = EXCLUDED.input_multiplier_ppm,
                cached_input_multiplier_ppm = EXCLUDED.cached_input_multiplier_ppm,
                output_multiplier_ppm = EXCLUDED.output_multiplier_ppm,
                priority = EXCLUDED.priority,
                enabled = EXCLUDED.enabled,
                updated_at = EXCLUDED.updated_at
            RETURNING
                id,
                model_pattern,
                request_kind,
                scope,
                threshold_input_tokens,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                priority,
                enabled,
                created_at,
                updated_at
            "#,
        )
        .bind(rule_id)
        .bind(model_pattern)
        .bind(request_kind)
        .bind(scope)
        .bind(threshold_input_tokens)
        .bind(req.input_multiplier_ppm)
        .bind(req.cached_input_multiplier_ppm)
        .bind(req.output_multiplier_ppm)
        .bind(req.priority)
        .bind(req.enabled)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .context("failed to upsert billing pricing rule")?;

        Ok(BillingPricingRuleItem {
            id: row.try_get("id")?,
            model_pattern: row.try_get("model_pattern")?,
            request_kind: row.try_get("request_kind")?,
            scope: row.try_get("scope")?,
            threshold_input_tokens: row.try_get("threshold_input_tokens")?,
            input_multiplier_ppm: row.try_get("input_multiplier_ppm")?,
            cached_input_multiplier_ppm: row.try_get("cached_input_multiplier_ppm")?,
            output_multiplier_ppm: row.try_get("output_multiplier_ppm")?,
            priority: row.try_get("priority")?,
            enabled: row.try_get("enabled")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn admin_delete_billing_pricing_rule(&self, rule_id: Uuid) -> Result<()> {
        let result = sqlx::query(
            r#"
            DELETE FROM billing_pricing_rules
            WHERE id = $1
            "#,
        )
        .bind(rule_id)
        .execute(&self.pool)
        .await
        .context("failed to delete billing pricing rule")?;

        if result.rows_affected() == 0 {
            return Err(anyhow!("billing pricing rule not found"));
        }

        Ok(())
    }

    pub async fn admin_list_model_entities(&self) -> Result<Vec<AdminModelEntityItem>> {
        let rows = sqlx::query(
            r#"
            SELECT id, model_id, provider, visibility, created_at, updated_at
            FROM admin_model_entities
            ORDER BY model_id ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list admin model entities")?;
        rows.into_iter()
            .map(|row| -> Result<AdminModelEntityItem> {
                Ok(AdminModelEntityItem {
                    id: row.try_get("id")?,
                    model: row.try_get("model_id")?,
                    provider: row.try_get("provider")?,
                    visibility: row.try_get("visibility")?,
                    created_at: row.try_get("created_at")?,
                    updated_at: row.try_get("updated_at")?,
                })
            })
            .collect()
    }

    pub async fn admin_upsert_model_entity(
        &self,
        req: AdminModelEntityUpsertRequest,
    ) -> Result<AdminModelEntityItem> {
        let model = req.model.trim();
        if model.is_empty() {
            return Err(anyhow!("model must not be empty"));
        }
        let provider = req
            .provider
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .unwrap_or("custom")
            .to_ascii_lowercase();
        let visibility = req
            .visibility
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| item.to_ascii_lowercase());
        let now = Utc::now();
        let row = sqlx::query(
            r#"
            INSERT INTO admin_model_entities (
                id, model_id, provider, visibility, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $5)
            ON CONFLICT (model_id)
            DO UPDATE SET
                provider = EXCLUDED.provider,
                visibility = EXCLUDED.visibility,
                updated_at = EXCLUDED.updated_at
            RETURNING id, model_id, provider, visibility, created_at, updated_at
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(model)
        .bind(provider)
        .bind(visibility)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .context("failed to upsert admin model entity")?;
        Ok(AdminModelEntityItem {
            id: row.try_get("id")?,
            model: row.try_get("model_id")?,
            provider: row.try_get("provider")?,
            visibility: row.try_get("visibility")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn admin_delete_model_entity(&self, entity_id: Uuid) -> Result<()> {
        let result = sqlx::query(
            r#"
            DELETE FROM admin_model_entities
            WHERE id = $1
            "#,
        )
        .bind(entity_id)
        .execute(&self.pool)
        .await
        .context("failed to delete admin model entity")?;
        if result.rows_affected() == 0 {
            return Err(anyhow!("model entity not found"));
        }
        Ok(())
    }

    pub async fn admin_impersonate(
        &self,
        admin_user_id: Uuid,
        req: AdminImpersonateRequest,
    ) -> Result<AdminImpersonateResponse> {
        if req.reason.trim().is_empty() {
            return Err(anyhow!("reason must not be empty"));
        }
        let now = Utc::now();
        let expires_at = now + chrono::Duration::seconds(self.token_ttl_sec as i64);
        let session_id = Uuid::new_v4();
        sqlx::query(
            r#"
            INSERT INTO admin_impersonation_sessions (id, admin_user_id, tenant_id, reason, expires_at, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(session_id)
        .bind(admin_user_id)
        .bind(req.tenant_id)
        .bind(req.reason.trim())
        .bind(expires_at)
        .bind(now)
        .execute(&self.pool)
        .await
        .context("failed to insert admin impersonation session")?;
        let token = self.issue_token(
            admin_user_id,
            req.tenant_id,
            "admin-impersonation",
            Some(admin_user_id),
            Some(session_id),
            Some(req.reason.clone()),
        )?;
        Ok(AdminImpersonateResponse {
            session_id,
            access_token: token,
            expires_in: self.token_ttl_sec,
            tenant_id: req.tenant_id,
        })
    }

    pub async fn admin_revoke_impersonation(&self, session_id: Uuid) -> Result<()> {
        let affected = sqlx::query(
            r#"
            DELETE FROM admin_impersonation_sessions
            WHERE id = $1
            "#,
        )
        .bind(session_id)
        .execute(&self.pool)
        .await
        .context("failed to delete admin impersonation session")?
        .rows_affected();
        if affected == 0 {
            return Err(anyhow!("impersonation session not found"));
        }
        Ok(())
    }

    async fn ensure_default_admin_tenant_login(&self, tenant_id: Uuid) -> Result<()> {
        let default_email = normalize_email(&read_default_admin_tenant_login_email())?;
        let default_password = read_default_admin_tenant_login_password();
        validate_password(&default_password)?;
        let password_hash = hash(&default_password, DEFAULT_COST)
            .context("failed to hash default admin tenant login password")?;
        let now = Utc::now();
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to start ensure default admin tenant login transaction")?;

        let existing = sqlx::query(
            r#"
            SELECT id, tenant_id
            FROM tenant_users
            WHERE email = $1
            LIMIT 1
            "#,
        )
        .bind(&default_email)
        .fetch_optional(tx.as_mut())
        .await
        .context("failed to query default admin tenant login account")?;

        if let Some(row) = existing {
            let tenant_user_id: Uuid = row.try_get("id")?;
            let existing_tenant_id: Uuid = row.try_get("tenant_id")?;
            if existing_tenant_id != tenant_id {
                return Err(anyhow!(
                    "default admin tenant login email is already used by another tenant"
                ));
            }
            sqlx::query(
                r#"
                UPDATE tenant_users
                SET
                    password_hash = $2,
                    email_verified = true,
                    enabled = true,
                    updated_at = $3
                WHERE id = $1
                "#,
            )
            .bind(tenant_user_id)
            .bind(&password_hash)
            .bind(now)
            .execute(tx.as_mut())
            .await
            .context("failed to update default admin tenant login account")?;
        } else {
            sqlx::query(
                r#"
                INSERT INTO tenant_users (
                    id, tenant_id, email, password_hash, email_verified, enabled, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, true, true, $5, $5)
                "#,
            )
            .bind(Uuid::new_v4())
            .bind(tenant_id)
            .bind(&default_email)
            .bind(&password_hash)
            .bind(now)
            .execute(tx.as_mut())
            .await
            .context("failed to create default admin tenant login account")?;
        }

        sqlx::query(
            r#"
            UPDATE tenants
            SET updated_at = $2
            WHERE id = $1
            "#,
        )
        .bind(tenant_id)
        .bind(now)
        .execute(tx.as_mut())
        .await
        .context("failed to update tenant updated_at after ensuring default login account")?;

        tx.commit()
            .await
            .context("failed to commit ensure default admin tenant login transaction")?;
        Ok(())
    }
}

fn read_default_admin_tenant_login_email() -> String {
    std::env::var(DEFAULT_ADMIN_TENANT_LOGIN_EMAIL_ENV)
        .ok()
        .map(|raw| raw.trim().to_string())
        .filter(|raw| !raw.is_empty())
        .unwrap_or_else(|| DEFAULT_ADMIN_TENANT_LOGIN_EMAIL.to_string())
}

fn read_default_admin_tenant_login_password() -> String {
    std::env::var(DEFAULT_ADMIN_TENANT_LOGIN_PASSWORD_ENV)
        .ok()
        .filter(|raw| !raw.is_empty())
        .unwrap_or_else(|| DEFAULT_ADMIN_TENANT_LOGIN_PASSWORD.to_string())
}
