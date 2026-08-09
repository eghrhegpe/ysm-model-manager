/**
 * mesh.ts — 3D 场景网格构建与材质释放（从 model3d.ts 拆出，无渲染器状态依赖）。
 *
 * 拆分动机（model3d.ts 函数边界评估）：buildSceneMesh / disposeMaterial 是顶层
 * 纯函数（只吃 spec 参数 / 只释放传入材质），不依赖 renderModel3D 闭包状态
 * （_renderer3d/_scene3d/_camera3d），可安全迁移；screenshotPreview 依赖模块级
 * 渲染器状态故留在 model3d.ts。
 */
import * as THREE from "three";
import { type Spec3D } from "./model3d.ts"; // 仅类型 import（编译后擦除，无运行时循环依赖）

/** 组件内骨骼 key（mi: 组件下标, id: 骨骼 id）。renderModel3D 与 buildSceneMesh 共用，随 mesh 迁移。 */
export function compKey(mi: number, id: string) {
  return mi + ":" + id;
}

/** 带贴图的材质（disposeMaterial 需释放 .map 位图） */
export interface MaterialWithMap {
  map?: THREE.Texture | null;
}

/** 释放材质（含位图 .map），null/undefined 安全。 */
export function disposeMaterial(m: THREE.Material | null | undefined): void {
  if (!m) return;
  const withMap = m as THREE.Material & Partial<MaterialWithMap>;
  if (withMap.map) withMap.map.dispose();
  m.dispose();
}

/** 构建 3D 场景网格（组件分组 + 骨骼树），返回供渲染/交互使用的组结构。 */
export function buildSceneMesh(spec: Spec3D): {
  boneGroupMap: Map<string, THREE.Group>;
  rootGroup: THREE.Group;
  modelScale: number;
  modelGroups: THREE.Group[];
} {
  // 显示尺寸：固定 1/16（基岩标准：16 像素 = 1 米），严格对齐 YSMViewer ExportScale。
  // 历史：曾动态 scale（>32→1/16、>4→1/4、else→1）把小模型放大，渲染对齐裁决后移除。
  const modelScale = 1 / 16;
  const rootGroup = new THREE.Group();
  rootGroup.scale.set(modelScale, modelScale, modelScale);
  // 组件级 modelGroup（YSMViewer 式多组件同屏）：每个 spec.model 一个组，
  // bone 树挂各自 modelGroup，可见性由 defaultVisible 控制（arm 等组件独立渲染）。
  const modelGroups = (spec.models || []).map((mg) => {
    const g = new THREE.Group();
    g.name = mg.id || "comp";
    g.visible = mg.defaultVisible !== false;
    return g;
  });
  for (const g of modelGroups) rootGroup.add(g);
  const boneGroupMap = new Map<string, THREE.Group>();
  for (const [mi, mg] of (spec.models || []).entries())
    for (const bd of mg.bones || []) {
      const g = new THREE.Group();
      g.name = bd.name;
      const pos = bd.localPosition || [0, 0, 0];
      g.position.set(
        pos[0] ?? 0,
        pos[1] ?? 0,
        pos[2] ?? 0,
      );
      const rot = bd.localRotation;
      if (
        rot?.[3] !== 1 ||
        rot?.[0] !== 0 ||
        rot?.[1] !== 0 ||
        rot?.[2] !== 0
      )
        g.quaternion.set(
          rot?.[0] ?? 0,
          rot?.[1] ?? 0,
          rot?.[2] ?? 0,
          rot?.[3] ?? 1,
        );
      boneGroupMap.set(compKey(mi, bd.id), g);
      // 全局 key：main 组件优先（先到先得），供 hover/UI/动画（v1 单组件语义）
      if (!boneGroupMap.has(bd.id)) boneGroupMap.set(bd.id, g);
    }
  for (const [mi, mg] of (spec.models || []).entries())
    for (const bd of mg.bones || []) {
      const g = boneGroupMap.get(compKey(mi, bd.id));
      if (!g) continue;
      if (bd.parentId && boneGroupMap.has(compKey(mi, bd.parentId)))
        boneGroupMap.get(compKey(mi, bd.parentId))!.add(g);
      else modelGroups[mi].add(g);
    }
  return { boneGroupMap, rootGroup, modelScale, modelGroups };
}
