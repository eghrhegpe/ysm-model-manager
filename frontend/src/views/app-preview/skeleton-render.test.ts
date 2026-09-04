// ===== 骨骼渲染层 skeleton-render 纯 DOM 函数测试（审核盲区补建）=====
// 覆盖：setup2DCanvas（canvas 尺寸 + 纹理异步）、buildToggleRow（开关状态 + 持久化）、
//  buildStatsCard（作者区填充）、buildBoneExportRow（Blob URL revoke 幂等）、
//  saveScreenshot（current 空 b64 抛错 / all 递归 / 角度命中）
// 不测：loadModel2D（已在 skeleton.test.ts）、fill3DPanel（在 skeleton-fill-panel.ts scope）；
//  build3DOverlay 已于 ADR-066 §5.6 方案 A 删除（YSM 3D 走 createYsm3D → mount3D）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getApp, screenshotFn, renderMultiAngle, saveFile } = vi.hoisted(() => ({
  getApp: vi.fn(),
  screenshotFn: vi.fn(),
  renderMultiAngle: vi.fn(),
  saveFile: vi.fn(),
}));

vi.mock("../../core/i18n/t.ts", () => ({ t: (k: string) => k }));
vi.mock("../../backend/app.ts", () => ({ getApp }));
vi.mock("../../preview-3d/screenshot-render.ts", () => ({ renderMultiAngle }));
vi.mock("../../preview-3d/decoder/wasm-decode.ts", () => ({ decodeYsmViaWasm: vi.fn(() => Promise.resolve(null)) }));

import { setup2DCanvas, buildToggleRow, buildStatsCard, buildBoneExportRow, saveScreenshot } from "./skeleton-render.ts";
import type { BedrockGeometry } from "../../preview-3d/decoder/geometry.ts";
import type { PreviewRoot, YsmDecoder, PreviewDebugger } from "./utils.ts";

/** 最小可用 BedrockGeometry（各测试按需 override） */
function makeModel(overrides: Partial<BedrockGeometry & { textures?: string[] | null }> = {}): BedrockGeometry & { textures?: string[] | null; _modelPath?: string } {
  return {
    boneCount: 0,
    cubeCount: 0,
    texWidth: 64,
    texHeight: 64,
    bones: [],
    _modelPath: "/m/a.ysm",
    ...overrides,
  };
}

/** 构造 PreviewRoot & YsmDecoder & PreviewDebugger 兼容 ctx */
function makeCtx(): PreviewRoot & YsmDecoder & PreviewDebugger {
  const root = document.createElement("div");
  root.innerHTML = `<div id="preview-content"></div>`;
  (root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => root.querySelector(`#${id}`);
  return {
    root: root as unknown as ShadowRoot,
    appendDebug: vi.fn(),
    decodeYsmViaWasm: vi.fn(() => Promise.resolve(null)),
    unsubs: [] as Array<() => void>,
  };
}

/** 可控 Image：src setter 同步 onload（happy-dom 无真实网络） */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  _src = "";
  set src(u: string) {
    this._src = u;
    this.onload?.();
  }
  get src(): string {
    return this._src;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
  getApp.mockResolvedValue({ SaveScreenshotFile: saveFile });
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
  vi.unstubAllGlobals();
});

// ── setup2DCanvas ──────────────────────────────────────────────
describe("setup2DCanvas", () => {
  it("无纹理 → 仅建 canvas，textureImg 为 null", async () => {
    const container = document.createElement("div");
    const { canvas, textureImg } = await setup2DCanvas(container, makeModel({ texture: null }));
    expect(canvas.width).toBe(180);
    expect(canvas.height).toBe(180);
    expect(canvas.className).toBe("pv-canvas");
    expect(container.contains(canvas)).toBe(true);
    expect(textureImg).toBeNull();
  });

  it("有纹理 → 建 Image 并加载 src（onload 同步触发）", async () => {
    const container = document.createElement("div");
    const { textureImg } = await setup2DCanvas(container, makeModel({ texture: "tex.png" }));
    expect(textureImg).toBeTruthy();
    expect(textureImg!.src).toBe("tex.png");
  });

  it("纹理加载失败（onerror）→ promise resolve 不悬死", async () => {
    const container = document.createElement("div");
    // 模拟 onerror 分支：直接 await 不应抛错
    const r = await setup2DCanvas(container, makeModel({ texture: "bad.png" }));
    expect(r.canvas).toBeTruthy();
  });
});

