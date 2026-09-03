// ===== init-github（GitHub 社群页编排）单测 =====
// 经导出入口 initGithubPage 覆盖三个内部包级函数：
//  - githubLoadRepos：gh-card 渲染 / 空列表 / 失败降级 / 点击切 active + showRepo / esc 转义
//  - githubShowRepo：缓存命中直渲染 / 镜像竞速 + 本地扫描 localMap / onProgress 加载态 /
//    noModelList 降级 / 错误分支文案映射 / #gh-open-repo 打开按钮 / 竞态守卫
//  - githubRenderModels：dlPrefix+sourceLabel 三元链 / prevCleanup 清理（失败不阻断，P3 回归）/
//    bindRepoEvents 委托 + cleanup 登记 / 同步抛错留痕不逸出（P3 回归）
// mock 写法按知识卡 vitest-env-switch.md 模式 4（vi.hoisted + mock getApp）。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../test-utils/index.ts";
import { t } from "../../core/i18n/t.ts";

const { getApp, bindRepoEvents, renderList, repoCleanup, tryFetchModels } = vi.hoisted(() => {
  const renderList = vi.fn();
  const repoCleanup = vi.fn(async () => {});
  return {
    getApp: vi.fn(),
    bindRepoEvents: vi.fn(() => ({ renderList, cleanup: repoCleanup })),
    renderList,
    repoCleanup,
    tryFetchModels: vi.fn(),
  };
});

vi.mock("../../backend/app.ts", () => ({ getApp }));
vi.mock("../../features/community/events.ts", () => ({ bindRepoEvents }));
vi.mock("../../features/community/data.ts", () => ({ tryFetchModels }));

import { initGithubPage } from "./init-github.ts";
import type { AppContentHost } from "./init-workshop.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";
import type { RepoCacheEntry } from "./state.ts";

/** vi.fn() 未显式标注入参时 mock.calls 元组推断为空，统一经 unknown[] 取参 */
function callArgs(mock: unknown, index: number): unknown[] {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[index] ?? [];
}

/** 组装 initGithubPage 需要的假 host（gh-grid / gh-results-body / gh-source-info） */
function makeHost() {
  const el = document.createElement("div");
  el.innerHTML = `
    <div id="gh-grid"></div>
    <div id="gh-results-body"></div>
    <div id="gh-source-info"></div>
  `;
  (el as unknown as { getElementById: (id: string) => Element | null }).getElementById =
    (id: string) => el.querySelector(`#${id}`);
  const raw: Record<string, unknown> = {
    _root: el,
    _unsubs: [],
    _globalUnsubs: [],
    _currentSite: null,
    _setCurrentSite: () => {},
    _avatarCache: {},
    _setAvatarCache: () => {},
    _workshopCache: null,
    _setWorkshopCache: () => {},
    _githubCache: null as Map<string, RepoCacheEntry> | null,
    _setGithubCache: (c: Map<string, RepoCacheEntry> | null) => { raw._githubCache = c; },
    _repoEventsCleanup: null as (() => Promise<void>) | null,
    _setRepoEventsCleanup: (fn: (() => Promise<void>) | null) => { raw._repoEventsCleanup = fn; },
    _workshopTimer: null,
    _setWorkshopTimer: () => {},
    _avatarRefreshRegistered: false,
    _setAvatarRefreshRegistered: () => {},
  };
  return { host: raw as unknown as AppContentHost, raw, el };
}

function gridOf(el: HTMLElement): HTMLElement {
  return el.querySelector("#gh-grid") as HTMLElement;
}
function bodyOf(el: HTMLElement): HTMLElement {
  return el.querySelector("#gh-results-body") as HTMLElement;
}

/** 冲刷微任务（getApp().then / await 链） */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

let appObj: Record<string, ReturnType<typeof vi.fn>>;

function mockApp(overrides: Record<string, unknown> = {}) {
  appObj = {
    LoadGitHubRepos: vi.fn(() => []),
    LoadAppConfig: vi.fn(() => ({ mirror: "" })),
    GetRepoRoot: vi.fn(() => ""),
    ScanModelEntriesWithLabel: vi.fn(() => []),
    OpenInBrowser: vi.fn(),
    ...overrides,
  };
  getApp.mockResolvedValue(appObj);
  return appObj;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
  mockApp();
});

