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
// 结构：常量/状态变量 → 公开 API（invalidatePreview / cleanupPreview / switch）→
// switchPreview（会话内复用外壳切换）→ mount3D 主挂载编排器（生命周期闭包已拆出
// 到 render-loop.ts 与 mount-session.ts）。

import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import type { SemanticBoneMap } from "@/preview-3d/bone/semantic-bones.ts";
import { sceneCapabilityRegistry } from "@/preview-3d/caps/scene-capability-registry.ts";
import { deferred } from "@/preview-3d/deferred.ts";
import type { CameraControlBridge } from "@/preview-3d/infra/camera-controls.ts";
import { guardGpuBudget } from "@/preview-3d/infra/gpu-budget.ts";
import type { InputOptions } from "@/preview-3d/infra/input-and-animation.ts";
import { bindInputHandlers } from "@/preview-3d/infra/input-and-animation.ts";
import type { TdKeyAction } from "@/preview-3d/infra/keymap.ts";
import { setOverlayStyleTarget } from "@/preview-3d/infra/overlay-style-bridge.ts";
import { showLoadFailure } from "@/preview-3d/infra/preview-loading.ts";
import {
  ensureOverlayShell,
  ensureViewContainer,
  previewShell,
} from "@/preview-3d/infra/preview-shell.ts";
import { registerBuiltScene } from "@/preview-3d/infra/register-built-scene.ts";
import {
  registerPerFrame,
  removePerFrame,
  resetLoopState,
  setActiveInputSession,
  startGlobalRenderLoop,
} from "@/preview-3d/infra/render-loop.ts";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import { makeUnifiedPickHandler } from "@/preview-3d/infra/unified-pick.ts";
import {
  componentsStyleSheet,
  installComponentsStyles,
} from "@/preview-3d/menu/components-styles.ts";
import {
  mountPreviewRootMenu,
  type PreviewMenuCtx,
  type PreviewMenuHandle,
} from "@/preview-3d/menu/core.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/node-types.ts";
import { slideMenuStyleSheet } from "@/preview-3d/menu/slide-menu-styles.ts";
import { createInstallableStyles } from "@/preview-3d/menu/style-install.ts";
import {
  type BoneMaps,
  type BoneSelectInfo,
  loadTdCamSpeed,
  loadTdRotMode,
} from "@/preview-3d/mesh/model3d.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { noAnimationsCSS } from "@/utils/dom/css.ts";
import { rememberTrigger } from "@/utils/dom/focus-restore.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { trapFocusAcrossShadow } from "@/utils/dom/trap-focus-across-shadow.ts";
// mount3D 生命周期闭包 → mount-session.ts；rAF 循环 → render-loop.ts
import {
  closeOverlay,
  type MountCtx,
  type MpSessionState,
  ownHandle,
  runFailedMountCleanup,
  runFullCleanup,
  unloadSessionModel,
} from "./mount-session.ts";
import { sessionLedger } from "./session-ledger.ts";
// §5 拆分：场景单例/基础设施装配 → shared-infra.ts；
// 统一拾取器 → unified-pick.ts
import {
  buildSharedInfra,
  resetSceneInfra,
  type SharedInfra,
  sceneInfraHost,
} from "./shared-infra.ts";
import type { SwitchContext } from "./switch-preview.ts";
import { switchToSession, syncLightTargetFromContent } from "./switch-preview.ts";

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
  /**
   * 适配器身份标识（rtype / preview-key 契约的镜像，见本文件 PreviewAdapter.id 文档）。
   * core 构造 buildCtx 时注入，内容层据此写 LoadTrace.format（ADR-262 D3）：
   * 6 个 adapter 不再各自硬编码字面量，而消费 core 交付的单一身份——
   * 前端类型表单一事实源 = registry preview-key / rtype 契约。
   */
  adapterId: string;
}

/**
 * 适配器返回的内容场景契约（对齐 Model3DHandleX）。
 * 字段分层（P1#3 审计定论）：
 * - 硬契约：仅 dispose——cleanupPreview 无条件遍历调用（sessionLedger.snapshot() → handle.cleanup →
 *   fullCleanup → content.dispose），缺失会 GPU 泄漏；6 格式适配器全实现。
 * - 能力可选：其余全部可选（接口注释"便于纯静态渲染"是有意设计）——update 供动态
 *   内容（动画/SpringBone/感知），静态体素（litematic/pack）不实现；resetCamera /
 *   setRotationMode / setSpeed / showModelGroup 等控制面按格式能力实现。
 * - 消费方一律 `?.` 特性探测（mount-preview-core L784 perFrame=content.update ?? null、
 *   L891 resetCamera/screenshot 透传 PreviewHandle 后再 ?.），缺字段 = 功能降级而非崩溃。
 * - 新增适配器：dispose 必须实现；其余按格式能力"有就实现、没有就不实现"，勿为凑
 *   字段数补空实现（空 update 是噪音，不是契约完整）。
 */
/**
 * 能力分层接口（ADR-178，2026-09-04）：把单接口 + 大量可选字段拆为
 * 「BaseScene（硬契约）+ 能力接口」——adapter 用结构类型声明自己实现哪些能力，
 * 消费方按需收窄，编译期表达「该格式支持什么」，替代 `?.` 特性探测的隐式约定。
 *
 * 设计原则（ADR-178 §2）：
 * - dispose 是唯一硬契约；其余能力按「有就 implements、没有就不 implements」；
 * - 数据字段（boneMaps/menuItems/keepInScene/onBonePick/semanticBones）留在 BaseScene——
 *   它们是内容层元数据不是方法能力，消费方（scene-registry/菜单）对任意格式读取；
 * - PreviewScene 保留为组合别名（= BaseScene + 全部可选能力字段的并集形态），
 *   存量 adapter 返回类型标注渐进迁移，不一次性改 6 格式。
 */

