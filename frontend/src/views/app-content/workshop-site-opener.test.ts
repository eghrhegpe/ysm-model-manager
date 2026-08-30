// ===== openSite 站点打开器单测（透传 targetUrl 回归）=====
// 背景：搜索按钮拼好的带词链接经 ctx.openUrl 转发，但实现曾丢弃 url 只按 site.url 打开，
// 导致「所有站点搜索退化为只开首页」。本文件锁定 openSite 必须把 targetUrl 真传给各打开分支。
// 扩写覆盖：窗口模式 web 平台回退、内嵌 15s 超时兜底（fake timers）、bindSiteEvents 全部按钮
// （返回/打开/窗口打开/导出/导入：web 降级 + 桥 + toast 成功/失败分支）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn(),
}));

const { isWebPlatform, busEmit, friendlyError } = vi.hoisted(() => ({
  isWebPlatform: vi.fn(() => false),
  busEmit: vi.fn(),
  friendlyError: vi.fn(
    (e: unknown, fb?: string) => `${String((e as Error)?.message ?? e)}|${fb ?? ""}`,
  ),
}));

vi.mock("../../backend/platform-web.ts", () => ({ isWebPlatform }));
vi.mock("../../bus.ts", () => ({ bus: { emit: busEmit } }));
vi.mock("../../utils/dom/errors.ts", () => ({ friendlyError }));
// 替换全局 setup 的 t mock：避免拉起 locale.ts → bus 的真实链
vi.mock("../../core/i18n/t.ts", () => ({ t: (key: string) => key }));

import { getApp } from "../../backend/app.ts";
import { openSite, bindSiteEvents } from "./workshop-site-opener.ts";
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import type { AppContentHost } from "./init-workshop.ts";

/** 组装 openEmbedded 分支需要的假 host（shadow DOM 节点直供） */
function makeHost() {
  const nodes: Record<string, any> = {
    "ws-iframe": { style: {}, src: "", onload: null },
    "ws-url": { textContent: "" },
    "ws-browser": { style: {} },
    "ws-blocked": { style: {} },
  };
  const host = {
    _root: { getElementById: (id: string) => nodes[id] ?? null },
  } as unknown as AppContentHost;
  return { host, nodes };
}

function makeApp() {
  return { OpenInBrowser: vi.fn(), NavigatePlazaWindow: vi.fn() };
}

/** 冲刷 getApp().then 的微任务 */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  const app = makeApp();
  (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
  return app;
});

const site = { id: "github", url: "https://github.com/", label: "GitHub" } as any;

describe("openSite — 透传 targetUrl", () => {
  it("外链模式：无 targetUrl → OpenInBrowser(site.url)", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    openSite(makeHost().host, site, "external");
    await flush();
    expect(app.OpenInBrowser).toHaveBeenCalledWith("https://github.com/");
  });

  it("外链模式：带 targetUrl → OpenInBrowser(targetUrl)，而非 site.url（回归：搜索带词链接被丢弃）", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const target = "https://github.com/search?q=%E5%B0%8F%E7%BA%A2";
    openSite(makeHost().host, site, "external", target);
    await flush();
    expect(app.OpenInBrowser).toHaveBeenCalledWith(target);
    expect(app.OpenInBrowser).not.toHaveBeenCalledWith(site.url);
  });

  it("窗口模式：带 targetUrl → NavigatePlazaWindow(targetUrl, true)", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const target = "https://github.com/search?q=foo";
    openSite(makeHost().host, site, "window", target);
    await flush();
    expect(app.NavigatePlazaWindow).toHaveBeenCalledWith(target, true);
  });

  it("内嵌模式：带 targetUrl → iframe.src 与地址栏都落实到 targetUrl", () => {
    const { host, nodes } = makeHost();
    const target = "https://github.com/search?q=bar";
    openSite(host, site, "embed", target);
    expect(nodes["ws-iframe"].src).toBe(target);
    expect(nodes["ws-url"].textContent).toBe(target);
  });

  it("内嵌模式：无 targetUrl → iframe.src 用 site.url", () => {
    const { host, nodes } = makeHost();
    openSite(host, site, "embed");
    expect(nodes["ws-iframe"].src).toBe(site.url);
  });
});

// ==================== 扩写：平台分支 / 内嵌超时 / bindSiteEvents ====================

afterEach(() => {
  vi.useRealTimers();
  isWebPlatform.mockReturnValue(false);
});

