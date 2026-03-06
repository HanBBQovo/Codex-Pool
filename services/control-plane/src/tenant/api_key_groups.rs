#[derive(Debug, Clone)]
struct UnifiedModelCatalogEntry {
    model: String,
    provider: String,
    title: Option<String>,
    visibility: Option<String>,
}

impl TenantAuthService {
    async fn fetch_api_key_group_record(&self, group_id: Uuid) -> Result<Option<ApiKeyGroupRecord>> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                name,
                description,
                is_default,
                enabled,
                allow_all_models,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                deleted_at,
                created_at,
                updated_at
            FROM api_key_groups
            WHERE id = $1
            "#,
        )
        .bind(group_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to query api key group")?;
        row.map(parse_api_key_group_record).transpose()
    }

    async fn fetch_default_api_key_group_record(&self) -> Result<ApiKeyGroupRecord> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                name,
                description,
                is_default,
                enabled,
                allow_all_models,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                deleted_at,
                created_at,
                updated_at
            FROM api_key_groups
            WHERE is_default = true AND deleted_at IS NULL
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to query default api key group")?;
        parse_api_key_group_record(row)
    }

    async fn fetch_api_key_group_for_api_key(&self, api_key_id: Uuid) -> Result<ApiKeyGroupRecord> {
        let row = sqlx::query(
            r#"
            SELECT
                g.id,
                g.name,
                g.description,
                g.is_default,
                g.enabled,
                g.allow_all_models,
                g.input_multiplier_ppm,
                g.cached_input_multiplier_ppm,
                g.output_multiplier_ppm,
                g.deleted_at,
                g.created_at,
                g.updated_at
            FROM api_keys k
            INNER JOIN api_key_groups g ON g.id = k.group_id
            WHERE k.id = $1
            "#,
        )
        .bind(api_key_id)
        .fetch_optional(&self.pool)
        .await
        .context("failed to query api key group for api key")?
        .ok_or_else(|| anyhow!("api key group not found"))?;
        parse_api_key_group_record(row)
    }

    async fn list_api_key_group_policy_records(
        &self,
        group_id: Uuid,
    ) -> Result<Vec<ApiKeyGroupModelPolicyRecord>> {
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                group_id,
                model_id,
                enabled,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits,
                created_at,
                updated_at
            FROM api_key_group_model_policies
            WHERE group_id = $1
            ORDER BY model_id ASC
            "#,
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await
        .context("failed to list api key group model policies")?;
        rows.into_iter().map(parse_api_key_group_model_policy_record).collect()
    }

    async fn fetch_api_key_group_policy_for_model(
        &self,
        group_id: Uuid,
        model: &str,
    ) -> Result<Option<ApiKeyGroupModelPolicyRecord>> {
        let row = sqlx::query(
            r#"
            SELECT
                id,
                group_id,
                model_id,
                enabled,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits,
                created_at,
                updated_at
            FROM api_key_group_model_policies
            WHERE group_id = $1 AND model_id = $2
            LIMIT 1
            "#,
        )
        .bind(group_id)
        .bind(model)
        .fetch_optional(&self.pool)
        .await
        .context("failed to query api key group model policy")?;
        row.map(parse_api_key_group_model_policy_record).transpose()
    }

    pub async fn resolve_api_key_group_model_allowlist(&self, api_key_id: Uuid) -> Result<Vec<String>> {
        let group = self.fetch_api_key_group_for_api_key(api_key_id).await?;
        ensure_api_key_group_is_usable(&group)?;

        let policies = self.list_api_key_group_policy_records(group.id).await?;
        if group.allow_all_models {
            let deny_set = policies
                .iter()
                .filter(|item| !item.enabled)
                .map(|item| item.model_id.clone())
                .collect::<std::collections::HashSet<_>>();
            let mut models = self
                .list_api_key_group_catalog()
                .await?
                .into_iter()
                .map(|item| item.model)
                .filter(|model| !deny_set.contains(model))
                .collect::<Vec<_>>();
            models.sort();
            models.dedup();
            return Ok(models);
        }

        let mut models = policies
            .into_iter()
            .filter(|item| item.enabled)
            .map(|item| item.model_id)
            .collect::<Vec<_>>();
        models.sort();
        models.dedup();
        Ok(models)
    }

    async fn resolve_api_key_group_pricing(
        &self,
        api_key_id: Uuid,
        model: &str,
        base: &BillingPricingResolved,
    ) -> Result<ApiKeyGroupResolvedPricing> {
        let group = self.fetch_api_key_group_for_api_key(api_key_id).await?;
        ensure_api_key_group_is_usable(&group)?;
        let policy = self
            .fetch_api_key_group_policy_for_model(group.id, model)
            .await?;

        let effective_policy = if group.allow_all_models {
            if policy.as_ref().is_some_and(|item| !item.enabled) {
                return Err(anyhow!("model is not allowed for api key group"));
            }
            policy.as_ref().filter(|item| item.enabled)
        } else {
            let Some(item) = policy.as_ref().filter(|item| item.enabled) else {
                return Err(anyhow!("model is not allowed for api key group"));
            };
            Some(item)
        };

        Ok(apply_api_key_group_model_pricing(base, &group, effective_policy))
    }

    pub async fn admin_list_api_key_groups(&self) -> Result<ApiKeyGroupAdminListResponse> {
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                name,
                description,
                is_default,
                enabled,
                allow_all_models,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                deleted_at,
                created_at,
                updated_at
            FROM api_key_groups
            ORDER BY is_default DESC, updated_at DESC, name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list api key groups")?;
        let catalog = self.list_api_key_group_catalog().await?;
        let mut groups = Vec::with_capacity(rows.len());
        for row in rows {
            groups.push(
                self.build_api_key_group_item(parse_api_key_group_record(row)?, &catalog)
                    .await?,
            );
        }
        Ok(ApiKeyGroupAdminListResponse { groups, catalog })
    }

    pub async fn tenant_list_api_key_groups(&self) -> Result<Vec<ApiKeyGroupItem>> {
        let rows = sqlx::query(
            r#"
            SELECT
                id,
                name,
                description,
                is_default,
                enabled,
                allow_all_models,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                deleted_at,
                created_at,
                updated_at
            FROM api_key_groups
            WHERE deleted_at IS NULL AND enabled = true
            ORDER BY is_default DESC, updated_at DESC, name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list tenant api key groups")?;
        let catalog = self.list_api_key_group_catalog().await?;
        let mut groups = Vec::with_capacity(rows.len());
        for row in rows {
            groups.push(
                self.build_api_key_group_item(parse_api_key_group_record(row)?, &catalog)
                    .await?,
            );
        }
        Ok(groups)
    }

    pub async fn admin_upsert_api_key_group(
        &self,
        req: ApiKeyGroupUpsertRequest,
    ) -> Result<ApiKeyGroupItem> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(anyhow!("group name must not be empty"));
        }
        ensure_multiplier_ppm_valid(req.input_multiplier_ppm)?;
        ensure_multiplier_ppm_valid(req.cached_input_multiplier_ppm)?;
        ensure_multiplier_ppm_valid(req.output_multiplier_ppm)?;
        let description = req
            .description
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string);
        let now = Utc::now();
        let id = req.id.unwrap_or_else(Uuid::new_v4);

        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to start api key group upsert transaction")?;

        if req.is_default {
            sqlx::query(
                r#"
                UPDATE api_key_groups
                SET is_default = false, updated_at = $1
                WHERE is_default = true AND id <> $2
                "#,
            )
            .bind(now)
            .bind(id)
            .execute(tx.as_mut())
            .await
            .context("failed to clear previous default api key group")?;
        }

        let row = sqlx::query(
            r#"
            INSERT INTO api_key_groups (
                id,
                name,
                description,
                is_default,
                enabled,
                allow_all_models,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
            ON CONFLICT (id)
            DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                is_default = EXCLUDED.is_default,
                enabled = EXCLUDED.enabled,
                allow_all_models = EXCLUDED.allow_all_models,
                input_multiplier_ppm = EXCLUDED.input_multiplier_ppm,
                cached_input_multiplier_ppm = EXCLUDED.cached_input_multiplier_ppm,
                output_multiplier_ppm = EXCLUDED.output_multiplier_ppm,
                deleted_at = NULL,
                updated_at = EXCLUDED.updated_at
            RETURNING
                id,
                name,
                description,
                is_default,
                enabled,
                allow_all_models,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                deleted_at,
                created_at,
                updated_at
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(req.is_default)
        .bind(req.enabled)
        .bind(req.allow_all_models)
        .bind(req.input_multiplier_ppm)
        .bind(req.cached_input_multiplier_ppm)
        .bind(req.output_multiplier_ppm)
        .bind(now)
        .fetch_one(tx.as_mut())
        .await
        .context("failed to upsert api key group")?;
        tx.commit()
            .await
            .context("failed to commit api key group upsert transaction")?;

        let catalog = self.list_api_key_group_catalog().await?;
        self.build_api_key_group_item(parse_api_key_group_record(row)?, &catalog)
            .await
    }

    pub async fn admin_delete_api_key_group(&self, group_id: Uuid) -> Result<()> {
        let existing = self
            .fetch_api_key_group_record(group_id)
            .await?
            .ok_or_else(|| anyhow!("api key group not found"))?;
        if existing.is_default {
            return Err(anyhow!("default api key group cannot be deleted"));
        }
        sqlx::query(
            r#"
            UPDATE api_key_groups
            SET enabled = false,
                is_default = false,
                deleted_at = $2,
                updated_at = $2
            WHERE id = $1
            "#,
        )
        .bind(group_id)
        .bind(Utc::now())
        .execute(&self.pool)
        .await
        .context("failed to delete api key group")?;
        Ok(())
    }

    pub async fn admin_upsert_api_key_group_model_policy(
        &self,
        req: ApiKeyGroupModelPolicyUpsertRequest,
    ) -> Result<ApiKeyGroupModelPolicyItem> {
        let group = self
            .fetch_api_key_group_record(req.group_id)
            .await?
            .ok_or_else(|| anyhow!("api key group not found"))?;
        ensure_api_key_group_is_usable_for_edit(&group)?;
        let model = req.model.trim();
        if model.is_empty() {
            return Err(anyhow!("model must not be empty"));
        }
        ensure_multiplier_ppm_valid(req.input_multiplier_ppm)?;
        ensure_multiplier_ppm_valid(req.cached_input_multiplier_ppm)?;
        ensure_multiplier_ppm_valid(req.output_multiplier_ppm)?;
        ensure_absolute_pricing_triplet(
            req.input_price_microcredits,
            req.cached_input_price_microcredits,
            req.output_price_microcredits,
        )?;
        let now = Utc::now();
        let row = sqlx::query(
            r#"
            INSERT INTO api_key_group_model_policies (
                id,
                group_id,
                model_id,
                enabled,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
            ON CONFLICT (group_id, model_id)
            DO UPDATE SET
                enabled = EXCLUDED.enabled,
                input_multiplier_ppm = EXCLUDED.input_multiplier_ppm,
                cached_input_multiplier_ppm = EXCLUDED.cached_input_multiplier_ppm,
                output_multiplier_ppm = EXCLUDED.output_multiplier_ppm,
                input_price_microcredits = EXCLUDED.input_price_microcredits,
                cached_input_price_microcredits = EXCLUDED.cached_input_price_microcredits,
                output_price_microcredits = EXCLUDED.output_price_microcredits,
                updated_at = EXCLUDED.updated_at
            RETURNING
                id,
                group_id,
                model_id,
                enabled,
                input_multiplier_ppm,
                cached_input_multiplier_ppm,
                output_multiplier_ppm,
                input_price_microcredits,
                cached_input_price_microcredits,
                output_price_microcredits,
                created_at,
                updated_at
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(req.group_id)
        .bind(model)
        .bind(req.enabled)
        .bind(req.input_multiplier_ppm)
        .bind(req.cached_input_multiplier_ppm)
        .bind(req.output_multiplier_ppm)
        .bind(req.input_price_microcredits)
        .bind(req.cached_input_price_microcredits)
        .bind(req.output_price_microcredits)
        .bind(now)
        .fetch_one(&self.pool)
        .await
        .context("failed to upsert api key group model policy")?;
        Ok(map_policy_record_to_item(
            parse_api_key_group_model_policy_record(row)?,
        ))
    }

    pub async fn admin_delete_api_key_group_model_policy(&self, policy_id: Uuid) -> Result<()> {
        let affected = sqlx::query("DELETE FROM api_key_group_model_policies WHERE id = $1")
            .bind(policy_id)
            .execute(&self.pool)
            .await
            .context("failed to delete api key group model policy")?
            .rows_affected();
        if affected == 0 {
            return Err(anyhow!("api key group model policy not found"));
        }
        Ok(())
    }

    async fn build_api_key_group_item(
        &self,
        group: ApiKeyGroupRecord,
        catalog: &[ApiKeyGroupCatalogItem],
    ) -> Result<ApiKeyGroupItem> {
        let policies = self.list_api_key_group_policy_records(group.id).await?;
        let mut policy_by_model = HashMap::new();
        for policy in &policies {
            policy_by_model.insert(policy.model_id.clone(), policy.clone());
        }
        let api_key_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM api_keys WHERE group_id = $1",
        )
        .bind(group.id)
        .fetch_one(&self.pool)
        .await
        .context("failed to count api keys for group")?;

        let base_models = if group.allow_all_models {
            catalog.to_vec()
        } else {
            catalog
                .iter()
                .filter(|item| {
                    policy_by_model
                        .get(&item.model)
                        .is_some_and(|policy| policy.enabled)
                })
                .cloned()
                .collect::<Vec<_>>()
        };
        let mut models = Vec::with_capacity(base_models.len());
        for item in base_models {
            let policy = policy_by_model.get(&item.model);
            let base_pricing = match (
                item.base_input_price_microcredits,
                item.base_cached_input_price_microcredits,
                item.base_output_price_microcredits,
            ) {
                (Some(input), Some(cached), Some(output)) => Some(BillingPricingResolved {
                    input_price_microcredits: input,
                    cached_input_price_microcredits: cached,
                    output_price_microcredits: output,
                    source: item
                        .base_price_source
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                }),
                _ => None,
            };
            let resolved = base_pricing
                .as_ref()
                .map(|pricing| apply_api_key_group_model_pricing(pricing, &group, policy));
            models.push(ApiKeyGroupModelPreviewItem {
                model: item.model.clone(),
                provider: item.provider.clone(),
                title: item.title.clone(),
                visibility: item.visibility.clone(),
                base_input_price_microcredits: item.base_input_price_microcredits,
                base_cached_input_price_microcredits: item.base_cached_input_price_microcredits,
                base_output_price_microcredits: item.base_output_price_microcredits,
                formula_input_price_microcredits: resolved.as_ref().map(|entry| entry.formula.input_price_microcredits),
                formula_cached_input_price_microcredits: resolved
                    .as_ref()
                    .map(|entry| entry.formula.cached_input_price_microcredits),
                formula_output_price_microcredits: resolved
                    .as_ref()
                    .map(|entry| entry.formula.output_price_microcredits),
                final_input_price_microcredits: resolved
                    .as_ref()
                    .map(|entry| entry.final_pricing.input_price_microcredits),
                final_cached_input_price_microcredits: resolved
                    .as_ref()
                    .map(|entry| entry.final_pricing.cached_input_price_microcredits),
                final_output_price_microcredits: resolved
                    .as_ref()
                    .map(|entry| entry.final_pricing.output_price_microcredits),
                uses_absolute_pricing: resolved
                    .as_ref()
                    .map(|entry| entry.uses_absolute_pricing)
                    .unwrap_or(false),
                policy: policy.cloned().map(map_policy_record_to_item),
            });
        }
        models.sort_by(|left, right| left.model.cmp(&right.model));

        Ok(ApiKeyGroupItem {
            id: group.id,
            name: group.name,
            description: group.description,
            is_default: group.is_default,
            enabled: group.enabled,
            allow_all_models: group.allow_all_models,
            input_multiplier_ppm: group.input_multiplier_ppm,
            cached_input_multiplier_ppm: group.cached_input_multiplier_ppm,
            output_multiplier_ppm: group.output_multiplier_ppm,
            api_key_count,
            model_count: models.len() as i64,
            deleted_at: group.deleted_at,
            policies: policies.into_iter().map(map_policy_record_to_item).collect(),
            models,
            created_at: group.created_at,
            updated_at: group.updated_at,
        })
    }

    async fn list_api_key_group_catalog(&self) -> Result<Vec<ApiKeyGroupCatalogItem>> {
        let official_models = self.admin_list_openai_model_catalog().await?;
        let custom_models = self.admin_list_model_entities().await?;
        let mut by_model = std::collections::BTreeMap::<String, UnifiedModelCatalogEntry>::new();

        for item in official_models {
            by_model.insert(
                item.model_id.clone(),
                UnifiedModelCatalogEntry {
                    model: item.model_id,
                    provider: "openai".to_string(),
                    title: Some(item.title),
                    visibility: None,
                },
            );
        }

        for item in custom_models {
            let entry = by_model
                .entry(item.model.clone())
                .or_insert(UnifiedModelCatalogEntry {
                    model: item.model.clone(),
                    provider: item.provider.clone(),
                    title: None,
                    visibility: item.visibility.clone(),
                });
            entry.provider = item.provider;
            if entry.visibility.is_none() {
                entry.visibility = item.visibility;
            }
        }

        let mut items = Vec::with_capacity(by_model.len());
        for (_, entry) in by_model {
            let base_pricing = self.resolve_base_model_pricing(&entry.model).await.ok();
            items.push(ApiKeyGroupCatalogItem {
                model: entry.model,
                provider: entry.provider,
                title: entry.title,
                visibility: entry.visibility,
                base_input_price_microcredits: base_pricing.as_ref().map(|item| item.input_price_microcredits),
                base_cached_input_price_microcredits: base_pricing
                    .as_ref()
                    .map(|item| item.cached_input_price_microcredits),
                base_output_price_microcredits: base_pricing.as_ref().map(|item| item.output_price_microcredits),
                base_price_source: base_pricing.map(|item| item.source),
            });
        }
        Ok(items)
    }
}

fn parse_api_key_group_record(row: sqlx_postgres::PgRow) -> Result<ApiKeyGroupRecord> {
    Ok(ApiKeyGroupRecord {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        is_default: row.try_get("is_default")?,
        enabled: row.try_get("enabled")?,
        allow_all_models: row.try_get("allow_all_models")?,
        input_multiplier_ppm: row.try_get("input_multiplier_ppm")?,
        cached_input_multiplier_ppm: row.try_get("cached_input_multiplier_ppm")?,
        output_multiplier_ppm: row.try_get("output_multiplier_ppm")?,
        deleted_at: row.try_get("deleted_at")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn parse_api_key_group_model_policy_record(
    row: sqlx_postgres::PgRow,
) -> Result<ApiKeyGroupModelPolicyRecord> {
    Ok(ApiKeyGroupModelPolicyRecord {
        id: row.try_get("id")?,
        _group_id: row.try_get("group_id")?,
        model_id: row.try_get("model_id")?,
        enabled: row.try_get("enabled")?,
        input_multiplier_ppm: row.try_get("input_multiplier_ppm")?,
        cached_input_multiplier_ppm: row.try_get("cached_input_multiplier_ppm")?,
        output_multiplier_ppm: row.try_get("output_multiplier_ppm")?,
        input_price_microcredits: row.try_get("input_price_microcredits")?,
        cached_input_price_microcredits: row.try_get("cached_input_price_microcredits")?,
        output_price_microcredits: row.try_get("output_price_microcredits")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn map_policy_record_to_item(record: ApiKeyGroupModelPolicyRecord) -> ApiKeyGroupModelPolicyItem {
    ApiKeyGroupModelPolicyItem {
        id: record.id,
        model: record.model_id,
        enabled: record.enabled,
        input_multiplier_ppm: record.input_multiplier_ppm,
        cached_input_multiplier_ppm: record.cached_input_multiplier_ppm,
        output_multiplier_ppm: record.output_multiplier_ppm,
        input_price_microcredits: record.input_price_microcredits,
        cached_input_price_microcredits: record.cached_input_price_microcredits,
        output_price_microcredits: record.output_price_microcredits,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn ensure_api_key_group_is_usable(group: &ApiKeyGroupRecord) -> Result<()> {
    if group.deleted_at.is_some() || !group.enabled {
        return Err(anyhow!("api key group is unavailable"));
    }
    Ok(())
}

fn ensure_api_key_group_is_usable_for_edit(group: &ApiKeyGroupRecord) -> Result<()> {
    if group.deleted_at.is_some() {
        return Err(anyhow!("api key group is deleted"));
    }
    Ok(())
}

fn ensure_multiplier_ppm_valid(value: i64) -> Result<()> {
    if value < 0 {
        return Err(anyhow!("multiplier ppm must be non-negative"));
    }
    Ok(())
}

fn ensure_absolute_pricing_triplet(
    input: Option<i64>,
    cached_input: Option<i64>,
    output: Option<i64>,
) -> Result<()> {
    let count = [input, cached_input, output]
        .into_iter()
        .filter(Option::is_some)
        .count();
    if count != 0 && count != 3 {
        return Err(anyhow!(
            "group model absolute pricing requires input, cached_input, and output together"
        ));
    }
    if [input, cached_input, output]
        .into_iter()
        .flatten()
        .any(|value| value < 0)
    {
        return Err(anyhow!("absolute pricing must be non-negative"));
    }
    Ok(())
}
