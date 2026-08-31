# ADR-129：3D 预览领域根升格（utils/3d → features/preview-3d，修依赖倒置）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-29
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/ (adapters/state/caps/perception), frontend/src/views/app-preview/, frontend/AGENTS.md (features 约定), state/preview-state.ts:30 (依赖倒置点), ADR-128`

---

## 1. 背景（Context）

### 1.1 utils/3d 名不副实（体量倒挂）

`frontend/AGENTS.md` 定义 `utils/` 为「工具函数」目录（`dom/format/icon/async/cache/debug` 等小而纯的函数）。实测（2026-08-29）：

| 层 | 文件 | 行数 | 语义 |
|----|------|------|------|
| `utils/3d` | 198 | 46124 | 号称工具，实为领域子系统 |
| `views/app-preview`（它服务的视图正主） | 73 | 11667 | 视图层 |

`utils` 顶层其它子目录才是真·工具的正常体量：`async` 2 文件 52 行、`cache` 2 文件 236 行、`format` 9 文件 1176 行、`core` 10 文件 725 行。唯独 `3d` 是 198 文件 4.6 万行——**大象挤进杂物间**，体量是同级工具的 9–40 倍，是它服务的视图层的 4 倍。本末倒置：号称支撑视图的「工具」，体量是视图本身 4 倍。

### 1.2 依赖倒置（架构债）

`state/preview-state.ts:30` 反向 import `adapters/preview-menu-node-types.ts` 的核心领域类型：

```ts
import type { PreviewStatePath, PreviewSnapshot } from "../adapters/preview-menu-node-types.ts";
```

状态层（`state/`）该是地基，却依赖 `adapters` 的类型——`PreviewSnapshot` / `PreviewStatePath` 这些核心领域类型被错埋在 `adapters/preview-menu-node-types.ts`，**地基建在楼上**。这是归属错位的直接产物：领域类型该住 `state`，却因整个 3d 子树挤在 `utils/adapters`，类型也跟着埋错层。

### 1.3 adapters 平铺成墙

`utils/3d/adapters` 单目录 78 文件平铺，`preview-menu-*` 前缀独占 17 个（5039 行）、`mmd-*` 12 个（5623 行）。文件名靠 `preview-menu-` 前缀重复打遍每个文件（本该是目录名），15+ 个同前缀文件平铺成墙，找文件靠滚轮。命名风格还分裂：`preview-menu-roles.test.ts`（全横线）与 `preview-menu.roles.test.ts`（点分隔）并存。

### 1.4 痛点

- **归属错位**：3D 预览是有类型系统 / 注册表 / 渲染器 / 状态层 / 适配器族的完整领域模块，塞在 `utils/` 下，语义误导后来者「这是小工具可随手改」。
- **依赖倒置**：`state` 寄生 `adapters`，改 `adapters` 类型会震 `state`，方向反了。
- **平铺膨胀**：`adapters` 78 文件平铺且仍在增长（ADR-128 的图生成器 / 谓词收集器还要加），越拖债越大。

---

## 2. 决策（Decision）

**把 `utils/3d` 整体升格为独立领域根 `features/preview-3d`，内部按职责分子目录，顺带修依赖倒置与平铺膨胀。** 升格是归属正名，不改变既有代码逻辑，只改物理位置与依赖方向。符合 `frontend/AGENTS.md`「新业务模块放 `features/`」既有规约。

### 2.1 目标结构

```
features/preview-3d/
├── menu/        ← preview-menu-* 家族（类型/渲染器/注册表/角色详情/cap 控件）
├── adapters/   ← ysm/mmd/vrm/fbx/litematic 适配器
├── caps/       ← cap 控件系统
├── state/      ← 状态层（PreviewSnapshot/PreviewStatePath 定义迁回此处，正地基）
└── perception/
```

升格后路径变短（`utils/3d/adapters/preview-menu-node-types.ts` → `features/preview-3d/menu/node-types.ts`）；依赖方向正（`state` 是 `menu` / `adapters` 的地基，不反向）。

### 2.2 三刀路线（分阶段决策，非实施进度）

全量迁移 198 文件 4.6 万行风险在广度，不能一把梭。按「高价值低风险优先」分三刀，每刀独立可落地、可回退：

| 刀 | 内容 | 风险 | 顺序理由 |
|----|------|------|---------|
| **第一刀** | `PreviewSnapshot` / `PreviewStatePath` 从 `adapters/preview-menu-node-types.ts` 迁到 `state/`，修依赖倒置 | 低 | 最小高价值：只动类型归属，不改目录结构；import 影响面约 20 处（`adapters` 内部 + `views/app-preview`），改相对路径机械安全；做完 `state` 不再寄生 `adapters`，地基正回 |
| **第二刀** | `preview-menu-*` 收进 `adapters/preview-menu/` 子目录，内部去前缀，统一测试命名 | 中 | 降墙：内部互引为主（81 处 import 里大头是同目录 `./`），搬子目录后相对路径不变；外部约 9 处改前缀；顺手统一横线 / 点命名分裂。**落地取舍（2026-08-31 评审后）**：家族已进一步上提为顶层 `features/preview-3d/menu/`（对齐 §2.1 目标图），`adapters/preview-menu/` 为中间态非终态 |
| **第三刀** | `utils/3d` 整体升格 `features/preview-3d`，改外部引用前缀 | 高 | 归属正名：改 `../../utils/3d/` → `../../features/preview-3d/`；广度最大，需发版前全量 `doctor` 兜底；**验收标准含 scripts/tests 门禁脚本锚点同步 + 30+ 知识卡 `source_files` 批量更新**（见 §3.2 长尾行）；当天一刀切完，不留 `utils/3d` 与 `features/preview-3d` 并存双轨 |

顺序的不可逆约束：**第一刀必须在第二、三刀之前**——正名不正骨，搬完仍是 `features/preview-3d/adapters` 持有 `state` 的类型，债跟着搬。第二、三刀可换序，但第三刀广度大，建议第二刀降墙后再做（子目录收敛后 import 路径更规整，第三刀替换面更小）。

### 2.3 关键约束

- **只改物理位置与依赖方向，不改业务逻辑**：三刀都不动渲染 / 状态 / 适配器实现，只搬目录、改 import、修类型归属。逻辑行为由既有测试（`vitest` + 契约）守。
- **每刀独立可回退**：第一刀失败只影响类型位置，`git checkout` 单文件即回；第二刀失败只影响 `preview-menu` 子目录；第三刀失败影响面广但纯路径迁移，可整目录回退。
- **不引入新机制**：本 ADR 是归属与依赖方向修正，复用既有 `PreviewMenuNode` / `PreviewSnapshot` / `schemaId` 类型契约，不新增抽象。
- **工具层与领域层的边界**：升格后 `utils/` 只留纯工具（`dom/format/icon/async/cache/debug/core/resource/animation`），任何带状态 / 注册表 / 渲染器的子系统一律进 `features`。

### 2.4 不在本 ADR 范围

- 菜单导航图生成器 / e2e 选择器派生——ADR-128 范畴；本 ADR 只为其正地基（第一刀修 `PreviewSnapshot` 归属后，ADR-128 图遍历吃正位 `state`）。
- 闭包 `routers.schemaBuilders` 6 builder 迁进 `schema-registry`——ADR-128 §2.4 子任务；本 ADR 不涵盖（但第二刀收进子目录后，该子任务影响面更小）。
- `mmd` / `vrm` / `fbx` 家族是否进一步分子目录——第二刀聚焦 `preview-menu-*`；`mmd-*` 前缀已够领域化，可后续单独评估。
- **views/app-preview 领域逻辑归属待定（第四刀候选）**：`skeleton-render.ts:202` 的 `toScreenshotLights()` 等纯领域函数仍住视图层（截图灯光逻辑一半 `utils/3d/screenshot.ts`、一半 `views/app-preview/skeleton-render.ts`）。升格 `features/preview-3d` 后「领域逻辑一半在 features 一半在 views」的撕裂会被本 ADR 制度化。本 ADR 不修（控爆炸半径），但点名此为后续第四刀候选——**边界未划完，下一个翻 ADR 的人勿以为 views/app-preview 已归位**。

---

## 3. 后果（Consequences）

### 3.1 正面

- **utils 回归真·工具**：`dom/format/icon/async` 等体量干净，语义不再误导后来者。
- **3D 预览成独立领域根**：依赖方向正——`state` 是地基，`menu` / `adapters` / `caps` 依赖 `state`，不反向。
- **路径变短、平铺墙消失**：`preview-menu-*` 进子目录 + 去前缀，`adapters` 目录从 78 文件墙降为分组。
- **为 ADR-128 正地基**：`PreviewSnapshot` 归 `state` 后，图生成器的可达性求值吃正位状态层。

### 3.2 负面 / 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 第三刀广度大，外部引用前缀批量改 | 🟡 | 发版前全量 `doctor`；import 影响面已实测（`views/app-preview` 约 9 处外部）；机械路径替换可脚本化 |
| 第二刀内部互引多，搬子目录易漏改 | 🟢 | 同目录搬移相对路径不变；漏改由 `typecheck` 即时拦截 |
| 迁移期并行会话活跃 | 🟡 | 按归属原则路径限定提交；大刀用工作树隔离 |
| 第三刀震门禁脚本 + 知识卡锚点（长尾） | 🟡 | 实测：`scripts/` 门禁脚本硬编码 `utils/3d` 约 25 处（`check-adr-drift.mjs` 4 / `check-menu-health.mjs` 5 / `port-align.mjs` 1 / `perf/vitest-env-switch.mjs` 15）、`tests/` 契约约 8 处、`docs/knowledge/` **30+ 卡 169 处** `source_files` 锚点；第三刀验收须同步此两块，否则 `check-knowledge-drift` 由钩子报集体漂移；基线快照（`deadcode-baseline.json`）自动再生成本低 |
| 历史空缺编号（ADR-009 / 078 / 109） | 🟢 | 既有遗留，非本 ADR 引入，`adr-check` 已确认无撞号漏登 |

### 3.3 已知遗留

- **第一刀决断：`preview-menu-node-types.ts` 删原位置，不留 re-export 壳**。`PreviewSnapshot` / `PreviewStatePath` 迁入 `state/`（新 `state/types.ts` 或并入 `preview-state.ts`）后，原 `adapters/preview-menu-node-types.ts` 删除——留壳即类型双源，正是本 ADR 要消灭的。约 20 处 import 全量改指向 `state/`；`adapters` 引用 `state` 类型是**正确的前向依赖**（非「反向」，原表述订正），残留旧路径由 `typecheck` 即时拦截。
- 第二刀统一测试命名（横线 / 点）会动测试文件名，影响 `vitest` 配置 / CI 引用，需同步。
- `caps` 与 `menu` 的边界（cap 控件属 menu 子系统还是独立）留第二刀实施时定，本 ADR 只定「均在 features/preview-3d 内」。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `utils` 顶层子目录体量实测 | `utils/3d` 198 文件 46124 行，是同级工具子目录（`async` 52 行 / `cache` 236 行）的 9–40 倍 |
| `views/app-preview` 体量 | 73 文件 11667 行——`utils/3d`（4.6 万行）是它服务的视图层的 4 倍，本末倒置 |
| `utils/3d/adapters` 分组 | adapters 78 文件 20269 行平铺；`preview-menu-*` 17 文件 5039 行、`mmd-*` 12 文件 5623 行 |
| `state/preview-state.ts:30` | 反向 import `adapters/preview-menu-node-types.ts` 的 `PreviewStatePath` / `PreviewSnapshot`——依赖倒置实证 |
| `preview-menu-*` import 影响面 | 81 处 import，`adapters` 内部互引为主，外部消费者（`views/app-preview` / `state`）约 9–20 处 |
| `frontend/AGENTS.md` §目录结构 | 「新业务模块放 `features/`」——升格有规约背书 |
| ADR-128 | 图生成器吃 `PreviewSnapshot` / `visibleWhen`——本 ADR 第一刀为其正地基 |

<!-- 文件名: preview-3d-domain-root.md → 实际文件 ADR-129-preview-3d-domain-root.md -->
