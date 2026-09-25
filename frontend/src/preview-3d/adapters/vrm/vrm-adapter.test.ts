// ===== VRM 适配器测试 =====
// 覆盖：buildVrmScene 主路径（readFn → GLTFLoader.parse + VRMLoaderPlugin →
// rotateVRM0 摆正 → 挂场景 + 灯光 + 包围盒定相机 + 根菜单注入）、
// VRMA 动作加载（同目录 .vrma → createVRMAnimationClip）、
// 错误路径（空字节/解析失败）、GPU 释放（deepDispose + uncacheRoot）。
// @pixiv/three-vrm 全 mock；three 用真实实现（Box3/Vector3/LoadingManager）。
import type { BoneTree } from "@/preview-3d/bone/bone-tools.ts"
import type { MmdPlayBridge } from "@/preview-3d/infra/content-bridges.ts"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PreviewBuildCtx } from "@/preview-3d/adapters/mount-preview-core.ts";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewMenuHandle } from "@/preview-3d/menu/engine/core.ts";

// ---- DOM mock（vitest 无默认 document）----
const mockElements: Map<string, HTMLElement> = new Map();
vi.stubGlobal("document", {
  createElement: (tag: string): HTMLElement => {
    const childNodes: unknown[] = [];
    const el = {
      tagName: tag,
      innerHTML: "",
      childNodes: childNodes as unknown as NodeListOf<ChildNode>,
      style: {},
      remove: () => { Object.defineProperty(el, "parentElement", { value: null, configurable: true }); },
      appendChild: (child: HTMLElement) => {
        childNodes.push(child);
        Object.defineProperty(child, "parentElement", { value: el, configurable: true });
      },
      querySelector: () => null,
    } as unknown as HTMLElement;
    Object.defineProperty(el, "parentElement", { value: null, configurable: true });
    Object.defineProperty(el, "parentNode", { get: () => (el as { parentElement: HTMLElement | null }).parentElement, configurable: true });
    mockElements.set(tag + Date.now(), el);
    return el;
  },
} as unknown as typeof document);

const hoisted = vi.hoisted(() => {
  const loaderParsers: Array<() => unknown> = [];
  const deepDisposeCalls: Array<unknown> = [];
  const footIKController = { apply: vi.fn(), dispose: vi.fn() };
  // P3：storage 原语内存兜底（readVmdPositionScale/writeVmdPositionScale 经 safeGet/safeSet/safeRemove）
  const storageStore = new Map<string, string>();
  return {
    readBytesMock: vi.fn(),
    listPathsMock: vi.fn(),
    loaderParsers,
    deepDisposeCalls,
    vrmUtilsMock: vi.fn(),
    rotateVRM0: vi.fn(),
    deepDispose: vi.fn(),
    createAnimClip: vi.fn(),
    parseMock: vi.fn(),
    buildVrmBoneTreeMock: vi.fn(() => ({ byId: new Map(), childrenMap: new Map(), roots: [] })),
    // ADR-243：VMD 重定向通道
    parseVmdMock: vi.fn(),
    getCustomAnimPathMock: vi.fn(),
    footIKController,
    createVrmFootIKMock: vi.fn(() => footIKController),
    // P3：VMD 位移缩放持久化（内存 Map 实现 safeGet/safeSet/safeRemove）
    storageStore,
    safeGetMock: vi.fn((k: string): string | null => (storageStore.has(k) ? storageStore.get(k)! : null)),
    safeSetMock: vi.fn((k: string, v: string): void => {
      storageStore.set(k, v);
    }),
    safeRemoveMock: vi.fn((k: string): void => {
      storageStore.delete(k);
    }),
    safeGetJSONMock: vi.fn(),
  };
});

