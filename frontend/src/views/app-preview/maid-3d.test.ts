// ===== 车万女仆详情预览测试 =====
// 覆盖：showMaidPreview 渲染彩色分区（statsCardHTML 复用）、GetModel3DSpec 单视图收敛
// （ADR-255：模型结构蓝卡静态逐角色行，取代 dp-submodels 交互清单 + Entry 逐角色预取）、
// metadata 段、spec 失败回落聚合口径、封面替换、FAB 进整包 3D。
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewCtx } from "./utils.ts";

const { analyzeMock, specMock, mountMock, cleanupMock, makeAdapterMock, loadModelDataMock, preloadMock, androidBackMock } = vi.hoisted(() => ({
  analyzeMock: vi.fn(),
  specMock: vi.fn(),
  mountMock: vi.fn().mockResolvedValue(undefined),
  cleanupMock: vi.fn(),
  makeAdapterMock: vi.fn((_path: unknown, _opts: unknown) => ({})),
  loadModelDataMock: vi.fn(),
  preloadMock: vi.fn(),
  androidBackMock: vi.fn(() => () => {}),
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    AnalyzeBedrockModel: analyzeMock,
    GetModel3DSpec: specMock,
    ReadFileBytes: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("../../preview-3d/adapters/mount-preview-core.ts", () => ({
  mount3D: mountMock,
  cleanupPreview: cleanupMock,
  invalidatePreview: vi.fn(),
}));
vi.mock("../../preview-3d/adapters/ysm-adapter.ts", () => ({
  makeYsmAdapter: makeAdapterMock,
}));
vi.mock("./loader.ts", () => ({
  loadModelData: loadModelDataMock,
}));
vi.mock("./model3d-loader.ts", () => ({
  preloadModel: preloadMock,
}));
vi.mock("./ysm-controls.ts", () => ({
  fillYsmShotPanel: vi.fn(),
  ysmShotNodes: vi.fn(() => []),
  // createMaid3D 构造 adapter panels 时同步读取 registerYsmModelSchema——
  // mock 缺此导出会在 makeYsmAdapter 调用前抛错（vitest mock 读取缺失导出即抛）
  registerYsmModelSchema: vi.fn(),
}));
vi.mock("./preview-library.ts", () => ({
  registerReRoute: vi.fn(),
  withPreviewExtras: (o: unknown) => o,
}));
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  registerAndroidBackHandler: androidBackMock,
}));
vi.mock("./skeleton.ts", () => ({
  setActive3DClose: vi.fn(),
}));

import { showMaidPreview } from "./maid-3d.ts";

function makeCtx(over: Partial<PreviewCtx> = {}): PreviewCtx {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  return {
    root,
    loadPreviewImage: vi.fn().mockResolvedValue(null),
    unsubs: [],
    decodeYsmViaWasm: vi.fn(),
    appendDebug: vi.fn(),
    ...over,
  };
}

function baseModel(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    boneCount: 196,
    cubeCount: 922,
    format: "1.20.0",
    texWidth: 128,
    texHeight: 256,
    textureNames: ["main", "arm"],
    textureCategories: ["player", "player"],
    textures: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"],
    metadata: {
      name: "Eanes（彩虹六号X碧蓝档案原创同人角色）",
      tips: "来自巴特蕾特学院。",
      license: { type: "CC BY-NC-SA 4.0" },
      authors: [{ name: "作者A", role: "模型原作", contact: { Bilibili: "https://b23.tv/x" } }],
    },
    ...over,
  };
}

/** GetModel3DSpec 契约（ADR-255）：zip 内每个 geo 文件 = 一个组件（= L0 角色），
 *  蓝卡行 = spec.models 投影（骨骼 = bones.length，立方体 = Σ _cubeCount） */
function baseSpec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    models: [
      { id: "comp_0", name: "Eanes", bones: [{ _cubeCount: 44 }, { _cubeCount: 44 }], textureWidth: 128, textureHeight: 256 },
      { id: "comp_1", name: "备用", bones: [{ _cubeCount: 7 }], textureWidth: 128, textureHeight: 256 },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  analyzeMock.mockResolvedValue(baseModel());
  specMock.mockResolvedValue(baseSpec());
});

