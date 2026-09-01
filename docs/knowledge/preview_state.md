---
kind: preview_state
name: 3D 预览全域状态层（ADR-126 P4-A）
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/state/preview-state.ts
  - frontend/src/preview-3d/menu/settings.ts
  - frontend/src/preview-3d/menu/node-types.ts
tests:
  - frontend/src/preview-3d/state/preview-state.test.ts
use_when:
  - 新增 3D 预览面板跨 cap 设置项
  - 排查预览面板状态改了不生效 / 重开面板值不对
  - 排查条件显隐控件不出现
  - P4 子步（A→B→D→C）状态通道复用参考
  - 评估"某状态是否应进 previewState vs 留在 sceneRegistry/SlideMenu/节点字段"
---

# 3D 预览全域状态层（ADR-126 P4-A）

## 概览

ADR-125 P1 把 ADR-085 S2「状态单向流」在**设置面板**落地（原 `settings-state.ts` / 六项横切）。ADR-126 P4-A 把该模式**升格到 3D 预览全域**——本文件是升格后的形态，是 P4 系列子步（A→B→D→C）的状态通道地基。

**升格要点**（与 ADR-126 §2.1「7 域类型全声明，binding 只填已落地项」校准对齐）：

| 项 | 旧（ADR-125） | 新（P4-A） |
|----|--------------|-----------|
| 模块 | `state/settings-state.ts` | `state/preview-state.ts` |
| 路径类型 | `SettingsPath`（六项窄联合） | 并入 `PreviewStatePath`（`state/preview-state.ts`，ADR-129 第一刀归位，原 `preview-menu/node-types.ts:14-21` 七域模板） |
| 已知路径常量 | `SETTINGS_PATHS` | `KNOWN_PATHS`（仍只列 6 项落地） |
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
type PreviewStatePath          // state/preview-state.ts，七域模板（ADR-129 第一刀归位）
const KNOWN_PATHS              // 窄集合：readonly ["render.frustumCull", ...]（6 项）

// 状态层（入参窄类型 = typeof KNOWN_PATHS[number]，编译期守「加新路径 = 扩 KNOWN_PATHS + 填 binding」）
getStateValue(path)                       // 读
setStateValue(path, v, { notify?: false }) // 写（滑块高频传 notify:false）
isPathAvailable(path)                     // cap 派生项在 cap 缺席时 false
previewSnapshot()                         // Record<PreviewStatePath, unknown>，未落地键 undefined，供 visibleWhen 纯函数谓词消费
subscribeSettings(listener) → off          // 订阅变更
resetSettingsListeners()                  // 测试隔离
toStatePath(path)                         // 恒等函数（编译期守卫 PreviewStatePath 定义域）
```

## 与其他子系统关系

- **ADR-085**：本层是其 S2「状态单向流」的补全——S1 注册表 / S3 refreshDock 仍有效（`preview-menu/core.ts`）。
- **ADR-125**：本层是其 P1 的升格，六项横切设置的「持久化边界」与「双写防线」原样继承。
- **ADR-126 P4-A→D→C**：本层是 P4 系列地基——P4-B 面板 schema 化、P4-D 可见性谓词化、P4-C dockGroup 解耦都消费本层的状态通道。
- **sceneRegistry（ADR-093）**：角色/动作的**业务状态**（活跃角色、角色列表、menuItems）由其管，本层**不重复造轮**——避免双源。
- **SlideMenuHandle**：面板导航栈由其自管，本层不接管。
- **`PreviewMenuNode` 字段层**：`sharedOnly` / `hideInSelfMode` / `requiresEnvironment` 是节点自身守卫，本层不复制。
- **`renderCapControls`**：唯一控件渲染器，本层状态通过 `buildCrossCuttingControls()`（`preview-menu/settings.ts`）喂给它。

## 不变量

1. 六条已落地路径的读写必须经状态层，**不得**在菜单侧直接 `safeSet` 那两个 localStorage 键。
2. cap 派生路径**永不落盘**——双写即双源。
3. `getStateValue/setStateValue/isPathAvailable` 的入参类型是 `typeof KNOWN_PATHS[number]`（窄联合）——加新路径必须先扩 `KNOWN_PATHS` + 填 binding，类型层守住。
4. `previewSnapshot()` 返回宽类型 `Record<PreviewStatePath, unknown>`——未落地键位是 undefined，谓词读 `s["ui.mode"]` 安全（falsy）。
5. 业务状态（角色/动作/面板导航）**不进本层**——留在 sceneRegistry / SlideMenuHandle / 节点字段。

## 相关

- ADR-126（本决策 P4-A）、ADR-125（P1 血统）、ADR-085（S2 补全对象）、ADR-093（sceneRegistry 归属）
- 契约测试：`frontend/src/preview-3d/state/preview-state.test.ts`（20 例，随迁自 settings-state.test.ts）
- 消费者：`preview-menu/settings.ts`（`buildCrossCuttingControls` 三项横切控件读写走本层）
- 后续：P4-B 面板 schema 化（**已落地 P4-B-1/2**）、P4-D 可见性谓词化（**已落地：`visibleWhen: (s: PreviewSnapshot) => boolean`**，node-types.ts 签名升级，renderMenu 统一消费 `previewSnapshot()`——原 renderPreviewSchemaContent 调用点已随该函数删除收编）、P4-C dockGroup 解耦（按需加 `ui.activePanel`）
