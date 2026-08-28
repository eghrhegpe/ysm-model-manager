// ===== YSM 3D 内容适配器（ADR-066 §5.7 shared 化：path 驱动 + 统一外壳）=====
// 从 self 模式（自驱 renderer 绕开统一外壳）改为 shared 模式：内容层
// buildYsmObject 挂进核心 ctx.scene，renderer/camera/controls/rAF 由
// mount-preview-core 统一提供——与 vrm/litematic 完全同构。
//
// 数据层 path 驱动（用户反馈：model 闭包不能 path 切换）：build(ctx, path)
// 内经注入的 loader(path) 加载 model（预览面板语境的数据加载链，含缓存/
// WASM/Go 兜底，由 skeleton 层注入），switchTo(newPath) 对 YSM 生效。
//
// YSM 特色保留：骨骼射线拾取（绑核心 renderer.domElement）、声明式根菜单专属项
// （model/截图/骨骼 经 built.menuItems 由 mount 层统一 feed dock + 角色详情归口，ADR-076 v2 Phase 2、ADR-093）。
// 已知降级（后续补）：调试模式（F 键 normal/pivot/bone 可视化）暂不接入 shared。
// ⚠️ 已解除：F 键调试模式现已接入 shared 模式，经 rebuildDebug 复用旧 renderModel3D 的
// 相同逻辑（pivot 线 + 骨骼连接 + Sprite 标签），与旧单例路径行为一致。
import * as THREE from "three";
import { RESOURCE_TYPES } from "../../resource/types.ts";
import { buildYsmObject, type YsmObjectHandle } from "../ysm-object.ts";
import { fitCameraToScene } from "../camera-setup.ts";
import { buildBoneHierarchy, registerBoneRaycast } from "../bone-raycast.ts";
import { buildBoneTree, type BoneNode, type BoneTree } from "../bone-tools.ts";
import { rebuildDebug } from "../debug-render.ts";
import { disposeDebugGroup } from "../cleanup-helper.ts";
import { screenshotFromRenderer } from "../screenshot.ts";
import type { YsmContentHandle, YsmControlsContext } from "../../../views/app-preview/ysm-controls.ts";
import type { PreviewMenuNode } from "./preview-menu-node-types.ts";
import { YSM_MODEL_SCHEMA_ID, unregisterSchema } from "./schema-registry.ts";
import { resetActiveComponent } from "../state/preview-state.ts";
import type { Spec3D, BoneSelectInfo, BoneMaps } from "../model3d.ts";
import { sceneRegistry } from "./scene-registry.ts";
import type { BedrockGeometry } from "../../../views/app-preview/geometry.ts";
import type { PreviewScene, PreviewBuildCtx, PreviewAdapter } from "./mount-preview-core.ts";
import { makeBonePanelRenderer } from "./vrm-bone-ui.ts"; // ADR-074 S2: 通用骨骼面板
import { buildPerceptionControls, type PerceptionState, type PerceptionCapability } from "./perception-controls.ts";
import { registerModelRoot, unregisterModelRoot } from "../frustum-cull.ts";
import { createYsmAnimPlayer, type YsmAnimPlayer } from "../ysm-animation-player.ts";
import { parseBedrockAnimationJSON, ysmAnimClipLabels, type AnimationClip } from "../../animation/animation.ts";
import { parseAnimationControllerJSON, type AnimationController } from "../../animation/animation-controller.ts";
import { b64ToBytes } from "../base64.ts";
import type { MmdPlayBridge } from "../../../views/app-preview/mmd-controls.ts";
import { ysmSemanticBoneMap } from "../semantic-bones.ts";
import { createBreathController } from "../perception/breath.ts";
import { recordLoadTrace } from "../load-trace.ts";

