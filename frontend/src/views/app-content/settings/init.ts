// ===== 设置页初始化（为 _initSettings 减负）=====
// ADR-040 按职责切文件：1063 行巨型 initSettings 拆分——路径卡片/高级面板/检测 → path-cards.ts，
// 主题 → theme.ts，3D 键位 → keymap.ts，UI 偏好 → ui-prefs.ts，共享状态 → store.ts。
// 本文件保留为编排壳：加载 cfg/registry → 调用各模块初始化 → 组装其余事件绑定骨架。
import { TOAST_MS } from "../../../utils/dom/toast-ms.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { isWebPlatform } from "../../../backend/platform-web.ts";
import { loadResourceRegistry } from "../../../utils/resource/registry.ts";
import { safeGet } from "../../../utils/dom/storage.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { isViewerMode } from "../../../utils/dom/android-bridge.ts";
import { t } from "../../../core/i18n/t.ts";
import { selectLocalRepo, getFsaAuthState, rescanFsaRoot } from "../../../backend/browser-adapter.ts";
import { RESOURCE_TYPES } from "../../../utils/resource/types.ts";
import { initVersionUpdater } from "../../../features/version-updater.ts";
import { GH_RELEASES } from "../../../utils/gh-links.ts";
import { bindPathClick, saveCfg, initAdvancedGrid, initMcDetect } from "./path-cards.ts";
import { initTheme } from "./theme.ts";
import { initUiPrefs } from "./ui-prefs.ts";
import { initWorkerPrefs } from "./worker-prefs.ts";
import { initKeymap } from "./keymap.ts";
import { resetSettingsStore, cfg, isBusy, setBusy, toastError } from "./store.ts";

// 高级面板折叠动画时长（ms）——与 CSS 过渡时长一致（魔法数值收敛）
const ADV_COLLAPSE_MS = 200;

function stgBindMirrorSelect(
  root: ShadowRoot,
  cfgLocal: typeof cfg,
  toastErrorLocal: typeof toastError,
): void {
  const savedMirror = cfgLocal.mirror || "";
  const mirrorSelect = root.getElementById("set-mirror") as HTMLSelectElement | null;
  if (mirrorSelect) {
    mirrorSelect.value = savedMirror;
    const initMirrorKey = savedMirror || "direct";
    ["direct", "jsdelivr", "githubapi"].forEach((m) => {
      const el = root.getElementById("mirror-hint-" + m);
      if (el) el.style.display = m === initMirrorKey ? "block" : "none";
    });
    mirrorSelect.addEventListener("change", async () => {
      const val = mirrorSelect.value;
      try {
        const { SetDownloadMirror } =
          await getApp();
        await SetDownloadMirror(val);
        bus.emit("toast:show", {
          msg:
            "✅ 下载源已切换为 " +
            (val === "jsdelivr"
              ? "jsDelivr CDN"
              : val === "githubapi"
                ? "GitHub API"
                : "直连"),
          duration: TOAST_MS.success,
          type: "success",
        });
      } catch (e) {
        toastErrorLocal(e);
      }
      ["direct", "jsdelivr", "githubapi"].forEach((m) => {
        const el = root.getElementById("mirror-hint-" + m);
        if (el) el.style.display = m === (val || "direct") ? "block" : "none";
      });
    });
  }
}

function stgBindUpdateInterval(
  root: ShadowRoot,
  cfgLocal: typeof cfg,
  toastErrorLocal: typeof toastError,
): void {
  const updateCheckSelect = root.getElementById("set-update-check") as HTMLSelectElement | null;
  if (updateCheckSelect) {
    updateCheckSelect.value = String(cfgLocal.updateCheckIntervalMs == null ? 21600000 : cfgLocal.updateCheckIntervalMs);
    updateCheckSelect.addEventListener("change", async () => {
      try {
        const { SaveThresholds } = await getApp();
        await SaveThresholds(Number(updateCheckSelect.value), cfgLocal.logMaxEntries || 500);
        cfgLocal.updateCheckIntervalMs = Number(updateCheckSelect.value);
        bus.emit("toast:show", {
          msg: "✅ " + t("settings.updateCheck.saved"),
          duration: TOAST_MS.success,
          type: "success",
        });
      } catch (e) {
        toastErrorLocal(e);
      }
    });
  }
}

