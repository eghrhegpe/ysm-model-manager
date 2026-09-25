// ===== VRM 内容适配器（ADR-066 P3：从 vrm-3d.ts 抽离内容层）=====
// 本文件只负责 VRM 专属逻辑：经 Go 绑定 ReadFileBytes 取字节 → 官方 GLTFLoader +
// VRMLoaderPlugin 解析 → rotateVRM0 摆正 → 注入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。

import { VmdObject } from "@moeru/three-mmd";
import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  type VRMAnimation,
  VRMAnimationLoaderPlugin,
} from "@pixiv/three-vrm-animation";
import type { VRM0Meta, VRM1Meta } from "@pixiv/three-vrm-core";
import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
// VMD 源（MMD 圈产 VMD、动捕产 FBX，无人专门产 .vrma——ADR-243 §1.1）
import { getCustomAnimPath } from "@/preview-3d/adapters/mmd/mmd-anim-library.ts";
import type {
  PreviewAdapter,
  PreviewBuildCtx,
  ScreenshotScene,
  SemanticScene,
  UpdateableScene,
} from "@/preview-3d/adapters/mount-preview-core.ts";
import type { AddOpLog } from "@/preview-3d/adapters/shared/data-port.ts";
import { createBlinkController } from "@/preview-3d/adapters/shared/perception/blink.ts"; // 语义表情消费方：程序化生命力 L1.5
import { createBreathController } from "@/preview-3d/adapters/shared/perception/breath.ts"; // 语义骨骼消费方：程序化生命力 L1
import {
  createPerceptionPauseRef,
  type PerceptionPauseRef,
} from "@/preview-3d/adapters/shared/perception/core.ts"; // #9 per-instance 暂停引用（取代全局单例）
import { createGazeController } from "@/preview-3d/adapters/shared/perception/gaze.ts"; // 语义骨骼消费方：程序化生命力 L2
import { requireSharedInfra } from "@/preview-3d/adapters/shared/shared-infra.ts";
import type { BoneTree } from "@/preview-3d/bone/bone-tools.ts";
import { createFootIKController } from "@/preview-3d/bone/mmd-foot-ik.ts"; // 程序化足部锚地（待机态 IK，格式无关）
import { vrmSemanticBoneMap } from "@/preview-3d/bone/semantic-bones.ts";
import { createVrmFootIKController } from "@/preview-3d/bone/vrm-foot-ik.ts"; // VMD 足ＩＫ 驱动（ADR-243 §2.8 方案 A）
import { frameCameraSide } from "@/preview-3d/infra/camera-setup.ts";
import { registerModelRoot, unregisterModelRoot } from "@/preview-3d/infra/frustum-cull.ts";
import { recordLoadTrace, TRACE_FORMAT_OTHER } from "@/preview-3d/infra/load-trace.ts";
import { renderLoadingState } from "@/preview-3d/infra/preview-loading.ts";
import { collectSceneStats, type SceneStats } from "@/preview-3d/infra/scene-stats.ts";
import type { BonePanelCleanupRef } from "@/preview-3d/menu/panels/bones-panel-node.ts";
import { makeBonesPanelItem } from "@/preview-3d/menu/panels/bones-panel-node.ts"; // 通用骨骼菜单项工厂（4 adapter 共用，ADR-074 S2 之上）
import { materialNodes } from "@/preview-3d/menu/panels/material-controls.ts";
import {
  type PerceptionCapability,
  type PerceptionState,
  perceptionNodes,
  pickPerceptionCaps,
} from "@/preview-3d/menu/panels/perception-controls.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import { screenshotFromRenderer } from "@/preview-3d/screenshot/screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import { createLoadGuard, type LoadGuard } from "@/utils/async/load-guard.ts";
import { base64ToBytes, bytesToArrayBuffer } from "@/utils/base/primitives/base64.ts";
import { safeGet, safeRemove, safeSet } from "@/utils/base/primitives/storage.ts";
import {
  autoVmdPositionScale,
  buildVmdRetargetClip,
  rescaleVmdPositionTracks,
  type VmdFootIKTargets,
  type VmdPositionTrackHandle,
} from "./vmd-retarget.ts";
import { buildVrmBoneTree } from "./vrm-bone.ts";

/** VRM 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据；
 *  addOpLog 签名引用共享 data-port 类型，2026-09-14 收敛逐字重复） */
export interface VrmDataPort {
  addOpLog: AddOpLog;
}

/** 环形日志面板诊断（AGENTS.md：排查卡顿往环形日志塞日志而非死盯 console）；失败静默不阻断 */
async function vrmDiag(
  port: VrmDataPort | undefined,
  op: string,
  msg: string,
  status: "ok" | "fail" | "warn",
  err?: string,
): Promise<void> {
  if (!port) return;
  try {
    await port.addOpLog(op, msg, status, err);
  } catch {
    /* 诊断不阻断加载 */
  }
}

import { t } from "@/core/i18n/t.ts";
import type { MmdPlayBridge } from "@/preview-3d/infra/content-bridges.ts";
import {
  getVrmMaterialDetail,
  listVrmMaterials,
  setVrmMaterialOpacity,
  setVrmMaterialVisible,
} from "@/preview-3d/materials/vrm-materials.ts";

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
  version?: string | undefined;
  license?: string | undefined;
  contact?: string | undefined;
  thumbnail?: string; // dataURL，空串表示无缩略图
  metaVersion: "0" | "1";
  /** VRM0 授权约束徽章（Vrm0Restrictions），VRM1 无此字段 */
  restrictions?: {
    allowedUser: "everyone" | "licensed" | "onlyAuthor";
    commercial: boolean;
    sexual: boolean;
    violent: boolean;
    reference?: string | undefined;
  };
  /** 场景统计（ADR-131 P2：复用本次 GLTF parse 顺带采集，零额外成本） */
  stats?: SceneStats | undefined;
}

/** VRM meta 文本摘要（3D 模型信息面板展示用；仅文本字段，零 GPU/图片，纯函数归一化） */
export interface VrmMetaSummary {
  /** 模型名（VRM0 title / VRM1 name） */
  title?: string | undefined;
  /** 作者（VRM0 author / VRM1 authors 顿号拼接） */
  author?: string | undefined;
  /** 授权（VRM0 licenseName(+otherLicenseUrl) / VRM1 licenseUrl） */
  license?: string | undefined;
  version?: string | undefined;
}

/** 授权文案归一：licenseName(+ otherLicenseUrl 以「 · 」拼接)；缺省 → undefined。
 *  与 readVrmMeta 的 VRM0 分支同源——抽函数消重复（jscpd）+ 降两处分支复杂度。 */
function licenseText(
  licenseName: string | undefined,
  otherLicenseUrl: string | undefined,
): string | undefined {
  return licenseName ? licenseName + (otherLicenseUrl ? ` · ${otherLicenseUrl}` : "") : undefined;
}

/** VRM0 授权枚举 → 徽章三态（Everyone / ExplicitlyLicensedPerson / 其余=仅作者） */
function allowedUserOf(
  allowedUserName: VRM0Meta["allowedUserName"],
): "everyone" | "licensed" | "onlyAuthor" {
  if (allowedUserName === "Everyone") return "everyone";
  if (allowedUserName === "ExplicitlyLicensedPerson") return "licensed";
  return "onlyAuthor";
}

/** VRM0 meta → 文本摘要（title/author/licenseName/version） */
function summaryFromVrm0(m: VRM0Meta): VrmMetaSummary {
  return {
    title: m.title?.trim() || undefined,
    author: m.author?.trim() || undefined,
    license: licenseText(m.licenseName, m.otherLicenseUrl),
    version: m.version?.trim() || undefined,
  };
}