describe("showMaidPreview 车万女仆详情", () => {
  it("复用 statsCardHTML 彩色分区：模型结构蓝卡 / 纹理尺寸绿卡 / 文件信息橙卡", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    expect(html).toContain("pv-section-blue");
    expect(html).toContain("pv-section-green");
    expect(html).toContain("pv-section-orange");
    expect(html).toContain("128 × 256");
    expect(html).toContain(".zip");
  });

  it("模型结构蓝卡静态逐角色行（GetModel3DSpec 单视图，不点击即见）", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    // spec.models 投影为蓝卡行：Eanes 2 骨骼 · 88 立方体 / 备用 1 骨骼 · 7 立方体
    // （数值包在 .pv-card-val span 内，故按蓝卡行 DOM 逐行断言 textContent）
    expect(specMock).toHaveBeenCalledWith("/repo/maid.zip");
    const rows = Array.from(ctx.root.querySelectorAll(".pv-section-blue .pv-card-row") ?? []);
    const texts = rows.map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("Eanes");
    expect(texts[0]).toContain("2 骨骼");
    expect(texts[0]).toContain("88 立方体");
    expect(texts[1]).toContain("备用");
    expect(texts[1]).toContain("1 骨骼");
    expect(texts[1]).toContain("7 立方体");
    // 不再渲染交互式角色清单（dp-submodels/chip 全移除）
    expect(html).not.toContain("dp-submodels");
    expect(html).not.toContain("dp-sublist");
    expect(html).not.toContain("chip-stat");
  });

  it("渲染 metadata 段：名称 / 许可 / 作者 / tips", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    expect(html).toContain("Eanes（彩虹六号X碧蓝档案原创同人角色）");
    expect(html).toContain("CC BY-NC-SA 4.0");
    expect(html).toContain("作者A");
    expect(html).toContain("来自巴特蕾特学院。");
  });

  it("extraCount = texCount - 组件数（2 组件 2 纹理 → 无额外纹理行）", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    expect(html).not.toContain("额外纹理");
    expect(html).toContain("角色纹理 2 张");
  });

  it("GetModel3DSpec 失败/无组件 → 回落 AnalyzeBedrockModel 聚合口径（大字 196/922）", async () => {
    specMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    // 无组件行：蓝卡回落为单一聚合行（骨骼/立方体大字）；
    // 断言以「蓝卡行集合无逐组件行」为准——不能 not.toContain("Eanes")，
    // metadata.name 合法携带 "Eanes"（彩虹六号同人），会误伤。
    const rows = Array.from(ctx.root.querySelectorAll(".pv-section-blue .pv-card-row") ?? []);
    const texts = rows.map((r) => (r.textContent ?? "").replace(/\s+/g, " ").trim());
    expect(rows).toHaveLength(1);
    expect(texts[0]).toContain("196");
    expect(texts[0]).toContain("922");
    expect(texts[0]).not.toContain("骨骼 ·"); // 无「N 骨骼 · M 立方体」逐组件行句式
  });

  it("AnalyzeBedrockModel 失败 → 降级显示无法读取提示", async () => {
    analyzeMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    expect(ctx.root.innerHTML).toContain("无法读取模型数据");
  });

  it("FAB 进整包 3D：不传 subModelIdx/subPath（角色切换在 3D 内组件下拉）", async () => {
    loadModelDataMock.mockResolvedValue({ model: { bones: [], cubeCount: 0 } });
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const btn = ctx.root.getElementById("btn-3d-preview");
    expect(btn).toBeTruthy();
    btn!.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(makeAdapterMock).toHaveBeenCalled();
    expect(cleanupMock).toHaveBeenCalled();
    expect(mountMock).toHaveBeenCalled();
    const adapterOpts = (makeAdapterMock.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    // 整包加载语义：adapter 不再携带单 entry 选择参数
    expect(adapterOpts).not.toHaveProperty("subModelIdx");
    expect(adapterOpts).not.toHaveProperty("subPath");
    expect(typeof adapterOpts.loader).toBe("function");
  });

  it("loadPreviewImage 返回封面 → 渲染 img 替换 🧸 大图标", async () => {
    const ctx = makeCtx({
      loadPreviewImage: vi.fn().mockResolvedValue("data:image/png;base64,COVER"),
    });
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    expect(html).toContain('<img src="data:image/png;base64,COVER"');
    expect(ctx.root.querySelector(".dp-placeholder .big-icon")).toBeNull();
  });

  it("loadPreviewImage 返回 null → 回退 🧸 大图标", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    expect(html).not.toContain("<img");
    expect(html).toContain('<div class="big-icon">🧸</div>');
  });

  it("占位符带紧凑头部类（dp-placeholder--head，避免 24px 空态留白）", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    expect(ctx.root.innerHTML).toContain('class="dp-placeholder dp-placeholder--head"');
  });
});
