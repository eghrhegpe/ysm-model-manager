// ===== 设置页：路径卡片 / 高级面板 / 游戏目录检测（ADR-040 拆分自 init.ts）=====
// 原 initSettings 巨型闭包中的路径相关逻辑整体迁出：共享状态（cfg/cardRefreshers/
// busy/toastError）统一走 store.ts 模块级，root/refreshAdvanced 显式参数传递。

import { pickDirectory } from "@/backend/directory-picker.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalPicker } from "@/utils/dom/modal-picker.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { ResourceType } from "@/utils/resource/schema.ts";
import { groupStorageRootOf } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { writeAppConfig } from "@/views/config-write.ts";
import { cardRefreshers, getCfg, isBusy, setBusy, toastError } from "./store.ts";

/**
 * 目录卡片文案（icon + 路径/未选择文案）。
 *
 * 单列为 `render*` builder：① 结构（folderOpen 图标槽）在渲染层、locale 值纯文本；
 * ② 路径是**外部数据**必须 `esc`；③ R8 模板闸按 `render*` 命名识别可信 HTML 源，
 * 使调用侧保持「单调用赋值」形态（与 app-tree `renderRepoLabel` 同构）。
 */
function renderDirLabel(dir: string): string {
  return dir
    ? `${UI_ICONS.folderOpen} ${esc(dir)}`
    : `${UI_ICONS.folderOpen} ${esc(t("settings.path.selectDir"))}`;
}

// 保存 cfg 辅助——设置域写配置出口（薄包装）。
// P1 修复（审核，配置回退）：保存前重读 Go 端最新配置作为未 patch 字段默认——
// 原用模块级 cfg（initSettings 一次性加载的旧值），用户在其他入口改过字段后
// 二次保存会把新值静默覆盖回退（如先改 mcRoot 再改 rpRoot，mcRoot 被旧值覆盖）。
// 2026-10 锐评第八轮扩编：patch 面从「路径四字段」扩到全字段（+theme/themeAuto）——
// 此前主题段（theme.ts ×2）与链接模式段（init.ts）绕开本函数各手抄一份
// `SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme, themeAuto)` 六位置实参，
// 而 Go 端签名是六个同型 string：位置错了类型系统看不见（历史 P3「闭包旧值覆盖 linkMode」/
// P4「theme-auto 漏落盘」都是这种手抄配方咬出来的）。
// 2026-10 锐评第九轮（ADR-313）：实参点本身也上移 views/config-write.ts，成为
// **跨视图**唯一出口（app-sidebar 两处同款手抄配方曾硬编码 "dark"/"copy" 字面量，
// 其中 "dark" 不在 THEME_VALID 内、落盘后被 normalizeTheme 静默转成 system 的 bug）。
// 本函数降为 settings 域包装：补上「保存成功后同步模块级 cfg 内存快照」这一步。
export async function saveCfg(patch: {
  filesRoot?: string;
  rpRoot?: string;
  mcRoot?: string;
  linkMode?: string;
  /** 缺省取 localStorage 当前值（各写入方均先 safeSet 再 saveCfg，语义与显式传入等价） */
  theme?: string;
  themeAuto?: string;
}): Promise<void> {
  const resolved = await writeAppConfig(patch);
  // 内存快照同步：只回写被 patch 的字段（未 patch 字段保持原值，与 resolved 的重读值
  // 可能不同——调用方不应假定内存与磁盘全等，只有被 patch 的字段是权威的）
  if (patch.filesRoot !== undefined) getCfg().filesRoot = resolved.filesRoot;
  if (patch.rpRoot !== undefined) getCfg().resourcepackRoot = resolved.rpRoot;
  if (patch.mcRoot !== undefined) getCfg().mcRoot = resolved.mcRoot;
  if (patch.linkMode !== undefined) getCfg().linkMode = resolved.linkMode;
}

