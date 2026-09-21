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
| `env-enabled` + `envPreset`（文案「环境」+ 预设缩略图/HDR） | 环境（氛围卡） | 把**程序化 Canvas 预设或自定义 HDR** 烤成 IBL 写入 `scene.environment` |

两者**是同一件事（为 `scene.environment` 供图）的两个数据源**，却被呈现为用户可见的两个独立开关，且都能开、互相静默覆盖。类比：同一个相框，一个按钮说「放手机拍的照片」，另一个说「放相册里的照片」，两个都能按，后按的赢。

用户视角的故障表现：开了 HDR 环境贴图，调一下太阳角度，HDR 被天空 IBL 顶掉；或反之。**UI 在撒谎——它展示的两个开关都处于「开」，但只有一个在生效。**

### 1.2b 关键发现：「跟随天空」已是既有的 envPreset 值，但没兑现

`envPreset` 的**默认值就是 `"sky"`**（`env-state-schema.ts:308`），且该预设的 label 是
**「天空（跟随 SkyCapability）」**（`environment-state.ts:31-33`）。

即：**「跟随天空」在概念上早已是 env 的一个数据源**，ADR-292 想立的「来源」三元并非新发明——
现状是**名字对了、实现没跟上**：

- `ENV_PRESETS.sky` 只定义了一组静态三色渐变（`zenith/horizon/nadir`），
  经 `drawEnvEquirect` 画成 equirect 贴图（`environment-capability.ts:293-308`）；
- label 承诺「跟随 SkyCapability」，但**没有任何代码去向 SkyCapability 取图**——
  它是**仿**天空，不是**跟随**天空。

因此本 ADR 的实质是**让已有的 `sky` 预设兑现其 label 承诺**，而非新增一套并列概念。
这大幅降低了复杂度与迁移面（见 §3.3）。

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

存档兼容（`skyEnvironment` 已由 `sky-capability.saveState` 落盘为 **sky 槽的 `environment` 键**，见 `sky-capability.ts:725`；⚠️ 非同名键，易错）→ 见 §3.3 迁移。

> **决策 D7（方案形态，2026-09-21 拍板）**：**兑现既有 `envPreset="sky"` 的 label 承诺**，
> 而非新造并列概念。`"sky"` 已是 `envPreset` 的合法值**且为默认值**，label 已写
> 「跟随 SkyCapability」但实际只画静态渐变（§1.2b）。故：
> - `"sky"` 保持为 `envPreset` 的**一个值**（不拆出枚举、不做正交第三轴）；
> - env cap 在 `envSource === "sky"` 时**真正调用** SkyCapability 烘焙取图，
>   不再走 `drawEnvEquirect` 静态渐变路径；
> - `envSource` 的**唯一职责**是表达「哪个数据源在供图」——解决
>   「`preset` 值为 `"sky"` 但用户其实不要天空 IBL」与「自定义 HDR」的区分，
>   而非重复表达 preset 已有信息。
>
> 理由：概念最少、复用最多，且**不触发 `envPreset` 枚举迁移**（无需改写历史存档的 preset 值）。

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

### 3.3 存档迁移语义（已拍板 2026-09-21）

**判据总纲 = 保画面不变。** 旧世界里两 cap 同写 `scene.environment`，env cap 构造在后
（基础卡 sky → 氛围卡 env）且 `loadState` 末尾显式 `buildEnvironment()`（`environment-capability.ts:558`），
故 **env 后写胜出**——旧存档的可见画面由 env 侧决定，**除非 env 功能被整体关掉**。

三条判据，优先级 ① > ② > ③，互斥且穷尽：

| # | 旧存档条件 | 迁移为 | 依据 |
|---|-----------|--------|------|
| ① | env 总开关 **关** + sky IBL **开** | `"sky"` | **唯一强意图信号**：用户关掉了整个环境贴图功能、却留着天空 IBL。此组合下旧世界画面 = 天空烘的 IBL，迁 `"preset"` 会**丢画面**。 |
| ② | `preset === "custom"` | `"custom"` | 用户显式加载过 HDR，画面 = HDR。HDR 二进制不入存档，「缓存是否仍在」由 cap 侧判定（纯函数只看 preset 字符串）。 |
| ③ | 其余（含默认路径） | `"preset"` | 见下「默认路径为何不迁 sky」 |

