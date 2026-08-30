// ===== buildFbxSceneFromData 契约测试（ADR-112 FBX worker）=====
// worker 端 fbxSceneToData 产出纯数据 FbxSceneData → 主线程 buildFbxSceneFromData
// 重建 Three.js 场景。本测试锁定重建契约：几何/材质/骨骼层级/boneInverses/
// bindMatrix/动画轨道类路由/texUrlMap 缺省时不挂纹理。

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildFbxSceneFromData } from "./fbx-parser.ts";
import type { FbxSceneData, FbxSkeletonData } from "./fbx-scene-to-data.ts";

function makeSkeleton(): FbxSkeletonData {
  const boneInverses = new Float32Array(32);
  new THREE.Matrix4().toArray(boneInverses as unknown as number[], 0);
  new THREE.Matrix4().makeTranslation(0, -10, 0).toArray(boneInverses as unknown as number[], 16);
  const bindMatrix = new Float32Array(16);
  new THREE.Matrix4().makeScale(2, 2, 2).toArray(bindMatrix as unknown as number[], 0);
  return {
    bones: [
      { name: "Root", position: [0, 0, 0], quaternion: [0, 0, 0, 1], parent: -1 },
      { name: "Hips", position: [0, 10, 0], quaternion: [0, 0, 0, 1], parent: 0 },
    ],
    boneInverses,
    bindMatrix,
  };
}

function makeSceneData(partial?: Partial<FbxSceneData>): FbxSceneData {
  return {
    nodes: [
      {
        name: "Body",
        parent: -1,
        isMesh: true,
        transform: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
        mesh: {
          name: "Body",
          geometry: {
            position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
            uv: new Float32Array([0, 0, 1, 0, 0, 1]),
            skinIndex: new Uint16Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
            skinWeight: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
            index: new Uint32Array([0, 1, 2]),
          },
          materials: [
            {
              type: "MeshPhongMaterial",
              name: "skin",
              color: [0.1, 0.2, 0.3],
              emissive: [0, 0, 0],
              specular: [1, 1, 1],
              shininess: 32,
              map: "skin.png",
            },
            {
              type: "MeshLambertMaterial",
              name: "shadow",
              color: [0.5, 0.5, 0.5],
              emissive: [0, 0, 0],
              transparent: true,
              opacity: 0.6,
            },
          ],
          hasSkeleton: true,
          skeleton: makeSkeleton(),
        },
      },
    ],
    animations: [
      {
        name: "take_001",
        duration: 1,
        tracks: [
          { name: "Hips.position", times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 1, 0, 0]) },
          { name: "Root.quaternion", times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]) },
          { name: "Body.morphTargetInfluences[0]", times: new Float32Array([0, 1]), values: new Float32Array([0, 1]) },
        ],
      },
    ],
    ...partial,
  };
}