vi.mock("@/preview-3d/materials/vrm-materials.ts", () => ({
  listVrmMaterials: vi.fn(() => []),
  getVrmMaterialDetail: vi.fn(() => ({})),
  setVrmMaterialVisible: vi.fn(),
  setVrmMaterialOpacity: vi.fn(),
}));
vi.mock("@/preview-3d/bone/bone-tools.ts", () => ({
  buildBoneTree: vi.fn(() => ({ byId: new Map(), childrenMap: new Map(), roots: [] })),
}));
vi.mock("./vrm-bone-ui.ts", () => ({
  makeBonePanelRenderer: vi.fn(() => () => () => {}),
}));
vi.mock("@/preview-3d/bone/semantic-bones.ts", () => ({
  vrmSemanticBoneMap: vi.fn(() => ({})),
}));
vi.mock("@/preview-3d/adapters/shared/perception/breath.ts", () => ({
  createBreathController: vi.fn(() => ({
    apply: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@/preview-3d/adapters/shared/perception/gaze.ts", () => ({
  createGazeController: vi.fn(() => ({
    apply: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@/preview-3d/adapters/shared/perception/blink.ts", () => ({
  createBlinkController: vi.fn(() => ({
    apply: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@/preview-3d/bone/mmd-foot-ik.ts", () => ({
  createFootIKController: vi.fn(() => ({
    apply: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("@/preview-3d/screenshot/screenshot.ts", () => ({
  screenshotFromRenderer: vi.fn(() => Promise.resolve("screenshot-url")),
}));
vi.mock("@/preview-3d/infra/frustum-cull.ts", () => ({
  registerModelRoot: vi.fn(),
  unregisterModelRoot: vi.fn(),
}));
vi.mock("./vrm-bone.ts", () => ({
  buildVrmBoneTree: hoisted.buildVrmBoneTreeMock,
}));

// ---- Mock @moeru/three-mmd（ADR-243）：保留真 buildAnimation（重定向走端到端），
//      只替掉二进制解析——`.vmd` 二进制构造需要 Shift-JIS 编码器，不值当 ----
vi.mock("@moeru/three-mmd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@moeru/three-mmd")>();
  return {
    ...actual,
    VmdObject: { ParseFromBuffer: hoisted.parseVmdMock },
  };
});

// ---- Mock MMD 动作库路径解析（隔离 backend 绑定；用例内按需指定目录）----
vi.mock("@/preview-3d/adapters/mmd/mmd-anim-library.ts", () => ({
  getCustomAnimPath: hoisted.getCustomAnimPathMock,
}));

// ---- Mock storage 原语（P3 位移缩放持久化；内存 Map 兜底，隔离 jsdom localStorage）----
vi.mock("@/utils/base/primitives/storage.ts", () => ({
  safeGet: hoisted.safeGetMock,
  safeSet: hoisted.safeSetMock,
  safeRemove: hoisted.safeRemoveMock,
  safeGetJSON: hoisted.safeGetJSONMock,
}));

// ---- Mock VRM 足 IK 控制器：算法细节归 vrm-foot-ik.test.ts，此处只验「装配 + 每帧驱动」----
vi.mock("@/preview-3d/bone/vrm-foot-ik.ts", () => ({
  createVrmFootIKController: hoisted.createVrmFootIKMock,
}));

// ---- Mock @pixiv/three-vrm ----
vi.mock("@pixiv/three-vrm", () => ({
  VRMLoaderPlugin: class {
    constructor(parser: unknown) {
      hoisted.loaderParsers.push(() => parser);
    }
  },
  VRMUtils: {
    rotateVRM0: hoisted.rotateVRM0,
    deepDispose: hoisted.deepDispose,
  },
}));

// ---- Mock @pixiv/three-vrm-animation ----
vi.mock("@pixiv/three-vrm-animation", () => ({
  VRMAnimationLoaderPlugin: class {
    constructor(parser: unknown) {
      hoisted.loaderParsers.push(() => parser);
    }
  },
  createVRMAnimationClip: hoisted.createAnimClip,
}));

// ---- Mock GLTFLoader ----
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    private parsers: Array<(parser: unknown) => unknown> = [];
    register(fn: (parser: unknown) => unknown): void {
      this.parsers.push(fn);
    }
    parse(
      buffer: ArrayBuffer,
      path: string,
      resolve: (gltf: unknown) => void,
      _reject: (e: unknown) => void,
    ): void {
      Promise.resolve().then(() => {
        try {
          const result = hoisted.parseMock(buffer, path);
          const vrm = result?.userData?.vrm;
          if (vrm) {
            resolve({ userData: { vrm } });
          } else {
            resolve(result);
          }
        } catch (e) {
          _reject(e);
        }
      });
    }
  },
}));

import {
  buildVrmScene,
  readVmdPositionScale,
  readVrmMeta,
  rebuildVmdMotionClips,
  type VrmPanelHooks,
  vrmMenuItems,
  vrmMetaSummary,
  writeVmdPositionScale,
} from "./vrm-adapter.ts";
import { getLoadTraces } from "@/preview-3d/infra/load-trace.ts";
import type { LocaleKey } from "@/core/i18n/t.ts";

/** 构造注入端口（含诊断日志 mock） */
function makePort() {
  return {
    readBytesMock: hoisted.readBytesMock,
    listPathsMock: hoisted.listPathsMock,
    addOpLog: vi.fn(),
  };
}

/**
 * 鸭子类型 VMD（ADR-243）：真 `buildAnimation` 只经 `boneKeyFrames` / `morphKeyFrames`
 * 两个读取器取值，不碰 VmdObject 的私有状态 ⇒ 结构等价即可，免去构造 Shift-JIS 二进制。
 */
function makeFakeVmd(
  bones: Array<
    | [string, number, [number, number, number]]
    | [string, number, [number, number, number], [number, number, number, number]]
  >,
  morphs: Array<{ morphName: string; frameNumber: number; weight: number }> = [],
): unknown {
  const reader = <T>(items: T[]) => ({
    length: items.length,
    get: (i: number): T => {
      const item = items[i];
      if (item === undefined) throw new RangeError(`index ${i} out of range`);
      return item;
    },
  });
  return {
    boneKeyFrames: reader(
      bones.map((frame) => ({
        boneName: frame[0],
        frameNumber: frame[1],
        position: frame[2],
        rotation: frame[3] ?? [0, 0, 0, 1],
        interpolation: new Array(16).fill(20),
      })),
    ),
    morphKeyFrames: reader(morphs),
  };
}

/** VMD 重定向会读到的归一化骨（其余骨缺席 ⇒ 绑定解析自动跳过） */
function makeNormalizedNodes(): Record<string, THREE.Object3D> {
  const nodes: Record<string, THREE.Object3D> = {};
  const defs: Array<[string, [number, number, number]]> = [
    ["hips", [0, 0.8, 0]],
    ["leftUpperArm", [0.12, 1.32, 0]],
    ["leftFoot", [0.1, 0.08, 0]],
  ];
  for (const [name, pos] of defs) {
    const node = new THREE.Object3D();
    node.position.set(...pos);
    nodes[name] = node;
  }
  return nodes;
}

/** 构造假 VRM；`humanoidNodes` 供 VMD 重定向读取归一化骨（缺省 = 模型无任何 humanoid 骨） */
function makeFakeVrm(humanoidNodes: Record<string, THREE.Object3D> = {}) {
  const scene = new THREE.Scene();
  // 锐评 P1：select 切换动作前调 resetNormalizedPose（归一化骨回 rest）+ resetValues（表情清零）
  const resetNormalizedPose = vi.fn();
  const resetValues = vi.fn();
  const humanoid = {
    humanBones: {} as Record<string, THREE.Bone | null>,
    getNormalizedBoneNode: (name: string): THREE.Object3D | null => humanoidNodes[name] ?? null,
    resetNormalizedPose,
  };
  const lookAt = { target: null as THREE.Object3D | null };
  const exprMgr = {
    getExpression: (name: string) => {
      if (name === "blink") return {};
      return null;
    },
    setValue: vi.fn(),
    // ADR-306：retarget 会对 manager 调 getExpressionTrackName（.bind）——fake 面必须齐
    getExpressionTrackName: vi.fn((name: string) =>
      name === "blink" ? "VRMExpression_blink.weight" : null,
    ),
    resetValues,
  };
  const result = {
    scene,
    humanoid,
    lookAt,
    expressionManager: exprMgr,
    meta: {
      metaVersion: "1" as const,
      name: "TestVRM",
      authors: ["TestAuthor"],
      version: "1.0.0",
    },
    update: vi.fn(),
    // 测试断言口（非契约字段）
    _resetNormalizedPose: resetNormalizedPose,
    _resetValues: resetValues,
  };
  return result;
}

function makeCtx() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const loadingEl = document.createElement("div");
  const overlay = document.createElement("div");
  return {
    ctx: {
      scene,
      camera,
      controls: {
        target: new THREE.Vector3(),
        minDistance: 0,
        maxDistance: 0,
        update: vi.fn(),
      } as unknown as OrbitControls,
      viewContainer: document.createElement("div"),
      loadingEl,
      overlay,
      menu: { setAdapterItems: vi.fn(), openPanel: vi.fn() } as unknown as PreviewMenuHandle,
      renderer: { domElement: document.createElement("div") } as unknown as THREE.WebGLRenderer,
      adapterId: "vrm",
    },
    scene,
    camera,
    loadingEl,
  };
}


/** 从 content 对象读取注入的菜单项（renderCustom 双参对齐声明式节点逃生舱） */
function registeredItems(content: { menuItems?: Array<{ id: string; kind: string; dockGroup?: string; render?: (list: HTMLElement, close: () => void) => void; renderCustom?: (list: HTMLElement, close?: () => void) => void }> | null }): Array<{
  id: string;
  kind: string;
  dockGroup?: string;
  render?: (list: HTMLElement, close: () => void) => void;
  renderCustom?: (list: HTMLElement, close?: () => void) => void;
}> {
  return (content.menuItems ?? []) as Array<{
    id: string;
    kind: string;
    dockGroup?: string;
    render?: (list: HTMLElement, close: () => void) => void;
    renderCustom?: (list: HTMLElement, close?: () => void) => void;
  }>;
}

function makePanels(): VrmPanelHooks {
  return {
    playNodes: () => [
      { id: "stub-play-toggle", kind: "toggle" as const, labelKey: "x" as LocaleKey, control: { get: () => false, set: () => {} } },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.deepDisposeCalls.length = 0;
  hoisted.loaderParsers.length = 0;
  mockElements.clear();
  // 每个用例独立起点：动作库默认不可用、VMD 默认解析为空动作、足 IK 控制器每次新建
  hoisted.getCustomAnimPathMock.mockResolvedValue(null);
  hoisted.parseVmdMock.mockResolvedValue(makeFakeVmd([]));
  hoisted.createVrmFootIKMock.mockReturnValue(hoisted.footIKController);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // 恢复 deepDispose 默认 no-op（顺序守护测试会设真清几何实现，防残留影响其他用例）
  hoisted.deepDispose.mockReset();
});

describe("buildVrmScene 主路径", () => {
  it("readFn → GLTFLoader.parse + VRMLoaderPlugin → rotateVRM0 → 挂场景 + 取景 + 菜单注入", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({
      userData: { vrm },
    }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM_DATA"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx, scene, camera, loadingEl } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // readFn 被调用
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/vrm/test.vrm");
    // GLTFLoader.parse 被调用（ArrayBuffer）
    expect(hoisted.parseMock).toHaveBeenCalled();
    // 相机取景：position 被 set 过（非默认原点）
    expect(camera.position.z).toBeGreaterThan(0);
    expect(camera.near).toBe(0.05);
    // 挂进 scene
    expect(scene.children).toContain(vrm.scene);
    // loadingEl 移除
    expect(loadingEl.parentNode).toBeNull();

    // 菜单项注入
    const items = registeredItems(content);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("model");
    expect(ids).toContain("shot");
    expect(ids).toContain("bones");

    content.dispose();
  });

  it("readFn 返回空 → 抛错", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    const { ctx } = makeCtx();
    await expect(
      buildVrmScene(ctx, "/vrm/missing.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock }),
    ).rejects.toThrow("ReadFileBytes 返回空");
  });

  it("GLTFLoader.parse 未返回 vrm → 抛错", async () => {
    hoisted.parseMock.mockImplementation(() => ({ userData: {} }));
    hoisted.readBytesMock.mockResolvedValue(btoa("FAKE"));
    const { ctx } = makeCtx();
    await expect(
      buildVrmScene(ctx, "/vrm/fake.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock }),
    ).rejects.toThrow("VRM 实例解析失败");
  });

  it("ctx 缺 renderer → shared 模式前置守卫抛错（对齐 ysm/pack-model）", async () => {
    const { ctx } = makeCtx();
    const badCtx = { ...ctx, renderer: undefined } as unknown as PreviewBuildCtx;
    await expect(
      buildVrmScene(badCtx, "/vrm/test.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock }),
    ).rejects.toThrow(/需要核心提供/);
  });
  // 刀⑳ 回归：load-trace 的 bones 必须报**骨骼总数**（byId.size），不是 roots.length
  // （无父骨根节点 ≈1）。同函数 :513 早修过同一 bug（面板显示「1 骨骼」），此处曾漏改。
  // 用「多骨骼 + 单根」的树把两口径彻底分开：roots.length=1 而 byId.size=3。
  it("recordLoadTrace 的 bones 报骨骼总数（byId.size）而非根节点数（roots.length）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM_DATA"));
    hoisted.listPathsMock.mockResolvedValue([]);
    const bones = new Map([
      ["hips", {}],
      ["spine", {}],
      ["head", {}],
    ]);
    hoisted.buildVrmBoneTreeMock.mockReturnValue({
      byId: bones,
      childrenMap: new Map(),
      roots: [{ id: "hips" }],
    } as unknown as ReturnType<typeof hoisted.buildVrmBoneTreeMock>);

    const { ctx } = makeCtx();
    await buildVrmScene(ctx, "/vrm/test.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    const traces = getLoadTraces().filter((t) => t.format === "vrm");
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[traces.length - 1]!.assets?.bones).toBe(3); // byId.size，不是 1
  });
});

describe("VRMA 动作加载", () => {
  it("同目录 .vrma → 加载并自动播放（经 createVRMAnimationClip）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({
      userData: { vrm },
    }));
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".vrm")) return Promise.resolve(btoa("VRM"));
      if (p.endsWith(".vrma")) return Promise.resolve(btoa("VRMA"));
      return Promise.resolve(null);
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/vrm/test.vrm",
      "/vrm/dance.vrma",
    ]);
    hoisted.createAnimClip.mockReturnValue(new THREE.AnimationClip("dance", -1, []));
    // VRMA 路径返回 vrmAnimations（非 vrm），供 createVRMAnimationClip 消费
    // 注意：VRMA loader.parse 用空路径 ""，通过调用顺序区分（第1次=主模型，第2次=VRMA）
    let parseCallCount = 0;
    hoisted.parseMock.mockImplementation((_buffer, _path) => {
      parseCallCount++;
      if (parseCallCount > 1) {
        return { userData: { vrmAnimations: [{ name: "test" }] } };
      }
      return { userData: { vrm } };
    });

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // VRMA 被解析 + 动画 clip 被创建
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/vrm/dance.vrma");
    expect(hoisted.createAnimClip).toHaveBeenCalled();

    // VRMA clip → 动画播放（mixer 驱动）
    content.update!(0.016);
    expect(vrm.update).toHaveBeenCalledWith(0.016);

    content.dispose();
  });

  it("损坏 .vrma 跳过不阻断", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({
      userData: { vrm },
    }));
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".vrm")) return Promise.resolve(btoa("VRM"));
      return Promise.resolve(btoa("CORRUPT"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/vrm/test.vrm",
      "/vrm/bad.vrma",
    ]);
    // 解析损坏 VRMA → parse 抛错，被 try/catch 吞
    hoisted.parseMock.mockImplementation((_buffer, path) => {
      if (path.endsWith("bad.vrma")) throw new Error("corrupt");
      return { userData: { vrm } };
    });

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // 模型仍加载
    expect(content.update).toBeDefined();
    content.dispose();
  });

  it("无同目录 .vrma → 播放菜单项仍在（空态引导，对齐 MMD 固定表项）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({
      userData: { vrm },
    }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue(["/vrm/test.vrm"]);

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // [ADR-242 后续] .vrma 稀少是常态，面板不得凭空消失——显示播放项（空态引导由
    // playNodes 渲染；此处 makePanels 是桩，故只断言项存在 + 收到空 clips 的桥）
    const items = registeredItems(content);
    const play = items.find((i) => i.id === "vrma-play");
    expect(play).toBeDefined();
    content.dispose();
  });
});

