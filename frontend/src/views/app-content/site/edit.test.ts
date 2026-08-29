// ===== 站点视图编辑模式事件组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// 真实绑定 bindEditEvents：拖拽排序（创作者/搜索词）、编辑入口/取消、
// 删除/新增搜索词、创作者搜索过滤。moveItem 纯函数已单独测，此处验证编排集成。
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { bus } from "../../../bus.ts";

// mock bindings + 社区数据源（fetch 更新配置路径不测，阻断网络与 getApp）
vi.mock("../../../backend/app.ts", () => ({
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
import { fireDrag } from "../../../test-utils/events.ts";
import { getApp } from "../../../backend/app.ts";
import * as communityData from "../community-data.ts";

/** mock 后的 getApp（vi.mock 工厂产物），便于逐测试覆盖返回的绑定集 */
const getAppMock = getApp as unknown as Mock & (() => Promise<Record<string, unknown>>);
/** mock 后的 community-data 各 vi.fn */
const fetchCreatorsMock = communityData.fetchCommunityCreators as unknown as ReturnType<typeof vi.fn>;
const fetchSitesMock = communityData.fetchCommunitySites as unknown as ReturnType<typeof vi.fn>;
const mergeCreatorsMock = communityData.mergeCommunityCreators as unknown as ReturnType<typeof vi.fn>;
const mergeSitesMock = communityData.mergeCommunitySites as unknown as ReturnType<typeof vi.fn>;

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

/** 注入 dataTransfer 的拖拽事件（happy-dom DragEvent init 忽略 dataTransfer，fireDrag 已处理 defineProperty 注入） */
function dragEvent(el: HTMLElement, type: string): DragEvent {
  return fireDrag(el, type, {
    effectAllowed: "",
    dropEffect: "",
    setData: () => {},
  });
}

/** spy bus.emit（静音真实分发），返回 spy，调用方负责 mockRestore */
function spyBusEmit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(bus, "emit").mockImplementation(() => {});
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

  it("9. cleanup 解绑全部编辑模式监听（切站点防泄漏）", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    state.wsEditModeRef.v = false;
    const cleanup = bindEditEvents(state, refresh);
    cleanup();

    // 工具栏：编辑入口 / 取消 不再生效
    (searchResults.querySelector(".cr-edit-btn") as HTMLElement).click();
    (searchResults.querySelector(".cr-cancel-btn") as HTMLElement).click();
    expect(state.wsEditModeRef.v).toBe(false);
    expect(refresh).not.toHaveBeenCalled();

    // 创作者拖拽排序不再生效
    const cards = searchResults.querySelectorAll(
      ".cr-edit-card:not([data-edit='preset'])",
    );
    dragEvent(cards[0] as HTMLElement, "dragstart");
    dragEvent(cards[1] as HTMLElement, "drop");
    expect(allCreators.map((c) => c.name)).toEqual(["甲", "乙"]);

    // 搜索过滤不再生效
    searchResults.insertAdjacentHTML(
      "beforeend",
      '<div class="gh-card" data-name="甲" data-tag="creator"><span class="cr-card-desc">d</span></div>',
    );
    const input = searchResults.querySelector("#ws-cr-search") as HTMLInputElement;
    input.value = "不存在的关键词";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      searchResults.querySelector(".gh-card")!.classList.contains("cr-card-hidden"),
    ).toBe(false);

    // 幂等：重复调用不抛
    expect(() => cleanup()).not.toThrow();
  });
});

