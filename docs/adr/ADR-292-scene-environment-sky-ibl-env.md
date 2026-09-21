# ADR-292：环境贴图单一归属：scene.environment 所有权收口，sky IBL 降为 env 的数据源

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-21
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - `frontend/src/preview-3d/caps/sky-capability.ts`（`regenerateEnvironment` / `clearEnvironment` / `setEnvironmentEnabled`）
  - `frontend/src/preview-3d/caps/environment-capability.ts`（`buildEnvironment` / `pmremToSceneEnv`）
  - `frontend/src/preview-3d/state/env-state-schema.ts`（`skyEnvironment` 键）
  - `frontend/src/preview-3d/caps/sky-menu.ts` / `environment-menu.ts`
  - ADR-268（环境面板插件式归属发现）、ADR-196（统一状态层）、ADR-254（来源门）
  - 上游缺陷记录：`docs/audit-env-review.md` §S1-4 / §E-4

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

### 1.1 一个槽位，两个写者

`THREE.Scene.environment`（IBL 环境贴图）在 Three.js 中是**物理唯一槽位**——环境反射/漫反射照明的贴图只能有一张。但本仓有**两个 cap 各自独立往它写**：

| 写者 | 触发时机 | 写入值 |
|------|---------|--------|
| `sky-capability.ts:451` `regenerateEnvironment()` | `skyEnvironment` 开 + 太阳/云量变化 / `skyForceEnv` 脉冲 | sky 烘的 PMREM `renderTarget.texture` |
| `sky-capability.ts:459` | PMREM 抛错（catch） | `null` |
| `sky-capability.ts:467` `clearEnvironment()` | `skyEnvironment` 关 / `detach()` | `null` |
| `environment-capability.ts:341` `pmremToSceneEnv()` | `envPreset` / `envResolution` / `envUseAsBackground` 变化 | env 烘的预设或 HDR 纹理 |
| `environment-capability.ts:349/363` | PMREM 失败 / `enabled=false` | `prevEnvironment` |

两个 cap **互不知晓对方存在**，都认为自己独占该槽位。结果是「**后写者赢**」，且胜者取决于用户的操作顺序——同一个操作序列换个先后，画面结果不同。

### 1.2 这不是「两个功能」，是「一个功能被劈成两半」

拆解 sky cap 的双 Sky 结构后，`skyEnvironment` 的真实语义水落石出：

```
this.sky     ← 挂入 scene，用户看见的天空背景
this.envSky  ← 不挂 scene，仅塞进 this.envScene，专供 PMREM 烘焙成环境贴图
```

即：**天空盒有一份专门用于「烤」成 IBL 的副本**。`skyEnvironment` 就是「烤不烤」的开关。于是：

| UI 开关 | 所属面板 | 实际语义 |
|---------|---------|---------|
| `skyEnvironment`（文案「环境贴图」） | 天空（基础卡） | 把**程序化天空**烤成 IBL 写入 `scene.environment` |
| `envEnabled` + `envPreset`（文案「环境」+ 预设缩略图/HDR） | 环境（氛围卡） | 把**程序化 Canvas 预设或自定义 HDR** 烤成 IBL 写入 `scene.environment` |

两者**是同一件事（为 `scene.environment` 供图）的两个数据源**，却被呈现为用户可见的两个独立开关，且都能开、互相静默覆盖。类比：同一个相框，一个按钮说「放手机拍的照片」，另一个说「放相册里的照片」，两个都能按，后按的赢。

用户视角的故障表现：开了 HDR 环境贴图，调一下太阳角度，HDR 被天空 IBL 顶掉；或反之。**UI 在撒谎——它展示的两个开关都处于「开」，但只有一个在生效。**

### 1.3 文案层面同样撞名

i18n 现状（`locales/zh-CN.ts`）：

- `preview.environmentMapping`: **「环境贴图」** ← 实为 sky IBL 联动开关（L1372）
- `preview.environment`: 「环境」、`preview.environmentDesc`: 「环境贴图：程序化天空/工作室等预设光照或自定义 HDR」（L1198-1199）

两个面板各有一个叫「环境贴图」的概念，指代不同东西。**文案撞名是 1.2 结构问题的表征，不是病因**。

### 1.4 与既有缺陷记录的关联

本仓 `docs/audit-env-review.md` 已记录两条同根缺陷：

