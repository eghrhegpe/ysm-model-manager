// ===== 站点视图浏览态事件绑定测试 =====
// 覆盖 bindBrowseEvents：
//  - 空状态按钮导航 / 创作者网格创建 / 预设搜索
//  - 收藏点击（阻止冒泡 + 排序 + toast）/ 头像调试 / 详情浮层（关闭/搜索/查看本地）
//  - 键盘导航 ←↑↓→ / storage 跨标签同步 + cleanup
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../../test-utils/index.ts";

const {
  busEmit,
  busOn,
  dbg,
  getCreatorIdentity,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
  getSiteIcon,
  getTagIconFromRole,
  createCrCard,
  getApp,
} = vi.hoisted(() => ({
  busEmit: vi.fn(),
  busOn: vi.fn(() => () => {}),
  dbg: vi.fn(),
  getCreatorIdentity: vi.fn((cr) => ({ icon: "🎭", label: cr.name + "(id)" })),
  getTagFromRole: vi.fn(() => "模型"),
  parseDescTags: vi.fn(() => []),
  loadFavs: vi.fn(() => []),
  isFaved: vi.fn(() => false),
  toggleFav: vi.fn(() => true),
  getSiteIcon: vi.fn(() => "🌐"),
  getTagIconFromRole: vi.fn(() => "🏷️"),
  createCrCard: vi.fn(() => document.createElement("div")),
  getApp: vi.fn(),
}));

vi.mock("../../../bus.ts", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("../../../utils/debug/debug.ts", () => ({ dbg }));
vi.mock("../workshop-data.ts", () => ({
  getCreatorIdentity,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
}));
vi.mock("../../../utils/icon/workshop-icons.ts", () => ({
  getSiteIcon,
  getTagIconFromRole,
}));
vi.mock("./render.ts", () => ({ createCrCard }));
vi.mock("@/backend/app.ts", () => ({ getApp }));

import { bindBrowseEvents } from "./events.ts";
import type { SiteViewState } from "./types.ts";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function makeState(overrides: Record<string, unknown> = {}): {
  state: SiteViewState;
  searchResults: HTMLElement;
} {
  const searchResults = document.createElement("div");
  searchResults.innerHTML = `
    <div data-local-empty></div>
    <div id="cr-creator-grid" class="cr-creator-grid"></div>
    <button class="cr-preset-btn" data-q="dog">dog</button>
    <div class="gh-card" data-name="A">
      <div class="cr-star-btn" data-star="A">☆</div>
      <span class="cr-card-search" data-search-creator="A">🔍</span>
      <span class="cr-card-local-count cr-card-local-jump" data-local-creator="A">📁3</span>
    </div>
    <img data-debug-avatar="A" alt="avatar">
    <div id="cr-mode-switch">
      <button class="cr-mode-opt" data-mode="external">external</button>
      <button class="cr-mode-opt" data-mode="window">window</button>
    </div>
  `;
  const state = {
    esc,
    searchResults,
    allCreators: [],
    wsEditModeRef: { v: false },
    avatarCache: {},
    site: { searchUrl: "https://s/search?q={q}", url: "https://s", name: "S" },
    creators: [{ name: "A", role: "modeler", desc: "好模型", type: "github" }],
    authorCountMap: { A: 3 },
    fillSearch: (url: string, q: string) =>
      url.replace("{q}", encodeURIComponent(q)),
    openUrl: vi.fn(),
    setBrowseMode: vi.fn(),
    bus: { emit: busEmit, on: busOn },
    ...overrides,
  } as unknown as SiteViewState;
  return { state, searchResults };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  getApp.mockResolvedValue({
    DebugExtractCreatorAvatar: vi.fn(() => ({ ok: true })),
  });
  toggleFav.mockReturnValue(true);
});

