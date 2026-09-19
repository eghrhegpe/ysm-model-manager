// ===== YSM 适配器契约测试（ysm-adapter.ts 728L 零 .test.ts 的头号覆盖盲区）=====
// 可测边界判定：
//  ① 纯逻辑/编排全可 node 测（happy-dom + three 纯 JS 无 WebGL）：菜单表 ysmMenuItems、
//    schemaId 全局/per-scene 键、adapter 工厂、dispose 契约、F 键调试、感知能力派生、
//    动画文件扫描数据流、load-trace 载荷、纹理引用归还。
//  ② buildYsmObject 内 three 场景构建（WebGL 消费侧）→ mock 掉（ysm-object.test.ts 单测覆盖）；
//    相机取景 fitCameraToScene / 骨骼射线拾取 registerBoneRaycast → mock（camera-setup /
//    bone-raycast 各自 .test.ts 覆盖）；几何计算在 Go 端（go-threejs 卡），前端只消费 spec。
// 与 ysm-3d.test.ts 差异：本文件补齐其未覆盖的契约——per-scene schema 键 + dispose 精准注销、
//  load-trace 载荷、update 感知暂停派生、generic 模式特性裁剪、动画扫描目录推导/标签策略、
//  F 键调试循环与输入守卫、makeYsmAdapter 工厂面（onClose/id/双 build）、screenshot 闭包。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { AnimationClip } from "@/utils/animation/animation.ts";
import type { BoneTree } from "@/preview-3d/bone/bone-tools.ts";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";
import type { Spec3D } from "@/preview-3d/mesh/model3d.ts";
import type { PreviewMenuHandle } from "@/preview-3d/menu/engine/core.ts";
import type {
  CameraControlScene,
  GroupedScene,
  PreviewBuildCtx,
  ScreenshotScene,
  UpdateableScene,
} from "./mount-preview-core.ts";
import type { YsmControlsContext } from "@/preview-3d/infra/content-bridges.ts";
import {
  YSM_MODEL_SCHEMA_ID,
  hasSchema,
  makeYsmModelSchemaId,
  registerSchema,
  resetSchemas,
} from "@/preview-3d/infra/schema-registry.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";
import {
  buildYsmScene,
  makeYsmAdapter,
  type YsmAdapterOptions,
  ysmMenuItems,
} from "./ysm-adapter.ts";
import type { LocaleKey } from "@/core/i18n/t.ts";

const h = vi.hoisted(() => ({
  buildYsmObject: vi.fn(),
  fitCamera: vi.fn(),
  buildBoneHierarchy: vi.fn(),
  registerBoneRaycast: vi.fn(),
  rayCleanup: vi.fn(),
  buildBoneTree: vi.fn(),
  disposeDebugGroup: vi.fn(),
  rebuildDebug: vi.fn(),
  registerModelRoot: vi.fn(),
  unregisterModelRoot: vi.fn(),
  recordLoadTrace: vi.fn(),
  createBreath: vi.fn(),
  setPerceptionPaused: vi.fn(),
  perceptionPauseRef: { paused: false },
  screenshot: vi.fn(),
  createYsmAnimPlayer: vi.fn(),
  logWarn: vi.fn(),
  isEditableTarget: vi.fn(() => false),
  makeBonesPanelItem: vi.fn(),
}));

vi.mock("@/preview-3d/model/ysm-object.ts", () => ({ buildYsmObject: h.buildYsmObject }));
vi.mock("@/preview-3d/infra/camera-setup.ts", () => ({ fitCameraToScene: h.fitCamera }));
vi.mock("@/preview-3d/bone/bone-raycast.ts", () => ({
  buildBoneHierarchy: h.buildBoneHierarchy,
  registerBoneRaycast: h.registerBoneRaycast,
}));
vi.mock("@/preview-3d/bone/bone-tools.ts", () => ({ buildBoneTree: h.buildBoneTree }));
vi.mock("@/preview-3d/infra/cleanup-helper.ts", () => ({ disposeDebugGroup: h.disposeDebugGroup }));
vi.mock("@/preview-3d/infra/debug-render.ts", () => ({ rebuildDebug: h.rebuildDebug }));
vi.mock("@/preview-3d/infra/frustum-cull.ts", () => ({
  registerModelRoot: h.registerModelRoot,
  unregisterModelRoot: h.unregisterModelRoot,
}));
vi.mock("@/preview-3d/infra/load-trace.ts", () => ({ recordLoadTrace: h.recordLoadTrace }));
vi.mock("@/preview-3d/adapters/shared/perception/breath.ts", () => ({ createBreathController: h.createBreath }));
vi.mock("@/preview-3d/adapters/shared/perception/core.ts", () => ({
  createPerceptionPauseRef: () => h.perceptionPauseRef,
}));
beforeEach(() => {
  h.perceptionPauseRef.paused = false;
});
vi.mock("@/preview-3d/screenshot/screenshot.ts", () => ({ screenshotFromRenderer: h.screenshot }));
vi.mock("@/preview-3d/model/ysm-animation-player.ts", () => ({ createYsmAnimPlayer: h.createYsmAnimPlayer }));
vi.mock("@/utils/base/primitives/log.ts", () => ({ logWarn: h.logWarn }));
vi.mock("@/utils/dom/editable-target.ts", () => ({ isEditableTarget: h.isEditableTarget }));
vi.mock("@/preview-3d/menu/panels/bones-panel-node.ts", () => ({ makeBonesPanelItem: h.makeBonesPanelItem }));

