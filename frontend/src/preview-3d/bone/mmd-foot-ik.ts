// ===== MMD Foot IK 集成（程序化锚地：待机态下保持双足贴地）=====
// 在 MMD 内置 IK（updateWithMixer）之后运行，作为后处理修正：
// - 无动画播放时，将双足拉回初始锚地高度，防脚底悬空/穿模
// - 有动画时跳过（MMD 内置 IK 已处理）
//
// 依赖：bone-tools.BoneTree + semantic-bones.ts 语义骨骼映射
import * as THREE from "three";
import type { BoneTree } from "./bone-tools.ts";
import { extractIKChainFromTree, type IKChain, solveIK } from "./ik-solver.ts";
import type { SemanticBoneMap } from "./semantic-bones.ts";

/** 足部 IK 控制器 */
export interface FootIKController {
  /** 每帧驱动（待机态下锚定双足） */
  apply(dt: number, isIdle: boolean): void;
  /** 释放资源 */
  dispose(): void;
}

/** 单腿 IK 上下文 */
interface LegIK {
  chain: IKChain;
  anchorY: number; // 初始足部世界 Y 坐标（锚地）
}

/** 创建足部 IK 控制器 */
export function createFootIKController(
  boneTree: BoneTree | null,
  semanticBones: SemanticBoneMap | undefined,
): FootIKController {
  if (!boneTree || !semanticBones) {
    return { apply: () => {}, dispose: () => {} };
  }

  const legs: LegIK[] = [];
  const legRoots: Array<{ rootId: string; footId: string }> = [];

  const leftRoot = getSemanticBoneId(semanticBones, "leftUpperLeg");
  const leftFoot = getSemanticBoneId(semanticBones, "leftFoot");
  const rightRoot = getSemanticBoneId(semanticBones, "rightUpperLeg");
  const rightFoot = getSemanticBoneId(semanticBones, "rightFoot");

  if (leftRoot && leftFoot) legRoots.push({ rootId: leftRoot, footId: leftFoot });
  if (rightRoot && rightFoot) legRoots.push({ rootId: rightRoot, footId: rightFoot });

  for (const { rootId, footId } of legRoots) {
    if (!rootId || !footId) continue;
    // 链根取「大腿的**直接父骨**」（骨盆语义：VRM hips、MMD 下半身/腰），不是大腿自身。
    // solveIK 的关节遍历跳过链根（ik-solver.ts:122 `j >= 1`）⇒ 链根即「保持锚定」的那一节：
    //   [大腿, 膝盖, 踝]      → 只有膝盖参与，腿只能「向锚地靠拢」
    //   [骨盆, 大腿, 膝盖, 踝] → 大腿与膝盖都参与，骨盆保持锚定（ADR-243 §2.8 方案 A）
    // 刻意**不**硬编码语义 id（如 hips）：MMD 的「腰」不保证是「左足」的祖先
    // （不同模型派系里 腰/下半身 的归属不一），取直接父骨才是格式无关的可靠锚点。
    // 父骨缺失（大腿即树根）或悬空 → 回退大腿自身，保持既有行为。
    const parentId = boneTree.byId.get(rootId)?.parentId ?? null;
    const parentEntry = parentId ? boneTree.byId.get(parentId) : undefined;
    const chainRootId = parentId && parentEntry?.object ? parentId : rootId;
    // 父骨缺 object / 提取失败（父骨不在祖先链上）→ 回退大腿自身，宁可 3 节链也不整腿失效
    const chain =
      extractIKChainFromTree(boneTree, chainRootId, footId) ??
      (chainRootId !== rootId ? extractIKChainFromTree(boneTree, rootId, footId) : null);
    if (!chain || chain.length < 2) continue;
    // 记录初始足部世界 Y 坐标
    const foot = chain[chain.length - 1];
    const wp = new THREE.Vector3();
    foot.getWorldPosition(wp);
    legs.push({ chain, anchorY: wp.y });
  }

  if (legs.length === 0) {
    return { apply: () => {}, dispose: () => {} };
  }

  const target = new THREE.Vector3();
  const footPos = new THREE.Vector3();

  return {
    apply(_dt: number, isIdle: boolean): void {
      if (!isIdle) return; // 动画播放中，MMD 内置 IK 处理
      for (const leg of legs) {
        const foot = leg.chain[leg.chain.length - 1];
        foot.getWorldPosition(footPos);
        // 足部高于锚地 → 下拉到锚地高度（防悬空）
        // 足部低于锚地 → 上拉到锚地高度（防穿模）
        if (Math.abs(footPos.y - leg.anchorY) < 0.001) continue;
        target.copy(footPos);
        target.y = leg.anchorY;
        solveIK(leg.chain, target, {
          iterations: 4,
          tolerance: 0.005,
          damping: 0.6,
          minAngle: -Math.PI / 3,
          maxAngle: Math.PI / 3,
        });
      }
    },
    dispose(): void {
      legs.length = 0;
    },
  };
}

/** 从语义骨骼映射中获取骨骼 id */
function getSemanticBoneId(map: SemanticBoneMap, key: string): string | null {
  const entry = map[key as keyof SemanticBoneMap];
  return entry?.id ?? null;
}