/** 内容层硬契约：释放 GPU 资源（几何/材质/纹理/helper）——cleanup 无条件调用，缺失即泄漏 */
export interface BaseScene {
  dispose(): void;
  /** 同台追加模式：true 表示不替换 scene，改为将模型 add 到已有场景（多模型同框） */
  keepInScene?: boolean;
  /** 骨骼映射（dispatch 拾取归属用，ADR-093 T5；未接入格式不返回） */
  boneMaps?: BoneMaps | null;
  /** 该模型声明式根菜单专属项（selectModel 换菜单用，ADR-093 T5；未接入为 null） */
  menuItems?: PreviewMenuNode[] | null;
  /** 多模型下由统一拾取器调用：点中该模型骨骼时打开其面板（ADR-093 T5） */
  onBonePick?: (boneId: string) => void;
}

/** 动态内容能力：每帧驱动（VRM SpringBone / 动画等）；无则仅静态渲染 */
export interface UpdateableScene extends BaseScene {
  update(dt: number): void;
}

/** 截图能力：截取当前 3D 渲染画面；PNG base64，无 data: 前缀（ADR-052 P3 通用化） */
export interface ScreenshotScene extends BaseScene {
  screenshot(): Promise<string | null>;
}

/** 相机控制能力（resetCamera / setRotationMode / setSpeed 按格式能力实现） */
export interface CameraControlScene extends BaseScene {
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  /** 骨骼选中回调（骨骼面板联动；无 = 格式不接入骨骼选择） */
  onBoneSelect?(info: BoneSelectInfo): void;
}

/** 模型分组能力：按组显隐（litematic 分层切片等） */
export interface GroupedScene extends BaseScene {
  showModelGroup?(i: number): void;
}

/** 语义骨骼能力：语义骨骼映射供语义层消费（无 = 该格式不接入语义层） */
export interface SemanticScene extends BaseScene {
  semanticBones?: SemanticBoneMap | undefined;
}

/** 姿势应用能力（VPD 姿势，MMD 专属；无 = 该格式不支持） */
export interface PoseScene extends BaseScene {
  applyPose?(index: number): void;
}

/**
 * 内容场景契约（兼容别名，ADR-178 渐进迁移期保留）：
 * = BaseScene + 全部可选能力。存量 adapter 返回类型仍可标 PreviewScene；
 * 新 adapter 建议标具体组合（如 `UpdateableScene & ScreenshotScene`）。
 */
export interface PreviewScene extends BaseScene {
  update?(dt: number): void;
  resetCamera?(): void;
  setRotationMode?(orbit: boolean): void;
  setSpeed?(n: number): void;
  showModelGroup?(i: number): void;
  onBoneSelect?(info: BoneSelectInfo): void;
  semanticBones?: SemanticBoneMap | undefined;
  applyPose?: ((index: number) => void) | undefined;
  screenshot?(): Promise<string | null>;
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
  // 注：screenshot 不做 handle 透传（2026-09-04 消费方审计）——截图走 shotNodes 声明式
  // 菜单节点（各 adapter build 内闭包直取 renderer），handle.screenshot 曾为只写不读死字段。
}

// ===== §1 常量 + 状态变量 =====
// 相机控制常量（buildCameraControls 已拆至 camera-controls.ts，本文件保留自身仍使用的部分：
// DRAG_ROTATE_SENSITIVITY 拖拽旋转 / TIP_AUTO_DISMISS_MS 提示自动消失）
// camSpeed 默认值已由 keymap.ts loadTdCamSpeed()（默认 20）提供，会话初始化时读取偏好。
// mpc 静态样式注入（mpcCss + ensureStyles 幂等旗标）已随外壳单例收敛至 preview-shell.ts。

const TIP_AUTO_DISMISS_MS = 6000;

// 会话协调态（_gen 代际 / _mountSessionSeq 会话序号 / _handles 存活句柄表）已收敛至
// session-ledger.ts 的 sessionLedger 实例（ADR-227）——代际作废、会话 id 分配、
// coop 多会话簿记均为台账方法（invalidate / beginSession / activeHandle / hasActive）。
// 外壳单例（overlay/body/viewContainer）已收敛至 preview-shell.ts 的 previewShell 实例。
// rAF 循环状态（_globalAnimId/_globalPerFrames/perFrame 告警）已拆至 render-loop.ts
// （registerPerFrame/removePerFrame/stopIfIdle/resetLoopState 访问）。
// 场景级单例（_singletonScene/_singletonCamera/_singletonRenderer/_singletonControls/_sceneCaps）
// 已随 §5 拆分收敛至 shared-infra.ts（resetSceneInfra / clearSceneCaps / getSceneCaps 访问）。

/** 任意新预览派发时调用，作废在途加载（对齐 invalidateVrmPreview / invalidateLitematicPreview） */
export function invalidatePreview(): void {
  sessionLedger.invalidate();
}

/** 清理所有 3D 预览（dispose content + 移除 scene children，保留 renderer/canvas/overlay 存活避免黑屏） */
export function cleanupPreview(): void {
  sessionLedger.invalidate();
  // 快照遍历：handle.cleanup() → fullCleanup → finishSession 会从台账摘除自身，
  // 边遍历边删会跳元素（cooperate 多会话场景只清掉一半），故先复制一份
  for (const h of sessionLedger.snapshot()) {
    try {
      h.handle.cleanup();
    } catch (e) {
      // 单会话清理失败不阻塞其余会话，但 GPU 泄漏排查需留痕（透写环形日志）
      logWarn("preview 3D", "handle.cleanup 失败", e);
    }
  }
  sessionLedger.clear();
  // cleanupPreview 是「全部关闭」语义，可安全 reset 注册表
  sceneRegistry.reset();
  // renderer/canvas 保留（下次 mount3D 直接复用，不重建 DOM），但外壳引用必须清零：
  // handle.cleanup→fullCleanup 已从 DOM 移除 overlay/body/viewContainer，保留旧引用会导致
  // 下次 mount3D 复用已脱离文档的 detached element（测试 afterEach 尤其敏感）。
  previewShell.resetRefs();
  // ADR-175 M1：overlay 单例已拆除——注入目标还原 head 兜底并复位全部 ensure* 旗标
  //（下次 mount3D 建新 shadow root 时会重注入）
  setOverlayStyleTarget(null);
  resetSceneInfra();
}

