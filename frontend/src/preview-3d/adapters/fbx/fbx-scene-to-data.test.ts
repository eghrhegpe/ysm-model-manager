// ===== FBX worker 场景序列化测试（fbxSceneToData）=====
// 背景：FBXLoader.parse()（three/addons 官方 FBXLoader）直接产出 THREE.Group，
// worker 内无法跨线程回传 THREE 对象，须先经 fbxSceneToData 抽成纯数据
// （几何数组 / 骨骼 / boneInverses / 动画轨道 / 纹理文件名），主线程再重建。
// 本测试构造合成 Group（与 worker 内 FBXLoader 产物同构：SkinnedMesh 已 bind、
// Phong 材质、纹理经 captureTextureName 登记、动画挂 group.animations），
// 端到端验证序列化形状，与主线程重建契约零漂移。
// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { fbxSceneToData, captureTextureName, type FbxSceneData } from "./fbx-scene-to-data.ts";

/** 取场景数据中首个 mesh 节点（新契约：mesh 内嵌在 nodes 的 isMesh 节点上） */
function firstMesh(data: FbxSceneData): NonNullable<FbxSceneData["nodes"][number]["mesh"]> {
  const node = data.nodes.find((n) => n.isMesh);
  if (!node?.mesh) throw new Error("无 mesh 节点");
  return node.mesh;
}

/** 合成一个带 position 的 BufferGeometry 的最小网格 */
function plainMesh(meshName = "mesh0"): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const mat = new THREE.MeshPhongMaterial({ color: 0xff0000, specular: 0x222222, shininess: 30 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = meshName;
  return mesh;
}

/** 合成一个已 bind 的 SkinnedMesh（2 骨骼 + 手写 boneInverses） */
function skinnedMesh(): THREE.SkinnedMesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0]), 4));
  const root = new THREE.Bone();
  root.name = "Root";
  root.position.set(0, 0, 0);
  const child = new THREE.Bone();
  child.name = "Child";
  child.position.set(0, 10, 0);
  root.add(child);
  const bones = [root, child];
  const boneInverses = [
    new THREE.Matrix4(),
    new THREE.Matrix4().makeTranslation(0, -10, 0),
  ];
  const skeleton = new THREE.Skeleton(bones, boneInverses);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshPhongMaterial({ color: 0x00ff00 }));
  mesh.name = "skinned";
  // 传 bindMatrix：避免 bind() 无参时 calculateInverses 覆盖手写 boneInverses
  mesh.bind(skeleton, new THREE.Matrix4());
  return mesh;
}

