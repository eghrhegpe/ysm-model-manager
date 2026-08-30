// ===== VRM 内容适配器（ADR-066 P3：从 vrm-3d.ts 抽离内容层）=====
// 本文件只负责 VRM 专属逻辑：经 Go 绑定 ReadFileBytes 取字节 → 官方 GLTFLoader +
// VRMLoaderPlugin 解析 → rotateVRM0 摆正 → 注入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip, type VRMAnimation } from "@pixiv/three-vrm-animation";
import type { VRM0Meta } from "@pixiv/three-vrm-core";
import { t } from "../../../core/i18n/t.ts";
import { makeBonesPanelItem } from "./bones-panel-node.ts"; // 通用骨骼菜单项工厂（4 adapter 共用，ADR-074 S2 之上）
import { buildVrmBoneTree } from "./vrm-bone.ts";
import { vrmSemanticBoneMap } from "../semantic-bones.ts";
import { createBreathController } from "../perception/breath.ts"; // 语义骨骼消费方：程序化生命力 L1
import { createGazeController } from "../perception/gaze.ts"; // 语义骨骼消费方：程序化生命力 L2
import { createBlinkController } from "../perception/blink.ts"; // 语义表情消费方：程序化生命力 L1.5
import { createFootIKController } from "../mmd-foot-ik.ts"; // 程序化足部锚地（待机态 IK，格式无关）
import { recordLoadTrace } from "../load-trace.ts";
import { frameCameraSide } from "../camera-setup.ts";
import { screenshotFromRenderer } from "../screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import { renderLoadingState } from "./preview-loading.ts";
import { b64ToBytes } from "../base64.ts";
import { collectSceneStats, type SceneStats } from "../scene-stats.ts";
import { perceptionNodes, type PerceptionState, type PerceptionCapability } from "./perception-controls.ts";
import { materialNodes } from "./material-controls.ts";
import { registerModelRoot, unregisterModelRoot } from "../frustum-cull.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import type { BoneTree } from "../bone-tools.ts";
import type { PreviewMenuNode } from "./preview-menu/node-types.ts";

