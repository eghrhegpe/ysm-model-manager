// ===== 站点视图浏览态事件绑定测试 =====
// 覆盖 bindBrowseEvents：
//  - 空状态按钮导航 / 创作者网格创建 / 预设搜索
//  - 收藏点击（阻止冒泡 + 排序 + toast）/ 头像调试 / 详情浮层（关闭/搜索/查看本地）
//  - 键盘导航 ←↑↓→ / storage 跨标签同步 + cleanup
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor } from "@/test-utils/index.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

const {
  busEmit,
  busOn,
  dbg,
  getCreatorIdentity,
  getTagDisplayLabel,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
  getSiteIcon,
  getTagIconFromRole,
  getApp,
  isDevMode,
} = vi.hoisted(() => ({
  busEmit: vi.fn(),
  busOn: vi.fn(() => () => {}),
  dbg: vi.fn(),
  // tag 与 getTagFromRole 对齐：浮层身份行按 `identity.tag === getTagFromRole(role)` 判定
  // 是否渲染（复核 N1），mock 缺 tag 会让身份行静默消失、与生产不符。
  // 注：本文件 getTagFromRole 的 mock 签名是零参（恒返回「模型」），故此处同样零参调用。
  getCreatorIdentity: vi.fn((cr) => ({
    icon: "🎭",
    label: cr.name + "(id)",
    tag: getTagFromRole(),
  })),
  getTagDisplayLabel: vi.fn((tag: string) => tag),
  getTagFromRole: vi.fn(() => "模型"),
  parseDescTags: vi.fn(() => []),
  loadFavs: vi.fn(() => []),
  isFaved: vi.fn(() => false),
  toggleFav: vi.fn(() => true),
  getSiteIcon: vi.fn(() => "🌐"),
  getTagIconFromRole: vi.fn(() => "🏷️"),
  getApp: vi.fn(),
  // 头像调试探针的门（dev-mode 单源）：默认关——生产态不得触发 Go 全库扫描
  isDevMode: vi.fn(() => false),
}));

vi.mock("@/bus", () => ({ bus: { emit: busEmit, on: busOn } }));
vi.mock("@/utils/debug/debug.ts", () => ({ dbg }));
vi.mock("./workshop-data.ts", async () => {
  // partial mock：标签/收藏函数按既有 hoisted mock 注入；parseSiteIds 保留真实现
  //（P1-6 收口后 events 消费它——整段 mock 不导出会炸「No export defined on mock」）
  const actual = await vi.importActual<typeof import("./workshop-data.ts")>(
    "./workshop-data.ts",
  );
  return {
    ...actual,
    getCreatorIdentity,
    getTagDisplayLabel,
    getTagFromRole,
    parseDescTags,
    loadFavs,
    isFaved,
    toggleFav,
  };
});
vi.mock("@/utils/icon/workshop-icons.ts", () => ({
  getSiteIcon,
  getTagIconFromRole,
}));
vi.mock("@/backend/app.ts", () => ({ getApp }));
// 头像调试探针的门（默认关）：isDevMode 单源见 utils/debug/dev-mode.ts
vi.mock("@/utils/debug/dev-mode.ts", () => ({ isDevMode }));

import { bindBrowseEvents } from "./events.ts";
import type { SiteViewState } from "./types.ts";

/** bindBrowseEvents 的追踪版：cleanup 入桶，afterEach 统一调用（模拟产品路径的配对语义） */
function trackedBind(state: SiteViewState, refresh: () => void): () => void {
  const cleanup = bindBrowseEvents(state, refresh);
  _boundCleanups.push(cleanup);
  return cleanup;
}

import { escUnknown as esc } from "@/utils/html/html.ts";