function stgBindLinkMode(
  root: ShadowRoot,
  cfgLocal: typeof cfg,
  isBusyLocal: typeof isBusy,
  setBusyLocal: typeof setBusy,
  toastErrorLocal: typeof toastError,
  advCollapseMs: number,
): void {
  void advCollapseMs;
  const linkMode = cfgLocal.linkMode || "copy";

  const updateLinkHint = (mode: string): void => {
    ["copy", "hardlink", "symlink"].forEach((m) => {
      const el = root.getElementById("lm-hint-" + m);
      if (el) el.style.display = m === mode ? "block" : "none";
    });
  };
  updateLinkHint(linkMode);

  const doRelink = async (): Promise<void> => {
    if (isBusyLocal()) return;
    setBusyLocal(true);
    let failed = 0;
    try {
      const {
        LoadAppConfig,
        ListVersionInstances,
        RelinkAllInstanceResources,
      } = await getApp();
      const cfg2 = await LoadAppConfig();
      const mcRoot = cfg2.mcRoot || "";
      if (!mcRoot) {
        bus.emit("toast:show", { msg: "请先设置游戏根目录", duration: TOAST_MS.info, type: "warn" });
        return;
      }
      const instances = (await ListVersionInstances(mcRoot)) || [];
      let total = 0;
      for (const ins of instances) {
        if (!ins.Exists || !ins.Name) continue;
        try {
          total += await RelinkAllInstanceResources(ins.Name);
        } catch (e) {
          failed++;
          console.warn("[community] 重新链接失败:", ins.Name, e);
        }
      }
      bus.emit("stats:refresh");
      if (total === 0) {
        bus.emit("toast:show", {
          msg: failed > 0 ? `⚠️ ${failed} 个整合包重新链接失败` : "没有需要重新链接的文件",
          duration: TOAST_MS.normal,
          type: failed > 0 ? "error" : "info",
        });
        return;
      }
      bus.emit("toast:show", {
        msg: failed > 0 ? `🔄 已重新链接 ${total} 个文件（${failed} 个失败）` : `🔄 已重新链接 ${total} 个文件`,
        duration: TOAST_MS.normal,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: TOAST_MS.long,
        type: "error",
      });
    } finally {
      setBusyLocal(false);
    }
  };

  const linkSelect = root.getElementById("set-link-mode") as HTMLSelectElement | null;
  if (linkSelect) {
    linkSelect.value = linkMode;
    linkSelect.addEventListener("change", async () => {
      const val = linkSelect.value;
      updateLinkHint(val);
      try {
        const { SaveAppConfig, SetLinkMode } = await getApp();
        const theme = safeGet("theme") || "dark";
        await SaveAppConfig(
          cfgLocal.filesRoot || "",
          cfgLocal.resourcepackRoot || "",
          cfgLocal.mcRoot || "",
          val,
          theme,
        );
        await SetLinkMode(val);
        cfgLocal.linkMode = val;
        bus.emit("toast:show", {
          msg: `✅ 链接模式已切换至: ${val}`,
          duration: TOAST_MS.success,
          type: "success",
        });
        await doRelink();
      } catch (e) {
        toastErrorLocal(e);
      }
    });
  }

  const relinkBtn = root.getElementById("set-relink") as HTMLElement | null;
  if (relinkBtn) {
    relinkBtn.addEventListener("click", doRelink);
  }
}

async function stgBindShowVersion(root: ShadowRoot): Promise<void> {
  try {
    const { CurrentVersion } =
      await getApp();
    const ver = await CurrentVersion();
    const el = root.getElementById("set-version");
    if (el) el.textContent = ver;
  } catch (e) {
    console.warn("[settings] CurrentVersion 获取失败:", e);
    const el = root.getElementById("set-version");
    if (el) el.textContent = "—";
  }
}

function stgBindReleasesClick(
  root: ShadowRoot,
  isViewerModeFn: typeof isViewerMode,
  ghReleases: string,
): void {
  root.getElementById("set-releases")?.addEventListener("click", () => {
    const url = ghReleases;
    if (isViewerModeFn()) {
      window.open(url, "_blank", "noopener");
      return;
    }
    getApp()
      .then(({ OpenInBrowser }) => OpenInBrowser(url))
      .catch((e) => {
        console.warn("[settings] 打开发布页失败:", e);
        bus.emit("toast:show", {
          msg: "❌ 打开浏览器失败",
          duration: TOAST_MS.normal,
          type: "error",
        });
      });
  });
}

async function stgBindLangSwitch(
  root: ShadowRoot,
  toastErrorLocal: typeof toastError,
): Promise<void> {
  const langSelect = root.getElementById("set-lang") as HTMLSelectElement | null;
  if (langSelect) {
    const { getLang, setLang } = await import("../../../core/i18n/locale.ts");
    langSelect.value = getLang();
    langSelect.addEventListener("change", async () => {
      try {
        await setLang(langSelect.value as "zh-CN" | "en" | "ja");
      } catch (e) {
        toastErrorLocal(e);
      }
    });
  }
}