/** 测试用：重置所有模块级单例状态（不影响生产代码路径） */
export function _resetSingletons(): void {
  previewShell.resetRefs();
  setOverlayStyleTarget(null); // ADR-175 M1：同 cleanupPreview——旗标复位防跨用例串目标
  resetSceneInfra();
  resetLoopState();
  // [审核修复] mount 会话序号同属台账实例态：重置后 sessionId 生成确定性可测
  // （否则跨用例单调递增，断言 per-scene key 形状的测试会顺序依赖）
  sessionLedger.resetSeq();
}

/** 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；无活跃会话时 no-op */
export async function switchPreview(
  path: string,
  options?: { keepInScene?: boolean },
): Promise<void> {
  await sessionLedger.activeHandle()?.switchTo?.(path, options);
}

/** 是否存在活跃 3D 预览会话（多模型同台追加的前置判定，ADR-093 T4） */
export function hasActivePreview(): boolean {
  return sessionLedger.hasActive();
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

// ===== mount3D stage 拆分段间产物类型（ADR-167 800 行老将拆单兵）=====
/** stage 1 assembleShell 产物：外壳 DOM(overlay/body/root) + 相机桥 + 声明式根菜单 + 加载态 + 输入状态容器 */
export interface AssembledShell {
  overlay: HTMLElement;
  body: HTMLElement;
  root: HTMLElement | ShadowRoot;
  camBridge: CameraControlBridge;
  viewContainer: HTMLElement;
  menuHandle: PreviewMenuHandle;
  loadingEl: HTMLElement;
  keys: Partial<Record<TdKeyAction, boolean>>;
  mouseDown: { v: boolean };
  lastMouse: { x: number; y: number };
}
/** stage 2 buildInfra 产物：已安装 shared 基础设施 + 会话内切换上下文 */
export interface InstalledPreviewInfra {
  /** shared 模式非 null；self 模式 null（适配器自驱） */
  infra: SharedInfra | null;
  switchCtx: SwitchContext;
}
/** stage 3 runBuild 产物：构建成功的内容层（stage 4 commit 消费）。 */
interface MountBuildResult {
  /** 已 build 成功、已登记进 session.allContent 的内容层 */
  content: PreviewScene;
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
  installComponentsStyles();
  previewShell.ensureStyles(); // P1 批次9:overlay 链 cssText 抽类注入(幂等)

  // ===== 直挂路径 GPU 预算门（刀⑪ 立门、刀⑫ 语义修正 + 前置化）=====
  // 无活跃会话时 preview-library 的 cooperate 退化为 false → 走本路径而不经
  // switch-preview|beginSwitch 的 keep 通道，曾是无预算门的不对称缺口。
  //
  // 两条约束，改动前必读（推理链详见知识卡 preview_core.md §不变量）：
  // ① gate 在 hasActivePreview()：本门读 renderer.info 的**上一帧**统计，而本次内容
  //    尚未构建——无残留会话时读到「空 renderer（全 0，白判）」或「上一会话陈旧指标
  //    （归因错误）」。只有确有未释放负载时拦，语义才成立。
  // ② 必须在装配之前判：否则拦截时需回收**半装配**外壳 → runFullCleanup 只结算本次
  //    会话，被 clearSingletons 摘掉 overlay 的残留 handle 仍留台账成僵尸。前置后本次
  //    无状态可回收，直接 cleanupPreview()（「全部关闭」）一步收干净。
  if (hasActivePreview()) {
    const liveRenderer = sceneInfraHost.renderer;
    if (liveRenderer && !guardGpuBudget(liveRenderer, "preview.gpuBudgetLoad")) {
      cleanupPreview();
      return;
    }
  }

  // 会话代际 + per-mount 会话稳定 id 由台账分配：[Bug A] 每次 mount3D 自增（switchTo 走
  // switch-preview 复用外壳、不重新 mount，故不递增）。适配器 build 经 ctx.sessionId 读取，
  // 供 per-scene schema key（ysm-model-{sid}）注册/注销对齐。
  const { gen: myGen, sessionId } = sessionLedger.beginSession();
  const selfMode = adapter.mode === "self";

  // ---- 收敛：session 级可变状态（原 14 个裸 let，统一经此对象读写）----
  const session: MpSessionState = {
    currentPath: path,
    isDisposed: { v: false },
    finished: false,
    aborted: { v: false },
    status: "idle", // ADR-233：会话生命周期状态单一事实源
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
    onUnifiedPickDispose: null,
    escH: () => {},
    tipTimeoutId: undefined,
    keys: {},
  };

  // infra（scene/camera/renderer/controls/orbitTarget + 全部 cap）由 buildSharedInfra
  // 一次性构造返回；self 模式下 infra 保持 null，所有访问经 infra?. 短路为 undefined。
  // infra/switchCtx 双 let + 两处手动回填收敛为单 slots 持有器——
  // getter 仍需延迟绑定（camBridge 在 buildInfra 内经 ctx.getInfra() 读装配产物，循环依赖），
  // 但 definite-assignment 风险（let switchCtx 用前未赋值）由 slots 的 null 态显式表达。
  const slots: { infra: SharedInfra | null; switchCtx: SwitchContext | null } = {
    infra: null,
    switchCtx: null,
  };

  // 事件 handler 集合（bindInputHandlers 后填充；runFullCleanup 按当前引用解绑）
  const handlers: MountCtx["handlers"] = {
    onKeyDown: () => {},
    onKeyUp: () => {},
    onDragPointerDown: () => {},
    onDragPointerUp: () => {},
    onDragPointerMove: () => {},
    onResize: () => {},
    cancelPendingResize: undefined,
  };

  // 焦点陷阱 cleanup（每次 mount3D 新建，closeOverlay / runFullCleanup 释放）
  const focusTrap: MountCtx["focusTrap"] = { cleanup: null };

  // 事件 handler 集合（bindInputHandlers 后填充；runFullCleanup 按当前引用解绑）
  // 会话生命周期上下文（mount-session.ts 的模块级函数经此读写装配产物；
  // menuHandle/overlay/viewContainer/loadingEl/camBridge 在装配各段就位）
  const ctx: MountCtx = {
    adapter,
    opts,
    myGen,
    selfMode,
    sessionId,
    session,
    getInfra: () => slots.infra,
    getGen: () => sessionLedger.gen(),
    handles: sessionLedger.handles,
    getSwitchCtx: () => {
      // buildInfra 完成前不存在合法 switchCtx；提前调用属装配时序 bug，显式炸出而非静默 undefined
      if (!slots.switchCtx)
        throw new Error("[mount-preview-core] getSwitchCtx 在 buildInfra 之前被调用");
      return slots.switchCtx;
    },
    clearSingletons: () => {
      previewShell.resetRefs();
    },
    overlay: null,
    viewContainer: deferred<HTMLElement>(),
    loadingEl: deferred<HTMLElement>(),
    menuHandle: deferred<PreviewMenuHandle>(),
    camBridge: deferred<CameraControlBridge>(),
    focusTrap,
    handlers,
  };

  // ===== stage 1: 外壳装配（overlay/camBridge/viewContainer/根菜单/loadingEl + input 容器）=====
  const shell = assembleShell(ctx);
  // ===== stage 2: 基础设施装配（escH/shared infra/输入/rAF/tip/switchCtx）=====
  const installed = buildInfra(ctx, shell);
  slots.infra = installed.infra; // 回填 ctx.getInfra() 槽位（buildInfra 后 camBridge 经 getter 读到）
  slots.switchCtx = installed.switchCtx; // 回填 ctx.getSwitchCtx() 槽位

  try {
    const build = await runBuild(ctx, shell, installed);
    if (!build) return; // abort / 代际作废（已 runFullCleanup），静默退出
    commitSession(ctx, installed.switchCtx, build.content);
  } catch (e) {
    recoverMountFailure(ctx, shell.loadingEl, e);
  }
}

// ===== mount3D stage 1: 外壳装配（原 mount3D L400-407 + L456-619 纯搬家）=====
/**
 * 会话骨架(session/handlers/focusTrap/ctx/infra 槽)由调度层 mount3D 先建；
 * 本函数按「单例 DOM → 相机桥 → 视窗 → 根菜单」四段顺序装配外壳，每段下沉为
 * 具名子函数（见下），主函数只保留编排与返回值组装。camBridge.setOrbit 经
 * ctx.getInfra() 延迟读 infra（原闭包捕获 let infra 的语义等价——buildInfra
 * 赋值后调度层回填 ctx 槽位）。
 */
function assembleShell(ctx: MountCtx): AssembledShell {
  const session = ctx.session;
  const selfMode = ctx.selfMode;
  const adapter = ctx.adapter;
  const opts = ctx.opts;

  // input 状态（不进 session：bindInputHandlers 已显式接收 keys/mouseDown/lastMouse）
  // keys 直接使用 session.keys（render-loop 动态读取驱动相机运动）
  const keys = session.keys;
  // mouseDown 用 { v } 引用容器（与 input-and-animation InputOptions.mouseDown 同形）：
  // camBridge.setOrbit 与 bindInputHandlers 共享同一引用——修历史脱节（原 let 布尔 +
  // { v: mouseDown } 快照，camBridge 写裸布尔不影响 input 读容器），并为 assembleShell/
  // buildInfra 跨 stage 共享铺路（容器引用跨函数传递共享同一状态）。
  const mouseDown = { v: false };
  const lastMouse = { x: 0, y: 0 };

  const shell = assembleOverlayShell(ctx);
  const { overlay, root } = shell;
  ctx.overlay = overlay;

  const camBridge = makeCamBridge(ctx, session, mouseDown);
  ctx.camBridge = camBridge;

  // ensureViewContainer 可能补建 body（单例半残场景）——返回权威引用，勿用 ensureOverlayShell 的初值
  const { viewContainer, body } = ensureViewContainer(shell.body, root);
  ctx.viewContainer = viewContainer;

  const menuHandle = mountRootMenu(ctx, {
    root,
    viewContainer,
    camBridge,
    selfMode,
    adapter,
    opts,
  });
  ctx.menuHandle = menuHandle;

  const loadingEl = document.createElement("div");
  loadingEl.className = "mpc-loading";
  viewContainer.appendChild(loadingEl);
  ctx.loadingEl = loadingEl;

  return {
    overlay,
    body,
    root,
    camBridge,
    viewContainer,
    menuHandle,
    loadingEl,
    keys,
    mouseDown,
    lastMouse,
  };
}

/**
 * `.no-animations` 通配桥的 CSSStyleSheet（ADR-015 §2.4 约束 1：用户关闭时零动画）。
 *
 * 为什么 3D overlay 也要自带：`.no-animations` 类挂 `documentElement`，而文档层通配规则
 * **不穿透 Shadow 边界**（`preview-shell.ts` 为本 overlay 建了独立 shadow root），
 * 故须显式 adopt——否则「关闭动画」在 3D HUD 上静默失效。
 * 复用 style-install 脚手架（勿手写 CSSStyleSheet + try/catch 三件套，见该文件头注释）。
 * 降级路径（无 shadow → overlay 本体在 light DOM）由文档层通配覆盖，故无需 install()。
 */
const noAnimationsStyles = createInstallableStyles(
  noAnimationsCSS,
  "data-ui-no-animations",
  "ui-no-animations",
);

/**
 * 单例外壳 DOM 装配的适配层：把 core 持有的样式表 / i18n 文案 / 样式目标注入点
 * 打包传给 infra 的 `ensureOverlayShell`（DOM 外壳本体与单例已归 preview-shell.ts）。
 * 焦点陷阱在此安装（依赖 ctx.focusTrap，属会话态而非外壳单例态）。
 */
function assembleOverlayShell(ctx: MountCtx): {
  overlay: HTMLElement;
  body: HTMLElement;
  root: HTMLElement | ShadowRoot;
} {
  const shell = ensureOverlayShell({
    styleSheets: [componentsStyleSheet, slideMenuStyleSheet, noAnimationsStyles.sheet],
    ariaLabel: t("preview.title3d"),
    setStyleTarget: setOverlayStyleTarget,
    onStyleError: (err) =>
      logWarn("preview-3d", `adoptedStyleSheets 安装失败（降级 head 注入）: ${String(err)}`),
  });
  // 焦点陷阱：ADR-175 M1 后 overlay 内容实体在 host.shadowRoot 内，
  // trapFocusAcrossShadow 的跨 shadow 下钻从防御性兜底转正为实际路径（D3）
  if (!ctx.focusTrap.cleanup) {
    ctx.focusTrap.cleanup = trapFocusAcrossShadow(shell.overlay);
  }
  return shell;
}

/**
 * 相机控制桥（shared 模式）：core 的相机控件与 PreviewBuildCtx.cameraControls
 * 共用同一 bridge（操作核心内部 orbitMode/camSpeed/controls），适配器（如 ysm 底部
 * 导航）经 cameraControls 复用同一套相机状态。相机控件本身已收进声明式根菜单的 camera 项。
 *
 * @param mouseDown 与 bindInputHandlers 共享的引用容器——setOrbit 需清零它防拖拽残留
 */
function makeCamBridge(
  ctx: MountCtx,
  session: MpSessionState,
  mouseDown: { v: boolean },
): CameraControlBridge {
  return {
    getOrbit: () => session.orbitMode,
    setOrbit: (v: boolean) => {
      const i = ctx.getInfra(); // camBridge 仅经 cameraControls 在 build 后使用；self 模式不调用（ctx.getInfra 延迟读）
      if (!i) return;
      session.orbitMode = v;
      i.controls.enableRotate = v;
      if (v) {
        i.orbitTarget.copy(i.controls.target);
      } else {
        session.euler.setFromQuaternion(i.camera.quaternion);
      }
      mouseDown.v = false;
    },
    getSpeed: () => session.camSpeed,
    setSpeed: (n: number) => {
      session.camSpeed = n;
    },
    // content 在 try 块内声明，此处经模块级 _handle（PreviewHandle 含 resetCamera? 契约）延迟调用。
    // gen-scoped 解析本会话句柄——原 `_handles[length-1]` 在 coop
    // 多 session 下指向「最后 commit 的 session」而非本菜单/camera 桥属主，相机复位会误切他人
    reset: () => {
      ownHandle(ctx)?.resetCamera?.();
    },
  };
}

/** 根菜单装配依赖（自 assembleShell 局部量打包，避免参数列表过长） */
interface RootMenuDeps {
  root: HTMLElement | ShadowRoot;
  viewContainer: HTMLElement;
  camBridge: CameraControlBridge;
  selfMode: boolean;
  adapter: PreviewAdapter;
  opts: Mount3DOptions;
}

/**
 * 声明式根菜单（⚙️）：core 在 overlay 内自建（预览全屏盖住 app 外壳，主程序 nav.settings 够不着），
 * 全部控件以 CORE_MENU_ITEMS + 适配器注入项表驱动渲染（preview-menu/defs.ts），
 * 测试遍历真实菜单数组断言（preview-menu/items.test.ts），选择器稳定可遍历（ADR-076 v2）。
 *
 * 顶栏已移除（ADR-076 v2，用户 2026-08-16 决策）：预览控件全部收进声明式根菜单
 * （⚙️ 按钮 → mountPreviewRootMenu），彻底告别顶栏滑块垃圾。litematic 分层切片面板也经
 * schemaId 注册（registerSchema builder）注入根菜单模型组。
 */
function mountRootMenu(ctx: MountCtx, deps: RootMenuDeps): PreviewMenuHandle {
  const { root, viewContainer, camBridge, selfMode, adapter, opts } = deps;
  const session = ctx.session;

  const menuCtx: PreviewMenuCtx = {
    selfMode,
    getCap: (id: string) => sceneCapabilityRegistry.getById(id) ?? null,
    getCamBridge: () => camBridge,
    getSiblings: () => (opts.siblings ?? []).filter((p) => p !== session.currentPath),
    getCurrentPath: () => session.currentPath,
    getCurrentRtype: () => (opts.rtype?.trim() ? opts.rtype : adapter.id),
    getCurrentSubtype: () => opts.subtype ?? "",
    getViewContainer: () => viewContainer,
    close: () => {
      if (session.cleanupFn) session.cleanupFn();
      else closeOverlay(ctx);
    },
    switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> | void => {
      // gen-scoped 解析本会话句柄（对齐 runBuild.switchTo 同款
      // 查找）——原 `_handles[length-1]` 在 coop 多 session 下指向最后 commit 的 session，
      const r = ownHandle(ctx)?.switchTo?.(p, options);
      // 透传 Promise：调用方（fillSwitch 替换/追加）在完成后局部刷新面板（renderRows 重读新当前路径）
      if (r) {
        void r.catch((err: unknown) =>
          logWarn("preview-menu", `switchTo 切换失败: ${String(err)}`),
        );
        return r;
      }
      return undefined;
    },
    unloadModel: (id: string) => unloadSessionModel(ctx, id),
    toast: (msg: string): void => {
      bus.emit("toast:show", { msg, duration: TOAST_MS.normal });
    },
    closeAllOverlays: (): void => {
      menuHandle.dispose();
    },
  };
  // getModelsByType / getTypeTabs / switchExternal 是 PreviewMenuCtx 可选键（menu/core.ts，
  // 非本域）——exactOptional 收紧后仅真实存在时赋值，避免显式 undefined 流入
  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  if (opts.getModelsByType) menuCtx.getModelsByType = (t, s) => opts.getModelsByType!(t, s);
  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  if (opts.getTypeTabs) menuCtx.getTypeTabs = () => opts.getTypeTabs!();
  if (opts.switchExternal)
    menuCtx.switchExternal = (
      p: string,
      s?: string[],
      options?: { keepInScene?: boolean },
    ): void => {
      // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
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
  return menuHandle;
}

// ===== mount3D stage 2: 基础设施装配（原 mount3D L621-738 纯搬家）=====
/**
 * escH 注册 + shared 基础设施(buildSharedInfra) + 输入绑定 + 统一拾取 + rAF 首帧 +
 * tip 提示条 + switchCtx 构造。self 模式 infra 保持 null（适配器自驱）。
 * @returns infra(shared 模式非 null) + switchCtx——调度层回填 ctx.getInfra()/getSwitchCtx() 槽位
 */
function buildInfra(ctx: MountCtx, shell: AssembledShell): InstalledPreviewInfra {
  const session = ctx.session;
  const selfMode = ctx.selfMode;
  const adapter = ctx.adapter;
  const opts = ctx.opts;
  const handlers = ctx.handlers;
  const {
    viewContainer,
    loadingEl,
    root,
    overlay,
    menuHandle,
    camBridge,
    keys,
    mouseDown,
    lastMouse,
  } = shell;
  let infra: SharedInfra | null = null;
  const myGen = ctx.myGen;
  const sessionId = ctx.sessionId;

  // ===== §4 基础设施创建（scene/camera/renderer/OrbitControls/灯光/resize）=====
  // session.aborted 已在 mount3D 头部 session 对象初始化时声明。
  // 可变 ESC 处理函数：switchTo 后重新赋值
  // （finishSession/closeOverlay 已提为 mount-session.ts 模块级函数，经 ctx 上下文读写）
  session.escH = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      if (session.cleanupFn) session.cleanupFn();
      else closeOverlay(ctx);
    }
  };
  document.addEventListener("keydown", session.escH);

  if (!selfMode) {
    infra = buildSharedInfra(adapter, viewContainer, menuHandle);
    // 偏好同步：自由模式（orbitMode=false）关闭 OrbitControls 自身旋转，
    // 拖拽自转走 input-and-animation 的 euler 桥（对齐 camBridge.setOrbit 语义）
    infra.controls.enableRotate = session.orbitMode;

    // ===== §4a 输入绑定（WASD 键盘 + 拖拽自转 + resize）=====
    const inputOpts: InputOptions = {
      keys,
      getOrbitMode: () => session.orbitMode,
      mouseDown, // 共享引用容器（非快照）：camBridge 与 input 同写一处
      lastMouse, // 同上：坐标状态归 input 独占读写，传引用消灭快照双轨（壳层容器即唯一事实源）
      euler: session.euler,
      camera: infra.camera,
      renderer: infra.renderer,
      postProc: infra.postProc,
      viewContainer,
      isDisposed: session.isDisposed,
    };
    const bound = bindInputHandlers(inputOpts);
    handlers.onKeyDown = bound.onKeyDown;
    handlers.onKeyUp = bound.onKeyUp;
    handlers.onDragPointerDown = bound.onDragPointerDown;
    handlers.onDragPointerUp = bound.onDragPointerUp;
    handlers.onDragPointerMove = bound.onDragPointerMove;
    handlers.onResize = bound.onResize;
    handlers.cancelPendingResize = bound.cancelPendingResize;

    // ADR-093 T5：统一多模型拾取器（仅 count>=2 激活，单模型完全沿用逐模型 registerBoneRaycast，零回归）
    const unifiedPick = makeUnifiedPickHandler(infra.renderer, infra.camera, infra.scene);
    session.onUnifiedPick = unifiedPick.handle;
    session.onUnifiedPickDispose = unifiedPick.dispose;
    infra.renderer.domElement.addEventListener("click", session.onUnifiedPick);

    // ===== §4b rAF 渲染管线（render-loop.ts：全局唯一 loop，所有 session 共享同一 renderer）=====
    // 首个 session 启动 loop，后续 session 追加 perFrame 回调；stopIfIdle 在 runFullCleanup 收尾
    startGlobalRenderLoop(viewContainer, infra);
    // perFrame 注册统一走 setPerFrame（初次 mount 在 build 成功后、切换在
    // switchToSession 内）——此处不再一次性 push：执行时 perFrame 尚未赋值（P3）
  }

  // 操作提示条（自动消失，两种模式通用）
  // body 经 root 现取而非复用 shell.body：shell.body 是装配段快照，若 body 曾被补建
  // （ensureViewContainer 兜底分支）则快照为陈旧引用，insertBefore 会抛
  // 「node is not a child of this node」。以 root 实查为准，杜绝跨段引用漂移。
  const tip = document.createElement("div");
  tip.className = "mpc-tip";
  tip.textContent = t("preview.controlsHint");
  const tipAnchor = root.querySelector(".mpc-body");
  if (tipAnchor) root.insertBefore(tip, tipAnchor);
  else root.appendChild(tip);
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
    adapterId: adapter.id,
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
    getCurrentRtype: () => (opts.rtype?.trim() ? opts.rtype : adapter.id),
    getCurrentSubtype: () => opts.subtype ?? "",
    getPerFrame: () => session.perFrame,
    setPerFrame: (f) => {
      // 切换模型时先从全局 perFrame 列表移除旧回调（防已 dispose 的旧内容层
      // update 持续执行），再注册新回调——移除/注册对称维护，初次 mount 与
      // 切换统一经此注册（rAF 引导块不再一次性 push）
      const old = session.perFrame;
      if (old) removePerFrame(old);
      session.perFrame = f;
      // P3 对称维护：新回调非空时重新注册，否则列表与 perFrame 引用脱节
      // （初次 mount 与切换统一经 setPerFrame 注册）
      if (f) registerPerFrame(f);
    },
    getHandle: () => sessionLedger.activeHandle(),
    handles: sessionLedger.handles,
    aborted: session.aborted,
    inFlight: false,
    isDisposed: session.isDisposed,
    myGen,
    getGen: () => sessionLedger.gen(),
  };

  return { infra, switchCtx };
}

