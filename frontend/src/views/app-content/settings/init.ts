// ===== 设置页初始化（为 _initSettings 减负）=====
// ADR-040 按职责切文件：1063 行巨型 initSettings 拆分——路径卡片/高级面板/检测 → path-cards.ts，
// 主题 → theme.ts，3D 键位 → keymap.ts，UI 偏好 → ui-prefs.ts，共享状态 → store.ts。
// 本文件保留为编排壳：加载 cfg/registry → 调用各模块初始化 → 组装其余事件绑定骨架。
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { resolveWebMode } from "../../../backend/platform.ts";
import { loadResourceRegistry } from "../../../utils/resource/registry.ts";
import { safeGet } from "../../../utils/dom/storage.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { isViewerMode } from "../../../utils/dom/android-bridge.ts";
import { t } from "../../../core/i18n/t.ts";
import { selectLocalRepo, getFsaAuthState, rescanFsaRoot } from "../../../backend/browser-adapter.ts";
import { RESOURCE_TYPES } from "../../../utils/resource/types.ts";
import { initVersionUpdater } from "../../../features/version-updater.ts";
import { GH_RELEASES } from "../../../utils/gh-links.ts";
import { bindPathClick, saveCfg, initAdvancedGrid, initMcDetect, initLauncherDetect } from "./path-cards.ts";
import { initTheme } from "./theme.ts";
import { initUiPrefs } from "./ui-prefs.ts";
import { initWorkerPrefs } from "./worker-prefs.ts";
import { initKeymap } from "./keymap.ts";
import { resetSettingsStore, cfg, isBusy, setBusy, toastError } from "./store.ts";

