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
import { previewPixelRatio } from "@/preview-3d/infra/render-budget.ts";
import type { PreviewMenuHandle } from "@/preview-3d/menu/core.ts";
import { applyPerfPreset, getPerfPreset } from "@/preview-3d/state/perf-presets.ts";
// [ADR-168] 状态层 cap 查询器注入：组合根 createAll 后注入 registry，断 preview-state→registry 运行时环
import { setSceneCapabilityLookup } from "@/preview-3d/state/preview-state.ts";
import type { PreviewAdapter } from "./mount-preview-core.ts";
import type { PostprocessingLike } from "./postprocessing.ts";

/**
 * 装配链——按模型类别套用预设（ADR-196）。
 * MODEL_DEFAULTS 驱动的单个入口：把 6 个预 apply cap 的模型预设套用统一编排，
 * 逐字复刻原 7 个散落 `cap.setPreset(adapter.id)` 的调用顺序（sky→light→fog→shadow→
 * reflector→environment）与各 cap 内部守卫（shadow/reflector 的 isStateLoaded、
 * light 的 manual 双入口原样保留在 cap 内，此处不越权）。未知 modelType 由各 cap
 * 内部 `?? MODEL_DEFAULTS.default` 回落，语义与现状一致。
 */
export function applyModelDefaults(
  modelType: string,
  deps: {
    sky?: SkyCapability | null;
    light?: LightCapability | null;
    fog?: FogCapability | null;
    shadow?: ShadowCapability | null;
    reflector?: ReflectorCapability | null;
    environment?: EnvironmentCapability | null;
  },
): void {
  deps.sky?.applyModelPreset(modelType);
  deps.light?.applyModelPreset(modelType);
  deps.fog?.applyModelPreset(modelType);
  deps.shadow?.applyModelPreset(modelType);
  deps.reflector?.applyModelPreset(modelType);
  deps.environment?.applyModelPreset(modelType);
}

/**
 * 装配链——post-apply 后处理模型预设（ADR-196）。
 * 须跑在 `for(cap)cap.apply()` + `syncShadowLights` 之后、`setReflectorCap` 之前
 * （composer / SSR↔reflector 联动时序）。postproc per-type enabled 不入 schema，
 * 读自家 POSTPROC_PRESETS，由 cap 内 applyPostProcDefaults 完成翻转 + composer 侧效。
 */
export function applyPostProcDefaults(
  postProcCap: PostprocessingCapability | null,
  modelType: string,
): void {
  postProcCap?.applyPostProcDefaults(modelType);
}

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
 * 设计边界：WebGLRenderer/scene/camera/controls 跨 session **复用**（单 WebGL context，
 * 避免重建黑屏——性能取舍，非缺陷），故本宿主为**单例实例**（sceneInfraHost），但状态
 * 均为实例字段，不再散落模块级 let；未来 PreviewSession 组合时只需持有 host 引用。
 * 生命周期：reset = session 级（保留 renderer 复用）；teardown = 应用终点（全量释放 +
 * forceContextLoss）。
 */
export class SceneInfraHost {
  /** 共享 scene（所有模型共用一个 scene，不同格式模型叠加在同一 WebGL context） */
  scene: THREE.Scene | null = null;
  /** 共享 camera / renderer / controls（第一次 mount3D 创建，后续复用） */
  camera: THREE.PerspectiveCamera | null = null;
  renderer: THREE.WebGLRenderer | null = null;
  controls: OrbitControls | null = null;
  /** 程序化能力列表（注册表统一创建），供 rAF 循环逐帧调用 update（水面波纹/弹簧骨骼等）。
   *  shared 模式下 caps 由 buildSharedInfra 单次填充，render loop 直接遍历，避免逐能力硬编码。 */
  caps: SceneCapability[] = [];
  /** unload 钩子是否已安装（惰性一次性，首次 buildSharedInfra 时注册） */
  unloadHookInstalled = false;

  /** 置空场景级单例（cleanupPreview / _resetSingletons 调用；renderer/canvas 保留语义由调用方承担）。
   *  P0 修复：单例归零前主动遍历 scene 树释放 geometry/material GPU 资源——否则后续 session
   *  的闭包可能引用已离但 GPU 未释放的旧 scene 子树（跨 session 资源泄漏）。纹理归 textureCache
   *  引用计数管，不在此释放（防双重释放打穿计数）。 */
  reset(): void {
    if (this.scene) {
      disposeSceneObjectResources(this.scene);
    }
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
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
      // dispose 后强制释放上下文，避免延迟到 GC（对齐 screenshot-render.ts P3 修复）
      (r as unknown as { forceContextLoss?: () => void }).forceContextLoss?.();
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
    sceneInfraHost.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    sceneInfraHost.renderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    sceneInfraHost.renderer.setPixelRatio(previewPixelRatio(window.devicePixelRatio));
    sceneInfraHost.renderer.domElement.style.touchAction = "none";
    viewContainer.appendChild(sceneInfraHost.renderer.domElement);
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
  // 单个 applyModelDefaults 入口编排 6 个预 apply cap，逐字复刻原 setPreset 顺序与守卫
  applyModelDefaults(adapter.id, {
    sky: skyCap,
    light: lightCap,
    fog: fogCap,
    shadow: shadowCap,
    reflector: reflectorCap,
    environment: environmentCap,
  });
  // 全部挂入场景
  for (const cap of caps) cap.apply();
  // ShadowCapability 同步：光 castShadow（光已由 LightCapability 创建）
  if (shadowCap && lightCap) syncShadowLights(scene, shadowCap, lightCap);
  // 后处理体积光管线（ADR-081 L2）：PostprocessingCapability（registry 驱动）
  const postProcCap = sceneCapabilityRegistry.getById("postprocessing") ?? null;
  // 兼容老接口：postProc 变量也指向同一 capability（对外 render/setSize/dispose 方法签名一致）
  const postProc = postProcCap;
  // 按模型类别套用预设（post-apply，须在 apply/syncShadowLights 之后、setReflectorCap 之前）
  applyPostProcDefaults(postProcCap, adapter.id);
  // SSR↔Reflector 联动（postprocessing-capability.setReflectorCap）：SSR 开启时自动禁用单平面镜面，防 z-fighting
  postProcCap?.setReflectorCap(reflectorCap);
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

/** syncShadowLights：ShadowCapability 同步光 castShadow（优先 setLightCap 精准注入 3 方向灯+聚光灯；
 *  再 scene.traverse 收集外部自定义灯走 syncLights 兜底），防误吞外部灯 */
function syncShadowLights(
  scene: THREE.Scene,
  shadowCap: ShadowCapability,
  lightCap: LightCapability,
): void {
  shadowCap.setLightCap(lightCap);
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
