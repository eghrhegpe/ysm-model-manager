// ===== 统一 3D 预览核心（ADR-066 P3：收缴 vrm/litematic 复制脚手架）=====
// 所有富格式 3D 预览（vrm / litematic / 后续 ysm）共用同一套外壳：
// overlay + 声明式根菜单(⚙️, CORE_MENU_ITEMS + 适配器注入项) + viewContainer + loadingEl +
// scene/camera/renderer/OrbitControls/灯光 + WASD/拖拽自转 + resize +
// rAF 循环 + ESC + GPU 资源释放。内容差异由 PreviewAdapter 经 build() 注入，
// 每帧 update(dt) 驱动动态部分（如 VRM SpringBone）。
//
// 旧实现里 vrm-3d.ts 与 litematic-3d.ts 各自内联 ~250 行同构脚手架（"复制那套"），
// 本文件将其收敛为单一事实来源。适配器契约对齐 YSM 既有的 Model3DHandleX，
// 使三套渲染器最终可经注册表统一派发（P3-E）。
//
// ┌─ 快速跳转 ───────────────────────────────────────────────────────────────────┐
// │  §1  常量 + 状态变量      → L100   DRAG_ROTATE_SENSITIVITY / DEFAULT_CAM_SPEED │
// │  §2  公开 API             → L108   invalidatePreview / cleanupPreview         │
// │  §3  switchPreview        → L123   会话内切换模型（复用外壳）                   │
// │  §4  mount3D 入口         → L133   主挂载函数（~700 行）                       │
// │    └─ 基础设施创建        → L266   scene/camera/renderer/OrbitControls         │
// │    └─ UI 装配             → L176   overlay/侧栏/loading/菜单                    │
// │    └─ 输入绑定            → L302   WASD 键盘 + 拖拽自转                       │
// │    └─ rAF 渲染管线        → L358   animate loop + postprocess composer        │
// │    └─ 生命周期管理        → L445   cooperate/switchTo/代际守卫               │
// │    └─ 通知 + 释放         → L572   toast + fullCleanup                       │
// │  §5  私有工具             → L741   safeDispose                              │
// └──────────────────────────────────────────────────────────────────────────────┘

import { TOAST_MS } from "../../dom/toast-ms.ts";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import { SkyCapability } from "../caps/sky-capability.ts";
import { GroundCapability } from "../caps/ground-capability.ts";
import { LightCapability } from "../caps/light-capability.ts";
import { FogCapability } from "../caps/fog-capability.ts";
import { ShadowCapability } from "../caps/shadow-capability.ts";
import { ReflectorCapability } from "../caps/reflector-capability.ts";
import { EnvironmentCapability } from "../caps/environment-capability.ts";
import type { PostprocessingLike } from "./postprocessing.ts";
import type { PostprocessingCapability } from "../caps/postprocessing-capability.ts";
import { runFullCleanup, type CleanupContext } from "./cleanup-3d.ts";
import { switchToSession, syncLightTargetFromContent } from "./switch-preview.ts";
import type { SwitchContext } from "./switch-preview.ts";
import { safeDispose } from "../safe-dispose.ts";
import { showLoadFailure } from "./preview-loading.ts";
import { sceneRegistry } from "./scene-registry.ts";
import { fitCameraToRoots } from "../camera-setup.ts";
import { assembleBoneSelectInfo, getMeshBoneId } from "../bone-raycast.ts";
import { cullModelGroups, isFrustumCullEnabled, restoreModelGroupsVisible } from "../frustum-cull.ts";
import { logWarn } from "../../core/log.ts";
import { bindInputHandlers } from "./input-and-animation.ts";
import type { InputOptions } from "./input-and-animation.ts";
import { type SemanticBoneMap } from "../semantic-bones.ts";
import { bus } from "../../../bus.ts";
import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import { createIconButton } from "../../../utils/dom/fab.ts";
import { installUiComponentsStyles } from "../../../ui/ui-components-styles.ts";
import { createSlideMenu } from "../../../ui/ui-helpers.ts";
import { createHeaderToggle } from "../../../ui/ui-header-toggle.ts";
import { mountPreviewRootMenu, type PreviewMenuHandle } from "./preview-menu.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import { type CameraControlBridge } from "./camera-controls.ts";
import type { BoneSelectInfo, BoneMaps } from "../model3d.ts";
import {
  PREVIEW_FRAME_INTERVAL_MS,
  createAdaptiveRenderBudget,
  getFrameIntervalMs,
  previewPixelRatio,
  sampleAdaptivePixelRatio,
  shouldRenderAtFps,
} from "../render-budget.ts";

/** 适配器构建时可用的通用外壳句柄（内容层据此注入场景/灯光/定相机） */
export interface PreviewBuildCtx {
  /** shared 模式下由核心创建并传入；self 模式（适配器自驱 renderer，如 ysm 单例）为 undefined */
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  controls?: OrbitControls;
  viewContainer: HTMLElement;
  loadingEl: HTMLElement;
  overlay: HTMLElement;
  /** shared 模式下核心创建的 renderer（适配器射线拾取 / 截图 / 内容挂载用；self 模式 undefined） */
  renderer?: THREE.WebGLRenderer;
  /** shared 模式下核心的相机控制桥（旋转/速度/重置，操作核心内部状态；self 模式 undefined） */
  cameraControls?: CameraControlBridge;
  /** 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；延迟闭包——build 时 _handle 未赋值，点击时已就绪 */
  switchTo?(path: string, options?: { keepInScene?: boolean }): Promise<void>;
  /** 声明式根菜单注册通道（ADR-076 v2 Phase 2）：适配器 build 内经 setAdapterItems 注入专属菜单项、openPanel 打开面板（骨骼拾取联动） */
  menu: PreviewMenuHandle;
}

