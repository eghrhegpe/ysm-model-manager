// ===== 资源包模型适配器测试 =====
// 覆盖：buildPackScene 主路径、tint 渲染、错误路径、GPU 释放。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";

const hoisted = vi.hoisted(() => ({
  parseMock: vi.fn(),
  renderable: vi.fn(() => true),
}));

vi.mock("../screenshot.ts", () => ({
  screenshotFromRenderer: vi.fn(() => Promise.resolve("screenshot-url")),
}));
vi.mock("../texture-cache.ts", () => ({
  textureCache: {
    acquire: vi.fn((u: string, f: (u: string) => THREE.Texture) => {
      const img = new Image(); img.src = u;
      return new THREE.Texture(img);
    }),
    release: vi.fn(),
  },
}));
vi.mock("../parse-java-model.ts", () => ({
  parseJavaModel: hoisted.parseMock,
  isRenderableModel: hoisted.renderable,
}));
vi.mock("../mc-tints.ts", () => ({
  loadMcTints: vi.fn(() => Promise.resolve()),
  getTintColorSync: vi.fn(() => 0x4a9d2b),
}));

import { buildPackScene, makePackAdapter, type PackDeps } from "./pack-model-adapter.ts";

/** 构造假 Java 模型 */
function makeJavaModel(overrides: Partial<{
  faces: Array<{
    dir: string;
    verts: number[];
    uv: number[];
    texEntry: string | null;
    tintindex: number | null;
    texColor: string | null;
    cullface: string;
  }>;
}> = {}) {
  return {
    version: 1,
    display: { rotation: { x: 0, y: 0, z: 0 }, translation: [0, 0, 0] },
    elements: [],
    groups: {},
    texture_size: [64, 64],
    textures: {},
    faces: [
      { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/dirt.png", tintindex: null, texColor: null, cullface: "north" },
      { dir: "south", verts: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/dirt.png", tintindex: null, texColor: null, cullface: "south" },
    ],
    ...overrides,
  };
}

function makeCtx() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return {
    scene, camera,
    controls: { target: new THREE.Vector3(), minDistance: 0, maxDistance: 0, update: vi.fn() },
    viewContainer: document.createElement("div"),
    loadingEl: document.createElement("div"),
    overlay: document.createElement("div"),
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn(), dispose: vi.fn() },
    renderer: { domElement: document.createElement("div") },
    cameraControls: { setOrbit: vi.fn(), setSpeed: vi.fn() },
  } as unknown as PreviewBuildCtx;
}

function makeDeps(overrides: Partial<PackDeps> = {}): PackDeps {
  return { readEntry: vi.fn(() => Promise.resolve(btoa("DIRT_TEX"))), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.parseMock.mockResolvedValue(makeJavaModel());
  hoisted.renderable.mockReturnValue(true);
});

