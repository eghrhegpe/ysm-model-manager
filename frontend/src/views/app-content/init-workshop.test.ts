// ===== init-workshop（创意工坊页编排入口）单测 =====
// 覆盖 initWorkshopPage / resetAvatarConfigLoaded：
//  - 初始化状态装配（页作用域 currentSite / workshopCache / avatarCache / extractAvatars / tabs 接线）
//  - showSiteView 闭包 ctx：openUrl 透传、setBrowseMode 单源 ref、backToSite、reRender cleanup 次序
//  - avatar:refresh 订阅：命中卡片更新 img.src、未命中重渲染、重复 dataUri 提前返回、单 host 注册守卫
//  - config-loaded 事件重提取 + 模块级注册守卫 + resetAvatarConfigLoaded 复位
// mock 写法按知识卡 vitest-env-switch.md 模式 4（vi.hoisted + mock getApp）；bus 用真实实例 + spy。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "@/bus";

const {
  getApp,
  eventsOn,
  renderSiteView,
  showRepoModels,
  extractAvatars,
  openSite,
  bindSiteEvents,
  initWorkshopTabs,
  setShowSiteView,
  createWorkshopRefs,
  fillSearch,
} = vi.hoisted(() => ({
  getApp: vi.fn(),
  eventsOn: vi.fn((_e: string, _cb: (...a: unknown[]) => void) => vi.fn()),
  renderSiteView: vi.fn(() => vi.fn()),
  showRepoModels: vi.fn(async () => {}),
  extractAvatars: vi.fn(async () => {}),
  openSite: vi.fn(),
  bindSiteEvents: vi.fn(),
  initWorkshopTabs: vi.fn(),
  setShowSiteView: vi.fn(),
  createWorkshopRefs: vi.fn(() => ({
    allSitesRef: { v: [] as unknown[] },
    allCreatorsRef: { v: [] as unknown[] },
    repoAuthorsRef: { v: [] as unknown[] },
    wsEditModeRef: { v: false },
  })),
  fillSearch: vi.fn(),
}));

vi.mock("@/backend/app.ts", () => ({ getApp }));
vi.mock("@/backend/runtime.ts", () => ({ Events: { On: eventsOn } }));
vi.mock("./site/site-view.ts", () => ({ renderSiteView }));
vi.mock("@/features/community/show-repo-models.ts", () => ({ showRepoModels }));
vi.mock("./site/workshop-avatar.ts", () => ({ extractAvatars }));
vi.mock("./site/workshop-site-opener.ts", () => ({ openSite, bindSiteEvents }));
vi.mock("./site/workshop-tabs.ts", () => ({ initWorkshopTabs, setShowSiteView, createWorkshopRefs }));
vi.mock("@/features/community/community-data.ts", () => ({ fillSearch }));

import { initWorkshopPage, resetAvatarConfigLoaded } from "./init-workshop.ts";
import { SubscriptionBucket } from "./subscription-bucket.ts";
import { flushPromises } from "@/test-utils/index.ts";
import type { AppContentHost } from "./host.ts";
import type { WorkshopPageState } from "./site/workshop-page-state.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";

/** vi.fn() 未显式标注入参时 mock.calls 元组推断为空，统一经 unknown[] 取参 */
function callArgs(mock: unknown, index: number): unknown[] {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[index] ?? [];
}
function lastCallArgs(mock: unknown): unknown[] {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  return calls[calls.length - 1] ?? [];
}

/** 假 host 结构（测试用，对齐 AppContentHost 接口） */
interface MockHost {
  state: {
    root: HTMLElement;
    avatarCache: Record<string, string>;
    workshopCache: Map<string, unknown> | null;
    githubCache: unknown;
  };
  /** 真订阅桶（ADR-260）：页内异步清理经 subs.addPage 登记，测试直接观察 pageUnsubs */
  subs: SubscriptionBucket;
}

