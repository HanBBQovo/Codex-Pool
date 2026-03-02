fn trim_ascii(raw: &[u8]) -> &[u8] {
    let mut start = 0usize;
    while start < raw.len() && raw[start].is_ascii_whitespace() {
        start += 1;
    }
    let mut end = raw.len();
    while end > start && raw[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    &raw[start..end]
}

fn response_with_bytes(status: StatusCode, headers: &HeaderMap, body: bytes::Bytes) -> Response {
    response_with_body(status, headers, Body::from(body))
}

fn response_with_body(status: StatusCode, headers: &HeaderMap, body: Body) -> Response {
    let mut response = Response::builder().status(status);
    if let Some(target_headers) = response.headers_mut() {
        for (name, value) in headers {
            if is_hop_by_hop_header(name) || *name == CONTENT_LENGTH {
                continue;
            }
            target_headers.insert(name, value.clone());
        }
    }

    response
        .body(body)
        .unwrap_or_else(|_| Response::new(Body::from("internal response error")))
}

#[derive(Debug)]
struct UpstreamWebSocketClose {
    code: u16,
    reason: String,
}

#[derive(Debug)]
enum ProxyWebSocketStreamError {
    UpstreamClosed(UpstreamWebSocketClose),
}

impl std::fmt::Display for ProxyWebSocketStreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UpstreamClosed(close) => {
                write!(f, "upstream websocket closed code={} reason={}", close.code, close.reason)
            }
        }
    }
}

impl std::error::Error for ProxyWebSocketStreamError {}

async fn proxy_websocket_streams(
    downstream_socket: WebSocket,
    upstream_socket: UpstreamWebSocket,
) -> Result<(), ProxyWebSocketStreamError> {
    let (mut downstream_sender, mut downstream_receiver) = downstream_socket.split();
    let (mut upstream_sender, mut upstream_receiver) = upstream_socket.split();

    let downstream_to_upstream = async {
        while let Some(message) = downstream_receiver.next().await {
            let Ok(message) = message else {
                break;
            };
            let should_close = matches!(message, AxumWsMessage::Close(_));
            if upstream_sender
                .send(axum_message_to_tungstenite(message))
                .await
                .is_err()
            {
                break;
            }
            if should_close {
                break;
            }
        }
        let _ = upstream_sender.close().await;
        Ok::<(), ProxyWebSocketStreamError>(())
    };

    let upstream_to_downstream = async {
        let mut upstream_close: Option<UpstreamWebSocketClose> = None;
        while let Some(message) = upstream_receiver.next().await {
            let Ok(message) = message else {
                break;
            };
            let should_close = matches!(message, TungsteniteMessage::Close(_));
            if let TungsteniteMessage::Close(frame) = &message {
                let close = frame
                    .as_ref()
                    .map(|frame| UpstreamWebSocketClose {
                        code: u16::from(frame.code),
                        reason: frame.reason.to_string(),
                    })
                    .unwrap_or_else(|| UpstreamWebSocketClose {
                        code: 1000,
                        reason: String::new(),
                    });
                upstream_close = Some(close);
            }
            if let Some(mapped) = tungstenite_message_to_axum(message) {
                if downstream_sender.send(mapped).await.is_err() {
                    break;
                }
            }
            if should_close {
                break;
            }
        }
        let _ = downstream_sender.close().await;
        if let Some(close) = upstream_close {
            return Err(ProxyWebSocketStreamError::UpstreamClosed(close));
        }
        Ok::<(), ProxyWebSocketStreamError>(())
    };

    let (downstream_to_upstream_result, upstream_to_downstream_result) =
        tokio::join!(downstream_to_upstream, upstream_to_downstream);
    if let Err(err) = downstream_to_upstream_result {
        return Err(err);
    }
    if let Err(err) = upstream_to_downstream_result {
        return Err(err);
    }

    Ok(())
}

