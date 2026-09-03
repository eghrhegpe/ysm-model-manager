// ===== 3D 骨骼射线拾取（从 model3d.ts 拆出，ADR-040 P1）=====
// 骨骼层级映射 + raycaster 拾取 + click 回调组装 BoneSelectInfo。
import * as THREE from "three";
import type { BoneSelectInfo } from "./model3d.ts";
import { isIdentityQuat } from "./quaternion.ts";

/** 无父级骨骼的哨兵父 id（childrenMap 根级聚合键，索引 2.2 魔数收敛） */
const ROOT_PARENT_ID = "__root__";

/**
 * 构建骨骼层级路径映射（name/id/parent/children）。
 * @returns { nameMap, parentMap, childrenMap }
 */
export function buildBoneHierarchy(
  spec: { models?: Array<{ bones?: Array<{ id: string; name: string; parentId?: string }> }> },
): {
  nameMap: Map<string, string>;
  parentMap: Map<string, string | null>;
  childrenMap: Map<string, string[]>;
} {
  const nameMap = new Map<string, string>();
  const parentMap = new Map<string, string | null>();
  const childrenMap = new Map<string, string[]>();
  for (const mg of spec.models || []) {
    for (const bd of mg.bones || []) {
      nameMap.set(bd.id, bd.name);
      parentMap.set(bd.id, bd.parentId || null);
      const parentId = bd.parentId || ROOT_PARENT_ID;
      if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
      childrenMap.get(parentId)!.push(bd.id);
    }
  }
  return { nameMap, parentMap, childrenMap };
}

/**
 * 骨骼名 → 全路径（如 "root / spine / head"）。
 */
function getBonePath(boneId: string, nameMap: Map<string, string>, parentMap: Map<string, string | null>): string {
  const parts: string[] = [];
  let current: string | null | undefined = boneId;
  while (current && nameMap.has(current)) {
    parts.unshift(nameMap.get(current)!);
    current = parentMap.get(current);
  }
  return parts.join(" / ");
}

/**
 * Mesh → 所属骨骼名（沿父链向上查找 has isGroup 且 name 在 nameMap 中的节点）。
 * 导出供统一多模型拾取器（ADR-093 dispatch）复用。
 */
export function getMeshBoneId(mesh: THREE.Object3D, nameMap: Map<string, string>): string | null {
  let obj: THREE.Object3D | null = mesh;
  while (obj) {
    if ((obj as THREE.Group).isGroup && obj.name && nameMap.has(obj.name)) {
      return obj.name;
    }
    obj = obj.parent;
  }
  return null;
}

/**
 * 骨骼选中信息组装。
 * 导出供统一多模型拾取器（ADR-093 dispatch）复用。
 */
export function assembleBoneSelectInfo(
  boneId: string,
  boneGroupMap: Map<string, THREE.Group>,
  nameMap: Map<string, string>,
  parentMap: Map<string, string | null>,
  childrenMap: Map<string, string[]>,
  hoveredMesh: THREE.Object3D | null,
): BoneSelectInfo {
  const bg = boneGroupMap.get(boneId);
  const wp = new THREE.Vector3();
  if (bg) bg.getWorldPosition(wp);
  const lp = bg ? bg.position : new THREE.Vector3();
  const lq = bg ? bg.quaternion : new THREE.Quaternion();
  let lr: number[] | null = null;
  // 单位四元数判定复用 quaternion.ts 现成工具（epsilon 1e-9 口径，与 Go threejs 一致）
  if (!isIdentityQuat([lq.x, lq.y, lq.z, lq.w]))
    lr = [lq.x, lq.y, lq.z, lq.w];

  // Cube（mesh）级数据
  let cq: number[] | null = null;
  let cp: number[] | null = null;
  if (hoveredMesh && (hoveredMesh as THREE.Mesh).isMesh) {
    cq = [
      (hoveredMesh as THREE.Mesh).quaternion.x,
      (hoveredMesh as THREE.Mesh).quaternion.y,
      (hoveredMesh as THREE.Mesh).quaternion.z,
      (hoveredMesh as THREE.Mesh).quaternion.w,
    ];
    cp = [
      (hoveredMesh as THREE.Mesh).position.x,
      (hoveredMesh as THREE.Mesh).position.y,
      (hoveredMesh as THREE.Mesh).position.z,
    ];
  }

  // meshCount：遍历 boneGroup 统计子 Mesh 数量
  let meshCount = 0;
  if (bg)
    bg.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) meshCount++;
    });

  return {
    name: nameMap.get(boneId) || boneId,
    path: getBonePath(boneId, nameMap, parentMap),
    parent: parentMap.get(boneId) ?? null,
    children: childrenMap.get(boneId) || [],
    meshCount,
    localPos: [lp.x, lp.y, lp.z],
    worldPos: [wp.x, wp.y, wp.z],
    localRot: lr,
    cubeRot: cq,
    cubePos: cp,
  };
}

/**
 * 注册 pointermove / click 骨骼拾取监听器。
 * onBoneSelect 引用通过 state.onBoneSelectCallback 读取（可变），
 * 支持外部通过 handle.onBoneSelect = fn 延迟设置。
 * @returns cleanup 函数
 */
export function registerBoneRaycast(
  renderer: { domElement: HTMLElement },
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
  boneGroupMap: Map<string, THREE.Group>,
  nameMap: Map<string, string>,
  parentMap: Map<string, string | null>,
  childrenMap: Map<string, string[]>,
  state: {
    hoveredBone: string | null;
    hoveredMesh: THREE.Object3D | null;
    setHoveredBone: (v: string | null) => void;
    setHoveredMesh: (v: THREE.Object3D | null) => void;
    onBoneSelectCallback: ((info: BoneSelectInfo) => void) | null;
  },
): () => void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const onPointerMove = (e: PointerEvent): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    let foundBone: string | null = null;
    let foundMesh: THREE.Object3D | null = null;
    for (const hit of intersects) {
      // THREE Raycaster 不检查 visible，需手动沿父链跳过已隐藏骨骼
      let node: THREE.Object3D | null = hit.object;
      let hidden = false;
      while (node) {
        if (!node.visible) { hidden = true; break; }
        node = node.parent;
      }
      if (hidden) continue;
      const boneId = getMeshBoneId(hit.object, nameMap);
      if (boneId) { foundBone = boneId; foundMesh = hit.object; break; }
    }
    if (foundBone !== state.hoveredBone) {
      state.setHoveredBone(foundBone);
      state.setHoveredMesh(foundMesh);
      renderer.domElement.style.cursor = foundBone ? "pointer" : "default";
    }
  };

  const onPointerClick = (_e: MouseEvent): void => {
    if (!state.hoveredBone || !state.onBoneSelectCallback) return;
    const info = assembleBoneSelectInfo(
      state.hoveredBone, boneGroupMap, nameMap, parentMap, childrenMap, state.hoveredMesh,
    );
    state.onBoneSelectCallback(info);
  };

  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("click", onPointerClick);

  return () => {
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("click", onPointerClick);
  };
}
