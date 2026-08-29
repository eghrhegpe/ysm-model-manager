// ===== 详情面板测试 =====
// 覆盖：showSimplePreview 简单类型渲染、showResourcePack 资源包信息成功/失败、
// showModelDetail YSM 详情渲染与解析失败分支
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewCtx } from "./utils.ts";

const { summaryMock, headerMock, readPackMock, vrmMetaMock, createVrm3DMock, createMmd3DMock, resolveMmdSiblingsMock, readFileBytesMock, readPmxStatsMock, packModelsMock, createPack3DMock, loadModel2DMock, shaderLangMock, wasmDecodeMock } = vi.hoisted(() => ({
  summaryMock: vi.fn(),
  headerMock: vi.fn(),
  readPackMock: vi.fn(),
  vrmMetaMock: vi.fn(),
  createVrm3DMock: vi.fn(),
  createMmd3DMock: vi.fn(),
  resolveMmdSiblingsMock: vi.fn(),
  readFileBytesMock: vi.fn(),
  readPmxStatsMock: vi.fn(),
  packModelsMock: vi.fn(),
  createPack3DMock: vi.fn(),
  loadModel2DMock: vi.fn().mockResolvedValue(undefined),
  shaderLangMock: vi.fn(),
  wasmDecodeMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ExtractYsmSummary: summaryMock,
    ExtractYSMHeader: headerMock,
    ReadPackMeta: readPackMock,
    ReadFileBytes: readFileBytesMock,
    ListPackModelsDetail: packModelsMock,
    ReadShaderpackLang: shaderLangMock,
  }),
}));
vi.mock("./wasm.ts", () => ({
  decodeYsmViaWasm: wasmDecodeMock,
}));
vi.mock("./pack-3d.ts", () => ({
  createPack3D: createPack3DMock,
}));
vi.mock("../../utils/3d/adapters/mmd-detail-stats.ts", () => ({
  readPmxStats: readPmxStatsMock,
}));
vi.mock("./skeleton.ts", () => ({ loadModel2D: loadModel2DMock }));
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