/** 适配器返回的内容场景契约（对齐 Model3DHandleX，方法全部可选，便于纯静态渲染） */
export interface PreviewScene {
  /** 每帧驱动（VRM SpringBone / 动画等）；无则仅静态渲染 */
  update?(dt: number): void;
  /** 释放内容层 GPU 资源（几何/材质/纹理/helper） */
  dispose(): void;
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  showModelGroup?(i: number): void;
  onBoneSelect?(info: BoneSelectInfo): void;
  /** 语义骨骼映射（语义骨骼层消费方读取；无 = 该格式不接入语义层，消费方降级） */
  semanticBones?: SemanticBoneMap;
  /** 应用 VPD 姿势（MMD 专属；无 = 该格式不支持） */
  applyPose?(index: number): void;
  /** 截取当前 3D 渲染画面；PNG base64，无 data: 前缀—— ADR-052 P3 通用化 */
  screenshot?(): Promise<string | null>;
  /** 同台追加模式：true 表示不替换 scene，改为将模型 add 到已有场景（多模型同框） */
  keepInScene?: boolean;
  /** 骨骼映射（dispatch 拾取归属用，ADR-093 T5；未接入格式不返回） */
  boneMaps?: BoneMaps | null;
  /** 该模型声明式根菜单专属项（selectModel 换菜单用，ADR-093 T5；未接入为 null） */
  menuItems?: PreviewMenuNode[] | null;
  /** 多模型下由统一拾取器调用：点中该模型骨骼时打开其面板（ADR-093 T5） */
  onBonePick?: (boneId: string) => void;
}

export interface PreviewAdapter {
  id: string;
  /** "shared"（默认）：核心创建 renderer/scene/controls 并驱循环；"self"：适配器自驱（如 ysm 单例），核心仅提供外壳 */
  mode?: "shared" | "self";
  build(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene>;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：供适配器复位调用方状态、注销平台返回键等 */
  onClose?(): void;
}

/** 统一预览句柄（D 步 ysm 接入时经此暴露内容层方法） */
export interface PreviewHandle {
  cleanup(): void;
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  showModelGroup?(i: number): void;
  onBoneSelect?(info: BoneSelectInfo): void;
  /** 当前会话内切换到另一模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6） */
  switchTo?(path: string, options?: { keepInScene?: boolean }): Promise<void>;
  /** 截取当前 3D 渲染画面（PNG base64，无 data: 前缀）—— ADR-052 P3 通用化 */
  screenshot?(): Promise<string | null>;
}

// ===== §1 常量 + 状态变量 =====
// 相机控制常量（buildCameraControls 已拆至 camera-controls.ts，本文件保留自身仍使用的部分：
// DRAG_ROTATE_SENSITIVITY 拖拽旋转 / DEFAULT_CAM_SPEED 初始速度 / TIP_AUTO_DISMISS_MS 提示自动消失）
const DRAG_ROTATE_SENSITIVITY = 0.003; // 自身旋转模式拖拽灵敏度（rad/px）
const DEFAULT_CAM_SPEED = 20;
const TIP_AUTO_DISMISS_MS = 6000;
/** perFrame 回调单次执行超过该阈值（ms）即告警（仅测回调段，非整帧） */
const PER_FRAME_WARN_MS = 50;
/** 告警节流间隔：持续超阈值帧最多每 N ms 报一条，防刷屏加重卡顿 */
const PER_FRAME_WARN_THROTTLE_MS = 5000;

let _gen = 0;
/** 上次 perFrame 告警时间戳（节流用） */
let _lastPerFrameWarnTs = 0;

/** 模块级全局 overlay（仅 cleanupPreview 时才移除，多次 mount3D 复用同一 DOM） */
let _singletonOverlay: HTMLElement | null = null;
let _singletonBody: HTMLElement | null = null;
/** 共享视窗容器（.preview-view-container：canvas 所在格子）：随外壳首次创建、后续复用 */
let _singletonViewContainer: HTMLElement | null = null;
/** 共享 scene（所有模型共用一个 scene，不同格式模型叠加在同一 WebGL context） */
let _singletonScene: THREE.Scene | null = null;
/** 共享 camera / renderer / controls（第一次 mount3D 创建，后续复用） */
let _singletonCamera: THREE.PerspectiveCamera | null = null;
let _singletonRenderer: THREE.WebGLRenderer | null = null;
let _singletonControls: OrbitControls | null = null;
/** 所有已挂载的 PreviewHandle（cooperate 模式下多模型各自独立） */
const _handles: Array<{ handle: PreviewHandle; gen: number }> = [];
/** rAF 全局唯一标识和 perFrame 回调列表（共享同一 renderer） */
let _globalAnimId = 0;
let _globalPerFrames: Array<(dt: number) => void> = [];

/** 任意新预览派发时调用，作废在途加载（对齐 invalidateVrmPreview / invalidateLitematicPreview） */
export function invalidatePreview(): void {
  _gen++;
}

/** 清理所有 3D 预览（dispose built + 移除 scene children，保留 renderer/canvas/overlay 存活避免黑屏） */
export function cleanupPreview(): void {
  _gen++;
  for (const h of _handles) {
    try { h.handle.cleanup(); } catch (_) {}
  }
  _handles.length = 0;
  // renderer/canvas/overlay 保留（下次 mount3D 直接复用，不重建 DOM）
  // 但 _singletonOverlay/_singletonBody/_singletonViewContainer 必须清零：handle.cleanup→
  // fullCleanup 已从 DOM 移除它们，保留旧引用会导致下次 mount3D 复用已脱离文档的
  // detached element（测试 afterEach 尤其敏感）。
  _singletonOverlay = null;
  _singletonBody = null;
  _singletonViewContainer = null;
  _singletonScene = null;
  _singletonCamera = null;
  _singletonRenderer = null;
  _singletonControls = null;
}

/** 测试用：重置所有模块级单例状态（不影响生产代码路径） */
export function _resetSingletons(): void {
  _singletonOverlay = null;
  _singletonBody = null;
  _singletonViewContainer = null;
  _singletonScene = null;
  _singletonCamera = null;
  _singletonRenderer = null;
  _singletonControls = null;
  _globalAnimId = 0;
  _globalPerFrames.length = 0;
}

/** 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；无活跃会话时 no-op */
export async function switchPreview(path: string, options?: { keepInScene?: boolean }): Promise<void> {
  const active = _handles[_handles.length - 1];
  await active?.handle.switchTo?.(path, options);
}

/** 是否存在活跃 3D 预览会话（多模型同台追加的前置判定，ADR-093 T4） */
export function hasActivePreview(): boolean {
  return _handles.length > 0;
}

/** mount3D 附加选项（ADR-066 §5.6 3D 内模型切换） */
export interface Mount3DOptions {
  /** 同类型可切换的候选路径列表（≥2 时 topBar 渲染切换下拉；缺省不渲染，向后兼容） */
  siblings?: string[];
  /** 同台追加模式：true 时不移除旧模型，新模型追加到同一场景（多模型同框） */
  cooperate?: boolean;
  /** 跨类型跳转（切换模型选中不同类型：关当前 + 开目标；app 层 openModel3DFullscreen 注入）。
   *  第二参透传 siblings（当前会话候选），避免切换后新会话「当前目录」tab 为空 */
  switchExternal?: (path: string, siblings?: string[], options?: { keepInScene?: boolean }) => Promise<void>;
  /** 当前会话资源类型（如 ysm/EntityPlayer/vrm/resourcepack）；类型 tab 点击时判断同类型走 switchTo */
  rtype?: string;
  /** 当前会话子类型（如 EntityPlayer/CustomAnim）——用于类型 tab 扫描时按 subtype 隔离扩展名 */
  subtype?: string;
  /** 按资源类型懒加载候选模型路径（切换模型的类型 tab 点击时；缺省无 tab） */
  getModelsByType?: (rtype: string, subtype?: string) => Promise<string[]>;
  /** 类型 tab 列表（有 3D opener 的类型；经 withPreviewExtras 注入，缺省仅「当前目录」tab） */
  getTypeTabs?: () => string[];
}

export async function mount3D(adapter: PreviewAdapter, path: string, opts: Mount3DOptions = {}): Promise<void> {
  const cooperate = opts.cooperate === true;
  // 复用单例外壳（renderer/canvas/overlay/scene 存活），首次 mount3D 创建，后续复用。
  // cooperate=true 时多个模型叠加在同一 scene；cooperate=false 时先清除旧模型再加载新模型。
  installUiComponentsStyles();
  const myGen = ++_gen;
  const selfMode = adapter.mode === "self";
  /** 当前模型路径：切换成功后「当前」项须指向新模型，原 path 移回候选。
   *  siblings 不再 mount 时一次性过滤——getSiblings 基于 currentPath 动态过滤，
   *  切换模型即「变更 filter 路径」，全程轻量不重扫。 */
  let currentPath = path;

  // ---- shared 模式相机状态（提前声明：buildCameraControls 的 bridge 闭包需在此后引用）----
  // self 模式由适配器（如 ysm 的 renderModel3D 单例）自行驱动这些，核心只提供外壳，
  // 避免与适配器自带 renderer/循环冲突（双重渲染 / 双重键盘劫持）。
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let controls: OrbitControls | undefined;
  const isDisposed = { v: false };
  const keys: Record<string, boolean> = {};
  let camSpeed = DEFAULT_CAM_SPEED;
  let orbitMode = true;
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  let mouseDown = false;
  let lastMouse = { x: 0, y: 0 };
  let orbitTarget: THREE.Vector3 | undefined;
  // ===== §3 UI 装配（overlay/loading/菜单）=====
  // 程序化天空能力（ADR-073 L1）：shared 模式注入统一核心，四种模型零改动继承
  // 由 sceneCapabilityRegistry 统一创建，此处用辅助 getter 引用
  let skyCap: SkyCapability | null = null;
  let groundCap: GroundCapability | null = null;
  let lightCap: LightCapability | null = null;
  let fogCap: FogCapability | null = null;
  let shadowCap: ShadowCapability | null = null;
  let reflectorCap: ReflectorCapability | null = null;
  let environmentCap: EnvironmentCapability | null = null;
  // 后处理体积光管线（ADR-081 L2）：PostprocessingCapability（Registry 驱动）
  // postProc 指向同一 capability，接口 PostprocessingLike：render/setSize/dispose
  let postProc: PostprocessingLike | null = null;
  let postProcCap: PostprocessingCapability | null = null;
  let perFrame: ((dt: number) => void) | null = null;
  let onKeyDown: (e: KeyboardEvent) => void = () => {};
  let onKeyUp: (e: KeyboardEvent) => void = () => {};
  let onDragPointerDown: (e: PointerEvent) => void = () => {};
  let onDragPointerUp: (e: PointerEvent) => void = () => {};
  let onDragPointerMove: (e: PointerEvent) => void = () => {};
  let onResize: () => void = () => {};
  // R1-P2-1：提升为 let，使 cleanupCtx（块外构建）可访问 click 处理器
  let onUnifiedPick: ((e: MouseEvent) => void) | null = null;

  // 单例外壳：首次创建，后续 mount3D 复用同一 DOM（避免重建导致黑屏）
  let overlay = _singletonOverlay;
  let body = _singletonBody;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "ysm-overlay-3d";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:var(--z-fullscreen);background:#11111b;display:flex;flex-direction:column";
    document.body.appendChild(overlay);
    body = document.createElement("div");
    body.style.cssText = "flex:1;display:flex;position:relative;overflow:hidden";
    overlay.appendChild(body);
    _singletonOverlay = overlay;
    _singletonBody = body;
  }
  // viewContainer 复用模块级单例（与 scene/canvas 同寿命；创建逻辑见下方 §3 UI 装配）