/** VRM1 meta → 文本摘要（name/authors 顿号拼接/licenseUrl） */
function summaryFromVrm1(m: VRM1Meta): VrmMetaSummary {
  return {
    title: m.name?.trim() || undefined,
    // VRM1 authors 运行时不保证存在（readVrmMeta 同款防御：meta.authors || []），缺字段防 TypeError
    author: Array.isArray(m.authors) && m.authors.length > 0 ? m.authors.join("、") : undefined,
    license: m.licenseUrl?.trim() || undefined,
    version: m.version?.trim() || undefined,
  };
}

/**
 * 归一化 vrm.meta → 文本摘要（纯函数零副作用；readVrmMeta 的重 parse 归一化与此同源不重构）。
 * 空字段/纯空白 → undefined（面板按「非空才补行」条件渲染，不产空串噪音）。
 * 版本判别分支已拆 summaryFromVrm0/1——本函数退化为纯分派（认知复杂度 < 阈值）。
 */
export function vrmMetaSummary(meta: VRM0Meta | VRM1Meta): VrmMetaSummary {
  // VRM0Meta.metaVersion 非字面量判别类型，故保留原 cast 语义（勿删）
  if (meta.metaVersion === "0") return summaryFromVrm0(meta as VRM0Meta);
  return summaryFromVrm1(meta);
}

/** VRM0 meta → VrmMetaInfo（restrictions 三开关 + thumbnail dataURL）——readVrmMeta 的归一化分支 */
function vrm0Info(m: VRM0Meta): VrmMetaInfo {
  return {
    metaVersion: "0",
    name: m.title || "",
    authors: m.author ? [m.author] : [],
    version: m.version,
    license: licenseText(m.licenseName, m.otherLicenseUrl),
    contact: m.contactInformation,
    thumbnail: m.texture ? imageToDataURL(m.texture) : "",
    restrictions: {
      allowedUser: allowedUserOf(m.allowedUserName),
      commercial: m.commercialUssageName === "Allow",
      sexual: m.sexualUssageName === "Allow",
      violent: m.violentUssageName === "Allow",
      reference: m.reference || undefined,
    },
  };
}

/** VRM1 meta → VrmMetaInfo（无 restrictions：VRM1 授权走 licenseUrl）——readVrmMeta 的归一化分支 */
function vrm1Info(m: VRM1Meta): VrmMetaInfo {
  return {
    metaVersion: "1",
    name: m.name || "",
    authors: m.authors || [],
    version: m.version,
    license: m.licenseUrl,
    contact: m.contactInformation,
    thumbnail: m.thumbnailImage ? imageToDataURL(m.thumbnailImage) : "",
  };
}

/** 解析 VRM meta（不渲染 3D，parse 后立即 deepDispose），失败返回 null */
export async function readVrmMeta(
  path: string,
  readFn: (p: string) => Promise<string | null>,
): Promise<VrmMetaInfo | null> {
  try {
    const b64 = await readFn(path);
    if (!b64) return null;

    const bytes = base64ToBytes(b64) as Uint8Array;
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(buffer, "", resolve, reject);
    });
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    if (!vrm) {
      // 非 VRM 的合法 glb：GLTFLoader 已构建 scene graph 并上传 GPU，
      // 必须释放，否则每次 meta 卡预览泄漏一份 geometry/material/texture
      VRMUtils.deepDispose(gltf.scene);
      return null;
    }
    const meta = vrm.meta;
    // 版本判别 + 字段归一化已拆 vrm0Info/vrm1Info——本函数只留编排（降认知复杂度）
    const info = meta.metaVersion === "0" ? vrm0Info(meta as VRM0Meta) : vrm1Info(meta);
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
  /** VRM meta 文本摘要（vrm.meta 归一化；缺失/无法解析时可缺省 → 面板不补 meta 行） */
  meta?: VrmMetaSummary | undefined;
}

/** 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） */
export interface VrmPanelHooks {
  /** 声明式节点工厂（[doc:adr-126-p4-b-1] 注入通道回归，P5 收尾 VRM 对齐 MMD）：
   *  vrmModelInfoNodes 必须经此处由视图层注入（缺失 → children 空、面板不渲染） */
  modelInfoNodes?: (ctx: VrmModelInfoCtx) => PreviewMenuNode[];
  /** 截图面板声明式节点工厂（[doc:adr-126-p4-b-1] 注入通道回归，P5 收尾：对齐 MMD/YSM
   *  shotNodes 模式，复用 shot-panel-shared；缺失 → children 空、面板不渲染） */
  shotNodes?: (
    screenshot: (() => Promise<string | null>) | null,
    modelPath: string,
  ) => PreviewMenuNode[];
  /** [doc:adr-126-p5-收尾] play 面板声明式节点（复用 MMD playNodes：toggle 播放/暂停 +
   *  select 动作 + 空态引导）；缺失 → children 空、面板不渲染 */
  playNodes?: (bridge: MmdPlayBridge) => PreviewMenuNode[];
}

interface VrmParseResult {
  vrm: VRM;
  gltf: GLTF;
  tStart: number;
  tParseStart: number;
  tParseEnd: number;
}
/** 单个动作条目：`clip` 可直接交给 AnimationMixer；`footIK` 仅 VMD 重定向产物具备 */
interface VrmMotionClipEntry {
  label: string;
  clip: THREE.AnimationClip;
  /** VMD 足ＩＫ 目标（`.vrma` 无此通道 ⇒ null）；由 Stage5 每帧喂给 VRM 足 IK 控制器 */
  footIK: VmdFootIKTargets | null;
  /** 来源：`.vrma` 官方动作 / `.vmd` 重定向动作 */
  source: "vrma" | "vmd";
  /**
   * 位移轨道重缩放句柄（锐评 P5）：VMD 重定向产物自带（hips 位移轨 + 足 IK 目标轨，
   * 含烘焙前 k=1 快照）；`.vrma` 条目前置缩放语义不适用 ⇒ 空数组。缩放滑块经
   * {@link rescaleVmdMotionClips} 原地改写，免重读/重解析/换绑。
   */
  posTracks: readonly VmdPositionTrackHandle[];
  /**
   * ADR-309 D2（锐评 P2）：该 clip 是否驱动眼骨（左目/右目 quaternion 轨道命中映射表）。
   * 每帧 update：`lookAt.autoUpdate = !(animActive && drivesEyes)`——带眼轨的动作让道
   * VMD 眼轨（lookAt 早退），无眼轨/待机态 lookAt 照常盯摄像头。
   */
  drivesEyes: boolean;
  /**
   * ADR-309 D6（锐评 P6）：动作来源域。`local` = 模型同目录（.vrma/.vmd）、
   * `library` = MMD 动作库（CustomAnim）。自动播只选 local；库动作只进列表。
   */
  origin: "local" | "library";
  /** 动作文件完整路径（诊断/版权提示用） */
  path: string;
}
interface VrmMotionState {
  motionClips: VrmMotionClipEntry[];
  motionMixer: THREE.AnimationMixer | null;
  motionAction: THREE.AnimationAction | null;
  motionPlaying: boolean;
  /**
   * 自动位移缩放**创建期快照**（锐评 P3）：build 期模型处于 rest 位姿时算一次，
   * 复位/重建路径一律用该值——动画中途重算会读到被动画污染的归一化骨世界位置。
   */
  autoPositionScale: number;
  /**
   * 加载代际守卫（锐评 P5 / ADR-230）：dispose 调 `invalidate()` 使在途
   * `loadMotionClips` 的结果不落地（防对已释放场景继续写 motionClips/换绑）。
   */
  guard: LoadGuard;
}
interface VrmPerceptionState {
  perceptionState: PerceptionState;
  perceptionCaps: PerceptionCapability[];
  breath: ReturnType<typeof createBreathController>;
  gaze: ReturnType<typeof createGazeController> | null;
  blink: ReturnType<typeof createBlinkController>;
  footIK: ReturnType<typeof createFootIKController>;
  useNativeLookAt: boolean;
  blinkExpressionNames: Array<"blink" | "blinkLeft" | "blinkRight">;
  exprMgr: VRM["expressionManager"];
  perceptionPauseRef: PerceptionPauseRef;
}
interface VrmBoneAssembly {
  bonePanelRef: BonePanelCleanupRef;
  boneTree: BoneTree;
  semanticBones: ReturnType<typeof vrmSemanticBoneMap>;
}

