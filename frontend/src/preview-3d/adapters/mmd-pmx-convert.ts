// ===== 权威 PMX 解析产物（babylon-mmd PmxObject）→ PmxParseResponse 转换器 =====
// Worker 内用 babylon-mmd 权威解析器（vendor/babylon-mmd/pmxReader.js，@moeru/three-mmd
// 同源内核）解析 PMX，产物 PmxObject 在此转成现有 PmxParseResponse 形状（压缩数组、
// GPU 友好、可 transferable），主线程构建（buildPmxScene / mmd 轻量适配器）零改动。
// 替代自研 PmxReader 双轨解析：解析口径与主线程 MMDLoader 完全一致，消除口径漂移。
import type { PmxObject } from "../vendor/babylon-mmd/pmxReader.js";
import type {
  PmxParseResponse,
  PmxVertexData,
  PmxMaterialData,
  PmxBoneData,
  PmxMorphData,
  PmxRigidBodyData,
  PmxJointData,
  PmxDisplayFrameData,
} from "./mmd-pmx-parser.worker.ts";

/** 顶点骨骼数据展平为 4 列压缩数组（BDEF4/QDEF 原样；BDEF1/2/SDEF 展开补零） */
function flattenBoneData(
  vertices: PmxObject["vertices"],
  boneIndexSize: number,
): { boneIndices: Uint8Array | Uint16Array | Uint32Array; boneWeights: Float32Array } {
  const count = vertices.length;
  // PMX 2.0：顶点蒙皮骨骼索引宽度随头部 boneIndexSize（非 vertexIndexSize）——
  // 否则 >255 骨骼模型的索引写进 Uint8Array 被截断，蒙皮静默损坏
  let idxArr: Uint8Array | Uint16Array | Uint32Array;
  if (boneIndexSize <= 1) {
    idxArr = new Uint8Array(count * 4);
  } else if (boneIndexSize === 2) {
    idxArr = new Uint16Array(count * 4);
  } else {
    idxArr = new Uint32Array(count * 4);
  }
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const bw = vertices[i].boneWeight;
    const o = i * 4;
    if (!bw || bw.boneIndices == null) continue; // 防御：坏数据跳过（权重 0，不参与蒙皮）
    if (typeof bw.boneIndices === "number") {
      // BDEF1：单骨骼，权重 1
      idxArr[o] = bw.boneIndices;
      weights[o] = 1;
    } else {
      const idxs = bw.boneIndices;
      for (let j = 0; j < 4; j++) idxArr[o + j] = idxs[j] ?? 0;
      if (typeof bw.boneWeights === "number") {
        // BDEF2：w0 + (1-w0)
        weights[o] = bw.boneWeights;
        weights[o + 1] = 1 - bw.boneWeights;
      } else if (Array.isArray(bw.boneWeights)) {
        // BDEF4 / QDEF
        for (let j = 0; j < 4; j++) weights[o + j] = bw.boneWeights[j] ?? 0;
      } else if (bw.boneWeights && typeof bw.boneWeights.boneWeight0 === "number") {
        // SDEF：主权重 + 补零（近似 BDEF2，SDEF 细节主线程 MMDLoader 路径才完整）
        weights[o] = bw.boneWeights.boneWeight0;
        weights[o + 1] = 1 - bw.boneWeights.boneWeight0;
      }
    }
  }
  return { boneIndices: idxArr, boneWeights: weights };
}

function convertVertices(vertices: PmxObject["vertices"], boneIndexSize: number): PmxVertexData {
  const count = vertices.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const v = vertices[i];
    const p = i * 3;
    const u = i * 2;
    positions[p] = v.position[0];
    positions[p + 1] = v.position[1];
    positions[p + 2] = v.position[2];
    normals[p] = v.normal[0];
    normals[p + 1] = v.normal[1];
    normals[p + 2] = v.normal[2];
    uvs[u] = v.uv[0];
    uvs[u + 1] = v.uv[1];
  }
  const { boneIndices, boneWeights } = flattenBoneData(vertices, boneIndexSize);
  return { count, positions, normals, uvs, boneIndices, boneWeights };
}

function convertMaterial(m: PmxObject["materials"][number]): PmxMaterialData {
  return {
    name: m.name,
    diffuse: m.diffuse,
    specular: m.specular,
    shininess: m.shininess,
    ambient: m.ambient,
    textureIndex: m.textureIndex,
    toonIndex: m.toonTextureIndex,
    flags: m.flag,
    edgeColor: m.edgeColor,
    edgeSize: m.edgeSize,
    sphereIndex: m.sphereTextureIndex,
    sphereMode: m.sphereTextureMode,
    sharedToon: m.isSharedToonTexture ? 1 : 0,
  };
}

