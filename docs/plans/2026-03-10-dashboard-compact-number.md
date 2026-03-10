# Dashboard Compact Number Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 统一 admin/tenant Dashboard 的数量展示为 `K/M/B/T` 两位小数，并修复 token 使用趋势 tooltip 显示原始时间戳的问题。

**Architecture:** 继续使用 Dashboard 专属格式化工具，但把规则收口为两类能力：精确千分位两位小数、Dashboard 专用 K/M/B/T 两位小数；时长类指标保留精确值加单位。两个 Dashboard 页面仅替换自身 KPI、表格、图表展示入口，不改 Billing 与其他页面。

**Tech Stack:** React 19、TypeScript、Vite、ESLint、Recharts

---

### Task 1: 固化回归检查

**Files:**
- Create: `frontend/scripts/dashboard-number-format.regression.mjs`

**Step 1:** 用回归脚本先锁定新的 Dashboard 数字格式规则。  
**Step 2:** 覆盖趋势 tooltip 时间标签格式，避免再次回归到原始时间戳。  

### Task 2: 收口 Dashboard 专属 helper

**Files:**
- Modify: `frontend/src/lib/dashboard-number-format.ts`

**Step 1:** 统一提供精确千分位两位小数格式。  
**Step 2:** 统一提供 Dashboard 专用 `K/M/B/T` 两位小数格式。  
**Step 3:** 新增时长与趋势 tooltip 时间标签 helper。  

### Task 3: 接入 admin Dashboard

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`

**Step 1:** 替换 KPI 的总量、速率、计数展示。  
**Step 2:** 替换 Top API Keys、token breakdown、token trend、model distribution 的数字展示。  
**Step 3:** 为趋势 tooltip 接入格式化后的时间标签。  

### Task 4: 接入 tenant Dashboard

**Files:**
- Modify: `frontend/src/tenant/pages/DashboardPage.tsx`

**Step 1:** 替换 KPI 的总量、速率、计数展示。  
**Step 2:** 替换 token breakdown、token trend、model distribution 的数字展示。  
**Step 3:** 为趋势 tooltip 接入格式化后的时间标签。  

### Task 5: 验证

**Files:**
- Verify only

**Step 1:** 运行 `npx tsx scripts/dashboard-number-format.regression.mjs`。  
**Step 2:** 运行 `cd frontend && npm run lint`。  
**Step 3:** 运行 `cd frontend && npm run build`。  