function ParseGlbVrm0(vrm: VRM, gltf: GLTF): void {
  VRMUtils.rotateVRM0(vrm);
  void gltf;
}
function ParseGlbVrm1(vrm: VRM, gltf: GLTF): void {
  void vrm;
  void gltf;
}
async function Stage1ReadParse(
  ctx: PreviewBuildCtx,
  path: string,
  port: VrmDataPort | undefined,
  readFn: (p: string) => Promise<string | null>,
): Promise<VrmParseResult> {
  renderLoadingState(ctx.loadingEl, "🥽", "preview.loadingModel");
  const tStart = performance.now();
  const b64 = await readFn(path);
  await vrmDiag(
    port,
    "read-model",
    path,
    b64 ? "ok" : "fail",
    b64 ? `bytes=${b64.length}` : "ReadFileBytes 返回空（路径语义/守卫？）",
  );
  if (!b64) throw new Error("ReadFileBytes 返回空");
  const bytes = base64ToBytes(b64) as Uint8Array;
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
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
  if (metaVersion === "0") ParseGlbVrm0(vrm, gltf);
  else ParseGlbVrm1(vrm, gltf);
  requireSharedInfra(ctx).scene.add(vrm.scene);
  registerModelRoot(vrm.scene);
  ctx.loadingEl.remove();
  const tParseEnd = performance.now();
  await vrmDiag(
    port,
    "parse",
    path,
    "ok",
    `bones=${gltf.scenes?.[0]?.children?.length ?? 0} gltf-children=${gltf.scenes?.length ?? 0}`,
  );
  await vrmDiag(
    port,
    "perf",
    path,
    "ok",
    `parse=${Math.round(tParseEnd - tParseStart)}ms total=${Math.round(tParseEnd - tStart)}ms`,
  );
  return { vrm, gltf, tStart, tParseStart, tParseEnd };
}
/** 动作标签 = 文件名去扩展名（无可用名 → "motion"） */
function motionLabel(filePath: string): string {
  return (filePath.split(/[/\\]/).pop() || "").replace(/\.[^.]+$/, "") || "motion";
}

/** `.vrma` 通道：官方 GLTFLoader + VRMAnimationLoaderPlugin → createVRMAnimationClip */
async function loadVrmaClips(
  paths: readonly string[],
  readFn: (p: string) => Promise<string | null>,
  vrm: VRM,
): Promise<VrmMotionClipEntry[]> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  const clips: VrmMotionClipEntry[] = [];
  for (const vp of paths) {
    try {
      const b64 = await readFn(vp);
      if (!b64) continue;
      const bytes = base64ToBytes(b64) as Uint8Array;
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const animGltf = await new Promise<GLTF>((resolve, reject) =>
        loader.parse(buf, "", resolve, reject),
      );
      const anims = (animGltf.userData as { vrmAnimations?: VRMAnimation[] }).vrmAnimations;
      if (!anims || anims.length === 0) continue;
      clips.push({
        label: motionLabel(vp),
        clip: createVRMAnimationClip(anims[0], vrm),
        footIK: null, // .vrma 自带完整腿部数据（含 IK 已烘好的 FK），无需外部求解
        source: "vrma",
        posTracks: [], // 官方动作轨道是 VRM 规范产物，无「位移烘焙缩放」语义
        // ADR-309 D2：.vrma 的 humanoid 轨道不驱动眼骨（官方 clip 无眼轨）⇒ false，
        // lookAt 行为与现状一致
        drivesEyes: false,
        // ADR-309 D6：同目录 .vrma = local 来源
        origin: "local",
        path: vp,
      });
    } catch {
      /* 单个 .vrma 解析失败 → 跳过其余照常 */
    }
  }
  return clips;
}

/**
 * `.vmd` 通道（ADR-243 §2 管线）：VmdObject 解析 → 重定向到 humanoid 归一化骨骼。
 * VMD 的腿部动作活在 `左足ＩＫ`/`右足ＩＫ` 的 position 通道上，`buildAnimation` 不解 IK，
 * 故重定向器把 IK 目标摘出来，交给 Stage5 每帧的 CCD 驱动（`vrm-foot-ik.ts`）。
 */
async function loadVmdClips(
  paths: readonly string[],
  readFn: (p: string) => Promise<string | null>,
  vrm: VRM,
  /** 位移缩放覆盖（ADR-243 锐评对账 P3）：undefined = 按身高自动估算；给定则烘焙进位移轨道 */
  positionScale?: number,
  /** ADR-309 D6（锐评 P6）：动作来源域（local = 模型同目录 / library = MMD 动作库） */
  origin: "local" | "library" = "local",
): Promise<VrmMotionClipEntry[]> {
  const clips: VrmMotionClipEntry[] = [];
  for (const vp of paths) {
    try {
      const b64 = await readFn(vp);
      if (!b64) continue;
      const vmd = await VmdObject.ParseFromBuffer(
        bytesToArrayBuffer(base64ToBytes(b64) as Uint8Array),
      );
      // 表情通道（ADR-306 §2.2）：传 expressionManager 使可映射 morph 改道进 clip；
      // 无 expressionManager（VRM0 / 该面缺席）→ null ⇒ 退化为 ADR-243 v1（morph 全丢弃）。
      // positionScale 条件展开（exactOptionalPropertyTypes：不显式传 undefined，缺省=自动估算）。
      const retarget = buildVmdRetargetClip(vmd, vrm.humanoid, {
        ...(positionScale !== undefined ? { positionScale } : {}),
        expressionManager: vrm.expressionManager ?? null,
      });
      // 一条轨道都建不起来（VMD 驱动的骨名本模型一个都没有、morph 也全不可映射）→ 不产条目，
      // 否则播放面板会多出「点了没反应」的空动作
      if (retarget.clip.tracks.length === 0) continue;
      clips.push({
        label: motionLabel(vp),
        clip: retarget.clip,
        footIK: retarget.footIK,
        source: "vmd",
        posTracks: retarget.posTracks,
        drivesEyes: retarget.drivesEyes,
        origin,
        path: vp,
      });
    } catch {
      /* 单个 .vmd 解析失败 → 跳过其余照常 */
    }
  }
  return clips;
}

/** MMD 动作库（CustomAnim）里的 .vmd 路径；库根不可用 / 不可列 → 空数组（静默降级） */
async function listCustomAnimVmd(
  listAllFilePaths: (dir: string) => Promise<string[] | null>,
): Promise<string[]> {
  const animDir = await getCustomAnimPath();
  if (!animDir) return [];
  try {
    const files = (await listAllFilePaths(animDir)) || [];
    return files.filter((p) => p.toLowerCase().endsWith(".vmd"));
  } catch {
    return [];
  }
}

