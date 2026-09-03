// ===== ysm-3d shared 集成测试（ADR-066 §5.7 + ADR-076 v2 Phase 2 菜单收编）=====
// buildYsmScene：loader(path) → preloadModel → buildYsmObject 挂 ctx.scene →
// ctx.menu.setAdapterItems 注入 model/截图/骨骼 三项 → dispose 清理。装配级测试。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";
import { buildYsmScene, makeYsmAdapter, ysmMenuItems } from "./ysm-adapter.ts";
import type { BedrockGeometry } from "../decoder/geometry.ts";
import type { PreviewMenuHandle } from "../menu/core.ts";
import type { BoneTree } from "../bone-tools.ts";
import type { YsmModel, YsmContentHandle } from "../../views/app-preview/ysm-controls.ts";
import type { Spec3D } from "../model3d.ts";
import type { PreviewBuildCtx, PreviewScene } from "./mount-preview-core.ts";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
vi.mock("./bones-panel-node.ts", () => ({
  // stub 工厂：记录调用参数，便于断言「ysm 正确把 o.bonePanel 字段传给工厂」
  // bones 面板的真实渲染行为（含 cleanupRef 重入、空守卫）在 bones-panel-node.test.ts 覆盖
  makeBonesPanelItem: vi.fn((opts: { legacyTestId: string }) => ({
    id: "bones",
    icon: "🦴",
    labelKey: "preview.section.bones",
    fallback: "骨骼",
    kind: "panel" as const,
    dockGroup: "motion" as const,
    legacyTestId: opts.legacyTestId,
    renderCustom: (): void => {},
  })),
}));

const rootGroup = { type: "Group", children: [] as unknown[] };
const boneGroupMap = new Map();
const modelGroups: unknown[] = [];

// 视图层面板填充函数（DI 注入）：单元测试仅验证适配器将 fill* 接线出去，
// 真实 DOM 渲染由视图层测试覆盖（fill* 属 views 域，utils 不得运行时依赖）。
const fakePanels = {
  fillShotPanel: () => {},
  // [doc:adr-126-p4-b-2] 声明式节点工厂经 panels 注入（R1 禁 utils→views 运行时依赖）——
  // 桩返回 6 个 button 节点，对齐 shotButtonNodes 结构（ysm-3d.test 断言 children.length === 6）
  shotNodes: () =>
    ["current", "front", "45", "side", "back45", "all"].map((k) => ({
      id: `ysm-shot-${k}`,
      kind: "button" as const,
      labelKey: `preview.screenshot${k[0].toUpperCase()}${k.slice(1)}`,
      fallback: k,
      legacyTestId: `shot-${k}`,
    })),
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
    componentTexMap: new Map(),
    // 审核 C1 新契约：preload 必须提供引用归还器（dispose 消费）
    releaseTextures: vi.fn(),
  });
  document.body.innerHTML = "";
});