  // 顶栏已移除（ADR-076 v2，用户 2026-08-16 决策）：预览控件全部收进
  // 声明式根菜单（⚙️ 按钮 → mountPreviewRootMenu），彻底告别顶栏滑块垃圾。
  // litematic 分层控件也经 litematicMenuItems 注入根菜单模型组（Phase 3 收编）。

  // 相机控制桥（shared 模式）：core 的相机控件与 PreviewBuildCtx.cameraControls
  // 共用同一 bridge（操作核心内部 orbitMode/camSpeed/controls），适配器（如 ysm 底部
  // 导航）经 cameraControls 复用同一套相机状态。相机控件本身已收进声明式根菜单的 camera 项。
  const camBridge: CameraControlBridge = {
    getOrbit: () => orbitMode,
    setOrbit: (v: boolean) => {
      orbitMode = v;
      if (controls) controls.enableRotate = v;
      if (v) {
        if (orbitTarget && controls) orbitTarget.copy(controls.target);
      } else {
        if (camera) euler.setFromQuaternion(camera.quaternion);
      }
      mouseDown = false;
    },
    getSpeed: () => camSpeed,
    setSpeed: (n: number) => { camSpeed = n; },
    // built 在 try 块内声明，此处经模块级 _handle（PreviewHandle 含 resetCamera? 契约）延迟调用
    reset: () => { _handles[_handles.length - 1]?.handle.resetCamera?.(); },
  };

  // viewContainer：与 scene/canvas 同属共享外壳——首次 mount3D 创建，后续复用同一
  // 视窗（多模型同台共用同一 canvas，而非每次 mount3D 新建空容器；回归：曾反复 new
  // 容器导致同台后多出空白分屏）
  if (!_singletonViewContainer) {
    const c = document.createElement("div");
    c.className = "preview-view-container";
    c.style.cssText = "flex:1;position:relative;overflow:hidden";
    body!.appendChild(c);
    _singletonViewContainer = c;
  }
  const viewContainer = _singletonViewContainer;