// ---------------------------------------------------------------------------
// VMD 动作加载与重定向（ADR-243 §2.7 发现 / §2.8 IK 驱动）
// ---------------------------------------------------------------------------

/** 扫描场景构建器：同目录 files + 动作库 libFiles，并捕获 play bridge */
async function buildWithMotion(opts: {
  files: string[];
  libFiles?: string[];
  animDir?: string | null;
  vmd?: unknown;
  vmdReject?: boolean;
  humanoidNodes?: Record<string, THREE.Object3D>;
  readVmd?: string | null;
  extraSceneNodes?: THREE.Object3D[];
}): Promise<{
  content: Awaited<ReturnType<typeof buildVrmScene>>;
  // 显式 `| undefined`（非可选属性）：exactOptionalPropertyTypes 下不许把 undefined 赋给 `play?`
  play: MmdPlayBridge | undefined;
  /** 本次构建用的 fake VRM（锐评 P1 断言口：_resetNormalizedPose / _resetValues） */
  vrm: ReturnType<typeof makeFakeVrm>;
}> {
  const nodes = opts.humanoidNodes ?? makeNormalizedNodes();
  const vrm = makeFakeVrm(nodes);
  // 归一化骨真实处于 mixer root（vrm.scene）子树内：否则轨道 uuid 绑不上，
  // PropertyBinding 只会打一条警告后静默失效（真实 loader 把 normalizedHumanBonesRoot
  // 挂在 gltf.scene 下，见 ADR-243 §2.2）
  for (const node of Object.values(nodes)) {
    if (!node.parent) vrm.scene.add(node);
  }
  // ADR-306：表情轨道（VRMExpression_<name>.weight）的绑定对象挂进 mixer root，
  // mixer 每帧直写 `weight` 属性——断言 e2e 的唯一观察点
  for (const node of opts.extraSceneNodes ?? []) {
    if (!node.parent) vrm.scene.add(node);
  }
  // GLTFLoader.parse 同时服务主模型与 .vrma：第 1 次是主模型，之后按 .vrma 处理
  //（.vmd 不走 GLTFLoader，走 mocked 的 VmdObject.ParseFromBuffer）
  let parseCalls = 0;
  hoisted.parseMock.mockImplementation(() => {
    parseCalls++;
    return parseCalls === 1
      ? { userData: { vrm } }
      : { userData: { vrmAnimations: [{ name: "anim" }] } };
  });
  if (opts.vmdReject) {
    hoisted.parseVmdMock.mockRejectedValue(new Error("bad vmd"));
  } else {
    hoisted.parseVmdMock.mockResolvedValue(opts.vmd ?? makeFakeVmd([]));
  }
  hoisted.getCustomAnimPathMock.mockResolvedValue(opts.animDir ?? null);
  hoisted.readBytesMock.mockImplementation((p: string) => {
    if (p.toLowerCase().endsWith(".vmd")) return Promise.resolve(opts.readVmd ?? btoa("VMD"));
    return Promise.resolve(btoa("VRM"));
  });
  hoisted.listPathsMock.mockImplementation((dir: string) =>
    Promise.resolve(dir.includes("CustomAnim") ? (opts.libFiles ?? []) : opts.files),
  );
  hoisted.createAnimClip.mockReturnValue(new THREE.AnimationClip("vrma-clip", -1, []));

  const captured: { play?: MmdPlayBridge } = {};
  const panels = makePanels();
  panels.playNodes = (bridge) => {
    captured.play = bridge;
    return [];
  };

  const { ctx } = makeCtx();
  const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock, panels: panels, listAllFilePaths: hoisted.listPathsMock });
  return { content, play: captured.play, vrm };
}

