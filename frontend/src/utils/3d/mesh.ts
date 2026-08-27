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
import { applyRotationIfNonIdentity } from "./quaternion.ts";
import { safeDispose } from "./safe-dispose.ts";

/** 模型显示缩放（基岩标准 16px = 1m，严格对齐 YSMViewer ExportScale，索引 2.14 收敛） */
const MODEL_SCALE = 1 / 16;

/** 组件内骨骼 key（mi: 组件下标, id: 骨骼 id）。renderModel3D 与 buildSceneMesh 共用，随 mesh 迁移。 */
export function compKey(mi: number, id: string) {
  return mi + ":" + id;
}

/** 材质上所有可能持有贴图的属性 key（对应 THREE.Material 纹理字段 + ShaderMaterial uniforms） */
const ALL_TEXTURE_KEYS = [
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

/** 构建 3D 场景网格（组件分组 + 骨骼树），返回供渲染/交互使用的组结构。 */
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
      applyRotationIfNonIdentity(g, bd.localRotation);
      boneGroupMap.set(compKey(mi, bd.id), g);
      // 全局 key：main 组件优先（先到先得），供 hover/UI/动画（v1 单组件语义）
      if (!boneGroupMap.has(bd.id)) boneGroupMap.set(bd.id, g);
    }
  for (const [mi, mg] of (spec.models || []).entries())
    for (const bd of mg.bones || []) {
      const g = boneGroupMap.get(compKey(mi, bd.id));
      if (!g) continue;
      // P1 修复（审核，父链环崩溃）：self 父/环边在 Three.js 中构成场景图环——
      // updateMatrixWorld 首次遍历即无限递归 RangeError（Three.js 只拦截 object===this
      // 的 self 环，不拦截 A↔B 互指）。Go spec.go 的 ParentID 直透不校验环，此处兜底：
      // self 边拒绝；A↔B 互指通过「已挂父的节点不再重复挂」的 visited 语义跳过环边。
      if (bd.parentId && bd.parentId !== bd.id && boneGroupMap.has(compKey(mi, bd.parentId))) {
        const parent = boneGroupMap.get(compKey(mi, bd.parentId))!;
        // 若 parent 已是 g 的后代（环），跳过此边（g 保持挂在 modelGroups 或更早父上）
        let cursor: THREE.Object3D | null = parent;
        let isCycle = false;
        while (cursor) {
          if (cursor === g) {
            isCycle = true;
            break;
          }
          cursor = cursor.parent;
        }
        if (isCycle) {
          console.warn(`[mesh] 跳过骨骼父链环: ${bd.id} ↔ ${bd.parentId}`);
        } else {
          parent.add(g);
        }
      } else {
        modelGroups[mi].add(g);
      }
    }
  return { boneGroupMap, rootGroup, modelScale, modelGroups };
}
