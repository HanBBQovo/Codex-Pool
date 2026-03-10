# Frontend Count Format Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把非 Dashboard 页面中的数量类数字统一为“千分位精确值，固定两位小数”，同时保持 Dashboard 继续使用 `K/M/B/T` 两位小数。

**Architecture:** 在现有 `dashboard-number-format.ts` 之外新增或抽出更通用的数量类格式 helper，让非 Dashboard 页面使用精确值格式，Dashboard 继续复用紧凑值格式。页面侧仅替换用户可见的数量展示入口，不改 Billing/credits/百分比/文件大小等语义不同的数字格式。

**Tech Stack:** React 19、TypeScript、Vite、ESLint、Recharts

---

### Task 1: 固化数量类回归检查

**Files:**
- Modify: `frontend/scripts/dashboard-number-format.regression.mjs`
- Create: `frontend/scripts/count-format.regression.mjs`

**Step 1:** 为非 Dashboard 的精确数量格式补最小回归脚本。  
**Step 2:** 先运行脚本，确认旧行为未满足“固定两位小数”的预期。  
**Step 3:** 修改实现后再次运行，确认回归脚本转绿。  

### Task 2: 实现通用数量格式 helper

**Files:**
- Modify: `frontend/src/lib/i18n-format.ts`
- Create or Modify: `frontend/src/lib/count-number-format.ts`

**Step 1:** 提供精确数量格式函数，统一输出千分位与两位小数。  
**Step 2:** 保持 locale 解析与现有 i18n 逻辑一致。  
**Step 3:** 不影响 Billing/credits 等已有格式化函数。  

### Task 3: 接入 admin Usage 与 tenant Usage

**Files:**
- Modify: `frontend/src/pages/Usage.tsx`
- Modify: `frontend/src/tenant/pages/UsagePage.tsx`

**Step 1:** 替换 requests 等数量类列的展示。  
**Step 2:** 保留 share 百分比等非数量格式。  
**Step 3:** 确认表格主展示统一为精确两位小数。  

### Task 4: 接入 Models 与租户用量摘要

**Files:**
- Modify: `frontend/src/pages/Models.tsx`
- Modify: `frontend/src/features/tenants/tenant-usage-section.tsx`

**Step 1:** 替换模型 token 窗口、输出上限等数量类展示。  
**Step 2:** 替换租户摘要里的 request / account / api key 计数展示。  
**Step 3:** 不改页面里非数量语义的文案。  

### Task 5: 验证

**Files:**
- Verify only

**Step 1:** 运行 `npx tsx scripts/dashboard-number-format.regression.mjs`。  
**Step 2:** 运行 `npx tsx scripts/count-format.regression.mjs`。  
**Step 3:** 运行 `cd frontend && npm run lint`。  
**Step 4:** 运行 `cd frontend && npm run build`。  
