// ===== VMD → VRM 人形骨骼重定向器（ADR-243 §2.1/§2.2/§2.4/§2.5/§2.8）=====
// 输入：已解析的 VmdObject + VRM humanoid 归一化骨骼；输出：可直接交给
// `AnimationMixer(vrm.scene)` 播放的 AnimationClip（轨道名已绑到归一化骨骼 uuid），
// 外加**足 IK 目标采样器**（VMD 的 左足ＩＫ/右足ＩＫ 只在 position 通道上有意义，
// 被摘出来交给 VRM 侧的 CCD 求解，见 §2.8）。
//
// 为什么写**归一化**骨骼：`VRMHumanoidRig.update()` 是「归一化 → 原始」的单向烘焙
// （读 rigBoneNode.quaternion，hips 另读世界位置；`autoUpdateHumanBones` 默认 true），
// 而归一化骨构造时只设 position、从不设 quaternion ⇒ 其静止位姿恒为单位四元数，与 MMD
// 骨骼同构 ⇒ 「静止位姿校正」这一项整个消失。官方 .vrma 走的也是同一条路。
//
// 复用 buildAnimation 的三样白送产物（轴系翻转 / MMD 逐轴贝塞尔插值 / 位置偏移合成），
// 手段是「幽灵骨架」：造一副骨头名 = MMD 名、静止 position = 目标归一化骨局部位置的
// 假骨架喂给 buildAnimation，再把产出的轨道名换绑到真实归一化节点。
//
// 纯逻辑（THREE + @moeru/three-mmd），零 DOM / 零 Wails：可 node 环境单测。

import { buildAnimation, type VmdObject } from "@moeru/three-mmd";
import type { VRMHumanBoneName } from "@pixiv/three-vrm-core";
import * as THREE from "three";
import { VMD_EXPRESSION_CANDIDATES } from "./vmd-expression-map.ts";
import {
  VMD_FOOT_IK_CANDIDATES,
  VMD_POSITION_SCALE_DEFAULT,
  VMD_REFERENCE_HEIGHT,
  VMD_RETARGET_CANDIDATES,
  VMD_ROOT_TRANSLATION_CANDIDATES,
  VMD_TOE_ROTATION_CANDIDATES,
} from "./vmd-retarget-map.ts";

/** 归一化骨骼访问面（`vrm.humanoid` 天然满足；窄接口便于单测注入假体） */
export interface VmdHumanoidRig {
  getNormalizedBoneNode(name: VRMHumanBoneName): THREE.Object3D | null;
}

/**
 * 单条腿的 VMD 足 IK 目标采样器（ADR-243 §2.8 方案 A）。
 *
 * 采样值是**世界空间偏移（米）**，已含两样重定向变换：上游 `buildAnimation` 的轴系翻转
 * `(px, py, -pz)` 与 §2.5 的位置缩放 `k`。目标是「相对 VRM 足骨静止世界位置」的增量，
 * 使用方按 `目标世界 = 足静止世界 + 采样值` 合成（该式不变量见 `vrm-foot-ik.ts` 文件头）。
 */
export interface VmdFootIKTarget {
  /** 采样时间（秒，与重定向 clip 同一时间轴）→ 写入 out；无可用数据返回 false */
  sample(timeSeconds: number, out: THREE.Vector3): boolean;
  /**
   * ADR-309 D4（锐评 P4）：IK 开关时间轴查询。返回 false = 该时刻 MMD 侧该骨 IK 关闭
   * （propertyKeyFrames 的 ikStates），CCD 求解器应跳过该侧。缺省 undefined = 全程启用
   * （`.vrma` 与无 ikStates 数据的旧 VMD 零影响）。
   */
  isEnabled?: (t: number) => boolean;
}

/** 双侧足 IK 目标（某侧为 null = 该 VMD 未含该侧 IK 骨） */
export interface VmdFootIKTargets {
  readonly left: VmdFootIKTarget | null;
  readonly right: VmdFootIKTarget | null;
}

/** 重定向配置 */
export interface VmdRetargetOptions {
  /**
   * 位置通道缩放（MMD 单位 → 米）。缺省按 VRM 身高自动估算（§2.5），
   * 估算失败回退 {@link VMD_POSITION_SCALE_DEFAULT}。
   */
  positionScale?: number;
  /**
   * 表情轨道名解析（ADR-306 §2.2）：鸭子类型的 `VRMExpressionManager.getExpressionTrackName`
   * （`name → VRMExpression_<preset>.weight | null`）。缺省 null = 不做表情改道（morph 全丢弃，
   * ADR-243 v1 行为）。传 `vrm.expressionManager` 即启用。
   */
  expressionManager?: VmdExpressionManagerLike | null;
}

/**
 * 可原地重缩放的位移轨道（锐评 P5）：hips 位移轨（base = 该骨静止局部位置）+
 * 足 IK 目标轨（base = 零）。`raw` 是烘焙前（k=1）的值快照——buildAnimation 产出即
 * 「静止位置 + 偏移」，与 k 无关。任意缩放换算都是同一个仿射式：
 *
 *   value(k) = base + (raw − base) × k
 *
 * 故重缩放**不需要旧 k、不需要重解析 VMD、不需要重建 clip / 换绑 action**：
 * 轨道 values 被 mixer 的 interpolant 与 IK 采样器共享引用（three interpolant 构造时
 * 持有 `track.values`），原地改写下一帧即生效。
 */
