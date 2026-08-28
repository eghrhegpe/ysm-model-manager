// ===== FBX 适配器测试（ADR-112 地基 TDD）====
// 覆盖：build 主路径（readBytes → FBXLoader.load → 挂场景 + 播内嵌动画 + 相机取景）、
// 空字节错误路径、无内嵌动画时 mixer 缺失路径健壮性、dispose 释放（scene.remove + 几何/材质释放）。
// three 用真实实现；FBXLoader 全 mock（避免在 vitest 内跑真实 FBX 解析）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { PreviewBuildCtx } from "./mount-preview-core.ts";
import { buildFbxScene, FBX_TARGET_MAX_DIM, normalizeFbxScale } from "./fbx-adapter.ts";

const hoisted = vi.hoisted(() => {
  const loadImpl = vi.fn();
  let withAnim = true;
  let withBones = false;
  return {
    loadImpl,
    readBytesMock: vi.fn(),
    setWithAnim: (v: boolean) => {
      withAnim = v;
    },
    getWithAnim: () => withAnim,
    setWithBones: (v: boolean) => {
      withBones = v;
    },
    getWithBones: () => withBones,
  };
});

vi.mock("three/addons/loaders/FBXLoader.js", () => ({
  FBXLoader: class {
    constructor(_manager?: unknown) {}
    load(_url: string, onLoad: (g: unknown) => void): void {
      const g = new THREE.Group();
      // 骨骼开关：构造带骨架的 SkinnedMesh（ADR-074 骨骼面板注入场景）
      if (hoisted.getWithBones()) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0]), 3));
        // Box3.setFromObject 对 SkinnedMesh 走 applyBoneTransform，需 skinIndex/skinWeight
        // （真实 fbx-parser 产物自带；缺省会崩——mock 补齐以模拟真实解析结果）
        geo.setAttribute("skinIndex", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]), 4));
        geo.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]), 4));
        const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
        const bone = new THREE.Bone();
        bone.name = "Hips";
        mesh.bind(new THREE.Skeleton([bone]));
        g.add(mesh);
      } else {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        g.add(mesh);
      }
      if (hoisted.getWithAnim()) {
        (g as unknown as { animations: THREE.AnimationClip[] }).animations = [
          new THREE.AnimationClip("clip1", 1, []),
        ];
      }
      hoisted.loadImpl(_url, onLoad);
      onLoad(g);
    }
  },
}));

function makeCtx(): PreviewBuildCtx {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  const controls = {
    target: new THREE.Vector3(),
    minDistance: 0,
    maxDistance: 0,
    update: vi.fn(),
  } as unknown as NonNullable<PreviewBuildCtx["controls"]>;
  return { scene, camera, controls, renderer: null } as unknown as PreviewBuildCtx;
}