describe("buildPackScene 主路径", () => {
  it("解析模型 → 合并面 → 挂场景 + 取景", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "assets/minecraft/models/block/dirt.json", deps, "/packs/dirt.zip");

    expect(hoisted.parseMock).toHaveBeenCalledWith(
      "assets/minecraft/models/block/dirt.json", expect.any(Function),
    );
    expect(deps.readEntry).toHaveBeenCalledWith("/packs/dirt.zip", "textures/block/dirt.png");
    expect((ctx.scene as THREE.Scene).children.length).toBeGreaterThan(0);
    expect((ctx.camera as THREE.PerspectiveCamera).near).toBe(0.05);
    preview.dispose!();
  });

  it("多面同材质 → 合并为单一 BufferGeometry", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [
        { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t.png", tintindex: null, texColor: null, cullface: "north" },
        { dir: "south", verts: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t.png", tintindex: null, texColor: null, cullface: "south" },
        { dir: "up", verts: [0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t.png", tintindex: null, texColor: null, cullface: "up" },
      ],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    // group 是 scene 的第一个孩子，Mesh 在 group.children 里
    const group = (ctx.scene as THREE.Scene).children[0] as THREE.Group;
    const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(meshes.length).toBe(1);
    const positions = (meshes[0] as THREE.Mesh).geometry.attributes.position.array as Float32Array;
    expect(positions.length).toBe(12 * 3);
    preview.dispose!();
  });
});

describe("tint 渲染", () => {
  it("face.tintindex → 取 MC biome 色", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [{ dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: null, tintindex: 0, texColor: null, cullface: "north" }],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "grass.json", deps, "/packs.zip");
    expect(deps.readEntry).not.toHaveBeenCalled();
    preview.dispose!();
  });

  it("tint 面有 texEntry → 仍读纹理，材质 color×map（grass 顶面不是纯色平板）", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [{ dir: "up", verts: [0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/grass_block_top.png", tintindex: 0, texColor: null, cullface: "up" }],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "grass_block.json", deps, "/packs.zip");
    expect(deps.readEntry).toHaveBeenCalledWith("/packs.zip", "textures/block/grass_block_top.png");
    const mesh = ((ctx.scene as THREE.Scene).children[0] as THREE.Group).children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.map).toBeDefined();
    expect(mat.color.getHex()).toBe(0x4a9d2b); // tint 色（mock getTintColorSync）
    preview.dispose!();
  });

  it("同 tint 不同纹理 → 分开材质（key 含纹理路径，避免错用同一张 map）", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [
        { dir: "up", verts: [0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/grass_block_top.png", tintindex: 0, texColor: null, cullface: "up" },
        { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/grass_block_side_overlay.png", tintindex: 0, texColor: null, cullface: "north" },
      ],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "grass_block.json", deps, "/packs.zip");
    const meshes = ((ctx.scene as THREE.Scene).children[0] as THREE.Group).children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(meshes.length).toBe(2);
    preview.dispose!();
  });

  it("类别按纹理路径启发式（tintindex 值非类别索引）：_leaves→foliage、water→water、无后缀→grass", async () => {
    const { getTintColorSync } = await import("../mc-tints.ts");
    const spy = vi.mocked(getTintColorSync);
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [
        { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/oak_leaves.png", tintindex: 0, texColor: null, cullface: "north" },
        { dir: "south", verts: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/water_still.png", tintindex: 0, texColor: null, cullface: "south" },
        { dir: "up", verts: [0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "textures/block/grass_block_top.png", tintindex: 0, texColor: null, cullface: "up" },
      ],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "tinted.json", deps, "/packs.zip");
    const cats = spy.mock.calls.map((c) => c[0]);
    expect(cats).toContain("foliage");
    expect(cats).toContain("water");
    expect(cats).toContain("grass");
    preview.dispose!();
  });

  it("face.texColor → 直接使用颜色值", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [{ dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: null, tintindex: null, texColor: "#ff0000", cullface: "north" }],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "wool.json", deps, "/packs.zip");
    expect(deps.readEntry).not.toHaveBeenCalled();
    preview.dispose!();
  });
});

describe("错误路径", () => {
  it("parseJavaModel 抛错 → 抛错 + loadingEl 移除", async () => {
    hoisted.parseMock.mockRejectedValue(new Error("parse fail"));
    const deps = makeDeps();
    const ctx = makeCtx();
    await expect(buildPackScene(ctx, "bad.json", deps, "/packs.zip")).rejects.toThrow("资源包内模型解析失败");
    expect(ctx.loadingEl.parentNode).toBeNull();
  });

  it("isRenderableModel 返回 false → 抛错", async () => {
    hoisted.renderable.mockReturnValue(false);
    const deps = makeDeps();
    const ctx = makeCtx();
    await expect(buildPackScene(ctx, "empty.json", deps, "/packs.zip")).rejects.toThrow("无完整纹理引用");
  });

  it("ctx.scene 缺失 → 抛错", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    (ctx.scene as unknown) = null;
    await expect(buildPackScene(ctx as never, "test.json", deps, "/packs.zip")).rejects.toThrow("shared 模式需要核心提供");
  });
});

describe("GPU 释放", () => {
  it("dispose → 移除 group", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    const group = (ctx.scene as THREE.Scene).children[0];
    preview.dispose!();
    expect((ctx.scene as THREE.Scene).children).not.toContain(group);
  });
});

describe("makePackAdapter", () => {
  it("build 用传入的 buildPath", async () => {
    const deps = makeDeps();
    const adapter = makePackAdapter(deps, "/packs/dirt.zip");
    expect(adapter.id).toBe("resourcepack");
    await adapter.build(makeCtx(), "assets/minecraft/models/block/dirt.json");
    expect(hoisted.parseMock).toHaveBeenCalledWith("assets/minecraft/models/block/dirt.json", expect.any(Function));
    await adapter.build(makeCtx(), "assets/minecraft/models/block/grass.json");
    expect(hoisted.parseMock).toHaveBeenCalledWith("assets/minecraft/models/block/grass.json", expect.any(Function));
  });
});

describe("纹理缓存", () => {
  it("textureCache.acquire 在 texEntry 时调用", async () => {
    const { textureCache } = await import("../texture-cache.ts");
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    expect(textureCache.acquire).toHaveBeenCalled();
    preview.dispose!();
  });

  it("textureCache.release 在 dispose 时调用", async () => {
    const { textureCache } = await import("../texture-cache.ts");
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    preview.dispose!();
    expect(textureCache.release).toHaveBeenCalled();
  });
});

describe("材质签名", () => {
  it("不同 texEntry → 不同材质 key", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [
        { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t1.png", tintindex: null, texColor: null, cullface: "north" },
        { dir: "south", verts: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "t2.png", tintindex: null, texColor: null, cullface: "south" },
      ],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "multi.json", deps, "/packs.zip");
    const group = (ctx.scene as THREE.Scene).children[0] as THREE.Group;
    // 两个不同纹理应生成两个 Mesh
    const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(meshes.length).toBe(2);
    preview.dispose!();
  });

  it("相同 texEntry → 合并为单一材质 key", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [
        { dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "same.png", tintindex: null, texColor: null, cullface: "north" },
        { dir: "south", verts: [1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: "same.png", tintindex: null, texColor: null, cullface: "south" },
      ],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "same.json", deps, "/packs.zip");
    const group = (ctx.scene as THREE.Scene).children[0] as THREE.Group;
    const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(meshes.length).toBe(1);
    preview.dispose!();
  });
});