function stgBindWebFsa(
  root: ShadowRoot,
  isWebPlatformFn: typeof isWebPlatform,
): void {
  const webRepoBtn = root.getElementById("web-repo-auth-btn") as HTMLButtonElement | null;
  const webRepoStatus = root.getElementById("web-repo-auth-status");
  if (webRepoBtn && isWebPlatformFn()) {
    const applyFsaState = async (): Promise<void> => {
      try {
        const state = await getFsaAuthState();
        if (state === "revoked") {
          if (webRepoStatus) webRepoStatus.textContent = t("settings.webRepo.revoked");
        } else if (state === "granted") {
          const r = await rescanFsaRoot();
          if (webRepoStatus) {
            webRepoStatus.textContent = t("settings.webRepo.restored").replace("{imported}", String(r.imported));
          }
          bus.emit("repo:rtype-changed", RESOURCE_TYPES.YSM);
        }
      } catch {
        // 自愈失败静默
      }
    };
    void applyFsaState();
    webRepoBtn.addEventListener("click", async () => {
      if (typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker !== "function") {
        if (webRepoStatus) webRepoStatus.textContent = t("settings.webRepo.unsupported");
        return;
      }
      webRepoBtn.disabled = true;
      if (webRepoStatus) webRepoStatus.textContent = t("settings.webRepo.scanning");
      try {
        const r = await selectLocalRepo();
        if (webRepoStatus) {
          webRepoStatus.textContent = t("settings.webRepo.done")
            .replace("{dir}", r.dir)
            .replace("{imported}", String(r.imported))
            .replace("{failed}", String(r.failed));
        }
        bus.emit("repo:rtype-changed", RESOURCE_TYPES.YSM);
      } catch (e) {
        if (webRepoStatus) webRepoStatus.textContent = friendlyError(e);
      } finally {
        webRepoBtn.disabled = false;
      }
    });
  }
}

/**
 * 初始化设置页所有事件绑定
 * @param root - 组件 shadow root
 */
export async function initSettings(root: ShadowRoot): Promise<void> {
  const {
    LoadAppConfig,
    SaveAppConfig,
    SetLinkMode,
  } = await getApp();
  void SaveAppConfig;
  void SetLinkMode;
  const cfgLoaded = await LoadAppConfig();
  resetSettingsStore(cfgLoaded);

  const reg = await loadResourceRegistry();
  const refreshAdvanced = initAdvancedGrid(root, reg);

  bindPathClick(
    root, "set-mc-path",
    () => cfg.mcRoot || "",
    async (dir) => {
      await saveCfg({ mcRoot: dir });
    },
    refreshAdvanced,
  );

  bindPathClick(
    root, "set-files-root",
    () => cfg.filesRoot || "",
    async (dir) => {
      await saveCfg({ filesRoot: dir });
    },
    refreshAdvanced,
  );

  root
    .getElementById("set-advanced-toggle")
    ?.addEventListener("click", async () => {
      const panel = root.getElementById("set-advanced-panel") as HTMLElement | null;
      const btn = root.getElementById("set-advanced-toggle") as HTMLElement | null;
      const card = root.getElementById("stg-files-card") as HTMLElement | null;
      if (!panel || !btn || !card) return;
      const isOpen = panel.classList.contains("adv-open");
      if (isOpen) {
        panel.classList.remove("adv-open");
        panel.classList.add("adv-closing");
        btn.textContent = t("settings.expand");
        card.style.gridColumn = "";
        setTimeout(() => {
          panel.classList.remove("adv-closing");
          panel.style.display = "none";
        }, ADV_COLLAPSE_MS);
      } else {
        await refreshAdvanced();
        panel.style.display = "block";
        panel.classList.remove("adv-closing");
        panel.classList.add("adv-open");
        btn.textContent = t("settings.collapse");
        card.style.gridColumn = "1 / -1";
      }
    });

  refreshAdvanced();
  initMcDetect(root);
  initTheme(root);

  stgBindMirrorSelect(root, cfg, toastError);
  stgBindUpdateInterval(root, cfg, toastError);
  stgBindLinkMode(root, cfg, isBusy, setBusy, toastError, ADV_COLLAPSE_MS);

  void stgBindShowVersion(root);
  initVersionUpdater(root);
  stgBindReleasesClick(root, isViewerMode, GH_RELEASES);

  initUiPrefs(root);
  initWorkerPrefs(root);
  initKeymap(root);

  await stgBindLangSwitch(root, toastError);
  stgBindWebFsa(root, isWebPlatform);
}
