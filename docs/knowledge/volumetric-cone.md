---
kind: volumetric-cone
name: 体积光锥 VolumetricCone（真锥体网格 + Fresnel）
tier: architecture
category: rendering
status: active
adr:
  - ADR-266
  - ADR-266-d1
  - ADR-177
  - ADR-246
  - ADR-290
use_when:
  - 体积光
  - 光锥
  - 聚光灯可见光柱
  - volumetric / cone
  - 边缘辉光 / fresnel
  - 截图光柱缺失或与预览不一致
source_files:
  - frontend/src/preview-3d/caps/light-cone.ts
  - frontend/src/preview-3d/caps/light-capability.ts
  - frontend/src/preview-3d/screenshot/screenshot-cone.ts
  - frontend/src/preview-3d/screenshot/screenshot-lights.ts
auto_fields:
  symbols_with_lines:
    - applyVolumetricCone
    - LightCapability
    - LightKey
    - ScreenshotLights
    - ScreenshotVolumetric
    - toScreenshotLights
    - volParamKeys
    - VolumetricCone
tests:
  - frontend/src/preview-3d/caps/light-cone.test.ts
  - frontend/src/preview-3d/caps/light-capability.test.ts
  - frontend/src/preview-3d/screenshot/screenshot-cone.test.ts
  - frontend/src/preview-3d/screenshot/screenshot-lights.test.ts
pitfalls:
  - 符号陷阱：ConeGeometry 锥顶在局部 +Y，射束向下延伸 → 几何中心 = 锥顶 + 半高·方向（写成 -半高 会让锥顶飘到光源上方一个锥高；垂直灯下看不出，斜射才穿帮）
  - 平面剪影回归：任何「两片交叉 Plane + discard 抠锥」的写法都会在侧视角双 edge-on 变薄消失、相机穿入时中轴亮缝
  - ACES 旁路回归：自定义 ShaderMaterial 不会自动注入 tonemapping/色彩空间转换，片元必须显式 include 两个 three chunk（tonemapping_fragment + colorspace_fragment），否则加色硬裁并异常喂 bloom
  - 离屏输出设置分叉（ADR-266-d1）：截图侧不镜像预览 renderer 的 toneMapping / toneMappingExposure 时，光柱与模型亮度在两画面之间静默分叉（ACES 曲线差异比几何差异更刺眼；历史只抄了 outputColorSpace，两侧恰好同为 SRGB 才没露馅）
  - edgeFade 语义已改：0=均匀壳，1=边缘辉光主导（旧版是「压暗边缘」），中间段观感整体约暗 20%，用 opacity 补偿
  - 重建成本：只有 type/enabled/angle/penumbra 影响几何（`CONE_GEO_CHANGES`）；方位角/仰角走 syncPosition，color/intensity/distance/decay 走 updateUniforms——误加回「任意灯字段变更即 rebuild」会恢复拖滑块抖动
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 改体积光外观 / 加锥体参数
  - 排查光柱穿帮、过曝、开关不生效
  - 截图/导出里没有光柱或亮度与预览不符
quick_risk_lines:
  - 锥体几何/着色/状态机单点在 light-cone.ts（rebuild + VOLUMETRIC_CONE_FRAG），禁止外挂第二套光柱实现
  - 重建触发面只有 CONE_GEO_CHANGES（type/enabled/angle/penumbra）；驱动源是 envState 键 lightVolumetricDriver，与 activeLight 彻底脱钩
  - 截图必须经 screenshot-cone.ts 的 applyVolumetricCone 复用同一锥体类，离屏 renderer 逐字段镜像预览 toneMapping 现值
invariant_anchors:
  - frontend/src/preview-3d/caps/light-cone.ts|VolumetricCone
  - frontend/src/preview-3d/caps/light-cone.ts|rebuild
  - frontend/src/preview-3d/caps/light-cone.ts|applyTransform
  - frontend/src/preview-3d/caps/light-cone.ts|ConeGeometry
  - frontend/src/preview-3d/caps/light-capability.ts|CONE_GEO_CHANGES
  - frontend/src/preview-3d/caps/light-capability.ts|getSpotDir
  - frontend/src/preview-3d/screenshot/screenshot-cone.ts|applyVolumetricCone
---

# 体积光锥 VolumetricCone（真锥体网格 + Fresnel）

## 概览

