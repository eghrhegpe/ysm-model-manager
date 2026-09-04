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
// ┌─ 快速跳转 ───────────────────────────────────────────────────────────────────┐// │  §1  常量 + 状态变量      → L176   TIP_AUTO_DISMISS_MS / PER_FRAME_WARN_*        │
// │  §2  公开 API             → L206   invalidatePreview / cleanupPreview / switch  │
// │  §3  switchPreview        → L245   会话内切换模型（复用外壳）                   │
// │  §4  mount3D 入口         → L285   主挂载函数（~650 行；§5 拆分后为编排器形态）    │
// │    └─ 头部装配            → L285   session 收敛体 + 闭包变量 + camBridge/menuCtx │
// │    └─ 基础设施锁定        → L474   buildSharedInfra + sc/cam/rd 局部锁定          │
// │    └─ 会话终结            → L489   finishSession / closeOverlay（幂等单出口）     │
// │    └─ 输入绑定 §4a        → L533   bindInputHandlers（input-and-animation.ts）   │
// │    └─ rAF 渲染管线 §4b    → L559   animate loop + postprocess composer          │
// │    └─ switchCtx 构造      → L652   switchToSession 参数胶水（switch-preview.ts） │
// │    └─ 生命周期管理 §4c    → L796   fullCleanup / escH 替换 / _handles.push        │
// │  MpSessionState           → L951   会话级可变状态收敛体（接口定义）              │
// └──────────────────────────────────────────────────────────────────────────────┘

import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { installUiComponentsStyles, uiComponentsStyleSheet } from "../../ui/ui-components-styles.ts";
import { slideMenuStyleSheet } from "../../ui/ui-slide-menu-styles.ts";
import { setOverlayStyleTarget, overlayStyleRoot, onOverlayStyleTargetReset } from "../overlay-style-bridge.ts";
import { PREVIEW_OVERLAY_ID } from "../../ui/ui-constants.ts";
import { logWarn } from "../../utils/core/log.ts";
import {
  rememberTrigger,
  returnFocus,
  trapFocusAcrossShadow,
} from "../../utils/dom/focus-restore.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import {
  clearModelRoots,
  cullModelGroups,
  isFrustumCullEnabled,
  restoreModelGroupsVisible,
} from "../frustum-cull.ts";
import type { TdKeyAction } from "../keymap.ts";
import { mountPreviewRootMenu, type PreviewMenuCtx, type PreviewMenuHandle } from "../menu/core.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import { mergeStatsMenuItems } from "../menu/stats.ts";
import { type BoneMaps, type BoneSelectInfo, loadTdCamSpeed, loadTdRotMode } from "../model3d.ts";
import {
  createAdaptiveRenderBudget,
  getFrameIntervalMs,
  PREVIEW_FRAME_INTERVAL_MS,
  previewPixelRatio,
  sampleAdaptivePixelRatio,
  shouldRenderAtFps,
} from "../render-budget.ts";
import { safeDispose } from "../safe-dispose.ts";
import { collectSceneStats } from "../scene-stats.ts";
import type { SemanticBoneMap } from "../semantic-bones.ts";
import { textureCache } from "../texture-cache.ts";
import type { CameraControlBridge } from "./camera-controls.ts";
import type { InputOptions } from "./input-and-animation.ts";
import { bindInputHandlers } from "./input-and-animation.ts";
import { showLoadFailure } from "./preview-loading.ts";
import { sceneRegistry } from "./scene-registry.ts";
// §5 拆分（2026 锐评整改）：场景单例/基础设施装配 → shared-infra.ts；
// WASD 相机运动 → wasd-camera.ts；统一拾取器 → unified-pick.ts；模型卸载 → unload-model.ts
import {
  clearSceneCaps,
  getSceneCaps,
  type SharedInfra,
  buildSharedInfra,
  resetSceneInfra,
} from "./shared-infra.ts";
import type { SwitchContext } from "./switch-preview.ts";
import { switchToSession, syncLightTargetFromContent } from "./switch-preview.ts";
import { makeUnifiedPickHandler } from "./unified-pick.ts";
import { unloadModel } from "./unload-model.ts";
import { applyWasdCameraMotion } from "./wasd-camera.ts";

/** 适配器构建时可用的通用外壳句柄（内容层据此注入场景/灯光/定相机） */
export interface PreviewBuildCtx {
  /** shared 模式下由核心创建并传入；self 模式（适配器自驱 renderer，如 ysm 单例）为 undefined */
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  controls?: OrbitControls;
  viewContainer: HTMLElement;
  loadingEl: HTMLElement;
  /** ADR-175 M1：overlay 内容实体所在作用域（shadowRoot；降级 light DOM 时为 host 本体） */
  overlay: HTMLElement | ShadowRoot;
  /** shared 模式下核心创建的 renderer（适配器射线拾取 / 截图 / 内容挂载用；self 模式 undefined） */
  renderer?: THREE.WebGLRenderer;
  /** shared 模式下核心的相机控制桥（旋转/速度/重置，操作核心内部状态；self 模式 undefined） */
  cameraControls?: CameraControlBridge;
  /** [Bug A] 当前 mount 会话稳定 id（per-mount 自增，新鲜 mount 生成；switchTo 复用外壳不换）。
   *  适配器据此做 per-scene schema key（如 ysm-model-{sid}）——多模型同框防互相覆盖。
   *  测试/旧调用无 sessionId 时缺省 undefined，适配器退化旧全局键（兼容不破）。 */
  sessionId?: string;
  /** 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；延迟闭包——build 时 _handle 未赋值，点击时已就绪 */
  switchTo?(path: string, options?: { keepInScene?: boolean }): Promise<void>;
  /** 声明式根菜单注册通道（ADR-076 v2 Phase 2）：适配器 build 内经 setAdapterItems 注入专属菜单项、openPanel 打开面板（骨骼拾取联动） */
  menu: PreviewMenuHandle;
}

