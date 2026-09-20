---
kind: volumetric_cone
name: 体积光锥 VolumetricCone（真锥体网格 + Fresnel）
tier: architecture
category: rendering
status: active
adr:
  - ADR-266
  - ADR-177
  - ADR-246
use_when:
  - 体积光
  - 光锥
  - 聚光灯可见光柱
  - volumetric / cone
  - 边缘辉光 / fresnel
source_files:
  - frontend/src/preview-3d/caps/light-cone.ts
  - frontend/src/preview-3d/caps/light-capability.ts
auto_fields:
  symbols_with_lines:
    - attenuateAmbientForSky
    - LightCapability
    - lightDirToPosition
    - LightKey
    - spotDistanceAttenuation
    - VolumetricCone
tests:
  - frontend/src/preview-3d/caps/light-cone.test.ts
  - frontend/src/preview-3d/caps/light-capability.test.ts
pitfalls:
  - 符号陷阱：ConeGeometry 锥顶在局部 +Y，射束向下延伸 → 几何中心 = 锥顶 + 半高·方向（写成 -半高 会让锥顶飘到光源上方一个锥高；垂直灯下看不出，斜射才穿帮）
  - 平面剪影回归：任何「两片交叉 Plane + discard 抠锥」的写法都会在侧视角双 edge-on 变薄消失、相机穿入时中轴亮缝
  - ACES 旁路回归：自定义 ShaderMaterial 不会自动注入 tonemapping/色彩空间转换，片元必须显式 include 两个 three chunk（tonemapping_fragment + colorspace_fragment），否则加色硬裁并异常喂 bloom
  - edgeFade 语义已改：0=均匀壳，1=边缘辉光主导（旧版是「压暗边缘」），中间段观感整体约暗 20%，用 opacity 补偿
  - 重建成本：只有 type/enabled/angle/penumbra 影响几何（`CONE_GEO_CHANGES`）；方位角/仰角走 syncPosition，color/intensity/distance/decay 走 updateUniforms——误加回「任意灯字段变更即 rebuild」会恢复拖滑块抖动
quick_groups:
  - preview-3d
quick_intents:
  - 改体积光外观 / 加锥体参数
  - 排查光柱穿帮、过曝、开关不生效
quick_risk_lines:
  - frontend/src/preview-3d/caps/light-cone.ts|applyTransform
  - frontend/src/preview-3d/caps/light-cone.ts|VOLUMETRIC_CONE_FRAG
  - frontend/src/preview-3d/caps/light-capability.ts|CONE_GEO_CHANGES
invariant_anchors:
  - frontend/src/preview-3d/caps/light-cone.ts|VolumetricCone
  - frontend/src/preview-3d/caps/light-cone.ts|rebuild
  - frontend/src/preview-3d/caps/light-cone.ts|applyTransform
  - frontend/src/preview-3d/caps/light-cone.ts|ConeGeometry
  - frontend/src/preview-3d/caps/light-capability.ts|CONE_GEO_CHANGES
  - frontend/src/preview-3d/caps/light-capability.ts|getSpotDir
---

# 体积光锥 VolumetricCone（真锥体网格 + Fresnel）

## 概览

聚光灯可见光柱的实现单文件（ADR-177 从 `LightCapability` 拆出的自包含单元：shader + 几何 + 材质 + 挂载状态机）。ADR-266（2026-09-18）把它从「两片交叉 `PlaneGeometry` + `discard` 抠锥」换成**真锥体网格**，因为十字片只是锥的剪影，侧视角会变薄消失、相机穿入时两片在中轴叠加出亮竖缝、模型贴近锥面时呈剪纸感。

> **[light-type-switch] 驱动源变更（2026-09）**：锥体不再绑定「第四盏独立聚光灯」，改由**三盏灯中第一盏 `type==='spot'` 且启用的灯**驱动——任一盏灯切到聚光灯即可见光柱。

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

- **`LightCapability`**：三盏灯（key/fill/rim）各可在 directional/point/spot 间切换；锥体由「第一盏启用的 spot 灯」驱动（`getSpotLightForCone()`），方向由 `getSpotDir(spotLight)`（光源 → 靶点）算出。重建触发面 = `CONE_GEO_CHANGES`（type/enabled/angle/penumbra），位置变更走 `syncPosition`，其余走 uniforms 快路径。
- **envState / env-dispatcher**：参数变更经 `setEnvState` 派发，`onEnvChanged` 分派到锥体。
- **灯 helper**（ADR-246 D3 扩展）：每盏灯按当前 type 配对应 helper（Directional↔DirectionalLightHelper / Spot↔SpotLightHelper / Point↔PointLightHelper），类型切换时重建；体积光锥是视觉光柱本体。
- **截图渲染**（`preview-3d/screenshot/screenshot-lights.ts`）：**不复用本能力**，不产出光锥——预览与截图在体积光上本就不同构。
- **后处理**（bloom / ACES 由 renderer 与 `PostprocessingCapability` 管）：本材质以「被色调映射的加色」参与，不再旁路。

## 不变量

1. **朝向不变量**：世界空间中锥顶 ≡ 聚光灯位置，锥底中心 ≡ 光源 + 锥高 · 射束方向；由 `light-cone.test.ts` 的 `localToWorld` 断言锁定。
2. **垂直等价**：缺省方向下 `quaternion` 为单位四元数、中心 `y = spotlightPos.y - height/2`——与 ADR-246 之前的旧实现逐像素等价（防止「换几何顺手改布局」的静默漂移）。
3. **未双开不产锥**：任一盏灯 `type==='spot' && enabled` 且 `volumetric.enabled` 同时为真才产出 group（挂载态另有 `attach/detach` 语义，重建后需回挂）。
4. **色调映射接线**：片元恒含 `#include <tonemapping_fragment>` + `<colorspace_fragment>`；`material.toneMapped` 必须为 `true`（否则 renderer 不注入 `TONE_MAPPING` 宏，两个 include 退化为空）。
5. **重建触发面**：`CONE_GEO_CHANGES`（type/enabled/angle/penumbra）才重建；方位角/仰角走 `syncPosition`；color/intensity/distance/decay 只走 `updateUniforms`。
6. **轻量性**：不加 pass、不给 renderer 加每帧接线（相机经 three 内置 uniform `cameraPosition` 取得）。

## 相关

- ADR-266：本次几何/着色/色调映射/朝向/重建收窄的决策记录与数据溯源。
- ADR-177：`VolumetricCone` 拆出 `LightCapability` 的出处（状态机用例契约位在 `light-capability.test.ts`）。
- ADR-246：D1 删 postprocess 空壳（单引擎 = 本锥体）、D2 参数收编、D3 SpotLightHelper 可视化。
- ADR-084：个人灯光系统（三点布光 + 聚光灯 + 可见光锥）；其中「雾中 raymarching 体积光」**仍未实现**，若要做须以新增 pass 方式引入（ADR-246 裁定）。
- ADR-107：天空体积光束（god rays）——与雾中光柱非同一物。
