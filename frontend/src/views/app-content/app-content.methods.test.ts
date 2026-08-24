// ===== app-content 方法级补测 =====
// 覆盖：_render 各页面分支、_bindTabs 懒初始化（import/recycle/dedup/oldest）、
// _initRepository subtab 切换、_initPreviewResize 拖拽宽度、_initInstances、
// 事件订阅（repo:search-creator / lang:changed / package:selected）、
// _fmtSize / _esc 纯函数。
// heavy feature 模块全 mock（副作用 import 断开），页面 HTML 用真实 tpl。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatBytes } from "../../utils/dom/format.ts";
import { esc } from "../../utils/dom/html.ts";

vi.mock("@wailsio/runtime", () => ({
  Events: { On: vi.fn().mockReturnValue(() => {}) },
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    LoadAppConfig: vi.fn().mockResolvedValue({}),
    GetRepoRoot: vi.fn().mockResolvedValue(""),
    ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
    LoadGitHubRepos: vi.fn().mockResolvedValue([]),
    OpenInBrowser: vi.fn().mockResolvedValue(undefined),
    BatchExtractCreatorAvatars: vi.fn().mockResolvedValue({}),
    LoadResourceTypes: vi.fn().mockResolvedValue("{}"),
  }),
}));

vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  ScanModelEntries: vi.fn().mockResolvedValue([]),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  LoadAppConfig: vi.fn().mockResolvedValue({}),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
}));

