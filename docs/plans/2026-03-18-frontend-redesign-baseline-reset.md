# Frontend Redesign Baseline Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 Codex Pool 前端从“静奢白卡后台”重置为“精编仪表台 · 连续工作面版”，并完成首批关键页面与基础控件的收敛。

**Architecture:** 先重命名设计语言和共享壳层，让基础 tokens、页面原型和表面规则不再默认生成卡片岛；再优先重做 dashboard、auth 和 3 个高频任务页，把新的结构纪律真正落实到页面编排中。实现时优先通过纯函数测试固定视觉契约，再用 lint、build 和浏览器截图做真实观感校验。

**Tech Stack:** React 19、TypeScript、Tailwind v4、Framer Motion、shadcn/ui、Node `--test`、Vite、agent-browser

---

### Task 1: 重命名设计语言为连续工作面契约

**Files:**
- Modify: `frontend/src/lib/design-system.ts`
- Modify: `frontend/src/lib/design-system.test.ts`

**Step 1: Write the failing test**

在 `frontend/src/lib/design-system.test.ts` 中先把旧的材质命名契约改掉，新增断言：

- `accentFamily` 不再强调“器物质感”命名，而是更偏结构化、软件化的强调色族
- `radius.panel` 与 `radius.stage` 再收一档，避免继续鼓励大圆角白卡
- `resolveSurfaceRecipe('stage')` 与 `resolveSurfaceRecipe('panel')` 不再返回强调表面材质，而返回更接近连续工作面与局部区块的语义
- `resolveTableChrome('toolbar')` 和 `resolveTableChrome('header')` 要明显偏向结构线与工作条，而不是工具盘包装感

**Step 2: Run test to verify it fails**

Run:
```bash
shnote --what "运行设计语言契约测试" --why "先固定连续工作面版的新基线语义" run "cd frontend && node --test src/lib/design-system.test.ts"
```

Expected: FAIL，因为当前 tokens 仍沿用上一轮的材质命名与面板逻辑。

**Step 3: Write minimal implementation**

在 `frontend/src/lib/design-system.ts` 中最小实现：

- 将 design language 命名从“材质/器物”切向“结构/工作面”
- stage、panel、sidebar、table 的 recipe 改为连续面、区块面、工作条、结构线等语义
- 收小圆角，降低默认强调层级

**Step 4: Run test to verify it passes**

Run:
```bash
shnote --what "验证连续工作面设计语言" --why "确认新的设计 tokens 已经替换旧的卡片材质契约" run "cd frontend && node --test src/lib/design-system.test.ts"
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/lib/design-system.ts frontend/src/lib/design-system.test.ts
git commit -m "feat(frontend): reset redesign design language" -m "Replace the material-first token baseline with a continuous workspace design contract."
```

