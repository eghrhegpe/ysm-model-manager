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
    - applyOverlayMaterial
    - buildGroundOverlaySpec
    - buildGroundSurfaceSpec
    - DEFAULT_GROUND_SURFACE_PARAMS
    - effectiveParamsOf
    - generateOverlayPixels
    - generateSurfacePixels
    - GROUND_CANVAS_STYLES
    - GROUND_MAT_PARAMS
    - GROUND_OVERLAY_STYLES
    - GROUND_SOURCE_KINDS
    - GROUND_SURFACE_MODES
    - GroundAxisMapping
    - GroundCanvasStyle
    - GroundCapability
    - GroundMaterialParams
    - GroundMatParam
    - groundMatSourceFromAxes
    - GroundOverlayParams
    - GroundOverlaySpec
    - GroundOverlayStyle
    - GroundSourceKind
    - GroundSurfaceAppearanceSpec
    - GroundSurfaceMode
    - groundSurfaceNeedsRebuild
    - GroundSurfaceSpec
    - GroundSurfaceStructuralSpec
    - migrateGroundMatSource
    - OVERLAY_TEX_SIZE
    - overlayNeedsRebuild
    - overlaySpecKey
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
  - **控件参数未进入像素生成 = 死控件**：叠加层初版 `generateOverlayPixels` 硬编码 `sizePx/8` 且不设 `map.repeat`，「叠加格数」滑杆可拖、会触发重建、产出却完全相同。ADR-249 §2.4 矩阵约束：渲染消费的参数菜单必须可见，反之亦然——控件参数必须真实参与像素/材质

use_when:
  - 地面材质 / 地面贴图 / 地板 / surface
  - 材质重建与原地更新的判别（needsRebuild）
  - 程序化纹理生成（噪声材质 plain/marble/sand/grass + 几何图案 grid/checker/stripes/diamond）
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

> ⚠️ **ADR-249 已拆轴**：状态层从单枚举 `groundMatSource`（9 值）拆为来源轴 `groundSourceKind`（none/solid/canvas/texture）+ 样式轴 `groundCanvasStyle`（plain/grid/checker/stripes/diamond/marble，仅 canvas 来源生效）。spec 内部仍以派生的 `GroundSurfaceMode` 运作（`groundMatSourceFromAxes` 往返），渲染管线零改动；菜单从「9 选 1」变为「来源 × 样式」双 select 组装（`none` = 真的关闭表面层，`texture` 来源不再被静默降级）。
扁平 mode 枚举 `"none"|"solid"|"plain"|"grid"|"checker"|"stripes"|"diamond"|"marble"|"sand"|"grass"|"texture"`：单字段表达来源+样式组合。CPU 像素生成（Uint8Array→DataTexture）对齐既有 generateNormalMap 口径，node 可测。

> ⚠️ **ADR-251：`canvasStyle` 混居两个家族**（历史残余）。字段名不体现，但成员分属两类，靠矩阵行为区分：
> - **噪声材质**（`plain`/`marble`/`sand`/`grass`）—— 读 `color2` 色变插值，**不读** `lineColor`（选材质 → 线色控件消失）
> - **几何图案**（`grid`/`checker`/`stripes`/`diamond`）—— 读 `lineColor`（选图案 → 线色出现）
>
> `sand`：高频细颗粒低对比（freq 14 / contrast 0.45）；`grass`：中频块状高对比（freq 5 / contrast 0.95）。两者与 `marble` 共用 `valueNoise` 三倍频基建。
- **stripes**：按 matDensity 密度、matAngleDeg 角度、用 matColor/matColor2 的双色按 1:1 正弦条纹交替
- **diamond**：菱形网格线（单边界，线宽 ≤ 1px，线面积占比 ≤ 50%），底色 matColor、线色 matLineColor
- **marble**：种子化哈希噪声叠加多频三角波，matColor/matColor2 之间插值产生随机大理石紊纹理
- **sand / grass**（ADR-251）：纯噪声材质（三倍频 `valueNoise`，无色带），在 matColor/matColor2 间 lerp；仅频率与对比度不同。`gridSize` 作粒度基准，`density` 作频率倍率，`angleRad` 旋转颗粒。

