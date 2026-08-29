// ===== ysm-object.test.ts — buildYsmObject 成品的可见性/材质契约 =====
// 修复回归守卫：确保经 buildYsmObject（含不透明烘焙批 addMeshToBoneGroup）
// 产出的**所有** Mesh 都满足：
//   1) frustumCulled === false（关闭 Three.js 内置 mesh 级视锥，交给外层 Group 级）
//   2) 材质 side === THREE.DoubleSide（对齐 architecture.md 材质标准 / YSMViewer 双面）
// 防止脸部薄板 / 车部件"镜头转动消失"回归。
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildYsmObject, type YsmObjectHandle } from "./ysm-object.ts";
import type { Spec3D } from "./model3d.ts";

/** 构造含单 quad cube 的最小 Spec3D（无纹理 → opaque → 走烘焙批路径） */
function makeMinSpec(): Spec3D {
  return {
    models: [
      {
        id: "main",
        name: "main",
        bones: [{ id: "head", name: "head", localPosition: [0, 0, 0], localRotation: [0, 0, 0, 1] }],
        meshGroups: [
          {
            id: "head_0",
            boneId: "head",
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
            uvs: [0, 0, 1, 0, 0, 1, 1, 1],
            indices: [0, 2, 1, 2, 3, 1],
            texIdx: 0,
            localPosition: [0, 0, 0],
            localRotation: [0, 0, 0, 1],
          },
        ],
      },
    ],
  };
}

function collectMeshes(handle: YsmObjectHandle): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  handle.rootGroup.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

describe("buildYsmObject 成品见质性/材质契约", () => {
  it("所有 mesh（含不透明烘焙批）frustumCulled=false 且材质 DoubleSide", () => {
    const handle = buildYsmObject(makeMinSpec(), [], new Map(), 0);
    const meshes = collectMeshes(handle);
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(m.frustumCulled).toBe(false);
      expect((m.material as THREE.MeshBasicMaterial).side).toBe(THREE.DoubleSide);
    }
  });
});
// ===== 覆盖率补强：glow / 组件纹理 / multiModel / blend 分桶 / API 面板 =====
import { describe as d2 } from "vitest";

function blendTexture(): THREE.Texture {
  // 2x2 RGBA：25% 半透明 → blend 判定（texture-alpha 阈值 5%）
  const data = new Uint8Array([
    10, 20, 30, 255, 40, 50, 60, 255,
    70, 80, 90, 255, 0, 0, 0, 128,
  ]);
  const tex = new THREE.DataTexture(data, 2, 2);
  tex.format = THREE.RGBAFormat;
  tex.needsUpdate = true;
  return tex;
}

d2("buildYsmObject — 分支补强", () => {
  it("glow 骨骼建立反查表（b.glow → glowByBoneId）且不炸", () => {
    const spec = makeMinSpec();
    (spec.models![0].bones![0] as { glow?: boolean }).glow = true;
    const handle = buildYsmObject(spec, [], new Map(), 0);
    expect(handle.getModelGroupCount()).toBe(1);
  });

  it("meshGroups 为空的模型 → continue 跳过（不产生 mesh）", () => {
    const spec = makeMinSpec();
    spec.models![0].meshGroups = [];
    const handle = buildYsmObject(spec, [], new Map(), 0);
    expect(collectMeshes(handle)).toHaveLength(0);
    expect(handle.getModelGroupCount()).toBe(1);
  });

  it("组件纹理 Map 分支 → 组件局部槽 0 分类 + bindArr 传组件数组", () => {
    const tex = new THREE.Texture();
    const compMap = new Map<string, (THREE.Texture | null)[]>([["main", [tex]]]);
    const handle = buildYsmObject(makeMinSpec(), [], compMap, 7);
    const meshes = collectMeshes(handle);
    expect(meshes.length).toBeGreaterThan(0);
  });

  it("multiModel → textureIndex 走 mesh.texIdx（两模型各自合并）", () => {
    const spec = makeMinSpec();
    const second = JSON.parse(JSON.stringify(spec.models![0])) as NonNullable<typeof spec.models>[0];
    second.id = "second";
    second.name = "second";
    second.bones![0].id = "head2";
    second.bones![0].name = "head2";
    second.meshGroups![0].boneId = "head2";
    second.meshGroups![0].texIdx = 1;
    spec.models!.push(second);
    const handle = buildYsmObject(spec, [new THREE.Texture(), new THREE.Texture()], new Map(), 0);
    expect(handle.getModelGroupCount()).toBe(2);
    expect(collectMeshes(handle).length).toBeGreaterThan(0);
    // showModelGroup 面板：切到第二个模型
    handle.showModelGroup(1);
    handle.removeFromScene(new THREE.Scene());
  });

  it("blend 纹理 → fragment 进 merged 透明桶（不烘焙合批）", () => {
    const handle = buildYsmObject(makeMinSpec(), [blendTexture()], new Map(), 0);
    expect(collectMeshes(handle).length).toBeGreaterThan(0);
  });

  it("mesh 缺 texIdx → console.warn 回退 0（spec 契约破坏防御）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = makeMinSpec();
    delete (spec.models![0].meshGroups![0] as { texIdx?: number }).texIdx;
    const handle = buildYsmObject(spec, [new THREE.Texture()], new Map(), 0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    handle.removeFromScene(new THREE.Scene());
  });

  it("API 面板：showModelGroup / setBoneVisible / toggleBone / getBoneList / removeFromScene", () => {
    const spec = makeMinSpec();
    spec.models!.push(JSON.parse(JSON.stringify(spec.models![0])) as never);
    const handle = buildYsmObject(spec, [], new Map(), 0);
    expect(handle.getModelGroupCount()).toBe(2);
    handle.showModelGroup(1);
    expect(handle.setBoneVisible("head", false)).toBeUndefined();
    expect(handle.toggleBone("head")).toBeUndefined();
    expect(handle.getBoneList().length).toBeGreaterThan(0);
    expect(handle.getBoneList(0).length).toBeGreaterThan(0);
    const scene = new THREE.Scene();
    scene.add(handle.rootGroup);
    handle.removeFromScene(scene);
    expect(scene.children).toHaveLength(0);
  });
});