/** 适配器可选项：loader 注入（预览面板语境数据加载链）/ 纹理重建 / 关闭回调 */
export interface YsmAdapterOptions {
  /** path → model 加载器（由 skeleton 层注入：loadModelData(p, ctx)，含缓存/WASM/Go 兜底） */
  loader: (path: string) => Promise<BedrockGeometry | null>;
  /** preloadModel 注入（视图壳层数据转换：model → { texArr, spec, componentTexMap }，含 WASM/Go 兜底） */
  preload: (model: unknown) => Promise<{ texArr: (THREE.Texture | null)[]; spec: unknown; componentTexMap: Map<string, (THREE.Texture | null)[]> }>;
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
  /** core 关闭（ESC / 关闭按钮 / 切模型 cleanup）时回调：复位调用方状态 + 注销 android-back */
  onClose?: () => void;
  /** 当前纹理下标（多纹理模型重建时传入） */
  texIdx?: number;
  /**
   * 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1，ADR 分层契约）。
   * 缺失时菜单 render / 骨骼拾取联动退化为 no-op（测试与无面板场景安全）。
   */
  panels?: {
    fillShotPanel: (list: HTMLElement, ctx: YsmControlsContext) => void;
    /** 声明式节点工厂（[doc:adr-126-p4-b-2] 注入通道回归）：R1 禁 utils 运行时依赖 views，
     *  ysmShotNodes 必须经此处由视图层注入（缺失 → children 空、面板不渲染） */
    shotNodes?: (ctx: YsmControlsContext) => PreviewMenuNode[];
    /** [doc:adr-126-p5-c] 受控 schema 注册钩子：build 拿到 controlsCtx 后调用，
     *  视图层在此注册 buildYsmModelSchema（key="ysm-model"）——model 面板内容走 schema-registry */
    registerModelSchema?: (ctx: YsmControlsContext) => void;
  };
  /** 同目录文件枚举（.animation.json 扫描用；对齐 VRM listAllFilePaths 注入模式） */
  listAllFilePaths?: (dir: string) => Promise<string[] | null>;
  /** base64 文本读取（读 .animation.json 字节用；对齐 VRM readFn 注入模式） */
  readTextFile?: (path: string) => Promise<string | null>;
  /** 播放面板填充回调（视图层注入；复用 fillMmdPlayPanel，解除 utils→views 分层违规 R1） */
  fillPlayPanel?: (list: HTMLElement, bridge: MmdPlayBridge) => void;
  /**
   * 渲染模式（ADR-Bedrock 通用化）：
   * - "ysm"（默认）：启用 YSM 专属特性（动画扫描、语义骨骼、呼吸控制）
   * - "generic"：纯 Bedrock 渲染，跳过 YSM 专属特性（用于车万女仆等通用 Bedrock 模型）
   */
  mode?: "ysm" | "generic";
}

/** 骨骼拾取状态（bone-raycast 需要的最小 state） */
function makeRayState(): {
  hoveredBone: string | null;
  hoveredMesh: unknown;
  setHoveredBone: (v: string | null) => void;
  setHoveredMesh: (v: unknown) => void;
  onBoneSelectCallback: ((info: BoneSelectInfo) => void) | null;
} {
  const s = {
    hoveredBone: null as string | null,
    hoveredMesh: null as unknown,
    setHoveredBone: (v: string | null) => {
      s.hoveredBone = v;
    },
    setHoveredMesh: (v: unknown) => {
      s.hoveredMesh = v;
    },
    onBoneSelectCallback: null as ((info: BoneSelectInfo) => void) | null,
  };
  return s;
}

/** 类型提级：buildYsmScene 多阶段共享基础上下文（包级非导出） */
interface MdYsSceneCtx {
  ctx: PreviewBuildCtx;
  path: string;
  opts: YsmAdapterOptions;
  tStart: number;
  tLoadStart: number;
  tLoadEnd: number;
  tPreloadStart: number;
  tPreloadEnd: number;
  tBuildStart: number;
  tBuildEnd: number;
}

/** 阶段①产物：数据加载 + 场景图构建核心 */
interface MdYsBuildCore {
  model: BedrockGeometry;
  texIdx: number;
  texArr: (THREE.Texture | null)[];
  spec: Spec3D;
  componentTexMap: Map<string, (THREE.Texture | null)[]>;
  obj: YsmObjectHandle;
}

/** 阶段②产物：相机 + 骨骼拾取系统 */
interface MdYsCameraBones {
  initCamPos: THREE.Vector3;
  initCamTarget: THREE.Vector3;
  rayState: ReturnType<typeof makeRayState>;
  nameMap: Map<string, string>;
  parentMap: Map<string, string | null>;
  childrenMap: Map<string, string[]>;
  rayCleanup: () => void;
  boneMaps: BoneMaps;
  content: YsmContentHandle;
}