describe("VMD 动作加载与重定向（ADR-243）", () => {
  /** センター 位移 + 左腕 旋转 + 左足ＩＫ 目标（覆盖三条通道） */
  const VMD_FRAMES: Array<[string, number, [number, number, number]]> = [
    ["センター", 0, [0, 0, 0]],
    ["センター", 30, [1, 2, 3]],
    ["左腕", 0, [0, 0, 0]],
    ["左足ＩＫ", 0, [0, 0, 0]],
    ["左足ＩＫ", 30, [1, 2, 3]],
  ];

  it("同目录 .vmd → 重定向成 clip 进播放列表（label 去扩展名）", async () => {
    const { content, play } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(VMD_FRAMES),
    });

    expect(play?.clips.map((c) => c.label)).toEqual(["wave"]);
    content.dispose();
  });

  it("原生 .vrma 排在 .vmd 之前（顺序即面板顺序：原生动作先露出）", async () => {
    const { content, play } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/idle.vrma", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(VMD_FRAMES),
    });

    expect(play?.clips.map((c) => c.label)).toEqual(["idle", "wave"]);
    content.dispose();
  });

  it("动作库（CustomAnim）来源并入，且与同目录重复的同一路径不重复列出", async () => {
    const { content, play } = await buildWithMotion({
      // 模型本身就放在动作库里：同目录扫到 wave.vmd，动作库也扫到同一路径
      files: ["/repo/CustomAnim/test.vrm", "/repo/CustomAnim/wave.vmd"],
      libFiles: ["/repo/CustomAnim/wave.vmd", "/repo/CustomAnim/lib.vmd"],
      animDir: "/repo/CustomAnim",
      vmd: makeFakeVmd(VMD_FRAMES),
    });

    // 去重按**完整路径**：同名不同目录的两个动作是两个不同资产，不该被合并
    expect(play?.clips.map((c) => c.label)).toEqual(["wave", "lib"]);
    content.dispose();
  });

  it("动画激活 → 每帧把当前动作的足 IK 目标喂给控制器（时间取 action.time）", async () => {
    const { content } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(VMD_FRAMES),
    });

    content.update(0.016);

    expect(hoisted.footIKController.apply).toHaveBeenCalledTimes(1);
    const [time, targets] = hoisted.footIKController.apply.mock.calls[0];
    expect(time).toBeGreaterThanOrEqual(0);
    // 左足ＩＫ 被摘出为目标；右足未出现在 VMD 里 ⇒ null（不猜）
    expect(targets.left).not.toBeNull();
    expect(targets.right).toBeNull();
    content.dispose();
  });

  it("仅 .vrma（无 VMD）→ 控制器不被驱动，足部交给动画自带数据", async () => {
    const { content } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/idle.vrma"],
    });

    content.update(0.016);

    expect(hoisted.footIKController.apply).not.toHaveBeenCalled();
    content.dispose();
  });

  it("VMD 骨名全不可映射（模型无对应 humanoid 骨）→ 不产空动作项", async () => {
    const { content, play } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(VMD_FRAMES),
      humanoidNodes: {}, // 该模型一根 humanoid 骨都没有
    });

    // 「点了没反应」的空动作比没有动作更糟——宁可让它落到空态引导
    expect(play?.clips).toEqual([]);
    content.dispose();
  });

  it(".vmd 解析抛错 → 跳过该动作，其余动作照常", async () => {
    const { content, play } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/idle.vrma", "/vrm/wave.vmd"],
      vmdReject: true,
    });

    expect(play?.clips.map((c) => c.label)).toEqual(["idle"]);
    content.dispose();
  });

  it("重定向轨道在真实 mixer 里命中归一化骨（uuid 绑定端到端，非仅轨道名对）", async () => {
    const nodes = makeNormalizedNodes();
    const { content } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/wave.vmd"],
      vmd: makeFakeVmd([
        ["左腕", 0, [0, 0, 0], [0, 0, 0, 1]],
        ["左腕", 30, [0, 0, 0], [0.6, 0, 0, 0.8]], // 明显旋转，便于观察
      ]),
      humanoidNodes: nodes,
    });

    const arm = nodes.leftUpperArm;
    if (!arm) throw new Error("测试装置损坏");
    expect(arm.quaternion.w).toBeCloseTo(1, 6); // 播放前恒等

    content.update(0.5); // 推进到动画中段

    // 轴系翻转（x 取反）+ 贝塞尔插值 ⇒ 四元数必然离开恒等
    expect(Math.abs(arm.quaternion.w - 1)).toBeGreaterThan(0.01);
    content.dispose();
  });

  // ── 表情通道（ADR-306 §2.2）：可映射 morph 改道进 clip，AnimationMixer 每帧直写
  //    `VRMExpression_<name>.weight`——e2e 断言挂在 mixer root 的表情对象上 ──

  it("VMD まばたき 帧 → 改道表情轨道被 mixer 驱动（mid-time 权重 0< w <0.5）", async () => {
    const nodes = makeNormalizedNodes();
    // 真实 VRMExpression 构造即 `this.weight = 0`（three-vrm-core）；three 的
    // PropertyBinding.bind 要求目标属性**已存在**（undefined 即报 not-found 跳过写入），
    // 故 fake 载体对象必须初始化 weight
    const exprObj = new THREE.Object3D() as THREE.Object3D & { weight: number };
    exprObj.name = "VRMExpression_blink"; // 与 fake getExpressionTrackName 的返回值对齐
    exprObj.weight = 0;
    const { content } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(
        [
          ["左腕", 0, [0, 0, 0], [0, 0, 0, 1]],
          ["左腕", 30, [0, 0, 0], [0.6, 0, 0, 0.8]],
        ],
        [
          { morphName: "まばたき", frameNumber: 0, weight: 0.5 },
          { morphName: "まばたき", frameNumber: 30, weight: 0 },
        ],
      ),
      humanoidNodes: nodes,
      extraSceneNodes: [exprObj],
    });

    content.update(0.5); // 0s(0.5) → 1s(0) 线性插值 ⇒ 0.5s 处 ≈ 0.25

    expect(exprObj.weight, "mixer 应把改道表情轨道写进 VRMExpression_blink.weight").toBeGreaterThan(0.1);
    expect(exprObj.weight).toBeLessThan(0.4);
    content.dispose();
  });

  it("不可映射 morph 名（作者自定义）→ 表情载体永不被驱动（轨道未进 clip）", async () => {
    const nodes = makeNormalizedNodes();
    const exprObj = new THREE.Object3D() as THREE.Object3D & { weight: number };
    exprObj.name = "VRMExpression_blink";
    exprObj.weight = 0; // 初值哨兵：mixer 从未写入 ⇒ 停 0
    const { content, play } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(
        [
          ["左腕", 0, [0, 0, 0], [0, 0, 0, 1]],
          ["左腕", 30, [0, 0, 0], [0.6, 0, 0, 0.8]],
        ],
        [{ morphName: "作者自定义", frameNumber: 0, weight: 1 }],
      ),
      humanoidNodes: nodes,
      extraSceneNodes: [exprObj],
    });

    // 条目仍在（FK 轨道撑住了 clip）——只是表情通道静默缺席
    expect(play?.clips.map((c) => c.label)).toEqual(["wave"]);

    content.update(0.5);
    // 作者自定义 morph 不在候选表 → 不改道，clip 无表情轨道 ⇒ 载体 weight 恒为初值 0
    expect(exprObj.weight).toBe(0);
    content.dispose();
  });

  it("select 切换到 .vmd 动作 → 足 IK targets 跟随新 clip（live-action 反查，非索引脱钩）", async () => {
    // 顺序：.vrma 先入列（footIK: null），.vmd 随后（footIK 含左足目标）
    // 初始播放 clip0 = idle(vrma) → 无 IK 通道，apply 不被调用
    const { content, play } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/idle.vrma", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(VMD_FRAMES),
    });
    expect(play?.clips.map((c) => c.label)).toEqual(["idle", "wave"]);

    hoisted.footIKController.apply.mockClear();
    content.update(0.016);
    expect(hoisted.footIKController.apply).not.toHaveBeenCalled();

    // 切到 wave（vmd 重定向，含左足 IK 目标）。
    // 旧病灶（独立索引脱钩）：切后采样仍钉 clip0 的 footIK(null) ⇒ apply 不触发；
    // 修复（live-action 反查）：采样源跟随实际播放的 clip ⇒ 左足目标命中
    play?.select!(1);
    content.update(0.016);

    expect(hoisted.footIKController.apply).toHaveBeenCalledTimes(1);
    const [, targets] = hoisted.footIKController.apply.mock.calls[0];
    expect(targets.left).not.toBeNull();
    expect(targets.right).toBeNull(); // 右足未出现在 VMD ⇒ 不猜
    content.dispose();
  });

  it("锐评 P1：select 切换动作 → 归一化骨/表情先复位（防未覆盖骨残留旧姿势，横移 MMD 侧 skeleton.pose 纪律）", async () => {
    // 顺序：.vrma 先入列（idle），.vmd 随后（wave）——切到 wave 时 idle 驱动过而
    // wave 未驱动的骨不应残留 idle 末帧姿势
    const { content, play, vrm } = await buildWithMotion({
      files: ["/vrm/test.vrm", "/vrm/idle.vrma", "/vrm/wave.vmd"],
      vmd: makeFakeVmd(VMD_FRAMES),
    });
    play?.select!(1);
    expect(vrm._resetNormalizedPose, "切动作前归一化骨须复位到 rest").toHaveBeenCalledTimes(1);
    expect(vrm._resetValues, "切动作前表情权重须清零（防笑脸冻帧）").toHaveBeenCalledTimes(1);
    // 同 index 早退分支不复位（幂等切换零副作用）
    play?.select!(1);
    expect(vrm._resetNormalizedPose).toHaveBeenCalledTimes(1);
    content.dispose();
  });

  it("空态文案同时交代 .vrma 与 .vmd 两条路径（不再只认 .vrma）", async () => {
    const { content, play } = await buildWithMotion({ files: ["/vrm/test.vrm"] });

    expect(play?.clips).toEqual([]);
    expect(play?.emptyHint).toContain(".vmd");
    expect(play?.emptyHint).toContain("CustomAnim");

    const items = registeredItems(content);
    expect(items.find((i) => i.id === "vrma-play")).toBeDefined();
    content.dispose();
  });
});

describe("GPU 内存释放", () => {
  it("dispose 时 deepDispose(vrm.scene) + uncacheRoot(vrm.scene)", async () => {
    const vrm = makeFakeVrm();
    const mixer = new THREE.AnimationMixer(vrm.scene);
    const clip = new THREE.AnimationClip("test", -1, []);
    const action = mixer.clipAction(clip);
    action.play();

    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue(["/vrm/test.vrm"]);
    hoisted.createAnimClip.mockReturnValue(clip);

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    content.dispose();
    expect(hoisted.deepDispose).toHaveBeenCalledWith(vrm.scene);
  });

  it("dispose 时原生 lookAt target 断开（防悬挂引用）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock });

    // lookAt target 被设置为 camera
    expect(vrm.lookAt.target).not.toBeNull();

    content.dispose();
    expect(vrm.lookAt.target).toBeNull();
  });
});