/**
 * `.vmd` 路径枚举（模型同目录 + MMD 动作库，去重）——ADR-309 D6（锐评 P6）：
 * local/library 分列返回（自动播只选 local；库动作只进列表，不自动播）。
 * 磁盘枚举一律走 Go 交付的 listAllFilePaths（归属红线）。
 */
async function listVmdPathLists(
  path: string,
  listAllFilePaths?: (dir: string) => Promise<string[] | null>,
): Promise<{ local: string[]; library: string[] }> {
  if (!listAllFilePaths) return { local: [], library: [] };
  try {
    const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
    const files = (await listAllFilePaths(dirPath)) || [];
    const local = files.filter((p) => p.toLowerCase().endsWith(".vmd"));
    // 追加动作库来源并去重（同目录已发现的路径不再重复解析）
    const seen = new Set(local.map((p) => p.toLowerCase()));
    const library: string[] = [];
    for (const p of await listCustomAnimVmd(listAllFilePaths)) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      library.push(p);
    }
    return { local, library };
  } catch {
    return { local: [], library: [] };
  }
}

/**
 * 加载动作通道（ADR-243 §2.7）：
 *   ① 模型同目录 `.vrma` —— VRM 原生（官方 createVRMAnimationClip）
 *   ② 模型同目录 `.vmd` —— MMD 动作，重定向到 humanoid
 *   ③ MMD 动作库（`CustomAnim`）`.vmd` —— MMD 圈的动作资产是共享的，两边吃同一份
 * 顺序即播放面板顺序（原生动作先露出，重定向动作随后）。
 *
 * 磁盘枚举一律走 Go 交付的 `listAllFilePaths`——前端不自行扫描磁盘（AGENTS.md 归属红线）。
 * 逐文件读取（VMD 个头不大）；若将来动作库批量变大，可对齐 MMD 侧改走批量读。
 *
 * 锐评 P3/P5：自动缩放在**创建期**（首帧 mixer.update 前，模型 rest 位姿）快照进
 * `autoPositionScale`；加载全程挂代际守卫（ADR-230），dispose 后在途结果不落地。
 */
async function loadMotionClips(
  vrm: VRM,
  path: string,
  readFn: (p: string) => Promise<string | null>,
  listAllFilePaths?: (dir: string) => Promise<string[] | null>,
  /** 位移缩放覆盖（ADR-243 锐评对账 P3）：undefined = 用创建期自动估算 */
  positionScale?: number,
): Promise<VrmMotionState> {
  const motionClips: VrmMotionClipEntry[] = [];
  let motionMixer: THREE.AnimationMixer | null = null;
  let motionAction: THREE.AnimationAction | null = null;
  const motionPlaying = true;
  const guard = createLoadGuard();
  // P3：此刻模型尚未跑过任何 mixer.update（load 先于 Stage5 构造 IK 控制器与首帧
  // update），读到的归一化骨世界位置即 rest 值——快照一次，全生命周期复用
  const autoPositionScale = autoVmdPositionScale(vrm.humanoid);
  const state: VrmMotionState = {
    motionClips,
    motionMixer: null,
    motionAction: null,
    motionPlaying,
    autoPositionScale,
    guard,
  };
  if (!listAllFilePaths) return state;
  const gen = guard.next();
  try {
    const dirPath = path.replace(/[^/\\]*$/, "").replace(/[/\\]$/, "");
    const files = (await listAllFilePaths(dirPath)) || [];
    const vrmaPaths = files.filter((p) => p.toLowerCase().endsWith(".vrma"));
    const vmdLists = await listVmdPathLists(path, listAllFilePaths);

    motionClips.push(...(await loadVrmaClips(vrmaPaths, readFn, vrm)));
    // P6：local .vmd 先入库（同目录），library .vmd 随后（动作库），各自带 origin 标记
    motionClips.push(
      ...(await loadVmdClips(
        vmdLists.local,
        readFn,
        vrm,
        positionScale ?? autoPositionScale,
        "local",
      )),
    );
    motionClips.push(
      ...(await loadVmdClips(
        vmdLists.library,
        readFn,
        vrm,
        positionScale ?? autoPositionScale,
        "library",
      )),
    );

    // P5 代际守卫：dispose 期间 invalidate() 使本代过期——在途结果不再写入 state
    //（motionMixer/motionAction 保持 null，下游 update 循环对空动作安全跳过）
    if (guard.stale(gen)) return state;

    // P6：自动播只选 local 条目（同目录 .vrma/.vmd）；库动作只进列表不自动播
    const firstLocal = motionClips.find((e) => e.origin === "local");
    if (firstLocal) {
      motionMixer = new THREE.AnimationMixer(vrm.scene);
      motionAction = motionMixer.clipAction(firstLocal.clip);
      motionAction.play();
      state.motionMixer = motionMixer;
      state.motionAction = motionAction;
    } else if (motionClips.length > 0) {
      // 只有 library 条目：建 mixer（供用户手动 select），但不自动 play
      motionMixer = new THREE.AnimationMixer(vrm.scene);
      state.motionMixer = motionMixer;
      // motionAction 保持 null（不自动播）：select() 时再 clipAction+play
    }
  } catch {
    /* 目录不可列 → 白模降级，不阻断模型渲染 */
  }
  return state;
}

// ---------------------------------------------------------------------------
// P3 位移缩放校准（ADR-243 锐评对账）：positionScale 在加载时 bake 进位移轨道
// （scaleTranslationTrack），改它 = 重建 .vmd 重定向 clip 并换绑——非运行期旋钮。
// ---------------------------------------------------------------------------

/** 持久化键（ADR-044 safeGet/safeSet）：用户校准的 VMD 位移缩放覆写；null/缺省 = 自动估算 */
const VMD_POS_SCALE_KEY = "vmd.positionScale";

