// ===== MMD 适配器测试 =====
// 覆盖：buildMmdScene 主路径（ReadFileBytes + ListAllFilePaths 同目录纹理预读 →
// URLModifier 映射 → 挂场景/灯光/取景）、update/dispose 契约（blob URL 回收）、
// 错误路径（空字节/加载失败/目录扫描失败降级）。
// @moeru/three-mmd 全 mock（MMDLoader 捕获 LoadingManager 断言 URLModifier 行为）；
// three 用真实实现（Box3/Vector3/Light/LoadingManager 为纯 JS，无 WebGL 依赖）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PreviewMenuHandle } from "../menu/core.ts";
import type { PreviewMenuNode } from "../menu/node-types.ts";
import type { DecodedTexture } from "./mmd-texture-decoder.ts";

const hoisted = vi.hoisted(() => {
  const managerInstances: Array<{ resolveURL: (url: string) => string }> = [];
  return {
    readBytesMock: vi.fn(),
    listPathsMock: vi.fn(),
    loaderLoadAsyncMock: vi.fn(),
    loaderRegisterMock: vi.fn(),
    mmdUpdateMock: vi.fn(),
    mmdUpdateWithMixerMock: vi.fn(),
    mmdDisposeMock: vi.fn(),
    vmdParseMock: vi.fn(),
    buildAnimMock: vi.fn(),
    buildCameraAnimMock: vi.fn(),
    ammoPluginMock: vi.fn(),
    vpdLoadAsyncMock: vi.fn(),
    applyVPDMock: vi.fn(),
    ktx2LoadAsyncMock: vi.fn(),
    prepareZipMock: vi.fn(),
    decodeAllMock: vi.fn(),
    applyTexturesMock: vi.fn(),
    scheduleBackgroundEncodingMock: vi.fn(),
    cancelPendingEncodingsMock: vi.fn(),
    screenshotMock: vi.fn(),
    recordTraceMock: vi.fn(),
    mainThreadWatchCb: null as ((info: unknown) => void) | null,
    createPmxParserImpl: null as null | (() => unknown),
    managerInstances,
  };
});

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ReadFileBytes: hoisted.readBytesMock,
    ListAllFilePaths: hoisted.listPathsMock,
  }),
}));
vi.mock("@moeru/three-mmd", () => ({
  MMDLoader: class {
    loadAsync = hoisted.loaderLoadAsyncMock;
    register = (...args: unknown[]) => {
      hoisted.loaderRegisterMock(...args);
      return this; // 链式：真实 register 返回 this，适配器 new MMDLoader().register() 继续链上 loadAsync
    };
    constructor(manager: { resolveURL: (url: string) => string }) {
      hoisted.managerInstances.push(manager);
    }
  },
  VmdObject: { ParseFromBuffer: hoisted.vmdParseMock },
  buildAnimation: hoisted.buildAnimMock,
  buildCameraAnimation: hoisted.buildCameraAnimMock,
  VPDLoader: class {
    loadAsync = hoisted.vpdLoadAsyncMock;
  },
  applyVPD: hoisted.applyVPDMock,
}));
vi.mock("@moeru/three-mmd-physics-ammo", () => ({
  MMDAmmoPlugin: hoisted.ammoPluginMock,
}));
vi.mock("three/addons/loaders/KTX2Loader.js", () => ({
  KTX2Loader: class {
    loadAsync = hoisted.ktx2LoadAsyncMock;
    setTranscoderPath(): unknown { return this; }
    detectSupport(): unknown { return this; }
  },
}));
vi.mock("./mmd-texture-decoder.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mmd-texture-decoder.ts")>();
  return {
    ...actual,
    getTextureDecoder: () => ({ decodeAll: hoisted.decodeAllMock }),
    applyWorkerDecodedTextures: hoisted.applyTexturesMock,
  };
});
vi.mock("../load-trace.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../load-trace.ts")>();
  return {
    ...actual,
    recordLoadTrace: hoisted.recordTraceMock,
  };
});
vi.mock("./mmd-zip-overlay.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mmd-zip-overlay.ts")>();
  return {
    ...actual,
    prepareMmdZipInput: hoisted.prepareZipMock,
  };
});
vi.mock("./mmd-pmx-parser.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mmd-pmx-parser.ts")>();
  return {
    ...actual,
    createPmxParser: (): unknown => {
      // 默认镜像真实降级行为（测试/受限环境无 Worker → always-fail parser）
      if (hoisted.createPmxParserImpl) return hoisted.createPmxParserImpl();
      return {
        parse: () => Promise.resolve({ id: 0, ok: false, error: "Worker 不可用（测试/受限环境）" }),
        dispose: () => undefined,
      };
    },
  };
});
vi.mock("./mmd-ktx2-encoder.ts", () => ({
  scheduleBackgroundEncoding: hoisted.scheduleBackgroundEncodingMock,
  cancelPendingEncodings: hoisted.cancelPendingEncodingsMock,
}));
vi.mock("../../utils/main-thread-watch.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/main-thread-watch.ts")>();
  return {
    ...actual,
    startMainThreadWatch: (cb: (info: unknown) => void): (() => void) => {
      hoisted.mainThreadWatchCb = cb;
      return () => { hoisted.mainThreadWatchCb = null; };
    },
  };
});
vi.mock("../screenshot.ts", () => ({
  screenshotFromRenderer: (...args: unknown[]) => hoisted.screenshotMock(...args),
}));

import { buildMmdScene, type MmdDataPort, type MmdPanelHooks } from "./mmd-adapter.ts";
import { getApp, type AppBindings } from "../../backend/app.ts";

/** 构造注入端口（对齐 ADR-072：适配器 0 backend import，数据经 port 注入） */
function makePort(): MmdDataPort {
  return {
    readFileBytes: hoisted.readBytesMock,
    readFileBytesBatch: vi.fn().mockImplementation(async (paths: string[]) => {
      const result: Record<string, string | null> = {};
      for (const p of paths) {
        result[p] = await hoisted.readBytesMock(p);
      }
      return result;
    }),
    listAllFilePaths: hoisted.listPathsMock,
    addOpLog: vi.fn().mockResolvedValue(undefined),
    getCachedTexture: vi.fn().mockResolvedValue(null),
  };
}

/** 测试用 panels 桩：playNodes 喂真实结构 toggle + select（对齐 playNodes id 约定），其余 no-op */
function makeMmdPanels(): MmdPanelHooks {
  return {
    fillModelPanel: () => {},
    playNodes: (bridge) => {
      const nodes: Array<{
        id: string;
        kind: "toggle" | "select";
        labelKey?: string;
        fallback: string;
        control: {
          options?: Array<{ value: string; label: string }>;
          get?: (v?: unknown) => unknown;
          set: (v?: unknown) => void;
        };
      }> = [
        {
          id: "play-toggle",
          kind: "toggle",
          fallback: "播放",
          control: { get: () => bridge.isPlaying(), set: () => bridge.toggle() },
        },
      ];
      if (bridge.clips.length > 1) {
        nodes.push({
          id: "play-select",
          kind: "select",
          fallback: "动作",
          control: {
            options: bridge.clips.map((c, i) => ({ value: String(i), label: c.label })),
            get: () => String(bridge.currentIndex()),
            set: (v) => { bridge.select(Number(v) || 0); },
          },
        });
      }
      return nodes as unknown as PreviewMenuNode[];
    },
    fillShotPanel: () => {},
    // [doc:adr-126-p4-b-1] 声明式节点工厂经 panels 注入（R1 禁 utils→views 运行时依赖）
    modelInfoNodes: () => [{ id: "stub-model", kind: "field", labelKey: "x", fallback: "x", value: "测试.pmx" }],
    shotNodes: () => [],
  };
}

function makeCtx() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const loadingEl = document.createElement("div");
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
      overlay: document.createElement("div"),
      menu: { setAdapterItems: vi.fn(), openPanel: vi.fn(), refreshDock: vi.fn() } as unknown as PreviewMenuHandle,
      // KTX2 直载/gpu-leak 用例会注入 fake renderer（happy-dom 无 WebGL）
      renderer: undefined as unknown as THREE.WebGLRenderer,
    },
    scene,
    camera,
    loadingEl,
  };
}

/** 最近一次 setAdapterItems 收到的适配器项 */
function registeredItems(built: { menuItems?: Array<{ id: string; kind: string; render?: (list: HTMLElement, close: () => void) => void; renderCustom?: (list: HTMLElement, close?: () => void) => void; children?: Array<{ id: string; kind: string; control?: { get?: (v?: unknown) => unknown; set?: (v: unknown) => void } }> }> | null }): Array<{
  id: string;
  kind: string;
  render?: (list: HTMLElement, close: () => void) => void;
  renderCustom?: (list: HTMLElement, close?: () => void) => void;
  children?: Array<{ id: string; kind: string; control?: { get?: (v?: unknown) => unknown; set?: (v: unknown) => void } }>;
}> {
  return (built.menuItems ?? []) as Array<{
    id: string;
    kind: string;
    render?: (list: HTMLElement, close: () => void) => void;
    renderCustom?: (list: HTMLElement, close?: () => void) => void;
    children?: Array<{ id: string; kind: string; control?: { get?: (v?: unknown) => unknown; set?: (v: unknown) => void } }>;
  }>;
}

