// ===== VMD → VRM 人形骨骼映射表 v1（ADR-243 §2.3）=====
// 职责单一：把 MMD 骨骼名翻译成 VRM humanoid 骨名。靶面是 VRM **全量** humanoid
// 骨骼（`@pixiv/three-vrm-core` 的 VRMHumanBoneList，55 项），刻意**不**走
// semantic-bones.ts 的 23 骨语义层——语义层是「感知层实际需要的子集」（ADR-081 §2.1），
// 让它承担动作重定向会糊掉边界、并牵动感知层整个回归面。本表独立成文件，
// 但沿用同一套「候选顺序即优先级、首个命中胜出」约定（对齐 matchSemanticBone）。
//
// v1 显式丢弃的 MMD 骨骼（VRM 无对应，或需按轴混合易引入扭曲）：
//   - 扭骨：左腕捩/右腕捩（上腕扭转）、左手捩/右手捩（手腕扭转）、左肩捩/右肩捩
//   - IK 骨：左足ＩＫ/右足ＩＫ、左つま先ＩＫ/右つま先ＩＫ（IK 目标，非 FK 骨；
//     其 VMD 关键帧活在 position 通道，当作 FK 旋转源只会得到恒等轨道）
//   - 形变辅助骨：足D/ひざD/足首D/足先EX
//   - 整体根：全ての親、グルーブ（グルーブ 仅作位移兜底，见 VMD_ROOT_TRANSLATION）
//
// 纯数据 + 纯类型：零 DOM / 零 backend / 零 three（ADR-072 工具层纯净；可 node 环境单测）。

import type { VRMHumanBoneName } from "@pixiv/three-vrm-core";

/**
 * 重定向候选名表：VRM humanoid 骨 → MMD 骨候选名（顺序即优先级，首个命中胜出）。
 *
 * 命中条件为**精确等同**（VMD 关键帧里的骨骼名 === 候选名），不做模糊/前缀匹配——
 * VMD 的骨骼名天生就是模型作者的命名，模糊匹配会把 `左肩` 误配到 `左肩P`。
 *
 * 未列出的 VRM 骨见 {@link VMD_RETARGET_UNMAPPED}（显式声明不映射 + 原因），
 * 二者并集必须覆盖 VRMHumanBoneList 全 55 项（由覆盖性测试兜底，防 VRM 侧新增
 * 骨骼时静默漏映射）。
 */
export const VMD_RETARGET_CANDIDATES: Readonly<
  Partial<Record<VRMHumanBoneName, readonly string[]>>
