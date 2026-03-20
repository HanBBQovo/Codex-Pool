# Platform Core / Edition Architecture Refactor Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. The primary integration owner must keep one dedicated integration worktree, accept every worker branch, and run the final acceptance suite before merge.

**Goal:** 把 `personal / team / business` 从“同一坨代码里的运行时裁剪”重构成“共享领域骨架 + 显式 capability matrix + backend family 装配”，同时保持 `personal/team` 的单部署体验、现有升级路径和运行时契约不变。

**Architecture:** 以现有 `codex-pool-core` 为唯一平台 core，收口 edition/capability/error/snapshot/runtime contracts；`control-plane` 与 `data-plane` 各自保留自己的 backend adapters 与组合根；Cargo feature 只表达 backend family，不表达 edition；edition 只负责 capability 和装配，不再负责隐藏依赖树。

**Tech Stack:** Rust workspace（Axum / Tokio / SQLx）、React + Vite、SQLite / PostgreSQL / Redis / ClickHouse、Cargo features、git worktrees、subagents。

---

## Summary

- 基线锚点：`main@efa878f`（`refactor: 调整依赖裁剪`）。
- 本计划替代两份旧计划的后续实施地位：
  - `.codex/docs/plans/20260313-001455-repo-personal-team-business-plan.md`
  - `.codex/docs/plans/2026-03-20-control-plane-backend-boundaries-plan.md`
- 这轮重构不是再造三套产品代码，而是把三层 edition 固化为：
  - 一套共享领域模型
  - 一套统一 capability matrix
  - 三套不同的 runtime/dependency assembly
- `personal` 和 `team` 继续保留轻量、单部署、低心智负担的外部产品体验。
- `business` 允许继续偏向模型统一和完整后端栈，但不能反向污染 `personal/team` 的依赖树。

## Frozen Decisions

以下决策已由产品 owner 明确，实施时不再重新讨论：

- 最不能接受的失败结果：edition 边界继续泄漏。
- capability 的唯一真相必须在 `codex-pool-core` 中统一维护，前后端和装配层都从这里推导。
- `personal` 在内部模型上是共享领域模型的单租户投影，不是另一套独立世界。
- `team` 在内部模型上是 `business` 的轻量投影，不是长期独立平行产品。
- `personal/team` 的单部署体验不能被破坏。
- `personal` 的长期资源目标是轻量 NAS 级，不能为了模型整齐引入重型常驻后台负担。
- `team` 的核心产品价值是轻依赖自托管，而不是尽量贴近 `business` 的基础设施形态。
- 三层版本是同一条升级路径，`edition-migrate`、导入导出、shrink、配置兼容都属于架构本身。
- 升级时优先保障“操作方式连续”，尤其是 `personal/team`；`business` 可以在内部结构上更偏模型统一。
- 开发期验证偏轻量，主分支和集成阶段再跑重验证；不允许把“全量跑很慢”当作长期默认开发体验。

## Baseline Facts On `main`

- `codex-pool-core` 当前仍混放了 edition/capability、错误信封、共享 DTO，以及大量 control-plane 专用 API DTO；它还不是真正的“平台 core”。
- `services/control-plane/src/main.rs` 仍是超重组合根，混合了：
  - edition 解析
  - runtime 默认值
  - store 选择
  - usage repo 选择
  - background loop 注册
  - `personal/team` single-binary merge
- `control-plane` 仍直接依赖：
  - `sqlx-postgres`
  - `redis`
  - `lettre`
  - `clickhouse`（feature gate）
- `services/control-plane/src/store/defs.rs` 仍让核心抽象暴露 `PgPool` 等 backend 细节。
- `services/control-plane/src/tenant/types_and_runtime.rs` 同时承载：
  - tenant session/JWT/cookie
  - self-service 注册/验证/找回密码
  - SMTP
  - credit/billing runtime
- `services/data-plane` 已经有 `redis-backend` feature、`EventSink`、`RoutingCache` 等较好的 adapter 边界，但 `bootstrap.rs` 仍是重组合根。
- `README.md` 与 `docs/editions-and-migration.md` 已对外承诺：
  - `codex-pool-personal / codex-pool-team / codex-pool-business`
  - `personal/team` 单机/单容器形态
  - `edition-migrate export / preflight / import / archive inspect / shrink`
  - `x-request-id`
  - `CONTROL_PLANE_INTERNAL_AUTH_TOKEN`
  - 三档 docker compose 矩阵