// ── 假依赖工厂 ─────────────────────────────────────────────

/** 默认 YsmObjectHandle（three 纯 JS Group/Map，无 WebGL） */
function makeObj(names: string[]) {
  const boneGroupMap = new Map<string, THREE.Group>();
  for (const n of names) boneGroupMap.set(n, new THREE.Group());
  const showModelGroup = vi.fn();
  return {
    obj: {
      rootGroup: new THREE.Group(),
      boneGroupMap,
      modelGroups: [new THREE.Group()],
      showModelGroup,
      getModelGroupCount: () => 1,
      setBoneVisible: vi.fn(),
      toggleBone: vi.fn(),
      getBoneList: () => [],
      removeFromScene: vi.fn(),
    },
    boneGroupMap,
    showModelGroup,
  };
}

/** 可控制状态的假动画播放器（对齐 YsmAnimPlayer 接口面） */
function makeFakePlayer() {
  const st = { playing: false, idx: 0, active: true, ctrl: null as unknown };
  const apply = vi.fn();
  const dispose = vi.fn();
  const selectClip = vi.fn((i: number) => {
    st.idx = i;
  });
  const setController = vi.fn((c: unknown) => {
    st.ctrl = c;
  });
  const player = {
    apply,
    dispose,
    toggle: vi.fn(() => {
      st.playing = !st.playing;
    }),
    isPlaying: () => st.playing,
    getTime: () => 0,
    getDuration: () => 0,
    currentIndex: () => st.idx,
    clips: () => [] as ReadonlyArray<{ label: string }>,
    clipCount: () => 0,
    selectClip,
    isAnimActive: () => st.active,
    setController,
    getControllerState: () => null,
  };
  return { player, st, apply, dispose, selectClip, setController };
}

let lastPlayerArgs: { labels: string[]; clips: AnimationClip[] } | null = null;

function specWith(bones: Array<[id: string, name: string]>): Spec3D {
  return {
    models: [
      {
        bones: bones.map(([id, name]) => ({ id, name })),
        textureWidth: 64,
        textureHeight: 32,
      },
    ],
  } as unknown as Spec3D;
}

function makePreload(spec: Spec3D, over: { noRelease?: boolean } = {}) {
  const releaseTextures = vi.fn();
  const preload = vi.fn(async () => {
    const out: Record<string, unknown> = {
      texArr: [new THREE.Texture()],
      spec,
      componentTexMap: new Map<string, (THREE.Texture | null)[]>(),
    };
    if (!over.noRelease) out.releaseTextures = releaseTextures;
    return out as unknown as Awaited<ReturnType<YsmAdapterOptions["preload"]>>;
  });
  return { preload, releaseTextures };
}

function makeCtx(over: Partial<PreviewBuildCtx> = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const controls = {
    target: new THREE.Vector3(),
    minDistance: 0,
    maxDistance: 0,
    update: vi.fn(),
  } as unknown as OrbitControls;
  const renderer = { domElement: document.createElement("div") } as unknown as THREE.WebGLRenderer;
  const menu = { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn() } as unknown as PreviewMenuHandle;
  return {
    ctx: {
      scene,
      camera,
      controls,
      renderer,
      viewContainer: document.createElement("div"),
      loadingEl: document.createElement("div"),
      overlay: document.createElement("div"),
      menu,
      sessionId: "s1",
      adapterId: "ysm",
      ...over,
    } as PreviewBuildCtx,
    scene,
    camera,
    controls,
    menu,
  };
}

function menuIds(handle: { menuItems?: Array<{ id: string }> | null }): string[] {
  return (handle.menuItems ?? []).map((i) => i.id);
}

/** 真实 animation json（走 parseBedrockAnimationJSON 真逻辑） */
const ANIM_ONE = btoa(
  JSON.stringify({
    animations: {
      idle: {
        animation_length: 1,
        loop: true,
        bones: { root: { position: { "0": [0, 0, 0] } } },
      },
    },
  }),
);
const ANIM_MULTI = btoa(
  JSON.stringify({
    animations: {
      walk: {
        animation_length: 1,
        loop: true,
        bones: { root: { position: { "0": [0, 0, 0] } } },
      },
      run: {
        animation_length: 1,
        loop: true,
        bones: { root: { position: { "0": [0, 0, 0] } } },
      },
    },
  }),
);
const CTL_JSON = btoa(
  JSON.stringify({
    format_version: "1.10",
    animation_controllers: {
      ctl: { states: { default: { animations: ["idle"], transitions: [] } } },
    },
  }),
);

/** 跨用例跟踪 document keydown 监听器存活性（F 键监听挂在 document，防跨用例泄漏误判） */
const liveKeydown = new Set<EventListener>();

