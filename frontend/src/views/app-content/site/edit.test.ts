// ===== 站点编辑模式事件测试（edit.ts）=====
// edit.ts 是编辑态事件胶水：过滤（eeApplyFilters）、输入回写同步（eeSyncAllEditInputs）、
// 保存/删除/新增/拖拽。此处从公共入口 bindEditEvents 构造真实 DOM + 事件驱动，
// 覆盖核心纯逻辑点（关键词/标签过滤、输入同步、保存落盘、增删）——不制造 test-only 导出。
import { describe, it, expect, vi, beforeEach } from "vitest";

const backend = vi.hoisted(() => ({
  SaveWorkshopPresetsBySite: vi.fn(async (_siteId: string, _presets: unknown[]) => {}),
  SaveWorkshopCreatorsBySite: vi.fn(async (_siteId: string, _creators: unknown[]) => {}),
}));

vi.mock("@/views/backend-deps.ts", () => ({
  backendGetApp: async () => ({
    SaveWorkshopPresetsBySite: backend.SaveWorkshopPresetsBySite,
    SaveWorkshopCreatorsBySite: backend.SaveWorkshopCreatorsBySite,
  }),
}));

vi.mock("@/core/i18n/t.ts", () => ({ t: (k: string) => k }));

import { bindEditEvents } from "./edit.ts";
import type { CleanupFn, LocalCreatorLike, SiteViewState } from "./types.ts";
import type { WorkshopSite } from "@/utils/types-re-export.ts";

