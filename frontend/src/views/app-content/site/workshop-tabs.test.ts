// ===== initWorkshopTabs 页作用域接线单测（ADR-263）=====
// 背景：`initWorkshopTabs` 曾直接读写 `host.state.currentSite`——它手持整个 AppContentState，
// 因此「顺手」写下了 `workshopTimer` 也无人拦得住（同一个 host 参数，同一个 state 对象）。
// 本文件锁定收窄后的契约：tabs 只拿到页作用域句柄，写站点必须经 `page.setCurrentSite`，
// 且重渲染读的是**同一句柄**的实时值（不是渲染时的快照）。
//
// 同时锁定 p7 修复：`sites.find()` 未命中即 return，不得把不属于本次数据的站点写进游标
// （否则默认站点定时器在配置被清空后会留下陈旧 currentSite，使离屏重渲染指向幽灵站点）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LocalCreator } from "@/features/community/community-data.ts";

const { loadCommunityData, loadLocalAuthors, mergeLocalAuthorsInto } = vi.hoisted(() => ({
  loadCommunityData: vi.fn(),
  loadLocalAuthors: vi.fn(async (): Promise<LocalCreator[]> => []),
  mergeLocalAuthorsInto: vi.fn((creators: unknown[]) => creators),
}));

vi.mock("@/features/community/community-data.ts", () => ({
  loadCommunityData,
  loadLocalAuthors,
  mergeLocalAuthorsInto,
}));
// tabs 顶部 import 了 toast/i18n/图标等 DOM 与文案依赖，与本文件契约无关——只保留站点图标。
vi.mock("@/utils/icon/workshop-icons.ts", () => ({ getSiteIcon: () => "" }));
vi.mock("@/core/i18n/t.ts", () => ({ t: (k: string) => k }));
vi.mock("@/bus", () => ({ bus: { emit: vi.fn() } }));

import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";
import { createWorkshopPageState } from "./workshop-page-state.ts";
import type { AppContentHost } from "@/views/app-content/host.ts";
import {
  createWorkshopRefs,
  initWorkshopTabs,
  setShowSiteView,
} from "./workshop-tabs.ts";

const site = { id: "bilibili", label: "B站", url: "https://bilibili.com" } as WorkshopSite;

/** 组装 initWorkshopTabs 需要的假 host（真实 DOM 承载 getElementById / querySelectorAll） */
function makeHost() {
  const el = document.createElement("div");
  el.innerHTML = `
    <div id="ws-tabs"></div>
    <div id="ws-search-results"></div>
    <div id="ws-creator-view"></div>
  `;
  // 假 ShadowRoot：普通 div 无 getElementById，补一个按 id 查询的实现
  (el as unknown as { getElementById: (id: string) => Element | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  const host = { state: { root: el } } as unknown as AppContentHost;
  return { host, el };
}

/** 收集 setShowSiteView 注册进来的 showSiteView 闭包调用 */
function spyShowSiteView(): { calls: Array<WorkshopSite | null>; restore: () => void } {
  const calls: Array<WorkshopSite | null> = [];
  setShowSiteView((s) => calls.push(s));
  return { calls, restore: () => setShowSiteView(() => {}) };
}

/** 排空微任务（定时器回调是 async 链） */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
  loadLocalAuthors.mockResolvedValue([]);
  mergeLocalAuthorsInto.mockImplementation((creators: unknown[]) => creators);
});

afterEach(() => {
  setShowSiteView(() => {});
  document.body.innerHTML = "";
});

describe("initWorkshopTabs — 页作用域句柄（ADR-263）", () => {
  it("默认站点加载后：currentSite 写入页作用域，重渲染读到同一站点", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site], creators: [], authors: [] });
      const { host } = makeHost();
      const page = createWorkshopPageState();
      const spy = spyShowSiteView();

      initWorkshopTabs(host, createWorkshopRefs(), page);
      expect(page.getCurrentSite()).toBeNull(); // 定时器未触发前不写

      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      expect(page.getCurrentSite()).toBe(site);
      expect(spy.calls).toContain(site);
      spy.restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tab 点击 → 写页作用域并按新值重渲染（读实时值，非快照）", async () => {
    vi.useFakeTimers();
    try {
      const siteB = { id: "afdian", label: "爱发电", url: "https://afdian.com" } as WorkshopSite;
      loadCommunityData.mockResolvedValue({
        sites: [site, siteB],
        creators: [],
        authors: [],
      });
      const { host, el } = makeHost();
      const page = createWorkshopPageState();
      const spy = spyShowSiteView();

      initWorkshopTabs(host, createWorkshopRefs(), page);
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      spy.calls.length = 0;
      (el.querySelector('[data-tab="afdian"]') as HTMLElement).click();
      await flushAsync();

      expect(page.getCurrentSite()).toBe(siteB);
      expect(spy.calls.at(-1)).toBe(siteB);
      spy.restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sites 未命中该 id → 游标不被污染（早期回落，不写幽灵站点）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site], creators: [], authors: [] });
      const { host, el } = makeHost();
      const page = createWorkshopPageState();
      const spy = spyShowSiteView();

      initWorkshopTabs(host, createWorkshopRefs(), page);
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();
      expect(page.getCurrentSite()).toBe(site);

      // 第二次数据里没有 bilibili → find 未命中 → 早退，游标保持上一次的值
      loadCommunityData.mockResolvedValue({ sites: [], creators: [], authors: [] });
      const before = page.getCurrentSite();
      (el.querySelector('[data-tab="bilibili"]') as HTMLElement | null)?.click();
      await flushAsync();

      expect(page.getCurrentSite()).toBe(before);
      spy.restore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("本地作者补充完成后重渲染当前站点（enrich 路径同样读句柄实时值）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site], creators: [], authors: [] });
      loadLocalAuthors.mockResolvedValue([{ name: "本地作者", desc: "", type: "bilibili" }]);
      const { host } = makeHost();
      const page = createWorkshopPageState();
      const spy = spyShowSiteView();

      initWorkshopTabs(host, createWorkshopRefs(), page);
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      // enrich 完成会补一次重渲染，且必须仍是当前站点
      expect(spy.calls.length).toBeGreaterThan(1);
      expect(spy.calls.every((s) => s === site)).toBe(true);
      spy.restore();
    } finally {
      vi.useRealTimers();
    }
  });
});
