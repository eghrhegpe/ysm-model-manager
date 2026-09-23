// ===== 设置页初始化（initSettingsPage 的编排壳，经 _render → PAGE_REGISTRY 调用）=====
// ADR-040 按职责切文件：1063 行巨型 initSettings 拆分——路径卡片/高级面板/检测 → path-cards.ts，
// 主题 → theme.ts，3D 键位 → keymap.ts，UI 偏好 → ui-prefs.ts，共享状态 → store.ts。
// 本文件保留为编排壳：加载 cfg/registry → 调用各模块初始化 → 组装其余事件绑定骨架。

import { getFsaAuthState, rescanFsaRoot, selectLocalRepo } from "@/backend/browser-adapter.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { initVersionUpdater } from "@/features/maintenance/version-updater.ts";
import { THEME_DARK } from "@/theme-core";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { resourceTypesById } from "@/utils/resource/schema.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { initDefaultPagePrefs } from "./default-page.ts";
import { initKeymap } from "./keymap.ts";
import { bindPathClick, initAdvancedGrid, initMcDetect, saveCfg } from "./path-cards.ts";
import type { SettingsCfg } from "./store.ts";
import { getCfg, isBusy, resetSettingsStore, setBusy, toastError } from "./store.ts";
import { initThemeSection } from "./theme.ts";
import { initUiPrefs } from "./ui-prefs.ts";
import { initWorkerPrefs } from "./worker-prefs.ts";

// 高级面板折叠动画时长（ms）——与 CSS 过渡时长一致（魔法数值收敛）
const ADV_COLLAPSE_MS = 200;

// 镜像源 / 链接模式提示条 key（与 <*-hint-<key>> 显隐、i18n 名映射一致）
const MIRROR_KEYS = ["direct", "jsdelivr", "githubapi"] as const;
const LINK_MODE_KEYS = ["copy", "hardlink", "symlink"] as const;

// 镜像名 → i18n 键（替代三元链）
const MIRROR_I18N_KEY: Record<string, LocaleKey> = {
  jsdelivr: "settings.mirror.nameJsdelivr",
  githubapi: "settings.mirror.nameGithubapi",
  direct: "settings.mirror.nameDirect",
};

/** 切换一组提示条显隐：仅 activeKey 对应的 <prefix>-<key> 元素显示，其余隐藏 */
function applyHintVisibility(
  root: ShadowRoot,
  prefix: string,
  activeKey: string,
  keys: readonly string[],
): void {
  for (const k of keys) {
    const el = root.getElementById(`${prefix}-${k}`);
    if (el) el.style.display = k === activeKey ? "block" : "none";
  }
}

/** 镜像提示显隐封装 */
function applyMirrorHints(root: ShadowRoot, activeKey: string): void {
  applyHintVisibility(root, "mirror-hint", activeKey, MIRROR_KEYS);
}

/** 镜像名 i18n 文案（默认 direct） */
function mirrorName(val: string): string {
  return t(MIRROR_I18N_KEY[val] ?? "settings.mirror.nameDirect");
}

/** 镜像源切换：写回 Go 端 + success toast；失败走 toastErrorLocal；并切换提示显隐 */
async function onMirrorChange(
  root: ShadowRoot,
  mirrorSelect: HTMLSelectElement,
  toastErrorLocal: typeof toastError,
): Promise<void> {
  const val = mirrorSelect.value;
  try {
    const { SetDownloadMirror } = await backendGetApp();
    await SetDownloadMirror(val);
    bus.emit("toast:show", {
      msg: t("settings.mirror.switched", { name: mirrorName(val) }),
      duration: TOAST_MS.success,
      type: "success",
    });
  } catch (e) {
    toastErrorLocal(e);
  }
  applyMirrorHints(root, val || "direct");
}

