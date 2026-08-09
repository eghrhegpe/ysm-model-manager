// ===== 2D 骨骼渲染层测试 =====
// 覆盖 loadModel2D：
//  - 无容器/无 bones/loadModelData 抛错 → 兜底不炸
//  - 成功路径：canvas + 统计卡片 + 作者区 + 骨骼名开关持久化
//  - 交互：拖拽旋转 / 滚轮缩放 / 2D 渲染异常捕获
//  - 导出骨骼名按钮 → Blob URL
//  - 3D 切换：overlay 创建 + preloadModel/renderModel3D 调用 + close3D 清理
//  - 3D 加载失败 → error toast
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../test-utils/index.ts";

const {
  getPrefer3D,
  setPrefer3D,
  loadModelData,
  renderModel2D,
  openFullPreview,
  getApp,
  busEmit,
  friendlyError,
  statsCardHTML,
  buildBoneNamesText,
  screenshotPreview,
  renderModel3D,
  renderMultiAngle,
  preloadModel,
} = vi.hoisted(() => ({
  getPrefer3D: vi.fn(() => false),
  setPrefer3D: vi.fn(),
  loadModelData: vi.fn(),
  renderModel2D: vi.fn(),
  openFullPreview: vi.fn(),
  getApp: vi.fn(),
  busEmit: vi.fn(),
  friendlyError: vi.fn((e: unknown) => `友好:${String((e as Error)?.message ?? e)}`),
  statsCardHTML: vi.fn(() => "<div>stats-card</div>"),
  buildBoneNamesText: vi.fn(() => ["root", "head"]),
  screenshotPreview: vi.fn(() => "b64data"),
  renderModel3D: vi.fn(),
  renderMultiAngle: vi.fn(),
  preloadModel: vi.fn(),
}));

vi.mock("./utils.ts", () => ({ getPrefer3D, setPrefer3D }));
// t 返回 key（skeleton 用 t("preview.*")，语言包无该命名空间时真实 t 也返回 key）
vi.mock("../../core/i18n/t.ts", () => ({
  t: (key: string) => key,
}));
vi.mock("./loader.ts", () => ({ loadModelData }));
vi.mock("../../utils/3d/model2d.ts", () => ({ renderModel2D }));
vi.mock("./zoom.ts", () => ({ openFullPreview }));
vi.mock("../../wails/app.ts", () => ({ getApp }));
vi.mock("../../bus.ts", () => ({ bus: { emit: busEmit } }));
vi.mock("../../utils/dom/errors.ts", () => ({ friendlyError }));
vi.mock("./tpl.ts", () => ({ statsCardHTML }));
vi.mock("./bone-names.ts", () => ({ buildBoneNamesText }));
vi.mock("../../utils/3d/model3d.ts", () => ({
  screenshotPreview,
  renderModel3D,
}));
vi.mock("./screenshot-renderer.ts", () => ({ renderMultiAngle }));
vi.mock("./model3d-loader.ts", () => ({ preloadModel }));

import { loadModel2D } from "./skeleton.ts";

/** 可控 Image：src setter 同步 onload（happy-dom 无真实网络） */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 64;
  naturalHeight = 32;
  _src = "";
  set src(u: string) {
    this._src = u;
    this.onload?.();
  }
  get src(): string {
    return this._src;
  }
}

function makeModel(overrides: Record<string, unknown> = {}) {
  return {
    bones: [{ id: "root", name: "根", parentId: null }],
    boneCount: 1,
    texture: "tex.png",
    textures: ["tex.png"],
    textureNames: ["tex.png"],
    _modelPath: "/m/a.ysm",
    _authors: [{ name: "作者A", role: "建模" }],
    ...overrides,
  };
}

function makeCtx() {
  const root = document.createElement("div");
  root.innerHTML = `<div id="preview-content"></div><button id="btn-3d-preview"></button><div id="ysm-author-avatars"></div>`;
  // PreviewCtx.root 需提供 getElementById（真实为组件宿主）
  (root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => root.querySelector(`#${id}`);
  const ctx = {
    root: root as unknown as ShadowRoot,
    appendDebug: vi.fn(),
    decodeYsmViaWasm: vi.fn(() => Promise.resolve(null)),
    loadPreviewImage: vi.fn(() => Promise.resolve(null)),
    unsubs: [] as Array<() => void>,
  };
  return ctx;
}

function make3DHandle() {
  return {
    cleanup: vi.fn(),
    resetCamera: vi.fn(),
    onBoneSelect: null as null | ((info: unknown) => void),
    getModelGroupCount: vi.fn(() => 1),
    getBoneList: vi.fn(() => []),
    setBoneVisible: vi.fn(),
    setRotationMode: vi.fn(),
    setSpeed: vi.fn(),
    showModelGroup: vi.fn(),
    _timeTimer: null as null | ReturnType<typeof setInterval>,
    _keyHandler: null as null | ((e: KeyboardEvent) => void),
    _boneDetailEl: null as null | HTMLElement,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  renderModel2D.mockReset(); // 清 mockImplementation 防跨测试泄漏
  localStorage.clear();
  document.body.innerHTML = "";
  getPrefer3D.mockReturnValue(false);
  loadModelData.mockResolvedValue({ model: makeModel(), decodedBy: "go" });
  getApp.mockResolvedValue({ SaveScreenshotFile: vi.fn() });
  vi.stubGlobal("Image", FakeImage as never);
  vi.stubGlobal(
    "URL",
    Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    }),
  );
});

