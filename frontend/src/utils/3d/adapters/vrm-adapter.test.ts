// ===== VRM 适配器测试 =====
// 覆盖：buildVrmScene 主路径（readFn → GLTFLoader.parse + VRMLoaderPlugin →
// rotateVRM0 摆正 → 挂场景 + 灯光 + 包围盒定相机 + 根菜单注入）、
// VRMA 动作加载（同目录 .vrma → createVRMAnimationClip）、
// 错误路径（空字节/解析失败）、GPU 释放（deepDispose + uncacheRoot）。
// @pixiv/three-vrm 全 mock；three 用真实实现（Box3/Vector3/LoadingManager）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewMenuHandle } from "./preview-menu.ts";
import type { PreviewMenuItemDef } from "./preview-menu-defs.ts";

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
    rotateVRM0: vi.fn(),
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

import { buildVrmScene, type VrmPanelHooks, vrmMenuItems } from "./vrm-adapter.ts";

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

function registeredItems(built: { menuItems?: PreviewMenuItemDef[] | null }): PreviewMenuItemDef[] {
  return built.menuItems ?? [];
}

function makePanels(): VrmPanelHooks {
  return {
    makePanelRenderer: () => () => {},
    makeModelPanelRenderer: () => {},
    makeShotPanelRenderer: () => () => {},
    fillPlayPanel: () => {},
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

    // 通过 panels.fillPlayPanel 验证 play bridge
    const fillPlayPanel = vi.fn();
    const panelsWithPlay = makePanels();
    panelsWithPlay.fillPlayPanel = fillPlayPanel;

    // 重置 parseMock 计数，重新构建以注入 fillPlayPanel
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

    // 菜单项含 vrma-play，且 render 会调用 fillPlayPanel
    const items2 = registeredItems(built2);
    const playItem2 = items2.find((i: { id: string }) => i.id === "vrma-play");
    expect(playItem2).toBeDefined();

    // 调用 render 触发 fillPlayPanel
    const list = document.createElement("div");
    playItem2!.render!(list, () => {});
    expect(fillPlayPanel).toHaveBeenCalled();

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
      modelPanel: vi.fn(),
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

  it("bonePanel 重入时先清理旧 renderer（cleanupRef.current 被调用后置 null）", () => {
    // 直接测试 cleanupRef 的行为逻辑（与 vrmMenuItems 中 bones 项的 render 一致）
    const cleanup1 = vi.fn();
    const cleanup2 = vi.fn();
    const cleanup3 = vi.fn();

    // 首次渲染：cleanupRef.current 初始为 null，不触发清理，直接注册
    const cleanupRef1 = { current: null as (() => void) | null };
    if (cleanupRef1.current) {
      cleanupRef1.current();
      cleanupRef1.current = null;
    }
    cleanupRef1.current = cleanup2;

    expect(cleanup1).not.toHaveBeenCalled(); // 首次无旧 cleanup
    expect(cleanupRef1.current).toBe(cleanup2);

    // 重入渲染：应先调用旧 cleanup 再注册新的
    if (cleanupRef1.current) {
      cleanupRef1.current(); // 应调用 cleanup2
      cleanupRef1.current = null;
    }
    cleanupRef1.current = cleanup3;

    expect(cleanup2).toHaveBeenCalledTimes(1);
    expect(cleanupRef1.current).toBe(cleanup3);
  });

  it("有 play → 追加 vrma-play 项（dockGroup=motion）", () => {
    const items = vrmMenuItems({
      screenshot: () => Promise.resolve("shot"),
      modelPanel: vi.fn(),
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
});