  // 声明式根菜单（⚙️）：core 在 overlay 内自建（预览全屏盖住 app 外壳，主程序 nav.settings 够不着），
  // 全部控件以 CORE_MENU_ITEMS + 适配器注入项表驱动渲染（preview-menu-defs.ts），
  // 测试遍历真实菜单数组断言（preview-menu-items.test.ts），选择器稳定可遍历（ADR-076 v2）。
  const menuHandle = mountPreviewRootMenu(overlay, {
    selfMode,
    getCap: (id: string) => sceneCapabilityRegistry.getById(id) ?? null,
    getCamBridge: () => camBridge,
    getSiblings: () => (opts.siblings ?? []).filter((p) => p !== currentPath),
    getCurrentPath: () => currentPath,
    getCurrentRtype: () => (opts.rtype && opts.rtype.trim() ? opts.rtype : adapter.id),
    getCurrentSubtype: () => opts.subtype ?? "",
    getModelsByType: opts.getModelsByType ? (t: string, s?: string) => opts.getModelsByType!(t, s) : undefined,
    getTypeTabs: opts.getTypeTabs ? () => opts.getTypeTabs!() : undefined,
    getViewContainer: () => viewContainer,
    close: () => {
      if (cleanupFn) cleanupFn();
      else closeOverlay();
    },
    switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> | void => {
      const active = _handles[_handles.length - 1];
      const r = active?.handle.switchTo?.(p, options);
      // 透传 Promise：调用方（fillSwitch 替换/追加）在完成后局部刷新面板（renderRows 重读新当前路径）
      if (r) {
        void r.catch((err: unknown) => logWarn("preview-menu", `switchTo 切换失败: ${String(err)}`));
        return r;
      }
      return undefined;
    },
    switchExternal: opts.switchExternal
      ? (p: string, s?: string[], options?: { keepInScene?: boolean }): void => {
          const r = opts.switchExternal!(p, s, options) as Promise<void> | void;
          if (r && typeof r.catch === "function") {
            void r.catch((err: unknown) => logWarn("preview-menu", `switchExternal 切换失败: ${String(err)}`));
          }
        }
      : undefined,
    unloadRole,
    toast: (msg: string): void => {
      bus.emit("toast:show", { msg, duration: TOAST_MS.normal });
    },
    closeAllOverlays: (): void => {
      menuHandle.dispose();
    },
  });
  // ADR-093 T5：注册表菜单 sink（selectModel 时按活跃模型换菜单项）
  sceneRegistry.setMenuSink({ setAdapterItems: (items) => menuHandle.setAdapterItems(items) });

  const loadingEl = document.createElement("div");
  loadingEl.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:rgba(255,255,255,0.6);font-size:14px;gap:12px;z-index:10";
  viewContainer.appendChild(loadingEl);

