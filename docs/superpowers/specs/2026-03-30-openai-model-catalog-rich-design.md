# OpenAI 模型目录富同步与抽屉详情设计

## 目标

把 OpenAI 官方模型目录同步升级为“列表有摘要、抽屉有全量详情”的工作台能力，并把模型头像 PNG 拉回仓库内的运行时目录，由后端托管成本地资源，保证同步后立即可见。

## 背景

当前 `Models` 页面只有基础表格和简单详情模态。后端同步也只覆盖标题、描述、窗口、价格、模态、端点等基础字段，无法支撑更完整的模型运营视图。

OpenAI 官方当前的模型信息分成两层：

- `all` 目录页：
  - 提供头像、模型名、tagline、模型家族/分组、目录卡片结构
- 单模型页：
  - 提供 `Pricing / Modalities / Endpoints / Features / Tools / Snapshots` 等详情 section

我们需要把这两层信息合并进现有 admin 工作台，并保持 `personal` 单二进制形态下同步后立即生效。

## 设计原则

- 保持 admin 工作台风格：专业、克制、清晰，不做营销页式夸张渲染
- 列表只显示高价值摘要，避免信息淹没
- 详情抽屉承载全量字段，减少路由跳转
- 同步后的头像资源必须立即可用，不依赖前端重新 build
- 优先使用 OpenAI 页面 SSR 内容与稳定资源路径，降低对前端私有 bundle 实现细节的耦合

## 信息架构

### 列表页

`Models` 页面改成分组目录卡片流：

- 顶部保留：
  - 搜索
  - provider 过滤
  - availability 过滤
  - 同步目录
  - 可用性探测
- 主体按模型家族分组：
  - `Frontier`
  - `Image`
  - `Video`
  - `Realtime & Audio`
  - `Coding`
  - `Deep research`
  - `More models`
- 卡片摘要字段：
  - 头像
  - 显示名
  - 模型 id
  - tagline
  - provider
  - availability
  - 价格摘要
  - 输入/输出模态摘要
  - 关键端点
  - 关键能力/工具徽标

### 详情抽屉

点击任一模型卡片，右侧打开大抽屉。抽屉信息按 section 呈现：

- `Overview`
  - 头像
  - 显示名
  - 模型 id
  - tagline
  - 描述
  - provider
  - availability
  - 同步时间
  - 复制 id
  - 打开官方页面
- `Pricing`
  - input / cached input / output
  - pricing notes
  - 手动 override 来源
- `Modalities`
  - input / output
- `Endpoints`
  - 支持端点
- `Features`
  - 支持能力与是否支持
- `Tools`
  - Responses API 下的工具能力
- `Snapshots`
  - 当前 alias
  - 具体 snapshot 列表

## 数据模型设计

### 列表摘要字段

为 `OpenAiModelCatalogItem` 新增：

- `display_name: Option<String>`
- `tagline: Option<String>`
- `family: Option<String>`
- `avatar_remote_url: Option<String>`
- `avatar_local_path: Option<String>`
- `avatar_synced_at: Option<DateTime<Utc>>`
- `deprecated: Option<bool>`
- `supported_features: Vec<String>`
- `supported_tools: Vec<String>`
- `snapshots: Vec<String>`
- `max_input_tokens: Option<i64>`

### 详情补充字段

继续保留并补强：

- `description`
- `context_window_tokens`
- `max_output_tokens`
- `knowledge_cutoff`
- `reasoning_token_support`
- `input_price_microcredits`
- `cached_input_price_microcredits`
- `output_price_microcredits`
- `pricing_notes`
- `input_modalities`
- `output_modalities`
- `endpoints`
- `source_url`

## 同步策略

### 目录同步

从 `all` 目录页提取：

- 模型分组
- 模型卡片顺序
- 显示名
- tagline
- 头像资源路径

### 详情同步

从单模型页提取：

- pricing 区块
- modalities 区块
- endpoints 区块
- features 区块
- tools 区块
- snapshots 区块

### 头像资源同步

头像 PNG 不落到 `frontend` 静态资源目录，而落到仓库内运行时目录，由 control-plane 直接托管：

- 建议目录：
  - `runtime-assets/openai-model-icons/`
- 同步行为：
  - 根据官方头像路径下载 PNG
  - 写入本地文件
  - 更新 catalog 中的本地相对路径
  - 前端通过本地托管 URL 访问

这样在 `personal` 下，前端点击“同步自 OpenAI”后即可立即看到最新头像，不需要重新 build/restart。

## 前端交互设计

- 保留现有工作台顶部动作和过滤器，避免牺牲运营效率
- 模型卡片 hover 有轻量高亮，不使用浮夸 motion
- 抽屉使用现有共享 `Dialog` 抽屉壳，沿用项目内 UI preference 的 drawer placement
- 小图标不直接内嵌官网原始 DOM，而在前端本地化为 React SVG 组件，保证风格统一和可维护性

## 后端兼容性

- `personal`
  - 必须支持本地目录写入与静态托管
  - 不引入额外服务依赖
- `team / business`
  - 使用同一 catalog 契约
  - Postgres 与 SQLite 都要能保存新字段

## 风险与取舍

- 官网 bundle 变量名有变动风险，因此详情同步优先解析单模型页 SSR section，bundle 只作为补充来源
- 头像资源量会增加，需要限制只同步 catalog 中实际存在的官方模型头像
- 卡片流替代表格后，信息密度下降的问题通过搜索、过滤、摘要徽标和详情抽屉补回来

## 验收标准

- 同步后模型数量不再只停留在基础 10 个
- 列表页能展示头像、显示名、tagline、价格摘要和关键能力摘要
- 详情抽屉能展示完整 `Pricing / Modalities / Endpoints / Features / Tools / Snapshots`
- 头像从本地托管 URL 访问，点击同步后无需重新 build 即可刷新
- 前后端检查通过：
  - `cargo check -p control-plane`
  - `cargo check -p data-plane`
  - `cd frontend && npm run i18n:check`
  - `cd frontend && npm run i18n:hardcode -- --no-baseline`
  - `cd frontend && npm run i18n:runtime-check`
  - `cd frontend && npm run lint`
  - `cd frontend && npm run build`