// ===== mount3D 构建管线（原 mount3D try 块 L759–L857 纯搬家；代际守卫 + build + abort + 同步 + 注册）=====
/**
 * 主路径构建管线：代际守卫 → sceneBaseline 快照 → buildCtx 构造 → adapter.build →
 * abort 打断分支 → 相机/light/shadow/env 同步 → setPerFrame → allContent/register/
 * setAdapterItems。
 * @returns MountBuildResult | null——null = abort 或代际作废（已 runFullCleanup 或静默退出），
 *  非 null = 可 commit（build.content 非空）。
 */
async function runBuild(
  ctx: MountCtx,
  shell: AssembledShell,
  installed: { infra: SharedInfra | null; switchCtx: SwitchContext },
): Promise<MountBuildResult | null> {
  const session = ctx.session;
  const { infra, switchCtx } = installed;
  // 代际守卫：await 期间用户已点其他文件 / 被 invalidate，丢弃本次挂载
  if (ctx.myGen !== ctx.getGen()) return null;

  const i = infra; // self 模式 infra=null，跳过 sceneBaseline；shared 模式恒非空
  if (i) session.sceneBaseline = new Set(i.scene.children);
  const buildCtx: PreviewBuildCtx = {
    viewContainer: shell.viewContainer,
    loadingEl: shell.loadingEl,
    overlay: shell.root, // ADR-175 M1：适配器内容插入目标 = root（shadow 内），非 host
    menu: shell.menuHandle,
    // 延迟闭包：build 时 _handle 尚未赋值，菜单点击（build 之后）时已就绪；
    // 无活跃会话时 no-op（与 switchPreview 同口径）。
    // 捕获当前 session 的稳定 gen，闭包按 gen 查找自身 handle——
    // 不取 handles 数组末尾，避免多 session 下同框 session 误触发彼此的切换。
    switchTo: (p: string, options?: { keepInScene?: boolean }): Promise<void> => {
      // gen-scoped 查找收敛到 ownHandle（不再各处手写 find）
      return ownHandle(ctx)?.switchTo?.(p, options) ?? Promise.resolve();
    },
    // 适配器身份单一事实：LoadTrace.format 由它派生（ADR-262 D3）
    adapterId: ctx.adapter.id,
  };
  // scene/camera/controls/renderer/cameraControls/sessionId 为可选项——
  // exactOptional 收紧后仅真实存在时赋值（shared 模式有值，self 模式缺省）
  if (i?.scene !== undefined) buildCtx.scene = i.scene;
  if (i?.camera !== undefined) buildCtx.camera = i.camera;
  if (i?.controls !== undefined) buildCtx.controls = i.controls;
  if (i?.renderer !== undefined) buildCtx.renderer = i.renderer;
  if (!ctx.selfMode && shell.camBridge) buildCtx.cameraControls = shell.camBridge;
  if (ctx.sessionId !== undefined) buildCtx.sessionId = ctx.sessionId;
  session.status = "mounting"; // ADR-233：build 进行中
  session.content = await ctx.adapter.build(buildCtx, session.currentPath);
  if (session.aborted.v || ctx.myGen !== ctx.getGen()) {
    // 加载期间被 ESC / invalidate 打断：完整拆除（含 rAF 循环与 WebGL renderer），
    // 避免外壳资源泄漏；内容层 GPU 资源经 fullCleanup 一并释放。
    // 注意：会话登记进 allContent 发生在下方（build 成功之后），此处必须补登记，
    // 否则刚 build 完的内容层不在 dispose 列表里 → GPU 资源泄漏。
    if (session.content && !session.allContent.includes(session.content)) {
      session.allContent.push(session.content);
    }
    runFullCleanup(ctx);
    return null;
  }
  // [P1 修复] 登记提前到「build 成功后的第一时刻」，使「content 已在 allContent 中」这一
  // 不变量在任何后续步骤之前成立。recoverMountFailure 正是据此前提**刻意不调**
  // session.content?.dispose()（注释自述「content 已在 allContent 中」）；原实现把 push 放在
  // 末尾，若下方 syncLightTargetFromContent / applyMeshCasts / syncMeshIntensity / setPerFrame
  // 任一步抛错，已 build 成功的 content 就落在 dispose 列表之外 → GPU 资源泄漏（窗口窄但真实）。
  if (session.content && !session.allContent.includes(session.content)) {
    session.allContent.push(session.content);
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
        ? // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
          i.scene.children.filter((c) => !session.sceneBaseline!.has(c))
        : [];
      i.shadowCap.applyMeshCasts(roots);
    }
    // 首模型 mesh envMapIntensity 同步
    if (i.environmentCap && session.content) {
      const roots = session.sceneBaseline
        ? // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
          i.scene.children.filter((c) => !session.sceneBaseline!.has(c))
        : [];
      i.environmentCap.syncMeshIntensity(roots);
    }
  }
  switchCtx.setPerFrame(session.content.update ?? null);
  // ===== §4c 生命周期管理（cooperate/switchTo/代际守卫）=====
  // 初始模型的 allContent 登记已上移到 build 成功后的第一时刻（见上方 [P1 修复]）——
  // 此处不再重复 push（allContent 无去重，重复登记会让 fullCleanup 对同一 content dispose 两次）。
  // ADR-093 T2：首模型注册进场景注册表（差量捕获→统计合并→注册，与 switchTo 共用
  if (session.content) {
    const menuItems = registerBuiltScene({
      path: session.currentPath,
      rtype: ctx.opts.rtype ?? ctx.adapter.id,
      content: session.content,
      scene: infra?.scene,
      diffSet: session.sceneBaseline,
      displayName: ctx.opts.displayName,
      components: ctx.opts.components,
    });
    // ADR-076 v2 Phase 3：注册后立刻注入菜单项，否则 dock-menu 无适配器专属控件
    // （ADR-131 §2.3：统计面板已并入 menuItems，一次注入不覆盖）
    if (menuItems.length > 0) shell.menuHandle.setAdapterItems(menuItems);
  }

  // ADR-076 v2 Phase 3：适配器控件全部经声明式根菜单注入（ctx.menu.setAdapterItems / content.menuItems）
  // 不再有 topBar 或 sidePanel 额外挂载

  // fullCleanup 已提为 mount-session.ts 的 runFullCleanup(ctx)（MountCtx 上下文模式）

  return { content: session.content };
}

