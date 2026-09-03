// ===== PMX 解析器（主线程 Builder）=====
// 与 mmd-pmx-parser.worker.ts 配合：Worker 解析 PMX 二进制 → 产出结构化数据
// → 主线程本模块将结构化数据构建为 Three.js 对象（BufferGeometry / Material / Bone）。
// P2 切片：重负载同步构建拆成 rAF 帧片段，避免长帧卡顿。

import * as THREE from "three";
import type {
  PmxParseResponse,
  PmxBoneData,
} from "./mmd-pmx-parser.worker.ts";
import { createWorkerParser } from "./worker-bridge.ts";

// ===== rAF 切片工具 =====
// 每帧处理预算（毫秒），留给浏览器 60fps 渲染的时间
const FRAME_BUDGET_MS = 12;

/** 让出主线程一帧（requestAnimationFrame），用于重负载切片 */
function yieldToFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** Builder 配置 */
export interface PmxBuilderConfig {
  /** 纹理路径 → blob URL 映射（复用 MMDLoader 的 URLModifier 逻辑） */
  texUrlMap: Map<string, string>;
  /** maxBoneInfluence: 每顶点最大影响骨骼数 */
  maxBoneInfluence?: number;
  /** 异步分帧构建（rAF yield 让出主线程）：大模型（10w+ 顶点 / 100+ 骨骼）防单帧长卡顿 */
  sliced?: boolean;
}

/** Builder 产出 */
export interface PmxBuildResult {
  mesh: THREE.SkinnedMesh;
  geometry: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial[];
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
}

/** PMX 解析器管理器 */
export interface PmxParser {
  /** 解析 PMX 文件（Worker 中解析，返回结构化数据） */
  parse(bytes: ArrayBuffer): Promise<PmxParseResponse>;
  /** 释放 Worker */
  dispose(): void;
}

/** 创建 PMX 解析器（Worker）。测试/受限环境无 Worker → always-fail 降级守卫，
 *  调用方（mmd-adapter）会 fallback 到 MMDLoader 主路径（对齐 web-stats 降级契约） */
export function createPmxParser(): PmxParser {
  return createWorkerParser<PmxParseResponse>("./mmd-pmx-parser.worker.ts", "PMX 解析超时（>30s）");
}

/**
 * 从 Worker 解析结果构建 Three.js 场景对象。
 * 只构建核心几何 + 材质 + 骨骼，MMD 特有功能（toon/sdf/physics）仍由 MMDLoader 处理。
 * config.sliced 时异步分帧构建（rAF yield 让出主线程），避免大模型单帧长卡顿。
 */
