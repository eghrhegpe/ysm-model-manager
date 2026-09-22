# ADR-297：水面模型倒影：隐藏 Reflector 借官方 RT + 水 shader 投影采样

- **状态**：✅ 已采纳（Adopted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-22
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/water-capability.ts; frontend/src/preview-3d/caps/reflector-capability.ts; docs/knowledge/water.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

水面（`water-capability.ts`）的「反射」一直是环境贴图高光（envMap sheen）级别的伪反射：
`preview.waterDesc` 文案却宣称「带动态波纹与反射」，名不副实。3D 预览环境系统里真
倒影只有两条既有通路，各有硬伤：

1. **地面镜面 Reflector**（`reflector-capability.ts`）：官方 `three/addons/objects/Reflector.js`
   把镜像渲进 RT、镜面材质自采样。但它是一块「可见的镜子」，材质是官方 ShaderMaterial，
   无法与 Gerstner 波浪水材质（MeshPhysicalMaterial + onBeforeCompile 注入）合体。
2. **SSR（后处理屏幕空间反射）**：`SSRPass` 的 GBuffer 法线 pass 依赖
   `scene.overrideMaterial = MeshNormalMaterial`，而 three 只在
   `material.allowOverride === true` 时才允许覆盖（three.module.js `getProgramCacheKey`/
   `renderObject` 路径）；水材质的 Gerstner 注入不在 override 通路里 → 水面在 GBuffer 里
   是**平顶法线**；且水 `depthWrite: false` → SSR 光线起点落在水下几何上。结论：SSR 对
   水面本身给不出正确倒影，只能反射别物。

需要一条「水面显示场景模型倒影、且随波纹摆动」的真平面反射通路，并服从既有纪律：
能力启停 = envState schema 单门（fog/water 先例）、官方件不自造（reflector-capability
「复用官方 Reflector，不允许自写镜像相机/RTV shader」红线）、菜单只走 MenuNode schema。

## 2. 决策（Decision）

三案比价（真平面反射 / SSR 修补 / 假立方体贴图），**拍板方案 A：隐藏 Reflector 借官方
RT + 水 shader 自采样**，配套两项默认值决策：

1. **方案 A**：`WaterCapability` 内懒建一个**不挂进场景**的官方 `Reflector`（单位平面、
   rotation.x = -π/2、position.y 逐帧跟 `waterLevel`）。每帧在 `update(dt)` 里手动驱动其
   `onBeforeRender(renderer, scene, camera)` 完成一次「镜像相机 + 斜裁剪 + 整场渲进 RT」，
   期间**临时隐藏整个水根**（防水体进自身镜像成双层水；防 pool 顶面 transmission pass
   在镜像通路里嵌套第二场整场渲染）。倒影贴图由水材质 shader 自采样：新增
   `uReflTex / uReflMatrix / uReflStrength` 三 uniform，fragment 在 dithering 段把水面
   世界坐标经 `uReflMatrix`（官方 textureMatrix = bias·P·V·M 右乘 M⁻¹ 剥回世界口径）投影
   得 uv，Gerstner 解析斜率（新增 `vWaveSlope_wave` varying，与光照法线同源）扰动 uv，
   fresnel 掠射增强后 mix 进底色。RT 内容为线性空间（three 仅对 canvas 输出做 tone map），
   采样值过与主程序同源的 `linearToOutputTexel` 编码后再混，空间一致。
   - 开关 = 翻 `uReflStrength`（0 → 混合块整体跳过），**不触发 shader program 重编译**。
   - 备选 B（SSR 修补）否决：要动 SSRPass 的 override 材质通路，属后处理层大手术，且水
     depthWrite:false 的光线起点问题无解。备选 C（假 cubemap）否决：反射内容不随相机
     变化，是贴图戏法，与「模型倒影」需求相悖。
2. **默认关**（`waterReflectionEnabled` 默认 false，菜单「倒影」组可开）：倒影 = 每帧多
   一次整场重渲，不是白拿的——与地面 `reflectorEnabled` 默认关同纪律。配套
   `waterReflectionStrength`（默认 0.6）、`waterReflectionResolution`（默认 512，
   256–2048 step 256，变更走 RT setSize 原位扩缩、不重建载体）。
3. **SSR 活跃时抑制水反射**（`waterReflectDisableWhenSSR` 默认 true）：`ppEnabled` 且
   `ppReflectionMode ∈ {envmap+ssr, ssr-only}` 时水反射自动跳渲归零——`ppReflectorDisableWhenSSR`
   （地面镜面对 SSR 的抑制）同范式。抑制态归水 cap 持有（ADR-247 D2 口径）。实现取
   逐帧现读 envState 而非订阅 pp 键：pp 键属 postprocessing 组，water 回调收不到派发，
   现读单真值源、不另订第二路订阅。

## 3. 后果（Consequences）

**正面**
- 水面获得真模型倒影：随 Gerstner 斜率摆动、掠射 fresnel 增强、随水位/圆角边缘同步淡出。
- 官方件复用零自造镜像数学；`getRenderTarget/getReflectionCamera/material.uniforms` 公开
  出口直取（three r185 实证），升级审计面与地面镜面同一条。
- 全链路 envState 单门：四新键进 schema 即持久化/预设/派发三自动（写侧派生化 +
  还原表登记 + W-3/D3 契约锁兜底）。

**负面 / 已知遗留**
- 开启后每帧整场多渲一遍（RT 分辨率档决定像素量）；pool 模式下「RT 渲 + transmission
  渲 + 主渲」三场并存是既定成本，靠默认关 + 分辨率档位控制。地面镜面同开时 RT 渲染内
  嵌套镜面自身 RT（官方 scope.visible 自排除保证深度有限），成本用户自担。
- **掠射穿帮（已知限制，接受）**：官方「背对早退」（view·normal > 0 跳渲）+ 反射相机
  视锥外的物体由主相机可见性决定（render-host 的 cullModelGroups 按主相机剔除发生在
  主渲染前、RT 渲染后），掠射角下倒影可能滞后一帧或边缘缺块。
- RT 内容未做 tone map（three 仅对 canvas 输出做 tone map）→ 混合时水面底色已过、倒影
  值仅过 colorspace，高亮区观感差异由强度上限吸收。
- 移动端/低端设备无自动降档——与地面镜面同现状，留给性能预设后续议题。

## 4. 数据溯源

- `frontend/src/preview-3d/caps/water-capability.ts` — `renderReflection / ensureReflector /
  reflectionActive / ssrActive`、shader 注入 `uRefl*` 三 uniform + `vWaveSlope_wave`。
- `frontend/src/preview-3d/caps/reflector-capability.ts` — 官方 Reflector 复用先例（import 路径）。
- `frontend/src/preview-3d/state/env-state-schema.ts` — water 组四新键（默认值/值域）。
- `frontend/src/preview-3d/state/preview-paths.ts` — `env.waterReflectionEnabled` 探针
  （ADR-291 三门槛：cap 态上浮 / 三步登记 + 活体消费者 / binding 内归一）。
- three r185 `examples/jsm/objects/Reflector.js` — `onBeforeRender` 契约（三参、读
  `scope.matrixWorld`、自设 visible=false、renderer.xr/shadowMap/state 触点）、
  `textureMatrix = bias·P·V·M` 构成、背对早退 + forceUpdate 逃生阀。
- SSRPass / three.module.js `allowOverride` — 「SSR 给不出水面自身倒影」判据（方案 B 否决依据）。
- `docs/knowledge/water.md` — 实施进度与陷阱条目（本 ADR 不记进度）。