// ===== mount3D 失败路径清理（catch 体抽为叶函数，纯搬家原 L851–L876）=====
/**
 * adapter.build 抛错时 session.content 为 null，session.content?.dispose() 是 no-op，
 * half-built mesh 留在 scene 中成为幽灵基线——下次 mount 把垃圾快照进 baseline。
 * 此处不移除 overlay/DOM（fullCleanup 语义，overlay 上保留 showLoadFailure 错误提示），
 * 只清场景中的半成品 + dispose 已注册 content + 解绑输入监听/停 rAF/拆菜单。
 */
function recoverMountFailure(ctx: MountCtx, loadingEl: HTMLElement, e: unknown): void {
  const session = ctx.session;
  // escH 解绑已归位 teardown 共用区（mount-session.ts ①b）——三档统一，本处不再手动补。
  runFailedMountCleanup(ctx);
  const infra = ctx.getInfra();
  if (infra && session.sceneBaseline) {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const stale = infra.scene.children.filter((c): boolean => !session.sceneBaseline!.has(c));
    for (const c of stale) infra.scene.remove(c);
  }
  for (const b of session.allContent) safeDispose(b);
  session.allContent.length = 0;
  // 不单独调 session.content?.dispose()——content 已在 allContent 中，
  // P2 守卫（对齐旧 skeleton close3D 语义）：加载期间被 ESC/切模型/invalidate
  // 打断后迟到的失败不得再弹错——否则关闭后 1~2s 突然冒「加载失败」toast，
  // 掩盖用户主动关闭的意图（旧实现 skeleton.ts 的 gen 守卫，迁移到核心统一承担）。
  if (session.aborted.v || ctx.myGen !== ctx.getGen()) return;
  logError("preview 3D", "加载失败", e);
  showLoadFailure(loadingEl, e);
}