  // ===== §4 基础设施创建（scene/camera/renderer/OrbitControls/灯光/resize）=====
  let aborted = { v: false };
  // 可变 ESC 处理函数：switchTo 后重新赋值
  let escH = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (cleanupFn) cleanupFn();
      else closeOverlay();
    }
  };
  function closeOverlay(): void {
    aborted.v = true;
    document.removeEventListener("keydown", escH);
    // 早期路径（cleanupFn 尚未赋值）：清理 tip 定时器 + 菜单，再拆 overlay
    if (tipTimeoutId) {
      clearTimeout(tipTimeoutId);
      tipTimeoutId = undefined;
    }
    menuHandle.dispose();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    // 从模块级 handles 列表移除当前 session
    const idx = _handles.findIndex(h => h.gen === myGen);
    if (idx >= 0) _handles.splice(idx, 1);
    adapter.onClose?.();
  }
  document.addEventListener("keydown", escH);

  if (!selfMode) {
    const infra = mpBuildSharedInfra(adapter, viewContainer, menuHandle);
    scene = infra.scene;
    camera = infra.camera;
    renderer = infra.renderer;
    controls = infra.controls;
    orbitTarget = infra.orbitTarget;
    skyCap = infra.skyCap;
    groundCap = infra.groundCap;
    lightCap = infra.lightCap;
    fogCap = infra.fogCap;
    shadowCap = infra.shadowCap;
    reflectorCap = infra.reflectorCap;
    environmentCap = infra.environmentCap;
    postProc = infra.postProc;
    postProcCap = infra.postProcCap;

    // ===== §4a 输入绑定（WASD 键盘 + 拖拽自转 + resize）=====
    const inputOpts: InputOptions = {
      keys,
      getOrbitMode: () => orbitMode,
      mouseDown: { v: mouseDown },
      lastMouse: { x: lastMouse.x, y: lastMouse.y },
      euler,
      camera,
      renderer,
      postProc,
      viewContainer,
      isDisposed,
    };
    const handlers = bindInputHandlers(inputOpts);
    onKeyDown = handlers.onKeyDown;

    // ADR-093 T5：统一多模型拾取器（仅 count>=2 激活，单模型完全沿用逐模型 registerBoneRaycast，零回归）
    onUnifiedPick = mpMakeUnifiedPickHandler(renderer, camera, scene);
    renderer.domElement.addEventListener("click", onUnifiedPick);
    onKeyUp = handlers.onKeyUp;
    onDragPointerDown = handlers.onDragPointerDown;
    onDragPointerUp = handlers.onDragPointerUp;
    onDragPointerMove = handlers.onDragPointerMove;
    onResize = handlers.onResize;

    // ===== §4b rAF 渲染管线（全局唯一 loop，所有 session 共享同一 renderer）=====
    // 首个 session 启动 loop，后续 session 追加 perFrame 回调；cleanupPreview 停止
    if (_globalAnimId === 0) {
      // rAF 每帧复用 Vector3 实例，避免 5 次 GC 分配（R1-P1-1）
      const _camDir = new THREE.Vector3();
      const _forward = new THREE.Vector3();
      const _right = new THREE.Vector3();
      const _move = new THREE.Vector3();
      let lastTime = performance.now() - PREVIEW_FRAME_INTERVAL_MS;
      let nextFrameTime = performance.now();
      const adaptiveBudget = createAdaptiveRenderBudget(
        previewPixelRatio(window.devicePixelRatio),
        performance.now(),
      );
      function animate(): void {
        _globalAnimId = requestAnimationFrame(animate);
        const now = performance.now();
        const interval = getFrameIntervalMs();
        if (!shouldRenderAtFps(now, nextFrameTime, interval, document.hidden === true)) {
          // 跳过帧（隐藏/节流）：推进采样起点——隐藏期间墙钟继续走但 sampleFrames
          // 不涨，恢复后平均帧时虚高会把像素比误降级，重复最小化渐进降到地板（code review P3）
          adaptiveBudget.sampleStart = now;
          return;
        }
        nextFrameTime += interval;
        if (nextFrameTime < now - interval) {
          nextFrameTime = now + interval;
        }
        const dt = Math.min((now - lastTime) / 1000, 0.1);
        lastTime = now;
        // 推进水面波纹动画（wetness>0 时 visible）
        const activeSession = _handles[_handles.length - 1];
        groundCap?.update(dt);
        const cam = camera as THREE.PerspectiveCamera;
        const sc = scene as THREE.Scene;
        const rd = renderer as THREE.WebGLRenderer;
        const ctr = controls as OrbitControls;
        const ot = orbitTarget as THREE.Vector3;
        mpApplyWasdCameraMotion(keys, cam, ctr, camSpeed, dt, orbitMode, ot, {
          camDir: _camDir,
          forward: _forward,
          right: _right,
          move: _move,
        });
        // 驱动所有 session 的 perFrame 回调
        for (const fn of _globalPerFrames) {
          const pfStart = performance.now();
          try { fn(dt); } catch (err) {
            logWarn("perFrame", `session 回调异常: ${String(err)}`);
          }
          const pfMs = performance.now() - pfStart;
          const pfNow = performance.now();
          if (pfMs > PER_FRAME_WARN_MS && pfNow - _lastPerFrameWarnTs > PER_FRAME_WARN_THROTTLE_MS) {
            _lastPerFrameWarnTs = pfNow;
            logWarn("perFrame", `阻塞 ${pfMs.toFixed(1)}ms (>${PER_FRAME_WARN_MS}ms 阈值)`);
          }
        }
        // 视锥裁剪（设置开关：关 → 跳过并恢复可见性——剔除失误会误藏模型，可关闭）
        if (isFrustumCullEnabled()) cullModelGroups(cam);
        else restoreModelGroupsVisible();
        // ADR-081 L2：后处理体积光管线
        const rendered = postProc ? postProc.render(dt, lightCap) : false;
        if (!rendered) rd.render(sc, cam);
        const nextPixelRatio = sampleAdaptivePixelRatio(adaptiveBudget, now, interval);
        if (nextPixelRatio !== null) {
          rd.setPixelRatio(nextPixelRatio);
          rd.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
          postProc?.setPixelRatio?.(nextPixelRatio);
          postProc?.setSize(viewContainer.clientWidth, viewContainer.clientHeight);
        }
      }
      animate();
    }
    // perFrame 注册统一走 setPerFrame（初次 mount 在 build 成功后、切换在
    // switchToSession 内）——此处不再一次性 push：执行时 perFrame 尚未赋值（P3）
  }

  // 操作提示条（自动消失，两种模式通用）
  const tip = document.createElement("div");
  tip.style.cssText = "padding:5px 12px;background:#1b1c24;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.7);font-size:11px;text-align:center;flex-shrink:0";
  tip.textContent = "WASD 移动 · 空格/Shift 上下 · 拖动旋转 · 滚轮缩放 · ESC 关闭";
  overlay.insertBefore(tip, body);
  // 保存 timeoutId 供 cleanup 时 clearTimeout
  let tipTimeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    if (tip.parentNode) tip.remove();
  }, TIP_AUTO_DISMISS_MS);

  let cleanupFn: (() => void) | null = null;
  // switchTo 支持（ADR-066 §5.6）：提升 built 到 try 外，复用外壳重建内容层
  let built: PreviewScene | null = null;
  /** scene 子节点基线快照（shared 模式）：区分「场景固有装饰」与「内容层增量」——
   *  首次 build 前捕获，切换后经 setSceneBaseline 更新为排除增量的快照；
   *  switchTo 时用差量移除旧内容层，防场景累积 */
  let sceneBaseline: Set<THREE.Object3D> | null = null;
  /** cooperate 模式下已追加的内容句柄列表（fullCleanup 时逐一 dispose） */
  const allBuilt: PreviewScene[] = [];

  const cleanupCtx: CleanupContext = {
    menuHandle,
    isDisposed,
    animId: _globalAnimId,
    onKeyDown,
    onKeyUp,
    getEscH: () => escH,
    onDragPointerDown,
    onDragPointerUp,
    onDragPointerMove,
    onResize,
    onUnifiedPick,
    allBuilt,
    nullBuilt: () => { built = null; },
    skyCap,
    groundCap,
    lightCap,
    fogCap,
    shadowCap,
    reflectorCap,
    environmentCap,
    postProc,
    nullPostProc: () => { postProc = null; },
    postProcCap,
    renderer,
    scene,
    controls,
    overlay,
    nullHandle: () => {
      const idx = _handles.findIndex(h => h.gen === myGen);
      if (idx >= 0) _handles.splice(idx, 1);
    },
    adapter,
    getTipTimeoutId: () => tipTimeoutId,
  };

  const switchCtx: SwitchContext = {
    scene,
    getSceneBaseline: () => sceneBaseline,
    setSceneBaseline: (s) => { sceneBaseline = s; },
    getBuilt: () => built,
    setBuilt: (s) => { built = s; },
    allBuilt,
    loadingEl,
    viewContainer,
    overlay,
    menuHandle,
    adapter: { build: adapter.build.bind(adapter) },
    camBridge,
    selfMode,
    renderer,
    controls,
    orbitTarget,
    camera,
    lightCap,
    shadowCap,
    environmentCap,
    getCurrentPath: () => currentPath,
    setCurrentPath: (p) => { currentPath = p; },
    getCurrentRtype: () => (opts.rtype && opts.rtype.trim() ? opts.rtype : adapter.id),
    getCurrentSubtype: () => opts.subtype ?? "",
    getPerFrame: () => perFrame,
    setPerFrame: (f) => {
      // 切换模型时先从全局 perFrame 列表移除旧回调（防已 dispose 的旧内容层
      // update 持续执行），再注册新回调——移除/注册对称维护，初次 mount 与
      // 切换统一经此注册（rAF 引导块不再一次性 push）
      const old = perFrame;
      if (old) {
        const idx = _globalPerFrames.indexOf(old);
        if (idx >= 0) _globalPerFrames.splice(idx, 1);
      }
      perFrame = f;
      // P3 对称维护：新回调非空时重新注册，否则列表与 perFrame 引用脱节
      // （初次 mount 与切换统一经 setPerFrame 注册，取代 595 行的一次性 push）
      if (f) _globalPerFrames.push(f);
    },
    getHandle: () => _handles[_handles.length - 1]?.handle ?? null,
    aborted,
    inFlight: false,
    isDisposed,
    myGen,
    getGen: () => _gen,
  };

  /**
   * 卸载单个角色（角色面板 ⚙ → 卸载角色，MikuMikuAR buildModelToolsLevel 移植）：
   * 移除其场景根节点 + 释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。
   * 函数声明提升：引用 allBuilt（§4 声明）在调用时已初始化。
   */
  function unloadRole(id: string): void {
    mpUnloadRole(
      {
        allBuilt,
        scene,
        controls,
        camera,
        menuHandle,
        getBuilt: () => built,
        setPerFrame: (f) => switchCtx.setPerFrame(f),
      },
      id,
    );
  }

  try {
    // 代际守卫：await 期间用户已点其他文件 / 被 invalidate，丢弃本次挂载
    if (myGen !== _gen) return;

    if (scene) sceneBaseline = new Set(scene.children);
    built = await adapter.build(
      {
        scene,
        camera,
        controls,
        renderer,
        cameraControls: selfMode ? undefined : camBridge,
        viewContainer,
        loadingEl,
        overlay,
        menu: menuHandle,
        // 延迟闭包：build 时 _handle 尚未赋值，菜单点击（build 之后）时已就绪；
        // 无活跃会话时 no-op（与 switchPreview 同口径）
        switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> => {
          const active = _handles[_handles.length - 1];
          return active?.handle.switchTo?.(p, options) ?? Promise.resolve();
        },
      },
      path,
    );
    if (aborted.v || myGen !== _gen) {
      // 加载期间被 ESC / invalidate 打断：完整拆除（含 rAF 循环与 WebGL renderer），
      // 避免外壳资源泄漏；内容层 GPU 资源经 fullCleanup 一并释放。
      fullCleanup();
      return;
    }
    // 注意：loadingEl 的移除交由适配器在成功路径自行处理（旧 vrm/litematic 即在
    // build 内 loadingEl.remove()）；空数据/错误等场景适配器会把提示写在 loadingEl
    // 并保留它，核心不在此强制移除。

    // 同步通用相机状态到适配器已设定的取景（包围盒/尺寸定相机）——仅 shared 模式
    if (renderer) {
      orbitTarget!.copy((controls as OrbitControls).target);
      euler.setFromQuaternion((camera as THREE.PerspectiveCamera).quaternion);
    }
    // ADR-081 L1：内容层包围盒 -> 聚光灯/体积光锥瞄准对象上方
    syncLightTargetFromContent(scene, sceneBaseline, lightCap);
    // 首模型 mesh castShadow / receiveShadow（内容层根节点 = 刚注册的 added）
    if (shadowCap && built) {
      const roots = scene && sceneBaseline
        ? scene.children.filter((c) => !sceneBaseline!.has(c))
        : [];
      shadowCap.applyMeshCasts(roots);
    }
    // 首模型 mesh envMapIntensity 同步
    if (environmentCap && built) {
      const roots = scene && sceneBaseline
        ? scene.children.filter((c) => !sceneBaseline!.has(c))
        : [];
      environmentCap.syncMeshIntensity(roots);
    }
    switchCtx.setPerFrame(built.update ?? null);
  // ===== §4c 生命周期管理（cooperate/switchTo/代际守卫）=====
  // 记录初始模型到追加列表（cooperate 模式下 fullCleanup 需逐一 dispose）
    if (built) allBuilt.push(built);
    // ADR-093 T2：首模型注册进场景注册表（roots 经 scene.children 差量捕获）
    if (built) {
      const added = scene && sceneBaseline
        ? scene.children.filter((c) => !sceneBaseline!.has(c))
        : [];
      sceneRegistry.register({
        path,
        rtype: opts.rtype ?? adapter.id,
        roots: added,
        built,
        boneMaps: built.boneMaps ?? null,
        menuItems: built.menuItems ?? null,
        onBonePick: built.onBonePick ?? null,
      });
      // ADR-076 v2 Phase 3：注册后立刻注入菜单项，否则 dock-menu 无适配器专属控件
      if (built.menuItems) menuHandle.setAdapterItems(built.menuItems);
    }

    // ADR-076 v2 Phase 3：适配器控件全部经声明式根菜单注入（ctx.menu.setAdapterItems / built.menuItems）
    // 不再有 topBar 或 sidePanel 额外挂载

    function fullCleanup(): void {
      // P0 修复：中止/退出路径完整拆除 DOM + 解绑监听，防泄漏
      // ① ESC 监听器（escH 经 L792 可能已被替换，移除当前引用）
      document.removeEventListener("keydown", escH);
      // ② 提示条定时器
      if (tipTimeoutId) {
        clearTimeout(tipTimeoutId);
        tipTimeoutId = undefined;
      }
      // ③ 声明式根菜单（移除 dock/popup + 解绑 view click 监听）
      menuHandle.dispose();
      // ④ viewContainer（含 loadingEl；首次挂载时可能含 renderer.domElement）
      if (viewContainer.parentNode) viewContainer.parentNode.removeChild(viewContainer);
      // ⑤ overlay 本体移除 + 清模块级单例：fullCleanup 是「完整关闭」语义。
      // switchTo 的复用外壳走 switch-preview.ts（不经过此处），故移除 overlay 不影响模型内切换。
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      _singletonOverlay = null;
      _singletonBody = null;
      _singletonViewContainer = null;
      // ⑥ 只清理内容层（dispose built + 移除 scene children），保留 renderer/canvas 存活
      //    避免销毁 WebGL context 导致黑屏窗口期
      if (scene && sceneBaseline) {
        const stale = scene.children.filter((c): boolean => !sceneBaseline!.has(c));
        for (const c of stale) scene.remove(c);
      }
      for (const b of allBuilt) {
        safeDispose(b);
      }
      allBuilt.length = 0;
      sceneRegistry.reset();
      // 清掉 loadingEl（已从 viewContainer 一并移除，此处为兜底）
      if (loadingEl.parentNode) loadingEl.remove();
      // 从全局 perFrame 回调列表移除本 session
      if (perFrame) {
        const idx = _globalPerFrames.indexOf(perFrame);
        if (idx >= 0) _globalPerFrames.splice(idx, 1);
      }
      // 如果所有 session 都清理完了，停止 rAF
      if (_globalPerFrames.length === 0) {
        cancelAnimationFrame(_globalAnimId);
        _globalAnimId = 0;
      }
    }

    // 复用 escH 可变引用，switchTo 后旧 handler 被替换，新 handler 在 cleanup 时通过 getter 正确卸载
    // R1-P1-2：先保存旧引用再替换，否则 removeEventListener 移除的是新函数（从未注册过），旧函数仍残留
    const oldEscH = escH;
    escH = (e: KeyboardEvent): void => {
      if (e.key === "Escape") fullCleanup();
    };
    document.removeEventListener("keydown", oldEscH);
    document.addEventListener("keydown", escH);
    cleanupFn = fullCleanup;
    const sessionHandle = {
      cleanup: fullCleanup,
      resetCamera: built.resetCamera,
      setRotationMode: built.setRotationMode,
      setSpeed: built.setSpeed,
      showModelGroup: built.showModelGroup,
      onBoneSelect: built.onBoneSelect,
      screenshot: built.screenshot,
      // 当前会话内切换模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6）
      // 支持 keepInScene 模式：true 时不移除旧模型，新模型追加到同一场景（多模型同台）
      switchTo: (newPath: string, options?: { keepInScene?: boolean }) => switchToSession(switchCtx, newPath, options),
    };
    _handles.push({ handle: sessionHandle, gen: myGen });
  } catch (e) {
    document.removeEventListener("keydown", escH);
    built?.dispose();
    // P2 守卫（对齐旧 skeleton close3D 语义）：加载期间被 ESC/切模型/invalidate
    // 打断后迟到的失败不得再弹错——否则关闭后 1~2s 突然冒「加载失败」toast，
    // 掩盖用户主动关闭的意图（旧实现 skeleton.ts 的 gen 守卫，迁移到核心统一承担）。
    if (aborted.v || myGen !== _gen) return;
    console.error("[preview 3D] 加载失败:", e);
    showLoadFailure(loadingEl, e);
  }
}

