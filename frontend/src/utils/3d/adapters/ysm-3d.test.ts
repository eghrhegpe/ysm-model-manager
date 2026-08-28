// ===== ysm-3d shared 集成测试（ADR-066 §5.7 + ADR-076 v2 Phase 2 菜单收编）=====
// buildYsmScene：loader(path) → preloadModel → buildYsmObject 挂 ctx.scene →
// ctx.menu.setAdapterItems 注入 model/截图/骨骼 三项 → dispose 清理。装配级测试。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildYsmScene, makeYsmAdapter, ysmMenuItems } from "./ysm-adapter.ts";
import type { BedrockGeometry } from "../../../views/app-preview/geometry.ts";
import type { PreviewMenuHandle } from "./preview-menu.ts";
import type { BoneTree } from "../bone-tools.ts";
import type { YsmControlsContext } from "../../../views/app-preview/ysm-controls.ts";

const mocks = vi.hoisted(() => ({
  preloadModel: vi.fn(),
  buildYsmObject: vi.fn(),
  fitCameraToScene: vi.fn(),
  registerBoneRaycast: vi.fn(() => vi.fn()),
}));

vi.mock("../ysm-object.ts", () => ({ buildYsmObject: mocks.buildYsmObject }));
vi.mock("../camera-setup.ts", () => ({ fitCameraToScene: mocks.fitCameraToScene }));
vi.mock("../bone-raycast.ts", () => ({
  buildBoneHierarchy: () => ({ nameMap: new Map(), parentMap: new Map(), childrenMap: new Map() }),
  registerBoneRaycast: mocks.registerBoneRaycast,
}));
vi.mock("../bone-tools.ts", () => ({
  buildBoneTree: vi.fn(() => ({ byId: new Map(), childrenMap: new Map(), roots: [] })),
}));
vi.mock("./vrm-bone-ui.ts", () => ({
  makeBonePanelRenderer: () => () => () => {},
}));

const rootGroup = { type: "Group", children: [] as unknown[] };
const boneGroupMap = new Map();
const modelGroups: unknown[] = [];

// 视图层面板填充函数（DI 注入）：单元测试仅验证适配器将 fill* 接线出去，
// 真实 DOM 渲染由视图层测试覆盖（fill* 属 views 域，utils 不得运行时依赖）。
const fakePanels = {
  fillModelPanel: (list: HTMLElement, _ctx: YsmControlsContext) => {
    list.textContent = "模型统计（骨骼 0 根 / 立方体 0 个）";
  },
  fillShotPanel: () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildYsmObject.mockReturnValue({
    rootGroup,
    boneGroupMap,
    modelGroups,
    showModelGroup: vi.fn(),
    getModelGroupCount: () => 1,
    setBoneVisible: vi.fn(),
    toggleBone: vi.fn(),
    getBoneList: () => [],
    removeFromScene: vi.fn(),
  });
  mocks.fitCameraToScene.mockImplementation(() => {});
  mocks.preloadModel.mockResolvedValue({
    texArr: [],
    spec: { models: [{ bones: [], textureWidth: 64, textureHeight: 32 }] },
  });
  document.body.innerHTML = "";
});

function makeCtx() {
  const scene = { add: vi.fn(), remove: vi.fn() } as unknown as import("three").Scene;
  const camera = {
    position: { clone: () => ({ copy: vi.fn() }), set: vi.fn() },
    lookAt: vi.fn(),
  } as unknown as import("three").PerspectiveCamera;
  const controls = {
    target: { clone: () => ({ copy: vi.fn() }), set: vi.fn(), copy: vi.fn() },
    update: vi.fn(),
  } as never;
  const renderer = { domElement: document.createElement("div") } as unknown as import("three").WebGLRenderer;
  const overlay = document.createElement("div");
  document.body.appendChild(overlay);
  return {
    scene,
    camera,
    controls,
    renderer,
    viewContainer: document.createElement("div"),
    loadingEl: document.createElement("div"),
    overlay,
    menu: { setAdapterItems: vi.fn(), openPanel: vi.fn() } as unknown as PreviewMenuHandle,
  };
}

