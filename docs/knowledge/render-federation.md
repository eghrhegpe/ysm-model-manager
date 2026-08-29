---
kind: render-federation
name: 联邦渲染能力 (Render Federation)
category: utils
tier: architecture
adr:
  - ADR-125
source_files:
  - frontend/src/utils/3d/caps/scene-capability-registry.ts
  - frontend/src/utils/3d/caps/sky-capability.ts
  - frontend/src/utils/3d/caps/ground-capability.ts
  - frontend/src/utils/3d/caps/light-capability.ts
  - frontend/src/utils/3d/caps/postprocessing-capability.ts
  - frontend/src/utils/3d/caps/environment-capability.ts
  - frontend/src/utils/3d/caps/fog-capability.ts
  - frontend/src/utils/3d/caps/shadow-capability.ts
  - frontend/src/utils/3d/adapters/mount-preview-core.ts
tests:
  - frontend/src/utils/3d/adapters/__tests__/mount-preview-core.test.ts
  - frontend/src/utils/3d/caps/environment-capability.test.ts
  - frontend/src/utils/3d/caps/fog-capability.test.ts
  - frontend/src/utils/3d/caps/ground-capability.test.ts
  - frontend/src/utils/3d/caps/light-capability.test.ts
  - frontend/src/utils/3d/caps/postprocessing-capability.test.ts
  - frontend/src/utils/3d/caps/scene-capability-registry.test.ts
  - frontend/src/utils/3d/caps/shadow-capability.test.ts
  - frontend/src/utils/3d/caps/sky-capability.test.ts
created: 2026-08-xx
updated: 2026-08-xx
description: ADR-073 确立的联邦渲染能力架构：caps/ 下的 SceneCapability 通过 sceneCapabilityRegistry 统一注册、自动挂载与菜单暴露
related_adrs:
  - ADR-073-federal-render-caps
  - ADR-084-personal-lighting
  - ADR-097-scene-capability-registry
---

# 联邦渲染能力 (Render Federation)

## 概述

基于 **ADR-073** 确立的联邦架构，每个渲染特性（天空、地面、灯光、Bloom 等）是一个独立的 `SceneCapability` 类，在 `sceneCapabilityRegistry` 中注册，由 `mount-preview-core.ts` 统一创建 → apply → refreshDock。

## 注册顺序（决定场景层叠）

```
Sky → Ground → Environment → Fog → Light → Shadow → Reflector → Postprocessing
```

## Cap 清单

| ID | 文件 | 默认开启 | v1.14 状态 | 职责 |
|----|------|---------|-----------|------|
| sky | sky-capability.ts | ❌ false | ✅ preset enabled（MMD exposure↑, VRM turbidity↓） | 大气散射天空盒 + IBL 环境贴图联动 + God Rays + Sunset Tint |
| ground | ground-capability.ts | ✅ true | ✅ size 50→80, wetness 0→0.15 (微湿地面光泽), grid对比加深 | GridHelper + 程序化表面纹理 + 动态水面叠加 |
| environment | environment-capability.ts | - | ✅ HDR 序列支持 + histogram | 背景色/HDR序列切换 + 背景开关 |
| fog | fog-capability.ts | - | - | 近远雾（线性/指数），与天空融合 |
| light | light-capability.ts | - | ✅ MMD/VRM volumetric+spotlight enabled:true, rim增强 | 三点布光(key/fill/rim) + Spotlight体积光锥 + 模型预设 |
| shadow | shadow-capability.ts | - | - | 深度图阴影投射（需启用 spotlight） |
| reflector | reflector-capability.ts | - | - | 单平面镜面反射（SSR 开启时自动禁用防 z-fighting） |
| postprocessing | postprocessing-capability.ts | - | ✅ MMD/VRM bloom enabled:true, strength上调 | Bloom + SSAO + SSR + ToneMapping + Exposure |

## UI 暴露路径

每个 Cap 实现 `getMenuControls(): MenuControlDef[]`，返回菜单项定义数组。
`preview-menu/core.ts` 的 `refreshDock()` 调用 `cap.getMenuControls()` 渲染到 dock-nav。

分组示例（postprocessing）：
- Basic: enabled toggle / toneMapping / exposure
- Bloom: strength / threshold / radius
- SSAO: enabled / radius / minDist / maxDist
- Reflection: mode (envmap-only/envmap+ssr/ssr-only) / opacity / maxDistance

## 性能注意

- Bloom + SSR + SSAO 三开是"重型组合"，低端 Android WebView 建议至少关闭 SSAO
- Volumetric cone 只在 `spotlight.enabled && volumetric.enabled` 同时真时渲染
- Postprocessing composer 延迟创建：需要时才 new EffectComposer，节省 GPU 资源

## v1.14 视觉调优变更

- [x] PostProcessing: MMD bloom `strength:0.8→1.0, threshold:0.6→0.5, enabled:false→true`; VRM `enabled:false→true, threshold:0.65→0.7`
- [x] Sky: MMD exposure `0.42→0.55`; VRM turbidity `8→7`; YSM exposure `0.6→0.55`
- [x] Ground: size `50→80`, divisions `50→60`, wetness `0→0.15`, waterOpacity `0.6→0.25`, grid color 加深
- [x] Light: MMD/VRM `volumetric.enabled` / `spotlight.enabled` → true; rim intensity 提升; key intensity 微调
- [ ] Shadow: pending — 待打开 spotlight.shadow.enabled 配合 volumetric
- [ ] Light UI panel: pending — 菜单控件已有(getMenuControls)，但顶层入口需确认用户是否可见
