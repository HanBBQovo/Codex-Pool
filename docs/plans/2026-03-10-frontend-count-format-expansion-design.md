# Frontend Count Format Expansion Design

## 背景

当前项目已经在 admin/tenant Dashboard 中统一了数量类数字展示：

- Dashboard 主展示使用 `K/M/B/T`，固定两位小数
- 时长类指标保留精确两位小数加单位
- token 趋势 tooltip 时间标签不再展示原始时间戳

但非 Dashboard 页面仍然存在多种数量展示写法混用：

- 直接 `toLocaleString()`
- 直接 `toFixed()`
- 通过 `formatNumber()` 展示但未固定两位小数

这会让 `Usage`、`Models`、租户用量摘要等页面的数字观感不一致。

## 目标

只扩展“数量类数字”的统一规则到非 Dashboard 页面：

- 非 Dashboard 页面默认展示精确值：千分位，固定两位小数
- Dashboard 页面继续展示紧凑值：`K/M/B/T`，固定两位小数

## 非目标

本次不调整以下语义不同的数字展示：

- Billing / credits / 金额相关
- 价格倍率
- 百分比
- 文件大小
- 导入吞吐率等带明显单位语义的文案

## 方案

新增一层可复用的“数量类格式 helper”，与现有 Dashboard helper 分工：

- `formatExactCount(...)`
  - 面向非 Dashboard 页面
  - 输出千分位、固定两位小数
- `formatCompactCount(...)`
  - 面向 Dashboard 页面
  - 输出 `K/M/B/T`、固定两位小数

页面层不再直接使用 `toLocaleString()` 或 `toFixed()` 来展示数量类数值。

## 首批接入页面

- `frontend/src/pages/Usage.tsx`
- `frontend/src/tenant/pages/UsagePage.tsx`
- `frontend/src/pages/Models.tsx`
- `frontend/src/features/tenants/tenant-usage-section.tsx`

## 验证

- 新增数量类格式回归脚本，覆盖精确值格式输出
- 运行 `frontend` 的 `lint`
- 运行 `frontend` 的 `build`