/** 最近一次 setAdapterItems 收到的适配器项 */
/** 从 preview(built) 对象读取注入的菜单项 */
function registeredItems(preview: { menuItems?: Array<{ id: string; kind: string; render?: (list: HTMLElement, close: () => void) => void; renderCustom?: (list: HTMLElement, close?: () => void) => void; children?: Array<{ id: string; kind: string }> }> | null }): Array<{
  id: string;
  kind: string;
  render?: (list: HTMLElement, close: () => void) => void;
  renderCustom?: (list: HTMLElement, close?: () => void) => void;
  children?: Array<{ id: string; kind: string }>;
}> {
  return (preview.menuItems ?? []) as Array<{
    id: string;
    kind: string;
    render?: (list: HTMLElement, close: () => void) => void;
    renderCustom?: (list: HTMLElement, close?: () => void) => void;
    children?: Array<{ id: string; kind: string }>;
  }>;
}

describe("buildYsmScene（shared 装配）", () => {
  it("loader(path) → model → buildYsmObject 挂 ctx.scene + 注入声明式菜单项", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload: mocks.preloadModel,
      panels: fakePanels,
    });

    expect(loader).toHaveBeenCalledWith("/m/a.ysm");
    expect(mocks.preloadModel).toHaveBeenCalledTimes(1);
    expect(mocks.buildYsmObject).toHaveBeenCalledTimes(1);
    expect(ctx.scene.add).toHaveBeenCalledWith(rootGroup);

    // ADR-076 v2 Phase 2：适配器经 ctx.menu.setAdapterItems 注入 model / 截图 / 骨骼 / 感知 四项
    const items = registeredItems(preview);
    expect(items.map((i) => i.id)).toEqual(["model", "shot", "bones", "perception"]);
    items.forEach((i) => expect(i.kind).toBe("panel"));
    // [doc:adr-126-p4-b] panel 渲染通道二选一：renderCustom（命令式逃生舱）或 children（声明式节点）
    items.forEach((i) =>
      expect(
        typeof i.renderCustom === "function" || (i.children?.length ?? 0) > 0,
        `${i.id} 缺渲染通道`,
      ).toBe(true),
    );

    // model 面板渲染：fill3DPanel 输出统计行（骨骼 0 根 + 立方体 0 个）
    const list = document.createElement("div");
    const modelItem = items.find((i) => i.id === "model")!;
    modelItem.renderCustom!(list, () => {});
    expect(list.textContent).toContain("模型统计");

    preview.dispose();
    expect(mocks.buildYsmObject().removeFromScene).toHaveBeenCalledWith(ctx.scene);
  });

  it("loader 返回空 → 抛错（不挂 scene，不注入菜单）", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => null);
    await expect(
      buildYsmScene(ctx, "/m/missing.ysm", { loader, preload: mocks.preloadModel }),
    ).rejects.toThrow(/加载失败/);
    expect(ctx.scene.add).not.toHaveBeenCalled();
    expect(ctx.menu.setAdapterItems).not.toHaveBeenCalled();
  });

  it("dispose → raycast cleanup + removeFromScene + bonePanelCleanup", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", { loader, preload: mocks.preloadModel });
    preview.dispose();
    expect(mocks.registerBoneRaycast).toHaveBeenCalled();
  });

  it("makeYsmAdapter：build 用传入 path（switchTo 换模型语义，闭包 path 仅初始值）", async () => {
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const adapter = makeYsmAdapter("/m/a.ysm", { loader, preload: mocks.preloadModel });
    expect(adapter.id).toBe("ysm");
    // switchTo 语义：core 调 build(ctx, newPath) 重建内容层——必须加载 newPath 而非闭包旧 path
    await expect(
      adapter.build(makeCtx() as never, "/m/b.ysm"),
    ).resolves.toBeTruthy();
    expect(loader).toHaveBeenCalledWith("/m/b.ysm");
  });
});

describe("buildYsmScene 面板填充与骨骼拾取", () => {
  it("fillModelPanel 被调用时正确渲染（面板注入验证）", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload: mocks.preloadModel,
      panels: fakePanels,
    });

    const items = registeredItems(preview);
    const modelItem = items.find((i) => i.id === "model")!;
    const list = document.createElement("div");
    modelItem.renderCustom!(list, () => {});
    expect(list.textContent).toContain("模型统计");

    preview.dispose();
  });

  it("shot 面板为声明式 children（6 截图按钮节点，无 renderCustom）", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload: mocks.preloadModel,
      panels: fakePanels,
    });

    const items = registeredItems(preview);
    const shotItem = items.find((i) => i.id === "shot")!;
    // [doc:adr-126-p4-b-2] shot 面板改走声明式 children（ysmShotNodes 纯数据节点）
    expect(shotItem.renderCustom).toBeUndefined();
    expect(shotItem.children?.length).toBe(6);
    expect(shotItem.children?.every((n) => n.kind === "button")).toBe(true);

    preview.dispose();
  });
});

