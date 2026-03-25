use std::time::Duration;

use codex_pool_core::model::{
    AccountRoutingHealthFreshness, AccountRoutingTraits, UpstreamAccount, UpstreamMode,
};
use data_plane::router::RoundRobinRouter;
use uuid::Uuid;

fn test_account(label: &str) -> UpstreamAccount {
    UpstreamAccount {
        id: Uuid::new_v4(),
        label: label.to_string(),
        mode: UpstreamMode::ChatGptSession,
        base_url: "https://upstream.test".to_string(),
        bearer_token: format!("token-{label}"),
        chatgpt_account_id: Some("acct_123".to_string()),
        enabled: true,
        priority: 100,
        created_at: chrono::Utc::now(),
    }
}

#[tokio::test]
async fn skips_temporarily_unhealthy_account() {
    let a = test_account("a");
    let b = test_account("b");
    let router = RoundRobinRouter::new(vec![a.clone(), b.clone()]);

    router.mark_unhealthy(a.id, Duration::from_secs(30));

    assert_eq!(router.pick().unwrap().id, b.id);
}

#[tokio::test]
async fn account_diagnostics_reflects_health_penalty_window() {
    let a = test_account("a");
    let b = test_account("b");
    let router = RoundRobinRouter::new(vec![a.clone(), b.clone()]);

    router.mark_unhealthy(a.id, Duration::from_secs(30));

    let diagnostics = router.list_account_diagnostics();
    let account_a = diagnostics.iter().find(|item| item.id == a.id).unwrap();
    let account_b = diagnostics.iter().find(|item| item.id == b.id).unwrap();

    assert!(account_a.temporarily_unhealthy);
    assert!(!account_b.temporarily_unhealthy);
}

#[tokio::test]
async fn clear_unhealthy_clears_health_penalty_for_existing_account() {
    let a = test_account("a");
    let b = test_account("b");
    let router = RoundRobinRouter::new(vec![a.clone(), b]);

    router.mark_unhealthy(a.id, Duration::from_secs(30));
    assert!(
        router
            .account_diagnostics(a.id)
            .unwrap()
            .temporarily_unhealthy
    );

    assert!(router.clear_unhealthy(a.id));

    assert!(
        !router
            .account_diagnostics(a.id)
            .unwrap()
            .temporarily_unhealthy
    );
}

#[tokio::test]
async fn clear_unhealthy_returns_false_for_unknown_account() {
    let router = RoundRobinRouter::new(vec![test_account("a")]);

    assert!(!router.clear_unhealthy(Uuid::new_v4()));
}

#[tokio::test]
async fn clear_all_unhealthy_clears_every_penalty_and_returns_count() {
    let a = test_account("a");
    let b = test_account("b");
    let c = test_account("c");
    let router = RoundRobinRouter::new(vec![a.clone(), b.clone(), c.clone()]);

    router.mark_unhealthy(a.id, Duration::from_secs(30));
    router.mark_unhealthy(c.id, Duration::from_secs(60));

    assert_eq!(router.clear_all_unhealthy(), 2);

    assert!(
        !router
            .account_diagnostics(a.id)
            .unwrap()
            .temporarily_unhealthy
    );
    assert!(
        !router
            .account_diagnostics(c.id)
            .unwrap()
            .temporarily_unhealthy
    );
    assert!(
        !router
            .account_diagnostics(b.id)
            .unwrap()
            .temporarily_unhealthy
    );
}

#[tokio::test]
async fn prefers_recently_successful_accounts_before_round_robin_fallback() {
    let a = test_account("a");
    let b = test_account("b");
    let router = RoundRobinRouter::new(vec![a.clone(), b.clone()]);

    router.record_success(b.id);

    assert_eq!(router.pick().unwrap().id, b.id);

    router.mark_unhealthy(b.id, Duration::from_secs(30));

    assert_eq!(router.pick().unwrap().id, a.id);
}

#[tokio::test]
async fn prefers_freshly_probed_accounts_before_unknown_accounts() {
    let a = test_account("a");
    let b = test_account("b");
    let router = RoundRobinRouter::new(vec![a.clone(), b.clone()]);

    router.replace_account_traits(vec![
        AccountRoutingTraits {
            account_id: a.id,
            health_freshness: Some(AccountRoutingHealthFreshness::Unknown),
            ..Default::default()
        },
        AccountRoutingTraits {
            account_id: b.id,
            health_freshness: Some(AccountRoutingHealthFreshness::Fresh),
            last_probe_at: Some(chrono::Utc::now()),
            ..Default::default()
        },
    ]);

    assert_eq!(router.pick().unwrap().id, b.id);
}

#[tokio::test]
async fn keeps_recent_success_priority_over_fresh_probe_priority() {
    let a = test_account("a");
    let b = test_account("b");
    let router = RoundRobinRouter::new(vec![a.clone(), b.clone()]);

    router.replace_account_traits(vec![
        AccountRoutingTraits {
            account_id: a.id,
            health_freshness: Some(AccountRoutingHealthFreshness::Unknown),
            ..Default::default()
        },
        AccountRoutingTraits {
            account_id: b.id,
            health_freshness: Some(AccountRoutingHealthFreshness::Fresh),
            last_probe_at: Some(chrono::Utc::now()),
            ..Default::default()
        },
    ]);
    router.record_success(a.id);

    assert_eq!(router.pick().unwrap().id, a.id);
}