describe("fbx-adapter", () => {
  beforeEach(() => {
    hoisted.readBytesMock.mockReset();
    hoisted.loadImpl.mockReset();
    hoisted.setWithAnim(true);
    hoisted.setWithBones(false);
  });

  it("build 主路径：读字节→加载→挂场景→播动画→相机取景", async () => {
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake fbx binary").toString("base64"));
    const ctx = makeCtx();
    const scene = ctx.scene as THREE.Scene;
    const addSpy = vi.spyOn(scene, "add");
    const removeSpy = vi.spyOn(scene, "remove");

    const built = await buildFbxScene(ctx, "/repo/mmd/CustomAnim/a.fbx", {
      readFileBytes: hoisted.readBytesMock,
    });

    // 字节按路径读取
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/repo/mmd/CustomAnim/a.fbx");
    // 模型挂入场景
    expect(addSpy).toHaveBeenCalledTimes(1);
    // 返回标准 PreviewScene 契约
    expect(typeof built.update).toBe("function");
    expect(typeof built.dispose).toBe("function");
    expect(typeof built.screenshot).toBe("function");
    // 相机取景已设置
    expect((ctx.camera as THREE.PerspectiveCamera).position.length()).toBeGreaterThan(0);
    expect((ctx.controls as { update: () => void }).update).toHaveBeenCalled();
    // ADR-112 P1 尺度归一：mock 单位立方体（1×1×1）被放大到规范最长边，
    // 相机按归一后尺寸取景（far = maxDim*50，z = maxDim*1.6）
    expect((ctx.camera as THREE.PerspectiveCamera).far).toBeCloseTo(FBX_TARGET_MAX_DIM * 50, 0);
    expect((ctx.camera as THREE.PerspectiveCamera).position.z).toBeCloseTo(FBX_TARGET_MAX_DIM * 1.6, 0);
    // perFrame 驱动不抛（mixer.update）
    expect(() => built.update?.(0.016)).not.toThrow();
    // dispose 释放并移出场景
    built.dispose();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it("空字节抛错（ReadFileBytes 返回 null）", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await expect(
      buildFbxScene(ctx, "/x.fbx", { readFileBytes: hoisted.readBytesMock }),
    ).rejects.toThrow();
  });

  it("无内嵌动画时 mixer 缺失，update/dispose 安全空转", async () => {
    hoisted.setWithAnim(false);
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake").toString("base64"));
    const ctx = makeCtx();
    const built = await buildFbxScene(ctx, "/y.fbx", { readFileBytes: hoisted.readBytesMock });
    expect(() => built.update?.(0.016)).not.toThrow();
    expect(() => built.dispose()).not.toThrow();
  });

  it("有骨骼（SkinnedMesh）→ menuItems 注入 🦴 bones 面板项（ADR-074 通用骨骼面板）", async () => {
    hoisted.setWithBones(true);
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake").toString("base64"));
    const ctx = makeCtx();
    const built = await buildFbxScene(ctx, "/z.fbx", { readFileBytes: hoisted.readBytesMock });

    const bonesItem = built.menuItems?.find((i) => i.id === "bones");
    expect(bonesItem).toBeDefined();
    expect(bonesItem?.kind).toBe("panel");
    expect(bonesItem?.dockGroup).toBe("model");
    // renderCustom 渲染通用骨骼面板不抛（真实渲染依赖 DOM，此处仅验证可调用）
    expect(typeof bonesItem?.renderCustom).toBe("function");
  });

  it("无骨骼（普通 Mesh）→ menuItems 不含 bones 项", async () => {
    hoisted.setWithBones(false);
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake").toString("base64"));
    const ctx = makeCtx();
    const built = await buildFbxScene(ctx, "/w.fbx", { readFileBytes: hoisted.readBytesMock });
    expect(built.menuItems?.find((i) => i.id === "bones")).toBeUndefined();
  });
});

function boxMaxDim(obj: THREE.Object3D): number {
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

describe("normalizeFbxScale（ADR-112 P1 尺度归一）", () => {
  it("厘米导出（180 单位）等比缩小收敛到规范最长边，factor<1", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(180, 120, 60), new THREE.MeshStandardMaterial()));
    const info = normalizeFbxScale(group);
    expect(info.factor).toBeLessThan(1);
    expect(info.factor).toBeCloseTo(FBX_TARGET_MAX_DIM / 180, 6);
    expect(boxMaxDim(group)).toBeCloseTo(FBX_TARGET_MAX_DIM, 6);
    // 等比缩放：宽高比保持
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    expect(size.y / size.x).toBeCloseTo(120 / 180, 6);
  });

  it("米制导出（0.18 单位）等比放大收敛到规范最长边，factor>1", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18)));
    const info = normalizeFbxScale(group);
    expect(info.factor).toBeGreaterThan(1);
    expect(boxMaxDim(group)).toBeCloseTo(FBX_TARGET_MAX_DIM, 6);
    // 返回的 size 为缩放后尺寸（信息回显一致）
    expect(info.size.x).toBeCloseTo(FBX_TARGET_MAX_DIM, 6);
  });

  it("已达规范最长的模型 factor≈1 不变形", () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(FBX_TARGET_MAX_DIM, FBX_TARGET_MAX_DIM * 0.5, FBX_TARGET_MAX_DIM * 0.3)));
    const info = normalizeFbxScale(group);
    expect(info.factor).toBeCloseTo(1, 6);
    expect(boxMaxDim(group)).toBeCloseTo(FBX_TARGET_MAX_DIM, 6);
  });

  it("空组（无几何）退化 no-op：factor=1 不抛错，scale 原样", () => {
    const group = new THREE.Group();
    group.scale.setScalar(2);
    const info = normalizeFbxScale(group);
    expect(info.factor).toBe(1);
    expect(group.scale.x).toBe(2);
  });

  it("归一化不触碰内嵌动画（clip 列表原样保留）", () => {
    const group = new THREE.Group();
    const clip = new THREE.AnimationClip("run", 1, []);
    (group as unknown as { animations: THREE.AnimationClip[] }).animations = [clip];
    group.add(new THREE.Mesh(new THREE.BoxGeometry(180, 180, 180)));
    normalizeFbxScale(group);
    const anims = (group as unknown as { animations: THREE.AnimationClip[] }).animations;
    expect(anims).toHaveLength(1);
    expect(anims[0]).toBe(clip);
  });
});
