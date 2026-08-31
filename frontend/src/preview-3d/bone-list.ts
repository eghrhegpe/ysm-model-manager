// ===== 3D 骨骼列表（从 model3d.ts 拆出，ADR-040 P1 第3轮）=====
// 提供 spec 中骨骼的只读列表接口。
import type { Spec3D, SpecBone3D } from "./model3d.ts";
import { compKey } from "./mesh.ts";

/** getBoneList 返回的扁平骨骼信息 */
export interface BoneInfoLite {
  id: string;
  name: string;
  parentId?: string;
  /** 组件维度显隐键（compKey(mi,id)），与 boneGroupMap 键一致；跨组件同名骨骼靠它精确定位 */
  groupId: string;
}

/**
 * 从 spec 提取骨骼列表，支持按组件索引：
 *  - modelIdx 缺省 0 → 第一组件（main，动画驱动）——向后兼容 v1 单组件语义
 *  - modelIdx >= 0  → 指定组件
 *  - modelIdx < 0   → 全部组件合并（多组件「全部」视图）
 */
export function getBoneList(spec: Spec3D, modelIdx = 0): BoneInfoLite[] {
  const models = spec.models || [];
  const indices =
    modelIdx < 0
      ? models.map((_, i) => i)
      : [Math.min(Math.max(modelIdx, 0), Math.max(models.length - 1, 0))];
  const out: BoneInfoLite[] = [];
  for (const mi of indices) {
    for (const b of models[mi]?.bones || []) {
      const bone = b as SpecBone3D;
      out.push({ id: bone.id, name: bone.name, parentId: bone.parentId, groupId: compKey(mi, bone.id) });
    }
  }
  return out;
}
