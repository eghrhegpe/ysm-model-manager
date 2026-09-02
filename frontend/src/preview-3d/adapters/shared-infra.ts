// ===== 3D 预览共享基础设施（从 mount-preview-core.ts §5 抽出）=====
// 持有场景级单例（scene/camera/renderer/OrbitControls + 程序化能力列表），
// 由 buildSharedInfra 一次性装配；cleanup/重置经导出访问器收敛——
// mount-preview-core 不再直接读写这些单例变量。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { EnvironmentCapability } from "../caps/environment-capability.ts";
import type { FogCapability } from "../caps/fog-capability.ts";
import type { GroundCapability } from "../caps/ground-capability.ts";
import type { LightCapability } from "../caps/light-capability.ts";
import type { PostprocessingCapability } from "../caps/postprocessing-capability.ts";
import type { ReflectorCapability } from "../caps/reflector-capability.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { ShadowCapability } from "../caps/shadow-capability.ts";
import type { SkyCapability } from "../caps/sky-capability.ts";
import type { WaterCapability } from "../caps/water-capability.ts";
import type { PreviewMenuHandle } from "../menu/core.ts";
import { previewPixelRatio } from "../render-budget.ts";
import { applyPerfPreset, getPerfPreset } from "../state/perf-presets.ts";
import type { PreviewAdapter } from "./mount-preview-core.ts";
import type { PostprocessingLike } from "./postprocessing.ts";

/** 共享 scene（所有模型共用一个 scene，不同格式模型叠加在同一 WebGL context） */
let _singletonScene: THREE.Scene | null = null;
/** 共享 camera / renderer / controls（第一次 mount3D 创建，后续复用） */
let _singletonCamera: THREE.PerspectiveCamera | null = null;
let _singletonRenderer: THREE.WebGLRenderer | null = null;
let _singletonControls: OrbitControls | null = null;
/** 程序化能力列表（注册表统一创建），供 rAF 循环逐帧调用 update（水面波纹/弹簧骨骼等）。
 *  shared 模式下 caps 由 buildSharedInfra 单次填充，render loop 直接遍历，避免逐能力硬编码。 */
let _sceneCaps: SceneCapability[] = [];

/** 置空场景级单例（cleanupPreview / _resetSingletons 调用；renderer/canvas 保留语义由调用方承担） */
export function resetSceneInfra(): void {
  _singletonScene = null;
  _singletonCamera = null;
  _singletonRenderer = null;
  _singletonControls = null;
}

/** 清空程序化能力列表（fullCleanup 调用；saveAll/dispose 已由调用方先行执行） */
export function clearSceneCaps(): void {
  _sceneCaps.length = 0;
}

