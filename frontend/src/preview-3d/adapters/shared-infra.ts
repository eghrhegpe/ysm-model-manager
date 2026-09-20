// ===== 3D 预览共享基础设施（从 mount-preview-core.ts §5 抽出）=====
// 持有场景级复用单例（scene/camera/renderer/OrbitControls + 程序化能力列表 + unload 钩子标志），
// 由 SceneInfraHost 实例收拢；buildSharedInfra 一次性装配，cleanup/重置经导出门面收敛——
// mount-preview-core 不再直接读写这些变量。
//
// [ADR-227 P1 战役] 原模块级 let 集群（_singletonScene/_singletonCamera/_singletonRenderer/
// _singletonControls/_sceneCaps/_unloadHookInstalled）收敛为 SceneInfraHost 实例字段——
// 与兄弟会话 A1（_globalPause → createPerceptionPauseRef）同一步伐、与 RendererHost 同构。
// 对外具名导出（buildSharedInfra/resetSceneInfra/clearSceneCaps/getSceneCaps/teardownSharedInfra）
// 签名零变更，消费方（mount-preview-core/mount-session/render-host/测试）零改动。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { EnvironmentCapability } from "@/preview-3d/caps/environment-capability.ts";
import type { FogCapability } from "@/preview-3d/caps/fog-capability.ts";
import type { GroundCapability } from "@/preview-3d/caps/ground-capability.ts";
import type { LightCapability } from "@/preview-3d/caps/light-capability.ts";
import type { PostprocessingCapability } from "@/preview-3d/caps/postprocessing-capability.ts";
import type { ReflectorCapability } from "@/preview-3d/caps/reflector-capability.ts";
import type { SceneCapability } from "@/preview-3d/caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import type { ShadowCapability } from "@/preview-3d/caps/shadow-capability.ts";
import type { SkyCapability } from "@/preview-3d/caps/sky-capability.ts";
import type { WaterCapability } from "@/preview-3d/caps/water-capability.ts";
import type { PostprocessingLike } from "@/preview-3d/infra/postprocessing.ts";
import { previewPixelRatio } from "@/preview-3d/infra/render-budget.ts";
import type { PreviewMenuHandle } from "@/preview-3d/menu/engine/core.ts";
import { type ModelType, toModelType } from "@/preview-3d/state/model-defaults.ts";
import { applyPerfPreset, getPerfPreset } from "@/preview-3d/state/perf-presets.ts";
// [ADR-168] 状态层 cap 查询器注入：组合根 createAll 后注入 registry，断 preview-state→registry 运行时环
import { setSceneCapabilityLookup } from "@/preview-3d/state/preview-state.ts";
import type { PreviewAdapter } from "./mount-preview-core.ts";

/**
 * 装配链——按模型类别套用预设（ADR-196）。
 * MODEL_DEFAULTS 驱动的单个入口：把 5 个预 apply cap 的模型预设套用统一编排，
 * 逐字复刻原 7 个散落 `cap.setPreset(adapter.id)` 的调用顺序（sky→fog→shadow→
 * reflector→environment）与各 cap 内部守卫（shadow/reflector 的 isStateLoaded）。
 * [ADR-282] light 已退出本链：灯光与模型类别解耦（见下方调用点注释）。
 *
 * 脏数据防御：runtime 入口（reflector/sky 的 loadState）统一经 toModelType 校验
 * （Object.hasOwn 自身属性判定，防原型链误判）；
 * 本函数调用点（buildSharedInfra）传 adapter.id 来自 RESOURCE_TYPES 已知集合，
 * 不经 toModelType——保持装配期与 runtime 恢复的入口分工。
 */
export function applyModelDefaults(
  modelType: ModelType,
  deps: {
    sky?: SkyCapability | null;
    fog?: FogCapability | null;
    shadow?: ShadowCapability | null;
    reflector?: ReflectorCapability | null;
    environment?: EnvironmentCapability | null;
  },
): void {
  deps.sky?.applyModelPreset(modelType);
  // [ADR-282] light 不再预 apply：灯光与模型类别解耦（灯光是场景属性，
  // Three.js 层面无「模型类别」；唯一模型相关输入是包围盒，已由 setTarget/setTargetHeight
  // 动态处理）。用户想回默认值走 LightCapability.resetLightParams() 显式重置。
  deps.fog?.applyModelPreset(modelType);
  deps.shadow?.applyModelPreset(modelType);
  deps.reflector?.applyModelPreset(modelType);
  deps.environment?.applyModelPreset(modelType);
}