// ===== §5 私有工具函数（mount3D 拆出的包级子函数，命名前缀 mp*/MountPreview）=====
// → cleanup-3d.ts（runFullCleanup / CleanupContext）
// → input-and-animation.ts（bindInputHandlers / InputOptions）
// → switch-preview.ts（switchToSession / SwitchContext）

/** mpUnloadRole 所需的外部会话引用（原 mount3D 内嵌闭包变量，显式参数化注入） */
interface MpUnloadCtx {
  allBuilt: PreviewScene[];
  scene: THREE.Scene | undefined;
  controls: OrbitControls | undefined;
  camera: THREE.PerspectiveCamera | undefined;
  menuHandle: PreviewMenuHandle;
  /** 当前会话内容层（switchTo 后会被替换，经 getter 读最新值） */
  getBuilt: () => PreviewScene | null;
  /** 复位 perFrame（null）——对称维护 _globalPerFrames（consume switchToSession 的同源注销逻辑） */
  setPerFrame: (f: ((dt: number) => void) | null) => void;
}

/** 卸载单个角色（角色面板 ⚙ → 卸载角色，MikuMikuAR buildModelToolsLevel 移植）：移除场景根节点 +
 *  释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。原 mount3D 内嵌闭包提纯。 */
function mpUnloadRole(ctx: MpUnloadCtx, id: string): void {
  const entry = sceneRegistry.get(id);
  if (!entry) return;
  // 卸载的是当前会话内容层源时，perFrame 指向其 update——先记下以便停掉
  // rAF 回调，避免每帧驱动已 dispose 的内容层（空场景 session 半死状态，P3）
  const wasCurrentSource = ctx.getBuilt() === entry.built;
  // 无条件释放内容层 GPU：cooperate 跨 session 场景下 allBuilt 可能不含
  // entry.built（角色面板显示注册表全部角色，可卸载另一 session 注册的），
  // 以 allBuilt 命中与否决定 dispose 会漏释放（P3 round2）
  safeDispose(entry.built);
  const bi = ctx.allBuilt.indexOf(entry.built);
  if (bi >= 0) ctx.allBuilt.splice(bi, 1);
  for (const r of entry.roots) {
    if (ctx.scene) ctx.scene.remove(r);
  }
  // 停掉持有该 built 的 perFrame（无论归属哪个 session；_globalPerFrames 按引用移除）
  const upd = entry.built.update;
  if (upd) {
    const fnIdx = _globalPerFrames.indexOf(upd);
    if (fnIdx >= 0) _globalPerFrames.splice(fnIdx, 1);
  }
  if (wasCurrentSource) ctx.setPerFrame(null);
  sceneRegistry.unregister(id);
  const next = sceneRegistry.getActiveId();
  if (next) {
    // setActive 仅在 menuItems truthy 时换菜单；新活跃角色无专属项时显式清空
    // dock 适配器项，杜绝残留已卸载角色的菜单绑定到已 dispose 内容层（P2）
    const ne = sceneRegistry.get(next);
    if (ne?.menuItems) sceneRegistry.setActive(next);
    else ctx.menuHandle.setAdapterItems([]);
  } else {
    ctx.menuHandle.setAdapterItems([]);
  }
  if (ctx.camera && ctx.controls) {
    const roots = sceneRegistry.visibleRoots();
    if (roots.length) fitCameraToRoots(roots, ctx.camera, ctx.controls);
  }
  ctx.menuHandle.refreshDock();
}