type DocLike = {
  addEventListener(type: string, listener: EventListener | null, options?: unknown): void;
  removeEventListener(type: string, listener: EventListener | null, options?: unknown): void;
};

beforeEach(() => {
  vi.clearAllMocks();
  sceneRegistry.reset();
  resetSchemas();
  document.body.innerHTML = "";
  lastPlayerArgs = null;
  // 跟踪 keydown 监听增删（包装真实实现，事件照常派发）
  const doc = document as unknown as DocLike;
  const origAdd = doc.addEventListener.bind(doc);
  const origRemove = doc.removeEventListener.bind(doc);
  vi.spyOn(doc, "addEventListener").mockImplementation(function (
    type,
    listener,
    ...rest
  ) {
    if (type === "keydown") liveKeydown.add(listener as EventListener);
    return origAdd(type, listener, ...rest);
  });
  vi.spyOn(doc, "removeEventListener").mockImplementation(function (
    type,
    listener,
    ...rest
  ) {
    if (type === "keydown" && listener) liveKeydown.delete(listener as EventListener);
    return origRemove(type, listener, ...rest);
  });
  h.isEditableTarget.mockImplementation(() => false);
  h.buildBoneHierarchy.mockReturnValue({
    nameMap: new Map<string, string>([["g1", "b1"]]),
    parentMap: new Map<string, string | null>([["b1", null]]),
    childrenMap: new Map<string, string[]>([["b1", []]]),
  });
  h.registerBoneRaycast.mockReturnValue(h.rayCleanup);
  h.buildBoneTree.mockImplementation(() => ({
    byId: new Map(),
    childrenMap: new Map(),
    roots: [],
    objectToId: new Map(),
  }));
  h.makeBonesPanelItem.mockImplementation(() => ({
    id: "bones",
    icon: "🦴",
    labelKey: "preview.section.bones",
    kind: "panel" as const,
    dockGroup: "motion" as const,
  }));
  h.createBreath.mockImplementation(() => ({ apply: vi.fn(), dispose: vi.fn() }));
  h.createYsmAnimPlayer.mockImplementation(() => makeFakePlayer().player);
  h.screenshot.mockResolvedValue("shot-b64");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── ① buildYsmScene 主路径 + load-trace 载荷 ──────────────

describe("buildYsmScene 主路径", () => {
  it("loader → preload → buildYsmObject 挂 scene + 注册 frustum-cull + perf trace 载荷契约", async () => {
    const spec = specWith([["b1", "root"], ["b2", "上半身"]]);
    const loader = vi.fn(async () => ({ bones: [], cubeCount: 3 } as unknown as BedrockGeometry));
    const { preload, releaseTextures } = makePreload(spec);
    const registerModelSchema = vi.fn();
    const { obj } = makeObj(["b1", "b2"]);
    h.buildYsmObject.mockReturnValue(obj);

    const { ctx, scene } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader,
      preload,
      panels: { registerModelSchema },
    });

    expect(loader).toHaveBeenCalledWith("/m/a.ysm");
    expect(h.buildYsmObject).toHaveBeenCalledWith(
      spec,
      [expect.any(THREE.Texture)],
      expect.any(Map),
      0,
    );
    expect(scene.children).toContain(obj.rootGroup); // 真实 THREE.Scene.add 生效
    expect(h.registerModelRoot).toHaveBeenCalledWith(obj.rootGroup);

    // 受控 schema 注册钩子：(controlsCtx, sessionId) 双参透传（per-scene 键依据）
    expect(registerModelSchema).toHaveBeenCalledTimes(1);
    expect(registerModelSchema.mock.calls[0]![1]).toBe("s1");
    expect(h.makeBonesPanelItem).toHaveBeenCalledTimes(1); // bones 工厂被菜单表接线

    // perf trace 载荷：format/path/四阶段/assets
    expect(h.recordLoadTrace).toHaveBeenCalledTimes(1);
    const trace = h.recordLoadTrace.mock.calls[0]![0] as {
      format: string;
      path: string;
      ok: boolean;
      stages: Array<{ name: string; status: string }>;
      assets: { files: number; textures: number; bones: number; cubes: number; materials: number };
    };
    expect(trace.format).toBe("ysm");
    expect(trace.path).toBe("/m/a.ysm");
    expect(trace.ok).toBe(true);
    expect(trace.stages.map((s) => s.name)).toEqual(["读取", "解析", "纹理加载", "build"]);
    expect(trace.stages.every((s) => s.status === "ok")).toBe(true);
    expect(trace.assets.files).toBe(1);
    expect(trace.assets.textures).toBe(1);
    expect(trace.assets.bones).toBe(2);
    expect(trace.assets.cubes).toBe(3);
    expect(trace.assets.materials).toBe(1);

    // 菜单表（经 menuItems 暴露）：model/shot/bones/perception（无 play——无 clip）
    expect(menuIds(handle)).toEqual(["model", "shot", "bones", "perception"]);
    expect(releaseTextures).not.toHaveBeenCalled();

    handle.dispose();
    expect(releaseTextures).toHaveBeenCalledTimes(1);
  });
});