- **E-4**（已修）：`dispose()` 侧所有权守卫深度不一致——sky 有守卫、env 没有，导致先构造的 cap dispose 时冲掉后写者。**修的是「销毁时」的竞争。**
- **S1-4**（本 ADR 处理）：**运行期**同槽位竞争 + 文案漂移。E-4 的 disposal 守卫只是补丁，因为只要存在两个写者，「谁该赢」这个语义问题就会从各个缝隙反复渗出（销毁期、重建期、切换期）。

### 1.5 为什么不能靠「互斥联动」收场

一个直觉方案是让两个开关互斥（开 A 自动关 B）。但这只是**把不确定的覆盖变成确定的覆盖**：

- 仍是两个控件表达一个槽位 → UI 依旧冗余、依旧需要用户理解「我该开哪个」；
- 互斥方向是任意产品决策，没有架构依据，将来加第三个数据源（地面/水面也可能想贡献 IBL）就要 N² 互斥；
- 状态仍可漂移：外部代码、存档恢复、`auto-*` 来源写入都可绕过联动。

---

## 2. 决策（Decision）

### 2.1 核心：`scene.environment` 所有权归 EnvironmentCapability 独占

**EnvironmentCapability 是「环境贴图」这一功能的正主**（面板名、预设、强度、HDR、直方图、背景控制均在其名下，ADR-268 亦将其归入氛围卡）。因此：

> **决策 D1**：`scene.environment` 的写入权**唯一**归 `EnvironmentCapability`。任何其他 cap **不得**直接给该槽位赋值。

> **决策 D2**：SkyCapability 保留其 IBL **烘焙能力**（`envSky` + PMREM），但降级为 env 的**数据源提供者**——对外暴露「烘焙并交回纹理」的纯函数式接口，由 env cap 决定何时把该纹理装入槽位。

> **决策 D3**：环境贴图面板引入**「来源 / Source」单选**，统一表达该槽位的三个数据源：

```
环境贴图（EnvironmentCapability 独占 scene.environment）
├── 来源：  ○ 预设（programmatic preset：studio / sunset / night / forest …）
│           ○ 跟随天空（sky environment —— 由 SkyCapability 烘焙供给）   ← 原 skyEnvironment
│           ○ 自定义 HDR（文件加载）
├── 环境强度   (envIntensity)
├── 分辨率     (envResolution)
└── 用作背景   (envUseAsBackground)
```

> **决策 D4**：**删除**天空面板中的「环境贴图」开关（原 `skyEnvironment` 控件）与 `preview.environmentMapping` 文案。该功能上移为「来源」的一个选项，不再作为天空的独立开关存在。

### 2.2 状态层表达

`skyEnvironment: boolean` 这一「布尔开关」无法表达三选一的互斥来源。决策：

> **决策 D5**：新增 `envSource: "preset" | "sky" | "custom"`（`group: "environment"`），作为槽位数据源的**单一事实源**。原 `skyEnvironment` 键退役。

存档兼容（`skyEnvironment` 已由 `sky-capability.saveState` 落盘，见 `sky-capability.ts:725`）→ 见 §3.3 迁移。

### 2.3 UI 归属与 ADR-268 一致性

来源选择器落在**氛围卡 → 环境贴图**面板内，与既有的 preset 缩略图 / HDR 选择并列。这符合 ADR-268 的插件式归属：sky 不再自报一个「环境贴图」控件，而是其烘焙能力被 env 面板消费。

**ADR-195 约束**：新增控件须通过 `MenuNode` schema 产出——「来源」用 `kind: "radio"`（或既有等价分段控件）节点，由 `environment-menu.ts` 直产，**不得**引入 schema 外的新 UI 机制。

### 2.4 运行期协调

移除 sky 的直接写入后，剩余协调退化为**单向调用**，无需通用协议：

```
env cap callback (envSource / envPreset / envResolution / envUseAsBackground 变化)
  └─ 若 envSource === "sky"：
       tex = getTypedCap(this.caps, "sky")?.bakeEnvironmentTexture()
       this.setEnvironmentTexture(tex)     // 唯一写点
     else: 走既有 preset / custom 分支
```

天空参数变化需要联动刷新时（原 `skyForceEnv` 语义），同样由 **env cap** 决定是否重新向 sky 取图，sky 仅暴露「我的烘焙输入变了」的查询/通知，不再自行写槽位。

**跨 cap 通知通道**复用既有先例 `getTypedCap(this.caps, "light")`（`sky-capability.ts:497`），由组合根 `createAll` 注入查询器，**不 import registry**（防模块环）。

### 2.5 明确不做

> **决策 D6**：**不**引入 `SceneEnvSlotManager` 之类的通用槽位仲裁器。