export interface VmdPositionTrackHandle {
  readonly track: THREE.KeyframeTrack;
  /** 缩放基准（hips = 归一化骨静止局部位置；IK 目标 = 零向量） */
  readonly base: THREE.Vector3;
  /** 烘焙前（k=1）值快照（与 track.values 同维） */
  readonly raw: Float32Array;
}

/**
 * ADR-309 D4（锐评 P4）：IK 骨单侧开关时间轴（MMD propertyKeyFrames.ikStates 的
 * 提取产物）。区间为**秒**，与重定向 clip 同时间轴；语义 = MMD 侧「该骨 IK 生效区间」
 * ——关闭段里 CCD 求解器应跳过（足回到 FK 自然位，与 MMD 关闭 IK 时表现一致）。
 *
 * 段表按时间轴升序、无重叠；恒定 `on`（作者全程开 IK，最常见）退化为单段
 * `[0, Infinity)`，零额外成本。
 */
export interface VmdIkTimeline {
  readonly side: "left" | "right";
  /** 时间轴升序、互不重叠的开关段（`on` = 该段内 IK 生效） */
  readonly segments: readonly { from: number; to: number; on: boolean }[];
}

/**
 * 从 VMD 的 `propertyKeyFrames` 提取足 IK 骨的开关时间轴（ADR-309 D4）。
 *
 * 数据源：`vmd.propertyKeyFrames[i].ikStates`（`[boneName, enabled][]`）——MMD 侧
 * 作者在每帧标「这帧左足 IK 开/关」，上游按 **属性变更** 生成 propertyKeyFrame，
 * 故段表粒度 = keyframe 粒度（非逐帧），上限 = propertyKeyFrameCount。
 *
 * 语义约定：
 * - 首个 keyframe 之前：默认 **on**（MMD 播放起点 IK 默认生效，与 MMD 侧一致）；
 * - 尾段延伸到 `Infinity`（clip 循环播放时开关状态保持最后一帧的值）；
 * - `ikBoneNames` 为 null/空（VMD 未驱动任何足 IK 骨）→ 返回 null。
 *
 * 性能护栏：keyframe 数 > 512 时直接退化为「全程 on」——ikStates 抖动到这种
 * 密度的 VMD 属极端例外，段表线性查会成为每帧热路径负担，宁可丢开关语义
 * 保住帧率（CCD 求解本来就有开销）。
 *
 * @param vmd 已解析的 VMD（propertyKeyFrames 缺席按「全程 on」处理）
 * @param ikBoneNames 该侧对应的 IK 骨 MMD 名（footIK.left / footIK.right，命中即查）
 * @param side 腿侧
 * @param clipDurationSeconds clip 时长（尾段补到该值；循环播放语义见上）
 * @returns 时间轴，或 null（无 IK 骨）
 */
export function extractVmdIkTimeline(
  vmd: VmdObject,
  ikBoneNames: readonly (string | null)[],
  side: "left" | "right",
  clipDurationSeconds: number,
): VmdIkTimeline | null {
  const targets = ikBoneNames.filter((n): n is string => n != null);
  if (targets.length === 0) return null;
  const frames = (
    vmd as unknown as {
      propertyKeyFrames?: readonly {
        frameNumber: number;
        ikStates: readonly (readonly [string, boolean])[];
      }[];
    }
  ).propertyKeyFrames;
  if (!frames || frames.length === 0) {
    return { side, segments: [{ from: 0, to: Infinity, on: true }] };
  }
  // 性能护栏：密度超限 → 退化全程 on（极端 VMD 的抖动 ikStates 不值得每帧线性查）
  if (frames.length > 512) {
    return { side, segments: [{ from: 0, to: Infinity, on: true }] };
  }
  const targetSet = new Set(targets);
  // 找该侧 IK 骨的首个 off keyframe（无 → 全程 on，最常见，零额外成本）
  let hasOff = false;
  for (const f of frames) {
    for (const [name, enabled] of f.ikStates) {
      if (targetSet.has(name) && !enabled) {
        hasOff = true;
        break;
      }
    }
    if (hasOff) break;
  }
  if (!hasOff) {
    return { side, segments: [{ from: 0, to: Infinity, on: true }] };
  }
  // 有 off 段：逐 keyframe 生成区间（升序、无重叠）
  const fps = 30; // MMD 标准帧率
  const segments: { from: number; to: number; on: boolean }[] = [];
  let prevT = 0;
  let prevOn = true;
  for (const f of frames) {
    let on = true;
    for (const [name, enabled] of f.ikStates) {
      if (targetSet.has(name)) {
        on = enabled;
        break;
      }
    }
    const t = f.frameNumber / fps;
    if (on === prevOn) continue; // 无变化不切段
    if (prevT < t) segments.push({ from: prevT, to: t, on: prevOn });
    prevT = t;
    prevOn = on;
  }
  // 尾段补到 clip 时长（循环播放时保持末帧状态）
  segments.push({
    from: prevT,
    to: clipDurationSeconds > prevT ? clipDurationSeconds : Infinity,
    on: prevOn,
  });
  return { side, segments };
}

/**
 * 把已烘焙的位移轨道从当前缩放原地改写为新缩放 k（锐评 P5：O(值总数)，零 IO）。
 * 前提：`raw` 快照存在（buildVmdRetargetClip 产物均自带）；k 相同则跳过。
 *
 * @returns 实际改写的 track 数
 */