import { showModelDetail, showResourcePack, showSimplePreview, showShaderpack, detailGen } from "./detail.ts";
import { waitFor, sleep } from "../../test-utils/index.ts";
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
  packModelsMock.mockResolvedValue("{\"models\":[],\"total\":0}");
  shaderLangMock.mockResolvedValue("{}");
  createPack3DMock.mockResolvedValue(undefined);
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

  it("模型清单（ADR-131 P3）：渲染 path + 方块数，点击直达 3D（startEntry）", async () => {
    readPackMock.mockResolvedValue(JSON.stringify({ description: "包", pack_format: 12 }));
    packModelsMock.mockResolvedValue(JSON.stringify({
      models: [
        { path: "assets/minecraft/models/block/door.json", cubes: 1 },
        { path: "assets/minecraft/models/block/wall.json", cubes: 3 },
      ],
      total: 2,
    }));
    const ctx = makeCtx();
    await showResourcePack(ctx, "/packs/pack.mcmeta");
    // 异步清单区补渲染：等 packModelsMock 调用后 host 出现
    await vi.waitFor(() => {
      expect(ctx.root.innerHTML).toContain("模型清单");
      expect(ctx.root.innerHTML).toContain("door.json");
      expect(ctx.root.innerHTML).toContain("3 方块");
    });
    expect(packModelsMock).toHaveBeenCalledWith("/packs/pack.mcmeta");
    // 点击 door 模型行 → 直达 3D 且带 startEntry
    const doorRow = [...ctx.root.querySelectorAll<HTMLElement>(".pack-model-item")].find(
      (el) => el.dataset.entry?.includes("door.json"),
    );
    expect(doorRow).toBeTruthy();
    doorRow!.click();
    await vi.waitFor(() =>
      expect(createPack3DMock).toHaveBeenCalledWith("/packs/pack.mcmeta", { startEntry: "assets/minecraft/models/block/door.json" }),
    );
  });

  it("模型清单：无模型 / total 0 → 不渲染清单区（仅 FAB）", async () => {
    readPackMock.mockResolvedValue(JSON.stringify({}, ));
    const ctx = makeCtx();
    await showResourcePack(ctx, "/packs/empty.mcmeta");
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.root.innerHTML).not.toContain("模型清单");
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

// ===== 覆盖率补强：tab 切换 / gen 过期守卫 / shaderpack 详情 / 模型清单竞态 =====
describe("showModelDetail — tab 切换（switchTab）", () => {
  it("点击 skeleton tab → 落盘偏好 + 面板显隐切换", async () => {
    const ctx = makeCtx();
    await showModelDetail(ctx, "/m/a.ysm");
    const skelTab = ctx.root.querySelector('.pv-tab[data-tab="skeleton"]') as HTMLElement;
    skelTab.click();
    expect(localStorage.getItem("ysm_previewTab")).toBe("skeleton");
    expect(skelTab.classList.contains("pv-tab-active")).toBe(true);
    const detail = ctx.root.getElementById("preview-detail") as HTMLElement;
    const skel = ctx.root.getElementById("preview-skeleton") as HTMLElement;
    expect(detail.style.display).toBe("none");
    expect(skel.style.display).toBe("");
    // 切回 detail
    (ctx.root.querySelector('.pv-tab[data-tab="detail"]') as HTMLElement).click();
    expect(localStorage.getItem("ysm_previewTab")).toBe("detail");
    expect((ctx.root.getElementById("preview-detail") as HTMLElement).style.display).toBe("");
  });

  it("持久化 ysm_previewTab=skeleton → 初始渲染骨架 tab 激活", async () => {
    localStorage.setItem("ysm_previewTab", "skeleton");
    const ctx = makeCtx();
    await showModelDetail(ctx, "/m/a.ysm");
    const skelTab = ctx.root.querySelector('.pv-tab[data-tab="skeleton"]') as HTMLElement;
    expect(skelTab.classList.contains("pv-tab-active")).toBe(true);
    expect((ctx.root.getElementById("preview-detail") as HTMLElement).style.display).toBe("none");
  });
});

describe("detailGen 过期守卫（在途请求作废）", () => {
  it("loadPreviewImage 在途时切走 → 恢复后 61 早退，不发请求", async () => {
    const ctx = makeCtx();
    let resolvePreview: (v: null) => void = () => {};
    vi.mocked(ctx.loadPreviewImage).mockImplementationOnce(
      () => new Promise<null>((r) => (resolvePreview = r)),
    );
    const pending = showModelDetail(ctx, "/m/stale.ysm");
    detailGen.invalidate(); // 用户切走
    resolvePreview(null);
    await pending;
    expect(summaryMock).not.toHaveBeenCalled();
  });

  it("ExtractYsmSummary 在途时切走 → 恢复后 70 早退", async () => {
    const ctx = makeCtx();
    let resolveSummary: (v: null) => void = () => {};
    summaryMock.mockImplementationOnce(() => new Promise<null>((r) => (resolveSummary = r)));
    const pending = showModelDetail(ctx, "/m/stale2.ysm");
    await vi.waitFor(() => expect(summaryMock).toHaveBeenCalled());
    detailGen.invalidate();
    resolveSummary(null);
    await pending;
    const detail = ctx.root.getElementById("preview-detail") as HTMLElement;
    expect(detail.innerHTML).toContain("⏳"); // 停留在加载占位，未回写
  });

  it("摘要无实义 → decodeYsmViaWasm 补全成功（95 enriched）", async () => {
    const ctx = makeCtx();
    wasmDecodeMock.mockResolvedValue({
      animGroups: [{ name: "idle" }],
      authors: [{ name: "作者A", role: "建模" }],
    });
    headerMock.mockResolvedValue({ name: "加密模", tips: "提示", license: "CC", linkHome: "https://x" });
    await showModelDetail(ctx, "/m/enc.ysm");
    expect(wasmDecodeMock).toHaveBeenCalledWith("/m/enc.ysm");
    // enriched 生成 → showSummary 非空 → 走 summaryCardHTML 渲染（header 信息上卡），
    // 作者头像由 loadModel2D 链的统计卡承载（本文件已 mock 该链）
    const detail = ctx.root.getElementById("preview-detail") as HTMLElement;
    expect(detail.innerHTML).toContain("加密模");
    expect(loadModel2DMock).toHaveBeenCalled();
  });

  it("loadModel2D 拒绝 → console.warn 兜底（132）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    summaryMock.mockResolvedValue({ stats: { models: 3 } });
    loadModel2DMock.mockRejectedValueOnce(new Error("2d boom"));
    const ctx = makeCtx();
    await showModelDetail(ctx, "/m/warn.ysm");
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });

  it("ReadPackMeta 在途时切走 → 恢复后 153 早退", async () => {
    const ctx = makeCtx();
    let resolveRead: (v: string) => void = () => {};
    readPackMock.mockImplementationOnce(() => new Promise<string>((r) => (resolveRead = r)));
    const pending = showResourcePack(ctx, "/p/a.zip");
    await vi.waitFor(() => expect(readPackMock).toHaveBeenCalled());
    detailGen.invalidate();
    resolveRead("{}");
    await pending;
    expect(ctx.root.getElementById("preview-content")).toBeNull();
  });

  it("ListPackModelsDetail 在途时切走 → 恢复后 203 静默早退", async () => {
    const ctx = makeCtx();
    let resolveList: (v: string) => void = () => {};
    packModelsMock.mockImplementationOnce(() => new Promise<string>((r) => (resolveList = r)));
    readPackMock.mockResolvedValue(
      JSON.stringify({ pack: { pack_format: 15, description: "x" } }),
    );
    await showResourcePack(ctx, "/p/stale.zip");
    detailGen.invalidate();
    resolveList(JSON.stringify({ models: [{ path: "assets/a.json", cubes: 2 }], total: 1 }));
    await sleep(50);
    expect(ctx.root.querySelector(".pack-model-item")).toBeNull();
  });

  it("FAB 点击 → createPack3D（182）", async () => {
    const ctx = makeCtx();
    await showResourcePack(ctx, "/p/fab.zip");
    const fab = ctx.root.querySelector("#btn-pack-model-3d") as HTMLButtonElement;
    fab.click();
    expect(createPack3DMock).toHaveBeenCalledWith("/p/fab.zip");
  });
});


