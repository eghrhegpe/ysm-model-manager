// ===== show-repo-models 装配逻辑测试（happy-dom：searchResults innerHTML 真实渲染）=====
// showRepoModels 是「Go 桥本地扫描 + header 渲染 + 事件绑定」的装配层：
// 模式 4：mock getApp 阻断 Wails 桥；模式 3：mock bindRepoEvents（阻断 events.ts
// 的 modal/下载队列/虚拟列表重 import 链）与 dbg；currentRepoType 状态外提 mock。
// render.ts 的 countMissing / renderRepoHeaderHTML 走真实实现（断言 innerHTML 实际产物）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { esc } from "../../utils/dom/html.ts";
import { RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import type { WorkshopModel } from "./render.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";

const { getAppMock, currentRepoTypeMock, bindRepoEventsMock, dbgMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  currentRepoTypeMock: vi.fn((): string => "ysm"),
  bindRepoEventsMock: vi.fn(),
  dbgMock: vi.fn(),
}));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../repo-rtype.ts", () => ({ currentRepoType: currentRepoTypeMock }));
vi.mock("./events.ts", () => ({ bindRepoEvents: bindRepoEventsMock }));
vi.mock("../../utils/debug/debug.ts", () => ({ dbg: dbgMock }));

import { showRepoModels } from "./show-repo-models.ts";

// 生产调用方传入的 esc 形状是 (s: unknown) => string，测试同构
const escAny = (s: unknown): string => esc(String(s));

type MockFn = ReturnType<typeof vi.fn>;

/** getApp mock 返回的桥绑定（缺 GetRepoRoot/ClearScanCache 时按需注入） */
function makeApp(over: Record<string, MockFn> = {}) {
  const m: Record<string, MockFn> = {
    LoadAppConfig: vi.fn().mockResolvedValue({ mirror: "" }),
    GetRepoRoot: vi.fn(),
    ClearScanCache: vi.fn(),
    ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
    ...over,
  };
  getAppMock.mockResolvedValue(m);
  return m;
}

/** bindRepoEvents mock 返回 { renderList, cleanup }，供断言交接 */
function makeRenderList() {
  const renderList = vi.fn();
  const cleanup = vi.fn(async () => {});
  bindRepoEventsMock.mockReturnValue({ renderList, cleanup });
  return { renderList, cleanup };
}

/** 固定装配参数：repo=user/repo，models 2 个（A 本地已有、C 缺失） */
function setup() {
  const searchResults = document.createElement("div");
  const setRepoEventsCleanup = vi.fn();
  const setCurrentSite = vi.fn();
  const models: WorkshopModel[] = [
    { name: "A.ysm", path: "a" },
    { name: "C.ysm", path: "c" },
  ];
  const run = (
    over: {
      source?: string;
      rtype?: string;
      models?: WorkshopModel[];
      repo?: string;
      repoEventsCleanup?: (() => Promise<void>) | null;
      currentSite?: WorkshopSite | null;
    } = {},
  ) =>
    showRepoModels(
      escAny,
      over.repoEventsCleanup ?? null,
      setRepoEventsCleanup,
      over.currentSite ?? null,
      setCurrentSite,
      over.repo ?? "user/repo",
      over.models ?? models,
      over.source ?? "raw",
      searchResults,
      over.rtype,
    );
  return { searchResults, setRepoEventsCleanup, setCurrentSite, models, run };
}

