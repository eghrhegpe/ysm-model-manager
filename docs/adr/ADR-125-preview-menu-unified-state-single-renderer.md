# ADR-125：3D 预览菜单统一：settingsState 横切状态层 + 单渲染器 + visible 规则

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-28
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/adapters/preview-menu.ts, preview-menu-settings.ts, preview-menu-cap-controls.ts, preview-menu-node-types.ts, caps/scene-capability.ts, caps/scene-capability-registry.ts, ADR-085, ADR-093, ADR-076`

> 本 ADR 是 **ADR-085 S2「状态单向流」的补全**，不取代 ADR-085（其 S1 注册表、S3 refreshDock 已落地并继续有效）。

---

## 1. 背景（Context）

2026-08-28 夜，3D 预览菜单体系出现三套机制并存，且当晚三次提交各自暴露一处病征。ADR-085（2026-08-16）已诊断同一病根（「菜单定义、状态读写、渲染时机三处各自为政」）并采纳 S1/S2/S3 三段决策；其中 **S1（注册表）与 S3（refreshDock，`preview-menu.ts:536/547`）已落地，S2「状态单向流」只落了 bind 回写，未落统一状态源**——本 ADR 补的正是这一半。

### 1.1 三套并存（源码实测）

| 体系 | 载体 | 渲染器 | 状态通道 |
|------|------|--------|----------|
| A 声明式 Schema | `PreviewMenuNode[]`（`preview-menu-node-types.ts`） | `renderPreviewSchemaContent`（`preview-menu.ts:171-217`）仅实现 `sectionTitle`/`divider`/`field` 三种，其余落 `renderCustom`（`:211-215`） | **无**；`control.bind: PreviewStatePath` 自注「state 映射表尚未建立时为占位」（`node-types.ts:13-14`）→ bind 为死代码 |
| B cap 控件 | `MenuControlDef[]` | `renderCapControls`（`preview-menu-cap-controls.ts:421-440`，10 种 kind + group 折叠 + visible 过滤） | cap 内 `getValue/setValue` 闭包；单渲染器工作良好，但**作用域只在 cap 内部** |
| C 逃生舱 | `renderCustom` 闭包 | 每节点自带 DOM | 各自直连；全 adapters **48 处**（settings 14 / env 3 / menu 4） |

settings 面板是**横切面**（跨 cap、跨模块），既不在 A 的状态层（无状态层），也不在 B 的 cap 域内，只能整体落入 C。

### 1.2 三条病征物证

1. **同一开关两条真值来源**（`f0fa3e23`，22:52）：`wireframe-capability.ts:96-107` 已自报标准 `toggle` 控件（`id:"wireframe-toggle"`，getValue/setValue 齐备），settings 面板未接，另手写 29 行 `bsBuildWireframeToggle()`（`preview-menu-settings.ts:306-330`）；commit message 自陈「手动 schema，非自动 cap 聚合」。
2. **visible 是温床**（`7fdfdcc7`，22:26）：`MenuControlDef.visible?`（`scene-capability.ts:30`）全仓仅 5 处调用点（water 2、ground 3），全手写在各 cap 控件工厂内，无注册表、无集中枚举、无契约测试；A 层另有同名不同义的 `visibleWhen`（`node-types.ts:84`）。
3. **声明期求值 → 运行时冻结**（`preview-menu-settings.ts:108-123`）：`if (wfCap) nodes.push(...)` 在 schema 构建时求值，此后 cap 创建面板也不会长出该行——与 `05fe24b7`（22:39）所修「水池分组永不可见」同病；该 commit 以 `SceneCapability.subscribe?` + `rebuildEnvSubs` + `menu.refresh()` 手工补链路，实为「A 层无状态层可订阅」的补丁，构成事实上第四套机制。

### 1.3 状态通道散落（横切项无统一读写口）

| 设置项 | 现通道 |
|--------|--------|
| 视锥裁剪 | 模块函数 `isFrustumCullEnabled/setFrustumCullEnabled`（`frustum-cull.ts:111/117`） |
| 帧率上限 | localStorage `MAX_FPS_KEY` + `getMaxFps/invalidateMaxFpsCache`（`render-budget.ts:23/30/33`） |
| 分辨率上限 | localStorage `MAX_PIXEL_RATIO_KEY`（`render-budget.ts:5/10`） |
| Bloom / PMREM / 线框 | 跨 cap 直调 `ppCap.setEnabled` / `skyCap.setEnvironmentEnabled` / `wfCap.setEnabled` |

`bind: path` 无处可指 → 只能退回手写闭包。

---

## 2. 决策（Decision）

菜单体系收敛为 **「状态层 + 单渲染器 + 声明式 visible」**，分三块按依赖顺序落地。

### P1 — `settingsState` 横切状态层（地基）

- 新建 `frontend/src/utils/3d/state/settings-state.ts`：单一 reactive 对象 + `getStateValue/setStateValue(path: PreviewStatePath)` 解析器 + `subscribe/notify`。
- 路径前缀**复用已定义的** `PreviewStatePath`（`env.* / render.* / light.* / ui.* / perception.* / motion.* / model.*`），不为本 ADR 新造类型。
- 收编六项：`render.frustumCull`、`render.maxFps`、`render.maxPixelRatio`、`render.bloom`、`env.pmrem`、`render.wireframe`。
- **持久化边界（防双写）**：localStorage 键名保持不变（兼容既有用户设置），读写收敛至状态层；`bloom`/`pmrem`/`wireframe` 走 cap 的 `get/set` 派生映射，**不额外落盘**（cap 存自己的域，状态层不重复存）。

### P2 — 单渲染器 + 自动 cap 聚合

- settings schema 改为产出 `MenuControlDef[]`，喂给既有 `renderCapControls`；`renderCapControls` 一统天下，A 层渲染器不再重复实现控件。
- 14 个 `renderCustom` 收敛为 **6 个数据节点 + 1 个 note**（note 为静态文案，属真·无法数据化，保留逃生舱）。
- **自动 cap 聚合**：settings 面板从 `sceneCapabilityRegistry` 遍历全部 cap 的 `getMenuControls()`，按 `settingsOrder` 字段排序并入；新 cap 无需在 settings 侧接线即自动出现（杜绝 `f0fa3e23` 型重复真值来源）。

### P3 — visible 规则定死

- 条件显隐只允许两种形式：
  1. 数据节点上的 `visibleWhen: (s) => boolean`——吃状态层快照的**纯函数**，可单测；
  2. cap 内 `visible`——保留，但必须基于自身 params，**禁止跨 cap 探查**。
- **禁止**在 schema 构建期以 `if (cap)` 做条件插入（`preview-menu-settings.ts:108-123` 为反例）。
- 导出 `collectVisiblePredicates()` 供契约测试枚举，杜绝「隐藏逻辑无人知道」。

---

## 3. 后果（Consequences）

**正面**
- 新增一个设置项由「约 30 行手写 DOM 闭包」降为「一行数据」。
- `bind: path` 由死代码变为可用路径，A 层声明式 Schema 首次真正具备状态依托。
- 「cap 已自报、面板却手写」的重复真值来源从机制上不再可能。
- `05fe24b7` 的手工 subscribe + refresh 链路，在 P1 统一通知完成后可降级为「状态变更自动重算」，第四套机制自然消失。

**负面 / 风险**
- 🔴 **双写风险**：cap `saveState()` 与 `settingsState` 若同时落盘即双源。已以 P1「持久化边界」条款划清，需契约测试守住。
- 🟡 **改动刚修好的代码**：P1 会触及 `05fe24b7` 刚落地的 env 局部刷新链路，须跑 `preview-menu-env.test.ts` 全套。
- 🟡 **自动聚合的可控性下降**：新 cap 自动进设置面板，可能出现顺序/分组不合预期；以 `settingsOrder` 显式字段而非隐式顺序控制。
- 🟢 迁移本身不改变任何 localStorage 键名与用户可见行为，属纯内部重构。

**已知遗留**
- A 层 `renderPreviewSchemaContent` 的 `folder`/`panel`/`slider`/`toggle` 等分支本 ADR 不实现——settings 走 B 层 `MenuControlDef` 通道即可，A 层控件分支留待确有面板需要时再补，避免空转。
- `litematic extraControls` 顶栏常驻控件（ADR-085 已列为遗留）不在本 ADR 收编范围。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `git log --oneline -12`（`f0fa3e23` / `05fe24b7` / `7fdfdcc7`，2026-08-28 夜） | 三套并存与三条病征物证 |
| `grep -rn "renderCustom" adapters/*.ts` → 48 处（settings 14 / env 3 / menu 4） | C 层逃生舱规模 |
| `grep -rn "visible" caps/*.ts` → water 2、ground 3，共 5 处 | visible 温床规模 |
| `grep -rn "settingsState" frontend/src` → 0 命中 | 统一状态层缺位 |
| `preview-menu.ts:171-217` + `node-types.ts:13-14` | A 层 bind 为死代码 |
| `wireframe-capability.ts:96-107` vs `preview-menu-settings.ts:306-330` | 同一开关两条真值来源 |
| ADR-085 §2 S2 原文「cap 是唯一状态源 / toggle 全部传 bind」 | 本 ADR 补全对象 |

---

<!-- 文件名: preview-menu-unified-state-single-renderer.md → 实际文件 ADR-125-preview-menu-unified-state-single-renderer.md -->
