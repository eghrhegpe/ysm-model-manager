---
kind: model3d
name: 3D 预览渲染 model3d
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/
  - frontend/src/views/app-preview/model3d-loader.ts
tests:
  - frontend/src/utils/3d/model3d-spec.test.ts
use_when:
  - 3D 预览
  - Three.js
  - 相机
  - 骨骼渲染
  - 自由相机
  - 3D 截图
  - 纹理加载
  - spec 兜底
  - OrbitControls
invariant_anchors:
  - frontend/src/utils/3d/cube-mesh.ts|computeBoneLocalPos
  - frontend/src/views/app-preview/model3d-loader.ts|specCache
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 相机控制、OrbitControls
quick_risk_lines:
  - 相机定位公式固定：position(0, 80, -120), target(0, 80, 0)
---

# 3D 预览渲染 model3d

## 概览

前端 Three.js 3D 渲染层（`frontend/src/utils/3d/`），**单会话架构**：场景/相机/渲染器/控制器由统一预览核心 `mount3D`（ADR-066）持有单实例，模型内容经适配器（ysm/vrm/mmd/litematic）挂进同一 `ctx.scene`；多模型同框经 `sceneRegistry` 注册表管理（ADR-093，`MAX_MODELS=8`）。曾落地的 RenderSession 对象化（ADR-052）因生产无调用方，render-session.ts 470 行已随 ADR-052 P2 收尾删除，本卡不再描述该链路。

**文件按层分组**：

| 层 | 文件 | 职责 |
|----|------|------|
| **场景/会话层**（核心） | `session-state.ts` / `model3d.ts` / `cube-mesh.ts` | 会话状态复位工具 + Spec 类型枢纽 + 坐标口径工具；会话外壳（mount3D 单实例）见 [preview_core](./preview_core.md) |
| **渲染管线层** | `render-loop.ts` / `camera-setup.ts` / `scene-lights.ts` / `cleanup-helper.ts` | 渲染循环 → 相机定位 → 灯光配置 → 资源释放 |
| **骨骼/几何层**（最大层） | `mesh.ts` / `mesh-builder.ts` / `cube-mesh.ts` / `model-group-builder.ts` / `bone-list.ts` / `bone-visibility.ts` / `bone-raycast.ts` | 骨骼组树构建 → 立方体几何 → mesh 合并 → 骨骼列表/可见性 → 射线拾取 |
| **工具/辅助层** | `quaternion.ts` / `debug-render.ts` / `keymap.ts` / `model3d-spec.ts` | 四元数工具 / debug 叠加 / 键位偏好 / 历史 JS spec 兜底（已废弃） |
| **加载/桥接层** | `model3d-loader.ts` / `spec-builder.ts` | 纹理 + spec 预加载（Go binding 桥接） / spec 构建工具 |

> **ADR-072 已落地**：内容适配器（ysm/vrm/litematic/mmd）已下沉至 `utils/3d/adapters/`，本卡仅覆盖渲染层基础设施。适配器层见知识卡 [preview_core](./preview_core.md)。

几何数据（顶点/法线/UV/骨骼四元数）全部由 Go 端 [go_threejs](./go-threejs.md) 预计算，本层只渲染、不做几何计算。

## 快速导航