export function rescaleVmdPositionTracks(
  handles: readonly VmdPositionTrackHandle[],
  k: number,
): number {
  let n = 0;
  for (const { track, base, raw } of handles) {
    const values = track.values;
    const bx = base.x;
    const by = base.y;
    const bz = base.z;
    for (let i = 0; i < values.length && i < raw.length; i += 3) {
      values[i] = bx + (raw[i] - bx) * k;
      values[i + 1] = by + (raw[i + 1] - by) * k;
      values[i + 2] = bz + (raw[i + 2] - bz) * k;
    }
    n++;
  }
  return n;
}

/** 查询单侧 IK 开关时间轴：t 落在某 `on` 段内返回 true，否则 false */
function isIkEnabled(timeline: VmdIkTimeline | null, t: number): boolean {
  if (!timeline) return true;
  for (const seg of timeline.segments) {
    if (t >= seg.from && t < seg.to && seg.on) return true;
  }
  return false;
}

/**
 * 表情轨道名解析窄面（ADR-306 §2.2）：鸭子类型 `VRMExpressionManager` 的单方法面
 * （`getExpressionTrackName: name → VRMExpression_<preset>.weight | null`），不必
 * import three-vrm-core 类型本身。适配器侧直接传 `vrm.expressionManager` 即满足。
 */
export interface VmdExpressionManagerLike {
  getExpressionTrackName(name: string): string | null;
}

/** 单条成功建立的骨骼映射（仅本模块内使用——经 VmdBindingPlan 对外暴露） */
interface VmdBoneBinding {
  readonly vrm: VRMHumanBoneName;
  readonly mmd: string;
}

/** 重定向计划（绑定结果；纯数据，便于测试与诊断面板直读） */
export interface VmdBindingPlan {
  /** 旋转通道绑定（MMD 名 → VRM 骨） */
  readonly bindings: readonly VmdBoneBinding[];
  /** MMD 骨名 → 目标归一化节点（旋转通道落点） */
  readonly nodesByMmd: ReadonlyMap<string, THREE.Object3D>;
  /** 位移源 MMD 骨名（null = VMD 未含位移源，或模型缺 hips） */
  readonly translationSource: string | null;
  /** 位移目标节点（VRM hips 归一化节点） */
  readonly translationTarget: THREE.Object3D | null;
  /** 位移基准（hips 归一化骨静止局部位置；幽灵骨静止位置与缩放基准同源，不变量） */
  readonly translationBase: THREE.Vector3 | null;
  /** 命中的 VMD 足 IK 骨名（null = 该侧无 IK 骨；不参与旋转绑定，仅摘目标轨道） */
  readonly footIK: Readonly<Record<"left" | "right", string | null>>;
  /**
   * 命中的 つま先ＩＫ 骨名（null = 该侧无；ADR-243 锐评对账 P1b）。
   * 与足ＩＫ相反：つま先ＩＫ关键帧活在 **quaternion** 通道，是合法 FK 旋转源，
   * 改道绑定到 `leftToes`/`rightToes` 归一化骨（路由见 toeNodesByMmd）。
   */
  readonly toeRotation: Readonly<Record<"left" | "right", string | null>>;
  /** つま先ＩＫ MMD 名 → toes 归一化节点（quaternion 通道改道落点） */
  readonly toeNodesByMmd: ReadonlyMap<string, THREE.Object3D>;
  /**
   * morph 轨道索引 → MMD morph 名（ADR-306 §2.2 改道表）。
   * 只含**可映射**的 morph 名（幽灵网格 morph 表与上游轨道索引同源），rewrite 阶段
   * 经 `expressionManager.getExpressionTrackName` 换成 `VRMExpression_<preset>.weight`。
   */
  readonly morphNameByIndex: ReadonlyMap<number, string>;
  /** MMD morph 名 → VRM preset（ADR-306 §2.1；改道解析时优先走 preset，原名为自定义表情兜底） */
  readonly morphPresetByMmd: ReadonlyMap<string, string>;
}

/** 重定向诊断报告（仅本模块内使用——经 VmdRetargetResult 对外暴露） */
interface VmdRetargetReport {
  readonly bindings: readonly VmdBoneBinding[];
  readonly translationSource: string | null;
  /** 被丢弃的轨道数（morph 通道 + 未映射骨 + 非位移源的 position 通道） */
  readonly droppedTracks: number;
  /** 实际采用的位置缩放 */
  readonly positionScale: number;
}

/** 重定向产物 */
export interface VmdRetargetResult {
  /** 已绑到 VRM 归一化骨骼的 clip；无任何可用映射时 tracks 为空 */
  readonly clip: THREE.AnimationClip;
  readonly report: VmdRetargetReport;
  /** 足 IK 目标采样器（供 VRM 侧 CCD 求解；ADR-243 §2.8 方案 A） */
  readonly footIK: VmdFootIKTargets;
  /**
   * 位移轨道重缩放句柄（锐评 P5）：hips 位移轨 + 足 IK 目标轨，`raw` 为烘焙前 k=1 快照。
   * 适配器把它存进动作条目，缩放滑块经 {@link rescaleVmdPositionTracks} 原地改写——
   * 免重读、免重解析、免换绑。无位移通道时为空数组。
   */
  readonly posTracks: readonly VmdPositionTrackHandle[];
  /**
   * ADR-309 D2（锐评 P2）：该 clip 是否驱动眼骨（左目/右目 quaternion 轨道命中映射表）。
   * 为 true 时 VRM 侧每帧把 `lookAt.autoUpdate` 置 false，眼骨完全交给 mixer；
   * 为 false 时 lookAt 照常盯摄像头。
   */
  readonly drivesEyes: boolean;
}