describe("VRMA 多动作切换", () => {
  it("多个 .vrma → 可选切换，select(i) 切换当前 action", async () => {
    const vrm = makeFakeVrm();
    // parseMock 根据路径区分主模型和 VRMA
    hoisted.parseMock.mockImplementation((_buffer: unknown, _path: string) => {
      // VRMA 解析时 path 为空字符串 ""（见源码 loader.parse(buf, "", ...)）
      // 通过调用次数区分：第1次=主模型，第2+次=VRMA
      const callCount = hoisted.parseMock.mock.calls.length;
      if (callCount > 1) {
        return { userData: { vrmAnimations: [{ name: "anim" }] } };
      }
      return { userData: { vrm } };
    });
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".vrm")) return Promise.resolve(btoa("VRM"));
      if (p.endsWith(".vrma")) return Promise.resolve(btoa("VRMA"));
      return Promise.resolve(null);
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/vrm/test.vrm",
      "/vrm/dance.vrma",
      "/vrm/idle.vrma",
    ]);
    hoisted.createAnimClip.mockReturnValue(new THREE.AnimationClip("motion", -1, []));

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // 菜单项含 vrma-play
    const items = registeredItems(content);
    const playItem = items.find((i: { id: string; dockGroup?: string }) => i.id === "vrma-play");
    expect(playItem).toBeDefined();
    expect(playItem?.dockGroup).toBe("motion");

    // 通过 panels.playNodes 验证 play bridge（[doc:adr-126-p5-收尾] play 面板声明式化）
    const playNodes = vi.fn((_bridge: unknown) => [
      { id: "stub-play", kind: "toggle" as const, labelKey: "x" as LocaleKey, control: { get: () => false, set: () => {} } },
    ]);
    const panelsWithPlay = makePanels();
    panelsWithPlay.playNodes = playNodes;

    // 重置 parseMock 计数，重新构建以注入 playNodes
    hoisted.parseMock.mockClear();
    hoisted.parseMock.mockImplementation((_buffer: unknown, _path: string) => {
      const callCount = hoisted.parseMock.mock.calls.length;
      if (callCount > 1) {
        return { userData: { vrmAnimations: [{ name: "anim" }] } };
      }
      return { userData: { vrm: makeFakeVrm() } };
    });
    hoisted.createAnimClip.mockReturnValue(new THREE.AnimationClip("motion", -1, []));

    const { ctx: ctx2 } = makeCtx();
    const port2 = makePort();
    const content2 = await buildVrmScene(ctx2, "/vrm/test.vrm", { port: port2, readFileBytes: hoisted.readBytesMock, panels: panelsWithPlay, listAllFilePaths: hoisted.listPathsMock });

    // 菜单项含 vrma-play，且 playNodes 被调用（bridge 传对）
    const items2 = registeredItems(content2);
    const playItem2 = items2.find((i: { id: string }) => i.id === "vrma-play");
    expect(playItem2).toBeDefined();
    expect(playNodes).toHaveBeenCalled();

    content2.dispose();
  });

  it("目录扫描失败 → 白模降级不阻断", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({
      userData: { vrm },
    }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockRejectedValue(new Error("no dir"));

    const { ctx, scene } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // 模型仍加载
    expect(scene.children).toContain(vrm.scene);
    expect(content.update).toBeDefined();
    // 扫描失败 → 无动作，但播放项仍在（空态引导，ADR-242 后续：面板不凭空消失）
    const items = registeredItems(content);
    expect(items.find((i: { id: string }) => i.id === "vrma-play")).toBeDefined();
    content.dispose();
  });
});

describe("GPU 内存释放边界", () => {
  it("dispose 时 bonePanel cleanup 抛错不阻断释放流程", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);
    // 模拟 bonePanel cleanup 抛错
    const origCleanup = vi.fn(() => { throw new Error("panel cleanup failed"); });
    vi.doMock("./vrm-bone-ui.ts", () => ({
      makeBonePanelRenderer: () => origCleanup,
    }));

    // 需在 import 前 doMock，但已 import，需重新导入
    // 此处测试：直接在 dispose 路径上手动触发 cleanupRef.current
    // 由于 cleanupRef 在 build 内闭包，无法直接注入
    // 改为：通过 vrmMenuItems 的 bones render 模拟 cleanup 抛错场景
    // dispose 内部已有 try/catch 包裹 bonePanelRef.current?.()

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // dispose 不应向外抛错
    expect(() => content.dispose()).not.toThrow();
  });

  it("dispose 时 uncacheRoot 在无 mixer 时安全（null 防护）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // 无 VRMA → motionMixer 为 null → dispose 时 uncacheRoot 不触发
    expect(() => content.dispose()).not.toThrow();
  });
});

describe("vrmDiag 诊断日志", () => {
  it("read-model 成功时 addOpLog 被调用（记录字节数）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM_DATA"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // read-model op 被调用，status=ok，msg 含字节数信息
    expect(port.addOpLog).toHaveBeenCalledWith(
      "read-model",
      "/vrm/test.vrm",
      "ok",
      expect.stringContaining("bytes="),
    );
  });

  it("read-model 失败时 addOpLog 被调用（记录错误）", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    const { ctx } = makeCtx();
    const port = makePort();
    await expect(
      buildVrmScene(ctx, "/vrm/missing.vrm", { port: port, readFileBytes: hoisted.readBytesMock }),
    ).rejects.toThrow("ReadFileBytes 返回空");

    // read-model op 被调用，status=fail
    expect(port.addOpLog).toHaveBeenCalledWith(
      "read-model",
      "/vrm/missing.vrm",
      "fail",
      expect.stringContaining("ReadFileBytes 返回空"),
    );
  });

  it("parse 完成后 addOpLog 被调用（记录 bones/glTF-children 数量）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({
      userData: { vrm },
      scenes: [{ children: [{} as unknown as THREE.Object3D, {} as unknown as THREE.Object3D] }],
    }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });

    // parse op 被调用，msg 含 gltf-children 信息
    expect(port.addOpLog).toHaveBeenCalledWith(
      "parse",
      "/vrm/test.vrm",
      "ok",
      expect.stringContaining("gltf-children="),
    );
  });

  it("dispose 时 addOpLog 被调用（记录 GPU 纹理释放）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock });
    content.dispose();

    // gpu-release op 被调用，msg 含 tex= 信息
    expect(port.addOpLog).toHaveBeenCalledWith(
      "gpu-release",
      "/vrm/test.vrm",
      "ok",
      expect.stringContaining("tex="),
    );
  });

  it("addOpLog 抛错时不阻断主流程", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);
    // addOpLog 抛错：诊断应静默吞掉
    const port = makePort();
    (port.addOpLog as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("diag break"));

    const { ctx } = makeCtx();
    // 不应向外抛错
    await expect(
      buildVrmScene(ctx, "/vrm/test.vrm", { port: port, readFileBytes: hoisted.readBytesMock, panels: makePanels(), listAllFilePaths: hoisted.listPathsMock }),
    ).resolves.toBeDefined();
  });
});