/** 组装 initWorkshopPage 需要的假 host（真实 DOM 承载 getElementById / querySelectorAll） */
function makeHost(cardsHTML = "") {
  const el = document.createElement("div");
  el.innerHTML = `
    <div id="ws-search-results"></div>
    <div id="ws-creator-view"></div>
    ${cardsHTML}
  `;
  // 假 ShadowRoot：普通 div 无 getElementById，补一个按 id 查询的实现
  (el as unknown as { getElementById: (id: string) => Element | null }).getElementById =
    (id: string) => el.querySelector(`#${id}`);
  const raw: MockHost = {
    state: {
      root: el,
      avatarCache: {},
      workshopCache: null,
      githubCache: null,
    },
    // 真桶（ADR-260）：页内异步清理经 subs.addPage 登记，测试直接观察 pageUnsubs
    subs: new SubscriptionBucket(),
  };
  createdHosts.push(raw);
  return { host: raw as unknown as AppContentHost, raw, el };
}

/** 取 setShowSiteView 注册进来的 showSiteView 闭包 */
function getShowSiteView(): (site: unknown) => void {
  const call = setShowSiteView.mock.calls.at(-1);
  if (!call) throw new Error("setShowSiteView 未被调用");
  return call[0] as (site: unknown) => void;
}

/**
 * 取 initWorkshopPage 创建的页作用域句柄（ADR-263）。
 * 它是页私有对象，不再挂在 host.state 上——测试经 initWorkshopTabs 的实参拿到它，
 * 这同时验证了「同一实例必须下传给 tabs」这条单源契约。
 */
function getPageState(): WorkshopPageState {
  const call = initWorkshopTabs.mock.calls.at(-1);
  if (!call) throw new Error("initWorkshopTabs 未被调用");
  return call[2] as WorkshopPageState;
}
const createdHosts: Array<MockHost> = [];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  // 回收真实 bus 上的 avatar:refresh 订阅，防止跨测试泄漏触发旧 host 副作用
  createdHosts.forEach((h) => {
    h.subs.globalUnsubs.forEach((u) => u());
    h.subs.globalUnsubs = [];
  });
  createdHosts.length = 0;
  resetAvatarConfigLoaded();
});

const site = { id: "github", url: "https://github.com/", label: "GitHub" } as unknown as WorkshopSite;
const site2 = { id: "bilibili", url: "https://bilibili.com/", label: "B站" } as unknown as WorkshopSite;

