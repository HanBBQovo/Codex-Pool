use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::{env, ffi::OsString};

use codex_pool_core::api::{
    CreateOutboundProxyNodeRequest, UpdateOutboundProxyPoolSettingsRequest,
};
use codex_pool_core::model::ProxyFailMode;
use control_plane::outbound_proxy_runtime::OutboundProxyRuntime;
use control_plane::store::{ControlPlaneStore, InMemoryStore};
use wiremock::matchers::any;
use wiremock::{Mock, MockServer, ResponseTemplate};

static ENV_LOCK: Mutex<()> = Mutex::new(());

#[tokio::test]
async fn runtime_prefers_enabled_proxy_and_respects_fail_mode() {
    let store: Arc<dyn ControlPlaneStore> = Arc::new(InMemoryStore::default());
    let runtime = Arc::new(OutboundProxyRuntime::new());
    runtime.attach_store(store.clone());

    let node = store
        .create_outbound_proxy_node(CreateOutboundProxyNodeRequest {
            label: "proxy-a".to_string(),
            proxy_url: "http://127.0.0.1:19080".to_string(),
            enabled: Some(true),
            weight: Some(1),
        })
        .await
        .expect("create proxy node");
    store
        .update_outbound_proxy_pool_settings(UpdateOutboundProxyPoolSettingsRequest {
            enabled: true,
            fail_mode: ProxyFailMode::StrictProxy,
        })
        .await
        .expect("enable proxy pool");

    let selected = runtime
        .select_http_client(Duration::from_secs(3))
        .await
        .expect("proxy selection should succeed");
    assert_eq!(selected.proxy_id, Some(node.id));
    runtime.mark_proxy_transport_failure(&selected).await;

    let strict_err = runtime.select_http_client(Duration::from_secs(3)).await;
    assert!(strict_err.is_err());

    store
        .update_outbound_proxy_pool_settings(UpdateOutboundProxyPoolSettingsRequest {
            enabled: true,
            fail_mode: ProxyFailMode::AllowDirectFallback,
        })
        .await
        .expect("switch to direct fallback");

    let fallback = runtime
        .select_http_client(Duration::from_secs(3))
        .await
        .expect("direct fallback should succeed");
    assert!(fallback.proxy_id.is_none());
    assert!(fallback.used_direct_fallback);
}

#[tokio::test]
async fn direct_client_bypasses_ambient_http_proxy() {
    let _env_guard = ENV_LOCK.lock().expect("env lock");
    let target = MockServer::start().await;
    Mock::given(any())
        .respond_with(ResponseTemplate::new(200).set_body_string("target"))
        .mount(&target)
        .await;

    let fake_proxy = MockServer::start().await;
    Mock::given(any())
        .respond_with(ResponseTemplate::new(503).set_body_string("proxy"))
        .mount(&fake_proxy)
        .await;

    let previous_http_proxy = env::var_os("http_proxy");
    let previous_http_proxy_upper = env::var_os("HTTP_PROXY");
    let previous_https_proxy = env::var_os("https_proxy");
    let previous_https_proxy_upper = env::var_os("HTTPS_PROXY");
    let previous_all_proxy = env::var_os("all_proxy");
    let previous_all_proxy_upper = env::var_os("ALL_PROXY");
    let previous_no_proxy = env::var_os("no_proxy");
    let previous_no_proxy_upper = env::var_os("NO_PROXY");

    unsafe {
        env::set_var("http_proxy", fake_proxy.uri());
        env::set_var("HTTP_PROXY", fake_proxy.uri());
        env::remove_var("https_proxy");
        env::remove_var("HTTPS_PROXY");
        env::remove_var("all_proxy");
        env::remove_var("ALL_PROXY");
        env::remove_var("no_proxy");
        env::remove_var("NO_PROXY");
    }

    let runtime = Arc::new(OutboundProxyRuntime::new());
    let selected = runtime
        .select_http_client(Duration::from_secs(5))
        .await
        .expect("direct selection should succeed");
    let response = selected
        .client
        .get(target.uri())
        .send()
        .await
        .expect("request should succeed");
    let status = response.status();
    let body = response.text().await.expect("response body");

    unsafe {
        restore_env("http_proxy", previous_http_proxy);
        restore_env("HTTP_PROXY", previous_http_proxy_upper);
        restore_env("https_proxy", previous_https_proxy);
        restore_env("HTTPS_PROXY", previous_https_proxy_upper);
        restore_env("all_proxy", previous_all_proxy);
        restore_env("ALL_PROXY", previous_all_proxy_upper);
        restore_env("no_proxy", previous_no_proxy);
        restore_env("NO_PROXY", previous_no_proxy_upper);
    }

    assert_eq!(status, reqwest::StatusCode::OK, "unexpected body: {body}");
    assert_eq!(body, "target");
}

unsafe fn restore_env(key: &str, value: Option<OsString>) {
    match value {
        Some(value) => env::set_var(key, value),
        None => env::remove_var(key),
    }
}
