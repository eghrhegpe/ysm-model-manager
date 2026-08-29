# ADR-128：菜单导航图生成器与 e2e 选择器派生（声明式收口后的可验证性）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-29
- **修订**：2026-08-29 复审重浇地基（三条源码实证裂缝已修正，见 §5；决策方向不变）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/adapters/schema-registry.ts, preview-menu.ts, preview-menu-cap-controls.ts:448(collectVisiblePredicates), preview-menu-node-types.ts:102(visibleWhen), preview-menu-node-types.ts:14-21(PreviewStatePath), state/preview-state.ts, ADR-125, ADR-126, ADR-085`

---

## 1. 背景（Context）

ADR-126（P4）把菜单体系收敛为「状态层泛化 → 面板 schema 化 → 可见性谓词化 → dockGroup 解耦」，并明确 `fillers` / `runners` / `modelDetailView` 等过程式下钻必须收进 schema。收口后，导航图在理论上可由 schema 递归走通。

但「声明式」只是**必要不充分**——收口前，自动查找菜单层级、e2e 安全断言真实路径两件事都做不到。本 ADR 在复审中发现初稿对三处源码契约的实证有误，已据 `schema-registry.ts` / `preview-menu.ts` / `preview-menu-cap-controls.ts` / `preview-menu-node-types.ts` 实测行号逐条修正（§5）。

### 1.1 现状缺口（2026-08-29 实测，已修正）

| 缺口 | 证据（修正后） | 症状 |
|------|------|------|
| 注册表不是图的真入口 | `schema-registry.ts:50` `listSchemas()` 返回运行时 `registry.keys()`；生产仅 `ysm-adapter.ts:459`（注册 `ysm-model`）、`litematic-adapter.ts:341`（per-scene 动态切片键）调过 `registerSchema`。**那 6 个 L2 builder（lighting/shadow/postproc/settings/camera/environment）活在 `preview-menu.ts:248` 的 `routers.schemaBuilders` 闭包，从未注册** | 以 `listSchemas()` 作遍历入口 → 图里只剩 `ysm-model` + 动态切片键，6 个常驻 L2 面板全丢，比「以为只有 2 层」更糟 |
| 渲染器双通道、闭包优先 | `preview-menu.ts:300` 查找顺序：`if (routers.schemaBuilders[node.id])` 先于 `renderAdapterPanelContent`（内含 `getSchema()`）。闭包是第一真值源，schema-registry 是第二并行通道 | 图遍历若只走 registry，与渲染器实际消费链错位 |
| 过程式下钻不可见 | `fillRoles`（`preview-menu.ts:258`）→ 点角色名 → `modelDetailView`（`:267`）全由闭包拼 | 真实用户能钻 L4，但静态 walk 走不到 |
| `visibleWhen` 运行时折叠 | `node-types.ts:102` 谓词吃 `PreviewSnapshot`，静态 walk 看不到可达性 | 某面板只在 motion 活跃时可达，不构造该状态就走不到 |

### 1.2 痛点：AI 改菜单栽真实路径 + e2e 必炸

- **双真值源**：`modelDetailView` 与 `preview-menu-roles.ts` 对「角色详情长啥样」各说各话；改一边另一边不跟着变，测试只验一边就漏。
- **路径漂移**：AI 在 `fillRoles` 改了入口逻辑，e2e 选择器写死 `dock-角色 → 角色项 → 详情`，真实路径一变测试炸。
- **条件路径盲点**：`visibleWhen` 路径不构造对应 `PreviewSnapshot` 就永远走不到，CI 绿但真实路径是断的。

### 1.3 ADR-126 已铺的脚手架（本 ADR 复用 / 须新建）

| 契约 | 来源 | 本 ADR 如何处理 |
|------|------|----------------|
| 面板枚举（双通道） | `routers.schemaBuilders` 闭包（`preview-menu.ts:248`）+ `schema-registry` Map（`getSchema` / `listSchemas`） | **图遍历入口 = 双通道并集**，非仅 `listSchemas()`；并派生子任务：把 6 个闭包 builder 迁进 `schema-registry`（ADR-126 P5-A「受控入口」落地前此通道本就漏） |
| 节点级谓词 | `visibleWhen?: (s: PreviewSnapshot) => boolean`（`node-types.ts:102`） | **新写** `collectNodePredicates(nodes: PreviewMenuNode[])` 遍历 `PreviewMenuNode[]`、收集 `visibleWhen`；⚠️ **不同于** `collectVisiblePredicates`（`preview-menu-cap-controls.ts:448`，入参 `MenuControlDef[]`、filter cap 级无参 `c.visible`）——两者层 / 签名 / 入参全异，不可混用 |
| 快照类型 | `PreviewSnapshot`（ADR-126 P4-D 升级） | 图生成器构造代表性快照集求 `reachable` |
| 兼容口 | `legacyTestId?`（`node-types.ts`） | e2e 选择器派生的稳定锚点 |

---

## 2. 决策（Decision）

**建「菜单导航图生成器」+「e2e 选择器派生」两件工具，让菜单层级机器可查、测试与菜单共享单一事实源。** 二者建在 ADR-126 收口后的 schema 上；与初稿不同，**本版承认需新建两处机制**（全链路枚举器 + 节点级谓词求值器），但都建在既有类型契约（`PreviewMenuNode` / `PreviewSnapshot` / `schemaId`）上，不另立真值源。

### 2.1 导航图生成器 `collectMenuGraph()`

- **输入（五源全链路枚举，非仅 `listSchemas`）**：
  1. `routers.schemaBuilders` 闭包（6 个常驻 L2 面板）；
  2. `schema-registry` Map（`ysm-model` + 动态 litematic 切片键）；
  3. 每个 `PreviewMenuNode` 的 `children[]` 递归（含 `modelDetailView` 收口后的声明式详情）；
  4. `fillers`（`roles` 过程式下钻，P4-B 前必需）；
  5. `runners`（`close` 动作式节点，建模为 `kind:"action"` 或标 `nonNav`）。
- **输出**：`MenuGraphNode` 树——`dock(group) → panel(schemaId|node.id) → node(PreviewMenuNode) → children[]`，节点带 `reachable: boolean`（对给定快照求 `node.visibleWhen(snap)`）。
- **纯函数 + 契约测试**：不依赖 DOM / Wails 桥，可在 `node` 环境单测；某 builder 抛错即生成失败。
- **代表性快照集契约**：默认 / 角色已加载 / motion 活跃 / 环境开启 四档，列为显式常量；⚠️ **快照覆盖 ≠ 谓词可达性覆盖**（见 §2.3），新增 `visibleWhen` 分支须显式标注「期望在哪一档为 true」，契约测试校验标注完整性，而非仅校验快照常量数量。

### 2.2 e2e 选择器派生（测试与菜单共享单一事实源）

- **禁止 e2e 硬编码路径**：测试改为断言「graph 中存在语义路径 `dock.角色.角色项.详情` 的节点链」。
- **选择器生成器**：从 `MenuGraphNode` 派生稳定选择器串——优先 `node.legacyTestId`（ADR-126 兼容口），缺则回退 `dockGroup + id` 语义链。
- **门禁前置（生成失败 → doctor 失败）**：builder 抛错 / `fillers` 未注册 / 快照缺失 → `collectMenuGraph()` 生成失败 → `doctor` 直接失败，把「AI 改菜单破坏真实路径」挡在 e2e 之前。
- **partial 阶段门禁规则（显式，修正初稿真空）**：
  - 图生成器输出 `coverage: "full" | "partial"` 与 `uncoveredLayers: string[]`。
  - `coverage: full`：选择器派生全量运行；covered 路径消失（回归）→ doctor **失败**。
  - `coverage: partial`（P4-B 未落地，L3/L4 未知）：① 选择器派生**强制收窄到已覆盖层**，绝不输出 `uncoveredLayers` 的选择器（杜绝半图选择器悄无声息进 e2e）；② doctor 发 **WARN（非失败）** 使缺口可见；③ 但仍维护 **covered-path 基线**，已覆盖路径若消失 → doctor **失败**（防 AI 破坏真实路径的主力，partial 阶段也生效）。
  - 规则一句话：partial **不阻断提交**，但**选择器派生自动降级 + covered-path 回归必拦**。

### 2.3 关键约束（修正过强断言）

- **图是 schema 的投影，不是独立事实源**：单一来源仍是「双通道面板枚举 + `children` + `visibleWhen`」；图生成器只读不写。
- **依赖 ADR-126 P4-B 收口**：`fillRoles` / `modelDetailView` 进 schema 前图只能到 L2，生成器显式标 `coverage: partial`（见 §2.2 规则）。
- **⚠️ 快照覆盖 ≠ 路径覆盖（修正初稿「快照覆盖即路径覆盖」）**：4 档代表性快照只能验证「这些固定状态下谓词取何值」，**证明不了**「谓词的全部可达分支被覆盖」。反例：`visibleWhen` 新增分支在所有 4 档均返回 `false` → 快照常量集未变 → 契约测试仍绿，但条件路径盲。因此可达性保障须辅以「每个 `visibleWhen` 显式标注期望为真的快照档」的契约，而非依赖快照数量。

### 2.4 不在本 ADR 范围

- 图生成器具体实现 / CLI 入口（`scripts/gen-menu-graph.mjs`）——另案子任务，本 ADR 只定方向。
- 视觉回归基建（ADR-126 §2.4 P4-B 子任务）——本 ADR e2e 选择器派生与之互补。
- 管理器侧 `app-nav` / `app-content` 导航图——独立 tab 体系，需另立生成器。
- **子任务：6 个闭包 builder 迁进 `schema-registry`**（ADR-126 P5-A「受控入口」前置）——本 ADR 依赖此收口才能用单一入口，否则须长期维护双通道枚举。

---

## 3. 后果（Consequences）

### 3.1 正面

- **菜单层级机器可查**：收口后 `collectMenuGraph()` 输出完整 `dock → panel → node → children` 树，CI 可 diff、可审计。
- **AI 改菜单不再栽真实路径**：路径断（covered 层回归）= 图生成失败 = 门禁拦截，错误在 commit 前暴露。
- **e2e 与菜单单一事实源**：选择器从图派生，菜单一改图跟着变，测试断言自动对齐。
- **诚实标注新机制债**：全链路枚举器 + 节点级谓词求值器确为新建，但都建在既有 `PreviewMenuNode` / `PreviewSnapshot` / `schemaId` 类型契约上，非凭空造物。

### 3.2 负面 / 风险

| 风险 | 等级 | 缓解（修正后） |
|------|------|------|
| **依赖 P4-B + 双通道枚举**：`fillRoles`/`modelDetailView` 未进 schema，且 6 builder 未迁 registry | 🔴 | 生成器显式 `coverage: partial` + `uncoveredLayers`；选择器派生强制收窄；派生子任务把 6 builder 迁 `schema-registry` |
| **快照覆盖不全漏条件路径** | 🟡 | 每个 `visibleWhen` 显式标注期望为真的快照档 + 契约校验标注完整性（非仅快照数量） |
| **partial 阶段半图选择器进 e2e** | 🔴→已消 | §2.2 规则：partial 时选择器派生自动降级 + covered-path 回归失败，杜绝真空 |
| **图节点与 DOM 选择器映射漂移** | 🟢 | 优先 `legacyTestId` 稳定锚点；生成器同时输出 `node → selector` 映射表 |

### 3.3 已知遗留

- **管理器导航图**：`app-nav` / `app-content` tab 体系需另立生成器（数据源 `GROUP_META` / `bindTabs`）。
- **`runners` 动作式节点**：`close` 建模为 `kind:"action"` 并入图，或定性「非导航路径、图外」。
- **骨骼面板 / litematic 分层切片**：真·复杂逃生舱（3D 射线拾取 / 直接持有 DOM），图生成器遇 `renderCustom` 节点标 `escapeHatch: true` 而非尝试走通。

---

## 4. 数据溯源（修正行号）

| 来源 | 结果（修正后） |
|------|------|
| `schema-registry.ts:50` `listSchemas()` | 返回运行时 `registry.keys()`；生产仅 `ysm-model` + 动态 litematic 切片键注册，6 闭包 builder 不在内 |
| `preview-menu.ts:248` `routers.schemaBuilders` | 6 个常驻 L2 builder 闭包，**未调 `registerSchema`**——图遍历须含此通道 |
| `preview-menu.ts:300` 渲染查找 | 闭包优先、`getSchema()` 第二，双通道并存 |
| `preview-menu.ts:258,267` | `fillers: roles` / `modelDetailView` 在 schema 之外，L3/L4 不可走（P4-B 收口对象） |
| `preview-menu-cap-controls.ts:448` `collectVisiblePredicates` | 入参 `MenuControlDef[]`、filter cap 级无参 `c.visible`；**非**节点级 `visibleWhen`，不可张冠李戴 |
| `preview-menu-node-types.ts:102` `visibleWhen?` | 节点级谓词，吃 `PreviewSnapshot`，图可达性求值真原子 |
| 用户对话（2026-08-29） | 「声明式后能否写脚本自动查菜单层级」「AI 改菜单栽真实路径 + e2e 必炸」痛点 |
| ADR-126 §2.4 / §3.3 | 「e2e 选择器同步 / 视觉回归」未决子任务——本 ADR 是其可验证性落点 |

---

## 5. 复审修订记录（2026-08-29）

初稿经源码实证复审，发现三处地基裂缝，已逐条修正（决策方向不变）：

1. **图入口误用 `listSchemas()`**（死穴一）：修正为「双通道并集枚举（闭包 `schemaBuilders` + `schema-registry` Map + `children` + `fillers` + `runners`）」，并加子任务把 6 闭包 builder 迁进 registry。
2. **`collectVisiblePredicates` 张冠李戴**（死穴二）：该函为 cap 级无参谓词，与节点级 `visibleWhen(s)` 层 / 签名 / 入参全异；修正为新建节点级谓词收集器，明确不可混用。
3. **partial 门禁真空**（死穴三）：原 §2.2 只拦「生成失败」不拦「半图」；修正为 partial 阶段选择器派生强制降级 + covered-path 回归必拦 + doctor WARN。
4. **过强断言**（§2.3）：删除「快照覆盖即路径覆盖」，改为「快照覆盖 ≠ 谓词可达性覆盖」并给反例与契约要求。

---

<!-- 文件名: menu-nav-graph-e2e-selectors.md → 实际文件 ADR-128-menu-nav-graph-e2e-selectors.md -->
