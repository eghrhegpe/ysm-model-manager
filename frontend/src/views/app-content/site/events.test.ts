// ===== 站点视图浏览态事件组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// 真实绑定 bindBrowseEvents：空态本地浏览/预设搜索/星标/详情浮层/storage 同步/cleanup。
// 网络路径（tryFetchModels）与进度 UI mock，卡片由真实 createCrCard 渲染。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../../bus.ts";

// mock bindings + 网络/进度（浏览仓库模型路径不测，阻断 getApp 与 tryFetchModels）
vi.mock("../../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    DebugExtractCreatorAvatar: vi.fn(),
    LoadAppConfig: vi.fn().mockResolvedValue({ mirror: "" }),
  }),
}));
vi.mock("../../../features/community/data.ts", () => ({
  showProgress: vi.fn(),
  tryFetchModels: vi.fn(),
}));

import { bindBrowseEvents } from "./events.ts";
import type { SiteViewState } from "./types.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { WorkshopSite } from "../../../../bindings/ysm-model-manager/go/types/models.ts";

interface MountResult {
  state: SiteViewState;
  searchResults: HTMLElement;
  refresh: () => void;
  cleanup: () => void;
}

function mount(over: { creators?: LocalCreatorLike[]; site?: Partial<WorkshopSite> } = {}): MountResult {
  const searchResults = document.createElement("div");
  const creators =
    over.creators ??
    ([
      { name: "甲", desc: "描述甲", tag: "", type: "siteA", role: "" },
    ] as unknown as LocalCreatorLike[]);
  const site = {
    id: "siteA",
    label: "测试站",
    searchUrl: "https://s.example/?q=",
    url: "https://s.example/",
    ...over.site,
  } as WorkshopSite;
  const state = {
    esc: (s: unknown) => String(s),
    searchResults,
    allCreators: [...creators],
    allSites: [],
    wsEditModeRef: { v: false },
    site,
    creators,
    authorCountMap: { 甲: 3 },
    repoModelCache: new Map(),
    showRepoModels: vi.fn(),
    fillSearch: (tpl: string, q: string) => tpl + encodeURIComponent(q),
    openUrl: vi.fn(),
    backToSite: vi.fn(),
    avatarCache: {},
    bus,
  } as unknown as SiteViewState;
  document.body.appendChild(searchResults);
  const refresh = vi.fn();
  const cleanup = bindBrowseEvents(state, refresh);
  return { state, searchResults, refresh, cleanup };
}

/** 构造「含创作者网格」的最小 state（createCrCard 渲染卡片所需） */
function makeCardState(searchResults: HTMLElement): SiteViewState {
  const creators = [
    { name: "甲", desc: "D", type: "siteA", role: "" },
  ] as unknown as LocalCreatorLike[];
  return {
    searchResults,
    creators,
    allCreators: [...creators],
    wsEditModeRef: { v: false },
    esc: (s: unknown) => String(s),
    authorCountMap: {},
    avatarCache: {},
    bus,
    site: { id: "siteA", label: "站" },
  } as unknown as SiteViewState;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  // 每个用例都调 cleanup 移除 window storage 监听，防跨用例残留
  // （bindBrowseEvents 的 cleanup 由挂载方在切页时调用）
});