describe("openSite — 窗口模式平台分支与内嵌容器状态", () => {
  it("窗口模式 + web 平台 → 无预热窗口，回退 OpenInBrowser（不调 NavigatePlazaWindow）", async () => {
    isWebPlatform.mockReturnValue(true);
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const target = "https://example.com/?q=1";
    openSite(makeHost().host, site, "window", target);
    await flush();
    expect(app.OpenInBrowser).toHaveBeenCalledWith(target);
    expect(app.NavigatePlazaWindow).not.toHaveBeenCalled();
  });

  it("内嵌模式：browser 显示 flex、blocked 隐藏、url 文案落实", () => {
    const { host, nodes } = makeHost();
    openSite(host, site, "embed");
    expect(nodes["ws-browser"].style.display).toBe("flex");
    expect(nodes["ws-blocked"].style.display).toBe("none");
    expect(nodes["ws-url"].textContent).toBe(site.url);
    expect(nodes["ws-iframe"].style.display).toBe("");
  });
});

describe("openEmbedded — 15s 加载超时兜底（fake timers）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("15s 未完成加载 → blocked 显示 flex（提示站点不允许内嵌）", () => {
    const { host, nodes } = makeHost();
    openSite(host, site, "embed");
    expect(nodes["ws-blocked"].style.display).toBe("none");
    vi.advanceTimersByTime(15000 - 1);
    expect(nodes["ws-blocked"].style.display).toBe("none");
    vi.advanceTimersByTime(1);
    expect(nodes["ws-blocked"].style.display).toBe("flex");
  });

  it("iframe.onload 完成 → 清除超时定时器，blocked 不弹出", () => {
    const { host, nodes } = makeHost();
    openSite(host, site, "embed");
    nodes["ws-iframe"].onload?.(new Event("load"));
    vi.advanceTimersByTime(16000); // 超过 WS_EMBED_TIMEOUT_MS(15000，模块私有常量)
    expect(nodes["ws-blocked"].style.display).toBe("none");
  });
});

describe("bindSiteEvents — 返回与打开按钮", () => {
  /** 组装 bindSiteEvents 需要的假 host（六个按钮 + iframe/browser 容器） */
  function makeBindHost() {
    const el = document.createElement("div");
    // 假 ShadowRoot：普通 div 无 getElementById，补一个按 id 查询的实现
    (el as unknown as { getElementById: (id: string) => Element | null }).getElementById =
      (id: string) => el.querySelector(`#${id}`);
    el.innerHTML = `
      <button id="ws-back"></button>
      <button id="ws-open"></button>
      <button id="ws-open-fallback"></button>
      <button id="ws-win-open"></button>
      <button id="ws-export-btn"></button>
      <button id="ws-import-btn"></button>
      <iframe id="ws-iframe" src="https://old.example.com/"></iframe>
      <div id="ws-browser"></div>
      <div id="ws-blocked" style="display:none"></div>
    `;
    const raw: Record<string, unknown> = { _root: el, _currentSite: null as unknown };
    const host = raw as unknown as AppContentHost;
    return {
      host,
      el,
      setCurrentSite: (s: typeof site) => { raw._currentSite = s; },
      btn: (id: string) => el.querySelector(`#${id}`) as HTMLElement,
      iframe: el.querySelector("#ws-iframe") as HTMLIFrameElement,
      browser: el.querySelector("#ws-browser") as HTMLElement,
    };
  }

  it("ws-back：清 iframe.src + 隐藏 browser 容器", () => {
    const b = makeBindHost();
    b.browser.style.display = "flex";
    bindSiteEvents(b.host);
    b.btn("ws-back").click();
    // happy-dom 将 iframe.src="" 解析为 base URL，用 attribute 断言原始写入
    expect(b.iframe.getAttribute("src")).toBe("");
    expect(b.browser.style.display).toBe("none");
  });

  it("ws-back：内嵌后返回 → 清掉 15s 超时定时器，blocked 不再弹出（回归：局部变量遮蔽模块级）", () => {
    vi.useFakeTimers();
    const b = makeBindHost();
    bindSiteEvents(b.host);
    openSite(b.host, site, "embed");
    b.btn("ws-back").click();
    vi.advanceTimersByTime(16000); // 超过 WS_EMBED_TIMEOUT_MS
    const blocked = b.el.querySelector("#ws-blocked") as HTMLElement;
    // 修复前：模块级 wsLoadTimer 从未被赋值，clearTimeout 清的是 undefined，
    // 局部超时定时器照常触发 → blocked 弹 flex（本断言红）
    expect(blocked.style.display).not.toBe("flex");
  });

  it("ws-open / ws-open-fallback：有 currentSite → OpenInBrowser(site.url)", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    b.setCurrentSite(site);
    bindSiteEvents(b.host);
    b.btn("ws-open").click();
    b.btn("ws-open-fallback").click();
    await flush();
    expect(app.OpenInBrowser).toHaveBeenCalledTimes(2);
    expect(app.OpenInBrowser).toHaveBeenCalledWith(site.url);
  });

  it("无 currentSite → 打开按钮不调桥", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    bindSiteEvents(b.host);
    b.btn("ws-open").click();
    b.btn("ws-open-fallback").click();
    b.btn("ws-win-open").click();
    await flush();
    expect(getApp).not.toHaveBeenCalled();
    expect(app.OpenInBrowser).not.toHaveBeenCalled();
    expect(app.NavigatePlazaWindow).not.toHaveBeenCalled();
  });

  it("ws-win-open：桌面 → NavigatePlazaWindow(url, true)（ADR-050 预热窗口直连）", async () => {
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    b.setCurrentSite(site);
    bindSiteEvents(b.host);
    b.btn("ws-win-open").click();
    await flush();
    expect(app.NavigatePlazaWindow).toHaveBeenCalledWith(site.url, true);
    expect(app.OpenInBrowser).not.toHaveBeenCalled();
  });

  it("ws-win-open：web 平台 → 回退 OpenInBrowser", async () => {
    isWebPlatform.mockReturnValue(true);
    const app = makeApp();
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    b.setCurrentSite(site);
    bindSiteEvents(b.host);
    b.btn("ws-win-open").click();
    await flush();
    expect(app.OpenInBrowser).toHaveBeenCalledWith(site.url);
    expect(app.NavigatePlazaWindow).not.toHaveBeenCalled();
  });
});