describe("initWorkshopPage — 初始化装配", () => {
  it("状态装配：页作用域 currentSite 置空、workshopCache/avatarCache 初始化、子模块接线", () => {
    const { host, raw } = makeHost();
    initWorkshopPage(host);

    // ADR-263：currentSite 已下沉到页作用域（不再借宿 AppContentState）——
    // 装配后初始为空，且结构性不可在共享 state 上访问到（后者已无该字段，故此处不断言）
    expect(getPageState().getCurrentSite()).toBeNull();
    expect(raw.state.workshopCache).toBeInstanceOf(Map);
    expect(raw.state.avatarCache).toEqual({});
    expect(extractAvatars).toHaveBeenCalledWith(host);
    expect(initWorkshopTabs).toHaveBeenCalledTimes(1);
    expect(callArgs(initWorkshopTabs, 0)[0]).toBe(host);
    // createWorkshopRefs 生成的单源 ref 原样传给 tabs（同实例约定）
    expect(callArgs(initWorkshopTabs, 0)[1]).toBe(createWorkshopRefs.mock.results[0]!.value);
    // 同一个页作用域句柄也必须原样传给 tabs 与 opener（同实例约定，ADR-263）
    const page = callArgs(initWorkshopTabs, 0)[2];
    expect(page).toBe(getPageState());
    expect(callArgs(bindSiteEvents, 0)[0]).toBe(host);
    expect(callArgs(bindSiteEvents, 0)[1]).toBe(page);
    expect(setShowSiteView).toHaveBeenCalledTimes(1);
    expect(typeof callArgs(setShowSiteView, 0)[0]).toBe("function");
  });

  it("已有缓存/已注册的 host 二次 init：不重复建 cache、不重复注册 avatar:refresh", () => {
    const { host, raw } = makeHost();
    initWorkshopPage(host);
    const cache = raw.state.workshopCache;
    initWorkshopPage(host);
    expect(raw.state.workshopCache).toBe(cache); // if (!host.state.workshopCache) 守卫
    expect(raw.subs.globalUnsubs).toHaveLength(1); // addGlobalOnce 守卫（ADR-261）
  });

  // ADR-263 决策 3「只给工厂不给单例」的正面锁：每次 init 必须生成**新**页作用域实例，
  // 旧游标不得跨代泄漏。若哪天有人为省事改成模块级单例，本用例当场转红。
  it("二次 init → 页作用域句柄换新实例（不复用单例，旧游标不泄漏）", () => {
    const { host } = makeHost();
    initWorkshopPage(host);
    const page1 = callArgs(initWorkshopTabs, 0)[2] as WorkshopPageState;
    page1.setCurrentSite(site);

    initWorkshopPage(host);
    const page2 = callArgs(initWorkshopTabs, 1)[2] as WorkshopPageState;

    expect(page2).not.toBe(page1);
    expect(page2.getCurrentSite()).toBeNull(); // 新实例空游标——不继承上一代
    expect(page1.getCurrentSite()).toBe(site); // 旧实例不受影响（无全局共享）
  });

  // 早退分支（骨架缺失）语义固定：page 尚未创建，initWorkshopTabs / bindSiteEvents 都未接线。
  // 这与旧实现的 `host.state.currentSite = null` 同样被跳过——行为等价，非回归。
  it("骨架缺失早退 → 不创建页作用域、不接线子模块（与旧置空路径同样被跳过）", () => {
    const el = document.createElement("div"); // 无 #ws-search-results / #ws-creator-view
    (el as unknown as { getElementById: (id: string) => Element | null }).getElementById = (
      id: string,
    ) => el.querySelector(`#${id}`);
    const host = { state: { root: el } } as unknown as AppContentHost;
    initWorkshopPage(host);
    expect(initWorkshopTabs).not.toHaveBeenCalled();
    expect(bindSiteEvents).not.toHaveBeenCalled();
  });
});

