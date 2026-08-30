// ===== ysm-object.ts — YSM 3D 场景图构建（可挂任意 THREE.Scene）=====
// ADR-066 §5.7 shared 化第一步：从 renderModel3D 抽出「内容层」——
// spec → Object3D 场景图（boneGroupMap/rootGroup/modelGroups），不依赖
// renderer/scene 实例，供统一核心（mount-preview-core shared 模式）挂载；
// renderModel3D 内部复用同一函数（自建外壳路径零回归）。
//
// 与 renderModel3D 原内联逻辑的差异：
//   - 不修改入参 spec（原实现原地改 spec.models[].meshGroups 合并网格，
//     多实例共享 spec 会互相污染；此处合并到本地结构）
//   - 不建 renderer/scene/camera/controls，不跑 rAF，不做输入/射线/调试接线
//     （这些属外壳层，由调用方决定：renderModel3D 自建壳 / 统一核心 shared 模式）

import * as THREE from "three";
import { buildSceneMesh, compKey } from "./mesh.ts";
import { addMeshToBoneGroup } from "./mesh-builder.ts";
import { bakeMeshFragments } from "./mesh-baker.ts";
import { getTextureAlphaMode } from "./texture-alpha.ts";
import { splitMeshByFaceAlpha, type MeshFragment } from "./face-split.ts";
import { disposeSceneMeshes } from "./cleanup-helper.ts";
import { getBoneList } from "./bone-list.ts";
import { setBoneVisible, toggleBone, showModelGroup } from "./bone-visibility.ts";
import type { Spec3D } from "./model3d.ts";

/** YSM 内容场景句柄：挂进任意 scene 后的内容层操作与释放 */
export interface YsmObjectHandle {
  rootGroup: THREE.Group;
  /** boneId 分组（含模型组维度 compKey），供骨骼拾取/显隐 */
  boneGroupMap: Map<string, THREE.Group>;
  /** 模型组（多组件模型切换） */
  modelGroups: THREE.Group[];
  showModelGroup(idx: number): void;
  getModelGroupCount(): number;
  setBoneVisible(name: string, visible: boolean): void;
  toggleBone(name: string): void;
  getBoneList(modelIdx?: number): Array<{ id: string; name: string; parentId?: string | null }>;
  /** 从所在 scene 移除 rootGroup 并释放其几何/材质资源（不含 scene/camera/controls） */
  removeFromScene(scene: THREE.Scene): void;
}

/**
 * 构建 YSM 内容场景图：spec → rootGroup（骨骼分组 + 网格挂载 + 纹理绑定）。
 * 纯 three 场景图构建，无渲染壳依赖。
 * ADR-114 perComponent：componentTexMap 按组件名查独立纹理数组，
 * 不再依赖全局 texArr[texIdx] 槽位顺序。
 *
 * 兼容调用（重载分派，避免破坏性 API 变更）：
 *   - 新口径：buildYsmObject(spec, texArr, componentTexMap, texIdx?)
 *   - 旧口径：buildYsmObject(spec, texArr, texIdx?)
 */
