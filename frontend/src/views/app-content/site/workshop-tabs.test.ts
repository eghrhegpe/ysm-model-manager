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
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { createWorkshopPageState } from "./workshop-page-state.ts";

import {
  createWorkshopRefs,
  initWorkshopTabs,
  type WorkshopRefs,
} from "./workshop-tabs.ts";

const site = { id: "bilibili", label: "B站", url: "https://bilibili.com" } as WorkshopSite;

/** 组装 initWorkshopTabs 需要的假 host（真实 DOM 承载 getElementById / querySelectorAll） */
function makeHost() {
  const el = document.createElement("div");
  el.innerHTML = `
    <div id="ws-tabs"></div>
    <div id="ws-search-results"></div>
  `;
  // 假 ShadowRoot：普通 div 无 getElementById，补一个按 id 查询的实现
  (el as unknown as { getElementById: (id: string) => Element | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  const root = el as unknown as ShadowRoot;
  return { root, el };
}

/** 造带 showSiteView 收集器的 refs（P1-8：渲染入口收进 refs.showSiteViewRef，不再有全局 setShowSiteView） */
function makeRefsWithShowSpy(): {
  refs: WorkshopRefs;
  calls: Array<WorkshopSite | null>;
} {
  const calls: Array<WorkshopSite | null> = [];
  const refs = createWorkshopRefs();
  refs.showSiteViewRef.v = (s) => calls.push(s);
  return { refs, calls };
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
  document.body.innerHTML = "";
});

describe("initWorkshopTabs — 页作用域句柄（ADR-263）", () => {
  it("默认站点加载后：currentSite 写入页作用域，重渲染读到同一站点", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site], creators: [], authors: [] });
      const { root } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      expect(page.getCurrentSite()).toBeNull(); // 定时器未触发前不写

      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      expect(page.getCurrentSite()).toBe(site);
      expect(calls).toContain(site);
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
      const { root, el } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      calls.length = 0;
      (el.querySelector('[data-tab="afdian"]') as HTMLElement).click();
      await flushAsync();

      expect(page.getCurrentSite()).toBe(siteB);
      expect(calls.at(-1)).toBe(siteB);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sites 未命中该 id → 游标不被污染（早期回落，不写幽灵站点）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site], creators: [], authors: [] });
      const { root, el } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();
      expect(page.getCurrentSite()).toBe(site);

      // 第二次数据里没有 bilibili → find 未命中 → 早退，游标保持上一次的值
      loadCommunityData.mockResolvedValue({ sites: [], creators: [], authors: [] });
      const before = page.getCurrentSite();
      (el.querySelector('[data-tab="bilibili"]') as HTMLElement | null)?.click();
      await flushAsync();

      expect(page.getCurrentSite()).toBe(before);
      expect(calls.length).toBe(1); // 早退不再触发重渲染
    } finally {
      vi.useRealTimers();
    }
  });

  it("本地作者补充完成后重渲染当前站点（enrich 路径同样读句柄实时值）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site], creators: [], authors: [] });
      loadLocalAuthors.mockResolvedValue([{ name: "本地作者", desc: "", type: "bilibili" }]);
      const { root } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      // enrich 完成会补一次重渲染，且必须仍是当前站点
      expect(calls.length).toBeGreaterThan(1);
      expect(calls.every((s) => s === site)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("无站点（配置为空）→ 空态提示指向导入，不再引导「导出站点」（锐评 P0-1）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [], creators: [], authors: [], failed: false });
      const { root, el } = makeHost();

      initWorkshopTabs(root, createWorkshopRefs(), createWorkshopPageState(), () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      // t 被 mock 成返回 key 本身 → 直接断言 key，锁定「恢复路径 = 导入」
      const tabsEl = el.querySelector("#ws-tabs") as HTMLElement;
      const hint = tabsEl.textContent ?? "";
      expect(hint).toContain("workshop.importSite");
      expect(hint).not.toContain("workshop.exportSite");
      // 图标半边同样要锁：回退成 upload 图标应红（复核「假锁」#4）。
      // 断言用 polyline points 属性而非整串 SVG——innerHTML 往返会被 happy-dom 规范化
      // （自闭合 → 显式闭合），整串比对必然误报；两点串是 upload(上箭头)/import(下箭头) 的唯一差异。
      const importMarker = UI_ICONS.import.match(/points="[^"]+"/)?.[0] ?? "";
      const uploadMarker = UI_ICONS.upload.match(/points="[^"]+"/)?.[0] ?? "";
      expect(importMarker).not.toBe(""); // 前置：图标确有可判别标记
      expect(importMarker).not.toBe(uploadMarker);
      expect(tabsEl.innerHTML).toContain(importMarker);
      expect(tabsEl.innerHTML).not.toContain(uploadMarker);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("initWorkshopTabs — 站点 tab 可访问性（tabs-a11y 复用，收敛手搓高亮）", () => {
  const siteB = { id: "afdian", label: "爱发电", url: "https://afdian.com" } as WorkshopSite;

  it("动态生成后：tablist/tab/aria-controls/roving tabindex 全套注入（不再是全应用唯一无 ARIA 的 tab 栏）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site, siteB], creators: [], authors: [] });
      const { root, el } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      const tabs = [...el.querySelectorAll<HTMLElement>("#ws-tabs .repo-tab")];
      expect(el.querySelector("#ws-tabs")?.getAttribute("role")).toBe("tablist");
      expect(tabs.map((b) => b.getAttribute("role"))).toEqual(["tab", "tab"]);
      expect(tabs.map((b) => b.getAttribute("aria-controls"))).toEqual([
        "ws-search-results",
        "ws-search-results",
      ]);
      // 无 localStorage 记忆 → 首个站点为初始激活项，roving tabindex 整组仅一个 0
      expect(tabs.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1"]);
      expect(tabs.map((b) => b.getAttribute("aria-selected"))).toEqual(["true", "false"]);
      expect(calls).toContain(site);
    } finally {
      vi.useRealTimers();
    }
  });

  it("点击切换 → active/aria-selected/tabindex 互斥迁移由原语统一持有（高亮循环已删）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site, siteB], creators: [], authors: [] });
      const { root, el } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      (el.querySelector('#ws-tabs [data-tab="afdian"]') as HTMLElement).click();
      await flushAsync();

      const tabs = [...el.querySelectorAll<HTMLElement>("#ws-tabs .repo-tab")];
      expect(tabs.map((b) => b.classList.contains("active"))).toEqual([false, true]);
      expect(tabs.map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true"]);
      expect(tabs.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "0"]);
      expect(page.getCurrentSite()).toBe(siteB);
      expect(calls.at(-1)).toBe(siteB);
    } finally {
      vi.useRealTimers();
    }
  });

  it("方向键 ArrowRight → 焦点移动并自动激活（键盘可达性回归红线）", async () => {
    vi.useFakeTimers();
    try {
      loadCommunityData.mockResolvedValue({ sites: [site, siteB], creators: [], authors: [] });
      const { root, el } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      const alpha = el.querySelector('#ws-tabs [data-tab="bilibili"]') as HTMLElement;
      alpha.focus();
      alpha.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await flushAsync();

      expect(page.getCurrentSite()).toBe(siteB);
      expect(calls.at(-1)).toBe(siteB);
    } finally {
      vi.useRealTimers();
    }
  });

  it("恢复上次 tab：记忆命中项为初始激活（seeded active → aria/tabindex 对齐）", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("ysm-ws-last-tab", "afdian");
      loadCommunityData.mockResolvedValue({ sites: [site, siteB], creators: [], authors: [] });
      const { root, el } = makeHost();
      const page = createWorkshopPageState();
      const { refs, calls } = makeRefsWithShowSpy();

      initWorkshopTabs(root, refs, page, () => {});
      await vi.advanceTimersByTimeAsync(150);
      await flushAsync();

      const tabs = [...el.querySelectorAll<HTMLElement>("#ws-tabs .repo-tab")];
      expect(tabs.map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true"]);
      expect(tabs.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "0"]);
      expect(page.getCurrentSite()).toBe(siteB);
      expect(calls).toContain(siteB);
    } finally {
      vi.useRealTimers();
    }
  });
});