理由：当前仅两个写者，且决策 D1/D2 已使写者降为一个。为两个客户造一个仲裁器是**过早抽象**——它会成为只有单一实现方（env）的中间层，徒增一跳间接和一套需要维护的协议。待将来出现**真正独立的第三个** IBL 来源（且其与预设不可归一为「来源」选项）时再抽象，那时需求形态才清晰。

---

## 3. 后果（Consequences）

### 3.1 正面

- **根因消除而非症状压制**：写者唯一 ⇒ 竞争在结构上不存在。E-4 那类「销毁期/重建期争抢」不再需要逐个补 ownership 守卫（守卫可保留为廉价断言）。
- **UI 不再撒谎**：一个面板、一个来源单选，用户看到的就是生效的。冗余控件消失。
- **文案撞名消解**：`preview.environmentMapping` 退役，「环境贴图」一词唯一指代环境面板功能。
- **可扩展**：新增第四个数据源 = 加一个 radio 选项 + 一个 bake 分支，无需与既有来源互斥。
- **符合项目既有取向**：通用化、统一、复用既有函数（`getTypedCap` 注入通道、MenuNode schema、ADR-268 归属）。

### 3.2 负面

- **改动面较大**：触及 2 个 cap、2 个菜单、env-state-schema、i18n、存档迁移，以及 sky 侧约 87 个测试中直接断言 `scene.environment` 归属的用例需重写。属**架构级改动**，需分批落地。
- **`skyEnvironment` 键退役涉及存档迁移**：存档中已落盘的该键须迁移到 `envSource`（§3.3）。迁移逻辑一旦有误，用户重启后环境贴图来源被重置。
- **天空面板失去一个控件**（功能位移，非功能删除）：习惯在天空面板开关 IBL 的用户需要重新建立心智模型。
- **`envSource` 与 `envPreset` 存在语义耦合**：来源为 `"sky"` 时 `envPreset` 无意义但不被清除，需明确「哪个键在何种来源下有效」并加守卫测试，否则成为新的事实源分裂点。（建议 `envSource !== "preset"` 时保留 `envPreset` 原值以备切回，渲染分支忽略之。）

### 3.3 已知遗留 / 待决

- **存档迁移策略待定**：`skyEnvironment: false` 应迁移为 `envSource = "preset"`（用户当时明确不要天空 IBL）；`skyEnvironment: true` 迁移为什么？若此时 `envPreset` 非默认，语义上天空 IBL 曾**覆盖**过 preset，严格还原应取 `"sky"`。需一并确认 `skyForceEnv` 等关联键的处置。
- **迁移落点待定**：本仓已有 `ground-migrations.ts` 先例（前缀化迁移 + 判据），sky/env 是否共用同类纯函数模块待定。
- **`prevEnvironment` 语义**：三个写点收敛后，构造期快照/失败回滚的目标需要重新定义（可能仍是「接管前的场景值」）。
- **`envIntensity` 的跨来源一致性**：`applyEnvIntensity` 作用于 `[this.scene]`，来源切换（如 sky↔preset 分辨率/色域差异）后强度手感是否一致，需视觉验证。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/audit-env-review.md` §S1-4 / §E-4 | 缺陷发现：运行期同槽位竞争 + 文案漂移；E-4 已修 dispose 侧守卫 |
| `sky-capability.ts:445-469` `regenerateEnvironment` / `clearEnvironment` | sky 写槽位的 3 个原始写点 |
| `sky-capability.ts:491-498` `setEnvironmentEnabled` | `skyEnvironment` 语义 + `getTypedCap(this.caps,"light")` 跨 cap 通知先例 |
| `environment-capability.ts:143-159` callback | env 结构性键集（envPreset/envResolution/envUseAsBackground） |
| `environment-capability.ts:341` `pmremToSceneEnv` | env 的唯一正常写槽点 |
| `env-state-schema.ts:92` `skyEnvironment` | 待退役键 |
| `sky-capability.ts:725` `saveState` | `skyEnvironment` 已落盘 ⇒ 迁移必要性的依据 |
| `locales/zh-CN.ts:1372 / 1198-1199` | 文案撞名证据 |
| `scene-capability.ts:42-81` `SceneCapabilityLookup` / `getTypedCap` | 跨 cap 协调的合法通道 |
| ADR-268（环境面板插件式归属）、ADR-195（cap 直产节点）、ADR-196（统一状态层） | 归属与 UI 机制的既有立法 |

<!-- 文件名: scene-environment-sky-ibl-env.md → 实际文件 ADR-292-scene-environment-sky-ibl-env.md -->
