// ===== VRM 内容适配器（ADR-066 P3：从 vrm-3d.ts 抽离内容层）=====
// 本文件只负责 VRM 专属逻辑：经 Go 绑定 ReadFileBytes 取字节 → 官方 GLTFLoader +
// VRMLoaderPlugin 解析 → rotateVRM0 摆正 → 注入核心场景 + 灯光 + 包围盒定相机。
// 通用外壳（overlay/renderer/循环/释放）由 mount-preview-core.ts 拥有。
//
// [ADR-315 D2] 真缝拆分（行为零变更纯搬运，原 1401 行巨型文件瘦身）：
//   - 动作通道（.vrma/.vmd/动作库 三通道加载 + 位移重缩放 + 代际守卫）→ vrm-motion.ts
//   - 感知层驱动（呼吸/注视/眨眼/足部 IK 构造与每帧应用）→ vrm-perception.ts
//   - 菜单节点工厂（vrmMenuItems 根菜单表 + 位移缩放叶子 + 空态兜底）→ vrm-menu.ts
// 本文件保留：解析/meta 归一化/build 主入口（Stage1-5 编排）；原导出符号经
// 文末 re-export 垫片保持 30+ 消费者 import 路径零改动（单来源转发，反桶契约豁免）。

import { type VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import type { VRM0Meta, VRM1Meta } from "@pixiv/three-vrm-core";
import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { t } from "@/core/i18n/t.ts";
import type {
  PreviewAdapter,
  PreviewBuildCtx,
  ScreenshotScene,
  SemanticScene,
  UpdateableScene,
} from "@/preview-3d/adapters/mount-preview-core.ts";
import { requireSharedInfra } from "@/preview-3d/adapters/shared/shared-infra.ts";
import type { BoneTree } from "@/preview-3d/bone/bone-tools.ts";
import { vrmSemanticBoneMap } from "@/preview-3d/bone/semantic-bones.ts";
import { createVrmFootIKController } from "@/preview-3d/bone/vrm-foot-ik.ts"; // VMD 足ＩＫ 驱动（ADR-243 §2.8 方案 A）
import { frameCameraSide } from "@/preview-3d/infra/camera-setup.ts";
import { registerModelRoot, unregisterModelRoot } from "@/preview-3d/infra/frustum-cull.ts";
import { recordLoadTrace, TRACE_FORMAT_OTHER } from "@/preview-3d/infra/load-trace.ts";
import { renderLoadingState } from "@/preview-3d/infra/preview-loading.ts";
import { collectSceneStats, type SceneStats } from "@/preview-3d/infra/scene-stats.ts";
import {
  getVrmMaterialDetail,
  listVrmMaterials,
  setVrmMaterialOpacity,
  setVrmMaterialVisible,
} from "@/preview-3d/materials/vrm-materials.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";
import { screenshotFromRenderer } from "@/preview-3d/screenshot/screenshot.ts"; // ADR-052 P3：截图走共享 renderer（通用化）
import { base64ToBytes } from "@/utils/base/primitives/base64.ts";
import { safeGet, safeRemove, safeSet } from "@/utils/base/primitives/storage.ts";
import { buildVrmBoneTree } from "./vrm-bone.ts";
import {
  type VrmDataPort,
  type VrmModelInfoCtx,
  type VrmPanelHooks,
  type VrmPositionScaleControl,
  vrmMenuItems,
} from "./vrm-menu.ts";
import { loadMotionClips, rescaleVmdMotionClips, type VrmMotionState } from "./vrm-motion.ts";
import {
  applyAnimationFootIK,
  applyBlinkPerception,
  applyIdlePerception,
  buildPerception,
  type VrmPerceptionState,
  type VrmUpdateDeps,
} from "./vrm-perception.ts";

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
interface VrmParseResult {
  vrm: VRM;
  gltf: GLTF;
  tStart: number;
  tParseStart: number;
  tParseEnd: number;
}

interface VrmBoneAssembly {
  bonePanelRef: import("@/preview-3d/menu/panels/bones-panel-node.ts").BonePanelCleanupRef;
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

/** P3 位移缩放校准（ADR-243 锐评对账）：positionScale 在加载时 bake 进位移轨道
 *  （scaleTranslationTrack），改它 = 重建 .vmd 重定向 clip 并换绑——非运行期旋钮。 */

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

/** 取 action 实播的 clip。three r185 起 AnimationAction 不再暴露 `.clip` 属性，
 *  改用公开方法 `getClip()`（私有字段 `_clip` 无跨版本契约，勿直接读）。
 *  用于「time 源与 target 源同一对象」的反查（review 64c24cf3e P1）。 */
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
  const bonePanelRef: VrmBoneAssembly["bonePanelRef"] = { current: null };
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
  const positionScale: VrmPositionScaleControl | undefined =
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

// [ADR-243 锐评对账 P1a] VMD 动作版权常驻提示（i18n preview.playNotice，与 vrm-menu.ts 空态同源）
const VRM_PLAY_NOTICE = t("preview.playNotice");

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
    if (useNativeLookAt && vrm.lookAt) vrm.lookAt.target = null;
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
 * [ADR-315 D2] 拆缝后 buildVrmScene 形参保持 3 参（ctx/path/deps）——真缝搬运不改外部签名。
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

/**
 * [ADR-161 §2.5 工厂] VRM 挂载主入口（make<Format>Adapter 命名章程）。
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

// ===== [ADR-315 D2] re-export 垫片（单来源转发，消费者 import 路径零改动；反桶契约豁免）=====
// 动作通道符号 → vrm-motion.ts；感知层符号 → vrm-perception.ts；菜单符号 → vrm-menu.ts。
export type { VrmModelInfoCtx, VrmPanelHooks } from "./vrm-menu.ts";
export {
  type VrmDataPort,
  type VrmMenuItemsOpts,
  type VrmPositionScaleControl,
  vrmMenuItems,
} from "./vrm-menu.ts";
export {
  loadMotionClips,
  rescaleVmdMotionClips,
  type VrmMotionClipEntry,
  type VrmMotionState,
} from "./vrm-motion.ts";
export {
  applyAnimationFootIK,
  applyBlinkPerception,
  applyIdlePerception,
  buildPerception,
  type VrmPerceptionState,
} from "./vrm-perception.ts";
