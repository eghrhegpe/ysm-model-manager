// ===== 创意工坊站点打开器 =====

import { getApp } from "@/backend/app.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { swallowError } from "@/utils/base/async.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import type { BrowseMode } from "@/views/app-content/site/workshop-browse-mode.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import type { AppContentHost } from "./host.ts";

// 扩展 HTMLIFrameElement 以携带加载超时 AbortController（实例级，非模块级）
declare global {
  interface HTMLIFrameElement {
    _wsLoadAbort?: AbortController;
  }
}

/** 内嵌浏览加载超时（15s 未完成加载 → 提示此站点不允许内嵌浏览） */
const WS_EMBED_TIMEOUT_MS = 15000;

/**
 * 打开站点（外链/内嵌/窗口）
 */
export function openSite(
  host: AppContentHost,
  site: WorkshopSite,
  browseMode: BrowseMode,
  targetUrl = "",
): void {
  if (!site) return;
  // targetUrl 传入时优先打开目标（搜索带词链接）；缺省回退站点首页
  const url = targetUrl || site.url;
  if (browseMode === "embed") {
    openEmbedded(host, site, url);
  } else if (browseMode === "window") {
    // 窗口模式直连（独立 WebView2 窗口，非 iframe，无需反代绕 X-Frame-Options）
    // 网页版没有预热窗口，回退系统浏览器打开，避免 NavigatePlazaWindow fail-fast 静默无反应
    if (isWebPlatform()) {
      swallowError(getApp().then(({ OpenInBrowser }) => OpenInBrowser(url)));
    } else {
      swallowError(getApp().then(({ NavigatePlazaWindow }) => NavigatePlazaWindow(url, true)));
    }
  } else {
    swallowError(getApp().then(({ OpenInBrowser }) => OpenInBrowser(url)));
  }
}

/**
 * 内嵌浏览：直连官网（仅 openSite 的 embed 分支调用，模块私有）
 * 用 AbortController 替代模块级 timer：每次打开新页面时 abort 上一轮，确保只有
 * 当前页面的 load 完成 / 超时触发；返回按钮同样 abort，彻底消除 timer 残留。
 */
function openEmbedded(host: AppContentHost, _site: WorkshopSite, url: string): void {
  const root = host.state.root;
  const browserEl = root.getElementById("ws-browser") as HTMLElement | null;
  const iframe = root.getElementById("ws-iframe") as HTMLIFrameElement | null;
  const urlEl = root.getElementById("ws-url") as HTMLElement | null;
  const blockedEl = root.getElementById("ws-blocked") as HTMLElement | null;

  // abort 上一轮 timer（如有）：防止快速连续打开时旧 timer 残留触发 blocked 弹层
  if (iframe?._wsLoadAbort) iframe._wsLoadAbort.abort();

  if (urlEl) urlEl.textContent = url;
  if (blockedEl) blockedEl.style.display = "none";
  if (browserEl) browserEl.style.display = "flex";
  if (iframe) {
    iframe.style.display = "";
    const ab = new AbortController();
    iframe._wsLoadAbort = ab;
    iframe.src = url;
    const timer = window.setTimeout(() => {
      if (!ab.signal.aborted && blockedEl) blockedEl.style.display = "flex";
    }, WS_EMBED_TIMEOUT_MS);
    iframe.onload = () => {
      ab.abort();
      clearTimeout(timer);
    };
    ab.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  }
}

/**
 * 绑定站点打开相关事件
 */
export function bindSiteEvents(host: AppContentHost): void {
  const root = host.state.root;

  // 返回按钮：abort 当前加载 timer + 隐藏浏览器面板
  root.getElementById("ws-back")?.addEventListener("click", () => {
    const iframe = root.getElementById("ws-iframe") as HTMLIFrameElement | null;
    if (iframe?._wsLoadAbort) iframe._wsLoadAbort.abort();
    if (iframe) iframe.src = "";
    const browserEl = root.getElementById("ws-browser") as HTMLElement | null;
    if (browserEl) browserEl.style.display = "none";
  });

  // 打开当前站点
  const openCurrent = (): void => {
    const cs = host.state.currentSite;
    if (cs) {
      swallowError(getApp().then(({ OpenInBrowser }) => OpenInBrowser(cs.url)));
    }
  };
  root.getElementById("ws-open")?.addEventListener("click", openCurrent);
  root.getElementById("ws-open-fallback")?.addEventListener("click", openCurrent);

  // 🖥️ 窗口模式：在预热 WebView2 窗口中直连打开（ADR-050）
  root.getElementById("ws-win-open")?.addEventListener("click", () => {
    const cs = host.state.currentSite;
    if (cs) {
      // 网页版无 WebView2 预热窗口，回退系统浏览器打开
      if (isWebPlatform()) {
        swallowError(getApp().then(({ OpenInBrowser }) => OpenInBrowser(cs.url)));
      } else {
        swallowError(getApp().then(({ NavigatePlazaWindow }) => NavigatePlazaWindow(cs.url, true)));
      }
    }
  });

  // 站点导出/导入
  root.getElementById("ws-export-btn")?.addEventListener("click", async () => {
    // 网页版（ADR-049）：无本地文件系统，站点配置导出/导入不可用
    if (isWebPlatform()) {
      bus.emit("toast:show", {
        msg: t("workshop.exportWebUnsupported"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    try {
      const { ExportWorkshopSitesJSONFile } = await getApp();
      const path = await ExportWorkshopSitesJSONFile();
      bus.emit("toast:show", {
        msg: t("workshop.action.exported", { path }),
        duration: TOAST_MS.success,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e, t("workshop.exportFailed"))}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    }
  });
  root.getElementById("ws-import-btn")?.addEventListener("click", async () => {
    // 网页版（ADR-049）：无本地文件系统，站点配置导出/导入不可用
    if (isWebPlatform()) {
      bus.emit("toast:show", {
        msg: t("workshop.importWebUnsupported"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    try {
      const { ValidateWorkshopSites } = await getApp();
      const n = await ValidateWorkshopSites();
      // TODO: 重新加载创作者列表
      bus.emit("toast:show", {
        msg: t("workshop.action.imported", { n }),
        duration: TOAST_MS.success,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e, t("content.importFailed"))}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    }
  });
}