/** 无 IK 目标的常态值（模型未驱动 IK 骨 / 无可用映射时复用，避免各处重复构造） */
const NO_FOOT_IK: VmdFootIKTargets = { left: null, right: null };

/**
 * 归一化骨静止位姿的身体比例（VRM/MMD 通例）：
 * `head` 骨位于身高约 87%（颅底/眼高），`foot`（踝）位于约 5%，差值即 82% 身高。
 * 仅用于 §2.5 的比例外推，非精确人体测量。
 */
const HEAD_HEIGHT_RATIO = 0.87;
const FOOT_HEIGHT_RATIO = 0.05;

/** buildAnimation 产出的骨骼轨道名（`index.js` `_createTrack(`${targetName}.position`)`） */
const BONE_TRACK_NAME = /^\.bones\[(.+)\]\.(position|quaternion)$/;

/** buildMorphAnimation 产出的表情轨道名（`index.js:4093` `.morphTargetInfluences[N]`） */
const MORPH_TRACK_NAME = /^\.morphTargetInfluences\[(\d+)\]$/;

const _probeHead = new THREE.Vector3();
const _probeFoot = new THREE.Vector3();
/** 幽灵 IK 骨的静止位置（零）：使 buildAnimation 的 `basePosition + offset` 退化为纯偏移 */
const _zeroOrigin = new THREE.Vector3();

// ---------------------------------------------------------------------------
// 比例（ADR-243 §2.5）
// ---------------------------------------------------------------------------

/** 按身高外推位移缩放：`k = k0 × (身高 / 1.6m)` */
export function scaleForHeight(heightMeters: number): number {
  return VMD_POSITION_SCALE_DEFAULT * (heightMeters / VMD_REFERENCE_HEIGHT);
}

/**
 * 由归一化骨静止位姿估算 VRM 身高（米）。非站立姿态 / 缺骨 / 退化尺度 → null（不猜）。
 * 只在 `positionScale` 未显式给出时使用。
 */
export function estimateVrmHeight(rig: VmdHumanoidRig): number | null {
  const head = rig.getNormalizedBoneNode("head");
  const foot = rig.getNormalizedBoneNode("leftFoot") ?? rig.getNormalizedBoneNode("rightFoot");
  if (!head || !foot) return null;
  const span = head.getWorldPosition(_probeHead).y - foot.getWorldPosition(_probeFoot).y;
  if (!Number.isFinite(span) || span <= 0.2) return null;
  return span / (HEAD_HEIGHT_RATIO - FOOT_HEIGHT_RATIO);
}

/**
 * 自动位移缩放（ADR-243 锐评对账 P3 单一事实源）：`buildVmdRetargetClip` 未显式给
 * `positionScale` 时的回退值——按身高外推，估算失败退 `VMD_POSITION_SCALE_DEFAULT`。
 * 校准滑块（vrm-adapter）用它镜像「自动值」做显示，避免两处各算一份漂移。
 */
export function autoVmdPositionScale(rig: VmdHumanoidRig): number {
  const height = estimateVrmHeight(rig);
  return height === null ? VMD_POSITION_SCALE_DEFAULT : scaleForHeight(height);
}

// ---------------------------------------------------------------------------
// 绑定解析
// ---------------------------------------------------------------------------

/** VMD 实际驱动的骨骼名集合（一次线性扫描；VMD 骨骼关键帧总量有限） */
export function collectVmdBoneNames(vmd: VmdObject): Set<string> {
  const names = new Set<string>();
  const frames = vmd.boneKeyFrames;
  for (let i = 0; i < frames.length; i++) names.add(frames.get(i).boneName);
  return names;
}

/** VMD 实际驱动的 morph 名集合（同 collectVmdBoneNames 的 morph 版） */
export function collectVmdMorphNames(vmd: VmdObject): Set<string> {
  const names = new Set<string>();
  const frames = vmd.morphKeyFrames;
  for (let i = 0; i < frames.length; i++) names.add(frames.get(i).morphName);
  return names;
}

/**
 * VMD morph 名 → VRM preset 改道表（ADR-306 §2.1/§2.2）。
 *
 * `collectVmdMorphNames(vmd) ∩ 候选表` 后**再过一道模型侧存在性检查**——preset 在
 * `expressionManager` 上解析不出轨道名（模型缺该表情）就不进表，幽灵网格不填该键，
 * 上游白名单自然跳过，不会产出落到不存在的 `VRMExpression_*.weight` 上的死轨道。
 *
 * @param present VMD 实际驱动的 morph 名（collectVmdMorphNames）
 * @param expressionManager 表情轨道名解析（鸭子类型 getExpressionTrackName；null = 不做表情改道）
 * @returns MMD morph 名 → VRM preset 名
 */