## Public Contracts That Must Not Regress

- 二进制名保持不变：
  - `codex-pool-personal`
  - `codex-pool-team`
  - `codex-pool-business`
- `CODEX_POOL_EDITION` 的优先级保持不变；环境变量优先于二进制名推断。
- `/api/v1/system/capabilities` 的对外契约保持不变。
- `frontend` 基于 capability 的 shell routing 和 route gating 语义保持不变。
- `edition-migrate` 的命令名与主参数保持不变。
- `personal/team` 的单部署体验保持不变：
  - 用户仍然可以一个产物/一个启动方式跑起来
  - 不引入 Redis / ClickHouse 作为基础必需项
- `x-request-id` 继续只是 tracing / correlation 字段，不变成 billing 幂等键。
- `CONTROL_PLANE_INTERNAL_AUTH_TOKEN` 继续是 control-plane / data-plane / usage-worker 的内部鉴权核心契约。
- `/health`、`/livez`、`/readyz`、日志流命名、request correlation 行为保持兼容。

## Collaboration Model

### Baseline Rule

- 先在 `main` 落并提交本计划文档。
- 之后所有实现工作都从本计划提交点重新开新 worktree。
- 主工作区不做实现，只保留：
  - 计划文档
  - 最终集成验收
  - 冲突消解

### Worktree Layout

主集成人保留一个集成 worktree，其他 worker 各自只改自己拥有的文件集。

| Worktree | Branch | Owner | Ownership |
| --- | --- | --- | --- |
| `.worktrees/refactor-integration` | `refactor/edition-architecture-integration` | 主 agent | 统一集成、共享 manifest、冲突解决、最终验收 |
| `.worktrees/refactor-core-foundation` | `refactor/core-foundation` | `worker` | `crates/codex-pool-core/**` |
| `.worktrees/refactor-control-entry` | `refactor/control-plane-entry` | `worker` | `services/control-plane/src/main.rs`、`src/bin/**`、`src/config.rs`、`src/single_binary.rs` |
| `.worktrees/refactor-control-store` | `refactor/control-plane-store` | `worker` | `services/control-plane/src/store/**` |
| `.worktrees/refactor-control-usage` | `refactor/control-plane-usage` | `worker` | `services/control-plane/src/usage/**`、`src/bin/usage-worker.rs` |
| `.worktrees/refactor-control-tenant-session` | `refactor/control-plane-tenant-session` | `worker` | `services/control-plane/src/tenant/auth_session.rs`、`src/tenant/admin_ops.rs`、`src/tenant/api_keys_credits.rs` 中 session/self-service 相关部分 |
| `.worktrees/refactor-control-billing` | `refactor/control-plane-billing` | `worker` | `services/control-plane/src/cost.rs`、`src/tenant/billing_reconcile.rs`、`src/tenant/types_and_runtime.rs` 中 billing 相关部分 |
| `.worktrees/refactor-data-runtime` | `refactor/data-plane-runtime` | `worker` | `services/data-plane/src/app/**`、`src/event/**`、`src/routing_cache.rs`、`src/upstream_health.rs`、`src/outbound_proxy_runtime.rs` |
| `.worktrees/refactor-contracts-docs` | `refactor/contracts-docs` | `worker` | `services/*/tests/dependency_boundaries.rs`、edition smoke tests、`README.md`、`docs/editions-and-migration.md`、必要的 frontend capability 契约测试 |

### Subagent Layout

- `worker` 使用 `gpt-5.4` + `xhigh`。
- `explore_worker` 使用默认配置，仅做只读调研与审计。
- 实施阶段固定启用 `11` 个 subagents：
  - `worker` x8：对应上表 8 个实现 worktrees
  - `explore_worker` x3：
    - edition/capability 契约审计
    - 运行运维契约审计
    - migration / archive / shrink 契约审计

### Ownership Rules

- Worker 只能改自己拥有的目录；跨目录改动一律交给主集成人在 integration worktree 合并。
- `Cargo.toml`、共享测试基建、公共 re-export、跨 crate import 清理由主集成人负责最终合并，避免多个 worker 冲突。
- 每个 worker 交付时必须附带：
  - 变更摘要
  - 完整 changed files 列表
  - 已运行命令
  - 未解决风险
