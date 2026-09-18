# ADR-266：体积光锥改真锥体几何 + Fresnel 边缘辉光；修 ACES 旁路与过度重建

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/light-cone.ts`（全量重写几何/shader）、`caps/light-capability.ts`（接线：`SPOT_GEO_CHANGES`、`getSpotDir()`、`SPOT_CHANGES` 分支收窄）、`caps/light-cone.test.ts`（新增）、`caps/light-capability.test.ts`（断言更新）；ADR-177（本类拆分出处）、ADR-246（D1 删 postprocess 空壳、D3 SpotLightHelper）、ADR-084（个人灯光三点布光）、ADR-107（天空 god rays 体积光，与本次「雾中光柱」非同一物）

---

## 1. 背景（Context）

体积光锥自 ADR-084 起一直是「两片交叉 `PlaneGeometry` + 片元 `discard` 抠锥形 + 径向压暗」的伪体积实现。2026-09-18 一次只读设计审核（对标 `MikuMikuAR/frontend/src/scene/render/light-cone.ts` 的 Babylon 真锥体实现）判定了三类硬伤与一处渲染正确性 bug：

| # | 问题 | 证据 |
|---|------|------|
| 1 | **侧面穿帮**：两片交叉平面各只覆盖一个方位角，视线与其中之一近共面时该片近乎 edge-on；锥体在斜视角下「变薄」甚至消失 | 旧 `buildGroup`：`plane2.rotation.y = π/2`，几何只有 2 个平面 |
| 2 | **亮竖缝伪影**：相机穿入锥体时内壁可见，两片在锥轴附近 additive 叠加出亮线 | `DoubleSide` + `AdditiveBlending`，两片在中轴相交 |
| 3 | **剪纸感**：体积光只沿两个平面与模型相交，「包裹」关系不成立 | 同上 |
| 4 | **ACES 旁路（渲染正确性 bug）**：自定义 `ShaderMaterial` 不自动注入 tone mapping chunk，加色以线性值直接写入 sRGB 目标 → 亮处硬裁 + 以超亮值喂 bloom 阈值，与场景其余部分色彩分级脱节 | 片元无 `#include <tonemapping_fragment>` / `<colorspace_fragment>`；renderer 侧 `ACESFilmicToneMapping` 生效于其他材质（`sky-capability` 设置） |
| 5 | **过度重建**：任意 spotlight 字段（含 color/intensity/distance/decay）变更都整组 `disposeObject3D` + 重建 GPU 几何，拖一次强度滑块即抖动；`angle/penumbra` 才影响锥形 | 旧 `onEnvChanged`：`hasAny(changed, SPOT_CHANGES)` → 无条件 `cone.rebuild(...)` |
| 6 | **「恒垂直」写死**：锥体几何不复用聚光灯朝向，一旦聚光灯获得倾斜能力即与真实光锥脱钩 | 旧 `buildGroup` 只做 `position.y -= height/2`，无旋转输入 |

## 2. 决策（Decision）

### D1 换真锥体网格，删掉平面剪影
`THREE.ConeGeometry(baseRadius, height, 48, 4, /* openEnded */ true)` 单网格替换两片平面。锥顶在局部 `+Y`、锥底圆在 `-Y`，与「锥顶贴光源、锥底落在对象」布局一致；`openEnded` 去掉底面封盖（有盖会在对象上方浮出一片亮盘）。双面渲染（`DoubleSide`）保留，真锥体下才成立「厚度感」。径向 `discard` mask 与 `uBaseRadius` uniform 随之退役。

### D2 边缘羽化语义改接到 Fresnel
旧 `radialFalloff = 1 - rNorm·edgeFade` 是「截面上越靠外越暗」——只在平面剪影下成立。真锥体上没有「截面内的半径」，对应的物理量是**掠射角**：

```glsl
vec3 viewDir = isOrthographic
  ? normalize(vec3(-viewMatrix[0][2], -viewMatrix[1][2], -viewMatrix[2][2]))
  : normalize(cameraPosition - vWorldPos);
float NdotV  = abs(dot(normalize(vWorldNormal), viewDir));
float fresnel = pow(clamp(1.0 - NdotV, 0.0, 1.0), 1.0 + uEdgeFade * 2.0);
float shell   = mix(1.0, 0.12 + 0.88 * fresnel, uEdgeFade);
```