describe("showShaderpack 光影包详情", () => {
  beforeEach(() => {
    shaderLangMock.mockResolvedValue("{}");
  });

  it("成功：displayName + .comment 配置简介（去 § 格式码，截前 3 条）", async () => {
    shaderLangMock.mockResolvedValue(
      JSON.stringify({
        name: "光影A",
        entries: {
          "settings.comment": "§a第一§c条",
          "quality.comment": "第二条",
          "shadow.comment": "第三条",
          "misc.comment": "第四条（应被截断）",
          "unrelated": "v",
        },
      }),
    );
    const ctx = makeCtx();
    await showShaderpack(ctx, "/s/a.zip", { icon: "✨", label: "光影" });
    const html = (ctx.root.getElementById("preview-content") as HTMLElement).innerHTML;
    expect(html).toContain("光影A");
    expect(html).toContain("第一");
    expect(html).not.toContain("第四条"); // slice(0,3) 上限：第四条不出现
    expect(html).not.toContain("§");
  });

  it("无 .comment 条目 → 回退「📦 光影包 (N 项配置)」", async () => {
    shaderLangMock.mockResolvedValue(JSON.stringify({ entries: { a: "1", b: "2" } }));
    const ctx = makeCtx();
    await showShaderpack(ctx, "/s/b.zip");
    const html = (ctx.root.getElementById("preview-content") as HTMLElement).innerHTML;
    expect(html).toContain("2 项配置");
    expect(html).toContain("b.zip"); // name 缺失 → basename 兜底
  });

  it("ReadShaderpackLang 拒绝 → ⚠️ 读取失败占位", async () => {
    shaderLangMock.mockRejectedValueOnce(new Error("lang boom"));
    const ctx = makeCtx();
    await showShaderpack(ctx, "/s/c.zip");
    const html = (ctx.root.getElementById("preview-content") as HTMLElement).innerHTML;
    expect(html).toContain("⚠️");
    expect(html).toContain("lang boom");
  });

  it("在途时切走（detailGen.invalidate）→ 恢复后 stale 早退（275）", async () => {
    let resolveLang: (v: string) => void = () => {};
    shaderLangMock.mockImplementationOnce(() => new Promise<string>((r) => (resolveLang = r)));
    const ctx = makeCtx();
    const pending = showShaderpack(ctx, "/s/stale.zip");
    await vi.waitFor(() => expect(shaderLangMock).toHaveBeenCalled());
    detailGen.invalidate();
    resolveLang(JSON.stringify({ name: "迟到的光影" }));
    await pending;
    const content = ctx.root.getElementById("preview-content") as HTMLElement;
    expect(content.innerHTML).toContain("⏳"); // 停留在加载占位
  });
});