聚光灯可见光柱的实现单文件（ADR-177 从 `LightCapability` 拆出的自包含单元：shader + 几何 + 材质 + 挂载状态机）。ADR-266（2026-09-18）把它从「两片交叉 `PlaneGeometry` + `discard` 抠锥」换成**真锥体网格**，因为十字片只是锥的剪影，侧视角会变薄消失、相机穿入时两片在中轴叠加出亮竖缝、模型贴近锥面时呈剪纸感。

> **[light-type-switch] 驱动源变更（2026-09）**：锥体不再绑定「第四盏独立聚光灯」，改由**启用的 `type==='spot'` 灯**驱动——任一盏灯切到聚光灯即可见光柱。
> **[ADR-290] 驱动源 schema 化（`lightVolumetricDriver`）**：锥体贴哪盏灯**不由编辑器焦点决定**，改由 envState 键 `lightVolumetricDriver` 显式决定（`auto` / `key` / `fill` / `rim`）——`auto` = 按 key→fill→rim 槽位顺序第一盏启用的 spot；显式槽位 = 严格绑定该槽位，该槽位不是启用的 spot 则**无锥（不回落）**。`getSpotLightForCone` 只读该 schema 键，与 `activeLight` **彻底脱钩**。
> **[同步点硬约束] `setActiveLight` 不再收敛锥体（ADR-290）**：驱动源已迁到 `lightVolumetricDriver`（envState 键，变更经既有派发通道触发 rebuild，与 `volumetric.enabled` 同路），`activeLight` 回归纯 UI 焦点态——原「切了没反应」的内联 rebuild 补丁随 ADR-290 退役。守卫：`light-capability.test.ts` 的「[ADR-290] setActiveLight 与锥体彻底脱钩（怎么切都不动锥）；driver 变更即收敛锥体」（断言焦点切换零渲染效果、改 driver 才重建）。

当前实现：`ConeGeometry(baseRadius, height, 48, 4, openEnded)` 单网格 + `AdditiveBlending` + `DoubleSide` + 轴向衰减 + Fresnel 视角边缘辉光 + ACES/色彩空间转换。**无 post-process 管线**（ADR-246 D1 的单引擎裁定）。

对标参照：`MikuMikuAR/frontend/src/scene/render/light-cone.ts`（Babylon 真锥体 + `u_apexPos`/`u_cameraPos` + Fresnel 边缘辉光）——两者同思路、不同引擎，不是同源代码。

## 核心职责

- 按 `LightInstanceParams`（type/angle/penumbra/enabled/color）+ `VolumetricParams`（opacity/fogPower/edgeFade/baseStrength/tipStrength）产出可见锥体。
- 轴向强度剖面：`h = 0` 底面（光落在对象上）、`h = 1` 锥顶（光源处）；`vertIntensity = mix(baseStrength, tipStrength, h)`、`airFalloff = exp(-fogPower·h)`——与旧十字片实现同式，四个轴向滑块语义未变（菜单「上下亮度比」由此派生）。
- 侧壁光度：Fresnel `pow(1-|N·V|, 1+edgeFade·2)`，`shell = mix(1, 0.12+0.88·fresnel, edgeFade)`。
- 朝向：由「聚光灯 → 靶点」方向驱动，锥顶恒贴光源、锥底落在靶点。

## 对外 API / 入口

| 方法 | 语义 |
|------|------|
| `rebuild(height, sp, vm, spotlightPos, spotlightDir?)` | 重建几何 + 材质（未双开时产出空 group）；`spotlightDir` 缺省垂直向下 |
| `attach(spotlightPos, spotlightDir?)` / `detach()` | 挂入/移出场景（attach 幂等，同时同步位置与朝向） |
| `syncPosition(spotlightPos, spotlightDir?)` | 只同步位置/朝向（方位角/仰角变更路径）；缺省沿用上次方向 |
| `updateUniforms(sp, vm)` | 原地刷新 uniforms，**不动几何**（color/intensity/edgeFade 等快路径） |
| `hasGroup()` / `isMounted()` / `dispose()` | 存在性 / 挂载态 / 释放（幂等，经 `safe-dispose.disposeObject3D`） |

消费方唯一：`LightCapability`（`private cone: VolumetricCone`），菜单经 `light-controls.ts` 的 MenuNode，参数真值源是 envState（ADR-196）。

## 与其他子系统关系