// 工具：绑定路径卡片点击
export function bindPathClick(
  root: ShadowRoot,
  elId: string,
  getPath: () => string,
  onSelect: (dir: string) => Promise<void>,
  refreshAdvanced: () => Promise<void>,
): void {
  const el = root.getElementById(elId);
  if (!el) return;
  const refresh = (): void => {
    const p = getPath();
    // 结构槽（folderOpen 图标）在渲染层，locale 已是纯文本；路径是外部数据须 esc
    el.innerHTML = renderDirLabel(p);
    el.style.color = p ? "" : "var(--accent)";
  };
  cardRefreshers.push(refresh);
  el.addEventListener("click", async () => {
    if (isBusy()) return; // 防连点：目录选择进行中忽略后续点击
    setBusy(true);
    try {
      // 平台分支：桌面 Wails Dialog / Android 授权检查+路径输入（ADR-046 P2）
      const pickResult = await pickDirectory();
      if (!pickResult.ok) return;
      await onSelect(pickResult.dir);
      refresh();
      refreshAdvanced();
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: t("settings.path.updated"),
        duration: TOAST_MS.success,
        type: "success",
      });
    } catch (e) {
      // P2 修复：pickDirectory/onSelect 失败要有出口，避免 unhandled rejection 静默
      toastError(e);
    } finally {
      setBusy(false);
    }
  });
  refresh();
}

/** 多路径选择器：弹出路径列表让用户挑选（返回 null 表示取消） */
async function showPathPicker(paths: string[]): Promise<string | null> {
  const result = await modalPicker({
    title: t("content.pickMcDirTitle"),
    subtitle: t("content.pickMcDirDesc"),
    titleIcon: "folder",
    items: paths.map((p) => ({ label: p, meta: "" })),
    cancelText: t("common.cancel"),
  });
  return result ? paths[result.index] : null;
}

/** 扫描提示气泡：hover 时显示扫描到的所有路径 + 搜索范围 */
function showScanTooltip(root: ShadowRoot, anchor: HTMLElement, paths: string[]): HTMLElement {
  const rect = anchor.getBoundingClientRect();
  const tip = document.createElement("div");
  // id 保持 mc-scan-tooltip：init.test.ts 经 getElementById 驱动 hover/泄漏回归断言
  tip.id = "mc-scan-tooltip";
  tip.style.position = "fixed";
  tip.style.zIndex = "var(--z-toast)";
  tip.style.background = "var(--surf)";
  tip.style.border = "1px solid var(--bd)";
  tip.style.borderRadius = "8px";
  tip.style.padding = "10px 14px";
  tip.style.fontSize = "var(--fs-sm)";
  tip.style.color = "var(--txt)";
  tip.style.boxShadow = "0 4px 16px rgba(0,0,0,.3)";
  tip.style.maxWidth = "420px";
  tip.style.maxHeight = "350px";
  tip.style.overflowY = "auto";
  tip.style.pointerEvents = "none";
  tip.style.lineHeight = "1.6";
  tip.style.left = `${Math.max(4, rect.left)}px`;
  tip.style.top = `${rect.bottom + 4}px`;

  // 搜索范围
  let html =
    "<div style='font-weight:600;margin-bottom:4px'>" +
    t("content.scanScope") +
    "</div>" +
    "<div style='font-size:var(--fs-xs);color:var(--muted,#888);margin-bottom:8px;padding-left:4px'>" +
    t("content.scanScopeLine1") +
    t("content.scanScopeLine2") +
    "</div>" +
    "<div style='border-top:1px solid var(--bd,#444);margin:6px 0'></div>";

  // 搜索结果
  if (!paths.length) {
    html +=
      "<div style='color:var(--muted,#888);padding:var(--sp-1) 0'>" +
      t("content.noMcDirFound") +
      "</div>" +
      "<div style='font-size:var(--fs-xs);color:var(--muted,#888);padding-top:2px'>" +
      t("content.noMcDirHint") +
      "</div>";
  } else {
    html +=
      "<div style='font-weight:600;margin-bottom:4px'>" +
      t("content.foundCount", { n: paths.length }) +
      "</div>";
    for (let i = 0; i < paths.length; i++) {
      html +=
        "<div style='padding:var(--pad-v-1);display:flex;align-items:center;gap:6px;font-size:var(--fs-xs)'>" +
        "<span style='color:var(--accent);flex-shrink:0'>" +
        UI_ICONS.folder +
        "</span>" +
        esc(String(paths[i])) +
        "</div>";
    }
  }

  tip.innerHTML = html;
  (root.getRootNode() === document
    ? document.body
    : root.host?.parentElement || document.body
  ).appendChild(tip);
  return tip;
}