/** 阶段③产物：骨骼面板 + 动画/感知系统 */
interface MdYsPanelAnim {
  bonePanelRef: YsmBonePanelRef;
  boneTree: BoneTree;
  animPlayer: YsmAnimPlayer | null;
  animBridge: MmdPlayBridge | null;
  semanticBones: import("../semantic-bones.ts").SemanticBoneMap | null;
  breath: ReturnType<typeof createBreathController> | null;
}

/** 阶段④产物：菜单 + 调试模式 */
interface MdYsMenuDebug {
  controlsCtx: YsmControlsContext;
  perceptionState: PerceptionState;
  menuItems: PreviewMenuNode[];
  debugState: { debugMode: "normal" | "pivot" | "bone"; debugGroup: THREE.Group | null };
  onFKeyDown: (e: KeyboardEvent) => void;
}

/** 阶段①：头部数据加载 + buildYsmObject 挂场景 */
async function mdYsLoadAndBuild(sc: MdYsSceneCtx): Promise<MdYsBuildCore> {
  const model = await sc.opts.loader(sc.path);
  sc.tLoadEnd = performance.now();
  if (!model) throw new Error("模型数据加载失败: " + sc.path);

  const texIdx = sc.opts.texIdx ?? 0;
  sc.tPreloadStart = performance.now();
  const { texArr, spec, componentTexMap } = await sc.opts.preload(model);
  sc.tPreloadEnd = performance.now();

  sc.tBuildStart = performance.now();
  const obj: YsmObjectHandle = buildYsmObject(spec as Spec3D, texArr, componentTexMap, texIdx);
  sc.tBuildEnd = performance.now();
  sc.ctx.scene!.add(obj.rootGroup);
  registerModelRoot(obj.rootGroup);

  return { model, texIdx, texArr, spec: spec as Spec3D, componentTexMap, obj };
}

/** 阶段②：相机取景 + 骨骼拾取系统 + content 句柄 */
function mdYsSetupCameraAndBones(sc: MdYsSceneCtx, core: MdYsBuildCore): MdYsCameraBones {
  const { ctx, opts } = sc;
  const { obj, spec } = core;

  fitCameraToScene(obj.rootGroup, ctx.camera!, ctx.controls!);
  const initCamPos = ctx.camera!.position.clone();
  const initCamTarget = ctx.controls!.target.clone();

  const rayState = makeRayState();
  const { nameMap, parentMap, childrenMap } = buildBoneHierarchy(spec);
  const multiMode = sceneRegistry.count() >= 1;
  const rayCleanup = multiMode
    ? () => {}
    : registerBoneRaycast(
        ctx.renderer!,
        ctx.camera!,
        ctx.scene!,
        obj.boneGroupMap,
        nameMap,
        parentMap,
        childrenMap,
        rayState as never,
      );
  const boneMaps: BoneMaps = { boneGroupMap: obj.boneGroupMap, nameMap, parentMap, childrenMap };

  const content: YsmContentHandle = {
    showModelGroup: (i: number) => obj.showModelGroup(i),
    getModelGroupCount: () => obj.getModelGroupCount(),
    setBoneVisible: (name: string, visible: boolean) => obj.setBoneVisible(name, visible),
    toggleBone: (name: string) => obj.toggleBone(name),
    getBoneList: (modelIdx?: number) => obj.getBoneList(modelIdx),
    onBoneSelect: null,
    _boneDetailEl: null,
  };
  rayState.onBoneSelectCallback = (info: BoneSelectInfo) => {
    content.onBoneSelect?.(info);
  };

  return { initCamPos, initCamTarget, rayState, nameMap, parentMap, childrenMap, rayCleanup, boneMaps, content };
}

