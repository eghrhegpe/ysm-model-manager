---
kind: model3d
name: 3D 预览渲染 model3d
tier: architecture
adr:
  - ADR-129
category: rendering
broad_claim: true
source_files:
  - frontend/src/preview-3d/
tests:
  - frontend/src/preview-3d/mesh/model3d.test.ts
  - frontend/src/preview-3d/adapters/ysm-model-preloader.test.ts
  - frontend/src/preview-3d/decoder/wasm-decode-blob-view.test.ts
  - frontend/src/preview-3d/caps/postprocessing-tonemapping-ownership.test.ts
  - frontend/src/preview-3d/caps/postprocessing-ssr-dispose.test.ts
  - frontend/src/preview-3d/caps/postprocessing-idle-bypass.test.ts
  - frontend/src/preview-3d/state/perf-presets-ssr-scale.test.ts
  - frontend/src/preview-3d/infra/render-host-frame-order.test.ts
auto_fields:
  symbols_with_lines:
    - __resetLargeModelWarnForTest
    - __resetSceneTextureBytesForTest
    - __resetSsrScaleCacheForTest
    - __resetWebGlContextLostForTest
    - __setEncodeImplForTest
    - _clearPmxStatsCache
    - _resetSingletons
    - ActiveInputSession
    - AdaptiveRenderBudget
    - addMeshToBoneGroup
    - AddOpLog
    - ALL_PERCEPTION_CAPS
    - ALL_TEXTURE_KEYS
    - AllocEntry
    - ALPHA_F_HOLE
    - ALPHA_F_TRANSLUCENT
    - ALPHA_F_VISIBLE
    - AlphaIndex
    - AmbientLightParams
    - AngleShot
    - AntiRepeatDualOptions
    - AntiRepeatOptions
    - AntiRepeatStrategy
    - applyAnimationFootIK
    - applyBlinkPerception
    - applyGroundSurfaceAppearance
    - applyGroundSurfaceStructural
    - applyIdlePerception
    - applyModelDefaults
    - applyOverlayMaterial
    - applyPerfPreset
    - applyReflectionUniforms
    - applyRotationIfNonIdentity
    - applyScaledUniformToPair
    - applyUniformToPair
    - applyVolumetricCone
    - applyVPDToMesh
    - applyWasdCameraMotion
    - applyWorkerDecodedTextures
    - ARCHIVE_ALIAS
    - ARIA_ATTR
    - ArmStats
    - assembleBoneSelectInfo
    - AssembledShell
    - assembleShell
    - AssertCommonFieldIsExact
    - assertNoDuplicateIds
    - assertRevisionRange
    - ATMOSPHERE_PRESETS
    - AtmospherePresetId
    - attenuateAmbientForSky
    - AutoDanceOptions
    - autoVmdPositionScale
    - bakeMeshFragments
    - BAND_TICKS
    - bandColorAt
    - BandStop
    - bandStops
    - BaseScene
    - BasisEncoderLike
    - BasisModuleLike
    - BeatDetectorLike
    - BeatDetectorOptions
    - BedrockModel
    - bindFieldRestorers
    - bindInputHandlers
    - BlinkCallback
    - BlinkOptions
    - bloomThresholdToLinear
    - BoneData
    - BoneDetail
    - BoneGroupMap
    - BoneInfoLite
    - BoneListItem
    - BoneMaps
    - BoneNode
    - BonePanelCleanupRef
    - boneRowActiveBg
    - BoneSelectInfo
    - BonesPanelItemOpts
    - BoneTree
    - boxUvEnd
    - buildBoneHierarchy
    - buildBoneTree
    - buildCameraSchema
    - buildCrossCuttingNodes
    - BuildCtx
    - buildCubeMeshData
    - buildEnvironmentNodes
    - buildEnvSchema
    - buildFbxScene
    - buildFbxSceneFromData
    - buildFogNodes
    - buildGroundNodes
    - buildGroundOverlaySpec
    - buildGroundSurfaceSpec
    - buildLightingSchema
    - buildLightNodes
    - buildLightPersistPayload
    - symbols_total: 1100
use_when:
  - 3D 渲染层
  - Three.js
  - 相机
  - 骨骼渲染
  - 自由相机
  - 3D 截图
  - 纹理加载
  - spec 兜底
invariant_anchors:
  - frontend/src/preview-3d/mesh/model3d.ts|Spec3D
  - frontend/src/preview-3d/adapters/ysm-model-preloader.ts|preloadModel
  - frontend/src/preview-3d/mesh/cube-mesh.ts|computeBoneLocalPos
  - frontend/src/preview-3d/mesh/mesh-builder.ts|addMeshToBoneGroup
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 挂载/切换 3D 预览（mount3D / switchPreview）
  - 多模型同框叠加（keepInScene=true）
  - 骨骼拾取与选中（pickBone / setBoneVisible）
  - 自由相机漫游（WASD + 空格/Shift 升降）
  - 3D 截图 / 纹理预加载缓存 / 渲染性能调优
quick_risk_lines:
  - 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径
  - 所有 3D 渲染内容必须经 mount3D 统一会话外壳，禁止独立维护 renderer/scene/camera
  - dispose() 必须遍历子对象调用 geometry?.dispose() / material?.dispose() / texture?.dispose()，Object3D.remove() 不释放 WebGL 资源
  - 100MB 阈值是网页版唯一防线，低端设备（4GB RAM）峰值内存可能触顶 OOM
