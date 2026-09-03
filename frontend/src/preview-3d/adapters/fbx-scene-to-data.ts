// ===== FBX worker 场景序列化（ADR-112）=====
// FBXLoader.parse()（three/addons 官方 FBXLoader）直接产出 THREE.Group，
// worker 内无法跨线程回传 THREE 对象：fbxSceneToData 把 Group 抽成纯数据
// （节点层级 / 几何数组 / 材质参数 / 骨骼 + boneInverses / 动画轨道 / 纹理文件名 /
// morph 目标），主线程凭 FbxSceneData 重建场景。纹理文件名由 worker 端 manager handler
// 经 captureTextureName 登记（镜像 mmd-pmx-parser.worker.ts 的纯数据契约）。
//
// 层级契约（codereview 批次2）：FBX 场景是完整模型树——mesh 常挂在携带祖先变换的
// Group 下（Null/LimbNode/根节点），动画轨道可命名非 mesh 节点。序列化保留全部
// 非骨骼节点（Group + Mesh）的父子索引与局部变换，重建端按树形还原，避免展平
// 丢祖先变换（放置错位 / 蒙皮 bind 错位）。骨骼节点不序列化——由 skeleton.bones
// 数据单独重建并挂到 mesh（既有契约，动画轨道经名字可达）。

import * as THREE from "three";

export interface FbxGeometryData {
  position: Float32Array;
  normal?: Float32Array;
  uv?: Float32Array;
  uv2?: Float32Array;
  color?: Float32Array;
  skinIndex?: Uint16Array;
  skinWeight?: Float32Array;
  index?: Uint32Array;
  /** morph 目标（FBX BlendShape → 位置增量 + 名称；重建时 morphTargetsRelative=true） */
  morphTargets?: Array<{ name: string; positions: Float32Array }>;
}

export interface FbxMaterialData {
  type: string;
  name?: string | undefined;
  color: number[];
  specular?: number[];
  shininess?: number;
  emissive: number[];
  transparent?: boolean;
  opacity?: number;
  map?: string;
  normalMap?: string;
  specularMap?: string;
  alphaMap?: string;
  emissiveMap?: string;
}

export interface FbxSkeletonData {
  bones: Array<{
    name: string;
    position: number[];
    quaternion: number[];
    parent: number;
  }>;
  boneInverses: Float32Array;
  bindMatrix: Float32Array;
}

export interface FbxMeshData {
  name: string;
  geometry: FbxGeometryData;
  materials: FbxMaterialData[];
  hasSkeleton: boolean;
  skeleton?: FbxSkeletonData | undefined;
}

/** 场景节点（非骨骼：Group 或 Mesh；parent = nodes 下标，-1 = 根） */
interface FbxNodeData {
  name: string;
  parent: number;
  isMesh: boolean;
  transform: {
    position: number[];
    quaternion: number[];
    scale: number[];
  };
  /** isMesh=true 时的网格数据 */
  mesh?: FbxMeshData | undefined;
}

interface FbxClipData {
  name: string;
  duration: number;
  tracks: Array<{
    name: string;
    times: Float32Array;
    values: Float32Array;
  }>;
}

export interface FbxSceneData {
  nodes: FbxNodeData[];
  animations: FbxClipData[];
  /** 根容器自身的局部变换（vendor FBXLoader 把 Z-up→Y-up 矫正设在返回根组上，
   *  不随数据回传则重建端恒等根 → worker 路径 Z-up FBX 侧躺，与主线程分叉，审核 P2） */
  rootTransform?: {
    position: number[];
    quaternion: number[];
    scale: number[];
  };
}

const textureFileNames = new WeakMap<THREE.Texture, string>();

export function captureTextureName(tex: THREE.Texture, fileName: string): void {
  textureFileNames.set(tex, fileName);
}

function toColor(c: unknown): number[] {
  const color = c as THREE.Color;
  return color ? [color.r, color.g, color.b] : [1, 1, 1];
}

function serializeMaterial(mat: THREE.Material): FbxMaterialData {
  const anyMat = mat as unknown as Record<string, unknown>;
  const out: FbxMaterialData = {
    type: mat.type,
    name: typeof anyMat.name === "string" ? (anyMat.name as string) : undefined,
    color: toColor(anyMat.color),
    emissive: toColor(anyMat.emissive),
  };
  const texNameOf = (key: string): string | undefined => {
    const tex = anyMat[key] as THREE.Texture | undefined;
    return tex && typeof tex.isTexture === "boolean" ? textureFileNames.get(tex) : undefined;
  };
  const optional = (key: string, write: (v: unknown) => void): void => {
    const v = anyMat[key];
    if (v !== undefined && v !== null) write(v);
  };
  optional("specular", (v) => { out.specular = toColor(v); });
  optional("shininess", (v) => { out.shininess = v as number; });
  optional("transparent", (v) => { out.transparent = v as boolean; });
  optional("opacity", (v) => { out.opacity = v as number; });
  for (const key of ["map", "normalMap", "specularMap", "alphaMap", "emissiveMap"] as const) {
    const name = texNameOf(key);
    if (name) out[key] = name;
  }
  return out;
}