/**
 * 装配链——[ADR-250] 原 `applyPostProcDefaults` 已删除。
 *
 * 它按模型类别写 cap 私有门禁（`perTypeGate`），导致：①模型类别伸进 cap 内部（职责越界）；
 * ②门禁翻转触发 composer 整组重建（配置缓存失效）；③与总闸二元相与造成「一枚字段三重语义」。
 * 「默认是否开后处理」现由 `MODEL_DEFAULTS` 写 `ppEnabled` 状态参数表达，
 * 随 `applyModelDefaults` 的既定路径生效，无需独立的后处理装配钩子。
 */

/**
 * 遍历 scene 树释放 geometry/material GPU 资源 + 清空场景。
 * SceneInfraHost.reset / teardown 共用（code_review ece0d4a4 #6：原两处逐字
 * 重复 ~13 行，防单侧演化漂移——未来若补 texture/light 处理只改此处）。
 * 纹理归 textureCache 引用计数管，不在此释放（防双重释放打穿计数）。
 */
function disposeSceneObjectResources(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      const mat = mesh.material;
      // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }
  });
  scene.clear();
}

/**
 * 共享基础设施宿主（[ADR-227] P1 单例收敛：原模块级 let 集群 → 实例字段）。
 *
 * 设计边界：WebGLRenderer 跨 session **复用**（单 WebGL context，避免重建黑屏——性能取舍，
 * 非缺陷）；scene / camera / controls 每 session 重建（各适配器每次 mount 由
 * fitCameraToScene / fitCameraToRoots 重新取景）。故本宿主为**单例实例**
 * （sceneInfraHost），但状态均为实例字段，不再散落模块级 let；未来 PreviewSession 组合时
 * 只需持有 host 引用。
 * 生命周期：reset = session 级（保留 renderer 复用）；teardown = 应用终点（全量释放 +
 * forceContextLoss）。
 */
export class SceneInfraHost {
  /** 共享 scene（所有模型共用一个 scene，不同格式模型叠加在同一 WebGL context） */
  scene: THREE.Scene | null = null;
  /** renderer 跨 session 复用（唯一 WebGL context，ADR-227）；camera/controls 每 session 重建 */
  camera: THREE.PerspectiveCamera | null = null;
  renderer: THREE.WebGLRenderer | null = null;
  controls: OrbitControls | null = null;
  /** 程序化能力列表（注册表统一创建），供 rAF 循环逐帧调用 update（水面波纹/弹簧骨骼等）。
   *  shared 模式下 caps 由 buildSharedInfra 单次填充，render loop 直接遍历，避免逐能力硬编码。 */
  caps: SceneCapability[] = [];
  /** unload 钩子是否已安装（惰性一次性，首次 buildSharedInfra 时注册） */
  unloadHookInstalled = false;

  /** 置空场景级单例（cleanupPreview / _resetSingletons 调用）。
   *  P0 修复①：归零前主动遍历 scene 树释放 geometry/material GPU 资源——否则后续 session
   *  的闭包可能引用已离但 GPU 未释放的旧 scene 子树（跨 session 资源泄漏）。纹理归 textureCache
   *  引用计数管，不在此释放（防双重释放打穿计数）。
   *  P0 修复②：renderer 保留（唯一 WebGL context 跨 session 复用，ADR-227）；camera/controls
   *  按 session 重建（fitCameraToScene 每次 mount 重新取景，且 controls 须 dispose 摘监听器）。 */
  reset(): void {
    if (this.scene) {
      disposeSceneObjectResources(this.scene);
    }
    this.scene = null;
    // [P0 修复] 仅 renderer 跨 session 复用（ADR-227 硬约束：WebGL context 数量有上限）。
    // 旧实现 reset 把 renderer 置 null 却从不 dispose → 每次「关预览→再开」泄漏一个 WebGL
    // context，累积到浏览器上限后新建 renderer 拿不到 context（黑屏）。
    // 内容层 geometry/material 已在上方释放；纹理归 textureCache 引用计数管，不在本处释放
    // （防双重释放打穿计数）。确要彻底释放走 teardown()。
    //
    // camera/controls 仍按 session 重建（不保留）：真实适配器每次 mount 都由
    // fitCameraToScene / fitCameraToRoots 重新取景（ysm-adapter / unload-model / switch-preview），
    // 复用相机没有额外收益，反而让上一会话的机位/朝向跨会话残留。
    //
    // 但 renderer 的 canvas 现在跨会话存活 → controls 必须 dispose 才能摘掉绑在
    // renderer.domElement 上的监听器（旧实现每次换新 canvas，监听器随旧 canvas 一并被丢弃，
    // 故此前漏掉 dispose 也不会累积）。
    if (this.controls) {
      // 防御：测试替身 OrbitControls 可能未实现 dispose（真实 OrbitControls 必有）
      if (typeof this.controls.dispose === "function") this.controls.dispose();
      this.controls = null;
    }
    this.camera = null;
  }

