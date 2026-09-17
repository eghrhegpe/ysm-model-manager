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
    - GROUND_CANVAS_STYLES
    - GROUND_MAT_PARAMS
    - GROUND_MATERIAL_PRESET_IDS
    - GROUND_MATERIAL_PRESET_KEYS
    - GROUND_MATERIAL_PRESETS
    - GROUND_OVERLAY_STYLES
    - GROUND_SOURCE_KINDS
    - GROUND_SURFACE_MODES
    - GroundAxisMapping
    - GroundCanvasStyle
    - GroundCapability
    - GroundMaterialParams
    - GroundMaterialPreset
    - GroundMaterialPresetDef
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
    - LEGACY_CANVAS_PATTERNS
    - LEGACY_GROUND_MAT_SOURCES
    - LegacyGroundMatSource
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
  - 控件参数未进入像素生成 = 死控件：叠加层初版 `generateOverlayPixels` 硬编码 `sizePx/8` 且不设 `map.repeat`，「叠加格数」滑杆可拖、会触发重建、产出却完全相同。ADR-249 §2.4 矩阵约束：渲染消费的参数菜单必须可见，反之亦然——控件参数必须真实参与像素/材质
    # ⚠️ 本行去粗体：frontmatter 是 YAML，行首 `*` 会被当 alias 引用 → VitePress 报
    #   `unidentified alias`（Pages 长期红）。详见 app_content_settings 卡同处说明。

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

> ⚠️ **ADR-249 + ADR-252 已拆三轴**：状态层从单枚举 `groundMatSource`（9 值）拆为：
> - 来源轴 `groundSourceKind`（none/solid/canvas/texture）
> - **材质轴** `groundCanvasStyle`（plain/marble/sand/grass，仅 canvas 来源生效）
> - **装饰轴** `groundOverlay`（none/grid/checker/stripes/diamond，透明底、可叠任意来源）
>
> **ADR-252 关键收敛**：几何图案（grid/checker/stripes/diamond）**已从 canvasStyle 迁出**——它属于叠加层，不是材质。故 `GroundSurfaceMode` = `none|solid|plain|marble|sand|grass|texture`（**运行时不含图案**）；旧 9 值扁平枚举另立为 `LegacyGroundMatSource`，**仅作迁移输入**。菜单不再需要分组标注：每个轴只装一类。
>
> ⚠️ **ADR-254 材质名兼现配色**：`canvasStyle` 原本只控形状（频率/对比度）、颜色正交——于是选「草地」得到的是**棕色斑块**（默认 matColor/matColor2 均棕）。现增 `GROUND_MATERIAL_PRESETS`（**配色唯一事实源**）+ 显式状态 `groundMaterialPreset`（plain|marble|sand|grass|custom）：选材质 = **一次性写入形状+配色**；手改预设关心的字段 → 中间件置 `custom`（菜单下拉可见）。
>
> ⚠️ **中间件与存档恢复的边界**（审核 1807efcd7 修正）：「手改即 custom」中间件只许拦**用户 setter** 写入——`loadState` 恢复路径必须 `skipMiddleware: true`（`setEnvState` opts 通道），否则逐字段还原配色会触发中间件，用户选的预设重启恒显示「自定义（已手改）」（名实不符）；`groundMaterialPreset` 须持久化（saveState 写、loadState oneOf 恢复，旧存档缺字段回退 plain）。**教训：新增全局写入中间件 = 同时定义「豁免通道」，恢复/同步类非用户写入一律显式豁免。**
> ⚠️ **legacy 迁移分支禁止整对象替换**（同轮实测发现）：`state = migrated` 会把混合存档（旧键+已前缀化新键共存，如 `{visible, groundCanvasStyle}`）中未映射的 `ground*` 键静默丢弃——迁移后须透传 `ground` 前缀键保底。
>
> `sand`：高频细颗粒低对比（freq 14 / contrast 0.45）；`grass`：中频块状高对比（freq 5 / contrast 0.95）。两者与 `marble` 共用 `valueNoise` 三倍频基建。
- **marble**：种子化哈希噪声叠加多频三角波，matColor/matColor2 之间插值产生随机大理石紊纹理
- **sand / grass**（ADR-251）：纯噪声材质（三倍频 `valueNoise`，无色带），在 matColor/matColor2 间 lerp；仅频率与对比度不同。`gridSize` 作粒度基准，`density` 作频率倍率，`angleRad` 旋转颗粒。

> **平铺已具备，不需 PNG**（ADR-254 §5 更正）：`makeGeneratedTexture` 产出 512² `DataTexture` + `RepeatWrapping`，由 `textureRepeat(meshSize, scale)` 驱动 `repeat`——地面尺寸变化时平铺密度自适应，大平面/无限地面均可复用。**「贴图」是「可无限平铺的载体」，不是程序化的替代品**；若日后要提形状真实度（草叶各向异性、大理石脉络），改噪声函数与换贴图资产**都是候选**，不预设哪条。

