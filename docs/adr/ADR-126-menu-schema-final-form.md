# ADR-126：3D 预览菜单声明式 Schema 终态——状态层泛化 + 面板 schema 化 + 可见性谓词化 + dockGroup 解耦

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-28
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/state/settings-state.ts, preview-menu-node-types.ts:14-21, caps/scene-capability.ts, adapters/preview-menu.ts, preview-menu-settings.ts, ADR-085, ADR-125, ADR-076, ADR-093`

---

## 1. 背景（Context）

承接 **ADR-085**（菜单单一事实来源，2026-08-16）→「注册表驱动 + 状态单向流」大方向；与 **ADR-125**（3D 预览菜单统一状态层，2026-08-28）→设置面板统一状态层 + 单渲染器 + visible 规则定死。ADR-085 立了大方向，ADR-125 把这条方向的**设置面板这一个横切面**落地了 P1/P2/P3。

**但**：ADR-085 标的「消失」清单 / ADR-125 §3 标的「第四套机制自然消失」——目前是 P4 阶段预期收益，**不是既成事实**。验货对账（2026-08-28）确认四类病仍在线：

### 1.1 4 类病根（按用户对账表，证据路径实测）

| 病根 | 证据 | 症状 |
|------|------|------|
| **dockGroup 1 字段 4 职责** | `preview-menu-node-types.ts:89`，5 值枚举（model/motion/env/scene/settings）承担**导航归位 + 过滤 + 分组 + 模式守卫** | 改一个职责会牵连另三个；模式切换时全字段变语义 |
| **roleDetailView 万能容器** | `preview-menu.ts:253-264`，`fillRoles` 按 `initialSection` 分拣渲染 | 一个容器塞下多个语义子面板，加新角色 = 加 if 分支 |
| **model/motion 交叉渲染** | `onSwitchRole` / `toolItems` / `motionItems` 三处命令式分支互调 | 角色切换时动作面板内容不能由 `visibleWhen` 静态表达，要写 run 期钩子 |
| **fill3DPanel / fillModelPanel** | 组件切换下拉 + 手动 `renderCurrent` 仍在 | 三个面板走两条独立命令式渲染通道，与 ADR-125 已 schema 化的 settings 面板不对称 |

### 1.2 ADR-125 交付的「三件前置基建」（P4 的脚手架）

| 基建 | 来源 | P4 如何复用 |
|------|------|------|
| **状态层模式** | `settings-state.ts`：`path → get/set` 路径读写 + `subscribe/notify` + 惰性 cap 解析 + `available()` 守卫 | P4-A 把它从 settings 域泛化到全 `PreviewStatePath`（model.*/ui.*/motion.* 域补齐） |
| **聚合协议** | `MenuControlDef.settingsOrder?: number` = cap 自声明、settings 侧零接线 | P4-B 把同一协议从 settings 面板推到 model/motion 面板；新面板 = 导出 schema + 注册一行 |
| **visible 规则定死** | `visibleWhen: () => boolean` 纯函数谓词 + `collectVisiblePredicates()` 可枚举 | P4-D 把 model/motion 交叉渲染转谓词；交叉渲染从此只有「一机制」——`visibleWhen` 吃 `previewSnapshot()` 快照 |

### 1.3 不动 ADR-125 的既有结论

- ADR-125 §3 已知遗留的「A 层 `renderPreviewSchemaContent` 的 folder/panel/slider/toggle 分支」——本 ADR **不单独写步**，但 P4-B 把所有面板 schema 化后顺路补齐（或在 P4-B 实施时另开 P4-E 子 ADR）
- `litematic extraControls` 顶栏常驻（ADR-085 §3 已知遗留）——不在本 ADR 范围

## 2. 决策（Decision）

**菜单体系完成 ADR-085 立的方向，路径为「状态层泛化 → 面板 schema 化 → 可见性谓词化 → dockGroup 解耦」四个独立子步**。每子步独立 commit、独立契约测试、独立知识卡，可单独回滚。

### 2.1 子步排序（按依赖链）

| 子步 | 标题 | 动什么 | 治什么病 | 依赖 | 风险 |
|------|------|--------|----------|------|------|
| **P4-A** | 状态层泛化 | `settings-state.ts` 升格为 `preview-state.ts`；`PreviewStatePath` 7 域（env/render/light/ui/perception/motion/model）落为真实路径表 | roleDetailView 万能容器（state 接管后容器不再分拣） | 无（地基） | 🔴 中：路径多需逐条摸清；双向 setter 需契约测试 |
| **P4-B** | 面板 schema 化 | 新增 `buildModelSchema/buildMotionSchema/buildRoleDetailSchema`；`fill3DPanel/fillModelPanel/fillRoles` 命令式全下线 | fill3DPanel/fillModelPanel、命令式菜单体 | A | 🔴 中：业务核心，回归面广；需 preview 菜单全套测试 + 视觉回归 |
| **P4-D** | 可见性谓词化 | model/motion 交叉渲染的 `onSwitchRole/toolItems/motionItems` 全部转 `visibleWhen: (s) => boolean` | model/motion 交叉渲染 | A | 🟢 低：纯谓词重写，行为不变；需契约测试枚举 |
| **P4-C** | dockGroup 解耦 | 拆字段：导航归位由 `ui.activePanel` 驱动，模式守卫独立为 `modeGuard` 谓词 | dockGroup 1 字段 4 职责 | A | 🟡 中：纯字段重构；需逐 cap/面板迁移 + 契约测试 |

**排序理由**：
1. **A 是地基**：无 A 则 BCD 全部难写（model/motion/cross-render/dockGroup 都需要统一状态通道）
2. **B 和 D 并行可做**：B 走「面板声明式化」、D 走「谓词化」，互相不依赖
3. **C 排最后**：dockGroup 字段在 cap 与菜单各点都有引用，最稳的迁法是等 A 的 `ui.*` 域就位后做「拆字段+改引用」一次性迁移

### 2.5 实施后子步定性修正（2026-08-29 收尾复盘）

P4-A/B/D 落地后，对 P4-B-3 / P4-C 的原始范围做**实施认知修正**（ADR 只记决策方向，此处补「实测定性与原假设的偏差」）：

- **P4-B-3（morph/play/material 交互面板）→ 定性「保持逃生舱」**：实测三者状态源都是**运行时交互态**（morph 权重直写 `mesh.morphTargetInfluences`、播放状态走 `MmdPlayBridge`、材质显隐走 `MaterialControlBridge`），不是「静态内容展示」。转 children 声明式 = 静态快照表达不了动态交互；转 cap 控件 = 需先造 MorphCapability/PlayCapability/MaterialCapability 类（cap 注册 + 生命周期 + saveState），属另一个量级。**逃生舱是 ADR-125「三套并存」的设计内终态（node-types 注释 escapeHatch 兼容命令式），非未完成**。P4-B-1/2 已把「静态内容面板」schema 化（MMD/YSM shot、MMD model 信息）——「易维护」红线（通道统一 + 截图共享）已达成。
- **P4-C（dockGroup 解耦）→ 修正「仅双语义，暂不拆」**：实测 `sharedOnly/hideInSelfMode/requiresEnvironment`（模式守卫）**早已是独立字段**（node-types.ts L98-103），dockGroup 实际只剩**双语义**——① dock 底栏分组（`dockGroupItemsFor` 按 `d.dockGroup === g.id` 筛）+ ② 角色详情内容域划分（`modelDetailView`/`motionDetailView` 按 `dockGroup === "model"/"motion"` 筛子项）。双语义消费者真实存在但**当前读法恰好一致**（model 内容都在 model 组）——是「概念错位」不是「功能 bug」，改 dock 归属才会误伤详情视图。真拆（panelDomain 字段）成本 = 所有 adapter 标注 + 详情逻辑 + 测试全动，收益只是「防未来改名踩坑」——ROI 低。**定性「保持观察，等真实诉求（如有人把面板挪组）再拆」**，与 §3.3 处理 `05fe24b7` env refresh 的先例一致。

### 2.2 关键约束

- **每子步独立可发布、可回滚**：独立 commit；独立契约测试通过；独立知识卡记录实施进度
- **母 ADR 不记实施进度**（AGENTS.md 铁律）：子步落地的 commit/测试/接口由各知识卡承载，本 ADR 只记决策方向与依赖链
- **触及 ADR-085**：P4-C 拆 dockGroup 属于 ADR-085 S1 注册表驱动的**字段层小修正**，不取代 ADR-085 大方向（注册表驱动、状态单向流、刷新时机仍有效）
- **触及 ADR-125**：P4-A 把 `SettingsPath` 升格为 `PreviewStatePath` 全集，**不取代** ADR-125（六项横切设置项的「持久化边界」与「双写防线」仍以 ADR-125 P1 原则守住）

### 2.3 复用 ADR-125 的三件契约

| 契约 | 现状（ADR-125 已立） | P4 推广 |
|------|---------------------|---------|
| 路径前缀类型 | `PreviewStatePath`（`node-types.ts:14-21`，7 域已声明） | A 步把 `SettingsPath` 升格为全集；`toStatePath` 编译期守卫跨子步复用 |
| 聚合协议 | `MenuControlDef.settingsOrder?: number`（cap 自声明，settings 零接线） | B 步把同一协议从 settings 面板推到 model/motion 面板（推广为 `MenuNode.dockOrder?`） |
| 可见性规则 | `visibleWhen: () => boolean` + `collectVisiblePredicates()` | D 步升级为 `visibleWhen: (s: PreviewSnapshot) => boolean`，吃 A 步的 `previewSnapshot()`；`collectVisiblePredicates` 跨子步枚举 |

### 2.4 不在本 ADR 范围

- `litematic extraControls` 顶栏常驻（ADR-085 §3 已知遗留）——另案轨道
- A 层 `renderPreviewSchemaContent` 的 folder/panel/slider/toggle 分支——若 P4-B 实施时必须补齐则开 P4-E 子 ADR，否则留待
- 视觉回归测试基建——留作 P4-B 子任务的子任务（preview 菜单命令式→schema 化后，DOM 结构会变，e2e 选择器需同步）

## 3. 后果（Consequences）

### 3.1 正面

- **4 类病一次根治**："消失"清单（dockGroup/roleDetailView/model-motion 交叉/fill3DPanel）从「反复修」变「机制性不再可能」
- **声明式 Schema 形态完整**：A 层 `renderPreviewSchemaContent` 真正一统；`renderCustom` 收敛为「note / 唯一 DOM 操作」少数逃生舱
- **三件契约复用为全域通用**：状态层 / 聚合协议 / 可见性规则从 settings 域推到 model/motion/roleDetail，对齐 AGENTS.md 「通用化、统一、复用既有函数」偏好
- **4 子步独立可回滚**：最大爆炸半径限定在单子步，不出现「all-or-nothing」改造
- **回归面收敛**：业务核心的回归点统一在 `preview-menu.ts` 命令式菜单体 + 三个 schema 化的 panel，e2e 改一处不再四散漂移

### 3.2 负面 / 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| **P4-A 是地基也是最大头**：PreviewStatePath 七域逐条摸清 + 双向 setter + 契约测试 | 🔴 | 估时 1-2 天；每域先建路径 + `get/set` + 一例契约测试，螺旋推进而非一次性铺 |
| **P4-B 回归面广**：业务核心，preview 菜单全套测试 + 视觉回归 | 🔴 | schema 化后逐面板视觉回归；`renderCustom` 改 schema 节点时**保留 data-testid 兼容**，e2e 选择器零改动 |
| **P4-A 暴露双写风险**：从 settings 域泛化后，原 cap 内部自管 + 新增状态层并存可能出现双源 | 🟡 | 沿用 ADR-125 「持久化边界」原则：cap 已自报的项走 cap 派生、状态层不重复存；契约测试守住「`safeSet` 那两个 localStorage 键不在菜单侧出现」 |
| **P4-C 字段迁移散点**：dockGroup 在 cap 与菜单各点都有引用，逐点迁移需 grep 守护 | 🟡 | 实施时先 `grep -rn "dockGroup" frontend/src` 全量定位，按文件分批迁移；契约测试断言「dockGroup 不再出现」 |
| **P4-B 视觉回归与 e2e 选择器同步** | 🟢 | schema 节点 `legacyTestId?` 字段已存在（`node-types.ts:99-100`），迁移时按需挂；DOM 树变化控制在单 panel 内 |

### 3.3 已知遗留

- **A 层 `renderPreviewSchemaContent` 的 folder/panel/slider/toggle 分支**：本 ADR 不在子步里单独写步；若 P4-B 实施时 B 步内部可顺路补齐（推荐），否则开 P4-E 子 ADR
- **`litematic extraControls` 顶栏常驻**（ADR-085 §3 已知遗留）——另案轨道，不在本 ADR
- **视觉回归测试基建**——留作 P4-B 子任务的子任务（命令式→schema 化后 DOM 结构会变，e2e 选择器需同步；`legacyTestId` 字段为兼容口）
- **`05fe24b7` 手工 refresh 链路**（`rebuildEnvSubs` + `menu.refresh()`，env 域 cap 参数订阅）——知识卡 `preview_menu_settings_state.md` L83 标记「迁移是遗留项」。本 ADR 不接管，env 域的 cap 参数订阅与 settingsState 横切六项**不同域**，硬迁 = 削足适履。除非冒出真实「设置 ↔ 环境面板联动」诉求，否则定性「保持观察」
- **P4-B-3 交互面板**（morph/play/material）——定性「保持逃生舱」：状态源均为运行时交互态（morph 权重直写 mesh / 播放走 MmdPlayBridge / 材质走 MaterialControlBridge），转声明式需先造 Capability 类（另一量级）。逃生舱是 ADR-125 设计内终态（escapeHatch 兼容命令式），非未完成（详见 §2.5）
- **P4-C dockGroup 双语义**（dock 分组 + 角色详情内容域划分）——定性「保持观察」：当前读法恰好一致（model 内容都在 model 组），概念错位非功能 bug；真拆 ROI 低，等真实诉求（有人把面板挪组）再拆（详见 §2.5）

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| **用户对账（2026-08-28 验货报告）** | 4 类病当前位置与现状（dockGroup 1 字段 4 职责 / roleDetailView 万能容器 / model-motion 交叉渲染 / fill3DPanel-fillModelPanel） |
| **兄弟会话 git log（ADR-125 + 同步提交）** | `22648fc7`（auto-import 修饰符根除误报）、`2c2083bc`（`typeof window` 守卫治 android-events 8 例连坐）、`79e583bb`（ADR-125 全量 14 文件入库） |
| **doctor 报告（2026-08-28）** | 31/31 全绿、78 文件、1068 测试 |
| **知识卡 `preview_menu_settings_state.md`** | P1/P2/P3 落地状态、不变量（5 条）、残留手工 refresh 链路（`05fe24b7`）、L100 遗留已被 `22648fc7` 修 |
| **ADR-085 §1.1-1.4** | 5 处分散定义、状态双源、渲染时机竞态、mmd bones 不可达——本 ADR 视为前置病情 |
| **ADR-125 §1.1-1.3** | 三套并存（A 声明式 Schema / B cap 控件 / C 逃生舱）、三条病征（f0fa3e23 / 7fdfdcc7 / 05fe24b7 物证）、状态通道散落——本 ADR 视为前置病情 |
| **AGENTS.md 「ADR 与审核」+「3d菜单只允许 visibleWhen: (s) => boolean」** | 母 ADR 不记实施进度；3D 菜单显隐统一规则约束 P4-D 子步 |
| **`preview-menu-node-types.ts:14-21` `PreviewStatePath` 七域已声明** | 路径类型契约现成，P4-A 升格为真实路径表无需扩展类型定义 |

<!-- 文件名: menu-schema-final-form.md → 实际文件 ADR-126-menu-schema-final-form.md -->