describe("githubLoadRepos（经 initGithubPage → loadRepos）", () => {
  it("正常加载：gh-repo-card 渲染 + repo 计数 + 点击切 active 并进入 showRepo", async () => {
    const { host, el } = makeHost();
    mockApp({
      LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "仓库一" }, { name: "o/r2", desc: "仓库二" }]),
    });
    // showRepo 走 fetch 路径，挂起以停在加载态，便于断言
    tryFetchModels.mockImplementation(() => new Promise(() => {}));

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 2);

    expect((el.querySelector("#gh-source-info") as HTMLElement).textContent).toBe(
      t("downloads.repoCountDesc", { n: 2 }),
    );
    expect(gridOf(el).innerHTML).toContain('data-repo="o/r1"');
    expect(gridOf(el).innerHTML).toContain("仓库一");

    const card = gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!;
    card.click();
    expect(card.classList.contains("active")).toBe(true);
    await waitFor(() => tryFetchModels.mock.calls.length > 0);
    expect(tryFetchModels.mock.calls[0]![0]).toBe("o/r1");
    expect(tryFetchModels.mock.calls[0]![1]).toBe(""); // mirror 默认
  });

  it("空仓库列表 → noRepos 提示（不渲染卡片）", async () => {
    const { host, el } = makeHost();
    mockApp({ LoadGitHubRepos: vi.fn(() => []) });
    initGithubPage(host);
    await waitFor(() => gridOf(el).textContent!.includes(t("downloads.noRepos")));
    expect(gridOf(el).querySelectorAll(".gh-repo-card").length).toBe(0);
    expect((el.querySelector("#gh-source-info") as HTMLElement).textContent).toBe(
      t("downloads.repoCountDesc", { n: 0 }),
    );
  });

  it("LoadGitHubRepos 失败 → loadFailed 降级文案", async () => {
    const { host, el } = makeHost();
    mockApp({ LoadGitHubRepos: vi.fn(() => Promise.reject(new Error("bridge boom"))) });
    initGithubPage(host);
    await waitFor(() => gridOf(el).textContent!.includes(t("common.loadFailed")));
  });

  it("repo 名含 HTML 特殊字符 → esc 转义防注入，dataset 往返校验", async () => {
    const { host, el } = makeHost();
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: '<b>&x"', desc: "d" }]) });
    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    // esc 后属性值完整往返（innerHTML 反序列化会解码实体，故断言 dataset 解码结果）
    const card = gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!;
    expect(card.dataset.repo).toBe('<b>&x"');
  });
});

describe("githubShowRepo — 缓存命中", () => {
  /** 预置 o/r1 缓存并初始化页面，点进仓库（触发缓存命中的 showRepo 路径） */
  async function cacheHost(entry: RepoCacheEntry) {
    const { host, raw, el } = makeHost();
    raw._githubCache = new Map<string, RepoCacheEntry>([["o/r1", entry]]);
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    return { raw, el };
  }

  it("缓存命中 → 直接 renderModels，不走 fetch", async () => {
    const { el } = await cacheHost({
      models: [{ name: "m1", path: "p1" }],
      source: "raw",
      localMap: new Map(),
    });
    await waitFor(() => bindRepoEvents.mock.calls.length > 0);
    expect(tryFetchModels).not.toHaveBeenCalled();

    const args0 = callArgs(bindRepoEvents, 0);
    const sr = args0[0] as HTMLElement;
    const ctx = args0[1] as any;
    expect(sr).toBe(bodyOf(el));
    expect(ctx.models).toEqual([{ name: "m1", path: "p1" }]);
    expect(ctx.repo).toBe("o/r1");
    expect(ctx.source).toBe("raw");
    expect(ctx.dlPrefix).toBe("https://raw.githubusercontent.com/o/r1/main/");
    expect(renderList).toHaveBeenCalledTimes(1);
    // resultsBody 已写入表头（renderRepoHeaderHTML 真实实现）
    expect(bodyOf(el).innerHTML).toContain("gh-header");
    expect(bodyOf(el).innerHTML).toContain("o/r1");
  });

  it("sourceLabel 三元链：raw / jsd / api / 未知来源", async () => {
    const cases: Array<[string, string | null]> = [
      ["raw", "link-badge-raw"],
      ["jsd", "link-badge-jsd"],
      ["api", "link-badge-api"],
      ["mystery", null],
    ];
    for (const [source, cls] of cases) {
      bindRepoEvents.mockClear();
      const { el } = await cacheHost({ models: [{ name: "m1", path: "p1" }], source });
      await waitFor(() => bindRepoEvents.mock.calls.length > 0);
      if (cls) expect(bodyOf(el).innerHTML).toContain(cls);
      else expect(bodyOf(el).innerHTML).not.toContain("link-badge");
    }
  });
});