function stgBindMirrorSelect(
  root: ShadowRoot,
  cfgLocal: SettingsCfg,
  toastErrorLocal: typeof toastError,
): void {
  const savedMirror = cfgLocal.mirror || "";
  const mirrorSelect = root.getElementById("set-mirror") as HTMLSelectElement | null;
  if (!mirrorSelect) return;
  mirrorSelect.value = savedMirror;
  applyMirrorHints(root, savedMirror || "direct");
  mirrorSelect.addEventListener("change", async () => {
    await onMirrorChange(root, mirrorSelect, toastErrorLocal);
  });
}

function stgBindUpdateInterval(
  root: ShadowRoot,
  cfgLocal: SettingsCfg,
  toastErrorLocal: typeof toastError,
): void {
  const updateCheckSelect = root.getElementById("set-update-check") as HTMLSelectElement | null;
  if (updateCheckSelect) {
    updateCheckSelect.value = String(
      cfgLocal.updateCheckIntervalMs == null ? 21600000 : cfgLocal.updateCheckIntervalMs,
    );
    updateCheckSelect.addEventListener("change", async () => {
      try {
        const { SaveThresholds } = await backendGetApp();
        await SaveThresholds(Number(updateCheckSelect.value), cfgLocal.logMaxEntries || 500);
        cfgLocal.updateCheckIntervalMs = Number(updateCheckSelect.value);
        bus.emit("toast:show", {
          msg: `✅ ${t("settings.updateCheck.saved")}`,
          duration: TOAST_MS.success,
          type: "success",
        });
      } catch (e) {
        toastErrorLocal(e);
      }
    });
  }
}

/** 整合包（relink 扫描只需 Name / Exists 两字段） */
interface RelinkInstance {
  Name: string;
  Exists: boolean;
}

/** 单整合包重链接；成功返回其资源数，失败 logWarn 第三参直传 error 并返回 {count:0,failed:1} */
async function relinkOneInstance(
  ins: RelinkInstance,
  relink: (name: string) => Promise<number>,
): Promise<{ count: number; failed: number }> {
  try {
    return { count: await relink(ins.Name), failed: 0 };
  } catch (e) {
    // code_review 3413288be 段 B #2（P3）：第三参直传 error（同文件 L217/237
    // 约定形状）——原 { name, err } 对象包装绕过 log 层错误格式化/栈保留，
    // name 并入 message
    logWarn("community", `重新链接失败: ${ins.Name}`, e);
    return { count: 0, failed: 1 };
  }
}

/** 按 total/failed 汇总 relink 结果 toast（成功 / 部分失败 / 空列表） */
function emitRelinkToast(total: number, failed: number): void {
  if (total === 0) {
    bus.emit("toast:show", {
      msg: failed > 0 ? `⚠️ ${t("settings.relinkFailed", { failed })}` : t("settings.relinkNone"),
      duration: TOAST_MS.normal,
      type: failed > 0 ? "error" : "info",
    });
    return;
  }
  bus.emit("toast:show", {
    msg:
      failed > 0
        ? t("settings.relinkDonePartial", { total, failed })
        : t("settings.relinkDone", { total }),
    duration: TOAST_MS.normal,
    type: "success",
  });
}

/**
 * 重链接核心（不含 busy 守卫）：LoadAppConfig → 空 mcRoot 提示 → 遍历实例
 * RelinkAllInstanceResources（逐实例增量进度 toast，ADR-296 D5）→ 汇总 toast。
 * 拆出 Inner 而非加 skipBusyGuard 参数（最小改动：公共出口签名不变，锁语义集中一处）——
 * 链接模式 change 回调自持 busy 锁后若调带守卫的 relinkAllInstances 会因已置忙直接 return。
 * relink 单实例的 error 第三参直传约定见 relinkOneInstance。
 */
