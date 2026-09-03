// ===== 语义骨骼层（SemanticBoneLayer）=====
// 跨格式「语义骨骼」统一抽象：感知层（呼吸/眨眼/注视/摇摆）、程序化动作、
// 姿势预设等消费方只认语义、不认格式——不用关心 VRM 的 humanoid 命名、
// MMD 的日文骨骼名、YSM 的随意命名。
//
// 接入范围（调研结论，2026-xx）：
//   - VRM：humanoid 52 骨骼 id 天然就是语义名（vrmSemanticBoneMap 零匹配直接产映射）。
//   - MMD：pmx 骨骼名随意（上半身/頭/左腕…），走候选名匹配表
//     （候选表自 MikuMikuAR motion-algos/proc-motion-shared 移植，已含日/英变体）。
//   - YSM：不接入——spec.bones 作者自由命名无标准，低模方块人上感知层收益有限，
//     候选表维护成本高、命中率低（语义骨骼面板等 YSM 现有功能不受影响）。
//
// 宽容缺省：匹配不到的语义直接缺省（map 无该键），消费方 getSemanticBone 返回
// null 优雅降级（如呼吸 chest 缺失 → fallback spine → hips → 静默）。
// 纯逻辑零 DOM、零 backend（ADR-072 工具层纯净）。

import * as THREE from "three";
import type { BoneNode, BoneTree } from "./bone-tools.ts";

/** 语义骨骼 id（对齐 VRM humanoid 命名；MMD 经候选名匹配；center 为 MMD 特有整体根） */
export type SemanticBoneId =
  | "hips"
  | "spine"
  | "chest"
  | "upperChest"
  | "neck"
  | "head"
  | "leftEye"
  | "rightEye"
  | "leftShoulder"
  | "rightShoulder"
  | "leftUpperArm"
  | "rightUpperArm"
  | "leftLowerArm"
  | "rightLowerArm"
  | "leftHand"
  | "rightHand"
  | "leftUpperLeg"
  | "rightUpperLeg"
  | "leftLowerLeg"
  | "rightLowerLeg"
  | "leftFoot"
  | "rightFoot"
  | "center";

/** 全部语义骨骼 id（稳定顺序：躯干 → 头颈 → 四肢；消费方遍历用） */
export const SEMANTIC_BONE_IDS: readonly SemanticBoneId[] = [
  "center",
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "leftShoulder",
  "rightShoulder",
  "leftUpperArm",
  "rightUpperArm",
  "leftLowerArm",
  "rightLowerArm",
  "leftHand",
  "rightHand",
  "leftUpperLeg",
  "rightUpperLeg",
  "leftLowerLeg",
  "rightLowerLeg",
  "leftFoot",
  "rightFoot",
];

/** 语义骨骼解析结果：语义 → 格式内骨骼（object 可直接改变换；缺失 = 该语义缺省） */
export interface SemanticBoneEntry {
  /** 格式内骨骼 id（VRM: humanoid bone name；MMD: pmx 索引字符串） */
  id: string;
  /** 3D 节点（改变换用；理论可缺省，实际两格式均有） */
  object?: THREE.Object3D | undefined;
}

/** 语义骨骼映射表（Partial：匹配不到的语义缺省，消费方宽容降级） */
export type SemanticBoneMap = Partial<Record<SemanticBoneId, SemanticBoneEntry>>;

// ---------------------------------------------------------------------------
// MMD 候选名表（自 MikuMikuAR motion-algos/proc-motion-shared 移植）
// 覆盖 MMD 标准日文名 + 全/半角变体 + 常见英文导出名。候选顺序 = 优先级，
// 首个命中胜出；歧义骨骼（上半身 vs 上半身2）靠「独占更具体候选」消解：
// chest 不含 上半身2，upperChest 独占 上半身2（VRM 语义 chest/upperChest 对齐）。
// ---------------------------------------------------------------------------