## 核心职责

- **buildGroundSurfaceSpec(params, textureToken)** → `{ structural:{mode,color,color2,gridSize,density,angleRad,textureToken}, appearance:{opacity,textureScale,rotationRad,roughness,metalness} }`（color2/density/angleRad 均为 structural：变则重建。**ADR-252 移除 lineColor**——无表面模式读它）
- **surfaceSpecKey(spec)**：structural 子集 JSON.stringify 固定字段序确定性序列化；新增结构性字段在此补一行即自动纳入重建判别
- **groundSurfaceNeedsRebuild(prev,next)**：specKey 比较，重建/原地唯一判据
- **applyGroundSurfaceStructural(mat,st,tex)**：重建路径材质组装（有贴图→map+白乘色；无贴图→color 直出）
- **applyGroundSurfaceAppearance(mat,spec,meshSize)**：外观参数**唯一**落地入口（opacity/transparent/depthWrite/PBR/map.center+rotation+repeat）
- **generateSurfacePixels(st,sizePx)**：纯函数像素生成（solid/plain 均匀、checker 奇偶交替、grid 首行首列画线、stripes/diamond/marble 种子化噪声；matColor2 仅 stripes/marble 参与）。**ADR-249 §2.2：`none` 与 `texture` 均返回空数组**——`none` = 真的关闭表面层（历史行为：与 solid/plain 同支返回不透明纯色，造成「控件隐了却仍盖实色」的语义矛盾）；`texture` = 表面来自用户贴图，程序化像素本是死计算（历史未短路，落进尾部 grid 分支画出格线但永不被使用）。消费方判据：空数组 ⇒ 不创建/不显示表面贴图。
- **参数 × 模式生效矩阵（ADR-249 §2.4）**：`GROUND_SURFACE_MODES` / `GROUND_MAT_PARAMS` / `paramIsEffective(mode, param)` / `effectiveParamsOf(mode)`——菜单控件可见性与渲染参数读取的**共同单一事实源**（菜单可见 ⇔ `paramIsEffective` 为真），禁止菜单与渲染各写一份 if。历史缺陷：全部材质控件共用一条粗谓词（仅判 `matSource !== "none"`），致 solid/plain/grid 下「线色/副色/格数」可见可拖可写、渲染却不读——零反馈死控件（用户实测「选纯色还显示线色」）。⚠️ `matScale`/`matRotationDeg` 作用于 `mat.map`：凡产出**或消费**贴图的模式均生效——plain 起的程序化贴图（generateSurfacePixels 产出）+ **texture 的用户自定义贴图**（`mat.map = customTex`，`applyGroundSurfaceAppearance` 对其应用 repeat/rotation，`acceptLoadedTexture` 设 RepeatWrapping 即为此）。ADR-249 矩阵 texture 列对这两项标 ✔，不得被 `if (mode === "texture") return false` 早退一并吞掉（review 1a9517465 P2 回归，34db0ac 修复）。
- GroundCapability 侧：`refreshSurface()` 唯一变更入口（needsRebuild→rebuild 否则 applyAppearance）；自定义贴图照抄 EnvironmentCapability customHdrTex 模式（缓存独立于材质、不随 dispose、不持久化二进制）。**ADR-249 §2.5 第 2 条：loadState 不再静默降级**——历史行为 `v === "texture" && !customTex ? "plain" : v`（因贴图二进制不持久化，重启后 customTex 必空），致用户存档里选的「自定义贴图」重启后变成看似无关的纯色地面；现保留用户来源选择，无贴图的渲染兜底归 `rebuildSurface` 的 `customTex ?? makeGeneratedTexture({...st, mode:"solid"})`（材质层）。
- **拆轴映射（ADR-249 §2.1/§2.5 + ADR-252）**：`GroundSourceKind`（来源轴 none/solid/canvas/texture）× `GroundCanvasStyle`（**材质轴** plain/marble/sand/grass）× `GroundOverlayStyle`（装饰轴 none/grid/checker/stripes/diamond）。`migrateGroundMatSource(old: LegacyGroundMatSource | GroundCanvasStyle)` → `GroundAxisMapping { sourceKind, canvasStyle?, overlayStyle? }`——**不再互逆**：旧图案值拆为 plain 底座 + 叠加层（并须搬运 `matLineColor→overlayColor`、`matGridSize→overlaySize`）。`groundMatSourceFromAxes(sourceKind, canvasStyle)` 派生当前 `GroundSurfaceMode`。`LegacyGroundMatSource`（旧 9 值）+ `LEGACY_CANVAS_PATTERNS`（旧 canvasStyle 里的 4 个图案值）**仅作迁移输入**；`loadState` 两条路径（扁平枚举 / ADR-249 时代图案）均有契约测试。脏数据回退 none。
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
3. **叠加层样式集可扩展**（ADR-249/251）：已落地 grid/checker/stripes/diamond；scan/glowEdge 等待扩展（只需改 `GROUND_OVERLAY_STYLES` + `generateOverlayPixels` 分支）。
4. **噪声材质重建开销**（ADR-252 未知遗留）：`density` 属 structural，每次变更触发 512² × 3 次 `valueNoise` 重建；拖拽密度滑杆可能卡顿（测试已因此触及 5s 超时，用例改用廉价材质规避）。优化方向：降采样或重建节流。