async function relinkAllInstancesInner(): Promise<void> {
  let failed = 0;
  const { LoadAppConfig, ListVersionInstances, RelinkAllInstanceResources } = await backendGetApp();
  const cfg2 = await LoadAppConfig();
  const mcRoot = cfg2.mcRoot || "";
  if (!mcRoot) {
    bus.emit("toast:show", {
      msg: t("settings.setGameRootFirst"),
      duration: TOAST_MS.info,
      type: "warn",
    });
    return;
  }
  const instances = ((await ListVersionInstances(mcRoot)) || []).filter(
    (ins) => ins.Exists && ins.Name,
  );
  let total = 0;
  const n = instances.length;
  let done = 0;
  for (const ins of instances) {
    const res = await relinkOneInstance(ins, RelinkAllInstanceResources);
    total += res.count;
    failed += res.failed;
    // ADR-296 D5：增量覆盖式进度（末个实例让位给紧随其后的终态汇总 toast，
    // 不闪重复条；单实例时天然跳过中间进度）
    done += 1;
    if (done < n) {
      bus.emit("toast:show", {
        msg: t("settings.relinkProgress", { done, total: n }),
        duration: Math.round(TOAST_MS.info / 1.5),
        type: "info",
      });
    }
  }
  bus.emit("stats:refresh");
  emitRelinkToast(total, failed);
}

/**
 * 重链接所有整合包（公共出口，busy 守卫 + 外层错误 toast）：
 * isBusy → setBusy → relinkAllInstancesInner → finally 释放。供「重新链接」按钮调用。
 */