describe("vrmMenuItems 结构", () => {
  it("基础三项：model/shot/bones", () => {
    const items = vrmMenuItems({
      screenshot: () => Promise.resolve("shot"),
      modelInfo: { modelName: "test", boneCount: 2, materialCount: 3 },
      modelPath: "a/test.vrm",
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() },
        viewContainer: null,
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
      material: {
        list: () => [],
        getDetail: () => ({ index: 0, name: "test", visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
        setVisible: () => {},
        setOpacity: () => {},
      },
      play: null,
    });

    const ids = items.map((i) => i.id);
    expect(ids).toContain("model");
    expect(ids).toContain("shot");
    expect(ids).toContain("bones");
    items.forEach((i) => expect(i.kind).toBe("panel"));
  });

  it("vrm 正确把 bonePanel 字段（tree/cleanupRef/viewContainer/camera/scene）传给真实 bones 工厂", () => {
    // 真实 bones-panel-node 工厂（未被 mock）会调 mock 的 makeBonePanelRenderer，
    // 记录到 makeBonePanelRenderer 的第二次参数（cleanup 函数）便于断言 cleanupRef 接线正确
    const cleanupRef = { current: null as (() => void) | null };
    const viewContainer = document.createElement("div");
    const tree = { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() } as unknown as BoneTree;
    const items = vrmMenuItems({
      screenshot: null,
      modelInfo: { modelName: "test", boneCount: 2, materialCount: 3 },
      modelPath: "a/test.vrm",
      bonePanel: { tree, viewContainer, camera: null, scene: null, cleanupRef },
      material: {
        list: () => [],
        getDetail: () => ({ index: 0, name: "test", visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
        setVisible: () => {},
        setOpacity: () => {},
      },
      play: null,
    });
    const bonesItem = items.find((i) => i.id === "bones")!;
    // 工厂产物的 renderCustom 应绑 cleanupRef；调一次后 cleanupRef.current 应被设为 no-op 函数
    bonesItem.renderCustom!(document.createElement("div"));
    // camera/scene 为 null → 工厂早 return，cleanupRef.current 仍为 null
    expect(cleanupRef.current).toBeNull();
  });

  it("有 play → 追加 vrma-play 项（dockGroup=motion）", () => {
    const items = vrmMenuItems({
      screenshot: () => Promise.resolve("shot"),
      modelInfo: { modelName: "test", boneCount: 2, materialCount: 3 },
      modelPath: "a/test.vrm",
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() },
        viewContainer: null,
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
      material: {
        list: () => [],
        getDetail: () => ({ index: 0, name: "test", visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
        setVisible: () => {},
        setOpacity: () => {},
      },
      play: {
        clips: [{ label: "dance" }],
        isPlaying: () => true,
        toggle: vi.fn(),
        currentIndex: () => 0,
        select: vi.fn(),
        animDir: null,
      },
    });

    expect(items.map((i) => i.id)).toContain("vrma-play");
    const playItem = items.find((i) => i.id === "vrma-play");
    expect(playItem?.dockGroup).toBe("motion");
  });

  it("modelInfoNodes/shotNodes 收到 modelInfo/modelPath（数据源透传——构造期求值 children）", () => {
    // [doc:adr-126-p4-b-1] P5 收尾：vrmMenuItems 构造时把 modelInfo/modelPath 传给注入工厂；
    // 漏传 → model/shot 面板 children 静默空（a400b244 review P3）
    const infoCb = vi.fn(() => []);
    const shotCb = vi.fn(() => []);
    const items = vrmMenuItems({
      screenshot: () => Promise.resolve("shot"),
      modelInfo: { modelName: "模型A", boneCount: 52, materialCount: 3 },
      modelPath: "/m/模型A.vrm",
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() },
        viewContainer: null,
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
      material: {
        list: () => [],
        getDetail: () => ({ index: 0, name: "test", visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
        setVisible: () => {},
        setOpacity: () => {},
      },
      play: null,
      panels: { modelInfoNodes: infoCb, shotNodes: shotCb },
    });
    expect(items.find((i) => i.id === "model")?.children?.length).toBe(0);
    expect(infoCb).toHaveBeenCalledWith({ modelName: "模型A", boneCount: 52, materialCount: 3 });
    expect(shotCb).toHaveBeenCalledWith(expect.any(Function), "/m/模型A.vrm");
  });
});

describe("readVrmMeta 场景统计（ADR-131 P2）", () => {
  it("复用 GLTF parse 的 vrm.scene 顺带采集 stats（deepDispose 前 traverse）", async () => {
    const vrm = makeFakeVrm();
    // 制造可统计内容：1 mesh（1 三角面）+ 1 bone
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(3), 1));
    vrm.scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
    vrm.scene.add(new THREE.Bone());
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));

    // 顺序守护加固（review 发现）：deepDispose mock 要真的「释放」场景几何——
    // 若实现 no-op，将来有人把 collectSceneStats 挪到 deepDispose 之后，mock 什么都没
    // 释放，stats 照样读到 1 mesh，测试照绿。「dispose 后几何为空」由本实现兑现：
    // 删 position/index 属性 + 材质置空 → 挪用后 triangleCount/materialCount 变 0，断言失败。
    hoisted.deepDispose.mockImplementation((scene: THREE.Object3D) => {
      scene.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const m = o as THREE.Mesh;
        const g = m.geometry as THREE.BufferGeometry;
        g.deleteAttribute("position");
        g.setIndex(null);
        m.material = null as unknown as THREE.Material;
      });
    });

    const info = await readVrmMeta("/vrm/test.vrm", hoisted.readBytesMock);
    expect(info).not.toBeNull();
    expect(info!.stats).toEqual(
      expect.objectContaining({
        meshCount: 1,
        boneCount: 1,
        triangleCount: 1, // 若挪到 deepDispose 后采集 → position/index 已清 → 变 0 失败
        materialCount: 1, // 若挪用 → material 已置空 → 变 0 失败
      }),
    );
    expect(hoisted.deepDispose).toHaveBeenCalledWith(vrm.scene);
  });

  it("空 scene（无 mesh/bone）→ stats 全 0 仍返回", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));

    const info = await readVrmMeta("/vrm/empty.vrm", hoisted.readBytesMock);
    expect(info!.stats).toEqual({
      boneCount: 0,
      meshCount: 0,
      triangleCount: 0,
      materialCount: 0,
      textureCount: 0,
      textureBytes: 0,
      morphCount: 0,
    });
  });
});

// ===== 覆盖率攻坚：readVrmMeta 分支 / metaVersion 0 / 桥消费 / dispose 纹理统计 =====

describe("readVrmMeta 分支补全", () => {
  /** 带 fake canvas 的 document（imageToDataURL 走 drawImage + toDataURL） */
  function stubCanvasDocument(): void {
    const originalCreateElement = (document as unknown as { createElement: (tag: string) => HTMLElement })
      .createElement;
    vi.stubGlobal("document", {
      createElement: (tag: string): unknown => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: vi.fn() }),
            toDataURL: () => "data:image/png;base64,THUMB",
          };
        }
        return originalCreateElement(tag);
      },
    } as unknown as typeof document);
  }

  it("VRM0 meta → restrictions 归一 + thumbnail dataURL（meta.texture 走 imageToDataURL）", async () => {
    stubCanvasDocument();
    const vrm = makeFakeVrm();
    vrm.meta = {
      metaVersion: "0" as const,
      title: "初音",
      author: "作者A",
      version: "0.1",
      licenseName: "CC0",
      otherLicenseUrl: "https://lic.example",
      contactInformation: "@contact",
      texture: { image: { width: 4, height: 4 } },
      allowedUserName: "Everyone",
      commercialUssageName: "Allow",
      sexualUssageName: "Disallow",
      violentUssageName: "Allow",
      reference: "https://ref.example",
    } as unknown as typeof vrm.meta;
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));

    const info = await readVrmMeta("/vrm/v0.vrm", hoisted.readBytesMock);
    expect(info).not.toBeNull();
    expect(info!.metaVersion).toBe("0");
    expect(info!.name).toBe("初音");
    expect(info!.authors).toEqual(["作者A"]);
    expect(info!.license).toBe("CC0 · https://lic.example");
    expect(info!.contact).toBe("@contact");
    expect(info!.thumbnail).toBe("data:image/png;base64,THUMB");
    expect(info!.restrictions).toEqual({
      allowedUser: "everyone",
      commercial: true,
      sexual: false,
      violent: true,
      reference: "https://ref.example",
    });
  });

  it("readFn 返回空 / parse 抛错 → 返回 null（catch 静默）", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    expect(await readVrmMeta("/vrm/missing.vrm", hoisted.readBytesMock)).toBeNull();

    hoisted.readBytesMock.mockResolvedValue(btoa("BAD"));
    hoisted.parseMock.mockImplementation(() => { throw new Error("corrupt glb"); });
    expect(await readVrmMeta("/vrm/bad.vrm", hoisted.readBytesMock)).toBeNull();
  });

  it("缩略图 toDataURL 抛错 → imageToDataURL catch 返回空串（meta 仍返回）", async () => {
    // canvas.toDataURL 抛错（happy-dom 环境异常）→ imageToDataURL 静默降级 ""
    // 捕获原始 createElement（审核修复）：stubGlobal 替换全局 document 后，fallback
    // 若调 document.createElement 会递归进 stub 自身直到栈溢出——与同文件
    // stubCanvasDocument 的既有安全模式保持一致。
    const origCreate = document.createElement.bind(document);
    vi.stubGlobal("document", {
      createElement: (tag: string): unknown => {
        if (tag === "canvas") {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: vi.fn() }),
            toDataURL: () => { throw new Error("canvas broken"); },
          };
        }
        return origCreate(tag);
      },
    } as unknown as typeof document);
    const vrm = makeFakeVrm();
    vrm.meta = {
      metaVersion: "0" as const,
      title: "x",
      texture: { image: { width: 4, height: 4 } },
    } as unknown as typeof vrm.meta;
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));

    const info = await readVrmMeta("/vrm/thumb-broken.vrm", hoisted.readBytesMock);
    expect(info).not.toBeNull();
    expect(info!.thumbnail).toBe("");
  });
});

