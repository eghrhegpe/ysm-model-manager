// ===== 3D 场景统计提取器（ADR-131 P0）=====
// 从 three.js 场景图一次 traverse 提取统计（骨骼数/网格数/三角面/材质数/纹理数/表情数），
// 供 mount-preview-core post-build 挂点采集（「能渲染就能出统计」）。
// 纯函数、零视图依赖：只做 traverse 统计，映射进 StatsCardModel 由调用方（视图层）完成。
//
// 约定：
// - 骨骼 = SkinnedMesh.skeleton.bones ∪ 场景中的裸 Bone 对象（去重，不双计）。
// - 三角面 = index 几何取 index count/3；非 index 几何取 position 顶点数/3。
// - 材质/纹理按实例去重（共享同一实例只计 1）。
// - 表情数（morphCount）取 morphTargetInfluences 最长的网格——VRM 表情通常挂单 mesh。
// - Line/Points 不计入网格与三角面（语义上非模型表面）。
//
// 实现陷阱（ADR-131 §3）：texture.image 在异步加载完成前为 null，本提取器只计纹理
// 数量，尺寸由调用方在纹理 onLoad 后补采。

import * as THREE from "three";

/** 场景统计（ADR-131 P0 产出，调用方映射进 StatsCardModel） */
export interface SceneStats {
  /** 骨骼数（SkinnedMesh.skeleton.bones ∪ 裸 Bone，去重） */
  boneCount: number;
  /** 网格数（Mesh/SkinnedMesh，Line/Points 不计） */
  meshCount: number;
  /** 三角面数（index/3 或 position 顶点/3） */
  triangleCount: number;
  /** 材质数（按实例去重） */
  materialCount: number;
  /** 纹理数（按 map 实例去重） */
  textureCount: number;
  /** 表情数（morphTargetInfluences 最长网格的通道数） */
  morphCount: number;
}

/** 一次 traverse 收集统计；roots 接受 Scene 或 Object3D[]（sceneBaseline 差量后的内容层根） */
export function collectSceneStats(roots: THREE.Object3D | THREE.Object3D[]): SceneStats {
  const stats: SceneStats = {
    boneCount: 0,
    meshCount: 0,
    triangleCount: 0,
    materialCount: 0,
    textureCount: 0,
    morphCount: 0,
  };
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const bones = new Set<THREE.Bone>();
  let maxMorph = 0;

  const list = Array.isArray(roots) ? roots : [roots];
  for (const root of list) {
    root.traverse((obj) => {
      // 骨骼：skeleton.bones（SkinnedMesh 自带）与裸 Bone 对象统一收进 Set 去重
      // （鸭子类型对齐 three.js 惯例：isBone / isSkinnedMesh / isMesh）
      if ((obj as THREE.Bone).isBone) {
        bones.add(obj as THREE.Bone);
      }
      const skinned = obj as THREE.SkinnedMesh;
      if (skinned.isSkinnedMesh && skinned.skeleton) {
        for (const b of skinned.skeleton.bones) bones.add(b);
      }

      if (!(obj as THREE.Mesh).isMesh) return; // Line/Points 不算网格
      const mesh = obj as THREE.Mesh;
      stats.meshCount++;

      // 三角面：index 几何 index.length/3；非 index 几何 position 顶点数/3
      const geo = mesh.geometry as THREE.BufferGeometry;
      if (geo) {
        const idx = geo.getIndex();
        if (idx && idx.count > 0) {
          stats.triangleCount += Math.floor(idx.count / 3);
        } else {
          const pos = geo.getAttribute("position");
          if (pos) stats.triangleCount += Math.floor(pos.count / 3);
        }
      }

      // 材质（数组/单实例统一处理，按实例去重）
      const matList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of matList) {
        if (!m) continue;
        materials.add(m);
        const mm = m as THREE.MeshBasicMaterial;
        if (mm.map) textures.add(mm.map);
      }

      // 表情数：morphTargetInfluences 通道数取最长（VRM 表情通常挂单 mesh）
      if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > maxMorph) {
        maxMorph = mesh.morphTargetInfluences.length;
      }
    });
  }

  stats.boneCount = bones.size;
  stats.materialCount = materials.size;
  stats.textureCount = textures.size;
  stats.morphCount = maxMorph;
  return stats;
}
