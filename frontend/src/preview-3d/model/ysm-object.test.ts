// ===== ysm-object.test.ts — buildYsmObject 成品的可见性/材质契约 =====
// 修复回归守卫：确保经 buildYsmObject（含不透明烘焙批 addMeshToBoneGroup）
// 产出的**所有** Mesh 都满足：
//   1) frustumCulled === false（关闭 Three.js 内置 mesh 级视锥，交给外层 Group 级）
//   2) 材质 side === THREE.DoubleSide（对齐 architecture.md 材质标准 / YSMViewer 双面）
// 防止脸部薄板 / 车部件"镜头转动消失"回归。
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildYsmObject, type YsmObjectHandle } from "./ysm-object.ts";
import type { Spec3D } from "@/preview-3d/mesh/model3d.ts";

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

  it("mesh 缺 texIdx → console.warn 回退 0，且整次构建仅提示一次（收敛防刷屏）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spec = makeMinSpec();
    // 两个 mesh 都缺 texIdx（模拟多组件模型契约破坏）——修复前逐 mesh 刷屏，应只 warn 一次
    const firstMesh = spec.models![0]!.meshGroups![0] as { texIdx?: number };
    delete firstMesh.texIdx;
    const cloned = structuredClone(spec.models![0]!.meshGroups![0]);
    delete (cloned as { texIdx?: number }).texIdx;
    spec.models![0]!.meshGroups!.push(cloned);
    const handle = buildYsmObject(spec, [new THREE.Texture()], new Map(), 0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    handle.removeFromScene(new THREE.Scene());
  });

  it("API 面板：showModelGroup / setBoneVisible / toggleBone / getBoneList / removeFromScene", () => {
    const spec = makeMinSpec();
    spec.models!.push(JSON.parse(JSON.stringify(spec.models![0])) as unknown as NonNullable<typeof spec.models>[0]);
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

// ===== 特征基线（认知复杂度战役 第 3 批）=====
// 补测前实测（istanbul 分支）：重载分派 `componentTexMapOrTexIdx instanceof Map` 的
// 旧口径（第三参传 number）分支零命中、缺省参数（第 3/4 参不传）零命中、
// `!bg`（mesh 的 boneId 在场景图里查不到）零命中、`mg.name || mg.id || \`comp_${mi}\``
// 的两级兜底零命中、`spec.models` 缺席零命中。
// 本组钉「纹理索引空间 + 组件名解析 + 未知骨骼静默丢弃」——绑错纹理不崩只画错。
d2("buildYsmObject — 索引空间/组件名/缺骨骼（补测前零命中分支）", () => {
  const texAt = (handle: YsmObjectHandle): unknown[] =>
    collectMeshes(handle).map((m) => (m.material as THREE.Material & { map?: unknown }).map);

  /** 三张互不相同的纹理（索引 2 用半透明 → 走透明桶不烘合，map 恒挂在 mesh 上） */
  function threeTextures(): THREE.Texture[] {
    return [new THREE.Texture(), new THREE.Texture(), blendTexture()];
  }

  it("旧口径（第三参传 number）→ 用该 number 作纹理索引；与新口径 (Map, texIdx) 等价", () => {
    const texArr = threeTextures();
    const legacy = buildYsmObject(makeMinSpec(), texArr, 2); // 旧签名：texIdx=2
    const modern = buildYsmObject(makeMinSpec(), texArr, new Map(), 2);
    expect(texAt(legacy)).toContain(texArr[2]);
    expect(texAt(modern)).toContain(texArr[2]);
    // 旧口径下第三参是索引而非 Map：不得退回缺省 0
    expect(texAt(legacy)).not.toContain(texArr[0]);
    // 缺省（不传第三/第四参）→ 索引 0
    const dflt = buildYsmObject(makeMinSpec(), texArr);
    expect(texAt(dflt)).toContain(texArr[0]);
    expect(texAt(dflt)).not.toContain(texArr[2]);
  });

  it("mesh 的 boneId 在场景图中无对应骨骼组 → 静默丢弃该 mesh（不建错绑的孤儿节点）", () => {
    const spec = makeMinSpec();
    const orphan = structuredClone(spec.models![0]!.meshGroups![0]);
    orphan.id = "nobody_0";
    orphan.boneId = "nobody";
    spec.models![0]!.meshGroups!.push(orphan);
    const handle = buildYsmObject(spec, [], new Map(), 0);
    // 只有真实骨骼 head 的 mesh 落地
    expect(collectMeshes(handle)).toHaveLength(1);
    expect(handle.boneGroupMap.has("comp_0/nobody")).toBe(false);
  });

  it("模型 name/id 双空 → 组件键回退 comp_<mi>（componentTexMap 按该键命中）", () => {
    const spec = makeMinSpec();
    spec.models![0]!.name = "";
    spec.models![0]!.id = "";
    const compTex = blendTexture();
    const handle = buildYsmObject(spec, [], new Map([["comp_0", [compTex]]]), 9);
    // 组件分支生效 → 绑组件数组槽 0（而非 texIdx=9 的全局槽）
    expect(texAt(handle)).toContain(compTex);
  });

  it("spec.models 缺席 → 空场景图（0 组 0 mesh），removeFromScene 不抛", () => {
    const handle = buildYsmObject({} as Spec3D, [], new Map(), 0);
    expect(handle.getModelGroupCount()).toBe(0);
    expect(handle.modelGroups).toEqual([]);
    expect(collectMeshes(handle)).toHaveLength(0);
    const scene = new THREE.Scene();
    scene.add(handle.rootGroup);
    handle.removeFromScene(scene);
    expect(scene.children).toHaveLength(0);
  });
});
