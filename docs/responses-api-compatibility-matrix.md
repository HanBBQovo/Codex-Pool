# Responses API 兼容矩阵

本文档描述 `Codex-Pool` 对外暴露的 OpenAI `Responses API` 在 `Codex profile` 上的兼容行为。这里的 “Codex profile” 指上游账号模式为 `ChatGptSession` / `CodexOauth`，且上游基路径为 `.../backend-api/codex`。

## 兼容等级

- `supported`：无需特殊兼容即可工作，或已具备稳定回归测试。
- `adapted`：通过代理层改写后稳定支持，并有回归测试。
- `conditional`：可工作，但有明确前提或注意事项。
- `known-gap`：当前仍有限制，不能当成稳定承诺。

## 支持入口

- `POST /v1/responses`
- `GET /v1/responses/{response_id}`
- `GET /v1/responses/{response_id}/input_items`
- `POST /v1/responses/{response_id}/cancel`
- `POST /v1/responses/input_tokens`
- `GET /v1/responses`（WebSocket Upgrade）
- `POST /v1/responses/compact`
- `POST /backend-api/codex/responses`
- `GET /backend-api/codex/responses`（WebSocket Upgrade）

## 能力矩阵

| 能力 | 下游入口 | Codex profile 代理行为 | 等级 | 证据 |
| --- | --- | --- | --- | --- |
| 基础文本响应 | `POST /v1/responses` | 路径改写到 `/backend-api/codex/responses`，必要时补 `instructions`、规范化 `input` | `adapted` | `services/data-plane/tests/compatibility.rs::adapts_openai_non_stream_responses_request_for_codex_profile` |
| SSE 流式响应 | `POST /v1/responses` + `stream=true` | 透传为上游流式，并保留 SSE 返回 | `adapted` | `services/data-plane/tests/compatibility.rs::adapts_openai_streaming_responses_request_for_codex_profile` |
| 非流式桥接 | `POST /v1/responses` + 默认非流式 | 上游仍可走流式，代理提取 `response.completed` 后回写标准 JSON | `adapted` | `services/data-plane/tests/compatibility.rs::adapts_openai_non_stream_responses_request_for_codex_profile` |
| Function calling | `POST /v1/responses` | 保留工具调用相关 JSON 结构，兼容 Codex 路径 | `adapted` | 本地 OpenAI Python SDK 联调已通过 |
| Structured output / JSON schema | `POST /v1/responses` | 保留结构化输出相关 JSON 结构 | `adapted` | 本地 OpenAI Python SDK 联调已通过 |
| `previous_response_id`（HTTP） | `POST /v1/responses` | 保留 continuation 锚点；若上游返回 `previous_response_not_found`，代理同账号重试并去掉 stale 锚点 | `adapted` | `preserves_first_turn_storage_so_previous_response_id_continues_without_retry_rewrite`、`recovers_http_responses_from_previous_response_not_found_without_reusing_stale_id` |
| `previous_response_id`（compact） | `POST /v1/responses/compact` | 保留 continuation 锚点；若上游返回 `previous_response_not_found`，代理同账号重试并去掉 stale 锚点 | `adapted` | `recovers_compact_responses_from_previous_response_not_found_without_reusing_stale_id` |
| `previous_response_id`（WebSocket） | `GET /v1/responses` | 作为 continuation / sticky 锚点；`previous_response_not_found` 时会重放必要帧并去掉 stale 锚点 | `adapted` | `services/data-plane/tests/compatibility_ws.rs::ws_session_recovers_from_previous_response_not_found_without_reusing_stale_id` |
| response retrieve | `GET /v1/responses/{response_id}` | 对已存储的普通/后台 response 返回标准 JSON；`store=false` 不可检索 | `adapted` | `retrieves_stored_http_response_by_response_id`、`does_not_retrieve_http_responses_when_store_is_false` |
| response input items | `GET /v1/responses/{response_id}/input_items` | 返回已存储 response 的输入项列表，支持 `limit/order/after` 分页参数 | `adapted` | `lists_input_items_for_stored_response` |
| response cancel | `POST /v1/responses/{response_id}/cancel` | 仅允许取消 `background=true` 的 response；对后台 response 标记 `cancelled`，后续上游完成不会覆盖已取消状态 | `adapted` | `cancels_background_responses_before_completion`、`does_not_cancel_non_background_responses` |
| `background=true` | `POST /v1/responses` | `store=false` 会被显式拒绝；普通 background 立即返回 `queued` response，后台排队自调用本地 `/v1/responses` 执行，并可通过 retrieve/cancel 管理 | `adapted` | `completes_background_responses_and_makes_them_retrievable`、`rejects_background_responses_when_store_is_false` |
| `background=true` + `stream=true` | `POST /v1/responses` | 立即返回 SSE；代理为 background 响应生成本地稳定 `response_id`，记录事件序列，并支持后续 retrieve/续流 | `adapted` | `streams_background_responses_and_supports_starting_after_resume` |
| background streaming retrieve/resume | `GET /v1/responses/{response_id}?stream=true&starting_after=...` | 对 background stream 回放已记录的 SSE 事件，并从 `starting_after` 之后续流 | `adapted` | `streams_background_responses_and_supports_starting_after_resume` |
| `conversation` 参数 | `POST /v1/responses` | 代理在本地维护 `conversation -> latest response_id` 游标，并自动补出续链所需的 `previous_response_id`；不会原样透传给 Codex 上游 | `adapted` | `conversation_reuses_last_response_id_without_explicit_previous_response_id` |
| `input_tokens` 计数 | `POST /v1/responses/input_tokens` | 复用本地请求体估算逻辑返回 `response.input_tokens` | `adapted` | `counts_input_tokens_for_responses_payloads` |
| `compact` 路径改写 | `POST /v1/responses/compact` | 路径改写到 `/backend-api/codex/responses/compact` | `adapted` | `services/data-plane/tests/compatibility.rs::rewrites_v1_responses_compact_to_codex_responses_compact_for_codex_base_profile` |
| `service_tier=fast` | HTTP / WS `Responses` | 归一化成 Codex 可接受的 `priority` | `adapted` | `services/data-plane/tests/compatibility.rs::codex_profile_fast_service_tier_flows_into_pricing_and_request_log`、`services/data-plane/tests/compatibility_ws.rs::ws_upgrade_v1_responses_maps_fast_service_tier_to_priority_for_codex_profile` |
| `max_output_tokens` | HTTP / compact `Responses` | 当前按调用方原值保留并透传给 Codex profile，不再静默删除 | `adapted` | `adapts_openai_non_stream_responses_request_for_codex_profile`、`adapts_openai_streaming_responses_request_for_codex_profile`、`rewrites_v1_responses_compact_to_codex_responses_compact_for_codex_base_profile` |
| `input_image` / 多模态 | `POST /v1/responses` | 标准 `input_image` 内容块随 `input` 数组透传；字符串 `input` 仍只做文本标准化 | `adapted` | `passes_input_image_items_through_for_codex_profile` |

