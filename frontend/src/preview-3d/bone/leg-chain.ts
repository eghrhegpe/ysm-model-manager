// ===== 腿链提取（格式无关：VRM hips 与 MMD 下半身/腰 同构）=====
// 抽成独立模块的理由：`mmd-foot-ik.ts`（待机锚地）与 `vrm-foot-ik.ts`（VMD 足ＩＫ 驱动）
// 需要**完全同构**的腿链。两处各存一份，会让「链根取谁」这条 ADR-243 §2.8 的关键约定
// 分叉——一处改了另一处没改，症状是「某个格式的腿只动膝盖」且不报错。
//
// 纯逻辑（THREE + bone-tools + ik-solver），零 DOM / 零 backend：可 node 环境单测。

import type * as THREE from "three";
import type { BoneTree } from "./bone-tools.ts";
import { extractIKChainFromTree, type IKChain } from "./ik-solver.ts";
import type { SemanticBoneMap } from "./semantic-bones.ts";

/** 单腿 IK 链（含链根与末端） */
export interface LegChain {
  side: "left" | "right";
  /** 从链根到踝的有序对象数组（链根 = 大腿的**直接父骨**，见 extractLegChains 注释） */
  chain: IKChain;
  /** 链末端（踝）；与 `chain[chain.length - 1]` 同一引用 */
  endEffector: THREE.Object3D;
  /** 链末端（踝）在树中的 id（`chain[chain.length - 1]` 的树节点键；脚尖链等后继提取用） */
  endEffectorId: string;
}

/** 语义骨 id 查表（缺项返回 null） */
function semanticId(map: SemanticBoneMap, key: string): string | null {
  const entry = map[key as keyof SemanticBoneMap];
  return entry?.id ?? null;
}

const LEG_DEFS = [
  { side: "left", upperLeg: "leftUpperLeg", foot: "leftFoot" },
  { side: "right", upperLeg: "rightUpperLeg", foot: "rightFoot" },
] as const;

/**
 * 提取双侧腿链（顺序恒为 left → right；缺骨/链不可提取的腿直接缺席，不占位）。
 *
 * **链根取「大腿的直接父骨」**（骨盆语义：VRM = `hips`，MMD = `下半身`/`腰`），不是大腿自身：
 * `solveIK` 的关节遍历跳过链根（`ik-solver.ts:124` `j >= 1`）⇒ 链根即「保持锚定」的那一节：
 *   `[大腿, 膝盖, 踝]`       → 只有膝盖参与，腿只能「向目标靠拢」
 *   `[骨盆, 大腿, 膝盖, 踝]` → 大腿与膝盖都参与，骨盆保持锚定（ADR-243 §2.8 方案 A）
 *
 * 刻意**不**硬编码语义 id（如 `hips`）：MMD 的「腰」不保证是「左足」的祖先
 * （不同模型派系里 腰/下半身 归属不一），硬编码会让 `extractIKChainFromTree` 直接返回
 * null ⇒ 整腿静默失效；取直接父骨才是格式无关的可靠锚点。
 * 父骨缺失（大腿即树根）或悬空 → 回退大腿自身，保持 3 节链的既有行为。
 */
export function extractLegChains(
  boneTree: BoneTree | null,
  semanticBones: SemanticBoneMap | undefined,
): LegChain[] {
  if (!boneTree || !semanticBones) return [];

  const legs: LegChain[] = [];
  for (const def of LEG_DEFS) {
    const upperLegId = semanticId(semanticBones, def.upperLeg);
    const footId = semanticId(semanticBones, def.foot);
    if (!upperLegId || !footId) continue;

    const parentId = boneTree.byId.get(upperLegId)?.parentId ?? null;
    const parentEntry = parentId ? boneTree.byId.get(parentId) : undefined;
    const chainRootId = parentId && parentEntry?.object ? parentId : upperLegId;
    // 父骨缺 object / 提取失败（父骨不在祖先链上）→ 回退大腿自身，宁可 3 节链也不整腿失效
    const chain =
      extractIKChainFromTree(boneTree, chainRootId, footId) ??
      (chainRootId !== upperLegId ? extractIKChainFromTree(boneTree, upperLegId, footId) : null);
    if (!chain || chain.length < 2) continue;

    legs.push({
      side: def.side,
      chain,
      endEffector: chain[chain.length - 1],
      endEffectorId: footId,
    });
  }
  return legs;
}
