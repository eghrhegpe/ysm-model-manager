# ADR-099：3D 预览 SceneCapability 注册表架构与能力分层（九 cap 接入、顶层五 tab 菜单映射、反射模式三档 SSR 闭环）

- **状态**：✅ 已采纳
- **被补充**：[ADR-106](./ADR-106-preview-env-menu-drill-visual.md) 在本 ADR 的九 cap 接入与五 tab 映射之上，扩展两级下钻、分组折叠、跨 cap 预设联动、4 种可视化控件类型（image/color/timeline/histogram）、水面湿润表面模式、环境亮度直方图
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-073 ADR-081 ADR-085 ADR-094 ADR-095`

---

## 1. 背景（Context）

2026 年中 3D 预览能力盘点后确认：原有 4 个 capability（Sky/Ground/Light/PostprocessingManager 内 Bloom）够基础浏览，但 Three.js addons 还有大量高 ROI 复用点未落地——程序化环境贴图、雾效、阴影、真实镜面地面、后处理 SSAO、屏幕空间反射 SSR、色调映射、曝光、LUT、景深 DOF 等。

原有痛点：
1. **手写接线**：每加一个 capability，`fillEnvironment`/`switch-preview`/`cleanup-3d`/`mount-preview-core` 四五个文件都要改条件分支，很容易漏，能力越多越不可维护。
2. **顶层菜单心智错位**：原来 environment / camera / lighting 3 tab，把「后处理管线（Bloom/SSAO/SSR 这些纯像素级 pass）」和「场景环境参数（改变 scene 内容、响应材质 envMap）」混在一起放，越堆越找不到开关。
3. **反射策略不统一**：EnvironmentCapability（scene.environment = 程序化 equirect → PMREM）做「反射内容是什么」，ReflectorCapability（Reflector.js 单平面镜面）做「地面真实倒影」，但 SSR（全屏屏幕空间反射）如果接入没有统一切换，会出现地面双算 + z-fighting + 屏幕外内容黑边无 fallback 的视觉事故，也会让用户 3 处各调参数不知道谁主导。
4. **类型契约**：原来 cleanupCtx.postProc / inputOpts.postProc 都是 `PostprocessingManager | null`，如果把 PostprocessingManager 抽壳成 registry 里的 SceneCapability（接口要保持 SceneCapability 契约 + 外部 3 方法 `render/setSize/dispose`），不抽公共 interface 就会 private `composer` 冲突导致 union 类型不可互代（tsc 2322）。
5. **pmrem 黑色反射教训**：之前自定义 CanvasTexture 做反射贴图没走 `PMREMGenerator.fromEquirectangular()` 全链路导致反射全黑（经验 433477 记录），必须在 EnvironmentCapability 里用程序化 Canvas（5 预设 studio/sky/sunset/night/forest）→ `EquirectangularReflectionMapping` → `scene.environment` + 所有 mesh 材质 `envMapIntensity` 统一调控，程序化兜底永远不出黑。
6. **旧 PostprocessingManager 单例**：原本只在 LightCapability volumetric engine=postprocess 激活时才创建 EffectComposer + Bloom，用户无法独立手调 Bloom、无法接 SSAO/SSR、`toneMapping`/`exposure` 写死 1.0、`dispose` 不还原输出状态导致 session 间渲染模式泄漏。

## 2. 决策（Decision）

### 2.1 SceneCapability 统一契约 + registry 驱动（ADR-073 caps/ 能力模式升级）

所有 3D 预览能力必须实现 `SceneCapability` 接口（`frontend/src/utils/3d/caps/scene-capability.ts` §接口）：

```
SceneCapability = {
  id, labelKey, icon, descKey,
  apply(): void,
  setEnabled(v: boolean): void, isEnabled(): boolean,
  setPreset?(modelType: string): void,         // 可选：按模型类别套用预设
  getMenuControls(): MenuControlDef[],         // 声明式菜单控件（toggle/slider/select/divider）
  saveState(): void, loadState(): void,        // localStorage 持久化
  dispose(): void,                              // 还原构造前 renderer 状态、释放 GL 资源
}
```

Registry（`sceneCapabilityRegistry`，`scene-capability-registry.ts`）：

- `add(factory: SceneCapabilityFactory)` 注册能力。`factory({ scene, renderer, camera })` → `SceneCapability`。
- `createAll({ scene, renderer, camera })` 按注册顺序构造所有 cap，失败单跳、不影响其余（`registry.test.ts` 单测险恶 case 覆盖）。
- `getById(id)` 按 cap id 取实例。
- `saveAll() → registry.dispose()`：会话退出时统一持久化 + 释放，`cleanupCtx.sceneCapabilityRegistry` 兜底。

**核心效应：新增一个 capability 只做 4 件事（写 caps/xxx.ts 实现接口 → registry.add 一行 → setPreset 挂 mount-preview-core createAll 后 wiring → 补三语 i18n 键），preview-menu.ts / input / cleanup 零改动。** menu fillEnvironment 改为 registry 全量遍历除 lightCap 外所有 cap 的 `getMenuControls()` + 分组分隔，注册顺序即渲染顺序。

### 2.2 顶层 5 tab 菜单映射（替代方案评估：舞台/氛围大 tab vs 分层 tab）

| Tab | DockGroup | 内容来源 | 心智归属 |
|-----|-----------|---------|---------|
| 🔁 switch | model | 模型切换（siblings / 路径 / 新建） | 选择模型内容 |
| 🌍 environment | scene | **注册表「除 lightCap 外」所有 cap 的 getMenuControls()**：Sky / Ground / Environment（程序化 HDR + 反射强度）/ Fog / Shadow / Reflector | 场景环境 + 改变材质响应（mesh.envMapIntensity、castShadow、fog.color 响应场景内容） |
| 🎇 **postproc（新增）** | scene | **PostprocessingCapability（registry 独立 cap）getMenuControls()**：ToneMapping / 曝光 / Bloom 4 项 / SSAO 4 项 / 反射模式 / SSR 8 项 | 纯像素级渲染管线（不碰 scene 内容，最终像素处理） |
| 💡 lighting | scene | LightCapability 专用 fillLighting：三点布光 / SpotLight / SpotLight 体积光锥 / volumetric 引擎切换 | 灯光层独立于环境层（ADR-081 设计，避免天/地/雾与灯光混） |
| 🎥 camera | scene | buildCameraControls（视图/取景/投影/FOV/相机类型） | 交互视角层 |

**评估过的替代方案**：新增「舞台/氛围」顶层 tab（把 postproc + lighting 合并）。**否决理由**：
- 「舞台运镜预设 / 关键帧 / 音画联动」这种跨层能力出现时才值得独立 tab（当前没有）。
- lighting 与 postproc 的调参模式不同：lighting 改 scene 中 Light 对象 castShadow/intensity，postproc 改 EffectComposer Pass 顺序和参数，把它们塞一起 UI 过长、心智混杂。
- registry 已经把 postproc tab 也做成了声明式自动渲染，成本和效果上，保持 5 tab 分层更利于用户"想调哪一层直接去哪个 tab"。

### 2.3 反射策略三档统一（envmap-only / envmap+ssr / ssr-only）

反射策略 **不放在 EnvironmentCapability 里**，放在 PostprocessingCapability 的 postproc tab，因为：
- EnvironmentCapability 管「反射内容是什么 + 全局 envMapIntensity」（场景/材质层）
- PostprocessingCapability 管「反射计算怎么算 + SSR pass」（渲染管线层）

三档定义（`ReflectionMode` 枚举）：

1. **envmap-only（默认）**：SSRPass off、Reflector 正常。
   - 性能：零 SSR 额外开销。
   - 视觉：PBR 角色金属塑料有环境反射（程序化 5 预设 + PMREM）、地面有 Reflector 真倒影、侧面/顶面无反射。
   - 适用：YSM 方块 / Litematic 体素 / MMD toon / 默认浏览。

2. **envmap+ssr**：SSRPass on + SSRPass.opacity = ssrOpacity (0~1, default 0.5)、可联动 `reflectorDisableWhenSSR` 自动禁用 Reflector 地面。
   - 性能：SSR 1 次 beauty render + normal + metalness + SSR raymarch + 2 pass blur。
   - 视觉：屏幕空间内任意角度反射真实场景内容，屏幕外 fallback 到 envmap（无黑边），SSR ↔ EnvMap 无缝混合。
   - 适用：VRM 角色近景特写（金属甲片/皮甲反射明显）、产品预览。

3. **ssr-only**：SSRPass on + SSRPass.opacity 强制 = 1。
   - 视觉：纯 SSR，屏幕外内容的反射会黑（屏幕空间方法的先天限制）。
   - 适用：调试 SSR 参数、确认镜面真实度。禁用不推荐，除非用户明确知道自己的相机角不会出现屏外。

SSR 参数（`PostprocessingParams` 9 字段 + 联动）：
- 反射模式 select；SSR 反射强度 / 最大距离 / 厚度判定 3 slider；SSR 模糊 / 距离衰减 / 菲涅尔 / 多重弹射 4 toggle；`reflectorDisableWhenSSR` toggle。
- 厚度判定默认 0.018，最大距离默认 180；blur + distanceAttenuation + fresnel 默认真。
- bouncing 默认假（慢，PBR 产品预览可开真）。

### 2.4 PostprocessingCapability 设计：抽壳旧 PostprocessingManager + 延迟创建 + 公共接口 PostprocessingLike

**旧 PostprocessingManager 与新 PostprocessingCapability 对外最小契约**抽成独立 `PostprocessingLike` 接口（`adapters/postprocessing.ts` §声明）：

```ts
export interface PostprocessingLike {
  render(dt: number, lightCap: LightCapability | null): boolean;
  setSize(width: number, height: number): void;
  dispose(): void;
}
```

cleanupCtx.postProc / inputOpts.postProc / mount-preview-core 本地 postProc 变量全部改为 `PostprocessingLike | null`。private `composer` 不泄漏到接口层，不再触发 tsc "类型不可相互赋值：两 private 字段名相同但可见性不同"的错误。

**延迟创建 composer 双门控**（沿用旧 PostprocessingManager 的低开销设计，SSR 继承）：
- `enabled = true` → composer；**或** LightCapability volumetric.engine=postprocess 且 volumetric.enabled = true → composer。
- 否则销毁 composer，renderer.render 普通通道。

**Pass 顺序**（`buildComposer()`）：
```
RenderPass → (SSAOPass cond) → UnrealBloomPass → (SSRPass cond) → OutputPass
```
- SSR 放在 Bloom 后：发光物的屏幕空间反射也带辉光溢出，视觉一致。
- OutputPass 最后：正确做 sRGB → display 转换与去带化。

### 2.5 PostprocessingCapability ↔ ReflectorCapability 双向联动（SSR 时自动禁地面镜面）

mount-preview-core 在 `registry.createAll` 完成后 wiring：
```ts
postProcCap.setReflectorCap(reflectorCap);  // registry.getById("reflector") as ReflectorCapability
```

联动算法（`applyReflectorSync()`）：
- 若 `reflectionMode !== "envmap-only"` 且 `reflectorDisableWhenSSR === true` →
  - 快照 `reflectorPrevEnabled = reflectorCap.isEnabled()`（若尚未快照）
  - reflectorCap.setEnabled(false)
- 否则（reflectionMode 回 envmap-only 或用户取消自动禁用 toggle）
  - 若有快照：`reflectorCap.setEnabled(reflectorPrevEnabled); reflectorPrevEnabled = undefined`

`setReflectorCap` 切新引用前先还原旧 cap。`dispose()` 退出会话前也会还原。**精确恢复用户原 enabled 状态，而不是粗暴 true/false。**

### 2.6 能力与持久性

- **按模型类别预设（POSTPROC_PRESETS / FOG_PRESETS / ENV_PRESETS ...）**：YSM 方块 / VRM 角色 / MMD toon / Litematic 体素 / ResourcePack / default 六类，全部预设 reflectionMode 默认 = `envmap-only`（零性能开销，用户手切升级）。
- **loadState 优先级高于预设**：进入预览时先 `registry.loadAll()`（持久化先读），再 `setPreset(adapter.id)`（仅当用户无持久化才套用模型类别预设）。
- **localStorage 持久化键**：`ysm:cap:postprocessing`、`ysm:cap:environment`、`ysm:cap:fog`、`ysm:cap:shadow`、`ysm:cap:reflector`。

### 2.7 EnvironmentCapability 程序化 HDR（经验 433477 教训兜底）

5 套 Canvas 2D 程序化绘制的 equirect 全景图（零外部依赖、零黑反射）：studio / sky / sunset / night / forest。全链路严格走：
1. HTMLCanvasElement → `new THREE.CanvasTexture(canvas)`
2. `.mapping = THREE.EquirectangularReflectionMapping`（关键，否则 `fromScene` 不对）
3. `new THREE.PMREMGenerator(renderer).fromEquirectangular(canvasTex).texture`
4. `scene.environment = envTex` + `scene.background = envTex`（用户可开只反射不当背景）
5. 遍历所有 mesh `material.envMapIntensity = envIntensity`

**绝对禁止**：只给 `material.envMap = equirectCanvasTex` 但不做 PMREM 预滤波；绝对不提供无 fallback 的"仅从 CDN 拉 polyhaven .hdr"路径——外部资源离线/403 时，程序化 5 预设必兜底，永远不返回黑。

## 3. 后果（Consequences）

### 正面
- **能力迭代速度**：新增 capability 只需 `caps/new.ts` + `registry.add()` 一行 + 三语键，preview-menu/input/cleanup 零改动。新增后处理 Pass（DOF/LUT/Vignette/MotionBlur）= 在 PostprocessingCapability 加参数 + 条件挂 Pass，全管道式。
- **顶层 tab 心智 1:1 映射**：找开关路径短——想改反射内容 → environment；想改反射计算策略 + AO/Bloom/色彩 → postproc；想改灯 → lighting；想改视角 → camera；换模型 → switch。不需要「舞台/氛围」超级大包 tab。
- **SSR ↔ Reflector 自动避让**：用户从 0→1 开 SSR 不会出现地面两层反射 + z-fighting flicker，关闭 SSR 时 reflector 精确回原 enabled 状态。
- **低性能默认档**：默认 envmap-only + postproc enabled 默认 false，全管线走普通 renderer.render，移动/WebView2 低配机不热。升级路径清晰：用户先开 postproc（ACES 色彩 + 曝光 + Bloom），再在反射模式一步步升级体验。
- **零外部资源不卡**：EnvironmentCapability 5 预设程序化绘制出 HDR 味的 equirect 全景；RGBELoader（未来自定义 HDR）是加项不是刚需，始终有兜底。
- **Session 泄漏修复**：PostprocessingCapability.dispose() 精确还原 toneMapping/outputColorSpace/exposure，旧 PostprocessingManager 改全局不还原的问题已修复。

### 负面
- **SSR 性能开销**：envmap+ssr 在低端笔记本/安卓 WebView 2G 内存机型可能 30fps→20fps，必须默认 envmap-only，切 SSR 时给出性能提示（后续版本可加 FPS meter 联动阈值自动降级）。
- **SSAO 伪影**：小模型（VRM 头部特写）kernelRadius 过大时 AO 出黑边条；UI 给了合理默认区间 + 滑杆，但参数敏感性仍存在，需要用户手动微调。
- **registry 注册顺序 == environment tab UI 顺序**：新增 cap 在注册表末尾追加会导致后加的能力出现在 menu 底，若团队成员并行 add 未协调顺序会导致 UI 排序漂移（轻度问题；可后续加 displayOrder 字段）。
- **三语 i18n 键同步负担**：新增 slider/toggle 必补 zh/en/ja 三个键 + `npm run i18n:compile`（pre-commit 自动编译 public/locales/*.json），漏补则 preview-menu-items.test.ts 的断言失败（门禁有效）。

### 已知遗留
- `e2e/mock-data.ts L272` 老布尔字面量类型推断冲突（本轮未触及，本轮前后一直存在），后续单独修。
- `preview-library` chunk 584 kB（Bloom/SSR/SSAO addons 打包后），建议下一轮引入 `manualChunks` 把 three/addons 切 chunk。
- 自定义 HDR 上传（RGBELoader）+ LUTPass 调色 + DOF 景深均已规划未实现，沿用本 ADR 的 PostprocessingCapability 参数 + Pass 条件架构即可。
- SSR 多重弹射 bouncing 默认关（慢），PBR 产品预览用户手开即可；暂不引入动态自适应开启。

## 4. 数据溯源

- ADR-073（caps/ 能力模式、ADR 前缀要求）。
- ADR-081（灯光独立 tab，不与环境混）。
- ADR-085（registry.createAll 时序；caps 后 refreshDock 修复 litematic/pack 项缺漏）。
- ADR-094/095（存储分层、安装目录/资源分层；PMREM 纹理不缓存，每次 createAll 重建避免内存常驻）。
- 经验 433477：CanvasTexture 做反射要走 `EquirectangularReflectionMapping` + `PMREMGenerator.fromEquirectangular` 全链路，否则反射全黑。
- 经验 1270285：Bloom 在玻璃/金属反射视觉叠加顺序应在 SSR 前（发光物反射也带辉光）。
- 代码落地位置：
  - SceneCapability 契约：`frontend/src/utils/3d/caps/scene-capability.ts`
  - Registry：`frontend/src/utils/3d/caps/scene-capability-registry.ts`
  - Capability 实现：`frontend/src/utils/3d/caps/*-capability.ts`（9 个）
  - PostprocessingLike 公共接口：`frontend/src/utils/3d/adapters/postprocessing.ts`
  - 顶层 tab 定义：`frontend/src/utils/3d/adapters/preview-menu-defs.ts`（CORE_MENU_ITEMS 5 tab）
  - 菜单 filler：`frontend/src/utils/3d/adapters/preview-menu.ts`（fillEnvironment / fillPostprocessing 均 registry 驱动）
  - mount wiring：`frontend/src/utils/3d/adapters/mount-preview-core.ts`（setPreset / setReflectorCap wiring）
  - 三语 i18n：`frontend/src/core/i18n/locales/{zh-CN,en,ja}.ts`（preview.* 键）
