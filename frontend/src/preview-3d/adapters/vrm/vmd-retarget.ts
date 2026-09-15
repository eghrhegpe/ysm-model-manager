// ===== VMD → VRM 人形骨骼重定向器（ADR-243 §2.1/§2.2/§2.4/§2.5）=====
// 输入：已解析的 VmdObject + VRM humanoid 归一化骨骼；输出：可直接交给
// `AnimationMixer(vrm.scene)` 播放的 AnimationClip（轨道名已绑到归一化骨骼 uuid）。
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
import {
  VMD_POSITION_SCALE_DEFAULT,
  VMD_REFERENCE_HEIGHT,
  VMD_RETARGET_CANDIDATES,
  VMD_ROOT_TRANSLATION_CANDIDATES,
} from "./vmd-retarget-map.ts";

/** 归一化骨骼访问面（`vrm.humanoid` 天然满足；窄接口便于单测注入假体） */
export interface VmdHumanoidRig {
  getNormalizedBoneNode(name: VRMHumanBoneName): THREE.Object3D | null;
}

/** 重定向配置 */
export interface VmdRetargetOptions {
  /**
   * 位置通道缩放（MMD 单位 → 米）。缺省按 VRM 身高自动估算（§2.5），
   * 估算失败回退 {@link VMD_POSITION_SCALE_DEFAULT}。
   */
  positionScale?: number;
}

/** 单条成功建立的骨骼映射 */
export interface VmdBoneBinding {
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
}

/** 重定向诊断报告 */
export interface VmdRetargetReport {
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
}

/**
 * 归一化骨静止位姿的身体比例（VRM/MMD 通例）：
 * `head` 骨位于身高约 87%（颅底/眼高），`foot`（踝）位于约 5%，差值即 82% 身高。
 * 仅用于 §2.5 的比例外推，非精确人体测量。
 */
const HEAD_HEIGHT_RATIO = 0.87;
const FOOT_HEIGHT_RATIO = 0.05;

/** buildAnimation 产出的骨骼轨道名（`index.js` `_createTrack(`${targetName}.position`)`） */
const BONE_TRACK_NAME = /^\.bones\[(.+)\]\.(position|quaternion)$/;

const _probeHead = new THREE.Vector3();
const _probeFoot = new THREE.Vector3();

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

/**
 * 按候选表解析绑定（ADR-243 §2.3/§2.4）。
 * 三重过滤：VRM 侧存在该归一化骨 → VMD 侧命中候选名 → 该 MMD 骨未被先前的 VRM 骨认领
 * （候选表已由覆盖性测试保证不重复，此处的去重是防表被改坏时的静默错绑）。
 */
export function resolveVmdBindings(
  present: ReadonlySet<string>,
  rig: VmdHumanoidRig,
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

  return {
    bindings,
    nodesByMmd,
    translationSource,
    translationTarget: translationSource ? hipsNode : null,
    translationBase: translationSource && hipsNode ? hipsNode.position.clone() : null,
  };
}

// ---------------------------------------------------------------------------
// 幽灵骨架（ADR-243 §2.1）
// ---------------------------------------------------------------------------

/**
 * 构造承载幽灵骨的 SkinnedMesh。
 *
 * ⚠️ `morphTargetDictionary` 必须显式置空对象：`buildAnimation` 无条件调用
 * `buildMorphAnimation`，其首行是 `mesh.morphTargetDictionary[morphName]`——而普通
 * `BufferGeometry` 不带 morph 属性 ⇒ three 的 Mesh 构造后该字段停在 `undefined`
 * ⇒ 解引用抛 TypeError。置空对象即让全部 morph 轨道被跳过（表情通道不在本次范围）。
 */
function createGhostMesh(bones: THREE.Bone[]): THREE.SkinnedMesh {
  const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  mesh.bind(new THREE.Skeleton(bones));
  mesh.morphTargetDictionary = {};
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
 */
export function rewriteVmdTracks(
  source: THREE.AnimationClip,
  plan: VmdBindingPlan,
  positionScale: number,
): { tracks: THREE.KeyframeTrack[]; droppedTracks: number } {
  const tracks: THREE.KeyframeTrack[] = [];
  let droppedTracks = 0;

  for (const track of source.tracks) {
    const matched = BONE_TRACK_NAME.exec(track.name);
    if (!matched) {
      droppedTracks++; // morph 轨道（`.morphTargetInfluences[i]`）——表情走另一个决策
      continue;
    }
    const mmd = matched[1];
    const channel = matched[2];

    if (channel === "quaternion") {
      const node = plan.nodesByMmd.get(mmd);
      if (!node) {
        droppedTracks++;
        continue;
      }
      track.name = `${node.uuid}.quaternion`;
      tracks.push(track);
      continue;
    }

    // position：VRMHumanoidRig.update 只读 hips 的位置，其余骨的位移通道一律丢弃
    // （保留只会得到每帧写回自身静止值的空转轨道）
    const { translationSource, translationTarget, translationBase } = plan;
    if (mmd !== translationSource || !translationTarget || !translationBase) {
      droppedTracks++;
      continue;
    }
    scaleTranslationTrack(track, translationBase, positionScale);
    track.name = `${translationTarget.uuid}.position`;
    tracks.push(track);
  }

  return { tracks, droppedTracks };
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
  const plan = resolveVmdBindings(collectVmdBoneNames(vmd), rig);
  const positionScale =
    opts.positionScale ??
    (() => {
      const height = estimateVrmHeight(rig);
      return height === null ? VMD_POSITION_SCALE_DEFAULT : scaleForHeight(height);
    })();

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

  const report: VmdRetargetReport = {
    bindings: plan.bindings,
    translationSource: plan.translationSource,
    droppedTracks: 0,
    positionScale,
  };

  if (ghostBones.length === 0) {
    return { clip: new THREE.AnimationClip("vmd-retarget", 0, []), report };
  }

  const ghostMesh = createGhostMesh(ghostBones);
  let source: THREE.AnimationClip;
  try {
    source = buildAnimation(vmd, ghostMesh);
  } finally {
    ghostMesh.geometry.dispose();
    (ghostMesh.material as THREE.Material).dispose();
  }

  const { tracks, droppedTracks } = rewriteVmdTracks(source, plan, positionScale);
  return {
    // duration 传 -1 → AnimationClip 构造函数按过滤后的轨道重算时长
    clip: new THREE.AnimationClip("vmd-retarget", -1, tracks),
    report: { ...report, droppedTracks },
  };
}