/** mpBuildSharedInfra 返回的 shared 基础设施 + 程序化能力引用（mount3D 赋值给会话局部变量） */
interface MpSharedInfra {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  orbitTarget: THREE.Vector3;
  skyCap: SkyCapability | null;
  groundCap: GroundCapability | null;
  lightCap: LightCapability | null;
  fogCap: FogCapability | null;
  shadowCap: ShadowCapability | null;
  reflectorCap: ReflectorCapability | null;
  environmentCap: EnvironmentCapability | null;
  postProc: PostprocessingLike | null;
  postProcCap: PostprocessingCapability | null;
}

/** mpBuildSharedInfra：shared 模式基础设施 + 程序化能力装配（scene/camera/renderer/OrbitControls 单例复用 + caps 创建/preset/Shadow/postProc 联动）。
 *  返回带出的局部引用，mount3D 仅赋值给会话变量；self 模式走适配器自驱，不走本函数。 */
function mpBuildSharedInfra(adapter: PreviewAdapter, viewContainer: HTMLElement, menuHandle: PreviewMenuHandle): MpSharedInfra {
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
  const skyCap = (sceneCapabilityRegistry.getById("sky") as SkyCapability) ?? null;
  const groundCap = (sceneCapabilityRegistry.getById("ground") as GroundCapability) ?? null;
  const lightCap = (sceneCapabilityRegistry.getById("light") as LightCapability) ?? null;
  const fogCap = (sceneCapabilityRegistry.getById("fog") as FogCapability) ?? null;
  const shadowCap = (sceneCapabilityRegistry.getById("shadow") as ShadowCapability) ?? null;
  const reflectorCap = (sceneCapabilityRegistry.getById("reflector") as ReflectorCapability) ?? null;
  const environmentCap = (sceneCapabilityRegistry.getById("environment") as EnvironmentCapability) ?? null;
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
  if (shadowCap && lightCap) mpSyncShadowLights(scene, shadowCap, lightCap);
  // 后处理体积光管线（ADR-081 L2）：PostprocessingCapability（registry 驱动）
  const postProcCap = (sceneCapabilityRegistry.getById("postprocessing") as PostprocessingCapability) ?? null;
  // 兼容老接口：postProc 变量也指向同一 capability（对外 render/setSize/dispose 方法签名一致）
  const postProc = postProcCap;
  // 按模型类别套用预设
  postProcCap?.setPreset(adapter.id);
  // SSR↔Reflector 联动（postprocessing-capability.setReflectorCap）：SSR 开启时自动禁用单平面镜面，防 z-fighting
  postProcCap?.setReflectorCap(reflectorCap);
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
    lightCap,
    fogCap,
    shadowCap,
    reflectorCap,
    environmentCap,
    postProc,
    postProcCap,
  };
}

