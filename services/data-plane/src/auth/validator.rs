use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Context;
use codex_pool_core::api::{ValidateApiKeyRequest, ValidateApiKeyResponse};
use tokio::sync::RwLock;

use super::ApiPrincipal;

#[derive(Clone)]
pub struct AuthValidatorClient {
    http_client: reqwest::Client,
    validate_url: String,
    internal_auth_token: String,
    default_cache_ttl: Duration,
    default_negative_cache_ttl: Duration,
    cache: Arc<RwLock<HashMap<String, CachedPrincipal>>>,
    negative_cache: Arc<RwLock<HashMap<String, Instant>>>,
    stats: Arc<AuthValidatorStats>,
}

#[derive(Clone)]
struct CachedPrincipal {
    principal: ApiPrincipal,
    expires_at: Instant,
}

struct AuthValidatorStats {
    cache_hit_count: AtomicU64,
    cache_miss_count: AtomicU64,
    remote_validate_count: AtomicU64,
    negative_cache_hit_count: AtomicU64,
    negative_cache_store_count: AtomicU64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AuthCacheStatsSnapshot {
    pub cache_hit_count: u64,
    pub cache_miss_count: u64,
    pub remote_validate_count: u64,
    pub negative_cache_hit_count: u64,
    pub negative_cache_store_count: u64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct AuthCacheEvictResult {
    pub positive_evicted: bool,
    pub negative_evicted: bool,
}

impl AuthCacheEvictResult {
    pub fn evicted(self) -> bool {
        self.positive_evicted || self.negative_evicted
    }
}

#[derive(Debug, Clone)]
pub enum AuthCacheLookupResult {
    PositiveHit(Box<ApiPrincipal>),
    NegativeHit,
    Miss,
}

impl AuthValidatorClient {
    pub fn new(
        validate_url: impl Into<String>,
        default_cache_ttl_sec: u64,
        default_negative_cache_ttl_sec: u64,
        internal_auth_token: String,
    ) -> Self {
        Self {
            http_client: reqwest::Client::new(),
            validate_url: validate_url.into(),
            internal_auth_token,
            default_cache_ttl: Duration::from_secs(default_cache_ttl_sec.max(1)),
            default_negative_cache_ttl: Duration::from_secs(default_negative_cache_ttl_sec),
            cache: Arc::new(RwLock::new(HashMap::new())),
            negative_cache: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(AuthValidatorStats {
                cache_hit_count: AtomicU64::new(0),
                cache_miss_count: AtomicU64::new(0),
                remote_validate_count: AtomicU64::new(0),
                negative_cache_hit_count: AtomicU64::new(0),
                negative_cache_store_count: AtomicU64::new(0),
            }),
        }
    }

    pub async fn validate(&self, token: &str) -> anyhow::Result<Option<ApiPrincipal>> {
        let cache_key = hash_api_key_token(token);
        if let Some(principal) = self.get_cached_principal(&cache_key).await {
            self.stats.cache_hit_count.fetch_add(1, Ordering::Relaxed);
            return Ok(Some(principal));
        }
        if self.is_cached_unauthorized(&cache_key).await {
            self.stats
                .negative_cache_hit_count
                .fetch_add(1, Ordering::Relaxed);
            return Ok(None);
        }

        self.stats.cache_miss_count.fetch_add(1, Ordering::Relaxed);
        self.stats
            .remote_validate_count
            .fetch_add(1, Ordering::Relaxed);
        let response = self
            .http_client
            .post(&self.validate_url)
            .bearer_auth(&self.internal_auth_token)
            .json(&ValidateApiKeyRequest {
                token: token.to_string(),
            })
            .send()
            .await
            .context("failed to call auth validation api")?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.insert_negative_cache(&cache_key).await;
            self.stats
                .negative_cache_store_count
                .fetch_add(1, Ordering::Relaxed);
            return Ok(None);
        }

        let response = response
            .error_for_status()
            .context("auth validation api returned unexpected status")?;
        let payload: ValidateApiKeyResponse = response
            .json()
            .await
            .context("failed to parse auth validation response")?;
        let principal = ApiPrincipal {
            token: token.to_string(),
            tenant_id: Some(payload.tenant_id),
            api_key_id: Some(payload.api_key_id),
            api_key_group_id: Some(payload.group.id),
            api_key_group_name: Some(payload.group.name),
            api_key_group_invalid: payload.group.invalid,
            enabled: payload.enabled,
            key_ip_allowlist: payload.policy.ip_allowlist,
            key_model_allowlist: payload.policy.model_allowlist,
            tenant_status: payload.tenant_status,
            tenant_expires_at: payload.tenant_expires_at,
            balance_microcredits: payload.balance_microcredits,
        };

        self.insert_cache(&cache_key, principal.clone(), payload.cache_ttl_sec)
            .await;
        Ok(Some(principal))
    }

    pub async fn cached_principal_total(&self) -> usize {
        let now = Instant::now();
        let mut cache = self.cache.write().await;
        cache.retain(|_, cached| cached.expires_at > now);
        cache.len()
    }

    pub async fn cached_negative_total(&self) -> usize {
        let now = Instant::now();
        let mut negative_cache = self.negative_cache.write().await;
        negative_cache.retain(|_, expires_at| *expires_at > now);
        negative_cache.len()
    }

    pub async fn clear_cache(&self) -> usize {
        let mut cache = self.cache.write().await;
        let cleared = cache.len();
        cache.clear();
        self.negative_cache.write().await.clear();
        cleared
    }

    pub async fn evict_token(&self, token: &str) -> AuthCacheEvictResult {
        let cache_key = hash_api_key_token(token);
        let now = Instant::now();
        let mut cache = self.cache.write().await;
        if cache
            .get(&cache_key)
            .is_some_and(|cached| cached.expires_at <= now)
        {
            cache.remove(&cache_key);
        }

        let positive_removed = cache.remove(&cache_key).is_some();

        let mut negative_cache = self.negative_cache.write().await;
        if negative_cache
            .get(&cache_key)
            .is_some_and(|expires_at| *expires_at <= now)
        {
            negative_cache.remove(&cache_key);
        }

        let negative_removed = negative_cache.remove(&cache_key).is_some();
        AuthCacheEvictResult {
            positive_evicted: positive_removed,
            negative_evicted: negative_removed,
        }
    }

    pub async fn lookup_cached_token(&self, token: &str) -> AuthCacheLookupResult {
        let cache_key = hash_api_key_token(token);
        if let Some(principal) = self.get_cached_principal(&cache_key).await {
            return AuthCacheLookupResult::PositiveHit(Box::new(principal));
        }

        if self.is_cached_unauthorized(&cache_key).await {
            return AuthCacheLookupResult::NegativeHit;
        }

        AuthCacheLookupResult::Miss
    }

    pub fn cache_stats(&self) -> AuthCacheStatsSnapshot {
        AuthCacheStatsSnapshot {
            cache_hit_count: self.stats.cache_hit_count.load(Ordering::Relaxed),
            cache_miss_count: self.stats.cache_miss_count.load(Ordering::Relaxed),
            remote_validate_count: self.stats.remote_validate_count.load(Ordering::Relaxed),
            negative_cache_hit_count: self.stats.negative_cache_hit_count.load(Ordering::Relaxed),
            negative_cache_store_count: self
                .stats
                .negative_cache_store_count
                .load(Ordering::Relaxed),
        }
    }

    pub fn reset_cache_stats(&self) -> AuthCacheStatsSnapshot {
        AuthCacheStatsSnapshot {
            cache_hit_count: self.stats.cache_hit_count.swap(0, Ordering::Relaxed),
            cache_miss_count: self.stats.cache_miss_count.swap(0, Ordering::Relaxed),
            remote_validate_count: self.stats.remote_validate_count.swap(0, Ordering::Relaxed),
            negative_cache_hit_count: self
                .stats
                .negative_cache_hit_count
                .swap(0, Ordering::Relaxed),
            negative_cache_store_count: self
                .stats
                .negative_cache_store_count
                .swap(0, Ordering::Relaxed),
        }
    }

    async fn get_cached_principal(&self, cache_key: &str) -> Option<ApiPrincipal> {
        let now = Instant::now();
        if let Some(cached) = self.cache.read().await.get(cache_key) {
            if cached.expires_at > now {
                return Some(cached.principal.clone());
            }
        }

        let mut cache = self.cache.write().await;
        if cache
            .get(cache_key)
            .is_some_and(|cached| cached.expires_at <= now)
        {
            cache.remove(cache_key);
        }

        None
    }

    async fn is_cached_unauthorized(&self, cache_key: &str) -> bool {
        let now = Instant::now();
        if let Some(expires_at) = self.negative_cache.read().await.get(cache_key).copied() {
            if expires_at > now {
                return true;
            }
        }

        let mut negative_cache = self.negative_cache.write().await;
        if negative_cache
            .get(cache_key)
            .is_some_and(|expires_at| *expires_at <= now)
        {
            negative_cache.remove(cache_key);
        }

        false
    }

    async fn insert_cache(&self, cache_key: &str, principal: ApiPrincipal, cache_ttl_sec: u64) {
        let ttl = if cache_ttl_sec == 0 {
            self.default_cache_ttl
        } else {
            Duration::from_secs(cache_ttl_sec)
        };
        self.cache.write().await.insert(
            cache_key.to_string(),
            CachedPrincipal {
                principal,
                expires_at: Instant::now() + ttl,
            },
        );
    }

    async fn insert_negative_cache(&self, cache_key: &str) {
        if self.default_negative_cache_ttl.is_zero() {
            return;
        }

        self.negative_cache.write().await.insert(
            cache_key.to_string(),
            Instant::now() + self.default_negative_cache_ttl,
        );
    }
}

fn hash_api_key_token(token: &str) -> String {
    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}
