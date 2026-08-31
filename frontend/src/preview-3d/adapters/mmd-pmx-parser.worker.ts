// ===== PMX 二进制解析 Worker =====
// 用 babylon-mmd 权威解析器（vendor/babylon-mmd/pmxReader.js，@moeru/three-mmd 同源内核）
// 在 Worker 中解析 PMX 格式（纯数据，无 DOM/WebGL 依赖），产物经 pmxObjectToResponse
// 转成 PmxParseResponse 回主线程，把 PMX 解析从主线程（CrRendererMain）搬到 Worker，
// 与纹理解码 Worker 并行，主线程只负责 Three.js 场景构建。
//
// 解析口径与主线程 MMDLoader（@moeru/three-mmd）完全一致——替代自研 PmxReader
// 双轨解析（历史「空气角色 / 解析越界 / 纹理挂载失败」等 4 个真实 bug 的根源）。
//
// PMX 格式规范：https://github.com/v-cfd/mmd/blob/master/mmd/file_format/pmx.md

import { PmxReader } from "../vendor/babylon-mmd/pmxReader.js";
import { pmxObjectToResponse } from "./mmd-pmx-convert.ts";
import { safeErrorMessage } from "../../utils/safe-error-msg.ts";

/** 主线程 → Worker 请求 */
export interface PmxParseRequest {
  id: number;
  bytes: ArrayBuffer; // PMX 文件二进制（transferable）
}

/** 顶点数据（交织存储，GPU 友好） */
export interface PmxVertexData {
  count: number;
  positions: Float32Array;   // xyz * count
  normals: Float32Array;     // xyz * count
  uvs: Float32Array;         // uv * count
  boneIndices: Uint8Array | Uint16Array | Uint32Array; // bone indices[4] * count（宽度随 boneIndexSize：1/2/4 字节）
  boneWeights: Float32Array;  // weights[4] * count
}

/** 面数据 */
export interface PmxFaceData {
  count: number;
  indices: Uint32Array; // triangle indices * count
}

/** 材质数据 */
export interface PmxMaterialData {
  name: string;
  diffuse: [number, number, number, number]; // RGBA
  specular: [number, number, number];
  shininess: number;
  ambient: [number, number, number];
  textureIndex: number; // -1 = none
  toonIndex: number;
  flags: number;
  edgeColor: [number, number, number, number];
  edgeSize: number;
  sphereIndex: number;
  sphereMode: number;
  sharedToon: number;
}

/** 骨骼数据（字段对齐 @moeru/three-mmd PmxObject.Bone） */
export interface PmxBoneData {
  name: string;
  englishName: string;
  parentBoneIndex: number; // -1 = root
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion
  flag: number; // PMX Bone.Flag 原始位（诊断/后续使用）
  hasIK: boolean;
  ikTarget?: number;
  ikIteration?: number;
  ikRotationConstraint?: number;
  ikLinks?: Array<{ boneIndex: number; hasLimitation: boolean }>;
}

/** Morph 数据 */
export interface PmxMorphData {
  name: string;
  type: number; // 0=group, 1=vertex, 2=bone, 3=uv, 4+=additional
  elements: Array<{ index: number; offset: [number, number, number] }>;
}

/** Worker → 主线程响应 */
export interface PmxParseResponse {
  id: number;
  ok: boolean;
  header?: {
    version: string;
    encoding: "utf-8" | "utf-16";
    additionalDataFlags: number;
  };
  vertices?: PmxVertexData;
  faces?: PmxFaceData;
  textures?: string[];
  materials?: PmxMaterialData[];
  bones?: PmxBoneData[];
  rigidBodies?: PmxRigidBodyData[];
  joints?: PmxJointData[];
  morphs?: PmxMorphData[];
  displayFrames?: PmxDisplayFrameData[];
  error?: string;
}

export interface PmxRigidBodyData {
  name: string;
  boneIndex: number; // -1 = no bone
  group: number;
  collisionGroup: number;
  shapeType: number; // 0=sphere, 1=box, 2=capsule
  shapeSize: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  mass: number;
  linearDamping: number;
  angularDamping: number;
  friction: number;
  restitution: number;
  mode: number; // 0=follow, 1=dynamic, 2=pseudo
}

export interface PmxJointData {
  name: string;
  rigidBodyIndexA: number;
  rigidBodyIndexB: number;
  type: number;
  position: [number, number, number];
  rotation: [number, number, number];
  positionMin?: [number, number, number];
  positionMax?: [number, number, number];
  rotationMin?: [number, number, number];
  rotationMax?: [number, number, number];
  springPosition?: [number, number, number];
  springRotation?: [number, number, number];
}

export interface PmxDisplayFrameData {
  name: string;
  type: number; // 0=root, 1=bone, 2=morph
  elements: Array<{ index: number; value: number }>;
}

// ===== Worker 消息处理 =====
self.onmessage = async (e: MessageEvent<PmxParseRequest>) => {
  const { id, bytes } = e.data;
  try {
    const pmx = await PmxReader.ParseAsync(bytes);
    const result = pmxObjectToResponse(pmx, id);
    // 传输 ArrayBuffer 的 transferable 数据
    const transferables: Transferable[] = [];
    if (result.vertices) {
      transferables.push(
        result.vertices.positions.buffer,
        result.vertices.normals.buffer,
        result.vertices.uvs.buffer,
        result.vertices.boneIndices.buffer,
        result.vertices.boneWeights.buffer,
      );
    }
    if (result.faces) {
      transferables.push(result.faces.indices.buffer);
    }
    (self as unknown as Worker).postMessage(result, transferables);
  } catch (err) {
    const resp: PmxParseResponse = {
      id,
      ok: false,
      error: safeErrorMessage(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};

export {};
