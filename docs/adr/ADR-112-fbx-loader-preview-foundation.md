# ADR-112：FBX 格式接入与独立预览地基

- **状态**：✅ 已采纳
- **日期**：2026-08-21
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：`ADR-094 位置路由`、`ADR-066 预览核心`、`ADR-105 子类型自描述`

---

## 1. 背景（Context）

隔壁 **3d-skin（MC-MMD-rust）** 上游已将 **FBX** 列为动画真实格式，与 VMD 并列存在于 `DefaultAnim/`、`CustomAnim/` 等目录。本联邦当前类型系统（`resource_types.json`）的 `CustomAnim` / `DefaultAnim` 仅声明 `.vmd` / `.zip`，**`.fbx` 缺失**（缺口 ❌）。

技术事实核查：

- three 的 `FBXLoader` 已随 `three` 依赖存在于 `frontend/node_modules/three/examples/jsm/loaders/FBXLoader.js`，经 `three/addons/loaders/FBXLoader.js` 动态 import 即可，**零新包**，Vite 自动分包。
- **FBX ≠ MMD 动画格式**：FBX 是「模型 + 骨架 + 内嵌动画」的完整 3D 容器；要让 FBX 动画驱动 PMX 模型，需骨骼名对表、骨架映射、单位换算（MMD cm ↔ FBX m）、四元数处理——three 的 `FBXLoader` 只产出 `AnimationClip[]`，**不提供重定向**。

## 2. 决策（Decision）

**接入 three `FBXLoader`，但地基范围严格限定为「独立 FBX 预览 + 路由登记」；FBX→PMX 重定向明确推迟到后续 ADR/Phase，不混入本地基。**

### 2.1 路由登记（关闭 ❌ 缺口）

新增独立资源类型 `fbx`（`resource_types.json`，group `mmd`）：

| 字段 | 值 | 理由 |
|------|-----|------|
| `id` | `fbx` | 独立于 `CustomAnim`/`DefaultAnim`，避免污染现有 VMD→PMX 动画流 |
| `extensions` | `[".fbx"]` | 扩展名兜底命中 |
| `storageSubDir` | `CustomAnim` | 物理落 `mmd/CustomAnim/`，对齐上游目录布局与用户表 |
| `instanceDir` | `CustomAnim` | 路径消歧双保险（`DetectResourceType` Phase 1） |
| `configField` | `MmdRoot` | 复用 MMD 根配置 |
| `preview` | `"3d"` | 自动脱离 `NO_3D_TYPES`，走 3D opener |
| `detector` | `"extension"` | 纯扩展名判定（FBX 无 zip 指纹） |

Go 侧 `DetectResourceType`（`go/packs/mcmeta.go:142`）读全动态 `ResourceTypeRegistry`（源自 `resource_types.json`，无静态常量表），**加 JSON 即自动识别，无需改 Go 代码**。前端 `ALL_RESOURCE_TYPES` / `RESOURCE_CAPS` / `NO_3D_TYPES` / `AMBIGUOUS_EXTS` 均构建期内联派生，**仅手写 `RESOURCE_TYPES` / `RESOURCE_TYPE_LABELS` 需同步补 `fbx`**。

### 2.2 预览地基

- 新增 `frontend/src/utils/3d/adapters/fbx-adapter.ts`：实现 `PreviewAdapter.build(ctx, path)`（`mount-preview-core.ts:110`），动态 import `FBXLoader`，经 Go RPC `ReadFileBytes` 取字节 → blob URL → `FBXLoader.load()` 挂入共享 scene；`AnimationMixer` 播内嵌 `animations`，经核心 `perFrame` 循环驱动 `mixer.update`；纹理走 `LoadingManager.setURLModifier` → blob URL（Wails 读不了本地盘，复用 MMD 适配器套路）；`dispose` 释放。
- 新增 `frontend/src/views/app-preview/fbx-3d.ts`：薄壳 `createFbx3D` / `cleanupFbx3D` / `invalidateFbxPreview`，镜像 `vrm-3d.ts` / `mmd-3d.ts`；`registerReRoute("fbx", createFbx3D)`。
- `detail-3d.ts` 新增 `showFbxPreview`（镜像 `showMmdPreview`，FAB→`createFbx3D`）；`index.ts` `PREVIEW_HANDLERS` 加 `"fbx"` 分支。

## 3. 后果（Consequences）

**正面**

- `.fbx` 缺口闭合于路由层 + 预览层，端到端可在联邦外壳内预览 FBX（模型 + 内嵌动画）。
- 零新增依赖，动态 import 自动分包，常驻体积不变。
- 独立类型设计不触碰现有 VMD→PMX 动画链路，回归风险隔离。

**负面 / 已知遗留**

- 🟡 **大 FBX 主线程卡顿**：FBX 无 PMX 那种 worker 解析路径，大模型阻塞主线程；先以加载态遮罩兜底，后续评估 worker 化。
- 🟡 **外链纹理**：FBX 外链贴图走相对路径，Wails 下需 blob URL 重定向（地基先支持自包含/内嵌纹理 FBX，外链纹理留待补全）。
- 🟡 **TS 类型**：需验证 `FBXLoader` 是否带 `.d.ts`，缺失则补模块声明。
- 🔴 **FBX→PMX 重定向未做**：本 ADR 明确推迟。若 3d-skin 后续要求「FBX 动画驱动 PMX（等同 VMD 槽位）」，须单列 ADR 研究骨骼映射 + 单位换算。

## 4. 数据溯源

- `resource_types.json:309-328`（CustomAnim）、`:442-461`（DefaultAnim）→ 现状仅 `.vmd`/`.zip`，证 ❌ 缺口。
- `frontend/node_modules/three/examples/jsm/loaders/FBXLoader.js` → 依赖已就位。
- `go/packs/mcmeta.go:142 DetectResourceType` + `go/types` 全动态注册表 → 加 JSON 即生效。
- `frontend/src/utils/resource/types.ts` → `RESOURCE_CAPS`/`NO_3D_TYPES` 派生自 JSON，仅 `RESOURCE_TYPES`/`RESOURCE_TYPE_LABELS` 手写。
- `frontend/src/views/app-preview/index.ts:56-85 PREVIEW_HANDLERS` → 新增 `fbx` 分支落点。

## 5. 未立项方向（范围边界）

- **P0-1 同类型 FBX 切换 / P1 尺度归一**：已落地（实现见知识卡 `app-preview`「siblings」节 / `model3d`「FBX 归一」节，commit `a0b4e9eb`）。
- **P1 待办（ADR-112 §3 负面项剩余）**：外链纹理 blob 重定向、截图面板 UI 接入（`makeShotPanelRenderer`）。
- **P2 待定（取决于 3d-skin）**：FBX→PMX 重定向（骨骼映射 + 单位换算 + 四元数）——仅当 3d-skin 要求「FBX 动画驱动 PMX 等同 VMD 槽位」时单列专项 ADR。

<!-- 文件名: fbx-loader-preview-foundation.md → 实际文件 ADR-112-fbx-loader-preview-foundation.md -->