// 高级面板折叠动画时长（ms）——与 CSS 过渡时长一致（魔法数值收敛）
const ADV_COLLAPSE_MS = 200;

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
  const cfgLoaded = await LoadAppConfig();
  resetSettingsStore(cfgLoaded);
  const linkMode = cfg.linkMode || "copy";

  // 从 Go 端 resource_types.json 加载注册表
  const reg = await loadResourceRegistry();

  // 高级设置面板（从注册表构建）→ 返回 refreshAdvanced，供展开/路径变更后刷新
  const refreshAdvanced = initAdvancedGrid(root, reg);

  // 🎮 游戏根目录
  bindPathClick(
    root, "set-mc-path",
    () => cfg.mcRoot || "",
    async (dir) => {
      await saveCfg({ mcRoot: dir });
    },
    refreshAdvanced,
  );

  // 📁 文件存储路径
  bindPathClick(
    root, "set-files-root",
    () => cfg.filesRoot || "",
    async (dir) => {
      await saveCfg({ filesRoot: dir });
    },
    refreshAdvanced,
  );

  // 展开/折叠
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

  // 初始刷新
  refreshAdvanced();

  // 游戏路径 - 自动搜索 + hover 扫描提示
  initMcDetect(root);
  initLauncherDetect(root, refreshAdvanced);

  // 主题段（卡片点击 / 自动切换）
  initTheme(root);

  // 镜像源
  const savedMirror = cfg.mirror || "";
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
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        // P2 修复：getApp/SetDownloadMirror 失败要有出口，避免 unhandled rejection 静默
        toastError(e);
      }
      ["direct", "jsdelivr", "githubapi"].forEach((m) => {
        const el = root.getElementById("mirror-hint-" + m);
        if (el) el.style.display = m === (val || "direct") ? "block" : "none";
      });
    });
  }

  // 版本检查间隔（ADR-062 §2.3：设置页写入 UpdateCheckIntervalMs，0=关闭检查）
  const updateCheckSelect = root.getElementById("set-update-check") as HTMLSelectElement | null;
  if (updateCheckSelect) {
    // 初值取配置：null/undefined=缺省显示 6h；0 保留为「关闭自动检查」（勿用 || 把 0 变回 6h）
    updateCheckSelect.value = String(cfg.updateCheckIntervalMs == null ? 21600000 : cfg.updateCheckIntervalMs);
    updateCheckSelect.addEventListener("change", async () => {
      try {
        const { SaveThresholds } = await getApp();
        await SaveThresholds(Number(updateCheckSelect.value), cfg.logMaxEntries || 500);
        cfg.updateCheckIntervalMs = Number(updateCheckSelect.value);
        bus.emit("toast:show", {
          msg: "✅ " + t("settings.updateCheck.saved"),
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        toastError(e);
      }
    });
  }

  // ===== 以下代码保持原样（链接模式/主题切换/关于等） =====
  // 链接模式提示切换
  const updateLinkHint = (mode: string): void => {
    ["copy", "hardlink", "symlink"].forEach((m) => {
      const el = root.getElementById("lm-hint-" + m);
      if (el) el.style.display = m === mode ? "block" : "none";
    });
  };
  updateLinkHint(linkMode);

  // 链接模式变更（下拉菜单）+ 重新应用按钮
  const doRelink = async (): Promise<void> => {
    if (isBusy()) return; // 防连点：重新链接进行中忽略后续点击（含链接模式切换并发触发）
    setBusy(true);
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
        bus.emit("toast:show", { msg: "请先设置游戏根目录", duration: 2500, type: "warn" });
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
          duration: 3000,
          type: failed > 0 ? "error" : "info",
        });
        return;
      }
      bus.emit("toast:show", {
        msg: failed > 0 ? `🔄 已重新链接 ${total} 个文件（${failed} 个失败）` : `🔄 已重新链接 ${total} 个文件`,
        duration: 3000,
        type: "success",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: 5000,
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const linkSelect = root.getElementById("set-link-mode") as HTMLSelectElement | null;
  if (linkSelect) {
    linkSelect.value = linkMode;
    linkSelect.addEventListener("change", async () => {
      const val = linkSelect.value;
      updateLinkHint(val);
      try {
        const theme = safeGet("theme") || "dark";
        await SaveAppConfig(
          cfg.filesRoot || "",
          cfg.resourcepackRoot || "",
          cfg.mcRoot || "",
          val,
          theme,
        );
        await SetLinkMode(val);
        // P3 修复（审核，linkMode 失同步）：回写内存 cfg——原只存后端不更新 cfg.linkMode，
        // 后续 saveCfg（含主题保存）用旧值把新 linkMode 覆盖回退
        cfg.linkMode = val;
        bus.emit("toast:show", {
          msg: `✅ 链接模式已切换至: ${val}`,
          duration: 2000,
          type: "success",
        });
        // 自动重新链接
        await doRelink();
      } catch (e) {
        // P2 修复：SaveAppConfig/SetLinkMode 失败要有出口，避免 unhandled rejection 静默
        toastError(e);
      }
    });
  }

  const relinkBtn = root.getElementById("set-relink") as HTMLElement | null;
  if (relinkBtn) {
    relinkBtn.addEventListener("click", doRelink);
  }

  // 显示版本号
  const showVersion = async (): Promise<void> => {
    try {
      const { CurrentVersion } =
        await getApp();
      const ver = await CurrentVersion();
      const el = root.getElementById("set-version");
      if (el) el.textContent = ver;
    } catch (e) {
      // P2 修复（审核）：失败置「—」兜底——原空 catch 静默，桌面 binding 失败时
      // #set-version 停在模板默认值「加载中」永不更新（无限加载态）；置「—」让用户
      // 明确知道版本不可用而非永久转圈；warn 留痕便于排障
      console.warn("[settings] CurrentVersion 获取失败:", e);
      const el = root.getElementById("set-version");
      if (el) el.textContent = "—";
    }
  };
  showVersion();

  // 检查更新
  initVersionUpdater(root);

  // 打开发布页
  root.getElementById("set-releases")?.addEventListener("click", () => {
    const url = GH_RELEASES; // P3 修复：集中常量（utils/gh-links.ts），防仓库迁移漂移
    // 网页版（ADR-049）：OpenInBrowser 桌面专属未实现，用 window.open 开新标签
    if (isViewerMode()) {
      window.open(url, "_blank", "noopener");
      return;
    }
    // P3（审核发现）：原无 .catch，getApp/OpenInBrowser 失败成 unhandledrejection
    getApp()
      .then(({ OpenInBrowser }) => OpenInBrowser(url))
      .catch((e) => {
        console.warn("[settings] 打开发布页失败:", e);
        bus.emit("toast:show", {
          msg: "❌ 打开浏览器失败",
          duration: 3000,
          type: "error",
        });
      });
  });

  // ===== 界面与体验设置（字体/密度/动画/默认页 → ui-prefs.ts）=====
  initUiPrefs(root);

  // ===== 3D 解析 worker 开关（FBX / MMD PMX → worker-prefs.ts）=====
  initWorkerPrefs(root);

  // ===== 3D 预览操作（键位/相机速度/旋转模式 → keymap.ts）=====
  initKeymap(root);

  // ── 语言切换（ADR-045）──
  const langSelect = root.getElementById("set-lang") as HTMLSelectElement | null;
  if (langSelect) {
    const { getLang, setLang } = await import("../../../core/i18n/locale.ts");
    langSelect.value = getLang();
    langSelect.addEventListener("change", async () => {
      try {
        await setLang(langSelect.value as "zh-CN" | "en" | "ja");
      } catch (e) {
        // P2 修复：语言包加载失败要有出口，避免 unhandled rejection 静默
        toastError(e);
      }
      // 热切换（ADR-045 增强）：不再整页 reload——setLang 内部 emit lang:changed，
      // app-content 全局订阅后重渲染当前页（t() 读取新语言包），保留应用状态
    });
  }

  // ── 网页版 FSA 授权本地仓库（ADR-049 能力门控缺口补齐；R2 数据互通：句柄持久化 + 启动自愈）──
  const webRepoBtn = root.getElementById("web-repo-auth-btn") as HTMLButtonElement | null;
  const webRepoStatus = root.getElementById("web-repo-auth-status");
  if (webRepoBtn && resolveWebMode()) {
    // R2 启动自愈：恢复持久化 FSA 句柄并重扫（仅 queryPermission，无手势），
    // 免用户每次重新选目录；已撤销则提示用户重新授权
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
        // state === "none" / "unsupported"：留空，由用户点按钮触发授权
      } catch {
        // 自愈失败静默：不打断设置页渲染，用户可手动点按钮授权
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
        // 刷新模型库视图（对齐 import 流程：bus.emit repo:rtype-changed）
        bus.emit("repo:rtype-changed", RESOURCE_TYPES.YSM);
      } catch (e) {
        if (webRepoStatus) webRepoStatus.textContent = friendlyError(e);
      } finally {
        webRepoBtn.disabled = false;
      }
    });
  }
}