**默认路径为何不迁 `"sky"`（关键决策）**：
存档 `preset: "sky"`（默认值）+ `environment: true`（默认值）+ `enabled: true`（默认值）
= **用户从未改过任何开关**。旧世界 env 后写胜出 ⇒ 画面是 env 的 `sky` 预设（静态渐变仿天空）。
若把「没关默认开关」解读成「我要天空 IBL」，会把**所有默认用户**迁进 `"sky"`，
且画面从静态渐变突变为真天空烘焙——**迁移引入回归**。故取 `"preset"`。

**两个数据源的存档位置**（分属两个 localStorage 槽，迁移需读齐）：

```jsonc
// localStorage["preview3d.sky"]          ← sky cap 读写
{ "environment": true, ... }             // sky IBL 开关（saveState:725 ↔ loadState:754）

// localStorage["preview3d.environment"]  ← env cap 读写
{ "enabled": true, "preset": "sky", ... } // enabled=总开关（cap 级 this.enabled）
```

**落点**：`envSource` 归属 env ⇒ 由 env 侧决定（决策 D7）。env 需要「sky 想不想要 IBL」
这一个布尔，经既有 `caps` 查询器向 sky 问一句即可（`getTypedCap(this.caps,"sky")` 先例），
**不新增通用协议、不破坏所有权收口**。

**已落地**：迁移纯函数 `frontend/src/preview-3d/caps/environment-migrations.ts`
（`migrateEnvSource` / `normalizeEnvLegacyState`）——零 THREE / 零 DOM / 零 envState，
node 可测，对齐 `ground-migrations.ts` 先例；21 例测试覆盖三判据 + 类型异常容错 + 幂等/无 mutate。

**仍未定**：
- **`custom` 缓存判定落点**：`migrateEnvSource` 只看 `preset === "custom"`；
  「HDR 缓存是否仍在」由 cap 侧在 `loadState` 结合，与既有 custom 无缓存回退 studio 行为一致。
- **`prevEnvironment` 语义**：三写点收敛后，构造期快照/失败回滚目标需重新定义。
- **`envIntensity` 跨来源一致性**：`applyEnvIntensity` 作用于 `[this.scene]`，
  来源切换（预设 Canvas ↔ 真天空烘焙，分辨率/色域差异）后强度手感是否一致，需视觉验证。

**已定：`skyForceEnv` 的处置（批次二，2026-09-21）**

该键原是**两个职责耦合在一个布尔**里：

| 职责 | 用途 | 收口后归属 |
|------|------|-----------|
| A. 重建触发器 | `maybeRegenerateEnvironment` 读它决定「无条件重建」vs「按高度角阈值」 | **env**（装载者） |
| B. 阈值门控旁路 | `skyForceEnv=false` 时按 `PMREM_ELEVATION_THRESHOLD` 判断（防昼夜循环每帧烘焙的 GPU 熔炉） | **sky**（生产者；阈值是烘焙成本问题） |

收口后 A/B 分属两个 cap，但必须协同——原设计把这份协议**塞进了状态层**（一个跨 cap 的 envState 键）。
批次一已建立更好的通道（`bakeEnvironmentTexture()` 直接调用）。故：

> **决策 D8**：`skyForceEnv` **保留为 envState 键**（不退役）——A 职责改由 env 侧
> 「直接调用 `bakeEnvironmentTexture({ force })`」表达；B 职责下沉为 sky 的
> `bakeEnvironment(force)` 私有门控。键仍承载**天空内部的**动画/阈值意图，
> 但**不再承担跨 cap 契约**。

> **决策 D9（强制 vs 省电的取舍）**：`bakeEnvironmentTexture(opts?: { force?: boolean })`——
> env 的**结构性变更**（来源/预设/分辨率切换）传 `force: true`（离散动作，必须拿到当前帧的图，
> 否则切到「跟随天空」后看到旧图）；**连续动画**（昼夜循环）不传，走阈值门控，
> 保留防 GPU 熔炉的历史防线（见 `sky-capability.test.ts` 云量回归用例）。

