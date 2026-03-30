# Codex-Pool

<p align="center">
  <img src="./frontend/public/favicon.svg" alt="Codex-Pool Logo" width="160" />
</p>

<p align="center">
  <strong>面向自托管场景的 Codex / OpenAI 兼容代理与管理台</strong><br/>
  当前公开稳定支持 <code>personal</code> 版：单二进制、SQLite、内嵌前端。
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Rust-stable-000000?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61dafb?logo=react" alt="Frontend" />
  <img src="https://img.shields.io/badge/License-Apache--2.0-blue" alt="License" />
</p>

## 当前状态

- 当前仓库对外主推的是 `personal`：单实例、单管理员入口、SQLite 存储、内嵌管理台。
- `team` 和 `business` 仍在开发中，仓库里已有部分代码、文档和编排文件，但**暂不作为公开稳定使用路径承诺**。
- 推荐的公开使用方式是：本地构建 `personal` 二进制，配置环境变量后直接运行。

## 它能做什么

Codex-Pool 用于把多个上游账号统一纳入一个管理面和一个兼容入口，对外提供：

- OpenAI / Codex 兼容请求入口
- 管理台中的账号池、日志、导入、模型、代理、计费与系统配置能力
- 针对 OAuth / Session 账号的批量导入、健康循环和状态可视化
- `personal` 形态下的一体化运行：admin UI + control-plane API + `/v1/*` 代理

## 当前公开支持范围

### 稳定公开

- `personal`
  - 单二进制
  - SQLite
  - 无需 PostgreSQL / Redis / ClickHouse / 独立 frontend 容器

### 开发中

- `team`
- `business`

如果你要公开部署或对外文档化，建议默认只写 `personal`，不要把 `team` / `business` 当作已稳定发布能力。

## Personal 快速开始

### 1. 准备依赖

- Rust 工具链
- Node.js 与 npm

### 2. 构建前端静态资源

`personal` 二进制会把 `frontend/dist` 内嵌进去，所以要先构建前端：

```bash
cd frontend
npm ci
npm run build
```

### 3. 构建 `personal` 二进制

```bash
cargo build --release -p control-plane --no-default-features --features sqlite-backend --bin codex-pool-personal
```

产物路径：

```text
target/release/codex-pool-personal
```

### 4. 配置环境变量

可以把 [`docker/.env.personal.example`](./docker/.env.personal.example) 当作参考模板，但推荐你自己创建一份本地环境文件，例如 `.env.runtime`，不要把真实值提交进仓库。

`personal` 至少需要这些变量：

| 变量 | 说明 |
| --- | --- |
| `PERSONAL_SQLITE_PATH` | SQLite 文件路径 |
| `CONTROL_PLANE_INTERNAL_AUTH_TOKEN` | control-plane / data-plane 内部鉴权 token |
| `CONTROL_PLANE_API_KEY_HMAC_KEYS` | API Key HMAC key ring，格式 `kid:base64_secret` |
| `CREDENTIALS_ENCRYPTION_KEY` | 凭据加密密钥，Base64 编码的 32 字节密钥 |
| `ADMIN_PASSWORD` | 管理台管理员密码 |
| `ADMIN_JWT_SECRET` | 管理台 JWT secret |

常用可选变量：

| 变量 | 说明 |
| --- | --- |
| `ADMIN_USERNAME` | 管理台用户名，未显式设置时通常使用 `admin` |
| `PERSONAL_APP_PORT` | 监听端口，常见为 `8090` |
| `RUST_LOG` | 日志级别 |

示例：

```bash
export PERSONAL_SQLITE_PATH="$PWD/codex-pool-personal.sqlite"
export CONTROL_PLANE_INTERNAL_AUTH_TOKEN="$(openssl rand -hex 32)"
export CONTROL_PLANE_API_KEY_HMAC_KEYS="k1:$(openssl rand -base64 32)"
export CREDENTIALS_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="replace-with-your-own-password"
export ADMIN_JWT_SECRET="$(openssl rand -base64 32)"
export PERSONAL_APP_PORT="8090"
export RUST_LOG="info"
```