/** 子辅助：磁盘扫描 .animation.json / .animation_controllers.json（阶段③内提纯） */
async function mdYsScanAnimFiles(
  sc: MdYsSceneCtx,
): Promise<{ clips: Array<{ label: string; clip: AnimationClip }>; controllers: AnimationController[] }> {
  const { opts, path } = sc;
  const allClips: Array<{ label: string; clip: AnimationClip }> = [];
  const allControllers: AnimationController[] = [];
  if (!opts.listAllFilePaths || !opts.readTextFile) return { clips: allClips, controllers: allControllers };

  const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
  const files = (await opts.listAllFilePaths(dirPath)) || [];
  const animFiles = files.filter((f) => f.toLowerCase().endsWith(".animation.json"));
  const controllerFiles = files.filter((f) => f.toLowerCase().endsWith(".animation_controllers.json"));

  for (const animFile of animFiles) {
    try {
      const b64 = await opts.readTextFile(animFile);
      if (!b64) continue;
      const text = new TextDecoder("utf-8").decode(b64ToBytes(b64));
      const { clips } = parseBedrockAnimationJSON(text);
      if (clips.length > 0) {
        const fileBase = animFile.split(/[/\\]/).pop()!.replace(/\.animation\.json$/i, "");
        const fileLabels = ysmAnimClipLabels(fileBase, clips);
        for (let ci = 0; ci < clips.length; ci++) {
          allClips.push({ label: fileLabels[ci], clip: clips[ci] });
        }
      }
    } catch { /* 单个文件解析失败跳过 */ }
  }

  for (const ctrlFile of controllerFiles) {
    try {
      const b64 = await opts.readTextFile(ctrlFile);
      if (!b64) continue;
      const text = new TextDecoder("utf-8").decode(b64ToBytes(b64));
      const { controllers } = parseAnimationControllerJSON(text);
      if (controllers.length > 0) allControllers.push(...controllers);
    } catch { /* 单个控制器文件解析失败跳过 */ }
  }
  return { clips: allClips, controllers: allControllers };
}

/** 阶段③：骨骼面板树 + 动画/感知系统（ADR-100 L1+L2+L3） */
async function mdYsBuildBonePanelAndAnim(
  sc: MdYsSceneCtx,
  core: MdYsBuildCore,
): Promise<MdYsPanelAnim> {
  const { ctx, opts } = sc;
  const { obj, spec, model } = core;

  const bonePanelRef: YsmBonePanelRef = { current: null };
  const specBones = spec.models?.flatMap((m) => m.bones ?? []) ?? [];
  const boneNodes: BoneNode[] = specBones.map((b) => ({
    id: b.id,
    name: b.name,
    parentId: b.parentId ?? null,
    object: obj.boneGroupMap.get(b.id),
  }));
  const boneTree = buildBoneTree(boneNodes);
  ctx.loadingEl.remove();

  const isGenericMode = opts.mode === "generic";
  let animPlayer: YsmAnimPlayer | null = null;
  let animBridge: MmdPlayBridge | null = null;
  let semanticBones: import("../semantic-bones.ts").SemanticBoneMap | null = null;
  let breath: ReturnType<typeof createBreathController> | null = null;

  if (!isGenericMode) {
    try {
      const sb = spec.models?.flatMap((m) => m.bones ?? []) ?? [];
      semanticBones = ysmSemanticBoneMap(sb);
      breath = createBreathController();

      const allClips: Array<{ label: string; clip: AnimationClip }> = [];
      const allControllers: AnimationController[] = [];
      const embedded = model._animClips ?? [];
      if (embedded.length > 0) {
        embedded.forEach((clip, i) => {
          allClips.push({ label: clip.name || `Clip ${i + 1}`, clip });
        });
      } else {
        const scanned = await mdYsScanAnimFiles(sc);
        allClips.push(...scanned.clips);
        allControllers.push(...scanned.controllers);
      }
      if (allClips.length > 0) {
        const boneByName = new Map<string, THREE.Object3D>();
        for (const sbi of sb) {
          const group = obj.boneGroupMap.get(sbi.id);
          if (group) boneByName.set(sbi.name, group);
        }
        const hierarchy: import("../../animation/animation.ts").BoneHierarchyNode[] =
          sb.map((b) => ({ name: b.name, parent: b.parentId ?? undefined }));
        const labels = allClips.map((c) => c.label);
        const clips = allClips.map((c) => c.clip);
        animPlayer = createYsmAnimPlayer(boneByName, clips, hierarchy, labels);
        if (allControllers.length > 0) animPlayer.setController(allControllers[0]);
        animBridge = {
          clips: allClips.map((c) => ({ label: c.label })),
          isPlaying: () => animPlayer?.isPlaying() ?? false,
          toggle: () => animPlayer?.toggle(),
          currentIndex: () => animPlayer?.currentIndex() ?? 0,
          select: (i: number) => animPlayer?.selectClip(i),
          animDir: null,
        };
      }
    } catch {
      /* 动画扫描失败 → 静默降级，不影响模型渲染 */
    }
  }
  return { bonePanelRef, boneTree, animPlayer, animBridge, semanticBones, breath };
}