// ── ② 错误路径（纹理引用归还）────────────────────────────

describe("buildYsmScene 错误路径", () => {
  it("loader 返回 null → 抛错（不挂 scene、不注册 frustum-cull）", async () => {
    const { preload, releaseTextures } = makePreload(specWith([]));
    const { ctx, scene } = makeCtx();
    await expect(
      buildYsmScene(ctx, "/m/missing.ysm", {
        loader: vi.fn(async () => null),
        preload,
      }),
    ).rejects.toThrow(/模型数据加载失败/);
    expect(scene.children).toEqual([]); // 未挂 scene
    expect(h.registerModelRoot).not.toHaveBeenCalled();
    expect(releaseTextures).not.toHaveBeenCalled();
  });

  it("buildYsmObject 抛错 → 仍归还纹理引用（失败路径不泄漏）", async () => {
    const { preload, releaseTextures } = makePreload(specWith([]));
    h.buildYsmObject.mockImplementationOnce(() => {
      throw new Error("build failed");
    });
    const { ctx } = makeCtx();
    await expect(
      buildYsmScene(ctx, "/m/broken.ysm", {
        loader: vi.fn(async () => ({} as unknown as BedrockGeometry)),
        preload,
      }),
    ).rejects.toThrow(/build failed/);
    expect(releaseTextures).toHaveBeenCalledTimes(1);
    expect(h.unregisterModelRoot).not.toHaveBeenCalled();
  });

  it("preload 缺 releaseTextures → dispose 降级告警不抛", async () => {
    const preload = vi.fn(async () => ({
      texArr: [],
      spec: specWith([]),
      componentTexMap: new Map(),
    }));
    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/legacy.ysm", {
      loader: vi.fn(async () => ({} as unknown as BedrockGeometry)),
      preload,
    });
    expect(() => handle.dispose()).not.toThrow();
    expect(h.logWarn).toHaveBeenCalledWith(
      "preview-3d",
      expect.stringContaining("releaseTextures"),
    );
  });
});

// ── ③ makeYsmAdapter 工厂面 ───────────────────────────────

describe("makeYsmAdapter 工厂", () => {
  it("id=ysm、onClose 透传、build 逐次取传入 path（switchTo 语义，无闭包旧 path）", async () => {
    const spec = specWith([]);
    const loader = vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry));
    const onClose = vi.fn();
    const adapter = makeYsmAdapter({
      loader,
      preload: makePreload(spec).preload,
      onClose,
    });
    expect(adapter.id).toBe("ysm");
    expect(adapter.onClose).toBe(onClose);

    const { ctx: ctxA } = makeCtx();
    const { ctx: ctxB } = makeCtx();
    const handleA = await adapter.build(ctxA, "/m/a.ysm");
    const handleB = await adapter.build(ctxB, "/m/b.ysm");
    expect(loader.mock.calls.flat().map(String)).toEqual(["/m/a.ysm", "/m/b.ysm"]);
    // 清理 F 键 document 监听（防跨用例泄漏）
    handleA.dispose();
    handleB.dispose();
  });

  it("ctx 缺 renderer → shared 模式前置守卫抛错", async () => {
    const { controls, scene, camera } = makeCtx();
    await expect(
      buildYsmScene(
        {
          scene,
          camera,
          controls,
          viewContainer: document.createElement("div"),
          loadingEl: document.createElement("div"),
          overlay: document.createElement("div"),
          menu: {} as PreviewMenuHandle,
        } as unknown as PreviewBuildCtx,
        "/m/a.ysm",
        {
          loader: vi.fn(async () => ({} as unknown as BedrockGeometry)),
          preload: makePreload(specWith([])).preload,
        },
      ),
    ).rejects.toThrow(/需要核心提供/);
  });
});

// ── ④ ysmMenuItems 表契约（直调，遍历真实菜单表）─────────

type MenuItemShape = {
  id: string;
  kind: string;
  dockGroup?: string;
  schemaId?: string;
  children?: Array<{ id: string; kind: string; label?: string; control?: { get?: (v?: unknown) => unknown; set?: (v: unknown) => void } }>;
};

