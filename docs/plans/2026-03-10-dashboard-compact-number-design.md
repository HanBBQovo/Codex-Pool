# Dashboard Compact Number Design

**日期：** 2026-03-10

## 背景

当前 Dashboard 中有两套大数字展示路径：

- `frontend/src/pages/Dashboard.tsx` 与 `frontend/src/tenant/pages/DashboardPage.tsx` 内部的 `formatMetric`
- `frontend/src/lib/token-format.ts` 提供的 token 紧凑格式化

其中 token 格式化目前只支持到 `M`，当数值达到 `1B` 及以上时，Dashboard 里会继续显示为 `1000M+`，不符合预期。

## 目标

仅在 Dashboard 范围内，将紧凑数字展示扩展为：

- `K`
- `M`
- `B`
- `T`
- 更高数量级继续按相同规则递增

并保持 Billing 等非 Dashboard 页面不受影响。

## 方案对比

### 方案 A（采用）

新增 Dashboard 专属数字格式化工具，只在两个 Dashboard 页面中接入。

**优点：**

- 完全满足“仅限 Dashboard”
- 不会影响 Billing、报表等复用 `token-format.ts` 的页面
- 后续 Dashboard 想单独调展示规则也更容易

**缺点：**

- 会多出一份 Dashboard 专用格式化逻辑

### 方案 B

直接扩展 `frontend/src/lib/token-format.ts` 的单位逻辑。

**优点：**

- 复用统一

**缺点：**

- 会影响 Billing 等非 Dashboard 页面，超出本次范围

### 方案 C

只修改两个页面内原有的 `formatMetric`，不处理 token 数字。

**优点：**

- 改动最少

**缺点：**

- `TPM`、`Token total`、图表 tooltip/摘要里的 token 数字问题仍然存在

## 最终设计

新增 `frontend/src/lib/dashboard-number-format.ts`，提供 3 个仅供 Dashboard 使用的函数：

- `formatDashboardMetric`
- `formatDashboardTokenCount`
- `formatDashboardTokenRate`

规则：

- `RPM` 这类指标从 `1,000` 开始使用紧凑单位
- token 总量/速率从 `1,000,000` 开始使用紧凑单位
- 当单位四舍五入达到 `1000` 时自动晋升到下一个单位，避免出现 `1000M`

接入范围：

- admin Dashboard KPI、token breakdown、token chart tooltip、model distribution token tooltip
- tenant Dashboard 对应位置

## 非目标

- 不修改 Billing 页面
- 不修改全局通用数字格式化逻辑
- 不新增 i18n 文案

## 验证

由于当前前端仓库没有独立测试脚本，本次以以下方式验证：

- `cd frontend && npm run lint`
- `cd frontend && npm run build`