/** 读持久化覆写：非法值（NaN/空）→ null（回自动） */
export function readVmdPositionScale(): number | null {
  const raw = safeGet(VMD_POS_SCALE_KEY);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 写持久化覆写：null = 清除（回自动）；否则存数字串（privacy 模式 safeSet 静默降级） */
export function writeVmdPositionScale(v: number | null): void {
  if (v == null) safeRemove(VMD_POS_SCALE_KEY);
  else safeSet(VMD_POS_SCALE_KEY, String(v));
}

/**
 * 锐评 P5：缩放滑块改值 → **原地**重缩放全部 VMD 位移轨道（O(值总数)，零 IO /
 * 零重解析 / 零换绑）。`.vrma` 条目无位移句柄（posTracks 空），天然不受影响。
 * 活动动作保留同一 action 对象（轨道 values 被 mixer interpolant 与 IK 采样器共享引用，
 * 下一帧即生效）——替代原先「重读整库 + 重建 clip + 换绑 action」的重路径。
 */
export function rescaleVmdMotionClips(motion: VrmMotionState, k: number): void {
  for (const entry of motion.motionClips) {
    if (entry.source !== "vmd" || entry.posTracks.length === 0) continue;
    rescaleVmdPositionTracks(entry.posTracks, k);
  }
}
/** 取 action 实播的 clip。three r185 起 AnimationAction 不再暴露 `.clip` 属性，
 * 改用公开方法 `getClip()`（私有字段 `_clip` 无跨版本契约，勿直接读）。
 * 用于「time 源与 target 源同一对象」的反查（review 64c24cf3e P1）。 */
function motionClipOf(action: THREE.AnimationAction): THREE.AnimationClip {
  return action.getClip();
}
function setupCameraBounds(ctx: PreviewBuildCtx, vrm: VRM): void {
  // 侧上方取景（对齐 fbx/pack 口径，见 camera-setup.frameCameraSide）
  frameCameraSide(ctx, vrm.scene);
}
function Stage2BonesHumanoid(vrm: VRM): VrmBoneAssembly {
  // BonePanelCleanupRef 统一类型（code_review d6de20d2 #10：原裸内联
  // { current: (() => void) | null } 与 mmd/ysm/fbx 已收编的共享接口分叉）
  const bonePanelRef: BonePanelCleanupRef = { current: null };
  const boneTree = buildVrmBoneTree(vrm);
  const semanticBones = vrmSemanticBoneMap(vrm.humanoid.humanBones);
  return { bonePanelRef, boneTree, semanticBones };
}
function Stage3Materials(vrm: VRM): THREE.Material[] {
  const vrmMaterials: THREE.Material[] = [];
  vrm.scene.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    vrmMaterials.push(...mats);
  });
  return vrmMaterials;
}
function buildPerception(
  vrm: VRM,
  ctx: PreviewBuildCtx,
  boneTree: BoneTree,
  semanticBones: ReturnType<typeof vrmSemanticBoneMap>,
): VrmPerceptionState {
  const perceptionState: PerceptionState = {
    breath: true,
    gaze: true,
    blink: true,
    lipSync: false,
    autoDance: false,
  };
  // 能力声明：caps 从真实构造派生（非硬编码清单）——原生 lookAt 接管注视、
  // 眨眼表情缺失、语义骨骼为空时不显示对应开关（否则菜单谎报：开关在、驱动不在）
  const perceptionPauseRef = createPerceptionPauseRef();
  const breath = createBreathController({ pauseRef: perceptionPauseRef });
  const useNativeLookAt = !!vrm.lookAt;
  const gaze: ReturnType<typeof createGazeController> | null = useNativeLookAt
    ? null
    : createGazeController();
  if (useNativeLookAt && ctx.camera) vrm.lookAt!.target = ctx.camera;
  const exprMgr = vrm.expressionManager;
  const blinkExpressionNames = exprMgr
    ? (["blink", "blinkLeft", "blinkRight"] as const).filter(
        (n) => exprMgr.getExpression(n) !== null,
      )
    : ([] as Array<"blink" | "blinkLeft" | "blinkRight">);
  const blink = createBlinkController({ pauseRef: perceptionPauseRef });
  const perceptionCaps = pickPerceptionCaps([
    ...(semanticBones && Object.keys(semanticBones).length > 0 ? (["breath"] as const) : []),
    ...(!useNativeLookAt ? (["gaze"] as const) : []),
    ...(blinkExpressionNames.length > 0 ? (["blink"] as const) : []),
  ]);
  const footIK = createFootIKController(boneTree, semanticBones);
  return {
    perceptionState,
    perceptionCaps,
    breath,
    gaze,
    blink,
    footIK,
    useNativeLookAt,
    blinkExpressionNames,
    exprMgr,
    perceptionPauseRef,
  };
}
/**
 * buildVrmScene 各 stage 产物的聚合（解参数陷阱：Stage4MenuPanels p8→p4、Stage5BuildResult p9→p5）。
 * 由 buildVrmScene 一次性构造，Stage4/Stage5 共用——语义等价于原分散形参，无行为变更。
 */
interface VrmBuildArtifacts {
  parseRes: VrmParseResult;
  boneAssy: VrmBoneAssembly;
  vrmMaterials: THREE.Material[];
  motion: VrmMotionState;
  perception: VrmPerceptionState;
  meta: VrmMetaSummary | undefined;
}

function Stage4MenuPanels(
  path: string,
  panels: VrmPanelHooks | undefined,
  ctx: PreviewBuildCtx,
  artifacts: VrmBuildArtifacts,
  // P5 后 Stage4 不再直接消费 deps（rescale 原地改写无 IO）；_deps 前缀标记为保留参数位
  _deps: VrmAdapterDeps,
): PreviewMenuNode[] {
  const { boneAssy, vrmMaterials, motion, perception, meta } = artifacts;
  const { bonePanelRef, boneTree } = boneAssy;
  const { motionClips, motionMixer } = motion;
  const vrm = artifacts.parseRes.vrm;
  // 模型信息数据源（model 面板 children；名称取文件名去扩展名）
  const modelInfo: VrmModelInfoCtx = {
    modelName:
      path
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") || path,
    // 全量骨骼数（byId.size = 提取的全部 humanoid 骨骼 ~52 根；roots 只是无父骨根节点 ≈1，
    // 用它面板会错误显示「1 骨骼」——a400b244 review P2）
    boneCount: boneAssy.boneTree.byId.size,
    materialCount: vrmMaterials.length,
    meta,
  };
  // [ADR-243 锐评对账 P3/P5] 位移缩放校准控制：仅当有 VMD 重定向动作时可用（.vrma 不受影响）。
  // P3：自动值用**创建期快照** motion.autoPositionScale（模型 rest 位姿算一次，动画中途
  // 重读归一化骨世界位置会被污染）。P5：改值 = 原地 rescale（O(值总数)零 IO），
  // 拖动逐 tick 实时生效；松手（onCommit）才落盘持久化。
  const vmdCount = motionClips.filter((c) => c.source === "vmd").length;
  const positionScale =
    vmdCount > 0
      ? {
          vmdCount,
          // 当前有效值：持久化覆写 ?? 创建期自动快照（P3 单一事实源，不再每次重算）
          current: () => readVmdPositionScale() ?? motion.autoPositionScale,
          set: (v: number): void => {
            // 拖动实时：原地改写轨道（values 被 interpolant 共享引用，下一帧即生效）
            rescaleVmdMotionClips(motion, v);
          },
          onCommit: (v: number | null): void => {
            if (v != null) writeVmdPositionScale(v);
          },
          resetToAuto: (): void => {
            writeVmdPositionScale(null);
            rescaleVmdMotionClips(motion, motion.autoPositionScale);
          },
        }
      : undefined;
  const menuItems = vrmMenuItems({
    panels,
    modelInfo,
    modelPath: path,
    screenshot: () =>
      Promise.resolve(
        screenshotFromRenderer(requireSharedInfra(ctx).renderer, ctx.scene, ctx.camera),
      ),
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
    play:
      motionClips.length > 0
        ? {
            clips: motionClips.map((c) => ({ label: c.label })),
            isPlaying: () => motion.motionPlaying,
            toggle: () => {
              motion.motionPlaying = !motion.motionPlaying;
              if (motion.motionAction) motion.motionAction.paused = !motion.motionPlaying;
            },
            currentIndex: () => {
              const cur = motion.motionAction;
              if (!cur) return -1;
              return motionClips.findIndex((c) => c.clip === motionClipOf(cur));
            },
            select: (i: number) => {
              if (i < 0 || i >= motionClips.length) return;
              const cur = motion.motionAction;
              if (cur && motionClips[i].clip === motionClipOf(cur)) return;
              if (!motionMixer) return;
              motion.motionAction?.stop();
              // 锐评 P1：切动作前把归一化骨拉回 rest + 表情权重清零（横移 MMD 侧
              // `skeleton.pose()` 纪律）。重定向 clip 的轨道只覆盖**该 VMD 驱动过**的骨——
              // 未覆盖骨会留在旧 action 的末帧值，且归一化骨每帧单向烘回原始骨 ⇒
              // 残留姿势永久投影（如「手指锁死在上一段舞蹈的抓握姿势」）。复位后
              // 新 action 首帧由 mixer.update 重写覆盖骨，未覆盖骨干净停在 rest。
              vrm.humanoid.resetNormalizedPose();
              vrm.expressionManager?.resetValues();
              const newAction = motionMixer.clipAction(motionClips[i].clip);
              motion.motionAction = newAction;
              motion.motionAction.play();
              motion.motionAction.paused = !motion.motionPlaying;
            },
            animDir: null,
            notice: VRM_PLAY_NOTICE,
          }
        : null,
    perception: { state: perception.perceptionState, caps: perception.perceptionCaps },
    positionScale,
  });
  return menuItems;
}
/** 待机态感知层驱动的状态依赖（Stage5 组装期一次性捕获，外提后各自可度量复杂度） */
interface VrmIdlePerceptionDeps {
  perception: VrmPerceptionState;
  semanticBones: VrmBoneAssembly["semanticBones"];
  animActive: boolean;
  ctx: PreviewBuildCtx;
}

