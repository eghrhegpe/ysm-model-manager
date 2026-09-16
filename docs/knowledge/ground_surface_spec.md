---
kind: ground_surface_spec
name: 地面材质 spec 单一事实源 ground-surface-spec
tier: leaf
category: rendering
source_files:
  - frontend/src/preview-3d/caps/ground-surface-spec.ts
  - frontend/src/preview-3d/caps/ground-capability.ts
auto_fields:
  symbols_with_lines:
    - applyGroundSurfaceAppearance
    - applyGroundSurfaceStructural
    - buildGroundSurfaceSpec
    - DEFAULT_GROUND_SURFACE_PARAMS
    - effectiveParamsOf
    - generateSurfacePixels
    - GROUND_CANVAS_STYLES
    - GROUND_MAT_PARAMS
    - GROUND_SOURCE_KINDS
    - GROUND_SURFACE_MODES
    - GroundAxisMapping
    - GroundCanvasStyle
    - GroundCapability
    - GroundMaterialParams
    - GroundMatParam
    - groundMatSourceFromAxes
    - GroundSourceKind
    - GroundSurfaceAppearanceSpec
    - GroundSurfaceMode
    - groundSurfaceNeedsRebuild
    - GroundSurfaceSpec
    - GroundSurfaceStructuralSpec
    - migrateGroundMatSource
    - paramIsEffective
    - surfaceSpecKey
    - textureRepeat
    - TILE_WORLD_SIZE
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 地面材质/地面贴图/地板/surface
  - 材质重建与原地更新的判别（needsRebuild）
  - 程序化纹理生成
  - 自定义图片上传到地面
  - GroundMaterialSpec/specKey/textureToken
quick_risk_lines:
  - 地面材质必须走 ground-surface-spec 的 buildGroundSurfaceSpec，spec 是唯一数据源
pitfalls:
  - 下游手写材质参数 → 与 spec 不一致、needsRebuild 判别错误；必须经 buildGroundSurfaceSpec
  - specKey 不完整 → 相同材质不同渲染；specKey 必须含所有影响渲染的参数

use_when:
  - 地面材质 / 地面贴图 / 地板 / surface
  - 材质重建与原地更新的判别（needsRebuild）
  - 程序化纹理生成（solid/plain/grid/checker/stripes/diamond/marble 像素）
  - 自定义图片上传到地面（TextureLoader）
  - GroundMaterialSpec / specKey / textureToken
perf:
  - cpu-bound
invariant_anchors:
  - frontend/src/preview-3d/caps/ground-surface-spec.ts|buildGroundSurfaceSpec
  - frontend/src/preview-3d/caps/ground-surface-spec.ts|groundSurfaceNeedsRebuild
status: active
---
# 地面材质 spec 单一事实源 ground-surface-spec

## 概览

ADR-117：GroundCapability 的表面材质层（`ysm-ground-surface`，y=0.005 介于网格 y=0 与水面 y=0.01）。架构移植自 MikuMikuAR ADR-226「GroundMaterialSpec 单一事实源」精髓——**spec 是唯一数据源**，所有下游（重建判别、材质落地、纹理密度）只从 `buildGroundSurfaceSpec()` 的产物取值，杜绝双路径手写平行逻辑。

扁平 mode 枚举 `"none"|"solid"|"plain"|"grid"|"checker"|"stripes"|"diamond"|"marble"|"texture"`：单字段表达来源+样式组合。CPU 像素生成（Uint8Array→DataTexture）对齐既有 generateNormalMap 口径，node 可测。新增 3 个像素模式：

> ⚠️ **ADR-249 已决策拆轴**（`sourceKind` 来源轴 + `canvasStyle` 样式轴 + 装饰叠加层），理由：单枚举压了两条正交轴，菜单层无法表达「纯色来源下线色不适用」，直接导致死控件。ADR-249 另要求消除 `DEFAULT_GROUND_SURFACE_PARAMS` 与 `env-state-schema.ts` 的默认值双源（`matGridSize`/`matRoughness` 两处不一致）。实施状态查 ADR-249。
- **stripes**：按 matDensity 密度、matAngleDeg 角度、用 matColor/matColor2 的双色按 1:1 正弦条纹交替
- **diamond**：菱形网格线（单边界，线宽 ≤ 1px，线面积占比 ≤ 50%），底色 matColor、线色 matLineColor
- **marble**：种子化哈希噪声叠加多频三角波，matColor/matColor2 之间插值产生随机大理石紊纹理

## 核心职责