function makeCtx() {
  const scene = { add: vi.fn(), remove: vi.fn() } as unknown as import("three").Scene;
  const camera = {
    // position.clone() 返回带 copy 的对象（resetCamera 用 position.copy(initCamPos) 回位）
    position: { clone: () => ({ copy: vi.fn(), x: 1, y: 2, z: 3 }), copy: vi.fn(), set: vi.fn() },
    lookAt: vi.fn(),
  } as unknown as import("three").PerspectiveCamera;
  const controls = {
    target: { clone: () => ({ copy: vi.fn() }), set: vi.fn(), copy: vi.fn() },
    update: vi.fn(),
  } as unknown as OrbitControls;
  const rendererDom = document.createElement("div");
  // width/height = 0 → screenshotFromRenderer 未就绪守卫返回 null（fake renderer 无 getSize）
  (rendererDom as unknown as { width: number; height: number }).width = 0;
  (rendererDom as unknown as { width: number; height: number }).height = 0;
  const renderer = { domElement: rendererDom } as unknown as import("three").WebGLRenderer;
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
/** 从 preview(content) 对象读取注入的菜单项 */
function registeredItems(preview: { menuItems?: Array<{ id: string; kind: string; render?: (list: HTMLElement, close: () => void) => void; renderCustom?: (list: HTMLElement, close?: () => void) => void; children?: Array<{ id: string; kind: string }>; schemaId?: string }> | null }): Array<{
  id: string;
  kind: string;
  render?: (list: HTMLElement, close: () => void) => void;
  renderCustom?: (list: HTMLElement, close?: () => void) => void;
  children?: Array<{ id: string; kind: string }>;
  schemaId?: string;
}> {
  return (preview.menuItems ?? []) as Array<{
    id: string;
    kind: string;
    render?: (list: HTMLElement, close: () => void) => void;
    renderCustom?: (list: HTMLElement, close?: () => void) => void;
    children?: Array<{ id: string; kind: string }>;
    schemaId?: string;
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
    // [doc:adr-126-p4-b + p5-a] panel 渲染通道三选一：renderCustom / children / schemaId（受控 registry）
    items.forEach((i) =>
      expect(
        typeof i.renderCustom === "function" || (i.children?.length ?? 0) > 0 || typeof i.schemaId === "string",
        `${i.id} 缺渲染通道`,
      ).toBe(true),
    );

    // [doc:adr-126-p5-c] model 面板走受控 schema：schemaId="ysm-model"，registry 注册后
    // renderPreviewPanel 查 getSchema("ysm-model") 产出声明式节点（不再 renderCustom）
    const modelItem = items.find((i) => i.id === "model")!;
    expect(modelItem.schemaId).toBe("ysm-model");
    expect(modelItem.renderCustom).toBeUndefined();

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

  it("makeYsmAdapter：build 用传入 path（switchTo 换模型语义，无闭包初始 path）", async () => {
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const adapter = makeYsmAdapter({ loader, preload: mocks.preloadModel });
    expect(adapter.id).toBe("ysm");
    // switchTo 语义：core 调 build(ctx, newPath) 重建内容层——必须加载本次传入的 newPath，
    // makeYsmAdapter 不持有任何初始 path（死参数已清理），无从 fallback 旧模型
    await expect(
      adapter.build(makeCtx() as unknown as PreviewBuildCtx, "/m/b.ysm"),
    ).resolves.toBeTruthy();
    expect(loader).toHaveBeenCalledWith("/m/b.ysm");
  });
});

describe("buildYsmScene 面板填充与骨骼拾取", () => {
  it("[doc:adr-126-p5-c] model 面板 schemaId 驱动：注册钩子被调 + 面板无 renderCustom", async () => {
    const ctx = makeCtx();
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const registerModelSchema = vi.fn();
    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload: mocks.preloadModel,
      panels: { ...fakePanels, registerModelSchema },
    });

    // build 时注册钩子被调（视图层在此注册 buildYsmModelSchema）
    expect(registerModelSchema).toHaveBeenCalledTimes(1);

    const items = registeredItems(preview);
    const modelItem = items.find((i) => i.id === "model")!;
    expect(modelItem.schemaId).toBe("ysm-model");
    expect(modelItem.renderCustom).toBeUndefined();

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
    // 用真实 cleanupRef 追踪
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

    // 无 panels → 菜单项 render 退化为 no-op（model 面板 schemaId 驱动，无注册时渲染不炸）
    const items = registeredItems(preview);
    const modelItem = items.find((i) => i.id === "model")!;
    // 无 registerModelSchema → registry 无 "ysm-model" → renderPreviewPanel 走通道衰退（不炸）
    expect(modelItem.schemaId).toBe("ysm-model");
    expect(modelItem.renderCustom).toBeUndefined();

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
      panels: {
        fillShotPanel: () => {},
        // [doc:adr-126-p5-收尾] play 面板声明式化：playNodes 经 panels 注入（R1 合规），
        // 捕获 bridge 验证动作标签解码
        playNodes: (bridge) => {
          firstLabel = bridge.clips[0]?.label ?? null;
          return [];
        },
      },
    });

    const items = registeredItems(preview);
    const playItem = items.find((i) => i.id === "ysm-play");
    expect(playItem).toBeDefined();
    // play 节点走 children（playNodes 产出），不再 renderCustom
    expect(playItem?.renderCustom).toBeUndefined();
    // 多 clip 标签 = 「文件名 · clip 名」；乱码解码会让 clip 名变 Latin-1 杂音
    expect(firstLabel).toBe("motion · 挥手");

    preview.dispose();
  });
});