## Codex profile 下的请求改写规则

对 `POST /v1/responses`：

- 若缺少 `instructions`，自动补空字符串。
- 若 `input` 是字符串，归一化成标准消息数组。
- 若 `input` 已经是标准消息数组（包括 `input_image` 等多模态内容块），保持其结构不变。
- 若下游非流式，代理会让上游走流式并桥接回标准 JSON。
- `service_tier=fast` 会被归一化成 `priority`。
- `max_output_tokens` 会按调用方原值保留并透传。
- 若携带 `conversation`，只在代理本地用它维护续链游标，不会原样透传给 Codex 上游。
- 不再默认强制插入 `store=false`。
- 若 `background=true`，显式 `store=false` 会返回 `400 background_requires_store`。
- 若同时携带 `background=true` 和 `stream=true`，代理会把首轮请求作为 SSE 返回，并为该 background response 记录可续流的事件序列。

对 `POST /v1/responses/compact`：

- 路径改写到 `/backend-api/codex/responses/compact`。
- 若缺少 `instructions`，自动补空字符串。
- 若 `input` 是字符串，归一化成标准消息数组。
- 若 `input` 已经是标准消息数组（包括多模态内容块），保持其结构不变。
- 当前仍会移除 `stream`。
- `max_output_tokens` 会按调用方原值保留并透传。
- 若请求显式携带 `store`，当前 compact 兼容层会移除该字段；因此它仍是更保守的 `conditional` 能力。

## continuation 说明

`previous_response_id` 现在被视为一等 continuation 锚点，而不是仅仅作为弱粘性提示：

- HTTP / WS / compact 都会解析它并参与 continuation / sticky 选择。
- 若上游返回 `previous_response_not_found`，代理会优先做同账号最小恢复，而不是直接跨账号失败切换。
- 最小恢复只会去掉 stale `previous_response_id`，不会重写其余业务字段。

需要注意：

- 真正的多轮续链仍依赖上游能够识别该锚点。
- 对普通 `Responses`，代理现在保留 `store` 的省略语义，不再人为把第一轮请求改成 `store=false`。
- 对 `compact`，若你强依赖显式 `store` 语义，当前仍应视为 `conditional` 能力。
- `conversation` 是代理层本地兼容语义：它最终仍会落成具体的 `previous_response_id`，而不是直接交给 Codex 上游理解。

## 已知限制

- `compact` 对显式 `store` 的保留还没有完全对齐普通 `Responses`。
- `GET /v1/responses/{response_id}?stream=true` 当前仅对 `background=true && stream=true` 创建出的 response 提供续流恢复；普通同步 `stream=true` 请求尚未纳入 retrieve 流视图。
- retrieve / cancel / background 当前是 data-plane 进程内运行时存储，默认保留 24 小时；它们在进程重启后不会跨进程恢复。
- 本矩阵只描述 `Codex profile` 的兼容行为；非 Codex 上游会走普通 OpenAI 代理链路，不受这里的字段改写规则约束。