describe("buildFbxSceneFromData", () => {
  it("重建 group：mesh 数量/名称/局部 transform 一致", () => {
    const group = buildFbxSceneFromData(makeSceneData());
    expect(group.children.length).toBe(1);
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.name).toBe("Body");
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("几何属性完整重建：position/normal/uv/index/skinIndex/skinWeight", () => {
    const mesh = buildFbxSceneFromData(makeSceneData()).children[0] as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry;
    expect(Array.from((geo.getAttribute("position") as THREE.BufferAttribute).array as Float32Array)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    expect((geo.getAttribute("normal") as THREE.BufferAttribute).count).toBe(3);
    expect((geo.getAttribute("uv") as THREE.BufferAttribute).count).toBe(3);
    expect(Array.from((geo.getAttribute("skinIndex") as THREE.BufferAttribute).array as Uint16Array)).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
    expect((geo.getAttribute("skinWeight") as THREE.BufferAttribute).count).toBe(4);
    expect(geo.index).not.toBeNull();
    expect(Array.from(geo.index!.array)).toEqual([0, 1, 2]);
  });

  it("材质重建：Phong 参数 / 线性颜色 / 数组材质", () => {
    const mesh = buildFbxSceneFromData(makeSceneData()).children[0] as THREE.Mesh;
    expect(Array.isArray(mesh.material)).toBe(true);
    const materials = mesh.material as THREE.Material[];
    expect(materials.length).toBe(2);
    const phong = materials[0] as THREE.MeshPhongMaterial;
    expect(phong.type).toBe("MeshPhongMaterial");
    expect(phong.name).toBe("skin");
    expect(phong.color.r).toBeCloseTo(0.1, 6);
    expect(phong.color.b).toBeCloseTo(0.3, 6);
    expect(phong.specular.r).toBeCloseTo(1, 6);
    expect(phong.shininess).toBe(32);
    expect(phong.map).toBeNull();
    const lambert = materials[1] as THREE.MeshLambertMaterial;
    expect(lambert.transparent).toBe(true);
    expect(lambert.opacity).toBeCloseTo(0.6, 6);
  });

  it("骨骼层级重建：父子引用 + 根骨骼挂到 mesh", () => {
    const mesh = buildFbxSceneFromData(makeSceneData()).children[0] as THREE.SkinnedMesh;
    expect(mesh.isSkinnedMesh).toBe(true);
    const { skeleton } = mesh;
    expect(skeleton.bones.length).toBe(2);
    expect(skeleton.bones[0].name).toBe("Root");
    expect(skeleton.bones[1].name).toBe("Hips");
    expect(skeleton.bones[1].parent).toBe(skeleton.bones[0]);
    expect(skeleton.bones[0].position.toArray()).toEqual([0, 0, 0]);
    expect(skeleton.bones[1].position.toArray()).toEqual([0, 10, 0]);
    expect(mesh.children).toContain(skeleton.bones[0]);
  });

  it("boneInverses 透传：第二根骨骼逆矩阵平移项 = -10", () => {
    const mesh = buildFbxSceneFromData(makeSceneData()).children[0] as THREE.SkinnedMesh;
    const inv = mesh.skeleton.boneInverses;
    expect(inv.length).toBe(2);
    expect(inv[0].elements[0]).toBeCloseTo(1, 6);
    expect(inv[1].elements[13]).toBeCloseTo(-10, 6);
  });

  it("bindMatrix 透传：SkinnedMesh.bindMatrix 与序列化值一致", () => {
    const mesh = buildFbxSceneFromData(makeSceneData()).children[0] as THREE.SkinnedMesh;
    const src = makeSkeleton().bindMatrix;
    expect(Array.from(mesh.bindMatrix.elements)).toEqual(Array.from(src));
  });

  it("动画重建：clip 挂 group.animations，轨道类型按后缀路由", () => {
    const group = buildFbxSceneFromData(makeSceneData());
    const anims = (group as THREE.Group & { animations: THREE.AnimationClip[] }).animations;
    expect(anims.length).toBe(1);
    const clip = anims[0];
    expect(clip.name).toBe("take_001");
    expect(clip.duration).toBe(1);
    expect(clip.tracks.length).toBe(3);
    expect(clip.tracks[0]).toBeInstanceOf(THREE.VectorKeyframeTrack);
    expect(clip.tracks[0].name).toBe("Hips.position");
    expect(clip.tracks[1]).toBeInstanceOf(THREE.QuaternionKeyframeTrack);
    expect(clip.tracks[1].name).toBe("Root.quaternion");
    expect(clip.tracks[2]).toBeInstanceOf(THREE.NumberKeyframeTrack);
  });

  it("空数据退化：无节点无动画返回空 group", () => {
    const group = buildFbxSceneFromData({ nodes: [], animations: [] });
    expect(group.children.length).toBe(0);
    expect((group as THREE.Group & { animations: THREE.AnimationClip[] }).animations.length).toBe(0);
  });

  it("普通 Mesh（无骨骼）不构建 Skeleton", () => {
    const scene = makeSceneData();
    scene.nodes[0].mesh!.hasSkeleton = false;
    scene.nodes[0].mesh!.skeleton = undefined;
    const mesh = buildFbxSceneFromData(scene).children[0] as THREE.Mesh;
    expect(mesh.type).toBe("Mesh");
    expect((mesh as THREE.Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh).not.toBe(true);
  });

  it("节点层级重建：mesh 挂到祖先 Group 下，祖先变换保留（发现2）", () => {
    const scene = makeSceneData({
      nodes: [
        {
          name: "Armature",
          parent: -1,
          isMesh: false,
          transform: { position: [10, 0, 0], quaternion: [0, 0, 0, 1], scale: [2, 2, 2] },
        },
        {
          name: "Body",
          parent: 0,
          isMesh: true,
          transform: { position: [1, 2, 3], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
          mesh: makeSceneData().nodes[0].mesh,
        },
      ],
      animations: [],
    });
    const group = buildFbxSceneFromData(scene);
    expect(group.children.length).toBe(1);
    const armature = group.children[0] as THREE.Group;
    expect(armature.name).toBe("Armature");
    expect(armature.position.toArray()).toEqual([10, 0, 0]);
    expect(armature.children.length).toBe(1);
    const mesh = armature.children[0] as THREE.Mesh;
    expect(mesh.name).toBe("Body");
    // 祖先变换参与世界矩阵（挂到 Group 下而非根），蒙皮 bind 不丢祖先链路
    armature.updateMatrixWorld(true);
    expect(mesh.matrixWorld.elements[0]).toBeCloseTo(2, 6);
  });

  it("morph 目标重建：geometry.morphAttributes.position + morphTargetsRelative（发现4）", () => {
    const scene = makeSceneData();
    scene.nodes[0].mesh!.geometry.morphTargets = [
      { name: "smile", positions: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]) },
    ];
    const mesh = buildFbxSceneFromData(scene).children[0] as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry;
    expect(geo.morphTargetsRelative).toBe(true);
    const morphPos = geo.morphAttributes.position;
    expect(morphPos).toBeDefined();
    expect(morphPos!.length).toBe(1);
    expect(morphPos![0].name).toBe("smile");
    expect(Array.from(morphPos![0].array as Float32Array)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it("texUrlMap 应用：map + normalMap 两槽位分别挂纹理（发现1）", async () => {
    // happy-dom 无真实图片解码，TextureLoader.load 的 onLoad 永不触发 → mock 同步回调
    const loadSpy = vi
      .spyOn(THREE.TextureLoader.prototype, "load")
      .mockImplementation(function (this: THREE.TextureLoader, _url: string, onLoad) {
        // 返回类型断言收敛：Texture<unknown> → 原型签名的 Texture<HTMLImageElement>
        const tex = new THREE.Texture() as ReturnType<typeof THREE.TextureLoader.prototype.load>;
        onLoad?.(tex);
        return tex;
      });
    try {
      const scene = makeSceneData();
      scene.nodes[0].mesh!.materials[0] = {
        type: "MeshPhongMaterial",
        name: "skin",
        color: [0.1, 0.2, 0.3],
        emissive: [0, 0, 0],
        map: "body.png",
        normalMap: "body_n.png",
      };
      // 1×1 像素 PNG（最小合法文件）
      const pngB64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const toBlob = (): string => {
        const bin = atob(pngB64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
      };
      const texUrlMap = new Map([
        ["body.png", toBlob()],
        ["body_n.png", toBlob()],
      ]);
      const group = buildFbxSceneFromData(scene, { texUrlMap });
      const mesh = group.children[0] as THREE.Mesh;
      const mat = mesh.material as THREE.MeshPhongMaterial;
      // mock 同步回调 → 无需等待真实异步加载
      expect(mat.map).not.toBeNull();
      expect(mat.normalMap).not.toBeNull();
      expect(loadSpy).toHaveBeenCalledTimes(2);
    } finally {
      loadSpy.mockRestore();
    }
  });
});