export function collectVmdExpressionMap(
  present: ReadonlySet<string>,
  expressionManager: VmdExpressionManagerLike | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!expressionManager) return map;
  const resolve = expressionManager.getExpressionTrackName.bind(expressionManager);
  for (const [preset, candidates] of Object.entries(VMD_EXPRESSION_CANDIDATES) as Array<
    [string, readonly string[]]
  >) {
    const mmd = candidates.find((c) => present.has(c));
    if (mmd === undefined) continue;
    // 模型侧存在性：preset 或原始名任一能解析出轨道名才改道（模型缺该表情 → 不进表）
    if (resolve(preset) === null && resolve(mmd) === null) continue;
    map.set(mmd, preset);
  }
  return map;
}

/**
 * 按候选表解析绑定（ADR-243 §2.3/§2.4）。
 * 三重过滤：VRM 侧存在该归一化骨 → VMD 侧命中候选名 → 该 MMD 骨未被先前的 VRM 骨认领
 * （候选表已由覆盖性测试保证不重复，此处的去重是防表被改坏时的静默错绑）。
 */
export function resolveVmdBindings(
  present: ReadonlySet<string>,
  rig: VmdHumanoidRig,
  expressionMap: ReadonlyMap<string, string> = new Map(),
): VmdBindingPlan {
  const bindings: VmdBoneBinding[] = [];
  const nodesByMmd = new Map<string, THREE.Object3D>();

  for (const [vrm, candidates] of Object.entries(VMD_RETARGET_CANDIDATES) as Array<
    [VRMHumanBoneName, readonly string[]]
  >) {
    const node = rig.getNormalizedBoneNode(vrm);
    if (!node) continue; // 模型未包含该 humanoid 骨（VRM 可选骨常态缺省）
    const mmd = candidates.find((c) => present.has(c) && !nodesByMmd.has(c));
    if (mmd === undefined) continue; // VMD 未驱动该骨
    nodesByMmd.set(mmd, node);
    bindings.push({ vrm, mmd });
  }

  const hipsNode = rig.getNormalizedBoneNode("hips");
  const translationSource =
    hipsNode == null
      ? null
      : (VMD_ROOT_TRANSLATION_CANDIDATES.find((c) => present.has(c) && !nodesByMmd.has(c)) ?? null);

  // 足 IK 骨只解析名字：它**不产生 FK 绑定**（关键帧活在 position 通道），也不占
  // nodesByMmd 的认领位——与旋转绑定的候选空间天然不相交（映射表里无 ＩＫ 骨）。
  const footIK = {
    left: VMD_FOOT_IK_CANDIDATES.left.find((c) => present.has(c)) ?? null,
    right: VMD_FOOT_IK_CANDIDATES.right.find((c) => present.has(c)) ?? null,
  };

  // つま先ＩＫ（P1b）：quaternion 通道的合法 FK 源，改道绑定到 toes 归一化骨。
  // 改道而非进主候选表的理由：候选表以「VRM 骨 → MMD 名」为向，而 つま先ＩＫ 与
  // 左つま先 可能同时存在（作者脚尖手调 + 模型自带 toe FK），改道表可独立优先。
  const toeNodesByMmd = new Map<string, THREE.Object3D>();
  const toeRotation: Record<"left" | "right", string | null> = { left: null, right: null };
  const toeTargets: Record<"left" | "right", VRMHumanBoneName> = {
    left: "leftToes",
    right: "rightToes",
  };
  for (const side of ["left", "right"] as const) {
    const mmd = VMD_TOE_ROTATION_CANDIDATES[side].find((c) => present.has(c)) ?? null;
    toeRotation[side] = mmd;
    if (mmd) {
      const toesNode = rig.getNormalizedBoneNode(toeTargets[side]);
      if (toesNode) toeNodesByMmd.set(mmd, toesNode);
    }
  }

  return {
    bindings,
    nodesByMmd,
    translationSource,
    translationTarget: translationSource ? hipsNode : null,
    translationBase: translationSource && hipsNode ? hipsNode.position.clone() : null,
    footIK,
    toeRotation,
    toeNodesByMmd,
    // 表情改道表（ADR-306 §2.2）：morph 名 → preset。轨道索引 → 名的映射在主入口
    // 填幽灵 morph 表时建立（索引 = 填表顺序，与上游 buildMorphAnimation 的写回一致）。
    morphNameByIndex: new Map([...expressionMap.keys()].map((mmd, i) => [i, mmd] as const)),
    morphPresetByMmd: expressionMap,
  };
}

// ---------------------------------------------------------------------------
// 幽灵骨架（ADR-243 §2.1）
// ---------------------------------------------------------------------------

/**
 * 构造承载幽灵骨的 SkinnedMesh。
 *
 * ⚠️ `morphTargetDictionary` 必须显式置对象（不可留 undefined）：`buildAnimation` 无条件
 * 调用 `buildMorphAnimation`，其首行是 `mesh.morphTargetDictionary[morphName]`——普通
 * `BufferGeometry` 不带 morph 属性 ⇒ three 的 Mesh 构造后该字段停在 `undefined` ⇒ 解引用
 * 抛 TypeError。填「可映射子集」（ADR-306 §2.2）后上游按键白名单过滤：可映射 morph 产出
 * `.morphTargetInfluences[N]` 轨道（随后被改道），不可映射的继续被上游跳过。
 */