describe("showRepoModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRepoTypeMock.mockReturnValue("ysm");
  });

  it("正常路径：扫本地 → 渲染 header → 绑定事件 → renderList", async () => {
    const app = makeApp();
    app.LoadAppConfig.mockResolvedValue({ mirror: "jsdelivr" });
    app.GetRepoRoot.mockResolvedValue("/repo/root");
    app.ScanModelEntriesWithLabel.mockResolvedValue([
      { Name: "A.ysm", Hash: "ha" },
      { Name: "B.ysm.disabled", Hash: "hb" },
    ]);
    const { renderList, cleanup } = makeRenderList();
    const { searchResults, setRepoEventsCleanup, models, run } = setup();

    await run({ rtype: "ysm" });

    // 本地扫描链：GetRepoRoot(rtype) → ClearScanCache → ScanModelEntriesWithLabel(root, label)
    expect(app.GetRepoRoot).toHaveBeenCalledWith("ysm");
    expect(app.ClearScanCache).toHaveBeenCalledTimes(1);
    expect(app.ScanModelEntriesWithLabel).toHaveBeenCalledWith("/repo/root", RESOURCE_TYPE_LABELS.ysm);
    // header 渲染（真实 renderRepoHeaderHTML）：repo 名 + raw/CDN 徽章 + 缺失徽章
    const html = searchResults.innerHTML;
    expect(html).toContain("gh-header");
    expect(html).toContain("user/repo");
    expect(html).toContain("link-badge-raw");
    expect(html).toContain("link-badge-cdn");
    expect(html).toContain("gh-model-badge-missing");
    expect(html).toContain("⬇️ 1"); // A 本地已有，C 缺失 → missingCount 1
    // 事件绑定参数：dlPrefix 固定 raw 前缀；localMap 键经 stripDisableSuffix
    expect(bindRepoEventsMock).toHaveBeenCalledTimes(1);
    const [el, opts] = bindRepoEventsMock.mock.calls[0] as [HTMLElement, Record<string, unknown>];
    expect(el).toBe(searchResults);
    expect(opts.repo).toBe("user/repo");
    expect(opts.source).toBe("raw");
    expect(opts.dlPrefix).toBe("https://raw.githubusercontent.com/user/repo/main/");
    expect(opts.models).toBe(models);
    expect(opts.esc).toBe(escAny);
    const localMap = opts.localMap as Map<string, string>;
    expect(localMap).toBeInstanceOf(Map);
    expect(localMap.get("A.ysm")).toBe("ha");
    expect(localMap.get("B.ysm")).toBe("hb"); // .disabled 后缀已剥
    expect(localMap.size).toBe(2);
    // cleanup 交接 + 初始渲染
    expect(setRepoEventsCleanup).toHaveBeenCalledTimes(1);
    expect(setRepoEventsCleanup.mock.calls[0][0]).toBe(cleanup);
    expect(renderList).toHaveBeenCalledTimes(1);
  });

  it("source=jsd + mirror=githubapi → jsd/ghapi 徽章，无 raw/CDN", async () => {
    const app = makeApp();
    app.LoadAppConfig.mockResolvedValue({ mirror: "githubapi" });
    makeRenderList();
    const { searchResults, run } = setup();
    await run({ source: "jsd", rtype: "ysm" });
    const html = searchResults.innerHTML;
    expect(html).toContain("link-badge-jsd");
    expect(html).toContain("link-badge-ghapi");
    expect(html).not.toContain("link-badge-raw");
    expect(html).not.toContain("link-badge-cdn");
  });

  it("source=api + 无 mirror → 仅 API 徽章（mirror 徽章两个分支都不命中）", async () => {
    makeApp();
    makeRenderList();
    const { searchResults, run } = setup();
    await run({ source: "api", rtype: "ysm" });
    const html = searchResults.innerHTML;
    expect(html).toContain("link-badge-api");
    expect(html).not.toContain("link-badge-cdn");
    expect(html).not.toContain("link-badge-ghapi");
  });

  it("LoadAppConfig 失败 → 不阻断渲染，localMap 为空、无 mirror 徽章", async () => {
    const app = makeApp({
      LoadAppConfig: vi.fn().mockRejectedValue(new Error("cfg boom")),
    });
    makeRenderList();
    const { searchResults, run } = setup();
    await run({ rtype: "ysm" });
    expect(app.GetRepoRoot).not.toHaveBeenCalled();
    expect(app.ScanModelEntriesWithLabel).not.toHaveBeenCalled();
    const html = searchResults.innerHTML;
    expect(html).toContain("gh-header");
    expect(html).not.toContain("link-badge-cdn");
    const opts = bindRepoEventsMock.mock.calls[0][1] as { localMap: Map<string, string> };
    expect(opts.localMap.size).toBe(0);
  });

  it("GetRepoRoot 返回空串 → 跳过本地扫描", async () => {
    const app = makeApp();
    app.GetRepoRoot.mockResolvedValue("");
    makeRenderList();
    const { run } = setup();
    await run({ rtype: "ysm" });
    expect(app.ClearScanCache).not.toHaveBeenCalled();
    expect(app.ScanModelEntriesWithLabel).not.toHaveBeenCalled();
  });

  it("桥绑定缺 GetRepoRoot（旧版适配）→ 跳过本地扫描", async () => {
    const m = {
      LoadAppConfig: vi.fn().mockResolvedValue({ mirror: "" }),
      ClearScanCache: vi.fn(),
      ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
    };
    getAppMock.mockResolvedValue(m);
    makeRenderList();
    const { run } = setup();
    await run({ rtype: "ysm" });
    expect(m.ScanModelEntriesWithLabel).not.toHaveBeenCalled();
  });

  it("ScanModelEntriesWithLabel 返回 null → 视为空本地表", async () => {
    const app = makeApp();
    app.GetRepoRoot.mockResolvedValue("/repo/root");
    app.ScanModelEntriesWithLabel.mockResolvedValue(null);
    makeRenderList();
    const { run } = setup();
    await run({ rtype: "ysm" });
    const opts = bindRepoEventsMock.mock.calls[0][1] as { localMap: Map<string, string> };
    expect(opts.localMap.size).toBe(0);
  });

  it("rtype 缺省 → currentRepoType() 决定扫描目标与标签", async () => {
    const app = makeApp();
    app.GetRepoRoot.mockResolvedValue("/repo/root");
    makeRenderList();
    const { run } = setup();
    currentRepoTypeMock.mockReturnValue("EntityPlayer");
    await run();
    expect(app.GetRepoRoot).toHaveBeenCalledWith("EntityPlayer");
    expect(app.ScanModelEntriesWithLabel).toHaveBeenCalledWith(
      "/repo/root",
      RESOURCE_TYPE_LABELS.EntityPlayer,
    );
  });

  it("未知 rtype → 扫描标签回退为 rtype 本名", async () => {
    expect(RESOURCE_TYPE_LABELS["ghost-type"]).toBeUndefined(); // 前置：确属未登记
    const app = makeApp();
    app.GetRepoRoot.mockResolvedValue("/repo/root");
    makeRenderList();
    const { run } = setup();
    await run({ rtype: "ghost-type" });
    expect(app.ScanModelEntriesWithLabel).toHaveBeenCalledWith("/repo/root", "ghost-type");
  });

  it("前一次 cleanup 失败 → dbg 记录后继续绑定，不逸出 unhandled rejection", async () => {
    makeApp();
    const { cleanup } = makeRenderList();
    const { setRepoEventsCleanup, run } = setup();
    const failingCleanup = vi.fn(async () => {
      throw new Error("cleanup boom");
    });
    await run({ rtype: "ysm", repoEventsCleanup: failingCleanup });
    expect(failingCleanup).toHaveBeenCalledTimes(1);
    expect(dbgMock).toHaveBeenCalledWith("repo-events", "清理旧仓库事件失败:", "cleanup boom");
    expect(bindRepoEventsMock).toHaveBeenCalledTimes(1);
    expect(setRepoEventsCleanup).toHaveBeenCalledTimes(1);
    expect(setRepoEventsCleanup.mock.calls[0][0]).toBe(cleanup);
  });

  it("backToSite 闭包：有 currentSite → setCurrentSite 触发重渲染；无 → 不动", async () => {
    makeApp();
    makeRenderList();
    const { setCurrentSite, run } = setup();
    const site = { name: "curseforge" } as unknown as WorkshopSite;
    await run({ rtype: "ysm", currentSite: site });
    const opts = bindRepoEventsMock.mock.calls[0][1] as { backToSite: () => void };
    opts.backToSite();
    expect(setCurrentSite).toHaveBeenCalledWith(site);

    // currentSite 为 null → backToSite 不触发 setCurrentSite
    setCurrentSite.mockClear();
    bindRepoEventsMock.mockClear();
    makeRenderList();
    await run({ rtype: "ysm" });
    const opts2 = bindRepoEventsMock.mock.calls[0][1] as { backToSite: () => void };
    opts2.backToSite();
    expect(setCurrentSite).not.toHaveBeenCalled();
  });
});