describe("bindEditEvents 保存流程", () => {
  it("保存：site.id 丢失 → 错误 toast，不触达 Go 桥", () => {
    const { state, searchResults } = mount();
    state.site = {} as WorkshopSite;
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-save-btn">💾</button>');
    const emitSpy = spyBusEmit();
    try {
      bindEditEvents(state, vi.fn());
      (searchResults.querySelector(".cr-save-btn") as HTMLElement).click();
      expect(emitSpy).toHaveBeenCalledWith(
        "toast:show",
        expect.objectContaining({ msg: expect.stringContaining("站点信息丢失"), type: "error" }),
      );
      expect(getAppMock).not.toHaveBeenCalled();
    } finally {
      emitSpy.mockRestore();
    }
  });

  it("保存成功：输入同步 + 预设收集 + 双 Save 调用 + 成功 toast + 退出编辑", async () => {
    const savePresets = vi.fn().mockResolvedValue(undefined);
    const saveCreators = vi.fn().mockResolvedValue(undefined);
    getAppMock.mockResolvedValue({ SaveWorkshopPresetsBySite: savePresets, SaveWorkshopCreatorsBySite: saveCreators });
    const { state, searchResults, refresh, allCreators, site } = mount();
    // 创作者卡：文本输入 + 多选下拉；预设卡：标签输入
    searchResults
      .querySelector('.cr-edit-card[data-edit="creator"][data-edit-idx="0"]')!
      .insertAdjacentHTML(
        "beforeend",
        '<input data-idx="0" data-fld="name" value="  改名  ">' +
          '<select data-idx="1" data-fld="type" multiple>' +
          '<option value="" selected></option><option value="x" selected></option><option value="y" selected></option></select>',
      );
    searchResults
      .querySelector('.cr-edit-card[data-edit="preset"][data-edit-idx="0"]')!
      .insertAdjacentHTML("beforeend", '<input data-fld="label" value="新标签">');
    allCreators[0]!.type = "siteA";
    allCreators[1]!.type = "other";
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-save-btn">💾</button>');
    const emitSpy = spyBusEmit();
    try {
      bindEditEvents(state, refresh);
      (searchResults.querySelector(".cr-save-btn") as HTMLElement).click();
      await vi.waitFor(() => expect(saveCreators).toHaveBeenCalled());
      // 预设：非空 label 收集并整站替换
      expect(savePresets).toHaveBeenCalledWith("siteA", [{ label: "新标签" }]);
      expect(site.presetSearches).toEqual([{ label: "新标签" }]);
      // 输入同步：trim + SELECT 多选拼接
      expect(allCreators[0]!.name).toBe("改名");
      expect(allCreators[1]!.type).toBe("x;y");
      // 创作者按 site.id 过滤后整站保存
      expect(saveCreators).toHaveBeenCalledWith("siteA", [allCreators[0]]);
      expect(state.wsEditModeRef.v).toBe(false);
      expect(emitSpy).toHaveBeenCalledWith(
        "toast:show",
        expect.objectContaining({ msg: expect.stringContaining("已保存"), type: "success" }),
      );
      expect(refresh).toHaveBeenCalled();
    } finally {
      emitSpy.mockRestore();
    }
  });

  it("保存失败：SaveWorkshopPresetsBySite 拒绝 → ❌ toast + 保持编辑模式", async () => {
    getAppMock.mockResolvedValue({
      SaveWorkshopPresetsBySite: vi.fn().mockRejectedValue(new Error("disk full")),
    });
    const { state, searchResults, refresh } = mount();
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-save-btn">💾</button>');
    const emitSpy = spyBusEmit();
    try {
      bindEditEvents(state, refresh);
      (searchResults.querySelector(".cr-save-btn") as HTMLElement).click();
      await vi.waitFor(() => expect(emitSpy).toHaveBeenCalled());
      const toastCall = (emitSpy.mock.calls as unknown[][]).find((c) => c[0] === "toast:show")!;
      expect((toastCall[1] as { msg: string }).msg.startsWith("❌")).toBe(true);
      expect((toastCall[1] as { type: string }).type).toBe("error");
      expect(state.wsEditModeRef.v).toBe(true);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      emitSpy.mockRestore();
    }
  });
});

