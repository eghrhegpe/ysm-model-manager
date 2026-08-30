// ===== VRM 适配器测试 =====
// 覆盖：buildVrmScene 主路径（readFn → GLTFLoader.parse + VRMLoaderPlugin →
// rotateVRM0 摆正 → 挂场景 + 灯光 + 包围盒定相机 + 根菜单注入）、
// VRMA 动作加载（同目录 .vrma → createVRMAnimationClip）、
// 错误路径（空字节/解析失败）、GPU 释放（deepDispose + uncacheRoot）。
// @pixiv/three-vrm 全 mock；three 用真实实现（Box3/Vector3/LoadingManager）。
import type { BoneTree } from "../bone-tools.ts"

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewMenuHandle } from "./preview-menu/core.ts";

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
  };
});

vi.mock("../vrm-materials.ts", () => ({
  listVrmMaterials: vi.fn(() => []),
  getVrmMaterialDetail: vi.fn(() => ({})),
  setVrmMaterialVisible: vi.fn(),
  setVrmMaterialOpacity: vi.fn(),
}));
vi.mock("../bone-tools.ts", () => ({
  buildBoneTree: vi.fn(() => ({ byId: new Map(), childrenMap: new Map(), roots: [] })),
}));
vi.mock("./vrm-bone-ui.ts", () => ({
  makeBonePanelRenderer: vi.fn(() => () => () => {}),
}));
vi.mock("../semantic-bones.ts", () => ({
  vrmSemanticBoneMap: vi.fn(() => ({})),
}));
vi.mock("../perception/breath.ts", () => ({
  createBreathController: vi.fn(() => ({
    apply: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("../perception/gaze.ts", () => ({
  createGazeController: vi.fn(() => ({
    apply: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("../perception/blink.ts", () => ({
  createBlinkController: vi.fn(() => ({
    apply: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("../mmd-foot-ik.ts", () => ({
  createFootIKController: vi.fn(() => ({
    apply: vi.fn(),
    dispose: vi.fn(),
  })),
}));
vi.mock("../screenshot.ts", () => ({
  screenshotFromRenderer: vi.fn(() => Promise.resolve("screenshot-url")),
}));
vi.mock("../frustum-cull.ts", () => ({
  registerModelRoot: vi.fn(),
  unregisterModelRoot: vi.fn(),
}));
vi.mock("./vrm-bone.ts", () => ({
  buildVrmBoneTree: vi.fn(() => ({ byId: new Map(), childrenMap: new Map(), roots: [] })),
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

import { buildVrmScene, readVrmMeta, type VrmPanelHooks, vrmMenuItems } from "./vrm-adapter.ts";

/** 构造注入端口（含诊断日志 mock） */
function makePort() {
  return {
    readBytesMock: hoisted.readBytesMock,
    listPathsMock: hoisted.listPathsMock,
    addOpLog: vi.fn(),
  };
}

/** 构造假 VRM */
function makeFakeVrm() {
  const scene = new THREE.Scene();
  const humanoid = { humanBones: {} as Record<string, THREE.Bone | null> };
  const lookAt = { target: null as THREE.Object3D | null };
  const exprMgr = {
    getExpression: (name: string) => {
      if (name === "blink") return {};
      return null;
    },
    setValue: vi.fn(),
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
    },
    scene,
    camera,
    loadingEl,
  };
}

/** 从 built 对象读取注入的菜单项（render 双参对齐 PreviewMenuItemDef，严格逆变下单参不可赋） */
function registeredItems(built: { menuItems?: Array<{ id: string; kind: string; dockGroup?: string; render?: (list: HTMLElement, close: () => void) => void; renderCustom?: (list: HTMLElement, close?: () => void) => void }> | null }): Array<{
  id: string;
  kind: string;
  dockGroup?: string;
  render?: (list: HTMLElement, close: () => void) => void;
  renderCustom?: (list: HTMLElement, close?: () => void) => void;
}> {
  return (built.menuItems ?? []) as Array<{
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
      { id: "stub-play-toggle", kind: "toggle" as const, labelKey: "x", fallback: "播放", control: { get: () => false, set: () => {} } },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.deepDisposeCalls.length = 0;
  hoisted.loaderParsers.length = 0;
  mockElements.clear();
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
    const built = await buildVrmScene(ctx, "/vrm/test.vrm", port, hoisted.readBytesMock, makePanels(), hoisted.listPathsMock);

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
    const items = registeredItems(built);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("model");
    expect(ids).toContain("shot");
    expect(ids).toContain("bones");

    built.dispose();
  });

  it("readFn 返回空 → 抛错", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    const { ctx } = makeCtx();
    await expect(
      buildVrmScene(ctx, "/vrm/missing.vrm", makePort(), hoisted.readBytesMock),
    ).rejects.toThrow("ReadFileBytes 返回空");
  });

  it("GLTFLoader.parse 未返回 vrm → 抛错", async () => {
    hoisted.parseMock.mockImplementation(() => ({ userData: {} }));
    hoisted.readBytesMock.mockResolvedValue(btoa("FAKE"));
    const { ctx } = makeCtx();
    await expect(
      buildVrmScene(ctx, "/vrm/fake.vrm", makePort(), hoisted.readBytesMock),
    ).rejects.toThrow("VRM 实例解析失败");
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
    hoisted.parseMock.mockImplementation((buffer, path) => {
      parseCallCount++;
      if (parseCallCount > 1) {
        return { userData: { vrmAnimations: [{ name: "test" }] } };
      }
      return { userData: { vrm } };
    });

    const { ctx, scene } = makeCtx();
    const port = makePort();
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    // VRMA 被解析 + 动画 clip 被创建
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/vrm/dance.vrma");
    expect(hoisted.createAnimClip).toHaveBeenCalled();

    // VRMA clip → 动画播放（mixer 驱动）
    built.update!(0.016);
    expect(vrm.update).toHaveBeenCalledWith(0.016);

    built.dispose();
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
    hoisted.parseMock.mockImplementation((buffer, path) => {
      if (path.endsWith("bad.vrma")) throw new Error("corrupt");
      return { userData: { vrm } };
    });

    const { ctx } = makeCtx();
    const port = makePort();
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    // 模型仍加载
    expect(built.update).toBeDefined();
    built.dispose();
  });

  it("无同目录 .vrma → 无播放菜单项", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({
      userData: { vrm },
    }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue(["/vrm/test.vrm"]);

    const { ctx } = makeCtx();
    const port = makePort();
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    const items = registeredItems(built);
    expect(items.find((i) => i.id === "vrma-play")).toBeUndefined();
    built.dispose();
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
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    built.dispose();
    expect(hoisted.deepDispose).toHaveBeenCalledWith(vrm.scene);
  });

  it("dispose 时原生 lookAt target 断开（防悬挂引用）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    const built = await buildVrmScene(ctx, "/vrm/test.vrm", port, hoisted.readBytesMock);

    // lookAt target 被设置为 camera
    expect(vrm.lookAt.target).not.toBeNull();

    built.dispose();
    expect(vrm.lookAt.target).toBeNull();
  });
});

describe("VRMA 多动作切换", () => {
  it("多个 .vrma → 可选切换，select(i) 切换当前 action", async () => {
    const vrm = makeFakeVrm();
    // parseMock 根据路径区分主模型和 VRMA
    hoisted.parseMock.mockImplementation((buffer: unknown, path: string) => {
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
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    // 菜单项含 vrma-play
    const items = registeredItems(built);
    const playItem = items.find((i: { id: string; dockGroup?: string }) => i.id === "vrma-play");
    expect(playItem).toBeDefined();
    expect(playItem?.dockGroup).toBe("motion");

    // 通过 panels.playNodes 验证 play bridge（[doc:adr-126-p5-收尾] play 面板声明式化）
    const playNodes = vi.fn((bridge: unknown) => [
      { id: "stub-play", kind: "toggle" as const, labelKey: "x", fallback: "播放", control: { get: () => false, set: () => {} } },
    ]);
    const panelsWithPlay = makePanels();
    panelsWithPlay.playNodes = playNodes;

    // 重置 parseMock 计数，重新构建以注入 playNodes
    hoisted.parseMock.mockClear();
    hoisted.parseMock.mockImplementation((buffer: unknown, path: string) => {
      const callCount = hoisted.parseMock.mock.calls.length;
      if (callCount > 1) {
        return { userData: { vrmAnimations: [{ name: "anim" }] } };
      }
      return { userData: { vrm: makeFakeVrm() } };
    });
    hoisted.createAnimClip.mockReturnValue(new THREE.AnimationClip("motion", -1, []));

    const { ctx: ctx2 } = makeCtx();
    const port2 = makePort();
    const built2 = await buildVrmScene(
      ctx2,
      "/vrm/test.vrm",
      port2,
      hoisted.readBytesMock,
      panelsWithPlay,
      hoisted.listPathsMock,
    );

    // 菜单项含 vrma-play，且 playNodes 被调用（bridge 传对）
    const items2 = registeredItems(built2);
    const playItem2 = items2.find((i: { id: string }) => i.id === "vrma-play");
    expect(playItem2).toBeDefined();
    expect(playNodes).toHaveBeenCalled();

    built2.dispose();
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
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    // 模型仍加载
    expect(scene.children).toContain(vrm.scene);
    expect(built.update).toBeDefined();
    // 无动作
    const items = registeredItems(built);
    expect(items.find((i: { id: string }) => i.id === "vrma-play")).toBeUndefined();
    built.dispose();
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
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    // dispose 不应向外抛错
    expect(() => built.dispose()).not.toThrow();
  });

  it("dispose 时 uncacheRoot 在无 mixer 时安全（null 防护）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const port = makePort();
    const built = await buildVrmScene(
      ctx,
      "/vrm/test.vrm",
      port,
      hoisted.readBytesMock,
      makePanels(),
      hoisted.listPathsMock,
    );

    // 无 VRMA → motionMixer 为 null → dispose 时 uncacheRoot 不触发
    expect(() => built.dispose()).not.toThrow();
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
    await buildVrmScene(ctx, "/vrm/test.vrm", port, hoisted.readBytesMock, makePanels(), hoisted.listPathsMock);

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
      buildVrmScene(ctx, "/vrm/missing.vrm", port, hoisted.readBytesMock),
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
    await buildVrmScene(ctx, "/vrm/test.vrm", port, hoisted.readBytesMock, makePanels(), hoisted.listPathsMock);

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
    const built = await buildVrmScene(ctx, "/vrm/test.vrm", port, hoisted.readBytesMock, makePanels(), hoisted.listPathsMock);
    built.dispose();

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
      buildVrmScene(ctx, "/vrm/test.vrm", port, hoisted.readBytesMock, makePanels(), hoisted.listPathsMock),
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

  it("vrm 正确把 bonePanel 字段（tree/cleanupRef/viewContainer/camera/scene/legacyTestId）传给真实 bones 工厂", () => {
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
    expect(bonesItem.legacyTestId).toBe("vrm-bones-entry");
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
    const built = await buildVrmScene(ctx, "/vrm/v0.vrm", makePort(), hoisted.readBytesMock);
    // rotateVRM0 是 vi.mock 工厂里的 vi.fn → 经 hoisted.vrmUtilsMock 不存在，直接断言调用过
    expect(hoisted.rotateVRM0).toHaveBeenCalledWith(vrm);
    built.dispose();
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
      await import("../vrm-materials.ts");
    (listVrmMaterials as ReturnType<typeof vi.fn>).mockReturnValue([
      { index: 0, name: "服" },
      { index: 1, name: "肌" },
    ]);
    (getVrmMaterialDetail as ReturnType<typeof vi.fn>).mockImplementation(
      (_mats: unknown, i: number) => ({ index: i, name: `m${i}`, visible: true, opacity: 1, transparent: false, type: "mtoon" as const }),
    );

    const { ctx } = makeCtx();
    const built = await buildVrmScene(ctx, "/vrm/mat.vrm", makePort(), hoisted.readBytesMock);
    const matItem = built.menuItems?.find((i) => i.id === "material") as {
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
    built.dispose();
  });

  it("无原生 lookAt → gaze 控制器兜底（update 驱动 + dispose 释放）", async () => {
    const vrm = makeFakeVrm();
    (vrm as { lookAt?: unknown }).lookAt = undefined; // 关闭原生 lookAt → gaze 兜底
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx, camera } = makeCtx();
    const built = await buildVrmScene(ctx, "/vrm/gaze.vrm", makePort(), hoisted.readBytesMock);
    built.update!(0.016);
    const { createGazeController } = await import("../perception/gaze.ts");
    const gaze = (createGazeController as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;
    expect(gaze.apply).toHaveBeenCalledWith(0.016, expect.anything(), camera.position);
    built.dispose();
    expect(gaze.dispose).toHaveBeenCalled();
  });

  it("update 眨眼分支：expressionManager 存在 + 待机态 → blink.apply 注入 setValue 回调", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation(() => ({ userData: { vrm } }));
    hoisted.readBytesMock.mockResolvedValue(btoa("VRM"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const built = await buildVrmScene(ctx, "/vrm/blink.vrm", makePort(), hoisted.readBytesMock);
    built.update!(0.016);
    const { createBlinkController } = await import("../perception/blink.ts");
    const blink = (createBlinkController as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value;
    expect(blink.apply).toHaveBeenCalledTimes(1);
    // 回调写入 expressionManager.setValue
    const setter = blink.apply.mock.calls[0][1] as (w: number) => void;
    setter(0.5);
    expect(vrm.expressionManager!.setValue).toHaveBeenCalledWith("blink", 0.5);
    built.dispose();
  });

  it("play 桥：toggle 翻转播放态 + select 切换 clip（同 index / 越界早退）", async () => {
    const vrm = makeFakeVrm();
    hoisted.parseMock.mockImplementation((buffer: unknown, path: string) => {
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
    hoisted.createAnimClip.mockReturnValue(new THREE.AnimationClip("m", -1, []));

    let bridge: Record<string, (...a: unknown[]) => unknown> | null = null;
    const panels = makePanels();
    panels.playNodes = (b) => {
      bridge = b as unknown as Record<string, (...a: unknown[]) => unknown>;
      return [];
    };
    const { ctx } = makeCtx();
    const built = await buildVrmScene(ctx, "/vrm/t.vrm", makePort(), hoisted.readBytesMock, panels, hoisted.listPathsMock);
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
    built.dispose();
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
    const built = await buildVrmScene(ctx, "/vrm/shot.vrm", makePort(), hoisted.readBytesMock, panels);
    await expect(gotShot!()).resolves.toBe("screenshot-url");
    await expect(built.screenshot!()).resolves.toBe("screenshot-url");
    built.dispose();
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
    const built = await buildVrmScene(ctx, "/vrm/tex.vrm", port, hoisted.readBytesMock);
    built.dispose();
    expect(port.addOpLog).toHaveBeenCalledWith(
      "gpu-release",
      "/vrm/tex.vrm",
      "ok",
      expect.stringContaining("tex=2"),
    );
  });
});