/** MMD 语义候选名表：语义 → 候选骨骼名列表（MMD 命名空间；消费方不直接触达） */
export const MMD_SEMANTIC_CANDIDATES: Record<SemanticBoneId, readonly string[]> = {
  // 整体根：センター（位移根）/ 全ての親（全亲）；VRM 无等价，常缺省
  center: ["センター", "全ての親", "center", "Center", "root", "Root", "AllParent"],
  // 腰 = pelvis（VRM hips 位置）；下半身 亦指向骨盆段
  hips: ["腰", "下半身", "hips", "Hips", "hip", "pelvis", "Pelvis"],
  // MMD 无 spine 精确等价（上半身 = spine+chest 合并段）→ 只留显式命名，命中率低，
  // 消费方 fallback 链 chest → spine → hips 兜底
  spine: ["脊柱", "spine", "Spine"],
  // 呼吸主骨：MMD 上半身（VRM chest 效果）；upper 兼容导出名
  chest: ["上半身", "chest", "Chest", "upper", "Upper"],
  // 上胸部：独占 上半身2（防与 chest 歧义）
  upperChest: ["上半身2", "上半身２", "upperChest", "UpperChest", "upper2", "Upper2"],
  neck: ["首", "首元", "neck", "Neck"],
  head: ["頭", "頭頂", "head", "Head"],
  leftEye: ["左目", "左眼", "left eye", "LeftEye"],
  rightEye: ["右目", "右眼", "right eye", "RightEye"],
  leftShoulder: [
    "左肩",
    "左肩P",
    "左肩C",
    "左肩捩",
    "left shoulder",
    "LeftShoulder",
    "LeftShoulderP",
    "LeftShoulderC",
  ],
  rightShoulder: [
    "右肩",
    "右肩P",
    "右肩C",
    "右肩捩",
    "right shoulder",
    "RightShoulder",
    "RightShoulderP",
    "RightShoulderC",
  ],
  // 上腕（大臂）；W/捩 变体兼容
  leftUpperArm: ["左腕", "左腕W", "左腕捩", "left arm", "LeftArm", "Left Arm", "leftUpperArm", "LeftUpperArm"],
  rightUpperArm: ["右腕", "右腕W", "右腕捩", "right arm", "RightArm", "Right Arm", "rightUpperArm", "RightUpperArm"],
  // 下腕（前臂）；肘骨兼容
  leftLowerArm: ["左ひじ", "左肘", "左ひじ捩", "left elbow", "LeftElbow", "leftLowerArm", "LeftLowerArm"],
  rightLowerArm: ["右ひじ", "右肘", "右ひじ捩", "right elbow", "RightElbow", "rightLowerArm", "RightLowerArm"],
  leftHand: ["左手首", "左リスト", "left wrist", "LeftWrist", "leftHand", "LeftHand"],
  rightHand: ["右手首", "右リスト", "right wrist", "RightWrist", "rightHand", "RightHand"],
  // 大腿（MMD「足」= 大腿）；L_/R_ 前缀兼容
  leftUpperLeg: ["左足", "左太もも", "left thigh", "LeftThigh", "left leg", "LeftLeg", "L_Thigh", "leftUpperLeg", "LeftUpperLeg"],
  rightUpperLeg: ["右足", "右太もも", "right thigh", "RightThigh", "right leg", "RightLeg", "R_Thigh", "rightUpperLeg", "RightUpperLeg"],
  leftLowerLeg: ["左ひざ", "左膝", "left knee", "LeftKnee", "L_Knee", "leftLowerLeg", "LeftLowerLeg"],
  rightLowerLeg: ["右ひざ", "右膝", "right knee", "RightKnee", "R_Knee", "rightLowerLeg", "RightLowerLeg"],
  leftFoot: ["左足首", "左足ＩＫ", "左足IK", "left foot", "LeftFoot", "left ankle", "LeftAnkle", "leftFoot", "LeftFoot"],
  rightFoot: ["右足首", "右足ＩＫ", "右足IK", "right foot", "RightFoot", "right ankle", "RightAnkle", "rightFoot", "RightFoot"],
};

// ---------------------------------------------------------------------------
// 解析器（格式无关核心）
// ---------------------------------------------------------------------------