function directMenuOpts(over: Partial<Parameters<typeof ysmMenuItems>[0]> = {}) {
  const tree = { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree;
  const cleanupRef = { current: null };
  return {
    controlsCtx: { model: {}, texIdx: 0, texArr: [], spec: {}, handle: {} } as unknown as YsmControlsContext,
    bonePanel: {
      tree,
      viewContainer: document.createElement("div"),
      camera: null,
      scene: null,
      cleanupRef,
    },
    ...over,
  };
}

describe("ysmMenuItems 表契约", () => {
  it("model 项 schemaId：无 sessionId → 全局键；有 → per-scene 键（注册/渲染同源）", () => {
    const base = directMenuOpts();
    const noSid = ysmMenuItems(base).find((i) => i.id === "model") as MenuItemShape;
    expect(noSid.schemaId).toBe(YSM_MODEL_SCHEMA_ID);
    const withSid = ysmMenuItems(directMenuOpts({ sessionId: "s9" })).find((i) => i.id === "model") as MenuItemShape;
    expect(withSid.schemaId).toBe(makeYsmModelSchemaId("s9"));
  });

  it("bones 项：o.bonePanel 字段（tree/cleanupRef/viewContainer/camera/scene）全量转发工厂", () => {
    const opts = directMenuOpts();
    ysmMenuItems(opts);
    expect(h.makeBonesPanelItem).toHaveBeenCalledWith({
      tree: opts.bonePanel.tree,
      cleanupRef: opts.bonePanel.cleanupRef,
      viewContainer: opts.bonePanel.viewContainer,
      camera: null,
      scene: null,
    });
  });

  it("shot 项 children = panels.shotNodes 注入产物；无 panels → 空 children（渲染退化 no-op 安全）", () => {
    const shotNodes = vi.fn(() => [
      { id: "ysm-shot-current", kind: "button" as const, labelKey: "x" as LocaleKey },
    ]);
    const items = ysmMenuItems(directMenuOpts({ panels: { shotNodes } }));
    const shot = items.find((i) => i.id === "shot") as MenuItemShape;
    expect(shot.children?.length).toBe(1);
    expect(shot.children?.[0]!.id).toBe("ysm-shot-current");
    expect(shotNodes).toHaveBeenCalledTimes(1);

    const bare = ysmMenuItems(directMenuOpts()).find((i) => i.id === "shot") as MenuItemShape;
    expect(bare.children?.length).toBe(0);
  });

  it("play 项 children = panels.playNodes(bridge)；bridge 即传入 play 对象", () => {
    const bridge = {
      clips: [{ label: "idle" }],
      isPlaying: () => false,
      toggle: () => {},
      currentIndex: () => 0,
      select: () => {},
      animDir: null,
    };
    const captured: unknown[] = [];
    const items = ysmMenuItems(
      directMenuOpts({
        play: bridge as never,
        panels: {
          playNodes: (b) => {
            captured.push(b);
            return [];
          },
        },
      }),
    );
    const play = items.find((i) => i.id === "ysm-play") as MenuItemShape;
    expect(play.dockGroup).toBe("motion");
    expect(captured[0]).toBe(bridge);
  });

  it("perception 项：caps 命中 → toggle 节点读写 state；caps 空 → perception-empty 空态", () => {
    const state = { breath: true, gaze: false, blink: false, lipSync: false, autoDance: false };
    const items = ysmMenuItems(
      directMenuOpts({
        perception: {
          state,
          caps: [{ id: "breath", labelKey: "preview.perceptionBreath" }],
        },
      }),
    );
    const perc = items.find((i) => i.id === "perception") as MenuItemShape;
    expect(perc.children?.[0]!.id).toBe("perception-breath");
    expect(perc.children?.[0]!.kind).toBe("toggle");
    expect(perc.children?.[0]!.control?.get?.(undefined)).toBe(true);
    perc.children?.[0]!.control?.set?.(false);
    expect(state.breath).toBe(false);

    const emptyItems = ysmMenuItems(directMenuOpts({ perception: { state, caps: [] } }));
    const emptyPerc = emptyItems.find((i) => i.id === "perception") as MenuItemShape;
    expect(emptyPerc.children?.[0]!.id).toBe("perception-empty");
  });
});

// ── ⑤ dispose 契约：per-scene schema 精准注销 + 订阅退订 ──

describe("dispose 契约（per-scene schema 键）", () => {
  it("sessionId=s1 → build 注册 ysm-model-s1；dispose 只注销自己的键（多模型同框不误伤）", async () => {
    const spec = specWith([]);
    const off = vi.fn();
    const registerModelSchema = vi.fn((_ctx: unknown, sid?: string) => {
      if (sid) registerSchema(makeYsmModelSchemaId(sid), () => []);
      return off;
    });
    // 模拟「先加载的另一场景」持有自己的 per-scene 键
    registerSchema(makeYsmModelSchemaId("s2"), () => []);

    const { obj } = makeObj([]);
    h.buildYsmObject.mockReturnValue(obj);
    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({} as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
      panels: { registerModelSchema },
    });
    expect(registerModelSchema).toHaveBeenCalledTimes(1);
    expect(hasSchema(makeYsmModelSchemaId("s1"))).toBe(true);

    handle.dispose();
    expect(hasSchema(makeYsmModelSchemaId("s1"))).toBe(false); // 自己的键已注销
    expect(hasSchema(makeYsmModelSchemaId("s2"))).toBe(true); // 他人键不误伤
    expect(off).toHaveBeenCalledTimes(1); // 状态层订阅退订（审计 #1 防 listeners 泄漏）
  });

  it("无 sessionId → 退化全局键 ysm-model 注销 + registerModelSchema 收空串 sessionId", async () => {
    const spec = specWith([]);
    let seenSid: string | undefined = "unset";
    const registerModelSchema = vi.fn((_ctx: unknown, sid?: string) => {
      seenSid = sid;
      registerSchema(YSM_MODEL_SCHEMA_ID, () => []);
      return vi.fn();
    });
    h.buildYsmObject.mockReturnValue(makeObj([]).obj);
    const { ctx } = makeCtx();
    delete ctx.sessionId; // 无 sessionId 退化全局键路径
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({} as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
      panels: { registerModelSchema },
    });
    expect(seenSid).toBe(""); // 空串透传（非 undefined——兼容旧全局键判据）
    // 菜单表 model 项 schemaId 同步退化全局键
    const modelItem = (handle.menuItems ?? []).find((i) => i.id === "model") as MenuItemShape;
    expect(modelItem.schemaId).toBe(YSM_MODEL_SCHEMA_ID);
    expect(hasSchema(YSM_MODEL_SCHEMA_ID)).toBe(true);

    handle.dispose();
    expect(hasSchema(YSM_MODEL_SCHEMA_ID)).toBe(false);
  });
});

