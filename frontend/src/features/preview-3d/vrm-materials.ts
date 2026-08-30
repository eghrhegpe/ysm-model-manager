// ===== VRM 材质工具层（对齐 mmd-materials.ts 适配层模式）=====
// 输入：vrm.scene 内所有 Mesh 的 THREE.Material（MToon 为 THREE.ShaderMaterial 或自定义材质）
// 能力：列表 / 显隐（Material.visible）/ 透明（opacity + transparent 联动）/ 详情。
// 纯逻辑零 DOM——UI 渲染不在本层（对齐 ADR-072）。
//
// 收集方式：vrm.scene.traverse 取出所有 isMesh 的 material；MToon 无 pmx 层索引结构，
// 直接按 scene 遍历顺序排列，与 vrm-materials.ts 的 list/getDetail/setVisible/setOpacity 一一对齐。
import * as THREE from "three";

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

/** 材质列表：vrm.scene 遍历所有 Mesh.material（含数组材质）*/
export function listVrmMaterials(
  materials: readonly THREE.Material[],
): VrmMaterialListItem[] {
  return materials.map((m, i) => ({
    index: i,
    name: m.name || `材质 #${i + 1}`,
  }));
}

/** 材质显隐：Material.visible（MToon/标准/基础均支持）*/
export function setVrmMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
  visible: boolean,
): void {
  const mat = materials[index];
  if (mat) mat.visible = visible;
}

/** 材质透明度（0-1）：opacity 设置 + transparent 联动 */
export function setVrmMaterialOpacity(
  materials: readonly THREE.Material[],
  index: number,
  opacity: number,
): void {
  const mat = materials[index];
  if (!mat) return;
  mat.opacity = Math.max(0, Math.min(1, opacity));
  if (mat.opacity < 1) mat.transparent = true;
  // MToon（ShaderMaterial 子类）透明变更需重编译着色器
  (mat as THREE.ShaderMaterial | THREE.Material).needsUpdate = true;
}

/** 材质详情：name/可见/透明/类型（越界返回 null）*/
export function getVrmMaterialDetail(
  materials: readonly THREE.Material[],
  index: number,
): VrmMaterialDetail | null {
  if (index < 0 || index >= materials.length) return null;
  const mat = materials[index];
  if (!mat) return null;
  // 推断材质类型：MToon 是自定义 ShaderMaterial，名称常含 MToon
  const typeName = mat.type.toLowerCase();
  const name = mat.name?.toLowerCase() || "";
  const type: VrmMaterialDetail["type"] =
    name.includes("mtoon") ? "mtoon"
    : typeName.includes("standard") ? "standard"
    : typeName.includes("basic") ? "basic"
    : typeName.includes("phong") ? "phong"
    : "unknown";
  return {
    index,
    name: mat.name || `材质 #${index + 1}`,
    visible: mat.visible ?? true,
    opacity: mat.opacity ?? 1,
    transparent: mat.transparent ?? false,
    type,
  };
}