- **buildGroundSurfaceSpec(params, textureToken)** → `{ structural:{mode,color,color2,lineColor,gridSize,density,angleRad,textureToken}, appearance:{opacity,textureScale,rotationRad,roughness,metalness} }`（T2 拓展 color2/density/angleRad 均为 structural：变则重建）
- **surfaceSpecKey(spec)**：structural 子集 JSON.stringify 固定字段序确定性序列化；新增结构性字段在此补一行即自动纳入重建判别
- **groundSurfaceNeedsRebuild(prev,next)**：specKey 比较，重建/原地唯一判据
- **applyGroundSurfaceStructural(mat,st,tex)**：重建路径材质组装（有贴图→map+白乘色；无贴图→color 直出）
- **applyGroundSurfaceAppearance(mat,spec,meshSize)**：外观参数**唯一**落地入口（opacity/transparent/depthWrite/PBR/map.center+rotation+repeat）
- **generateSurfacePixels(st,sizePx)**：纯函数像素生成（solid/plain 均匀、checker 奇偶交替、grid 首行首列画线、stripes/diamond/marble 种子化噪声；matColor2 仅 stripes/marble 参与）。**ADR-249 §2.2：`none` 与 `texture` 均返回空数组**——`none` = 真的关闭表面层（历史行为：与 solid/plain 同支返回不透明纯色，造成「控件隐了却仍盖实色」的语义矛盾）；`texture` = 表面来自用户贴图，程序化像素本是死计算（历史未短路，落进尾部 grid 分支画出格线但永不被使用）。消费方判据：空数组 ⇒ 不创建/不显示表面贴图。
- **参数 × 模式生效矩阵（ADR-249 §2.4）**：`GROUND_SURFACE_MODES` / `GROUND_MAT_PARAMS` / `paramIsEffective(mode, param)` / `effectiveParamsOf(mode)`——菜单控件可见性与渲染参数读取的**共同单一事实源**（菜单可见 ⇔ `paramIsEffective` 为真），禁止菜单与渲染各写一份 if。历史缺陷：全部材质控件共用一条粗谓词（仅判 `matSource !== "none"`），致 solid/plain/grid 下「线色/副色/格数」可见可拖可写、渲染却不读——零反馈死控件（用户实测「选纯色还显示线色」）。⚠️ `matScale`/`matRotationDeg` 作用于 `mat.map`：凡产出**或消费**贴图的模式均生效——plain 起的程序化贴图（generateSurfacePixels 产出）+ **texture 的用户自定义贴图**（`mat.map = customTex`，`applyGroundSurfaceAppearance` 对其应用 repeat/rotation，`acceptLoadedTexture` 设 RepeatWrapping 即为此）。ADR-249 矩阵 texture 列对这两项标 ✔，不得被 `if (mode === "texture") return false` 早退一并吞掉（review 1a9517465 P2 回归，34db0ac 修复）。
- GroundCapability 侧：`refreshSurface()` 唯一变更入口（needsRebuild→rebuild 否则 applyAppearance）；自定义贴图照抄 EnvironmentCapability customHdrTex 模式（缓存独立于材质、不随 dispose、不持久化二进制）。**ADR-249 §2.5 第 2 条：loadState 不再静默降级**——历史行为 `v === "texture" && !customTex ? "plain" : v`（因贴图二进制不持久化，重启后 customTex 必空），致用户存档里选的「自定义贴图」重启后变成看似无关的纯色地面；现保留用户来源选择，无贴图的渲染兜底归 `rebuildSurface` 的 `customTex ?? makeGeneratedTexture({...st, mode:"solid"})`（材质层）。
- **拆轴映射（ADR-249 §2.1/§2.5）**：`GroundSourceKind`（来源轴 none/solid/canvas/texture）× `GroundCanvasStyle`（样式轴 plain/grid/checker/stripes/diamond/marble）+ `migrateGroundMatSource(old)` / `groundMatSourceFromAxes(sourceKind, canvasStyle)` 互逆对。旧单枚举压了两条正交轴（「线色是否适用」属样式轴，「有无贴图」属来源轴），是死控件的根源。

## 对外 API / 入口

见上「核心职责」；消费入口 = `GroundCapability.setMat*()` 12 组 setter/getter（新增 matColor2/matDensity/matAngle） + 菜单控件（group `preview.groundGroupMaterial`，14 控件）。

## 与其他子系统关系

- 挂在场景能力注册表（scene_capability_registry 卡）的 GroundCapability 内，复用其显隐/持久化/菜单框架，无独立 registry 条目
- i18n key `preview.groundMat*` ×3 语言包（新增 `groundMatColor2`/`groundMatDensity`/`groundMatAngle`）
- 参考项目 MikuMikuAR ADR-089/226/231（演进线调研结论）

## 不变量

1. **单路径原则**：外观参数只经 `applyGroundSurfaceAppearance` 落地，capability 里禁止散落 mutate（合约测试锁死 rebuild==in-place 等价）
2. **纹理密度单点**：`textureRepeat(meshSize,scale)=meshSize/TILE_WORLD_SIZE(10)/scale` 只在 spec 模块算一次
3. **customTex 缓存生命周期**：独立于当前 surfaceTex，dispose 只释放自建纹理；clearCustomTexture 时 wasAttached 才清 surfaceTex 防误判归属
4. **持久化白名单**：loadState 校验 matSource ∈ GROUND_SURFACE_MODES（非法回退 none）；~~texture 无 customTex 回退 plain~~（**ADR-249 §2.5 已废除**——静默降级致用户来源选择丢失，改为保留来源、渲染层兜底）
5. **默认值单一事实源**：`env-state-schema.ts` 的 `groundMat*` 默认值一律引用 spec 侧 `DEFAULT_GROUND_SURFACE_PARAMS`，禁止重写字面量（历史双源：matGridSize 10/8、matRoughness 0.8/0.85、matLineColor、matColor2 四处分歧，用户实测显示 spec 侧胜出）
6. **GROUND_SURFACE_MODES 单一定义**：由 `ground-surface-spec.ts` 导出，`ground-capability.ts` 不得本地重建同名常量（历史常量双源）

## 相关

- `docs/adr/ADR-117-ground-material-spec.md`
- 知识卡 scene_capability_registry.md（能力注册表框架）