function serializeGeometry(geo: THREE.BufferGeometry): FbxGeometryData {
  const getAttr = (
    name: string,
    ctor: { from(a: ArrayLike<number>): Float32Array | Uint16Array | Uint32Array },
  ): (Float32Array | Uint16Array | Uint32Array) | undefined => {
    const attr = geo.getAttribute(name);
    return attr ? ctor.from(attr.array as ArrayLike<number>) : undefined;
  };
  const out: FbxGeometryData = { position: getAttr("position", Float32Array) as Float32Array };
  for (const name of ["normal", "uv", "uv2", "color", "skinWeight"] as const) {
    const arr = getAttr(name, Float32Array);
    if (arr) (out as unknown as Record<string, unknown>)[name] = arr;
  }
  const skinIndex = geo.getAttribute("skinIndex");
  if (skinIndex) out.skinIndex = Uint16Array.from(skinIndex.array as ArrayLike<number>);
  const index = geo.getIndex();
  if (index) out.index = Uint32Array.from(index.array as ArrayLike<number>);
  // morph 目标（FBX BlendShape）：vendor addMorphTargets 以 position 增量形式
  // 存入 geometry.morphAttributes.position（morphTargetsRelative=true），每项带名称
  const morphAttrs = geo.morphAttributes?.position;
  if (morphAttrs && morphAttrs.length > 0) {
    out.morphTargets = morphAttrs.map((attr, i) => ({
      name: (attr.name as string) || `morph${i}`,
      positions: Float32Array.from(attr.array as ArrayLike<number>),
    }));
  }
  return out;
}

function serializeSkeleton(mesh: THREE.SkinnedMesh): FbxSkeletonData {
  const skeleton = mesh.skeleton;
  const indexOf = new Map<THREE.Object3D, number>();
  skeleton.bones.forEach((b, i) => indexOf.set(b, i));
  return {
    bones: skeleton.bones.map((b) => ({
      name: b.name,
      position: [b.position.x, b.position.y, b.position.z],
      quaternion: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
      parent: b.parent ? (indexOf.get(b.parent) ?? -1) : -1,
    })),
    boneInverses: Float32Array.from(skeleton.boneInverses.flatMap((m) => Array.from(m.elements))),
    bindMatrix: Float32Array.from(mesh.bindMatrix.elements),
  };
}

function serializeMesh(mesh: THREE.Mesh): FbxMeshData {
  const materialsArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const geo = mesh.geometry as THREE.BufferGeometry;
  const out: FbxMeshData = {
    name: mesh.name,
    geometry: serializeGeometry(geo),
    materials: materialsArray
      .filter((m): m is THREE.Material => Boolean(m))
      .map((m) => serializeMaterial(m)),
    hasSkeleton: false,
  };
  const skinned = mesh as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh && skinned.skeleton && skinned.skeleton.bones.length > 0) {
    out.hasSkeleton = true;
    out.skeleton = serializeSkeleton(skinned);
  }
  return out;
}

/** 判定是否保留为场景节点：Group（非骨骼）与 Mesh；灯光/相机等旁路对象不参与重建 */
function isSceneNode(obj: THREE.Object3D): boolean {
  if ((obj as THREE.Bone).isBone) return false;
  if ((obj as THREE.Mesh).isMesh) return true;
  return (obj as THREE.Group).isGroup === true;
}

export function fbxSceneToData(group: THREE.Object3D): FbxSceneData {
  // 先序遍历收集节点 + 建 object→index 映射（父索引据此解析；根容器自身不序列化——
  // 重建端新建根 Group，根容器作为子节点会多一层无意义嵌套；被跳过的骨骼/灯光
  // 作为父时映射缺失 → 子节点挂到 -1（根），退化为展平但保留自身变换）
  const order: THREE.Object3D[] = [];
  const indexOf = new Map<THREE.Object3D, number>();
  group.traverse((obj) => {
    if (obj === group) return;
    if (isSceneNode(obj)) {
      indexOf.set(obj, order.length);
      order.push(obj);
    }
  });
  const nodes: FbxNodeData[] = order.map((obj) => {
    const node: FbxNodeData = {
      name: obj.name,
      parent: obj.parent ? (indexOf.get(obj.parent) ?? -1) : -1,
      isMesh: (obj as THREE.Mesh).isMesh === true,
      transform: {
        position: [obj.position.x, obj.position.y, obj.position.z],
        quaternion: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
        scale: [obj.scale.x, obj.scale.y, obj.scale.z],
      },
    };
    if (node.isMesh) node.mesh = serializeMesh(obj as THREE.Mesh);
    return node;
  });
  const anims = (group as THREE.Object3D & { animations?: THREE.AnimationClip[] }).animations;
  return {
    nodes,
    rootTransform: {
      position: [group.position.x, group.position.y, group.position.z],
      quaternion: [group.quaternion.x, group.quaternion.y, group.quaternion.z, group.quaternion.w],
      scale: [group.scale.x, group.scale.y, group.scale.z],
    },
    animations: (anims ?? []).map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map((track) => ({
        name: track.name,
        times: track.times as Float32Array,
        values: track.values as Float32Array,
      })),
    })),
  };
}
