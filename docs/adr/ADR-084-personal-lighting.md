# ADR-084：个人灯光系统（Personal Lighting）——三点布光 + 聚光灯 + 体积光双引擎

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/light-capability.ts`、`frontend/src/preview-3d/adapters/mount-preview-core.ts`、`ADR-073` 联邦渲染能力、`ADR-076` 预览底部导航、`ADR-066` 通用资源预览

---

## 1. 背景（Context）

### 1.1 现有状态

在 LightCapability 落地前，5 类 3D 预览（YSM / VRM / MMD / Litematic / PackModel）各自在适配器内手动 `scene.add(new THREE.AmbientLight(...))` + `new THREE.DirectionalLight(...)`，亮度值零散硬编码（vrm 0.7/1.0、mmd 0.6/1.2、litematic 0.7/0.5/0.3 等），用户无法调节。

### 1.2 用户诉求

用户要求「从对象正上方打一束聚光灯」，即**个人灯光系统**——按被预览对象独立控制，不依赖全局环境光。

### 1.3 设计目标

- 所有 shared 模式适配器（ysm / vrm / mmd / litematic / pack-model）**零改动继承**统一灯光
- 根菜单💡面板提供开关、强度滑块、预设下拉、引擎切换
- 轻量（cone 几何体积光）与重型（post-process bloom 体积光）双引擎，运行中可切换

---

## 2. 决策（Decision）

### 2.1 架构：LightCapability 作为联邦能力（ADR-073 范式）

与 `SkyCapability` / `GroundCapability` 同构，封装为 `frontend/src/preview-3d/caps/light-capability.ts`，在 `mount-preview-core.ts` shared 模式初始化阶段统一注入：

```
core 初始化
  ├── skyCap   = new SkyCapability({ scene, renderer })
  ├── groundCap = new GroundCapability({ scene })
  └── lightCap = new LightCapability({ scene, renderer })  ← 新增
       ├── setPreset(adapter.id)    // ysm/vrm/mmd/litematic/resourcepack 5 类预设
       └── apply()                  // 挂进 scene
