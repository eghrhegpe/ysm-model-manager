---
kind: preview_state
name: 3D 预览全域状态层（ADR-126 P4-A）
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/state/preview-state.ts
  - frontend/src/preview-3d/menu/settings.ts
  - frontend/src/preview-3d/menu/node-types.ts
auto_fields:
  symbols_with_lines:
    - buildCameraSchema
    - buildCrossCuttingControls
    - buildLightingSchema
    - buildPostprocessingSchema
    - buildSettingsControls
    - buildSettingsSchema
    - buildShadowSchema
    - collectPreviewLeafNodes
    - collectPreviewNodeIds
    - collectSettingsCapControls
    - getStateValue
    - isPathAvailable
    - isPreviewFolderNode
    - KNOWN_PATHS
    - PreviewActionMenuCtx
    - PreviewControlSpec
    - PreviewMenuCtx
    - PreviewMenuNode
    - PreviewMenuNodeKind
    - previewSnapshot
    - PreviewSnapshot
    - PreviewStatePath
    - resetActiveComponent
    - resetSettingsListeners
    - setPreviewUiMode
    - setSceneCapabilityLookup
    - setStateValue
    - subscribeSettings
    - toStatePath
  tests:
    - frontend/src/preview-3d/state/preview-state.test.ts
tests:
  - frontend/src/preview-3d/state/preview-state.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 3D 预览面板跨 cap 设置项
  - 预览面板状态改了不生效 / 重开面板值不对
  - P4 子步（A→B→D→C）状态通道复用
  - 新增 KNOWN_PATHS 路径
quick_risk_lines:
  - 预览状态必须走 preview-state.ts 的 KNOWN_PATHS 注册，binding 只填已落地项，未落地键编译期报错
pitfalls:
  - 直接改 preview-state 里的未注册键 → 切页 / 换模后状态回滚；必须经 KNOWN_PATHS 注册
  - 把状态放 sceneRegistry / SlideMenu / 节点字段而非 previewState → 状态无法在 cap 切换时保留；状态通道需集中

use_when:
  - 新增 3D 预览面板跨 cap 设置项
  - 排查预览面板状态改了不生效 / 重开面板值不对
  - 排查条件显隐控件不出现
  - P4 子步（A→B→D→C）状态通道复用参考
  - 评估"某状态是否应进 previewState vs 留在 sceneRegistry/SlideMenu/节点字段"
status: active
---

# 3D 预览全域状态层（ADR-126 P4-A）

## 概览

ADR-125 P1 把 ADR-085 S2「状态单向流」在**设置面板**落地（原 `settings-state.ts` / 六项横切）。ADR-126 P4-A 把该模式**升格到 3D 预览全域**——本文件是升格后的形态，是 P4 系列子步（A→B→D→C）的状态通道地基。

**升格要点**（与 ADR-126 §2.1「7 域类型全声明，binding 只填已落地项」校准对齐）：

| 项 | 旧（ADR-125） | 新（P4-A） |
|----|--------------|-----------|
| 模块 | `state/settings-state.ts` | `state/preview-state.ts` |
| 路径类型 | `SettingsPath`（六项窄联合） | 并入 `PreviewStatePath`（`state/preview-state.ts`，ADR-129 第一刀归位；**2026-09 收紧 = `typeof KNOWN_PATHS[number]`，类型契约即运行时实现**，未落地键编译期报错） |
| 已知路径常量 | `SETTINGS_PATHS` | `KNOWN_PATHS`（**11 项落地**：6 横切 + env.waterMode/groundMatSource + ui.activeComponent + **[2026-09-03 S1] ui.mode / env.skyGroundCap**） |
| 快照函数 | `settingsSnapshot()` | `previewSnapshot()` |
| 公共函数名 | `getStateValue/setStateValue/subscribeSettings/isPathAvailable/resetSettingsListeners/toStatePath` | **保持同名**（通用名，跨子步零额外回归） |

## 核心职责

1. **给已落地的横切设置项一个 `path` 读写口**（`getStateValue/setStateValue`）——六项：`render.frustumCull` / `render.maxFps` / `render.maxPixelRatio` / `render.bloom` / `render.wireframe` / `env.pmrem`。
2. **cap 派生路径惰性解析**：cap 缺席时 `available()=false`，不在构建期冻结（ADR-125 P3 明令禁止的 `if (cap)` 声明期求值反例的根治点）。
3. **订阅通知**（`subscribeSettings`）：供后续把 `05fe24b7` 的手工 refresh 链路降级为「状态变更自动重算」。

**持久化边界（ADR-125 P1 继承，防双写）**：
- 三项无 cap 归属的横切项（frustumCull/maxFps/maxPixelRatio）由本层读写 localStorage，键名与迁移前完全一致。
- bloom/pmrem/wireframe 走 cap 的 get/set 派生映射，**本层不落盘**（cap 存自己的域）。

## 对外 API / 入口

