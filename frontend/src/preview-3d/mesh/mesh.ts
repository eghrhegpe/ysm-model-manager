/**
 * mesh.ts — 3D 场景网格构建与材质释放（从 model3d.ts 拆出，无渲染器状态依赖）。
 *
 * 拆分动机（model3d.ts 函数边界评估）：buildSceneMesh / disposeMaterial 是顶层
 * 纯函数（只吃 spec 参数 / 只释放传入材质），不依赖 renderModel3D 闭包状态
 * （_renderer3d/_scene3d/_camera3d），可安全迁移；screenshotPreview 依赖模块级
 * 渲染器状态故留在 model3d.ts。
 */
import * as THREE from "three";
import { safeDispose } from "@/preview-3d/infra/safe-dispose.ts";
import type { Spec3D, SpecBone3D } from "./model3d.ts"; // 仅类型 import（编译后擦除，无运行时循环依赖）
import { applyRotationIfNonIdentity } from "./quaternion.ts";

/** 模型显示缩放（基岩标准 16px = 1m，严格对齐 YSMViewer ExportScale，索引 2.14 收敛） */
const MODEL_SCALE = 1 / 16;

/** 组件内骨骼 key（mi: 组件下标, id: 骨骼 id）。renderModel3D 与 buildSceneMesh 共用，随 mesh 迁移。 */
export function compKey(mi: number, id: string) {
  return `${mi}:${id}`;
}

/** 材质上所有可能持有贴图的属性 key（对应 THREE.Material 纹理字段 + ShaderMaterial uniforms）
 *  导出供 scene-stats 复用：释放与统计共用同一纹理口径（单一事实源，防双源漂移）。 */
export const ALL_TEXTURE_KEYS = [
  "map",
  "emissiveMap",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "lightMap",
  "alphaMap",
  "envMap",
] as const;

/** 释放材质（含所有位图贴图），null/undefined 安全。 */
export function disposeMaterial(
  m: THREE.Material | null | undefined,
  disposeTextures = true,
): void {
  if (!m) return;
  // 显式释放纹理：material.dispose() 不保证清除 mat.map 等引用（实测验证）
  if (disposeTextures) {
    for (const key of ALL_TEXTURE_KEYS) {
      const tex = (m as unknown as Record<string, unknown | THREE.Texture | null>)[key];
      if (tex && typeof (tex as THREE.Texture).dispose === "function") {
        safeDispose(tex as THREE.Texture);
      }
    }
  }
  safeDispose(m);
}

/** 组件 spec 元素（SpecModelGroup3D 未导出，经索引取型以免第二套 spec 类型名——ADR-161 §2.1） */
type SpecModelGroup = NonNullable<Spec3D["models"]>[number];

/** 构建 3D 场景网格（组件分组 + 骨骼树），返回供渲染/交互使用的组结构。
 *  两遍构建各自具名：第一遍建组登记（createBoneGroups），第二遍挂父子（attachBonesToParents）
 *  ——「先全建后连边」是环边兜底的前提（父组必须已存在才谈得上环检测）。 */
export function buildSceneMesh(spec: Spec3D): {
  boneGroupMap: Map<string, THREE.Group>;
  rootGroup: THREE.Group;
  modelScale: number;
  modelGroups: THREE.Group[];
} {
  // 显示尺寸：固定 1/16（基岩标准：16 像素 = 1 米），严格对齐 YSMViewer ExportScale。
  // 历史：曾动态 scale（>32→1/16、>4→1/4、else→1）把小模型放大，渲染对齐裁决后移除。
  const modelScale = MODEL_SCALE;
  const rootGroup = new THREE.Group();
  rootGroup.scale.set(modelScale, modelScale, modelScale);
  // 组件级 modelGroup（YSMViewer 式多组件同屏）：每个 spec.model 一个组，
  // bone 树挂各自 modelGroup，可见性由 defaultVisible 控制（arm 等组件独立渲染）。
  const modelGroups = (spec.models || []).map(makeComponentGroup);
  for (const g of modelGroups) rootGroup.add(g);
  const boneGroupMap = createBoneGroups(spec);
  attachBonesToParents(spec, modelGroups, boneGroupMap);
  return { boneGroupMap, rootGroup, modelScale, modelGroups };
}

/** 组件级 Group（name 缺省 "comp"；可见性 = defaultVisible !== false，缺省可见）。 */
function makeComponentGroup(mg: SpecModelGroup): THREE.Group {
  const g = new THREE.Group();
  g.name = mg.id || "comp";
  g.visible = mg.defaultVisible !== false;
  return g;
}