/**
 * 适配器返回的内容场景契约（对齐 Model3DHandleX）。
 * 字段分层（P1#3 审计定论）：
 * - 硬契约：仅 dispose——cleanupPreview 无条件遍历调用（_handles → handle.cleanup →
 *   fullCleanup → content.dispose），缺失会 GPU 泄漏；6 格式适配器全实现。
 * - 能力可选：其余全部可选（接口注释"便于纯静态渲染"是有意设计）——update 供动态
 *   内容（动画/SpringBone/感知），静态体素（litematic/pack）不实现；resetCamera /
 *   setRotationMode / setSpeed / showModelGroup 等控制面按格式能力实现。
 * - 消费方一律 `?.` 特性探测（mount-preview-core L784 perFrame=content.update ?? null、
 *   L891 resetCamera/screenshot 透传 PreviewHandle 后再 ?.），缺字段 = 功能降级而非崩溃。
 * - 新增适配器：dispose 必须实现；其余按格式能力"有就实现、没有就不实现"，勿为凑
 *   字段数补空实现（空 update 是噪音，不是契约完整）。
 */
export interface PreviewScene {
  /** 每帧驱动（VRM SpringBone / 动画等）；无则仅静态渲染 */
  update?(dt: number): void;
  /** 释放内容层 GPU 资源（几何/材质/纹理/helper）——硬契约，cleanup 无条件调用 */
  dispose(): void;
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  showModelGroup?(i: number): void;
  onBoneSelect?(info: BoneSelectInfo): void;
  /** 语义骨骼映射（语义骨骼层消费方读取；无 = 该格式不接入语义层，消费方降级） */
  semanticBones?: SemanticBoneMap | undefined;
  /** 应用 VPD 姿势（MMD 专属；无 = 该格式不支持） */
  applyPose?: ((index: number) => void) | undefined;
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
  /**
   * 适配器标识（P1#2 审计定论：非自由命名——是 rtype / preview-key 契约的镜像）：
   * - 与 Go resource_types.json 的 rtype ID 或 variants preview key 对齐（"mmd"/"vrm"/
   *   "fbx"/"ysm"/"litematic"/"resourcepack"/"mmd-scene" 均为既有契约字符串）
   * - 消费方：mount3D 的 getCurrentRtype 回退、caps 预设表按它分派
   *   （shadow/sky/light/env/fog/postprocessing 的 PRESET_BY_MODEL 类表；未知 id 落 default）
   * - 新增格式勿发明新命名风格——直接沿用对应 rtype/preview key 值
   */
  id: string;
  /** "shared"（默认）：核心创建 renderer/scene/controls 并驱循环；"self"：适配器自驱（如 ysm 单例），核心仅提供外壳 */
  mode?: "shared" | "self";
  build(ctx: PreviewBuildCtx, path: string): Promise<PreviewScene>;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：供适配器复位调用方状态、注销平台返回键等 */
  onClose?: (() => void) | undefined;
}

/** 统一预览句柄（D 步 ysm 接入时经此暴露内容层方法） */
export interface PreviewHandle {
  cleanup(): void;
  resetCamera?: (() => void) | undefined;
  setRotationMode?: ((orbit: boolean) => void) | undefined;
  setSpeed?: ((n: number) => void) | undefined;
  showModelGroup?: ((i: number) => void) | undefined;
  onBoneSelect?: ((info: BoneSelectInfo) => void) | undefined;
  /** 当前会话内切换到另一模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6） */
  switchTo?(path: string, options?: { keepInScene?: boolean }): Promise<void>;
  /** 截取当前 3D 渲染画面（PNG base64，无 data: 前缀）—— ADR-052 P3 通用化 */
  screenshot?: (() => Promise<string | null>) | undefined;
}

// ===== §1 常量 + 状态变量 =====
// 相机控制常量（buildCameraControls 已拆至 camera-controls.ts，本文件保留自身仍使用的部分：
// DRAG_ROTATE_SENSITIVITY 拖拽旋转 / TIP_AUTO_DISMISS_MS 提示自动消失）
// camSpeed 默认值已由 keymap.ts loadTdCamSpeed()（默认 20）提供，会话初始化时读取偏好。
// §1.5 P1 批次9:overlay 链静态 cssText 抽类集中注入(mount3D 内 ensureMpcStyles 幂等调用)
// ADR-175 M1:overlay shadow host 化——内容迁入 shadowRoot 后 head 注入穿不透边界,
// 首条规则改 `:host` 承载宿主自身布局(降级 light DOM 路径由 .mpc-overlay 选择器兜底);
// 注入目标经 overlay-style-bridge 迁移(shadow root / 无 overlay 时 head 兜底)。
const mpcCss = `
:host, .mpc-overlay { position:fixed; inset:0; z-index:var(--z-fullscreen); background:#11111b; display:flex; flex-direction:column; }
.mpc-body { flex:1; display:flex; position:relative; overflow:hidden; }
.preview-view-container.mpc-view { flex:1; position:relative; overflow:hidden; }
.mpc-loading { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; color:rgba(255,255,255,0.6); font-size:14px; gap:12px; z-index:10; }
.mpc-tip { padding:5px 12px; background:#1b1c24; border-bottom:1px solid rgba(255,255,255,.08); color:rgba(255,255,255,.7); font-size:11px; text-align:center; flex-shrink:0; }
`;
let _mpcStylesInjected = false;
onOverlayStyleTargetReset(() => { _mpcStylesInjected = false; });
function ensureMpcStyles(): void {
  if (_mpcStylesInjected) return;
  _mpcStylesInjected = true;
  const el = document.createElement("style");
  el.textContent = mpcCss;
  overlayStyleRoot().appendChild(el);
}

const TIP_AUTO_DISMISS_MS = 6000;
/** perFrame 回调单次执行超过该阈值（ms）即告警（仅测回调段，非整帧） */
const PER_FRAME_WARN_MS = 50;
/** 告警节流间隔：持续超阈值帧最多每 N ms 报一条，防刷屏加重卡顿 */
const PER_FRAME_WARN_THROTTLE_MS = 5000;

let _gen = 0;
/** [Bug A] mount 会话序号（per-mount 唯一 id 来源；switchTo 复用外壳不递增） */
let _mountSessionSeq = 0;
/** 上次 perFrame 告警时间戳（节流用） */
let _lastPerFrameWarnTs = 0;

/** 模块级全局 overlay（仅 cleanupPreview 时才移除，多次 mount3D 复用同一 DOM） */
let _singletonOverlay: HTMLElement | null = null;
let _singletonBody: HTMLElement | null = null;
/** 共享视窗容器（.preview-view-container：canvas 所在格子）：随外壳首次创建、后续复用 */
let _singletonViewContainer: HTMLElement | null = null;
/** 所有已挂载的 PreviewHandle（cooperate 模式下多模型各自独立） */
const _handles: Array<{ handle: PreviewHandle; gen: number }> = [];
/** rAF 全局唯一标识和 perFrame 回调列表（共享同一 renderer） */
let _globalAnimId = 0;
const _globalPerFrames: Array<(dt: number) => void> = [];
// 场景级单例（_singletonScene/_singletonCamera/_singletonRenderer/_singletonControls/_sceneCaps）
// 已随 §5 拆分收敛至 shared-infra.ts（resetSceneInfra / clearSceneCaps / getSceneCaps 访问）。