describe("bindEditEvents 拉取配置", () => {
  function mockFetchApp(overrides: Record<string, unknown> = {}) {
    getAppMock.mockResolvedValue({
      SaveWorkshopCreators: vi.fn().mockResolvedValue(undefined),
      SaveWorkshopSites: vi.fn().mockResolvedValue(undefined),
      LoadGitHubRepos: vi.fn().mockResolvedValue([]),
      LoadResourceTypes: vi.fn().mockResolvedValue("{}"),
      ...overrides,
    });
  }

  it("全量更新 → merge + 双 Save + 汇总 toast + refresh + 按钮复位", async () => {
    mockFetchApp({
      LoadGitHubRepos: vi.fn().mockResolvedValue(["r1", "r2"]),
      LoadResourceTypes: vi.fn().mockResolvedValue(JSON.stringify({ resourceTypes: [{ id: "ysm" }, { id: "mmd" }] })),
    });
    fetchCreatorsMock.mockResolvedValue([{ name: "甲" }]);
    fetchSitesMock.mockResolvedValue([{ id: "s1" }]);
    mergeCreatorsMock.mockReturnValue({ added: 1, updated: 2 });
    mergeSitesMock.mockReturnValue({ added: 1 });
    const { state, searchResults, refresh, allCreators } = mount();
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-fetch-btn">🌐 更新配置</button>');
    const emitSpy = spyBusEmit();
    try {
      bindEditEvents(state, refresh);
      (searchResults.querySelector(".cr-fetch-btn") as HTMLElement).click();
      await vi.waitFor(() =>
        expect(emitSpy).toHaveBeenCalledWith(
          "toast:show",
          expect.objectContaining({ msg: expect.stringContaining("创作者: +1 补2") }),
        ),
      );
      const msg = ((emitSpy.mock.calls as unknown[][]).find((c) => c[0] === "toast:show")![1] as { msg: string }).msg;
      expect(msg).toContain("站点: +1");
      expect(msg).toContain("GitHub: 2 仓库");
      expect(msg).toContain("类型: 2 种");
      const app = (await getAppMock()) as { SaveWorkshopCreators: Mock; SaveWorkshopSites: Mock };
      expect(app.SaveWorkshopCreators).toHaveBeenCalledWith(allCreators);
      expect(app.SaveWorkshopSites).toHaveBeenCalledWith(state.allSites);
      expect(refresh).toHaveBeenCalled();
      const btn = searchResults.querySelector(".cr-fetch-btn") as HTMLButtonElement;
      expect(btn.textContent).toBe("🌐 更新配置");
      expect(btn.disabled).toBe(false);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it("无变化（LoadGitHubRepos 拒绝被吞）→ 「已是最新配置」+ 不 refresh + 不 Save", async () => {
    const saveC = vi.fn();
    const saveS = vi.fn();
    mockFetchApp({
      LoadGitHubRepos: vi.fn().mockRejectedValue(new Error("offline")),
    });
    fetchCreatorsMock.mockResolvedValue([]);
    fetchSitesMock.mockResolvedValue([]);
    const { state, searchResults, refresh } = mount();
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-fetch-btn">🌐 更新配置</button>');
    const emitSpy = spyBusEmit();
    try {
      bindEditEvents(state, refresh);
      (searchResults.querySelector(".cr-fetch-btn") as HTMLElement).click();
      await vi.waitFor(() =>
        expect(emitSpy).toHaveBeenCalledWith(
          "toast:show",
          expect.objectContaining({ msg: expect.stringContaining("已是最新配置") }),
        ),
      );
      expect(refresh).not.toHaveBeenCalled();
      expect(saveC).not.toHaveBeenCalled();
      expect(saveS).not.toHaveBeenCalled();
    } finally {
      emitSpy.mockRestore();
    }
  });

  it("resourceTypes 非法 JSON → console.warn 兜底，仍走「已是最新配置」", async () => {
    mockFetchApp({ LoadResourceTypes: vi.fn().mockResolvedValue("not json{") });
    fetchCreatorsMock.mockResolvedValue([]);
    fetchSitesMock.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { state, searchResults, refresh } = mount();
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-fetch-btn">🌐 更新配置</button>');
    const emitSpy = spyBusEmit();
    try {
      bindEditEvents(state, refresh);
      (searchResults.querySelector(".cr-fetch-btn") as HTMLElement).click();
      await vi.waitFor(() =>
        expect(emitSpy).toHaveBeenCalledWith(
          "toast:show",
          expect.objectContaining({ msg: expect.stringContaining("已是最新配置") }),
        ),
      );
      expect(warnSpy).toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      emitSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it.each([
    ["NetworkOffline", "无网络连接"],
    ["NoIndex", "社区索引文件不存在"],
    ["RateLimited", "频率限制"],
    ["weird failure", "拉取失败"],
  ])("拉取失败文案映射：%s → toast 含「%s」", async (errMsg, expected) => {
    mockFetchApp();
    fetchCreatorsMock.mockRejectedValue(new Error(errMsg));
    fetchSitesMock.mockResolvedValue([]);
    const { state, searchResults } = mount();
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-fetch-btn">🌐 更新配置</button>');
    const emitSpy = spyBusEmit();
    try {
      bindEditEvents(state, vi.fn());
      (searchResults.querySelector(".cr-fetch-btn") as HTMLElement).click();
      await vi.waitFor(() =>
        expect(emitSpy).toHaveBeenCalledWith(
          "toast:show",
          expect.objectContaining({ msg: expect.stringContaining(expected), type: "error" }),
        ),
      );
      // finally 按钮复位
      const btn = searchResults.querySelector(".cr-fetch-btn") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("🌐 更新配置");
    } finally {
      emitSpy.mockRestore();
    }
  });
});

describe("bindEditEvents 创作者编辑扩展", () => {
  it("行内 input（文本）→ trim 同步 creators[idx][fld]，不触发 refresh", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    searchResults
      .querySelector('.cr-edit-card[data-edit-idx="0"]')!
      .insertAdjacentHTML("beforeend", '<input data-idx="0" data-fld="name" value="">');
    bindEditEvents(state, refresh);
    const inp = searchResults.querySelector('input[data-idx="0"]') as HTMLInputElement;
    inp.value = "  新名  ";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    expect(allCreators[0]!.name).toBe("新名");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("行内 input（SELECT multiple）→ 非空值 ; 拼接", () => {
    const { state, searchResults, allCreators } = mount();
    searchResults
      .querySelector('.cr-edit-card[data-edit-idx="0"]')!
      .insertAdjacentHTML(
        "beforeend",
        '<select data-idx="0" data-fld="type" multiple>' +
          '<option value="" selected></option><option value="a" selected></option><option value="b" selected></option></select>',
      );
    bindEditEvents(state, vi.fn());
    const sel = searchResults.querySelector('select[data-idx="0"]') as HTMLSelectElement;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    expect(allCreators[0]!.type).toBe("a;b");
  });

  it("删除创作者：cr-del → allCreators splice + refresh；越界 idx 不刷新", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    searchResults.insertAdjacentHTML(
      "beforeend",
      '<button class="cr-del" data-idx="0">🗑️</button><button class="cr-del" data-idx="9">🗑️</button>',
    );
    bindEditEvents(state, refresh);
    const dels = searchResults.querySelectorAll(".cr-del");
    (dels[0] as HTMLElement).click();
    expect(allCreators.map((c) => c.name)).toEqual(["乙"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    (dels[1] as HTMLElement).click();
    expect(allCreators.map((c) => c.name)).toEqual(["乙"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("新增创作者：cr-add → push 到 creators 与 allCreators + refresh", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    // 真实语义：creators 是 allCreators 按站点过滤的子集（同元素不同数组），
    // 避免 mount 里同引用数组导致的双 push 伪影
    state.creators = allCreators.slice();
    searchResults.insertAdjacentHTML("beforeend", '<button class="cr-add">➕</button>');
    bindEditEvents(state, refresh);
    (searchResults.querySelector(".cr-add") as HTMLElement).click();
    expect(allCreators).toHaveLength(3);
    expect(allCreators[2]).toMatchObject({ name: "新作者", desc: "描述", type: "siteA", tag: "" });
    expect(refresh).toHaveBeenCalled();
  });

  it("搜索词排序：order-up 交换、order-down 换回、越界 no-op", () => {
    const { state, searchResults, refresh, presetSearches } = mount();
    searchResults.insertAdjacentHTML(
      "beforeend",
      '<button class="cr-order-up" data-idx="1">↑</button>' +
        '<button class="cr-order-down" data-idx="0">↓</button>' +
        '<button class="cr-order-up" data-idx="0">↑0</button>',
    );
    bindEditEvents(state, refresh);
    const ups = searchResults.querySelectorAll(".cr-order-up");
    const down = searchResults.querySelector(".cr-order-down") as HTMLElement;
    (ups[0] as HTMLElement).click(); // idx 1 上移
    expect(presetSearches.map((p) => p.label)).toEqual(["搜B", "搜A"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    down.click(); // idx 0 下移 → 换回
    expect(presetSearches.map((p) => p.label)).toEqual(["搜A", "搜B"]);
    expect(refresh).toHaveBeenCalledTimes(2);
    (ups[1] as HTMLElement).click(); // idx 0 上移 → no-op
    expect(presetSearches.map((p) => p.label)).toEqual(["搜A", "搜B"]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("bindEditEvents 过滤与拖拽扩展", () => {
  it("tag 过滤按钮 → activeTag 切换 + 过滤 + localStorage 持久化 + active 样式", () => {
    localStorage.clear();
    const { state, searchResults } = mount();
    searchResults.insertAdjacentHTML(
      "beforeend",
      `
      <div class="gh-card" data-name="高产甲" data-tag="creator"><span class="cr-card-desc">descA</span></div>
      <div class="gh-card" data-name="低产乙" data-tag="official"><span class="cr-card-desc">descB</span></div>
      <span id="ws-cr-count"></span>
      <button class="cr-tag-filter-btn" data-tag="creator">创作者</button>
      <button class="cr-tag-filter-btn" data-tag="">全部</button>`,
    );
    bindEditEvents(state, vi.fn());
    const cards = searchResults.querySelectorAll(".gh-card");
    const creatorBtn = searchResults.querySelector(
      '.cr-tag-filter-btn[data-tag="creator"]',
    ) as HTMLElement;
    creatorBtn.click();
    expect(cards[0]!.classList.contains("cr-card-hidden")).toBe(false);
    expect(cards[1]!.classList.contains("cr-card-hidden")).toBe(true);
    expect(searchResults.querySelector("#ws-cr-count")?.textContent).toBe("(1/2)");
    expect(localStorage.getItem("ysm-ws-active-tag")).toBe("creator");
    expect(creatorBtn.classList.contains("active")).toBe(true);
    // 切回全部
    (searchResults.querySelector('.cr-tag-filter-btn[data-tag=""]') as HTMLElement).click();
    expect(cards[0]!.classList.contains("cr-card-hidden")).toBe(false);
    expect(cards[1]!.classList.contains("cr-card-hidden")).toBe(false);
    expect(localStorage.getItem("ysm-ws-active-tag")).toBe("");
  });

  it("搜索输入 → safeSet 持久化 ysm-ws-search-kw", () => {
    localStorage.clear();
    const { state, searchResults } = mount();
    bindEditEvents(state, vi.fn());
    const input = searchResults.querySelector("#ws-cr-search") as HTMLInputElement;
    input.value = "xyz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(localStorage.getItem("ysm-ws-search-kw")).toBe("xyz");
  });

  it("拖拽视觉反馈：dragging/dragover/dragenter 方向 class/dragleave/dragend 清理", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    bindEditEvents(state, refresh);
    const cards = searchResults.querySelectorAll(
      ".cr-edit-card:not([data-edit='preset'])",
    );
    const evStart = dragEvent(cards[0] as HTMLElement, "dragstart");
    expect((cards[0] as HTMLElement).classList.contains("cr-dragging")).toBe(true);
    expect((cards[0] as HTMLElement).draggable).toBe(false); // dragstart 立即收掉 draggable
    expect(evStart.dataTransfer!.effectAllowed).toBe("move");
    const evOver = dragEvent(cards[1] as HTMLElement, "dragover");
    expect(evOver.dataTransfer!.dropEffect).toBe("move");
    dragEvent(cards[1] as HTMLElement, "dragenter"); // src 0 < tgt 1
    expect((cards[1] as HTMLElement).classList.contains("cr-drag-target")).toBe(true);
    expect((cards[1] as HTMLElement).classList.contains("cr-drag-before")).toBe(true);
    dragEvent(cards[1] as HTMLElement, "dragleave");
    expect((cards[1] as HTMLElement).classList.contains("cr-drag-target")).toBe(false);
    expect((cards[1] as HTMLElement).classList.contains("cr-drag-before")).toBe(false);
    // 反向：src 1 > tgt 0 → after
    dragEvent(cards[1] as HTMLElement, "dragstart");
    dragEvent(cards[0] as HTMLElement, "dragenter");
    expect((cards[0] as HTMLElement).classList.contains("cr-drag-after")).toBe(true);
    // dragend → 状态与样式全清
    dragEvent(cards[1] as HTMLElement, "dragend");
    expect((cards[1] as HTMLElement).classList.contains("cr-dragging")).toBe(false);
    expect((cards[0] as HTMLElement).classList.contains("cr-drag-after")).toBe(false);
    expect(allCreators.map((c) => c.name)).toEqual(["甲", "乙"]); // 纯视觉，未 drop 不重排
    expect(refresh).not.toHaveBeenCalled();
  });

  it("预设拖拽方向 class：src<tgt → before，src>tgt → after", () => {
    const { state, searchResults } = mount();
    bindEditEvents(state, vi.fn());
    const presets = searchResults.querySelectorAll(".cr-edit-card[data-edit='preset']");
    dragEvent(presets[0] as HTMLElement, "dragstart");
    dragEvent(presets[1] as HTMLElement, "dragenter");
    expect((presets[1] as HTMLElement).classList.contains("cr-drag-before")).toBe(true);
    dragEvent(presets[0] as HTMLElement, "dragend");
    dragEvent(presets[1] as HTMLElement, "dragstart");
    dragEvent(presets[0] as HTMLElement, "dragenter");
    expect((presets[0] as HTMLElement).classList.contains("cr-drag-after")).toBe(true);
  });

  it("drop：creators 元素不在 allCreators（realIdx<0）→ 早退不刷新", () => {
    const { state, searchResults, refresh, allCreators } = mount();
    state.creators = [{ name: "独" } as LocalCreatorLike];
    bindEditEvents(state, refresh);
    const cards = searchResults.querySelectorAll(
      ".cr-edit-card:not([data-edit='preset'])",
    );
    dragEvent(cards[0] as HTMLElement, "dragstart");
    dragEvent(cards[1] as HTMLElement, "drop");
    expect(refresh).not.toHaveBeenCalled();
    expect(allCreators.map((c) => c.name)).toEqual(["甲", "乙"]);
  });

  it("preset drop：site.presetSearches 缺失 → 早退不抛错", () => {
    const { state, searchResults, refresh } = mount();
    state.site = { id: "siteA" } as WorkshopSite;
    bindEditEvents(state, refresh);
    const presets = searchResults.querySelectorAll(".cr-edit-card[data-edit='preset']");
    dragEvent(presets[0] as HTMLElement, "dragstart");
    expect(() => dragEvent(presets[1] as HTMLElement, "drop")).not.toThrow();
    expect(refresh).not.toHaveBeenCalled();
  });
});
