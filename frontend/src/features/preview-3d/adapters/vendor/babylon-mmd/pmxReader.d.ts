// babylon-mmd pmxReader 轻量类型声明（vendor .js 无类型，供转换器/worker 引用）。
// 仅声明转换器所需字段，未覆盖的复杂字段用 any 兜底（数据来自字节解析，边界类型由转换器保证）。

export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface PmxHeader {
  signature: string;
  version: number;
  globalsCount: number;
  encoding: number; // 0=UTF-16LE 1=UTF-8 2=ShiftJis
  additionalVec4Count: number;
  vertexIndexSize: number;
  textureIndexSize: number;
  materialIndexSize: number;
  boneIndexSize: number;
  morphIndexSize: number;
  rigidBodyIndexSize: number;
}

export interface PmxVertex {
  position: Vec3;
  normal: Vec3;
  uv: [number, number];
  additionalVec4: Vec4[];
  weightType: number; // 0=BDEF1 1=BDEF2 2=BDEF4 3=SDEF 4=QDEF
  boneWeight: {
    boneIndices: number | number[];
    boneWeights: number | number[] | { boneWeight0: number; c: Vec3; r0: Vec3; r1: Vec3 } | null;
  };
  edgeScale: number;
}

export interface PmxMaterial {
  name: string;
  englishName: string;
  diffuse: Vec4;
  specular: Vec3;
  shininess: number;
  ambient: Vec3;
  flag: number;
  edgeColor: Vec4;
  edgeSize: number;
  textureIndex: number;
  sphereTextureIndex: number;
  sphereTextureMode: number;
  isSharedToonTexture: boolean;
  toonTextureIndex: number;
  comment: string;
  indexCount: number;
}

export interface PmxBone {
  name: string;
  englishName: string;
  position: Vec3;
  parentBoneIndex: number;
  transformOrder: number;
  flag: number; // Bone.Flag 位（IsIkEnabled=32）
  tailPosition: number | Vec3;
  appendTransform?: { parentIndex: number; ratio: number };
  axisLimit?: Vec3;
  localVector?: { x: Vec3; z: Vec3 };
  externalParentTransform?: number;
  ik?: {
    target: number;
    iteration: number;
    rotationConstraint: number;
    links: Array<{ target: number; limitation?: { minimumAngle: Vec3; maximumAngle: Vec3 } }>;
  };
}

export interface PmxMorph {
  name: string;
  englishName: string;
  category: number;
  type: number; // Morph.Type：0=group 1=vertex 2=bone 3=uv 4-7=additional uv 8=material 9=flip 10=impulse
  indices?: Int32Array;
  ratios?: Float32Array;
  positions?: Float32Array;
  rotations?: Float32Array;
  offsets?: Float32Array;
  elements?: unknown[];
}

export interface PmxDisplayFrame {
  name: string;
  englishName: string;
  isSpecialFrame: boolean;
  frames: Array<{ type: number; index: number }>;
}

export interface PmxRigidBody {
  name: string;
  englishName: string;
  boneIndex: number;
  collisionGroup: number;
  collisionMask: number;
  shapeType: number;
  shapeSize: Vec3;
  shapePosition: Vec3;
  shapeRotation: Vec3;
  mass: number;
  linearDamping: number;
  angularDamping: number;
  repulsion: number;
  friction: number;
  physicsMode: number;
}

export interface PmxJoint {
  name: string;
  englishName: string;
  type: number;
  rigidbodyIndexA: number;
  rigidbodyIndexB: number;
  position: Vec3;
  rotation: Vec3;
  positionMin: Vec3;
  positionMax: Vec3;
  rotationMin: Vec3;
  rotationMax: Vec3;
  springPosition: Vec3;
  springRotation: Vec3;
}

export interface PmxObject {
  header: PmxHeader;
  vertices: PmxVertex[];
  indices: Uint8Array | Uint16Array | Int32Array;
  textures: string[];
  materials: PmxMaterial[];
  bones: PmxBone[];
  morphs: PmxMorph[];
  displayFrames: PmxDisplayFrame[];
  rigidBodies: PmxRigidBody[];
  joints: PmxJoint[];
  softBodies: unknown[];
}

export declare class PmxReader {
  static ParseAsync(data: ArrayBuffer, logger?: unknown): Promise<PmxObject>;
}