function createGhostMesh(
  bones: THREE.Bone[],
  morphNames: readonly string[] = [],
): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.bind(new THREE.Skeleton(bones));
  const morphTargetDictionary: Record<string, number> = {};
  morphNames.forEach((name, i) => {
    morphTargetDictionary[name] = i;
  });
  mesh.morphTargetDictionary = morphTargetDictionary;
  return mesh;
}

// ---------------------------------------------------------------------------
// 轨道重写（ADR-243 §2.2）
// ---------------------------------------------------------------------------

/** 位移轨道缩放：只缩放「相对静止位置的偏移」部分，保留静止位置与贝塞尔插值参数同源 */
function scaleTranslationTrack(
  track: THREE.KeyframeTrack,
  base: THREE.Vector3,
  scale: number,
): void {
  if (scale === 1) return;
  const values = track.values;
  const { x: bx, y: by, z: bz } = base;
  for (let i = 0; i + 2 < values.length; i += 3) {
    values[i] = bx + (values[i] - bx) * scale;
    values[i + 1] = by + (values[i + 1] - by) * scale;
    values[i + 2] = bz + (values[i + 2] - bz) * scale;
  }
}

/**
 * 把 `buildAnimation` 的轨道换绑到 VRM 归一化节点。
 *
 * ⚠️ **原地改 `track.name`，禁止 `new QuaternionKeyframeTrack(...)` 重建**——
 * MMD 贝塞尔插值是 `_createTrack` 挂在**原 track 对象**上的 `createInterpolant` 覆写
 * 方法（`CubicBezierInterpolation` 未导出，无法重建）。重建即丢插值、退化为线性，
 * 视觉上「卡点顿挫」却不报错——本 ADR 最易漏检的一条，测试已钉死。
 *
 * 绑 `uuid` 而非 `name`：归一化节点名是 `"Normalized_" + <模型作者自定义骨名>`，
 * 可能含空格/日文，而 `PropertyBinding.findNode` 同时匹配 `name` 与 `uuid` ⇒ uuid 零歧义。
 *
 * `posTracks`（锐评 P5）：烘焙前快照每条位移轨的 values（k=1 原值）作为 `raw`，
 * 供 {@link rescaleVmdPositionTracks} 任意重缩放（不改 times、不换轨、不重建 clip）。
 */
export function rewriteVmdTracks(
  source: THREE.AnimationClip,
  plan: VmdBindingPlan,
  positionScale: number,
  /** 表情轨道名解析（ADR-306 §2.2）；缺省 = 不做表情改道（morph 全丢弃，ADR-243 v1 行为） */
  expressionManager?: VmdExpressionManagerLike | null,
): {
  tracks: THREE.KeyframeTrack[];
  droppedTracks: number;
  /** 摘出的足 IK 目标轨道（未进 clip；null = 该侧无目标） */
  ikTracks: Readonly<Record<"left" | "right", THREE.KeyframeTrack | null>>;
  /** 位移轨道重缩放句柄（hips 轨 + 双侧 IK 轨；raw = 烘焙前 k=1 快照） */
  posTracks: VmdPositionTrackHandle[];
} {
  const tracks: THREE.KeyframeTrack[] = [];
  const ikTracks: { left: THREE.KeyframeTrack | null; right: THREE.KeyframeTrack | null } = {
    left: null,
    right: null,
  };
  const posTracks: VmdPositionTrackHandle[] = [];
  let droppedTracks = 0;

  for (const track of source.tracks) {
    // 表情轨道（ADR-306 §2.2）：`.morphTargetInfluences[N]` → `VRMExpression_<preset>.weight`
    // 原地改名进 clip，由 AnimationMixer 统一驱动（官方 .vrma 同路）。索引不在改道表
    // （不可映射名 / 无 expressionManager）→ 常规丢弃，与 ADR-243 v1 行为一致。
    const morphMatched = MORPH_TRACK_NAME.exec(track.name);
    if (morphMatched) {
      const mmd = plan.morphNameByIndex.get(Number(morphMatched[1]));
      // 解析序：preset 优先（表语义），MMD 原名为自定义表情兜底（模型恰好同名的自定义
      // expression）。两者都解析不出轨道名（模型缺该表情 / 无 expressionManager）→ 丢弃。
      const preset = mmd ? plan.morphPresetByMmd.get(mmd) : undefined;
      const em = expressionManager ?? null;
      const trackName =
        mmd && em
          ? ((preset ? em.getExpressionTrackName(preset) : null) ?? em.getExpressionTrackName(mmd))
          : null;
      if (trackName) {
        // 原地改名（与骨骼轨道同一条纪律）；morph 轨道是裸 NumberKeyframeTrack（无贝塞尔
        // 覆写），改名零损失
        track.name = trackName;
        tracks.push(track);
      } else {
        droppedTracks++;
      }
      continue;
    }
    const matched = BONE_TRACK_NAME.exec(track.name);
    if (!matched) {
      droppedTracks++; // 非骨骼非表情轨道（相机/灯光等，本管线不管）
      continue;
    }
    const mmd = matched[1];
    const channel = matched[2];

    if (channel === "quaternion") {
      // つま先ＩＫ 改道（P1b）：quaternion 是合法 FK 源，落点改为 toes 归一化骨
      const toesNode = plan.toeNodesByMmd.get(mmd);
      if (toesNode) {
        track.name = `${toesNode.uuid}.quaternion`;
        tracks.push(track);
        continue;
      }
      const node = plan.nodesByMmd.get(mmd);
      if (!node) {
        droppedTracks++;
        continue;
      }
      track.name = `${node.uuid}.quaternion`;
      tracks.push(track);
      continue;
    }

    // position ①：足 IK 目标骨 → **摘出来**交给 VRM 侧 CCD 求解（ADR-243 §2.8 方案 A）。
    // 不进 clip（clip 的接收方是 AnimationMixer，IK 骨在 VRM 里不存在对应节点），
    // 也**不计入 droppedTracks**——它另有去处，不是被丢弃。
    const side = mmd === plan.footIK.left ? "left" : mmd === plan.footIK.right ? "right" : null;
    if (side) {
      // 幽灵 IK 骨静止位置为零 ⇒ 轨道值即「相对 bind 的偏移」，直接整体按 k 缩放
      posTracks.push({ track, base: _zeroOrigin, raw: track.values.slice(0) });
      scaleTranslationTrack(track, _zeroOrigin, positionScale);
      ikTracks[side] = track;
      continue;
    }

    // position ②：VRMHumanoidRig.update 只读 hips 的位置，其余骨的位移通道一律丢弃
    // （保留只会得到每帧写回自身静止值的空转轨道）
    const { translationSource, translationTarget, translationBase } = plan;
    if (mmd !== translationSource || !translationTarget || !translationBase) {
      droppedTracks++;
      continue;
    }
    posTracks.push({ track, base: translationBase, raw: track.values.slice(0) });
    scaleTranslationTrack(track, translationBase, positionScale);
    track.name = `${translationTarget.uuid}.position`;
    tracks.push(track);
  }

  return { tracks, droppedTracks, ikTracks, posTracks };
}