// ── ⑥ F 键调试模式（normal→pivot→bone 循环 + 输入守卫）────

describe("F 键调试模式", () => {
  it("单按 f 循环 pivot→bone→normal；组合键/其他键/输入焦点早退", async () => {
    h.buildYsmObject.mockReturnValue(makeObj([]).obj);
    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({} as unknown as BedrockGeometry)),
      preload: makePreload(specWith([])).preload,
    });
    // 密闭性前置：无残留监听器；build 后仅本 handle 一个
    expect(liveKeydown.size).toBe(1);

    const pressF = (mod?: { shiftKey?: boolean; ctrlKey?: boolean }) =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "f", ...(mod ?? {}) }),
      );

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" })); // 其他键无反应
    pressF({ ctrlKey: true }); // 组合键早退
    h.isEditableTarget.mockImplementation(() => true); // 输入焦点守卫
    pressF();
    expect(h.rebuildDebug).not.toHaveBeenCalled();
    h.isEditableTarget.mockImplementation(() => false);

    const modes: string[] = [];
    h.rebuildDebug.mockImplementation((...a: unknown[]) => {
      modes.push((a[4] as { debugMode: string }).debugMode);
    });

    pressF();
    pressF();
    pressF();
    pressF();
    // 每次接受后 rebuildDebug 收到「已切到的」模式：normal→pivot→bone→normal
    expect(modes).toEqual(["pivot", "bone", "normal", "pivot"]);

    // dispose 后监听移除：再按 f 无反应
    handle.dispose();
    expect(liveKeydown.size).toBe(0);
    const callsBefore = h.rebuildDebug.mock.calls.length;
    pressF();
    expect(h.rebuildDebug.mock.calls.length).toBe(callsBefore);
  });
});

// ── ⑦ 场景句柄能力方法 ────────────────────────────────────

describe("场景句柄能力面", () => {
  it("resetCamera 回位取景位 + setRotationMode/setSpeed 转发 cameraControls + onBonePick 转发 openPanel + screenshot 返回 base64", async () => {
    const spec = specWith([["b1", "root"]]);
    const { obj, showModelGroup } = makeObj(["b1"]);
    h.buildYsmObject.mockReturnValue(obj);
    const cameraControls = { setOrbit: vi.fn(), setSpeed: vi.fn() };
    const { ctx, camera, controls, menu } = makeCtx({
      cameraControls: cameraControls as unknown as NonNullable<PreviewBuildCtx["cameraControls"]>,
    });
    // 预设取景位（build 时 fitCamera mock 不改动相机 → initCamPos/initCamTarget = 当前位）
    camera.position.set(1, 2, 3);
    (controls.target as THREE.Vector3).set(4, 5, 6);

    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({} as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
    });
    const sceneHandle = handle as UpdateableScene & CameraControlScene & GroupedScene & ScreenshotScene;

    // boneMaps 暴露：boneGroupMap 透传 + 层级三元组（buildBoneHierarchy 产物）
    expect(sceneHandle.boneMaps?.boneGroupMap).toBe(obj.boneGroupMap);
    expect(sceneHandle.boneMaps?.nameMap).toBe(
      h.buildBoneHierarchy.mock.results[0]!.value.nameMap,
    );

    // resetCamera：移动相机/注视点后回取景位（1,2,3 / 4,5,6）
    camera.position.set(99, 99, 99);
    (controls.target as THREE.Vector3).set(50, 50, 50);
    sceneHandle.resetCamera?.();
    expect(camera.position.x).toBe(1);
    expect(camera.position.y).toBe(2);
    expect(camera.position.z).toBe(3);
    expect((controls.target as THREE.Vector3).x).toBe(4);
    expect((controls as unknown as { update: ReturnType<typeof vi.fn> }).update).toHaveBeenCalled();

    // 控制桥转发
    sceneHandle.setRotationMode?.(true);
    sceneHandle.setSpeed?.(5);
    expect(cameraControls.setOrbit).toHaveBeenCalledWith(true);
    expect(cameraControls.setSpeed).toHaveBeenCalledWith(5);
    sceneHandle.showModelGroup?.(0);
    expect(showModelGroup).toHaveBeenCalledWith(0);

    // onBonePick → menu.openPanel
    sceneHandle.onBonePick?.("b1");
    expect(menu.openPanel).toHaveBeenCalledWith("b1");

    // screenshot：Promise<base64>（screenshotFromRenderer mock）
    expect(await sceneHandle.screenshot?.()).toBe("shot-b64");

    sceneHandle.dispose();
  });

  it("update：动画激活 → perceptionPauseRef.paused(true) + 呼吸驱动；失活 → false 且呼吸不受感知暂停影响仍驱动", async () => {
    const spec = specWith([["b1", "root"], ["b2", "上半身"]]);
    const { player, st } = makeFakePlayer();
    h.createYsmAnimPlayer.mockImplementation((_boneByName, clips, labels) => {
      lastPlayerArgs = { labels, clips };
      return player;
    });
    const breathApply = vi.fn();
    h.createBreath.mockReturnValue({ apply: breathApply, dispose: vi.fn() });
    h.buildYsmObject.mockReturnValue(makeObj(["b1", "b2"]).obj);

    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({ bones: [], _animClips: [{ name: "idle" }] } as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
    });
    // 内嵌 clip 命中 → player 携带标签「idle」（label = clip.name）
    expect(lastPlayerArgs?.labels).toEqual(["idle"]);

    st.active = true;
    (handle as UpdateableScene).update(0.016);
    expect(h.perceptionPauseRef.paused).toBe(true);
    expect(breathApply).toHaveBeenCalledTimes(1);

    st.active = false;
    (handle as UpdateableScene).update(0.016);
    expect(h.perceptionPauseRef.paused).toBe(false);
    expect(breathApply).toHaveBeenCalledTimes(2); // 呼吸仍驱动（感知层开关 breath=true）

    handle.dispose();
    expect(player.dispose).toHaveBeenCalled();
  });
});

