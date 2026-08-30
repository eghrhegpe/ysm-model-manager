# ADR-136：截图/离屏渲染领域归位（views/app-preview → features/preview-3d，第四刀）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-31
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/adr/ADR-129-preview-3d-domain-root.md, frontend/src/views/app-preview/screenshot-renderer.ts, frontend/src/views/app-preview/skeleton-render.ts, frontend/src/views/app-preview/model3d-loader.ts, frontend/src/features/preview-3d/screenshot.ts, frontend/src/features/preview-3d/caps/light-capability.ts`

---

## 1. 背景（Context）

ADR-129 三刀把 `utils/3d`（227 文件）整体升格 `features/preview-3d`，3D 预览领域根已成，但 §2.4 点名「views/app-preview 领域逻辑归属待定（第四刀候选）」，并明确本 ADR 不修（控爆炸半径）。第四刀候选的实证撕裂点：

### 1.1 截图领域逻辑一半在 features 一半在 views

| 层 | 文件 | 语义 |
|----|------|------|
| `features/preview-3d/screenshot.ts` | `screenshotFromRenderer` 纯函数（6 适配器复用，ADR-052 P3 通用化） | 已在领域根 |
| `views/app-preview/screenshot-renderer.ts` | `renderMultiAngle` 离屏多角度截图（175 行，**零 DOM、纯 Three.js 离屏渲染**）+ `ScreenshotLights` / `AngleShot` / `RenderMultiAngleOptions` 类型 | 纯领域，**错住视图层** |
| `views/app-preview/skeleton-render.ts:202` | `toScreenshotLights()` 从 LightCapability 提取截图灯光（纯函数，依赖全在 features） | 纯领域，**错住视图层** |

`light-capability.ts:358` 注释就是活的口径分叉证据：「skeleton-render toScreenshotLights 共用——**×0.5 单一事实源，改一处两处同步**」。

### 1.2 依赖结：screenshot-renderer 耦合两个视图层文件

`screenshot-renderer.ts` import `./model3d-loader.ts`（`loadTextures`）与 `./wasm.ts`（`decodeYsmViaWasm`）——这是搬移时最大的暗礁：直接搬进 features 会造成 features → views 反向依赖（违反 ADR-072「features 不反向依赖 views」边界判据）。

- `loadTextures` 本身 99% 是领域工具（只用 `textureCache`，textureCache 已在 features），是「纹理 URL → THREE.Texture 并行加载」，不该住视图。
- `decodeYsmViaWasm`（wasm.ts，836 行）深耦合视图兄弟（cache / geometry / parse-ysm-json / texture-order / utils），是**加载解码胶水**，不属于本刀范围（那是更大的第五刀候选）。

### 1.3 视图层职责错位

`skeleton-render.ts` 混装三种东西：纯 DOM 创建（`buildStatsCard` / `buildToggleRow` / `buildBoneExportRow`，该留视图）+ 纯领域截图编排（`toScreenshotLights` / `renderFrame` / `renderFrontFrame`，该走）+ 视图壳职责（`saveScreenshot` 调 `getApp().SaveScreenshotFile`，该留视图——Go binding 归视图壳，ADR-072 判据）。

---

## 2. 决策（Decision）

**把截图/离屏渲染领域整体归位 `features/preview-3d`，视图层只留 DOM/文件保存编排与平台胶水。** 复用 ADR-072 边界判据：features 不反向 import views；视图壳负责调 Go binding、把数据链注入领域层。本刀是归属正名，不改变业务逻辑，物理搬移 + 依赖方向修复，行为由既有测试守。

### 2.1 迁移方案（对应 ADR-129 §2.4 第四刀）

| 项 | 去向 | 理由 |
|----|------|------|
| `ScreenshotLights` 类型 + `toScreenshotLights()` | `features/preview-3d/`（并入 `screenshot.ts` 或新建 `screenshot-lights.ts`） | 纯领域，消灭「改一处两处同步」分叉——`toScreenshotLights` 归位后 `light-capability.ts:358` 注释改口为「features 内同源」 |
| `renderMultiAngle` 整文件（screenshot-renderer.ts） | `features/preview-3d/screenshot-render.ts`（纯领域无 DOM，直接搬，顺手清死 import `bus`） | 纯 Three.js 离屏渲染，与 `screenshot.ts` 同域 |
| `loadTextures` | `features/preview-3d/`（并入 `texture-cache.ts` 或独立 `texture-loader.ts`） | 99% 领域工具（只用 textureCache），迁移后 `model3d-loader.ts` 从 features import |
| `decodeYsmViaWasm` | **留在 views/app-preview/wasm.ts**，通过 `RenderMultiAngleOptions` 依赖注入（`decodeYsm?: (path) => Promise<DecodedYsm | null>`） | 深耦合视图兄弟，不搬；注入保持 features 0 views import |

### 2.2 关键约束

- **只改物理位置与依赖方向，不改业务逻辑**：`renderMultiAngle` / `toScreenshotLights` / `loadTextures` 实现原样搬移；`renderMultiAngle` 的 WASM 兜底从直接 import 改为 options 注入（行为等价，测试 mock 路径同步）。
- **features/preview-3d 维持 0 个 views import（运行时）**：本刀完成后 `screenshot-render.ts` / `screenshot.ts` / `texture-cache.ts` 只 import features 内部 + utils/backend 正向；视图层（skeleton-render / model3d-loader / shot-panel-shared）从 features import。类型 import（`YsmContentHandle` 等 control bridge 类型）为本刀范围外既存债，不扩大小刀。
- **`saveScreenshot` 留视图**：它调 `getApp().SaveScreenshotFile`（Go binding）——视图壳职责，本刀不动；但其中 `renderFrame` / `renderFrontFrame` / `toScreenshotLights` 调用改指 features 新路径。
- **不引入新机制**：复用既有 `ScreenshotLights` / `AngleShot` / `RenderMultiAngleOptions` 契约与 `textureCache`，不新增抽象。
- **测试同迁**：`screenshot-renderer.test.ts` 随实现搬到 features（mock 路径从 `./model3d-loader.ts` / `./wasm.ts` 改为注入/features 新路径）；`skeleton-render.test.ts` / `model3d-loader.test.ts` 的 mock 目标同步指向 features。

### 2.3 不在本 ADR 范围

- **wasm.ts 解码流水线（836 行）归位 = 第五刀候选**：依赖 cache / geometry / parse-ysm-json / texture-order / utils 等视图兄弟，搬动面大，本刀只做 `decodeYsmViaWasm` 依赖注入隔离，不搬。
- **controls bridge 类型反向引用**：`mmd-adapter` / `vrm-adapter` / `ysm-adapter` import `views/app-preview/{mmd-controls,ysm-controls}.ts` 的 type（MmdPlayBridge / YsmContentHandle 等）——既存债，本刀不处理（未划完的边界，勿以为已闭合）。
- **`shot-panel-shared.ts` 归位**：`saveScreenshot` 依赖 + i18n/`PreviewMenuNode`，混视图壳与声明式节点，本刀不动（第六刀候选可评估）。

---

## 3. 后果（Consequences）

### 3.1 正面

- **截图领域单一事实源**：`ScreenshotLights` / `toScreenshotLights` / `renderMultiAngle` / `loadTextures` 归位 features，消灭「改一处两处同步」的分叉注释；`screenshot.ts` 成为截图域入口。
- **依赖方向正**：features/preview-3d 无新增 views 运行时依赖；视图层只做 DOM / Go binding / 平台胶水。
- **边界判据可执行**：`grep "features/preview-3d.*views"` 可验证 0 运行时反向依赖（除既存 type-only control bridge）。
- **为第五刀正地基**：`decodeYsmViaWasm` 注入隔离后，wasm.ts 归位时只需从 features 补 import，不破坏截图域。

### 3.2 负面 / 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| mock 路径大面积同步（screenshot-renderer / skeleton-render / model3d-loader 三份测试） | 🟡 | 测试与实现同迁，改后 `npx vitest --run` 全量验证 |
| 依赖注入改行为（WASM 兜底从直接 import → options） | 🟢 | 注入默认缺省时保持原语义（view 层调用处传 `decodeYsmViaWasm`）；测试覆盖兜底路径 |
| 知识卡 source_files 锚点漂移（utils-export / app-preview / model3d 等卡） | 🟡 | 同步 knowledge 卡 `source_files`，跑 `check-knowledge-drift` 验证 |
| 与并行会话并发（ADR-133/134/135 已登记） | 🟢 | 路径限定提交，只交自己的文件 |

### 3.3 已知遗留

- 第五刀候选：wasm.ts 解码流水线归位（依赖注入已隔离，可独立评估）。
- 第六刀候选：shot-panel-shared.ts 归位评估。
- controls bridge type-only 反向引用为既存债，本刀不修。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `screenshot-renderer.ts` 通读 | 175 行纯领域（`renderMultiAngle` + 3 接口），无 DOM；`bus` import 为死引用 |
| `skeleton-render.ts:202` | `toScreenshotLights()` 纯函数，依赖 `sceneCapabilityRegistry` / `attenuateAmbientForSky`（全在 features） |
| `light-capability.ts:358` 注释 | 「skeleton-render toScreenshotLights 共用——×0.5 单一事实源，改一处两处同步」——口径分叉实证 |
| `screenshot-renderer.ts` import 分析 | 依赖 `model3d-loader.ts`（loadTextures）+ `wasm.ts`（decodeYsmViaWasm）——反向依赖暗礁 |
| `model3d-loader.ts` 通读 | `loadTextures` 只用 `textureCache`（已在 features），99% 领域工具 |
| `wasm.ts` 通读 | 836 行深耦合视图兄弟（cache/geometry/parse-ysm-json/texture-order/utils）——不搬，注入隔离 |
| ADR-129 §2.4 | 点名 views/app-preview 领域逻辑归属待定（第四刀候选），本 ADR 落地 |

<!-- 文件名: screenshot-domain-homecoming.md → 实际文件 ADR-136-screenshot-domain-homecoming.md -->