  // ===== 终局拆除（code review #1）=====
  // 复用单例避免黑屏是合理取舍，但此前全应用没有任何最终拆除路径——WebGL context、
  // canvas、OrbitControls 监听器永久驻留。此方法在应用 unload 时走一次完整释放
  // （dispose 范式对齐 screenshot-render.ts finally 段），仅兜应用生命周期终点，
  // 不参与 session 级 cleanup（后者继续走 reset 保留 renderer 复用语义）。
  // 注意：纹理归 textureCache LRU 引用计数管，此处只释放 geometry/material，
  // 不碰 texture.dispose（防双重释放打穿引用计数）。

  /** 终局拆除：释放 caps → controls → scene 树 geometry/material → renderer + WebGL context。
   *  幂等：单例为 null 时各段自动跳过，可安全重复调用。 */
  teardown(): void {
    sceneCapabilityRegistry.dispose();
    this.clearCaps();
    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }
    if (this.scene) {
      disposeSceneObjectResources(this.scene);
      this.scene = null;
    }
    this.camera = null;
    if (this.renderer) {
      const r = this.renderer;
      r.dispose();
      r.forceContextLoss?.();
      r.domElement.remove();
      this.renderer = null;
    }
    // 重置 unload 钩子标志——下次 buildSharedInfra 可重新注册 beforeunload listener
    this.unloadHookInstalled = false;
  }

  /** 安装应用 unload 终局拆除钩子（首次 buildSharedInfra 调用；once 语义） */
  installUnloadTeardown(): void {
    if (this.unloadHookInstalled) return;
    this.unloadHookInstalled = true;
    window.addEventListener("beforeunload", () => this.teardown(), { once: true });
  }

  /** 清空程序化能力列表（fullCleanup 调用；saveAll/dispose 已由调用方先行执行） */
  clearCaps(): void {
    this.caps.length = 0;
  }

  /** rAF 循环遍历用（返回同一数组引用，遍历语义与原模块级变量一致） */
  getCaps(): readonly SceneCapability[] {
    return this.caps;
  }
}

/** 全局唯一共享基础设施宿主（scene/camera/renderer/controls 跨 session 复用，单 host 合理） */
export const sceneInfraHost = new SceneInfraHost();

/** 置空场景级单例门面（cleanupPreview / _resetSingletons；实际逻辑见 SceneInfraHost.reset） */
export function resetSceneInfra(): void {
  sceneInfraHost.reset();
}

/** 终局拆除门面（应用 unload / 测试用；实际逻辑见 SceneInfraHost.teardown） */
export function teardownSharedInfra(): void {
  sceneInfraHost.teardown();
}

/** 清空程序化能力列表门面（fullCleanup 调用；实际逻辑见 SceneInfraHost.clearCaps） */
export function clearSceneCaps(): void {
  sceneInfraHost.clearCaps();
}

/** rAF 循环遍历用门面（实际逻辑见 SceneInfraHost.getCaps） */
export function getSceneCaps(): readonly SceneCapability[] {
  return sceneInfraHost.getCaps();
}

/** buildSharedInfra 返回的 shared 基础设施 + 程序化能力引用（mount3D 赋值给会话局部变量） */
export interface SharedInfra {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  orbitTarget: THREE.Vector3;
  skyCap: SkyCapability | null;
  groundCap: GroundCapability | null;
  waterCap: WaterCapability | null;
  lightCap: LightCapability | null;
  fogCap: FogCapability | null;
  shadowCap: ShadowCapability | null;
  reflectorCap: ReflectorCapability | null;
  environmentCap: EnvironmentCapability | null;
  postProc: PostprocessingLike | null;
  postProcCap: PostprocessingCapability | null;
}

/** buildSharedInfra：shared 模式基础设施 + 程序化能力装配（scene/camera/renderer/OrbitControls 单例复用 + caps 创建/preset/Shadow/postProc 联动）。
 *  返回带出的局部引用，mount3D 仅赋值给会话变量；self 模式走适配器自驱，不走本函数。 */