// ── ⑧ 感知能力派生（build 路径）────────────────────────────

describe("感知能力派生（build 路径）", () => {
  it("ysm 模式 + 语义骨命中 → perception 项带 breath toggle（caps 从真实构造派生非硬编码）", async () => {
    const spec = specWith([["b1", "root"], ["b2", "上半身"]]);
    h.buildYsmObject.mockReturnValue(makeObj(["b1", "b2"]).obj);
    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({ bones: [], _animClips: [{ name: "idle" }] } as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
    });
    const perc = (handle.menuItems ?? []).find((i) => i.id === "perception") as MenuItemShape;
    const breath = perc.children?.[0];
    expect(breath?.id).toBe("perception-breath");
    expect(breath?.kind).toBe("toggle");
    expect(breath?.control?.get?.(undefined)).toBe(true);
    // play 项同时存在（内嵌 clip）
    expect(menuIds(handle)).toContain("ysm-play");
    handle.dispose();
  });

  it("无 clip + 语义骨未命中 → perception 空态（perception-empty），无 play 项", async () => {
    const spec = specWith([["b1", "随便命名"]]);
    h.buildYsmObject.mockReturnValue(makeObj(["b1"]).obj);
    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
      listAllFilePaths: vi.fn(async () => []),
      readTextFile: vi.fn(async () => null),
    });
    const perc = (handle.menuItems ?? []).find((i) => i.id === "perception") as MenuItemShape;
    expect(perc.children?.[0]?.id).toBe("perception-empty");
    expect(menuIds(handle)).not.toContain("ysm-play");
    handle.dispose();
  });

  it("generic 模式：裁剪 YSM 专属特性（无 player/breath/磁盘扫描，play/perception 退空态）", async () => {
    const spec = specWith([["b1", "root"]]);
    const listAllFilePaths = vi.fn(async () => ["/m/anim/a.animation.json"]);
    const readTextFile = vi.fn(async () => ANIM_ONE);
    h.buildYsmObject.mockReturnValue(makeObj(["b1"]).obj);
    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({ bones: [], _animClips: [{ name: "idle" }] } as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
      mode: "generic",
      listAllFilePaths,
      readTextFile,
    });
    expect(h.createYsmAnimPlayer).not.toHaveBeenCalled(); // 内嵌 clip 也不建 player
    expect(h.createBreath).not.toHaveBeenCalled();
    expect(listAllFilePaths).not.toHaveBeenCalled(); // 整段特性裁剪
    const perc = (handle.menuItems ?? []).find((i) => i.id === "perception") as MenuItemShape;
    expect(perc.children?.[0]?.id).toBe("perception-empty");
    expect(menuIds(handle)).not.toContain("ysm-play");
    handle.dispose();
  });
});

// ── ⑨ 动画文件扫描数据流（scanAnimFiles）──────────────

