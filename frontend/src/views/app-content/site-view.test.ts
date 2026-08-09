// ===== 站点视图编排壳组件测试（G-1 — ADR-035 / Design.md §19.1）=====
// renderSiteView 是编排壳：构造数据 → 构 HTML → 绑三块事件 → 聚 cleanup。
// 三个 bindXxxEvents 子模块各自有组件测试（events.test/edit 待补/drag.test），
// 此处 mock 掉只验证编排：过滤/渲染/编辑模式/cleanup 聚合。
import { describe, it, expect, vi, beforeEach } from "vitest";

const binds = vi.hoisted(() => ({
  bindBrowseEvents: vi.fn((_state: unknown) => vi.fn()),
  bindEditEvents: vi.fn((_state: unknown) => vi.fn()),
  bindDragEvents: vi.fn((_state: unknown) => vi.fn()),
}));

vi.mock("./site/events.ts", () => ({ bindBrowseEvents: binds.bindBrowseEvents }));
vi.mock("./site/edit.ts", () => ({ bindEditEvents: binds.bindEditEvents }));
vi.mock("./site/drag.ts", () => ({ bindDragEvents: binds.bindDragEvents }));

import { renderSiteView, type RenderSiteViewCtx, type LocalCreatorLike } from "./site-view.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";

function makeCtx(over: Partial<RenderSiteViewCtx> = {}): {
  ctx: RenderSiteViewCtx;
  searchResults: HTMLElement;
  creatorView: HTMLElement;
} {
  const searchResults = document.createElement("div");
  const creatorView = document.createElement("div");
  const allCreators: LocalCreatorLike[] = [
    { name: "高产甲", type: "siteA;official" } as LocalCreatorLike,
    { name: "低产乙", type: "siteA" } as LocalCreatorLike,
    { name: "他站丙", type: "siteB" } as LocalCreatorLike,
  ];
  const ctx: RenderSiteViewCtx = {
    esc: (s: unknown) => String(s),
    searchResults,
    creatorView,
    allSites: [],
    allCreators,
    repoAuthors: [{ Name: "高产甲", Count: 9 }, { Name: "低产乙", Count: 1 }],
    wsEditModeRef: { v: false },
    showRepoModels: vi.fn(),
    fillSearch: (tpl) => tpl,
    repoModelCache: new Map(),
    openUrl: vi.fn(),
    backToSite: vi.fn(),
    avatarCache: {},
    ...over,
  };
  document.body.appendChild(searchResults);
  document.body.appendChild(creatorView);
  return { ctx, searchResults, creatorView };
}

const site: WorkshopSite = { id: "siteA", label: "测试站" } as WorkshopSite;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("renderSiteView 编排壳", () => {
  it("1. 渲染 HTML 到 searchResults 并隐藏 creatorView", () => {
    const { ctx, searchResults, creatorView } = makeCtx();
    renderSiteView(site, ctx);
    expect(searchResults.innerHTML).toContain("cr-scroll");
    expect(creatorView.style.display).toBe("none");
  });

  it("2. 只保留 type 含本站 id 的创作者（ws-cr-count=2）", () => {
    const { ctx, searchResults } = makeCtx();
    renderSiteView(site, ctx);
    const count = searchResults.querySelector("#ws-cr-count");
    expect(count?.textContent).toContain("2"); // 高产甲 + 低产乙，排除他站丙
  });

  it("3. 编辑模式 wsEditModeRef.v=true → 渲染搜索词编辑区", () => {
    const { ctx, searchResults } = makeCtx({
      wsEditModeRef: { v: true },
    });
    renderSiteView(site, ctx);
    expect(searchResults.innerHTML).toContain("cr-add-preset");
  });

  it("4. 三块事件绑定各被调用一次", () => {
    const { ctx } = makeCtx();
    renderSiteView(site, ctx);
    expect(binds.bindBrowseEvents).toHaveBeenCalledTimes(1);
    expect(binds.bindEditEvents).toHaveBeenCalledTimes(1);
    expect(binds.bindDragEvents).toHaveBeenCalledTimes(1);
  });

  it("5. 返回的 cleanup 聚合调用三块 cleanup", () => {
    const { ctx } = makeCtx();
    const cleanup = renderSiteView(site, ctx);
    const browseC = binds.bindBrowseEvents.mock.results[0].value as ReturnType<typeof vi.fn>;
    const editC = binds.bindEditEvents.mock.results[0].value as ReturnType<typeof vi.fn>;
    const dragC = binds.bindDragEvents.mock.results[0].value as ReturnType<typeof vi.fn>;
    cleanup();
    expect(browseC).toHaveBeenCalled();
    expect(editC).toHaveBeenCalled();
    expect(dragC).toHaveBeenCalled();
  });

  it("6. 创作者按模型数降序传入 buildSiteHtml（高产在前）", () => {
    // renderSiteView 内 sort 的是过滤后新数组；经 buildSiteHtml 的再次排序
    // 产出同样顺序——通过绑定块收到的 state.creators 断言顺序
    const { ctx } = makeCtx();
    renderSiteView(site, ctx);
    const received = binds.bindBrowseEvents.mock.calls[0][0] as unknown as {
      creators: LocalCreatorLike[];
    };
    expect(received.creators.map((c) => c.name)).toEqual(["高产甲", "低产乙"]);
  });
});