describe("bindSiteEvents — 站点导出/导入（web 降级 + 桥 + toast 分支）", () => {
  function makeBindHost() {
    const el = document.createElement("div");
    (el as unknown as { getElementById: (id: string) => Element | null }).getElementById =
      (id: string) => el.querySelector(`#${id}`);
    el.innerHTML = `
      <button id="ws-export-btn"></button>
      <button id="ws-import-btn"></button>
    `;
    const host = { _root: el, _currentSite: null } as unknown as AppContentHost;
    return { host, el, btn: (id: string) => el.querySelector(`#${id}`) as HTMLElement };
  }

  it("web 平台导出 → warn toast 早退，不碰桥", async () => {
    isWebPlatform.mockReturnValue(true);
    const b = makeBindHost();
    bindSiteEvents(b.host);
    b.btn("ws-export-btn").click();
    await flush();
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "workshop.exportWebUnsupported",
      duration: TOAST_MS.normal,
      type: "warn",
    });
    expect(getApp).not.toHaveBeenCalled();
  });

  it("桌面导出成功 → success toast 带导出路径", async () => {
    const app = makeApp();
    (app as Record<string, unknown>).ExportWorkshopSitesJSONFile = vi.fn(
      () => Promise.resolve("/x/sites.json"),
    );
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    bindSiteEvents(b.host);
    b.btn("ws-export-btn").click();
    await flush();
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "workshop.exported",
      duration: TOAST_MS.success,
      type: "success",
    });
  });

  it("桌面导出失败 → error toast（friendlyError 兜底 + verbose 时长）", async () => {
    const app = makeApp();
    (app as Record<string, unknown>).ExportWorkshopSitesJSONFile = vi.fn(() =>
      Promise.reject(new Error("disk boom")),
    );
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    bindSiteEvents(b.host);
    b.btn("ws-export-btn").click();
    await flush();
    expect(friendlyError).toHaveBeenCalledWith(expect.any(Error), "workshop.exportFailed");
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "❌ disk boom|workshop.exportFailed",
      duration: TOAST_MS.verbose,
      type: "error",
    });
  });

  it("web 平台导入 → warn toast 早退，不碰桥", async () => {
    isWebPlatform.mockReturnValue(true);
    const b = makeBindHost();
    bindSiteEvents(b.host);
    b.btn("ws-import-btn").click();
    await flush();
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "workshop.importWebUnsupported",
      duration: TOAST_MS.normal,
      type: "warn",
    });
    expect(getApp).not.toHaveBeenCalled();
  });

  it("桌面导入成功 → success toast 带站点数", async () => {
    const app = makeApp();
    (app as Record<string, unknown>).ValidateWorkshopSites = vi.fn(() => Promise.resolve(3));
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    bindSiteEvents(b.host);
    b.btn("ws-import-btn").click();
    await flush();
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "workshop.imported",
      duration: TOAST_MS.success,
      type: "success",
    });
  });

  it("桌面导入失败 → error toast（friendlyError + content.importFailed 兜底）", async () => {
    const app = makeApp();
    (app as Record<string, unknown>).ValidateWorkshopSites = vi.fn(() =>
      Promise.reject(new Error("parse boom")),
    );
    (getApp as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(app);
    const b = makeBindHost();
    bindSiteEvents(b.host);
    b.btn("ws-import-btn").click();
    await flush();
    expect(busEmit).toHaveBeenCalledWith("toast:show", {
      msg: "❌ parse boom|content.importFailed",
      duration: TOAST_MS.verbose,
      type: "error",
    });
  });
});