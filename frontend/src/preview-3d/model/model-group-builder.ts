// ===== model-group-builder.ts — buildModelGroup（从 spec-builder.ts 拆出，ADR-040 P1）=====
// 单组件 spec 构建核心（Build 与 BuildMulti 共用）。
// 对齐 Go threejs/spec.go buildModelGroup（L103-390）。

import { deferred } from "@/preview-3d/deferred.ts";
import {
  buildCubeMeshData,
  computeBoneLocalPos,
  eulerToQuaternion,
  hasBoneRotation,
  isIdentityQuat,
  mergeCubes,
} from "@/preview-3d/mesh/cube-mesh.ts";
import type { BedrockModel, BoneData, Cube2D, MeshData, ModelGroup, Vec3 } from "./spec-builder.ts";

/** buildModelGroup 内部：骨骼首次出现信息 */
interface BoneFirst {
  pivot: Vec3;
  hasParent: boolean;
  hasRot: boolean;
}

/** buildModelGroup 骨骼构建上下文（类型提级） */
interface BonesCtx {
  bones: BoneData[];
  boneIdx: Map<string, number>;
  boneCubes: Map<string, Cube2D[]>;
  first: Map<string, BoneFirst>;
  pivots: Map<string, Vec3>;
  texW: number;
  texH: number;
}

/**
 * 同名骨骼 overwrite 决策（bug-chronicle #14）：
 * 已有骨骼无父 → 新有父则覆盖；均有父且已有无旋 → 新有旋则覆盖。
 * 收敛 first 预收集与 bones 合并两处逐字同构的公式。
 */
const ShouldOverwrite = (
  existingHasParent: boolean,
  existingHasRot: boolean,
  newHasParent: boolean,
  newHasRot: boolean,
): boolean =>
  (!existingHasParent && newHasParent) ||
  (existingHasParent && newHasParent && !existingHasRot && newHasRot);

/**
 * 修复断裂的父子链：沿父链向上找第一个有 pivot 且在 bones 列表中的祖先，
 * 若链断则挂到 root。
 */
function fixOrphanBoneChain(
  bones: BoneData[],
  modelBones: BedrockModel["bones"],
  pivots: Map<string, Vec3>,
): void {
  const boneNameSet = new Set<string>();
  for (const b of bones) boneNameSet.add(b.name);
  for (let i = 0; i < bones.length; i++) {
    if (bones[i].parentId === null) continue;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    let ancestor = bones[i].parentId!;
    const visited = new Set<string>([bones[i].name]);
    while (true) {
      const ancHasPivot = pivots.has(ancestor);
      if (boneNameSet.has(ancestor) && ancHasPivot) break;
      let found = false;
      for (const b of modelBones) {
        if (b.name === ancestor && b.parent !== "" && !visited.has(b.parent)) {
          ancestor = b.parent;
          visited.add(ancestor);
          found = true;
          break;
        }
      }
      if (!found) {
        ancestor = "";
        break;
      }
    }

    const bp = pivots.get(bones[i].name);
    const ancPivot = ancestor !== "" ? (pivots.get(ancestor) ?? null) : null;
    if (ancestor !== "") {
      bones[i].parentId = ancestor;
      bones[i].localPosition =
        ancPivot && bp
          ? computeBoneLocalPos(bp, ancPivot)
          : bp
            ? computeBoneLocalPos(bp, null)
            : [0, 0, 0];
    } else {
      bones[i].parentId = null;
      bones[i].localPosition = bp ? computeBoneLocalPos(bp, null) : [0, 0, 0];
    }
  }
}

/**
 * 阶段①：初始化空壳 + tex 尺寸 + first/pivots 预收集 map
 */
