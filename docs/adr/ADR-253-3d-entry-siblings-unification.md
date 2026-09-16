# ADR-253：3D 入口统一：路由层 siblings 兜底与详情卡收编

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-preview/preview-library.ts`、`frontend/src/views/app-preview/siblings.ts`、`frontend/src/views/app-nav/index.ts`、`ADR-066`、`ADR-132`（**不重复决策**，见 §2.0）

---

## 1. 背景（Context）

### 1.1 同一份「3D 入口」有两条调用路径，能力不一致

`openModel3DFullscreen(path, options?)` 是打开 3D 全屏的唯一路由出口（`preview-library.ts:76`），
其 `OpenModel3DOptions` 已支持 `{ siblings?, cooperate?, rtype? }`。但两个调用方的传参不一致：

| 调用方 | 传参 | 结果 |
|---|---|---|
| 各详情卡 FAB（`detail-3d.ts` `wireFab`） | 先 `await resolveXxxSiblings()` 再 `createXxx3D(path, { siblings })` | 3D 内「当前目录」候选 tab 有内容 |
| 导航栏左下角 FAB（`app-nav/index.ts:322` `_viewerFabClick`） | `openModel3DFullscreen(path)` —— **零 options** | 3D 内候选 tab 为空 |

即：**同一条路径，取决于谁点的按钮，3D 内的模型切换下拉时有时无。**

### 1.2 根因不是隔离，是职责错位

曾怀疑 shadow DOM 隔离导致数据无法透传——**实测证伪**：

- Shadow DOM 隔离 DOM 树，不隔离 JS 模块图；`app-nav` 早已跨 view 静态/动态 import
  app-preview 模块（`app-nav/index.ts:326,330`）。
- `resolveMmdSiblings` / `resolveFbxSiblings` / `resolveSceneSiblings` / `resolveMorphSiblings` /
  `resolveStageSiblings` 均为**零参数导出函数**（`siblings.ts`），不依赖 `ctx`、不碰 DOM。

真正的错位是：**siblings 被当成「详情卡的上下文数据」在 `wireFab` 闭包里现算，而它实际上是
「按 rtype 派生的仓库级候选」**——`resolveSiblingsByType` 走 `GetRepoRoot(rtype)` +
`ScanModelEntriesFiltered(root, rtype, "", label)`（subtype 传空、递归整根），
`mount-preview-core.ts:661` 的 `getSiblings` 也只 `filter(p => p !== session.currentPath)`，
**无需知道当前目录**。

⇒ 凡是能解析出 rtype 的地方都能算出同一份 siblings，而 `openModel3DFullscreen` 内部
**本来就解析了 rtype**（`DetectResourceType` + `resolvePreviewKey`）。数据本可自足，却依赖调用方补齐。

### 1.3 `showResourcePack` 是唯一未收编的详情壳

7 个详情渲染器中，vrm / mmd / fbx / scene / morph / stage 六种统一走
`detail-3d.ts` 的 `showCard(CardShowConfig)`（`renderCard` + `wireFab` + `postRender` 三件套），
唯有 `detail.ts` 的 `showResourcePack()` 手写 innerHTML，未进 `showCard`。

### 1.4 边界申明：容器内多模型选择**已由 ADR-132 决策并落地**，本 ADR 不碰

调查中曾误判「只有资源包能浏览容器内部条目」。实测更正——**三处**均已具备，且都走
ADR-132 的统一原语 `multiModelSelectNode`（`preview-3d/menu/multi-model.ts`）：

| 容器 | 位置 | 节点 id |
|---|---|---|
| MMD zip（多 pmx/pmd） | `mmd-controls.ts:34` | `mmd-model-select` |
| 资源包（多 block/item JSON） | `pack-model-adapter.ts:392` | `pack-model-select` |
| 蓝图/litematic（多 nbt） | `litematic-adapter.ts:509` | `litematic-model-select` |

并为知识卡 `multi_model_select.md` 钉为不变量:「容器内多模型必须经 `multiModelSelectNode`
声明式菜单选择，禁止 adapter 直接遍历 entry 数组渲染」。

因此「详情卡不列出 zip 内条目、需进 3D 切换」**是 ADR-132 的设计选择**（多模型选择属 3D 菜单域），
不是待补缺口。本 ADR 明确**不重复决策、不新增 2D 侧容器浏览 UI**（那会与 ADR-132 及
AGENTS.md「3d菜单只允许 MenuNode schema」冲突）。

## 2. 决策（Decision）

### D0 · 边界：只收口「入口一致性」，不动容器多模型域

本 ADR 的范围严格限定为 §1.1／§1.2／§1.3 三件事。容器内条目枚举与多模型选择归 ADR-132，
本 ADR 不再决策、不改其实现。

### D1 · `openModel3DFullscreen` 在 siblings 缺省时按 rtype 自算兜底

`openModel3DFullscreen` 解析出 `routeKey` / `rtype` 后，若 `options.siblings` 未提供，
则按 routeKey 自算候选（新增 `resolveSiblingsForRoute(routeKey, rtype)` 单一出口，
口径与各详情卡原手算逐一对齐——MMD/FBX 裸扫、场景带 ext 白名单），再随 opener 透传。

- 语义等价保证：与详情卡现算的列表同源同口径（同一 `GetRepoRoot` + `ScanModelEntriesFiltered`）。
- **空候选归一为 `undefined`**：自算结果为空时不写回 `siblings`，保持调用方原行为
  （下游 `getSiblings: () => (opts.siblings ?? [])` 不会把 `[]` 当有效候选列表）。
- 调用方**无需**再手算；旧调用方显式传入的 `siblings` 仍优先（向后兼容）。
- 收益：nav-fab 与详情卡 FAB 的 3D 内下拉行为一致，**不再取决于谁点的**。

### D1b · `registerReRoute` opener 必须转发 `siblings`（实施中发现的必经环节）

仅有 D1 不够：`createMmd3D/Fbx3D/Scene3D/Vrm3D/Pack3D` 虽均接 `opts.siblings`，
但其 `registerReRoute` 回调原写作 `(path) => createXxx3D(path)`，**丢掉了 siblings 第二参**——
D1 算出的候选会在 opener 处被静默丢弃（`preview-library.ts` 的 `_openers[routeKey](path, siblings)`）。

- 决策：全部 opener 对齐 `litematic-3d.ts` 的既有正确写法——
  `(path, siblings) => createXxx3D(path, siblings ? { siblings } : undefined)`
  （`siblings ? ... : undefined` 而非 `{ siblings }`，避免 `exactOptionalPropertyTypes` 下传 undefined 字段）。
- 涉及：mmd / fbx / mmd-scene / vrm / pack 五处（litematic / blueprint 原本已正确）。
- 意义：**这是「统一」的真正收口点**——不同步修此条，D1 就是死代码。

### D2 · 详情卡 `wireFab` 移除手算 siblings

`detail-3d.ts` 三处（mmd / fbx / scene）`wireFab` 内的 `await resolveXxxSiblings()` 删除，
改为 `void openModel3DFullscreen(path)`（走统一路由，siblings 由 D1 补齐）。

- 同时删除随之失效的 import（`createMmd3D` / `createFbx3D` / `createScene3D` /
  `resolveMmdSiblings` / `resolveFbxSiblings` / `resolveSceneSiblings`）。
- VRM 的 `wireFab` 原本就未传 siblings（直调 `createVrm3D(path)`），本次一并对齐为路由调用；
  YSM 的 `#btn-3d-preview` 因携带 ctx 绑定的 `loader` / `onClose`，**不在本决策范围**（见 D3）。