describe("buildYsmScene dispose 清理行为", () => {
  it("dispose 时 bonePanel cleanup 被调用", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    let cleanupCalled = false;
    // 用真实 cleanupRef 追踪
    const origBuildYsmObject = mocks.buildYsmObject;
    mocks.buildYsmObject.mockReturnValue({
      rootGroup,
      boneGroupMap,
      modelGroups,
      showModelGroup: vi.fn(),
      getModelGroupCount: () => 1,
      setBoneVisible: vi.fn(),
      toggleBone: vi.fn(),
      getBoneList: () => [],
      removeFromScene: vi.fn(),
    });

    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload: mocks.preloadModel,
    });

    // bonePanelRef.current 在 build 后仍为 null（未打开骨骼面板）
    preview.dispose();
    // dispose 应成功不抛错
    expect(() => preview.dispose()).not.toThrow();
  });

  it("无 panels 时不崩溃（panels 可选）", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload: mocks.preloadModel,
    });

    // 无 panels → 菜单项 render 退化为 no-op
    const items = registeredItems(preview);
    const modelItem = items.find((i) => i.id === "model")!;
    const list = document.createElement("div");
    expect(() => modelItem.renderCustom!(list, () => {})).not.toThrow();

    preview.dispose();
  });
});

describe("buildYsmScene 动画播放器集成（ADR-100）", () => {
  it("listAllFilePaths + readTextFile → 扫描 .animation.json 并构建播放器", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const listPaths = vi.fn().mockResolvedValue([
      "/m/anim/test.animation.json",
      "/m/anim/readme.txt",
    ]);
    const readTextFile = vi.fn().mockResolvedValue(btoa('{"clips":[{"name":"idle","frames":[]}]}'));

    const preview = await buildYsmScene(ctx, "/m/anim/model.ysm", {
      loader,
      preload: mocks.preloadModel,
      listAllFilePaths: listPaths,
      readTextFile,
    });

    expect(listPaths).toHaveBeenCalledWith("/m/anim");
    expect(readTextFile).toHaveBeenCalledWith("/m/anim/test.animation.json");
    expect(preview.update).toBeDefined(); // animPlayer 已注入 update

    preview.dispose();
  });

  it("无 .animation.json → 不注入 play 菜单项", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const listPaths = vi.fn().mockResolvedValue([
      "/m/model.ysm",
    ]);
    const readTextFile = vi.fn();

    const preview = await buildYsmScene(ctx, "/m/model.ysm", {
      loader,
      preload: mocks.preloadModel,
      listAllFilePaths: listPaths,
      readTextFile,
    });

    const items = registeredItems(preview);
    const playItem = items.find((i) => i.id === "ysm-play");
    expect(playItem).toBeUndefined();

    preview.dispose();
  });

  it(".animation.json 解析失败 → 静默降级不阻断模型渲染", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const listPaths = vi.fn().mockResolvedValue([
      "/m/anim/bad.animation.json",
    ]);
    const readTextFile = vi.fn().mockResolvedValue("invalid-json");

    // 允许 build 成功
    const preview = await buildYsmScene(ctx, "/m/anim/model.ysm", {
      loader,
      preload: mocks.preloadModel,
      listAllFilePaths: listPaths,
      readTextFile,
    });

    expect(preview.dispose).toBeDefined();
    preview.dispose();
  });

  it("内嵌动画 model._animClips → 注入 play 菜单项（单文件 .ysm 无磁盘动画文件）", async () => {
    const ctx = makeCtx();
    const clip = {
      name: "idle",
      loop: true,
      length: 1,
      bones: {
        root: { position: [{ time: 0, post: [0, 0, 0], pre: [0, 0, 0], lerp: "linear" }] },
      },
    };
    const loader = vi.fn(
      async () => ({ bones: [], _animClips: [clip] } as unknown as BedrockGeometry),
    );

    // 故意不注入 listAllFilePaths/readTextFile：单文件模型磁盘没有 .animation.json
    const preview = await buildYsmScene(ctx, "/m/model.ysm", {
      loader,
      preload: mocks.preloadModel,
    });

    const items = registeredItems(preview);
    expect(items.find((i) => i.id === "ysm-play")).toBeDefined();

    preview.dispose();
  });

  it("磁盘 .animation.json 含 UTF-8 中文 → 正确解码，clip 名不乱码", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const jsonStr = JSON.stringify({
      animations: {
        挥手: { animation_length: 1, loop: true, bones: { root: { position: { "0": [0, 0, 0] } } } },
        鞠躬: { animation_length: 1, loop: true, bones: { root: { position: { "0": [0, 0, 0] } } } },
      },
    });
    const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
    const listPaths = vi.fn().mockResolvedValue(["/m/anim/motion.animation.json"]);
    const readTextFile = vi.fn().mockResolvedValue(b64);
    let firstLabel: string | null = null;

    const preview = await buildYsmScene(ctx, "/m/anim/model.ysm", {
      loader,
      preload: mocks.preloadModel,
      listAllFilePaths: listPaths,
      readTextFile,
      fillPlayPanel: (_list, bridge) => {
        firstLabel = bridge.clips[0]?.label ?? null;
      },
    });

    const items = registeredItems(preview);
    const playItem = items.find((i) => i.id === "ysm-play");
    expect(playItem).toBeDefined();
    playItem!.renderCustom!(document.createElement("div"), () => {});
    // 多 clip 标签 = 「文件名 · clip 名」；乱码解码会让 clip 名变 Latin-1 杂音
    expect(firstLabel).toBe("motion · 挥手");

    preview.dispose();
  });
});