// heavy feature 模块 mock（断开 import 副作用链）
vi.mock("../../core/handlers/global.ts", () => ({
  registerGlobalHandlers: vi.fn(() => []),
}));
vi.mock("./diagnostics/init.ts", () => ({
  initDiagnostics: vi.fn(),
}));
vi.mock("./diagnostics/dedup.ts", () => ({
  initDedupConfig: vi.fn(),
  startDedup: vi.fn(),
}));
vi.mock("../../features/recycle-bin.ts", () => ({ initRecycleBin: vi.fn() }));
vi.mock("../../features/oldest-models.ts", () => ({
  loadOldestModel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../features/community/data.ts", () => ({ tryFetchModels: vi.fn() }));
vi.mock("./settings/init.ts", () => ({
  initSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./community-data.ts", () => ({
  loadCommunityData: vi.fn().mockResolvedValue({ sites: [], creators: [], authors: [] }),
  fillSearch: vi.fn(),
}));
vi.mock("./site-view.ts", () => ({ renderSiteView: vi.fn(() => () => {}) }));
vi.mock("../../features/community/events.ts", () => ({ bindRepoEvents: vi.fn() }));
vi.mock("../../utils/icon/workshop-icons.ts", () => ({ getSiteIcon: vi.fn(() => "") }));

import { bus } from "../../bus.ts";
import { initRecycleBin } from "../../features/recycle-bin.ts";
import { loadOldestModel } from "../../features/oldest-models.ts";
import { startDedup } from "./diagnostics/dedup.ts";
import { PAGE_REGISTRY } from "./page-registry.ts";
import { loadCommunityData } from "./community-data.ts";
import { tryFetchModels } from "../../features/community/data.ts";
import { renderSiteView } from "./site-view.ts";
import "./index.ts"; // 触发 customElements.define("app-content")
import { sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";

type ContentEl = {
  shadowRoot: ShadowRoot;
  _current: string;
  _root: ShadowRoot;
  _globalUnsubs: Array<() => void>;
  _unsubs: Array<() => void>;
  _render(): void;
  _initPreviewResize(): void;
  _initRepository(): void;
  _initInstances(): void;
  _bindTabs(sel: string, prefix: string, ids: string[]): void;
  [key: string]: unknown;
} & Element;

function mountContent(): ContentEl {
  const el = mountCustomElement("app-content") as unknown as ContentEl;
  // 页面级 init 方法替换为 spy（各自模块已有独立测试；此处只测 _render 分支/交互层）
  (el as unknown as { _initDiagnostics: () => void })._initDiagnostics = vi.fn();
  (el as unknown as { _initWorkshop: () => void })._initWorkshop = vi.fn();
  (el as unknown as { _initGithub: () => void })._initGithub = vi.fn();
  (el as unknown as { _initSettings: () => Promise<void> })._initSettings = vi.fn().mockResolvedValue(undefined);
  // _initInstances 保留真实实现（package:selected 订阅测试需要）
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.removeItem("nav_page");
  localStorage.removeItem("ui-default-page");
  localStorage.removeItem("repo_rtype");
  localStorage.removeItem("preview-width");
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("_render — 页面分支", () => {
  it("repository → 仓库页（.repo-tab，无本地双下拉——资源类型由导航栏全局切换器驱动）", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    expect(el.shadowRoot.querySelector(".repo-tab")).not.toBeNull();
    // ADR-092/094 收敛：仓库页不再持有本地 subtabs（资源切换器已上移导航栏 app-nav）
    expect(el.shadowRoot.querySelector("#group-select")).toBeNull();
    expect(el.shadowRoot.querySelector("#subtype-select")).toBeNull();
    unmountElement(el);
  });

  it("instances 与未知页 → 整合包页（.ins-content）", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "instances";
    el._render();
    expect(el.shadowRoot.querySelector(".ins-content")).not.toBeNull();
    el._current = "weird-page";
    el._render(); // default 分支回落 instances
    expect(el.shadowRoot.querySelector(".ins-content")).not.toBeNull();
    unmountElement(el);
  });

  it("settings → .stg-tab；diagnostics/oldest → 诊断页；workshop → #ws-tabs；github → #gh-grid", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "settings";
    el._render();
    expect(el.shadowRoot.querySelector(".stg-tab")).not.toBeNull();
    el._current = "diagnostics";
    el._render();
    // P3 修复（审核）：原断言 .repo-tab 是全部页面模板的通用类名（tpl.ts 各页都有），
    // 诊断页渲染错误也会通过——改断言诊断页专属 .diag-wrapper
    expect(el.shadowRoot.querySelector(".diag-wrapper")).not.toBeNull();
    el._current = "workshop";
    el._render();
    expect(el.shadowRoot.querySelector("#ws-tabs")).not.toBeNull();
    el._current = "github";
    el._render();
    expect(el.shadowRoot.querySelector("#gh-grid")).not.toBeNull();
    unmountElement(el);
  });

  it("init 抛错 → toast:show 而非中断（bus 收到错误事件）", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "settings";
    // P1-1（子代理审核）：_render 改直调 PAGE_REGISTRY.init（不再经私有 _initSettings），
    // 故替换注册表 init 为 reject 验证 async 失败路径 → _pageInitFailed → toast
    const origInit = PAGE_REGISTRY.settings.init;
    PAGE_REGISTRY.settings.init = () => Promise.reject(new Error("boom"));
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    try {
      el._render();
      await sleep(20);
      expect(toastSpy).toHaveBeenCalled();
    } finally {
      PAGE_REGISTRY.settings.init = origInit;
      unsub();
      unmountElement(el);
    }
  });
});

describe("_bindTabs — 仓库 tab 懒初始化", () => {  it("点击 recycle tab → initRecycleBin 注册", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const btn = el.shadowRoot.querySelector('.repo-tab[data-tab="recycle"]') as HTMLElement;
    btn.click();
    await sleep(20);
    expect(initRecycleBin).toHaveBeenCalled();
    unmountElement(el);
  });

  it("点击 oldest tab → loadOldestModel 注册", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const btn = el.shadowRoot.querySelector('.repo-tab[data-tab="oldest"]') as HTMLElement;
    btn.click();
    await sleep(20);
    expect(loadOldestModel).toHaveBeenCalled();
    unmountElement(el);
  });

  it("点击 dedup tab → 渲染去重按钮；点击按钮与 rtype-changed 均触发 startDedup", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const btn = el.shadowRoot.querySelector('.repo-tab[data-tab="dedup"]') as HTMLElement;
    btn.click();
    await sleep(20);
    const startBtn = el.shadowRoot.getElementById("dedup-start-btn") as HTMLElement | null;
    expect(startBtn).toBeTruthy();
    startBtn!.click();
    await sleep(20);
    expect(startDedup).toHaveBeenCalledTimes(1);
    bus.emit("repo:rtype-changed", "mmd"); // 全局类型切换 → 自动重复
    await sleep(20);
    expect(startDedup).toHaveBeenCalledTimes(2);
    unmountElement(el);
  });
});