## 不变量

1. **单路径原则**：外观参数只经 `applyGroundSurfaceAppearance` 落地，capability 里禁止散落 mutate（合约测试锁死 rebuild==in-place 等价）
1b. **legacy 与运行时类型分离**（ADR-252）：`LegacyGroundMatSource` / `LEGACY_CANVAS_PATTERNS` **只能作为迁移输入**；运行时类型（`GroundSurfaceMode` / `GroundCanvasStyle`）永不包含几何图案。禁止把图案值加回 `GROUND_CANVAS_STYLES`。
1c. **零消费者字段即时删除**（ADR-252 例）：图案迁出后 `matLineColor` 无任何渲染消费者，故从 params/schema/menu/structural **整体移除**，其旧值仅由迁移路径读取写入 `groundOverlayColor`——不留死字段。
2. **纹理密度单点**：`textureRepeat(meshSize,scale)=meshSize/TILE_WORLD_SIZE(10)/scale` 只在 spec 模块算一次
3. **customTex 缓存生命周期**：独立于当前 surfaceTex，dispose 只释放自建纹理；clearCustomTexture 时 wasAttached 才清 surfaceTex 防误判归属
4. **持久化白名单**：loadState 校验 `groundSourceKind ∈ GROUND_SOURCE_KINDS` / `groundCanvasStyle ∈ GROUND_CANVAS_STYLES` / `groundOverlay ∈ GROUND_OVERLAY_STYLES`（非法回退默认）；~~texture 无 customTex 回退 plain~~（**ADR-249 §2.5 已废除**——静默降级致用户来源选择丢失，改为保留来源、渲染层兜底）
5. **默认值单一事实源**：`env-state-schema.ts` 的 `groundMat*` 默认值一律引用 spec 侧 `DEFAULT_GROUND_SURFACE_PARAMS`，禁止重写字面量（历史双源：matGridSize 10/8、matRoughness 0.8/0.85、matLineColor、matColor2 四处分歧，用户实测显示 spec 侧胜出）
6. **GROUND_SURFACE_MODES 单一定义**：由 `ground-surface-spec.ts` 导出，`ground-capability.ts` 不得本地重建同名常量（历史常量双源）
7. **叠加层资源自有**：`overlayTex`/`overlayMat`/`overlay.geometry` 释放责任全在 GroundCapability（切 none 与 dispose 两路）；叠加层永不触碰 `customTex`/`surfaceTex`（防 MikuMikuAR 907fa26b 式跨层误 dispose）
8. **spec 零运行时依赖**：`ground-surface-spec.ts` 保持 `import type * as THREE`——像素生成只产出 `Uint8Array`，DataTexture 构造一律在 capability（叠加层与表面层同口径，保证 spec 可 node 单测）
9. **材质预设配色单一事实源（ADR-254）**：材质名 ⇒ 配色只能来自 `GROUND_MATERIAL_PRESETS`。菜单选项与 `setMaterialPreset` 均从它派生，**禁止在菜单里重写色值**。
10. **预设白名单精确匹配（ADR-254）**：`GROUND_MATERIAL_PRESET_KEYS`（定义在 `ground-capability.ts`）必须与 `setMaterialPreset` 写入的 envState 键**一一对应**（有一致性断言测试）。**严禁前缀匹配**——否则改 groundSize/groundVisible/groundOverlay 系列会误清预设标记（邻座 `_WATER_KEYS` 精确清单教训）。
11. **预设状态由中间件收口置位（ADR-254）**：`custom` 的置位只发生在 `env-state.ts` 的写入中间件（`registerEnvStateMiddleware`）一處，**不靠每个 setter 自觉**（防漏）。预设点击自带 `groundMaterialPreset`，故不会被误清。
12. **plain 与 solid 同路径（ADR-254 §2.5）**：两者均为平坦 matColor，`plain` 走 `tex = null`（材质直出 color），**不再生成均匀贴图**——同一输出不留两条实现路径。

## 相关

- `docs/adr/ADR-117-ground-material-spec.md`
- 知识卡 scene_capability_registry.md（能力注册表框架）