describe("bindBrowseEvents 浏览态", () => {
  it("1. 空创作者 → 本地浏览按钮 → nav:change repository", () => {
    const navSpy = vi.fn();
    const unsub = bus.on("nav:change", navSpy);
    const { searchResults, cleanup } = mount({ creators: [] });
    searchResults.innerHTML =
      '<button data-local-empty>📂 浏览本地模型</button>';
    // 重新绑定以覆盖上面 mount 的空渲染（creators 为空时不渲染网格）
    const state = {
      searchResults,
      bus,
    } as unknown as SiteViewState;
    cleanup();
    const c2 = bindBrowseEvents(state, vi.fn());
    (searchResults.querySelector("[data-local-empty]") as HTMLElement).click();
    expect(navSpy).toHaveBeenCalledWith({ page: "repository" });
    c2();
    unsub();
  });

  it("2. 预设搜索按钮（有 searchUrl）→ openUrl(fillSearch(...))", () => {
    const { state, searchResults, cleanup } = mount();
    searchResults.innerHTML =
      '<button class="cr-preset-btn" data-q="关键词">🔍 关键词</button>';
    const state2 = { ...state, searchResults } as unknown as SiteViewState;
    cleanup();
    const c2 = bindBrowseEvents(state2, vi.fn());
    (searchResults.querySelector(".cr-preset-btn") as HTMLElement).click();
    expect(state2.openUrl).toHaveBeenCalledWith(
      "https://s.example/?q=" + encodeURIComponent("关键词"),
    );
    c2();
  });

  it("3. 预设搜索按钮（无 searchUrl）→ 打开站点首页", () => {
    const { state, searchResults, cleanup } = mount({
      site: { searchUrl: undefined },
    });
    searchResults.innerHTML =
      '<button class="cr-preset-btn" data-q="x">🔍</button>';
    const state2 = { ...state, searchResults } as unknown as SiteViewState;
    cleanup();
    const c2 = bindBrowseEvents(state2, vi.fn());
    (searchResults.querySelector(".cr-preset-btn") as HTMLElement).click();
    expect(state2.openUrl).toHaveBeenCalledWith("https://s.example/");
    c2();
  });

  it("4. 创作者网格经 createCrCard 填充（含 data-name 与星标）", () => {
    const { cleanup } = mount();
    const searchResults = document.createElement("div");
    searchResults.innerHTML = '<div id="cr-creator-grid"></div>';
    cleanup();
    const c2 = bindBrowseEvents(makeCardState(searchResults), vi.fn());
    const grid = searchResults.querySelector("#cr-creator-grid")!;
    expect(grid.querySelectorAll(".gh-card[data-name]").length).toBe(1);
    expect(grid.querySelector(".cr-star-btn")?.getAttribute("data-star")).toBe(
      "甲",
    );
    c2();
  });

  it("5. 星标点击 → 收藏/取消 + toast", () => {
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    const { cleanup } = mount();
    const searchResults = document.createElement("div");
    searchResults.innerHTML = '<div id="cr-creator-grid"></div>';
    cleanup();
    const c2 = bindBrowseEvents(makeCardState(searchResults), vi.fn());
    const star = searchResults.querySelector(".cr-star-btn") as HTMLElement;
    expect(star.textContent).toBe("☆");
    star.click();
    expect(star.textContent).toBe("⭐");
    expect(toastSpy.mock.calls[0][0].msg).toContain("已收藏 甲");
    star.click();
    expect(star.textContent).toBe("☆");
    expect(toastSpy.mock.calls[1][0].msg).toContain("取消收藏");
    c2();
    unsub();
  });

  it("6. storage 事件（ysm-fav-creators）→ 星标文案同步", () => {
    const { cleanup } = mount();
    const searchResults = document.createElement("div");
    searchResults.innerHTML = '<div id="cr-creator-grid"></div>';
    cleanup();
    const c2 = bindBrowseEvents(makeCardState(searchResults), vi.fn());
    localStorage.setItem("ysm-fav-creators", JSON.stringify(["甲"]));
    window.dispatchEvent(
      new StorageEvent("storage", { key: "ysm-fav-creators" }),
    );
    expect(
      (searchResults.querySelector(".cr-star-btn") as HTMLElement).textContent,
    ).toBe("⭐");
    c2();
  });

  it("7. cleanup 移除 window storage 监听（dispatch 不再同步）", () => {
    const { cleanup } = mount();
    const searchResults = document.createElement("div");
    searchResults.innerHTML = '<div id="cr-creator-grid"></div>';
    cleanup();
    const c2 = bindBrowseEvents(makeCardState(searchResults), vi.fn());
    c2(); // 立即清理
    localStorage.setItem("ysm-fav-creators", JSON.stringify(["甲"]));
    window.dispatchEvent(
      new StorageEvent("storage", { key: "ysm-fav-creators" }),
    );
    expect(
      (searchResults.querySelector(".cr-star-btn") as HTMLElement).textContent,
    ).toBe("☆"); // 监听已移除，不刷新
  });
});