/** 阶段④：声明式根菜单 + F 键调试模式 + perf trace 记录 */
function mdYsBuildMenuAndDebug(
  sc: MdYsSceneCtx,
  core: MdYsBuildCore,
  cam: MdYsCameraBones,
  anim: MdYsPanelAnim,
): MdYsMenuDebug {
  const { ctx, opts } = sc;
  const { model, texIdx, texArr, spec, obj } = core;
  const { content } = cam;
  const { bonePanelRef, boneTree, animBridge } = anim;

  const controlsCtx: YsmControlsContext = {
    model,
    texIdx: opts.texIdx ?? 0,
    texArr,
    spec,
    handle: content,
    cameraControls: ctx.cameraControls,
    onTextureChange: opts.onTextureChange,
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene!, ctx.camera!)),
  };
  const perceptionState: PerceptionState = { breath: true, gaze: false, blink: false, lipSync: false, autoDance: false };
  const perceptionCaps: PerceptionCapability[] = [
    { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
  ];
  // [doc:adr-126-p5-c] 受控 schema 注册：model 面板内容由视图层注册的 builder 驱动
  // （R1 禁 utils→views，注册钩子由视图层注入实现）。所有调用者（ysm-3d / maid-3d）都
  // 经 registerModelSchema 注册；缺失时不注册 → schemaId 无 fallback（契约禁双通道），面板空渲染。
  opts.panels?.registerModelSchema?.(controlsCtx);
  const menuItems = ysmMenuItems({
    controlsCtx,
    panels: opts.panels,
    bonePanel: {
      tree: boneTree,
      viewContainer: ctx.viewContainer,
      camera: ctx.camera,
      scene: ctx.scene,
      cleanupRef: bonePanelRef,
    },
    play: animBridge ?? undefined,
    fillPlayPanel: opts.fillPlayPanel,
    perception: { state: perceptionState, caps: perceptionCaps },
  });

  const debugState = {
    debugMode: "normal" as "normal" | "pivot" | "bone",
    debugGroup: null as THREE.Group | null,
  };
  const onFKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "f" && e.key !== "F") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const modes: Array<"normal" | "pivot" | "bone"> = ["normal", "pivot", "bone"];
    const currentIdx = modes.indexOf(debugState.debugMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    debugState.debugMode = nextMode;
    rebuildDebug(ctx.scene as THREE.Scene, obj.rootGroup, obj.boneGroupMap, spec, debugState);
  };
  ctx.renderer!.domElement.addEventListener("keydown", onFKeyDown);

  try {
    const allBones = spec.models?.flatMap((m) => m.bones ?? []) ?? [];
    const texCount = texArr.filter(Boolean).length;
    recordLoadTrace({
      ts: Date.now(),
      format: "ysm",
      path: sc.path,
      stages: [
        { name: "读取", ms: Math.round(sc.tLoadStart - sc.tStart), status: "ok" },
        { name: "解析", ms: Math.round(sc.tLoadEnd - sc.tLoadStart), status: "ok" },
        { name: "纹理加载", ms: Math.round(sc.tPreloadEnd - sc.tPreloadStart), status: "ok" },
        { name: "build", ms: Math.round(sc.tBuildEnd - sc.tBuildStart), status: "ok" },
      ],
      assets: {
        files: 1,
        textures: texCount,
        bones: allBones.length,
        cubes: (model as { cubeCount?: number }).cubeCount ?? 0,
        materials: spec.models?.length ?? 0,
        animations: 0,
      },
      ok: true,
    });
  } catch { /* perf trace 失败不影响渲染 */ }

  return { controlsCtx, perceptionState, menuItems, debugState, onFKeyDown };
}