- 每个 worker 的实现必须原子提交，提交信息遵循仓库提交规范。

### Merge Order

必须按以下顺序集成，不能并行乱合：

1. `core-foundation`
2. `data-plane-runtime`
3. `control-plane-store`
4. `control-plane-usage`
5. `control-plane-tenant-session`
6. `control-plane-billing`
7. `control-plane-entry`
8. `contracts-docs`

原因：

- `core-foundation` 提供 capability/contract 新基线。
- `data-plane-runtime` 与 `control-plane-store/usage` 对依赖树的裁剪最早产生正反馈。
- `tenant-session` 和 `billing` 都依赖新的 store/usage 边界。
- `control-plane-entry` 必须最后吃入前面所有装配变化。
- `contracts-docs` 需要在结构稳定后补最终护栏和文档。

## Target Architecture

### 1. `codex-pool-core`

最终只保留以下共享内容：

- edition/capability matrix
- 对外错误信封
- control-plane 与 data-plane 共用的 snapshot/event contracts
- 两边都用到的 shared domain model
- backend-neutral 的纯策略与 helper

最终不再保留：

- 纯 control-plane 管理后台 DTO
- tenant portal/self-service 专用 DTO
- logging/runtime 初始化这类 service-specific 代码

实施决策：

- 继续沿用现有 crate 名 `codex-pool-core`，不新建第二个 core crate。
- 通过拆模块净化，不通过复制 crate。

### 2. `control-plane`

最终形态：

- `main.rs` 只做：
  - 解析 runtime edition
  - 构建 runtime profile
  - 组装 backend adapters
  - 注册后台任务
  - 构造 Axum app
- store/usage/tenant/billing 通过更细的 ports 连接，不再让顶层装配直接依赖后端具体实现细节。
- `personal` 编译时只带 SQLite family。
- `team` 编译时只带 Postgres family。
- `business` 编译时才带 Redis / ClickHouse / SMTP family。

### 3. `data-plane`

最终形态：

- `bootstrap.rs` 只保留 runtime profile 到 adapter 的装配。
- `EventSink`、`RoutingCache`、`AliveRingRouter`、`SeenOkReporter` 的选择明确由 backend family 驱动。
- `personal/team` 不编译 Redis backend。
- `business` 编译 Redis backend，并保留现有可横向扩展能力。

### 4. Runtime / Packaging

最终形态：

- Cargo feature 只表达 backend family：
  - `sqlite-backend`
  - `postgres-backend`
  - `redis-backend`
  - `clickhouse-backend`
  - `smtp-backend`
- edition 不再映射成 Cargo feature 名。
- edition 只映射：
  - capability matrix
  - runtime defaults
  - backend assembly profile

## Workstream Details

### Workstream 1: Core Capability Foundation

**Worktree:** `.worktrees/refactor-core-foundation`  
**Branch:** `refactor/core-foundation`

**Files:**
- Modify: `crates/codex-pool-core/src/lib.rs`
- Modify: `crates/codex-pool-core/src/api.rs`
- Modify: `crates/codex-pool-core/src/model.rs`
- Modify: `crates/codex-pool-core/src/events.rs`
- Modify: `crates/codex-pool-core/src/logging.rs`
- Create: `crates/codex-pool-core/src/edition.rs`
- Create: `crates/codex-pool-core/src/error.rs`
- Create: `crates/codex-pool-core/src/snapshot.rs`
- Create: `crates/codex-pool-core/src/runtime_contract.rs`

**Deliverables:**
- 从超大的 `api.rs` 中拆出 `ProductEdition`、capability matrix、error envelope、snapshot/runtime contract。
- `api.rs` 只保留真正跨服务共享的 wire DTO；control-plane 专用 DTO 先打 `to_move` 注释分组并导出迁移清单。
- 提供稳定 helper：
  - `ProductEdition::from_env_value`
  - `ProductEdition::infer_from_binary_name`
  - `SystemCapabilitiesResponse::for_edition`
  - capability convenience helpers
- 为后续服务拆分提供最小 re-export，确保集成阶段可逐步迁移 imports。

**Verification:**
- `cargo test -p codex-pool-core`
- `cargo check -p control-plane --bin codex-pool-personal`
- `cargo check -p data-plane --no-default-features`

**Handoff Requirements:**
- 给主集成人一份“已拆出模块 / 待迁出 DTO”清单。
- 不直接改 `services/**`。