async function relinkAllInstances(
  isBusyLocal: typeof isBusy,
  setBusyLocal: typeof setBusy,
): Promise<void> {
  if (isBusyLocal()) return;
  setBusyLocal(true);
  try {
    await relinkAllInstancesInner();
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ ${friendlyError(e)}`,
      duration: TOAST_MS.long,
      type: "error",
    });
  } finally {
    setBusyLocal(false);
  }
}

function stgBindLinkMode(
  root: ShadowRoot,
  cfgLocal: SettingsCfg,
  isBusyLocal: typeof isBusy,
  setBusyLocal: typeof setBusy,
  toastErrorLocal: typeof toastError,
): void {
  const linkMode = cfgLocal.linkMode || "copy";
  applyHintVisibility(root, "lm-hint", linkMode, LINK_MODE_KEYS);

  const linkSelect = root.getElementById("set-link-mode") as HTMLSelectElement | null;
  if (linkSelect) {
    linkSelect.value = linkMode;
    // 上一次生效值：change 事件触发时 select 已指向新值，取消回退 / busy 重入判定
    // 均以此为准；仅在保存成功后推进（闭包变量，勿用 cfg 初值快照当旧值）
    let curVal = linkMode;
    linkSelect.addEventListener("change", async () => {
      // ADR-296 D5：change 全程 busy 守卫（与 relink 按钮共锁）；busy 期间忽略并
      // **当场回退** select 与 hint 到上次生效值——吞掉不回滚会让下拉停显示未生效的
      // 新模式（模式实际未变），直到用户下次操作前 UI/真相分叉（审查 E 项）。
      if (isBusyLocal()) {
        linkSelect.value = curVal;
        applyHintVisibility(root, "lm-hint", curVal, LINK_MODE_KEYS);
        return;
      }
      setBusyLocal(true);
      const oldVal = curVal;
      const val = linkSelect.value;
      applyHintVisibility(root, "lm-hint", val, LINK_MODE_KEYS);
      try {
        // 确认前先数实例（与 relinkAllInstancesInner 的 Exists && Name 同口径），
        // 供文案展示工作量；mcRoot 为空跳过计数（n=0，relink 段随后自会提示
        // 「请先设置游戏根目录」）；计数失败不拦确认框，退化为 n=0。
        let n = 0;
        try {
          const { LoadAppConfig, ListVersionInstances } = await backendGetApp();
          const cfg2 = await LoadAppConfig();
          const mcRoot = cfg2.mcRoot || "";
          if (mcRoot) {
            n = ((await ListVersionInstances(mcRoot)) || []).filter(
              (ins) => ins.Exists && ins.Name,
            ).length;
          }
        } catch {
          /* 计数失败静默：n=0 仍可读，用户照样能决策 */
        }
        const confirmed = await modalConfirm({
          title: t("settings.linkModeConfirmTitle"),
          titleIcon: "warning",
          message: t("settings.linkModeConfirmMessage", { val, n }),
          danger: true,
        });
        if (!confirmed) {
          // 取消：回退 select 与 hint，不发任何 RPC、不弹模式切换 toast（静默，
          // 比 instance-ops 样板少一条 cancelled toast 噪音）
          linkSelect.value = oldVal;
          applyHintVisibility(root, "lm-hint", oldVal, LINK_MODE_KEYS);
          return;
        }
        const { SaveAppConfig, SetLinkMode } = await backendGetApp();
        const theme = safeGet("theme") || THEME_DARK;
        await SaveAppConfig(
          cfgLocal.filesRoot || "",
          cfgLocal.resourcepackRoot || "",
          cfgLocal.mcRoot || "",
          val,
          theme,
          safeGet("theme-auto") || "",
        );
        await SetLinkMode(val);
        cfgLocal.linkMode = val;
        curVal = val;
        bus.emit("toast:show", {
          msg: t("settings.linkModeSwitched", { val }),
          duration: TOAST_MS.success,
          type: "success",
        });
        // 本回调已持 busy 锁，调无守卫的 Inner——若走带守卫的 relinkAllInstances
        // 会因判忙直接 return；锁统一由本回调 finally 释放，覆盖整个 relink 段
        await relinkAllInstancesInner();
      } catch (e) {
        toastErrorLocal(e);
      } finally {
        setBusyLocal(false);
      }
    });
  }

  const relinkBtn = root.getElementById("set-relink");
  if (relinkBtn) {
    relinkBtn.addEventListener("click", () => relinkAllInstances(isBusyLocal, setBusyLocal));
  }
}

async function stgBindShowVersion(root: ShadowRoot): Promise<void> {
  try {
    const { CurrentVersion } = await backendGetApp();
    const ver = await CurrentVersion();
    const el = root.getElementById("set-version");
    if (el) el.textContent = ver;
  } catch (e) {
    logWarn("settings", "CurrentVersion 获取失败", e);
    const el = root.getElementById("set-version");
    if (el) el.textContent = "—";
  }
}

async function stgBindLangSwitch(
  root: ShadowRoot,
  toastErrorLocal: typeof toastError,
): Promise<void> {
  const langSelect = root.getElementById("set-lang") as HTMLSelectElement | null;
  if (langSelect) {
    const { getLang, setLang } = await import("@/core/i18n/locale.ts");
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

/** FSA 授权态自愈：读 getFsaAuthState → granted 自动重扫 / revoked 提示；失败静默 */
async function applyFsaState(
  statusEl: Element | null,
  getFsaAuthStateFn: typeof getFsaAuthState,
  rescanFsaRootFn: typeof rescanFsaRoot,
): Promise<void> {
  try {
    const state = await getFsaAuthStateFn();
    if (state === "revoked") {
      if (statusEl) statusEl.textContent = t("settings.webRepo.revoked");
    } else if (state === "granted") {
      const r = await rescanFsaRootFn();
      if (statusEl) {
        statusEl.textContent = t("settings.webRepo.restored").replace(
          "{imported}",
          String(r.imported),
        );
      }
      bus.emit("repo:rtype-changed", RESOURCE_TYPES.YSM);
    }
  } catch {
    // 自愈失败静默
  }
}

/** 网页版点击授权：能力检测 → 禁用按钮 → selectLocalRepo → 文案 → bus → finally 恢复 */
async function onWebRepoAuthClick(
  btn: HTMLButtonElement,
  statusEl: Element | null,
  selectLocalRepoFn: typeof selectLocalRepo,
): Promise<void> {
  if (typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker !== "function") {
    if (statusEl) statusEl.textContent = t("settings.webRepo.unsupported");
    return;
  }
  btn.disabled = true;
  if (statusEl) statusEl.textContent = t("settings.webRepo.scanning");
  try {
    const r = await selectLocalRepoFn();
    if (statusEl) {
      statusEl.textContent = t("settings.webRepo.done")
        .replace("{dir}", r.dir)
        .replace("{imported}", String(r.imported))
        .replace("{failed}", String(r.failed));
    }
    bus.emit("repo:rtype-changed", RESOURCE_TYPES.YSM);
  } catch (e) {
    if (statusEl) statusEl.textContent = friendlyError(e);
  } finally {
    btn.disabled = false;
  }
}

function stgBindWebFsa(root: ShadowRoot, isWebPlatformFn: typeof isWebPlatform): void {
  const webRepoBtn = root.getElementById("web-repo-auth-btn") as HTMLButtonElement | null;
  const webRepoStatus = root.getElementById("web-repo-auth-status");
  if (webRepoBtn && isWebPlatformFn()) {
    void applyFsaState(webRepoStatus, getFsaAuthState, rescanFsaRoot);
    webRepoBtn.addEventListener("click", () => {
      void onWebRepoAuthClick(webRepoBtn, webRepoStatus, selectLocalRepo);
    });
  }
}

/**
 * 初始化设置页所有事件绑定
 * @param root - 组件 shadow root
 */
export async function initSettings(root: ShadowRoot): Promise<void> {
  const { LoadAppConfig, SaveAppConfig, SetLinkMode } = await backendGetApp();
  void SaveAppConfig;
  void SetLinkMode;
  const cfgLoaded = await LoadAppConfig();
  resetSettingsStore(cfgLoaded);

  // ADR-269 D3④：资源类型注册表同步读 resource_types.json 派生视图，废 Go RPC 旁路
  const reg = resourceTypesById;
  const refreshAdvanced = initAdvancedGrid(root, reg);

  bindPathClick(
    root,
    "set-mc-path",
    () => getCfg().mcRoot || "",
    async (dir) => {
      await saveCfg({ mcRoot: dir });
    },
    refreshAdvanced,
  );

  bindPathClick(
    root,
    "set-files-root",
    () => getCfg().filesRoot || "",
    async (dir) => {
      await saveCfg({ filesRoot: dir });
    },
    refreshAdvanced,
  );

  root.getElementById("set-advanced-toggle")?.addEventListener("click", async () => {
    const panel = root.getElementById("set-advanced-panel");
    const btn = root.getElementById("set-advanced-toggle");
    const card = root.getElementById("stg-files-card");
    if (!panel || !btn || !card) return;
    // 图标与折叠箭头走 SVG 语义槽（ADR-238）：locale 只留纯文本，
    // 箭头在「展开态→收起」与「收起态→展开」间切换方向
    const setToggleLabel = (key: "settings.expand" | "settings.collapse"): void => {
      const arrow = key === "settings.expand" ? UI_ICONS.chevronDown : UI_ICONS.chevronUp;
      const html = `${UI_ICONS.folderOpen} ${t(key)} ${arrow}`;
      btn.innerHTML = html;
    };
    const isOpen = panel.classList.contains("adv-open");
    if (isOpen) {
      panel.classList.remove("adv-open");
      panel.classList.add("adv-closing");
      setToggleLabel("settings.expand");
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
      setToggleLabel("settings.collapse");
      card.style.gridColumn = "1 / -1";
    }
  });

  refreshAdvanced();
  initMcDetect(root);
  initThemeSection(root);

  stgBindMirrorSelect(root, getCfg(), toastError);
  stgBindUpdateInterval(root, getCfg(), toastError);
  stgBindLinkMode(root, getCfg(), isBusy, setBusy, toastError);

  void stgBindShowVersion(root);
  initVersionUpdater(root);

  initUiPrefs(root);
  initWorkerPrefs(root);
  initDefaultPagePrefs(root);
  initKeymap(root);

  await stgBindLangSwitch(root, toastError);
  stgBindWebFsa(root, isWebPlatform);
}
