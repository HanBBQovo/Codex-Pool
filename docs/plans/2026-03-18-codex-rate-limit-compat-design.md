# Codex Rate Limit 兼容与实时调度设计

## 背景

当前 `data-plane` 在 ChatGPT/Codex OAuth 上游前基本是透传：

- SSE 响应头里的 `x-codex-*` rate limit / credits 相关字段会原样回给下游。
- WS 文本流里的 `codex.rate_limits` 事件也没有被清洗或重写。
- `control-plane` 虽然已经有 OAuth rate limit cache 与阻断判断，但主要依赖 `/wham/usage` 或 `/api/codex/usage` 主动拉取，缺少 `data-plane -> control-plane` 的实时观测回写路径。

这带来两个问题：

1. 我们作为 provider 时，会把上游 OAuth 账户态直接暴露给下游。
2. 账号池调度拿不到实时 limit 变化，只能等后台刷新或下一轮被动拉取。

## 目标

- 不再把上游 raw OAuth rate limit 数据原样透传给下游。
- 将 SSE/WS 中观测到的 rate limit 信息实时回写到账号池缓存，并立刻参与账号可用性与阻断判断。
- 对 `Codex` 客户端保留“可自动识别”的兼容层，但由我们自己重写生成，不再透传上游原值。
- 顺手补齐账号详情页的 rate limit 可观测性，让管理端能看清“为什么这个号被挡住了”。

## 非目标

- 不在本轮重构整套账号池调度器。
- 不为所有普通 API 客户端定义新的私有扩展协议。
- 不引入新的重型依赖或单独的 rate limit 服务。

## 设计决策

### 1. 对内统一归一化，对外按客户端类型分流

- `data-plane` 会先把上游 SSE headers / WS `codex.rate_limits` 事件吃掉，解析成统一的内部观测结构。
- 对普通 API 客户端：
  - 不返回 `x-codex-*` 这类私有 rate limit 扩展。
- 对 `Codex` 兼容客户端：
  - 由我们自己重写生成 `x-codex-*` headers 与 `codex.rate_limits` 事件。
  - 字段内容来自我们归一化后的 provider 视角数据，而不是上游 raw OAuth 数据。

这样既能保持 `Codex -> 我们` 的自动识别能力，也能避免其他客户端看到上游私有形态。

### 2. Codex 兼容判定走现有兼容信号

优先使用当前仓库已经存在的兼容信号来判断“这是不是 Codex 客户端”：

- `openai-beta: responses_websockets=...`
- `x-codex-turn-state`
- `x-codex-beta-features`
- 现有 Codex 兼容路由路径

不新增额外的客户端协商前提，避免把这次兼容做成一套新的接入协议。

### 3. 实时观测直接回写 control-plane

- `data-plane` 新增 `ObservedRateLimits` 结构：
  - 可表达一个或多个 bucket 的 primary / secondary 窗口
  - 带上 `source`、`observed_at`、`plan_type`、`credits`、`account_label`
- 新增 internal route：
  - `POST /internal/v1/upstream-accounts/{account_id}/rate-limits/observed`
- `control-plane` 收到后：
  - 写入现有 rate limit cache
  - 触发 snapshot/outbox/revision 更新
  - 让账号池调度立即看到最新 blocked 状态

这条链路优先级高于后台 `/wham/usage` 刷新，但不会删除后台刷新能力。

### 4. 实时观测优先级高于后台轮询

- 实时观测写入后，当前账号的有效 limit 状态以实时观测为准。
- 观测数据过期后，再回退到后台轮询缓存。
- 如果这次只拿到部分 bucket，就只覆盖对应 bucket，不清空未知 bucket。

这样可以避免“WS 只告诉我们周窗打满，但把其他 bucket 一并抹掉”的问题。

### 5. 对外重写内容保留 Codex 识别所需字段，不暴露上游身份

对于 Codex 兼容客户端，我们继续输出它能理解的字段名，但内容做 provider 级重写：

- 继续使用 `x-codex-primary-*` / `x-codex-secondary-*` / `x-codex-credits-*`
- `codex.rate_limits` 事件仍保留原事件名
- 不传上游 OAuth 主体信息、access token 信息或 ChatGPT 账户原始身份
- 如需展示账号信息，只传我们自己的池账号 label / opaque 标识

这是一种“兼容 contract，不兼容 raw source”的做法。

### 6. 前端展示补两层信息

账号详情页和列表页在现有剩余额度基础上，补充：

- `source`：来自 SSE、WS 还是后台刷新
- `observed_at`：最近一次实时观测时间
- 当前是否命中 `primary` / `secondary` 阻断
- 距离解封还有多久
- `plan_type`
- `credits` 是否可用、是否 unlimited、余额

列表页保持克制，只做摘要；详情页承载完整排障信息。

## 数据流

1. `data-plane` 请求上游。
2. SSE 路径从 upstream headers 解析 rate limit；WS 路径从 `codex.rate_limits` 解析。
3. `data-plane` 将观测结果上报 `control-plane internal rate-limits/observed`。
4. `control-plane` 持久化并刷新账号快照 / revision / routing refresh。
5. 账号池下一次选择账号时，直接基于最新 rate limit cache 做可用性判断。
6. 若下游是 Codex 客户端，`data-plane` 将当前 provider 视角的 rate limit 重新编码成 Codex 可识别的头/事件；否则不发私有扩展。

## 风险与处理

- 风险：把 `x-codex-*` 完全删掉会让 Codex 客户端失去自动识别能力。
  - 处理：只对 Codex 兼容客户端重新生成，普通客户端不发。
- 风险：实时观测和后台轮询同时写入，可能互相覆盖。
  - 处理：增加 `source + observed_at`，按“新鲜度更高者优先”合并。
- 风险：WS 注入自定义事件会破坏兼容。
  - 处理：本轮不新增 `codex_pool.*` 自定义事件，只在 Codex 兼容模式下重写成原生 `codex.rate_limits`。
- 风险：前端一次塞太多信息，账号列表会变吵。
  - 处理：列表维持摘要，详情页展示完整上下文。

## 验证

- `data-plane`
  - SSE 响应头不会原样透传上游 raw rate limit 数据。
  - Codex 兼容请求会收到重写后的 `x-codex-*` headers。
  - 普通 API 请求不会收到私有 rate limit 扩展。
  - WS `codex.rate_limits` 能被内部消费，并在需要时重写给 Codex 客户端。
- `control-plane`
  - 实时观测能落入现有 cache / 持久层。
  - 账号被观测到 100% 用尽后，会立刻影响 `effective_enabled` / routing 可用性。
- `frontend`
  - 账号详情可展示 source / observed_at / blocked reason / plan / credits。
  - 所有新增文案走 i18n。