describe("githubShowRepo — 镜像竞速与本地扫描", () => {
  it("缓存未命中 → 本地扫描建 localMap（stripBanSuffix）+ fetch 结果入库并渲染", async () => {
    const { host, raw, el } = makeHost();
    mockApp({
      LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]),
      GetRepoRoot: vi.fn(() => "/repo"),
      ScanModelEntriesWithLabel: vi.fn(() => [
        { Name: "alice.ban", Hash: "h1" },
        { Name: "bob.disabled", Hash: "h2" },
      ]),
    });
    tryFetchModels.mockResolvedValue({
      models: [
        { name: "alice", path: "p1", hash: "h1" },
        { name: "ghost", path: "p2" }, // 本地没有 → 缺失
      ],
      source: "jsd",
    });

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();

    await waitFor(() => bindRepoEvents.mock.calls.length > 0);
    expect(appObj.ScanModelEntriesWithLabel).toHaveBeenCalledWith(
      "/repo",
      RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM],
    );
    const ctx = callArgs(bindRepoEvents, 0)[1] as any;
    expect(ctx.localMap.get("alice")).toBe("h1"); // stripBanSuffix 剥掉 .ban
    expect(ctx.localMap.get("bob")).toBe("h2"); // 剥掉 .disabled
    // 缺失徽章：ghost 不在本地 → missingCount 1
    expect(bodyOf(el).innerHTML).toContain("gh-model-badge-missing");
    // 结果入库（下次命中）
    const entry = (raw._githubCache as Map<string, RepoCacheEntry>).get("o/r1")!;
    expect(entry.models).toHaveLength(2);
    expect(entry.source).toBe("jsd");
  });

  it("onProgress 回调 → resultsBody 加载态文本更新", async () => {
    const { host, el } = makeHost();
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    let resolveFetch!: (v: { models: unknown[]; source: string }) => void;
    tryFetchModels.mockImplementation(
      (_repo: string, _mirror: string, onProgress?: (pct: number, label: string) => void) => {
        onProgress?.(30, "⬇️ 下载中 30%");
        return new Promise((r) => (resolveFetch = r));
      },
    );

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    await waitFor(() => bodyOf(el).textContent!.includes("下载中 30%"));

    resolveFetch({ models: [{ name: "m1", path: "p1" }], source: "raw" });
    await waitFor(() => bindRepoEvents.mock.calls.length > 0);
  });

  it("result 无 models → noModelList 降级 + gh-open-repo-dl 按钮打开 GitHub", async () => {
    const { host, el } = makeHost();
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    tryFetchModels.mockResolvedValue(null);

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    await waitFor(() => bodyOf(el).innerHTML.includes("gh-open-repo-dl"));
    expect(bodyOf(el).textContent).toContain(t("downloads.noModelList"));
    expect(bindRepoEvents).not.toHaveBeenCalled();

    (bodyOf(el).querySelector("#gh-open-repo-dl") as HTMLElement).click();
    await waitFor(() => appObj.OpenInBrowser.mock.calls.length > 0);
    expect(appObj.OpenInBrowser).toHaveBeenCalledWith("https://github.com/o/r1");
  });
});

describe("githubShowRepo — 错误分支文案映射", () => {
  async function runWithError(err: Error): Promise<{ el: HTMLElement; app: Record<string, ReturnType<typeof vi.fn>> }> {
    const { host, el } = makeHost();
    const app = mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    tryFetchModels.mockRejectedValue(err);
    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    await waitFor(() => bodyOf(el).innerHTML.includes("gh-open-repo"));
    return { el, app };
  }

  it("NetworkOffline → 无网络提示", async () => {
    const { el } = await runWithError(new Error("NetworkOffline"));
    expect(bodyOf(el).textContent).toContain("无网络连接，请检查网络后重试");
  });

  it("NoIndex → 无 index.json 提示", async () => {
    const { el } = await runWithError(new Error("NoIndex"));
    expect(bodyOf(el).textContent).toContain("该仓库没有 index.json");
  });

  it("RateLimited → 频率限制提示", async () => {
    const { el } = await runWithError(new Error("RateLimited"));
    expect(bodyOf(el).textContent).toContain("GitHub API 频率限制");
  });

  it("其他错误 → 通用失败提示；#gh-open-repo 点击 → OpenInBrowser", async () => {
    const { el, app } = await runWithError(new Error("boom"));
    expect(bodyOf(el).textContent).toContain("加载失败，请检查网络或稍后重试");
    (bodyOf(el).querySelector("#gh-open-repo") as HTMLElement).click();
    await waitFor(() => app.OpenInBrowser.mock.calls.length > 0);
    expect(app.OpenInBrowser).toHaveBeenCalledWith("https://github.com/o/r1");
  });
});