/**
 * 在 BoneTree 中按候选名匹配首个骨骼（name 优先、id 兜底；候选顺序即优先级）。
 * MMD：id 是 pmx 索引字符串（"3"），name 是真实骨骼名，靠 name 命中；
 * VRM：id === name，两路等效。无命中返回 null（宽容缺省）。
 */
export function matchSemanticBone(tree: BoneTree, candidates: readonly string[]): BoneNode | null {
  for (const c of candidates) {
    for (const node of tree.byId.values()) {
      if (node.name === c || node.id === c) return node;
    }
  }
  return null;
}

/**
 * 从 BoneTree + 候选表解析语义映射（MMD 等无标准语义的格式走此路）。
 * 每语义独立匹配，互不干扰；缺省语义不进 map（消费方 getSemanticBone 返回 null）。
 */
export function resolveSemanticBones(
  tree: BoneTree,
  candidates: Record<SemanticBoneId, readonly string[]>,
): SemanticBoneMap {
  const map: SemanticBoneMap = {};
  for (const id of SEMANTIC_BONE_IDS) {
    const cands = candidates[id];
    if (!cands) continue; // 自定义/子集候选表缺键 = 该语义无候选，宽容跳过
    const node = matchSemanticBone(tree, cands);
    if (node) map[id] = { id: node.id, object: node.object };
  }
  return map;
}

/**
 * 取语义骨骼（消费方唯一入口；缺失返回 null，调用方自行降级）。
 * @param map 语义映射（适配器 build 后构建一次，传入消费方）
 * @param id 语义骨骼 id
 */
export function getSemanticBone(map: SemanticBoneMap, id: SemanticBoneId): SemanticBoneEntry | null {
  return map[id] ?? null;
}

// ---------------------------------------------------------------------------
// 格式特化（适配器侧调用；消费方不触达）
// ---------------------------------------------------------------------------

/**
 * VRM 特化：humanoid.humanBones 的键天然就是语义名（52 个标准骨骼），
 * 零候选匹配直接产映射——与 buildVrmBoneNodes 同一数据源。
 * @param humanBones vrm.humanoid.humanBones（键 = HumanoidBoneName，值含 node）
 * @returns 语义映射（仅含实际存在的骨骼）
 */
export function vrmSemanticBoneMap(
  humanBones: Record<string, { node?: THREE.Object3D }>,
): SemanticBoneMap {
  const map: SemanticBoneMap = {};
  for (const id of SEMANTIC_BONE_IDS) {
    const bone = humanBones[id];
    if (bone?.node) map[id] = { id, object: bone.node };
  }
  return map;
}

/**
 * MMD 特化：BoneTree（mmdBonesToBoneNodes → buildBoneTree 产物）+ 内置候选表 → 语义映射。
 * @param tree MMD 骨骼树（pmx.bones 索引结构）
 * @returns 语义映射（匹配不到的语义缺省）
 */
export function mmdSemanticBoneMap(tree: BoneTree): SemanticBoneMap {
  return resolveSemanticBones(tree, MMD_SEMANTIC_CANDIDATES);
}

// ---------------------------------------------------------------------------
// YSM 特化
// ---------------------------------------------------------------------------

/**
 * YSM 语义骨骼候选名表。
 * 覆盖 Blockbench/MC 导出常见命名（英文为主，含部分日文/中文变体）。
 * 候选顺序 = 优先级，首个命中胜出。
 */