/**
 * 待机态感知层驱动（呼吸/眨眼自查全局暂停标志；gaze 保留本层 !animActive 守卫）。
 * 从 Stage5 的 update 闭包外提——原实现三层嵌套 if 使 update 认知复杂度超标。
 */
function applyIdlePerception(dt: number, deps: VrmIdlePerceptionDeps): void {
  const { perception, semanticBones, animActive, ctx } = deps;
  const { perceptionState, breath, gaze, footIK, useNativeLookAt } = perception;
  if (semanticBones) {
    if (perceptionState.breath) breath.apply(dt, semanticBones);
    // gaze 不挂全局暂停标志（摄像机追踪，非动画优先级）——保留本层 !animActive 守卫
    if (!animActive && !useNativeLookAt && perceptionState.gaze)
      gaze?.apply(dt, semanticBones, requireSharedInfra(ctx).camera.position);
  }
  footIK.apply(dt, !animActive);
}

/**
 * 当前动作帧的 VMD 足 IK 驱动。按 live action 的 clip 反查 targets（非独立维护的 index）——
 * time 源与 target 源同一对象，永不脱钩（review 64c24cf3e P1；clip 经公开 `action.getClip()`
 * 读取，不碰 three 私有 `_clip`）。
 */
function applyAnimationFootIK(
  action: THREE.AnimationAction,
  motionClips: VrmMotionClipEntry[],
  vrmFootIK: ReturnType<typeof createVrmFootIKController>,
): void {
  const current = motionClips.find((c) => c.clip === motionClipOf(action));
  if (current?.footIK) vrmFootIK.apply(action.time, current.footIK);
}

/** 眨眼驱动：exprMgr + 表情名齐备且 blink 开启才生效（从 update 闭包外提降嵌套） */
function applyBlinkPerception(dt: number, perception: VrmPerceptionState): void {
  const { perceptionState, blink, blinkExpressionNames, exprMgr } = perception;
  if (exprMgr && blinkExpressionNames.length > 0 && perceptionState.blink) {
    const mgr = exprMgr;
    blink.apply(dt, (weight: number) => {
      for (const name of blinkExpressionNames) {
        mgr.setValue(name, weight);
      }
    });
  }
}

/** 每帧 update 的状态依赖（Stage5 组装期一次性捕获） */
interface VrmUpdateDeps {
  vrm: VRM;
  motion: VrmMotionState;
  perception: VrmPerceptionState;
  semanticBones: VrmBoneAssembly["semanticBones"];
  vrmFootIK: ReturnType<typeof createVrmFootIKController>;
  ctx: PreviewBuildCtx;
}

/** 构建每帧 update 回调（原 Stage5 return 内的 update 闭包原样外提，行为零变更） */
function makeVrmUpdater(deps: VrmUpdateDeps): (dt: number) => void {
  const { vrm, motion, perception, semanticBones, vrmFootIK, ctx } = deps;
  const { motionClips, motionMixer } = motion;
  const { perceptionPauseRef } = perception;
  return (dt: number): void => {
    // 全局暂停标志先于 visible 早退写：不可见帧也要刷新标志，否则早退期间
    // 标志停在上一帧的值，恢复可见后感知层被陈旧状态冻结
    const animActive = !!motion.motionAction && !motion.motionAction.paused;
    perceptionPauseRef.paused = animActive;
    if (!vrm.scene.visible) return;
    if (motionMixer) motionMixer.update(dt);

    // ADR-309 D2（锐评 P2）：lookAt 让道条件 = animActive && 当前动作 drivesEyes——
    // 带眼轨的 VMD 动作把 lookAt.autoUpdate 置 false（VRMLookAt.update 早退），
    // 眼骨完全交给 mixer 眼轨；无眼轨动作/待机态恢复 true，lookAt 照常盯摄像头。
    if (vrm.lookAt) {
      const liveAction = motion.motionAction;
      const currentEntry = liveAction
        ? motionClips.find((c) => c.clip === motionClipOf(liveAction))
        : null;
      vrm.lookAt.autoUpdate = !(animActive && currentEntry?.drivesEyes === true);
    }

    vrm.update(dt);
    // #9 全局暂停标志：动画激活时 breath/blink 自查静默，取代散布的 `!animActive` 守卫。
    applyIdlePerception(dt, { perception, semanticBones, animActive, ctx });
    // VMD 足 IK：与上面的待机锚地以 animActive 互斥（待机走锚地、动画走 VMD 目标）。
    // 写在 vrm.update(dt) 之后——归一化骨的位姿是**单向烘回**原始骨的，IK 结论要落在
    // 原始骨上就必须晚于那一步（detail 见 vrm-foot-ik.ts 文件头）。
    if (animActive && motion.motionAction) {
      applyAnimationFootIK(motion.motionAction, motionClips, vrmFootIK);
    }
    applyBlinkPerception(dt, perception);
  };
}

/** 逐 Mesh 材质统计纹理数（dispose 释放日志用；traverse 回调从 dispose 外提降嵌套） */
function countSceneTextures(scene: THREE.Object3D): number {
  let texCount = 0;
  scene.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const mat of mats) {
      const texKeys = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap"];
      for (const key of texKeys) {
        const tex = (mat as unknown as Record<string, unknown>)[key];
        if (tex instanceof THREE.Texture) texCount++;
      }
    }
  });
  return texCount;
}

/** 构建 dispose 回调的状态依赖（Stage5 组装期一次性捕获） */
interface VrmDisposeDeps {
  vrm: VRM;
  boneAssy: VrmBoneAssembly;
  motion: VrmMotionState;
  perception: VrmPerceptionState;
  vrmFootIK: ReturnType<typeof createVrmFootIKController>;
  path: string;
  port: VrmDataPort | undefined;
}