### 5. 运行

```bash
target/release/codex-pool-personal
```

启动后访问：

- 管理台：`http://127.0.0.1:${PERSONAL_APP_PORT:-8090}`
- 健康检查：`http://127.0.0.1:${PERSONAL_APP_PORT:-8090}/health`

## 通过 GitHub Actions 发布到 GHCR

仓库已提供 [`build-images.yml`](./.github/workflows/build-images.yml)，会在 `main` / `master` 分支 push，或手动触发 `workflow_dispatch` 时构建并推送两个镜像到 GHCR：

- `ghcr.io/<owner>/codex-pool-rust:latest`
- `ghcr.io/<owner>/codex-pool-frontend:latest`

其中：

- `codex-pool-rust` 基于 [`docker/rust-runtime.Dockerfile`](./docker/rust-runtime.Dockerfile) 构建，内含 `control-plane`、`data-plane`、`usage-worker` 三个可执行文件
- `codex-pool-frontend` 基于 [`docker/frontend.runtime.Dockerfile`](./docker/frontend.runtime.Dockerfile) 构建

### 使用前准备

1. 把代码推到 GitHub 仓库。
2. 在 GitHub 仓库设置里确认 `Actions > General > Workflow permissions` 允许工作流写入包。
3. 首次运行后，到仓库的 `Actions` 页面手动触发一次，或直接向 `main` / `master` push。

工作流默认会推送两个 tag：

- `latest`
- `${GITHUB_SHA}`

### 在 Compose 中使用 GHCR 镜像

如果你使用根目录的多服务编排，可以这样指定镜像：

```bash
export CONTROL_PLANE_IMAGE="ghcr.io/<owner>/codex-pool-rust:latest"
export DATA_PLANE_IMAGE="ghcr.io/<owner>/codex-pool-rust:latest"
export USAGE_WORKER_IMAGE="ghcr.io/<owner>/codex-pool-rust:latest"
export FRONTEND_IMAGE="ghcr.io/<owner>/codex-pool-frontend:latest"
docker compose up -d
```

如果你使用 `personal` 或 `team` 编排，只需要覆盖 `CONTROL_PLANE_IMAGE`，例如：

```bash
export CONTROL_PLANE_IMAGE="ghcr.io/<owner>/codex-pool-rust:latest"
docker compose -f docker-compose.personal.yml up -d
```

## 管理员鉴权

管理员登录接口：

```text
POST /api/v1/admin/auth/login
```

请求示例：

```bash
ADMIN_TOKEN="$(
  curl -fsS http://127.0.0.1:8090/api/v1/admin/auth/login \
    -H 'Content-Type: application/json' \
    -d '{
      "username": "admin",
      "password": "replace-with-your-own-password"
    }' | jq -r '.access_token'
)"
```

后续调用管理接口时带上：

```text
Authorization: Bearer <ADMIN_TOKEN>
```

注意：批量上传账号接口虽然路径不在 `/api/v1/admin/*` 下，但它同样要求管理员鉴权。

## 批量上传账号

接口：

```text
POST /api/v1/upstream-accounts/oauth/import-jobs
```

请求格式：

- `multipart/form-data`
- 支持上传 `.json` 或 `.jsonl`
- 文件字段可用 `file`、`files` 或 `files[]`

常用表单字段：

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| `credential_mode` | `refresh_token` / `access_token` / `auto` | 后端默认 `auto`，前端默认 `refresh_token` |
| `mode` | 上游模式，例如 `chat_gpt_session` / `codex_oauth` | `chat_gpt_session` |
| `base_url` | 上游基地址 | `https://chatgpt.com/backend-api/codex` |
| `default_priority` | 默认优先级 | `100` |
| `default_enabled` | 默认启用状态 | `true` |

### 最小字段要求

#### RT 模式

当 `credential_mode=refresh_token` 时，每条记录最少只需要：

```json
{
  "refresh_token": "rt_xxx"
}
```

建议同时提供这些字段，便于后续运营和去重：