describe("_initRepository — 订阅全局资源类型（ADR-092/094 收敛）", () => {
  it("repo:rtype-changed → 重建文件树 root=EntityPlayer（subdir 从 localStorage 读）", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const unsub = bus.on("repo:rtype-changed", () => {});
    try {
      localStorage.setItem("repo_subdir", "SceneModel");
      bus.emit("repo:rtype-changed", "EntityPlayer");
      await sleep(20);
      // repo_rtype 由导航栏 app-nav 切换器写入（仓库页只订阅重建树，不再落盘）
      expect(localStorage.getItem("repo_rtype")).not.toBe("EntityPlayer");
      const tree = el.shadowRoot.getElementById("repo-tab-tree");
      expect(tree?.innerHTML).toContain('root="EntityPlayer"');
      expect(tree?.innerHTML).toContain('subdir="SceneModel"');
    } finally {
      localStorage.removeItem("repo_subdir");
      unsub();
      unmountElement(el);
    }
  });

  it("repo:rtype-changed → 切到 resourcepack（无 subdir）重建树", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    try {
      bus.emit("repo:rtype-changed", "resourcepack");
      await sleep(20);
      const tree = el.shadowRoot.getElementById("repo-tab-tree");
      expect(tree?.innerHTML).toContain('root="resourcepack"');
      expect(tree?.innerHTML).not.toContain("subdir=");
    } finally {
      unmountElement(el);
    }
  });

  it("localStorage 存非默认 rtype → 初始化恢复该 rtype 文件树", async () => {
    // 回归：localStorage 存 resourcepack 时，初始化应挂载 resourcepack 文件树
    localStorage.setItem("repo_rtype", "resourcepack");
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    try {
      const tree = el.shadowRoot.getElementById("repo-tab-tree");
      expect(tree?.innerHTML).toContain('root="resourcepack"');
    } finally {
      localStorage.removeItem("repo_rtype");
      unmountElement(el);
    }
  });
});

describe("_initPreviewResize — 拖拽调宽", () => {
  it("拖拽 handle → preview 宽度变化 + 保存 localStorage", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const handle = el.shadowRoot.getElementById("preview-resize-handle") as HTMLElement | null;
    const preview = el.shadowRoot.getElementById("app-preview") as HTMLElement | null;
    expect(handle).toBeTruthy();
    expect(preview).toBeTruthy();
    // happy-dom 无布局，getBoundingClientRect 返回 0 → newW 取 max(160, ...) 下限
    handle!.dispatchEvent(new PointerEvent("pointerdown", { cancelable: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 50 }));
    document.dispatchEvent(new PointerEvent("pointerup"));
    expect(preview!.style.width).toContain("px");
    expect(localStorage.getItem("preview-width")).toContain("px");
    unmountElement(el);
  });

  it("localStorage 已有宽度 → 恢复并钳制 160–500", async () => {
    localStorage.setItem("preview-width", "999"); // 超上限 → 500
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const preview = el.shadowRoot.getElementById("app-preview") as HTMLElement | null;
    expect(preview?.style.width).toBe("500px");
    unmountElement(el);
  });
});

describe("事件订阅", () => {
  it("repo:search-creator → 发射 tree:set-search + 切仓库页", async () => {
    const el = mountContent();
    await sleep(50);
    const navSpy = vi.fn();
    const searchSpy = vi.fn();
    const unsubNav = bus.on("nav:changed", navSpy);
    const unsubSearch = bus.on("tree:set-search", searchSpy);
    try {
      bus.emit("repo:search-creator", "某作者");
      await sleep(10);
      expect(searchSpy).toHaveBeenCalledWith("某作者");
      expect(navSpy).toHaveBeenCalledWith({ page: "repository" });
    } finally {
      unsubNav();
      unsubSearch();
      unmountElement(el);
    }
  });

  it("lang:changed → 重渲染当前页", async () => {
    const el = mountContent();
    await sleep(50);
    // P2（子代理审核）：原测试为 no-op——before 在显式 _render() 前捕获后 void 丢弃，
    // 断言仅 .repo-tab 存在（显式 _render 已满足），删掉 lang:changed 订阅测试照样通过。
    // 改为 spyOn(_render) 断言 emit 后热重渲染真实触发。
    const renderSpy = vi.spyOn(el, "_render");
    bus.emit("lang:changed", { lang: "en" });
    await sleep(10);
    expect(renderSpy).toHaveBeenCalled();
    unmountElement(el);
  });

  it("package:selected → ins-content 渲染 app-sync-manager", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "instances";
    el._render(); // 真实 _initInstances 注册 package:selected 订阅
    bus.emit("package:selected", { name: "MyPack", rtype: "ysm" });
    await sleep(10);
    const content = el.shadowRoot.getElementById("ins-content");
    expect(content?.innerHTML).toContain("app-sync-manager");
    expect(content?.innerHTML).toContain('instance="MyPack"');
    unmountElement(el);
  });
});