function initShellAndMaps(model: BedrockModel): {
  ctx: BonesCtx;
  emptyReturn: ModelGroup | null;
} {
  if (!model.bones || model.bones.length === 0) {
    return {
      ctx: deferred<BonesCtx>(),
      emptyReturn: {
        id: "",
        name: "",
        defaultVisible: true,
        textureWidth: 0,
        textureHeight: 0,
        textureId: null,
        bones: [],
        meshGroups: [],
      },
    };
  }
  let texW = model.texWidth;
  if (texW === 0) texW = 64;
  let texH = model.texHeight;
  if (texH === 0) texH = 64;

  const first = new Map<string, BoneFirst>();
  const pivots = new Map<string, Vec3>();
  for (const b of model.bones) {
    const np: Vec3 = { x: b.pivot[0], y: b.pivot[1], z: b.pivot[2] };
    const fi = first.get(b.name);
    if (!fi) {
      first.set(b.name, {
        pivot: np,
        hasParent: b.parent !== "",
        hasRot: hasBoneRotation(b.rotation),
      });
      pivots.set(b.name, np);
      continue;
    }
    const newHasParent = b.parent !== "";
    const newHasRot = hasBoneRotation(b.rotation);
    if (ShouldOverwrite(fi.hasParent, fi.hasRot, newHasParent, newHasRot)) {
      pivots.set(b.name, np);
      first.set(b.name, { pivot: np, hasParent: newHasParent, hasRot: newHasRot });
    }
  }

  const ctx: BonesCtx = {
    bones: [],
    boneIdx: new Map<string, number>(),
    boneCubes: new Map<string, Cube2D[]>(),
    first,
    pivots,
    texW,
    texH,
  };
  return { ctx, emptyReturn: null };
}

/**
 * 阶段②：遍历 model.bones 构建 bones 数组 + boneIdx + boneCubes（按 parent 挂树）
 */
function buildBonesTree(model: BedrockModel, ctx: BonesCtx): void {
  for (const b of model.bones) {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const bp = ctx.pivots.get(b.name)!;
    const parentPivot = b.parent !== "" ? (ctx.pivots.get(b.parent) ?? null) : null;
    const localPos = computeBoneLocalPos(bp, parentPivot);

    let localRot: [number, number, number, number] = [0, 0, 0, 1];
    if (hasBoneRotation(b.rotation)) {
      localRot = eulerToQuaternion(-b.rotation[0], -b.rotation[1], b.rotation[2]);
    }
    const parentID: string | null = b.parent !== "" ? b.parent : null;

    const idx = ctx.boneIdx.get(b.name);
    if (idx !== undefined) {
      const existingHasParent = ctx.bones[idx].parentId !== null;
      const newHasParent = b.parent !== "";
      const existingHasRot = !isIdentityQuat(ctx.bones[idx].localRotation);
      const newHasRot = !isIdentityQuat(localRot);

      if (ShouldOverwrite(existingHasParent, existingHasRot, newHasParent, newHasRot)) {
        ctx.bones[idx].parentId = parentID;
        ctx.bones[idx].localPosition = localPos;
        ctx.bones[idx].localRotation = localRot;
        ctx.boneCubes.set(b.name, b.cubes.slice());
      } else {
        ctx.boneCubes.set(b.name, mergeCubes(ctx.boneCubes.get(b.name) || [], b.cubes));
      }
    } else {
      ctx.boneIdx.set(b.name, ctx.bones.length);
      ctx.bones.push({
        id: b.name,
        name: b.name,
        parentId: parentID,
        localPosition: localPos,
        localRotation: localRot,
        _cubeCount: 0,
      });
      ctx.boneCubes.set(b.name, b.cubes.slice());
    }
  }
}

/**
 * 阶段③-1：逐 bone 的 cubes 构建 mesh 数据
 */
function buildMeshesFromCubes(model: BedrockModel, ctx: BonesCtx): MeshData[] {
  const meshes: MeshData[] = [];
  const boneDone = new Set<string>();
  for (const b of model.bones) {
    if (!ctx.boneIdx.has(b.name)) continue;
    if (boneDone.has(b.name)) continue;
    boneDone.add(b.name);

    let bonePivot = ctx.pivots.get(b.name);
    if (!bonePivot) {
      bonePivot = { x: b.pivot[0], y: b.pivot[1], z: b.pivot[2] };
    }
    const idx = ctx.boneIdx.get(b.name);
    if (idx !== undefined) {
      ctx.bones[idx]._cubeCount = (ctx.boneCubes.get(b.name) || []).length;
    }
    const cubs = ctx.boneCubes.get(b.name) || [];
    for (let ci = 0; ci < cubs.length; ci++) {
      const meshData = buildCubeMeshData(cubs[ci], bonePivot, ctx.texW, ctx.texH, b.name, ci);
      if (meshData) meshes.push(meshData);
    }
  }
  return meshes;
}

