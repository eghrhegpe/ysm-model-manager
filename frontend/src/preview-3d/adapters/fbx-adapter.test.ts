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
  let loadError: Error | null = null;
  return {
    loadImpl,
    readBytesMock: vi.fn(),
    fbxParserImpl: null as null | (() => unknown),
    buildFromDataOverride: null as null | ((data: unknown, config?: unknown) => THREE.Group),
    setWithAnim: (v: boolean) => {
      withAnim = v;
    },
    getWithAnim: () => withAnim,
    setWithBones: (v: boolean) => {
      withBones = v;
    },
    getWithBones: () => withBones,
    setLoadError: (e: Error | null) => {
      loadError = e;
    },
    getLoadError: () => loadError,
  };
});

vi.mock("three/addons/loaders/FBXLoader.js", () => ({
  FBXLoader: class {
    constructor(_manager?: unknown) {}
    load(_url: string, onLoad: (g: unknown) => void, _onProgress?: unknown, onError?: (e: unknown) => void): void {
      const loadError = hoisted.getLoadError();
      if (loadError) {
        onError?.(loadError);
        return;
      }
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

vi.mock("./fbx-parser.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fbx-parser.ts")>();
  return {
    ...actual,
    createFbxParser: (): unknown => {
      // 默认镜像真实降级（测试/受限环境无 Worker → always-fail parser）
      if (hoisted.fbxParserImpl) return hoisted.fbxParserImpl();
      return {
        parse: () => Promise.resolve({ ok: false, error: "Worker 不可用（测试/受限环境）" }),
        dispose: () => undefined,
      };
    },
    buildFbxSceneFromData: (data: unknown, config?: unknown): THREE.Group => {
      if (hoisted.buildFromDataOverride) return hoisted.buildFromDataOverride(data, config);
      return actual.buildFbxSceneFromData(data as unknown as Parameters<typeof actual.buildFbxSceneFromData>[0], config as unknown as Parameters<typeof actual.buildFbxSceneFromData>[1]);
    },
  };
});

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
    hoisted.setLoadError(null);
    hoisted.fbxParserImpl = null;
    hoisted.buildFromDataOverride = null;
    localStorage.removeItem("fbx-worker");
  });

  it("build 主路径：读字节→加载→挂场景→播动画→相机取景", async () => {
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake fbx binary").toString("base64"));
    const ctx = makeCtx();
    const scene = ctx.scene as THREE.Scene;
    const addSpy = vi.spyOn(scene, "add");
    const removeSpy = vi.spyOn(scene, "remove");

    const content = await buildFbxScene(ctx, "/repo/mmd/CustomAnim/a.fbx", {
      readFileBytes: hoisted.readBytesMock,
    });

    // 字节按路径读取
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/repo/mmd/CustomAnim/a.fbx");
    // 模型挂入场景
    expect(addSpy).toHaveBeenCalledTimes(1);
    // 返回标准 PreviewScene 契约
    expect(typeof content.update).toBe("function");
    expect(typeof content.dispose).toBe("function");
    expect(typeof content.screenshot).toBe("function");
    // 相机取景已设置
    expect((ctx.camera as THREE.PerspectiveCamera).position.length()).toBeGreaterThan(0);
    expect((ctx.controls as { update: () => void }).update).toHaveBeenCalled();
    // ADR-112 P1 尺度归一：mock 单位立方体（1×1×1）被放大到规范最长边，
    // 相机按归一后尺寸取景（far = maxDim*50，z = maxDim*1.6）
    expect((ctx.camera as THREE.PerspectiveCamera).far).toBeCloseTo(FBX_TARGET_MAX_DIM * 50, 0);
    expect((ctx.camera as THREE.PerspectiveCamera).position.z).toBeCloseTo(FBX_TARGET_MAX_DIM * 1.6, 0);
    // perFrame 驱动不抛（mixer.update）
    expect(() => content.update?.(0.016)).not.toThrow();
    // dispose 释放并移出场景
    content.dispose();
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
    const content = await buildFbxScene(ctx, "/y.fbx", { readFileBytes: hoisted.readBytesMock });
    expect(() => content.update?.(0.016)).not.toThrow();
    expect(() => content.dispose()).not.toThrow();
  });

  it("有骨骼（SkinnedMesh）→ menuItems 注入 🦴 bones 面板项（ADR-074 通用骨骼面板）", async () => {
    hoisted.setWithBones(true);
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake").toString("base64"));
    const ctx = makeCtx();
    const content = await buildFbxScene(ctx, "/z.fbx", { readFileBytes: hoisted.readBytesMock });

    const bonesItem = content.menuItems?.find((i) => i.id === "bones");
    expect(bonesItem).toBeDefined();
    expect(bonesItem?.kind).toBe("panel");
    expect(bonesItem?.dockGroup).toBe("motion");
    // renderCustom 渲染通用骨骼面板不抛（真实渲染依赖 DOM，此处仅验证可调用）
    expect(typeof bonesItem?.renderCustom).toBe("function");
  });

  it("无骨骼（普通 Mesh）→ menuItems 不含 bones 项", async () => {
    hoisted.setWithBones(false);
    hoisted.readBytesMock.mockResolvedValue(Buffer.from("fake").toString("base64"));
    const ctx = makeCtx();
    const content = await buildFbxScene(ctx, "/w.fbx", { readFileBytes: hoisted.readBytesMock });
    expect(content.menuItems?.find((i) => i.id === "bones")).toBeUndefined();
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

// ===== 覆盖率攻坚：worker 路径 / texUrlMap / 降级与错误路径 / screenshot =====

/** worker 解析产物 fixture：1 mesh + 1 非 mesh 节点；材质含大小写纹理 + 缺失纹理 */
function workerData(): unknown {
  return {
    nodes: [
      {
        name: "mesh0",
        parent: -1,
        isMesh: true,
        transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
        mesh: {
          name: "mesh0",
          geometry: {},
          materials: [
            { type: "MeshStandardMaterial", name: "m", map: "Tex.PNG" },
            { type: "MeshStandardMaterial", name: "m2", normalMap: "missing.png" },
          ],
          hasSkeleton: false,
        },
      },
      {
        name: "empty-group",
        parent: -1,
        isMesh: false,
        transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    ],
    animations: [{ name: "clip1", duration: 1, tracks: [] }],
  };
}

describe("fbx-adapter worker 路径（fbx-worker=1）", () => {
  beforeEach(() => {
    hoisted.readBytesMock.mockReset();
    hoisted.loadImpl.mockReset();
    hoisted.setWithAnim(true);
    hoisted.setWithBones(false);
    hoisted.setLoadError(null);
    hoisted.fbxParserImpl = null;
    hoisted.buildFromDataOverride = null;
    localStorage.removeItem("fbx-worker");
  });

  it("worker 解析成功 → texUrlMap（原样/小写双试）+ buildFbxSceneFromData 重建 + diag ok", async () => {
    localStorage.setItem("fbx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:tex-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // 原样大小写 miss → 小写重试命中（磁盘文件名大小写不一致场景）
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p === "/repo/fbx/a.fbx") return Promise.resolve(btoa("FBX"));
      if (p === "/repo/fbx/tex.png") return Promise.resolve(btoa("PNG"));
      return Promise.resolve(null);
    });
    let parsedData: unknown;
    hoisted.fbxParserImpl = () => ({
      parse: async (bytes: Uint8Array) => {
        void bytes;
        parsedData = workerData();
        return { ok: true, data: parsedData };
      },
      dispose: vi.fn(),
    });
    // buildFbxSceneFromData override：重建带动画的 Group（worker 路径纹理挂贴图由真实 builder 完成，
    // 此处只锁 adapter 侧编排：texUrlMap 构建 → 重建 → 统计 → 挂场景）
    const group = new THREE.Group();
    group.add(new THREE.Mesh(
      new THREE.BoxGeometry(180, 180, 180),
      [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()], // 材质数组 → countFbxStats/dispose 数组分支
    ));
    (group as unknown as { animations: THREE.AnimationClip[] }).animations = [new THREE.AnimationClip("c", 1, [])];
    hoisted.buildFromDataOverride = vi.fn(() => group);

    const ctx = makeCtx();
    const content = await buildFbxScene(ctx, "/repo/fbx/a.fbx", {
      readFileBytes: hoisted.readBytesMock,
      addOpLog: vi.fn(),
    });

    // parser.parse 收到字节，dispose 释放
    expect(hoisted.buildFromDataOverride).toHaveBeenCalledTimes(1);
    // 纹理按 FBX 同目录读取：原样 miss → 小写命中
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/repo/fbx/Tex.PNG");
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/repo/fbx/tex.png");
    // 尺度归一 + 相机取景按 worker 重建产物
    expect((ctx.camera as THREE.PerspectiveCamera).far).toBeCloseTo(FBX_TARGET_MAX_DIM * 50, 0);
    // 内嵌动画 → mixer 播放（update 不抛）
    expect(() => content.update?.(0.016)).not.toThrow();
    // dispose → 纹理 blob URL 释放（模型 blob 已在 finally 释放）
    content.dispose();
    expect(revokeURL).toHaveBeenCalledWith("blob:tex-url");
    void parsedData;
  });

  it("worker 解析失败（ok:false）→ 降级主线程 blob 路径（FBXLoader）", async () => {
    localStorage.setItem("fbx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fbx-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("FBX"));
    hoisted.fbxParserImpl = () => ({
      parse: () => Promise.resolve({ ok: false, error: "bad header" }),
      dispose: vi.fn(),
    });
    const ctx = makeCtx();
    const content = await buildFbxScene(ctx, "/repo/fbx/b.fbx", {
      readFileBytes: hoisted.readBytesMock,
      addOpLog: vi.fn(),
    });
    // 降级路径产出 mock FBXLoader 的 Group（含动画）
    expect(hoisted.loadImpl).toHaveBeenCalled();
    expect(content.update).toBeDefined();
    content.dispose();
    expect(revokeURL).toHaveBeenCalled();
  });

  it("worker parse 抛错 → diag fail + 异常穿透", async () => {
    localStorage.setItem("fbx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fbx-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("FBX"));
    hoisted.fbxParserImpl = () => ({
      parse: () => Promise.reject(new Error("worker crash")),
      dispose: vi.fn(),
    });
    const ctx = makeCtx();
    await expect(
      buildFbxScene(ctx, "/repo/fbx/c.fbx", { readFileBytes: hoisted.readBytesMock, addOpLog: vi.fn() }),
    ).rejects.toThrow("worker crash");
  });
});

describe("fbx-adapter 主线程降级与边界", () => {
  beforeEach(() => {
    hoisted.readBytesMock.mockReset();
    hoisted.loadImpl.mockReset();
    hoisted.setWithAnim(true);
    hoisted.setWithBones(false);
    hoisted.setLoadError(null);
    hoisted.fbxParserImpl = null;
    hoisted.buildFromDataOverride = null;
    localStorage.removeItem("fbx-worker");
  });

  it("FBXLoader load onError → 拒绝并携带 Error（diag fail）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fbx-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("FBX"));
    hoisted.setLoadError(new Error("fbx parse fail"));
    const ctx = makeCtx();
    await expect(
      buildFbxScene(ctx, "/repo/fbx/d.fbx", { readFileBytes: hoisted.readBytesMock }),
    ).rejects.toThrow("fbx parse fail");
  });

  it("renderer 缺失 → screenshot 归一 null（不抛）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:fbx-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("FBX"));
    const ctx = makeCtx();
    const content = await buildFbxScene(ctx, "/repo/fbx/e.fbx", { readFileBytes: hoisted.readBytesMock });
    await expect(content.screenshot?.()).resolves.toBeNull();
    content.dispose();
  });

  it("纹理原样大小写命中 → 不做小写重试", async () => {
    localStorage.setItem("fbx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:tex-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p === "/repo/fbx/f.fbx") return Promise.resolve(btoa("FBX"));
      if (p === "/repo/fbx/Tex.PNG") return Promise.resolve(btoa("PNG"));
      return Promise.resolve(null);
    });
    hoisted.fbxParserImpl = () => ({
      parse: () => Promise.resolve({ ok: true, data: workerData() }),
      dispose: vi.fn(),
    });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    (group as unknown as { animations: THREE.AnimationClip[] }).animations = [];
    hoisted.buildFromDataOverride = vi.fn(() => group);

    await buildFbxScene(makeCtx(), "/repo/fbx/f.fbx", {
      readFileBytes: hoisted.readBytesMock,
      addOpLog: vi.fn(),
    });
    // 原样命中 → 该纹理只读一次（不做小写重试；missing.png 双试均 miss 另计）
    const texCalls = (hoisted.readBytesMock.mock.calls as Array<[string]>)
      .map((c) => c[0])
      .filter((p) => p.endsWith("Tex.PNG") || p.endsWith("tex.png"));
    expect(texCalls).toEqual(["/repo/fbx/Tex.PNG"]);
  });
});