/** 任意新预览派发时调用，作废在途加载（对齐 invalidateVrmPreview / invalidateLitematicPreview） */
export function invalidatePreview(): void {
  _gen++;
}

/** 清理所有 3D 预览（dispose content + 移除 scene children，保留 renderer/canvas/overlay 存活避免黑屏） */
export function cleanupPreview(): void {
  _gen++;
  // 快照遍历：handle.cleanup() → fullCleanup → finishSession 会从 _handles 摘除自身，
  // 边遍历边删会跳元素（cooperate 多会话场景只清掉一半），故先复制一份
  for (const h of [..._handles]) {
    try {
      h.handle.cleanup();
    } catch (_) {}
  }
  _handles.length = 0;
  // renderer/canvas/overlay 保留（下次 mount3D 直接复用，不重建 DOM）
  // 但 _singletonOverlay/_singletonBody/_singletonViewContainer 必须清零：handle.cleanup→
  // fullCleanup 已从 DOM 移除它们，保留旧引用会导致下次 mount3D 复用已脱离文档的
  // detached element（测试 afterEach 尤其敏感）。
  _singletonOverlay = null;
  _singletonBody = null;
  _singletonViewContainer = null;
  // ADR-175 M1：overlay 单例已拆除——注入目标还原 head 兜底并复位全部 ensure* 旗标
  //（下次 mount3D 建新 shadow root 时会重注入）
  setOverlayStyleTarget(null);
  resetSceneInfra();
}

/** 测试用：重置所有模块级单例状态（不影响生产代码路径） */
export function _resetSingletons(): void {
  _singletonOverlay = null;
  _singletonBody = null;
  _singletonViewContainer = null;
  setOverlayStyleTarget(null); // ADR-175 M1：同 cleanupPreview——旗标复位防跨用例串目标
  resetSceneInfra();
  _globalAnimId = 0;
  _globalPerFrames.length = 0;
  // [审核修复] mount 会话序号同属模块级单例态：重置后 sessionId 生成确定性可测
  // （否则跨用例单调递增，断言 per-scene key 形状的测试会顺序依赖）
  _mountSessionSeq = 0;
}

/** 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；无活跃会话时 no-op */
export async function switchPreview(
  path: string,
  options?: { keepInScene?: boolean },
): Promise<void> {
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
  switchExternal?: (
    path: string,
    siblings?: string[],
    options?: { keepInScene?: boolean },
  ) => Promise<void>;
  /** 当前会话资源类型（如 ysm/EntityPlayer/vrm/resourcepack）；类型 tab 点击时判断同类型走 switchTo */
  rtype?: string;
  /** 当前会话子类型（如 EntityPlayer/CustomAnim）——用于类型 tab 扫描时按 subtype 隔离扩展名 */
  subtype?: string;
  /** 按资源类型懒加载候选模型路径（切换模型的类型 tab 点击时；缺省无 tab） */
  getModelsByType?: (rtype: string, subtype?: string) => Promise<string[]>;
  /** 类型 tab 列表（有 3D opener 的类型；经 withPreviewExtras 注入，缺省仅「当前目录」tab） */
  getTypeTabs?: () => string[];
  /** [ADR-159] 实体展示名（容器类格式：资源包 = zip 名）；透传 sceneRegistry entry.displayName */
  displayName?: string;
  /** [ADR-159] 容器组件列表（资源包 = zip 内全部模型 entry）；透传 sceneRegistry entry.components */
  components?: string[];
}