| 你想找什么 | 跳到 |
|-----------|------|
| 单会话架构 / 多模型同框 | [§ 对外 API / 入口](#对外-api--入口) + [§ 单会话与多模型同框](#单会话--多模型同框现状adr-093)；外壳见 [preview_core](./preview_core.md) |
| 渲染循环 / 相机 / 灯光 / 材质 | [§ 渲染管线层](#渲染管线层) + [§ 渲染循环与交互](#渲染循环与交互) |
| 骨骼组树 / mesh 合并 / 拾取 | [§ 骨骼/几何层](#骨骼几何层) |
| 坐标口径 / X 轴翻转 / trap #11 | [§ 坐标口径工具](#坐标口径工具) + [不变量](#不变量) |
| 对外 API / 加载入口 | [§ 加载/桥接层](#加载桥接层) + [对外 API / 入口](#对外-api--入口) |
| 废弃兜底 spec | [§ 工具/辅助层](#工具辅助层) |

### 渲染会话（已收敛至统一核心）

会话外壳由 [preview_core](./preview_core.md) 的 `mount3D` 承担（ADR-066，单实例 renderer/scene/camera/OrbitControls/rAF 循环），本卡不再持有会话层代码。渲染内容经 `PreviewAdapter.build(ctx, path)` 挂进 `ctx.scene`，外壳与内容契约（`PreviewScene`：`update`/`dispose`/`resetCamera` 等）见 preview_core 知识卡。

### 坐标口径工具

```typescript
// cube-mesh.ts 导出，统一骨骼位置计算（ADR-052 P3）
export function computeBoneLocalPos(
  bonePivot: Vec3,
  parentPivot: Vec3 | null
): [number, number, number]
```

公式（对齐 YSMViewer/C# ConvertBones）：
- 有父骨骼：`[parent.x - bone.x, bone.y - parent.y, bone.z - parent.z]`
- 无父骨骼：`[-bone.x, bone.y, bone.z]`

**X 轴翻转是 ysmview 口径关键特征**（trap #11 反复修的根源）。

## 渲染管线层

**职责**：从场景初始化到渲染循环的完整执行链。`camera-setup.ts` 定位相机到 Z 负侧（`camera.position.set(0, 80, -120)`，`controls.target(0, 80, 0)`，模型脸朝 Z-）→ `scene-lights.ts` 配置环境光 + 双方向光（`addStandardSceneLights`，快消批收敛自 3D 灯光样板）→ `render-loop.ts` 启动 `requestAnimationFrame` 主循环。

**渲染循环与交互**：
- 默认 OrbitControls 轨道模式，`setRotationMode(false)` 切自由相机（WASD 平移 + 空格/Shift 升降）
- **3D 操作键位 / 相机偏好持久化**（localStorage）：键位存 `KeyboardEvent.code` 物理键，相机速度 `td-cam-speed`（2–200，默认 20），旋转模式 `td-rot-mode`（orbit/free）
- **键位消费链（2026-08-29 修复"改键不生效"）**：设置页存 `KeyboardEvent.code`（`settings/keymap.ts` 捕获）→ `loadTdKeymap()` 读取（`utils/3d/keymap.ts`）→ `input-and-animation.ts` `bindInputHandlers` 按 code 映射成**动作表**（forward/back/left/right/up/down 布尔）→ `mount-preview-core.ts` `mpApplyWasdCameraMotion` 只查动作表，不再硬编码键位。**自定义键位真正生效**（原来消费端硬编码 `keys["w"]` 等，设置页改键白改）。方向键双轨保留（ArrowUp→forward 等，FPS 惯例）；修饰键左右对称（ShiftLeft/ShiftRight 对 down 等价，对齐旧 `keys["shift"]` 行为）。**输入框守卫**：焦点在 INPUT/TEXTAREA/SELECT/contentEditable 时不记录、不 preventDefault——3D 面板内文本框打字不被吞（原 document 级监听无条件吞 w/a/s/d）。
- **相机偏好初始读偏好**（2026-08-29）：会话初始 `camSpeed=loadTdCamSpeed()`、`orbitMode=loadTdRotMode()`，free 模式下同步 `controls.enableRotate=false`（此前硬编码 orbit+速度 20，设置页改相机偏好 3D 打开不生效）
- **材质为 ysmview 风格**：`DoubleSide + transparent + alphaTest:0.1 + depthWrite:true`；alpha 模式由 `texture-alpha.ts getTextureAlphaMode` 逐纹理分类并缓存 userData（ADR-118 Phase A：半透明像素占比 ≤0.5% 视为杂点不判 blend——wine_fox 实测错路面 80.9%→35.6%，8 模型 blend→cutout 翻正，18_wedding 真混合保持 blend）
  - **mesh 级视锥剔除关闭**（2026-08-25 修复）：`mesh-builder.ts` 统一 `mesh.frustumCulled = false`。Three.js 默认 mesh 级剔除常开，但设置页 `ysm_3d_frustumCull` 开关只管 Group 级（`frustum-cull.ts` `cullModelGroups`），单模型场景 Group 级本就豁免，导致 mesh 级剔除始终是场上唯一在跑的剔除机制——骨骼旋转时脸部等扁平小包围球部件落到视锥边缘被误判不可见（"转头脸消失"根因之一）。关闭 mesh 级剔除后，可见性交由 Group 级 `cullModelGroups` 统一管理，多模型同框性能由 Group 级兜底，单模型场景无损。
- **面级透明路由**（ADR-118 Phase B）：`getTextureAlphaInfo(texture)` 一次读像素同时产出全局 mode + `alpha-index.ts` AlphaIndex（小矩形精确扫描 / 大矩形 TILE=8 前缀和）缓存 `userData.ysmAlphaInfo`；`face-split.ts splitMeshByFaceAlpha` 逐三角形 UV 包围盒查 flags 分桶（严格口径：any translucent→blend / hole→cutout / else opaque），`ysm-object.ts` 统一碎片流——cutout/opaque 碎片按 `boneId:texIdx:mode` 烘合，**blend 碎片保持独立 mesh 不烘合**（逐 mesh 深度排序契约）；flipY=true 或无索引纹理回退整图模式。YSM 主链路 `model3d-loader.ts` flipY=false，v 即图像行域无需翻转
- **debug 叠加层**（`debug-render.ts`）：`state.debugMode = "normal"|"pivot"|"bone"` 切换，`rebuildDebug(scene, rootGroup, boneGroupMap, spec, state)` 重建叠加层
- **cleanup**（`cleanup-helper.ts`）：资源释放工具，遍历子对象并调用 `geometry/material/texture` 的 `dispose()`，确保 WebGL 资源完全释放

## 骨骼/几何层

**职责**：骨骼层级组树构建 + 立方体几何生成 + mesh 合并 + 骨骼交互。

- **骨骼组树**：`model-group-builder.ts` 的 `buildModelGroup` 递归构建骨骼 Group 树，`mesh.ts` 的 `buildSceneMesh` 组装完整场景；同一骨骼下按 `boneId + ":" + texIdx` 分组，同组多个 MeshGroup 合并顶点/法线/UV/索引减少 draw call
- **立方体几何**：`cube-mesh.ts` 的 `computeBoneLocalPos` + `buildCubeGeometry` 生成单个 cube 顶点/法线/UV（**坐标口径见上方坐标口径工具**）
- **单个 mesh**：`mesh-builder.ts` 的 `addMeshToBoneGroup` 构造单个 Mesh 并挂到骨骼 Group
- **骨骼交互**：`bone-raycast.ts` 用 `Raycaster.setFromCamera` + `intersectObjects` 做骨骼拾取，命中时组装 `BoneSelectInfo` 调 `handle.onBoneSelect`；`bone-list.ts` / `bone-visibility.ts` 分别维护骨骼列表与可见性切换（`setBoneVisible` / `toggleBone` / `showModelGroup`）
- **四元数**（`quaternion.ts`）：骨骼旋转的 `localRotation` 四元数 `[x,y,z,w]` 工具函数

## 工具/辅助层

- `keymap.ts` — 键位/相机偏好持久化（`loadTdKeymap` / `loadTdCamSpeed` / `loadTdRotMode`）
- `debug-render.ts` — debug 叠加层渲染（pivot 标记 / 骨骼线框）
- `model3d-spec.ts` — JS 端 spec 类型定义与 `buildSpecFromModel` 构建器；`CUBE_EPS` 被 cube-mesh.ts 消费（零厚度面修正/合并 epsilon 单点），`fetchSpec` 被 model3d-loader.ts 调用。与 Go `threejs.Build()` 口径不一致（cubePivot/cubeOrigin 不做 X 取反），仅作前端 spec 类型枢纽与测试黄金样本使用

## 加载/桥接层

**`model3d-loader.ts`**：
- `loadTextures(urls?): Promise<(THREE.Texture | null)[]>` — 并行加载，`flipY=false` + `NearestFilter` + `SRGB`；**null 占位不压缩索引**（全失败时返回 null 占位数组而非空数组）
- `preloadModel(model): Promise<{ texArr, spec, componentTexMap }>` — 纹理 + spec 并行预加载；内部 `fetchSpec` 走 Go `GetModel3DSpec` binding（模块级 `specCache` LRU 缓存上限 20）；Android/网页 viewer 模式降级 WASM 解码兜底（`fetchSpecViaWasmFallback` + `buildSpecFromModel`）。**ADR-114 perComponent：componentTexMap 数据源 = `spec.componentTextures`**（Go GetModel3DSpec 注入，键 = `comp_<i>` 对齐 BuildMulti ModelGroup 命名，zip/7z/解压目录三路同源；`model.componentTextures` 仅旧数据链兼容）——未声明组件（arrow 等投射物）按 YSM 游戏语义用同名纹理，不再依赖全局 texArr 槽位
- `spec-builder.ts` — spec 构建工具（WASM 兜底通道，含 `thicknessEpsilon` 零厚度面修正）；`cubeTexW/cubeTexH` 已对齐 Go 端 per-cube 记录来源 geometry 的 texture_width/height（恒 0 会让多组件 UV 全按第一个 geometry 尺寸归一化 → 缩放错）

**桥接方向**：Go `GetModel3DSpec` ← [go_threejs](./go-threejs.md) `threejs.Build()` → `model3d-loader.ts` `fetchSpec` → 适配器 `build()` 挂进 `mount3D` 统一场景渲染。纹理/模型对象来自 [go_geometry](./go-geometry.md)。

## 对外 API / 入口

`model3d.ts`（类型枢纽，无渲染入口）：
- 类型：`Spec3D` / `SpecModelGroup3D` / `SpecBone3D`（localPosition/localRotation 四元数 [x,y,z,w]/parentId）/ `SpecMeshGroup3D`（positions/normals/uvs/indices/texIdx）/ `BoneSelectInfo` / `BoneMaps`
- re-export：键位/相机偏好（`DEFAULT_TD_KEYMAP` / `loadTdKeymap` / `loadTdCamSpeed` / `loadTdRotMode`，对外统一出口）

渲染入口在统一预览核心 [preview_core](./preview_core.md)（`mount-preview-core.ts`）：
- `mount3D(adapter, path, opts?)` — 会话外壳主入口（单实例 renderer/scene/camera/controls/rAF）
- `switchPreview(path, { keepInScene? })` — 会话内切换 / 同台追加（ADR-066 §5.6；keep 追加即多模型同框）
- `cleanupPreview()` / `invalidatePreview()` — 清理与在途作废竞态守卫
- `preview-library.ts` `openModel3DFullscreen(path, { cooperate? })` — 跨类型统一路由入口（ADR-093 T4）；**方案 A（2026-08-24）**：`cooperate=false` 且有活跃会话时先 `cleanupPreview()` 清理旧活跃全屏层（释放旧内容层 + 复位注册表 + 复原单例），再建新模型——把本函数注释「cooperate=false 会先清理旧的活跃全屏层」从名义变实际；对 ysm/mmd/vrm/litematic 所有类型的「二次点击资源列表」统一生效，不影响 `cooperate=true` 的 keepInScene 追加语义，也不影响会话内 `switchTo` 切换。契约测试见 `preview-library-replace.test.ts`
- 截图：`utils/3d/screenshot.ts` 纯函数（接收 renderer+scene+camera）+ `screenshot-renderer.ts` 离屏多角度

`model3d-loader.ts`：
- `loadTextures(urls?): Promise<(THREE.Texture | null)[]>` — 并行加载，`flipY=false` + `NearestFilter` + `SRGB`；**null 占位不压缩索引**
- `preloadModel(model): Promise<{ texArr, spec }>` — 纹理 + spec 并行预加载；内部 `fetchSpec` 走 Go `GetModel3DSpec` binding（模块级 `specCache` LRU 缓存上限 20）；Android/网页 viewer 模式降级 WASM 解码兜底

## 单会话 + 多模型同框（现状，ADR-093）

**不是多面板多实例**：renderer/scene/camera 单实例，同一会话内可叠加多个模型：

| 机制 | 落点 | 说明 |
|------|------|------|
| 会话外壳 | `mount-preview-core.ts` `mount3D` | 一个预览面板 = 一个会话（renderer/rAF/controls 单例） |
| 模型切换 | `switch-preview.ts` `switchToSession` | 复用外壳重建内容层（ADR-066 §5.6）；对外暴露为 `switchPreview`（mount-preview-core.ts） |
| 多模型同框 | `switchPreview(path, { keepInScene: true })` | 旧内容不移除，新模型 add 进同一 scene（上限 `MAX_MODELS=8`，超量 toast 拒绝） |
| 多蓝图同框（litematic） | `appendLitematicPreview(path)`（`litematic-3d.ts`） | 与 `appendMmdPreview`/`appendVrmPreview` 对称：经 `openModel3DFullscreen(path, { cooperate: true })` → `switchPreview({ keepInScene: true })` 收口；litematic 会话内点菜单 ➕（`preview-menu/core.ts` 行尾「➕ 追加」按钮，**任何非当前候选无条件显示，与类型无关**）亦可触发；各蓝图独立 entry + 各自 dispose，旧内容不误清（2026-08-23 Phase B-1 收口） |
| 场景注册表 | `scene-registry.ts` `sceneRegistry` | 每模型 `roots`/`visible`/`built`/`boneMaps`/`menuItems` 元数据；相机多包围盒累加（`fitCameraToRoots`）、拾取归属、上限计数单一事实来源。**`built.menuItems` 是角色详情 sink**（2026-08-22 收口）：角色详情 `roleDetailView` 按 `entry.menuItems` 中 `kind==="panel" && dockGroup==="model"` 过滤渲染该实体的专属工具；适配器须**同时在 `build()` 返回值里带 `menuItems`**（如 ysm-adapter 既 `ctx.menu.setAdapterItems` 喂 dock 历史通道、又返回值带 `menuItems` 喂角色详情），否则注册进 `sceneRegistry` 的 entry 详情为空。litematic 蓝图切片即此：原仅经 `ctx.menu.setAdapterItems(sliceItems)`（dock 平铺通道），现改为 `buildLitematicScene` 返回值 `menuItems: sliceItems`，使其经角色详情 sink 显示与卸载（commit e8d6f5aa）。dock 模型组（🧍）自 2026-08-22 起恒定直达 roles 面板，不再平铺 model 组项 |
| 拾取 dispatch | 统一拾取器（仅 `registry.count() >= 2` 激活） | 射线命中 → `pickModelByObject` 沿父链反查归属 → `setActive` 切活跃模型 + 换菜单（ADR-093 T5） |

**历史**：ADR-052 的 RenderSession 对象化（2026-08-11）曾为实现「多实例隔离」落地，但 UI 从未出现多面板并存场景——生产无调用方，render-session.ts 470 行随 ADR-052 P2 收尾删除；其「实例字段封装、显式 dispose」思想由 ADR-066 统一核心继承。

## 与其他子系统关系

- 消费方：`app-preview/ysm-3d.ts`（YSM 3D 薄包装，skeleton.ts 经此接入统一外壳）、`utils/screenshot-renderer.ts`（复用 buildSceneMesh + loadTextures 做离屏多角度截图）
- 上游数据：Go `GetModel3DSpec` binding ← [go_threejs](./go-threejs.md) `threejs.Build()`；纹理/模型对象来自 [go_geometry](./go-geometry.md)

## 不变量

- **致命陷阱 #11**：3D 坐标变换是全项目 fix 次数最多的区域（model3d.ts 历史 fix 第一）。坐标口径必须对齐 YSMViewer：pivot X 取反、`from.x = origin.x - size.x`（Go go/threejs 实现）。**消费侧（mesh.ts buildSceneMesh / 各适配器 build）直接透传 Go 坐标，不再二次翻转**；JS 兜底 model3d-spec.ts 的 cubePivot/cubeOrigin **不做 X 取反、与 Go 口径不一致**（已废弃无运行时影响）。改 model2d/model3d/threejs spec 前先 grep `docs/archive/bug-chronicle.md`，改完用自由相机近距验证
- `dispose()` 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/pointer/resize/fullscreenchange 全部监听（Pointer Events 迁移，ADR-047）、dispose controls/renderer/geometry/material、清空容器 —— 缺一即泄漏
- **Three.js 资源 dispose 模式**：移除 `Object3D` 时，`Object3D.remove()` 只从场景图移除引用，**不释放底层 WebGL 资源**。必须遍历子对象并调用 `geometry?.dispose()`、`material?.dispose()`、`texture?.dispose()`
- 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径；JS 兜底算法（model3d-spec.ts）已废弃，不再承担降级职责
- **纹理绑定不静默兜底**（2026-08-23 根除）：`mesh-builder.ts` 槽位越界/缺图 → 灰色占位 + `console.error`（含组件 boneId/期望索引），**绝不「找第一张可用」贴错图**——贴错皮肤还装没事比诚实暴露映射断裂糟糕得多（wine_fox 多组件渲染错乱帮凶）。排查入口：环形日志搜 `纹理槽位缺失`
- **perComponent 纹理链**：Go `FindComponentsInExtractedYSM`（解压目录）/`buildComponents`（zip/7z）给未声明组件挂同名纹理 `ComponentTextures`（TexSlot=0 局部索引）→ `GetModel3DSpec` 经 `injectComponentTextures` 注入 `spec.componentTextures` → 前端 `preloadModel` 转 `componentTexMap` → `ysm-object.ts` 按 `mg.name || mg.id` 查表。**键 = SourceName**（如 "main"/"arm"/"arrow"），与 spec.models[i].name 同源（BuildMulti 中 Name=SourceName，fallback compID="comp_N"）。Go 侧注入时若 SourceName 为空则 fallback `comp_<i>`；前端查表顺序 `mg.name || mg.id` 两路均能命中。**分类索引与绑定索引同一空间**（2026-08-23 收口）：组件分支恒用局部槽 0（mesh-builder 对组件数组 `arr === compTexArr ? 0`），非组件回退全局 `mesh.texIdx`/`resolvedTexIdx`——绝不用全局 texIdx 查组件数组（WASM 路径 TexSlot=组件文件序 i，对长度 1 数组越界 → blend 组件误判 batchable 被烘进不透明批次）。Go 注入侧 SourceName 碰撞（zip 内两子目录同名 geometry）→ log 告警不静默丢映射
- 治理红线 R1：模块级状态不挂 `window.__*`（场景状态收敛进 mount3D 会话 + sceneRegistry）

## ⚠️ 大文件性能阈值

> **状态**：欠账（ADR-049:98）。100MB 上限是唯一防线，但从未在真实设备上实测校准。

### 内存拷贝链（解码时 peak）

网页版 WASM 解码流水线在解码瞬间存在 2-3 份全量拷贝：

```
Go/binding 返回 base64 字符串        ← 拷贝①：文本形态（~1.33× 原始大小）
  │
  ▼
b64ToBytes → Uint8Array             ← 拷贝②：二进制形态（原始大小）
  │
  ▼
_writeHeap → _malloc → HEAPU8.set   ← 拷贝③：WASM 线性内存（原始大小）
  │
  ▼
WASM 解码 → MEMFS 输出文件            ← 拷贝④：WASM 内部 FS（解码后产物）
  │
  ▼
collectOutputFiles → FS.readFile    ← 拷贝⑤：JS 侧读取解码结果
  │
  ▼
parseBedrockGeometry → JSON.parse   ← 拷贝⑥：字符串化 + 解析
```

**关键点**：拷贝③④⑤⑥在解码过程中并存，但拷贝③（`_malloc`）在 `finally` 块中 `_free` 释放（`ysm-parser.ts`），拷贝⑤在读取后通过 `wipeDir` 清理 MEMFS 残留（`ysm-parser.ts`）。**不存在长期泄漏，但解码瞬间 peak 内存可达 ~3-4× 文件大小。**

### 当前 100MB 防线（四层互锁）

| 层 | 文件 | 常量 | 阶段 |
|----|------|------|------|
| 导入层（网页） | `web-common.ts` | `MAX_IMPORT_BYTES = 100MB` | 拖入/选择文件时过滤 |
| 导入层（桌面） | `import-dnd.ts` | 引用 `MAX_IMPORT_BYTES` | 拖入文件时过滤 |
| ZIP 解压 | `extract.ts` | `MAX_ZIP_FILE_BYTES = 100MB` | 单 entry 解压前拦截 |
| NBT 解析 | `nbt-parse.ts` | `MAX_NBT_BYTES = 100MB` | 解压后 NBT 解析前 |
| Spec 构建 | `spec-builder.ts` | `MAX_PARSE_SIZE = 100MB` | 解析 bedrock geometry JSON 前 |
| Go 侧（桌面） | `geometry/parse.go` | `maxParseSize = 100MB` | 服务端解析 |
| Go 侧（桌面） | `litematic/nbt.go` | `maxDecodedBytes = 100MB` | 服务端 NBT 解析 |

所有 100MB 阈值同源（继承自 Go `geometry/parse.go` 的设计值），但 **从未在网页版真实设备上实证**——包括低端手机（4GB RAM）、中端平板、旧款 Chromebook 等边缘场景。

### 解码后释放策略现状

| 策略 | 状态 | 说明 |
|------|------|------|
| `_malloc` → `_free` | ✅ 已落地 | `ysm-parser.ts` finally 块释放 |
| MEMFS `wipeDir` | ✅ 已落地 | `decodeYsmFile` 末尾清理 `/output` 和 `/input`；`decodeYsmFileFromMemory` 不写 MEMFS，无需清理 |
| 并发去重守卫 | ✅ 已落地 | `wasm.ts` `_decodeInFlight` Map，同一路径只解码一次 |
| LRU spec 缓存 | ✅ 已落地 | `model3d-loader.ts` `SPEC_CACHE_MAX = 20`，用 Map 淘汰 |
| Worker 独立 HEAP | ✅ 已落地 | `ysm-worker-loader.ts` stats worker 内独立 WASM 实例，不占主线程 HEAP |
| base64 中间态及时释放 | ⚠️ 依赖 GC | `b64ToBytes` 返回的 `Uint8Array` 在 `_decodeYsmViaWasm` 内无显式释放，依赖 V8 GC（解码结束后自然可达） |
| 大文件导入后 IDB 残留 | ⚠️ 未评估 | 100MB 文件写入 IDB 后删除，IDB 是否及时回收空间未验证 |

### 如需实测阈值

```bash
# 1. 启动网页版
cd frontend && npm run dev:web

# 2. 准备不同大小的测试模型（可用 Python/Node 生成填充骨架）
#    建议测试梯度：10MB、30MB、50MB、80MB、100MB、120MB（超限验证）

# 3. 在 Chrome DevTools → Performance 面板录制解码过程，记录：
#    - JS Heap 峰值（尤其是解码瞬间）
#    - DOM GC 后的常驻内存
#    - 解码耗时
#    - 是否触发 OOM / tab 崩溃

# 4. 至少覆盖 3 类设备：
#    - 低端（4GB RAM，Chrome）
#    - 中端（8GB RAM，Edge）
#    - 高端（16GB+ RAM，Chrome）

# 5. 实测数据填回本表，并据此调整 MAX_IMPORT_BYTES 等阈值
```

## 相关

- [ADR-049](../adr/ADR-049-web-edition-bridge.md) — 网页版桥接（含大文件性能欠账）
- [ADR-052](../adr/ADR-052-render-session-objectification.md) — RenderSession 对象化决策（落地后删除，见文件内后续状态注记）
- [ADR-066](../adr/ADR-066-universal-resource-preview.md) — 统一预览核心（现行会话外壳）
- [ADR-093](../adr/ADR-093-multi-model-scene-core.md) — 多模型同框（sceneRegistry / 拾取 dispatch）
- [ADR-040](../adr/ADR-040-architecture-scale-governance.md) — 架构治理（拆分基准）
- [ADR-047](../adr/ADR-047-android-usability-plan.md) — Pointer Events 统一
- [go-threejs](./go-threejs.md) — spec 生成（Go 端）
- [model2d](./model2d.md) — 2D 预览（同一坐标口径约束）
- [app_preview](./app-preview.md) — 预览面板消费方
- [web-edition 路线图](../roadmap/web-edition.md) — 网页版性能线 R4
- `frontend/src/utils/3d/cube-mesh.ts` — computeBoneLocalPos 工具