export function buildSharedInfra(
  adapter: PreviewAdapter,
  viewContainer: HTMLElement,
  menuHandle: PreviewMenuHandle,
): SharedInfra {
  // 首次装配时安装应用 unload 终局拆除钩子（code review #1，惰性一次性）
  sceneInfraHost.installUnloadTeardown();
  // 复用单例 scene（多模型共享同一场景）
  if (!sceneInfraHost.scene) {
    sceneInfraHost.scene = new THREE.Scene();
    sceneInfraHost.scene.background = new THREE.Color("#171820");
  }
  const scene = sceneInfraHost.scene;
  // 复用单例 camera（多模型共用同一相机，controls 控制同一套）
  const ar = viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1);
  if (!sceneInfraHost.camera) {
    sceneInfraHost.camera = new THREE.PerspectiveCamera(50, ar, 0.05, 5000);
  } else {
    sceneInfraHost.camera.aspect = ar;
    sceneInfraHost.camera.updateProjectionMatrix();
  }
  const camera = sceneInfraHost.camera;
  // 复用单例 renderer（唯一 WebGL context）
  if (!sceneInfraHost.renderer) {
    // [P1 修复] `alpha: true` 是「透明背景截图」的前置条件：three 默认 `alpha: false`
    //（r185 WebGLRenderer.js:77）→ 画布无 α 通道，`screenshot.ts` 即便把清屏色置全透明、
    // 把 scene.background 置 null 也仍拿不到透明像素。开启后预览观感不变
    //（场景 background 是不透明 #171820，见下方场景创建），只让截图期的透明捕获生效。
    sceneInfraHost.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    sceneInfraHost.renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    sceneInfraHost.renderer.setPixelRatio(previewPixelRatio(window.devicePixelRatio));
    sceneInfraHost.renderer.domElement.style.touchAction = "none";
    viewContainer.appendChild(sceneInfraHost.renderer.domElement);
  } else {
    // [P0 联动·P2 修复] renderer 跨 session 复用，须每次重新对齐像素比与画布尺寸——
    // 否则自适应降采样把 pixelRatio 钉在低档后，关预览→再开仍停低分辨率（render-host
    // 的 budget 已复位 1.5，但 renderer 停在 0.75，二者脱钩）。同时重建场景下相机/控制
    // 已复用，renderer 也须把尺寸对齐新容器。
    sceneInfraHost.renderer.setPixelRatio(previewPixelRatio(window.devicePixelRatio));
    sceneInfraHost.renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    if (sceneInfraHost.renderer.domElement.parentNode !== viewContainer) {
      viewContainer.appendChild(sceneInfraHost.renderer.domElement);
    }
  }
  const renderer = sceneInfraHost.renderer;
  // 修复：fullCleanup（ESC/关闭按钮）会移除旧 viewContainer（连同 canvas），但
  // 保留 renderer——再次 mount3D 复用 renderer 时若不重新挂载 canvas，
  // 渲染循环照常跑但 canvas 已脱离 DOM → 用户「第二次进 3D 预览」看到空白/无反应。
  if (renderer.domElement.parentNode !== viewContainer) {
    viewContainer.appendChild(renderer.domElement);
  }
  // 程序化能力（ADR-073 L1 + 统一注册表）：由 registry 统一创建并持久化
  const caps = sceneCapabilityRegistry.createAll({ scene, renderer, camera });
  // [ADR-168] 状态层查询器注入（registry 单例长命，instances 由 createAll/dispose 管理——行为与状态层直持同一引用等价）
  setSceneCapabilityLookup(sceneCapabilityRegistry);
  sceneInfraHost.caps = caps;
  const skyCap = sceneCapabilityRegistry.getById("sky") ?? null;
  const groundCap = sceneCapabilityRegistry.getById("ground") ?? null;
  const waterCap = sceneCapabilityRegistry.getById("water") ?? null;
  const lightCap = sceneCapabilityRegistry.getById("light") ?? null;
  const fogCap = sceneCapabilityRegistry.getById("fog") ?? null;
  const shadowCap = sceneCapabilityRegistry.getById("shadow") ?? null;
  const reflectorCap = sceneCapabilityRegistry.getById("reflector") ?? null;
  const environmentCap = sceneCapabilityRegistry.getById("environment") ?? null;
  // 从 localStorage 恢复上次会话状态
  sceneCapabilityRegistry.loadAll();
  // 按模型类别套用预设（已有持久化状态的 cap 不覆盖）——ADR-196 装配链收敛：
  // 单个 applyModelDefaults 入口编排 5 个预 apply cap（light 已据 ADR-282 退出本链），
  // 逐字复刻原 setPreset 顺序与守卫
  // adapter.id 是运行时字符串（来自 RESOURCE_TYPES 联合），经 toModelType 校验收窄
  // （未知值回退 "default"，不再裸 cast）
  applyModelDefaults(toModelType(adapter.id), {
    sky: skyCap,
    fog: fogCap,
    shadow: shadowCap,
    reflector: reflectorCap,
    environment: environmentCap,
  });
  // 全部挂入场景
  for (const cap of caps) cap.apply();
  // ShadowCapability 同步：光 castShadow（light 联动走构造注入的查询器；此处收外部自定义灯兜底）
  if (shadowCap) syncShadowLights(scene, shadowCap);
  // 后处理体积光管线（ADR-081 L2）：PostprocessingCapability（registry 驱动）
  const postProcCap = sceneCapabilityRegistry.getById("postprocessing") ?? null;
  // 兼容老接口：postProc 变量也指向同一 capability（对外 render/setSize/dispose 方法签名一致）
  const postProc = postProcCap;
  // [ADR-250] 后处理 per-type 默认：原 `applyPostProcDefaults`（写 cap 私有门禁）已删除，
  // 现与六 cap 同构——读 MODEL_DEFAULTS 的 `ppEnabled` 写状态参数（post-apply，composer 时序无约束）。
  // 未走上方 applyModelDefaults 是因该函数签名只收六 cap（属地接口不扩张），此处单独一行更显式。
  postProc?.applyModelPreset(adapter.id);
  // SSR↔Reflector 联动已前端化（postprocessing-capability 构造注入 caps 查询器，
  // applyReflectorSync 经 getTypedCap 现场取 reflector——不再需要此处手工接线）
  // 性能档位（薄壳版，perf-presets.ts 数据表驱动）：用户显式档位最后套用，覆盖模型预设的性能项
  // （fps / 分辨率 / Bloom）；cap 缺席的派生路径 setStateValue 静默跳过，无副作用
  applyPerfPreset(getPerfPreset());
  // ADR-085 S3：caps 创建后触发 refreshDock()，修复 litematic/pack 的 environment 项时序缺失
  // （菜单先于 caps 挂载，挂载时 env.skyGroundCap 谓词为 false 被过滤；此处 lookup 已注入、
  // 谓词重求值为 true，重渲染补回——requiresEnvironment 谓词化后同一机制原样生效）
  menuHandle.refreshDock();
  // 复用单例 controls（多模型共用同一套相机控制）
  if (!sceneInfraHost.controls) {
    sceneInfraHost.controls = new OrbitControls(camera, renderer.domElement);
    sceneInfraHost.controls.enableDamping = true;
    sceneInfraHost.controls.dampingFactor = 0.1;
    sceneInfraHost.controls.minDistance = 0.1;
    sceneInfraHost.controls.maxDistance = 5000;
    sceneInfraHost.controls.update();
    sceneInfraHost.controls.enableRotate = true;
  }
  const controls = sceneInfraHost.controls;
  // orbitTarget 是本次 mount 的会话局部变量：复用单例 controls（非首次）时不进上面的 if，
  // 但必须每次从当前 controls 目标刷新，否则下方 orbitTarget!.copy 读到 undefined。
  const orbitTarget = controls.target.clone();
  return {
    scene,
    camera,
    renderer,
    controls,
    orbitTarget,
    skyCap,
    groundCap,
    waterCap,
    lightCap,
    fogCap,
    shadowCap,
    reflectorCap,
    environmentCap,
    postProc,
    postProcCap,
  };
}

/** syncShadowLights：ShadowCapability 同步光 castShadow（light 联动已走构造注入的 caps
 *  查询器——createAll 时查询即就绪；此处仅 scene.traverse 收集外部自定义灯走 syncLights 兜底）*/
function syncShadowLights(scene: THREE.Scene, shadowCap: ShadowCapability): void {
  const lights: Array<THREE.DirectionalLight | THREE.SpotLight> = [];
  scene.traverse((obj) => {
    if (
      (obj as unknown as THREE.DirectionalLight).isDirectionalLight ||
      (obj as unknown as THREE.SpotLight).isSpotLight
    ) {
      lights.push(obj as THREE.DirectionalLight | THREE.SpotLight);
    }
  });
  shadowCap.syncLights(lights);
}
