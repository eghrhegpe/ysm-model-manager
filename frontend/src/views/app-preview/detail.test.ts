// ===== 详情面板测试 =====
// 覆盖：showShaderPack 简单类型渲染、showResourcePack 资源包信息成功/失败、
// showModelDetail YSM 详情渲染与解析失败分支
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewCtx } from "./utils.ts";

const { summaryMock, headerMock, readPackMock } = vi.hoisted(() => ({
  summaryMock: vi.fn(),
  headerMock: vi.fn(),
  readPackMock: vi.fn(),
}));

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ExtractYsmSummary: summaryMock,
    ExtractYSMHeader: headerMock,
    ReadPackMeta: readPackMock,
  }),
}));
vi.mock("./skeleton.ts", () => ({
  loadModel2D: vi.fn().mockResolvedValue(undefined),
}));

import { showModelDetail, showResourcePack, showShaderPack } from "./detail.ts";

function makeCtx(): PreviewCtx {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  return {
    _root: root,
    _loadPreviewImage: vi.fn().mockResolvedValue(null),
    _unsubs: [],
    decodeYsmViaWasm: vi.fn(),
    _decodeYsmViaWasm: vi.fn(),
    _appendDebug: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  summaryMock.mockResolvedValue(null);
  headerMock.mockResolvedValue(null);
  readPackMock.mockResolvedValue("{}");
  localStorage.clear();
});

describe("showShaderPack 简单类型预览", () => {
  it("渲染图标、标签与文件名", async () => {
    const ctx = makeCtx();
    await showShaderPack(ctx, "/dir/光影包.zip", { icon: "☀️", label: "光影包" });
    expect(ctx._root.innerHTML).toContain("☀️ 光影包");
    expect(ctx._root.innerHTML).toContain("光影包.zip");
  });

  it("无 opts → 默认图标与标签", async () => {
    const ctx = makeCtx();
    await showShaderPack(ctx, "/dir/x.ysm");
    expect(ctx._root.innerHTML).toContain("☀️ 光影包");
  });
});

describe("showResourcePack 资源包信息", () => {
  it("成功 → 渲染描述与 pack_format 版本", async () => {
    readPackMock.mockResolvedValue(
      JSON.stringify({
        description: "测试资源包",
        pack_format: 12,
        min_format: [8, 12],
        max_format: [12, 13],
      }),
    );
    const ctx = makeCtx();
    await showResourcePack(ctx, "/packs/pack.mcmeta");
    expect(ctx._root.innerHTML).toContain("测试资源包");
    // describeVersionRange：min_format[0] ~ max_format[last]（验证 P1 修复的 Max 不丢）
    expect(ctx._root.innerHTML).toContain("pack_format: 8 ~ 13");
  });

  it("读取失败 → 错误占位", async () => {
    readPackMock.mockRejectedValue(new Error("ENOENT"));
    const ctx = makeCtx();
    await showResourcePack(ctx, "/packs/bad.mcmeta");
    expect(ctx._root.innerHTML).toContain("读取失败");
  });
});

describe("showModelDetail YSM 详情", () => {
  it("解析到有效摘要 → 渲染详情卡 + 作者头像槽位", async () => {
    summaryMock.mockResolvedValue({
      name: "角色A",
      stats: { textures: 2, models: 1 },
    });
    headerMock.mockResolvedValue({ isYsm: true, version: 20 });
    const ctx = makeCtx();
    await showModelDetail(ctx, "/repo/角色A.ysm");
    expect(ctx._root.innerHTML).toContain("preview-content");
    expect(ctx._root.innerHTML).toContain("ysm-author-avatars");
    expect(ctx._root.innerHTML).toContain("角色A");
    // 占位已替换为详情卡
    expect(ctx._root.innerHTML).not.toContain("正在解析模型文件");
  });

  it("无摘要无头部 → 无法解析错误分支", async () => {
    summaryMock.mockResolvedValue(null);
    headerMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await showModelDetail(ctx, "/repo/坏.ysm");
    expect(ctx._root.innerHTML).toContain("无法解析此文件");
  });

  it("ExtractYsmSummary 抛错 → 错误占位（gen 一致时不静默）", async () => {
    summaryMock.mockRejectedValue(new Error("boom"));
    const ctx = makeCtx();
    await showModelDetail(ctx, "/repo/err.ysm");
    expect(ctx._root.innerHTML).toContain("解析失败");
  });
});
