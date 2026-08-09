// ===== 站点视图编辑模式事件组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// 真实绑定 bindEditEvents：拖拽排序（创作者/搜索词）、编辑入口/取消、
// 删除/新增搜索词、创作者搜索过滤。moveItem 纯函数已单独测，此处验证编排集成。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "../../../bus.ts";

// mock bindings + 社区数据源（fetch 更新配置路径不测，阻断网络与 getApp）
vi.mock("../../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    SaveWorkshopCreators: vi.fn(),
    SaveWorkshopSites: vi.fn(),
    LoadGitHubRepos: vi.fn().mockResolvedValue([]),
    LoadResourceTypes: vi.fn().mockResolvedValue("{}"),
  }),
}));
vi.mock("../community-data.ts", () => ({
  fetchCommunityCreators: vi.fn(),
  fetchCommunitySites: vi.fn(),
  mergeCommunityCreators: vi.fn(),
  mergeCommunitySites: vi.fn(),
  DEFAULT_COMMUNITY_URL: "mock://url",
}));

import { bindEditEvents } from "./edit.ts";
import type { SiteViewState } from "./types.ts";
import type { LocalCreatorLike } from "../site-view.ts";
import type { WorkshopSite, WorkshopPresetSearch } from "../../../../bindings/ysm-model-manager/go/types/models.ts";

interface MountResult {
  state: SiteViewState;
  searchResults: HTMLElement;
  refresh: () => void;
  allCreators: LocalCreatorLike[];
  site: WorkshopSite;
  presetSearches: WorkshopPresetSearch[];
}

function mount(): MountResult {
  const searchResults = document.createElement("div");
  const allCreators: LocalCreatorLike[] = [
    { name: "甲" } as LocalCreatorLike,
    { name: "乙" } as LocalCreatorLike,
  ];
  const presetSearches: WorkshopPresetSearch[] = [
    { label: "搜A", q: "a" },
    { label: "搜B", q: "b" },
  ];
  const site = { id: "siteA", presetSearches } as WorkshopSite;
  const wsEditModeRef = { v: true };
  const refresh = vi.fn();
  searchResults.innerHTML = `
    <button class="cr-edit-btn">✏️ 编辑</button>
    <button class="cr-cancel-btn">取消</button>
    <input id="ws-cr-search">
    <div class="cr-edit-card" data-edit="creator" data-edit-idx="0"><span class="cr-drag-handle">⠿</span></div>
    <div class="cr-edit-card" data-edit="creator" data-edit-idx="1"><span class="cr-drag-handle">⠿</span></div>
    <div class="cr-edit-card" data-edit="preset" data-edit-idx="0"><span class="cr-drag-handle">⠿</span></div>
    <div class="cr-edit-card" data-edit="preset" data-edit-idx="1"><span class="cr-drag-handle">⠿</span></div>
  `;
  const state = {
    searchResults,
    allCreators,
    allSites: [],
    wsEditModeRef,
    site,
    creators: allCreators,
    bus,
    ctx: {},
  } as unknown as SiteViewState;
  document.body.appendChild(searchResults);
  return { state, searchResults, refresh, allCreators, site, presetSearches };
}

/** 注入 dataTransfer 的拖拽事件（happy-dom DragEvent init 忽略 dataTransfer） */
function dragEvent(el: HTMLElement, type: string): void {
  const dt = {
    effectAllowed: "",
    dropEffect: "",
    setData: () => {},
  } as unknown as DataTransfer;
  const ev = new DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt, writable: true, configurable: true });
  el.dispatchEvent(ev);
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("bindEditEvents 编辑模式", () => {
  it("1. 创作者拖拽 drop → allCreators 全量数组重排 + refresh", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    bindEditEvents(state, refresh);
    const cards = searchResults.querySelectorAll(
      ".cr-edit-card:not([data-edit='preset'])",
    );
    dragEvent(cards[0] as HTMLElement, "dragstart");
    dragEvent(cards[1] as HTMLElement, "drop");
    expect(allCreators.map((c) => c.name)).toEqual(["乙", "甲"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("2. 搜索词拖拽 drop → site.presetSearches 重排 + refresh", () => {
    const { state, searchResults, refresh, site } = mount();
    bindEditEvents(state, refresh);
    const presets = searchResults.querySelectorAll(
      ".cr-edit-card[data-edit='preset']",
    );
    dragEvent(presets[0] as HTMLElement, "dragstart");
    dragEvent(presets[1] as HTMLElement, "drop");
    expect((site.presetSearches || []).map((p) => p.label)).toEqual(["搜B", "搜A"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("3. 拖到自身 → 顺序不变不刷新", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    bindEditEvents(state, refresh);
    const cards = searchResults.querySelectorAll(
      ".cr-edit-card:not([data-edit='preset'])",
    );
    dragEvent(cards[0] as HTMLElement, "dragstart");
    dragEvent(cards[0] as HTMLElement, "drop");
    expect(allCreators.map((c) => c.name)).toEqual(["甲", "乙"]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("4. 编辑入口 → wsEditModeRef 置 true + refresh", () => {
    const { state, searchResults, refresh } = mount();
    state.wsEditModeRef.v = false;
    bindEditEvents(state, refresh);
    (searchResults.querySelector(".cr-edit-btn") as HTMLElement).click();
    expect(state.wsEditModeRef.v).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });

  it("5. 取消 → wsEditModeRef 置 false + refresh", () => {
    const { state, searchResults, refresh } = mount();
    bindEditEvents(state, refresh);
    (searchResults.querySelector(".cr-cancel-btn") as HTMLElement).click();
    expect(state.wsEditModeRef.v).toBe(false);
    expect(refresh).toHaveBeenCalled();
  });

  it("6. 删除搜索词按钮 → splice + refresh", () => {
    const { state, searchResults, refresh, presetSearches } = mount();
    searchResults.insertAdjacentHTML(
      "beforeend",
      '<button class="cr-del-preset" data-idx="0">🗑️</button>',
    );
    bindEditEvents(state, refresh);
    (searchResults.querySelector(".cr-del-preset") as HTMLElement).click();
    expect(presetSearches.map((p) => p.label)).toEqual(["搜B"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("7. 新增搜索词 → push + refresh", () => {
    const { state, searchResults, refresh, presetSearches } = mount();
    searchResults.insertAdjacentHTML(
      "beforeend",
      '<button class="cr-add-preset">➕</button>',
    );
    bindEditEvents(state, refresh);
    (searchResults.querySelector(".cr-add-preset") as HTMLElement).click();
    expect(presetSearches).toHaveLength(3);
    expect(refresh).toHaveBeenCalled();
  });

  it("8. 创作者搜索过滤 → hidden class + 计数", () => {
    const { state, searchResults, refresh } = mount();
    searchResults.insertAdjacentHTML(
      "beforeend",
      `
      <div class="gh-card" data-name="高产甲" data-tag="creator"><span class="cr-card-desc">descA</span></div>
      <div class="gh-card" data-name="低产乙" data-tag="official"><span class="cr-card-desc">descB</span></div>
      <span id="ws-cr-count"></span>`,
    );
    bindEditEvents(state, refresh);
    const input = searchResults.querySelector("#ws-cr-search") as HTMLInputElement;
    input.value = "甲";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const cards = searchResults.querySelectorAll(".gh-card");
    expect(cards[0].classList.contains("cr-card-hidden")).toBe(false);
    expect(cards[1].classList.contains("cr-card-hidden")).toBe(true);
    expect(
      searchResults.querySelector("#ws-cr-count")?.textContent,
    ).toBe("(1/2)");
  });
});
