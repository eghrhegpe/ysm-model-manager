// ===== 详情面板测试 =====
// 覆盖：showSimplePreview 简单类型渲染、showResourcePack 资源包信息成功/失败、
// showModelDetail YSM 详情渲染与解析失败分支
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewCtx } from "./utils.ts";

const { summaryMock, headerMock, readPackMock, vrmMetaMock, createVrm3DMock, createMmd3DMock, resolveMmdSiblingsMock, readFileBytesMock, readPmxStatsMock } = vi.hoisted(() => ({
  summaryMock: vi.fn(),
  headerMock: vi.fn(),
  readPackMock: vi.fn(),
  vrmMetaMock: vi.fn(),
  createVrm3DMock: vi.fn(),
  createMmd3DMock: vi.fn(),
  resolveMmdSiblingsMock: vi.fn(),
  readFileBytesMock: vi.fn(),
  readPmxStatsMock: vi.fn(),
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ExtractYsmSummary: summaryMock,
    ExtractYSMHeader: headerMock,
    ReadPackMeta: readPackMock,
    ReadFileBytes: readFileBytesMock,
  }),
}));
vi.mock("../../utils/3d/adapters/mmd-detail-stats.ts", () => ({
  readPmxStats: readPmxStatsMock,
}));
vi.mock("./skeleton.ts", () => ({
  loadModel2D: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/3d/adapters/vrm-adapter.ts", () => ({
  readVrmMeta: vrmMetaMock,
}));
// ADR-072 根治：薄包装（vrm-3d/mmd-3d）已归位 views/app-preview，mock 路径同目录；
// resolveMmdSiblings 归位 mmd-siblings.ts
vi.mock("./vrm-3d.ts", () => ({
  createVrm3D: createVrm3DMock,
}));
vi.mock("./mmd-3d.ts", () => ({
  createMmd3D: createMmd3DMock,
}));
vi.mock("./mmd-siblings.ts", () => ({
  resolveMmdSiblings: resolveMmdSiblingsMock,
}));

import { showModelDetail, showResourcePack, showSimplePreview } from "./detail.ts";
import { showVrmMeta, showMmdPreview } from "./detail-3d.ts";

function makeCtx(): PreviewCtx {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  return {
    root: root,
    loadPreviewImage: vi.fn().mockResolvedValue(null),
    unsubs: [],
    decodeYsmViaWasm: vi.fn(),
    appendDebug: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  summaryMock.mockResolvedValue(null);
  headerMock.mockResolvedValue(null);
  readPackMock.mockResolvedValue("{}");
  resolveMmdSiblingsMock.mockResolvedValue([]);
  readFileBytesMock.mockResolvedValue(btoa("PMX"));
  readPmxStatsMock.mockResolvedValue(null);
  localStorage.clear();
});

describe("showSimplePreview 简单类型预览", () => {
  it("渲染图标、标签与文件名", async () => {
    const ctx = makeCtx();
    await showSimplePreview(ctx, "/dir/光影包.zip", { icon: "☀️", label: "光影包" });
    expect(ctx.root.innerHTML).toContain("☀️ 光影包");
    expect(ctx.root.innerHTML).toContain("光影包.zip");
  });

  it("无 opts → 默认图标与标签", async () => {
    const ctx = makeCtx();
    await showSimplePreview(ctx, "/dir/x.ysm");
    expect(ctx.root.innerHTML).toContain("☀️ 光影包");
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
    expect(ctx.root.innerHTML).toContain("测试资源包");
    // describeVersionRange：min_format[0] ~ max_format[last]（验证 P1 修复的 Max 不丢）
    expect(ctx.root.innerHTML).toContain("pack_format: 8 ~ 13");
  });

  it("读取失败 → 错误占位", async () => {
    readPackMock.mockRejectedValue(new Error("ENOENT"));
    const ctx = makeCtx();
    await showResourcePack(ctx, "/packs/bad.mcmeta");
    expect(ctx.root.innerHTML).toContain("读取失败");
  });
});

describe("showModelDetail YSM 详情", () => {
  it("解析到有效摘要 → 渲染详情卡（顶部头像槽位已移除，作者由底部统计卡承载）", async () => {
    summaryMock.mockResolvedValue({
      name: "角色A",
      stats: { textures: 2, models: 1 },
    });
    headerMock.mockResolvedValue({ isYsm: true, version: 20 });
    const ctx = makeCtx();
    await showModelDetail(ctx, "/repo/角色A.ysm");
    expect(ctx.root.innerHTML).toContain("preview-content");
    expect(ctx.root.innerHTML).toContain("角色A");
    // 方案 A（2026-08-28）：顶部 ysm-author-avatars 小头像行已移除，作者/头像由统计卡承载
    expect(ctx.root.innerHTML).not.toContain("ysm-author-avatars");
    // 占位已替换为详情卡
    expect(ctx.root.innerHTML).not.toContain("正在解析模型文件");
  });

  it("无摘要无头部 → 无法解析错误分支", async () => {
    summaryMock.mockResolvedValue(null);
    headerMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await showModelDetail(ctx, "/repo/坏.ysm");
    expect(ctx.root.innerHTML).toContain("无法解析此文件");
  });

  it("ExtractYsmSummary 抛错 → 错误占位（gen 一致时不静默）", async () => {
    summaryMock.mockRejectedValue(new Error("boom"));
    const ctx = makeCtx();
    await showModelDetail(ctx, "/repo/err.ysm");
    expect(ctx.root.innerHTML).toContain("解析失败");
  });
});

