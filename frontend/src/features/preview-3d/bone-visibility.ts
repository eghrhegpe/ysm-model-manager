// ===== 3D 骨骼/组件可见性控制（从 model3d.ts 拆出，ADR-040 P1 第3轮）=====
// 提供骨骼和模型组件的可见性操作接口。
import * as THREE from "three";

/** BoneGroupMap 类型别名：骨骼 id → THREE.Group */
export type BoneGroupMap = Map<string, THREE.Group>;

/**
 * 设置指定骨骼组及其所有子网格的可见性。
 */
export function setBoneVisible(boneGroupMap: BoneGroupMap, name: string, visible: boolean): void {
  const g = boneGroupMap.get(name);
  if (g) g.traverse((c) => { (c as THREE.Object3D).visible = visible; });
}

/**
 * 切换指定骨骼组的可见性（取反）。
 */
export function toggleBone(boneGroupMap: BoneGroupMap, name: string): void {
  const g = boneGroupMap.get(name);
  if (g) g.traverse((c) => { (c as THREE.Object3D).visible = !c.visible; });
}

/**
 * 按索引显示单个模型组件（idx < 0 = 全部显示，NaN 防御）。
 * @param modelGroups 由 buildSceneMesh 返回的模型组件数组
 * @param idx 组件索引，-1 表示全部显示
 */
export function showModelGroup(modelGroups: THREE.Group[], idx: number): void {
  // NaN 防御：parseInt 空值/异常输入按全部显示处理
  if (Number.isNaN(idx)) idx = -1;
  modelGroups.forEach((g, i) => { g.visible = i === idx || idx < 0; });
}