/** 第一遍：为每个 (组件下标, 骨骼) 建 Group，登记组件 key 与全局 key（后者先到先得）。 */
function createBoneGroups(spec: Spec3D): Map<string, THREE.Group> {
  const boneGroupMap = new Map<string, THREE.Group>();
  for (const [mi, mg] of (spec.models || []).entries()) {
    for (const bd of mg.bones || []) createBoneGroup(boneGroupMap, mi, bd);
  }
  return boneGroupMap;
}

/** 单个骨骼的 Group：名字/局部位置/非单位旋转 + 双 key 登记
 *  （组件 key 恒写；全局 key 先到先得，供 hover/UI/动画的 v1 单组件语义）。 */
function createBoneGroup(boneGroupMap: Map<string, THREE.Group>, mi: number, bd: SpecBone3D): void {
  const g = new THREE.Group();
  g.name = bd.name;
  const pos = bd.localPosition || [0, 0, 0];
  g.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
  applyRotationIfNonIdentity(g, bd.localRotation);
  boneGroupMap.set(compKey(mi, bd.id), g);
  if (!boneGroupMap.has(bd.id)) boneGroupMap.set(bd.id, g);
}

/** 第二遍：把每个骨骼组按 parentId 挂到父组，无父（或父不在此组件内）挂组件组。 */
function attachBonesToParents(
  spec: Spec3D,
  modelGroups: THREE.Group[],
  boneGroupMap: Map<string, THREE.Group>,
): void {
  for (const [mi, mg] of (spec.models || []).entries()) {
    for (const bd of mg.bones || []) {
      const g = boneGroupMap.get(compKey(mi, bd.id));
      if (!g) continue;
      attachBoneToParent(bd, g, mi, modelGroups, boneGroupMap);
    }
  }
}

/** 单个骨骼的挂载决策：无父/自环/父不在此组件 → 挂组件组；成环 → 跳过该边并告警；
 *  否则挂父。环检测必要性见下方注释（Three.js 只拦 object===this 的 self 环）。 */
function attachBoneToParent(
  bd: SpecBone3D,
  g: THREE.Group,
  mi: number,
  modelGroups: THREE.Group[],
  boneGroupMap: Map<string, THREE.Group>,
): void {
  const parentId = bd.parentId;
  // self 父/环边在 Three.js 中构成场景图环——
  // updateMatrixWorld 首次遍历即无限递归 RangeError（Three.js 只拦截 object===this
  // 的 self 环，不拦截 A↔B 互指）。Go spec.go 的 ParentID 直透不校验环，此处兜底：
  // self 边拒绝；A↔B 互指通过「已挂父的节点不再重复挂」的 visited 语义跳过环边。
  if (!parentId || parentId === bd.id || !boneGroupMap.has(compKey(mi, parentId))) {
    modelGroups[mi].add(g);
    return;
  }
  // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
  const parent = boneGroupMap.get(compKey(mi, parentId))!;
  // 若 parent 已是 g 的后代（环），跳过此边并告警。
  // ⚠️ 实测（2026-10-07）：此处 return 时 g **尚未被挂到任何父**（挂 modelGroups 只发生在上面
  // 那条分支），故环上的骨连同其子树会整体脱离场景图（A(parent=B)/B(parent=A) 时：先 B.add(A)、
  // 再处理 B 命中环 → B 悬空且 A 在 B 内 → 两者皆不可见）。原注释写「g 保持挂在 modelGroups
  // 或更早父上」，描述的是**意图而非现状**——特此更正，避免后人据此误判降级行为。
  // 是否改为「先 modelGroups[mi].add(g) 再告警」（把环骨降级挂到组件根、保住子树可见），
  // 属「畸形模型降级策略」的产品口径决策，未擅自改（仅影响 ParentID 成对互指的畸形 spec）。
  if (ancestorChainContains(parent, g)) {
    console.warn(`[mesh] 跳过骨骼父链环: ${bd.id} ↔ ${bd.parentId}`);
    return;
  }
  parent.add(g);
}

/** `start` 自身或其任一祖先 === `node` → 把 start 挂到 node 下会构成场景图环。 */
function ancestorChainContains(start: THREE.Object3D, node: THREE.Object3D): boolean {
  let cursor: THREE.Object3D | null = start;
  while (cursor) {
    if (cursor === node) return true;
    cursor = cursor.parent;
  }
  return false;
}