/** 阶段⑤：组装 PreviewScene 返回句柄（dispose/reset/update 等） */
function mdYsMakeSceneHandle(
  sc: MdYsSceneCtx,
  core: MdYsBuildCore,
  cam: MdYsCameraBones,
  anim: MdYsPanelAnim,
  menu: MdYsMenuDebug,
): PreviewScene {
  const { ctx } = sc;
  const { obj } = core;
  const { initCamPos, initCamTarget, rayCleanup, boneMaps } = cam;
  const { bonePanelRef, animPlayer, semanticBones, breath } = anim;
  const { menuItems, debugState, onFKeyDown, perceptionState } = menu;

  return {
    dispose(): void {
      rayCleanup();
      bonePanelRef.current?.();
      unregisterModelRoot(obj.rootGroup);
      obj.removeFromScene(ctx.scene as THREE.Scene);
      ctx.renderer!.domElement.removeEventListener("keydown", onFKeyDown);
      if (debugState.debugGroup) {
        disposeDebugGroup(debugState.debugGroup);
        debugState.debugGroup = null;
      }
      animPlayer?.dispose();
      breath?.dispose();
      // [doc:adr-126-p5] dispose 注销 schema：防跨会话污染（陈旧 builder 闭包持有已销毁场景
      // 的 model/texArr/handle，不清理会泄漏 WebGL 纹理集 + maid 等后续预览渲染旧模型数据）
      unregisterSchema(YSM_MODEL_SCHEMA_ID);
      // 会话态组件选择重置（-1 = All）：防跨预览陈旧下标（P5-A review P2）
      resetActiveComponent();
    },
    resetCamera(): void {
      ctx.camera!.position.copy(initCamPos);
      ctx.controls!.target.copy(initCamTarget);
      ctx.controls!.update();
    },
    setRotationMode: (orbit: boolean) => ctx.cameraControls?.setOrbit(orbit),
    setSpeed: (n: number) => ctx.cameraControls?.setSpeed(n),
    showModelGroup: (i: number) => obj.showModelGroup(i),
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene!, ctx.camera!)),
    boneMaps,
    menuItems,
    onBonePick: (id: string) => ctx.menu.openPanel(id),
    update: (dt: number): void => {
      animPlayer?.apply(dt);
      if (semanticBones && !animPlayer?.isAnimActive() && perceptionState.breath) {
        breath?.apply(dt, semanticBones);
      }
    },
  };
}

/**
 * 构建 YSM 3D 内容并挂载到统一外壳（shared 模式）。
 * path 驱动：loader(path) → model → preloadModel → buildYsmObject 挂 ctx.scene。
 */
export async function buildYsmScene(
  ctx: PreviewBuildCtx,
  path: string,
  opts: YsmAdapterOptions,
): Promise<PreviewScene> {
  if (!ctx.scene || !ctx.camera || !ctx.controls || !ctx.renderer) {
    throw new Error("YSM shared 模式需要核心提供 scene/camera/controls/renderer");
  }

  const now = () => performance.now();
  const sc: MdYsSceneCtx = {
    ctx, path, opts,
    tStart: now(),
    tLoadStart: now(),
    tLoadEnd: 0,
    tPreloadStart: 0,
    tPreloadEnd: 0,
    tBuildStart: 0,
    tBuildEnd: 0,
  };
  sc.tLoadStart = sc.tStart;

  const core = await mdYsLoadAndBuild(sc);
  const cam = mdYsSetupCameraAndBones(sc, core);
  const anim = await mdYsBuildBonePanelAndAnim(sc, core);
  const menu = mdYsBuildMenuAndDebug(sc, core, cam, anim);
  return mdYsMakeSceneHandle(sc, core, cam, anim, menu);
}

/** 工厂：构造统一 PreviewAdapter（shared 模式） */
export function makeYsmAdapter(path: string, opts: YsmAdapterOptions): PreviewAdapter {
  return {
    id: RESOURCE_TYPES.YSM,
    // shared 模式（§5.7）：核心提供 renderer/scene/camera/controls/rAF，适配器只注入内容
    onClose: opts.onClose,
    // 必须用 build 传入的 path（switchTo(newPath) 重建内容层的换模型入口），
    // 闭包 path 仅是首次挂载的初始值——否则 switchTo 对 YSM 加载同一旧模型（假切换）。
    build(ctx: PreviewBuildCtx, buildPath: string): Promise<PreviewScene> {
      return buildYsmScene(ctx, buildPath, opts);
    },
  };
}

/** 骨骼面板清理引用（菜单项 render 与 adapter dispose 共享，防重入泄漏） */
interface YsmBonePanelRef {
  current: (() => void) | null;
}

/** ysmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface YsmMenuItemsOpts {
  controlsCtx: YsmControlsContext;
  /** 骨骼面板依赖（render 闭包 + 清理引用） */
  bonePanel: {
    /** 已构建骨骼树（buildBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: YsmBonePanelRef;
  };
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: {
    fillShotPanel: (list: HTMLElement, ctx: YsmControlsContext) => void;
    /** 声明式节点工厂（[doc:adr-126-p4-b-2] 注入通道回归）：R1 禁 utils 运行时依赖 views，
     *  ysmShotNodes 必须经此处由视图层注入（缺失 → children 空、面板不渲染） */
    shotNodes?: (ctx: YsmControlsContext) => PreviewMenuNode[];
    // 注：registerModelSchema 只在 YsmAdapterOptions（makeYsmAdapter opts）消费——
    // ysmMenuItems 不读它，不在此重复声明（防两接口分化，P5-A review P3）
  };
  /** YSM 动画桥（ADR-100）；null/缺省（无 .animation.json）→ 不注入 play 项 */
  play?: MmdPlayBridge | null | undefined;
  /** 播放面板填充回调（视图层注入；复用 fillMmdPlayPanel，解除 utils→views 分层违规 R1） */
  fillPlayPanel?: (list: HTMLElement, bridge: MmdPlayBridge) => void;
  /** 感知层状态（adapter build 创建，面板 UI 双向绑定） */
  perception?: {
    state: PerceptionState;
    caps: PerceptionCapability[];
  };
}

/**
 * YSM 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 截图 / 骨骼。
 * 提取为可导出表：适配器与测试共用同一份真实数组——测试遍历本表断言结构与
 * dock 渲染（对齐 MikuMikuAR 声明式菜单测试范式），加菜单项只改这里。
 * model/截图/骨骼 归 🧍 模型组；play 归 💃 动作组（有 clip 才显示）。
 */
export function ysmMenuItems(o: YsmMenuItemsOpts): PreviewMenuNode[] {
  const items: PreviewMenuNode[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "ysm-model-entry",
      // [doc:adr-126-p5-c] 受控 schema 驱动：renderPreviewPanel 优先查 schema-registry 的
      // YSM_MODEL_SCHEMA_ID，builder（buildYsmModelSchema）吃状态层快照产出声明式节点。
      // schemaId 是唯一渲染通道（契约：带 schemaId 不得同时带 renderCustom——双通道歧义）；
      // 所有 makeYsmAdapter 调用者（ysm-3d / maid-3d）必须经 registerModelSchema 注册，
      // 缺失则面板空渲染（P5-A review P1 修复：maid-3d 已补注册）。
      schemaId: YSM_MODEL_SCHEMA_ID,
    },
    {
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "ysm-shot-entry",
      // [doc:adr-126-p4-b-2] 面板内容声明式化：children = shotNodes 纯数据节点（经 panels 注入，
      // R1 禁 utils→views 运行时依赖）。YSM 的 screenshot 是 ctx 可选字段（undefined 走 fallback），
      // 面板常驻——不按能力条件注入。
      children: o.panels?.shotNodes?.(o.controlsCtx) ?? [],
    },
    {
      id: "bones",
      icon: "🦴",
      labelKey: "preview.section.bones",
      fallback: "骨骼",
      kind: "panel",
      dockGroup: "motion",
      legacyTestId: "ysm-bones-entry",
      renderCustom:(list) => {
        // 通用骨骼面板（ADR-077）：渲染进根菜单面板；重入时先清理旧 renderer
        if (o.bonePanel.cleanupRef.current) {
          o.bonePanel.cleanupRef.current();
          o.bonePanel.cleanupRef.current = null;
        }
        o.bonePanel.cleanupRef.current = makeBonePanelRenderer(o.bonePanel.tree)(list, {
          viewContainer: o.bonePanel.viewContainer!,
          camera: o.bonePanel.camera!,
          scene: o.bonePanel.scene!,
        });
      },
    },
  ];
  if (o.play) {
    items.push({
      id: "ysm-play",
      icon: "▶️",
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      kind: "panel",
      legacyTestId: "ysm-play-entry",
      dockGroup: "motion",
      renderCustom:(list) => {
        o.fillPlayPanel?.(list, o.play!);
      },
    });
  }
  if (o.perception) {
    items.push({
      id: "perception",
      icon: "👁️",
      labelKey: "preview.perception",
      fallback: "感知",
      kind: "panel",
      dockGroup: "motion",
      renderCustom:(list) => buildPerceptionControls(list, o.perception!.state, o.perception!.caps),
    });
  }
  return items;
}