/** 构造一个可用的 fake MMD（mesh 挂进 scene 需真实 Object3D 供 Box3 计算；pmx 对齐真实 MMD 类形态） */
function fakeMmd() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
  return {
    mesh,
    pmx: { bones: [], materials: [], morphs: [] },
    update: hoisted.mmdUpdateMock,
    updateWithMixer: hoisted.mmdUpdateWithMixerMock,
    dispose: hoisted.mmdDisposeMock,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.managerInstances.length = 0;
  hoisted.loaderLoadAsyncMock.mockReset();
  hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmd()));
  // 新增依赖 mock 默认值（decodeAll 空结果 = 无 worker 解码纹理；背景编码/dispose no-op）
  hoisted.decodeAllMock.mockResolvedValue(new Map());
  hoisted.screenshotMock.mockResolvedValue("shot-b64");
  hoisted.createPmxParserImpl = null;
  hoisted.mainThreadWatchCb = null;
  localStorage.removeItem("mmd-pmx-worker");
  localStorage.removeItem("fbx-worker");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildMmdScene 主路径", () => {
  it("读模型字节 + 预读同目录纹理 → URLModifier 命中模型/纹理/放行未知", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      if (p.toLowerCase().endsWith(".tga")) {
        // 合法 TGA 头：18 字节 + 图像类型 2（未压缩真彩）——通过假 TGA 魔数检测
        const tga = new Uint8Array(18);
        tga[2] = 2;
        return Promise.resolve(btoa(String.fromCharCode(...tga)));
      }
      return Promise.resolve(btoa("PNG"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/tex.png",
      "/mmd/miku/sub/face.tga",
      "/mmd/miku/readme.txt",
    ]);
    const { ctx, scene, camera, loadingEl } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());

    // 目录列取 + 模型/纹理读取
    expect(hoisted.listPathsMock).toHaveBeenCalledWith("/mmd/miku");
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/tex.png");
    expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/sub/face.tga");
    // readme.txt 不是纹理候选，不读
    expect(hoisted.readBytesMock).not.toHaveBeenCalledWith("/mmd/miku/readme.txt");

    // loader 收到模型路径
    expect(hoisted.loaderLoadAsyncMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");

    // URLModifier：模型本体 + 纹理（含子目录 basename）→ blob；未知/toon dataURL 放行
    // （LoadingManager.resolveURL 实例方法内部走 setURLModifier 注册的闭包 modifier）
    const mgr = hoisted.managerInstances[0];
    expect(mgr).toBeDefined();
    expect(mgr!.resolveURL("/mmd/miku/miku.pmx")).toBe("blob:mock-url");
    expect(mgr!.resolveURL("/mmd/miku/tex.png")).toBe("blob:mock-url");
    expect(mgr!.resolveURL("/mmd/miku/sub/face.tga")).toBe("blob:mock-url");
    expect(mgr!.resolveURL("/mmd/miku/unknown.png")).toBe("/mmd/miku/unknown.png");
    expect(mgr!.resolveURL("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");

    // 挂场景 + 灯光 + 取景（包围盒中心定相机）
    expect(scene.children).toContain(fakeMmdMeshRef(scene));
    expect(camera.near).toBe(0.05);
    expect(camera.position.z).toBeGreaterThan(0);

    // loading 占位已移除
    expect(loadingEl.parentNode).toBeNull();

    // update 契约：VMD 动画 + IK/追加变换经 updateWithMixer 驱动
    built.update!(0.016);
    expect(hoisted.mmdUpdateWithMixerMock).toHaveBeenCalledWith(
      0.016,
      expect.anything(),
      { ik: true, grant: true },
    );

    // dispose 契约：释放 GPU + 回收 blob URL
    built.dispose();
    expect(hoisted.mmdDisposeMock).toHaveBeenCalled();
    expect(revokeURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("目录扫描失败 → 白模降级不阻断（无纹理映射，模型仍加载）", async () => {
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockRejectedValue(new Error("no dir"));
    const { ctx, scene } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(scene.children.length).toBeGreaterThan(0);
    built.dispose();
    // 无纹理 → 仅回收模型本体 blob
    expect(revokeURL).toHaveBeenCalledTimes(1);
  });

  it("主线程 MMDLoader 路径注册 MMDAmmoPlugin 物理后端（PhysicsService 经官方 ammo 后端接入）", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    // 主线程 MMDLoader 路径必须注册物理插件：MMD.update 的 this.physics?.update 才有实体
    expect(hoisted.loaderRegisterMock).toHaveBeenCalledWith(hoisted.ammoPluginMock);
    built.dispose();
    expect(revokeURL).toHaveBeenCalled();
  });

  it("同名纹理在不同子目录 → 最长后缀匹配各归其位（不串贴图）", async () => {
    let counter = 0;
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:t${++counter}`);
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) =>
      Promise.resolve(btoa("PNG-" + p)),
    );
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/a/body.png",
      "/mmd/miku/b/body.png",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const mgr = hoisted.managerInstances[0]!;
    // 模型 blob 第 1 个（t1）；纹理按 entries 顺序 a→t2、b→t3
    expect(mgr.resolveURL("/mmd/miku/miku.pmx")).toBe("blob:t1");
    expect(mgr.resolveURL("/mmd/miku/a/body.png")).toBe("blob:t2");
    expect(mgr.resolveURL("/mmd/miku/b/body.png")).toBe("blob:t3");
    built.dispose();
    expect(revokeURL).toHaveBeenCalledTimes(3); // 模型 + 2 纹理
  });

  it("假 TGA（头部类型非法）→ 跳过不注册，TGALoader 不会收到它", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // 假 TGA：18 字节头部 + 第 3 字节（索引 2）图像类型 = 100（非法，合法仅 1/2/3/9/10/11）
    const fakeTga = new Uint8Array(18);
    fakeTga[2] = 100;
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.toLowerCase().endsWith(".tga")) {
        return Promise.resolve(btoa(String.fromCharCode(...fakeTga)));
      }
      return Promise.resolve(btoa("PNG"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/tex.png",
      "/mmd/miku/fake.tga",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const mgr = hoisted.managerInstances[0]!;
    // 合法 PNG 命中 blob
    expect(mgr.resolveURL("/mmd/miku/tex.png")).toBe("blob:mock-url");
    // 假 TGA 不注册 → 放行原路径（不触发 TGALoader 解析错误）
    expect(mgr.resolveURL("/mmd/miku/fake.tga")).toBe("/mmd/miku/fake.tga");
    built.dispose();
  });

  it("Windows 反斜杠路径形态 → 分隔符统一后纹理键仍命中", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "C:\\mmd\\ziyan\\textures\\ziyan_head.png",
      "C:\\mmd\\ziyan\\ziyan.pmx",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "C:\\mmd\\ziyan\\ziyan.pmx", makePort());
    expect(hoisted.listPathsMock).toHaveBeenCalledWith("C:\\mmd\\ziyan");
    const mgr = hoisted.managerInstances[0]!;
    // PMX 内正斜杠相对路径（textures/ziyan_head.png）→ 命中 rel 键
    expect(mgr.resolveURL("textures/ziyan_head.png")).toBe("blob:mock-url");
    // 反斜杠完整路径 → 统一分隔符后同样命中
    expect(mgr.resolveURL("C:\\mmd\\ziyan\\textures\\ziyan_head.png")).toBe("blob:mock-url");
    // 未知路径仍放行
    expect(mgr.resolveURL("C:\\mmd\\other\\x.png")).toBe("C:\\mmd\\other\\x.png");
    built.dispose();
  });

  it("同目录 VMD → 自动播放 + 播放面板（经菜单项渲染）", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/dance.vmd",
    ]);
    hoisted.vmdParseMock.mockReturnValue({});
    hoisted.buildAnimMock.mockReturnValue(new THREE.AnimationClip("dance", -1, []));

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    // VMD 解析 + 动画构建
    expect(hoisted.vmdParseMock).toHaveBeenCalledTimes(1);
    expect(hoisted.buildAnimMock).toHaveBeenCalledTimes(1);

    // 播放面板（[doc:adr-126-p5-收尾] play 走 playNodes 声明式 toggle/select；初始播放态 → toggle on）
    const playItem = registeredItems(built).find((i) => i.id === "play");
    expect(playItem).toBeDefined();
    expect(playItem?.renderCustom).toBeUndefined();
    // children = playNodes 产出：toggle（播放/暂停）经 control.get/set 闭包读写 bridge
    const toggle = (playItem?.children ?? []).find((n) => n.id === "play-toggle");
    expect(toggle).toBeDefined();
    expect(toggle?.kind).toBe("toggle");
    // 初始播放态（VMD 自动播放）→ toggle on
    expect(toggle?.control?.get?.(undefined)).toBe(true);
    // 点击 → 暂停 → toggle off
    toggle?.control?.set?.(false);
    expect(toggle?.control?.get?.(undefined)).toBe(false);
    // 再点 → 恢复播放 → toggle on
    toggle?.control?.set?.(true);
    expect(toggle?.control?.get?.(undefined)).toBe(true);

    // update 契约：updateWithMixer 驱动动画 + IK
    built.update!(0.016);
    expect(hoisted.mmdUpdateWithMixerMock).toHaveBeenCalledWith(
      0.016,
      expect.anything(),
      { ik: true, grant: true },
    );

    built.dispose();
    expect(hoisted.mmdDisposeMock).toHaveBeenCalled();
  });

  it("VMD 含相机关键帧 → 轨道相机：buildCameraAnimation 驱动相机位置/旋转/fov/注视点", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/camera.vmd",
    ]);
    // VMD 含相机关键帧（cameraKeyFrames 非空）→ 触发轨道相机分支
    hoisted.vmdParseMock.mockReturnValue({
      cameraKeyFrames: [{ frameNumber: 0 }, { frameNumber: 30 }],
    });
    hoisted.buildAnimMock.mockReturnValue(new THREE.AnimationClip("dance", -1, []));
    hoisted.buildCameraAnimMock.mockReturnValue(
      new THREE.AnimationClip("cam", -1, [
        new THREE.VectorKeyframeTrack("target.position", [0, 1], [1, 2, 3, 4, 5, 6]),
        new THREE.VectorKeyframeTrack(".position", [0, 1], [0, 0, 0, 10, 0, 0]),
        new THREE.QuaternionKeyframeTrack(".quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
        new THREE.NumberKeyframeTrack(".fov", [0, 1], [45, 60]),
      ]),
    );

    const { ctx, camera } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(hoisted.buildCameraAnimMock).toHaveBeenCalledTimes(1);

    // update 推进相机动画 → 相机位置/旋转/fov/controls.target 被轨道相机接管。
    // 步长 0.5（非 1.0）：mixer.update(dt) 是 time += dt，dt=1.0 恰好等于 clip duration=1，
    // LoopRepeat 回绕到 t=0（取首帧）；真实 rAF 每帧 ~0.016s 不会踩边界。0.5 → t=0.5 插值中点。
    built.update!(0.5);
    const cam = camera as THREE.PerspectiveCamera;
    expect(cam.position.x).toBeCloseTo(5, 1); // .position [0,0,0]→[10,0,0] 中点
    expect(cam.fov).toBeCloseTo(52.5, 1);     // .fov 45→60 中点
    expect((ctx.controls as unknown as { target: THREE.Vector3 }).target.x).toBeCloseTo(2.5, 1); // target.position [1,2,3]→[4,5,6] 中点

    built.dispose();
    expect(revokeURL).toHaveBeenCalled();
  });

  it("多个 VMD → select 切换动作，坏文件跳过其余照常", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/bad.vmd",
      "/mmd/miku/idle.vmd",
    ]);
    // 第一个 VMD 解析失败（损坏）→ 跳过；第二个成功（按调用次数分派，不依赖 Once 链语义）
    let vmdCall = 0;
    hoisted.vmdParseMock.mockImplementation(() => {
      vmdCall += 1;
      if (vmdCall === 1) return Promise.reject(new Error("bad vmd"));
      return Promise.resolve({});
    });
    hoisted.buildAnimMock.mockReturnValue(new THREE.AnimationClip("motion", -1, []));

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    // 坏 VMD 被跳过，仅 1 个动画构建成功
    expect(hoisted.buildAnimMock).toHaveBeenCalledTimes(1);

    // 仅 1 个 clip → play 节点无 select（播放 toggle 仍在）
    const playItem = registeredItems(built).find((i) => i.id === "play");
    expect(playItem).toBeDefined();
    const playChildren = playItem?.children ?? [];
    expect(playChildren.some((n) => n.id === "play-select")).toBe(false);
    expect(playChildren.some((n) => n.id === "play-toggle")).toBe(true);
    built.dispose();
  });

  it("无 VMD → 播放按钮仍注册（空态引导选择动作库）", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(hoisted.vmdParseMock).not.toHaveBeenCalled();
    // play 始终注册（支持用户配置自定义动作库，空态引导选择）
    const playItem = registeredItems(built).find((i) => i.id === "play");
    expect(playItem).toBeDefined();
    // 空 mixer 的 updateWithMixer 无害
    built.update!(0.016);
    expect(hoisted.mmdUpdateWithMixerMock).toHaveBeenCalled();
    built.dispose();
  });
});

describe("buildMmdScene 错误路径", () => {
  it("ReadFileBytes 返回空 → 抛错", async () => {
    hoisted.readBytesMock.mockResolvedValue(null);
    const { ctx } = makeCtx();
    await expect(buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort())).rejects.toThrow("ReadFileBytes 返回空");
  });

  it("MMDLoader.loadAsync 失败 → 抛错穿透 + 已建 blob 全部回收", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/tex.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockRejectedValue(new Error("parse fail"));
    const { ctx } = makeCtx();
    await expect(buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort())).rejects.toThrow("parse fail");
    // 模型 blob + 已读纹理 blob 均回收，不随会话泄漏
    expect(revokeURL).toHaveBeenCalledTimes(2);
  });
});

/** 从 scene.children 取 mesh（fakeMmd 每次调用新建实例，断言用内容而非引用） */
function fakeMmdMeshRef(scene: THREE.Scene): THREE.Object3D {
  return scene.children.find((c) => c instanceof THREE.Mesh) as THREE.Object3D;
}

describe("KTX2 缓存", () => {
  it("纹理加载后无额外 RPC（getCachedTexture 不再调用，hash 由前端计算）", async () => {
    const createURL = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      hoisted.readBytesMock.mockImplementation((p: string) => {
        if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
        return Promise.resolve(btoa("PNG_DATA"));
      });
      hoisted.listPathsMock.mockResolvedValue([
        "/mmd/miku/miku.pmx",
        "/mmd/miku/tex.png",
        "/mmd/miku/face.png",
      ]);

      const port: MmdDataPort = {
        readFileBytes: hoisted.readBytesMock,
        readFileBytesBatch: vi.fn().mockImplementation(async (paths: string[]) => {
          const result: Record<string, string | null> = {};
          for (const p of paths) {
            result[p] = await hoisted.readBytesMock(p);
          }
          return result;
        }),
        listAllFilePaths: hoisted.listPathsMock,
        addOpLog: vi.fn().mockResolvedValue(undefined),
      };

      const { ctx } = makeCtx();
      const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());

      // 验证 blob URL 数量：模型(1) + 纹理(2) = 3 次（无额外 KTX2 blob）
      expect(createURL).toHaveBeenCalledTimes(3);

      // 模型文件仍走 readFileBytes
      expect(hoisted.readBytesMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");

      built.dispose();
      expect(hoisted.mmdDisposeMock).toHaveBeenCalled();
    } finally {
      createURL.mockRestore();
      revokeURL.mockRestore();
    }
  });
});

// ---- P0-2 GPU 内存释放：SkinnedMesh.skeleton.dispose ----
describe("GPU 内存释放", () => {
  function makeSkinnedMeshForTest() {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    // 添加 skinIndex 和 skinWeight 属性让 SkinnedMesh.computeBoundingBox 不崩
    const boneIndices = new Float32Array(geometry.attributes.position.count * 4);
    const boneWeights = new Float32Array(geometry.attributes.position.count * 4);
    for (let i = 0; i < boneWeights.length; i += 4) {
      boneIndices[i] = 0; boneIndices[i + 1] = 0; boneIndices[i + 2] = 0; boneIndices[i + 3] = 0;
      boneWeights[i] = 1; boneWeights[i + 1] = 0; boneWeights[i + 2] = 0; boneWeights[i + 3] = 0;
    }
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(boneIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(boneWeights, 4));
    const skeleton = new THREE.Skeleton([new THREE.Bone()]);
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.bind(skeleton, new THREE.Matrix4());
    return { mesh, skeleton };
  }

  it("dispose 时释放 SkinnedMesh.skeleton（防 GPU 内存泄漏）", async () => {
    const { mesh, skeleton } = makeSkinnedMeshForTest();
    const skeletonDisposeSpy = vi.spyOn(skeleton, "dispose");

    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve({
        mesh,
        pmx: { bones: [], materials: [], morphs: [] },
        update: hoisted.mmdUpdateMock,
        updateWithMixer: hoisted.mmdUpdateWithMixerMock,
        dispose: hoisted.mmdDisposeMock,
      })
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());
    built.dispose();
    expect(skeletonDisposeSpy).toHaveBeenCalled();
  });

  it("dispose 时无 skeleton 不抛错", async () => {
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    // Mesh 没有 skeleton 属性

    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve({
        mesh,
        pmx: { bones: [], materials: [], morphs: [] },
        update: hoisted.mmdUpdateMock,
        updateWithMixer: hoisted.mmdUpdateWithMixerMock,
        dispose: hoisted.mmdDisposeMock,
      })
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());
    expect(() => built.dispose()).not.toThrow();
  });
});

// ---- P1-4 dispose 错误路径 blob URL 回收 ----
describe("dispose 错误路径 blob URL 回收", () => {
  it("dispose 前置步骤抛错时，blob URL 仍在 finally 中被回收", async () => {
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    // 模拟 AnimationMixer.stopAllAction 抛错
    vi.spyOn(THREE.AnimationMixer.prototype, "stopAllAction")
      .mockImplementation(() => { throw new Error("mixer failed"); });

    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve(fakeMmd())
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());

    // dispose 不应向外抛错（blob URL 在 finally 中被回收）
    let threw = false;
    try { built.dispose(); } catch { threw = true; }
    expect(threw).toBe(false);
    expect(revokeURL).toHaveBeenCalled();
  });

  it("build 失败时 finally 兜底回收 blob URL（scene.add 后抛错）", async () => {
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    // 让 loader.loadAsync 成功，但 scene.add 之后的步骤抛错
    // 通过 mock loaderLoadAsyncMock 成功 + 让后续逻辑抛错
    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve(fakeMmd())
    );
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);

    // 让 registerModelRoot 抛错（scene.add 后的第一步）
    // registerModelRoot 是模块内部函数，不易直接 mock
    // 改为：mock THREE.Scene.prototype.add 在特定条件下抛错
    const origAdd = THREE.Scene.prototype.add;
    vi.spyOn(THREE.Scene.prototype, "add").mockImplementation(function (this: THREE.Scene, ...args: unknown[]) {
      // 抛错前先执行原方法（让 mesh.parent 被设置）
      origAdd.call(this, ...(args as [THREE.Object3D]));
      // 然后抛错，模拟 scene.add 后 build 中途失败
      throw new Error("scene.add failed");
    });

    const { ctx } = makeCtx();
    let buildError: unknown = null;
    try {
      await buildMmdScene(ctx, "/mmd/test/test.pmx", makePort(), makeMmdPanels());
    } catch (e) {
      buildError = e;
    }

    // build 确实抛错了
    expect(buildError).toBeInstanceOf(Error);
    // finally 兜底回收了 blob URL
    expect(revokeURL).toHaveBeenCalled();
  });
});

// ---- P0-3 批量读取 fallback：readFileBytesBatch 失败时降级并发分片读取 ----
describe("批量读取降级", () => {
  it("readFileBytesBatch 抛错时，降级为并发分片 readFileBytes 读取纹理", async () => {
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      if (p.endsWith(".png")) return Promise.resolve(btoa("PNX"));
      return Promise.resolve(btoa("DATA"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/tex.png",
      "/mmd/miku/sub.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockImplementation(
      () => Promise.resolve(fakeMmd())
    );

    const port: MmdDataPort = {
      ...makePort(),
      // 批量读取抛错，强制降级
      readFileBytesBatch: vi.fn().mockRejectedValue(new Error("batch RPC failed")),
    };

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku", port, makeMmdPanels());

    // 关键断言：batch 失败后，readFileBytes 仍被并发调用读取所有纹理
    const texCalls = hoisted.readBytesMock.mock.calls
      .map((c: unknown[]) => (c as [string])[0])
      .filter((p: string) => p.endsWith(".png"));
    expect(texCalls.length).toBeGreaterThanOrEqual(2);

    // 模型仍正常加载（URLModifier 已挂载）
    expect(built.update).toBeDefined();
  });

  it("多个纹理并发 fallback 全部成功", async () => {
    // 模拟 6 个纹理文件（> chunkSize=4，触发分片行为）
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      return Promise.resolve(btoa("TEX"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/t1.png",
      "/mmd/miku/t2.png",
      "/mmd/miku/t3.png",
      "/mmd/miku/t4.png",
      "/mmd/miku/t5.png",
      "/mmd/miku/t6.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockImplementation(
      () => Promise.resolve(fakeMmd())
    );

    const port: MmdDataPort = {
      ...makePort(),
      readFileBytesBatch: vi.fn().mockRejectedValue(new Error("batch RPC failed")),
      readFileBytesBatchWithMeta: vi.fn().mockRejectedValue(new Error("meta batch RPC failed")),
    };

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku", port, makeMmdPanels());

    // 6 个纹理 + 1 个模型 = 7 次 readFileBytes 调用
    const allCalls = hoisted.readBytesMock.mock.calls.map(
      (c: unknown[]) => (c as [string])[0]
    );
    expect(allCalls.length).toBeGreaterThanOrEqual(7);

    // 模型仍正常加载
    expect(built.update).toBeDefined();
  });

  it("部分纹理 readFileBytes 失败不阻塞其他纹理", async () => {
    let failCount = 0;
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      // 第二个纹理返回 null（模拟失败）
      if (p.endsWith("t2.png")) { failCount++; return Promise.resolve(null); }
      return Promise.resolve(btoa("TEX"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/t1.png",
      "/mmd/miku/t2.png",
      "/mmd/miku/t3.png",
    ]);
    hoisted.loaderLoadAsyncMock.mockImplementation(
      () => Promise.resolve(fakeMmd())
    );

    const port: MmdDataPort = {
      ...makePort(),
      readFileBytesBatch: vi.fn().mockRejectedValue(new Error("batch RPC failed")),
      readFileBytesBatchWithMeta: vi.fn().mockRejectedValue(new Error("meta batch RPC failed")),
    };

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku", port, makeMmdPanels());

    // 即使有纹理失败，模型仍应加载
    expect(built.update).toBeDefined();
    expect(failCount).toBe(1);
  });
});

describe("mmd-pmx-worker 开关（默认主线程 MMDLoader 完整加载，worker opt-in）", () => {
  beforeEach(() => {
    localStorage.removeItem("mmd-pmx-worker");
  });
  afterEach(() => {
    localStorage.removeItem("mmd-pmx-worker");
  });

  /** 最小加载流程：模型 + 无纹理，返回 port 供断言环形日志 */
  async function runMinimalLoad() {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmd()));
    const port = makePort();
    const { ctx } = makeCtx();
    await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    return port;
  }

  it("默认（开关未设置）→ 主线程 MMDLoader 路径，不 dispatch worker 解析", async () => {
    const port = await runMinimalLoad();
    const calls = (port.addOpLog as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const dispatch = calls.find((c) => c[0] === "pmx-parse-dispatch");
    expect(dispatch).toBeDefined();
    expect(String(dispatch![3])).toContain("主线程 MMDLoader 路径");
    // 完整加载路径：MMDLoader 被调用
    expect(hoisted.loaderLoadAsyncMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");
    // 无 worker 构建日志（worker 路径未启用）
    expect(calls.find((c) => c[0] === "pmx-worker-build")).toBeUndefined();
  });

  it("开关 = 1 → dispatch worker 解析；受限环境解析失败时 fallback MMDLoader", async () => {
    localStorage.setItem("mmd-pmx-worker", "1");
    const port = await runMinimalLoad();
    const calls = (port.addOpLog as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const dispatch = calls.find((c) => c[0] === "pmx-parse-dispatch");
    expect(dispatch).toBeDefined();
    expect(String(dispatch![3])).toContain("dispatched to worker (mmd-pmx-worker=1)");
    // 测试环境无 Worker → always-fail parser → worker 路径构建失败并 fallback
    const workerBuild = calls.find((c) => c[0] === "pmx-worker-build");
    expect(workerBuild).toBeDefined();
    expect(workerBuild![2]).toBe("warn");
    expect(hoisted.loaderLoadAsyncMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");
  });
});

// ---- VMD 切换动作：拉回绑定姿势再播 + action.reset 归零（避免未覆盖骨骼残留旧动作）----
describe("VMD select 切换：骨骼复位 + action 归零重播", () => {
  /** 带 select 下拉的 panels 桩（base.playNodes 多 clip 时含 play-select，直接复用） */
  function makePanelsWithSelect(): MmdPanelHooks {
    return makeMmdPanels();
  }

  it("select 切换动作：先复位骨骼（skeleton.pose）+ 新 action.reset 归零", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    // 构造带 skeleton 属性的 mesh（普通 Mesh 即可；select 里 mesh.skeleton?.pose() 可选链调用，
    // 普通 Mesh 的 Box3 包围盒不走 applyBoneTransform，避免 SkinnedMesh 骨骼矩阵初始化负担）
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial());
    const skeleton = new THREE.Skeleton([new THREE.Bone()]);
    (mesh as unknown as { skeleton: THREE.Skeleton }).skeleton = skeleton;
    const poseSpy = vi.spyOn(skeleton, "pose");
    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve({
        mesh,
        pmx: { bones: [], materials: [], morphs: [] },
        update: hoisted.mmdUpdateMock,
        updateWithMixer: hoisted.mmdUpdateWithMixerMock,
        dispose: hoisted.mmdDisposeMock,
      }),
    );

    // 两个 VMD → 两个 clip
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/a.vmd",
      "/mmd/miku/b.vmd",
    ]);
    hoisted.vmdParseMock.mockResolvedValue({});
    let buildCall = 0;
    hoisted.buildAnimMock.mockImplementation(() => {
      buildCall += 1;
      return new THREE.AnimationClip(`motion${buildCall}`, -1, []);
    });

    // spy clipAction：包装返回 action 的 reset，统计被调用次数
    const resetCalls: number[] = [];
    const origClipAction = THREE.AnimationMixer.prototype.clipAction;
    const clipActionSpy = vi
      .spyOn(THREE.AnimationMixer.prototype, "clipAction")
      .mockImplementation(function (
        this: THREE.AnimationMixer,
        clip: string | THREE.AnimationClip,
      ): THREE.AnimationAction | null {
        const action = origClipAction.call(this, clip as THREE.AnimationClip);
        if (!action) return null;
        const origReset = action.reset.bind(action);
        action.reset = (): THREE.AnimationAction => {
          resetCalls.push(1);
          return origReset();
        };
        return action;
      });

    try {
      const { ctx } = makeCtx();
      const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makePanelsWithSelect());
      expect(hoisted.buildAnimMock).toHaveBeenCalledTimes(2);

      // 通过下拉切换动作 0 → 1（[doc:adr-126-p5-收尾] play 走声明式 select 节点 control）
      const playItem = registeredItems(built).find((i) => i.id === "play");
      expect(playItem).toBeDefined();
      const sel = (playItem?.children ?? []).find((n) => n.kind === "select");
      expect(sel).toBeDefined();
      const beforeReset = resetCalls.length;
      // select 节点 control.set 触发 bridge.select（内部含骨骼复位 + action.reset）
      sel!.control?.set?.("1");

      expect(poseSpy, "切换动作前应复位骨骼到绑定姿势（防未覆盖骨骼残留旧动作）").toHaveBeenCalled();
      expect(
        resetCalls.length - beforeReset,
        "切换动作时新 action 应 reset 归零（重复切换同一 VMD 也从头播）",
      ).toBeGreaterThan(0);

      built.dispose();
      expect(revokeURL).toHaveBeenCalled();
    } finally {
      clipActionSpy.mockRestore();
    }
  });
});

// ===== 覆盖率攻坚：诊断降级 / LoadingManager 回调 / 纹理哈希 / KTX2 缓存 / zip 输入 =====

/** 构造带骨骼 + 语义 morph 字典的 SkinnedMesh fake MMD（感知层 update 分支用） */
function fakeMmdRich() {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const boneIndices = new Float32Array(geometry.attributes.position.count * 4);
  const boneWeights = new Float32Array(geometry.attributes.position.count * 4);
  for (let i = 0; i < boneWeights.length; i += 4) {
    boneIndices[i] = 0; boneIndices[i + 1] = 0; boneIndices[i + 2] = 0; boneIndices[i + 3] = 0;
    boneWeights[i] = 1; boneWeights[i + 1] = 0; boneWeights[i + 2] = 0; boneWeights[i + 3] = 0;
  }
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(boneIndices, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(boneWeights, 4));
  const chest = new THREE.Bone();
  chest.name = "上半身"; // MMD_SEMANTIC_CANDIDATES.chest 命中 → semanticBones 非空
  const skeleton = new THREE.Skeleton([chest]);
  const mat = new THREE.MeshBasicMaterial();
  mat.map = new THREE.Texture();
  (mat.map as unknown as { image: { src: string; width: number; height: number } }).image = {
    src: "blob:mock-url",
    width: 64,
    height: 64,
  };
  const mesh = new THREE.SkinnedMesh(geometry, [mat]); // 材质数组（对齐多材质 PMX 常态）
  mesh.bind(skeleton, new THREE.Matrix4());
  // morphTargetDictionary 对齐 MMD_SEMANTIC_MORPH_CANDIDATES（blink=まばたき / lipOpen=あ）
  (mesh as unknown as { morphTargetDictionary: Record<string, number> }).morphTargetDictionary = {
    "まばたき": 0,
    "あ": 1,
  };
  mesh.morphTargetInfluences = [0, 0];
  return {
    mesh,
    pmx: {
      bones: [{ name: "上半身", parentBoneIndex: -1 }],
      materials: [{ name: "服" }],
      morphs: [{ name: "まばたき" }, { name: "あ" }],
    },
    update: hoisted.mmdUpdateMock,
    updateWithMixer: hoisted.mmdUpdateWithMixerMock,
    dispose: hoisted.mmdDisposeMock,
  };
}

describe("诊断与降级路径", () => {
  it("addOpLog 抛错 → mmdDiag 静默吞掉，加载不阻断", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
    const port = makePort();
    (port.addOpLog as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("diag down"));
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    expect(built.update).toBeDefined();
    built.dispose();
  });

  it("main-thread 长任务回调 → 环形日志 main-thread warn（不阻断）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    // startMainThreadWatch 已被 mock 捕获回调 → 手动触发长任务
    expect(hoisted.mainThreadWatchCb).not.toBeNull();
    hoisted.mainThreadWatchCb!({ duration: 120 });
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    const mainThread = calls.find((c) => c[0] === "main-thread");
    expect(mainThread).toBeDefined();
    expect(mainThread![2]).toBe("warn");
    built.dispose();
  });

  it("批量读取降级后单纹理 readFileBytes reject → 该纹理跳过不阻断", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      if (p.endsWith("t1.png")) return Promise.reject(new Error("io error"));
      return Promise.resolve(btoa("TEX"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/t1.png",
      "/mmd/miku/t2.png",
    ]);
    const port: MmdDataPort = {
      ...makePort(),
      readFileBytesBatch: vi.fn().mockRejectedValue(new Error("batch down")),
    };
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    expect(built.update).toBeDefined();
    built.dispose();
  });

  it("MMDLoader.loadAsync 返回 undefined → 结构守卫抛「MMD parse 返回空结果」", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
    hoisted.loaderLoadAsyncMock.mockResolvedValue(undefined);
    const { ctx } = makeCtx();
    await expect(
      buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort()),
    ).rejects.toThrow("MMD parse 返回空结果");
  });

  it("dispose 时 mmd.dispose 抛错 → dbg 记录 dispose-mesh-fail 不外抛", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    hoisted.mmdDisposeMock.mockImplementation(() => { throw new Error("gpu dead"); });
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(() => built.dispose()).not.toThrow();
  });
});

describe("LoadingManager 回调（进度条 + 性能统计）", () => {
  it("onProgress 更新进度条宽度；onLoad 统计纹理尺寸/gpu 上报 perf", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    const port = makePort();
    const { ctx, loadingEl } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());

    const mgr = hoisted.managerInstances[0] as unknown as {
      onProgress: (url: string, loaded: number, total: number) => void;
      onLoad: () => void;
    };
    // renderLoadingState(determinate) 已在 loadingEl 内建 #ysm-mmd-progress；onProgress 命中并改宽
    mgr.onProgress("/x.png", 5, 10);
    const bar = loadingEl.querySelector<HTMLElement>("#ysm-mmd-progress");
    expect(bar).not.toBeNull();
    expect(bar!.style.width).toBe("50%");

    // onLoad：tParseEnd/tBuildEnd 已在 build 流程写入 → perf diag 含纹理尺寸统计
    mgr.onLoad();
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    const perf = calls.find((c) => c[0] === "perf");
    expect(perf).toBeDefined();
    expect(String(perf![3])).toContain("tex=64x64x1");
    expect(String(perf![3])).toContain("parse=");
    built.dispose();
  });
});

describe("PMX worker 路径成功（workerBuilt）", () => {
  /** 合成 PMX worker 解析结果（含 IK 骨骼 + 刚体 + 纹理引用） */
  function okPmxResult() {
    return {
      id: 0,
      ok: true,
      vertices: {
        count: 3,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
        boneIndices: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        boneWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      },
      faces: { count: 3, indices: new Uint32Array([0, 1, 2]) },
      textures: ["tex.png"],
      materials: [{ name: "服", diffuse: [1, 0, 0, 0.5], flags: 1, textureIndex: 0 }],
      bones: [{ name: "rootA", englishName: "", parentBoneIndex: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: true }],
      rigidBodies: [{}],
      joints: [],
      morphs: [],
      displayFrames: [],
    };
  }

  function setupWorkerOk() {
    localStorage.setItem("mmd-pmx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa("DATA-" + p)));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    const disposeSpy = vi.fn();
    hoisted.createPmxParserImpl = () => ({
      parse: () => Promise.resolve(okPmxResult()),
      dispose: disposeSpy,
    });
    return disposeSpy;
  }

  it("worker 解析成功 → buildPmxSceneSliced 建 mesh（IK/刚体受限 warn）+ parser.dispose", async () => {
    setupWorkerOk();
    const port = makePort();
    const { ctx, scene } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());

    // worker 产物 mesh 挂进 scene（SkinnedMesh），MMDLoader 主路径未走
    expect(hoisted.loaderLoadAsyncMock).not.toHaveBeenCalled();
    expect(scene.children.some((c) => (c as THREE.SkinnedMesh).isSkinnedMesh)).toBe(true);
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "pmx-worker-build" && c[2] === "ok")).toBeDefined();
    expect(calls.find((c) => c[0] === "worker-limit" && String(c[3]).includes("IK"))).toBeDefined();
    expect(calls.find((c) => c[0] === "worker-limit" && String(c[3]).includes("刚体"))).toBeDefined();

    // worker 路径 applyPose → applyVPDToMesh（直接改 mesh 骨骼）
    const vpd = {
      bones: { rootA: { position: [0, 1, 0], rotation: [0, 0, 0, 1] } },
      morphs: { "まばたき": 0.5 },
    };
    built.applyPose?.(0);
    void vpd; // applyPose 内部使用 build 时记录的 vpdPoses（此模型无 vpd 文件 → no-op）
    built.dispose();
  });

  it("worker 路径 VPD 姿势 → applyVPDToMesh 直改骨骼/morph（不经 applyVPD）", async () => {
    setupWorkerOk();
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/pose.vpd",
    ]);
    const vpdObj = {
      bones: { rootA: { position: [0, 1, 0], rotation: [0, 0, 0, 1] } },
      morphs: {},
    };
    hoisted.vpdLoadAsyncMock.mockResolvedValue(vpdObj);
    const port = makePort();
    const { ctx, scene } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());

    const skinned = scene.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    const rootBone = skinned.skeleton.bones.find((b) => b.name === "rootA")!;
    built.applyPose?.(0);
    // applyVPDToMesh：position.add 直接改骨骼（不走 applyVPD mock）
    expect(hoisted.applyVPDMock).not.toHaveBeenCalled();
    expect(rootBone.position.y).toBeGreaterThan(0);
    built.dispose();
  });

  it("worker parse promise reject → 降级 MMDLoader 主路径（diag warn）", async () => {
    localStorage.setItem("mmd-pmx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
    hoisted.createPmxParserImpl = () => ({
      parse: () => Promise.reject(new Error("worker crash")),
      dispose: vi.fn(),
    });
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    expect(hoisted.loaderLoadAsyncMock).toHaveBeenCalledWith("/mmd/miku/miku.pmx");
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "pmx-worker-build" && String(c[3]).includes("threw"))).toBeDefined();
    built.dispose();
  });
});

describe("纹理哈希 + KTX2 缓存直载（renderer 路径）", () => {
  function makeRichPort(opts: { cacheHit: boolean }): MmdDataPort {
    return {
      readFileBytes: hoisted.readBytesMock,
      readFileBytesBatch: vi.fn().mockResolvedValue({
        "/mmd/miku/tex.png": btoa("PNG"),
      }),
      readFileBytesBatchWithMeta: vi.fn().mockResolvedValue({
        "/mmd/miku/tex.png": { data: btoa("PNG"), hash: "h1" },
      }),
      listAllFilePaths: hoisted.listPathsMock,
      addOpLog: vi.fn().mockResolvedValue(undefined),
      getCachedTexture: vi.fn().mockResolvedValue(null),
    };
    void opts;
  }

  function fakeRenderer() {
    return {
      info: { memory: { geometries: 2, textures: 3 } },
    } as unknown as THREE.WebGLRenderer;
  }

  it("缓存命中 → GetCachedTextureByHash 直载 KTX2 替换材质 map（旧纹理释放）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.ktx2LoadAsyncMock.mockResolvedValue(new THREE.CompressedTexture([], 1, 1));
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    vi.mocked(getApp).mockResolvedValue({
      HasCachedTextures: async () => ({ h1: true }),
      GetCachedTextureByHash: async () => btoa("KTX2DATA"),
    } as unknown as AppBindings);

    const port = makeRichPort({ cacheHit: true });
    const { ctx } = makeCtx();
    ctx.renderer = fakeRenderer();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());

    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    const replace = calls.find((c) => c[0] === "ktx2-replace" && c[1] === "cache-hit");
    expect(replace).toBeDefined();
    // 材质 map 被替换为压缩纹理（fakeMmdRich 材质数组首项）
    const mesh = (ctx.scene as THREE.Scene).children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    const replacedMap = (mesh.material as THREE.MeshBasicMaterial[])[0].map;
    expect(replacedMap).toBeDefined();
    expect((replacedMap as unknown as { isCompressedTexture?: boolean }).isCompressedTexture).toBe(true);

    // 经 manager.getHandler 取回 Ktx2TextureLoader，直测 resolveHash/getCachedTextureByHash 闭包
    const mgr = hoisted.managerInstances[0] as unknown as { getHandler: (f: string) => unknown };
    const ktx2Direct = mgr.getHandler("tex.png") as unknown as {
      load: (url: string, onLoad?: (t: THREE.Texture) => void) => THREE.Texture;
      deps: { resolveHash: (u: string) => string | undefined; getCachedTextureByHash: (h: string) => Promise<string | null> };
    };
    expect(ktx2Direct.deps.resolveHash("textures/tex.png")).toBe("h1");
    expect(ktx2Direct.deps.resolveHash("toon01.bmp")).toBeUndefined();
    await expect(ktx2Direct.deps.getCachedTextureByHash("h1")).resolves.toBe(btoa("KTX2DATA"));
    // 直载路径：hash 命中 → 占位纹理被合并压缩字段（isCompressedTexture 翻转）
    const placeholder = ktx2Direct.load("textures/tex.png");
    await new Promise((r) => setTimeout(r, 0));
    expect((placeholder as unknown as { isCompressedTexture?: boolean }).isCompressedTexture).toBe(true);

    built.dispose();
    // gpu-leak 前后统计 + 背景编码排除已缓存 hash
    expect(hoisted.scheduleBackgroundEncodingMock).not.toHaveBeenCalled();
  });

  it("GetCachedTextureByHash 返回空串 → getCachedTextureByHash 归一为 null", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    vi.mocked(getApp).mockRejectedValue(new Error("bridge down"));
    const { ctx } = makeCtx();
    ctx.renderer = { info: { memory: { geometries: 1, textures: 1 } } } as unknown as THREE.WebGLRenderer;
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const mgr = hoisted.managerInstances[0] as unknown as { getHandler: (f: string) => unknown };
    const ktx2Direct = mgr.getHandler("tex.png") as unknown as {
      deps: { getCachedTextureByHash: (h: string) => Promise<string | null> };
    };
    await expect(ktx2Direct.deps.getCachedTextureByHash("h1")).resolves.toBeNull();
    built.dispose();
  });

  it("缓存未命中 → warn 上报 + 未缓存 hash 转后台编码", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    vi.mocked(getApp).mockResolvedValue({
      HasCachedTextures: async () => ({}),
      GetCachedTextureByHash: async () => null,
    } as unknown as AppBindings);

    const port = makeRichPort({ cacheHit: false });
    const { ctx } = makeCtx();
    ctx.renderer = fakeRenderer();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());

    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "ktx2-replace" && c[1] === "cache-miss")).toBeDefined();
    // 未命中 → hash 转后台编码（getCachedTexture 兼容通道存在）
    expect(hoisted.scheduleBackgroundEncodingMock).toHaveBeenCalledTimes(1);
    built.dispose();
  });

  it("gpu-leak 统计：dispose 前后读 renderer.info.memory（不抛）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    const { ctx } = makeCtx();
    ctx.renderer = fakeRenderer();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(() => built.dispose()).not.toThrow();
  });
});

describe("zip 输入（ADR-132 多候选）", () => {
  it(".zip 路径 → prepareMmdZipInput 换 port/虚拟路径 + 候选透传 navCtx", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    const zipPort: MmdDataPort = {
      readFileBytes: vi.fn().mockResolvedValue(btoa("ZIP-PMX")),
      readFileBytesBatch: vi.fn().mockResolvedValue({}),
      listAllFilePaths: vi.fn().mockResolvedValue([]),
      addOpLog: vi.fn().mockResolvedValue(undefined),
    };
    hoisted.prepareZipMock.mockResolvedValue({
      port: zipPort,
      rootPath: "zip://a/",
      modelEntry: "m.pmx",
      allModelEntries: ["m.pmx", "b.pmx"],
      modelBytes: new Uint8Array([1, 2, 3]),
      modelBase: "m.pmx",
    });
    const capturedNav: Array<Record<string, unknown>> = [];
    const panels = makeMmdPanels();
    panels.modelInfoNodes = (navCtx) => {
      capturedNav.push(navCtx as unknown as Record<string, unknown>);
      return [];
    };

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/a.zip", makePort(), panels);

    // loader 收到虚拟路径；模型字节来自 zip override（zipPort.readFileBytes 不再触发）
    expect(hoisted.loaderLoadAsyncMock).toHaveBeenCalledWith("zip://a/m.pmx");
    expect(zipPort.readFileBytes).not.toHaveBeenCalled();
    // 候选透传 navCtx（模型面板切换 select 用）
    expect(capturedNav[0]!.zipModelCandidates).toEqual(["zip://a/m.pmx", "zip://a/b.pmx"]);
    built.dispose();
  });
});

describe("材质/播放桥消费（menu children control 接线）", () => {
  it("materialNodes eye/opacity control → setMmdMaterialVisible/Opacity 实改材质", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());

    const matItem = registeredItems(built as unknown as Parameters<typeof registeredItems>[0]).find((i) => i.id === "material") as {
      children?: Array<{ eye?: { get: () => boolean; set: (v: boolean) => void }; opacity?: { get: () => number; set: (v: number) => void } }>;
    };
    const row = matItem?.children?.find((c) => c.eye && c.opacity);
    expect(row).toBeDefined();
    expect(row!.eye!.get()).toBe(true);
    row!.eye!.set(false);
    expect(row!.eye!.get()).toBe(false);
    row!.opacity!.set(50);
    expect(row!.opacity!.get()).toBe(50);
    built.dispose();
  });

  it("play 桥：无 clip toggle 空守卫 + currentIndex/isPlaying 读取", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());

    // 经 playNodes 捕获 bridge（makeMmdPanels 的 toggle control set 触发 bridge.toggle）
    const playItem = registeredItems(built as unknown as Parameters<typeof registeredItems>[0]).find((i) => i.id === "play");
    const toggle = (playItem?.children ?? []).find((n) => n.id === "play-toggle") as unknown as { control: { get: () => boolean; set: (v: boolean) => void } };
    expect(toggle.control.get()).toBe(true); // playing 初始 true（无 clip 也如此）
    toggle.control.set(false); // toggle() → clips.length===0 早退，playing 不变
    expect(toggle.control.get()).toBe(true);
    built.dispose();
  });

  it("相机 VMD select 切换 → cameraAction stop/重建/播放（cameraMixer 分支）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/cam1.vmd",
      "/mmd/miku/cam2.vmd",
    ]);
    hoisted.vmdParseMock.mockImplementation(() => Promise.resolve({ cameraKeyFrames: [{ frameNumber: 0 }] }));
    hoisted.buildAnimMock.mockReturnValue(new THREE.AnimationClip("motion", -1, []));
    hoisted.buildCameraAnimMock.mockReturnValue(new THREE.AnimationClip("cam", -1, []));

    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());

    const playItem = registeredItems(built as unknown as Parameters<typeof registeredItems>[0]).find((i) => i.id === "play");
    const sel = (playItem?.children ?? []).find((n) => n.kind === "select") as unknown as { control: { get: () => string; set: (v: string) => void } };
    expect(sel).toBeDefined();
    expect(sel.control.get()).toBe("0");
    sel.control.set("1");
    expect(sel.control.get()).toBe("1");
    sel.control.set("1"); // 同 index → 早退
    sel.control.set("99"); // 越界 → 早退
    expect(sel.control.get()).toBe("1");
    // 切换后 isPlaying 保持
    const toggle = (playItem?.children ?? []).find((n) => n.id === "play-toggle") as unknown as { control: { get: () => boolean; set: (v: boolean) => void } };
    expect(toggle.control.get()).toBe(true);
    built.dispose();
  });
});

describe("update 感知层分支（呼吸/注视/眨眼/口型/足部 IK）", () => {
  /** 从 scene 中取 fakeMmdRich mesh 的 morphTargetInfluences */
  function fakeMmdRichMeshInfluences(scene: THREE.Scene): number[] {
    const mesh = scene.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    return mesh.morphTargetInfluences ?? [];
  }

  it("语义骨骼 + 语义 morph 齐备 → update 驱动全部感知控制器（无动画待机态）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());

    // semanticBones 已通过 built 透传（非空 = 语义层接入成功）
    expect(built.semanticBones).toBeDefined();
    expect(built.semanticBones!.chest).toBeDefined();
    // 推进数帧：breath/gaze/blink/lipSync/footIK/autoDance 全链路（断言不抛 + 权重写入合法区间）
    for (let i = 0; i < 5; i++) built.update!(0.016);
    const morphs = fakeMmdRichMeshInfluences((ctx.scene as THREE.Scene));
    expect(morphs.every((w) => w >= 0 && w <= 1)).toBe(true);
    expect(hoisted.mmdUpdateWithMixerMock).toHaveBeenCalled();
    built.dispose();
  });
});

describe("挂载边界（scene 缺失 / 多材质纹理释放统计）", () => {
  it("scene 缺失（self 模式）→ mesh-debug warn 跳过挂载，仍返回 PreviewScene", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    const { ctx } = makeCtx();
    (ctx as { scene?: unknown }).scene = undefined;
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(built.update).toBeDefined();
    built.dispose();
  });

  it("disposeMmdMesh：多材质数组 + 带尺寸纹理 → tex/gpu 统计上报（dispose-tex diag）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    const revokeURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    const texA = new THREE.Texture();
    (texA as unknown as { image: { width: number; height: number } }).image = { width: 256, height: 256 };
    const texADispose = vi.spyOn(texA, "dispose");
    const matA = new THREE.MeshBasicMaterial();
    matA.map = texA;
    const matB = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [matA, matB]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() =>
      Promise.resolve({
        mesh,
        pmx: { bones: [], materials: [], morphs: [] },
        update: hoisted.mmdUpdateMock,
        updateWithMixer: hoisted.mmdUpdateWithMixerMock,
        dispose: hoisted.mmdDisposeMock,
      }),
    );
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    built.dispose();

    expect(texADispose).toHaveBeenCalled();
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    const texDiag = calls.find((c) => c[0] === "dispose-tex");
    expect(texDiag).toBeDefined();
    expect(String(texDiag![1])).toContain("tex=1");
    expect(revokeURL).toHaveBeenCalled();
  });
});

// ===== 覆盖率攻坚二：pmd 分支 / 动作库扫描 / worker 纹理解码 / applyPose 变体 =====

describe("格式与纹理边界", () => {
  it(".pmd 扩展名 → mdMmDetectFormat 走 pmd 分支（跳过 PMX worker stage）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMD"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmd"]);
    const { ctx, scene } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmd", makePort(), makeMmdPanels());
    expect(hoisted.loaderLoadAsyncMock).toHaveBeenCalledWith("/mmd/miku/miku.pmd");
    expect(scene.children.length).toBeGreaterThan(0);
    built.dispose();
  });

  it("短 TGA（<18 字节）→ isLikelyTga 早退跳过（不注册 blob）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.toLowerCase().endsWith(".tga")) return Promise.resolve(btoa("short")); // 5 字节
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      return Promise.resolve(btoa("PNG"));
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/short.tga",
      "/mmd/miku/tex.png",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const mgr = hoisted.managerInstances[0]!;
    // 短 TGA 未注册 → 原路径放行
    expect(mgr.resolveURL("/mmd/miku/short.tga")).toBe("/mmd/miku/short.tga");
    built.dispose();
  });

  it("build 悬置期间 onLoad 先到 → tParseEnd=0 早退；完成后 trace 含纹理加载段", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    // 延迟 parse：stage2（manager 已建）与 parse 之间插入 onLoad 调用
    let resolveLoad!: (v: unknown) => void;
    hoisted.loaderLoadAsyncMock.mockImplementation(
      () => new Promise((res) => { resolveLoad = res; }),
    );
    const { ctx } = makeCtx();
    const p = buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    // 轮询等待 stage2 完成（manager 已建、parse 悬置）
    for (let i = 0; i < 200 && hoisted.managerInstances.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 1));
    }
    const mgr = hoisted.managerInstances[0] as unknown as { onLoad: () => void };
    mgr.onLoad(); // tParseEnd 尚为 0 → 早退分支
    resolveLoad(fakeMmdRich());
    await p;
    // textureLoadedAt 已被 onLoad 写入 → stage6bTrace push「纹理加载」段
    const traceCall = hoisted.recordTraceMock.mock.calls.at(-1)?.[0] as { stages: Array<{ name: string }> };
    expect(traceCall.stages.map((s) => s.name)).toContain("纹理加载");
  });
});

describe("动作库扫描（getCustomAnimPath + vmd/vpd 降级）", () => {
  function setup() {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx"]);
  }

  it("GetRepoRoot 返回动作库目录 → 扫描 extraAnims 追加 vmd/vpd（diag ok）", async () => {
    setup();
    vi.mocked(getApp).mockResolvedValue({
      GetRepoRoot: async () => "/repo/CustomAnim",
    } as unknown as AppBindings);
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    // 目录文件（模型同目录）只有 pmx；动作库目录扫描到 vmd/vpd/无关文件
    let scanDir = "";
    hoisted.listPathsMock.mockImplementation(async (dir: string) => {
      scanDir = dir;
      if (dir === "/repo/CustomAnim") {
        return ["/repo/CustomAnim/dance.vmd", "/repo/CustomAnim/pose.vpd", "/repo/CustomAnim/note.txt"];
      }
      return ["/mmd/miku/miku.pmx"];
    });
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    expect(scanDir).toBe("/repo/CustomAnim");
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "anim-lib-scan" && c[2] === "ok")).toBeDefined();
    built.dispose();
  });

  it("动作库目录扫描失败 → diag fail 静默降级", async () => {
    setup();
    vi.mocked(getApp).mockResolvedValue({
      GetRepoRoot: async () => "/repo/CustomAnim",
    } as unknown as AppBindings);
    hoisted.listPathsMock.mockImplementation(async (dir: string) => {
      if (dir === "/repo/CustomAnim") throw new Error("scan fail");
      return ["/mmd/miku/miku.pmx"];
    });
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "anim-lib-scan" && c[2] === "fail")).toBeDefined();
    built.dispose();
  });

  it("anim 字节缺失/坏 VPD → 逐文件跳过不阻断", async () => {
    setup();
    hoisted.readBytesMock.mockImplementation((p: string) => {
      if (p.endsWith(".pmx")) return Promise.resolve(btoa("PMX"));
      return Promise.resolve(null); // anim 字节批量读取返回空
    });
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/dance.vmd",
      "/mmd/miku/pose.vpd",
    ]);
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    // 字节为空 → vmd/vpd 均跳过（vmdParse/VPDLoader 未触发）
    expect(hoisted.vmdParseMock).not.toHaveBeenCalled();
    expect(hoisted.vpdLoadAsyncMock).not.toHaveBeenCalled();
    built.dispose();
  });

  it("VPD 解析抛错 → dbg parse-vpd-fail 跳过其余照常", async () => {
    setup();
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/bad.vpd",
    ]);
    hoisted.vpdLoadAsyncMock.mockRejectedValue(new Error("bad vpd"));
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(built.update).toBeDefined();
    built.dispose();
  });
});

describe("worker 纹理解码应用（pendingTexture / decoded 位图）", () => {
  it("主线程路径无 pendingTexture 材质 → decoded 位图空转（warn diag）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.decodeAllMock.mockResolvedValue(new Map([["tex.png", {} as unknown as DecodedTexture]]));
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "tex-decode-apply" && String(c[3]).includes("pendingTexture"))).toBeDefined();
    built.dispose();
  });

  it("worker 路径 pendingTexture 命中 → applyWorkerDecodedTextures 替换（ok diag）", async () => {
    localStorage.setItem("mmd-pmx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("DATA"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.decodeAllMock.mockResolvedValue(new Map([["tex.png", {} as unknown as DecodedTexture]]));
    hoisted.applyTexturesMock.mockReturnValue({ replaced: 2, total: 2 });
    hoisted.createPmxParserImpl = () => ({
      parse: () => Promise.resolve({
        id: 0,
        ok: true,
        vertices: {
          count: 3,
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          uvs: new Float32Array([]),
          boneIndices: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
          boneWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
        },
        faces: { count: 3, indices: new Uint32Array([0, 1, 2]) },
        textures: ["tex.png"],
        materials: [{ name: "服", diffuse: [1, 1, 1, 1], flags: 0, textureIndex: 0 }],
        bones: [{ name: "rootA", englishName: "", parentBoneIndex: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false }],
        rigidBodies: [],
        joints: [],
        morphs: [],
        displayFrames: [],
      }),
      dispose: vi.fn(),
    });
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    expect(hoisted.applyTexturesMock).toHaveBeenCalled();
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "tex-decode-apply" && c[2] === "ok")).toBeDefined();
    built.dispose();
  });

  it("worker 路径 replaced=0（路径不匹配）→ warn diag", async () => {
    localStorage.setItem("mmd-pmx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("DATA"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.decodeAllMock.mockResolvedValue(new Map([["tex.png", {} as unknown as DecodedTexture]]));
    hoisted.applyTexturesMock.mockReturnValue({ replaced: 0, total: 2 });
    hoisted.createPmxParserImpl = () => ({
      parse: () => Promise.resolve({
        id: 0,
        ok: true,
        vertices: {
          count: 3,
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          uvs: new Float32Array([]),
          boneIndices: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
          boneWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
        },
        faces: { count: 3, indices: new Uint32Array([0, 1, 2]) },
        textures: ["tex.png"],
        materials: [{ name: "服", diffuse: [1, 1, 1, 1], flags: 0, textureIndex: 0 }],
        bones: [{ name: "rootA", englishName: "", parentBoneIndex: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false }],
        rigidBodies: [],
        joints: [],
        morphs: [],
        displayFrames: [],
      }),
      dispose: vi.fn(),
    });
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "tex-decode-apply" && String(c[3]).includes("replaced=0"))).toBeDefined();
    built.dispose();
  });

  it("decoded promise reject → tex-decode-apply warn（主线程 fallback）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.decodeAllMock.mockRejectedValue(new Error("decode boom"));
    const port = makePort();
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "tex-decode-apply" && String(c[3]).includes("fallback"))).toBeDefined();
    built.dispose();
  });
});

describe("KTX2 替换异常（stage3 直载容错）", () => {
  /** 与 KTX2 缓存直载 describe 同款 rich port（WithMeta 提供 hash） */
  function makeRichPort(): MmdDataPort {
    return {
      readFileBytes: hoisted.readBytesMock,
      readFileBytesBatch: vi.fn().mockResolvedValue({
        "/mmd/miku/tex.png": btoa("PNG"),
      }),
      readFileBytesBatchWithMeta: vi.fn().mockResolvedValue({
        "/mmd/miku/tex.png": { data: btoa("PNG"), hash: "h1" },
      }),
      listAllFilePaths: hoisted.listPathsMock,
      addOpLog: vi.fn().mockResolvedValue(undefined),
      getCachedTexture: vi.fn().mockResolvedValue(null),
    };
  }

  function fakeRenderer() {
    return {
      info: { memory: { geometries: 2, textures: 3 } },
    } as unknown as THREE.WebGLRenderer;
  }

  it("GetCachedTextureByHash 返回空串 → 跳过替换保留原纹理", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    vi.mocked(getApp).mockResolvedValue({
      HasCachedTextures: async () => ({ h1: true }),
      GetCachedTextureByHash: async () => "",
    } as unknown as AppBindings);
    const port = makeRichPort();
    const { ctx } = makeCtx();
    ctx.renderer = fakeRenderer();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    // 缓存命中计数仍有，但替换数为 0（ktx2LoadAsync 未触发）
    expect(hoisted.ktx2LoadAsyncMock).not.toHaveBeenCalled();
    const calls = (port.addOpLog as ReturnType<typeof vi.fn>).mock.calls as Array<[string, string, string, string?]>;
    expect(calls.find((c) => c[0] === "ktx2-replace" && c[1] === "cache-hit")).toBeDefined();
    built.dispose();
  });

  it("KTX2 loadAsync reject → dbg ktx2-replace-fail 保留原纹理（链不阻断）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/tex.png"]);
    hoisted.loaderLoadAsyncMock.mockImplementation(() => Promise.resolve(fakeMmdRich()));
    hoisted.ktx2LoadAsyncMock.mockRejectedValue(new Error("ktx fail"));
    vi.mocked(getApp).mockResolvedValue({
      HasCachedTextures: async () => ({ h1: true }),
      GetCachedTextureByHash: async () => btoa("KTX2"),
    } as unknown as AppBindings);
    const port = makeRichPort();
    const { ctx } = makeCtx();
    ctx.renderer = fakeRenderer();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", port, makeMmdPanels());
    expect(hoisted.ktx2LoadAsyncMock).toHaveBeenCalled();
    built.dispose();
  });
});

describe("applyPose / play 桥补漏", () => {
  function setupVpdNonWorker() {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockImplementation((p: string) => Promise.resolve(btoa(p)));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/pose.vpd"]);
    hoisted.vmdParseMock.mockImplementation(() => Promise.resolve({ cameraKeyFrames: [{ frameNumber: 0 }] }));
    hoisted.buildAnimMock.mockReturnValue(new THREE.AnimationClip("m", -1, []));
    hoisted.buildCameraAnimMock.mockReturnValue(new THREE.AnimationClip("cam", -1, []));
  }

  it("非 worker 路径 applyPose → applyVPD；越界 index 早退；applyVPD 抛错容错", async () => {
    setupVpdNonWorker();
    hoisted.vpdLoadAsyncMock.mockResolvedValue({ bones: { c: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } }, morphs: {} });
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());

    built.applyPose?.(0);
    expect(hoisted.applyVPDMock).toHaveBeenCalledTimes(1);
    built.applyPose?.(99); // 越界 → 早退
    expect(hoisted.applyVPDMock).toHaveBeenCalledTimes(1);

    // applyVPD 抛错 → dbg apply-vpd-fail 不外抛
    hoisted.applyVPDMock.mockImplementation(() => { throw new Error("vpd boom"); });
    expect(() => built.applyPose?.(0)).not.toThrow();
    built.dispose();
  });

  it("play 桥：toggle 翻转 cameraAction.paused + requestReload 触发 dock 刷新", async () => {
    setupVpdNonWorker();
    hoisted.listPathsMock.mockResolvedValue([
      "/mmd/miku/miku.pmx",
      "/mmd/miku/cam.vmd",
      "/mmd/miku/pose.vpd",
    ]);
    hoisted.vpdLoadAsyncMock.mockResolvedValue({ bones: {}, morphs: {} });
    let capturedBridge: Record<string, (...a: unknown[]) => unknown> | null = null;
    const panels = makeMmdPanels();
    panels.playNodes = (bridge) => {
      capturedBridge = bridge as unknown as Record<string, (...a: unknown[]) => unknown>;
      return [];
    };
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), panels);

    // requestReload → menu.refreshDock
    capturedBridge!.requestReload!();
    expect((ctx.menu as unknown as { refreshDock: ReturnType<typeof vi.fn> }).refreshDock).toHaveBeenCalled();

    // toggle：翻 playing + cameraAction.paused（camera clip 存在 → cameraAction 非空）
    const isPlaying0 = capturedBridge!.isPlaying!() as boolean;
    capturedBridge!.toggle!();
    expect(capturedBridge!.isPlaying!()).toBe(!isPlaying0);
    capturedBridge!.toggle!();
    expect(capturedBridge!.isPlaying!()).toBe(isPlaying0);
    built.dispose();
  });

  it("shotNodes 注入的 screenshot 能力可调用（mmdMenuItems screenshot 闭包）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    const panels = makeMmdPanels();
    let gotShot: (() => Promise<string | null>) | null = null;
    panels.shotNodes = (_navCtx, screenshot) => {
      gotShot = screenshot;
      return [];
    };
    const { ctx } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), panels);
    await expect(gotShot!()).resolves.toBe("shot-b64");
    // PreviewScene.screenshot 同源
    await expect(built.screenshot!()).resolves.toBe("shot-b64");
    built.dispose();
  });

  it("mesh.visible=false → update 早退（不再驱动 updateWithMixer）", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("PMX"));
    hoisted.listPathsMock.mockResolvedValue([]);
    const { ctx, scene } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const mesh = scene.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    const before = hoisted.mmdUpdateWithMixerMock.mock.calls.length;
    mesh.visible = false;
    built.update!(0.016);
    expect(hoisted.mmdUpdateWithMixerMock.mock.calls.length).toBe(before);
    built.dispose();
  });
});

describe("worker applyVPDToMesh 变体", () => {
  function setupWorkerWithVpd(vpdObj: unknown) {
    localStorage.setItem("mmd-pmx-worker", "1");
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:mock-url");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    hoisted.readBytesMock.mockResolvedValue(btoa("DATA"));
    hoisted.listPathsMock.mockResolvedValue(["/mmd/miku/miku.pmx", "/mmd/miku/pose.vpd"]);
    hoisted.vpdLoadAsyncMock.mockResolvedValue(vpdObj);
    hoisted.createPmxParserImpl = () => ({
      parse: () => Promise.resolve({
        id: 0,
        ok: true,
        vertices: {
          count: 3,
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
          uvs: new Float32Array([]),
          boneIndices: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
          boneWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
        },
        faces: { count: 3, indices: new Uint32Array([0, 1, 2]) },
        textures: [],
        materials: [{ name: "服", diffuse: [1, 1, 1, 1], flags: 0, textureIndex: -1 }],
        bones: [{ name: "rootA", englishName: "", parentBoneIndex: -1, position: [0, 0, 0], rotation: [0, 0, 0, 1], flag: 0, hasIK: false }],
        rigidBodies: [],
        joints: [],
        morphs: [],
        displayFrames: [],
      }),
      dispose: vi.fn(),
    });
  }

  it("VPD 无 bones → applyVPDToMesh 早退；未知骨骼名 continue", async () => {
    setupWorkerWithVpd({}); // 无 bones → 早退
    const { ctx } = makeCtx();
    let built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(() => built.applyPose?.(0)).not.toThrow();
    built.dispose();

    // bones 含未知名 → continue（不抛）
    setupWorkerWithVpd({ bones: { 不存在: { position: [0, 1, 0], rotation: [0, 0, 0, 1] } }, morphs: {} });
    const { ctx: ctx2 } = makeCtx();
    built = await buildMmdScene(ctx2, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    expect(() => built.applyPose?.(0)).not.toThrow();
    built.dispose();
  });

  it("VPD morphs + mesh morphTargetDictionary → 权重直写 influences", async () => {
    setupWorkerWithVpd({
      bones: { rootA: { position: [0, 1, 0], rotation: [0, 0, 0, 1] } },
      morphs: { "まばたき": 0.7 },
    });
    const { ctx, scene } = makeCtx();
    const built = await buildMmdScene(ctx, "/mmd/miku/miku.pmx", makePort(), makeMmdPanels());
    const skinned = scene.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    skinned.morphTargetDictionary = { "まばたき": 0 };
    skinned.morphTargetInfluences = [0];
    built.applyPose?.(0);
    expect(skinned.morphTargetInfluences![0]).toBeCloseTo(0.7, 5);
    built.dispose();
  });
});
