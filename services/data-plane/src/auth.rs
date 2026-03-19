use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use chrono::{DateTime, Utc};
use codex_pool_core::api::ErrorEnvelope;
use tracing::warn;
use uuid::Uuid;

use crate::app::AppState;

pub mod validator;

#[derive(Debug, Clone)]
pub struct ApiPrincipal {
    pub token: String,
    pub tenant_id: Option<Uuid>,
    pub api_key_id: Option<Uuid>,
    pub api_key_group_id: Option<Uuid>,
    pub api_key_group_name: Option<String>,
    pub api_key_group_invalid: bool,
    pub enabled: bool,
    pub key_ip_allowlist: Vec<String>,
    pub key_model_allowlist: Vec<String>,
    pub tenant_status: Option<String>,
    pub tenant_expires_at: Option<DateTime<Utc>>,
    pub balance_microcredits: Option<i64>,
}

fn auth_error_response(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (status, Json(ErrorEnvelope::new(code, message))).into_response()
}

pub async fn require_api_key(
    State(state): State<Arc<AppState>>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, Response> {
    if let Some(auth_validator) = state.auth_validator.as_ref() {
        let token = extract_bearer(req.headers()).ok_or_else(|| {
            auth_error_response(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing or invalid bearer token",
            )
        })?;
        let principal = match auth_validator.validate(&token).await {
            Ok(Some(principal)) => principal,
            Ok(None) => {
                return Err(auth_error_response(
                    StatusCode::UNAUTHORIZED,
                    "unauthorized",
                    "api key is unauthorized",
                ));
            }
            Err(err) => {
                warn!(error = %err, "online api key validation failed");
                if state.auth_fail_open && is_fail_open_eligible(&err) {
                    warn!("falling back to local auth mode after validator failure");
                    return authorize_with_local_mode(req, next, &state, Some(token)).await;
                }
                return Err(auth_error_response(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "service_unavailable",
                    "auth validator is unavailable",
                ));
            }
        };
        if !principal.enabled {
            return Err(auth_error_response(
                StatusCode::FORBIDDEN,
                "forbidden",
                "api key is disabled",
            ));
        }

        req.extensions_mut().insert(principal);
        return Ok(next.run(req).await);
    }

    authorize_with_local_mode(req, next, &state, None).await
}

pub async fn require_internal_service_token(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, Response> {
    let token = extract_bearer(req.headers()).ok_or_else(|| {
        auth_error_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "missing or invalid bearer token",
        )
    })?;

    if token != state.control_plane_internal_auth_token.as_ref() {
        return Err(auth_error_response(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "internal bearer token is unauthorized",
        ));
    }

    Ok(next.run(req).await)
}

async fn authorize_with_local_mode(
    mut req: Request<Body>,
    next: Next,
    state: &AppState,
    token: Option<String>,
) -> Result<Response, Response> {
    if state.allowed_api_keys.is_empty() {
        return Ok(next.run(req).await);
    }

    let token = match token {
        Some(token) => token,
        None => extract_bearer(req.headers()).ok_or_else(|| {
            auth_error_response(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "missing or invalid bearer token",
            )
        })?,
    };
    if !state.allowed_api_keys.contains(&token) {
        return Err(auth_error_response(
            StatusCode::FORBIDDEN,
            "forbidden",
            "api key is not allowed",
        ));
    }

    req.extensions_mut().insert(ApiPrincipal {
        token,
        tenant_id: None,
        api_key_id: None,
        api_key_group_id: None,
        api_key_group_name: None,
        api_key_group_invalid: false,
        enabled: true,
        key_ip_allowlist: Vec::new(),
        key_model_allowlist: Vec::new(),
        tenant_status: None,
        tenant_expires_at: None,
        balance_microcredits: None,
    });
    Ok(next.run(req).await)
}

fn is_fail_open_eligible(error: &anyhow::Error) -> bool {
    error
        .chain()
        .find_map(|cause| cause.downcast_ref::<reqwest::Error>())
        .is_some_and(|reqwest_error| {
            reqwest_error.is_connect()
                || reqwest_error.is_timeout()
                || reqwest_error.is_request()
                || reqwest_error
                    .status()
                    .is_some_and(|status| status.is_server_error())
        })
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))?;
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

#[cfg(test)]
mod tests {
    use super::extract_bearer;
    use axum::http::header::AUTHORIZATION;
    use axum::http::HeaderMap;

    #[test]
    fn extracts_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, "Bearer cp_test_key".parse().unwrap());

        assert_eq!(extract_bearer(&headers).as_deref(), Some("cp_test_key"));
    }
}
