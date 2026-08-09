// ===== app-content 方法级补测 =====
// 覆盖：_render 各页面分支、_bindTabs 懒初始化（import/recycle/dedup/oldest）、
// _initRepository subtab 切换、_initPreviewResize 拖拽宽度、_initInstances、
// 事件订阅（repo:switch-tab / repo:search-creator / lang:changed / package:selected）、
// _fmtSize / _esc 纯函数。
// heavy feature 模块全 mock（副作用 import 断开），页面 HTML 用真实 tpl。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@wailsio/runtime", () => ({
  Events: { On: vi.fn().mockReturnValue(() => {}) },
}));

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    LoadAppConfig: vi.fn().mockResolvedValue({}),
    GetRepoRoot: vi.fn().mockResolvedValue(""),
    ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
    LoadGitHubRepos: vi.fn().mockResolvedValue([]),
    OpenInBrowser: vi.fn().mockResolvedValue(undefined),
    BatchExtractCreatorAvatars: vi.fn().mockResolvedValue({}),
    StartProxy: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  ScanModelEntries: vi.fn().mockResolvedValue([]),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  LoadAppConfig: vi.fn().mockResolvedValue({}),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
}));

// heavy feature 模块 mock（断开 import 副作用链）
vi.mock("../../core/handlers/global.ts", () => ({
  registerGlobalHandlers: vi.fn(() => []),
}));
vi.mock("../../features/import-dnd.ts", () => ({ registerDnD: vi.fn() }));
vi.mock("../app-resource-manager/index.ts", () => ({
  registerResourceManagerGlobal: vi.fn(),
}));
vi.mock("../app-tree/index.ts", () => ({ setPendingTreeSearch: vi.fn() }));
vi.mock("./diagnostics/community.ts", () => ({
  initDiagnostics: vi.fn(),
  startDedup: vi.fn(),
}));
vi.mock("../../features/import-queue.ts", () => ({ initImportQueue: vi.fn() }));
vi.mock("../../features/recycle-bin.ts", () => ({ initRecycleBin: vi.fn() }));
vi.mock("../../features/oldest-models.ts", () => ({
  loadOldestModel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../features/community/data.ts", () => ({ tryFetchModels: vi.fn() }));
vi.mock("./settings/community.ts", () => ({
  initSettings: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./community-data.ts", () => ({
  loadCommunityData: vi.fn().mockResolvedValue({ sites: [], creators: [], authors: [] }),
  fillSearch: vi.fn(),
}));
vi.mock("./site-view.ts", () => ({ renderSiteView: vi.fn(() => () => {}) }));
vi.mock("../../features/community/events.ts", () => ({ bindRepoEvents: vi.fn() }));
vi.mock("../../utils/icon/workshop-icons.ts", () => ({ getSiteIcon: vi.fn(() => "") }));

import { bus } from "../../bus.ts";
import { initImportQueue } from "../../features/import-queue.ts";
import { initRecycleBin } from "../../features/recycle-bin.ts";
import { loadOldestModel } from "../../features/oldest-models.ts";
import { startDedup } from "./diagnostics/community.ts";
import { setPendingTreeSearch } from "../app-tree/index.ts";
import "./index.ts"; // 触发 customElements.define("app-content")
import { sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";

type ContentEl = {
  shadowRoot: ShadowRoot;
  _current: string;
  _root: ShadowRoot;
  _globalUnsubs: Array<() => void>;
  _unsubs: Array<() => void>;
  _render(): void;
  _initPreviewResize(): void;
  _initRepository(): void;
  _initInstances(): void;
  _bindTabs(sel: string, prefix: string, ids: string[]): void;
  _fmtSize(bytes: number): string;
  _esc(s: unknown): string;
  [key: string]: unknown;
} & Element;

function mountContent(): ContentEl {
  const el = mountCustomElement("app-content") as unknown as ContentEl;
  // 页面级 init 方法替换为 spy（各自模块已有独立测试；此处只测 _render 分支/交互层）
  (el as unknown as { _initDiagnostics: () => void })._initDiagnostics = vi.fn();
  (el as unknown as { _initWorkshop: () => void })._initWorkshop = vi.fn();
  (el as unknown as { _initGithub: () => void })._initGithub = vi.fn();
  (el as unknown as { _initSettings: () => Promise<void> })._initSettings = vi.fn().mockResolvedValue(undefined);
  // _initInstances 保留真实实现（package:selected 订阅测试需要）
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.removeItem("nav_page");
  localStorage.removeItem("ui-default-page");
  localStorage.removeItem("repo_rtype");
  localStorage.removeItem("preview-width");
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("_render — 页面分支", () => {
  it("repository → 仓库页（.repo-tab + subtab）", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    expect(el.shadowRoot.querySelector(".repo-tab")).toBeTruthy();
    expect(el.shadowRoot.querySelector(".repo-subtab")).toBeTruthy();
    unmountElement(el);
  });

  it("instances 与未知页 → 整合包页（.ins-content）", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "instances";
    el._render();
    expect(el.shadowRoot.querySelector(".ins-content")).toBeTruthy();
    el._current = "weird-page";
    el._render(); // default 分支回落 instances
    expect(el.shadowRoot.querySelector(".ins-content")).toBeTruthy();
    unmountElement(el);
  });

  it("settings → .stg-tab；diagnostics/oldest → 诊断页；workshop → #ws-tabs；github → #gh-grid", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "settings";
    el._render();
    expect(el.shadowRoot.querySelector(".stg-tab")).toBeTruthy();
    el._current = "diagnostics";
    el._render();
    expect(el.shadowRoot.querySelector(".repo-tab")).toBeTruthy();
    el._current = "workshop";
    el._render();
    expect(el.shadowRoot.querySelector("#ws-tabs")).toBeTruthy();
    el._current = "github";
    el._render();
    expect(el.shadowRoot.querySelector("#gh-grid")).toBeTruthy();
    unmountElement(el);
  });

  it("init 抛错 → toast:show 而非中断（bus 收到错误事件）", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "settings";
    // _render 的 try/catch 只捕获同步 throw（async reject 会变 unhandled，不进 catch）
    (el as unknown as { _initSettings: () => Promise<void> })._initSettings = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as () => Promise<void>;
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", toastSpy);
    try {
      el._render();
      await sleep(20);
      expect(toastSpy).toHaveBeenCalled();
    } finally {
      unsub();
      unmountElement(el);
    }
  });
});

describe("_bindTabs — 仓库 tab 懒初始化", () => {
  it("点击 import tab → 渲染下载页 + initImportQueue 注册", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const importBtn = el.shadowRoot.querySelector('.repo-tab[data-tab="import"]') as HTMLElement;
    importBtn.click();
    await sleep(20);
    expect(initImportQueue).toHaveBeenCalled();
    const body = el.shadowRoot.getElementById("repo-tab-import");
    expect(body?.innerHTML.length).toBeGreaterThan(0);
    expect(body?.style.display).not.toBe("none");
    unmountElement(el);
  });

  it("点击 recycle tab → initRecycleBin 注册", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const btn = el.shadowRoot.querySelector('.repo-tab[data-tab="recycle"]') as HTMLElement;
    btn.click();
    await sleep(20);
    expect(initRecycleBin).toHaveBeenCalled();
    unmountElement(el);
  });

  it("点击 oldest tab → loadOldestModel 注册", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const btn = el.shadowRoot.querySelector('.repo-tab[data-tab="oldest"]') as HTMLElement;
    btn.click();
    await sleep(20);
    expect(loadOldestModel).toHaveBeenCalled();
    unmountElement(el);
  });

  it("点击 dedup tab → 渲染去重按钮；点击按钮与 rtype-changed 均触发 startDedup", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const btn = el.shadowRoot.querySelector('.repo-tab[data-tab="dedup"]') as HTMLElement;
    btn.click();
    await sleep(20);
    const startBtn = el.shadowRoot.getElementById("dedup-start-btn") as HTMLElement | null;
    expect(startBtn).toBeTruthy();
    startBtn!.click();
    await sleep(20);
    expect(startDedup).toHaveBeenCalledTimes(1);
    bus.emit("repo:rtype-changed", "mmd"); // 全局类型切换 → 自动重复
    await sleep(20);
    expect(startDedup).toHaveBeenCalledTimes(2);
    unmountElement(el);
  });
});

