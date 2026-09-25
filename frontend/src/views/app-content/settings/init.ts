// ===== 设置页初始化（initSettingsPage 的编排壳，经 _render → PAGE_REGISTRY 调用）=====
// ADR-040 按职责切文件：1063 行巨型 initSettings 拆分——路径卡片/高级面板/检测 → path-cards.ts，
// 主题 → theme.ts，3D 键位 → keymap.ts，UI 偏好 → ui-prefs.ts，共享状态 → store.ts。
// 本文件保留为编排壳：加载 cfg/registry → 调用各模块初始化 → 组装其余事件绑定骨架。

import { getFsaAuthState, rescanFsaRoot, selectLocalRepo } from "@/backend/browser-adapter.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import type { LangCode } from "@/core/i18n/locale.ts";
import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { initVersionUpdater } from "@/features/maintenance/version-updater.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { resourceTypesById } from "@/utils/resource/schema.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { initDefaultPagePrefs } from "./default-page.ts";
import { initKeymap } from "./keymap.ts";
import { bindPathClick, initAdvancedGrid, initMcDetect, saveCfg } from "./path-cards.ts";
import {
  LINK_MODE_DEFAULT,
  LINK_MODES,
  type LinkMode,
  MIRROR_SOURCES,
  type MirrorSource,
  UPDATE_CHECK_DEFAULT,
} from "./settings-schema.ts";
import type { SettingsCfg } from "./store.ts";
import { getCfg, isBusy, resetSettingsStore, setBusy, toastError } from "./store.ts";
import { initThemeSection } from "./theme.ts";
// 链接模式用户可见名（下拉 option 与确认框/toast 共用单表，见 tpl-settings.ts|LINK_MODE_UI）。
// 模板模块只导出纯数据表，无副作用（本 import 不触发渲染）。
import { LINK_MODE_UI } from "./tpl-settings.ts";
import { initUiPrefs } from "./ui-prefs.ts";
import { initWorkerPrefs } from "./worker-prefs.ts";

// 高级面板折叠动画时长（ms）——与 CSS 过渡时长一致（魔法数值收敛）
const ADV_COLLAPSE_MS = 200;

// 镜像源 / 链接模式提示条 key（与 <*-hint-<key>> 显隐、i18n 名映射一致）。
// 枚举单一来源 = settings-schema.ts：MIRROR_SOURCES / LINK_MODES（ADR-307 D3 收债，
// 本地 MIRROR_KEYS + LINK_MODE_KEYS 副本已删——加成员漏 hint 显隐即编译期红）。

// 镜像名 → i18n 键（替代三元链）。键收紧为 MirrorSource 联合——加镜像源漏文案键即编译期红，
// 不再靠运行时 ?? 兜底掩盖漏键（ADR-307 D3 收口 B3 真瓶颈）。
const MIRROR_I18N_KEY: Record<MirrorSource, LocaleKey> = {
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
  applyHintVisibility(root, "mirror-hint", activeKey, MIRROR_SOURCES);
}

/** 镜像名 i18n 文案。select.value 可能是 ""（UI 层 direct 的空值约定，settings-schema.ts 注释），
 *  归一为 "direct" 再索引联合映射；值域外的裸值靠 select 选项约束，不再 ?? 兜底掩盖漏键 */
function mirrorName(raw: string): string {
  const key: MirrorSource = raw === "" ? "direct" : (raw as MirrorSource);
  return t(MIRROR_I18N_KEY[key]);
}

/** 下拉值 → LinkMode 归一（值域外的脏值回落 schema 默认）。
 *  选项由 settings-schema|LINK_MODES 派生，正常必命中；归一保住两件事：
 *  ① 文案表索引不做裸 `as` 强转（脏值不会取出 undefined 文案）；
 *  ② 存量脏 linkMode 下 applyHintVisibility 不再把所有 hint 全隐藏（回落默认档可见）。 */
function normalizeLinkMode(raw: string): LinkMode {
  return (LINK_MODES as readonly string[]).includes(raw) ? (raw as LinkMode) : LINK_MODE_DEFAULT;
}

