// ===== [ADR-243 §2 / ADR-315 D2①] VRM 动作通道（自 vrm-adapter.ts 拆出真缝）=====
// 动作加载三通道：① 同目录 .vrma（官方 VRMAnimationLoaderPlugin）② 同目录 .vmd
// （MMD 动作重定向 humanoid）③ MMD 动作库 .vmd（CustomAnim 共享资产）。
// 顺序即播放面板顺序；磁盘枚举一律走 Go 交付的 listAllFilePaths（归属红线）。
import { VmdObject } from "@moeru/three-mmd";
import { type VRM, VRMLoaderPlugin } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  type VRMAnimation,
  VRMAnimationLoaderPlugin,
} from "@pixiv/three-vrm-animation";
import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { getCustomAnimPath } from "@/preview-3d/adapters/mmd/mmd-anim-library.ts";
import { createLoadGuard, type LoadGuard } from "@/utils/async/load-guard.ts";
import { base64ToBytes, bytesToArrayBuffer } from "@/utils/base/primitives/base64.ts";
import {
  autoVmdPositionScale,
  buildVmdRetargetClip,
  rescaleVmdPositionTracks,
  type VmdFootIKTargets,
  type VmdPositionTrackHandle,
} from "./vmd-retarget.ts";

/** 动作标签 = 文件名去扩展名（无可用名 → "motion"） */
function motionLabel(filePath: string): string {
  return (filePath.split(/[/\\]/).pop() || "").replace(/\.[^.]+$/, "") || "motion";
}

/** 单个动作条目：`clip` 可直接交给 AnimationMixer；`footIK` 仅 VMD 重定向产物具备 */
export interface VrmMotionClipEntry {
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

export interface VrmMotionState {
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

/** `.vrma` 通道：官方 GLTFLoader + VRMAnimationLoaderPlugin → createVRMAnimationClip */
export async function loadVrmaClips(
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
export async function loadVmdClips(
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
export async function loadMotionClips(
  vrm: VRM,
  path: string,
  readFn: (p: string) => Promise<string | null>,
  listAllFilePaths?: (dir: string) => Promise<string[] | null>,
  /** 位移缩放覆盖（ADR-243 锐评对账 P3）：undefined = 用创建期自动估算 */
  positionScale?: number,
): Promise<VrmMotionState> {
  const motionClips: VrmMotionClipEntry[] = [];
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
      state.motionMixer = new THREE.AnimationMixer(vrm.scene);
      state.motionAction = state.motionMixer.clipAction(firstLocal.clip);
      state.motionAction.play();
    } else if (motionClips.length > 0) {
      // 只有 library 条目：建 mixer（供用户手动 select），但不自动 play
      state.motionMixer = new THREE.AnimationMixer(vrm.scene);
      // motionAction 保持 null（不自动播）：select() 时再 clipAction+play
    }
  } catch {
    /* 目录不可列 → 白模降级，不阻断模型渲染 */
  }
  return state;
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