describe("ysmMenuItems 独立菜单表测试", () => {
  it("基本菜单项结构完整（model/shot/bones）", () => {
    const opts = {
      controlsCtx: {
        model: {} as unknown as YsmModel,
        texIdx: 0,
        texArr: [],
        spec: {} as unknown as Spec3D,
        handle: {} as unknown as YsmContentHandle,
      },
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree,
        viewContainer: document.createElement("div"),
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
      // [doc:adr-126-p4-b-2] shotNodes 经 panels 注入（R1 禁 utils→views 运行时依赖）——桩保证 shot 面板有渲染通道
      panels: {
        fillShotPanel: () => {},
        shotNodes: () => [{ id: "ysm-shot-current", kind: "button" as const, labelKey: "x", fallback: "x" }],
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
      // [doc:adr-126-p4-b + p5-a] panel 渲染通道三选一：renderCustom / children / schemaId（受控 registry）
      expect(
        typeof i.renderCustom === "function" || (i.children?.length ?? 0) > 0 || typeof i.schemaId === "string",
        `${i.id} 缺渲染通道`,
      ).toBe(true);
    });
  });

  it("有 play bridge 时追加 ysm-play 菜单项", () => {
    const opts = {
      controlsCtx: {
        model: {} as unknown as YsmModel,
        texIdx: 0,
        texArr: [],
        spec: {} as unknown as Spec3D,
        handle: {} as unknown as YsmContentHandle,
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
    };
    const items = ysmMenuItems(opts);
    expect(items.map((i) => i.id)).toContain("ysm-play");
    expect(items.find((i) => i.id === "ysm-play")!.dockGroup).toBe("motion");
  });

  // 旧「cleanupRef 重入清理」测试已删除——该责任点迁出 ysm-adapter 至
  // bones-panel-node.ts（4 adapter 共用工厂）。行为契约在 bones-panel-node.test.ts
  // 「cleanupRef 重入清理：第二次 renderCustom 前先调上一次 cleanup 并置 null」覆盖。
  // ysm-adapter 这一层只剩「正确把 o.bonePanel 字段传给工厂」的接线契约：

  it("ysm 正确把 bonePanel 字段（tree/cleanupRef/viewContainer/camera/scene/legacyTestId）传给 bones 工厂", async () => {
    const { makeBonesPanelItem } = await import("./bones-panel-node.ts");
    const cleanupRef = { current: null };
    const viewContainer = document.createElement("div");
    const tree = { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree;
    const opts = {
      controlsCtx: {
        model: {} as unknown as YsmModel,
        texIdx: 0,
        texArr: [],
        spec: {} as unknown as Spec3D,
        handle: {} as unknown as YsmContentHandle,
      },
      bonePanel: {
        tree,
        viewContainer,
        camera: null,
        scene: null,
        cleanupRef,
      },
    };
    ysmMenuItems(opts);
    expect(makeBonesPanelItem).toHaveBeenCalledWith({
      tree,
      cleanupRef,
      viewContainer,
      camera: null,
      scene: null,
      legacyTestId: "ysm-bones-entry",
    });
  });
});

// ===== 覆盖率攻坚：守卫 / 多模型模式 / 拾取回调 / 播放桥 / F 键调试 / 生命周期方法 =====

import { sceneRegistry } from "./scene-registry.ts";

describe("buildYsmScene 守卫与多模型模式", () => {
  beforeEach(() => {
    sceneRegistry.reset();
    mocks.registerBoneRaycast.mockReset();
    mocks.registerBoneRaycast.mockImplementation(() => vi.fn());
  });

  it("scene/camera/controls/renderer 缺失 → 抛错（shared 模式前置守卫）", async () => {
    const ctx = makeCtx() as Record<string, unknown>;
    delete ctx.renderer;
    await expect(
      buildYsmScene(ctx as unknown as PreviewBuildCtx, "/m/a.ysm", {
        loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
        preload: mocks.preloadModel,
      }),
    ).rejects.toThrow(/需要核心提供/);
  });

  it("多模型同框（注册表非空）→ 跳过逐模型 raycast（统一拾取器接管），dispose 不抛", async () => {
    sceneRegistry.register({
      path: "other.ysm",
      rtype: "ysm",
      roots: [],
      content: { dispose: vi.fn() } as unknown as PreviewScene,
    });
    const ctx = makeCtx();
    const preview = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
      preload: mocks.preloadModel,
    });
    expect(mocks.registerBoneRaycast).not.toHaveBeenCalled();
    expect(() => preview.dispose()).not.toThrow();
    sceneRegistry.reset(); // 防泄漏：多模型态不留到后续用例
  });
});

