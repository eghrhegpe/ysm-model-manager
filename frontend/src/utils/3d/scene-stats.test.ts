// 覆盖：collectSceneStats 从 three.js 场景图一次 traverse 提取统计
// （骨骼数 / 网格数 / 三角面 / 材质数 / 纹理数 / 表情数）。
// ADR-131 P0：通用统计提取器，供 mount-preview-core post-build 挂点调用。

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { collectSceneStats, type SceneStats } from "./scene-stats.ts";

/** 构造带 index 的 BufferGeometry（triangleCount 个三角面） */
function makeIndexedGeo(triangles: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(triangles * 3 * 3);
  for (let i = 0; i < triangles * 3; i++) {
    positions[i * 3] = i;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 0;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const idx = new Uint32Array(triangles * 3);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function emptyStats(): SceneStats {
  return { boneCount: 0, meshCount: 0, triangleCount: 0, materialCount: 0, textureCount: 0, morphCount: 0 };
}

describe("collectSceneStats", () => {
  it("空场景 → 全 0", () => {
    expect(collectSceneStats(new THREE.Group())).toEqual(emptyStats());
  });

  it("单个网格：meshCount 1 + 三角面数 + 材质 1", () => {
    const root = new THREE.Group();
    root.add(new THREE.Mesh(makeIndexedGeo(3), new THREE.MeshBasicMaterial()));
    const s = collectSceneStats(root);
    expect(s.meshCount).toBe(1);
    expect(s.triangleCount).toBe(3);
    expect(s.materialCount).toBe(1);
    expect(s.textureCount).toBe(0);
  });

  it("嵌套 Group 递归遍历：多个网格三角面累加", () => {
    const root = new THREE.Group();
    const a = new THREE.Group();
    a.add(new THREE.Mesh(makeIndexedGeo(4), new THREE.MeshBasicMaterial()));
    const b = new THREE.Group();
    b.add(new THREE.Mesh(makeIndexedGeo(6), new THREE.MeshBasicMaterial()));
    root.add(a, b);
    const s = collectSceneStats(root);
    expect(s.meshCount).toBe(2);
    expect(s.triangleCount).toBe(10);
  });

  it("共享同一材质实例 → materialCount 去重为 1", () => {
    const mat = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(makeIndexedGeo(2), mat),
      new THREE.Mesh(makeIndexedGeo(2), mat),
    );
    expect(collectSceneStats(root).materialCount).toBe(1);
  });

  it("材质数组 + 跨网格共享 → 按实例去重计数", () => {
    const m0 = new THREE.MeshBasicMaterial();
    const m1 = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    // mesh0: [m0, m1]，mesh1: [m1]（共享 m1）→ 去重后 2
    root.add(
      new THREE.Mesh(makeIndexedGeo(2), [m0, m1]),
      new THREE.Mesh(makeIndexedGeo(2), [m1]),
    );
    expect(collectSceneStats(root).materialCount).toBe(2);
  });

  it("纹理按 map 实例去重计数（同纹理共享 → 1）", () => {
    const tex = new THREE.Texture();
    const matA = new THREE.MeshBasicMaterial({ map: tex });
    const matB = new THREE.MeshBasicMaterial({ map: tex });
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(makeIndexedGeo(2), matA),
      new THREE.Mesh(makeIndexedGeo(2), matB),
    );
    const s = collectSceneStats(root);
    expect(s.textureCount).toBe(1);
    expect(s.materialCount).toBe(2);
  });

  it("SkinnedMesh：计入网格；skeleton.bones 计入骨骼数", () => {
    const geo = makeIndexedGeo(2);
    const bones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
    const skeleton = new THREE.Skeleton(bones);
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
    mesh.add(bones[0]!, bones[1]!, bones[2]!);
    mesh.bind(skeleton);
    const s = collectSceneStats(mesh);
    expect(s.meshCount).toBe(1);
    expect(s.boneCount).toBe(3);
  });

  it("裸 Bone 对象计入骨骼数（不双计 skeleton.bones）", () => {
    const root = new THREE.Group();
    root.add(new THREE.Bone());
    root.add(new THREE.Bone());
    expect(collectSceneStats(root).boneCount).toBe(2);
  });

  it("表情数取 morph target 最多的网格（VRM 表情挂在单 mesh 上）", () => {
    const root = new THREE.Group();
    const m0 = new THREE.Mesh(makeIndexedGeo(2), new THREE.MeshBasicMaterial());
    m0.morphTargetInfluences = [0, 0, 0, 0, 0]; // 5 个
    const m1 = new THREE.Mesh(makeIndexedGeo(2), new THREE.MeshBasicMaterial());
    m1.morphTargetInfluences = [0, 0, 0]; // 3 个
    root.add(m0, m1);
    expect(collectSceneStats(root).morphCount).toBe(5);
  });

  it("非索引几何：三角面 = position 顶点数 / 3", () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(27), 3)); // 9 顶点 = 3 三角形
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
    expect(collectSceneStats(root).triangleCount).toBe(3);
  });

  it("Line/Points 不计入网格与三角面", () => {
    const root = new THREE.Group();
    root.add(new THREE.Line(makeIndexedGeo(4), new THREE.LineBasicMaterial()));
    root.add(new THREE.Points(makeIndexedGeo(4), new THREE.PointsMaterial()));
    const s = collectSceneStats(root);
    expect(s.meshCount).toBe(0);
    expect(s.triangleCount).toBe(0);
    expect(s.materialCount).toBe(0);
  });
});