### Workstream 2: Data-Plane Runtime And Adapter Boundaries

**Worktree:** `.worktrees/refactor-data-runtime`  
**Branch:** `refactor/data-plane-runtime`

**Files:**
- Modify: `services/data-plane/Cargo.toml`
- Modify: `services/data-plane/src/app.rs`
- Modify: `services/data-plane/src/app/bootstrap.rs`
- Modify: `services/data-plane/src/config.rs`
- Modify: `services/data-plane/src/event.rs`
- Modify: `services/data-plane/src/event/http_sink.rs`
- Modify: `services/data-plane/src/event/redis_sink.rs`
- Modify: `services/data-plane/src/routing_cache.rs`
- Modify: `services/data-plane/src/upstream_health.rs`
- Modify: `services/data-plane/src/outbound_proxy_runtime.rs`
- Create: `services/data-plane/tests/dependency_boundaries.rs`

**Deliverables:**
- 固化 `redis-backend` 为唯一 Redis family feature。
- 新增 dependency boundary test：
  - `personal/team` build tree 不包含 `redis`
- 将 `bootstrap.rs` 中的 adapter 选择收口成显式 runtime profile helper。
- 保持 `EventSink` / `RoutingCache` trait 作为稳定边界，不把 Redis 选择逻辑散落在多个 call site。
- 保持 `personal/team` 走 control-plane HTTP sink 的语义不变。

**Verification:**
- `cargo test -p data-plane --test dependency_boundaries -- --nocapture`
- `cargo check -p data-plane --no-default-features`
- `cargo check -p data-plane --no-default-features --features redis-backend`
- `cargo test -p data-plane compatibility -- --nocapture`
- `cargo test -p data-plane compatibility_ws -- --nocapture`

**Handoff Requirements:**
- 说明新增 runtime profile helper 的输入输出。
- 标注所有 `#[cfg(feature = "redis-backend")]` 变更点。

### Workstream 3: Control-Plane Store Boundary Split

**Worktree:** `.worktrees/refactor-control-store`  
**Branch:** `refactor/control-plane-store`

**Files:**
- Modify: `services/control-plane/src/store.rs`
- Modify: `services/control-plane/src/store/defs.rs`
- Modify: `services/control-plane/src/store/in_memory_core.rs`
- Modify: `services/control-plane/src/store/sqlite_backed.rs`
- Modify: `services/control-plane/src/store/postgres.rs`
- Modify: `services/control-plane/src/store/trait_impl.rs`
- Modify: `services/control-plane/src/store/family_snapshot.rs`
- Modify: `services/control-plane/src/store/migration.rs`
- Modify: `services/control-plane/src/import_jobs/store_impl.rs`

**Deliverables:**
- 把当前“大一统” `ControlPlaneStore` 拆成过渡性细粒度 ports：
  - `SnapshotPolicyStore`
  - `TenantCatalogStore`
  - `OAuthRuntimeStore`
  - `ImportJobStorePort`
  - `EditionMigrationStore`
- 允许先保留一个过渡 facade，但 facade 不再暴露 `PgPool`。
- SQLite 与 Postgres 都要对齐到同一组 ports；不接受“SQLite 继续特殊一层”。
- 为后续 worker 提供明确 constructor：
  - `build_sqlite_store_ports(...)`
  - `build_postgres_store_ports(...)`

**Verification:**
- `cargo check -p control-plane --bin codex-pool-personal`
- `cargo test -p control-plane postgres_repo -- --nocapture`
- `cargo test -p control-plane integration -- --nocapture`

**Handoff Requirements:**
- 输出 ports 列表与对应实现映射表。
- 明确哪些旧 facade 方法已经被清空，哪些仍在过渡保留。

### Workstream 4: Control-Plane Usage Backend Split

**Worktree:** `.worktrees/refactor-control-usage`  
**Branch:** `refactor/control-plane-usage`

**Files:**
- Modify: `services/control-plane/src/usage/mod.rs`
- Modify: `services/control-plane/src/usage/sqlite_repo.rs`
- Modify: `services/control-plane/src/usage/postgres_repo.rs`
- Modify: `services/control-plane/src/usage/redis_reader.rs`
- Modify: `services/control-plane/src/usage/clickhouse_repo/**`
- Modify: `services/control-plane/src/usage/worker.rs`
- Modify: `services/control-plane/src/bin/usage-worker.rs`
- Modify: `services/control-plane/tests/dependency_boundaries.rs`