## 核心职责

- **buildGroundSurfaceSpec(params, textureToken)** → `{ structural:{mode,color,color2,lineColor,gridSize,density,angleRad,textureToken}, appearance:{opacity,textureScale,rotationRad,roughness,metalness} }`（T2 拓展 color2/density/angleRad 均为 structural：变则重建）
- **surfaceSpecKey(spec)**：structural 子集 JSON.stringify 固定字段序确定性序列化；新增结构性字段在此补一行即自动纳入重建判别
- **groundSurfaceNeedsRebuild(prev,next)**：specKey 比较，重建/原地唯一判据
- **applyGroundSurfaceStructural(mat,st,tex)**：重建路径材质组装（有贴图→map+白乘色；无贴图→color 直出）
- **applyGroundSurfaceAppearance(mat,spec,meshSize)**：外观参数**唯一**落地入口（opacity/transparent/depthWrite/PBR/map.center+rotation+repeat）
- **generateSurfacePixels(st,sizePx)**：纯函数像素生成（solid/plain 均匀、checker 奇偶交替、grid 首行首列画线、stripes/diamond/marble 种子化噪声；matColor2 仅 stripes/marble 参与）。**ADR-249 §2.2：`none` 与 `texture` 均返回空数组**——`none` = 真的关闭表面层（历史行为：与 solid/plain 同支返回不透明纯色，造成「控件隐了却仍盖实色」的语义矛盾）；`texture` = 表面来自用户贴图，程序化像素本是死计算（历史未短路，落进尾部 grid 分支画出格线但永不被使用）。消费方判据：空数组 ⇒ 不创建/不显示表面贴图。
- **参数 × 模式生效矩阵（ADR-249 §2.4）**：`GROUND_SURFACE_MODES` / `GROUND_MAT_PARAMS` / `paramIsEffective(mode, param)` / `effectiveParamsOf(mode)`——菜单控件可见性与渲染参数读取的**共同单一事实源**（菜单可见 ⇔ `paramIsEffective` 为真），禁止菜单与渲染各写一份 if。历史缺陷：全部材质控件共用一条粗谓词（仅判 `matSource !== "none"`），致 solid/plain/grid 下「线色/副色/格数」可见可拖可写、渲染却不读——零反馈死控件（用户实测「选纯色还显示线色」）。⚠️ `matScale`/`matRotationDeg` 作用于 `mat.map`：凡产出**或消费**贴图的模式均生效——plain 起的程序化贴图（generateSurfacePixels 产出）+ **texture 的用户自定义贴图**（`mat.map = customTex`，`applyGroundSurfaceAppearance` 对其应用 repeat/rotation，`acceptLoadedTexture` 设 RepeatWrapping 即为此）。ADR-249 矩阵 texture 列对这两项标 ✔，不得被 `if (mode === "texture") return false` 早退一并吞掉（review 1a9517465 P2 回归，34db0ac 修复）。
- GroundCapability 侧：`refreshSurface()` 唯一变更入口（needsRebuild→rebuild 否则 applyAppearance）；自定义贴图照抄 EnvironmentCapability customHdrTex 模式（缓存独立于材质、不随 dispose、不持久化二进制）。**ADR-249 §2.5 第 2 条：loadState 不再静默降级**——历史行为 `v === "texture" && !customTex ? "plain" : v`（因贴图二进制不持久化，重启后 customTex 必空），致用户存档里选的「自定义贴图」重启后变成看似无关的纯色地面；现保留用户来源选择，无贴图的渲染兜底归 `rebuildSurface` 的 `customTex ?? makeGeneratedTexture({...st, mode:"solid"})`（材质层）。
- **拆轴映射（ADR-249 §2.1/§2.5）**：`GroundSourceKind`（来源轴 none/solid/canvas/texture）× `GroundCanvasStyle`（样式轴 plain/grid/checker/stripes/diamond/marble/**sand/grass**，后两者为 ADR-251 补入）+ `migrateGroundMatSource(old)` / `groundMatSourceFromAxes(sourceKind, canvasStyle)` 互逆对。旧单枚举压了两条正交轴（「线色是否适用」属样式轴，「有无贴图」属来源轴），是死控件的根源。
- **叠加层（ADR-249 §2.3 架构 / ADR-251 补齐图案集）**：第三个正交层——独立透明格线 mesh（`ysm-ground-overlay`，y 取 `GROUND_LAYER_OFFSETS.groundOverlay`，介于 surface 与 water 之间），可叠加在任意底层（solid/canvas/texture）之上，实现旧互斥枚举下不可达的「纯色 + 格线」。`GroundOverlayStyle`（none/grid/checker/stripes/diamond）+ `buildGroundOverlaySpec` / `overlaySpecKey`（style/color/size 入 key，opacity 属外观走原地）/ `overlayNeedsRebuild` / `generateOverlayPixels`（透明底 + alpha 二值化线色，none → 空数组；**`cells` 参数驱动格数且必须参与像素生成**——初版硬编码 `sizePx/8` 致「叠加格数」滑杆成死控件，回归修复见 `24be598e8`）/ `applyOverlayMaterial`。**资源所有权**：`overlayTex`/`overlayMat`/`overlay.geometry` 均属 GroundCapability（非 customTex），`dispose` 与切换到 none 时释放（§1.4 第 2 条"谁拥有纹理"的落实）。纹理构造在 capability（`makeOverlayTexture`）而非 spec——spec 保持 `import type * as THREE` 的零运行时依赖（node 可测）。
  - **叠加倍率口径**（review 268cc3c21 P2-3）：`makeOverlayTexture` 设 `tex.repeat = textureRepeat(groundSize, max(1, spec.size))`，与 surface 的 `applyGroundSurfaceAppearance` 同口径（`meshSize/TILE_WORLD_SIZE/scale`）——「叠加格数」滑杆除改贴图像素外，还经 repeat 真实驱动世界格密度（只设 `RepeatWrapping` 而不写 repeat 是无效 wrap，密度恒定）。
  - **overlay.visible 三条同步路径**：① `setVisible(v)` 无条件跟随（`v && enabled`，防「地面已隐、格线还漂」半隐形残影，surface 层同形历史缺陷）；② `setEnabled` 后重算 `refreshOverlay()`（mesh 摘取/重挂后 visible 会 stale）；③ `refreshOverlay` none 分支的销毁只走「曾激活→none」过渡（稳态 none 每次 ground 组变更重入不再置 needsUpdate，避免强制材质重传）。
  - **与 `canvasStyle` 同名值的关系**（ADR-251 §1.3）：`canvasStyle=grid` 是「地面**就是**网格材质」（单层不透明，仅 canvas 来源可用）；`overlay=grid` 是「格线**叠在**底层上」（透明、任意来源、可叠用户贴图）。二者视觉等价当 `overlayColor` 取 `matLineColor`，但能力不同——**共存非冗余**。

## 对外 API / 入口

见上「核心职责」；消费入口 = `GroundCapability.setMat*()` / `setSourceKind`/`setCanvasStyle` / `setOverlay*` 各组 setter/getter + 菜单控件（材质组 `preview.groundGroupMaterial` + 叠加层组 `preview.groundGroupOverlay`）。

## 与其他子系统关系

- 挂在场景能力注册表（scene_capability_registry 卡）的 GroundCapability 内，复用其显隐/持久化/菜单框架，无独立 registry 条目
- i18n key `preview.groundMat*` / `preview.groundOverlay*` ×3 语言包（叠加层新增 `groundGroupOverlay`/`groundOverlay`/`groundOverlayColor`/`groundOverlaySize`/`groundOverlayOpacity`）
- 参考项目 MikuMikuAR ADR-089/226/231（演进线调研结论）

## 已知遗留（ADR-249 §2.7 登记）

1. **旧网格层与表面层字段语义重叠（病例 C）**：`env-state-schema.ts` 同时存在两套语义重叠的地面字段——旧网格层（y=0，`groundType` plain/grid/checker/lines/dots + `groundColor` tuple3 + `groundLineColor` tuple3，即 GridHelper）与表面层（y=0.005，`groundSourceKind`/`groundCanvasStyle` + `groundMatColor` hex + `groundMatLineColor` hex + …）。两套都表达「底色/线色/样式」，是历史层叠的双重实现。**未合并**（ADR-249 显式排除以避免范围蔓延）；合并是独立议题。
2. **地面 y 位置固定**：承接面/叠加层/水膜高度均取 `GROUND_LAYER_OFFSETS` 常量，不可调（与菜单拆轴无关）。
3. **叠加层几何图案已补齐一半**（ADR-251）：已落地 grid/checker/stripes/diamond（与 `canvasStyle` 同族但透明底、可叠任意来源）；scan/glowEdge 等仍待后续扩展（扩展时只需改 `GROUND_OVERLAY_STYLES` + `generateOverlayPixels` 分支）。
4. **第三轴拆分未做**（ADR-251 §2.2 显式拒绝）：`canvasStyle` 仍混居噪声材质与几何图案两家族（字段名不体现）；拆为「材质选择 + 图案选择」两字段需旧存档迁移 + 生效矩阵重构（矩阵输入从单值变值对），评估后判定「收益仅命名洁净、代价为迁移+重构」而保留共存。

## 不变量

1. **单路径原则**：外观参数只经 `applyGroundSurfaceAppearance` 落地，capability 里禁止散落 mutate（合约测试锁死 rebuild==in-place 等价）
2. **纹理密度单点**：`textureRepeat(meshSize,scale)=meshSize/TILE_WORLD_SIZE(10)/scale` 只在 spec 模块算一次
3. **customTex 缓存生命周期**：独立于当前 surfaceTex，dispose 只释放自建纹理；clearCustomTexture 时 wasAttached 才清 surfaceTex 防误判归属
4. **持久化白名单**：loadState 校验 `groundSourceKind ∈ GROUND_SOURCE_KINDS` / `groundCanvasStyle ∈ GROUND_CANVAS_STYLES` / `groundOverlay ∈ GROUND_OVERLAY_STYLES`（非法回退默认）；~~texture 无 customTex 回退 plain~~（**ADR-249 §2.5 已废除**——静默降级致用户来源选择丢失，改为保留来源、渲染层兜底）
5. **默认值单一事实源**：`env-state-schema.ts` 的 `groundMat*` 默认值一律引用 spec 侧 `DEFAULT_GROUND_SURFACE_PARAMS`，禁止重写字面量（历史双源：matGridSize 10/8、matRoughness 0.8/0.85、matLineColor、matColor2 四处分歧，用户实测显示 spec 侧胜出）
6. **GROUND_SURFACE_MODES 单一定义**：由 `ground-surface-spec.ts` 导出，`ground-capability.ts` 不得本地重建同名常量（历史常量双源）
7. **叠加层资源自有**：`overlayTex`/`overlayMat`/`overlay.geometry` 释放责任全在 GroundCapability（切 none 与 dispose 两路）；叠加层永不触碰 `customTex`/`surfaceTex`（防 MikuMikuAR 907fa26b 式跨层误 dispose）
8. **spec 零运行时依赖**：`ground-surface-spec.ts` 保持 `import type * as THREE`——像素生成只产出 `Uint8Array`，DataTexture 构造一律在 capability（叠加层与表面层同口径，保证 spec 可 node 单测）

## 相关

- `docs/adr/ADR-117-ground-material-spec.md`
- 知识卡 scene_capability_registry.md（能力注册表框架）