describe("initWorkshopPage — showSiteView 与 ctx", () => {
  it("showSiteView(null) 不渲染；showSiteView(site) → renderSiteView(site, ctx)", () => {
    const { host, el } = makeHost();
    initWorkshopPage(host);
    const showSiteView = getShowSiteView();

    showSiteView(null);
    expect(renderSiteView).not.toHaveBeenCalled();

    showSiteView(site);
    expect(renderSiteView).toHaveBeenCalledTimes(1);
    const args0 = callArgs(renderSiteView, 0);
    const calledSite = args0[0];
    const ctx = args0[1] as any;
    expect(calledSite).toBe(site);
    expect(ctx.searchResults).toBe(el.querySelector("#ws-search-results"));
    expect(ctx.creatorView).toBe(el.querySelector("#ws-creator-view"));
    expect(ctx.allSites).toEqual([]); // refs.allSitesRef.v
    expect(ctx.wsEditModeRef).toEqual({ v: false });
    expect(ctx.repoModelCache).toBe(raw_workshopCache(host));
    expect(ctx.fillSearch).toBe(fillSearch);
    expect(ctx.esc("<b>&\"'")).toBe("&lt;b&gt;&amp;&quot;&#39;");
  });

  it("ctx 读取 localStorage 预置的 activeTag / searchKw", () => {
    localStorage.setItem("ysm-ws-active-tag", "tagA");
    localStorage.setItem("ysm-ws-search-kw", "小红");
    const { host } = makeHost();
    initWorkshopPage(host);
    getShowSiteView()(site);
    const ctx = lastCallArgs(renderSiteView)[1] as any;
    expect(ctx.activeTag).toBe("tagA");
    expect(ctx.searchKw).toBe("小红");
  });

  it("ctx.openUrl 透传 targetUrl；setBrowseMode 更新单源 ref 后 openUrl 读到新值", () => {
    const { host } = makeHost();
    initWorkshopPage(host);
    getShowSiteView()(site);
    const ctx = lastCallArgs(renderSiteView)[1] as any;

    ctx.openUrl("https://github.com/search?q=foo");
    expect(openSite).toHaveBeenCalledWith(host, site, "external", "https://github.com/search?q=foo");

    ctx.setBrowseMode("embed");
    expect(localStorage.getItem("ysm-browse-mode")).toBe("embed"); // saveBrowseMode 落盘

    ctx.openUrl("https://x/y");
    expect(openSite).toHaveBeenLastCalledWith(host, site, "embed", "https://x/y");
  });

  it("ctx.backToSite：有 currentSite → 用它重渲染；无 → 不渲染", () => {
    const { host } = makeHost();
    initWorkshopPage(host);
    getShowSiteView()(site);
    const ctx = lastCallArgs(renderSiteView)[1] as any;

    ctx.backToSite(); // currentSite 仍为 null
    expect(renderSiteView).toHaveBeenCalledTimes(1);

    getPageState().setCurrentSite(site2);
    ctx.backToSite();
    expect(renderSiteView).toHaveBeenCalledTimes(2);
    expect(callArgs(renderSiteView, 1)[0]).toBe(site2);
  });

  it("ctx.reRender：先跑旧 cleanup 再渲染新视图（cleanup 次序）", () => {
    const cleanupA = vi.fn();
    const cleanupB = vi.fn();
    renderSiteView.mockReturnValueOnce(cleanupA).mockReturnValueOnce(cleanupB);
    const { host } = makeHost();
    initWorkshopPage(host);
    getShowSiteView()(site);
    const ctx = callArgs(renderSiteView, 0)[1] as any;

    ctx.reRender();
    expect(cleanupA).toHaveBeenCalledTimes(1);
    expect(renderSiteView).toHaveBeenCalledTimes(2);
    expect(cleanupA.mock.invocationCallOrder[0]).toBeLessThan(
      renderSiteView.mock.invocationCallOrder[1]!,
    );

    // 切站点：上一轮 reRender 存下的 cleanupB 先跑
    getShowSiteView()(site2);
    expect(cleanupB).toHaveBeenCalledTimes(1);
    expect(renderSiteView).toHaveBeenCalledTimes(3);
  });

  it("ctx.showRepoModels 委托 showRepoModels 并透传 host 清理钩子与 searchResults", async () => {
    const { host, raw, el } = makeHost();
    initWorkshopPage(host);
    getShowSiteView()(site);
    const ctx = lastCallArgs(renderSiteView)[1] as any;

    const models = [{ name: "m1", path: "p1" }];
    await ctx.showRepoModels("o/r", models, "raw");
    expect(showRepoModels).toHaveBeenCalledTimes(1);
    const args = callArgs(showRepoModels, 0);
    expect(args[0]).toBeTypeOf("function"); // esc
    // 首绑无前次清理 → args[1] 为 null（值口径，非 getter）
    expect(args[1]).toBeNull();
    expect(args[2]).toBeTypeOf("function"); // setter
    // setter 写入「页内可替换槽」；再调一次 showRepoModels 即应读到该值（往返一致）
    const token = vi.fn(async () => {});
    (args[2] as (fn: unknown) => void)(token);
    await ctx.showRepoModels("o/r", models, "raw");
    expect(callArgs(showRepoModels, 1)[1], "第二次应读到上次写入的清理").toBe(token);
    // 且该槽已随订阅桶登记：桶清理即执行（ADR-260 拆除单源）
    raw.subs.cleanupPage();
    await flushPromises();
    expect(token).toHaveBeenCalledTimes(1);
    expect(args[3]).toBe(getPageState().getCurrentSite());
    expect(args[4]).toBeTypeOf("function");
    (args[4] as (site: unknown) => void)("site-token");
    expect(getPageState().getCurrentSite()).toBe("site-token");
    expect(args[5]).toBe("o/r");
    expect(args[6]).toEqual(models);
    expect(args[7]).toBe("raw");
    expect(args[8]).toBe(el.querySelector("#ws-search-results"));
  });
});