const YSM_SEMANTIC_CANDIDATES: Record<SemanticBoneId, readonly string[]> = {
  center: ["center", "Center", "Centre", "root", "Root", "ROOT", "allparent", "AllParent"],
  hips: ["hips", "Hips", "HIPS", "hip", "Pelvis", "pelvis", "腰", "下半身"],
  spine: ["spine", "Spine", "SPINE", "脊柱", "stomach", "Stomach"],
  chest: ["chest", "Chest", "CHEST", "upper", "Upper", "上半身", "torso", "Torso"],
  upperChest: ["upperChest", "upper_chest", "upper chest", "上半身2", "上半身２", "upper2"],
  neck: ["neck", "Neck", "NECK", "首", "脖子"],
  head: ["head", "Head", "HEAD", "頭", "头"],
  leftEye: ["leftEye", "left_eye", "LeftEye", "left eye", "左目", "左眼"],
  rightEye: ["rightEye", "right_eye", "RightEye", "right eye", "右目", "右眼"],
  leftShoulder: [
    "leftShoulder", "left_shoulder", "LeftShoulder", "left shoulder",
    "左肩", "左肩P", "左肩C", "L_Shoulder", "lShoulder",
  ],
  rightShoulder: [
    "rightShoulder", "right_shoulder", "RightShoulder", "right shoulder",
    "右肩", "右肩P", "右肩C", "R_Shoulder", "rShoulder",
  ],
  leftUpperArm: [
    "leftUpperArm", "left_upper_arm", "LeftUpperArm", "left upper arm",
    "左腕", "左腕W", "L_UpperArm", "lUpperArm", "lArm",
  ],
  rightUpperArm: [
    "rightUpperArm", "right_upper_arm", "RightUpperArm", "right upper arm",
    "右腕", "右腕W", "R_UpperArm", "rUpperArm", "rArm",
  ],
  leftLowerArm: [
    "leftLowerArm", "left_lower_arm", "LeftLowerArm", "left lower arm",
    "左ひじ", "左肘", "L_LowerArm", "lLowerArm", "lElbow",
  ],
  rightLowerArm: [
    "rightLowerArm", "right_lower_arm", "RightLowerArm", "right lower arm",
    "右ひじ", "右肘", "R_LowerArm", "rLowerArm", "rElbow",
  ],
  leftHand: [
    "leftHand", "left_hand", "LeftHand", "left hand",
    "左手首", "左リスト", "L_Hand", "lHand",
  ],
  rightHand: [
    "rightHand", "right_hand", "RightHand", "right hand",
    "右手首", "右リスト", "R_Hand", "rHand",
  ],
  leftUpperLeg: [
    "leftUpperLeg", "left_upper_leg", "LeftUpperLeg", "left upper leg",
    "左足", "左太もも", "L_Thigh", "lThigh", "lUpperLeg",
  ],
  rightUpperLeg: [
    "rightUpperLeg", "right_upper_leg", "RightUpperLeg", "right upper leg",
    "右足", "右太もも", "R_Thigh", "rThigh", "rUpperLeg",
  ],
  leftLowerLeg: [
    "leftLowerLeg", "left_lower_leg", "LeftLowerLeg", "left lower leg",
    "左ひざ", "左膝", "L_Knee", "lKnee", "lLowerLeg",
  ],
  rightLowerLeg: [
    "rightLowerLeg", "right_lower_leg", "RightLowerLeg", "right lower leg",
    "右ひざ", "右膝", "R_Knee", "rKnee", "rLowerLeg",
  ],
  leftFoot: [
    "leftFoot", "left_foot", "LeftFoot", "left foot",
    "左足首", "左足IK", "L_Foot", "lFoot", "lAnkle",
  ],
  rightFoot: [
    "rightFoot", "right_foot", "RightFoot", "right foot",
    "右足首", "右足IK", "R_Foot", "rFoot", "rAnkle",
  ],
};

/**
 * YSM 特化：从 SpecBone3D[]（spec.models[].bones[]）构建语义映射。
 * YSM spec.bones[].name 即骨骼名，与 .animation.json 的 bones key 直接匹配。
 * @param bones spec.bones 列表（扁平声明）
 * @returns 语义映射（匹配不到的语义缺省）
 */
export function ysmSemanticBoneMap(
  bones: Array<{ id: string; name: string; parentId?: string }>,
): SemanticBoneMap {
  const nameToId = new Map<string, string>();
  for (const b of bones) {
    if (b.name) nameToId.set(b.name, b.id);
  }
  const map: SemanticBoneMap = {};
  for (const id of SEMANTIC_BONE_IDS) {
    const cands = YSM_SEMANTIC_CANDIDATES[id];
    if (!cands) continue;
    for (const c of cands) {
      const boneId = nameToId.get(c);
      if (boneId) {
        map[id] = { id: boneId };
        break;
      }
    }
  }
  return map;
}