### Task 2: 重写全局壳层与背景为连续工作面

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/ui/parallax-background.tsx`

**Step 1: Identify the failing contract**

在 `frontend/src/lib/design-system.test.ts` 中补充或改写断言：

- light/dark canvas tone 都应更接近稳定工作底面，而不是气氛底
- `page-stage-surface`、`page-panel-surface` 和 `page-panel-surface-muted` 的实际视觉职责应从“浮卡”改为“工作底板 / 局部区块 / 结构分层”

**Step 2: Run checks to confirm baseline is still old**

Run:
```bash
shnote --what "验证壳层旧语法仍存在" --why "在改全局样式前先确认测试约束会失败" run "cd frontend && node --test src/lib/design-system.test.ts"
```

Expected: FAIL

**Step 3: Write minimal implementation**

最小实现包括：

- 在 `frontend/src/index.css` 中把全局 page surface 从大白卡逻辑切成更连续的工作底面
- 降低面板之间的独立岛屿感，让局部分区更多依靠分隔线、底色和 inset
- 在 `frontend/src/components/ui/parallax-background.tsx` 中继续收掉一切会把页面导向“背景氛围图”的元素，只保留最弱的空间托底

**Step 4: Run checks**

Run:
```bash
shnote --what "验证全局连续工作面壳层" --why "确认背景与表面重写后测试、lint 和构建都正常" run "cd frontend && node --test src/lib/design-system.test.ts && npm run lint && npm run build"
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/components/ui/parallax-background.tsx frontend/src/lib/design-system.test.ts
git commit -m "feat(frontend): replace redesign shell baseline" -m "Turn the app canvas and shared surfaces into a quieter continuous workspace shell."
```

### Task 3: 重写页面原型与共享壳层语气

**Files:**
- Modify: `frontend/src/lib/page-archetypes.ts`
- Modify: `frontend/src/lib/page-archetypes.test.ts`
- Modify: `frontend/src/components/layout/page-archetypes.tsx`
- Modify: `frontend/src/components/layout/AppLayout.tsx`

**Step 1: Write the failing test**

在 `frontend/src/lib/page-archetypes.test.ts` 中新增断言：

- `dashboard` 的 `stageEmphasis` 必须低于旧版 hero 语气
- `workspace` 与 `settings` 应明确走 continuous / quiet surface，而不是 panel-first
- `auth` 允许品牌化，但布局必须偏单工作面，不再鼓励双 panel 展示

**Step 2: Run test to verify it fails**

Run:
```bash
shnote --what "运行页面原型测试" --why "先固定新基线下的页面语气和区域纪律" run "cd frontend && node --test src/lib/page-archetypes.test.ts"
```

Expected: FAIL

**Step 3: Write minimal implementation**

最小实现包括：

- 在 `frontend/src/lib/page-archetypes.ts` 中新增 continuous workspace 方向的 layout 描述
- 在 `frontend/src/components/layout/page-archetypes.tsx` 中收掉模板化 eyebrow、过大的 intro、统一圆角 panel 和“卡片式 section”
- 在 `frontend/src/components/layout/AppLayout.tsx` 中让 sidebar、topbar、nav item 更像控制台壳体，而不是圆角组件展示架

**Step 4: Run checks**

Run:
```bash
shnote --what "验证共享壳层与页面原型" --why "确认新的页面语气不会破坏测试和构建" run "cd frontend && node --test src/lib/page-archetypes.test.ts && npm run lint && npm run build"
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/lib/page-archetypes.ts frontend/src/lib/page-archetypes.test.ts frontend/src/components/layout/page-archetypes.tsx frontend/src/components/layout/AppLayout.tsx
git commit -m "feat(frontend): recast shared shell surfaces" -m "Shift shared layouts and archetypes from floating panels to continuous workspace surfaces."
```

### Task 4: 重做 dashboard 为连续总览台

**Files:**
- Modify: `frontend/src/pages/Dashboard.tsx`
- Modify: `frontend/src/components/layout/page-archetypes.tsx`
- Reference: `frontend/src/components/ui/button.tsx`
- Reference: `frontend/src/components/ui/select.tsx`

**Step 1: Write the failing test**

在 `frontend/src/lib/page-archetypes.test.ts` 中补一条 dashboard 约束：

- overview 页必须优先表现为“总览编排”，而不是“hero + CTA + KPI 卡片阵列”

如果需要，在 `frontend/src/lib/page-archetypes.ts` 中增加 `overviewMode` 或 `metricPresentation` 一类纯函数描述，并先让测试失败。

**Step 2: Run test to verify it fails**

Run:
```bash
shnote --what "运行 dashboard 编排测试" --why "先把概览页的连续工作面纪律固定下来" run "cd frontend && node --test src/lib/page-archetypes.test.ts"
```

Expected: FAIL

**Step 3: Write minimal implementation**

最小实现包括：

- 缩短 dashboard 页头，不再使用大 hero 语法
- 把当前操作按钮改成更像总览上下文操作，而不是 CTA 排列
- 将 KPI 从独立大卡改成连续读数编排或更薄的统计区块
- 将右侧 pulse / filter panel 改成依附式边注，而不是两张独立白卡

**Step 4: Run checks and capture screenshots**

Run:
```bash
shnote --what "验证 dashboard 连续总览台" --why "确认概览页重构后测试和构建都正常" run "cd frontend && node --test src/lib/page-archetypes.test.ts && npm run lint && npm run build"
```

Run:
```bash
shnote --what "抓取 dashboard 截图" --why "确认 dashboard 已经摆脱白卡首页模板" run "agent-browser --session-name codex-redesign open http://127.0.0.1:5174/dashboard && agent-browser --session-name codex-redesign wait --load networkidle && agent-browser --session-name codex-redesign wait 2500 && agent-browser --session-name codex-redesign screenshot /tmp/codex-dashboard-reset-v2.jpg"
```

Expected: PASS，截图中主观观感应更像总览控制台，而不是 KPI 首页。

**Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard.tsx frontend/src/components/layout/page-archetypes.tsx frontend/src/lib/page-archetypes.ts frontend/src/lib/page-archetypes.test.ts
git commit -m "feat(frontend): redesign dashboard overview surfaces" -m "Recompose the dashboard into a continuous overview workspace instead of a card-based homepage."
```