function makeState(overrides: Record<string, unknown> = {}): {
  state: SiteViewState;
  searchResults: HTMLElement;
} {
  const searchResults = document.createElement("div");
  searchResults.innerHTML = `
    <div data-local-empty></div>
    <div id="cr-creator-grid" class="cr-creator-grid">
      <div class="gh-card cr-creator-card cr-creator-card--grid" tabindex="0" data-name="A" data-tag="modeler" title="搜索 A">
        <div class="cr-card-header">
          <div class="cr-avatar-container">
            <div class="cr-avatar-ring"></div>
            <div class="cr-avatar cr-avatar-fallback">A</div>
          </div>
          <div class="cr-card-name-row">
            <span class="cr-card-name">A</span>
            <span class="cr-card-local-count cr-card-local-jump" data-local-creator="A" title="查看本地模型">${UI_ICONS.folder}3</span>
            <span class="cr-star-btn" data-star="A">${UI_ICONS.star}</span>
            <span class="cr-card-search" data-search-creator="A" title="搜索更多模型">${UI_ICONS.search}</span>
          </div>
        </div>
        <div class="cr-card-desc">好模型</div>
        <div class="cr-card-footer">
          <span class="cr-platform-badge">github</span>
          <span class="cr-tag cr-tag-modeler">🏷️ <span>modeler</span></span>
        </div>
      </div>
    </div>
    <button class="cr-preset-btn" data-q="dog">dog</button>
    <img data-debug-avatar="A" data-avatar-fallback="A" alt="avatar">
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

/** 追踪 bindBrowseEvents 的 cleanup，集中到用例边界调用——产品路径 init-workshop 每次
 *  渲染前必跑 runPrevSiteViewCleanup（监听恒配对），测试须模拟同样的配对语义，
 *  否则 P1-8 闭包化后 storage 监听会跨用例残留堆积（旧模块级单例覆盖恰好掩盖了这一点）。 */
const _boundCleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of _boundCleanups.splice(0)) fn();
});

describe("bindBrowseEvents — 基础绑定", () => {
  it("空状态按钮 → nav:changed 到 repository", () => {
    const { state } = makeState();
    trackedBind(state, () => {});
    (state.searchResults.querySelector("[data-local-empty]") as HTMLElement).click();
    expect(busEmit).toHaveBeenCalledWith("nav:changed", { page: "repository" });
  });

  it("有创作者且非编辑模式 → 声明式 HTML 已包含卡片（grid 有子元素）", () => {
    const { state } = makeState();
    trackedBind(state, () => {});
    const grid = state.searchResults.querySelector(".cr-creator-grid");
    expect(grid).toBeTruthy();
    expect(grid!.querySelectorAll(".cr-creator-card")).toHaveLength(1);
  });

  // 注：「编辑模式不渲染网格」已随职责迁至 render.ts（buildSiteHtml 决定网格存亡），
  // events.ts 只做绑定，不再承担网格填充——断言见 render.test.ts「编辑态不渲染创作者网格」。

  it("预设搜索按钮 → openUrl(fillSearch)；无 searchUrl → 打开站点首页", () => {
    const { state } = makeState();
    const openUrl = state.openUrl as ReturnType<typeof vi.fn>;
    trackedBind(state, () => {});
    (state.searchResults.querySelector(".cr-preset-btn") as HTMLElement).click();
    expect(openUrl).toHaveBeenCalledWith(
      "https://s/search?q=dog",
    );

    // 无 searchUrl
    const s2 = makeState({ site: { url: "https://s", name: "S" } });
    const open2 = s2.state.openUrl as ReturnType<typeof vi.fn>;
    trackedBind(s2.state, () => {});
    (s2.searchResults.querySelector(".cr-preset-btn") as HTMLElement).click();
    expect(open2).toHaveBeenCalledWith("https://s");
  });

  it("取消收藏 → 卡片回到产量序的正确位次，而非队尾（排序规则单源回归）", () => {
    // 历史缺陷：取消收藏一律 appendChild 扔队尾，与 render.ts 规则（收藏置顶 +
    // 组内产量降序）反向——且不触发重渲染，错乱持续到整树重建。现就地按同一比较器重排。
    //
    // ⚠️ 夹具要件：被取消的收藏者 A 产量必须**低于**某个未收藏者（B）。
    //    若 A 产量最高（10），取消后按规则仍居首，两版行为巧合一致 → 什么也锁不住。
    const { state, searchResults } = makeState();
    state.authorCountMap = { A: 5, B: 10, C: 1 };
    searchResults.innerHTML =
      '<div id="cr-creator-grid" class="cr-creator-grid">' +
      '<div class="gh-card" data-name="A" tabindex="0"><span class="cr-star-btn" data-star="A"></span></div>' +
      '<div class="gh-card" data-name="B" tabindex="0"><span class="cr-star-btn" data-star="B"></span></div>' +
      '<div class="gh-card" data-name="C" tabindex="0"><span class="cr-star-btn" data-star="C"></span></div>' +
      "</div>";
    // 收藏名单状态机：A 初始已收藏，本次点击取消（toggleFav 返回 false 并移除 A）
    let favList = ["A"];
    (loadFavs as ReturnType<typeof vi.fn>).mockImplementation(() => favList);
    (isFaved as ReturnType<typeof vi.fn>).mockImplementation((n: string) => favList.includes(n));
    (toggleFav as ReturnType<typeof vi.fn>).mockImplementation((n: string) => {
      if (favList.includes(n)) {
        favList = favList.filter((x) => x !== n);
        return false;
      }
      favList = [...favList, n];
      return true;
    });
    trackedBind(state, () => {});

    const grid = searchResults.querySelector("#cr-creator-grid") as HTMLElement;
    const order = () =>
      Array.from(grid.querySelectorAll<HTMLElement>(".gh-card")).map((c) => c.dataset.name);
    // 收藏置顶 → A 领先 B(10)
    expect(order()).toEqual(["A", "B", "C"]);

    (searchResults.querySelector('[data-star="A"]') as HTMLElement).click();

    // 取消收藏后按产量重排：B(10) → A(5) → C(1)
    // 旧实现 appendChild → [B, C, A]（A 沉到队尾，与规则反向）
    expect(order()).toEqual(["B", "A", "C"]);
  });

  it("收藏点击 → toggleFav + toast + 卡片移到首部", () => {
    const { state, searchResults } = makeState();
    trackedBind(state, () => {});
    const star = searchResults.querySelector(".cr-star-btn") as HTMLElement;
    const grid = searchResults.querySelector("#cr-creator-grid") as HTMLElement;
    const card = searchResults.querySelector(".gh-card") as HTMLElement;
    grid.appendChild(card);
    star.click();
    expect(toggleFav).toHaveBeenCalledWith("A");
    // ADR-238：星标改走 SVG 语义图标（已收藏 = starFilled，svg 带 fill 属性）
    const starSvg = star.querySelector("svg");
    expect(starSvg).toBeTruthy();
    expect(starSvg?.hasAttribute("fill")).toBe(true);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("已收藏") }),
    );
  });

  it("搜索快捷按钮 → openUrl(fillSearch(site.searchUrl, 名))，且不触发详情", () => {
    const { state, searchResults } = makeState();
    const openUrl = state.openUrl as ReturnType<typeof vi.fn>;
    trackedBind(state, () => {});
    (searchResults.querySelector(".cr-card-search") as HTMLElement).click();
    expect(openUrl).toHaveBeenCalledWith("https://s/search?q=A");
    // 未弹出详情浮层
    expect(searchResults.querySelector(".cr-detail-overlay")).toBeNull();
  });

  it("搜索快捷按钮（无 searchUrl）→ openUrl(site.url) 兜底", () => {
    const s2 = makeState({ site: { url: "https://s", name: "S" } });
    const open2 = s2.state.openUrl as ReturnType<typeof vi.fn>;
    trackedBind(s2.state, () => {});
    (s2.searchResults.querySelector(".cr-card-search") as HTMLElement).click();
    expect(open2).toHaveBeenCalledWith("https://s");
  });

  it("📁本地徽章点击 → repo:search-creator，且不触发详情", () => {
    const { state, searchResults } = makeState();
    trackedBind(state, () => {});
    (searchResults.querySelector(".cr-card-local-jump") as HTMLElement).click();
    expect(busEmit).toHaveBeenCalledWith("repo:search-creator", "A");
    // 未弹出详情浮层
    expect(searchResults.querySelector(".cr-detail-overlay")).toBeNull();
  });

  it("开发态（isDevMode）点头像 → 调 DebugExtractCreatorAvatar + dbg", async () => {
    isDevMode.mockReturnValue(true);
    const { state, searchResults } = makeState();
    trackedBind(state, () => {});
    (searchResults.querySelector("[data-debug-avatar]") as HTMLElement).click();
    await waitFor(() => dbg.mock.calls.length > 0);
    expect(dbg.mock.calls[0]![0]).toBe("avatar-debug");
    expect(dbg.mock.calls[0]![1]).toBe("A");
  });

  it("生产默认态（isDevMode=false）点头像 → 不触发 Go 扫描，且点击回归卡片行为开浮层", () => {
    // 历史缺陷：头像 click 无条件调 DebugExtractCreatorAvatar（Go 侧对整库
    // ScanModelEntries 全量扫描，见 internal/app/app_avatar.go|DebugExtractCreatorAvatar），
    // 结果只进 dbg 环形缓冲——用户看不见任何反应；又因 stopPropagation 吞掉卡片点击，
    // 连本该打开的详情浮层也不开。即「最贵的手势 + 零可见反馈 + 吞掉正常行为」。
    // 现：探针门 = isDevMode()（默认关），非开发态根本不绑 click。
    isDevMode.mockReturnValue(false);
    const { state, searchResults } = makeState();
    // 自建**生产形状**夹具：真实 createCrCard 把 `<img class="cr-avatar" data-debug-avatar>`
    // 嵌在 .gh-card 内（makeState 的 img 是游离兄弟节点，测不出冒泡语义）。
    searchResults.innerHTML =
      '<div id="cr-creator-grid" class="cr-creator-grid">' +
      '<div class="gh-card cr-creator-card" tabindex="0" data-name="A" data-tag="creator">' +
      '<div class="cr-avatar-container"><div class="cr-avatar-ring"></div>' +
      '<img class="cr-avatar" src="data:," data-debug-avatar="A" data-avatar-fallback="A">' +
      "</div></div></div>";
    // 挂进真实 shadow root：浮层写入 `searchResults.getRootNode()`，留在 light DOM 时该值
    // 是 Document，happy-dom 的 document.appendChild 直接抛「Only one element on document
    // allowed」——那是夹具结构错，不是生产缺陷（生产中容器恒在 app-content 的 shadow root 内）。
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(searchResults);
    trackedBind(state, () => {});

    const extract = (getApp as ReturnType<typeof vi.fn>).mock.results;
    (searchResults.querySelector("[data-debug-avatar]") as HTMLElement).click();
    expect(extract).toHaveLength(0); // 未发起任何桥调用（全库扫描的门确实关上了）
    // 点击未被吞：冒泡到卡片 → 详情浮层打开（观测点同生产，在 shadow root 上）
    expect(shadow.querySelector(".cr-detail-overlay")).toBeTruthy();
  });

  it("头像加载失败（error）→ 用 data-avatar-fallback 字母替换 img", () => {
    const { state, searchResults } = makeState();
    trackedBind(state, () => {});
    const img = searchResults.querySelector("[data-debug-avatar]") as HTMLImageElement;
    img.dispatchEvent(new Event("error"));
    const fallback = searchResults.querySelector(".cr-avatar-fallback");
    expect(fallback?.textContent).toBe("A");
    // img 已就地替换（声明式降级不残留破图节点）
    expect(searchResults.querySelector("[data-debug-avatar]")).toBeNull();
  });

  it("storage 同步：ysm-fav-creators 事件 → 星标同步 + cleanup 移除监听", () => {
    const { state, searchResults } = makeState();
    const cleanup = trackedBind(state, () => {});
    (loadFavs as ReturnType<typeof vi.fn>).mockReturnValue(["A"]);
    window.dispatchEvent(new StorageEvent("storage", { key: "ysm-fav-creators" }));
    // ADR-238：星标改走 SVG 语义图标（已收藏 = starFilled，svg 带 fill 属性）
    const syncedStar = searchResults.querySelector(".cr-star-btn")!.querySelector("svg");
    expect(syncedStar).toBeTruthy();
    expect(syncedStar?.hasAttribute("fill")).toBe(true);

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
    trackedBind(state, () => {});
    const card = searchResults.querySelector(".gh-card") as HTMLElement;
    card.click();
    const overlay = searchResults.querySelector(".cr-detail-overlay") as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toContain("A");
    expect(overlay.textContent).toContain("已下载 3 个模型");
    // 锐评 P0-3：非标签式 desc（本文件 mock parseDescTags → []）必须展示全文，不再被吞。
    // ⚠️ 本文件的 parseDescTags 是 mock，**测不出「真描述的丢原文」**——真实链路的锁在
    // events-desc.integration.test.ts（不 mock workshop-data），引用覆盖凭证时请看那边。
    expect(overlay.querySelector(".cr-detail-desc")?.textContent).toContain("好模型");

    // 关闭按钮 → 移除浮层
    (overlay.querySelector("[data-close]") as HTMLElement).click();
    expect(searchResults.querySelector(".cr-detail-overlay")).toBeNull();
  });

  it("本地条目空 desc → 浮层回退当前语言提示（锐评 P0-2b）", () => {
    const { state, searchResults } = makeState({
      creators: [{ name: "A", role: "modeler", desc: "", type: "github", _fromLocal: true }],
    });
    trackedBind(state, () => {});
    (searchResults.querySelector(".gh-card") as HTMLElement).click();
    const overlay = searchResults.querySelector(".cr-detail-overlay") as HTMLElement;
    expect(overlay.querySelector(".cr-detail-desc")?.textContent).toBe("来自本地仓库");
  });

  it("浮层 [data-local] → repo:search-creator；[data-search] → openUrl 搜索", () => {
    const { state, searchResults } = makeState();
    trackedBind(state, () => {});
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
    trackedBind(state, () => {});
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

  /**
   * 挂进真实 shadow host——**这是本组用例存在的全部意义**。
   * 创作者网格在生产中位于 app-content 的 shadow root（init-workshop 的 root 来自
   * attachShadow），此时 `document.activeElement` 按 DOM retargeting 规则返回 **host**
   * 而非内层卡片。旧夹具把 searchResults 直接 appendChild 到 document.body（light DOM），
   * 于是 document.activeElement === 卡片 恒成立，键盘导航「测绿」而生产 100% 失效。
   * 本组用例改挂 shadow，断言一律读 root.activeElement（生产口径）。
   */
  function makeShadowState(): {
    state: SiteViewState;
    searchResults: HTMLElement;
    root: ShadowRoot;
  } {
    const base = makeState();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.appendChild(base.searchResults);
    return { state: base.state, searchResults: base.searchResults, root };
  }

  it("shadow 内：ArrowDown → focus 下一张；ArrowUp → 上一张；Enter → click", () => {
    const { state, searchResults, root } = makeShadowState();
    trackedBind(state, () => {});
    const [c1, c2] = makeGridCards(searchResults);
    const grid = searchResults.querySelector(".cr-creator-grid") as HTMLElement;
    c1.focus();
    // 生产口径前置断言：焦点确实在 shadow 树内（document 级只能看到 host）
    expect(root.activeElement).toBe(c1);
    expect(document.activeElement).not.toBe(c1);

    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(root.activeElement).toBe(c2);

    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(root.activeElement).toBe(c1);

    const clickSpy = vi.spyOn(c1, "click").mockImplementation(() => {});
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("shadow 内：末项 ArrowDown 回绕到首项（末尾回绕）", () => {
    const { state, searchResults, root } = makeShadowState();
    trackedBind(state, () => {});
    const [, c2] = makeGridCards(searchResults);
    const grid = searchResults.querySelector(".cr-creator-grid") as HTMLElement;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(".gh-card[tabindex]"));
    // 夹具自带 1 张卡 + makeGridCards 追加 2 张 → 共 3 张，末项是 c2
    expect(cards).toHaveLength(3);
    c2.focus();
    grid.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(root.activeElement).toBe(cards[0]);
  });
});

describe("bindBrowseEvents — 浏览模式「点谁用谁」", () => {
  it("点击 cr-mode-opt[data-mode] → setBrowseMode(该mode) + 触发重渲染", () => {
    const { state, searchResults } = makeState();
    const refresh = vi.fn();
    trackedBind(state, refresh);
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
