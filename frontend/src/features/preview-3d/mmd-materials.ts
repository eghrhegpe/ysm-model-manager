// ===== MMD 材质工具层（对齐 mmd-bones.ts 适配层模式，先不接 UI）=====
// 输入：pmx.materials（@moeru/three-mmd：name/diffuse/specular/shininess/flag）
//      + mesh.material（THREE.Material[]，与 pmx.materials 索引一一对齐——buildMaterial
//        经 materials.map((pmx, index) => new MMDToonMaterial(...)) 构建）。
// 能力：列表 / 显隐（Material.visible）/ 透明（opacity + transparent 联动）/ 详情。
// 纯逻辑零 DOM——UI 渲染不在本层（对齐 ADR-072）。
// 协调边界：bone-tools.ts 是骨骼通用层（BoneNode 抽象跨格式）；材质各格式结构差异大
// （YSM textures / VRM MToon / MMD pmx.materials），不做通用层，MMD 材质独立工具层。

import * as THREE from "three";

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
export function listMmdMaterials(
  pmxMaterials: readonly { name: string }[],
): MmdMaterialListItem[] {
  return pmxMaterials.map((m, i) => ({ index: i, name: m.name }));
}

/** 材质显隐：Material.visible（MMDToonMaterial 继承 MeshPhongMaterial） */
export function setMmdMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
  visible: boolean,
): void {
  const mat = materials[index];
  if (mat) mat.visible = visible;
}

/** 材质显隐切换：返回切换后的可见状态（越界返回 false） */
export function toggleMmdMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
): boolean {
  const mat = materials[index];
  if (!mat) return false;
  mat.visible = !mat.visible;
  return mat.visible;
}

/** 材质透明度（0-1）：opacity 设置 + transparent 联动（opacity < 1 → transparent = true） */
export function setMmdMaterialOpacity(
  materials: readonly THREE.Material[],
  index: number,
  opacity: number,
): void {
  const mat = materials[index];
  if (!mat) return;
  mat.opacity = Math.max(0, Math.min(1, opacity));
  if (mat.opacity < 1) mat.transparent = true;
}

/** 材质详情：name/可见/透明/高光/光泽（越界返回 null） */
export function getMmdMaterialDetail(
  pmxMaterials: readonly { name: string }[],
  materials: readonly THREE.Material[],
  index: number,
): MmdMaterialDetail | null {
  if (index < 0 || index >= pmxMaterials.length) return null;
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
    index,
    name: pmxMaterials[index].name,
    visible: mat?.visible ?? true,
    opacity: mat?.opacity ?? 1,
    transparent: mat?.transparent ?? false,
    specular,
    shininess,
  };
}