`edgeFade` 的**值域与端点语义不变**（0 = 均匀壳，1 = 边缘辉光主导），中间段从「压暗边缘」变为「点亮轮廓」。视线方向复用 three 内置 uniform `cameraPosition`（renderer 每帧喂，无需外部接线），正交分支照抄 three 自身 `envmap_fragment` 的写法。

其余四个滑块（`opacity`/`fogPower`/`baseStrength`/`tipStrength`）与轴向公式逐字保留——`h = 0` 底面（光落在对象上）、`h = 1` 锥顶（光源处），`vertIntensity = mix(base, tip, h)`、`airFalloff = exp(-fogPower·h)`，故「上下亮度比」等既有 UI 语义与测试零改动。

### D3 补 tone mapping / 输出色彩空间转换
片元末尾加 `#include <tonemapping_fragment>` + `#include <colorspace_fragment>`。前提已实证：`material.toneMapped`（默认 `true`）为真时 renderer 注入 `TONE_MAPPING` 宏与 `toneMapping()` 函数，且两个 chunk 名在 three 0.185 存在、`linearToOutputTexel()` 恒在片元前缀中。

### D4 朝向由「聚光灯 → 靶点」驱动
`rebuild/attach/syncPosition` 增加可选 `spotlightDir`（世界，光源 → 靶点）。锥组几何中心 = 锥顶 + 半高·射束方向，朝向用 `quaternion.setFromUnitVectors(localUp, -dir)` 表达。默认俯视灯下 `dir = (0,-1,0)` → 单位四元数 + 中心 `y = spotlightPos.y - height/2`，**与旧实现逐像素等价**；灯一旦可倾斜，锥体自动跟随。

### D5 重建触发面收窄
新增 `SPOT_GEO_CHANGES = {lightSpotEnabled, lightSpotAngle, lightSpotPenumbra}`；`SPOT_CHANGES` 内非几何字段（color/intensity/distance/decay）只走 `cone.updateUniforms()` 快路径。同时把 spot/volumetric 两条分支合并为单次 `needConeRebuild` 判定——旧实现在同批双改时会重建两遍。

## 3. 后果（Consequences）

**正面**
- 侧面穿帮、亮竖缝、剪纸感三处视觉债一并消除；锥形在任何视角都有正确侧壁轮廓。
- 色彩与场景其余部分一致（过曝/异常 bloom 消失）。
- 拖强度/颜色/距离滑块不再触发 GPU 几何重建与 GC 抖动。
- 锥体朝向与聚光灯解耦，为后续「倾斜聚光灯」（斜射舞台光）预留了正确的接线位，不再需要动几何。

**代价与边界**
- `edgeFade` 中间段观感变化（整体约暗 20%，边缘由「暗轮廓」变「亮壳」）——留给 `opacity` 滑块补偿，未做归一化以保持公式可读。
- 几何成本从 2 片平面（2×2 三角形）升至约 384 三角形，可忽略。
- 逐帧无任何新增接线（`cameraPosition` 由 renderer 供），但锥体本身仍非 raymarching：**雾中散射的近真实解仍未实现**，仍是轻量近似（ADR-246 已裁定若要做须以新增 pass 方式引入）。

**不变的红线**
- 无 post-process 管线（ADR-246 D1 的单引擎裁定未被触碰）。
- 参数面与 `MenuNode` 菜单结构零改动（菜单节点 id/顺序不变，仅几何与着色实现替换）。
- 类型判定归 Go、前端只读；本改动全在 `preview-3d` 渲染层内。

## 4. 数据溯源

- 旧实现：`frontend/src/preview-3d/caps/light-cone.ts`（本 ADR 提交前的 `VOLUMETRIC_CONE_FRAG` 含 `discard`/`rAtH` 分支）。
- 对标实现：`MikuMikuAR/frontend/src/scene/render/light-cone.ts`（`MeshBuilder.CreateCylinder` 真锥 + `u_apexPos`/`u_cameraPos` + Fresnel）。
- three 0.185 前提：`node_modules/three/build/three.module.js` 片元前缀含 `uniform vec3 cameraPosition;` / `uniform bool isOrthographic;` / `TONE_MAPPING` 宏注入（`material.toneMapped`）；`tonemapping_fragment` = `#if defined(TONE_MAPPING) gl_FragColor.rgb = toneMapping(...)`；`colorspace_fragment` = `gl_FragColor = linearToOutputTexel(...)`。