describe("fbxSceneToData — 几何/材质/纹理文件名", () => {
  it("空组 → 空数据（无节点无动画）", () => {
    const data = fbxSceneToData(new THREE.Group());
    expect(data.nodes).toEqual([]);
    expect(data.animations).toEqual([]);
  });

  it("普通 Mesh：position/normal/uv/index 数组 + local transform 保留", () => {
    const mesh = plainMesh();
    mesh.position.set(1, 2, 3);
    const group = new THREE.Group();
    group.add(mesh);
    const data = fbxSceneToData(group);
    expect(data.nodes).toHaveLength(1); // 根容器不序列化，仅 mesh
    const meshNode = data.nodes[0];
    expect(meshNode.isMesh).toBe(true);
    const m = meshNode.mesh!;
    expect(m.name).toBe("mesh0");
    expect(meshNode.transform.position).toEqual([1, 2, 3]);
    expect(meshNode.transform.quaternion).toEqual([0, 0, 0, 1]);
    expect(meshNode.transform.scale).toEqual([1, 1, 1]);
    expect(Array.from(m.geometry.position)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(m.geometry.normal!)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(Array.from(m.geometry.uv!)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(Array.from(m.geometry.index!)).toEqual([0, 1, 2]);
    expect(m.hasSkeleton).toBe(false);
  });

  it("Phong 材质参数抽取：color/specular/shininess/emissive", () => {
    const group = new THREE.Group();
    const mesh = plainMesh();
    const mat = mesh.material as THREE.MeshPhongMaterial;
    mat.color.set(1, 0.5, 0.25);
    mat.specular.set(0.2, 0.2, 0.2);
    mat.shininess = 40;
    mat.emissive.set(0.1, 0.1, 0);
    group.add(mesh);
    const data = fbxSceneToData(group);
    expect(firstMesh(data).materials[0]).toMatchObject({
      type: "MeshPhongMaterial",
      color: [1, 0.5, 0.25],
      specular: [0.2, 0.2, 0.2],
      shininess: 40,
      emissive: [0.1, 0.1, 0],
    });
  });

  it("纹理文件名抽取：captureTextureName 登记 → 材质 map/normalMap 序列化为文件名", () => {
    const group = new THREE.Group();
    const mesh = plainMesh();
    const mat = mesh.material as THREE.MeshPhongMaterial;
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    captureTextureName(map, "body_diffuse.png");
    captureTextureName(normalMap, "body_normal.png");
    mat.map = map;
    mat.normalMap = normalMap;
    group.add(mesh);
    const data = fbxSceneToData(group);
    expect(firstMesh(data).materials[0].map).toBe("body_diffuse.png");
    expect(firstMesh(data).materials[0].normalMap).toBe("body_normal.png");
  });

  it("多材质数组：逐项序列化（FBX multi-material）", () => {
    const group = new THREE.Group();
    const mesh = plainMesh();
    const m0 = new THREE.MeshPhongMaterial();
    m0.color.setRGB(0.1, 0.2, 0.3);
    const m1 = new THREE.MeshPhongMaterial();
    m1.color.setRGB(0.4, 0.5, 0.6);
    mesh.material = [m0, m1];
    group.add(mesh);
    const data = fbxSceneToData(group);
    expect(firstMesh(data).materials).toHaveLength(2);
    expect(firstMesh(data).materials[0].color).toEqual([0.1, 0.2, 0.3]);
    expect(firstMesh(data).materials[1].color).toEqual([0.4, 0.5, 0.6]);
  });
});

describe("fbxSceneToData — 骨骼（SkinnedMesh borrow 模式）", () => {
  it("骨骼层级 + boneInverses + bindMatrix：重建可免算逆矩阵", () => {
    const group = new THREE.Group();
    group.add(skinnedMesh());
    const data = fbxSceneToData(group);
    const m = firstMesh(data);
    expect(m.hasSkeleton).toBe(true);
    expect(m.skeleton).toBeDefined();
    expect(m.skeleton!.bones).toHaveLength(2);
    expect(m.skeleton!.bones[0]).toMatchObject({ name: "Root", parent: -1 });
    expect(m.skeleton!.bones[1]).toMatchObject({ name: "Child", parent: 0 });
    expect(m.skeleton!.bones[1].position).toEqual([0, 10, 0]);
    expect(m.skeleton!.boneInverses).toBeInstanceOf(Float32Array);
    expect(m.skeleton!.boneInverses.length).toBe(32); // 2 × 16 矩阵元素
    // makeTranslation(0,-10,0) 的逆 = 上移 10：整体偏移 16+13 → -10
    expect(m.skeleton!.boneInverses[29]).toBeCloseTo(-10);
    expect(m.skeleton!.bindMatrix).toBeInstanceOf(Float32Array);
    expect(m.skeleton!.bindMatrix.length).toBe(16);
  });

  it("skinIndex/skinWeight 随几何序列化（蒙皮权重数据）", () => {
    const group = new THREE.Group();
    group.add(skinnedMesh());
    const data = fbxSceneToData(group);
    const g = firstMesh(data).geometry;
    expect(g.skinIndex).toBeInstanceOf(Uint16Array);
    expect(Array.from(g.skinIndex!)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(g.skinWeight).toBeInstanceOf(Float32Array);
    expect(Array.from(g.skinWeight!)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0]);
  });
});

describe("fbxSceneToData — 节点层级（发现2）", () => {
  it("祖先 Group 保留：mesh 的 parent 指向 Armature 节点，transform 独立序列化", () => {
    const mesh = plainMesh();
    mesh.position.set(1, 2, 3);
    const armature = new THREE.Group();
    armature.name = "Armature";
    armature.position.set(10, 0, 0);
    armature.add(mesh);
    const group = new THREE.Group();
    group.add(armature);
    const data = fbxSceneToData(group);
    // 根容器不序列化 → Armature(0) → mesh(1)
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0].isMesh).toBe(false);
    expect(data.nodes[0].name).toBe("Armature");
    expect(data.nodes[0].parent).toBe(-1);
    expect(data.nodes[0].transform.position).toEqual([10, 0, 0]);
    const meshNode = data.nodes[1];
    expect(meshNode.isMesh).toBe(true);
    expect(meshNode.parent).toBe(0); // 挂在 Armature 下，非根
    expect(meshNode.transform.position).toEqual([1, 2, 3]);
  });

  it("morph 目标序列化：morphAttributes.position 增量 + 名称（发现4）", () => {
    const mesh = plainMesh();
    const geo = mesh.geometry as THREE.BufferGeometry;
    geo.morphTargetsRelative = true;
    const smile = new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 3);
    smile.name = "smile";
    geo.morphAttributes.position = [smile];
    const group = new THREE.Group();
    group.add(mesh);
    const data = fbxSceneToData(group);
    expect(firstMesh(data).geometry.morphTargets).toEqual([
      { name: "smile", positions: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]) },
    ]);
  });
});