- `siblings.ts` 的 `resolve*` 薄封装保留（`resolveSiblingsByType` 仍是 D1 的底座，且测试直接消费）。
- `showMorphPreview` / `showStagePreview` 的 `postRender` 用 `resolveMorphSiblings` /
  `resolveStageSiblings` 渲染**列表 UI**，属列表展示而非 3D 入口传参，**保留不动**。

### D3 · nav-fab 成为格式卡 FAB 的超集后，才允许删除详情卡 FAB

D1 落地后，nav-fab 与详情卡 FAB 的差异仅剩：

| 能力 | nav-fab（D1 后） | 详情卡 FAB |
|---|---|---|
| 打开目标 | 最近选中模型（`getLastModelPath`） | 当前预览模型 |
| siblings | ✅（D1 补齐） | ✅ |
| `_prefer3D` 偏好持久化 / 再点关闭 / `onClose` 复位 / android-back | ❌ | ✅ |

**决策**：删除详情卡 FAB 的前提是「差异项已被判定为可放弃」。当前 `btn-3d-preview` 独有的
「再点关闭 + 偏好记忆 + onClose 复位」是**交互语义**而非冗余实现，故：

- **本 ADR 不授权删除任何 FAB**；
- FAB 收敛（含是否迁移 `_prefer3D` 语义到路由层）另立决策，须以 D1 落地为前提。

### D4 · `showResourcePack` 收编进 `showCard`

`detail.ts` 的 `showResourcePack` 改为 `showCard(CardShowConfig)` 形态（`renderCard` +
`wireFab` + `postRender`），消除最后一个手写详情壳。数据通道（`ReadPackMeta` /
`ListPackModelsDetail`）不变，仅收敛渲染装配方式。