### Task 5: 重做 auth 为单一登录工作面

**Files:**
- Modify: `frontend/src/components/auth/auth-shell.tsx`
- Modify: `frontend/src/pages/Login.tsx`
- Reference: `frontend/src/components/ui/button.tsx`
- Reference: `frontend/src/components/ui/input.tsx`

**Step 1: Identify the failing contract**

在 `frontend/src/lib/page-archetypes.test.ts` 中补充 auth 约束：

- `auth` 页允许有品牌气息，但视觉结构必须以单一工作面为主
- 任何品牌说明都必须退到边注或次级区，而不是形成第二主角 panel

**Step 2: Run test to verify it fails**

Run:
```bash
shnote --what "运行 auth 结构测试" --why "先固定登录页不再使用双 panel 模板" run "cd frontend && node --test src/lib/page-archetypes.test.ts"
```

Expected: FAIL

**Step 3: Write minimal implementation**

最小实现包括：

- 在 `frontend/src/components/auth/auth-shell.tsx` 中删除双 panel 叙事结构
- 在 `frontend/src/pages/Login.tsx` 中让标题、表单、提示与辅助说明压缩为一个稳定登录面
- 将品牌语言缩成页眉、页脚或边注，不再占据第二块大面板

**Step 4: Run checks and capture screenshots**

Run:
```bash
shnote --what "验证登录工作面重做" --why "确认 auth 收敛后通过 lint 和构建" run "cd frontend && node --test src/lib/page-archetypes.test.ts && npm run lint && npm run build"
```

Run:
```bash
shnote --what "抓取登录页截图" --why "确认登录页已从模板化双 panel 变成单一工作面" run "agent-browser --session-name codex-redesign open http://127.0.0.1:5174/ && agent-browser --session-name codex-redesign wait --load networkidle && agent-browser --session-name codex-redesign wait 1500 && agent-browser --session-name codex-redesign screenshot /tmp/codex-login-reset-v2.jpg"
```

Expected: PASS，截图中登录表单应成为唯一视觉锚点。

**Step 5: Commit**

```bash
git add frontend/src/components/auth/auth-shell.tsx frontend/src/pages/Login.tsx frontend/src/lib/page-archetypes.ts frontend/src/lib/page-archetypes.test.ts
git commit -m "feat(frontend): redesign auth entry baseline" -m "Rebuild the login screen as a single controlled workspace surface."
```

### Task 6: 重做核心控件与数据容器

**Files:**
- Modify: `frontend/src/components/ui/button.tsx`
- Modify: `frontend/src/components/ui/input.tsx`
- Modify: `frontend/src/components/ui/textarea.tsx`
- Modify: `frontend/src/components/ui/select.tsx`
- Modify: `frontend/src/components/ui/card.tsx`
- Modify: `frontend/src/components/ui/standard-data-table.tsx`

**Step 1: Write the failing test or visual contract**

如果组件已有测试则优先补测试；若没有，则在 `frontend/src/lib/design-system.test.ts` 中补充控件视觉语义契约：

- 按钮不允许使用上抬 hover
- 输入框、选择器和表格工具栏要走边界清晰、底色稳定的工作控件路线
- `card.tsx` 若仍被大量依赖，应把默认 card 语义改成“局部分区”而不是“独立浮卡”

**Step 2: Run test to verify it fails**

Run:
```bash
shnote --what "运行控件基线测试" --why "先固定器件化控件的新约束" run "cd frontend && node --test src/lib/design-system.test.ts"
```

Expected: FAIL

**Step 3: Write minimal implementation**

最小实现包括：

- 按钮 hover 改成底色/边界/字色变化，active 更沉
- 输入类控件减少厚 padding 和大圆角，强化字段感
- 表格工具栏和表头从 panel 工具盘改成结构化工作条
- card 组件如果被大量复用，默认继续降包装感

**Step 4: Run checks**

Run:
```bash
shnote --what "验证核心控件重做" --why "确认控件和数据容器收敛后仍可正常构建" run "cd frontend && node --test src/lib/design-system.test.ts && npm run lint && npm run build"
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/components/ui/button.tsx frontend/src/components/ui/input.tsx frontend/src/components/ui/textarea.tsx frontend/src/components/ui/select.tsx frontend/src/components/ui/card.tsx frontend/src/components/ui/standard-data-table.tsx frontend/src/lib/design-system.test.ts
git commit -m "feat(frontend): refine workspace controls" -m "Turn shared controls and data containers into denser, tool-like workspace primitives."
```