/** 构建 dispose 回调（原 Stage5 return 内的 dispose 闭包原样外提，行为零变更） */
function makeVrmDisposer(deps: VrmDisposeDeps): () => void {
  const { vrm, boneAssy, motion, perception, vrmFootIK, path, port } = deps;
  const { bonePanelRef } = boneAssy;
  const { motionMixer } = motion;
  // P5 代际守卫：dispose 使在途 loadMotionClips 的结果不落地（ADR-230）
  motion.guard.invalidate();
  const { breath, gaze, blink, footIK, useNativeLookAt } = perception;
  return (): void => {
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
    vrmFootIK.dispose();
    motionMixer?.stopAllAction();
    motionMixer?.uncacheRoot(vrm.scene);
    if (useNativeLookAt) vrm.lookAt!.target = null;
    const texCount = countSceneTextures(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
    void vrmDiag(port, "gpu-release", path, "ok", `tex=${texCount}`);
  };
}

function Stage5BuildResult(
  ctx: PreviewBuildCtx,
  path: string,
  port: VrmDataPort | undefined,
  artifacts: VrmBuildArtifacts,
  menuItems: PreviewMenuNode[],
): UpdateableScene & ScreenshotScene & SemanticScene {
  const { parseRes, boneAssy, vrmMaterials, motion, perception } = artifacts;
  const { vrm } = parseRes;
  const { semanticBones } = boneAssy;
  const { motionClips } = motion;
  // VMD 足 IK 驱动（ADR-243 §2.8 方案 A）：内部在**创建期快照**足骨的静止世界位置，
  // 因此必须在任何 mixer.update 之前构造——本函数处于 build 阶段，天然满足。
  const vrmFootIK = createVrmFootIKController(boneAssy.boneTree, semanticBones);
  recordLoadTrace({
    ts: Date.now(),
    format: ctx.adapterId ?? TRACE_FORMAT_OTHER,
    path,
    stages: [
      { name: "读取", ms: Math.round(parseRes.tParseStart - parseRes.tStart), status: "ok" },
      { name: "解析", ms: Math.round(parseRes.tParseEnd - parseRes.tParseStart), status: "ok" },
    ],
    assets: {
      files: 1,
      textures: vrmMaterials.length,
      // ⚠️ 刀⑳：原为 `boneTree.roots.length`——roots 只是「无父骨的根节点」≈1，
      // 会让 load-trace 把 VRM 报成「1 骨骼」。同一函数 :513 早已修过**完全相同**的
      // bug 并留注释（"a400b244 review P2：用它面板会错误显示「1 骨骼」"），此处漏改。
      // 骨骼总数口径 = byId.size（含全部 humanoid 骨骼 ~52 根），与面板同源。
      bones: boneAssy.boneTree.byId.size,
      materials: vrmMaterials.length,
      animations: motionClips.length,
      vrmaClips: motionClips.length,
    },
    ok: true,
  });
  // update/dispose 体量大且各自含多层嵌套——外提为顶层工厂（各自独立度量复杂度），
  // 本函数退化为纯编排。依赖经对象一次性传入，语义等价于原闭包捕获。
  return {
    menuItems,
    update: makeVrmUpdater({ vrm, motion, perception, semanticBones, vrmFootIK, ctx }),
    dispose: makeVrmDisposer({
      vrm,
      boneAssy,
      motion,
      perception,
      vrmFootIK,
      path,
      port,
    }),
    screenshot: () =>
      Promise.resolve(
        screenshotFromRenderer(requireSharedInfra(ctx).renderer, ctx.scene, ctx.camera),
      ),
    semanticBones,
  };
}

/**
 * VRM 构建主入口。依赖复用 `VrmAdapterDeps`（IO + 视图钩子）——原 6 形参
 * （ctx/path/port/readFn/panels/listAllFilePaths）收进单一依赖对象，消参数陷阱
 * （check-params p6→p3），且与 makeVrmAdapter 的注入形态同源（同一个 deps 直接透传）。
 */
export async function buildVrmScene(
  ctx: PreviewBuildCtx,
  path: string,
  deps: VrmAdapterDeps,
): Promise<UpdateableScene & ScreenshotScene & SemanticScene> {
  requireSharedInfra(ctx);
  const parseRes = await Stage1ReadParse(ctx, path, deps.port, deps.readFileBytes);
  const { vrm } = parseRes;
  // P3：用户校准的位移缩放覆写（持久化）；null = 自动按身高估算
  const motion = await loadMotionClips(
    vrm,
    path,
    deps.readFileBytes,
    deps.listAllFilePaths,
    readVmdPositionScale() ?? undefined,
  );
  setupCameraBounds(ctx, vrm);
  const boneAssy = Stage2BonesHumanoid(vrm);
  const vrmMaterials = Stage3Materials(vrm);
  const perception = buildPerception(vrm, ctx, boneAssy.boneTree, boneAssy.semanticBones);
  // meta 文本摘要随 vrm 存活期归一化（纯数据零 GPU；stage5 dispose 后 vrm.meta 仍可读，
  // 但趁 vrm 在手边一并收口，语义对齐「面板数据源一次构造」）
  const meta = vrmMetaSummary(vrm.meta);
  const artifacts: VrmBuildArtifacts = {
    parseRes,
    boneAssy,
    vrmMaterials,
    motion,
    perception,
    meta,
  };
  // P5 后 Stage4 不再直接消费 deps（rescale 原地改写，无 IO）；保留参数位供未来扩展
  const menuItems = Stage4MenuPanels(path, deps.panels, ctx, artifacts, deps);
  return Stage5BuildResult(ctx, path, deps.port, artifacts, menuItems);
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
    cleanupRef: BonePanelCleanupRef;
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
  panels?: VrmPanelHooks | undefined;
  /** 感知层状态（adapter build 创建，面板 UI 双向绑定） */
  perception?: {
    state: PerceptionState;
    caps: PerceptionCapability[];
  };
  /** [ADR-243 锐评对账 P3/P5] 位移缩放校准控制：仅当有 VMD 重定向动作（vmdCount>0）时注入；
   *  拖动逐 tick 原地 rescale（P5），松手落盘（onCommit），复位回创建期自动快照（P3）。 */
  positionScale?: VrmPositionScaleControl | undefined;
}

/** P3/P5 位移缩放校准控制面（Stage4 组装、vrmMenuItems 消费；测试可假实现遍历真实菜单表） */
interface VrmPositionScaleControl {
  /** VMD 重定向动作条目数（>0 才渲染滑块） */
  vmdCount: number;
  /** 当前有效值：持久化覆写 ?? 创建期自动快照（P3，单一事实源） */
  current: () => number;
  /** 用户校准值：原地 rescale 位移轨道（同步，O(值总数)，P5 拖动实时） */
  set: (v: number) => void;
  /** 松手/点击轨道后的离散落盘（null = 清除回自动） */
  onCommit?: (v: number | null) => void;
  /** 清除持久化覆写，回创建期自动快照并 rescale */
  resetToAuto: () => void;
}

/**
 * ADR-161 §2.5 工厂：VRM 挂载主入口（make<Format>Adapter 命名章程）。
 * 依赖（IO/面板 hooks）由视图层组装经 deps 注入——adapters 层不反向依赖 views。
 * 用法：`const adapter = makeVrmAdapter({ readFileBytes, panels, listAllFilePaths }); mount3D(adapter, path)`
 */
export interface VrmAdapterDeps {
  /** 诊断端口（addOpLog 等）；可选——未注入时诊断日志静默跳过 */
  port?: VrmDataPort;
  /** 包内文件读取（view-shell 注入） */
  readFileBytes: (p: string) => Promise<string | null>;
  /** 面板 UI hooks（model/shot/play 菜单节点，视图层组装） */
  panels?: VrmPanelHooks;
  /** 动作扫描文件枚举（`.vrma` + `.vmd`；ADR-243 §2.7 起还用于 MMD 动作库） */
  listAllFilePaths?: (dir: string) => Promise<string[] | null>;
}
export function makeVrmAdapter(deps: VrmAdapterDeps): PreviewAdapter {
  return {
    id: "vrm",
    build: (ctx, path) => buildVrmScene(ctx, path, deps),
  };
}

/**
 * [ADR-242 后续 / ADR-243 §2.7] 播放面板空态引导文案。
 * VRMA 在现实生态里极稀少（MMD 圈产 VMD、动捕产 FBX，无人专门产 .vrma），故「扫不到动作」
 * 曾是常态；ADR-243 落地后 VMD 成为第二条来源，文案须同时交代两条路径——否则用户会以为
 * 这里只认 .vrma（bridge.emptyHint 与兜底空态节点共用同一份，防两处漂移）。
 */
const VRM_PLAY_EMPTY_HINT =
  "未找到动作文件。把 .vrma / .vmd 放到该模型所在目录即可（同目录自动发现）；MMD 动作库（CustomAnim）里的 .vmd 也会自动重定向到本模型。";

/**
 * [ADR-243 锐评对账 P1a] VMD 动作版权常驻提示：MMD 配布モーション条款常含「MMD 以外使用禁止」
 * 等限制，重定向播放属灰色地带——工具层不裁决合规性，但雷区立牌。走 i18n（`preview.playNotice`），
 * MmdPlayBridge.notice 缺省不渲染，MMD/YSM 桥零影响。
 */
const VRM_PLAY_NOTICE = t("preview.playNotice");

/**
 * [ADR-242 后续] 无动作时的空播放桥：clips 空 → playNodes 走空态引导分支。
 * 面板须显示引导而非消失（对齐 MMD 固定表项行为）。
 */
function emptyVrmPlayBridge(): MmdPlayBridge {
  return {
    clips: [],
    isPlaying: () => false,
    toggle: () => {},
    currentIndex: () => 0,
    select: () => {},
    animDir: null,
    emptyHint: VRM_PLAY_EMPTY_HINT,
    notice: VRM_PLAY_NOTICE,
  };
}

/** [ADR-242 后续] playNodes 未注入时的兜底空态节点：保证 play 面板恒有渲染通道
 *  （items.test 契约「panel 必有 renderCustom/children/schemaId 三选一」，空 children 即静默空面板）。 */
const VRM_PLAY_EMPTY_NODE: PreviewMenuNode = {
  id: "vrma-play-empty",
  kind: "field",
  labelKey: "preview.playEmpty",
  value: VRM_PLAY_EMPTY_HINT,
};

/** [ADR-243 锐评对账 P5] 位移缩放校准叶子节点（滑块 + 复位）：仅当有 VMD 重定向动作时露出
 *  （.vrma 不受 positionScale 影响）。拖动逐 tick 实时 rescale（set），松手落盘（onCommit）——
 *  替换原先「拖动抑制 + 松手重建整库重读」的重路径。
 *  ⚠️ 必须挂面板 children（叶子层）：根项只允许 panel/action/divider（check-menu-health
 *  ROOT_KINDS），根项滑块既违规又不可达（motionDetailView 只列 kind==="panel" 的 motion 项）。 */
function vmdPositionScaleNodes(ps: VrmPositionScaleControl): PreviewMenuNode[] {
  return [
    {
      id: "vmd-position-scale",
      labelKey: "preview.vmdPositionScale",
      kind: "slider",
      control: {
        min: 0,
        max: 0.4,
        step: 0.005,
        get: () => ps.current(),
        set: (v: unknown) => {
          // 拖动实时：原地改写位移轨道（O(值总数)），下一帧渲染即见新缩放
          const n = Number(v);
          if (Number.isFinite(n)) ps.set(n);
        },
        onCommit: (v: number) => {
          // 松手/点击轨道/键盘步进后离散落盘（拖动期间的 rescale 已完成）
          ps.onCommit?.(v);
        },
        unit: "x",
      },
    },
    {
      id: "vmd-position-scale-reset",
      labelKey: "preview.vmdPositionScaleReset",
      kind: "button",
      action: (): void => {
        ps.resetToAuto();
      },
    },
  ];
}

/**
 * VRM 声明式根菜单专属项（ADR-076 v2 Phase 2）：🦴 骨骼 + 🎨 材质。
 * 提取为可导出表：适配器与测试共用同一份真实数组（对齐 MikuMikuAR），加菜单项只改这里。
 * 根项白名单：只出 panel/action/divider（控件类节点挂对应面板 children）。
 */
export function vrmMenuItems(o: VrmMenuItemsOpts): PreviewMenuNode[] {
  const items: PreviewMenuNode[] = [
    {
      id: "model",
      icon: "model",
      labelKey: "preview.modelInfo",
      kind: "panel",
      dockGroup: "model",
      // [doc:adr-126-p4-b-1] 面板内容声明式化（P5 收尾：VRM 迁 children 样板，对齐 MMD）：
      // children = vrmModelInfoNodes 纯数据节点（经 panels 注入，R1 禁 utils→views）。
      // 此前 renderCustom 委托 makeModelPanelRenderer——视图层从未注入（no-op 空面板），
      // 迁 children 顺带补上从未有过的模型信息内容。
      children: o.panels?.modelInfoNodes?.(o.modelInfo) ?? [],
    },
    {
      id: "shot",
      icon: "camera",
      labelKey: "preview.screenshot",
      kind: "panel",
      dockGroup: "model",
      // [doc:adr-126-p4-b-1] 截图面板声明式化（P5 收尾：对齐 MMD/YSM shotNodes 样板，
      // 复用 shot-panel-shared 六角度按钮）；此前委托 makeShotPanelRenderer——
      // 视图层从未注入（no-op 空面板），迁 children 顺带补上截图功能。
      children: o.panels?.shotNodes?.(o.screenshot, o.modelPath) ?? [],
    },
    {
      id: "material",
      icon: "appearance",
      labelKey: "preview.materialList",
      kind: "panel",
      dockGroup: "model",
      children: materialNodes(o.material),
    },
    makeBonesPanelItem({
      tree: o.bonePanel.tree,
      cleanupRef: o.bonePanel.cleanupRef,
      viewContainer: o.bonePanel.viewContainer,
      camera: o.bonePanel.camera,
      scene: o.bonePanel.scene,
    }),
  ];
  // [ADR-242 后续] play 面板无条件注入（对齐 MMD 的固定表项）：无 .vrma 时也显示面板 +
  // 空态引导，用户才知道「此处可放动作」——此前 if(o.play) 门控致面板凭空消失，
  // 用户误以为 VRM 不支持动作。空态文案由 bridge.emptyHint 自报（VRM 专有 .vrma 说明）。
  // playNodes 未注入时兜底空态 field：面板恒有渲染通道（items.test 契约：panel 必有
  // renderCustom/children/schemaId 三选一，空 children 会被判为静默空面板）。
  const playChildren = o.panels?.playNodes?.(o.play ?? emptyVrmPlayBridge());
  // [ADR-243 锐评对账 P3] 位移缩放校准挂动作面板 children（叶子层，见 vmdPositionScaleNodes）：
  // 仅当有 VMD 重定向动作时露出（.vrma 不受 positionScale 影响）。
  const posScaleNodes =
    o.positionScale && o.positionScale.vmdCount > 0 ? vmdPositionScaleNodes(o.positionScale) : [];
  const playPanelChildren = [...(playChildren ?? []), ...posScaleNodes];
  items.push({
    id: "vrma-play",
    icon: "play",
    labelKey: "preview.mmdPlay",
    kind: "panel",
    dockGroup: "motion", // 底栏 💃 动作组（对齐 MMD）
    // [doc:adr-126-p5-收尾] play 面板声明式化：children = playNodes（复用 MMD，经 panels 注入）
    // + P3 位移缩放校准叶子（两通道皆空时兜底空态 field，保证面板恒有渲染通道）
    children: playPanelChildren.length > 0 ? playPanelChildren : [VRM_PLAY_EMPTY_NODE],
  });
  if (o.perception) {
    items.push({
      id: "perception",
      icon: "visibility",
      labelKey: "preview.perception",
      kind: "panel",
      dockGroup: "motion",
      children: perceptionNodes(o.perception.state, o.perception.caps),
    });
  }
  return items;
}