describe("loadModel2D — 防御路径", () => {
  it("无容器且 root 无 preview-content → 静默返回", async () => {
    const ctx = makeCtx();
    ctx.root.innerHTML = "";
    await loadModel2D(ctx, "/m/a.ysm", null);
    expect(loadModelData).not.toHaveBeenCalled();
  });

  it("loadModelData 抛错 → 解析失败提示（不向外抛）", async () => {
    loadModelData.mockRejectedValue(new Error("boom"));
    const ctx = makeCtx();
    const container = document.createElement("div");
    await loadModel2D(ctx, "/m/a.ysm", container);
    expect(container.querySelector(".ysm-error-title")).toBeTruthy();
    expect(container.textContent).toContain("boom");
  });

  it("model 无 bones → 未找到几何数据提示", async () => {
    loadModelData.mockResolvedValue({ model: { bones: [] }, decodedBy: "go" });
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    expect(container.textContent).toContain("noGeometry");
  });

  it("P1 守卫：容器被移除（切页重建）后迟到的渲染不再写 ctx.root（防跨文件污染）", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);
    let resolveData: (v: unknown) => void = () => {};
    loadModelData.mockReturnValue(
      new Promise((r) => {
        resolveData = r;
      }),
    );
    const p = loadModel2D(ctx, "/m/a.ysm", container);
    // 模拟用户切到 B：showModelDetail 重建 ctx.root.innerHTML，A 的 container 被移除
    ctx.root.innerHTML = `<div id="preview-content"></div><button id="btn-3d-preview"></button><div id="ysm-author-avatars"></div>`;
    container.remove();
    resolveData({ model: makeModel(), decodedBy: "go" });
    await p;
    // A 不再把作者头像写进 B 的详情页、不再把 _toggle3D 绑到 B 的按钮
    const avatars = ctx.root.querySelector("#ysm-author-avatars") as HTMLElement;
    expect(avatars.innerHTML).not.toContain("作者A");
    const btn3d = ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement;
    expect(btn3d.onclick).toBeNull();
  });
});