// 高级设置面板：从注册表构建条目 + 渲染网格 + 绑定点击/重置
// 返回 refreshAdvanced，供展开折叠/路径卡片变更后刷新复用
export function initAdvancedGrid(
  root: ShadowRoot,
  reg: Record<string, ResourceType>,
): () => Promise<void> {
  // 从注册表构建高级设置条目
  interface AdvancedType {
    rtype: string;
    icon: string;
    name: string;
    cfgKey: string;
  }
  const advancedTypes: AdvancedType[] = Object.values(reg).map((entry: ResourceType) => ({
    rtype: entry.id,
    icon: entry.icon ?? "📦",
    name: entry.name || entry.id,
    cfgKey: entry.configField
      ? String(entry.configField).charAt(0).toLowerCase() + String(entry.configField).slice(1)
      : "",
  }));

  // cfg 动态索引辅助（cfgKey 来自配置字段，类型收窄为字符串索引）
  const cfgAny = getCfg() as unknown as Record<string, unknown>;
  const cfgStr = (key: string): string =>
    typeof cfgAny[key] === "string" ? (cfgAny[key] as string) : "";

  const refreshAdvanced = async (): Promise<void> => {
    const grid = root.getElementById("set-advanced-grid");
    if (!grid) return;
    let html = "";
    for (const at of advancedTypes) {
      const canOverride = !!at.cfgKey;
      const overridePath = canOverride ? cfgStr(at.cfgKey) : "";
      const defaultPath = getCfg().filesRoot
        ? `${getCfg().filesRoot}/${groupStorageRootOf(at.rtype) || at.rtype || ""}`
        : t("settings.path.notSetStorage");
      const currentPath = overridePath || defaultPath;
      const isOverridden = !!overridePath;
      html +=
        '<div class="stg-card' +
        (isOverridden ? " stg-card-overridden" : "") +
        '">' +
        '<div class="stg-card-hdr">' +
        "<span>" +
        at.icon +
        "</span><span>" +
        at.name +
        "</span>" +
        (isOverridden
          ? `<span class="stg-custom-badge">${t("settings.path.customized")}</span>`
          : "") +
        (isOverridden
          ? '<button class="btn-base sm stg-adv-reset" data-rtype="' +
            at.rtype +
            '" style="font-size:var(--fs-btn-tool);padding:var(--btn-padding-sm)">' +
            UI_ICONS.undo +
            " " +
            t("settings.path.default") +
            "</button>"
          : "") +
        "</div>" +
        '<div class="stg-card-body">' +
        '<button type="button" class="stg-path-picker" data-rtype="' +
        at.rtype +
        '" title="' +
        t("settings.path.clickToChange") +
        '">' +
        esc(String(currentPath)) +
        "</button>" +
        "</div></div>";
    }
    grid.innerHTML = html;

    // 点击路径文字更改路径
    grid.querySelectorAll(".stg-path-picker").forEach((el) => {
      el.addEventListener("click", async () => {
        const rtype = (el as HTMLElement).dataset.rtype || "";
        try {
          // 平台分支：桌面 Wails Dialog / Android 授权检查+路径输入（ADR-046 P2）
          const pickResult = await pickDirectory();
          if (!pickResult.ok) return;
          const { SetResourceRoot } = await backendGetApp();
          await SetResourceRoot(rtype, pickResult.dir);
          const found = advancedTypes.find((a) => a.rtype === rtype);
          if (found?.cfgKey) cfgAny[found.cfgKey] = pickResult.dir;
          refreshAdvanced();
          bus.emit("toast:show", {
            msg: t("settings.path.set"),
            duration: TOAST_MS.success,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            // ADR-267：状态图标由 type 驱动，msg 不带 ❌ 前缀
            msg: friendlyError((e as Error)?.message || e, t("settings.saveFailed")),
            duration: TOAST_MS.verbose,
            type: "error",
          });
        }
      });
    });
    // 绑定 ↩️ 按钮
    grid.querySelectorAll(".stg-adv-reset").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const rtype = (btn as HTMLElement).dataset.rtype || "";
        try {
          const { ResetResourceRoot } = await backendGetApp();
          await ResetResourceRoot(rtype);
          const found = advancedTypes.find((a) => a.rtype === rtype);
          if (found?.cfgKey) cfgAny[found.cfgKey] = "";
          refreshAdvanced();
          cardRefreshers.forEach((fn) => {
            fn();
          });
          bus.emit("toast:show", {
            msg: t("settings.resetDefault"),
            duration: TOAST_MS.success,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            // ADR-267：状态图标由 type 驱动，msg 不带 ❌ 前缀
            msg: friendlyError((e as Error)?.message || e, t("settings.resetFailed")),
            duration: TOAST_MS.verbose,
            type: "error",
          });
        }
      });
    });
  };
  return refreshAdvanced;
}