function makeState(over: Partial<SiteViewState> = {}): {
  state: SiteViewState;
  searchResults: HTMLElement;
  refresh: () => void;
  allCreators: LocalCreatorLike[];
  creators: LocalCreatorLike[];
  site: WorkshopSite;
} {
  const searchResults = document.createElement("div");
  const allCreators: LocalCreatorLike[] = [
    { id: 1, name: "Alice", desc: "helper", type: "siteA", role: "creator" } as unknown as LocalCreatorLike,
  ];
  const creators: LocalCreatorLike[] = [...allCreators];
  const site = { id: "siteA", label: "测试站", presetSearches: [{ label: "旧词", q: "" }] } as WorkshopSite;
  const refresh: () => void = vi.fn();
  const state: SiteViewState = {
    esc: (s: unknown) => String(s),
    searchResults,
    allSites: [],
    allCreators,
    repoAuthors: [],
    wsEditModeRef: { v: false },
    fillSearch: (tpl) => tpl,
    openUrl: vi.fn(),
    setBrowseMode: vi.fn(),
    avatarCache: {},
    site,
    creators,
    authorCountMap: {},
    bus: { emit: vi.fn() } as unknown as SiteViewState["bus"],
    ctx: null as unknown as SiteViewState["ctx"],
    activeTag: "",
    searchKw: "",
    detachedCreators: [],
    ...over,
  };
  document.body.appendChild(searchResults);
  return { state, searchResults, refresh, allCreators, creators, site };
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.SaveWorkshopPresetsBySite.mockReset();
  backend.SaveWorkshopCreatorsBySite.mockReset();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("eeApplyFilters 过滤逻辑", () => {
  function mountFilterDom(searchResults: HTMLElement): void {
    searchResults.innerHTML =
      '<input id="ws-cr-search">' +
      '<span id="ws-cr-count"></span>' +
      '<div class="cr-tag-filter-row">' +
      '<button class="cr-tag-filter-btn" data-tag=""></button>' +
      '<button class="cr-tag-filter-btn" data-tag="official"></button>' +
      "</div>" +
      '<div class="gh-card" data-name="Alice" data-tag="official"><div class="cr-card-desc">helper</div></div>' +
      '<div class="gh-card" data-name="Bob" data-tag=""><div class="cr-card-desc">main</div></div>';
  }

  it("1. 初始化无关键词 → 全部可见，计数 2/2", () => {
    const { state, searchResults } = makeState();
    mountFilterDom(searchResults);
    let cleanup: CleanupFn | undefined;
    cleanup = bindEditEvents(state, () => {});
    cleanup!();
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    expect(cards[0].classList.contains("cr-card-hidden")).toBe(false);
    expect(cards[1].classList.contains("cr-card-hidden")).toBe(false);
    expect(searchResults.querySelector("#ws-cr-count")?.textContent).toContain("2/2");
  });

  it("2. 关键词过滤：命中 name/desc 的可见，其余隐藏，计数随动", () => {
    const { state, searchResults } = makeState();
    mountFilterDom(searchResults);
    const cleanup = bindEditEvents(state, () => {});
    const input = searchResults.querySelector("#ws-cr-search") as HTMLInputElement;
    input.value = "lic"; // 命中 Alice 的 name
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    expect(cards[0].classList.contains("cr-card-hidden")).toBe(false); // Alice desc 命中
    expect(cards[1].classList.contains("cr-card-hidden")).toBe(true); // Bob 未命中
    expect(searchResults.querySelector("#ws-cr-count")?.textContent).toContain("1/2");
    cleanup!();
  });

  it("2b. 筛选零结果 → 空态容器出现 + 计数 (0/2)；清除按钮复位关键词与标签（P1-4 锐评）", () => {
    const { state, searchResults } = makeState();
    mountFilterDom(searchResults);
    const cleanup = bindEditEvents(state, () => {});
    const input = searchResults.querySelector("#ws-cr-search") as HTMLInputElement;

    // 关键词打不到任何卡 → 零结果空态
    input.value = "zzz-no-such";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const empty = searchResults.querySelector("#cr-filter-empty");
    expect(empty).toBeTruthy();
    expect(empty?.querySelector("[data-clear-filter]")).toBeTruthy();
    expect(searchResults.querySelector("#ws-cr-count")?.textContent).toContain("(0/2)");

    // 清除按钮 → 关键词复位 + 空态移除 + 计数回到全量
    (empty!.querySelector("[data-clear-filter]") as HTMLElement).click();
    expect(searchResults.querySelector("#cr-filter-empty")).toBeNull();
    expect(input.value).toBe("");
    expect(searchResults.querySelector("#ws-cr-count")?.textContent).toContain("(2/2)");
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    expect(cards[0].classList.contains("cr-card-hidden")).toBe(false);
    expect(cards[1].classList.contains("cr-card-hidden")).toBe(false);
    cleanup!();
  });

  it("3. 标签过滤：点 official → 仅 official 卡可见", () => {
    const { state, searchResults } = makeState();
    mountFilterDom(searchResults);
    const cleanup = bindEditEvents(state, () => {});
    const officialBtn = searchResults.querySelector('.cr-tag-filter-btn[data-tag="official"]') as HTMLButtonElement;
    officialBtn.click();
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    expect(cards[0].classList.contains("cr-card-hidden")).toBe(false); // Alice official
    expect(cards[1].classList.contains("cr-card-hidden")).toBe(true); // Bob 非 official
    expect(searchResults.querySelector("#ws-cr-count")?.textContent).toContain("1/2");
    cleanup!();
  });
});

describe("保存流程（eeSyncAllEditInputs 回写 + 落盘）", () => {
  function mountEditDom(searchResults: HTMLElement): void {
    searchResults.innerHTML =
      '<button class="cr-save-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0">' +
      '<input data-idx="0" data-fld="name" value="Alice">' +
      '<input data-idx="0" data-fld="desc" value="helper">' +
      "</div>" +
      '<div class="cr-edit-card" data-edit="preset" data-edit-idx="0">' +
      '<input data-idx="0" data-fld="label" value="旧词">' +
      "</div>";
  }

  it("4. 修改编辑卡输入并保存 → 回写 creators + 预设 label，并按本站 id 过滤后落盘", async () => {
    const { state, searchResults, refresh, creators, site } = makeState();
    mountEditDom(searchResults);
    const cleanup = bindEditEvents(state, refresh);

    const nameInput = searchResults.querySelector('.cr-edit-card[data-edit-idx="0"] input[data-fld="name"]') as HTMLInputElement;
    nameInput.value = "Zed";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    const presetLabel = searchResults.querySelector(".cr-edit-card[data-edit='preset'] input[data-fld='label']") as HTMLInputElement;
    presetLabel.value = "新词";
    searchResults.querySelector(".cr-save-btn")!.dispatchEvent(new Event("click", { bubbles: true }));

    await vi.waitFor(() => expect(backend.SaveWorkshopPresetsBySite).toHaveBeenCalledTimes(1));
    expect(backend.SaveWorkshopPresetsBySite).toHaveBeenCalledWith(site.id, [{ label: "新词" }]);
    expect(backend.SaveWorkshopCreatorsBySite).toHaveBeenCalledTimes(1);
    const saved = backend.SaveWorkshopCreatorsBySite.mock.calls[0][1] as LocalCreatorLike[];
    expect(saved[0].name).toBe("Zed");
    expect(creators[0].name).toBe("Zed");
    expect(site.presetSearches?.[0].label).toBe("新词");
    expect(refresh).toHaveBeenCalled();
    expect(state.wsEditModeRef.v).toBe(false);
    expect((state.bus.emit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
    cleanup!();
  });

  it("5. 保存仅落盘 type 含本站 id 的创作者（他站作者排除）", async () => {
    const { state } = makeState({
      creators: [
        { id: 1, name: "Alice", type: "siteA", role: "creator" } as unknown as LocalCreatorLike,
        { id: 2, name: "Bob", type: "siteB", role: "creator" } as unknown as LocalCreatorLike,
      ],
    });
    state.searchResults.innerHTML =
      '<button class="cr-save-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>' +
      '<div class="cr-edit-card" data-edit-idx="1"><input data-idx="1" data-fld="name" value="Bob"></div>';
    const cleanup = bindEditEvents(state, () => {});

    state.searchResults.querySelector(".cr-save-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.SaveWorkshopCreatorsBySite).toHaveBeenCalledTimes(1));
    const saved = backend.SaveWorkshopCreatorsBySite.mock.calls[0][1] as LocalCreatorLike[];
    expect(saved.map((c) => c.name)).toEqual(["Alice"]);
    cleanup!();
  });
});

describe("编辑态增删", () => {
  function mountToolbarDom(searchResults: HTMLElement): void {
    searchResults.innerHTML =
      '<button class="cr-edit-btn"></button>' +
      '<button class="cr-cancel-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>' +
      '<button class="cr-add"></button>' +
      '<button class="cr-del" data-idx="0"></button>';
  }

  it("6. 编辑/取消按钮切换编辑模式并联调 refresh", () => {
    const { state, searchResults, refresh } = makeState();
    mountToolbarDom(searchResults);
    const cleanup = bindEditEvents(state, refresh);

    searchResults.querySelector(".cr-edit-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(state.wsEditModeRef.v).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    searchResults.querySelector(".cr-cancel-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(state.wsEditModeRef.v).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(2);
    cleanup!();
  });

  it("7. 删除创作者 → 从 allCreators 移除并联调 refresh", () => {
    const { state, searchResults, refresh, allCreators } = makeState();
    mountToolbarDom(searchResults);
    const cleanup = bindEditEvents(state, refresh);
    expect(allCreators).toHaveLength(1);

    searchResults.querySelector(".cr-del")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(allCreators).toHaveLength(0);
    expect(refresh).toHaveBeenCalled();
    cleanup!();
  });

  it("7b. 跨站点创作者删除 → 仅解除本站关联，不删 allCreators 条目，type 去本站段并入 detached（P1-2 锐评）", () => {
    // type:"siteA;siteB" 的多站点创作者：在 A 站删除必须是「从 A 解除」——
    // 若整删，Go 按站整存会把 B 站的条目也抹掉（跨站越权）。
    // 注意 makeState 的 over 只覆盖 state.* 字段，返回的独立变量是默认值——
    // 断言必须读 state.creators / state.allCreators。
    const multiSite = {
      id: 9,
      name: "跨站",
      desc: "",
      type: "siteA;siteB",
      role: "creator",
    } as unknown as LocalCreatorLike;
    const { state, searchResults, refresh } = makeState({
      creators: [multiSite],
      allCreators: [multiSite],
    });
    searchResults.innerHTML =
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="跨站"></div>' +
      '<button class="cr-del" data-idx="0"></button>';
    const cleanup = bindEditEvents(state, refresh);
    expect(state.allCreators).toHaveLength(1);
    expect(state.detachedCreators).toHaveLength(0);

    searchResults.querySelector(".cr-del")!.dispatchEvent(new Event("click", { bubbles: true }));

    // 条目仍在 allCreators（他站保留），type 已去本站段，进入 detached 待保存写回
    expect(state.allCreators).toHaveLength(1);
    expect(state.creators[0]!.type).toBe("siteB");
    expect(state.detachedCreators.map((c) => c.name)).toEqual(["跨站"]);
    expect(refresh).toHaveBeenCalled();
    cleanup!();
  });

  it("8. 新增创作者 → 追加到 creators 与 allCreators 并联调 refresh", () => {
    const { state, searchResults, refresh, allCreators } = makeState();
    mountToolbarDom(searchResults);
    const cleanup = bindEditEvents(state, refresh);

    searchResults.querySelector(".cr-add")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(allCreators).toHaveLength(2);
    expect(state.creators).toHaveLength(2);
    // 锐评 P0-2a：新增行不写 i18n 默认文案（t 在此被 mock 成返回 key 本身——
    // 若回退旧实现，这里会拿到 "workshop.newCreatorName" 这种语言串并落盘）
    expect(state.creators[1].name).toBe("");
    expect(state.creators[1].desc).toBe("");
    expect(refresh).toHaveBeenCalled();
    cleanup!();
  });

  it("8b. platform badge 点击切换 → type 段增减 + chip active 态（P1-5 锐评：多选控件改 badge 组）", () => {
    const site = { id: "siteA" } as WorkshopSite;
    const { state, searchResults } = makeState({
      site,
      creators: [
        { id: 1, name: "Alice", desc: "", type: "siteA", role: "creator" } as unknown as LocalCreatorLike,
      ],
      allCreators: [
        { id: 1, name: "Alice", desc: "", type: "siteA", role: "creator" } as unknown as LocalCreatorLike,
      ],
    });
    // badge 组：siteA 已选中（active），siteB 未选中
    searchResults.innerHTML =
      '<div class="cr-edit-card" data-edit-idx="0">' +
      '<div class="cr-site-chip-group" data-idx="0" data-fld="type">' +
      '<button class="cr-site-chip active" data-site-id="siteA">站点A</button>' +
      '<button class="cr-site-chip" data-site-id="siteB">站点B</button>' +
      "</div></div>";
    const cleanup = bindEditEvents(state, () => {});

    // 点击 siteB → 加入归属，type 变 "siteA;siteB"
    const chipB = searchResults.querySelector('[data-site-id="siteB"]') as HTMLElement;
    chipB.click();
    expect(chipB.classList.contains("active")).toBe(true);
    expect(state.creators[0]!.type).toBe("siteA;siteB");

    // 点击 siteA → 解除归属，type 变 "siteB"（保留他站）
    (searchResults.querySelector('[data-site-id="siteA"]') as HTMLElement).click();
    expect(state.creators[0]!.type).toBe("siteB");
    cleanup!();
  });

  it("9. 保存挡掉空名条目（新增未命名行不落盘，锐评 P0-2a）", async () => {
    const { state, searchResults } = makeState();
    searchResults.innerHTML =
      '<button class="cr-add"></button>' +
      '<button class="cr-save-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>';
    const cleanup = bindEditEvents(state, () => {});

    searchResults.querySelector(".cr-add")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(state.creators).toHaveLength(2);

    searchResults.querySelector(".cr-save-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.SaveWorkshopCreatorsBySite).toHaveBeenCalledTimes(1));
    const saved = backend.SaveWorkshopCreatorsBySite.mock.calls[0][1] as LocalCreatorLike[];
    expect(saved.map((c) => c.name)).toEqual(["Alice"]);
    cleanup!();
  });

  it("10. 保存併入 detached 写回：跨站解除关联条目随 siteCreators 落盘，type 已无本站段（P1-2 锐评）", async () => {
    // 场景：多站点创作者在 A 站删除 → detached 待写回 → 保存时必须併入，
    // 否则 Go 按站整存（移除 type 含本站旧条目→追加新列表）会把 B 站的条目也抹掉。
    const detached = {
      id: 9,
      name: "跨站",
      desc: "",
      type: "siteB", // 已去本站段（siteA 删除时解除）
      role: "creator",
    } as unknown as LocalCreatorLike;
    const { state, searchResults } = makeState({ detachedCreators: [detached] });
    searchResults.innerHTML =
      '<button class="cr-save-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>';
    const cleanup = bindEditEvents(state, () => {});

    searchResults.querySelector(".cr-save-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.SaveWorkshopCreatorsBySite).toHaveBeenCalledTimes(1));
    const saved = backend.SaveWorkshopCreatorsBySite.mock.calls[0][1] as LocalCreatorLike[];
    // 本站 Alice + 解除关联的跨站条目（type=siteB）一并写回
    expect(saved.map((c) => c.name)).toEqual(["Alice", "跨站"]);
    expect(saved[1]?.type).toBe("siteB");
    cleanup!();
  });
});