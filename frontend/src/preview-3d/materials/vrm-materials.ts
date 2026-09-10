// ===== VRM 材质工具层（对齐 mmd-materials.ts 适配层模式）=====
// 输入：vrm.scene 内所有 Mesh 的 THREE.Material（MToon 为 THREE.ShaderMaterial 或自定义材质）
// 能力：列表 / 显隐（Material.visible）/ 透明（opacity + transparent 联动）/ 详情。
// 纯逻辑零 DOM——UI 渲染不在本层（对齐 ADR-072）。
//
// 收集方式：vrm.scene.traverse 取出所有 isMesh 的 material；MToon 无 pmx 层索引结构，
// 直接按 scene 遍历顺序排列，与 mmd-materials.ts 的 list/getDetail/setVisible/setOpacity
// 一一对齐。
//
// [ADR-180] 骨架收编 materials-shared.ts：list/setVisible/setOpacity/detail 字段提取
// 全走共享骨架（VRM 输入即 THREE.Material[]，与共享层签名吻合）；本文件保留领域差异：
//   - name 回退「材质 #N」（MToon 无命名层）
//   - type 推断（mtoon/standard/basic/phong/unknown）
//   - opacity 变更后 needsUpdate=true（MToon ShaderMaterial 重编译，onChanged 注入）
// 消费方 import 路径与导出名不变。

import type * as THREE from "three";
import {
  getMaterialDetailBase,
  listMaterials,
  setMaterialOpacity,
  setMaterialVisible,
} from "./materials-shared.ts";

/** 材质列表项（listVrmMaterials） */
export interface VrmMaterialListItem {
  index: number;
  name: string;
}

/** 材质详情（getVrmMaterialDetail） */
export interface VrmMaterialDetail {
  index: number;
  name: string;
  visible: boolean;
  opacity: number;
  transparent: boolean;
  /** 材质类型：'mtoon' | 'standard' | 'basic' | 'phong' | 'unknown' */
  type: "mtoon" | "standard" | "basic" | "phong" | "unknown";
}

/** VRM 材质显示名：有 name 用之，无则回退「材质 #N」（共享 list 的 nameFn 参数） */
const vrmName = (m: THREE.Material, i: number): string => m.name || `材质 #${i + 1}`;

/** 推断材质类型：MToon 是自定义 ShaderMaterial，名称常含 MToon */
function inferVrmType(mat: THREE.Material): VrmMaterialDetail["type"] {
  const typeName = mat.type.toLowerCase();
  const name = mat.name?.toLowerCase() || "";
  if (name.includes("mtoon")) return "mtoon";
  if (typeName.includes("standard")) return "standard";
  if (typeName.includes("basic")) return "basic";
  if (typeName.includes("phong")) return "phong";
  return "unknown";
}

/** 材质列表：vrm.scene 遍历所有 Mesh.material（含数组材质）*/
export function listVrmMaterials(materials: readonly THREE.Material[]): VrmMaterialListItem[] {
  return listMaterials(materials, vrmName);
}

/** 材质显隐：Material.visible（MToon/标准/基础均支持）*/
export function setVrmMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
  visible: boolean,
): void {
  setMaterialVisible(materials, index, visible);
}

/** 材质透明度（0-1）：opacity 设置 + transparent 联动；
 *  MToon（ShaderMaterial 子类）透明变更需 needsUpdate 重编译着色器（onChanged 注入） */
export function setVrmMaterialOpacity(
  materials: readonly THREE.Material[],
  index: number,
  opacity: number,
): void {
  setMaterialOpacity(materials, index, opacity, (mat) => {
    mat.needsUpdate = true;
  });
}

/** 材质详情：name/可见/透明/类型（越界返回 null）*/
export function getVrmMaterialDetail(
  materials: readonly THREE.Material[],
  index: number,
): VrmMaterialDetail | null {
  const base = getMaterialDetailBase(materials, index, vrmName);
  if (!base) return null;
  const mat = materials[index];
  // mat 非空已由 base 保证（getMaterialDetailBase 越界/缺失返回 null）
  return {
    ...base,
    type: inferVrmType(mat as THREE.Material),
  };
}