// ── buildToggleRow ─────────────────────────────────────────────
describe("buildToggleRow", () => {
  it("默认 on（localStorage 未存 false）→ 按钮👁 + hint preview.on", () => {
    const container = document.createElement("div");
    const { eyeBtn, eyeHint, getLabelsOn } = buildToggleRow(container);
    expect(getLabelsOn()).toBe(true);
    expect(eyeBtn.textContent).toContain("preview.field.boneNames");
    expect(eyeHint.textContent).toBe("preview.on");
    expect(container.contains(eyeBtn)).toBe(true);
  });

  it("localStorage 存 false → 默认 off", () => {
    localStorage.setItem("ysm_showBoneLabels", "false");
    const container = document.createElement("div");
    const { getLabelsOn, eyeHint } = buildToggleRow(container);
    expect(getLabelsOn()).toBe(false);
    expect(eyeHint.textContent).toBe("preview.off");
  });

  it("setLabelsOn(false) → 按钮/hint 刷新 + getter 反映", () => {
    const container = document.createElement("div");
    const { setLabelsOn, getLabelsOn, eyeBtn, eyeHint } = buildToggleRow(container);
    setLabelsOn(false);
    expect(getLabelsOn()).toBe(false);
    expect(eyeBtn.textContent).toContain("preview.field.boneNames");
    expect(eyeHint.textContent).toBe("preview.off");
    setLabelsOn(true);
    expect(getLabelsOn()).toBe(true);
    expect(eyeHint.textContent).toBe("preview.on");
  });
});

// ── buildStatsCard ─────────────────────────────────────────────
describe("buildStatsCard", () => {
  it("无作者 → 仅 statsCardHTML 卡片", async () => {
    const container = document.createElement("div");
    await buildStatsCard(
      container,
      makeModel(),
      "/m/a.ysm",
      "YSMParser",
      makeCtx(),
    );
    const card = container.querySelector(".pv-card");
    expect(card).toBeTruthy();
    expect(container.querySelectorAll(".pv-card").length).toBe(1);
  });

  it("有作者 → 卡片内作者列表（顶部 ysm-author-avatars 填充已移除）", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    await buildStatsCard(
      container,
      makeModel({ _authors: [{ name: "作者A", role: "建模", avatarUrl: "ava.png" }] }),
      "/m/a.ysm",
      "YSMParser",
      ctx,
    );
    expect(container.textContent).toContain("作者A");
    expect(container.textContent).toContain("建模");
    // 方案 A（2026-08-28）：头像在统计卡作者列表内承载（img 含 ava.png），
    // 不再向详情页顶部 ysm-author-avatars 重复填充小头像
    const img = container.querySelector(".pv-card img");
    expect(img?.getAttribute("src")).toBe("ava.png");
    expect(ctx.root.querySelector("#ysm-author-avatars")).toBeNull();
  });

  it("作者带 bilibili → 渲染 📺 链接（保留 Go SummaryAuthor.Bilibili 透传）", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    await buildStatsCard(
      container,
      makeModel({ _authors: [{ name: "纸板", role: "建模", bilibili: "https://space.bilibili.com/123" }] }),
      "/m/a.ysm",
      "YSMParser",
      ctx,
    );
    const link = container.querySelector(".pv-card a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://space.bilibili.com/123");
    expect(link.textContent).toBe("📺");
  });

  it("作者无 bilibili → 不渲染 📺 链接", async () => {
    const ctx = makeCtx();
    const container = document.createElement("div");
    await buildStatsCard(
      container,
      makeModel({ _authors: [{ name: "匿名", role: "建模" }] }),
      "/m/a.ysm",
      "",
      ctx,
    );
    expect(container.querySelector(".pv-card a")).toBeNull();
  });

  it("作者无 avatarUrl → 占位圆点（无 img）", async () => {
    const container = document.createElement("div");
    const ctx = makeCtx();
    await buildStatsCard(
      container,
      makeModel({ _authors: [{ name: "匿名" }] }),
      "/m/a.ysm",
      "",
      ctx,
    );
    expect(container.textContent).toContain("匿名");
  });
});

