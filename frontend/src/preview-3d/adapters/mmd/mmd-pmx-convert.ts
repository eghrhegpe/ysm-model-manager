// ===== 权威 PMX 解析产物（babylon-mmd PmxObject）→ PmxParseResponse 转换器 =====
// Worker 内用 babylon-mmd 权威解析器（vendor/babylon-mmd/pmxReader.js，@moeru/three-mmd
// 同源内核）解析 PMX，产物 PmxObject 在此转成现有 PmxParseResponse 形状（压缩数组、
// GPU 友好、可 transferable），主线程构建（buildPmxScene / mmd 轻量适配器）零改动。
// 替代自研 PmxReader 双轨解析：解析口径与主线程 MMDLoader 完全一致，消除口径漂移。
import type { PmxObject } from "@/preview-3d/vendor/babylon-mmd/pmxReader.js";
import type {
  PmxBoneData,
  PmxDisplayFrameData,
  PmxJointData,
  PmxMaterialData,
  PmxMorphData,
  PmxParseResponse,
  PmxRigidBodyData,
  PmxVertexData,
} from "./mmd-pmx-parser.worker.ts";

/** PMX 顶点骨骼索引数组宽度选择。PMX 2.0：宽度随头部 boneIndexSize（非 vertexIndexSize）——
 *  否则 >255 骨骼模型的索引写进 Uint8Array 被截断，蒙皮静默损坏 */
function createBoneIndexArray(
  count: number,
  boneIndexSize: number,
): Uint8Array | Uint16Array | Uint32Array {
  if (boneIndexSize <= 1) return new Uint8Array(count * 4);
  if (boneIndexSize === 2) return new Uint16Array(count * 4);
  return new Uint32Array(count * 4);
}

/** 单顶点骨骼索引写入：BDEF1 单骨骼直写首槽；数组形态（BDEF2/4、QDEF、SDEF）原样 4 槽、缺位补零 */
function writeBoneIndices(
  idxArr: Uint8Array | Uint16Array | Uint32Array,
  o: number,
  boneIndices: number | number[],
): void {
  if (typeof boneIndices === "number") {
    idxArr[o] = boneIndices;
    return;
  }
  for (let j = 0; j < 4; j++) idxArr[o + j] = boneIndices[j] ?? 0;
}

/** 单顶点权重展开为 4 列：BDEF1 → [1,0,0,0]；BDEF2/SDEF → [w0,1-w0,0,0]；BDEF4/QDEF → 原样 */
function writeBoneWeights(
  weights: Float32Array,
  o: number,
  bw: PmxObject["vertices"][number]["boneWeight"],
): void {
  if (typeof bw.boneIndices === "number") {
    // BDEF1：单骨骼，权重 1
    weights[o] = 1;
    return;
  }
  if (typeof bw.boneWeights === "number") {
    // BDEF2：w0 + (1-w0)
    weights[o] = bw.boneWeights;
    weights[o + 1] = 1 - bw.boneWeights;
    return;
  }
  if (Array.isArray(bw.boneWeights)) {
    // BDEF4 / QDEF
    for (let j = 0; j < 4; j++) weights[o + j] = bw.boneWeights[j] ?? 0;
    return;
  }
  if (bw.boneWeights && typeof bw.boneWeights.boneWeight0 === "number") {
    // SDEF：主权重 + 补零（近似 BDEF2，SDEF 细节主线程 MMDLoader 路径才完整）
    weights[o] = bw.boneWeights.boneWeight0;
    weights[o + 1] = 1 - bw.boneWeights.boneWeight0;
  }
}

/** 顶点骨骼数据展平为 4 列压缩数组（BDEF4/QDEF 原样；BDEF1/2/SDEF 展开补零） */
function flattenBoneData(
  vertices: PmxObject["vertices"],
  boneIndexSize: number,
): { boneIndices: Uint8Array | Uint16Array | Uint32Array; boneWeights: Float32Array } {
  const count = vertices.length;
  const idxArr = createBoneIndexArray(count, boneIndexSize);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const bw = vertices[i].boneWeight;
    const o = i * 4;
    if (!bw || bw.boneIndices == null) continue; // 防御：坏数据跳过（权重 0，不参与蒙皮）
    writeBoneIndices(idxArr, o, bw.boneIndices);
    writeBoneWeights(weights, o, bw);
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
    // IK 字段仅在 b.ik 存在时附带（exactOptional 收紧后避免显式 undefined 流入可选键）
    ...(b.ik
      ? {
          ikTarget: b.ik.target,
          ikIteration: b.ik.iteration,
          ikRotationConstraint: b.ik.rotationConstraint,
          ikLinks: b.ik.links.map((l) => ({ boneIndex: l.target, hasLimitation: !!l.limitation })),
        }
      : {}),
  };
}

/** 权威解析器 morph 条目（PmxObject["morphs"][number] 别名，供各元素构造器签名复用） */
type PmxMorph = PmxObject["morphs"][number];

/** VertexMorph / BoneMorph：逐元素位移偏移（两型同构，offset 取位移三分量） */
function positionMorphElements(
  idxs: Int32Array,
  positions: Float32Array,
): PmxMorphData["elements"] {
  const elements: PmxMorphData["elements"] = [];
  for (let i = 0; i < idxs.length; i++) {
    elements.push({
      index: idxs[i],
      offset: [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]],
    });
  }
  return elements;
}

/** GroupMorph：组比例（offset 借位存 ratio） */
function groupMorphElements(idxs: Int32Array, ratios: Float32Array): PmxMorphData["elements"] {
  const elements: PmxMorphData["elements"] = [];
  for (let i = 0; i < idxs.length; i++) {
    elements.push({ index: idxs[i], offset: [ratios[i], 0, 0] });
  }
  return elements;
}

/** UvMorph / AdditionalUv：UV 偏移（offset 取前 3 分量） */
function uvMorphElements(idxs: Int32Array, offsets: Float32Array): PmxMorphData["elements"] {
  const elements: PmxMorphData["elements"] = [];
  for (let i = 0; i < idxs.length; i++) {
    elements.push({
      index: idxs[i],
      offset: [offsets[i * 4], offsets[i * 4 + 1], offsets[i * 4 + 2]],
    });
  }
  return elements;
}

/** 按 PMX morph 类型选取元素构造器：守卫顺序即类型判定顺序，对应数据段缺失 → 空元素
 *  （原 if/else-if 链每层都嵌进上一层，深度随分支数递增；改早退守卫后逐条平铺） */
function morphElements(m: PmxMorph, idxs: Int32Array): PmxMorphData["elements"] {
  if (m.type === 1 && m.positions) return positionMorphElements(idxs, m.positions);
  if (m.type === 0 && m.ratios) return groupMorphElements(idxs, m.ratios);
  if (m.type === 2 && m.positions) return positionMorphElements(idxs, m.positions);
  if (m.type >= 3 && m.offsets) return uvMorphElements(idxs, m.offsets);
  return [];
}

function convertMorph(m: PmxMorph): PmxMorphData {
  const idxs = m.indices;
  const elements: PmxMorphData["elements"] = idxs ? morphElements(m, idxs) : [];
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