- `chatgpt_account_id`
- `email`
- `label`
- `access_token` 或 `bearer_token` 作为 fallback access token
- `mode`
- `base_url`

说明：

- 如果缺少 `label`，后端会自动派生一个标签。
- 如果缺少 `base_url`、`priority`、`enabled`，后端会使用默认值。
- `refresh_token` 也支持一批常见别名，例如 `refreshToken`、`rt`。

#### AK 模式

当 `credential_mode=access_token` 时，每条记录最少只需要：

```json
{
  "access_token": "eyJ..."
}
```

也接受这些同义字段：

- `bearer_token`
- `token`
- `accessToken`

建议同时提供：

- `chatgpt_account_id`
- `label`
- `exp` 或 `expired`
- `mode`
- `base_url`

说明：

- 如果 `access_token` 是 JWT，后端会尝试从 token 里推导过期时间。
- 如果同时给了 `exp` 或 RFC3339 格式的 `expired`，会优先使用它们。

### 上传示例

#### 1. RT 模式 JSONL 示例

`accounts-rt.jsonl`

```json
{"refresh_token":"rt_example_1","chatgpt_account_id":"acct_example_1","label":"rt-example-1"}
{"refresh_token":"rt_example_2","access_token":"eyJ...","email":"user2@example.com"}
```

调用：

```bash
curl -fsS http://127.0.0.1:8090/api/v1/upstream-accounts/oauth/import-jobs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "files[]=@accounts-rt.jsonl" \
  -F "credential_mode=refresh_token" \
  -F "mode=chat_gpt_session" \
  -F "base_url=https://chatgpt.com/backend-api/codex"
```

#### 2. AK 模式 JSON 示例

`accounts-ak.json`

```json
[
  {
    "access_token": "eyJ...",
    "chatgpt_account_id": "acct_ak_1",
    "label": "ak-example-1",
    "exp": 1893456000
  },
  {
    "bearer_token": "eyJ...",
    "label": "ak-example-2"
  }
]
```

调用：

```bash
curl -fsS http://127.0.0.1:8090/api/v1/upstream-accounts/oauth/import-jobs \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "files[]=@accounts-ak.json" \
  -F "credential_mode=access_token" \
  -F "mode=chat_gpt_session" \
  -F "base_url=https://chatgpt.com/backend-api/codex"
```

### 导入后查询任务状态

```text
GET /api/v1/upstream-accounts/oauth/import-jobs/{job_id}
GET /api/v1/upstream-accounts/oauth/import-jobs/{job_id}/items
POST /api/v1/upstream-accounts/oauth/import-jobs/{job_id}/retry-failed
POST /api/v1/upstream-accounts/oauth/import-jobs/{job_id}/pause
POST /api/v1/upstream-accounts/oauth/import-jobs/{job_id}/resume
POST /api/v1/upstream-accounts/oauth/import-jobs/{job_id}/cancel
```

这些接口都需要同一个管理员 Bearer Token。

## API 兼容面

当前项目主要兼容这些入口：

- `POST /v1/responses`
- `GET /v1/responses`
- `POST /backend-api/codex/responses`
- `GET /backend-api/codex/responses`
- `POST /v1/chat/completions`
- `GET /v1/models`

更细的兼容矩阵后续会单独补充到公开文档中；当前以仓库代码与实际接口行为为准。

## 仓库内仍在演进的部分

以下内容目前仍保留在仓库里，但不建议当作公开稳定承诺：

- `team` / `business` 相关二进制与部署路径
- 多服务 Docker Compose 编排
- 部分内部规划文档与开发辅助脚本

如果你只是想稳定自托管使用，优先看本 README 的 `personal` 路径即可。

## 项目结构

```text
.
├── crates/
│   └── codex-pool-core/          # 共享模型与 DTO
├── services/
│   ├── control-plane/            # 管理面 API / 导入 / 配置 / 模型 / 代理
│   └── data-plane/               # 对外兼容代理入口
├── frontend/                     # 内嵌管理台前端
├── docker/                       # Dockerfile 与示例环境变量
└── scripts/                      # 开发与运维辅助脚本
```

## License

Apache-2.0