/**
 * 阶段③-2：补全无 cube 的中间骨骼到 bones 列表
 */
function ensureAllBonesPresent(model: BedrockModel, ctx: BonesCtx): void {
  const allBoneNames = new Set<string>();
  for (const b of model.bones) {
    allBoneNames.add(b.name);
    if (b.parent !== "") allBoneNames.add(b.parent);
  }
  for (const name of allBoneNames) {
    if (ctx.boneIdx.has(name)) continue;
    const bp = ctx.pivots.get(name);
    let parentName = "";
    let localPos: [number, number, number] = [0, 0, 0];
    let found = false;
    for (const b of model.bones) {
      if (b.name === name) {
        found = true;
        parentName = b.parent;
        const parentPivot2 = b.parent !== "" ? (ctx.pivots.get(b.parent) ?? null) : null;
        localPos =
          parentPivot2 && bp
            ? computeBoneLocalPos(bp, parentPivot2)
            : bp
              ? computeBoneLocalPos(bp, null)
              : [0, 0, 0];
        break;
      }
    }
    if (!found) {
      if (!bp) {
        console.warn(`[spec-builder] 骨骼 ${name} 无 pivot（纯 parent 引用）`);
      }
      localPos = bp ? computeBoneLocalPos(bp, null) : [0, 0, 0];
      parentName = "";
    }
    const parentID: string | null = parentName !== "" ? parentName : null;
    ctx.boneIdx.set(name, ctx.bones.length);
    ctx.bones.push({
      id: name,
      name: name,
      parentId: parentID,
      localPosition: localPos,
      localRotation: [0, 0, 0, 1],
      _cubeCount: 0,
    });
  }
}

/**
 * 阶段④：后处理（断链修复 + Arm 挂接）+ 纹理 ID 计算
 */
function postProcessAndTextures(
  model: BedrockModel,
  ctx: BonesCtx,
  texIdxBase: number,
): string | null {
  fixOrphanBoneChain(ctx.bones, model.bones, ctx.pivots);

  // 左右臂挂接：二者逻辑逐字同构（仅骨名与取 pivot 的键不同），合并为循环。
  // LeftArm 在 MMD/部分基岩模型里与 RightArm 一样可能是「无父链的游离根」，
  // 需在 Arm 已定父后挂回，否则局部坐标算错。
  for (const armName of ["RightArm", "LeftArm"] as const) {
    const armBone = ctx.bones.find((b) => b.name === armName && b.parentId === null);
    if (!armBone) continue;
    const armParent = ctx.bones.find((b) => b.name === "Arm" && b.parentId !== null);
    if (!armParent) continue;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const armPivot = ctx.pivots.get(armName)!;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const parentPivot = ctx.pivots.get("Arm")!;
    armBone.parentId = armParent.name;
    armBone.localPosition = computeBoneLocalPos(armPivot, parentPivot);
  }

  // ⚠️ 刀⑳：此处原有 `const hasTextures = false; if (hasTextures) { texID = ... }` 恒假死分支
  // （texIdxBase 参数在生产路径因此完全未被使用，仅用于喂这条死路）。删除后统一返回 null；
  // 参数 texIdxBase 保留以维持 `buildModelGroup` 既有调用签名（对齐 Go spec.go 的同名契约），
  // 待 Go 侧切片真正下发纹理 ID 时再接线。
  void texIdxBase;
  return null;
}

/**
 * 单组件 spec 构建核心。
 * 对齐 Go threejs/spec.go buildModelGroup（L103-390）。
 */
export function buildModelGroup(
  model: BedrockModel,
  compID: string,
  texIdxBase: number,
): ModelGroup {
  const { ctx, emptyReturn } = initShellAndMaps(model);
  if (emptyReturn !== null) {
    emptyReturn.id = compID;
    emptyReturn.name = compID;
    return emptyReturn;
  }

  buildBonesTree(model, ctx);
  const meshes = buildMeshesFromCubes(model, ctx);
  ensureAllBonesPresent(model, ctx);
  const texID = postProcessAndTextures(model, ctx, texIdxBase);

  const compName = model.sourceName || compID;
  return {
    id: compID,
    name: compName,
    defaultVisible: true,
    textureWidth: ctx.texW,
    textureHeight: ctx.texH,
    textureId: texID,
    bones: ctx.bones,
    meshGroups: meshes,
  };
}