// 游戏路径 - 自动搜索 + hover 扫描提示
export function initMcDetect(root: ShadowRoot): void {
  const detectBtn = root.getElementById("set-mc-detect");
  detectBtn?.addEventListener("click", async () => {
    if (isBusy()) return; // 防连点：检测进行中忽略后续点击
    setBusy(true);
    try {
      const { GetMinecraftPaths } = await backendGetApp();
      const paths = await GetMinecraftPaths();
      if (!paths?.length) {
        bus.emit("toast:show", {
          msg: t("settings.mc.noFound"),
          duration: TOAST_MS.normal,
          type: "warn",
        });
        return;
      }
      // 只有一个直接使用，多个让用户选
      let selected: string | null = paths[0];
      if (paths.length > 1) {
        selected = await showPathPicker(paths);
        if (!selected) return; // 用户取消
      }
      // 走 saveCfg 唯一出口（patch 语义：未传字段取重读的最新配置，顺带更新内存 cfg.mcRoot）——
      // 原手抄六位置实参用的是 getCfg() 快照，正是 saveCfg 注释里 P1 修过的「旧值覆盖」形态
      await saveCfg({ mcRoot: selected });
      cardRefreshers.forEach((fn) => {
        fn();
      });
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: t("content.mcPathSet", { path: selected }),
        duration: TOAST_MS.normal,
        type: "success",
      });
    } catch (e) {
      // P2 修复：GetMinecraftPaths/SaveAppConfig 失败要有出口，避免 unhandled rejection 静默
      toastError(e);
    } finally {
      setBusy(false);
    }
  });
  // hover 时预加载并显示扫描到的所有路径 + 搜索范围
  let _scanTooltip: HTMLElement | null = null;
  let _scanPaths: string[] | null = null;
  let _scanHovered = false; // P2 修复（审核）：await 竞态守卫——GetMinecraftPaths 完成前鼠标已移出时不再挂气泡
  detectBtn?.addEventListener("pointerenter", async () => {
    _scanHovered = true;
    if (_scanTooltip) return;
    try {
      if (!_scanPaths) {
        const { GetMinecraftPaths } = await backendGetApp();
        _scanPaths = await GetMinecraftPaths();
      }
      // P2 修复（审核，资源泄漏）：原实现先 await 再无条件挂气泡——鼠标快速移出后
      // 工具提示仍出现在 pointerleave 之后并滞留可见；仅当仍悬停时才挂载
      if (!_scanHovered) return;
      _scanTooltip = showScanTooltip(root, detectBtn, _scanPaths || []);
    } catch (e) {
      // P3 修复（审核）：hover 预加载失败有出口——原裸 await 逸出 unhandled rejection
      // （hover 非用户主动操作，静默降级不 toast，避免打扰）
      logWarn("scan-tooltip", "预加载路径失败", e);
      _scanPaths = [];
    }
  });
  detectBtn?.addEventListener("pointerleave", () => {
    _scanHovered = false;
    if (_scanTooltip) {
      _scanTooltip.remove();
      _scanTooltip = null;
    }
  });
}