describe("buildYsmScene 拾取/播放/调试/生命周期补全", () => {
  it("拾取回调 + 播放桥 + 控制器 + F 键调试全链路", async () => {
    sceneRegistry.reset(); // 单模型模式：raycast 走逐模型注册
    const ctx = makeCtx();
    mocks.registerBoneRaycast.mockReset();
    const capturedRayState: { rayState: { onBoneSelectCallback: ((i: unknown) => void) | null } | null } = { rayState: null };
    (mocks.registerBoneRaycast as unknown as { mockImplementation: (f: (...args: unknown[]) => unknown) => void }).mockImplementation(
      (...args: unknown[]) => {
        const rayState = args[7] as { setHoveredBone: (v: string | null) => void; setHoveredMesh: (v: unknown) => void; onBoneSelectCallback: ((i: unknown) => void) | null };
        rayState.setHoveredBone("b1");
        rayState.setHoveredMesh({});
        capturedRayState.rayState = rayState;
        return () => {};
      },
    );
    mocks.preloadModel.mockResolvedValue({
      texArr: [],
      spec: { models: [{ bones: [{ id: "b1", name: "Body", parentId: null }], textureWidth: 64, textureHeight: 32 }] },
    });
    const THREE = await import("three");
    mocks.buildYsmObject.mockReturnValue({
      rootGroup: new THREE.Group(),
      boneGroupMap: new Map([["b1", new THREE.Group()]]),
      modelGroups,
      showModelGroup: vi.fn(),
      getModelGroupCount: () => 1,
      setBoneVisible: vi.fn(),
      toggleBone: vi.fn(),
      getBoneList: () => [],
      removeFromScene: vi.fn(),
    });

    const listPaths = vi.fn().mockResolvedValue([
      "/m/anim/motion.animation.json",
      "/m/anim/ctl.animation_controllers.json",
    ]);
    const readTextFile = vi.fn().mockImplementation(async (p: string) => {
      if (p.endsWith(".animation_controllers.json")) {
        return btoa(JSON.stringify({
          format_version: "1.10",
          animation_controllers: { ctl: { states: { default: { animations: ["idle"], transitions: [] } } } },
        }));
      }
      return btoa(JSON.stringify({ animations: { idle: { animation_length: 1, loop: true, bones: { root: { position: { "0": [0, 0, 0] } } } } } }));
    });

    let controlsCtx: Record<string, unknown> = {};
    let playBridge: Record<string, (...a: unknown[]) => unknown> | null = null;
    const preview = await buildYsmScene(ctx, "/m/anim/model.ysm", {
      loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
      preload: mocks.preloadModel,
      listAllFilePaths: listPaths,
      readTextFile,
      panels: {
        fillShotPanel: () => {},
        shotNodes: (c) => { controlsCtx = c as unknown as Record<string, unknown>; return []; },
        playNodes: (bridge) => { playBridge = bridge as unknown as Record<string, (...a: unknown[]) => unknown>; return []; },
      },
    });

    // 拾取回调：rayState.onBoneSelectCallback → content.onBoneSelect（null 时 no-op 不抛）
    expect(capturedRayState.rayState).not.toBeNull();
    expect(() => capturedRayState.rayState!.onBoneSelectCallback!({ boneId: "b1" })).not.toThrow();

    // 播放桥闭包（isPlaying/toggle/currentIndex/select → animPlayer）
    expect(playBridge).not.toBeNull();
    const p0 = playBridge!.isPlaying!() as boolean;
    playBridge!.toggle!();
    expect(playBridge!.isPlaying!()).toBe(!p0);
    playBridge!.currentIndex!();
    playBridge!.select!(0);
    playBridge!.toggle!();

    // controlsCtx.screenshot 闭包（fake renderer → 静默 null）
    await expect(
      (controlsCtx.screenshot as () => Promise<string | null>)(),
    ).resolves.toBeNull();

    // content 句柄方法（视图层消费面；mock obj 方法直透）
    const handle = controlsCtx.handle as {
      showModelGroup: (i: number) => void;
      getModelGroupCount: () => number;
      setBoneVisible: (n: string, v: boolean) => void;
      toggleBone: (n: string) => void;
      getBoneList: (i?: number) => unknown;
    };
    handle.showModelGroup(0);
    handle.getModelGroupCount();
    handle.setBoneVisible("b1", false);
    handle.toggleBone("b1");
    handle.getBoneList();

    // F 键调试：其他键 / 组合键早退；单按 f → normal→pivot（rebuildDebug 真实执行）
    const dom = ctx.renderer.domElement as HTMLElement;
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "f" })); // → pivot（debugGroup 非空）
    dom.dispatchEvent(new KeyboardEvent("keydown", { key: "f" })); // → bone（debugGroup 非空，dispose 时释放）

    // 生命周期方法
    expect(() => preview.resetCamera?.()).not.toThrow();
    preview.setRotationMode?.(true);
    preview.setSpeed?.(5);
    preview.showModelGroup?.(0);
    preview.onBonePick?.("b1");
    expect(ctx.menu.openPanel).toHaveBeenCalledWith("b1");
    preview.update?.(0.016);
    await expect(preview.screenshot?.()).resolves.toBeNull();

    preview.dispose();
  });
});