fn axum_message_to_tungstenite(message: AxumWsMessage) -> TungsteniteMessage {
    match message {
        AxumWsMessage::Text(text) => TungsteniteMessage::Text(text.to_string().into()),
        AxumWsMessage::Binary(bytes) => TungsteniteMessage::Binary(bytes),
        AxumWsMessage::Ping(payload) => TungsteniteMessage::Ping(payload),
        AxumWsMessage::Pong(payload) => TungsteniteMessage::Pong(payload),
        AxumWsMessage::Close(frame) => {
            TungsteniteMessage::Close(frame.map(axum_close_frame_to_tungstenite))
        }
    }
}

fn tungstenite_message_to_axum(message: TungsteniteMessage) -> Option<AxumWsMessage> {
    match message {
        TungsteniteMessage::Text(text) => Some(AxumWsMessage::Text(text.to_string().into())),
        TungsteniteMessage::Binary(bytes) => Some(AxumWsMessage::Binary(bytes)),
        TungsteniteMessage::Ping(payload) => Some(AxumWsMessage::Ping(payload)),
        TungsteniteMessage::Pong(payload) => Some(AxumWsMessage::Pong(payload)),
        TungsteniteMessage::Close(frame) => Some(AxumWsMessage::Close(
            frame.map(tungstenite_close_frame_to_axum),
        )),
        TungsteniteMessage::Frame(_) => None,
    }
}

fn axum_close_frame_to_tungstenite(frame: AxumCloseFrame) -> TungsteniteCloseFrame {
    TungsteniteCloseFrame {
        code: CloseCode::from(frame.code),
        reason: frame.reason.to_string().into(),
    }
}

fn tungstenite_close_frame_to_axum(frame: TungsteniteCloseFrame) -> AxumCloseFrame {
    AxumCloseFrame {
        code: frame.code.into(),
        reason: frame.reason.to_string().into(),
    }
}

