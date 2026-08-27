// ===== 创意工坊站点打开器 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { getApp } from "../../backend/app.ts";
import { swallowError } from "../../utils/core/async.ts";
import { resolveWebMode } from "../../backend/platform.ts";
import { safeSet } from "../../utils/dom/storage.ts";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import type { BrowseMode } from "./workshop-browse-mode.ts";
import type { AppContentHost } from "./init-workshop.ts";

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
    swallowError(getApp().then(({ NavigatePlazaWindow }) =>
      NavigatePlazaWindow(url, true),
    ));
  } else {
    swallowError(getApp().then(({ OpenInBrowser }) =>
      OpenInBrowser(url),
    ));
  }
}

/**
 * 内嵌浏览：直连官网（仅 openSite 的 embed 分支调用，模块私有）
 */
function openEmbedded(
  host: AppContentHost,
  site: WorkshopSite,
  url: string,
): void {
  const root = host._root;
  const browserEl = root.getElementById("ws-browser") as HTMLElement | null;
  const iframe = root.getElementById("ws-iframe") as HTMLIFrameElement | null;
  const urlEl = root.getElementById("ws-url") as HTMLElement | null;
  const blockedEl = root.getElementById("ws-blocked") as HTMLElement | null;

  if (urlEl) urlEl.textContent = url;
  if (blockedEl) blockedEl.style.display = "none";
  if (browserEl) browserEl.style.display = "flex";
  if (iframe) {
    iframe.style.display = "";
    iframe.src = url;
    // 加载超时兜底：15s 未完成加载 → 提示「此站点不允许内嵌浏览」+ 外链打开
    const wsLoadTimer = window.setTimeout(() => {
      if (blockedEl) blockedEl.style.display = "flex";
    }, WS_EMBED_TIMEOUT_MS);
    iframe.onload = () => window.clearTimeout(wsLoadTimer);
  }
}

/**
 * 绑定站点打开相关事件
 */
export function bindSiteEvents(
  host: AppContentHost,
): void {
  const root = host._root;

  // 返回按钮
  root.getElementById("ws-back")?.addEventListener("click", () => {
    const iframe = root.getElementById("ws-iframe") as HTMLIFrameElement | null;
    if (iframe) iframe.src = "";
    const browserEl = root.getElementById("ws-browser") as HTMLElement | null;
    if (browserEl) browserEl.style.display = "none";
    window.clearTimeout(wsLoadTimer);
  });

  // 打开当前站点
  const openCurrent = (): void => {
    const cs = host._currentSite;
    if (cs) {
      swallowError(getApp().then(({ OpenInBrowser }) =>
        OpenInBrowser(cs.url),
      ));
    }
  };
  root.getElementById("ws-open")?.addEventListener("click", openCurrent);
  root
    .getElementById("ws-open-fallback")
    ?.addEventListener("click", openCurrent);

  // 🖥️ 窗口模式：在预热 WebView2 窗口中直连打开（ADR-050）
  root.getElementById("ws-win-open")?.addEventListener("click", () => {
    const cs = host._currentSite;
    if (cs) {
      swallowError(getApp().then(({ NavigatePlazaWindow }) =>
        NavigatePlazaWindow(cs.url, true),
      ));
    }
  });

  // 站点导出/导入
  root
    .getElementById("ws-export-btn")
    ?.addEventListener("click", async () => {
      // 网页版（ADR-049）：无本地文件系统，站点配置导出/导入不可用
      if (resolveWebMode()) {
        bus.emit("toast:show", {
          msg: "网页版暂不支持导出站点配置，请使用桌面版",
          duration: TOAST_MS.normal,
          type: "warn",
        });
        return;
      }
      try {
        const { ExportWorkshopSitesJSONFile } = await getApp();
        const path = await ExportWorkshopSitesJSONFile();
        bus.emit("toast:show", {
          msg: "📤 站点已导出: " + path,
          duration: TOAST_MS.success,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "导出失败"),
          duration: TOAST_MS.verbose,
          type: "error",
        });
      }
    });
  root
    .getElementById("ws-import-btn")
    ?.addEventListener("click", async () => {
      // 网页版（ADR-049）：无本地文件系统，站点配置导出/导入不可用
      if (resolveWebMode()) {
        bus.emit("toast:show", {
          msg: "网页版暂不支持导入站点配置，请使用桌面版",
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
          msg: "✅ 已导入 " + n + " 个站点",
          duration: TOAST_MS.success,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, t("content.importFailed")),
          duration: TOAST_MS.verbose,
          type: "error",
        });
      }
    });
}

// 模块级变量（用于闭包捕获）
let wsLoadTimer: number | undefined;