### D5 · 3D 切换机制与 2D 骨架加载解耦（实施中发现的缺陷修复）

`loadModel2D` 内的 3D 切换块（`_toggle3D` / `close3D` / `onClose` / android-back / FAB 绑定 /
`_prefer3D` 自动弹）**必须在 `try` 之前同步执行**，不得位于 2D 骨架加载成功路径末端。

- 原因：该块只依赖入参 `modelPath` 与 `ctx`，与 `loadModelData` 的结果无关；
  置于 try 尾部会使 FAB 在「解析失败 / 无 bones / 摘要提取失败」三条路径上永不绑定 → 死点击。
- 兼容性：A 的迟到渲染不会污染 B 的按钮——同步绑定发生在 A 自己的渲染时机，
  B 后续重建 `innerHTML` 得到的是全新未绑定按钮（既有跨文件污染守卫用例仍绿）。

### 否决的方案

- **否决「给 `_toggle3D` 加空 model 兜底」**（D5）：治标——根因是绑定时机错位，不是缺数据。
- **否决「在 detail.ts 渲染 FAB 时立即绑一个占位 handler」**（D5）：会导致两处绑定源、
  后者覆盖前者，新增隐性顺序依赖。

- **否决「给 nav-fab 加与详情卡并列的 siblings 计算」**：治标不治本，同类第 3 个调用方还会再漏一次。
- **否决「在详情卡新增 zip 内条目列表 UI」**：与 ADR-132 冲突（容器多模型选择属 3D 菜单域），
  且违反知识卡不变量。
- **否决「依赖 shadow 穿透/全局变量传 siblings」**：违背 §1.2 —— 问题不在隔离，在职责错位。
- **否决「本 ADR 一并删除详情卡 FAB」**：差异项含交互语义（§D3），须单独决策。

## 3. 后果（Consequences）

### 正面

- 3D 内模型切换下拉**不再取决于入口**，行为一致（消除 §1.1 的不一致）。
- siblings 计算从 N 个调用方收敛到路由层**单一出口**，新增调用方零成本获得。
- 详情卡少一层异步（不再为传参而 `await` 扫描），FAB 点击更快进入 3D。
- 消除最后一个手写详情壳，7 个渲染器同构。

### 负面 / 风险

- 路由层多一次扫描：若调用方本就已算好，D1 的兜底不会触发（显式 `siblings` 优先），无额外开销；
  仅 nav-fab 路径新增一次扫描，与详情卡原开销同量级。
- `rtype` 无法解析（探测失败）时 siblings 兜底为空 → 退化为当前行为（下拉不渲染），
  **不阻断** 3D 打开。

### 已知遗留

- 详情卡 FAB 的存废与 `_prefer3D` 语义迁移（§D3）待单独决策。
- ~~YSM 详情卡 `#btn-3d-preview` 的「延迟绑定致错误路径下点击无响应」缺陷~~
  **已于 2026-09-16 修复**（§D5）：原 `btn3d.onclick` 挂在 `loadModel2D` 的 try 尾部
  （所有 `await` + 两个早退之后），解析失败 / 无 bones / 摘要提取失败三条路径上 FAB
  渲染出来却点击无反应。修复方式：把整块 3D 切换机制（`_toggle3D` + FAB 绑定 +
  `_prefer3D` 自动弹）提到 `try` **之前**同步执行——依据是 `_toggle3D` 只依赖 `modelPath`
  参数与 `ctx`，与 2D 加载出的 `model` 无关（3D 侧自带 `loader` 重新加载）。

## 4. 数据溯源

- 来源：`skeleton.ts` `loadModel2D`（D5 修复现场：3D 切换块原位于 try 尾部）、
  `preview-library.ts:52-64`（`OpenModel3DOptions` 已含 siblings）、
  `preview-library.ts:76`（`openModel3DFullscreen`）、`app-nav/index.ts:322`（零 options 调用）、
  `siblings.ts:41`（`resolveSiblingsByType` 按 rtype 扫描）、
  `mount-preview-core.ts:661`（getSiblings 仅滤 currentPath，**无同目录过滤**）、
  `detail-3d.ts`（4 处 wireFab 手算）、`detail.ts:150`（`showResourcePack` 手写壳）、
  `mmd-controls.ts:34` / `pack-model-adapter.ts:392` / `litematic-adapter.ts:509`（ADR-132 三处已落地）
- 结果：siblings 归路由层自足（D1），详情卡去手算（D2），FAB 删除设前置条件（D3），
  资源包详情收编 `showCard`（D4）；容器多模型域维持 ADR-132 不动（D0）。

<!-- 文件名: 3d-entry-siblings-unification.md → 实际文件 ADR-253-3d-entry-siblings-unification.md -->