> = {
  // ── 躯干（MMD 上半身 = spine+chest 合并段，v1 整体归 chest，见 UNMAPPED.spine）──
  hips: ["腰", "下半身", "hips", "Hips", "pelvis", "Pelvis"],
  chest: ["上半身", "chest", "Chest", "upper", "Upper"],
  upperChest: ["上半身2", "上半身２", "upperChest", "UpperChest", "upper2", "Upper2"],
  // ── 头颈 ──
  neck: ["首", "首元", "neck", "Neck"],
  head: ["頭", "head", "Head"],
  leftEye: ["左目", "左眼", "left eye", "LeftEye"],
  rightEye: ["右目", "右眼", "right eye", "RightEye"],
  // ── 手臂 ──
  // P/C 是 MMD 的 IK 辅助变体（多数动作里与基准骨同值），作兜底保留；
  // 捩（扭转）属扭骨，按 §2.3 丢弃策略排除。
  leftShoulder: ["左肩", "左肩P", "左肩C", "left shoulder", "LeftShoulder"],
  rightShoulder: ["右肩", "右肩P", "右肩C", "right shoulder", "RightShoulder"],
  leftUpperArm: ["左腕", "left arm", "LeftArm", "leftUpperArm", "LeftUpperArm"],
  rightUpperArm: ["右腕", "right arm", "RightArm", "rightUpperArm", "RightUpperArm"],
  leftLowerArm: ["左ひじ", "左肘", "left elbow", "LeftElbow", "leftLowerArm", "LeftLowerArm"],
  rightLowerArm: ["右ひじ", "右肘", "right elbow", "RightElbow", "rightLowerArm", "RightLowerArm"],
  leftHand: ["左手首", "左リスト", "left wrist", "LeftWrist", "leftHand", "LeftHand"],
  rightHand: ["右手首", "右リスト", "right wrist", "RightWrist", "rightHand", "RightHand"],
  // ── 腿脚 ──
  leftUpperLeg: ["左足", "左太もも", "left thigh", "LeftThigh", "leftUpperLeg", "LeftUpperLeg"],
  rightUpperLeg: [
    "右足",
    "右太もも",
    "right thigh",
    "RightThigh",
    "rightUpperLeg",
    "RightUpperLeg",
  ],
  leftLowerLeg: ["左ひざ", "左膝", "left knee", "LeftKnee", "leftLowerLeg", "LeftLowerLeg"],
  rightLowerLeg: ["右ひざ", "右膝", "right knee", "RightKnee", "rightLowerLeg", "RightLowerLeg"],
  leftFoot: ["左足首", "left ankle", "LeftAnkle", "leftFoot", "LeftFoot"],
  rightFoot: ["右足首", "right ankle", "RightAnkle", "rightFoot", "RightFoot"],
  leftToes: ["左つま先", "左足先", "left toe", "LeftToe", "leftToes", "LeftToes"],
  rightToes: ["右つま先", "右足先", "right toe", "RightToe", "rightToes", "RightToes"],
  // ── 手指（MMD 标准用全角数字；半角变体常见于导出/转换工具）──
  leftThumbMetacarpal: ["左親指０", "左親指0", "LeftThumbMetacarpal"],
  leftThumbProximal: ["左親指１", "左親指1", "LeftThumbProximal"],
  leftThumbDistal: ["左親指２", "左親指2", "LeftThumbDistal"],
  rightThumbMetacarpal: ["右親指０", "右親指0", "RightThumbMetacarpal"],
  rightThumbProximal: ["右親指１", "右親指1", "RightThumbProximal"],
  rightThumbDistal: ["右親指２", "右親指2", "RightThumbDistal"],
  leftIndexProximal: ["左人指１", "左人指1", "LeftIndexProximal"],
  leftIndexIntermediate: ["左人指２", "左人指2", "LeftIndexIntermediate"],
  leftIndexDistal: ["左人指３", "左人指3", "LeftIndexDistal"],
  rightIndexProximal: ["右人指１", "右人指1", "RightIndexProximal"],
  rightIndexIntermediate: ["右人指２", "右人指2", "RightIndexIntermediate"],
  rightIndexDistal: ["右人指３", "右人指3", "RightIndexDistal"],
  leftMiddleProximal: ["左中指１", "左中指1", "LeftMiddleProximal"],
  leftMiddleIntermediate: ["左中指２", "左中指2", "LeftMiddleIntermediate"],
  leftMiddleDistal: ["左中指３", "左中指3", "LeftMiddleDistal"],
  rightMiddleProximal: ["右中指１", "右中指1", "RightMiddleProximal"],
  rightMiddleIntermediate: ["右中指２", "右中指2", "RightMiddleIntermediate"],
  rightMiddleDistal: ["右中指３", "右中指3", "RightMiddleDistal"],
  leftRingProximal: ["左薬指１", "左薬指1", "LeftRingProximal"],
  leftRingIntermediate: ["左薬指２", "左薬指2", "LeftRingIntermediate"],
  leftRingDistal: ["左薬指３", "左薬指3", "LeftRingDistal"],
  rightRingProximal: ["右薬指１", "右薬指1", "RightRingProximal"],
  rightRingIntermediate: ["右薬指２", "右薬指2", "RightRingIntermediate"],
  rightRingDistal: ["右薬指３", "右薬指3", "RightRingDistal"],
  leftLittleProximal: ["左小指１", "左小指1", "LeftLittleProximal"],
  leftLittleIntermediate: ["左小指２", "左小指2", "LeftLittleIntermediate"],
  leftLittleDistal: ["左小指３", "左小指3", "LeftLittleDistal"],
  rightLittleProximal: ["右小指１", "右小指1", "RightLittleProximal"],
  rightLittleIntermediate: ["右小指２", "右小指2", "RightLittleIntermediate"],
  rightLittleDistal: ["右小指３", "右小指3", "RightLittleDistal"],
};

/**
 * v1 显式不映射的 VRM 骨 + 原因（**不是遗漏**：与 {@link VMD_RETARGET_CANDIDATES}
 * 互补，并集须覆盖 VRMHumanBoneList 全 55 项）。值即原因文案，供诊断面板直读。
 */
export const VMD_RETARGET_UNMAPPED: Readonly<Partial<Record<VRMHumanBoneName, string>>> = {
  spine:
    "MMD 上半身 同时覆盖 spine+chest 两段，v1 整体归 chest（ADR-243 §3.3：二期按比例分摊旋转）",
  jaw: "MMD 标准骨架无对应骨（口型走 morph 通道，ADR-243 §2.9 划出本次范围）",
};

/**
 * 全身位移源骨候选（顺序即优先级，首个命中胜出）。
 *
 * 只对 VRM `hips` 生效：`VRMHumanoidRig.update()` 是唯一读取归一化骨 **position** 的
 * 路径，且只对 `hips` 生效（其余骨只读 quaternion）——所以 VMD 里其他骨的 position
 * 通道一律丢弃，不产生无谓轨道。
 *
 * ⚠️ v1 取**首个命中**，不做叠加（ADR-243 §2.4 实施期修订）：`センター` 与 `グルーブ`
 * 同时存在时只取前者。叠加需对两条不同关键帧时间的曲线重采样，v1 不值得，且
 * グルーブ 在主流动作里基本不用。
 */
export const VMD_ROOT_TRANSLATION_CANDIDATES: readonly string[] = [
  "センター",
  "グルーブ",
  "center",
  "Center",
  "root",
];

/** MMD 单位 → 米的默认缩放（MMD 标准模型 ≈ 20 单位高 ≈ 1.6 m；ADR-243 §2.5） */
export const VMD_POSITION_SCALE_DEFAULT = 0.08;

/** 参考身高（米）：缩放基准，非标模型按比例线性外推（ADR-243 §2.5） */
export const VMD_REFERENCE_HEIGHT = 1.6;
