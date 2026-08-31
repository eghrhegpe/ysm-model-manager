// ===== debug-render.ts 契约测试 =====
// 覆盖：rebuildDebug 三模式（normal 早退 / pivot 线+标签 / bone 骨骼连线）、
// 世界坐标正确性（updateMatrixWorld 修复）、同名骨骼纹理缓存命中、
// 重建时旧组 dispose（geometry/material/纹理）+ 纹理缓存清空。
// happy-dom（默认环境）：makeTextTexture 需要 document.createElement("canvas")。
import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { rebuildDebug } from "./debug-render.ts";

/** 与 rebuildDebug 入参对齐的 state 类型（显式标注防 TS 把 debugGroup 窄化为 null） */
type DebugState = { debugGroup: THREE.Group | null; debugMode: "normal" | "pivot" | "bone" };

/** 场景 + rootGroup + boneGroupMap（骨骼组挂 rootGroup 下，updateMatrixWorld 后取世界坐标） */
function makeRig(positions: Record<string, [number, number, number]>) {
  const scene = new THREE.Scene();
  const rootGroup = new THREE.Group();
  scene.add(rootGroup);
  const boneGroupMap = new Map<string, THREE.Group>();
  for (const [id, p] of Object.entries(positions)) {
    const g = new THREE.Group();
    g.position.set(p[0], p[1], p[2]);
    rootGroup.add(g);
    boneGroupMap.set(id, g);
  }
  return { scene, rootGroup, boneGroupMap };
}

const SPEC_BONES = [
  { id: "root", name: "root" },
  { id: "head", name: "head", parentId: "root" },
];

describe("rebuildDebug — normal 模式", () => {
  it("debugMode=normal → 不创建 debugGroup，state 置 null", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({ root: [0, 0, 0] });
    const state: DebugState = { debugGroup: null, debugMode: "normal" as const };
    rebuildDebug(scene, rootGroup, boneGroupMap, { models: [{ bones: SPEC_BONES }] }, state);
    expect(state.debugGroup).toBeNull();
    expect(scene.children).toHaveLength(1); // 仅 rootGroup
  });

  it("已有旧 debugGroup → dispose 旧组内容 + 从 scene 移除 + 不新建", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({ root: [0, 0, 0] });
    const oldGeo = new THREE.BufferGeometry();
    const geoSpy = vi.spyOn(oldGeo, "dispose");
    const oldGroup = new THREE.Group();
    oldGroup.add(new THREE.Mesh(oldGeo, new THREE.MeshBasicMaterial()));
    scene.add(oldGroup);
    const state: DebugState = { debugGroup: oldGroup, debugMode: "normal" };

    rebuildDebug(scene, rootGroup, boneGroupMap, { models: [{ bones: SPEC_BONES }] }, state);

    expect(geoSpy).toHaveBeenCalledTimes(1); // 旧内容已释放
    expect(scene.children).not.toContain(oldGroup); // 已从 scene 移除
    expect(state.debugGroup).toBeNull();
    expect(scene.children).toHaveLength(1);
  });
});

describe("rebuildDebug — pivot 模式", () => {
  it("每骨骼 1 条 pivot 线（世界坐标 → y+4）+ 1 个标签 Sprite（尺寸/材质/纹理）", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({
      root: [1, 2, 3],
      head: [0, 5, 0],
    });
    const state: DebugState = { debugGroup: null, debugMode: "pivot" as const };
    rebuildDebug(scene, rootGroup, boneGroupMap, { models: [{ bones: SPEC_BONES }] }, state);

    expect(state.debugGroup).not.toBeNull();
    expect(scene.children).toContain(state.debugGroup);

    const lines = state.debugGroup!.children.filter((c) => c instanceof THREE.Line);
    const sprites = state.debugGroup!.children.filter((c) => c instanceof THREE.Sprite);
    expect(lines).toHaveLength(2);
    expect(sprites).toHaveLength(2);

    // root 在 spec 首位 → 第一条线：pos (1,2,3) → top (1,6,3)
    const pos = (lines[0] as THREE.Line).geometry.getAttribute("position");
    expect(pos.count).toBe(2);
    expect(pos.getX(0)).toBeCloseTo(1);
    expect(pos.getY(0)).toBeCloseTo(2);
    expect(pos.getZ(0)).toBeCloseTo(3);
    expect(pos.getX(1)).toBeCloseTo(1);
    expect(pos.getY(1)).toBeCloseTo(6); // pivot 线长 4
    expect(pos.getZ(1)).toBeCloseTo(3);

    // 标签：位置在 top、scale (120,24,1)、SpriteMaterial 深度/衰减/透明配置、Canvas 纹理
    const mat = (sprites[0] as THREE.Sprite).material;
    expect((sprites[0] as THREE.Sprite).position.y).toBeCloseTo(6);
    expect((sprites[0] as THREE.Sprite).scale.x).toBe(120);
    expect((sprites[0] as THREE.Sprite).scale.y).toBe(24);
    expect(mat.depthTest).toBe(false);
    expect(mat.sizeAttenuation).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.map).toBeInstanceOf(THREE.CanvasTexture);
  });

  it("同名骨骼共享缓存纹理（_labelTexCache 命中，不重复建 CanvasTexture）", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({ a: [0, 0, 0], b: [1, 0, 0] });
    const spec = { models: [{ bones: [{ id: "a", name: "dup" }, { id: "b", name: "dup" }] }] };
    const state: DebugState = { debugGroup: null, debugMode: "pivot" as const };
    rebuildDebug(scene, rootGroup, boneGroupMap, spec, state);

    const sprites = state.debugGroup!.children.filter(
      (c) => c instanceof THREE.Sprite,
    ) as THREE.Sprite[];
    expect(sprites).toHaveLength(2);
    expect(sprites[0].material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(sprites[1].material.map).toBe(sprites[0].material.map); // 同 key 缓存命中
  });

  it("boneGroupMap 缺该骨骼 → 跳过（无输出）", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({});
    const state: DebugState = { debugGroup: null, debugMode: "pivot" as const };
    rebuildDebug(scene, rootGroup, boneGroupMap, { models: [{ bones: SPEC_BONES }] }, state);
    expect(state.debugGroup!.children).toHaveLength(0);
  });
});

