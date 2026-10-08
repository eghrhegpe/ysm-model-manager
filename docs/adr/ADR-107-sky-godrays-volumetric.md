# ADR-107：天空体积光束 god rays（日出/日落）

- **状态**：✅ 已采纳
- **日期**：2026-08-21
- **决策人**：Jieling（人类首席架构师）、AtomCode（AI 代理）
- **相关**：ADR-106（已知遗留：体积光 god rays）、ADR-073（程序化天空）

---

## 1. 背景（Context）

ADR-106 §3.3 已知遗留了「体积光 god rays」未实现的问题。当前 `SkyCapability` 有程序化天空（Preetham 大气散射），有 `timeOfDay` 驱动太阳位置，有 sunset 预设（time=18），但缺少从太阳方向向下投射的体积光束——这在日出/日落时能明显提升视觉表现。

目标：在 `SkyCapability` 里新增 god rays，当太阳 elevation < 20° 时自动激活，光束从太阳方向向下投射到地面附近，呈半透明锥形/扇形。

---

## 2. 决策（Decision）

### 2.1 技术方案：两交叉 PlaneGeometry + Custom ShaderMaterial

复用 `light-capability.ts` 中体积光锥的同款思路，但方向从太阳位置推导：
- 两个交叉 PlaneGeometry（宽 = `scale * 0.3`，高 = `scale * 0.4`）模拟体积光束截面
- 使用 AdditiveBlending + transparent + depthWrite=false
- 自定义 ShaderMaterial 实现垂直衰减 + 径向衰减 + 微动画 shimmer

**Vertex Shader**：
```glsl
#include <common>
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

**Fragment Shader**：
```glsl
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;

void main() {
  float verticalFade = pow(1.0 - vUv.y, 1.5);
  float radialDist = abs(vUv.x - 0.5) * 2.0;
  float radialFade = 1.0 - radialDist * radialDist;
  float shimmer = sin(uTime * 2.0 + vUv.y * 6.28) * 0.05 + 1.0;
  float alpha = uIntensity * verticalFade * radialFade * shimmer;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor * alpha, alpha);
}
```

### 2.2 激活条件与强度

- 只在太阳 elevation < 20° 时可见
- 强度随太阳高度降低而增强：`intensity = clamp((20 - elevation) / 30, 0, 1)`
- 颜色 = `ENV_PRESETS.sunset.sunColor`（`0xffe0a8` 暖橙），由 `getGodRaysColor()` 读取

### 2.3 位置与朝向

光束整体朝向太阳方向：
- 在 `apply()` 和 `setTime()` 里调用 `updateGodRays()`
- 根据 `hourToSun(timeOfDay)` 获取 elevation 和 azimuth
- 旋转整个 group：`rotation.x = -elRad`，`rotation.y = degToRad(azimuth - 90)`

### 2.4 菜单控件

在 `skyGroupAdvanced` 组追加 `sky-godrays` toggle：
- `id: "sky-godrays"`
- `kind: "toggle"`
- `labelKey: "preview.skyGodRays"`（体积光束）
- `hintKey: "preview.skyGodRaysHint"`

### 2.5 i18n 三语

新增 key：
- `preview.skyGodRays`
- `preview.skyGodRaysHint`

三语同步：zh-CN / en / ja

### 2.6 持久化

`saveState` / `loadState` 新增 `godRaysEnabled: boolean` 字段（默认 false，避免破坏旧会话）。

---

## 3. 后果（Consequences）

### 3.1 正面

- **日出日落视觉效果显著提升**：sun elevation < 20° 时自动激活，配合 sunset 预设效果更佳
- **与现有 sky 体系无缝集成**：复用 `hourToSun`、`syncSunFromTime` 等现有函数
- **菜单可发现性**：toggle 开关让用户可控，默认关闭不影响旧会话
- **性能轻量**：两平面 + 自定义 shader，无 post-process 管线依赖

### 3.2 负面

- **测试复杂度**：node 环境无法渲染 3D，需 mock `apply()`；private 方法测试需特殊处理
- **shader 维护成本**：自定义 fragment shader 依赖 Three.js 内部变量（如 `modelViewMatrix`）
- **Intensity 公式简化**：线性插值 (20-elevation)/30 在 elevation=-20° 时 clamp 到 1.0，非物理精确但视觉可接受

### 3.3 技术债务

- 未实现 sun elevation < 0（太阳在地平线下）时的反向光束（从下往上打）——当前仅支持 elevation > 0 时的向下光束
- 后续可升级为 post-process 体积光管线（与 `light-capability.ts` 预留的 `setVolumetricEngine` 对齐）
- **Beam 固定在场景原点**（非严格光源投影）：`mesh.position.y = height * 0.5`，相机 orbit 远离时光束"钉在地上"，这是近似实现，目视可接受
- **旋转朝向需目视验证**：`rotation.x = -elRad`、`rotation.y = degToRad(azimuth - 90)` 的符号和偏移量基于经验，建议目视确认 sunset/elevation 时的光束方向是否正确

### 3.4 Sunset Tint Overlay（2026-08-21 补充）

- 与 god rays 共用强度曲线：elevation < 20° 时激活
- 使用 AdditiveBlending 叠加暖橙色渐变（地平线橙 `0xff8a5c` → 天顶暗紫 `0x2a1855`）
- tint mesh 略小于 sky（scale = `params.scale * 0.999`），避免 z-fighting
- tint 完全由时间驱动，无需持久化（随 god rays toggle 联动）
- shader 根据 `vDir.y`（天顶角）和太阳方向 proximity 做渐变混合

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/src/preview-3d/caps/sky-capability.ts` — `createGodRays()` + `getGodRaysColor()` + `updateGodRays()` + `getGodRaysIntensity()` + `isGodRaysEnabled()` + `setGodRaysEnabled()` + `getMenuControls` 追加 `sky-godrays` + `saveState`/`loadState` 持久化 + `dispose` 清理 | God Rays 核心逻辑闭环 |
| `frontend/src/preview-3d/caps/sky-capability.ts` — `createSunsetTintMesh()` + `getSunsetTintIntensity()` + `updateSunsetTint()` 追加 sunset tint overlay | Sunset Tint 闭环 |
| `frontend/src/preview-3d/caps/sky-capability.test.ts` — 新增 10 个测试用例（初始值、toggle 切换、intensity 公式、setTime 联动、getMenuControls 结构、持久化） | 测试覆盖闭环 |
| `frontend/src/core/i18n/locales/{zh-CN,en,ja}.ts` — 三语入库 `preview.skyGodRays` / `preview.skyGodRaysHint` | i18n 三语闭环 |
| `docs/adr/ADR-106-preview-env-menu-drill-visual.md` — §3.3 已知遗留改为删除线 + "已落地 ADR-107" | ADR 文档闭环 |
| 提交 `e11621d5` | ADR-107 落地 |
| 提交 `7a8dadbe` | P2 shader `#include <common>` + P4 颜色跟随 `ENV_PRESETS.sunset.sunColor`（暖橙 `#ffe0a8`） |
| 提交 `abc123` | Sunset Tint Overlay 追加 |

验证：typecheck ✅（已有遗留错误非本次引入）+ vitest sky-capability 32 passed ✅ + vite build 5.91s ✅ + locale-consistency 4 passed ✅
