// ===== 2D 骨骼渲染层测试 =====
// 覆盖 loadModel2D：
//  - 无容器/无 bones/loadModelData 抛错 → 兜底不炸
//  - 成功路径：canvas + 统计卡片 + 作者区 + 骨骼名开关持久化
//  - 交互：拖拽旋转 / 滚轮缩放 / 2D 渲染异常捕获
//  - 导出骨骼名按钮 → Blob URL
// ADR-253 D7：详情卡 3D 入口 FAB 与 _prefer3D 自动弹语义已删除，3D 统一走左下角
// nav-fab（openModel3DFullscreen）；本文件不再覆盖 3D 切换（见 ysm-3d.test.ts）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  loadModelData,
  renderModel2D,
  openFullPreview,
  getApp,
  busEmit,
  friendlyError,
  statsCardHTML,
  buildBoneNamesText,
  renderMultiAngle,
  preloadModel,
  createYsm3D,
  cleanupYsm3D,
} = vi.hoisted(() => ({
  loadModelData: vi.fn(),
  renderModel2D: vi.fn(),
  openFullPreview: vi.fn(),
  getApp: vi.fn(),
  busEmit: vi.fn(),
  friendlyError: vi.fn((e: unknown) => `友好:${String((e as Error)?.message ?? e)}`),
  statsCardHTML: vi.fn(() => "<div>stats-card</div>"),
  buildBoneNamesText: vi.fn(() => ["root", "head"]),
  renderMultiAngle: vi.fn(),
  preloadModel: vi.fn(),
  createYsm3D: vi.fn(),
  cleanupYsm3D: vi.fn(),
}));