pitfalls:
  - 「Fatal trap#11」坐标口径必须对齐 YSMViewer：pivot X 取反；Go 端为唯一事实源，网页兜底 cube-mesh.ts 逐值同构。旧第二套 JS 兜底 model3d-spec.ts（cubePivot/cubeOrigin 与 Go 不一致）已于 2026-09 删除
  - mesh 级视锥剔除必须关闭（mesh.frustumCulled = false），否则骨骼旋转时扁平部件（如脸部）会误判不可见
  - dispose 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/pointer/resize/fullscreenchange 监听、dispose geometry/material/texture，缺一即泄漏
  - 纹理绑定不得静默兜底：槽位越界/缺图应报错「纹理槽位缺失」+ 灰色占位，严禁「找第一张可用」贴错图
  - perComponent 纹理索引分类与绑定索引必须同一空间：组件分支恒用局部槽 0（arr === compTexArr ? 0），非组件回退全局 texIdx/resolvedTexIdx
  - 大文件解码 peak 内存可达 ~3-4× 文件大小（base64 → Uint8Array → WASM HEAP → MEMFS → readFile → JSON.parse 六层拷贝并存）
  - 「`infra/worker-bridge.ts|rebuildDeadWorkers` 的重建是**逐实例**而非全池连坐」（2026-10-12 池语义修正）：`Worker` 无 `readyState` 可查，桥**无法反查**哪个实例已死，故原实现退化为「无条件 terminate 池中每一个」——把注释承诺的「terminate **死实例**」做成了**全池连坐**（健康 worker 的在途请求被一并 `settleError`，且整池重建）。修法 = **事件驱动记账**：`onerror` 是死亡唯一可靠信号，`handleWorkerError(failed?)` 传实例即精确标记、只重建该实例；**不传 = 无法归属 → 全体标记**（保守回退，语义同旧版，故**非破坏性变更**——既有不传参调用点行为不变）。`createResolveModeBridge`（唯一 resolve-mode 生产入口）已改传实例。**当前无实际受害者**：生产唯一多 worker 池 = ktx2，走 `terminatePool` 分支不达此函数；resolve-mode 生产用户只传**单** worker（池长 1 时「杀死的」≡「杀全部」）。故本次是**把将来池化必踩的暗雷提前拆掉**，判据 = **注释与实现不一致本身即债**（本仓最重视的漂移类型）。**同族变体（2026-10-12 当日补口）**：替补的 `onerror` 接线在 `rebuildDeadWorkers` 内部（`createWorker` 只返回裸实例）——此处也必须传 `replacement`，不传则替补二次崩溃走无参分支「全体标记 → 全池连坐」，把本修原样绕开；同段注释曾把真实接线误写成不传参形态且引用不存在的 `markDead`（已一并改正）。执法 `worker-bridge.test.ts`「池语义（只重建死实例）」三例（多池单崩 → 健康实例不被 terminate；两次各崩 → 各补一个；**替补二次崩溃 → 健康实例不被连坐、只再补一个**）
  - 「`mmd-ktx2-encoder.ts|disposeKtx2WorkerPool`」KTX2 编码 worker 池曾长期无回收点：池由模块级缓存持有，生产侧零调用桥的 `dispose()`，唯一清空路径是 worker 崩溃；而编码是「每个纹理一生一次」的事件（落盘后 `completedHashes` 幂等跳过），3 个 worker + 各自 WASM BasisEncoder 却按进程级常驻。修法 = 挂 MMD 会话 `Stage6Dispose` 的 finally（`cancelPendingEncodings` 旁，同粒度同语义），懒建逻辑负责下次重建。**勿挂终局拆除**——其 `beforeunload` 钩子在 Wails v3 桌面端确认不触发（上游源码取证，见 `docs/archive/audit-host-env-coupling-review.md`），挂上去等于死代码。判别式：为资源补 dispose 前先问「它服务的事件频率 vs 它的生命周期」，一次性事件的资源不该活到进程结束
  - 「`render-host.ts|animate` 是**先无条件续期、后判断**」——早退（局部态缺失/未就绪）**不停环**，停环唯一手段是 `stopIfIdle`（判 `_perFrames.length === 0`）或 `reset()`。**勿按「早退即停环」的直觉写断言**（契约测试首版即因此写反）。回归守卫 `render-host.raf-contract.test.ts`（用受控 rAF + 「反复 flush 看队列是否仍增长」判「帧真停」——不用 fake timers 只数调用次数、不断言 cancelAnimationFrame 被调，两者都骗得过）
  - 「`render-host.ts|reset` **不是停环手段**」——它只清状态字段（`_animId = 0` 等），**不 cancel 已在飞的那一帧**；残余帧执行后会再次 `requestAnimationFrame` 把 `_animId` 复活，导致下次 `start()` 被幂等判定（`if (_animId !== 0) return`）**误拦**，循环拉不起来（实测第二轮帧数 0）。生产 close 正确顺序 = **摘 perFrame → `stopIfIdle()` 真停环 → `reset()` 清状态**。回归守卫 `render-host.session-restart.test.ts`（全行为可观察判据——不读内部字段，避开「断言 reset 后为空而 reset 根本没清」的自证式假绿）
perf:
  - memory-heavy
  - gpu-bound
---

# 3D 预览渲染 model3d

> **目录级覆盖为有意为之**：本卡为 3D 渲染层（YSM/VRM/MMD/Litematic/FBX）索引卡，source_files 有意覆盖 `frontend/src/preview-3d/` 全部源文件（含 `adapters/ysm-model-preloader.ts`），提供全层符号表供路由直跳。

