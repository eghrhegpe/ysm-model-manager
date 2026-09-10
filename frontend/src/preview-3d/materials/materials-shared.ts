// ===== 3D 预览材质工具共享骨架（ADR-180：mmd/vrm materials 骨架收编）=====
// mmd-materials.ts 与 vrm-materials.ts 的 list/setVisible/setOpacity 曾逐字重复
// （仅函数名前缀不同），本模块吸收通用骨架；各格式保留薄壳转发 + 领域差异
// （MMD 的 pmx 索引配对/specular、VRM 的 type 推断/needsUpdate）留在各自文件。
//
// 单一事实来源：材质列表 / 显隐 / 透明度联动 / 详情字段提取。

import type * as THREE from "three";

/** 材质列表项（共享骨架：索引 + 名称） */
export interface SharedMaterialListItem {
  index: number;
  name: string;
}

/** 取材质显示名（格式自定：VRM 需回退「材质 #N」） */
export type MaterialNameFn = (mat: THREE.Material, index: number) => string;

/** 材质列表：materials.map 骨架（name 取法参数化） */
export function listMaterials(
  materials: readonly THREE.Material[],
  nameFn?: MaterialNameFn,
): SharedMaterialListItem[] {
  return materials.map((m, i) => ({
    index: i,
    name: nameFn ? nameFn(m, i) : m.name,
  }));
}

/** 材质显隐：Material.visible（通用骨架，越界 no-op） */
export function setMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
  visible: boolean,
): void {
  const mat = materials[index];
  if (mat) mat.visible = visible;
}

/** 材质显隐切换：返回切换后状态（越界返回 false；吸收 mmd 的 toggle 独有函数） */
export function toggleMaterialVisible(
  materials: readonly THREE.Material[],
  index: number,
): boolean {
  const mat = materials[index];
  if (!mat) return false;
  mat.visible = !mat.visible;
  return mat.visible;
}

/** 透明度变更后回调（VRM MToon 需 needsUpdate 重编译着色器；MMD 无此需求传 undefined） */
export type MaterialOpacityChangedFn = (mat: THREE.Material) => void;

/** 材质透明度：clamp 0-1 + transparent 联动（骨架；opacity 恢复 ≥1 须重置 transparent=false，
 *  否则材质仍按透明渲染——多一次 blend pass + 渲染顺序变化）。越界 index no-op。 */
export function setMaterialOpacity(
  materials: readonly THREE.Material[],
  index: number,
  opacity: number,
  onChanged?: MaterialOpacityChangedFn,
): void {
  const mat = materials[index];
  if (!mat) return;
  mat.opacity = Math.max(0, Math.min(1, opacity));
  mat.transparent = mat.opacity < 1;
  onChanged?.(mat);
}

/** 材质详情共享字段（索引越界/材质缺失返回 null） */
export interface SharedMaterialDetail {
  index: number;
  name: string;
  visible: boolean;
  opacity: number;
  transparent: boolean;
}

/**
 * 材质详情骨架提取：读 visible/opacity/transparent + name（nameFallback 缺省
 * 「材质 #N」——VRM 无 pmx 命名层时用；MMD 恒有 pmx 名覆盖之）。
 * 返回 null 表示越界/无材质（格式专属扩展字段由调用方在非 null 分支补充）。
 */
export function getMaterialDetailBase(
  materials: readonly THREE.Material[],
  index: number,
  nameFallback?: (mat: THREE.Material, index: number) => string,
): SharedMaterialDetail | null {
  if (index < 0 || index >= materials.length) return null;
  const mat = materials[index];
  if (!mat) return null;
  return {
    index,
    name: nameFallback ? nameFallback(mat, index) : mat.name,
    visible: mat.visible ?? true,
    opacity: mat.opacity ?? 1,
    transparent: mat.transparent ?? false,
  };
}