describe("loadModel2D — 2D 成功路径", () => {
  it("创建 canvas + 统计卡片 + 作者区 + 渲染骨骼图", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await loadModel2D(ctx, "/m/a.ysm", container);

    expect(container.querySelector(".ysm-canvas")).toBeTruthy();
    expect(statsCardHTML).toHaveBeenCalledWith(
      expect.objectContaining({ bones: expect.any(Array) }),
      "/m/a.ysm",
      "go",
    );
    expect(container.textContent).toContain("作者A");
    expect(renderModel2D).toHaveBeenCalledTimes(1);
    expect(renderModel2D).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.anything(),
      expect.any(FakeImage),
      expect.objectContaining({ showLabels: true, zoom: 1, rotation: 0 }),
    );
  });

  it("作者区同步填充详情页头像容器", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const avatars = ctx.root.querySelector("#ysm-author-avatars") as HTMLElement;
    expect(avatars.innerHTML).toContain("作者A");
  });

  it("骨骼名开关：点击 → localStorage 持久化 + 重渲染", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const eyeBtn = container.querySelector("button") as HTMLButtonElement;
    expect(eyeBtn.textContent).toContain("preview.boneLabels");

    eyeBtn.click();
    expect(localStorage.getItem("ysm_showBoneLabels")).toBe("false");
    expect(renderModel2D).toHaveBeenCalledTimes(2);
    expect(renderModel2D.mock.calls[1]![3]).toMatchObject({ showLabels: false });
  });

  it("2D 渲染抛错 → console.warn 不中断（doRender 内捕获）", async () => {
    renderModel2D.mockImplementation(() => {
      throw new Error("2d boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx = makeCtx();
      const container = document.createElement("div");
      document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
      await loadModel2D(ctx, "/m/a.ysm", container);
      expect(warn.mock.calls[0]?.[0]).toContain("[preview] 2D 渲染跳过");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("loadModel2D — 交互", () => {
  it("拖拽旋转：mousedown + window mousemove → 重渲染 + click 被拦截", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const canvas = container.querySelector(".ysm-canvas") as HTMLCanvasElement;
    renderModel2D.mockClear();

    canvas.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 10, bubbles: true }),
    );
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 30 }));
    window.dispatchEvent(new MouseEvent("mouseup"));

    expect(renderModel2D).toHaveBeenCalledTimes(1);
    expect(renderModel2D.mock.calls[0]![3]).toMatchObject({ rotation: 10 });
    expect(openFullPreview).not.toHaveBeenCalled();

    // 组件销毁 → window 监听器移除
    for (const fn of [...ctx.unsubs]) fn();
    renderModel2D.mockClear();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 }));
    expect(renderModel2D).not.toHaveBeenCalled();
  });

  it("滚轮缩放：缩放有界 [0.2, 10]", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const canvas = container.querySelector(".ysm-canvas") as HTMLCanvasElement;
    renderModel2D.mockClear();

    // 缩小 5 次（deltaY 大正值 → zoom 指数衰减趋近下限）
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true }),
      );
    }
    const last = renderModel2D.mock.calls.at(-1)![3] as { zoom: number };
    expect(last.zoom).toBeGreaterThanOrEqual(0.19);
    expect(last.zoom).toBeLessThan(0.3);

    // 放大
    renderModel2D.mockClear();
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(
        new WheelEvent("wheel", { deltaY: -500, bubbles: true, cancelable: true }),
      );
    }
    const zoomed = renderModel2D.mock.calls.at(-1)![3] as { zoom: number };
    expect(zoomed.zoom).toBeLessThanOrEqual(10);
    expect(zoomed.zoom).toBeGreaterThan(5);
  });

  it("导出骨骼名按钮 → buildBoneNamesText + 下载链接触发", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await loadModel2D(ctx, "/m/a.ysm", container);
    const boneBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "📋 preview.exportBones",
    )!;
    boneBtn.click();
    expect(buildBoneNamesText).toHaveBeenCalledWith(
      "/m/a.ysm",
      1,
      expect.any(Array),
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});

describe("loadModel2D — 3D 切换", () => {
  it("btn-3d-preview 点击 → overlay + preloadModel/renderModel3D + 面板统计", async () => {
    const handle = make3DHandle();
    renderModel3D.mockResolvedValue(handle);
    preloadModel.mockResolvedValue({
      texArr: [],
      spec: {
        models: [
          {
            bones: [{ _cubeCount: 2 }],
            textureWidth: 64,
            textureHeight: 32,
            name: "m0",
          },
        ],
      },
    });
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);

    (ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement).click();
    await waitFor(() => document.getElementById("ysm-overlay-3d"));

    expect(preloadModel).toHaveBeenCalledTimes(1);
    expect(renderModel3D).toHaveBeenCalledTimes(1);
    expect(handle.cleanup).not.toHaveBeenCalled();
    const panel = document.getElementById("ysm-3d-panel") as HTMLElement;
    expect(panel.textContent).toContain("1 根");
    expect(panel.textContent).toContain("2 个");
    expect(panel.textContent).toContain("64×32");

    // close3D 已在 unsubs（组件销毁自动清理），执行后 renderer 释放 + overlay 移除
    for (const fn of [...ctx.unsubs]) fn();
    expect(handle.cleanup).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ysm-overlay-3d")).toBeNull();
  });

  it("3D 加载失败 → error toast + 错误占位", async () => {
    preloadModel.mockRejectedValue(new Error("wasm 崩了"));
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);

    (ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement).click();
    await waitFor(() => busEmit.mock.calls.length > 0);

    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({
        msg: expect.stringContaining("wasm 崩了"),
        type: "error",
      }),
    );
    expect(friendlyError).toHaveBeenCalled();
  });

  it("3D 加载期间用户关闭（ESC）→ 立即 cleanup 防 WebGL 泄漏", async () => {
    const handle = make3DHandle();
    let resolveRender: (h: typeof handle) => void = () => {};
    renderModel3D.mockReturnValue(
      new Promise((r) => {
        resolveRender = r;
      }),
    );
    preloadModel.mockResolvedValue({ texArr: [], spec: { models: [] } });
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);

    (ctx.root.querySelector("#btn-3d-preview") as HTMLButtonElement).click();
    // 加载未完成前先关闭（触发 close3D → _model3dGen++）
    const closeFn = ctx.unsubs.at(-1)!;
    closeFn();
    resolveRender(handle);
    await new Promise((r) => setTimeout(r, 0));

    expect(handle.cleanup).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ysm-overlay-3d")).toBeNull();
  });
});