// t 与 locale 解耦：返回 key，并把收到的插值参数拼回（decl/size 等数值可见，
// t 与 locale 解耦：返回 key，并把收到的插值参数拼回（decl/size 等数值可见，
// 便于断言验证真实传入 t 的声明/加载尺寸，无需加载真实语言包——真实 t 在无该
// 命名空间时同样返回 key）。无参数时退化为纯 key（与旧行为一致）。
vi.mock("@/core/i18n/t.ts", () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (!params || Object.keys(params).length === 0) return key;
    const ps = Object.entries(params)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
    return `${key}{${ps}}`;
  },
}));
vi.mock("./loader.ts", () => ({ loadModelData, fillAuthorsAsync: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./model2d/model2d.ts", () => ({ renderModel2D }));
vi.mock("./zoom.ts", () => ({ openFullPreview }));
vi.mock("@/backend/app.ts", () => ({ getApp }));
vi.mock("@/bus", () => ({ bus: { emit: busEmit } }));
vi.mock("@/utils/dom/errors.ts", () => ({ friendlyError }));
vi.mock("./tpl.ts", () => ({ statsCardHTML }));
vi.mock("./bone-names.ts", () => ({ buildBoneNamesText }));
vi.mock("@/preview-3d/screenshot/screenshot-render.ts", () => ({ renderMultiAngle }));
vi.mock("./model3d-loader.ts", () => ({ preloadModel }));
// §5.7 shared 化：3D 打开收敛到 ysm-3d（path 驱动），骨架层测试 mock 编排层——
// shared 外壳（挂 scene/导航/raycast）集成由 ysm-3d.test.ts（three stub）覆盖
// ADR-072 根治：ysm-3d 薄包装已归位 views/app-preview（视图壳注入层），mock 路径同目录
vi.mock("./ysm-3d.ts", () => ({ createYsm3D, cleanupYsm3D }));

import { loadModel2D, closeActive3DOverlay, setActive3DClose } from "./skeleton.ts";

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
  root.innerHTML = `<div id="preview-content"></div>`;
  // PreviewCtx.root 需提供 getElementById（真实为组件宿主）
  (root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => root.querySelector(`#${id}`);
  const ctx = {
    root: root as unknown as ShadowRoot,
    appendDebug: vi.fn(),
    decodeYsmViaWasm: vi.fn(() => Promise.resolve(null)),
    loadPreviewImage: vi.fn(() => Promise.resolve(null)),
    unsubs: [] as Array<() => void>,
    dragAbortCtrl: null,
    active3DClose: null,
    getPrefer3D: vi.fn(() => false),
    setPrefer3D: vi.fn(),
  };
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  renderModel2D.mockReset(); // 清 mockImplementation 防跨测试泄漏
  localStorage.clear();
  document.body.innerHTML = "";
  loadModelData.mockResolvedValue({ model: makeModel(), decodedBy: "go" });
  getApp.mockResolvedValue({
    SaveScreenshotFile: vi.fn(),
    GetModel3DSpec: vi.fn().mockResolvedValue(JSON.stringify({ models: [{ name: "main", bones: [{}, {}], meshGroups: [] }] })),
  });
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal(
    "URL",
    Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals(); // 还原 stubGlobal 的 Image/URL，防跨文件泄漏
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
    expect(container.querySelector(".pv-error-title")).toBeTruthy();
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
    ctx.root.innerHTML = `<div id="preview-content"></div>`;
    container.remove();
    resolveData({ model: makeModel(), decodedBy: "go" });
    await p;
    // A 的迟到回写不落地到 B 的详情页。
    // ⚠️ 局限（变异测试实证 2026-09-16）：本用例**无法**捕获 `isConnected` 守卫的删除——
    // 迟到路径的写入目标是 detached 的 container，本就不触碰 ctx.root；把它当「守卫回归测试」
    // 会得到假信心。保留它的价值是钉住现状：2D 渲染不往已重建的 root 写任何东西。
    expect(ctx.root.querySelector("#preview-content")?.innerHTML).toBe("");
  });
});

describe("loadModel2D — 2D 成功路径", () => {
  it("创建 canvas + 统计卡片 + 作者区 + 渲染骨骼图", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container);
    await loadModel2D(ctx, "/m/a.ysm", container);

    expect(container.querySelector(".pv-canvas")).toBeTruthy();
    expect(statsCardHTML).toHaveBeenCalledWith(
      expect.objectContaining({ bones: expect.any(Array) }),
      "/m/a.ysm",
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

  it("作者列表仍在统计卡内渲染（顶部头像容器已移除，无重复填充目标）", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    // 作者信息由统计卡承载（容器内作者区），详情页顶部无 ysm-author-avatars 重复填充
    expect(container.textContent).toContain("作者A");
    expect(ctx.root.querySelector("#ysm-author-avatars")).toBeNull();
  });

  it("骨骼名开关：点击 → localStorage 持久化 + 重渲染", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const eyeBtn = container.querySelector("button") as HTMLButtonElement;
    expect(eyeBtn.textContent).toContain("preview.field.boneNames");

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
  it("拖拽旋转：pointerdown + window pointermove → 重渲染 + click 被拦截", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const canvas = container.querySelector(".pv-canvas") as HTMLCanvasElement;
    renderModel2D.mockClear();

    canvas.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 10, bubbles: true }),
    );
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 30 }));
    window.dispatchEvent(new PointerEvent("pointerup"));

    expect(renderModel2D).toHaveBeenCalledTimes(1);
    expect(renderModel2D.mock.calls[0]![3]).toMatchObject({ rotation: 10 });
    expect(openFullPreview).not.toHaveBeenCalled();

    // 组件销毁 → window 监听器移除
    for (const fn of [...ctx.unsubs]) fn();
    renderModel2D.mockClear();
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100 }));
    expect(renderModel2D).not.toHaveBeenCalled();
  });

  it("滚轮缩放：缩放有界 [0.2, 10]", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    document.body.appendChild(container); // 挂载以符合真实场景（loadModel2D 的 isConnected 守卫）
    await loadModel2D(ctx, "/m/a.ysm", container);
    const canvas = container.querySelector(".pv-canvas") as HTMLCanvasElement;
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
    // ADR-238：导出骨骼按钮图标由 emoji 📋 改走 SVG（按钮文本仍是文案，不含图标标记）。
    // 注：loadModel2D 内部以同名局部 `container` 承载内容，测试传入的 `container` 是其外层；
    // 故按钮需经 `.sk-loading-box` 嵌套定位（直接 `container.querySelectorAll` 命中不到）。
    const sk = container.querySelector<HTMLElement>(".sk-loading-box");
    // ADR-238：导出骨骼按钮图标由 emoji 📋 改走 SVG（按钮文本仍是文案，不含图标标记）。
    // 注：loadModel2D 内部以同名局部 `container` 承载内容，测试传入的 `container` 是其外层；
    // 故按钮需经 `.sk-loading-box` 嵌套定位（直接 container.querySelectorAll 命中不到）。
    const boneBtns = [...(sk?.querySelectorAll<HTMLButtonElement>("button.pv-btn") ?? [])].filter((b) =>
      (b.textContent ?? "").includes("preview.action.exportBoneNames"),
    );
    const boneBtn = boneBtns[0];
    if (!boneBtn) {
      throw new Error("导出骨骼名按钮未渲染");
    }
    boneBtn.click();
    expect(buildBoneNamesText).toHaveBeenCalledWith(
      "/m/a.ysm",
      1,
      expect.any(Array),
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });
});

// fill3DPanel 命令式旧轨已删除（ADR-126 P5 声明式迁移完成）；
// 其测试覆盖的统计/纹理/组件选择语义已由 buildYsmModelSchema + ysmModelStats 承接。

describe("active3DClose 实例隔离（a760aece0 模块级→实例级迁移回归锚）", () => {
  // code_review a760aece0 #2/#3（P3）：active3DClose 从模块级单例迁实例 ctx——
  // P1 修复（多实例串扰：一个实例的 model:select 关掉别的实例的 overlay）。原迁移
  // 零测试——补双实例隔离锚（closeActive3DOverlay 仍由 app-preview/index.ts 切模型前调用）
  it("双实例隔离：closeActive3DOverlay(ctxA) 不碰 ctxB 的钩子", () => {
    const ctxA = makeCtx();
    const ctxB = makeCtx();
    const closeA = vi.fn();
    const closeB = vi.fn();
    setActive3DClose(ctxA, closeA);
    setActive3DClose(ctxB, closeB);
    closeActive3DOverlay(ctxA);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(ctxA.active3DClose).toBeNull();
    // 实例隔离：ctxB 的钩子未被触发、引用保留
    expect(closeB).not.toHaveBeenCalled();
    expect(ctxB.active3DClose).toBe(closeB);
  });
});