export async function mount3D(
  adapter: PreviewAdapter,
  path: string,
  opts: Mount3DOptions = {},
): Promise<void> {
  // 焦点记忆：记下当前 activeElement 作为关闭时 returnFocus 的目标
  // （FAB 按钮的 onclick 触发 mount3D → activeElement 即触发按钮）
  rememberTrigger();
  // 复用单例外壳（renderer/canvas/overlay/scene 存活），首次 mount3D 创建，后续复用。
  // cooperate=true 时多个模型叠加在同一 scene；cooperate=false 时先清除旧模型再加载新模型。
  installUiComponentsStyles();
  ensureMpcStyles(); // P1 批次9:overlay 链 cssText 抽类注入(幂等)
  const myGen = ++_gen;
  const selfMode = adapter.mode === "self";
  // [Bug A] per-mount 会话稳定 id：每次 mount3D 自增（含 switchTo 重建？否——switchTo 走
  // switch-preview 复用外壳，不重新 mount；此处仅新鲜 mount 生成）。适配器 build 经
  // ctx.sessionId 读取，供 per-scene schema key（ysm-model-{sid}）注册/注销对齐。
  const sessionId = `s${++_mountSessionSeq}`;

  // ---- 收敛：session 级可变状态（原 14 个裸 let，统一经此对象读写）----
  const session: MpSessionState = {
    currentPath: path,
    isDisposed: { v: false },
    finished: false,
    aborted: { v: false },
    cleanupFn: null,
    // 相机偏好从 localStorage 读取（keymap.ts 同源：速度默认 20，环绕模式默认 orbit）
    camSpeed: loadTdCamSpeed(),
    orbitMode: loadTdRotMode(),
    euler: new THREE.Euler(0, 0, 0, "YXZ"),
    content: null,
    sceneBaseline: null,
    allContent: [],
    perFrame: null,
    onUnifiedPick: null,
    escH: () => {},
    tipTimeoutId: undefined,
  };

  // input 状态（不进 session：bindInputHandlers 已显式接收 keys/mouseDown/lastMouse）
  const keys: Partial<Record<TdKeyAction, boolean>> = {};
  let mouseDown = false;
  const lastMouse = { x: 0, y: 0 };

  // infra（scene/camera/renderer/controls/orbitTarget + 全部 cap）由 buildSharedInfra
  // 一次性构造返回；self 模式下 infra 保持 null，所有访问经 infra?. 短路为 undefined。
  let infra: SharedInfra | null = null;

  // 事件 handler（仅一次性赋值，cleanupCtx 按值快照；不进 session）
  let onKeyDown: (e: KeyboardEvent) => void = () => {};
  let onKeyUp: (e: KeyboardEvent) => void = () => {};
  let onDragPointerDown: (e: PointerEvent) => void = () => {};
  let onDragPointerUp: (e: PointerEvent) => void = () => {};
  let onDragPointerMove: (e: PointerEvent) => void = () => {};
  let onResize: () => void = () => {};
  // resize rAF 在途帧取消（input-and-animation 新增；fullCleanup 同步 cancel 防幽灵 setSize）
  let cancelPendingResize: (() => void) | undefined = undefined;

  // 焦点陷阱 cleanup（每次 mount3D 新建，closeOverlay / fullCleanup 释放）
  let focusTrapCleanup: (() => void) | null = null;

  // 单例外壳：首次创建，后续 mount3D 复用同一 DOM（避免重建导致黑屏）
  let overlay = _singletonOverlay;
  let body = _singletonBody;
  // ADR-175 M1：overlay = shadow host（挂 document.body 保留 id/class/aria，app-tree
  // getElementById 守卫零改动）；全部内容（tip/body/viewContainer/菜单链）迁入 shadowRoot。
  // attachShadow 缺失（behavior.test fake document 等环境）降级 light DOM——root 即 overlay 本体，
  // 样式注入走 head 兜底，与迁移前行为一致。
  // 复用路径（单例存活）从 host 取回既有 shadowRoot，不走重建分支。
  let root: HTMLElement | ShadowRoot;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = PREVIEW_OVERLAY_ID;
    overlay.className = "mpc-overlay";
    // 无障碍：3D 全屏预览是模态体验——告诉屏幕阅读器这是对话框、独占焦点、名称用
    // 已有 preview.title3d i18n key（与 FAB aria-label 同源，3 语言包已同步）
    // D3：aria 挂 host（host 在 document 树，语义对屏幕阅读器可见）
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", t("preview.title3d"));
    document.body.appendChild(overlay);
    const shadow = typeof overlay.attachShadow === "function" ? overlay.attachShadow({ mode: "open" }) : null;
    root = shadow ?? overlay;
    if (shadow) {
      // 共享样式模块走 adoptedStyleSheets（与全站 shadow 组件同形态；head 注入由
      // installUiComponentsStyles 兜底路径承担，不冲突）。失败仅影响样式，不阻断挂载。
      try {
        shadow.adoptedStyleSheets = [uiComponentsStyleSheet, slideMenuStyleSheet].filter(
          (s): s is CSSStyleSheet => s != null,
        );
      } catch (err) {
        logWarn("preview-3d", `adoptedStyleSheets 安装失败（降级 head 注入）: ${String(err)}`);
      }
    }
    // 注入目标切到本 shadow root（或降级的 overlay 本体）——全部 ensure* 旗标复位重注入
    setOverlayStyleTarget(root);
    ensureMpcStyles(); // 首建即注入 mpc 规则（:host 布局在 root 内生效）
    body = document.createElement("div");
    body.className = "mpc-body";
    root.appendChild(body);
    _singletonOverlay = overlay;
    _singletonBody = body;
  } else {
    // 复用路径：从 host 取回既有 shadowRoot（降级环境无 shadowRoot → host 本体）
    root = overlay.shadowRoot ?? overlay;
  }
  // 焦点陷阱：ADR-175 M1 后 overlay 内容实体在 host.shadowRoot 内，
  // trapFocusAcrossShadow 的跨 shadow 下钻从防御性兜底转正为实际路径（D3）
  if (!focusTrapCleanup) {
    focusTrapCleanup = trapFocusAcrossShadow(overlay);
  }
  // viewContainer 复用模块级单例（与 scene/canvas 同寿命；创建逻辑见下方 §3 UI 装配）

  // 顶栏已移除（ADR-076 v2，用户 2026-08-16 决策）：预览控件全部收进
  // 声明式根菜单（⚙️ 按钮 → mountPreviewRootMenu），彻底告别顶栏滑块垃圾。
  // litematic 分层切片面板也经 schemaId 注册（registerSchema builder）注入根菜单模型组。

  // 相机控制桥（shared 模式）：core 的相机控件与 PreviewBuildCtx.cameraControls
  // 共用同一 bridge（操作核心内部 orbitMode/camSpeed/controls），适配器（如 ysm 底部
  // 导航）经 cameraControls 复用同一套相机状态。相机控件本身已收进声明式根菜单的 camera 项。
  const camBridge: CameraControlBridge = {
    getOrbit: () => session.orbitMode,
    setOrbit: (v: boolean) => {
      const i = infra; // camBridge 仅经 cameraControls 在 build 后使用；self 模式不调用
      if (!i) return;
      session.orbitMode = v;
      i.controls.enableRotate = v;
      if (v) {
        i.orbitTarget.copy(i.controls.target);
      } else {
        session.euler.setFromQuaternion(i.camera.quaternion);
      }
      mouseDown = false;
    },
    getSpeed: () => session.camSpeed,
    setSpeed: (n: number) => {
      session.camSpeed = n;
    },
    // content 在 try 块内声明，此处经模块级 _handle（PreviewHandle 含 resetCamera? 契约）延迟调用
    reset: () => {
      _handles[_handles.length - 1]?.handle.resetCamera?.();
    },
  };

  // viewContainer：与 scene/canvas 同属共享外壳——首次 mount3D 创建，后续复用同一
  // 视窗（多模型同台共用同一 canvas，而非每次 mount3D 新建空容器；回归：曾反复 new
  // 容器导致同台后多出空白分屏）
  if (!_singletonViewContainer) {
    const c = document.createElement("div");
    c.className = "preview-view-container mpc-view"; // 语义锚点类保留,布局样式入 .mpc-view(双类防将来锚点规则覆盖)
    body!.appendChild(c);
    _singletonViewContainer = c;
  }
  const viewContainer = _singletonViewContainer;

  // 声明式根菜单（⚙️）：core 在 overlay 内自建（预览全屏盖住 app 外壳，主程序 nav.settings 够不着），
  // 全部控件以 CORE_MENU_ITEMS + 适配器注入项表驱动渲染（preview-menu/defs.ts），
  // 测试遍历真实菜单数组断言（preview-menu/items.test.ts），选择器稳定可遍历（ADR-076 v2）。
  const menuCtx: PreviewMenuCtx = {
    selfMode,
    getCap: (id: string) => sceneCapabilityRegistry.getById(id) ?? null,
    getCamBridge: () => camBridge,
    getSiblings: () => (opts.siblings ?? []).filter((p) => p !== session.currentPath),
    getCurrentPath: () => session.currentPath,
    getCurrentRtype: () => (opts.rtype && opts.rtype.trim() ? opts.rtype : adapter.id),
    getCurrentSubtype: () => opts.subtype ?? "",
    getViewContainer: () => viewContainer,
    close: () => {
      if (session.cleanupFn) session.cleanupFn();
      else closeOverlay();
    },
    switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> | void => {
      const active = _handles[_handles.length - 1];
      const r = active?.handle.switchTo?.(p, options);
      // 透传 Promise：调用方（fillSwitch 替换/追加）在完成后局部刷新面板（renderRows 重读新当前路径）
      if (r) {
        void r.catch((err: unknown) =>
          logWarn("preview-menu", `switchTo 切换失败: ${String(err)}`),
        );
        return r;
      }
      return undefined;
    },
    unloadModel: unloadSessionModel,
    toast: (msg: string): void => {
      bus.emit("toast:show", { msg, duration: TOAST_MS.normal });
    },
    closeAllOverlays: (): void => {
      menuHandle.dispose();
    },
  };
  // getModelsByType / getTypeTabs / switchExternal 是 PreviewMenuCtx 可选键（menu/core.ts，
  // 非本域）——exactOptional 收紧后仅真实存在时赋值，避免显式 undefined 流入
  if (opts.getModelsByType) menuCtx.getModelsByType = (t, s) => opts.getModelsByType!(t, s);
  if (opts.getTypeTabs) menuCtx.getTypeTabs = () => opts.getTypeTabs!();
  if (opts.switchExternal)
    menuCtx.switchExternal = (p: string, s?: string[], options?: { keepInScene?: boolean }): void => {
      const r = opts.switchExternal!(p, s, options) as Promise<void> | void;
      if (r && typeof r.catch === "function") {
        void r.catch((err: unknown) =>
          logWarn("preview-menu", `switchExternal 切换失败: ${String(err)}`),
        );
      }
    };
  const menuHandle = mountPreviewRootMenu(root, menuCtx);
  // ADR-093 T5：注册表菜单 sink（selectModel 时按活跃模型换菜单项）
  sceneRegistry.setMenuSink({ setAdapterItems: (items) => menuHandle.setAdapterItems(items) });

  const loadingEl = document.createElement("div");
  loadingEl.className = "mpc-loading";
  viewContainer.appendChild(loadingEl);

  // ===== §4 基础设施创建（scene/camera/renderer/OrbitControls/灯光/resize）=====
  // session.aborted 已在 mount3D 头部 session 对象初始化时声明。
  // 可变 ESC 处理函数：switchTo 后重新赋值
  session.escH = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (session.cleanupFn) session.cleanupFn();
      else closeOverlay();
    }
  };
  /**
   * 会话收尾（幂等，closeOverlay 早期路径与 fullCleanup post-build 路径共用）：
   * 摘句柄 → 通知调用方 → 无障碍焦点归还。
   * 必须单一出口：ESC 早期中断会先走 closeOverlay，build 随后 resolve 时中止守卫
   * 又会进入 fullCleanup，两条路径都会调到这里——不幂等则 onClose 会重复触发。
   */
  function finishSession(): void {
    if (session.finished) return;
    session.finished = true;
    // 从模块级 handles 列表移除当前 session（hasActivePreview 以该列表为依据）
    const idx = _handles.findIndex((h) => h.gen === myGen);
    if (idx >= 0) _handles.splice(idx, 1);
    // 无障碍：释放焦点陷阱 + 把焦点还给触发 3D 的 FAB 按钮（rememberTrigger 在
    // mount3D 入口已记下 activeElement；元素已离文档时 returnFocus 静默跳过）
    focusTrapCleanup?.();
    focusTrapCleanup = null;
    returnFocus();
    // 通知调用方会话已关闭（UI 状态复位 / android-back 注销依赖此回调）
    adapter.onClose?.();
  }

  function closeOverlay(): void {
    session.aborted.v = true;
    document.removeEventListener("keydown", session.escH);
    // 早期路径（cleanupFn 尚未赋值）：清理 tip 定时器 + 菜单，再拆 overlay
    if (session.tipTimeoutId) {
      clearTimeout(session.tipTimeoutId);
      session.tipTimeoutId = undefined;
    }
    menuHandle.dispose();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    finishSession();
  }
  document.addEventListener("keydown", session.escH);

  if (!selfMode) {
    infra = buildSharedInfra(adapter, viewContainer, menuHandle);
    // 块内 infra 已非 null（buildSharedInfra 必返回完整对象）；用局部 const 锁定非空，
    // 避免 animate 闭包穿越控制流回退到 SharedInfra | null。
    const sc = infra.scene;
    const cam = infra.camera;
    const rd = infra.renderer;
    const ctr = infra.controls;
    const ot = infra.orbitTarget;
    const lightCap = infra.lightCap;
    const postProc = infra.postProc;
    // 偏好同步：自由模式（orbitMode=false）关闭 OrbitControls 自身旋转，
    // 拖拽自转走 input-and-animation 的 euler 桥（对齐 camBridge.setOrbit 语义）
    infra.controls.enableRotate = session.orbitMode;

    // ===== §4a 输入绑定（WASD 键盘 + 拖拽自转 + resize）=====
    const inputOpts: InputOptions = {
      keys,
      getOrbitMode: () => session.orbitMode,
      mouseDown: { v: mouseDown },
      lastMouse: { x: lastMouse.x, y: lastMouse.y },
      euler: session.euler,
      camera: cam,
      renderer: rd,
      postProc: infra.postProc,
      viewContainer,
      isDisposed: session.isDisposed,
    };
    const handlers = bindInputHandlers(inputOpts);
    onKeyDown = handlers.onKeyDown;

    // ADR-093 T5：统一多模型拾取器（仅 count>=2 激活，单模型完全沿用逐模型 registerBoneRaycast，零回归）
    session.onUnifiedPick = makeUnifiedPickHandler(rd, cam, sc);
    rd.domElement.addEventListener("click", session.onUnifiedPick);
    onKeyUp = handlers.onKeyUp;
    onDragPointerDown = handlers.onDragPointerDown;
    onDragPointerUp = handlers.onDragPointerUp;
    onDragPointerMove = handlers.onDragPointerMove;
    onResize = handlers.onResize;
    cancelPendingResize = handlers.cancelPendingResize;

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
        // 推进逐帧动态效果（水面波纹/弹簧骨骼等；能力自行决定是否需要更新）
        for (const c of getSceneCaps()) c.update?.(dt);
        applyWasdCameraMotion(keys, cam, ctr, session.camSpeed, dt, session.orbitMode, ot, {
          camDir: _camDir,
          forward: _forward,
          right: _right,
          move: _move,
        });
        // 驱动所有 session 的 perFrame 回调
        for (const fn of _globalPerFrames) {
          const pfStart = performance.now();
          try {
            fn(dt);
          } catch (err) {
            logWarn("perFrame", `session 回调异常: ${String(err)}`);
          }
          const pfMs = performance.now() - pfStart;
          const pfNow = performance.now();
          if (
            pfMs > PER_FRAME_WARN_MS &&
            pfNow - _lastPerFrameWarnTs > PER_FRAME_WARN_THROTTLE_MS
          ) {
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
  tip.className = "mpc-tip";
  tip.textContent = "WASD 移动 · 空格/Shift 上下 · 拖动旋转 · 滚轮缩放 · ESC 关闭";
  root.insertBefore(tip, body);
  // 保存 timeoutId 供 cleanup 时 clearTimeout（收敛进 session.tipTimeoutId）
  session.tipTimeoutId = setTimeout(() => {
    if (tip.parentNode) tip.remove();
  }, TIP_AUTO_DISMISS_MS);

  // session.cleanupFn / session.content / session.sceneBaseline / session.allContent
  // 已在 mount3D 头部 session 对象初始化时声明，此处不再重复 let。

  // 清理统一内联于下方 fullCleanup（原 cleanup-3d.ts 的 runFullCleanup/CleanupContext 是
  // 从未被调用的僵尸实现，已随本次修复删除——单一事实来源，杜绝双清理路径漂移）。

  const switchCtx: SwitchContext = {
    scene: infra?.scene,
    getSceneBaseline: () => session.sceneBaseline,
    setSceneBaseline: (s) => {
      session.sceneBaseline = s;
    },
    getContent: () => session.content,
    setContent: (s) => {
      session.content = s;
    },
    allContent: session.allContent,
    loadingEl,
    viewContainer,
    overlay,
    menuHandle,
    adapter: { build: adapter.build.bind(adapter) },
    camBridge,
    selfMode,
    sessionId,
    renderer: infra?.renderer,
    controls: infra?.controls,
    orbitTarget: infra?.orbitTarget,
    camera: infra?.camera,
    lightCap: infra?.lightCap ?? null,
    shadowCap: infra?.shadowCap ?? null,
    environmentCap: infra?.environmentCap ?? null,
    getCurrentPath: () => session.currentPath,
    setCurrentPath: (p) => {
      session.currentPath = p;
    },
    getCurrentRtype: () => (opts.rtype && opts.rtype.trim() ? opts.rtype : adapter.id),
    getCurrentSubtype: () => opts.subtype ?? "",
    getPerFrame: () => session.perFrame,
    setPerFrame: (f) => {
      // 切换模型时先从全局 perFrame 列表移除旧回调（防已 dispose 的旧内容层
      // update 持续执行），再注册新回调——移除/注册对称维护，初次 mount 与
      // 切换统一经此注册（rAF 引导块不再一次性 push）
      const old = session.perFrame;
      if (old) {
        const idx = _globalPerFrames.indexOf(old);
        if (idx >= 0) _globalPerFrames.splice(idx, 1);
      }
      session.perFrame = f;
      // P3 对称维护：新回调非空时重新注册，否则列表与 perFrame 引用脱节
      // （初次 mount 与切换统一经 setPerFrame 注册，取代 595 行的一次性 push）
      if (f) _globalPerFrames.push(f);
    },
    getHandle: () => _handles[_handles.length - 1]?.handle ?? null,
    aborted: session.aborted,
    inFlight: false,
    isDisposed: session.isDisposed,
    myGen,
    getGen: () => _gen,
  };

  /**
   * 卸载单个模型实例（角色面板 ⚙ → 卸载模型，MikuMikuAR buildModelToolsLevel 移植）：
   * 移除其场景根节点 + 释放内容层 GPU + 注册表注销（焦点自动转移）+ 相机取景重算。
   * 函数声明提升：引用 allContent（§4 声明）在调用时已初始化。
   */
  function unloadSessionModel(id: string): void {
    unloadModel(
      {
        allContent: session.allContent,
        scene: infra?.scene,
        controls: infra?.controls,
        camera: infra?.camera,
        menuHandle,
        getContent: () => session.content,
        setPerFrame: (f) => switchCtx.setPerFrame(f),
        // 从全局 perFrame 列表移除指定回调（原 unloadModel 内联 _globalPerFrames splice 逻辑）
        removePerFrame: (f) => {
          const idx = _globalPerFrames.indexOf(f);
          if (idx >= 0) _globalPerFrames.splice(idx, 1);
        },
      },
      id,
    );
  }

  try {
    // 代际守卫：await 期间用户已点其他文件 / 被 invalidate，丢弃本次挂载
    if (myGen !== _gen) return;

    const i = infra; // self 模式 infra=null，跳过 sceneBaseline；shared 模式恒非空
    if (i) session.sceneBaseline = new Set(i.scene.children);
    const buildCtx: PreviewBuildCtx = {
      viewContainer,
      loadingEl,
      overlay: root, // ADR-175 M1：适配器内容插入目标 = root（shadow 内），非 host
      menu: menuHandle,
      // 延迟闭包：build 时 _handle 尚未赋值，菜单点击（build 之后）时已就绪；
      // 无活跃会话时 no-op（与 switchPreview 同口径）
      switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> => {
        const active = _handles[_handles.length - 1];
        return active?.handle.switchTo?.(p, options) ?? Promise.resolve();
      },
    };
    // scene/camera/controls/renderer/cameraControls/sessionId 为可选项——
    // exactOptional 收紧后仅真实存在时赋值（shared 模式有值，self 模式缺省）
    if (i?.scene !== undefined) buildCtx.scene = i.scene;
    if (i?.camera !== undefined) buildCtx.camera = i.camera;
    if (i?.controls !== undefined) buildCtx.controls = i.controls;
    if (i?.renderer !== undefined) buildCtx.renderer = i.renderer;
    if (!selfMode && camBridge) buildCtx.cameraControls = camBridge;
    if (sessionId !== undefined) buildCtx.sessionId = sessionId;
    session.content = await adapter.build(buildCtx, path);
    if (session.aborted.v || myGen !== _gen) {
      // 加载期间被 ESC / invalidate 打断：完整拆除（含 rAF 循环与 WebGL renderer），
      // 避免外壳资源泄漏；内容层 GPU 资源经 fullCleanup 一并释放。
      // 注意：会话登记进 allContent 发生在下方（build 成功之后），此处必须补登记，
      // 否则刚 build 完的内容层不在 dispose 列表里 → GPU 资源泄漏。
      if (session.content && !session.allContent.includes(session.content)) {
        session.allContent.push(session.content);
      }
      fullCleanup();
      return;
    }
    // 注意：loadingEl 的移除交由适配器在成功路径自行处理（旧 vrm/litematic 即在
    // build 内 loadingEl.remove()）；空数据/错误等场景适配器会把提示写在 loadingEl
    // 并保留它，核心不在此强制移除。

    // 同步通用相机状态到适配器已设定的取景（包围盒/尺寸定相机）——仅 shared 模式
    if (i) {
      i.orbitTarget.copy(i.controls.target);
      session.euler.setFromQuaternion(i.camera.quaternion);
      // ADR-081 L1：内容层包围盒 -> 聚光灯/体积光锥瞄准对象上方
      syncLightTargetFromContent(i.scene, session.sceneBaseline, i.lightCap ?? null);
      // 首模型 mesh castShadow / receiveShadow（内容层根节点 = 刚注册的 added）
      if (i.shadowCap && session.content) {
        const roots = session.sceneBaseline
          ? i.scene.children.filter((c) => !session.sceneBaseline!.has(c))
          : [];
        i.shadowCap.applyMeshCasts(roots);
      }
      // 首模型 mesh envMapIntensity 同步
      if (i.environmentCap && session.content) {
        const roots = session.sceneBaseline
          ? i.scene.children.filter((c) => !session.sceneBaseline!.has(c))
          : [];
        i.environmentCap.syncMeshIntensity(roots);
      }
    }
    switchCtx.setPerFrame(session.content.update ?? null);
    // ===== §4c 生命周期管理（cooperate/switchTo/代际守卫）=====
    // 记录初始模型到追加列表（cooperate 模式下 fullCleanup 需逐一 dispose）
    if (session.content) session.allContent.push(session.content);
    // ADR-093 T2：首模型注册进场景注册表（roots 经 scene.children 差量捕获）
    if (session.content) {
      const added =
        infra && session.sceneBaseline
          ? infra.scene.children.filter((c) => !session.sceneBaseline!.has(c))
          : [];
      // ADR-131 P1：post-build 采集场景统计，合并统计面板进菜单（「能渲染就能出统计」）
      const stats = collectSceneStats(added);
      const menuItems = mergeStatsMenuItems(session.content.menuItems, stats);
      sceneRegistry.register({
        path,
        rtype: opts.rtype ?? adapter.id,
        roots: added,
        content: session.content,
        boneMaps: session.content.boneMaps ?? null,
        menuItems,
        onBonePick: session.content.onBonePick ?? null,
        displayName: opts.displayName,
        components: opts.components,
      });
      // ADR-076 v2 Phase 3：注册后立刻注入菜单项，否则 dock-menu 无适配器专属控件
      // （ADR-131 §2.3：统计面板已并入 menuItems，一次注入不覆盖）
      if (menuItems.length > 0) menuHandle.setAdapterItems(menuItems);
    }

    // ADR-076 v2 Phase 3：适配器控件全部经声明式根菜单注入（ctx.menu.setAdapterItems / content.menuItems）
    // 不再有 topBar 或 sidePanel 额外挂载

    function fullCleanup(): void {
      // P0 修复：中止/退出路径完整拆除 DOM + 解绑监听，防泄漏
      // ① ESC 监听器（escH 经 L792 可能已被替换，移除当前引用）
      document.removeEventListener("keydown", session.escH);
      // ② 提示条定时器
      if (session.tipTimeoutId) {
        clearTimeout(session.tipTimeoutId);
        session.tipTimeoutId = undefined;
      }
      // ③ 声式根菜单（移除 dock/popup + 解绑 view click 监听）
      menuHandle.dispose();
      // ④ viewContainer（含 loadingEl；首次挂载时可能含 renderer.domElement）
      if (viewContainer.parentNode) viewContainer.parentNode.removeChild(viewContainer);
      // ⑤ overlay 本体移除 + 清模块级单例：fullCleanup 是「完整关闭」语义。
      // switchTo 的复用外壳走 switch-preview.ts（不经过此处），故移除 overlay 不影响模型内切换。
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      _singletonOverlay = null;
      _singletonBody = null;
      _singletonViewContainer = null;
      // ⑥ 只清理内容层（dispose content + 移除 scene children），保留 renderer/canvas 存活
      //    避免销毁 WebGL context 导致黑屏窗口期
      if (infra && session.sceneBaseline) {
        const stale = infra.scene.children.filter((c): boolean => !session.sceneBaseline!.has(c));
        for (const c of stale) infra.scene.remove(c);
      }
      for (const b of session.allContent) {
        safeDispose(b);
      }
      session.allContent.length = 0;
      sceneRegistry.reset();
      // ⑦ 输入监听解绑（bindInputHandlers 内注册）——旧实现漏解绑，跨会话累积
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onDragPointerUp);
      window.removeEventListener("pointermove", onDragPointerMove);
      window.removeEventListener("resize", onResize);
      cancelPendingResize?.(); // 取消已在途 resize rAF 帧（容器已拆，防幽灵 setSize）
      if (infra) {
        infra.renderer.domElement.removeEventListener("pointerdown", onDragPointerDown);
        if (session.onUnifiedPick)
          infra.renderer.domElement.removeEventListener("click", session.onUnifiedPick);
      }
      // ⑧ 场景能力：保存状态 + 释放 GPU（下次 mount 由 createAll 重建）；清空能力引用
      sceneCapabilityRegistry.saveAll();
      sceneCapabilityRegistry.dispose();
      clearSceneCaps();
      // ⑨ 纹理缓存池 session 结束统一释放 + 视锥裁剪注册清空
      textureCache.disposeAll();
      clearModelRoots();
      // 清掉 loadingEl（已从 viewContainer 一并移除，此处为兜底）
      if (loadingEl.parentNode) loadingEl.remove();
      // 从全局 perFrame 回调列表移除本 session
      if (session.perFrame) {
        const idx = _globalPerFrames.indexOf(session.perFrame);
        if (idx >= 0) _globalPerFrames.splice(idx, 1);
      }
      // 如果所有 session 都清理完了，停止 rAF
      if (_globalPerFrames.length === 0) {
        cancelAnimationFrame(_globalAnimId);
        _globalAnimId = 0;
      }
      // ⑦ 收尾：摘句柄 + 通知调用方 + 焦点归还（幂等，与 closeOverlay 共用同一出口）
      finishSession();
    }

    // 复用 escH 可变引用，switchTo 后旧 handler 被替换，新 handler 在 cleanup 时通过 getter 正确卸载
    // R1-P1-2：先保存旧引用再替换，否则 removeEventListener 移除的是新函数（从未注册过），旧函数仍残留
    const oldEscH = session.escH;
    session.escH = (e: KeyboardEvent): void => {
      if (e.key === "Escape") fullCleanup();
    };
    document.removeEventListener("keydown", oldEscH);
    document.addEventListener("keydown", session.escH);
    session.cleanupFn = fullCleanup;
    const sessionHandle = {
      cleanup: fullCleanup,
      resetCamera: session.content.resetCamera,
      setRotationMode: session.content.setRotationMode,
      setSpeed: session.content.setSpeed,
      showModelGroup: session.content.showModelGroup,
      onBoneSelect: session.content.onBoneSelect,
      screenshot: session.content.screenshot,
      // 当前会话内切换模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6）
      // 支持 keepInScene 模式：true 时不移除旧模型，新模型追加到同一场景（多模型同台）
      switchTo: (newPath: string, options?: { keepInScene?: boolean }) =>
        switchToSession(switchCtx, newPath, options),
    };
    _handles.push({ handle: sessionHandle, gen: myGen });
  } catch (e) {
    // 失败路径清理（P1 修复，兄弟会话审核发现）
    // adapter.build 抛错时 session.content 为 null，session.content?.dispose() 是 no-op，
    // half-built mesh 留在 scene 中成为幽灵基线——下次 mount 把垃圾快照进 baseline。
    // 此处不移除 overlay/DOM（fullCleanup 语义），只清场景中的半成品 + dispose 已注册 content。
    document.removeEventListener("keydown", session.escH);
    if (infra && session.sceneBaseline) {
      const stale = infra.scene.children.filter((c): boolean => !session.sceneBaseline!.has(c));
      for (const c of stale) infra.scene.remove(c);
    }
    for (const b of session.allContent) safeDispose(b);
    session.allContent.length = 0;
    // 不单独调 session.content?.dispose()——content 已在 allContent 中，
    // safeDispose 循环已 dispose 它；再调一次是 double-dispose（code review #2 修复）
    // P2 守卫（对齐旧 skeleton close3D 语义）：加载期间被 ESC/切模型/invalidate
    // 打断后迟到的失败不得再弹错——否则关闭后 1~2s 突然冒「加载失败」toast，
    // 掩盖用户主动关闭的意图（旧实现 skeleton.ts 的 gen 守卫，迁移到核心统一承担）。
    if (session.aborted.v || myGen !== _gen) return;
    console.error("[preview 3D] 加载失败:", e);
    showLoadFailure(loadingEl, e);
  }
}

// ===== §5 mount3D 会话状态（其余私有工具已拆出独立模块）=====
// → shared-infra.ts（场景单例 + buildSharedInfra + syncShadowLights）
// → wasd-camera.ts（applyWasdCameraMotion + WasdReuse）
// → unified-pick.ts（makeUnifiedPickHandler）
// → unload-model.ts（unloadModel + UnloadCtx）
// → input-and-animation.ts（bindInputHandlers / InputOptions）
// → switch-preview.ts（switchToSession / SwitchContext）

/**
 * mount3D 会话级可变状态收敛体（原 30+ 裸 let，收敛后仅剩 keys/mouseDown/lastMouse 等少量 input let）。
 * infra 字段（scene/camera/renderer/controls/orbitTarget + 全部 cap）复用 {@link SharedInfra}，
 * 本接口仅收敛 session 级可变状态——闭包读写统一经此对象，降低认知负担。
 */
interface MpSessionState {
  /** 当前模型路径（switchTo 时变更，getSiblings 据此动态过滤） */
  currentPath: string;
  /** disposed 标记（可变引用） */
  isDisposed: { v: boolean };
  /** 会话收尾已完成标记：closeOverlay（早期路径）与 fullCleanup（post-build 路径）共用，
   *  保证「摘句柄 + 通知调用方 + 焦点归还」只发生一次（abort 路径会二次进入 fullCleanup） */
  finished: boolean;
  /** 中止标记（可变引用，ESC/invalidate 打断） */
  aborted: { v: boolean };
  /** cleanup 函数引用（build 成功后赋值） */
  cleanupFn: (() => void) | null;
  /** 相机移动速度（camBridge.setSpeed 变更） */
  camSpeed: number;
  /** 轨道/自由模式开关（camBridge.setOrbit 变更） */
  orbitMode: boolean;
  /** 每帧复用的临时欧拉角（WASD 自由相机时读 camera.quaternion） */
  euler: THREE.Euler;
  /** 当前会话内容层（switchTo 后会被替换） */
  content: PreviewScene | null;
  /** 场景子节点基线快照（区分固有装饰与内容层增量） */
  sceneBaseline: Set<THREE.Object3D> | null;
  /** cooperate 模式下已追加的内容句柄列表（fullCleanup 逐一 dispose） */
  allContent: PreviewScene[];
  /** 每帧回调（setPerFrame 统一注册/注销） */
  perFrame: ((dt: number) => void) | null;
  /** 统一多模型拾取器（仅 count>=2 激活） */
  onUnifiedPick: ((e: MouseEvent) => void) | null;
  /** 可变 ESC handler（switchTo 后替换，cleanup 经当前引用卸载） */
  escH: (e: KeyboardEvent) => void;
  /** 提示条自动消失定时器（cleanup 时 clearTimeout） */
  tipTimeoutId: ReturnType<typeof setTimeout> | undefined;
}