function convertBone(b: PmxObject["bones"][number]): PmxBoneData {
  return {
    name: b.name,
    englishName: b.englishName,
    parentBoneIndex: b.parentBoneIndex,
    position: b.position,
    // PMX 骨骼无旋转数据（只有 position + flag），identity quaternion
    rotation: [0, 0, 0, 1],
    flag: b.flag,
    hasIK: (b.flag & 32) !== 0, // Bone.Flag.IsIkEnabled
    ikTarget: b.ik?.target,
    ikIteration: b.ik?.iteration,
    ikRotationConstraint: b.ik?.rotationConstraint,
    ikLinks: b.ik?.links.map((l) => ({ boneIndex: l.target, hasLimitation: !!l.limitation })),
  };
}

function convertMorph(m: PmxObject["morphs"][number]): PmxMorphData {
  const elements: PmxMorphData["elements"] = [];
  const idxs = m.indices;
  if (idxs) {
    if (m.type === 1 && m.positions) {
      // VertexMorph：顶点位移
      for (let i = 0; i < idxs.length; i++) {
        elements.push({ index: idxs[i], offset: [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]] });
      }
    } else if (m.type === 0 && m.ratios) {
      // GroupMorph：组比例（offset 借位存 ratio）
      for (let i = 0; i < idxs.length; i++) {
        elements.push({ index: idxs[i], offset: [m.ratios[i], 0, 0] });
      }
    } else if (m.type === 2 && m.positions) {
      // BoneMorph：位移 + 旋转（offset 取位移）
      for (let i = 0; i < idxs.length; i++) {
        elements.push({ index: idxs[i], offset: [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]] });
      }
    } else if (m.type >= 3 && m.offsets) {
      // UvMorph / AdditionalUv：UV 偏移（offset 取前 3 分量）
      for (let i = 0; i < idxs.length; i++) {
        elements.push({ index: idxs[i], offset: [m.offsets[i * 4], m.offsets[i * 4 + 1], m.offsets[i * 4 + 2]] });
      }
    }
  }
  return { name: m.name, type: m.type, elements };
}

function convertRigidBody(r: PmxObject["rigidBodies"][number]): PmxRigidBodyData {
  return {
    name: r.name,
    boneIndex: r.boneIndex,
    group: r.collisionGroup,
    collisionGroup: r.collisionMask,
    shapeType: r.shapeType,
    shapeSize: r.shapeSize,
    position: r.shapePosition,
    rotation: r.shapeRotation,
    mass: r.mass,
    linearDamping: r.linearDamping,
    angularDamping: r.angularDamping,
    friction: r.friction,
    restitution: r.repulsion,
    mode: r.physicsMode,
  };
}

function convertJoint(j: PmxObject["joints"][number]): PmxJointData {
  return {
    name: j.name,
    rigidBodyIndexA: j.rigidbodyIndexA,
    rigidBodyIndexB: j.rigidbodyIndexB,
    type: j.type,
    position: j.position,
    rotation: j.rotation,
    positionMin: j.positionMin,
    positionMax: j.positionMax,
    rotationMin: j.rotationMin,
    rotationMax: j.rotationMax,
    springPosition: j.springPosition,
    springRotation: j.springRotation,
  };
}

function convertDisplayFrame(d: PmxObject["displayFrames"][number]): PmxDisplayFrameData {
  return {
    name: d.name,
    type: d.isSpecialFrame ? 0 : 1, // 0=root, 1=bone（对齐现有约定）
    elements: d.frames.map((f) => ({ index: f.index, value: f.type })),
  };
}

/** 权威 PmxObject → PmxParseResponse（压缩数组可 transferable；id 由调用方填入） */
export function pmxObjectToResponse(pmx: PmxObject, id: number): PmxParseResponse {
  if (!pmx?.vertices || !pmx?.indices) {
    return { id, ok: false, error: "PmxObject 缺少顶点/索引数据" };
  }
  return {
    id,
    ok: true,
    header: {
      version: pmx.header.version.toFixed(2),
      encoding: pmx.header.encoding === 1 ? "utf-8" : "utf-16",
      additionalDataFlags: pmx.header.additionalVec4Count,
    },
    vertices: convertVertices(pmx.vertices, pmx.header.boneIndexSize),
    faces: { count: pmx.indices.length, indices: Uint32Array.from(pmx.indices) },
    textures: pmx.textures ?? [],
    materials: (pmx.materials ?? []).map(convertMaterial),
    bones: (pmx.bones ?? []).map(convertBone),
    rigidBodies: (pmx.rigidBodies ?? []).map(convertRigidBody),
    joints: (pmx.joints ?? []).map(convertJoint),
    morphs: (pmx.morphs ?? []).map(convertMorph),
    displayFrames: (pmx.displayFrames ?? []).map(convertDisplayFrame),
  };
}