describe("ysmMenuItems 独立菜单表测试", () => {
  it("基本菜单项结构完整（model/shot/bones）", () => {
    const opts = {
      controlsCtx: {
        model: {} as never,
        texIdx: 0,
        texArr: [],
        spec: {} as never,
        handle: {} as never,
      },
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree,
        viewContainer: document.createElement("div"),
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
    };
    const items = ysmMenuItems(opts);
    expect(items.map((i) => i.id)).toEqual(["model", "shot", "bones"]);
    // model/shot 归 model 组；bones 归 motion 组（骨骼是动作驱动目标）
    expect(items[0].dockGroup).toBe("model");
    expect(items[1].dockGroup).toBe("model");
    expect(items[2].dockGroup).toBe("motion");
    items.forEach((i) => {
      expect(i.kind).toBe("panel");
      // [doc:adr-126-p4-b] panel 渲染通道二选一：renderCustom（命令式逃生舱）或 children（声明式节点）
      expect(
        typeof i.renderCustom === "function" || (i.children?.length ?? 0) > 0,
        `${i.id} 缺渲染通道`,
      ).toBe(true);
    });
  });

  it("有 play bridge 时追加 ysm-play 菜单项", () => {
    const opts = {
      controlsCtx: {
        model: {} as never,
        texIdx: 0,
        texArr: [],
        spec: {} as never,
        handle: {} as never,
      },
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree,
        viewContainer: document.createElement("div"),
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
      play: {
        clips: [{ label: "idle" }],
        isPlaying: () => false,
        toggle: vi.fn(),
        currentIndex: () => 0,
        select: vi.fn(),
        animDir: null,
      },
      fillPlayPanel: vi.fn(),
    };
    const items = ysmMenuItems(opts);
    expect(items.map((i) => i.id)).toContain("ysm-play");
    expect(items.find((i) => i.id === "ysm-play")!.dockGroup).toBe("motion");
  });

  it("bonePanel cleanupRef 重入时先清理旧 renderer", () => {
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();
    const opts = {
      controlsCtx: {
        model: {} as never,
        texIdx: 0,
        texArr: [],
        spec: {} as never,
        handle: {} as never,
      },
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree,
        viewContainer: document.createElement("div"),
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
    };
    const items = ysmMenuItems(opts);
    const bonesItem = items.find((i) => i.id === "bones")!;
    const list = document.createElement("div");

    // 首次渲染：cleanupRef.current 初始为 null，直接注册
    bonesItem.renderCustom!(list, () => {});
    expect(cleanup1).not.toHaveBeenCalled();

    // 模拟重入场景：cleanupRef.current 已有值（第二次渲染）
    // 此时应触发清理旧 renderer
    const cleanupRef = (opts.bonePanel as { cleanupRef: { current: (() => void) | null } }).cleanupRef;
    cleanupRef.current = cleanup2;
    bonesItem.renderCustom!(list, () => {});
    expect(cleanup2).toHaveBeenCalledTimes(1);
  });
});