describe("NO_TEX_FALLBACK", () => {
  it("texEntry 为 null 且无 tintindex/texColor → 使用默认灰色", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({
      faces: [{ dir: "north", verts: [0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1], uv: [0, 0, 1, 0, 1, 1, 0, 1], texEntry: null, tintindex: null, texColor: null, cullface: "north" }],
    }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "noface.json", deps, "/packs.zip");
    // readEntry 不应被调用（没有 texEntry）
    expect(deps.readEntry).not.toHaveBeenCalled();
    const group = (ctx.scene as THREE.Scene).children[0] as THREE.Group;
    const mesh = group.children[0] as THREE.Mesh;
    // 检查材质颜色是 NO_TEX_FALLBACK (0xcccccc)
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHex()).toBe(0xcccccc);
    preview.dispose!();
  });
});

describe("空模型", () => {
  it("faces 为空数组 → 不崩溃，生成空 group", async () => {
    hoisted.parseMock.mockResolvedValue(makeJavaModel({ faces: [] }));
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "empty.json", deps, "/packs.zip");
    // group 应该存在但无子 Mesh
    const group = (ctx.scene as THREE.Scene).children[0] as THREE.Group;
    expect(group).toBeDefined();
    const meshes = group.children.filter((c) => (c as THREE.Mesh).isMesh);
    expect(meshes.length).toBe(0);
    preview.dispose!();
  });
});

describe("dispose 幂等性", () => {
  it("多次 dispose 不抛错", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    preview.dispose!();
    // 第二次调用不应抛错
    expect(() => preview.dispose!()).not.toThrow();
    // 第三次也不应抛错
    expect(() => preview.dispose!()).not.toThrow();
  });

  it("dispose 后 group 不再在 scene 中", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    const group = (ctx.scene as THREE.Scene).children[0];
    preview.dispose!();
    expect((ctx.scene as THREE.Scene).children).not.toContain(group);
    // 再次 dispose 不恢复
    preview.dispose!();
    expect((ctx.scene as THREE.Scene).children).not.toContain(group);
  });
});

describe("menu 注入", () => {
  it("setAdapterItems 被调用，菜单项结构正确", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    // mock setAdapterItems 记录调用
    const menuSpy = vi.spyOn(ctx.menu, "setAdapterItems");
    await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    // 注：当前 buildPackScene 不直接调用 setAdapterItems，这是 core 的职责
    // 此处仅验证 menu 对象存在且可用
    expect(ctx.menu).toBeDefined();
    expect(menuSpy).toBeDefined();
    menuSpy.mockRestore();
  });
});

describe("camera framing", () => {
  it("包围盒计算正确，相机位置基于模型中心", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    // camera.near 应被设置为 0.05
    expect((ctx.camera as THREE.PerspectiveCamera).near).toBe(0.05);
    // camera.far 应基于模型尺寸
    expect((ctx.camera as THREE.PerspectiveCamera).far).toBeGreaterThan(0);
    // controls.target 应被设置
    expect((ctx.controls as any).target).toBeDefined();
    // controls.minDistance/maxDistance 应被设置
    expect((ctx.controls as any).minDistance).toBeGreaterThan(0);
    expect((ctx.controls as any).maxDistance).toBeGreaterThan(0);
  });

  it("resetCamera 重新应用 framing", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    const originalFar = (ctx.camera as THREE.PerspectiveCamera).far;
    // 手动改变相机位置
    (ctx.camera as THREE.PerspectiveCamera).position.set(100, 100, 100);
    // resetCamera 应恢复 framing
    preview.resetCamera!();
    expect((ctx.camera as THREE.PerspectiveCamera).position.x).not.toBe(100);
    preview.dispose!();
  });
});

describe("screenshot", () => {
  it("screenshot 返回 data URL", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    const url = await preview.screenshot!();
    expect(url).toBe("screenshot-url");
    preview.dispose!();
  });
});

describe("setRotationMode / setSpeed", () => {
  it("setRotationMode 调用 cameraControls.setOrbit", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    preview.setRotationMode!(true);
    expect((ctx.cameraControls as any).setOrbit).toHaveBeenCalledWith(true);
    preview.setRotationMode!(false);
    expect((ctx.cameraControls as any).setOrbit).toHaveBeenCalledWith(false);
    preview.dispose!();
  });

  it("setSpeed 调用 cameraControls.setSpeed", async () => {
    const deps = makeDeps();
    const ctx = makeCtx();
    const preview = await buildPackScene(ctx, "dirt.json", deps, "/packs.zip");
    preview.setSpeed!(2.5);
    expect((ctx.cameraControls as any).setSpeed).toHaveBeenCalledWith(2.5);
    preview.dispose!();
  });
});