export async function buildPmxScene(
  parsed: PmxParseResponse,
  config: PmxBuilderConfig,
): Promise<PmxBuildResult | null> {
  if (!parsed.ok || !parsed.vertices || !parsed.faces) return null;

  const { vertices, faces, materials: pmxMaterials, bones: pmxBones } = parsed;
  const sliced = config.sliced ?? false;
  const frameStart = performance.now();

  // 切片模式：构建阶段间超预算则让出主线程；同步模式空转
  const maybeYield = async (): Promise<void> => {
    if (sliced && performance.now() - frameStart > FRAME_BUDGET_MS) await yieldToFrame();
  };

  // --- 1. 创建 BufferGeometry ---
  const geometry = new THREE.BufferGeometry();

  // 位置
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices.positions, 3));
  // 法线
  geometry.setAttribute("normal", new THREE.BufferAttribute(vertices.normals, 3));
  // UV
  if (vertices.uvs.length > 0) {
    geometry.setAttribute("uv", new THREE.BufferAttribute(vertices.uvs, 2));
  }

  // 骨骼索引
  if (vertices.boneIndices.length > 0) {
    const boneIndexAttr = new THREE.BufferAttribute(vertices.boneIndices, 4);
    boneIndexAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("skinIndex", boneIndexAttr);
  }

  // 骨骼权重
  if (vertices.boneWeights.length > 0) {
    const weightAttr = new THREE.BufferAttribute(vertices.boneWeights, 4);
    weightAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("skinWeight", weightAttr);
  }

  // 索引
  geometry.setIndex(new THREE.BufferAttribute(faces.indices, 1));
  await maybeYield();

  // --- 2. 创建材质（切片模式分 4 帧）---
  const materialCount = pmxMaterials?.length ?? 1;
  const materials: THREE.MeshStandardMaterial[] = [];
  const materialSlice = sliced ? Math.max(1, Math.ceil(materialCount / 4)) : materialCount;
  for (let i = 0; i < materialCount; i++) {
    if (sliced && i > 0 && i % materialSlice === 0) await yieldToFrame();
    const pmxMat = pmxMaterials?.[i];
    const mat = new THREE.MeshStandardMaterial({
      name: pmxMat?.name ?? `material_${i}`,
      color: pmxMat
        ? new THREE.Color(pmxMat.diffuse[0], pmxMat.diffuse[1], pmxMat.diffuse[2])
        : new THREE.Color(1, 1, 1),
      transparent: pmxMat ? pmxMat.diffuse[3] < 1 : false,
      opacity: pmxMat ? pmxMat.diffuse[3] : 1,
      side: pmxMat ? (pmxMat.flags & 0x01 ? THREE.DoubleSide : THREE.FrontSide) : THREE.FrontSide,
      metalness: 0,
      roughness: 1,
    });

    // 纹理：PMX 原始大小写 vs texMap key 全 lowercase → 统一 toLowerCase 再查（basename 兜底）。
    // 延迟纹理挂 pendingTexture（worker 解码完成后同步应用，避免 TextureLoader.load() 竞态）。
    if (pmxMat && pmxMat.textureIndex >= 0 && parsed.textures) {
      const texPath = parsed.textures[pmxMat.textureIndex];
      if (texPath) {
        const normalizedPath = texPath.toLowerCase().replace(/\\/g, "/");
        const blobUrl = config.texUrlMap.get(normalizedPath)
          ?? config.texUrlMap.get(normalizedPath.split("/").pop() ?? "");
        if (blobUrl) {
          mat.userData.pendingTexture = { relPath: normalizedPath, blobUrl };
        }
      }
    }

    materials.push(mat);
  }
  await maybeYield();

  // --- 3. 创建骨骼（切片模式分 4 帧）---
  const bones: THREE.Bone[] = [];
  if (pmxBones && pmxBones.length > 0) {
    const boneSlice = sliced ? Math.max(1, Math.ceil(pmxBones.length / 4)) : pmxBones.length;
    for (let i = 0; i < pmxBones.length; i++) {
      if (sliced && i > 0 && i % boneSlice === 0) await yieldToFrame();
      const pmxBone = pmxBones[i];
      const bone = new THREE.Bone();
      bone.name = pmxBone.name;
      bone.position.set(pmxBone.position[0], pmxBone.position[1], pmxBone.position[2]);
      bones.push(bone);
    }

    // 构建父子关系（切片模式分 4 帧）
    const relSlice = sliced ? Math.max(1, Math.ceil(pmxBones.length / 4)) : pmxBones.length;
    for (let i = 0; i < pmxBones.length; i++) {
      if (sliced && i > 0 && i % relSlice === 0) await yieldToFrame();
      const parent = pmxBones[i].parentBoneIndex;
      if (parent >= 0 && parent < bones.length) {
        bones[parent].add(bones[i]);
      }
    }
  }
  await maybeYield();

  // --- 4. 创建 Skeleton + SkinnedMesh ---
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geometry, materials.length === 1 ? materials[0] : materials);
  attachRootBones(mesh, bones, pmxBones);
  mesh.bind(skeleton);

  return { mesh, geometry, materials, bones, skeleton };
}

/**
 * 把**所有**根骨骼（parentBoneIndex < 0）挂到 mesh，而非只 bones[0]。
 * ⚠️ PMX 常有多个根（如「操作中心」+「全ての親」），漏挂的根及其整棵子树成为孤儿 →
 * matrixWorld 不更新 → Skeleton.calculateInverses() 基于 identity 算逆矩阵 → 蒙皮把顶点
 * 拉到骨骼世界位置（角色「空气」/几何放大 N 倍）。真实模型（子言-馬尾版）实测两个根。
 * buildPmxScene 唯一挂载路径（sliced 开关不分叉），保证同步/切片不漂移（review P3）。
 */
function attachRootBones(
  mesh: THREE.SkinnedMesh,
  bones: THREE.Bone[],
  pmxBones: PmxBoneData[] | undefined,
): void {
  let rootAdded = false;
  for (let i = 0; i < bones.length; i++) {
    if (pmxBones && pmxBones[i] && pmxBones[i].parentBoneIndex < 0) {
      mesh.add(bones[i]);
      rootAdded = true;
    }
  }
  if (!rootAdded) mesh.add(bones[0] ?? new THREE.Bone());
}