describe("githubShowRepo — 竞态守卫", () => {
  it("切仓后旧仓库的迟到 fetch 响应被丢弃（不 renderModels、仅入库）", async () => {
    const { host, raw, el } = makeHost();
    // r2 预置缓存：点击即命中渲染
    raw._githubCache = new Map<string, RepoCacheEntry>([
      ["o/r2", { models: [{ name: "m2", path: "p2" }], source: "api" }],
    ]);
    mockApp({
      LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }, { name: "o/r2", desc: "d" }]),
    });
    let resolveR1!: (v: { models: unknown[]; source: string }) => void;
    tryFetchModels.mockImplementation(() => new Promise((r) => (resolveR1 = r)));

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 2);

    const cards = gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card");
    cards[0]!.click(); // r1：fetch 挂起
    await waitFor(() => tryFetchModels.mock.calls.length > 0);
    cards[1]!.click(); // r2：缓存命中，currentRepo 切到 r2
    await waitFor(() => bindRepoEvents.mock.calls.length > 0);
    expect((callArgs(bindRepoEvents, 0)[1] as { repo: string }).repo).toBe("o/r2");

    resolveR1({ models: [{ name: "late", path: "late" }], source: "raw" });
    await flush();
    await flush();
    // 迟到响应：不触发新渲染，仅写缓存
    expect(bindRepoEvents).toHaveBeenCalledTimes(1);
    expect((raw._githubCache as Map<string, RepoCacheEntry>).has("o/r1")).toBe(true);
  });
});

describe("githubRenderModels — 清理与异常", () => {
  it("prevCleanup 存在 → 先 await 清理再绑定，并把新 cleanup 登记回 host", async () => {
    const { host, raw, el } = makeHost();
    const prevCleanup = vi.fn(async () => {});
    raw._repoEventsCleanup = prevCleanup;
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    raw._githubCache = new Map<string, RepoCacheEntry>([
      ["o/r1", { models: [{ name: "m1", path: "p1" }], source: "raw" }],
    ]);

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    await waitFor(() => bindRepoEvents.mock.calls.length > 0);

    expect(prevCleanup).toHaveBeenCalledTimes(1);
    expect(raw._repoEventsCleanup).toBe(repoCleanup); // 新 cleanup 已登记
  });

  it("prevCleanup reject → 不阻断新绑定（c7cd6363 模式回归）", async () => {
    const { host, raw, el } = makeHost();
    raw._repoEventsCleanup = vi.fn(async () => {
      throw new Error("cleanup boom");
    });
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    raw._githubCache = new Map<string, RepoCacheEntry>([
      ["o/r1", { models: [{ name: "m1", path: "p1" }], source: "raw" }],
    ]);

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    await waitFor(() => bindRepoEvents.mock.calls.length > 0); // 仍完成绑定
    expect(renderList).toHaveBeenCalledTimes(1);
  });

  it("bindRepoEvents 同步抛错 → catch 留痕不逸出（fire-and-forget 回归）", async () => {
    const { host, el } = makeHost();
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    raw_cacheHost(host, "o/r1");
    bindRepoEvents.mockImplementationOnce(() => {
      throw new Error("bind boom");
    });

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    await flush();
    await flush();
    // 无 unhandled rejection 即通过；表头已在绑定前写入
    expect(bodyOf(el).innerHTML).toContain("gh-header");
  });

  it("ctx 接线：bindCtx.showRepoModels() → 重新 showRepo；bindCtx.backToSite() → 重新 loadRepos", async () => {
    const { host, raw, el } = makeHost();
    mockApp({ LoadGitHubRepos: vi.fn(() => [{ name: "o/r1", desc: "d" }]) });
    raw._githubCache = new Map<string, RepoCacheEntry>([
      ["o/r1", { models: [{ name: "m1", path: "p1" }], source: "raw" }],
    ]);

    initGithubPage(host);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
    gridOf(el).querySelectorAll<HTMLElement>(".gh-repo-card")[0]!.click();
    await waitFor(() => bindRepoEvents.mock.calls.length > 0);
    const app = appObj;
    const loadCalls = app.LoadGitHubRepos.mock.calls.length;

    const bindCtx = callArgs(bindRepoEvents, 0)[1] as any;
    bindCtx.showRepoModels(); // → ctx.showRepo("o/r1") → 缓存再渲染
    await waitFor(() => bindRepoEvents.mock.calls.length > 1);

    bindCtx.backToSite(); // → ctx.loadRepos() → 再拉一次仓库列表
    await waitFor(() => app.LoadGitHubRepos.mock.calls.length > loadCalls);
    await waitFor(() => gridOf(el).querySelectorAll(".gh-repo-card").length === 1);
  });
});

/** 给 host 预置 o/r1 的缓存条目（renderModels 路径复用） */
function raw_cacheHost(host: AppContentHost, repo: string): void {
  const raw = host as unknown as { _githubCache: Map<string, RepoCacheEntry> | null };
  raw._githubCache = new Map<string, RepoCacheEntry>([
    [repo, { models: [{ name: "m1", path: "p1" }], source: "raw" }],
  ]);
}
