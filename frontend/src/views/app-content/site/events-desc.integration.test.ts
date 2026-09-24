// ===== 详情浮层 desc 渲染：真实 parseDescTags → 分支的集成锁（复核 P1-2/P1-3）=====
//
// 为什么需要这个文件：`events.test.ts` 把整个 `workshop-data.ts` mock 掉（`parseDescTags → []`），
// 于是「浮层丢原文」的回归在那边**永远测不出来**（父提交照样绿）——本文件只 mock 无关副作用
// （backend / dbg），让 `parseDescTags`、`getTagDisplayLabel`、`loadFavs` 全走**真实实现**，
// 把「真实输出 → 浮层分支」这条链锁住。
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/utils/debug/debug.ts", () => ({ dbg: vi.fn() }));
vi.mock("@/views/backend-deps.ts", () => ({
  backendGetApp: async () => ({ DebugExtractCreatorAvatar: async () => ({}) }),
}));

import { bindBrowseEvents } from "./events.ts";
import type { LocalCreatorLike, SiteViewState } from "./types.ts";

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** 真实 DOM 夹具：一张卡片（.gh-card[data-name]）+ 收藏/头像等被绑定块忽略的容器 */
function makeState(creators: LocalCreatorLike[]): {
  state: SiteViewState;
  searchResults: HTMLElement;
} {
  const searchResults = document.createElement("div");
  searchResults.innerHTML = `
    <div id="cr-creator-grid" class="cr-creator-grid">
      <div class="gh-card cr-creator-card cr-creator-card--grid" tabindex="0" data-name="A" data-tag="modeler">
        <div class="cr-card-header">
          <div class="cr-avatar-container">
            <div class="cr-avatar cr-avatar-fallback">A</div>
          </div>
          <div class="cr-card-name-row">
            <span class="cr-card-name">A</span>
            <span class="cr-star-btn" data-star="A">☆</span>
          </div>
        </div>
        <div class="cr-card-desc">描述</div>
      </div>
    </div>
    <div id="cr-mode-switch"></div>
  `;
  // 刻意**不挂进 document.body**：events.ts 用 `searchResults.getRootNode()` 落浮层，
  // 已挂载时 getRootNode() = document → appendChild 报「Only one element on document allowed」
  // （与 events.test.ts 同款夹具约定）。
  const state: SiteViewState = {
    esc,
    searchResults,
    allSites: [],
    allCreators: creators,
    repoAuthors: [],
    wsEditModeRef: { v: false },
    fillSearch: (tpl) => tpl,
    openUrl: vi.fn(),
    setBrowseMode: vi.fn(),
    avatarCache: {},
    site: {
      id: "siteA",
      searchUrl: "https://s/search?q={q}",
      url: "https://s",
    } as unknown as SiteViewState["site"],
    creators,
    authorCountMap: {},
    bus: { emit: vi.fn() } as unknown as SiteViewState["bus"],
    ctx: null as unknown as SiteViewState["ctx"],
    activeTag: "",
    searchKw: "",
  };
  return { state, searchResults };
}

/** 打开详情浮层并取回它 */
function openOverlay(state: SiteViewState, searchResults: HTMLElement): HTMLElement {
  bindBrowseEvents(state, () => {});
  (searchResults.querySelector(".gh-card") as HTMLElement).click();
  return searchResults.querySelector(".cr-detail-overlay") as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("详情浮层 desc：真实解析链（复核 P1-2 / P0-3）", () => {
  it("英文描述含 ASCII 逗号 → 展示全文，不切 chips（不再被逗号碎掉）", () => {
    const { state, searchResults } = makeState([
      { name: "A", role: "modeler", desc: "cool models, fast updates", type: "github" },
    ] as LocalCreatorLike[]);
    const overlay = openOverlay(state, searchResults);
    expect(overlay.querySelectorAll(".cr-desc-tag")).toHaveLength(0);
    expect(overlay.querySelector(".cr-detail-desc")?.textContent).toContain(
      "cool models, fast updates",
    );
  });

  it("顿号标签串（≤6 段）→ 渲染 chips", () => {
    const { state, searchResults } = makeState([
      { name: "A", role: "modeler", desc: "模型、捏人、皮肤", type: "github" },
    ] as LocalCreatorLike[]);
    const overlay = openOverlay(state, searchResults);
    const chips = [...overlay.querySelectorAll(".cr-desc-tag")].map((el) => el.textContent);
    expect(chips).toEqual(["#模型", "#捏人", "#皮肤"]);
  });

  it("≥7 段标签串 → 回退全文，尾段不丢（复核 P1-2 的 slice(0,6) 残留）", () => {
    const desc = "模型、捏人、皮肤、道具、坐骑、宠物、家具";
    const { state, searchResults } = makeState([
      { name: "A", role: "modeler", desc, type: "github" },
    ] as LocalCreatorLike[]);
    const overlay = openOverlay(state, searchResults);
    expect(overlay.querySelectorAll(".cr-desc-tag")).toHaveLength(0);
    const text = overlay.querySelector(".cr-detail-desc")?.textContent ?? "";
    expect(text).toContain("模型");
    expect(text).toContain("家具"); // 第 7 段必须在场
  });

  it("本地扫描条目（_fromLocal + 空 desc）→ 语言提示由展示层现取（源头已不落语言串）", () => {
    const { state, searchResults } = makeState([
      { name: "A", role: "modeler", desc: "", type: "ysm", _fromLocal: true },
    ] as LocalCreatorLike[]);
    const overlay = openOverlay(state, searchResults);
    expect(overlay.querySelector(".cr-detail-desc")?.textContent).toBe("来自本地仓库");
  });
});