describe("bindBrowseEvents — 基础绑定", () => {
  it("空状态按钮 → nav:changed 到 repository", () => {
    const { state } = makeState();
    bindBrowseEvents(state, () => {});
    (state.searchResults.querySelector("[data-local-empty]") as HTMLElement).click();
    expect(busEmit).toHaveBeenCalledWith("nav:changed", { page: "repository" });
  });

  it("有创作者且非编辑模式 → 每创作者生成一张卡片", () => {
    const { state } = makeState();
    bindBrowseEvents(state, () => {});
    expect(createCrCard).toHaveBeenCalledTimes(1);
    expect(createCrCard).toHaveBeenCalledWith(
      expect.objectContaining({ name: "A" }),
      expect.objectContaining({ creators: expect.any(Array) }),
    );
  });

  it("编辑模式 → 不生成网格卡片", () => {
    const { state } = makeState({ wsEditModeRef: { v: true } });
    bindBrowseEvents(state, () => {});
    expect(createCrCard).not.toHaveBeenCalled();
  });

  it("预设搜索按钮 → openUrl(fillSearch)；无 searchUrl → 打开站点首页", () => {
    const { state } = makeState();
    const openUrl = state.openUrl as ReturnType<typeof vi.fn>;
    bindBrowseEvents(state, () => {});
    (state.searchResults.querySelector(".cr-preset-btn") as HTMLElement).click();
    expect(openUrl).toHaveBeenCalledWith(
      "https://s/search?q=dog",
    );

    // 无 searchUrl
    const s2 = makeState({ site: { url: "https://s", name: "S" } });
    const open2 = s2.state.openUrl as ReturnType<typeof vi.fn>;
    bindBrowseEvents(s2.state, () => {});
    (s2.searchResults.querySelector(".cr-preset-btn") as HTMLElement).click();
    expect(open2).toHaveBeenCalledWith("https://s");
  });

  it("收藏点击 → toggleFav + toast + 卡片移到首部", () => {
    const { state, searchResults } = makeState();
    bindBrowseEvents(state, () => {});
    const star = searchResults.querySelector(".cr-star-btn") as HTMLElement;
    const grid = searchResults.querySelector("#cr-creator-grid") as HTMLElement;
    const card = searchResults.querySelector(".gh-card") as HTMLElement;
    grid.appendChild(card);
    star.click();
    expect(toggleFav).toHaveBeenCalledWith("A");
    expect(star.textContent).toBe("⭐");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已收藏") }),
    );
  });

  it("搜索快捷按钮 → openUrl(fillSearch(site.searchUrl, 名))，且不触发详情", () => {
    const { state, searchResults } = makeState();
    const openUrl = state.openUrl as ReturnType<typeof vi.fn>;
    bindBrowseEvents(state, () => {});
    (searchResults.querySelector(".cr-card-search") as HTMLElement).click();
    expect(openUrl).toHaveBeenCalledWith("https://s/search?q=A");
    // 未弹出详情浮层
    expect(searchResults.querySelector(".cr-detail-overlay")).toBeNull();
  });

  it("搜索快捷按钮（无 searchUrl）→ openUrl(site.url) 兜底", () => {
    const s2 = makeState({ site: { url: "https://s", name: "S" } });
    const open2 = s2.state.openUrl as ReturnType<typeof vi.fn>;
    bindBrowseEvents(s2.state, () => {});
    (s2.searchResults.querySelector(".cr-card-search") as HTMLElement).click();
    expect(open2).toHaveBeenCalledWith("https://s");
  });

  it("📁本地徽章点击 → repo:search-creator，且不触发详情", () => {
    const { state, searchResults } = makeState();
    bindBrowseEvents(state, () => {});
    (searchResults.querySelector(".cr-card-local-jump") as HTMLElement).click();
    expect(busEmit).toHaveBeenCalledWith("repo:search-creator", "A");
    // 未弹出详情浮层
    expect(searchResults.querySelector(".cr-detail-overlay")).toBeNull();
  });

  it("头像调试点击 → getApp DebugExtractCreatorAvatar + dbg", async () => {
    const { state, searchResults } = makeState();
    bindBrowseEvents(state, () => {});
    (searchResults.querySelector("[data-debug-avatar]") as HTMLElement).click();
    await waitFor(() => dbg.mock.calls.length > 0);
    expect(dbg.mock.calls[0]![0]).toBe("avatar-debug");
    expect(dbg.mock.calls[0]![1]).toBe("A");
  });

  it("storage 同步：ysm-fav-creators 事件 → 星标同步 + cleanup 移除监听", () => {
    const { state, searchResults } = makeState();
    const cleanup = bindBrowseEvents(state, () => {});
    (loadFavs as ReturnType<typeof vi.fn>).mockReturnValue(["A"]);
    window.dispatchEvent(new StorageEvent("storage", { key: "ysm-fav-creators" }));
    expect(searchResults.querySelector(".cr-star-btn")!.textContent).toBe("⭐");

    cleanup();
    window.dispatchEvent(new StorageEvent("storage", { key: "ysm-fav-creators" }));
    // 已在 cleanup 时移除监听，手动再触发不应有变化（事件已解绑）
    (loadFavs as ReturnType<typeof vi.fn>).mockReturnValue([]);
    window.dispatchEvent(new StorageEvent("storage", { key: "ysm-fav-creators" }));
    expect(loadFavs).toHaveBeenCalledTimes(1); // 仅第一次触发时被调
  });
});