// ===== 审核 C1 回归：纹理所有权归还（P0 缺陷，YSM + 女仆两条主路径）=====
// 背景：loadTextures 内部对每个 URL 调 textureCache.acquire（refs+1），而 dispose 原先
// 直接 t.dispose() 从不归还引用 → 缓存条目 refs 恒 ≥1，LRU 只淘汰 refs===0 条目 →
// 淘汰永久失效、缓存越过上限单调增长，且池会继续分发已销毁的 Texture。
describe("buildYsmScene 纹理引用归还（审核 C1 P0）", () => {
  const fakeLoader = () => vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));

  function makePreloadWithTextures() {
    const texA = new THREE.Texture();
    const texB = new THREE.Texture();
    const releaseTextures = vi.fn();
    const preload = vi.fn(async () => ({
      texArr: [texA, texB],
      spec: { models: [{ bones: [], textureWidth: 64, textureHeight: 32 }] },
      componentTexMap: new Map<string, (THREE.Texture | null)[]>(),
      releaseTextures,
    }));
    return {
      disposeA: vi.spyOn(texA, "dispose"),
      disposeB: vi.spyOn(texB, "dispose"),
      releaseTextures,
      preload,
    };
  }

  it("dispose → 归还引用而非 dispose 纹理（所有权归缓存池）", async () => {
    const ctx = makeCtx();
    const { disposeA, disposeB, releaseTextures, preload } = makePreloadWithTextures();
    const preview = await buildYsmScene(ctx, "/m/a.ysm", { loader: fakeLoader(), preload });
    preview.dispose();

    expect(releaseTextures).toHaveBeenCalledTimes(1);
    // 关键回归点：此前 dispose 直接 t.dispose()，留下 refs 恒 ≥1 的僵尸条目
    expect(disposeA).not.toHaveBeenCalled();
    expect(disposeB).not.toHaveBeenCalled();
    expect(mocks.buildYsmObject().removeFromScene).toHaveBeenCalledWith(ctx.scene);
  });

  it("buildYsmObject 抛错 → 仍归还纹理引用（失败路径不泄漏）", async () => {
    const ctx = makeCtx();
    const { releaseTextures, preload } = makePreloadWithTextures();
    mocks.buildYsmObject.mockImplementationOnce(() => {
      throw new Error("build failed");
    });

    await expect(
      buildYsmScene(ctx, "/m/broken.ysm", { loader: fakeLoader(), preload }),
    ).rejects.toThrow(/build failed/);
    // preload 已 acquire，句柄尚未产出 → 不归还即永久泄漏（对齐 pack-model-adapter:265）
    expect(releaseTextures).toHaveBeenCalledTimes(1);
    expect(ctx.scene.add).not.toHaveBeenCalled();
  });

  it("preload 未提供 releaseTextures → dispose 降级不抛（兼容旧注入方）", async () => {
    const ctx = makeCtx();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const preload = vi.fn(async () => ({
        texArr: [],
        spec: { models: [{ bones: [], textureWidth: 64, textureHeight: 32 }] },
        componentTexMap: new Map(),
      }));
      const preview = await buildYsmScene(ctx, "/m/legacy.ysm", { loader: fakeLoader(), preload });
      expect(() => preview.dispose()).not.toThrow();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("releaseTextures"));
    } finally {
      warn.mockRestore();
    }
  });
});
