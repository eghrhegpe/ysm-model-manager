// ===== 站点编辑模式事件测试（edit.ts）=====
// edit.ts 是编辑态事件胶水：过滤（eeApplyFilters）、输入回写同步（eeSyncAllEditInputs）、
// 保存/删除/新增/拖拽。此处从公共入口 bindEditEvents 构造真实 DOM + 事件驱动，
// 覆盖核心纯逻辑点（关键词/标签过滤、输入同步、保存落盘、增删）——不制造 test-only 导出。
import { describe, it, expect, vi, beforeEach } from "vitest";

const backend = vi.hoisted(() => ({
  SaveWorkshopPresetsBySite: vi.fn(async (_siteId: string, _presets: unknown[]) => {}),
  SaveWorkshopCreatorsBySite: vi.fn(async (_siteId: string, _creators: unknown[]) => {}),
  modalConfirm: vi.fn(async () => true),
}));

vi.mock("@/views/backend-deps.ts", () => ({
  backendGetApp: async () => ({
    SaveWorkshopPresetsBySite: backend.SaveWorkshopPresetsBySite,
    SaveWorkshopCreatorsBySite: backend.SaveWorkshopCreatorsBySite,
  }),
}));

// P1-3a：edit.ts 的取消按钮 dirty 守卫消费 modalConfirm——mock 默认确认，逐用例覆盖拒绝路径
vi.mock("@/utils/dom/modal-confirm.ts", () => ({
  modalConfirm: backend.modalConfirm,
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
    { id: 2, name: "Bob", desc: "dom-text-mismatch", type: "siteA", role: "creator" } as unknown as LocalCreatorLike,
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
    editSnapshot: null,
    ...over,
  };
  document.body.appendChild(searchResults);
  return { state, searchResults, refresh, allCreators, creators, site };
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.SaveWorkshopPresetsBySite.mockReset();
  backend.SaveWorkshopCreatorsBySite.mockReset();
  backend.modalConfirm.mockReset();
  backend.modalConfirm.mockResolvedValue(true);
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

  it("2c. 数据层优先：DOM 文案与 creators 数据层不一致时按数据层命中（2026-09 锐评 P2 数据层化回归锁）", () => {
    const { state, searchResults } = makeState();
    mountFilterDom(searchResults);
    const cleanup = bindEditEvents(state, () => {});
    const input = searchResults.querySelector("#ws-cr-search") as HTMLInputElement;
    // fixture：Bob 的 DOM 文案是 "main"，数据层 desc 是 "dom-text-mismatch"
    input.value = "mismatch";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    expect(cards[0].classList.contains("cr-card-hidden")).toBe(true); // Alice 无 mismatch
    expect(cards[1].classList.contains("cr-card-hidden")).toBe(false); // Bob 按数据层 desc 命中（DOM "main" 不含 mismatch）
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
      '<button class="btn-base sm cr-save-btn"></button>' +
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
      '<button class="btn-base sm cr-save-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>' +
      '<div class="cr-edit-card" data-edit-idx="1"><input data-idx="1" data-fld="name" value="Bob"></div>';
    const cleanup = bindEditEvents(state, () => {});

    state.searchResults.querySelector(".cr-save-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.SaveWorkshopCreatorsBySite).toHaveBeenCalledTimes(1));
    const saved = backend.SaveWorkshopCreatorsBySite.mock.calls[0][1] as LocalCreatorLike[];
    // 他站作者排除：Bob 的 type=siteB 不含本站 siteA，不落盘
    expect(saved.map((c) => c.name)).toEqual(["Alice"]);
    cleanup!();
  });
});

describe("编辑态增删", () => {
  function mountToolbarDom(searchResults: HTMLElement): void {
    searchResults.innerHTML =
      '<button class="btn-base sm cr-edit-btn"></button>' +
      '<button class="btn-base sm cr-cancel-btn"></button>' +
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

  it("7. 删除创作者 → 数组移除 + DOM 卡片移除 + 索引重编号（P1-3b 局部渲染，不再整树 refresh）", () => {
    const { state, searchResults, refresh, allCreators } = makeState();
    // 两卡：data-edit-idx=0（Alice）/1（Bob），删除 0 号后 Bob 应重编号为 0
    searchResults.innerHTML =
      '<button class="btn-base sm cr-edit-btn"></button>' +
      '<button class="btn-base sm cr-cancel-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice">' +
      '<button class="cr-del" data-idx="0"></button></div>' +
      '<div class="cr-edit-card" data-edit-idx="1"><input data-idx="1" data-fld="name" value="Bob"></div>';
    const cleanup = bindEditEvents(state, refresh);
    expect(allCreators).toHaveLength(2); // makeState 默认 Alice+Bob 两个；DOM 是额外夹具，数组以 state 为准

    searchResults.querySelector('.cr-del[data-idx="0"]')!.dispatchEvent(new Event("click", { bubbles: true }));

    // 数组移除 Alice，Bob 前移
    expect(allCreators.map((c) => c.name)).toEqual(["Bob"]);
    // DOM：Alice 卡移除、Bob 卡重编号为 0，且其内部 input data-idx 同步
    const cards = searchResults.querySelectorAll<HTMLElement>(".cr-edit-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.dataset.editIdx).toBe("0");
    expect((cards[0]?.querySelector('input[data-fld="name"]') as HTMLInputElement).dataset.idx).toBe("0");
    // P1-3b：不整树重建（refresh 不被调）
    expect(refresh).not.toHaveBeenCalled();
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
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="跨站">' +
      '<button class="cr-del" data-idx="0"></button></div>';
    const cleanup = bindEditEvents(state, refresh);
    expect(state.allCreators).toHaveLength(1);
    expect(state.detachedCreators).toHaveLength(0);

    searchResults.querySelector(".cr-del")!.dispatchEvent(new Event("click", { bubbles: true }));

    // 条目仍在 allCreators（他站保留），type 已去本站段，进入 detached 待保存写回；
    // DOM 卡片移除（本站视图不再显示），不整树重建
    expect(state.allCreators).toHaveLength(1);
    expect(state.creators).toHaveLength(0);
    expect(state.creators[0]).toBeUndefined();
    expect(state.detachedCreators.map((c) => c.name)).toEqual(["跨站"]);
    expect(searchResults.querySelector(".cr-edit-card")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
    cleanup!();
  });

  it("8. 新增创作者 → 数组追加 + DOM 新卡插入 + 焦点落到新卡 name（P1-3b 局部渲染）", () => {
    const { state, searchResults, refresh, allCreators } = makeState();
    mountToolbarDom(searchResults);
    const cleanup = bindEditEvents(state, refresh);

    searchResults.querySelector(".cr-add")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(allCreators).toHaveLength(3);
    expect(state.creators).toHaveLength(3);
    // 锐评 P0-2a：新增行不写 i18n 默认文案（t 在此被 mock 成返回 key 本身——
    // 若回退旧实现，这里会拿到 "workshop.newCreatorName" 这种语言串并落盘）
    // fixture 已有 Alice(idx0)+Bob(idx1)，cr-add 追加的第三行为空名 → 断言 idx=2
    expect(state.creators[2].name).toBe("");
    expect(state.creators[2].desc).toBe("");
    // P1-3b：DOM 出现新卡（按 DOM 序重编号：Alice 卡 + 新卡 → 新卡 = idx1），不整树重建（焦点保持）
    const newCard = searchResults.querySelector(
      '.cr-edit-card[data-edit-idx="1"]',
    ) as HTMLElement | null;
    expect(newCard).toBeTruthy();
    expect(
      (newCard?.querySelector('input[data-fld="name"]') as HTMLInputElement).dataset.idx,
    ).toBe("1");
    expect(refresh).not.toHaveBeenCalled();
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
    // DOM 与 creators 一一对应（Alice idx0 + Bob idx1）——真实编辑态由
    // buildSiteCreatorEditCards 保证；cr-add 新增的第三行才落空名
    searchResults.innerHTML =
      '<button class="cr-add"></button>' +
      '<button class="btn-base sm cr-save-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>' +
      '<div class="cr-edit-card" data-edit-idx="1"><input data-idx="1" data-fld="name" value="Bob"></div>';
    const cleanup = bindEditEvents(state, () => {});

    searchResults.querySelector(".cr-add")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(state.creators).toHaveLength(3);

    searchResults.querySelector(".cr-save-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.SaveWorkshopCreatorsBySite).toHaveBeenCalledTimes(1));
    const saved = backend.SaveWorkshopCreatorsBySite.mock.calls[0][1] as LocalCreatorLike[];
    expect(saved.map((c) => c.name)).toEqual(["Alice", "Bob"]);
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
      '<button class="btn-base sm cr-save-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>';
    const cleanup = bindEditEvents(state, () => {});

    searchResults.querySelector(".cr-save-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.SaveWorkshopCreatorsBySite).toHaveBeenCalledTimes(1));
    const saved = backend.SaveWorkshopCreatorsBySite.mock.calls[0][1] as LocalCreatorLike[];
    // 本站 Alice+Bob + 解除关联的跨站条目（type=siteB）一并写回
    expect(saved.map((c) => c.name)).toEqual(["Alice", "Bob", "跨站"]);
    expect(saved[2]?.type).toBe("siteB");
    cleanup!();
  });

  it("11. 编辑态 dirty 守卫：修改后取消 → modalConfirm；确认退出 / 拒绝留在编辑态（P1-3a 锐评）", async () => {
    const { state, searchResults, refresh } = makeState();
    // 进入编辑态（cr-edit-btn → 取基线快照）+ 渲染编辑工具栏（含取消按钮）
    searchResults.innerHTML =
      '<button class="btn-base sm cr-edit-btn"></button>' +
      '<button class="btn-base sm cr-cancel-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>';
    const cleanup = bindEditEvents(state, refresh);

    searchResults.querySelector(".cr-edit-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(state.wsEditModeRef.v).toBe(true);
    expect(state.editSnapshot).not.toBeNull();

    // 修改 name → dirty 成立
    const nameInput = searchResults.querySelector('input[data-fld="name"]') as HTMLInputElement;
    nameInput.value = "Bob";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    // 取消 → modalConfirm 确认 → 退出编辑态
    backend.modalConfirm.mockResolvedValueOnce(true);
    searchResults.querySelector(".cr-cancel-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.modalConfirm).toHaveBeenCalledTimes(1));
    expect(state.wsEditModeRef.v).toBe(false);
    expect(state.editSnapshot).toBeNull();
    expect(refresh).toHaveBeenCalled();

    // 再次进入编辑态（新基线），修改后取消但拒绝确认 → 留在编辑态
    searchResults.querySelector(".cr-edit-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    const nameInput2 = searchResults.querySelector('input[data-fld="name"]') as HTMLInputElement;
    nameInput2.value = "Cara";
    nameInput2.dispatchEvent(new Event("input", { bubbles: true }));
    backend.modalConfirm.mockResolvedValueOnce(false);
    searchResults.querySelector(".cr-cancel-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await vi.waitFor(() => expect(backend.modalConfirm).toHaveBeenCalledTimes(2));
    expect(state.wsEditModeRef.v).toBe(true); // 拒绝 → 仍在编辑态
    cleanup!();
  });

  it("12. 编辑态无修改取消 → 不弹 modalConfirm（dirty 为假，快速退出）（P1-3a 锐评）", async () => {
    const { state, searchResults, refresh } = makeState();
    searchResults.innerHTML =
      '<button class="btn-base sm cr-edit-btn"></button>' +
      '<button class="btn-base sm cr-cancel-btn"></button>' +
      '<div class="cr-edit-card" data-edit-idx="0"><input data-idx="0" data-fld="name" value="Alice"></div>';
    const cleanup = bindEditEvents(state, refresh);

    searchResults.querySelector(".cr-edit-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(state.editSnapshot).not.toBeNull();

    // 未修改直接取消 → 不弹确认
    searchResults.querySelector(".cr-cancel-btn")!.dispatchEvent(new Event("click", { bubbles: true }));
    await Promise.resolve();
    expect(backend.modalConfirm).not.toHaveBeenCalled();
    expect(state.wsEditModeRef.v).toBe(false);
    cleanup!();
  });
});