**Deliverables:**
- 使用统一 usage ports：
  - `UsageIngestRepository`
  - `UsageQueryRepository`
  - `UsageAggregationRuntime`
- 明确 edition 到 usage backend topology 的映射：
  - `personal = sqlite`
  - `team = postgres`
  - `business = redis + usage-worker + clickhouse`
- `usage-worker` 只在 `business` 构建路径存在。
- 补齐 control-plane dependency boundary test：
  - `personal` tree 不包含 `sqlx-postgres` / `redis` / `clickhouse` / `lettre`
  - `team` tree 不包含 `redis` / `clickhouse` / `lettre`

**Verification:**
- `cargo test -p control-plane --test dependency_boundaries -- --nocapture`
- `cargo check -p control-plane --no-default-features --features sqlite-backend --bin codex-pool-personal`
- `cargo check -p control-plane --no-default-features --features postgres-backend --bin codex-pool-team`
- `cargo check -p control-plane --no-default-features --features postgres-backend,redis-backend,clickhouse-backend,smtp-backend --bin codex-pool-business --bin usage-worker`

**Handoff Requirements:**
- 给出三档 edition 的 usage backend 选择表。
- 说明哪些测试仍需要主集成人在 integration worktree 补线。

### Workstream 5: Tenant Session Core And Self-Service Adapter

**Worktree:** `.worktrees/refactor-control-tenant-session`  
**Branch:** `refactor/control-plane-tenant-session`

**Files:**
- Modify: `services/control-plane/src/tenant.rs`
- Modify: `services/control-plane/src/tenant/auth_session.rs`
- Modify: `services/control-plane/src/tenant/admin_ops.rs`
- Modify: `services/control-plane/src/tenant/api_keys_credits.rs`
- Modify: `services/control-plane/src/tenant/audit_and_utils.rs`
- Create: `services/control-plane/src/tenant/session_core.rs`
- Create: `services/control-plane/src/tenant/self_service.rs`

**Deliverables:**
- 把 tenant JWT、cookie、principal、impersonation、session verification 收口到 `session_core.rs`。
- 把注册、邮箱验证码、密码重置、SMTP 发送全部收口到 `self_service.rs`。
- `team` 保留 tenant portal 登录，但不编译 self-service/SMTP。
- `personal` 不暴露 tenant portal 路径；如果内部仍要复用 session core，也只能通过 capability 封口，不允许路由泄漏。

**Verification:**
- `cargo test -p control-plane i18n_error_locale -- --nocapture`
- `cargo test -p control-plane api -- --nocapture`
- `cargo check -p control-plane --no-default-features --features postgres-backend --bin codex-pool-team`
- `cargo check -p control-plane --no-default-features --features sqlite-backend --bin codex-pool-personal`

**Handoff Requirements:**
- 给出 session core 与 self-service 的新边界说明。
- 标注所有需要 `smtp-backend` gate 的入口。

### Workstream 6: Billing Core Extraction

**Worktree:** `.worktrees/refactor-control-billing`  
**Branch:** `refactor/control-plane-billing`

**Files:**
- Modify: `services/control-plane/src/cost.rs`
- Modify: `services/control-plane/src/tenant/billing_reconcile.rs`
- Modify: `services/control-plane/src/tenant/types_and_runtime.rs`
- Modify: `services/control-plane/src/app/core_handlers/billing_runtime.rs`
- Create: `services/control-plane/src/tenant/billing_core.rs`

**Deliverables:**
- 把 pricing resolve、authorize、capture、release、reconcile 的核心决策收口到 `billing_core.rs`。
- 让 route handlers 与后台 reconcile loop 共用同一套 billing policy，不再重复埋在 `types_and_runtime.rs` 大文件中。
- `personal/team` 明确只支持 `cost_report_only`，不编译 credit billing backend 路径。
- `business` 才保留完整 credit billing + reconcile runtime。

**Verification:**
- `cargo test -p control-plane usage_worker -- --nocapture`
- `cargo test -p control-plane dashboard_logs_billing_e2e -- --nocapture`
- `cargo check -p control-plane --no-default-features --features postgres-backend --bin codex-pool-team`
- `cargo check -p control-plane --no-default-features --features postgres-backend,redis-backend,clickhouse-backend,smtp-backend --bin codex-pool-business`