fn json_error(status: StatusCode, code: &str, message: &str) -> Response {
    let payload = serde_json::to_vec(&ErrorEnvelope::new(code, message)).unwrap_or_default();
    let mut response = Response::builder().status(status);
    if let Some(headers) = response.headers_mut() {
        headers.insert(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
    }

    response
        .body(Body::from(payload))
        .unwrap_or_else(|_| Response::new(Body::from("internal response error")))
}

fn is_body_too_large_error(err: &axum::Error) -> bool {
    let lowered = err.to_string().to_ascii_lowercase();
    lowered.contains("length limit")
        || lowered.contains("body too large")
        || lowered.contains("payload too large")
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::HeaderMap;
    use axum::http::HeaderName;
    use axum::http::StatusCode;
    use bytes::Bytes;
    use codex_pool_core::model::UpstreamMode;
    use std::time::Duration;

    use super::{
        build_upstream_url, build_upstream_ws_url, compose_upstream_path, ejection_ttl_for_status,
        ensure_client_version_query, extract_upstream_error_code, is_body_too_large_error,
        is_compatibility_passthrough_header, is_websocket_passthrough_header,
        parse_request_policy_context, recovery_action_for_upstream_error_code,
        sticky_session_key_from_headers,
        ProxyRecoveryAction,
    };

    #[test]
    fn builds_upstream_url_with_base_path() {
        let url = build_upstream_url(
            "https://chatgpt.com/backend-api/codex",
            &UpstreamMode::ChatGptSession,
            "/v1/responses",
            Some("a=1"),
        )
        .unwrap();

        assert_eq!(url, "https://chatgpt.com/backend-api/codex/responses?a=1");
    }

    #[test]
    fn treats_openai_beta_and_subagent_as_compatibility_headers() {
        let openai_beta = HeaderName::from_static("openai-beta");
        let subagent = HeaderName::from_static("x-openai-subagent");
        let turn_state = HeaderName::from_static("x-codex-turn-state");
        let turn_metadata = HeaderName::from_static("x-codex-turn-metadata");
        let beta_features = HeaderName::from_static("x-codex-beta-features");
        let session_id = HeaderName::from_static("session_id");
        let conversation_id = HeaderName::from_static("conversation_id");
        let x_session_id = HeaderName::from_static("x-session-id");

        assert!(is_compatibility_passthrough_header(&openai_beta));
        assert!(is_compatibility_passthrough_header(&subagent));
        assert!(is_compatibility_passthrough_header(&turn_state));
        assert!(is_compatibility_passthrough_header(&turn_metadata));
        assert!(is_compatibility_passthrough_header(&beta_features));
        assert!(is_compatibility_passthrough_header(&session_id));
        assert!(is_compatibility_passthrough_header(&conversation_id));
        assert!(is_compatibility_passthrough_header(&x_session_id));
    }

    #[test]
    fn builds_upstream_websocket_url_with_base_path() {
        let url = build_upstream_ws_url(
            "https://chatgpt.com/backend-api/codex",
            &UpstreamMode::ChatGptSession,
            "/v1/responses",
            Some("a=1"),
        )
        .unwrap();

        assert_eq!(
            url.as_str(),
            "wss://chatgpt.com/backend-api/codex/responses?a=1"
        );
    }

    #[test]
    fn avoids_duplicate_base_path_when_client_path_already_prefixed() {
        let path = compose_upstream_path("/backend-api/codex", "/backend-api/codex/responses");
        assert_eq!(path, "/backend-api/codex/responses");
    }

    #[test]
    fn builds_upstream_url_without_duplicate_backend_api_prefix() {
        let url = build_upstream_url(
            "https://chatgpt.com/backend-api/codex",
            &UpstreamMode::ChatGptSession,
            "/backend-api/codex/responses",
            None,
        )
        .unwrap();

        assert_eq!(url, "https://chatgpt.com/backend-api/codex/responses");
    }

    #[test]
    fn builds_upstream_websocket_url_without_duplicate_backend_api_prefix() {
        let url = build_upstream_ws_url(
            "https://chatgpt.com/backend-api/codex",
            &UpstreamMode::ChatGptSession,
            "/backend-api/codex/responses",
            None,
        )
        .unwrap();

        assert_eq!(
            url.as_str(),
            "wss://chatgpt.com/backend-api/codex/responses"
        );
    }

    #[test]
    fn treats_session_id_and_x_codex_as_websocket_passthrough_headers() {
        let session_id = HeaderName::from_static("session_id");
        let conversation_id = HeaderName::from_static("conversation_id");
        let x_session_id = HeaderName::from_static("x-session-id");
        let codex_state = HeaderName::from_static("x-codex-turn-state");

        assert!(is_websocket_passthrough_header(&session_id, true));
        assert!(is_websocket_passthrough_header(&conversation_id, true));
        assert!(is_websocket_passthrough_header(&x_session_id, true));
        assert!(is_websocket_passthrough_header(&codex_state, true));
    }

    #[test]
    fn appends_client_version_query_for_codex_models_when_missing() {
        let query = ensure_client_version_query(Some("a=1"));
        assert!(query.contains("a=1"));
        assert!(query.contains("client_version=0.1.0"));
    }

    #[test]
    fn keeps_existing_client_version_query_for_codex_models() {
        let query = ensure_client_version_query(Some("client_version=9.9.9&a=1"));
        assert_eq!(query, "client_version=9.9.9&a=1");
    }

    #[test]
    fn keeps_openai_mode_path_unchanged_even_with_codex_base_path() {
        let url = build_upstream_url(
            "https://chatgpt.com/backend-api/codex",
            &UpstreamMode::OpenAiApiKey,
            "/v1/responses",
            None,
        )
        .unwrap();

        assert_eq!(url, "https://chatgpt.com/backend-api/codex/v1/responses");
    }

    #[test]
    fn applies_layered_ejection_ttl_by_status_code() {
        let base = Duration::from_secs(30);

        assert_eq!(
            ejection_ttl_for_status(StatusCode::TOO_MANY_REQUESTS, base, false),
            Some(Duration::from_secs(30))
        );
        assert_eq!(
            ejection_ttl_for_status(StatusCode::UNAUTHORIZED, base, false),
            Some(Duration::from_secs(300))
        );
        assert_eq!(
            ejection_ttl_for_status(StatusCode::INTERNAL_SERVER_ERROR, base, false),
            Some(Duration::from_secs(10))
        );
        assert_eq!(
            ejection_ttl_for_status(StatusCode::SERVICE_UNAVAILABLE, base, true),
            Some(Duration::from_secs(30))
        );
        assert_eq!(
            ejection_ttl_for_status(StatusCode::BAD_REQUEST, base, false),
            None
        );
    }

    #[test]
    fn extracts_sticky_session_key_from_session_or_conversation_header() {
        let mut headers = HeaderMap::new();
        headers.insert("session_id", "session-abc".parse().unwrap());
        assert_eq!(
            sticky_session_key_from_headers(&headers).as_deref(),
            Some("session-abc")
        );

        let mut headers = HeaderMap::new();
        headers.insert("conversation_id", "conv-123".parse().unwrap());
        assert_eq!(
            sticky_session_key_from_headers(&headers).as_deref(),
            Some("conv-123")
        );

        let mut headers = HeaderMap::new();
        headers.insert("x-session-id", "x-session-xyz".parse().unwrap());
        assert_eq!(
            sticky_session_key_from_headers(&headers).as_deref(),
            Some("x-session-xyz")
        );

        let mut headers = HeaderMap::new();
        headers.insert("x-codex-turn-state", "turn-state-1".parse().unwrap());
        assert_eq!(
            sticky_session_key_from_headers(&headers).as_deref(),
            Some("turn-state-1")
        );
    }

    #[test]
    fn parses_zstd_compressed_request_body_for_policy_context() {
        let json = br#"{"model":"gpt-4.1-mini","stream":true,"prompt_cache_key":"conv-1","input":"hello"}"#;
        let compressed =
            zstd::stream::encode_all(std::io::Cursor::new(json.as_slice()), 3).unwrap();
        let body = Bytes::from(compressed);
        let mut headers = HeaderMap::new();
        headers.insert("content-encoding", "zstd".parse().unwrap());

        let context = parse_request_policy_context(&headers, &body);
        assert_eq!(context.model.as_deref(), Some("gpt-4.1-mini"));
        assert!(context.stream);
        assert_eq!(context.sticky_key_hint.as_deref(), Some("conv-1"));
        assert!(context.estimated_input_tokens.is_some());
    }

    #[test]
    fn extracts_upstream_error_code_from_standard_error_payload() {
        let body = br#"{"error":{"code":"token_invalidated","message":"invalid token"}}"#;
        assert_eq!(
            extract_upstream_error_code(body),
            Some("token_invalidated".to_string())
        );
    }

    #[test]
    fn extracts_upstream_error_code_from_top_level_code() {
        let body = br#"{"code":"account_deactivated"}"#;
        assert_eq!(
            extract_upstream_error_code(body),
            Some("account_deactivated".to_string())
        );
    }

    #[test]
    fn returns_none_for_non_json_body() {
        let body = b"not-json";
        assert_eq!(extract_upstream_error_code(body), None);
    }

    #[test]
    fn maps_recovery_actions_for_known_error_codes() {
        assert_eq!(
            recovery_action_for_upstream_error_code(Some("token_invalidated")),
            Some(ProxyRecoveryAction::RotateRefreshToken)
        );
        assert_eq!(
            recovery_action_for_upstream_error_code(Some("account_deactivated")),
            Some(ProxyRecoveryAction::DisableAccount)
        );
        assert_eq!(recovery_action_for_upstream_error_code(Some("other")), None);
        assert_eq!(recovery_action_for_upstream_error_code(None), None);
    }

    #[tokio::test]
    async fn classifies_length_limit_errors_as_payload_too_large() {
        let err = axum::body::to_bytes(Body::from(vec![0_u8; 16]), 8)
            .await
            .expect_err("expected length limit error");
        assert!(is_body_too_large_error(&err));
    }
}
