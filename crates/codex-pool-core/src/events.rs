use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestLogEvent {
    pub id: Uuid,
    pub account_id: Uuid,
    pub tenant_id: Option<Uuid>,
    pub api_key_id: Option<Uuid>,
    #[serde(default = "default_request_log_event_version")]
    pub event_version: u16,
    pub path: String,
    pub method: String,
    pub status_code: u16,
    pub latency_ms: u64,
    pub is_stream: bool,
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_input_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_token_latency_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub billing_phase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture_status: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthEvent {
    pub id: Uuid,
    pub account_id: Uuid,
    pub healthy: bool,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SystemEventCategory {
    Request,
    AccountPool,
    Patrol,
    Import,
    Infra,
    AdminAction,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SystemEventSeverity {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SystemEventWrite {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ts: Option<DateTime<Utc>>,
    pub category: SystemEventCategory,
    pub event_type: String,
    pub severity: SystemEventSeverity,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator_state_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator_state_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason_class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_action_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_account_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_proxy_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routing_decision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failover_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_status_code: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload_json: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret_preview: Option<String>,
}

fn default_request_log_event_version() -> u16 {
    1
}

#[cfg(test)]
mod tests {
    use super::RequestLogEvent;
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn request_log_event_serializes_identity_fields() {
        let event = RequestLogEvent {
            id: Uuid::new_v4(),
            account_id: Uuid::new_v4(),
            tenant_id: Some(Uuid::new_v4()),
            api_key_id: Some(Uuid::new_v4()),
            event_version: 2,
            path: "/v1/chat/completions".to_string(),
            method: "POST".to_string(),
            status_code: 200,
            latency_ms: 12,
            is_stream: false,
            error_code: None,
            request_id: Some("req-1".to_string()),
            model: Some("gpt-5.3-codex".to_string()),
            service_tier: Some("priority".to_string()),
            input_tokens: Some(123),
            cached_input_tokens: Some(0),
            output_tokens: Some(456),
            reasoning_tokens: Some(12),
            first_token_latency_ms: Some(28),
            billing_phase: Some("captured".to_string()),
            authorization_id: Some(Uuid::new_v4()),
            capture_status: Some("captured".to_string()),
            created_at: Utc::now(),
        };

        let json = serde_json::to_value(&event).unwrap();
        assert!(json.get("tenant_id").is_some());
        assert!(json.get("api_key_id").is_some());
        assert_eq!(json["event_version"], 2);
    }
}
