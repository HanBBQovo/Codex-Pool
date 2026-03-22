use codex_pool_core::api::{
    BillingMode as BillingRuntimeMode, ProductEdition, SystemCapabilitiesResponse,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeploymentShape {
    SingleBinary,
    MultiService,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreBackendFamily {
    InMemory,
    Sqlite,
    Postgres,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageQueryBackendFamily {
    None,
    Sqlite,
    Postgres,
    ClickHouse,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsageIngestBackendFamily {
    None,
    Sqlite,
    Postgres,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendProfile {
    pub edition: ProductEdition,
    pub deployment_shape: DeploymentShape,
    pub store_backend: StoreBackendFamily,
    pub usage_query_backend: UsageQueryBackendFamily,
    pub usage_ingest_backend: UsageIngestBackendFamily,
    pub billing_mode: BillingRuntimeMode,
}

impl BackendProfile {
    pub fn system_capabilities(self) -> SystemCapabilitiesResponse {
        SystemCapabilitiesResponse::for_edition(self.edition)
    }

    pub fn uses_single_binary_merge(self) -> bool {
        matches!(self.deployment_shape, DeploymentShape::SingleBinary)
    }

    pub fn allows_tenant_self_service(self) -> bool {
        self.system_capabilities().allows_tenant_self_service()
    }

    pub fn billing_reconcile_enabled(self) -> bool {
        matches!(self.billing_mode, BillingRuntimeMode::CreditEnforced)
    }
}

pub fn resolve_backend_profile(
    edition: ProductEdition,
    database_configured: bool,
    clickhouse_configured: bool,
) -> BackendProfile {
    match edition {
        ProductEdition::Personal => BackendProfile {
            edition,
            deployment_shape: DeploymentShape::SingleBinary,
            store_backend: StoreBackendFamily::Sqlite,
            usage_query_backend: UsageQueryBackendFamily::Sqlite,
            usage_ingest_backend: UsageIngestBackendFamily::Sqlite,
            billing_mode: BillingRuntimeMode::CostReportOnly,
        },
        ProductEdition::Team => BackendProfile {
            edition,
            deployment_shape: DeploymentShape::SingleBinary,
            store_backend: if database_configured {
                StoreBackendFamily::Postgres
            } else {
                StoreBackendFamily::InMemory
            },
            usage_query_backend: if database_configured {
                UsageQueryBackendFamily::Postgres
            } else {
                UsageQueryBackendFamily::None
            },
            usage_ingest_backend: if database_configured {
                UsageIngestBackendFamily::Postgres
            } else {
                UsageIngestBackendFamily::None
            },
            billing_mode: BillingRuntimeMode::CostReportOnly,
        },
        ProductEdition::Business => BackendProfile {
            edition,
            deployment_shape: DeploymentShape::MultiService,
            store_backend: if database_configured {
                StoreBackendFamily::Postgres
            } else {
                StoreBackendFamily::InMemory
            },
            usage_query_backend: if clickhouse_configured {
                UsageQueryBackendFamily::ClickHouse
            } else {
                UsageQueryBackendFamily::None
            },
            usage_ingest_backend: UsageIngestBackendFamily::None,
            billing_mode: BillingRuntimeMode::CreditEnforced,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_backend_profile, BillingRuntimeMode, DeploymentShape, StoreBackendFamily,
        UsageIngestBackendFamily, UsageQueryBackendFamily,
    };
    use codex_pool_core::api::ProductEdition;

    #[test]
    fn team_profile_falls_back_to_in_memory_without_database_url() {
        let profile = resolve_backend_profile(ProductEdition::Team, false, false);
        assert_eq!(profile.deployment_shape, DeploymentShape::SingleBinary);
        assert_eq!(profile.store_backend, StoreBackendFamily::InMemory);
        assert_eq!(profile.usage_query_backend, UsageQueryBackendFamily::None);
        assert_eq!(profile.usage_ingest_backend, UsageIngestBackendFamily::None);
        assert_eq!(profile.billing_mode, BillingRuntimeMode::CostReportOnly);
    }

    #[test]
    fn business_profile_only_enables_clickhouse_queries_when_configured() {
        let without_clickhouse = resolve_backend_profile(ProductEdition::Business, true, false);
        assert_eq!(
            without_clickhouse.usage_query_backend,
            UsageQueryBackendFamily::None
        );

        let with_clickhouse = resolve_backend_profile(ProductEdition::Business, true, true);
        assert_eq!(
            with_clickhouse.usage_query_backend,
            UsageQueryBackendFamily::ClickHouse
        );
        assert_eq!(
            with_clickhouse.billing_mode,
            BillingRuntimeMode::CreditEnforced
        );
    }
}