/** VRM 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） */
export interface VrmDataPort {
  addOpLog(op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void>;
}

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
async function vrmDiag(
  port: VrmDataPort,
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
): Promise<void> {
  try {
    await port.addOpLog(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}
import {
  listVrmMaterials,
  getVrmMaterialDetail,
  setVrmMaterialVisible,
  setVrmMaterialOpacity,
} from "../vrm-materials.ts";
import type { MmdPlayBridge } from "../../../views/app-preview/mmd-controls.ts";

/** 把 THREE.Texture / HTMLImageElement 转 dataURL（meta 卡缩略图） */
function imageToDataURL(img: unknown): string {
  try {
    // VRM0 meta.texture 是 THREE.Texture（取 .image）；VRM1 meta.thumbnailImage 直接是 HTMLImageElement
    const holder = img as { image?: unknown } | null;
    const raw = holder && typeof holder.image !== "undefined" ? holder.image : img;
    const source = raw as HTMLImageElement | HTMLCanvasElement | ImageBitmap | null;
    if (!source) return "";
    const w =
      source instanceof HTMLImageElement
        ? source.naturalWidth
        : (source as HTMLCanvasElement | ImageBitmap).width;
    const h =
      source instanceof HTMLImageElement
        ? source.naturalHeight
        : (source as HTMLCanvasElement | ImageBitmap).height;
    if (!w || !h) return "";
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return "";
    g.drawImage(source as CanvasImageSource, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/** VRM meta 归一化信息（meta 卡展示用） */
export interface VrmMetaInfo {
  name: string;
  authors: string[];
  version?: string;
  license?: string;
  contact?: string;
  thumbnail?: string; // dataURL，空串表示无缩略图
  metaVersion: "0" | "1";
  /** VRM0 授权约束徽章（Vrm0Restrictions），VRM1 无此字段 */
  restrictions?: {
    allowedUser: "everyone" | "licensed" | "onlyAuthor";
    commercial: boolean;
    sexual: boolean;
    violent: boolean;
    reference?: string;
  };
  /** 场景统计（ADR-131 P2：复用本次 GLTF parse 顺带采集，零额外成本） */
  stats?: SceneStats;
}

/** 解析 VRM meta（不渲染 3D，parse 后立即 deepDispose），失败返回 null */
export async function readVrmMeta(
  path: string,
  readFn: (p: string) => Promise<string | null>,
): Promise<VrmMetaInfo | null> {
  try {
    const b64 = await readFn(path);
    if (!b64) return null;

    const bytes = b64ToBytes(b64);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    if (!vrm) return null;
    const meta = vrm.meta;
    let info: VrmMetaInfo;
    if (meta.metaVersion === "0") {
      const m = meta as VRM0Meta;
      info = {
        metaVersion: "0",
        name: meta.title || "",
        authors: meta.author ? [meta.author] : [],
        version: meta.version,
        license: meta.licenseName ? meta.licenseName + (meta.otherLicenseUrl ? " · " + meta.otherLicenseUrl : "") : undefined,
        contact: meta.contactInformation,
        thumbnail: meta.texture ? imageToDataURL(meta.texture) : "",
        restrictions: {
          allowedUser: m.allowedUserName === "Everyone" ? "everyone"
            : m.allowedUserName === "ExplicitlyLicensedPerson" ? "licensed"
            : "onlyAuthor",
          commercial: m.commercialUssageName === "Allow",
          sexual: m.sexualUssageName === "Allow",
          violent: m.violentUssageName === "Allow",
          reference: m.reference || undefined,
        },
      };
    } else {
      info = {
        metaVersion: "1",
        name: meta.name || "",
        authors: meta.authors || [],
        version: meta.version,
        license: meta.licenseUrl,
        contact: meta.contactInformation,
        thumbnail: meta.thumbnailImage ? imageToDataURL(meta.thumbnailImage) : "",
      };
    }
    // ADR-131 P2：复用本次 GLTF parse 的 vrm.scene 顺带采集统计（必须在 deepDispose
    // 之前 traverse——dispose 后 geometry/material 已释放，读到的是空数据）
    info.stats = vrm.scene ? collectSceneStats(vrm.scene) : undefined;
    VRMUtils.deepDispose(vrm.scene); // 仅取 meta，释放 parse 出的 GPU 资源
    return info;
  } catch {
    return null;
  }
}

/** VRM 内容构建：把模型挂入核心 scene，返回每帧 update + dispose */
/** VRM 模型信息（model 面板声明式节点数据源；对齐 MMD MmdBottomNavCtx 注入链） */
export interface VrmModelInfoCtx {
  modelName: string;
  boneCount: number;
  materialCount: number;
}

/** 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） */
export interface VrmPanelHooks {
  /** 声明式节点工厂（[doc:adr-126-p4-b-1] 注入通道回归，P5 收尾 VRM 对齐 MMD）：
   *  vrmModelInfoNodes 必须经此处由视图层注入（缺失 → children 空、面板不渲染） */
  modelInfoNodes?: (ctx: VrmModelInfoCtx) => PreviewMenuNode[];
  /** 截图面板声明式节点工厂（[doc:adr-126-p4-b-1] 注入通道回归，P5 收尾：对齐 MMD/YSM
   *  shotNodes 模式，复用 shot-panel-shared；缺失 → children 空、面板不渲染） */
  shotNodes?: (screenshot: (() => Promise<string | null>) | null, modelPath: string) => PreviewMenuNode[];
  /** [doc:adr-126-p5-收尾] play 面板声明式节点（复用 MMD playNodes：toggle 播放/暂停 +
   *  select 动作 + 空态引导）；缺失 → children 空、面板不渲染 */
  playNodes?: (bridge: MmdPlayBridge) => PreviewMenuNode[];
}

interface MdVrParseResult {
  vrm: VRM;
  gltf: GLTF;
  tStart: number;
  tParseStart: number;
  tParseEnd: number;
}
interface MdVrMotionState {
  motionClips: Array<{ label: string; clip: THREE.AnimationClip }>;
  motionMixer: THREE.AnimationMixer | null;
  motionAction: THREE.AnimationAction | null;
  motionPlaying: boolean;
  motionIdx: number;
}
interface MdVrPerceptionState {
  perceptionState: PerceptionState;
  perceptionCaps: PerceptionCapability[];
  breath: ReturnType<typeof createBreathController>;
  gaze: ReturnType<typeof createGazeController> | null;
  blink: ReturnType<typeof createBlinkController>;
  footIK: ReturnType<typeof createFootIKController>;
  useNativeLookAt: boolean;
  blinkExpressionNames: Array<"blink" | "blinkLeft" | "blinkRight">;
  exprMgr: VRM["expressionManager"];
}
interface MdVrBoneAssembly {
  bonePanelRef: { current: (() => void) | null };
  boneTree: BoneTree;
  semanticBones: ReturnType<typeof vrmSemanticBoneMap>;
}

function mdVrParseGlbVrm0(vrm: VRM, gltf: GLTF): void {
  VRMUtils.rotateVRM0(vrm);
  void gltf;
}
function mdVrParseGlbVrm1(vrm: VRM, gltf: GLTF): void {
  void vrm;
  void gltf;
}
async function mdVrStage1ReadParse(
  ctx: PreviewBuildCtx,
  path: string,
  port: VrmDataPort,
  readFn: (p: string) => Promise<string | null>,
): Promise<MdVrParseResult> {
  renderLoadingState(ctx.loadingEl, "🥽", "preview.loadingModel");
  const tStart = performance.now();
  const b64 = await readFn(path);
  await vrmDiag(port, "read-model", path, b64 ? "ok" : "fail", b64 ? `bytes=${b64.length}` : "ReadFileBytes 返回空（路径语义/守卫？）");
  if (!b64) throw new Error("ReadFileBytes 返回空");
  const bytes = b64ToBytes(b64);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const tParseStart = performance.now();
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(buffer, "", resolve, reject);
  });
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  if (!vrm) throw new Error("VRM 实例解析失败（非标准 .vrm？）");
  const metaVersion = vrm.meta.metaVersion;
  if (metaVersion === "0") mdVrParseGlbVrm0(vrm, gltf);
  else mdVrParseGlbVrm1(vrm, gltf);
  ctx.scene!.add(vrm.scene);
  registerModelRoot(vrm.scene);
  ctx.loadingEl.remove();
  const tParseEnd = performance.now();
  await vrmDiag(port, "parse", path, "ok", `bones=${gltf.scenes?.[0]?.children?.length ?? 0} gltf-children=${gltf.scenes?.length ?? 0}`);
  await vrmDiag(port, "perf", path, "ok", `parse=${Math.round(tParseEnd - tParseStart)}ms total=${Math.round(tParseEnd - tStart)}ms`);
  return { vrm, gltf, tStart, tParseStart, tParseEnd };
}
async function mdVrLoadVrmaAnims(
  vrm: VRM,
  path: string,
  readFn: (p: string) => Promise<string | null>,
  listAllFilePaths?: (dir: string) => Promise<string[] | null>,
): Promise<MdVrMotionState> {
  const motionClips: Array<{ label: string; clip: THREE.AnimationClip }> = [];
  let motionMixer: THREE.AnimationMixer | null = null;
  let motionAction: THREE.AnimationAction | null = null;
  let motionPlaying = true;
  let motionIdx = 0;
  if (!listAllFilePaths) return { motionClips, motionMixer, motionAction, motionPlaying, motionIdx };
  try {
    const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
    const files = (await listAllFilePaths(dirPath)) || [];
    const vrmaPaths = files.filter((p) => p.toLowerCase().endsWith(".vrma"));
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    for (const vp of vrmaPaths) {
      try {
        const b64 = await readFn(vp);
        if (!b64) continue;
        const bytes = b64ToBytes(b64);
        const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const animGltf = await new Promise<GLTF>((resolve, reject) => loader.parse(buf, "", resolve, reject));
        const anims = (animGltf.userData as { vrmAnimations?: VRMAnimation[] }).vrmAnimations;
        if (!anims || anims.length === 0) continue;
        motionClips.push({
          label: (vp.split(/[/\\]/).pop() || "motion").replace(/\.vrma$/i, "") || "motion",
          clip: createVRMAnimationClip(anims[0], vrm),
        });
      } catch {
        /* 单个 .vrma 解析失败 → 跳过其余照常 */
      }
    }
    if (motionClips.length > 0) {
      motionMixer = new THREE.AnimationMixer(vrm.scene);
      motionAction = motionMixer.clipAction(motionClips[0].clip);
      motionAction.play();
    }
  } catch {
    /* 目录不可列 → 白模降级，不阻断模型渲染 */
  }
  return { motionClips, motionMixer, motionAction, motionPlaying, motionIdx };
}
function mdVrSetupCameraBounds(ctx: PreviewBuildCtx, vrm: VRM): void {
  // 侧上方取景（对齐 fbx/pack 口径，见 camera-setup.frameCameraSide）
  frameCameraSide(ctx, vrm.scene);
}
function mdVrStage3Materials(vrm: VRM): THREE.Material[] {
  const vrmMaterials: THREE.Material[] = [];
  vrm.scene.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    vrmMaterials.push(...mats);
  });
  return vrmMaterials;
}
function mdVrStage2BonesHumanoid(vrm: VRM): MdVrBoneAssembly {
  const bonePanelRef: { current: (() => void) | null } = { current: null };
  const boneTree = buildVrmBoneTree(vrm);
  const semanticBones = vrmSemanticBoneMap(vrm.humanoid.humanBones);
  return { bonePanelRef, boneTree, semanticBones };
}
function mdVrBuildPerception(vrm: VRM, ctx: PreviewBuildCtx, boneTree: BoneTree, semanticBones: ReturnType<typeof vrmSemanticBoneMap>): MdVrPerceptionState {
  const perceptionState: PerceptionState = { breath: true, gaze: true, blink: true, lipSync: false, autoDance: false };
  const perceptionCaps: PerceptionCapability[] = [
    { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
    { id: "gaze", labelKey: "preview.perceptionGaze", fallback: "注视" },
    { id: "blink", labelKey: "preview.perceptionBlink", fallback: "眨眼" },
  ];
  const breath = createBreathController();
  const useNativeLookAt = !!vrm.lookAt;
  const gaze: ReturnType<typeof createGazeController> | null = useNativeLookAt ? null : createGazeController();
  if (useNativeLookAt) vrm.lookAt!.target = ctx.camera;
  const exprMgr = vrm.expressionManager;
  const blinkExpressionNames = exprMgr
    ? (["blink", "blinkLeft", "blinkRight"] as const).filter((n) => exprMgr.getExpression(n) !== null)
    : [] as Array<"blink" | "blinkLeft" | "blinkRight">;
  const blink = createBlinkController();
  const footIK = createFootIKController(boneTree, semanticBones);
  return { perceptionState, perceptionCaps, breath, gaze, blink, footIK, useNativeLookAt, blinkExpressionNames, exprMgr };
}
function mdVrStage4MenuPanels(
  path: string,
  panels: VrmPanelHooks | undefined,
  ctx: PreviewBuildCtx,
  boneAssy: MdVrBoneAssembly,
  vrmMaterials: THREE.Material[],
  motion: MdVrMotionState,
  perception: MdVrPerceptionState,
): PreviewMenuNode[] {
  const { bonePanelRef, boneTree } = boneAssy;
  const { motionClips, motionMixer } = motion;
  // 模型信息数据源（model 面板 children；名称取文件名去扩展名）
  const modelInfo: VrmModelInfoCtx = {
    modelName: path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || path,
    // 全量骨骼数（byId.size = 提取的全部 humanoid 骨骼 ~52 根；roots 只是无父骨根节点 ≈1，
    // 用它面板会错误显示「1 骨骼」——a400b244 review P2）
    boneCount: boneAssy.boneTree.byId.size,
    materialCount: vrmMaterials.length,
  };
  const menuItems = vrmMenuItems({
    panels,
    modelInfo,
    modelPath: path,
    screenshot: () => Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    bonePanel: {
      tree: boneTree,
      viewContainer: ctx.viewContainer,
      camera: ctx.camera,
      scene: ctx.scene,
      cleanupRef: bonePanelRef,
    },
    material: {
      list: () => listVrmMaterials(vrmMaterials),
      getDetail: (i: number) => getVrmMaterialDetail(vrmMaterials, i),
      setVisible: (i: number, v: boolean) => setVrmMaterialVisible(vrmMaterials, i, v),
      setOpacity: (i: number, o: number) => {
        setVrmMaterialOpacity(vrmMaterials, i, o);
      },
    },
    play: motionClips.length > 0
      ? {
          clips: motionClips.map((c) => ({ label: c.label })),
          isPlaying: () => motion.motionPlaying,
          toggle: () => {
            motion.motionPlaying = !motion.motionPlaying;
            if (motion.motionAction) motion.motionAction.paused = !motion.motionPlaying;
          },
          currentIndex: () => motion.motionIdx,
          select: (i: number) => {
            if (i === motion.motionIdx || !motionMixer) return;
            if (i < 0 || i >= motionClips.length) return;
            motion.motionIdx = i;
            motion.motionAction?.stop();
            motion.motionAction = motionMixer.clipAction(motionClips[i].clip);
            motion.motionAction.play();
            motion.motionAction.paused = !motion.motionPlaying;
          },
          animDir: null,
        }
      : null,
    perception: { state: perception.perceptionState, caps: perception.perceptionCaps },
  });
  return menuItems;
}
function mdVrStage5BuildResult(
  ctx: PreviewBuildCtx,
  path: string,
  port: VrmDataPort,
  parseRes: MdVrParseResult,
  boneAssy: MdVrBoneAssembly,
  vrmMaterials: THREE.Material[],
  motion: MdVrMotionState,
  perception: MdVrPerceptionState,
  menuItems: PreviewMenuNode[],
): PreviewScene {
  const { vrm } = parseRes;
  const { semanticBones, bonePanelRef } = boneAssy;
  const { motionClips, motionMixer } = motion;
  const {
    perceptionState, breath, gaze, blink, footIK,
    useNativeLookAt, blinkExpressionNames, exprMgr,
  } = perception;
  recordLoadTrace({
    ts: Date.now(),
    format: "vrm",
    path,
    stages: [
      { name: "读取", ms: Math.round(parseRes.tParseStart - parseRes.tStart), status: "ok" },
      { name: "解析", ms: Math.round(parseRes.tParseEnd - parseRes.tParseStart), status: "ok" },
    ],
    assets: {
      files: 1,
      textures: vrmMaterials.length,
      bones: boneAssy.boneTree.roots.length,
      materials: vrmMaterials.length,
      animations: motionClips.length,
      vrmaClips: motionClips.length,
    },
    ok: true,
  });
  return {
    menuItems,
    update: (dt: number): void => {
      if (!vrm.scene.visible) return;
      if (motionMixer) motionMixer.update(dt);
      vrm.update(dt);
      const animActive = !!motion.motionAction && !motion.motionAction.paused;
      if (semanticBones) {
        if (!animActive && perceptionState.breath) breath.apply(dt, semanticBones);
        if (!animActive && !useNativeLookAt && perceptionState.gaze) gaze!.apply(dt, semanticBones, ctx.camera!.position);
      }
      footIK.apply(dt, !animActive);
      if (exprMgr && blinkExpressionNames.length > 0 && !animActive && perceptionState.blink) {
        const mgr = exprMgr;
        blink.apply(dt, (weight: number) => {
          for (const name of blinkExpressionNames) {
            mgr.setValue(name, weight);
          }
        });
      }
    },
    dispose: (): void => {
      try {
        bonePanelRef.current?.();
      } catch {
        /* 面板清理不阻断 dispose */
      }
      unregisterModelRoot(vrm.scene);
      breath.dispose();
      gaze?.dispose();
      blink.dispose();
      footIK.dispose();
      motionMixer?.stopAllAction();
      motionMixer?.uncacheRoot(vrm.scene);
      if (useNativeLookAt) vrm.lookAt!.target = null;
      let texCount = 0;
      vrm.scene.traverse((child: THREE.Object3D) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) {
          const texKeys = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap"];
          for (const key of texKeys) {
            const tex = (mat as unknown as Record<string, unknown>)[key];
            if (tex instanceof THREE.Texture) texCount++;
          }
        }
      });
      VRMUtils.deepDispose(vrm.scene);
      void vrmDiag(port, "gpu-release", path, "ok", `tex=${texCount}`);
    },
    screenshot: () =>
      Promise.resolve(screenshotFromRenderer(ctx.renderer!, ctx.scene, ctx.camera)),
    semanticBones,
  };
}

export async function buildVrmScene(
  ctx: PreviewBuildCtx,
  path: string,
  port: VrmDataPort,
  readFn: (p: string) => Promise<string | null>,
  panels?: VrmPanelHooks,
  listAllFilePaths?: (dir: string) => Promise<string[] | null>,
): Promise<PreviewScene> {
  const parseRes = await mdVrStage1ReadParse(ctx, path, port, readFn);
  const { vrm } = parseRes;
  const motion = await mdVrLoadVrmaAnims(vrm, path, readFn, listAllFilePaths);
  mdVrSetupCameraBounds(ctx, vrm);
  const boneAssy = mdVrStage2BonesHumanoid(vrm);
  const vrmMaterials = mdVrStage3Materials(vrm);
  const perception = mdVrBuildPerception(vrm, ctx, boneAssy.boneTree, boneAssy.semanticBones);
  const menuItems = mdVrStage4MenuPanels(path, panels, ctx, boneAssy, vrmMaterials, motion, perception);
  return mdVrStage5BuildResult(ctx, path, port, parseRes, boneAssy, vrmMaterials, motion, perception, menuItems);
}

/** vrmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 */
export interface VrmMenuItemsOpts {
  /** 截图能力（ADR-052 P3：screenshotFromRenderer 共享 renderer）；null → 不注入 shot 项 */
  screenshot: (() => Promise<string | null>) | null;
  /** 模型信息数据源（adapter build 构造：文件名 + 骨骼/材质数；model 面板 children 的数据输入） */
  modelInfo: VrmModelInfoCtx;
  /** 模型完整路径（截图保存文件名 + 假对象 _modelPath） */
  modelPath: string;
  bonePanel: {
    /** 已构建骨骼树（buildVrmBoneTree 产物） */
    tree: BoneTree;
    viewContainer: HTMLElement | null;
    /** 兼容真实 ctx 可选字段（undefined）与测试假依赖（null） */
    camera: THREE.PerspectiveCamera | null | undefined;
    scene: THREE.Object3D | null | undefined;
    cleanupRef: { current: (() => void) | null };
  };
  /** VRM 材质桥：vrm.scene 遍历的 Mesh.material 列表（与 MMD MaterialControlBridge 对齐）*/
  material: {
    list: () => ReturnType<typeof listVrmMaterials>;
    getDetail: (i: number) => ReturnType<typeof getVrmMaterialDetail>;
    setVisible: (i: number, v: boolean) => void;
    setOpacity: (i: number, o: number) => void;
  };
  /** VRM 动作桥（@pixiv/three-vrm-animation 播放）；null/缺省（无同目录 .vrma）→ 不注入 play 项 */
  play?: MmdPlayBridge | null;
  /** 面板填充回调（视图层注入；缺失则 render 退化为 no-op，解除 utils→views 分层违规 R1） */
  panels?: VrmPanelHooks;
  /** 感知层状态（adapter build 创建，面板 UI 双向绑定） */
  perception?: {
    state: PerceptionState;
    caps: PerceptionCapability[];
  };
}

/**
 * VRM 声明式根菜单专属项（ADR-076 v2 Phase 2）：🦴 骨骼 + 🎨 材质。
 * 提取为可导出表：适配器与测试共用同一份真实数组（对齐 MikuMikuAR），加菜单项只改这里。
 */
export function vrmMenuItems(o: VrmMenuItemsOpts): PreviewMenuNode[] {
  const items: PreviewMenuNode[] = [
    {
      id: "model",
      icon: "🧍",
      labelKey: "preview.modelInfo",
      fallback: "模型",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "vrm-model-entry",
      // [doc:adr-126-p4-b-1] 面板内容声明式化（P5 收尾：VRM 迁 children 样板，对齐 MMD）：
      // children = vrmModelInfoNodes 纯数据节点（经 panels 注入，R1 禁 utils→views）。
      // 此前 renderCustom 委托 makeModelPanelRenderer——视图层从未注入（no-op 空面板），
      // 迁 children 顺带补上从未有过的模型信息内容。
      children: o.panels?.modelInfoNodes?.(o.modelInfo) ?? [],
    },
    {
      id: "shot",
      icon: "📷",
      labelKey: "preview.screenshot",
      fallback: "截图",
      kind: "panel",
      dockGroup: "model",
      legacyTestId: "vrm-shot-entry",
      // [doc:adr-126-p4-b-1] 截图面板声明式化（P5 收尾：对齐 MMD/YSM shotNodes 样板，
      // 复用 shot-panel-shared 六角度按钮）；此前委托 makeShotPanelRenderer——
      // 视图层从未注入（no-op 空面板），迁 children 顺带补上截图功能。
      children: o.panels?.shotNodes?.(o.screenshot, o.modelPath) ?? [],
    },
    {
      id: "material",
      icon: "🎨",
      labelKey: "preview.materialList",
      fallback: "材质",
      kind: "panel",
      legacyTestId: "vrm-material-entry",
      dockGroup: "model",
      children: materialNodes(o.material),
    },
    makeBonesPanelItem({
      tree: o.bonePanel.tree,
      cleanupRef: o.bonePanel.cleanupRef,
      viewContainer: o.bonePanel.viewContainer,
      camera: o.bonePanel.camera,
      scene: o.bonePanel.scene,
      legacyTestId: "vrm-bones-entry",
    }),
  ];
  if (o.play) {
    items.push({
      id: "vrma-play",
      icon: "▶️",
      labelKey: "preview.mmdPlay",
      fallback: "播放",
      kind: "panel",
      legacyTestId: "vrm-play-entry",
      dockGroup: "motion", // 底栏 💃 动作组（对齐 MMD）
      // [doc:adr-126-p5-收尾] play 面板声明式化：children = playNodes（复用 MMD，经 panels 注入）
      children: o.panels?.playNodes?.(o.play) ?? [],
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
      children: perceptionNodes(o.perception!.state, o.perception!.caps),
    });
  }
  return items;
}