**Handoff Requirements:**
- 提供 `cost_report_only` 与 `credit_enforced` 的最终行为表。
- 标注仍依赖 Postgres 的 billing 数据入口。

### Workstream 7: Control-Plane Composition Root Refactor

**Worktree:** `.worktrees/refactor-control-entry`  
**Branch:** `refactor/control-plane-entry`

**Files:**
- Modify: `services/control-plane/Cargo.toml`
- Modify: `services/control-plane/src/main.rs`
- Modify: `services/control-plane/src/config.rs`
- Modify: `services/control-plane/src/app.rs`
- Modify: `services/control-plane/src/single_binary.rs`
- Modify: `services/control-plane/src/bin/codex-pool-personal.rs`
- Modify: `services/control-plane/src/bin/codex-pool-team.rs`
- Modify: `services/control-plane/src/bin/codex-pool-business.rs`
- Modify: `services/control-plane/src/bin/edition-migrate.rs`

**Deliverables:**
- 把 `main.rs` 重构成明确的装配流程：
  - `resolve_runtime_edition`
  - `resolve_backend_profile`
  - `build_store_bundle`
  - `build_usage_bundle`
  - `build_tenant_bundle`
  - `register_background_tasks`
  - `build_http_app`
- Cargo features 固化为 backend family；entrypoint 不再隐式依赖“大而全默认编译”。
- `personal/team` 的 single-binary merge 保留现有外部行为，但内部只消费 runtime profile，不再四处散落 edition if/else。
- 保持 bin 名与 env precedence 测试继续通过。

**Verification:**
- `cargo check -p control-plane --no-default-features --features sqlite-backend --bin codex-pool-personal`
- `cargo check -p control-plane --no-default-features --features postgres-backend --bin codex-pool-team`
- `cargo check -p control-plane --no-default-features --features postgres-backend,redis-backend,clickhouse-backend,smtp-backend --bin codex-pool-business --bin edition-migrate`
- `cargo test -p control-plane single_binary::tests -- --nocapture`
- `cargo test -p control-plane --lib --bins`

**Handoff Requirements:**
- 输出 runtime profile 类型定义与 edition/backend/profile 对照表。
- 标出仍由主集成人解决的 manifest 冲突。

### Workstream 8: Contracts, Guardrails, Docs

**Worktree:** `.worktrees/refactor-contracts-docs`  
**Branch:** `refactor/contracts-docs`

**Files:**
- Modify: `services/control-plane/tests/dependency_boundaries.rs`
- Modify: `services/data-plane/tests/dependency_boundaries.rs`
- Modify: `services/control-plane/tests/support/mod.rs`
- Modify: `services/data-plane/tests/support/mod.rs`
- Modify: `frontend/src/lib/edition-shell-routing.ts`
- Modify: `frontend/src/lib/edition-shell-routing.test.ts`
- Modify: `README.md`
- Modify: `docs/editions-and-migration.md`

**Deliverables:**
- 把 edition/dependency/capability 护栏测试补成长期资产：
  - dependency boundary tests
  - edition assembly smoke tests
  - frontend capability routing tests
- README 与迁移文档同步反映新的 backend family feature 组合与验证命令。
- 明确 `personal/team/business` 的 build matrix 和 acceptance matrix。

**Verification:**
- `cargo test -p control-plane --test dependency_boundaries -- --nocapture`
- `cargo test -p data-plane --test dependency_boundaries -- --nocapture`
- `cd frontend && npm test -- edition-shell-routing`
- `cd frontend && npm run build`

**Handoff Requirements:**
- 输出最终 acceptance matrix 表格。
- 标出所有外部契约验证点。

## Integration Worktree Duties

集成 worktree 只由主 agent 维护，职责固定：

- 创建分支：`refactor/edition-architecture-integration`
- 依次 cherry-pick 各 worker 的原子提交
- 统一解决：
  - `Cargo.toml`
  - shared import/re-export
  - crate public API 对齐
  - 跨 worktree 测试修线
- 统一补最后一层“只能在全局看清”的改动：
  - 共享 helper 的最终归属
  - 跨 crate feature gate
  - 文档命令与真实构建矩阵对齐

## Acceptance Plan

### Fast Checks Per Worker

- Worker 只跑自己 workstream 的最小验证集合。
- 不允许在 worker 阶段默认跑整仓全量。

