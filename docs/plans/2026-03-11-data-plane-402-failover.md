# Data Plane 402 Failover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make upstream `402 Payment Required` responses classify as quota-style failover candidates and log enough upstream detail to diagnose the next occurrence quickly.

**Architecture:** Add regression coverage at the HTTP proxy boundary and unit coverage for request-utils classification helpers. Then make the smallest possible change in `request_utils.rs` so upstream `402` maps to `QuotaExhausted`, and extend failover warning logs to include a short upstream error-message preview without leaking huge bodies.

**Tech Stack:** Rust, axum, reqwest, wiremock, tracing

---

### Task 1: Add failing regression tests

**Files:**
- Modify: `services/data-plane/tests/compatibility.rs`
- Modify: `services/data-plane/src/proxy/request_utils.rs`

**Step 1: Write the failing integration test**

- Add a new HTTP proxy test where:
  - upstream A returns `402 Payment Required`
  - body contains a realistic plan/quota text such as `Upgrade to Plus to continue using Codex`
  - upstream B returns `200 OK`
- Assert the final response is the second account's success payload

**Step 2: Write the failing unit test**

- Add a `request_utils_tests` case asserting `classify_upstream_error(StatusCode::PAYMENT_REQUIRED, None, Some(...)) == UpstreamErrorClass::QuotaExhausted`
- Add a small helper test for the message-preview function once that helper exists

**Step 3: Run the targeted tests to verify RED**

Run:

```bash
cargo test -p data-plane fails_over_on_http_402_payment_required_response
cargo test -p data-plane classifies_402_payment_required_as_quota_exhausted
```

Expected:
- New tests fail before implementation

### Task 2: Implement the minimal fix

**Files:**
- Modify: `services/data-plane/src/proxy/request_utils.rs`

**Step 1: Fix classification**

- Teach `classify_upstream_error` to classify upstream `402 Payment Required` as `QuotaExhausted`
- Keep existing explicit code/message matches intact

**Step 2: Improve diagnostics**

- Add a helper that returns a short preview of `error_message`
- Include that preview in `log_failover_decision`
- Update all call sites to pass the existing `UpstreamErrorContext`

**Step 3: Keep the change scoped**

- Do not alter API error envelopes
- Do not widen recovery actions beyond existing quota handling

### Task 3: Verify GREEN

**Files:**
- No additional files

**Step 1: Run the focused tests**

```bash
cargo test -p data-plane fails_over_on_http_402_payment_required_response
cargo test -p data-plane classifies_402_payment_required_as_quota_exhausted
```

Expected:
- Both pass

**Step 2: Run broader safety checks**

```bash
cargo test -p data-plane request_utils_tests
cargo check -p data-plane
```

Expected:
- Request-utils regression tests pass
- `cargo check` passes

### Task 4: Document outcome

**Files:**
- Modify: `docs/plans/2026-03-11-data-plane-402-failover.md`

**Step 1: Mark tasks complete**

- Check off completed todo items
- Summarize root cause and fix

**Step 2: Prepare handoff**

- Note that historic logs cannot reconstruct the old upstream body
- Point to the new warning field for future reproductions

## Execution Notes

- [x] Added an HTTP integration regression: upstream A returns `402` with only a plan-upgrade message, upstream B succeeds, and the proxy now fails over to B.
- [x] Added a unit regression proving `StatusCode::PAYMENT_REQUIRED` now classifies as `QuotaExhausted`.
- [x] Root cause confirmed before the fix: `402` previously fell through to `NonRetryableClient`, so `is_failover_retryable_error(...)` returned `false` and cross-account failover never ran.
- [x] Implemented the minimal fix by classifying upstream `402 Payment Required` as `QuotaExhausted`.
- [x] Extended `proxy failover decision` logs with `upstream_error_message`, so the next reproduction will show the extracted upstream message alongside `upstream_error_code`.
- [x] Verified with:
  - `cargo test -p data-plane fails_over_on_http_402_payment_required_response -- --nocapture`
  - `cargo test -p data-plane request_utils_tests -- --nocapture`
  - `cargo check -p data-plane`

## Handoff

- The historic one-line warning you pasted cannot be reverse-expanded into the original upstream body, because the old log format only recorded status/code/class and not the message body.
- After this change, re-running the same request should print `upstream_error_message=...` in the same `proxy failover decision` warning, which is the fastest way to see what OpenAI actually returned.