describe("rebuildDebug — bone 模式", () => {
  it("有父骨骼 → 子→父连线；孤儿/父不在图 → 跳过", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({
      root: [0, 0, 0],
      head: [0, 2, 0],
      orphan: [1, 1, 1],
    });
    const spec = {
      models: [
        {
          bones: [
            { id: "root", name: "root" },
            { id: "head", name: "head", parentId: "root" },
            { id: "orphan", name: "orphan", parentId: "ghost" }, // 父不在 boneWorldPositions
          ],
        },
      ],
    };
    const state: DebugState = { debugGroup: null, debugMode: "bone" as const };
    rebuildDebug(scene, rootGroup, boneGroupMap, spec, state);

    const lines = state.debugGroup!.children.filter((c) => c instanceof THREE.Line) as THREE.Line[];
    expect(lines).toHaveLength(1);
    const pos = lines[0].geometry.getAttribute("position");
    expect(pos.count).toBe(2);
    // 子在前、父在后
    expect(pos.getX(0)).toBeCloseTo(0);
    expect(pos.getY(0)).toBeCloseTo(2);
    expect(pos.getX(1)).toBeCloseTo(0);
    expect(pos.getY(1)).toBeCloseTo(0);
  });

  it("只消费 spec.models[0]（与 renderModel3D 原口径一致），models[1] 骨骼不参与", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({ root: [0, 0, 0], extra: [9, 9, 9] });
    const spec = {
      models: [
        { bones: [{ id: "root", name: "root" }] },
        { bones: [{ id: "extra", name: "extra" }] },
      ],
    };
    const state: DebugState = { debugGroup: null, debugMode: "pivot" as const };
    rebuildDebug(scene, rootGroup, boneGroupMap, spec, state);
    expect(state.debugGroup!.children).toHaveLength(2); // 仅 root：1 线 + 1 标签
  });
});

describe("rebuildDebug — 重建清理", () => {
  it("pivot→pivot 重建：旧 geometry/material/纹理 dispose + 纹理缓存清空 + scene 不累积", () => {
    const { scene, rootGroup, boneGroupMap } = makeRig({ root: [0, 0, 0] });
    const state: DebugState = { debugGroup: null, debugMode: "pivot" as const };
    const spec = { models: [{ bones: SPEC_BONES }] };
    rebuildDebug(scene, rootGroup, boneGroupMap, spec, state);

    // 捕获首轮资源并挂 spy
    const firstGroup = state.debugGroup!;
    const firstLine = firstGroup.children.find((c) => c instanceof THREE.Line) as THREE.Line;
    const firstSprite = firstGroup.children.find((c) => c instanceof THREE.Sprite) as THREE.Sprite;
    const geoSpy = vi.spyOn(firstLine.geometry, "dispose");
    const matSpy = vi.spyOn(firstSprite.material, "dispose");
    const texSpy = vi.spyOn(firstSprite.material.map!, "dispose");
    const oldChildrenCount = scene.children.length;

    rebuildDebug(scene, rootGroup, boneGroupMap, spec, state); // 重建

    expect(geoSpy).toHaveBeenCalledTimes(1);
    expect(matSpy).toHaveBeenCalledTimes(1);
    // 纹理 dispose 2 次 = 源码真实语义：disposeMaterial 释放材质 map 一次 +
    // clearLabelTexCache 清缓存再释放一次（Texture.dispose 幂等，无害）
    expect(texSpy).toHaveBeenCalledTimes(2);
    expect(scene.children).toHaveLength(oldChildrenCount); // 旧组移除 + 新组加入，不累积
    expect(state.debugGroup).not.toBe(firstGroup);
    expect(scene.children).toContain(state.debugGroup);
  });
});
