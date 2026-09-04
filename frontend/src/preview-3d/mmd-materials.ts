// ===== MMD 材质工具层（对齐 mmd-bones.ts 适配层模式，先不接 UI）=====
// 输入：pmx.materials（@moeru/three-mmd：name/diffuse/specular/shininess/flag）
//      + mesh.material（THREE.Material[]，与 pmx.materials 索引一一对齐——buildMaterial
//        经 materials.map((pmx, index) => new MMDToonMaterial(...)) 构建）。
// 能力：列表 / 显隐（Material.visible）/ 透明（opacity + transparent 联动）/ 详情。
// 纯逻辑零 DOM——UI 渲染不在本层（对齐 ADR-072）。
//
// [ADR-180] 骨架收编 materials-shared.ts：setVisible/setOpacity/getDetail 字段提取
// 骨架与 VRM 共用；list 保留本文件原逻辑——MMD 的 list 输入是 pmx 元数据
// （{name}[]，非 THREE.Material[]），与 VRM 的 list 输入源本就不同，无共享价值。
// 消费方 import 路径与导出名不变。

import * as THREE from "three";
import {
  getMaterialDetailBase,
  setMaterialOpacity,
  setMaterialVisible,
  toggleMaterialVisible,
} from "./materials-shared.ts";

/** 材质列表项（listMmdMaterials） */
export interface MmdMaterialListItem {
  index: number;
  name: string;
}

/** 材质详情（getMmdMaterialDetail） */
export interface MmdMaterialDetail {
  index: number;
  name: string;
  visible: boolean;
  opacity: number;
  transparent: boolean;
  /** MeshPhongMaterial 子类（MMDToonMaterial）有 specular/shininess；其他材质为 null */
  specular: THREE.Color | null;
  shininess: number | null;
}

/** 材质列表：pmx.materials name + 索引（索引与 mesh.material 对齐） */
export function listMmdMaterials(pmxMaterials: readonly { name: string }[]): MmdMaterialListItem[] {
  return pmxMaterials.map((m, i) => ({ index: i, name: m.name }));
}

/** 材质显隐：Material.visible（MMDToonMaterial 继承 MeshPhongMaterial） */
export function setMmdMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
  visible: boolean,
): void {
  setMaterialVisible(materials, index, visible);
}

/** 材质显隐切换：返回切换后的可见状态（越界返回 false） */
export function toggleMmdMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
): boolean {
  return toggleMaterialVisible(materials, index);
}

/** 材质透明度（0-1）：opacity 设置 + transparent 联动（opacity < 1 → transparent = true）。
 *  MMD 无 needsUpdate 需求（MMDToonMaterial 非 ShaderMaterial 重编译场景），不传 onChanged。 */
export function setMmdMaterialOpacity(
  materials: readonly THREE.Material[],
  index: number,
  opacity: number,
): void {
  setMaterialOpacity(materials, index, opacity);
}

/** 材质详情：name/可见/透明/高光/光泽（越界返回 null） */
export function getMmdMaterialDetail(
  pmxMaterials: readonly { name: string }[],
  materials: readonly THREE.Material[],
  index: number,
): MmdMaterialDetail | null {
  const base = getMaterialDetailBase(materials, index, (_m, i) => {
    const pmx = pmxMaterials[i];
    return pmx ? pmx.name : "";
  });
  if (!base) return null;
  const mat = materials[index];
  const specular =
    mat && "specular" in mat && (mat as { specular?: unknown }).specular instanceof THREE.Color
      ? (mat as { specular: THREE.Color }).specular
      : null;
  const shininess =
    mat && "shininess" in mat && typeof (mat as { shininess?: unknown }).shininess === "number"
      ? (mat as { shininess: number }).shininess
      : null;
  return {
    ...base,
    specular,
    shininess,
  };
}