### Final Acceptance In Integration Worktree

主 agent 在 integration worktree 必跑以下命令：

```bash
cargo test -p codex-pool-core
cargo test -p control-plane --test dependency_boundaries -- --nocapture
cargo test -p data-plane --test dependency_boundaries -- --nocapture
cargo check -p control-plane --no-default-features --features sqlite-backend --bin codex-pool-personal
cargo check -p control-plane --no-default-features --features postgres-backend --bin codex-pool-team
cargo check -p control-plane --no-default-features --features postgres-backend,redis-backend,clickhouse-backend,smtp-backend --bin codex-pool-business --bin usage-worker --bin edition-migrate
cargo check -p data-plane --no-default-features
cargo check -p data-plane --no-default-features --features redis-backend
cargo test -p control-plane single_binary::tests -- --nocapture
cargo test -p data-plane compatibility -- --nocapture
cargo test -p data-plane compatibility_ws -- --nocapture
cd frontend && npm run build
```

### Release Acceptance Scenarios

主 agent 需要手工确认以下场景不回归：

- `personal`：
  - 单部署体验仍成立
  - SQLite 仍是唯一基础存储
  - build tree 不包含 Postgres / Redis / ClickHouse / SMTP
- `team`：
  - 单部署体验仍成立
  - 多租户与 tenant portal 仍成立
  - build tree 不包含 Redis / ClickHouse / SMTP
- `business`：
  - 完整 backend stack 仍可编译
  - `usage-worker`、`edition-migrate` 仍可用
- 跨版本：
  - capability endpoint 语义不变
  - `edition-migrate` CLI 语义不变
  - `x-request-id` 与 request correlation 不变
  - `CONTROL_PLANE_INTERNAL_AUTH_TOKEN` 契约不变

## Important Interface Changes

这些改动属于“内部接口重构”，实施时必须发生，但对外契约不应退化：

- `codex-pool-core`
  - 新增内部模块：
    - `edition`
    - `error`
    - `snapshot`
    - `runtime_contract`
  - `ProductEdition` 与 `SystemCapabilitiesResponse` 的导出位置允许变化，但 public re-export 必须保留兼容层。
- `control-plane`
  - 新增内部 runtime profile 概念，用于表达：
    - edition
    - backend family set
    - deployment shape
  - `ControlPlaneStore` 允许作为过渡 facade 短暂保留，但最终不得继续暴露 backend-specific primitives。
- `data-plane`
  - adapter 选择逻辑集中到 runtime profile helper，不再散落于 `bootstrap.rs` 多处条件分支。

## Assumptions And Defaults

- 这轮重构接受一次性较大改动，不追求“每一层只动一点”的最小修补路线。
- 不新建第二个 core crate，直接净化现有 `codex-pool-core`。
- `team` 不编译 SMTP/self-service 路径。
- `personal` 不暴露 tenant portal，不编译 Postgres / Redis / ClickHouse / SMTP 路径。
- `business` 继续保留 ClickHouse、Redis、SMTP 和完整 credit billing。
- 如果某个 control-plane DTO 目前同时被两边引用，但本轮来不及安全迁出，可先在 `codex-pool-core` 过渡保留并加 `to_move` 分组，必须在 integration worktree 记录剩余债务。

## Todo

- [ ] 在 `main` 提交本计划文档，作为所有新 worktree 的统一基线
- [ ] 创建 integration worktree 与 8 个 worker worktrees
- [ ] 创建 8 个 `worker(gpt-5.4/xhigh)` 与 3 个 `explore_worker`
- [ ] 完成 `codex-pool-core` 模块净化与 capability single source of truth 固化
- [ ] 为 `data-plane` 补齐 dependency boundary tests 并收口 runtime adapter 选择
- [ ] 拆出 `control-plane` store ports，移除 facade 对 `PgPool` 的暴露
- [ ] 收口 `control-plane` usage 三层 backend topology
- [ ] 拆出 tenant session core 与 self-service adapter
- [ ] 提取 billing core，并把 `personal/team` 固化为 `cost_report_only`
- [ ] 重构 `control-plane` 组合根与 backend family feature 装配
- [ ] 补齐 contracts/docs workstream，包括 frontend capability 护栏
- [ ] 在 integration worktree 完成按顺序 cherry-pick、冲突消解和全量验收
- [ ] 回填本计划的完成状态、验证命令和剩余债务