- **`LightCapability`**：三盏灯（key/fill/rim）各可在 directional/point/spot 间切换；锥体驱动源 = envState 键 `lightVolumetricDriver`（`getSpotLightForCone` 只读该键，与 `activeLight` 无关），方向由 `getSpotDir(spotLight)`（光源 → 靶点）算出。重建触发面 = `CONE_GEO_CHANGES`（type/enabled/angle/penumbra），位置变更走 `syncPosition`，其余走 uniforms 快路径。
- **envState / env-dispatcher**：参数变更经 `setEnvState` 派发，`onEnvChanged` 分派到锥体。
- **灯 helper**（ADR-246 D3 扩展）：每盏灯按当前 type 配对应 helper（Directional↔DirectionalLightHelper / Spot↔SpotLightHelper / Point↔PointLightHelper），类型切换时重建；体积光锥是视觉光柱本体。
- **截图渲染**（`preview-3d/screenshot/screenshot-lights.ts` + `preview-3d/screenshot/screenshot-cone.ts`）：**同构**（ADR-266-d1，取代 ADR-246 期「预览与截图本就不同构」的旧口径）——`toScreenshotLights()` 经 `light-capability.ts|getSpotLightForCone` 取驱动槽位（不重算驱动规则），离屏经 `screenshot-cone.ts|applyVolumetricCone` **复用本类**建锥（同一几何/shader，非第二套「截图专用光柱」）；无驱动 spot / 未开体积光 / 能力总闸关 → `volumetric` 为 null（预览没有的东西，截图不凭空出现）。同构义务不止几何：离屏 renderer 的 `toneMapping` / `toneMappingExposure` / `outputColorSpace` 一律镜像活跃预览 renderer 的**现值**（`ScreenshotLights.output`；读现值而非重推 sky/pp 属主链——推导即手抄）。
- **后处理**（bloom / ACES 由 renderer 与 `PostprocessingCapability` 管）：本材质以「被色调映射的加色」参与，不再旁路。

## 不变量

1. **朝向不变量**：世界空间中锥顶 ≡ 聚光灯位置，锥底中心 ≡ 光源 + 锥高 · 射束方向；由 `light-cone.test.ts` 的 `localToWorld` 断言锁定。
2. **垂直等价**：缺省方向下 `quaternion` 为单位四元数、中心 `y = spotlightPos.y - height/2`——与 ADR-246 之前的旧实现逐像素等价（防止「换几何顺手改布局」的静默漂移）。
3. **未双开不产锥**：驱动槽位（`lightVolumetricDriver` 选定的灯，`auto` 下为槽位顺序第一盏启用 spot）`type==='spot' && enabled` 且 `volumetric.enabled` 同时为真才产出 group（挂载态另有 `attach/detach` 语义，重建后需回挂）。
4. **色调映射接线**：片元恒含 `#include <tonemapping_fragment>` + `<colorspace_fragment>`；`material.toneMapped` 必须为 `true`（否则 renderer 不注入 `TONE_MAPPING` 宏，两个 include 退化为空）。
5. **重建触发面**：`CONE_GEO_CHANGES`（type/enabled/angle/penumbra）才重建；方位角/仰角走 `syncPosition`；color/intensity/distance/decay 只走 `updateUniforms`。
6. **轻量性**：不加 pass、不给 renderer 加每帧接线（相机经 three 内置 uniform `cameraPosition` 取得）。
7. **截图同构**（ADR-266-d1）：`ScreenshotLights.volumetric` 非空 ⟺ 预览此刻确有光柱（能力总闸开 ∧ 体积光开 ∧ 存在启用的驱动 spot）；离屏输出设置逐字段等于预览 renderer 现值。回归锁：`screenshot-cone.test.ts` + `screenshot-lights.test.ts` + `screenshot-render.test.ts`。

## 相关

- ADR-266-d1：体积光入截图 + 离屏/预览输出设置同构（本条取代「预览与截图本就不同构」的旧口径）。
- ADR-266：本次几何/着色/色调映射/朝向/重建收窄的决策记录与数据溯源。
- ADR-177：`VolumetricCone` 拆出 `LightCapability` 的出处（状态机用例契约位在 `light-capability.test.ts`）。
- ADR-246：D1 删 postprocess 空壳（单引擎 = 本锥体）、D2 参数收编、D3 SpotLightHelper 可视化。
- ADR-290：锥体驱动源 schema 化（`lightVolumetricDriver`）——本条取代「编辑器焦点优先 / `setActiveLight` 收敛锥体」的旧口径。
- ADR-084：个人灯光系统（三点布光 + 聚光灯 + 可见光锥）；其中「雾中 raymarching 体积光」**仍未实现**，若要做须以新增 pass 方式引入（ADR-246 裁定）。
- ADR-107：天空体积光束（god rays）——与雾中光柱非同一物。