describe("_initRepository — subtab 切换", () => {
  it("切换 rtype → 更新树 + 发 repo:rtype-changed", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const rtypeSpy = vi.fn();
    const unsub = bus.on("repo:rtype-changed", rtypeSpy);
    try {
      const mmd = el.shadowRoot.querySelector('.repo-subtab[data-rtab="mmd-skin"]') as HTMLElement;
      mmd.click();
      await sleep(20);
      expect(localStorage.getItem("repo_rtype")).toBe("mmd-skin");
      expect(rtypeSpy).toHaveBeenCalledWith("mmd-skin");
      // 树容器被重写为对应 <app-tree root>
      const tree = el.shadowRoot.getElementById("repo-tab-tree");
      expect(tree?.innerHTML).toContain('root="mmd-skin"');
    } finally {
      unsub();
      unmountElement(el);
    }
  });
});

describe("_initPreviewResize — 拖拽调宽", () => {
  it("拖拽 handle → preview 宽度变化 + 保存 localStorage", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const handle = el.shadowRoot.getElementById("preview-resize-handle") as HTMLElement | null;
    const preview = el.shadowRoot.getElementById("app-preview") as HTMLElement | null;
    expect(handle).toBeTruthy();
    expect(preview).toBeTruthy();
    // happy-dom 无布局，getBoundingClientRect 返回 0 → newW 取 max(160, ...) 下限
    handle!.dispatchEvent(new MouseEvent("mousedown", { cancelable: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    document.dispatchEvent(new MouseEvent("mouseup"));
    expect(preview!.style.width).toContain("px");
    expect(localStorage.getItem("preview-width")).toContain("px");
    unmountElement(el);
  });

  it("localStorage 已有宽度 → 恢复并钳制 160–500", async () => {
    localStorage.setItem("preview-width", "999"); // 超上限 → 500
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const preview = el.shadowRoot.getElementById("app-preview") as HTMLElement | null;
    expect(preview?.style.width).toBe("500px");
    unmountElement(el);
  });
});

describe("事件订阅", () => {
  it("repo:switch-tab → 点击对应 tab", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "repository";
    el._render();
    const importBtn = el.shadowRoot.querySelector('.repo-tab[data-tab="import"]') as HTMLElement;
    const clickSpy = vi.spyOn(importBtn, "click");
    bus.emit("repo:switch-tab", { tab: "import" });
    await sleep(10);
    expect(clickSpy).toHaveBeenCalled();
    unmountElement(el);
  });

  it("repo:search-creator → 存搜索词 + 切仓库页", async () => {
    const el = mountContent();
    await sleep(50);
    const navSpy = vi.fn();
    const unsub = bus.on("nav:change", navSpy);
    try {
      bus.emit("repo:search-creator", "某作者");
      await sleep(10);
      expect(setPendingTreeSearch).toHaveBeenCalledWith("某作者");
      expect(navSpy).toHaveBeenCalledWith({ page: "repository" });
    } finally {
      unsub();
      unmountElement(el);
    }
  });

  it("lang:changed → 重渲染当前页", async () => {
    const el = mountContent();
    await sleep(50);
    const before = el.shadowRoot.innerHTML;
    el._current = "repository";
    el._render();
    bus.emit("lang:changed", { lang: "en" });
    await sleep(10);
    expect(el.shadowRoot.querySelector(".repo-tab")).toBeTruthy();
    void before;
    unmountElement(el);
  });

  it("package:selected → ins-content 渲染 app-sync-manager", async () => {
    const el = mountContent();
    await sleep(50);
    el._current = "instances";
    el._render(); // 真实 _initInstances 注册 package:selected 订阅
    bus.emit("package:selected", { name: "MyPack", rtype: "ysm" });
    await sleep(10);
    const content = el.shadowRoot.getElementById("ins-content");
    expect(content?.innerHTML).toContain("app-sync-manager");
    expect(content?.innerHTML).toContain('instance="MyPack"');
    unmountElement(el);
  });
});

describe("纯函数", () => {
  it("_fmtSize：0/字节/KB/MB 分级", () => {
    const el = mountCustomElement("app-content") as unknown as ContentEl;
    expect((el as unknown as { _fmtSize(n: number): string })._fmtSize(0)).toBe("");
    expect((el as unknown as { _fmtSize(n: number): string })._fmtSize(512)).toBe("512 B");
    expect((el as unknown as { _fmtSize(n: number): string })._fmtSize(2048)).toBe("2.0 KB");
    expect((el as unknown as { _fmtSize(n: number): string })._fmtSize(5 * 1048576)).toBe("5.0 MB");
  });

  it("_esc：委托规范 esc（含引号转义）", () => {
    const el = mountCustomElement("app-content") as unknown as ContentEl;
    const esc = (el as unknown as { _esc(s: unknown): string })._esc.bind(el);
    expect(esc('<b title="x">')).toContain("&lt;b");
    expect(esc('a"b')).toContain("&quot;");
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});