> **决策 D10（装载权让渡）**：`SkyCapability.requestEnvironmentRefresh()` 取代原先的直接
> `regenerateEnvironment()` 调用——env 声明接管（`isSkySourced()` 为真）时，sky **转交**
> `env.refreshFromSkySource()` 而**不写槽位**；未接管时保留 sky 自持装载（既有行为不回归）。
> 这使「谁写槽位」在运行期也是**单一**的，而非仅靠 dispose 期守卫兜底。

### 3.4 ADR 起草期间的事实更正（留档）

起草本 ADR 时曾据记忆写出两个错误事实，已在核验后更正，留档以防复现：

1. **`envEnabled` 键不存在**：env 面板的「环境」toggle 实为 cap 级 `this.enabled`
   （UI 节点 `env-enabled` → `cap.setEnabled`），**并非 envState 键**。grep `envEnabled` 零命中。
2. **`envPreset` 默认值是 `"sky"` 而非 `"studio"`**（`env-state-schema.ts:308`）；
   `"studio"` 只是 custom 无缓存时的**回退目标**（`environment-capability.ts:329`）。
   此更正直接改变了迁移推理（见 §3.3 默认路径），并催生了 §1.2b 的「既有 sky 预设」发现。

教训：ADR 的背景/事实陈述必须逐条以当前源码树核验，不得凭前序会话记忆落笔。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/audit-env-review.md` §S1-4 / §E-4 | 缺陷发现：运行期同槽位竞争 + 文案漂移；E-4 已修 dispose 侧守卫 |
| `sky-capability.ts:445-469` `regenerateEnvironment` / `clearEnvironment` | sky 写槽位的 3 个原始写点 |
| `sky-capability.ts:491-498` `setEnvironmentEnabled` | `skyEnvironment` 语义 + `getTypedCap(this.caps,"light")` 跨 cap 通知先例 |
| `environment-capability.ts:143-159` callback | env 结构性键集（envPreset/envResolution/envUseAsBackground） |
| `environment-capability.ts:341` `pmremToSceneEnv` | env 的唯一正常写槽点 |
| `env-state-schema.ts:92` `skyEnvironment` | 待退役键（默认 `true` —— 开箱即两个写者都活着，竞争在默认路径上） |
| `sky-capability.ts:725` `saveState` / `:754` `loadState` | `skyEnvironment` 落盘键名为 **`environment`**（sky 槽）⇒ 迁移必要性依据 |
| `env-state-schema.ts:308` `envPreset` 默认值 | **`"sky"`**（非 `"studio"`）——§1.2b 发现的依据 |
| `environment-state.ts:31-33` `ENV_PRESETS.sky` | label「天空（跟随 SkyCapability）」但仅静态三色渐变 ⇒ 未兑现承诺 |
| `environment-capability.ts:293-308` `buildPresetEquirectTex` | sky 预设走 `drawEnvEquirect` 静态路径（待改真调用） |
| `environment-capability.ts:495-508` `saveState` / `:510-559` `loadState` | env 槽键形（`enabled` 为 cap 级总开关，非 envState 键） |
| `environment-capability.ts:558` `buildEnvironment()` | loadState 末尾显式 build ⇒ **env 后写胜出**是迁移判据总纲的依据 |
| `environment-capability.ts:319` `envUseAsBackground` 默认 `false` | 与 `skyEnvironment` 默认 `true` 对比 |
| `environment-migrations.ts`（本次新增） | 迁移纯函数落地 + 21 例测试 |
| `locales/zh-CN.ts:1372 / 1198-1199` | 文案撞名证据 |
| `scene-capability.ts:42-81` `SceneCapabilityLookup` / `getTypedCap` | 跨 cap 协调的合法通道（D7 落点依据） |
| ADR-268（环境面板插件式归属）、ADR-195（cap 直产节点）、ADR-196（统一状态层） | 归属与 UI 机制的既有立法 |
| `ground-migrations.ts` | 迁移纯函数下沉的先例（零 THREE / node 可测 / 幂等无 mutate） |

<!-- 文件名: scene-environment-sky-ibl-env.md → 实际文件 ADR-292-scene-environment-sky-ibl-env.md -->