/** rAF 相机运动复用的 Vector3 实例（避免每帧 GC 分配）；mpUP 只读常量 */
const mpUP = new THREE.Vector3(0, 1, 0);

/** mpSyncShadowLights：ShadowCapability 同步光 castShadow（优先 setLightCap 精准注入 3 方向灯+聚光灯；
 *  再 scene.traverse 收集外部自定义灯走 syncLights 兜底），防误吞外部灯 */
function mpSyncShadowLights(scene: THREE.Scene, shadowCap: ShadowCapability, lightCap: LightCapability): void {
  shadowCap.setLightCap(lightCap);
  const lights: Array<THREE.DirectionalLight | THREE.SpotLight> = [];
  scene.traverse((obj) => {
    if ((obj as unknown as THREE.DirectionalLight).isDirectionalLight
      || (obj as unknown as THREE.SpotLight).isSpotLight) {
      lights.push(obj as THREE.DirectionalLight | THREE.SpotLight);
    }
  });
  shadowCap.syncLights(lights);
}

/** mpApplyWasdCameraMotion 的复用向量槽位（rAF loop 一次性创建，每帧传入） */
interface MpWasdReuse {
  camDir: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  move: THREE.Vector3;
}

/** mpApplyWasdCameraMotion：rAF 帧内 WASD/方向键 → 相机平移与焦点跟随（纯函数，无单例依赖；
 *  仅改传入 cam/ctr/ot 引用，移动向量经 reuse 复用，返回值 void） */
function mpApplyWasdCameraMotion(
  keys: Record<string, boolean>,
  cam: THREE.PerspectiveCamera,
  ctr: OrbitControls,
  camSpeed: number,
  dt: number,
  orbitMode: boolean,
  ot: THREE.Vector3,
  reuse: MpWasdReuse,
): void {
  cam.getWorldDirection(reuse.camDir);
  reuse.forward.set(reuse.camDir.x, 0, reuse.camDir.z).normalize();
  reuse.right.crossVectors(reuse.forward, mpUP).normalize();
  reuse.move.set(0, 0, 0);
  if (keys["w"] || keys["arrowup"]) reuse.move.add(reuse.forward);
  if (keys["s"] || keys["arrowdown"]) reuse.move.sub(reuse.forward);
  if (keys["a"] || keys["arrowleft"]) reuse.move.sub(reuse.right);
  if (keys["d"] || keys["arrowright"]) reuse.move.add(reuse.right);
  if (keys[" "]) reuse.move.y += 1;
  if (keys["shift"]) reuse.move.y -= 1;
  if (reuse.move.length() > 0) {
    reuse.move.normalize().multiplyScalar(camSpeed * dt);
    cam.position.add(reuse.move);
    if (orbitMode) ot.add(reuse.move);
  }
  if (orbitMode && ot) {
    ctr.target.copy(ot);
    ctr.update();
    ot.copy(ctr.target);
  } else {
    ctr.target.copy(cam.position).addScaledVector(reuse.camDir, 10);
    ctr.update();
  }
}

/** mpMakeUnifiedPickHandler：统一多模型拾取器工厂（仅 count>=2 激活，单模型完全沿用逐模型
 *  registerBoneRaycast，零回归）；renderer/camera/scene 显式注入，语义骨骼映射经模块级导入消费 */
function mpMakeUnifiedPickHandler(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
): (e: MouseEvent) => void {
  const raycaster = new THREE.Raycaster();
  const pickPointer = new THREE.Vector2();
  return (e: MouseEvent): void => {
    if (sceneRegistry.count() < 2) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pickPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pickPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pickPointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      // THREE Raycaster 不检查 visible，手动跳过隐藏链
      let node: THREE.Object3D | null = hit.object;
      let hidden = false;
      while (node) {
        if (!node.visible) { hidden = true; break; }
        node = node.parent;
      }
      if (hidden) continue;
      const entry = sceneRegistry.pickModelByObject(hit.object);
      if (!entry) continue;
      // 切活跃模型 + 换菜单（菜单会话级共享、后建覆盖前建，故需按归属换项）
      sceneRegistry.setActive(entry.id);
      if (entry.boneMaps) {
        const boneId = getMeshBoneId(hit.object, entry.boneMaps.nameMap);
        if (boneId) {
          const info = assembleBoneSelectInfo(
            boneId,
            entry.boneMaps.boneGroupMap,
            entry.boneMaps.nameMap,
            entry.boneMaps.parentMap,
            entry.boneMaps.childrenMap,
            hit.object,
          );
          entry.built.onBoneSelect?.(info);
          entry.onBonePick?.(boneId);
        }
      }
      break;
    }
  };
}
