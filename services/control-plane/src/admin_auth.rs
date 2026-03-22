#![cfg_attr(
    not(feature = "postgres-backend"),
    allow(dead_code, unreachable_code, unused_imports)
)]

use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use bcrypt::{hash, verify, DEFAULT_COST};
use chrono::Utc;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::contracts::{AdminLoginRequest, AdminLoginResponse, AdminMeResponse};
#[cfg(feature = "postgres-backend")]
use crate::store::PgPool;

const DEFAULT_TOKEN_TTL_SEC: u64 = 8 * 60 * 60;

#[derive(Debug, Clone)]
pub struct AdminPrincipal {
    pub user_id: Uuid,
    pub username: String,
}

#[derive(Clone)]
enum AdminCredentialBackend {
    Static {
        user_id: Uuid,
        username: String,
        password_hash: String,
    },
    #[cfg(feature = "postgres-backend")]
    Postgres { pool: PgPool },
}

#[derive(Clone)]
pub struct AdminAuthService {
    credential_backend: AdminCredentialBackend,
    bootstrap_username: Option<String>,
    bootstrap_password_hash: Option<String>,
    token_ttl_sec: u64,
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AdminClaims {
    sub: String,
    username: String,
    iat: u64,
    exp: u64,
}

impl AdminAuthService {
    pub fn from_env() -> Result<Self> {
        let settings = load_admin_settings_from_env()?;

        Ok(Self {
            credential_backend: AdminCredentialBackend::Static {
                user_id: Uuid::new_v4(),
                username: settings.username,
                password_hash: settings.password_hash,
            },
            bootstrap_username: None,
            bootstrap_password_hash: None,
            token_ttl_sec: settings.token_ttl_sec,
            encoding_key: EncodingKey::from_secret(settings.jwt_secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(settings.jwt_secret.as_bytes()),
        })
    }

    #[cfg(feature = "postgres-backend")]
    pub fn from_env_with_postgres(pool: PgPool) -> Result<Self> {
        let settings = load_admin_settings_from_env()?;
        Ok(Self {
            credential_backend: AdminCredentialBackend::Postgres { pool },
            bootstrap_username: Some(settings.username),
            bootstrap_password_hash: Some(settings.password_hash),
            token_ttl_sec: settings.token_ttl_sec,
            encoding_key: EncodingKey::from_secret(settings.jwt_secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(settings.jwt_secret.as_bytes()),
        })
    }

    pub async fn ensure_bootstrap_admin_user(&self) -> Result<()> {
        #[cfg(not(feature = "postgres-backend"))]
        {
            return Ok(());
        }

        #[cfg(feature = "postgres-backend")]
        let AdminCredentialBackend::Postgres { pool } = &self.credential_backend
        else {
            return Ok(());
        };
        #[cfg(feature = "postgres-backend")]
        let Some(username) = self.bootstrap_username.as_deref() else {
            return Ok(());
        };
        #[cfg(feature = "postgres-backend")]
        let Some(password_hash) = self.bootstrap_password_hash.as_deref() else {
            return Ok(());
        };

        #[cfg(feature = "postgres-backend")]
        sqlx::query(
            r#"
            INSERT INTO admin_users (id, username, password_hash, enabled, created_at, updated_at)
            VALUES ($1, $2, $3, true, $4, $4)
            ON CONFLICT (username) DO NOTHING
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(username)
        .bind(password_hash)
        .bind(Utc::now())
        .execute(pool)
        .await
        .context("failed to bootstrap admin user")?;

        Ok(())
    }

    pub async fn login(&self, req: AdminLoginRequest) -> Result<Option<AdminLoginResponse>> {
        let principal = self.verify_login_credentials(req).await?;
        let Some(principal) = principal else {
            return Ok(None);
        };
        let now = current_ts_sec()?;
        let claims = AdminClaims {
            sub: principal.user_id.to_string(),
            username: principal.username,
            iat: now,
            exp: now.saturating_add(self.token_ttl_sec),
        };
        let token = encode(&Header::default(), &claims, &self.encoding_key)
            .context("failed to sign admin jwt")?;

        Ok(Some(AdminLoginResponse {
            access_token: token,
            token_type: "Bearer".to_string(),
            expires_in: self.token_ttl_sec,
        }))
    }

    async fn verify_login_credentials(
        &self,
        req: AdminLoginRequest,
    ) -> Result<Option<AdminPrincipal>> {
        let AdminLoginRequest { username, password } = req;

        match &self.credential_backend {
            AdminCredentialBackend::Static {
                user_id,
                username: target_username,
                password_hash,
            } => {
                if username != *target_username {
                    return Ok(None);
                }

                if !verify(password, password_hash).context("failed to verify admin password")? {
                    return Ok(None);
                }

                Ok(Some(AdminPrincipal {
                    user_id: *user_id,
                    username: target_username.clone(),
                }))
            }
            #[cfg(feature = "postgres-backend")]
            AdminCredentialBackend::Postgres { pool } => {
                let row = sqlx::query(
                    r#"
                    SELECT id, username, password_hash, enabled
                    FROM admin_users
                    WHERE username = $1
                    "#,
                )
                .bind(username)
                .fetch_optional(pool)
                .await
                .context("failed to query admin user")?;

                let Some(row) = row else {
                    return Ok(None);
                };

                let enabled: bool = row.try_get("enabled")?;
                if !enabled {
                    return Ok(None);
                }

                let password_hash: String = row.try_get("password_hash")?;
                if !verify(password, &password_hash).context("failed to verify admin password")? {
                    return Ok(None);
                }

                Ok(Some(AdminPrincipal {
                    user_id: row.try_get("id")?,
                    username: row.try_get("username")?,
                }))
            }
        }
    }

    pub fn me(&self, principal: &AdminPrincipal) -> AdminMeResponse {
        AdminMeResponse {
            user_id: principal.user_id,
            username: principal.username.clone(),
        }
    }

    pub fn verify_bearer_header(&self, authorization: Option<&str>) -> Result<AdminPrincipal> {
        let header = authorization.ok_or_else(|| anyhow!("missing authorization header"))?;
        let token = header
            .strip_prefix("Bearer ")
            .or_else(|| header.strip_prefix("bearer "))
            .ok_or_else(|| anyhow!("invalid authorization header"))?;

        self.verify_token(token)
    }

    pub fn verify_token(&self, token: &str) -> Result<AdminPrincipal> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = true;
        let data = decode::<AdminClaims>(token, &self.decoding_key, &validation)
            .context("failed to decode admin jwt")?;
        let user_id = Uuid::parse_str(&data.claims.sub).context("invalid admin user id in jwt")?;

        Ok(AdminPrincipal {
            user_id,
            username: data.claims.username,
        })
    }
}

fn current_ts_sec() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock before unix epoch")?
        .as_secs())
}

struct AdminAuthSettings {
    username: String,
    password_hash: String,
    jwt_secret: String,
    token_ttl_sec: u64,
}

fn load_admin_settings_from_env() -> Result<AdminAuthSettings> {
    let username = required_non_empty_env("ADMIN_USERNAME")?;
    let password = required_non_empty_env("ADMIN_PASSWORD")?;
    let jwt_secret = required_non_empty_env("ADMIN_JWT_SECRET")?;
    let token_ttl_sec = std::env::var("ADMIN_JWT_TTL_SEC")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_TOKEN_TTL_SEC);

    let password_hash = hash(password, DEFAULT_COST).context("failed to hash admin password")?;

    Ok(AdminAuthSettings {
        username,
        password_hash,
        jwt_secret,
        token_ttl_sec,
    })
}

fn required_non_empty_env(key: &str) -> Result<String> {
    let value = std::env::var(key)
        .with_context(|| format!("{key} is required and must be set in environment"))?;
    let value = value.trim();
    if value.is_empty() {
        return Err(anyhow!("{key} is required and must not be empty"));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::AdminAuthService;
    use crate::test_support::{set_env, ENV_LOCK};

    #[test]
    fn from_env_fails_when_admin_username_missing() {
        let _guard = ENV_LOCK.blocking_lock();
        let old_username = set_env("ADMIN_USERNAME", None);
        let old_password = set_env("ADMIN_PASSWORD", Some("test-password"));
        let old_secret = set_env("ADMIN_JWT_SECRET", Some("test-jwt-secret"));

        let result = AdminAuthService::from_env();
        assert!(result.is_err());

        set_env("ADMIN_USERNAME", old_username.as_deref());
        set_env("ADMIN_PASSWORD", old_password.as_deref());
        set_env("ADMIN_JWT_SECRET", old_secret.as_deref());
    }
}