// ---------------------------------------------------------------------------
// 足 IK 目标采样（ADR-243 §2.8 方案 A 的重定向侧出口）
// ---------------------------------------------------------------------------

/** `Interpolant` 窄接口：`@types/three` 未声明 `KeyframeTrack.createInterpolant`（实例覆写） */
interface InterpolantLike {
  evaluate(t: number): void;
  readonly resultBuffer: unknown;
}

/**
 * 把摘出的 IK 轨道包成采样器（含 ADR-309 D4 的 IK 开关时间轴）。
 *
 * ⚠️ 走 `track.createInterpolant()` 而**不是**自己插值：上游把 MMD 逐轴贝塞尔挂在
 * 这个实例方法上（与 §2.2 同一条红线），自己线性插值会让抬脚轨迹出现卡点。
 * `evaluate` 的 t 超界行为在不同 three 版本间不一致，故显式 clamp 到首末关键帧。
 */
function createFootIKTarget(
  track: THREE.KeyframeTrack,
  timeline: VmdIkTimeline | null,
): VmdFootIKTarget {
  const factory = track as unknown as { createInterpolant?: () => unknown };
  const interpolant = (
    typeof factory.createInterpolant === "function" ? factory.createInterpolant() : null
  ) as InterpolantLike | null;
  const times = track.times;

  return {
    sample(timeSeconds: number, out: THREE.Vector3): boolean {
      if (!interpolant || times.length === 0) return false;
      const t = Math.min(Math.max(timeSeconds, times[0]), times[times.length - 1]);
      interpolant.evaluate(t);
      const buf = interpolant.resultBuffer as Float32Array;
      out.set(buf[0], buf[1], buf[2]);
      return true;
    },
    // ADR-309 D4：有开关时间轴时挂 isEnabled（CCD 关闭段跳过该侧）
    ...(timeline ? { isEnabled: (t: number) => isIkEnabled(timeline, t) } : {}),
  };
}