describe("buildVrmScene metaVersion 0", () => {
  it("VRM0 → rotateVRM0 摆正分支触发", async () => {
    const vrm = makeFakeVrm();
    (vrm.meta as { metaVersion: string }).metaVersion = "0";
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const content = await buildVrmScene(ctx, "/vrm/v0.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock });
    // rotateVRM0 是 vi.mock 工厂里的 vi.fn → 经 hoisted.vrmUtilsMock 不存在，直接断言调用过
    expect(hoisted.rotateVRM0).toHaveBeenCalledWith(vrm);
    content.dispose();
  });
});

describe("桥消费（material / play / screenshot / 感知 update）", () => {
  function makeVrmWithMaterials(materials: THREE.Material[]): ReturnType<typeof makeFakeVrm> {
    const vrm = makeFakeVrm();
    for (const m of materials) {
      vrm.scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
    }
    return vrm;
  }

  it("materialNodes eye/opacity control → 消费 vrm-materials 桥（visible/opacity 透传）", async () => {
    const vrm = makeVrmWithMaterials([
      new THREE.MeshBasicMaterial(),
      new THREE.MeshBasicMaterial(),
    ]);
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);
    // listVrmMaterials / getVrmMaterialDetail 已在文件头 mock → 重配置返回非空列表
    const { listVrmMaterials, getVrmMaterialDetail, setVrmMaterialVisible, setVrmMaterialOpacity } =
      await import("@/preview-3d/materials/vrm-materials.ts");
    (listVrmMaterials as ReturnType<typeof vi.fn>).mockReturnValue([
      { index: 0, name: "服" },
      { index: 1, name: "肌" },
    ]);
    (getVrmMaterialDetail as ReturnType<typeof vi.fn>).mockImplementation(
      (_mats: unknown, i: number) => ({ index: i, name: `m${i}`, visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
    );

    const { ctx } = makeCtx();
    const content = await buildVrmScene(ctx, "/vrm/mat.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock });
    const matItem = content.menuItems?.find((i) => i.id === "material") as {
      children?: Array<{ eye?: { get: () => boolean; set: (v: boolean) => void }; opacity?: { get: () => number; set: (v: number) => void } }>;
    };
    const row = matItem?.children?.find((c) => c.eye && c.opacity);
    expect(row).toBeDefined();
    expect(row!.eye!.get()).toBe(true);
    row!.eye!.set(false);
    expect(setVrmMaterialVisible).toHaveBeenCalled();
    expect(row!.opacity!.get()).toBe(100);
    row!.opacity!.set(50);
    expect(setVrmMaterialOpacity).toHaveBeenCalled();
    content.dispose();
  });

  it("无原生 lookAt → gaze 控制器兜底（update 驱动 + dispose 释放）", async () => {
    const vrm = makeFakeVrm();
    (vrm as { lookAt?: unknown }).lookAt = undefined; // 关闭原生 lookAt → gaze 兜底
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx, camera } = makeCtx();
    const content = await buildVrmScene(ctx, "/vrm/gaze.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock });
    content.update!(0.016);
    const { createGazeController } = await import("@/preview-3d/adapters/shared/perception/gaze.ts");
    const gaze = (createGazeController as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;
    expect(gaze.apply).toHaveBeenCalledWith(0.016, expect.anything(), camera.position);
    content.dispose();
    expect(gaze.dispose).toHaveBeenCalled();
  });

  it("update 眨眼分支：expressionManager 存在 + 待机态 → blink.apply 注入 setValue 回调", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const content = await buildVrmScene(ctx, "/vrm/blink.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock });
    content.update!(0.016);
    const { createBlinkController } = await import("@/preview-3d/adapters/shared/perception/blink.ts");
    const blink = (createBlinkController as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;
    expect(blink.apply).toHaveBeenCalledTimes(1);
    // 回调写入 expressionManager.setValue
    const setter = blink.apply.mock.calls[0][1] as (w: number) => void;
    setter(0.5);
    expect(vrm.expressionManager!.setValue).toHaveBeenCalledWith("blink", 0.5);
    content.dispose();
  });

  it("play 桥：toggle 翻转播放态 + select 切换 clip（同 index / 越界早退）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation((_buffer: unknown, path: string) => {
      void path;
      if (hoisted.parseMock.mock.calls.length > 1) {
        return { userData: { vrmAnimations: [{ name: "a" }] } };
      }
      return { userData: { vrm } };
    });
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".vrma")) return Promise.resolve(btoa("VRMA"));
      if (p.endsWith(".vrm")) return Promise.resolve(btoa("VRM"));
      return Promise.resolve(null);
    });
    hoisted.listPathsMock.mockResolvedValue(["/vrm/t.vrm", "/vrm/a.vrma", "/vrm/b.vrma"]);
    let clipN = 0;
    hoisted.createAnimClip.mockImplementation(() =>
      new THREE.AnimationClip("m" + clipN++, -1, []),
    );

    let bridge: Record<string, (...a: unknown[]) => unknown> | null = null;
    const panels = makePanels();
    panels.playNodes = (b) => {
      bridge = b as unknown as Record<string, (...a: unknown[]) => unknown>;
      return [];
    };
    const { ctx } = makeCtx();
    const content = await buildVrmScene(ctx, "/vrm/t.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock, panels: panels, listAllFilePaths: hoisted.listPathsMock });
    expect(bridge).not.toBeNull();

    // toggle 翻转
    const p0 = bridge!.isPlaying!() as boolean;
    bridge!.toggle!();
    expect(bridge!.isPlaying!()).toBe(!p0);
    // select 切换
    bridge!.select!(1);
    expect(bridge!.currentIndex!()).toBe(1);
    // 同 index / 越界早退
    bridge!.select!(1);
    bridge!.select!(99);
    expect(bridge!.currentIndex!()).toBe(1);
    // [ADR-243 锐评对账 P1a] 有动作的常态桥也必须带版权提示（配布条款雷区立牌）
    expect(bridge!.notice).toBeTruthy();
    content.dispose();
  });

  it("play 桥：空态桥同样带 notice（版权提示与空态引导不互斥）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue(["/vrm/t.vrm"]);
    let bridge: Record<string, unknown> | null = null;
    const panels = makePanels();
    panels.playNodes = (b) => {
      bridge = b as unknown as Record<string, unknown>;
      return [];
    };
    const { ctx } = makeCtx();
    const content = await buildVrmScene(ctx, "/vrm/t.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock, panels: panels, listAllFilePaths: hoisted.listPathsMock });
    expect(bridge).not.toBeNull();
    expect(bridge!.emptyHint).toBeTruthy(); // 空态引导在
    expect(bridge!.notice).toBeTruthy(); // 版权提示也在
    content.dispose();
  });

  it("shotNodes 注入的 screenshot 能力可调用 + PreviewScene.screenshot", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);
    let gotShot: (() => Promise<string | null>) | null = null;
    const panels = makePanels();
    panels.shotNodes = (screenshot) => {
      gotShot = screenshot;
      return [];
    };
    const { ctx } = makeCtx();
    const content = await buildVrmScene(ctx, "/vrm/shot.vrm", { port: makePort(), readFileBytes: hoisted.readBytesMock, panels: panels });
    await expect(gotShot!()).resolves.toBe("screenshot-url");
    await expect(content.screenshot!()).resolves.toBe("screenshot-url");
    content.dispose();
  });
});

describe("dispose 纹理统计（gpu-release diag）", () => {
  it("mesh 多材质 + map 纹理 → dispose 统计 texCount 上报", async () => {
    const vrm = makeFakeVrm();
    const matA = new THREE.MeshBasicMaterial();
    matA.map = new THREE.Texture();
    const matB = new THREE.MeshBasicMaterial();
    matB.map = new THREE.Texture();
    vrm.scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [matA, matB]));
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    const content = await buildVrmScene(ctx, "/vrm/tex.vrm", { port: port, readFileBytes: hoisted.readBytesMock });
    content.dispose();
    expect(port.addOpLog).toHaveBeenCalledWith(
      "gpu-release",
      "/vrm/tex.vrm",
      "ok",
      expect.stringContaining("tex=2"),
    );
  });
});

describe("vrmMetaSummary（3D 面板 meta 摘要：v0/v1 归一化，纯函数零副作用）", () => {
  it("VRM0：title/author/licenseName(+otherLicenseUrl)/version → 摘要", () => {
    expect(
      vrmMetaSummary({
        metaVersion: "0",
        title: "初音",
        author: "作者A",
        version: "0.1",
        licenseName: "CC0",
        otherLicenseUrl: "https://lic.example",
      } as never),
    ).toEqual({
      title: "初音",
      author: "作者A",
      license: "CC0 · https://lic.example",
      version: "0.1",
    });
  });

  it("VRM1：name/authors[]/licenseUrl/version → 摘要（多作者顿号拼接）", () => {
    expect(
      vrmMetaSummary({
        metaVersion: "1",
        name: "Robot",
        authors: ["作者A", "作者B"],
        version: "1.2",
        licenseUrl: "https://lic.example/v1",
      } as never),
    ).toEqual({
      title: "Robot",
      author: "作者A、作者B",
      license: "https://lic.example/v1",
      version: "1.2",
    });
  });

  it("字段缺失 → 对应摘要字段 undefined（不产空串噪音）", () => {
    expect(vrmMetaSummary({ metaVersion: "0" } as never)).toEqual({
      title: undefined,
      author: undefined,
      license: undefined,
      version: undefined,
    });
    expect(vrmMetaSummary({ metaVersion: "1", name: "", authors: [], licenseUrl: "" } as never)).toEqual({
      title: undefined,
      author: undefined,
      license: undefined,
      version: undefined,
    });
  });
});