describe("showVrmMeta VRM meta 卡", () => {
  it("有 meta → 渲染名称/作者/许可/版本 + FAB 进 3D", async () => {
    vrmMetaMock.mockResolvedValue({
      name: "测试模型",
      authors: ["作者A", "作者B"],
      version: "1.0",
      license: "CC_BY",
      contact: "contact@example.com",
      thumbnail: "data:image/png;base64,AAA",
      metaVersion: "1",
    });
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/avatar.vrm");
    const html = ctx.root.innerHTML;
    expect(html).toContain("测试模型");
    expect(html).toContain("作者A");
    expect(html).toContain("CC_BY");
    expect(html).toContain("btn-vrm-3d");
    // FAB 点击 → createVrm3D
    const fab = ctx.root.querySelector<HTMLElement>("#btn-vrm-3d");
    expect(fab).not.toBeNull();
    fab?.click();
    expect(createVrm3DMock).toHaveBeenCalledWith("/repo/avatar.vrm");
  });

  it("无 meta（非标准 VRM）→ 仅文件名 + FAB 仍可进 3D", async () => {
    vrmMetaMock.mockResolvedValue(null);
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/avatar.vrm");
    const html = ctx.root.innerHTML;
    expect(html).toContain("avatar.vrm");
    expect(html).toContain("btn-vrm-3d");
    // 不应渲染作者/许可空行
    expect(html).not.toContain("作者");
  });

  it("readVrmMeta 抛错 → 错误占位（gen 一致时不静默）", async () => {
    vrmMetaMock.mockRejectedValue(new Error("parse fail"));
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/bad.vrm");
    expect(ctx.root.innerHTML).toContain("读取失败");
  });

  it("有 stats（ADR-131 P2）→ 渲染渲染实测统计行；无 stats → 不渲染", async () => {
    vrmMetaMock.mockResolvedValueOnce({
      name: "带统计模型",
      authors: [],
      metaVersion: "1",
      stats: {
        boneCount: 52,
        meshCount: 8,
        triangleCount: 12000,
        materialCount: 3,
        textureCount: 1,
        morphCount: 6,
      },
    });
    const ctx = makeCtx();
    await showVrmMeta(ctx, "/repo/stats.vrm");
    const html = ctx.root.innerHTML;
    expect(html).toContain("渲染实测"); // 口径标注（审核建议 ②）
    expect(html).toContain("52");
    expect(html).toContain("12,000");
    expect(html).toContain("表情");

    // 无 stats → 无统计行
    vrmMetaMock.mockResolvedValueOnce({ name: "无统计", authors: [], metaVersion: "1" });
    const ctx2 = makeCtx();
    await showVrmMeta(ctx2, "/repo/nostats.vrm");
    expect(ctx2.root.innerHTML).not.toContain("渲染实测");
  });
});

describe("showMmdPreview MMD 预览卡", () => {
  it("渲染标签 + 文件名 + FAB，点击 → resolveMmdSiblings 后 createMmd3D(path, {siblings})", async () => {
    resolveMmdSiblingsMock.mockResolvedValue(["/repo/other.pmx", "/repo/third.pmd"]);
    const ctx = makeCtx();
    await showMmdPreview(ctx, "/repo/miku.pmx");
    const html = ctx.root.innerHTML;
    expect(html).toContain("miku.pmx");
    expect(html).toContain("btn-mmd-3d");
    const fab = ctx.root.querySelector<HTMLElement>("#btn-mmd-3d");
    expect(fab).not.toBeNull();
    fab?.click();
    // 3D 内换模型（ADR-066 §5.6）：siblings 随 opts 传入，核心渲染 topBar 切换下拉
    await vi.waitFor(() =>
      expect(createMmd3DMock).toHaveBeenCalledWith("/repo/miku.pmx", {
        siblings: ["/repo/other.pmx", "/repo/third.pmd"],
      }),
    );
  });

  it("自定义 opts → 使用传入图标与标签", async () => {
    const ctx = makeCtx();
    await showMmdPreview(ctx, "/repo/模型.pmd", { icon: "🎭", label: "MMD 角色模型" });
    expect(ctx.root.innerHTML).toContain("🎭 MMD 角色模型");
    expect(ctx.root.innerHTML).toContain("模型.pmd");
  });

  it(".pmx 有统计（ADR-131 P2）→ 异步补文件统计行；非 .pmx 不触发解析", async () => {
    readPmxStatsMock.mockResolvedValue({
      vertices: 12500,
      faces: 25000,
      bones: 42,
      materials: 5,
      morphs: 8,
    });
    const ctx = makeCtx();
    await showMmdPreview(ctx, "/repo/miku2.pmx");
    await vi.waitFor(() => {
      const html = ctx.root.innerHTML;
      expect(html).toContain("文件统计"); // PMX 解析口径标注
      expect(html).toContain("12,500");
      expect(html).toContain("25,000");
      expect(html).toContain("42");
    });
    expect(readPmxStatsMock).toHaveBeenCalledWith(
      "/repo/miku2.pmx",
      expect.any(Function),
    );

    // 非 .pmx（如 .pmd）不触发 Worker 解析（文件统计不可得，基础卡不受影响）
    const ctx2 = makeCtx();
    await showMmdPreview(ctx2, "/repo/old.pmd");
    expect(readPmxStatsMock).not.toHaveBeenCalledWith(
      "/repo/old.pmd",
      expect.any(Function),
    );
  });
});