export function buildYsmObject(
  spec: Spec3D,
  texArr: (THREE.Texture | null)[],
  componentTexMapOrTexIdx: Map<string, (THREE.Texture | null)[]> | number = new Map<
    string,
    (THREE.Texture | null)[]
  >(),
  texIdx = 0,
): YsmObjectHandle {
  const componentTexMap = componentTexMapOrTexIdx instanceof Map
    ? componentTexMapOrTexIdx
    : new Map<string, (THREE.Texture | null)[]>();
  const resolvedTexIdx = componentTexMapOrTexIdx instanceof Map
    ? texIdx
    : componentTexMapOrTexIdx;
  const { boneGroupMap, rootGroup, modelGroups } = buildSceneMesh(spec);
  const multiModel = (spec.models?.length ?? 1) > 1;

  // 发光骨骼索引（boneId → glow）：对齐上游 GeoBone.glow = name.startsWith("ysmGlow")。
  // Go 侧 spec-bones.go isGlowBone 已在 BoneData.Glow 标记，此处建反查表供
  // addMeshToBoneGroup 按 md.boneId 取 glow，据此切 MeshStandardMaterial + emissive。
  const glowByBoneId = new Map<string, boolean>();
  for (const m of (spec.models || [])) {
    for (const b of (m.bones ?? [])) {
      if (b.glow) glowByBoneId.set(b.id, true);
    }
  }

  // 网格合并 + 挂载（原 renderModel3D 内联逻辑；合并结果本地化，不写回 spec）
  for (const [mi, mg] of (spec.models || []).entries()) {
    if (!mg.meshGroups?.length) continue;
    const compName = mg.name || mg.id || `comp_${mi}`;
    const mappedComponentTextures = componentTexMap.get(compName);
    const usesComponentTextures = Boolean(mappedComponentTextures?.length);
    // ADR-118 Phase B：统一碎片流——能面级拆分（有 AlphaIndex）的按三角 UV 路由
    // 三种渲染路径；不能拆分的回退整图模式单碎片（行为与旧双桶一致）
    const fragments: MeshFragment[] = [];
    for (const mesh of mg.meshGroups) {
      // 分类索引与绑定索引同一空间（原版 ModernYSM 亦按单一 textureIndex 判定透明与绑定）：
      // 组件分支 → 组件局部槽 0（mesh-builder 对组件数组恒用 arr === compTexArr ? 0）；
      // 非组件 → 全局 texArr[mesh.texIdx]（multiModel）/ texArr[resolvedTexIdx]（单模型）。
      // 19d9b2ad 曾改组件分支为 mesh.texIdx（全局槽位，WASM 路径 = 组件文件序 i）——
      // 对组件数组（通常长 1）越界 → null → blend 组件误判 batchable 被烘进不透明批次。
      const classifyArr = usesComponentTextures ? mappedComponentTextures! : texArr;
      let textureIndex: number;
      if (usesComponentTextures) textureIndex = 0;
      else if (multiModel) textureIndex = mesh.texIdx ?? 0;
      else textureIndex = resolvedTexIdx;
      const texture = classifyArr[textureIndex] ?? null;
      const split = texture ? splitMeshByFaceAlpha(mesh, texture) : null;
      if (split) fragments.push(...split);
      else fragments.push({ md: mesh, mode: texture ? getTextureAlphaMode(texture) : "opaque" });
    }
    const merged: MeshFragment[] = [];
    const bakeable: MeshFragment[] = [];
    for (const frag of fragments) {
      if (frag.mode === "blend") merged.push(frag);
      else bakeable.push(frag);
    }
    // blend 不烘合（保持逐 mesh 深度排序，与旧双桶契约一致）；先烘批后透明维持提交次序
    merged.push(...bakeMeshFragments(bakeable));
    // ADR-114 perComponent：按组件名查 componentTexMap，fallback 全局 texArr
    // Keep the source spec immutable so cached model data can be reused safely.
    for (const { md, mode } of merged) {
      const bg = boneGroupMap.get(compKey(mi, md.boneId));
      if (!bg) continue;
      if (md.texIdx === undefined) {
        console.warn("[model3d] mesh 缺 texIdx（spec 契约破坏），回退 0", spec.models?.length);
      }
      // 绑定索引与分类同空间：组件分支传组件数组（mesh-builder 局部槽 0）；
      // 非组件传 [] + 全局 texArr——传 texArr 会被 arr === compTexArr 误判为组件数组，
      // 导致全局槽位 md.texIdx 恒失效（修复前非组件多组件全绑 texArr[0]）。
      const bindArr = usesComponentTextures ? mappedComponentTextures! : [];
      addMeshToBoneGroup(bg, md, bindArr, resolvedTexIdx, multiModel, texArr, mode, glowByBoneId.get(md.boneId) ?? false);
    }
  }

  return {
    rootGroup,
    boneGroupMap,
    modelGroups,
    showModelGroup: (idx: number) => showModelGroup(modelGroups, idx),
    getModelGroupCount: () => spec.models?.length || 0,
    setBoneVisible: (name: string, visible: boolean) => setBoneVisible(boneGroupMap, name, visible),
    toggleBone: (name: string) => toggleBone(boneGroupMap, name),
    getBoneList: (modelIdx?: number) => getBoneList(spec, modelIdx),
    removeFromScene(scene: THREE.Scene): void {
      scene.remove(rootGroup);
      disposeSceneMeshes(rootGroup, { disposeTextures: false });
    },
  };
}