/** 链接模式用户可见名（下拉 option / 确认框 / toast 同一文案表，杜绝裸枚举进用户视野） */
function linkModeName(raw: string): string {
  return t(LINK_MODE_UI[normalizeLinkMode(raw)].labelKey);
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
    // 缺省回退默认值引 schema 单一来源（ADR-307 D3 扩编）——原裸 21600000 字面量与模板
    // option 首项 + version-updater 6h 兜底三处各写一份，改默认漏此处即回退值漂移。
    updateCheckSelect.value = String(
      cfgLocal.updateCheckIntervalMs == null
        ? UPDATE_CHECK_DEFAULT
        : cfgLocal.updateCheckIntervalMs,
    );
    updateCheckSelect.addEventListener("change", async () => {
      try {
        const { SaveThresholds } = await backendGetApp();
        await SaveThresholds(Number(updateCheckSelect.value), cfgLocal.logMaxEntries || 500);
        cfgLocal.updateCheckIntervalMs = Number(updateCheckSelect.value);
        bus.emit("toast:show", {
          // ADR-267：状态图标由 type 驱动，msg 不带 ✅ 前缀
          msg: t("settings.updateCheck.saved"),
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
      // ADR-267：状态图标由 type 驱动，msg 不带 ⚠️ 前缀
      msg: failed > 0 ? t("settings.relinkFailed", { failed }) : t("settings.relinkNone"),
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
      // ADR-267：状态图标由 type 驱动，msg 不带 ❌ 前缀
      msg: friendlyError(e),
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
  // 缺省回退默认值引 schema 单一来源（ADR-307 D3 扩编）：原 "copy" 字面量散在 init +
  // path-cards 各写一份，改默认漏一处即回退值漂移。归一后脏值回落默认档（hint 不再全隐）。
  const linkMode = normalizeLinkMode(cfgLocal.linkMode || LINK_MODE_DEFAULT);
  applyHintVisibility(root, "lm-hint", linkMode, LINK_MODES);

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
        applyHintVisibility(root, "lm-hint", curVal, LINK_MODES);
        return;
      }
      setBusyLocal(true);
      const oldVal = curVal;
      // 归一为 LinkMode（下拉选项由 schema 派生，正常必命中）：下游「写 cfg / 进文案表」
      // 共用同一收窄值，不再各自 string 化（cfgLocal.linkMode 也从此不会吃到域外裸值）
      const val = normalizeLinkMode(linkSelect.value);
      applyHintVisibility(root, "lm-hint", val, LINK_MODES);
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
          // 用户可见模式名过文案表（原塞裸枚举 → 中文界面出现「重新链接为 symlink 模式」）
          message: t("settings.linkModeConfirmMessage", { val: linkModeName(val), n }),
          danger: true,
        });
        if (!confirmed) {
          // 取消：回退 select 与 hint，不发任何 RPC、不弹模式切换 toast（静默，
          // 比 instance-ops 样板少一条 cancelled toast 噪音）
          linkSelect.value = oldVal;
          applyHintVisibility(root, "lm-hint", oldVal, LINK_MODES);
          return;
        }
        const { SetLinkMode } = await backendGetApp();
        // 配置落盘走 saveCfg 唯一出口（patch 语义：未传字段取**重读**的最新 Go 配置，
        // theme/themeAuto 由该函数自 localStorage 兜底）——原手抄六位置实参吃的是 cfgLocal
        // 快照，正是 saveCfg 注释里 P1 修过的「旧值覆盖」形态；链接模式同步进内存 cfg 亦由它完成
        await saveCfg({ linkMode: val });
        await SetLinkMode(val);
        curVal = val;
        bus.emit("toast:show", {
          msg: t("settings.linkModeSwitched", { val: linkModeName(val) }),
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
        await setLang(langSelect.value as LangCode);
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
      // 2026-09 收债：此处要的是「重扫后刷新树」，不是类型切换——改发 tree:reload
      //（app-tree reload 链含 ClearScanCache）。原借 repo:rtype-changed 同值重放，
      // mountTree 改复用实例后被 oldVal===newVal 拦下，刷新语义即失效。
      bus.emit("tree:reload");
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
    // 2026-09 收债：同上——刷新树走 tree:reload，不再借同值 rtype-changed
    bus.emit("tree:reload");
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
  // ADR-296 起 SetLinkMode 由 stgBindLinkMode 自持解构，此处只取 LoadAppConfig；
  // 配置落盘统一走 path-cards.ts|saveCfg（全页唯一 SaveAppConfig 实参点）
  const { LoadAppConfig } = await backendGetApp();
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