### Task 7: 推进 Import Jobs、Models、Config 样板页

**Files:**
- Modify: `frontend/src/pages/ImportJobs.tsx`
- Modify: `frontend/src/pages/Models.tsx`
- Modify: `frontend/src/pages/Config.tsx`

**Step 1: Identify the failing layout contract**

在 `frontend/src/lib/page-archetypes.test.ts` 中补充约束：

- `workspace` 页的主任务区必须是唯一锚点
- `settings` 页必须比 dashboard 和 auth 更安静、更稳定

**Step 2: Run test to verify it fails**

Run:
```bash
shnote --what "运行任务页与设置页测试" --why "先固定工作台和设置页的连续面纪律" run "cd frontend && node --test src/lib/page-archetypes.test.ts"
```

Expected: FAIL

**Step 3: Write minimal implementation**

最小实现包括：

- `ImportJobs.tsx`：把主任务区收束为唯一焦点，说明和帮助退到依附层
- `Models.tsx`：把状态、动作、描述从多 panel 改成连续区块
- `Config.tsx`：去掉任何多余舞台感，做成最安静的系统设置页之一

**Step 4: Run checks and capture screenshots**

Run:
```bash
shnote --what "验证任务页与设置页收敛" --why "确认三类样板页已跟上新基线" run "cd frontend && node --test src/lib/page-archetypes.test.ts && npm run lint && npm run build"
```

Run:
```bash
shnote --what "抓取样板页截图" --why "用真实页面确认 workspace 和 settings 已脱离白卡模板感" run "agent-browser --session-name codex-redesign open http://127.0.0.1:5174/imports && agent-browser --session-name codex-redesign wait --load networkidle && agent-browser --session-name codex-redesign screenshot /tmp/codex-imports-reset-v2.jpg && agent-browser --session-name codex-redesign open http://127.0.0.1:5174/models && agent-browser --session-name codex-redesign wait --load networkidle && agent-browser --session-name codex-redesign screenshot /tmp/codex-models-reset-v2.jpg && agent-browser --session-name codex-redesign open http://127.0.0.1:5174/config && agent-browser --session-name codex-redesign wait --load networkidle && agent-browser --session-name codex-redesign screenshot /tmp/codex-config-reset-v2.jpg"
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/pages/ImportJobs.tsx frontend/src/pages/Models.tsx frontend/src/pages/Config.tsx frontend/src/lib/page-archetypes.ts frontend/src/lib/page-archetypes.test.ts
git commit -m "feat(frontend): align workspace pages with new baseline" -m "Apply the continuous workspace design language to the core task and settings pages."
```

### Task 8: 最终验证与文档回填

**Files:**
- Modify: `docs/plans/2026-03-18-frontend-redesign-baseline-reset.md`
- Modify: `docs/plans/2026-03-18-frontend-redesign-baseline-reset-design.md`
- Modify: `README.md` (only if any user-facing screenshots or wording must be updated)

**Step 1: Mark completed tasks**

回填本计划文档中已完成的任务状态或备注，确保后续会话能直接接续。

**Step 2: Run final verification**

Run:
```bash
shnote --what "运行前端最终验证" --why "在宣称新的前端基线完成前确认所有关键检查都通过" run "cd frontend && node --test src/lib/design-system.test.ts && node --test src/lib/page-archetypes.test.ts && node --test src/lib/motion-presets.test.ts && npm run lint && npm run build"
```

Expected: PASS

**Step 3: Review screenshots**

人工查看 `/tmp/codex-dashboard-reset-v2.jpg`、`/tmp/codex-login-reset-v2.jpg`、`/tmp/codex-imports-reset-v2.jpg`、`/tmp/codex-models-reset-v2.jpg`、`/tmp/codex-config-reset-v2.jpg`，确认：

- 不再有明显白卡模板感
- dashboard 更像总览台
- auth 是单一登录工作面
- settings 是最安静页面

**Step 4: Commit**

```bash
git add docs/plans/2026-03-18-frontend-redesign-baseline-reset.md docs/plans/2026-03-18-frontend-redesign-baseline-reset-design.md README.md
git commit -m "docs(frontend): update redesign execution notes" -m "Capture the final verification evidence and rollout status for the reset baseline."
```