> **架构事实已迁移至 **[architecture.md#4-ysm-模型解析与渲染threejs-ysmparser-wasm](../architecture.md#4-ysm-模型解析与渲染threejs-ysmparser-wasm)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 概览

`frontend/src/preview-3d/`（含 `adapters/ysm-model-preloader.ts`）构成 YSM/VRM/MMD/Litematic/FBX 等格式的 **3D 渲染层**——将 Go 端 spec 或 WASM 解码产物（BedrockGeometry）转成 Three.js 场景图，供 `mount-preview-core` 外壳挂载渲染。本层只管"数据→Three 对象"，不管会话外壳/菜单/rAF（归 preview-core）。

## 核心职责

- **模型加载与解码**（`adapters/ysm-model-preloader.ts`，ADR-270-d5 自 `views/app-preview/model3d-loader.ts` 迁入）：`preloadModel(path)` → 缓存 → Go `GetModel3DSpec` → 失败兜 WASM `decodeYsmViaWasm` → 输出 `BedrockGeometry`（bones/cubes/materials/textures）；`textureCache` 引用计数池跨模型复用（同 URL 只 upload 一次 GPU）
- **几何/骨骼/立方体**（`geometry.ts`/`cube-mesh.ts`/`mesh-builder.ts`/`bone-tools.ts`/`model-group-builder.ts`）：BedrockGeometry → Three.js Mesh（按骨骼组拆分、按面 alpha 分 split、perComponent 纹理 slot 绑定）；`BoneTree` 跨格式抽象；`semantic-bones.ts` 语义骨骼 id 集（VRM/MMD/YSM 三格式统一，宽容缺省；含 toes——ADR-306 P1b 起脚尖链 CCD 需要）
  - **cube UV 双端逐值同构（foxcar 贴图颠倒修复，2026-09）**：网页兜底链（`spec-builder.ts → model-group-builder.ts → cube-mesh.ts`）的 `expandBoxUV`/`mdCmBuildFace` 必须与 Go `spec.go`/`packFaceVertices` 同构——canonical UV 槽位 + up/down 在打包点反转角点（负 uv_size 有符号、禁止归一化），细节与黄金参照见 [go-threejs](./go-threejs.md) 不变量「per-face/box UV 的 up/down 角点定向」。旧 JS 兜底 `model3d-spec.ts`（角点序与 Go 漂移的第二套实现）已于 2026-09 删除，`CUBE_EPS` 单点并入 cube-mesh.ts；WASM 解码的诊断纹理范围估算（`wasm-decode.ts|computeBoneTexRange`）同口径——faceUV 优先且负 uv_size 取有符号包围盒
- **材质与纹理**（`texture-loader.ts`/`texture-cache.ts`/`texture-alpha.ts`/`mc-tints.ts`）：`loadTextures` 并行 acquire + 50ms 轮询 complete（P2 修复加 15s 超时兜底，悬挂 URL 不再永久 pending）；KTX2 压缩管线（WASM BasisEncoder → base64 → Go `SaveCachedTexture` 缓存）
- **渲染循环与性能**（`render-budget.ts`/`frustum-cull.ts`/`scene-stats.ts`/`screenshot.ts`/`screenshot-render.ts`）：perFrame 回调驱动 `update(dt)`（动画/感知/物理）；自适应像素比 / 帧率上限（GPU 饱和时预防性降档 + **滞回回升**，锐评 2026-10-11：降档单向不可逆已修——`sampleAdaptivePixelRatio` 连满 3 个健康采样窗口才 +0.25 回升一档、上限创建时初值、降档即复位计数；gpu 参数为**惰性采样函数**，仅窗口结算帧调用，rAF 热路径零对象分配）；视锥裁剪（mesh 级 `frustumCulled=false`，骨骼旋转时扁平部件误判已修）；离屏多角度截图（front/45/side/back45）
  - **可见性属主分家（2026-09 修复）**：`Object3D.visible` 曾被三方共写而互相踩踏——① 视锥剔除（`cullModelGroups`）② 关剔除兜底（`restoreModelGroupsVisible`）③ 用户按模型隐藏（`sceneRegistry|setVisible`，落盘 `ysm:model-visible:<path>`）。`sceneRegistry.roots` 与 `frustum-cull.modelRoots` 是**同一批对象**（`register-built-scene|registerBuiltScene` 用 `scene.children` 差量捕获，捕获到的正是 adapter 里 `scene.add` + `registerModelRoot` 的同一个 rootGroup），故兜底原实现的无条件 `visible=true` 会在下一帧抹掉用户隐藏意图。现按**抑制态归属**（`_culled` 集合，范式同 postprocessing 的 `reflectorSuppressing`/ADR-247 D2）：剔除只处置非本模块隐藏的根并登记自己压下的，兜底只还原仍被自己压着的（`_culled` 空则零写）。**改动此处必须同时跑 `frustum-cull.test.ts` 与 `frustum-cull-visibility-ownership.test.ts`**——后者专测「隐藏意图不被剔除/兜底覆盖」。
  - **矩阵置脏判据**：`markCullMatricesDirty()` 须由「真有 Object3D 变换写入」的 perFrame 回调触发。cap 的 `update()` 只推进 uniform/时间值（water 写 `waterTime`、sky 写 `beams.time`），**从不写变换**，故不得以「存在实现了 update 的 cap」为置脏依据（原 `|| hasCapUpdate` 判据恒真，使动静分治失效）。
  - **[ADR-330 逐根收口 2026-10-12]** 消费端 `render-host|animate` 原走**全体**形态（`_perFrames` 非空即 `markCullMatricesDirty()` 无参），因 perFrame 契约不带根身份无法归属。现经 `BaseScene.root`（adapter 内容层暴露，= `registerModelRoot` 同一根，4 个动效格式 fbx/mmd/ysm/vrm 已补）→ `setPerFrame(f, root?)`/`registerPerFrame(f, root?)` 透传，帧循环收集「本帧实际驱动的根」逐根置脏；**任一回调无根 → 保守回退全体**（正确性不变）。静态格式无 `update` → perFrame 为 null 不受影响。执法 `render-host-per-root-dirty.test.ts`。模式层背景 → `3d-patterns.md` §18（脏标记粒度下沉 + 诚实边界）。
  - **适配器可见性守卫（ADR-098 契约）**：`update(dt)` 入口须按 `visible` 早退以省离屏模型的动画/感知开销——VRM/MMD 已实现，YSM 因 ADR-098 立项时尚无动画播放器而漏掉（前提已失效），2026-09 补齐。⚠️ `perceptionPauseRef.paused` 等全局标志**必须先于早退写**，否则早退期间标志停陈旧值、恢复可见后感知层被冻结
  - **反射链成本与排除机制（读 three r185 源码核实，2026-09）**：每帧整场渲染次数 = 基础 1（`RenderPass`）；`reflectorEnabled` 开时 +1（`Reflector.onBeforeRender` 自渲一次，但其内置「镜面背对相机则早退」守卫，故仅镜面可见时付出）；SSR（`ppReflectionMode !== "envmap-only"`）+2（beauty pass 整场 + normal pass `scene.overrideMaterial` 整场）。**`selects: null` 使 `_renderMetalness` 正确跳过**（`selective = Array.isArray(null) = false`），不构成第三次。⚠️ **`groundReflector` 不能传本仓的 `Reflector`**：SSRPass 要求的是 `ReflectorForSSRPass` 实例（须有 `doRender()` 方法），误传会在 `SSRPass.render` 抛 `doRender is not a function`；且该类是**替代品**而非附加品（自带 maxDistance/opacity/fresnel 等与 SSR 对齐的 uniform），首行 `import` 换成它才行。**双反射（单平面镜 + SSR 叠同一水面）默认不可达**：`ppReflectorDisableWhenSSR` 默认 `true`，SSR 活动时 `applyReflectorSync` 会压制 reflector（抑制态归属见 ADR-247 D2）；仅当用户显式关掉该守卫才叠加——属用户选择而非缺陷
    - **SSRPass.dispose 上游泄漏 → 本仓补丁（2026-10-11 读源码实证）**：官方 `SSRPass.dispose()`（`three/examples/jsm/postprocessing/SSRPass.js`）释放 7 个 render target（beauty/prev/normal/metalness/ssr/blur/blur2）+ 7 个材质（normalMaterial / metalnessOn/OffMaterial / blurMaterial / blurMaterial2 / copyMaterial / depthRenderMaterial）+ fsQuad，**唯独漏掉主 `ssrMaterial`**——它持 `tDiffuse`/`tNormal`/`tMetalness`/`tDepth` 四张纹理引用与全部 defines/uniforms。不补即每次拆链漏一个 ShaderMaterial 及其 GPU program。本仓在 `postprocessing-composer.ts|disposeComposer` 显式补 `ssrPass.ssrMaterial.dispose()`（**类型安全无需强转**——官方 `@types/three` 的 SSRPass.d.ts 有 `ssrMaterial: ShaderMaterial` 公开声明）。**撤除条件**：three 上游修复后，`postprocessing-ssr-dispose.test.ts` 首例「上游确实漏释放」会转红提示；撤补丁时须同步翻转该例断言方向。既有「切档不重建 composer」策略由此**降级为纯性能选择**（原立论「避免累积泄漏」已不成立）
  - **后处理 Pass 链序硬约束 + MSAA（读 three r185 源码核实，2026-09）**：**SSR 必须独占链首**（紧跟 `RenderPass`，位于 SSAO/Bloom 之前）——`SSRPass.OUTPUT.Default` 把自身的 `beautyRenderTarget.texture` 以 `NoBlending` **整片覆写**进 `writeBuffer`，且 `render(renderer, writeBuffer /*, readBuffer, ...*/)` 的 `readBuffer` 形参被注释忽略；而 `SSAOPass.OUTPUT.Default` 是 `CustomBlending` 写 `readBuffer`（正确叠加前序结果）、`UnrealBloomPass` 亦读 `readBuffer`。故原顺序（Bloom → SSR）会让**一开 SSR 就静默吃掉 Bloom/SSAO 的成果**；正确链序 = `RenderPass → SSR(可选) → SSAO(可选) → Bloom → OutputPass`。另：`EffectComposer` 自建读/写缓冲为 `new WebGLRenderTarget(w, h, { type: HalfFloatType })`**不带 `samples`**（=MSAA 被静默旁路，renderer 的 `antialias: true` 失效），本仓改为传入带 `samples` 的 target（采样数按 `renderer.getContext().getContextAttributes().antialias` 实际授予与否决定）
    - **渲染选项之间没有硬冲突，故不设互斥下拉（2026-09 结论）**：① **MSAA × SSR 不冲突**——MSAA 是 `WebGLRenderer` **构造期 context 属性**（`antialias`），**运行期无法切换**，故不具备做菜单项的前提；它只对「正在光栅化几何」的 `RenderPass`（及 SSR 自渲的 beauty/normal）有意义，其余 pass 都是全屏 quad。SSRPass 的 5 个内部目标（beauty 带 depthTexture/normal/metalness/ssr/prev）**全为 samples=0**，与 composer 缓冲的 MSAA 各管各的；three 有完整支持（`useMultisampledRTT` 需 `WEBGL_multisampled_render_to_texture`，否则退回 multisampled renderbuffer + blit；切目标时自动 `updateMultisampleRenderTarget` resolve）。② **SSR × SSAO/Bloom 不是冲突而是链序依赖**——stock pass 里**只有 SSRPass 忽略 `readBuffer`**，链序修正后三者可同时开。③ **SSR × 单平面镜**才真需取舍，已由 `ppReflectorDisableWhenSSR`（默认 true 自动抑制）+ 一个 toggle 覆盖，无需下拉。④ 现有菜单已具备切换能力（均 MenuNode schema）：`pp-reflection-mode` 是 `kind:"select"` 三档、`pp-reflector-disable-when-ssr` 与 SSAO 是 `kind:"toggle"`。**唯一未处理的渲染选项组合是「后期 × 截图」（后期不入截图）——见 `export.md` 的已知差异条**
  - **composer 惰性常驻（ADR-299，实测裁定 2026-09-24）**：ADR-250 §2.2 的「构造即建、常驻」被实测推翻了一半——`needComposer()` 退化成 `composer !== null` 使 `render()` 恒返回 `true`，`render-host` 的直渲兜底成死代码，而 `ppEnabled` 默认 `false`，即**默认会话从不启用后处理却每帧付管线过路费**。实测（`postproc-cost-probe`，948×610@DPR1）：直渲 1.96 / 关闭态走 composer 3.02 / 开启态 3.48 ms——**常驻税 1.05ms/帧（+53.7%）**，且其中真实效果仅 0.21ms（默认 bloom/ssao/ssr 全关），**管线成本是载荷的 5 倍**；常驻双缓冲 35.3MB。现按两轴解耦：**生命周期**=首次启用才建、建后不销毁（保住「换模型不重建 GPU 资源」）；**每帧参与**=`composer !== null && enabled`，关闭态 `render()` 返回 `false` 交回直渲。⚠️ 惰性化的隐藏坑：关闭态 `setSize`/`setPixelRatio` 必须**无条件记录凭据**（`lastW/lastH/lastPixelRatio`），否则自适应降档后才启用会按 `devicePixelRatio` 建出与 renderer 实际像素比不符的缓冲
  - **空转短路（2026-10-12 补 ADR-299 的另一半）**：ADR-299 管「**未启用**（`ppEnabled=false`）却付过路费」；本条管「**启用但三个子效果全关**」——此时 `EffectComposer.render` 仍要跑 `RenderPass`（整场渲进离屏 HalfFloat RT）+ `OutputPass`（全屏 quad 拷回画布）**两趟全屏**，换来与直渲**逐像素等价**的画面。**等价性根据**（非推测）：① `OutputPass` 不产新效果——它读 `renderer.toneMapping`/`outputColorSpace`（`OutputPass.js`）把同一变换烘进自己的 shader，属**重复** renderer 在 `renderer.render()` 里已做的事；② `postprocessing-capability|applyToneMapping` 直接写 renderer 两字段，故 **toneMapping 不依赖 composer**。实现 = `postprocessing-composer|isFullyIdle()`（判据：`!ppBloomEnabled && !ppSsaoEnabled && ppReflectionMode === "envmap-only"`）+ `cap.render` 命中即返回 `false`（与「composer 未建」同语义，交 render-host 直渲）。⚠️ **新增任何子效果（如 DOF）必须同步扩 `isFullyIdle` 判据**，否则被静默吞掉。执法 `postprocessing-idle-bypass.test.ts`
  - **SSR 反射缓冲缩放（档位派生，2026-10-12）**：上游 `SSRPass.resolutionScale`（默认 1=全分辨率）本仓此前**从未设置**。现按性能档位派生（low 0.5 / medium 0.75 / high 1 / **custom 1**——不擅自替用户降质），走 `perf-presets|getSsrResolutionScale()`（模块级缓存 + 切档失效）。**只缩 SSR 自己的三张缓冲**（ssr/prev/blur×2），beauty/normal/metalness 与**主渲染不受影响**——与「全屏降分辨率」的霰弹枪方案有本质区别。精准性依据：`SSRPass.setSize` 内 `MAX_STEP = √(w²+h²)`（步进 ∝ 屏幕对角线）。⚠️ 赋值**必须在 `insertPass` 之前**（`resolutionScale` 只在 `setSize` 内被消费）。执法 `perf-presets-ssr-scale.test.ts` + `postprocessing-idle-bypass.test.ts` 接线例
  - **WebGL context lost/restored 守卫（`infra/webgl-context-guard.ts`，锐评 2026-10-11 P2 落地）**：WebView2 GPU 进程重置（内存压力/驱动切换/核显独显切换）时浏览器抛 `webglcontextlost`，three 静默挂起渲染 → 用户见黑场且零提示。守卫在 renderer 单例创建时挂 lost/restored 一对监听：lost 必 `preventDefault()`（否则 context 销毁不可恢复）+ toast「等待恢复」；restored 清标志 + toast「已恢复」。**不接管恢复本身**（浏览器 + three 内部完成）。生命周期：`shared-infra|buildSharedInfra` renderer 创建分支安装一次（renderer 跨 session 复用故守卫常驻），**teardown 时先 uninstall 再 forceContextLoss**（forceContextLoss 会触发 lost 事件，守卫未摘会误发 toast）。对外查询 `isWebGlContextLost()`。
- **GPU 预算与纹理字节计量**（`gpu-load.ts`/`gpu-budget.ts`/`gpu-load-calibrate.ts`/`texture-bytes.ts`）：4 维预算（draw calls / triangles / 纹理数 / textureBytes）统一经 `gpu-budget|guardGpuBudget` 判定，两条入口共用（追加通道 + 直挂通道）。**字节维度双口径取大者**：场景图（`texture-bytes|estimateSceneTextureBytes`，覆盖 MMD/VRM/FBX 等**不进 `textureCache`** 的格式）+ 池累计（`textureCache|getTotalBytes`）——单用池会对 MMD/VRM 恒 0（最吃显存的格式反而不被计量）。预算上限走 `gpu-load-calibrate|resolveGpuLoadLimits()`（真机标定生效、clamp 到默认 ×0.1~×10 防自锁）
- **2D 预览**（`views/app-preview/model2d/model2d.ts`）：平铺/网格 2D 缩略图（Canvas 2D 正交投影）

## 对外 API / 入口

- `preloadModel(path)` — 加载 + 缓存 spec（`adapters/ysm-model-preloader.ts`）
- `loadTextures(urls)` / `releaseTextureUrls(urls)` — 纹理加载 + 引用归还（配对使用，禁止 dispose）
- `buildYsmObject(geo)` / `buildYsmScene(ctx)` — YSM 适配器内容层
- `renderMultiAngle(path, urls, opts)` — 离屏多角度渲染
- `screenshotFromRenderer(renderer, scene, camera, opts)` — 纯函数截图
- `SceneCapability` 接口族（`BaseScene` + `UpdateableScene`/`ScreenshotScene`/`CameraControlScene`/`GroupedScene`/`SemanticScene`）— ADR-178 能力拆分，adapter.build 返回能力组合（`PoseScene` 接口已删 2026-10-11：applyPose 姿势能力经 `PreviewScene` 可选字段 + MMD 内联 `SemanticScene & { applyPose? }` 承载，接口形制无人消费）

## 与其他子系统关系

- **mount-preview-core**（`preview-3d/adapters/`）：本层提供 `PreviewAdapter.build` 产出内容层 + perFrame 回调；外壳负责挂载/菜单/rAF/清理
- **Go 绑定**：`GetModel3DSpec`（spec 数据源，单一事实）、`GetVoxelData*`（体素/存档）、`DetectResourceType`（类型探测）、`SaveCachedTexture`（KTX2 缓存）
- **WASM 解码**（`decoder/wasm-decode.ts`）：Go 不可用时的 BedrockGeometry 兜底
- **skeleton 2D 层**（`views/app-preview/skeleton.ts`）：先走 2D 骨骼线框图，用户点 3D 按钮升级→`createYsm3D` 走本层
- **预览缓存**（`preview-3d/decoder/model-cache.ts`）：FIFO 50 条 spec 缓存（与 `export.md` 口径一致）；`texture-cache.ts` 纹理引用计数池；KTX2 缓存走 Go 端落盘

## 不变量

- **几何口径唯一事实源 = Go `GetModel3DSpec`**：网页兜底统一走 `cube-mesh.ts`（与 Go 逐值同构，双端测试锁定）；旧第二套 JS 兜底 `model3d-spec.ts buildSpecFromModel` 因 cubePivot/cubeOrigin 与 Go 口径漂移且无生产调用，已于 2026-09 删除，禁止再私改/私建几何计算口径（pivot X 取反等以 Go 端为准）
- **geometry 输入选择链与 Go `parse.go` 同构**（巡检第 8 轮 2026-10-11，值面同构 ≠ 结构同构——轮 7 逐值核抓不到的东西，本轮靠「两侧走不走同一条条目选择链」抓到）：`spec-builder.ts parseBedrockGeometry` 必须与 Go 权威走**相同的选条与过滤链**——① 新版 `minecraft:geometry[]`：单条目宽容（bones/description 缺席 → 非 nil 空模型 → 入口落 `{}`），多条目跳 bones 空壳取首个非空（Blockbench 偶发首条占位）；② 新版失败**回退旧版 `geometry.*`**（车万女仆 mod 形态，texturewidth 无下划线；字典序 sort 后规范键 model 与首位**解构互换**非覆盖挪位）；③ `isGuiBone` 过滤（Go `TestIsGuiBone` 为锚——cubeCount>0 一票否决、大小写不敏感、gui/background **前缀**不认包含）。**可达性依据**：`geometryRaw` 是原文件文本（`wasm-decode.ts|firstGeoRaw`），同一文本 Android Go binding 与网页 TS 兜底必须同形产出 spec，否则跨通道分叉。⚠️ 射程边界：本条管**结构面**（选条/回退/过滤），**值面**逐值由轮 7 parity 锁；**边界值容错类**（origin/size 过短过长对象形态）属真实语料零命中的死路径，`3d-patterns.md` §14 已裁决**不收敛**（ADR-129），勿顺手"统一"。执法：`spec-builder.test.ts`「Go parse.go 结构对齐」三块（A/B/C）变异验证 M1-M4 全钉死
- **纹理所有权归缓存池**：`loadTextures` acquire → 用完 `releaseTextureUrls`（引用 -1），禁止 `tex.dispose()`——LRU 失效三重后果（见 `3d-patterns.md` §7.1）
- **dispose 必须完整遍历子对象**：`geometry?.dispose()` / `material?.dispose()` / `texture?.dispose()`；`Object3D.remove()` 不释放 WebGL 资源
- **mesh 级 `frustumCulled = false`**：骨骼旋转时扁平部件（脸部）会误判不可见
- **perComponent 纹理索引分类与绑定索引同一空间**：组件分支恒用局部槽 0，非组件回退全局 `texIdx`/`resolvedTexIdx`
- **大文件解码 peak ~3-4× 文件大小**：base64 → Uint8Array → WASM HEAP → MEMFS → readFile → JSON.parse 六层拷贝并存（100MB 阈值是网页版唯一防线）。2026-09 补**事前告知**：`infra/large-model.ts|warnLargeModelIfNeeded(bytes, path)` 在受限平台（`isViewerMode`：网页版 / Android）超 50MB 时给一条带实测字节数 + 3× 峰值估算的 toast（文案 `preview.largeModelWarn` 三语，会话内同路径只提示一次）；调用点 `decoder/wasm-decode.ts|doDecodeYsmViaWasm` 拿到字节后——复用已有字节数，**不做额外 IO 探测**。⚠️ 这**不改内存模型**：六层拷贝并存仍是长期债，警示只把「静默 OOM」变成「有预期的卡顿」
- **renderer 输出字段的归还必须「逐字段归属判定」，不得按「谁在场」整块跳过**（2026-10-11）：`postprocessing-composer.ts|restoreOutputSettings` 原以 `if (sky 启用) return;` **整块提前退出**——因 sky 也写 `renderer.toneMapping`（`sky-capability.ts|apply` 写定值 **ACESFilmic** 并自行引用计数归还），作者怕盲还原打回 sky 的值。但**「sky 在场」≠「sky 是当前持有者」**：本 cap 写 `toneMappingValue(envState.ppToneMapping)`（用户可选 none/linear/reinhard/aces/cineon）——用户选**非 aces**（如 reinhard）时 renderer 上就是**本 cap 的值**，提前退出 = 放弃归还自己的写入，**残留成第三种状态**（既非 sky 的 ACES 也非快照）。正解 = 判据 `renderer.toneMapping === 本 cap 写值 ? 归还 : 不动`（同文件 `outputColorSpace` 已是此范式、同 `frustum-cull|_culled` 抑制态归属）——「非持有者」自然跳过，原提前退出想保的场景由**判据本身**覆盖。执法：`postprocessing-tonemapping-ownership.test.ts`（4 例；重引入提前退出即 3 例红，已实测）。**附带清理**：该判定原经 `deps.caps` 查询器，修完 `caps` 参数/字段/import 全无消费者 → 一并删除（死缝不留）
- **帧末钩子 `SceneCapability.afterFrameUpdate?()`**（2026-10-11 新增）：在 **WASD 相机输入 + 全部 perFrame 回调之后、主渲染之前**调用，供「需要读本帧已更新场景状态」的渲染准备使用（消费例 = 水面倒影 RT）。契约：**只产出资源、不推进时钟**（时钟属 `update`）。`update` 的语义同步收窄为「前段：推进内部时钟/uniform」。时序守卫 = `render-host-frame-order.test.ts`
- **「视图语义」缺陷族：凡取 `.buffer` 处必审**（2026-10-11 立 / 2026-10-12 三轮扩捕）：**禁止把 `bytes.buffer` 当作 `bytes` 的等价物**——`.buffer` 是**底层整块**（可能远大于视图），且 transfer 时会 detach 整块。族内已知形态与处置：
  - **Blob 构造**（`decoder/wasm-decode.ts` 四处，2026-10-11）：一律经 `viewAsBlobPart(bytes)`——整视图零拷贝直传、偏移视图 `.slice()` 收窄。执法 `wasm-decode-blob-view.test.ts`（错位 subarray + 0xAA 哨兵，三例全红于 `.buffer` 变异）。
  - **`ImageData.data` 重建**（`decoder/mmd-ktx2-encoder.ts|blobUrlToImageData`，2026-10-12）：原 `new Uint8Array(imageData.data.buffer)` 取整块重建 → 若浏览器返回偏移视图即**静默放大**成多于实际像素的字节，下游按 `width×height×4` 解读即**像素错位**。改 `Uint8Array.from(imageData.data)`（按视图区间取值 + 归一 `Uint8ClampedArray`→`Uint8Array`）。**这是本轮唯一有实测判别力的修复**（见下条「纵深 vs 载荷」）。
  - **transfer 送出的 buffer**（`decoder/mmd-ktx2-encoder.ts|encodeToKTX2`，2026-10-12）：原 `img.data.buffer` + transfer → 传 subarray 时送出并 detach 超范围整块。改 `bytesToArrayBuffer(img.data)`，且 **transfer list 必须传 helper 的返回值本身**（否则 detach 的不是被送对象）。**性质 = 纵深防御**（见下条）。
  - **同文件一致性基准**：`adapters/mmd/` 家族（`mmd-build-load` / `mmd-build-scene` / `mmd-build-anim|VMD 路径`）**早已统一走 `bytesToArrayBuffer`**；`mmd-build-anim|VPD 路径`（2026-10-12）是唯一漏网，已收敛——**判据 = 同文件内两种写法并存即债**，不必等真实故障。
  - **`transferables` 送 `.buffer`：仅当确认无重叠时安全**（`adapters/fbx/fbx-parser.worker.ts`，2026-10-12 核查判定**不改**）：该处对每个 attribute 推 `arr.buffer`，若两个 attribute 共享底层 buffer 则 `postMessage` 抛 `DataCloneError`（重复 transferable）。**核查结论 = 上游 `fbx-scene-to-data.ts|serializeGeometry` 的每个属性都经 `TypedArray.from(...)` 新建独立数组**，物理上不可能共享 → 当前安全。**不加去重守卫**（本仓明训「不为不存在的场景写防御」，见 `worker-bridge.ts` 的「不为瞬态加防御」判例）。**复查触发条件**：若 `serializeGeometry` 改为零拷贝/复用缓冲（如 `subarray`），此处必须同轮加去重。
  - ⚠️ **「纵深 vs 载荷」必须分清**（本轮实证）：`encodeToKTX2` 那处**变异未被测试捕获**——因为上游 `blobUrlToImageData` 修好后 `img.data` 已是精确数组，`.buffer` 恰好占满，两条路径结果相同。故该处是**纵深防御**（防未来调用方传 subarray），**真正修掉缺陷的是 `blobUrlToImageData`**。申报成果时不得把两者混为一谈——**改动量 ≠ 判别力**。
- **Blob 构造必须走「视图语义」而非 `.buffer`**（2026-10-11 收敛，四处统一）：`decoder/wasm-decode.ts` 的纹理/头像 Blob 构造一律经 `viewAsBlobPart(bytes)`——**整视图**（byteOffset=0 且占满底层）零拷贝直传视图；**偏移视图**才 `.slice()` 收窄。**禁止退回 `bytes.buffer`**：那是底层**整块**，当 bytes 是 subarray 视图时会把多余字节塞进 Blob → 纹理花屏/头像损坏**且不报错**（同族正确性基准：`backend/web-community.ts` 显式按 `byteOffset/byteLength` 切片、`utils/base/primitives/base64.ts|bytesToArrayBuffer` 注明「仅偏移视图才 slice」）。**可达性依据**：`InflightCtx.ReadBytes` 在网页版走 IDB `ArrayBuffer` 直出（ADR-228），可能返回 subarray 视图；WASM 侧 `FS.readFile` 将来若改零拷贝视图同理。⚠️ 类型陷阱：TS 的 `BlobPart` 要求 `ArrayBufferView<ArrayBuffer>`，而 `Uint8Array.buffer` 是 `ArrayBufferLike`（可能 `SharedArrayBuffer`）→ 直接 `new Blob([bytes])` 报 TS2322；**helper 内的 `as unknown as BlobPart` 是必要断言，不是偷懒**。执法：`wasm-decode-blob-view.test.ts` 用**错位 subarray**（底层前后各 8 字节 0xAA 哨兵）驱动生产路径，三例全红于 `.buffer` 变异（已实测）；KTX2 侧另由 `mmd-ktx2-encoder.test.ts`「img.data 为 subarray 视图」例覆盖（含 transfer 与被送 payload 同一性断言）
- **解码读取链已升格为「字节直读」**（ADR-228）：`decoder/wasm-decode.ts` **不再接触 base64**——`InflightCtx.ReadBytes: (path) => Promise<Uint8Array | null>` 替代原 `ReadFileBytes`（base64 字符串契约），入口与三处子文件读取（avatar / model / tex）统一走 `backend/read-model-bytes.ts|readModelBytes`。**平台分叉只在该 seam 内存在**：网页版走 `web-fs-read.ts|readWebFileArrayBuffer`（IndexedDB `ArrayBuffer` **零拷贝视图**直出，省掉 base64 往返 ≈4.3N）；桌面 / Android 仍走 `getApp().ReadFileBytes` + `base64ToBytes`（Wails 传输只有 JSON，这层躲不掉）。**不改 Wails binding 契约**（`readModelBytes` 不进 `browserAdapter`——`webImpls` 是 `satisfies Partial<GoBindingShape>`，且不该为纯前端优化动 binding 契约），故 `generate:bindings` / Android 桥 / 桌面行为全不变
- **解码拷贝链实测口径与前提更正**（2026-09 专项调研，V8 13.6 / N=64MB 实测）：L1 base64 串(1.33N) + L2 `atob` 串(1.0N) + L3 `charCodeAt` 拷贝(1.0N) + `HEAPU8.set`(1.0N) = **4.33N**——「3-4×」是 **N_in 口径的下界**，尚未计 C++ 内部 `m_buffer`/`m_binaryData`/`m_decrypted`（各 ~N_in）与输出侧 N_out（.ysm 是压缩格式，N_out 可能显著大于 N_in）。前提更正：① **MEMFS 的 `node.contents` 是 JS 侧数组、不在 WASM 线性内存**（Emscripten 的 MEMFS 是 JS 实现）；② `atob` 产出 **Latin-1 one-byte string（1 字节/字符）**，非 UTF-16 的 2 字节；③ `new Uint8Array(arrayBuffer)` 是**视图（别名）**非拷贝——拷贝须用 `new Uint8Array(typedArray)`。已落地的优化：审查 C-1（`sniffTexSize` 复用 `f.data` 免每张纹理整拷贝 −N_tex、内存直解路径补 MEMFS 收集后清理）+ **ADR-228 网页版消除 base64 往返**。⚠️ **比峰值更隐蔽的风险：WASM 线性内存只增不减**（上限 2GB），HEAP 高位常驻整个应用生命周期。**已排除路线**（勿重复论证）：Go binding 直接返回 ArrayBuffer（Wails 传输只有 JSON）、分块流式喂解析器（`YSMParserFactory::Create` 要求完整缓冲）、Web Worker 降峰值（dedicated worker 与页面同渲染进程，只改卡顿不改内存）、**桌面资产服务器二进制路由**（2026-09 核实：机制可行但 ROI 太小——桌面这条链一次性开销仅 50MB≈0.13–0.17s / 100MB≈0.29–0.35s，且桌面已被 `large-model` 排除在内存告警外；详见锐评卡刀⑭ 的证据链）。另**桌面「改 Go 优先让 4.33N 归零」亦不成立**：Go 的 `.ysm` 路径（`runYSMParserOnFile` → `decodeYSMViaNodeJS`）不产出内嵌动画，且 `authors`/`avatars` 依赖 WASM 结果，改排序会三样齐丢
- **纹理键集合单一事实源 = `mesh.ts` `ALL_TEXTURE_KEYS`**：`scene-stats.ts` 统计与 `mesh.ts` `disposeMaterial` 释放共用同一常量（`map` / `emissiveMap` / `normalMap` / `roughnessMap` / `metalnessMap` / `aoMap` / `lightMap` / `alphaMap` / `envMap`），禁止双源漂移——新增纹理槽位须同时更新 `ALL_TEXTURE_KEYS` 与所有消费者
- **`scene.environment` 写者唯一 = `EnvironmentCapability`**（ADR-292 D1，回归红线）：`SkyCapability` **保留烘焙能力但降级为数据源**——`bakeEnvironmentTexture(opts?: { force })` 只「烤」并返回纹理、**不写槽位**；装载由 env 决定。收口前 sky 的 `regenerateEnvironment()` 与 env cap 都写该槽位、互不知晓、后写者赢（UI 上两个开关都「开」却只有一个生效）。**运行期让渡判定 = `environment-ownership.ts|envShouldYieldSlot`**（问「**env cap 在场且启用吗**」——**不问来源**；sky 侧 3 处 + `light-capability.ts|refreshAmbientFromSky` 共 4 处手抄已归零）：真则转交 `env.refreshFromSkySource()` 不写槽位，假（env 缺席/关闭）才走 sky 自持兜底装载，那条路才受退役键 `skyEnvironment` 门控。⚠️ **勿把 `env.loadsFromSkySource()`（旧名 `isSkySourced`）当让权判据**——它是**通路自省**（「本 cap 此刻是否经天空通路装载」），答不了让权问题：默认 `envSource="preset"` 下它会答「否」而让 sky 顶掉 env 预设图，正是 `ce0ec8090` 修掉的原病灶；改名即为此（判别样本见 `preview-env-state.md` 不变量条）。**纹理所有权**：sky 来源的纹理归 sky 的 renderTarget 持有，env 的 `pmremToSceneEnv` **不得 dispose** 它（守卫字段 `skySourcedTex`），否则会释放掉天空的烘焙产物。`force` 语义：结构性变更（来源/预设/分辨率切换）传 `true` 取当前帧图；连续动画（昼夜循环）不传，走 `PMREM_ELEVATION_THRESHOLD` 门控以守住防 GPU 熔炉的历史防线。
  **机器闸（锐评 2026-10-11 P1-① 补齐）**：本条红线原只有散文 + 行为测试（防「改坏既有路径」，不防「新写者出现」）——现 `scripts/check-scene-slot-writers.ts` 把槽位赋值锁死在白名单内（`env-ibl.ts` 唯一写者 / `sky-capability.ts` 自持兜底 + dispose 对称守卫 / `shared-infra.ts` 初始化 Color / `screenshot.ts` 截图保存还原 / 测试夹具；白名单外赋值即红），挂 `gate-config` ALL_STATIC_TOOLS **hard 档**（零存量债），登记 `scripts/README.md`；扩白名单须先经锐评/ADR 拍板（WHITELIST 段注释即拍板记录）。`scene.background` 同闸共管。

## 相关

- `frontend/src/preview-3d/` — 全部 3D 渲染工具
- `frontend/src/preview-3d/adapters/ysm-model-preloader.ts` — 模型加载入口（ADR-270-d5 自 views 迁入）
- `frontend/src/views/app-preview/skeleton.ts` — 2D 预览 + 3D 升级
- 知识卡：`preview-core`、`3d_patterns`、`export`、`vmd-vrm-retarget`
- ADR-129（3D 渲染层升格）、ADR-178（能力接口拆分）、ADR-101（纹理缓存 + release 模式）、ADR-136（纹理加载器归位）、ADR-309（VRM 播 VMD 播放语义收口）

---

## 符号索引

> 本卡目录级宽认领（`frontend/src/preview-3d/` 全层）符号已按 [ADR-338-d2](../adr/decisions/ADR-338-d2-broad-claim-auto-fields.md) **封顶**：frontmatter 只保留前 99 条 + 块末 `symbols_total: N` 全量计数（单一事实源 = 源码 grep，本卡不重复存全量清单）。拆卡（infra/caps/mmd-adapter 三域）是终局，排期见 d2 §决策 3。