// ── buildBoneExportRow ─────────────────────────────────────────
describe("buildBoneExportRow", () => {
  it("建按钮行 + hint 显示骨骼数", () => {
    const container = document.createElement("div");
    buildBoneExportRow(
      container,
      { bones: [], boneCount: 1 } as unknown as BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> },
      "/m/a.ysm",
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("preview.action.exportBoneNames");
    const hint = container.querySelector(".pv-hint") as HTMLElement;
    expect(hint.textContent).toContain("1");
  });

  it("点击 → Blob URL 创建后 revoke（幂等清）", () => {
    const container = document.createElement("div");
    buildBoneExportRow(
      container,
      { bones: [], boneCount: 1 } as unknown as BedrockGeometry & { boneCount?: number; bones?: Array<{ id: string; name: string; parentId?: string }> },
      "/m/a.ysm",
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    const urlSpy = URL.revokeObjectURL as ReturnType<typeof vi.fn>;
    urlSpy.mockClear();
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();
    btn.click();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(urlSpy).toHaveBeenCalledTimes(1);
  });
});

// ── saveScreenshot ─────────────────────────────────────────────
describe("saveScreenshot", () => {
  it("current 有 screenshotFn → 直接截当前视角", async () => {
    screenshotFn.mockResolvedValue("b64data");
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    vi.useFakeTimers();
    try {
      await saveScreenshot(makeModel(), "current", setShotState, screenshotFn);
      expect(screenshotFn).toHaveBeenCalledTimes(1);
      expect(renderMultiAngle).not.toHaveBeenCalled();
      expect(saveFile).toHaveBeenCalledWith(expect.stringContaining(".png"), "b64data");
      expect(setShotState).toHaveBeenCalledWith("\u2705");
      vi.advanceTimersByTime(2000);
      expect(setShotState).toHaveBeenCalledWith("\u{1F4F7}");
    } finally {
      vi.useRealTimers();
    }
  });

  it("current 无 screenshotFn → fallback renderMultiAngle 取首帧", async () => {
    renderMultiAngle.mockResolvedValue([{ name: "front", base64: "f" }]);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel(), "current", setShotState);
    expect(screenshotFn).not.toHaveBeenCalled();
    expect(renderMultiAngle).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledWith(expect.stringContaining(".png"), "f");
  });

  it("current 且 b64 空 → 抛错（不静默吞错）", async () => {
    screenshotFn.mockResolvedValue(null);
    const setShotState = vi.fn();
    await expect(
      saveScreenshot(makeModel(), "current", setShotState, screenshotFn),
    ).rejects.toThrow("截图返回空");
    expect(setShotState).not.toHaveBeenCalledWith("\u2705");
  });

  it("all → 递归 front/45/side/back45（saveFile 4 次，内容与视角一一对应）", async () => {
    renderMultiAngle.mockResolvedValue([
      { name: "front", base64: "f" },
      { name: "45", base64: "45" },
      { name: "side", base64: "s" },
      { name: "back45", base64: "b45" },
    ]);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel({ textures: ["t1", "t2"] }), "all", setShotState, screenshotFn);
    expect(renderMultiAngle).toHaveBeenCalledTimes(4);
    expect(saveFile).toHaveBeenCalledTimes(4);
    // 视角-内容一一对应（审查 P1：误用 renderFrontFrame 会让四张全存 front 帧）
    const calls = saveFile.mock.calls.map(([file, b64]) => [String(file), b64]);
    expect(calls).toEqual([
      [expect.stringContaining("_front"), "f"],
      [expect.stringContaining("_45"), "45"],
      [expect.stringContaining("_side"), "s"],
      [expect.stringContaining("_back45"), "b45"],
    ]);
  });

  it("45 → renderMultiAngle 命中 45 角度帧（非 front 帧，审查 P1 回归）", async () => {
    renderMultiAngle.mockResolvedValue([
      { name: "front", base64: "f" },
      { name: "45", base64: "45" },
    ]);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel(), "45", setShotState, screenshotFn);
    expect(saveFile).toHaveBeenCalledWith(expect.stringContaining("_45"), "45");
  });

  it("front → renderMultiAngle 命中 front 角度", async () => {
    renderMultiAngle.mockResolvedValue([{ name: "front", base64: "f" }]);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel(), "front", setShotState, screenshotFn);
    expect(renderMultiAngle).toHaveBeenCalledWith(
      "/m/a.ysm",
      [""],
      expect.objectContaining({ size: 512, decodeYsm: expect.any(Function) }),
    );
    expect(saveFile).toHaveBeenCalledWith(expect.stringContaining("_front"), "f");
  });

  it("renderMultiAngle 返回 null → 不调 saveFile（静默）", async () => {
    renderMultiAngle.mockResolvedValue(null);
    saveFile.mockResolvedValue(undefined);
    const setShotState = vi.fn();
    await saveScreenshot(makeModel(), "front", setShotState, screenshotFn);
    expect(saveFile).not.toHaveBeenCalled();
  });
});

// skeleton-utils（sec/iRow/buildDepthMap）已于 G3 复查确认生产零引用，整文件删除（2026-09-04）。
// 相关直测随死代码一并移除；面板 sec/iRow 的活体实现在 skeleton-fill-panel.ts（sfp- 类）。