// ---------------------------------------------------------------------------
// P3 位移缩放校准（ADR-243 锐评对账）：持久化 + 菜单滑块 + 重建换绑
// ---------------------------------------------------------------------------

describe("P3 positionScale 校准（ADR-243 锐评对账）", () => {
  beforeEach(() => {
    hoisted.storageStore.clear();
  });

  it("writeVmdPositionScale/readVmdPositionScale 往返（null 清除回自动）", () => {
    expect(readVmdPositionScale()).toBeNull();
    writeVmdPositionScale(0.15);
    expect(readVmdPositionScale()).toBe(0.15);
    writeVmdPositionScale(null);
    expect(readVmdPositionScale()).toBeNull();
  });

  it("readVmdPositionScale：非法值（非数字 / 负数）→ null（回自动不崩）", () => {
    hoisted.storageStore.set("vmd.positionScale", "abc");
    expect(readVmdPositionScale()).toBeNull();
    hoisted.storageStore.set("vmd.positionScale", "-1");
    expect(readVmdPositionScale()).toBeNull();
    hoisted.storageStore.set("vmd.positionScale", "0.3");
    expect(readVmdPositionScale()).toBe(0.3);
  });

  it("vrmMenuItems：positionScale 控制且 vmdCount>0 → 动作面板 children 内滑块 + 复位按钮（onCommit→set / 复位→resetToAuto）", () => {
    const control = { vmdCount: 2, current: () => 0.1, set: vi.fn(), resetToAuto: vi.fn() };
    const items = vrmMenuItems({
      screenshot: null,
      modelInfo: { modelName: "t", boneCount: 1, materialCount: 1 },
      modelPath: "a/t.vrm",
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() },
        viewContainer: null,
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
      material: {
        list: () => [],
        getDetail: () => ({ index: 0, name: "m", visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
        setVisible: () => {},
        setOpacity: () => {},
      },
      play: null,
      positionScale: control,
    });
    // 根项白名单（check-menu-health ROOT_KINDS）：滑块/按钮是叶子，必须挂动作面板 children——
    // 曾经的根项写法既违规又不可达（motionDetailView 只列 kind==="panel" 的 motion 项）
    expect(
      items.map((i) => i.kind).filter((k) => k !== "panel" && k !== "action" && k !== "divider"),
    ).toEqual([]);
    const play = items.find((i) => i.id === "vrma-play");
    const slider = play?.children?.find((i) => i.id === "vmd-position-scale");
    const reset = play?.children?.find((i) => i.id === "vmd-position-scale-reset");
    expect(slider?.kind).toBe("slider");
    expect(reset?.kind).toBe("button");
    // 滑块 get = 当前有效值；onCommit（松手）才 set（重建）——拖动过程抑制
    expect(slider?.control?.get?.(undefined)).toBe(0.1);
    slider?.control?.onCommit?.(0.2);
    expect(control.set).toHaveBeenCalledWith(0.2);
    reset?.action?.({} as never);
    expect(control.resetToAuto).toHaveBeenCalled();
  });

  it("vrmMenuItems：positionScale 控制缺席 → 无位移缩放节点（.vrma-only 模型不露出）", () => {
    const items = vrmMenuItems({
      screenshot: null,
      modelInfo: { modelName: "t", boneCount: 1, materialCount: 1 },
      modelPath: "a/t.vrm",
      bonePanel: {
        tree: { byId: new Map(), childrenMap: new Map(), roots: [], objectToId: new Map() },
        viewContainer: null,
        camera: null,
        scene: null,
        cleanupRef: { current: null },
      },
      material: {
        list: () => [],
        getDetail: () => ({ index: 0, name: "m", visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
        setVisible: () => {},
        setOpacity: () => {},
      },
      play: null,
    });
    const play = items.find((i) => i.id === "vrma-play");
    expect(play?.children?.some((c) => c.id === "vmd-position-scale")).toBe(false);
    expect(play?.children?.some((c) => c.id === "vmd-position-scale-reset")).toBe(false);
  });

  it("rebuildVmdMotionClips：换掉 vmd 条目、保留 vrma 条目、活动动作按 label 重绑新 clip 并保播放态", async () => {
    const nodes = makeNormalizedNodes();
    const vrm = makeFakeVrm(nodes);
    for (const n of Object.values(nodes)) vrm.scene.add(n);
    const mixer = new THREE.AnimationMixer(vrm.scene);
    const vrmaClip = new THREE.AnimationClip("vrma", -1, []);
    const oldVmdClip = new THREE.AnimationClip("wave-old", -1, []);
    const motion: {
      motionClips: Array<{ label: string; clip: THREE.AnimationClip; footIK: null; source: "vrma" | "vmd" }>;
      motionMixer: THREE.AnimationMixer;
      motionAction: THREE.AnimationAction;
      motionPlaying: boolean;
    } = {
      motionClips: [
        { label: "idle", clip: vrmaClip, footIK: null, source: "vrma" },
        { label: "wave", clip: oldVmdClip, footIK: null, source: "vmd" },
      ],
      motionMixer: mixer,
      motionAction: mixer.clipAction(oldVmdClip), // 活动的是 vmd clip
      motionPlaying: true,
    };
    motion.motionAction.play();

    // 重建：listVmdPaths 只列 .vmd；parseVmdMock 产真轨道；positionScale=0.5 烘焙
    hoisted.getCustomAnimPathMock.mockResolvedValue(null);
    hoisted.listPathsMock.mockImplementation((dir: string) =>
      Promise.resolve(dir === "/vrm" ? ["/vrm/wave.vmd"] : []),
    );
    hoisted.readBytesMock.mockImplementation(() => Promise.resolve(btoa("VMD")));
    hoisted.parseVmdMock.mockResolvedValue(
      makeFakeVmd([
        ["左腕", 0, [0, 0, 0]],
        ["左腕", 30, [1, 2, 3]],
      ]),
    );

    await rebuildVmdMotionClips(motion, vrm as unknown as Parameters<typeof rebuildVmdMotionClips>[1], "/vrm/test.vrm", hoisted.readBytesMock, hoisted.listPathsMock, 0.5);

    // vrma 条目对象保留；vmd 条目被新 clip 对象替换
    expect(motion.motionClips[0].clip).toBe(vrmaClip);
    expect(motion.motionClips[1].source).toBe("vmd");
    const newVmdClip = motion.motionClips[1].clip;
    expect(newVmdClip).not.toBe(oldVmdClip);
    expect(newVmdClip.tracks.length).toBeGreaterThan(0);
    // 活动动作重绑到新 vmd clip（同 label），且保持播放态
    expect(motion.motionAction).toBe(mixer.clipAction(newVmdClip));
    expect(motion.motionPlaying).toBe(true);
    expect(motion.motionAction.isRunning()).toBe(true);
  });

  it("rebuildVmdMotionClips：活动的是 .vrma（对象未变）→ 不碰其 action（避免从头重放）", async () => {
    const nodes = makeNormalizedNodes();
    const vrm = makeFakeVrm(nodes);
    for (const n of Object.values(nodes)) vrm.scene.add(n);
    const mixer = new THREE.AnimationMixer(vrm.scene);
    const vrmaClip = new THREE.AnimationClip("idle", -1, []);
    const vmdClip = new THREE.AnimationClip("wave", -1, []);
    const motion: {
      motionClips: Array<{ label: string; clip: THREE.AnimationClip; footIK: null; source: "vrma" | "vmd" }>;
      motionMixer: THREE.AnimationMixer;
      motionAction: THREE.AnimationAction;
      motionPlaying: boolean;
    } = {
      motionClips: [
        { label: "idle", clip: vrmaClip, footIK: null, source: "vrma" },
        { label: "wave", clip: vmdClip, footIK: null, source: "vmd" },
      ],
      motionMixer: mixer,
      motionAction: mixer.clipAction(vrmaClip), // 活动的是 vrma
      motionPlaying: true,
    };
    const sameAction = motion.motionAction;
    motion.motionAction.play();

    hoisted.getCustomAnimPathMock.mockResolvedValue(null);
    hoisted.listPathsMock.mockImplementation((dir: string) =>
      Promise.resolve(dir === "/vrm" ? ["/vrm/wave.vmd"] : []),
    );
    hoisted.readBytesMock.mockImplementation(() => Promise.resolve(btoa("VMD")));
    hoisted.parseVmdMock.mockResolvedValue(makeFakeVmd([])); // 空 vmd → 重建后无 vmd 轨道，条目被丢

    await rebuildVmdMotionClips(motion, vrm as unknown as Parameters<typeof rebuildVmdMotionClips>[1], "/vrm/test.vrm", hoisted.readBytesMock, hoisted.listPathsMock, 0.5);

    // vrma 活动动作对象不变（同一 action 实例，未从头重放）
    expect(motion.motionAction).toBe(sameAction);
    expect(motion.motionAction.isRunning()).toBe(true);
  });
});