describe("动画文件扫描（.animation.json / controllers）", () => {
  it("目录推导 + 只读 .animation.json + 标签策略（单 clip 文件名 / 多 clip「文件名 · clip 名」）", async () => {
    const spec = specWith([["b1", "root"]]);
    const listAllFilePaths = vi.fn(async () => [
      "/m/anim/one.animation.json",
      "/m/anim/multi.animation.json",
      "/m/anim/notes.txt",
    ]);
    const readTextFile = vi.fn(async (p: string) =>
      p.endsWith("one.animation.json") ? ANIM_ONE : ANIM_MULTI,
    );
    let labels: string[] = [];
    h.createYsmAnimPlayer.mockImplementation((_b, _c, l) => {
      labels = l;
      return makeFakePlayer().player;
    });
    h.buildYsmObject.mockReturnValue(makeObj(["b1"]).obj);

    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/anim/model.ysm", {
      loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
      listAllFilePaths,
      readTextFile,
    });
    expect(listAllFilePaths).toHaveBeenCalledWith("/m/anim"); // 目录 = path 去尾段
    expect(readTextFile).toHaveBeenCalledWith("/m/anim/one.animation.json");
    expect(readTextFile).toHaveBeenCalledWith("/m/anim/multi.animation.json");
    expect(readTextFile).not.toHaveBeenCalledWith("/m/anim/notes.txt"); // 非动画文件不读
    expect(labels).toEqual(["one", "multi · walk", "multi · run"]);
    const play = (handle.menuItems ?? []).find((i) => i.id === "ysm-play");
    expect(play).toBeDefined();
    handle.dispose();
  });

  it("Windows 反斜杠路径 → 目录推导同口径", async () => {
    const listAllFilePaths = vi.fn(async () => []);
    h.buildYsmObject.mockReturnValue(makeObj([]).obj);
    const { ctx } = makeCtx();
    await buildYsmScene(ctx, "C:\\m\\anim\\model.ysm", {
      loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
      preload: makePreload(specWith([])).preload,
      listAllFilePaths,
      readTextFile: vi.fn(async () => null),
    });
    expect(listAllFilePaths).toHaveBeenCalledWith("C:\\m\\anim");
  });

  it("坏动画文件静默跳过 + .animation_controllers.json → player.setController", async () => {
    const spec = specWith([["b1", "root"]]);
    const listAllFilePaths = vi.fn(async () => [
      "/m/anim/bad.animation.json",
      "/m/anim/ok.animation.json",
      "/m/anim/ctl.animation_controllers.json",
    ]);
    const readTextFile = vi.fn(async (p: string) => {
      if (p.endsWith("bad.animation.json")) return "not-a-json";
      if (p.endsWith("animation_controllers.json")) return CTL_JSON;
      return ANIM_ONE;
    });
    const { player, st, setController } = makeFakePlayer();
    h.createYsmAnimPlayer.mockImplementation(() => player);
    h.buildYsmObject.mockReturnValue(makeObj(["b1"]).obj);

    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/anim/model.ysm", {
      loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
      preload: makePreload(spec).preload,
      listAllFilePaths,
      readTextFile,
    });
    // 坏文件不阻断；controller 状态机注入（取首个）
    expect(setController).toHaveBeenCalledTimes(1);
    expect((st.ctrl as { name: string }).name).toBe("ctl");
    // play 桥仍产出（ok 文件 1 clip）
    expect(menuIds(handle)).toContain("ysm-play");
    handle.dispose();
  });

  it("内嵌 model._animClips → 优先走内嵌标签，跳过磁盘扫描", async () => {
    const spec = specWith([]);
    const listAllFilePaths = vi.fn(async () => ["/m/anim/a.animation.json"]);
    const readTextFile = vi.fn(async () => ANIM_ONE);
    let labels: string[] = [];
    h.createYsmAnimPlayer.mockImplementation((_b, _c, l) => {
      labels = l;
      return makeFakePlayer().player;
    });
    h.buildYsmObject.mockReturnValue(makeObj([]).obj);

    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () =>
        ({ bones: [], _animClips: [{ name: "idle" }, {}] } as unknown as BedrockGeometry),
      ),
      preload: makePreload(spec).preload,
      listAllFilePaths,
      readTextFile,
    });
    expect(listAllFilePaths).not.toHaveBeenCalled(); // 内嵌存在 → 不扫磁盘
    // 内嵌标签：clip.name 优先，无名 clip 序号兜底
    expect(labels).toEqual(["idle", "Clip 2"]);
    handle.dispose();
  });
});

// ── ⑩ 多模型模式（sceneRegistry 非空 → 统一拾取器接管）────

describe("多模型模式", () => {
  it("注册表非空 → 跳过逐模型 raycast；dispose 不抛", async () => {
    sceneRegistry.register({
      path: "other.ysm",
      rtype: "ysm",
      roots: [],
      content: { dispose: vi.fn() } as never,
    });
    h.buildYsmObject.mockReturnValue(makeObj([]).obj);
    const { ctx } = makeCtx();
    const handle = await buildYsmScene(ctx, "/m/a.ysm", {
      loader: vi.fn(async () => ({ bones: [] } as unknown as BedrockGeometry)),
      preload: makePreload(specWith([])).preload,
    });
    expect(h.registerBoneRaycast).not.toHaveBeenCalled();
    expect(h.rayCleanup).not.toHaveBeenCalled();
    expect(() => handle.dispose()).not.toThrow();
    sceneRegistry.reset();
  });
});