// ===== mount3D 收尾（escH 替换 + sessionHandle 构造 + 句柄入列，纯搬家原 L830–L850）=====
function commitSession(ctx: MountCtx, switchCtx: SwitchContext, content: PreviewScene): void {
  const session = ctx.session;
  session.status = "mounted"; // ADR-233：build 成功、活跃
  // 复用 escH 可变引用，switchTo 后旧 handler 被替换，新 handler 在 cleanup 时通过 getter 正确卸载
  // R1-P1-2：先保存旧引用再替换，否则 removeEventListener 移除的是新函数（从未注册过），旧函数仍残留
  const oldEscH = session.escH;
  session.escH = (e: KeyboardEvent): void => {
    if (e.key === "Escape") runFullCleanup(ctx);
  };
  document.removeEventListener("keydown", oldEscH);
  document.addEventListener("keydown", session.escH);
  session.cleanupFn = () => runFullCleanup(ctx);
  // build 成功 → 本会话成为活跃输入会话（render-loop 动态读取 keys/camSpeed/orbitMode）。
  // self-mode session 不绑 WASD（buildInfra `if (!selfMode)` 守卫
  // 跳过输入绑定，keys 恒空）——不得抢占活跃输入 slot，否则共享/动画 session 的 WASD 立即失效
  if (!ctx.selfMode) setActiveInputSession(session);
  const sessionHandle: PreviewHandle = {
    cleanup: () => runFullCleanup(ctx),
    resetCamera: content.resetCamera,
    setRotationMode: content.setRotationMode,
    setSpeed: content.setSpeed,
    showModelGroup: content.showModelGroup,
    onBoneSelect: content.onBoneSelect,
    // 截图不做 handle 透传（消费方审计 2026-09-04）：shotNodes 菜单闭包直取，此处曾死透传
    // 当前会话内切换模型：复用外壳（renderer/rAF/controls/灯光）重建内容层（ADR-066 §5.6）
    // 支持 keepInScene 模式：true 时不移除旧模型，新模型追加到同一场景（多模型同台）
    switchTo: (newPath: string, options?: { keepInScene?: boolean }) =>
      switchToSession(switchCtx, newPath, options),
  };
  ctx.handles.push({ handle: sessionHandle, gen: ctx.myGen });
}