describe("fbxSceneToData — 动画（group.animations 内嵌 clip）", () => {
  it("clip 轨道序列化：position/quaternion/number 三种轨道", () => {
    const group = new THREE.Group();
    group.add(plainMesh());
    const clip = new THREE.AnimationClip("Take 001", 2, [
      new THREE.VectorKeyframeTrack("Child.position", [0, 1], [0, 10, 0, 5, 10, 0]),
      new THREE.QuaternionKeyframeTrack("Root.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0.707106, 0.707106]),
      new THREE.NumberKeyframeTrack("Child.morphTargetInfluences", [0, 1], [0, 1]),
    ]);
    (group as unknown as { animations: THREE.AnimationClip[] }).animations = [clip];
    const data = fbxSceneToData(group);
    expect(data.animations).toHaveLength(1);
    const a = data.animations[0];
    expect(a.name).toBe("Take 001");
    expect(a.duration).toBe(2);
    expect(a.tracks).toHaveLength(3);
    expect(a.tracks[0].name).toBe("Child.position");
    expect(Array.from(a.tracks[0].times)).toEqual([0, 1]);
    expect(Array.from(a.tracks[0].values)).toEqual([0, 10, 0, 5, 10, 0]);
    expect(a.tracks[1].name).toBe("Root.quaternion");
    expect(a.tracks[1].values[6]).toBeCloseTo(0.707106, 4);
    expect(a.tracks[1].values[7]).toBeCloseTo(0.707106, 4);
    expect(a.tracks[2].name).toBe("Child.morphTargetInfluences");
    expect(Array.from(a.tracks[2].values)).toEqual([0, 1]);
  });

  it("多 clip：逐项序列化", () => {
    const group = new THREE.Group();
    const c1 = new THREE.AnimationClip("a", 1, [new THREE.NumberKeyframeTrack("N.x", [0], [1])]);
    const c2 = new THREE.AnimationClip("b", 2, [new THREE.NumberKeyframeTrack("N.x", [0, 1], [1, 2])]);
    (group as unknown as { animations: THREE.AnimationClip[] }).animations = [c1, c2];
    const data = fbxSceneToData(group);
    expect(data.animations.map((c) => c.name)).toEqual(["a", "b"]);
    expect(data.animations[1].tracks[0].values).toEqual(new Float32Array([1, 2]));
  });
});