/** 摘出的轨道 → 对外采样器（缺侧为 null；附 ADR-309 D4 的 IK 开关时间轴） */
function toFootIKTargets(
  ikTracks: Readonly<Record<"left" | "right", THREE.KeyframeTrack | null>>,
  timelines: Readonly<Record<"left" | "right", VmdIkTimeline | null>>,
): VmdFootIKTargets {
  const left = ikTracks.left;
  const right = ikTracks.right;
  if (!left && !right) return NO_FOOT_IK;
  return {
    left: left ? createFootIKTarget(left, timelines.left) : null,
    right: right ? createFootIKTarget(right, timelines.right) : null,
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 把 VMD 身体 FK 重定向成可播的 VRM AnimationClip（ADR-243 §2 管线）。
 *
 * @param vmd 已解析的 VMD（本函数只读骨骼关键帧）
 * @param rig VRM 归一化骨访问面（传 `vrm.humanoid`）
 * @param opts 位置缩放覆盖（缺省按身高估算）
 */
export function buildVmdRetargetClip(
  vmd: VmdObject,
  rig: VmdHumanoidRig,
  opts: VmdRetargetOptions = {},
): VmdRetargetResult {
  const exprMgr = opts.expressionManager ?? null;
  // 表情改道（ADR-306 §2.1/§2.2）：VMD morph 名 ∩ 候选表 ∩ 模型侧存在性 → preset 映射。
  // 无 expressionManager / 全不可映射时为空表，行为退化为 ADR-243 v1（morph 全丢弃）。
  const expressionMap = collectVmdExpressionMap(collectVmdMorphNames(vmd), exprMgr);
  const plan = resolveVmdBindings(collectVmdBoneNames(vmd), rig, expressionMap);
  const positionScale = opts.positionScale ?? autoVmdPositionScale(rig);

  // 幽灵骨静止 position 必须填**目标归一化骨的局部位置**：buildAnimation 的
  // `basePosition + offset` 会把静止位置加进每条 position 轨道，填幽灵自己的坐标
  // 会让换绑后的骨骼每帧被拽到错误位置。
  const ghostBones: THREE.Bone[] = [];
  const pushGhost = (name: string, position: THREE.Vector3): void => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(position);
    ghostBones.push(bone);
  };
  for (const binding of plan.bindings) {
    const node = plan.nodesByMmd.get(binding.mmd);
    if (node) pushGhost(binding.mmd, node.position);
  }
  if (plan.translationSource && plan.translationBase) {
    pushGhost(plan.translationSource, plan.translationBase);
  }
  // つま先ＩＫ（P1b）：quaternion 通道的 FK 源也要进幽灵骨架，否则上游按骨架名白名单
  // 过滤时直接 skip，改道路由拿不到轨道。静止位置同源 toes 节点（position 通道不会用）。
  for (const mmd of [plan.toeRotation.left, plan.toeRotation.right]) {
    const toesNode = mmd ? plan.toeNodesByMmd.get(mmd) : undefined;
    if (mmd && toesNode) pushGhost(mmd, toesNode.position);
  }
  // 幽灵 IK 骨：静止位置**置零**（见 rewriteVmdTracks 的 position ①），因此产出的轨道
  // 值就是「相对 bind 的偏移」本身，无需再减基准。这两条轨道随后被摘出，不会进 clip。
  for (const mmd of [plan.footIK.left, plan.footIK.right]) {
    if (mmd) pushGhost(mmd, _zeroOrigin);
  }
  // 幽灵 morph 表（ADR-306 §2.2）：只填可映射子集做上游白名单——键序即轨道索引，
  // 与 plan.morphNameByIndex（同源 expressionMap.keys()）严格对齐。
  const ghostMorphs = [...expressionMap.keys()];

  const report: VmdRetargetReport = {
    bindings: plan.bindings,
    translationSource: plan.translationSource,
    droppedTracks: 0,
    positionScale,
  };

  let source: THREE.AnimationClip;
  if (ghostBones.length === 0 && ghostMorphs.length === 0) {
    // 无骨也无可映射 morph（ADR-306：零骨但有表情轨道时走主路径，clip 只装表情轨道）：
    // 用空幽灵骨架跑真实 buildAnimation 统计被丢弃的轨道，避免诊断面板把「全不可映射」
    // 误读为「0 丢弃」——上游 buildSkeletalAnimation 按 mesh.skeleton.bones 名单过滤、
    // buildMorphAnimation 按 morphTargetDictionary 过滤，零骨空表 ⇒ 源轨道全被滤掉
    // （droppedTracks = 源全量），与 rewriteVmdTracks 统计口径一致。
    // ⚠️ 不能传 null：buildSkeletalAnimation 无条件读 mesh.skeleton.bones，会 TypeError。
    source = buildAnimation(vmd, createGhostMesh([], ghostMorphs));
    const { droppedTracks } = rewriteVmdTracks(source, plan, positionScale, exprMgr);
    return {
      clip: new THREE.AnimationClip("vmd-retarget", 0, []),
      report: { ...report, droppedTracks },
      footIK: NO_FOOT_IK,
      posTracks: [],
      drivesEyes: false,
    };
  }

  const ghostMesh = createGhostMesh(ghostBones, ghostMorphs);
  try {
    source = buildAnimation(vmd, ghostMesh);
  } finally {
    ghostMesh.geometry.dispose();
    (ghostMesh.material as THREE.Material).dispose();
  }

  const { tracks, droppedTracks, ikTracks, posTracks } = rewriteVmdTracks(
    source,
    plan,
    positionScale,
    exprMgr,
  );
  const clip = new THREE.AnimationClip("vmd-retarget", -1, tracks);

  // ADR-309 D2：drivesEyes = 映射表命中的眼骨（leftEye/rightEye）是否被该 VMD 驱动。
  // 轨道名是 uuid（§2.2 纪律），不能拿字符串里找 "leftEye"——查绑定表 + 节点 uuid。
  const eyeUuids = new Set(
    plan.bindings
      .filter((b) => b.vrm === "leftEye" || b.vrm === "rightEye")
      .map((b) => plan.nodesByMmd.get(b.mmd)?.uuid)
      .filter((u): u is string => u != null),
  );
  const drivesEyes = [...eyeUuids].some((uuid) =>
    clip.tracks.some((t) => t.name === `${uuid}.quaternion`),
  );

  // ADR-309 D4：IK 开关时间轴（propertyKeyFrames.ikStates）
  const ikTimelines: Record<"left" | "right", VmdIkTimeline | null> = {
    left: plan.footIK.left
      ? extractVmdIkTimeline(vmd, [plan.footIK.left], "left", clip.duration)
      : null,
    right: plan.footIK.right
      ? extractVmdIkTimeline(vmd, [plan.footIK.right], "right", clip.duration)
      : null,
  };

  return {
    clip,
    report: { ...report, droppedTracks },
    footIK: toFootIKTargets(ikTracks, ikTimelines),
    posTracks,
    drivesEyes,
  };
}