```ts
// 路径类型（编译期契约）
type PreviewStatePath          // = typeof KNOWN_PATHS[number]（11 键联合，2026-09 收紧：类型=实现）
const KNOWN_PATHS              // readonly ["render.frustumCull", ...]（11 项：6 横切 + 2 env 探针 + ui.activeComponent + ui.mode + env.skyGroundCap）

// 状态层（入参窄类型 = typeof KNOWN_PATHS[number]，编译期守「加新路径 = 扩 KNOWN_PATHS + 填 binding」）
getStateValue(path)                       // 读
setStateValue(path, v, { notify?: false }) // 写（滑块高频传 notify:false）
isPathAvailable(path)                     // cap 派生项在 cap 缺席时 false
previewSnapshot()                         // Record<PreviewStatePath, unknown>（全键有值，无黑洞键），供 visibleWhen 纯函数谓词消费
subscribeSettings(listener) → off          // 订阅变更
resetSettingsListeners()                  // 测试隔离
toStatePath(path)                         // 恒等函数（编译期守卫 PreviewStatePath 定义域）
```

> 谓词签名已放宽为 `(s: Partial<PreviewSnapshot>) => boolean`（node 级 visibleWhen / cap 级 MenuControlDef.visibleWhen / SchemaBuilder）：**键存在性仍编译期守卫**（写 `s["ui.activePanel"]` 报 TS7053——[2026-09-03 S1] `ui.mode` 已落地为合法键，dock 级谓词可读），但调用方可传部分快照（代表性快照天然是部分状态）。菜单图 `RepresentativeSnapshot.snapshot` 同步为 `Partial<PreviewSnapshot>`。

## 与其他子系统关系

- **ADR-085**：本层是其 S2「状态单向流」的补全——S1 注册表 / S3 refreshDock 仍有效（`preview-menu/core.ts`）。
- **ADR-125**：本层是其 P1 的升格，六项横切设置的「持久化边界」与「双写防线」原样继承。
- **ADR-126 P4-A→D→C**：本层是 P4 系列地基——P4-B 面板 schema 化、P4-D 可见性谓词化、P4-C dockGroup 解耦都消费本层的状态通道。
- **sceneRegistry（ADR-093）**：角色/动作的**业务状态**（活跃角色、角色列表、menuItems）由其管，本层**不重复造轮**——避免双源。
- **SlideMenuHandle**：面板导航栈由其自管，本层不接管。
- **`PreviewMenuNode` 字段层**：可见性**统一走 `visibleWhen` 谓词**（[2026-09-03 S1] dock 级与内容级同一求值器）——`sharedOnly` / `hideInSelfMode` / `requiresEnvironment` 三个专有布尔已删除；self 模式隐藏写 `(s) => s["ui.mode"] !== "self"`，环境门禁写 `(s) => !!s["env.skyGroundCap"]`，谓词吃本层快照（dock 过滤链 `menu/core.ts dockGroupItemsFor` 与 `render.ts renderMenu` 同源）。
- **`renderCapControls`**：唯一控件渲染器，本层状态通过 `buildCrossCuttingControls()`（`preview-menu/settings.ts`）喂给它。

## 不变量

1. 十一条已落地路径的读写必须经状态层，**不得**在菜单侧直接 `safeSet` 那两个 localStorage 键。
2. cap 派生路径**永不落盘**——双写即双源。
3. `getStateValue/setStateValue/isPathAvailable` 的入参类型是 `typeof KNOWN_PATHS[number]`（窄联合）——加新路径必须先扩 `KNOWN_PATHS` + 填 binding，类型层守住。
4. `PreviewStatePath` = `KNOWN_PATHS` 联合（2026-09 收紧）——**不存在未落地键**，谓词写未落地键（如 `s["ui.activePanel"]`，P4-C 预留）编译报错（TS7053），静默假死从根上消除；谓词入参为 `Partial<PreviewSnapshot>`（可传部分快照，键存在性仍守卫）。
5. 业务状态（角色/动作/面板导航）**不进本层**——留在 sceneRegistry / SlideMenuHandle / 节点字段。

## 相关

- ADR-126（本决策 P4-A）、ADR-125（P1 血统）、ADR-085（S2 补全对象）、ADR-093（sceneRegistry 归属）
- 契约测试：`frontend/src/preview-3d/state/preview-state.test.ts`（30 例，含 [2026-09-03 S1] ui.mode / env.skyGroundCap 两键单测）+ `menu/node-render.test.ts` 编译期契约（@ts-expect-error 锁未落地键 `ui.activePanel` 报错）
- 消费者：`preview-menu/settings.ts`（`buildCrossCuttingControls` 三项横切控件读写走本层）、`menu/core.ts dockGroupItemsFor`（dock 级谓词经 `previewSnapshot()` 读 `ui.mode` / `env.skyGroundCap`）
- 后续：P4-B 面板 schema 化（**已落地 P4-B-1/2**）、P4-D 可见性谓词化（**已落地**：node 级 `visibleWhen`（renderMenu 统一消费 `previewSnapshot()`）+ **[2026-09-03 S1] dock 级 dockGroupItemsFor 同求值器**——三专有布尔删除、状态层扩 `ui.mode`/`env.skyGroundCap` 供 dock 谓词读）、P4-C dockGroup 解耦（按需加 `ui.activePanel`）