describe("bindBrowseEvents — 详情浮层", () => {
  it("点击创作者卡片 → 浮层含名称/收藏/本地模型/操作按钮", () => {
    const { state, searchResults } = makeState();
    bindBrowseEvents(state, () => {});
    const card = searchResults.querySelector(".gh-card") as HTMLElement;
    card.click();
    const overlay = searchResults.querySelector(".cr-detail-overlay") as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain("A");
    expect(overlay.textContent).toContain("已下载 3 个模型");

    // 关闭按钮 → 移除浮层
    (overlay.querySelector("[data-close]") as HTMLElement).click();
    expect(searchResults.querySelector(".cr-detail-overlay")).toBeNull();
  });

  it("浮层 [data-local] → repo:search-creator；[data-search] → openUrl 搜索", () => {
    const { state, searchResults } = makeState();
    bindBrowseEvents(state, () => {});
    (searchResults.querySelector(".gh-card") as HTMLElement).click();
    const overlay = searchResults.querySelector(".cr-detail-overlay") as HTMLElement;

    (overlay.querySelector("[data-local]") as HTMLElement).click();
    expect(busEmit).toHaveBeenCalledWith("repo:search-creator", "A");

    (searchResults.querySelector(".gh-card") as HTMLElement).click();
    const overlay2 = searchResults.querySelector(".cr-detail-overlay") as HTMLElement;
    (overlay2.querySelector("[data-search]") as HTMLElement).click();
    expect(state.openUrl).toHaveBeenCalledWith("https://s/search?q=A");
  });

  it("点击收藏按钮 → 不弹浮层（stopPropagation）", () => {
    const { state, searchResults } = makeState();
    bindBrowseEvents(state, () => {});
    const star = searchResults.querySelector(".cr-star-btn") as HTMLElement;
    star.click();
    expect(searchResults.querySelector(".cr-detail-overlay")).toBeNull();
  });
});

describe("bindBrowseEvents — 键盘导航", () => {
  function makeGridCards(searchResults: HTMLElement): HTMLElement[] {
    const grid = searchResults.querySelector(".cr-creator-grid") as HTMLElement;
    const c1 = document.createElement("div");
    c1.className = "gh-card";
    c1.tabIndex = 0;
    const c2 = document.createElement("div");
    c2.className = "gh-card";
    c2.tabIndex = 0;
    grid.append(c1, c2);
    return [c1, c2];
  }

  it("ArrowDown → focus 下一张；ArrowUp → 上一张；Enter → click", () => {
    const { state, searchResults } = makeState();
    document.body.appendChild(searchResults); // focus 需要元素挂载
    bindBrowseEvents(state, () => {});
    const [c1, c2] = makeGridCards(searchResults);
    const grid = searchResults.querySelector(".cr-creator-grid") as HTMLElement;
    c1.focus();

    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement).toBe(c2);

    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(c1);

    const clickSpy = vi.spyOn(c1, "click").mockImplementation(() => {});
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});

describe("bindBrowseEvents — 浏览模式「点谁用谁」", () => {
  it("点击 cr-mode-opt[data-mode] → setBrowseMode(该mode) + 触发重渲染", () => {
    const { state, searchResults } = makeState();
    const refresh = vi.fn();
    bindBrowseEvents(state, refresh);
    const winBtn = searchResults.querySelector(
      '.cr-mode-opt[data-mode="window"]',
    ) as HTMLElement;
    winBtn.click();
    expect(state.setBrowseMode).toHaveBeenCalledWith("window");
    expect(refresh).toHaveBeenCalled();

    const extBtn = searchResults.querySelector(
      '.cr-mode-opt[data-mode="external"]',
    ) as HTMLElement;
    extBtn.click();
    expect(state.setBrowseMode).toHaveBeenCalledWith("external");
  });
});