/** rAF 循环遍历用（返回同一数组引用，遍历语义与原模块级变量一致） */
export function getSceneCaps(): readonly SceneCapability[] {
  return _sceneCaps;
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
  // 复用单例 scene（多模型共享同一场景）
  if (!_singletonScene) {
    _singletonScene = new THREE.Scene();
    _singletonScene.background = new THREE.Color("#171820");
  }
  const scene = _singletonScene;
  // 复用单例 camera（多模型共用同一相机，controls 控制同一套）
  const ar = viewContainer.clientWidth / Math.max(viewContainer.clientHeight, 1);
  if (!_singletonCamera) {
    _singletonCamera = new THREE.PerspectiveCamera(50, ar, 0.05, 5000);
  } else {
    _singletonCamera.aspect = ar;
    _singletonCamera.updateProjectionMatrix();
  }
  const camera = _singletonCamera;
  // 复用单例 renderer（唯一 WebGL context）
  if (!_singletonRenderer) {
    _singletonRenderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    _singletonRenderer.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
    _singletonRenderer.setPixelRatio(previewPixelRatio(window.devicePixelRatio));
    _singletonRenderer.domElement.style.touchAction = "none";
    viewContainer.appendChild(_singletonRenderer.domElement);
  }
  const renderer = _singletonRenderer;
  // 修复：fullCleanup（ESC/关闭按钮）会移除旧 viewContainer（连同 canvas），但
  // 保留 _singletonRenderer——再次 mount3D 复用 renderer 时若不重新挂载 canvas，
  // 渲染循环照常跑但 canvas 已脱离 DOM → 用户「第二次进 3D 预览」看到空白/无反应。
  if (_singletonRenderer.domElement.parentNode !== viewContainer) {
    viewContainer.appendChild(_singletonRenderer.domElement);
  }
  // 程序化能力（ADR-073 L1 + 统一注册表）：由 registry 统一创建并持久化
  const caps = sceneCapabilityRegistry.createAll({ scene, renderer, camera });
  _sceneCaps = caps;
  const skyCap = (sceneCapabilityRegistry.getById("sky") as SkyCapability) ?? null;
  const groundCap = (sceneCapabilityRegistry.getById("ground") as GroundCapability) ?? null;
  const waterCap = (sceneCapabilityRegistry.getById("water") as WaterCapability) ?? null;
  const lightCap = (sceneCapabilityRegistry.getById("light") as LightCapability) ?? null;
  const fogCap = (sceneCapabilityRegistry.getById("fog") as FogCapability) ?? null;
  const shadowCap = (sceneCapabilityRegistry.getById("shadow") as ShadowCapability) ?? null;
  const reflectorCap =
    (sceneCapabilityRegistry.getById("reflector") as ReflectorCapability) ?? null;
  const environmentCap =
    (sceneCapabilityRegistry.getById("environment") as EnvironmentCapability) ?? null;
  // 从 localStorage 恢复上次会话状态
  sceneCapabilityRegistry.loadAll();
  // 按模型类别套用预设（已有持久化状态的 cap 不覆盖）
  skyCap?.setPreset(adapter.id);
  lightCap?.setPreset(adapter.id);
  fogCap?.setPreset(adapter.id);
  shadowCap?.setPreset(adapter.id);
  reflectorCap?.setPreset(adapter.id);
  environmentCap?.setPreset(adapter.id);
  // 全部挂入场景
  for (const cap of caps) cap.apply();
  // ShadowCapability 同步：光 castShadow（光已由 LightCapability 创建）
  if (shadowCap && lightCap) syncShadowLights(scene, shadowCap, lightCap);
  // 后处理体积光管线（ADR-081 L2）：PostprocessingCapability（registry 驱动）
  const postProcCap =
    (sceneCapabilityRegistry.getById("postprocessing") as PostprocessingCapability) ?? null;
  // 兼容老接口：postProc 变量也指向同一 capability（对外 render/setSize/dispose 方法签名一致）
  const postProc = postProcCap;
  // 按模型类别套用预设
  postProcCap?.setPreset(adapter.id);
  // SSR↔Reflector 联动（postprocessing-capability.setReflectorCap）：SSR 开启时自动禁用单平面镜面，防 z-fighting
  postProcCap?.setReflectorCap(reflectorCap);
  // 性能档位（薄壳版，perf-presets.ts 数据表驱动）：用户显式档位最后套用，覆盖模型预设的性能项
  // （fps / 分辨率 / Bloom）；cap 缺席的派生路径 setStateValue 静默跳过，无副作用
  applyPerfPreset(getPerfPreset());
  // ADR-085 S3：caps 创建后触发 refreshDock()，修复 litematic/pack 的 environment 项时序缺失
  // （菜单先于 caps 挂载，挂载时 requiresEnvironment 被过滤；此处重渲染补回）
  menuHandle.refreshDock();
  // 复用单例 controls（多模型共用同一套相机控制）
  if (!_singletonControls) {
    _singletonControls = new OrbitControls(camera, renderer.domElement);
    _singletonControls.enableDamping = true;
    _singletonControls.dampingFactor = 0.1;
    _singletonControls.minDistance = 0.1;
    _singletonControls.maxDistance = 5000;
    _singletonControls.update();
    _singletonControls.enableRotate = true;
  }
  const controls = _singletonControls;
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