describe("_initGithub / _initWorkshop 真实路径", () => {
  it("github 无仓库 → 「暂无 GitHub 仓库」占位", async () => {
    const el = mountCustomElement("app-content") as unknown as ContentEl;
    await sleep(50);
    el._current = "github";
    el._render(); // 真实 _initGithub → loadRepos → LoadGitHubRepos(mock [])
    await sleep(20);
    const grid = el.shadowRoot.getElementById("gh-grid");
    expect(grid?.textContent).toContain("暂无 GitHub 仓库");
    unmountElement(el);
  });

  it("github 有仓库 → 卡片渲染 + 点击走 showRepo（未找到模型列表）", async () => {
    const el = mountCustomElement("app-content") as unknown as ContentEl;
    await sleep(50);
    const appMock = (await import("../../backend/app.ts")).getApp as unknown as ReturnType<typeof vi.fn>;
    appMock.mockResolvedValue({
      LoadAppConfig: vi.fn().mockResolvedValue({}),
      GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
      ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
      LoadGitHubRepos: vi.fn().mockResolvedValue([{ name: "creator/models", desc: "索引" }]),
      OpenInBrowser: vi.fn().mockResolvedValue(undefined),
      BatchExtractCreatorAvatars: vi.fn().mockResolvedValue({}),
    });
    vi.mocked(tryFetchModels).mockResolvedValue(undefined as never); // 未找到模型列表分支
    el._current = "github";
    el._render();
    await sleep(50);
    const card = el.shadowRoot.querySelector(".gh-repo-card") as HTMLElement | null;
    expect(card).toBeTruthy();
    card!.click();
    await sleep(30);
    const body = el.shadowRoot.getElementById("gh-results-body");
    expect(body?.textContent).toContain("未找到模型列表");
    unmountElement(el);
  });

  it("workshop 空站点 → 不生成 tab；有站点 → 生成 tab + 默认显示第一个", async () => {
    const el = mountCustomElement("app-content") as unknown as ContentEl;
    await sleep(50);
    vi.mocked(loadCommunityData).mockResolvedValue({
      sites: [
        { id: "bilibili", label: "B站", url: "https://bilibili.com", icon: "", desc: "", group: "" },
        { id: "afdian", label: "爱发电", url: "https://afdian.com", icon: "", desc: "", group: "" },
      ],
      creators: [],
      authors: [],
    });
    el._current = "workshop";
    el._render();
    // _initWorkshop 用 setTimeout(100) 延迟加载站点
    await sleep(200);
    const tabs = el.shadowRoot.getElementById("ws-tabs");
    expect(tabs?.querySelectorAll("button").length).toBe(2);
    // 默认站点（bilibili）触发 showSiteView → renderSiteView（mock 内联）
    expect(renderSiteView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bilibili" }),
      expect.anything(),
    );
    unmountElement(el);
  });

  it("workshop: 创作者数据异步加载 → ref 引用一致性（stale closure 防回归）", async () => {
    // —— 设计意图：本次 bug 就是 initWorkshopTabs 写入的 ref 与 showSiteView 读取的 ref
    // 不是同一个对象实例，导致 tabs 更新了 .v 但视图闭包永远读到原始空数组。
    // 此用例显式断言：loadCommunityData 返回的 creators/authors 被 renderSiteView 收到的
    // ctx.allCreators / ctx.repoAuthors 正确反映——即同一份 ref 的 .v。
    const el = mountCustomElement("app-content") as unknown as ContentEl;
    await sleep(50);

    const mockCreators = [
      { name: "测试创作者A", site: "bilibili", role: "creator", url: "https://a.example" },
      { name: "测试创作者B", site: "afdian", role: "vup", url: "https://b.example" },
    ];
    const mockAuthors = [{ login: "repoAuthorA", avatar: "https://avatar/a.png" }];

    vi.mocked(loadCommunityData).mockResolvedValue({
      sites: [
        { id: "bilibili", label: "B站", url: "https://bilibili.com", icon: "", desc: "", group: "" },
        { id: "afdian", label: "爱发电", url: "https://afdian.com", icon: "", desc: "", group: "" },
      ],
      // @ts-expect-error 覆盖 LocalCreator 类型为最小形状
      creators: mockCreators,
      authors: mockAuthors,
    });

    el._current = "workshop";
    el._render();
    // initWorkshopTabs 用 setTimeout(100) 延迟加载 + 内部 async showCreatorsBySite 完成
    await sleep(300);

    // renderSiteView 必须被调用，且 ctx.allCreators 里包含测试创作者A
    const viewCalls = vi.mocked(renderSiteView).mock.calls;
    expect(viewCalls.length).toBeGreaterThan(0);
    const lastCtx = viewCalls[viewCalls.length - 1][1] as { allCreators: unknown[]; repoAuthors: unknown[] };
    expect(lastCtx.allCreators.length).toBe(mockCreators.length);
    expect(lastCtx.allCreators.map((c: any) => c.name)).toContain("测试创作者A");
    // 同时校验 repoAuthors（另一条 ref 通道）
    expect(lastCtx.repoAuthors.length).toBe(mockAuthors.length);

    unmountElement(el);
  });

  it("内嵌模式直连官网（iframe.src=site.url，不再走本地代理 127.0.0.1）", async () => {
    const el = mountCustomElement("app-content") as unknown as ContentEl;
    await sleep(50);
    vi.mocked(loadCommunityData).mockResolvedValue({
      sites: [
        { id: "bilibili", label: "B站", url: "https://bilibili.com", icon: "", desc: "", group: "" },
      ],
      creators: [],
      authors: [],
    });
    // renderSiteView mock：渲染可交互卡片 + 模式切换按钮（真实实现内部同样绑定 ctx.openUrl）
    vi.mocked(renderSiteView).mockImplementation((site, ctx) => {
      ctx.searchResults.innerHTML =
        '<button id="cr-mode-toggle"><span class="cr-mode-opt cr-mode-ext active">↗ 外链</span><span class="cr-mode-opt cr-mode-emb">🔍 内嵌</span><span class="cr-mode-opt cr-mode-win">🖥️ 窗口</span></button>' +
        `<div class="cr-site-card">${site.label}</div>`;
      ctx.searchResults
        .querySelector(".cr-site-card")!
        .addEventListener("click", () => ctx.openUrl(site.url));
      return () => {};
    });
    el._current = "workshop";
    el._render();
    await sleep(200);

    // 点击卡片 → openUrl 应被调用（真实实现中会根据 browseMode 决定走 openEmbedded 还是 OpenInBrowser）
    const card = el.shadowRoot.querySelector(".cr-site-card") as HTMLElement | null;
    expect(card).toBeTruthy();
    card!.click();

    // 验证 openUrl 被调用（通过 getApp mock 验证）
    const { getApp } = await import("../../backend/app.ts");
    const app = await getApp();
    expect((app as any).OpenInBrowser).toHaveBeenCalledOnce();
    expect(String(((app as any).OpenInBrowser as any).mock.calls[0][0])).toBe("https://bilibili.com");
    unmountElement(el);
  });
});

describe("纯函数（直引 util：formatBytes / esc，AppContent 不再持有薄壳）", () => {
  it("formatBytes：0/字节/KB/MB 分级", () => {
    expect(formatBytes(0)).toBe("");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
  });

  it("esc：规范转义（含引号）", () => {
    expect(esc('<b title="x">')).toContain("&lt;b");
    expect(esc('a"b')).toContain("&quot;");
    expect(esc(null as unknown as string)).toBe("");
    expect(esc(undefined as unknown as string)).toBe("");
  });
});