describe("initWorkshopPage — avatar:refresh 订阅", () => {
  const cardHTML = `<div class="cr-creator-card" data-name="alice"><img class="cr-avatar" src=""/></div>`;

  it("命中卡片：更新 img.src 与缓存", () => {
    const { host, raw, el } = makeHost(cardHTML);
    initWorkshopPage(host);
    expect(raw.subs.globalUnsubs).toHaveLength(1);

    bus.emit("avatar:refresh", { author: "alice", dataUri: "data:image/png;base64,AAA" });
    const img = el.querySelector(".cr-avatar") as HTMLImageElement;
    expect(img.src).toBe("data:image/png;base64,AAA");
    expect((raw.state.avatarCache as Record<string, string>).alice).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("重复 dataUri 提前返回（不再扫 DOM）；未命中且无 currentSite 不重渲染", () => {
    const { host, raw, el } = makeHost(cardHTML);
    initWorkshopPage(host);
    const qsa = vi.spyOn(el, "querySelectorAll");

    bus.emit("avatar:refresh", { author: "bob", dataUri: "X" });
    expect(qsa).toHaveBeenCalledTimes(1);
    expect((raw.state.avatarCache as Record<string, string>).bob).toBe("X");

    // 同 author 同 dataUri → 提前 return，不再 querySelectorAll
    bus.emit("avatar:refresh", { author: "bob", dataUri: "X" });
    expect(qsa).toHaveBeenCalledTimes(1);

    // 未命中卡片 + currentSite 为 null → 不触发重渲染
    bus.emit("avatar:refresh", { author: "carol", dataUri: "Y" });
    expect(renderSiteView).not.toHaveBeenCalled();
    qsa.mockRestore();
  });

  it("未命中卡片但有 currentSite → showSiteView 重渲染当前站点", () => {
    const { host } = makeHost();
    initWorkshopPage(host);
    getPageState().setCurrentSite(site);
    getShowSiteView()(site); // 先渲染一次，占位
    renderSiteView.mockClear();

    bus.emit("avatar:refresh", { author: "nobody", dataUri: "Z" });
    expect(renderSiteView).toHaveBeenCalledTimes(1);
    expect(callArgs(renderSiteView, 0)[0]).toBe(site);
  });

  it("注册守卫按 host 生效：新 host 仍会注册自己的订阅", () => {
    const h1 = makeHost();
    const h2 = makeHost();
    initWorkshopPage(h1.host);
    initWorkshopPage(h1.host); // 同 host 守卫
    expect(h1.raw.subs.globalUnsubs).toHaveLength(1);
    initWorkshopPage(h2.host); // 新 host 注册
    expect(h2.raw.subs.globalUnsubs).toHaveLength(1);
  });
});

describe("config-loaded 事件与 resetAvatarConfigLoaded", () => {
  it("首次 init 注册 config-loaded；重复 init 不重复注册（模块级守卫）", () => {
    const h1 = makeHost();
    initWorkshopPage(h1.host);
    expect(eventsOn).toHaveBeenCalledTimes(1);
    expect(callArgs(eventsOn, 0)[0]).toBe("config-loaded");

    const h2 = makeHost();
    initWorkshopPage(h2.host);
    expect(eventsOn).toHaveBeenCalledTimes(1); // _avatarConfigLoadedRegistered 守卫
  });

  it("config-loaded 触发 → 重新提取头像；reset 复位后可重新注册", () => {
    const { host } = makeHost();
    initWorkshopPage(host);
    expect(extractAvatars).toHaveBeenCalledTimes(1);

    const handler = callArgs(eventsOn, 0)[1] as () => void;
    handler();
    expect(extractAvatars).toHaveBeenCalledTimes(2);

    const unsub = eventsOn.mock.results[0]!.value as ReturnType<typeof vi.fn>;
    expect(unsub).not.toHaveBeenCalled();
    resetAvatarConfigLoaded();
    expect(unsub).toHaveBeenCalledTimes(1);

    initWorkshopPage(host);
    expect(eventsOn).toHaveBeenCalledTimes(2);
  });
});

/** 从 host 上取 workshopCache（测试辅助，类型收窄用） */
function raw_workshopCache(host: AppContentHost): Map<string, unknown> | null {
  return (host as unknown as MockHost).state.workshopCache;
}