```

适配器的内联灯光（vrm/mmd/litematic/pack-model 共 4 处）全部清除，由 core 注入。

### 2.2 三点布光 + 顶光 + 环境光

- **key**（DirectionalLight）：主光源，azimuth/elevation 可调
- **fill**（DirectionalLight）：补光，强度低于 key
- **rim**（DirectionalLight）：轮廓光，来自后方
- **ambient**（AmbientLight）：全局环境
- **spotlight**（SpotLight）：从对象正上方打入，cone + penumbra + decay 可调
- **volume cone**：两交叉 PlaneGeometry + 自定义 shader，渲染光束体积

### 2.3 体积光双引擎

| 引擎 | 实现 | 性能 | 视觉 |
|------|------|------|------|
| `cone` | 两交叉 PlaneGeometry + `ConeLightMaterial`（GLSL，垂直 fog 衰减 + 径向羽化 + AdditiveBlending） | 极轻量，几乎零开销 | 真实几何锥体，边缘锐利 |
| `postprocess` | EffectComposer + RenderPass + UnrealBloomPass + OutputPass | 中等（额外全屏 quad + 一次 bloom blur） | 柔光晕染，光晕溢出对象 |

运行中切换：`lightCap.setVolumetricEngine('cone' | 'postprocess')` → core animate 循环自动创建/销毁 composer。

### 2.4 参数类型：`DeepPartial<LightParams>`

`setParams()` 接受 `DeepPartial<LightParams>` 而非 `Partial<LightParams>`——因为 `LightParams` 嵌套 `{ key, fill, rim, ambient, spotlight, volumetric }` 6 个子对象，`Partial` 要求整子对象全传，用户只想调 `key.intensity` 一个字段时必须允许 `setParams({ key: { intensity: 1.5 } })`。

### 2.5 6 类预设（`LIGHT_PRESETS`）

| id | 目标 | key | fill | rim | spotlight |
|----|------|-----|------|-----|-----------|
| default | 通用 | 1.0 | 0.3 | 0.25 | 关 |
| ysm | YSM 方块 | 1.1 | 0.35 | 0.3 | 开 2.0 |
| vrm | VRM 角色 | 1.1 | 0.4 | 0.35 | 关 |
| mmd | MMD 角色 | 1.1 | 0.4 | 0.35 | 关 |
| litematic | 体素 | 0.9 | 0.35 | 0.3 | 关 |
| resourcepack | MC 方块/物品 | 1.3 | 0.4 | 0.35 | 关 1.8 |

（`resourcepack` 是 `pack-model` 的别名，兼容 adapter.id 命名差异。）

### 2.6 面板（`preview-menu.ts` fillLighting）

💡 灯光面板 7 项控件：顶光开关 / 主光强度滑块 / 环境光强度滑块 / 体积光锥开关 / 锥引擎下拉（cone↔postprocess）/ 锥角滑块 / 灯光预设下拉。

### 2.7 YSM self 模式已澄清

早期判断「YSM self 模式独立渲染器，未接入 LightCapability」——**已更正**：YSM 在 ADR-066 §5.7 已 shared 化（`makeYsmAdapter` 默认 shared），自动继承 LightCapability，无需任何额外工作。

---

## 3. 范围边界：未立项方向

### L3 体积光精化

| 方向 | 说明 | 前置 |
|------|------|------|
| 真 VolumetricLightingPass | Three.js examples 的 Volume + VolumetricLightingPass（raymarching），真正的雾中体积光 | 当前 three 版本 `examples/jsm/volumes/` 为空；需升级 three.js 或手动移植 Volume.js |
| 物理衰减精调 | Spotlight 当前 decay=2（已近物理），但 DistanceAttenuation 系数需精调 | — |
| 多聚光灯 | 面板允许新增/删除多束 spot light（当前只有 1 束） | 面板重构，支持可折叠的 light list |

### L4 长期候选

- 实时光强度/色彩曲线（per-key/fill/rim 独立颜色选择器）
- 场景保存/加载灯光布局
- 截图管线也接入 composer（当前截图仅 rd.toDataURL，走 postprocess 时不经过 bloom）

---

## 4. 设计要点与陷阱

### 4.1 为什么 cone 用两交叉 PlaneGeometry + shader，而非 ConeGeometry

`ConeGeometry` 只能渲染实心锥壳，要做出「内部有光线梯度、边缘羽化」的体积感，必须走 shader。PlaneGeometry + shader 的灵活性：垂直 `fogPower` 控制底部暗、尖端亮；径向 `edgeFade` 控制硬边→柔边。

### 4.2 为什么 postprocess 用 UnrealBloomPass 而非 VolumetricLightingPass

当前 `three` 版本 `node_modules/three/examples/jsm/volumes/` 目录为空——该管线在 three r163+ 被移除，需额外安装 `@three-ts/volume` 或手写 raymarching shader。UnrealBloomPass 是 three 自带，零依赖，视觉接近。

### 4.3 为什么 lightCap 在 core 初始化而非 adapter

能力驱动显示（ADR-073）：所有 adapter 经同一 `ctx.scene` 注入，核心统一拥有 cap 生命周期（创建/释放）。adapter 只消费 `lightCap.setPreset(id)`，不拥有对象所有权。

### 4.4 DeepPartial 陷阱

`Partial<LightParams>` 在 TS 4+ 下无法合并嵌套字段——`setParams({ key: { intensity: 1.5 } })` 会因 `key` 缺 `color/azimuth/elevation/enabled` 报 `TS2345`。解决方案：手写 `DeepPartial<T>` 递归 partial 类型。

### 4.5 YSM 2D 骨骼查看器不受影响

`YSM 3D` 走 shared 模式（`makeYsmAdapter`），但 `skeleton.ts` 的 2D 骨骼画布是独立 DOM 渲染，与 LightCapability 无关——不在本 ADR 范围内。

---

## 5. 已提交

| Commit | 内容 |
|--------|------|
| `5a2eba5d` | LightCapability 类 + 27 测试 |
| `7598fceb` | 注入 core + 4 adapter 清理内联灯光 |
| `3bed3dca` | 💡 根菜单面板 + i18n 7 键三语 |
| `e19434a6` | EffectComposer 后处理体积光管线 + 6 面板 i18n |
| `003dba7a` | 面板新增锥引擎 select + i18n |

---

## 6. 验证

| 检查 | 结果 |
|------|------|
| `npm run typecheck` | ✅ 0 errors |
| `npx vite build` | ✅ |
| 3D 测试 227/227 | ✅ |
| i18n 三语一致 4/4 | ✅ |
| LightCapability 单测 27/27 | ✅ |