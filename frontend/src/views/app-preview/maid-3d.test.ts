// ===== 车万女仆详情预览测试 =====
// 覆盖：showMaidPreview 渲染彩色分区（statsCardHTML 复用）、交互角色清单保留、metadata 段。
// 数据源：Go AnalyzeBedrockModel 返回 types.BedrockModel（与 YSM 同一结构）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewCtx } from "./utils.ts";

const { analyzeMock, mountMock, cleanupMock, makeAdapterMock, loadModelDataMock, preloadMock, androidBackMock } = vi.hoisted(() => ({
  analyzeMock: vi.fn(),
  mountMock: vi.fn().mockResolvedValue(undefined),
  cleanupMock: vi.fn(),
  makeAdapterMock: vi.fn(() => ({})),
  loadModelDataMock: vi.fn(),
  preloadMock: vi.fn(),
  androidBackMock: vi.fn(() => () => {}),
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    AnalyzeBedrockModel: analyzeMock,
    ReadFileBytes: vi.fn().mockResolvedValue(null),
  }),
}));
vi.mock("../../utils/3d/adapters/mount-preview-core.ts", () => ({
  mount3D: mountMock,
  cleanupPreview: cleanupMock,
  invalidatePreview: vi.fn(),
}));
vi.mock("../../utils/3d/adapters/ysm-adapter.ts", () => ({
  makeYsmAdapter: makeAdapterMock,
}));
vi.mock("./loader.ts", () => ({
  loadModelData: loadModelDataMock,
}));
vi.mock("./model3d-loader.ts", () => ({
  preloadModel: preloadMock,
}));
vi.mock("./ysm-controls.ts", () => ({
  fillYsmModelPanel: vi.fn(),
  fillYsmShotPanel: vi.fn(),
  attachYsmBoneSelect: vi.fn(),
}));
vi.mock("./preview-library.ts", () => ({
  registerReRoute: vi.fn(),
  withPreviewExtras: (o: unknown) => o,
}));
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  registerAndroidBackHandler: androidBackMock,
}));
// skeleton.ts 顶部有窗口级事件，mock 掉 3D 切换入口
vi.mock("./skeleton.ts", () => ({
  setActive3DClose: vi.fn(),
}));

import { showMaidPreview } from "./maid-3d.ts";

function makeCtx(): PreviewCtx {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  return {
    root,
    loadPreviewImage: vi.fn().mockResolvedValue(null),
    unsubs: [],
    decodeYsmViaWasm: vi.fn(),
    appendDebug: vi.fn(),
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
    subModels: [
      { name: "Eanes", texSlot: 0, sourcePath: "models/main.geo.json" },
      { name: "备用", texSlot: 1, sourcePath: "models/arm.geo.json" },
    ],
    metadata: {
      name: "Eanes（彩虹六号X碧蓝档案原创同人角色）",
      tips: "来自巴特蕾特学院。",
      license: { type: "CC BY-NC-SA 4.0" },
      authors: [{ name: "作者A", role: "模型原作", contact: { Bilibili: "https://b23.tv/x" } }],
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  analyzeMock.mockResolvedValue(baseModel());
});

describe("showMaidPreview 车万女仆详情", () => {
  it("复用 statsCardHTML 彩色分区：模型结构蓝卡 / 纹理尺寸绿卡 / 文件信息橙卡", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    // 彩色分区三卡
    expect(html).toContain("pv-section-blue");
    expect(html).toContain("pv-section-green");
    expect(html).toContain("pv-section-orange");
    // 骨骼/立方体数值高亮
    expect(html).toContain("196");
    expect(html).toContain("922");
    expect(html).toContain("128 × 256");
    // 文件格式信息（.zip）
    expect(html).toContain(".zip");
  });

  it("保留交互式角色清单（dp-submodels，maid 独有）", async () => {
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    const html = ctx.root.innerHTML;
    expect(html).toContain("dp-submodels");
    expect(html).toContain("dp-sublist");
    expect(html).toContain("Eanes");
    expect(html).toContain("备用");
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

  it("AnalyzeBedrockModel 失败 → 降级显示无法读取提示", async () => {
    analyzeMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await showMaidPreview(ctx, "/repo/maid.zip");
    expect(ctx.root.innerHTML).toContain("无法读取模型数据");
  });
});
