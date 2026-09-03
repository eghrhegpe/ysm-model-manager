// ===== 设置页：路径卡片 / 高级面板 / 游戏目录检测（ADR-040 拆分自 init.ts）=====
// 原 initSettings 巨型闭包中的路径相关逻辑整体迁出：共享状态（cfg/cardRefreshers/
// busy/toastError）统一走 store.ts 模块级，root/refreshAdvanced 显式参数传递。
import { TOAST_MS } from "../../../utils/dom/toast-ms.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { t } from "../../../core/i18n/t.ts";
import { esc } from "../../../utils/dom/html.ts";
import { safeGet } from "../../../utils/dom/storage.ts";
import { pickDirectory } from "../../../utils/dom/directory-picker.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import type { ResourceTypeEntry } from "../../../services/resource-registry.ts";
import { groupStorageRootOf } from "../../../utils/resource/types.ts";
import { cfg, cardRefreshers, isBusy, setBusy, toastError } from "./store.ts";

/** HTML 转义（高级面板路径/路径选择器/扫描提示共用） */
function escHtml(s: unknown): string {
  return esc(String(s ?? ""));
}

// 保存 cfg 辅助（保留各字段原值）
// P1 修复（审核，配置回退）：保存前重读 Go 端最新配置作为未 patch 字段默认——
// 原用模块级 cfg（initSettings 一次性加载的旧值），用户在其他入口改过字段后
// 二次保存会把新值静默覆盖回退（如先改 mcRoot 再改 rpRoot，mcRoot 被旧值覆盖）
export async function saveCfg(patch: {
  filesRoot?: string;
  rpRoot?: string;
  mcRoot?: string;
  linkMode?: string;
}): Promise<void> {
  const { LoadAppConfig, SaveAppConfig } = await getApp();
  let latest = cfg;
  try {
    latest = await LoadAppConfig();
  } catch {
    /* 重读失败退化为内存 cfg（尽力而为） */
  }
  const theme = safeGet("theme") || "dark";
  await SaveAppConfig(
    patch.filesRoot !== undefined ? patch.filesRoot : latest.filesRoot || "",
    patch.rpRoot !== undefined ? patch.rpRoot : latest.resourcepackRoot || "",
    patch.mcRoot !== undefined ? patch.mcRoot : latest.mcRoot || "",
    patch.linkMode !== undefined ? patch.linkMode : latest.linkMode || "copy",
    theme,
  );
  if (patch.filesRoot !== undefined) cfg.filesRoot = patch.filesRoot;
  if (patch.rpRoot !== undefined) cfg.resourcepackRoot = patch.rpRoot;
  if (patch.mcRoot !== undefined) cfg.mcRoot = patch.mcRoot;
  if (patch.linkMode !== undefined) cfg.linkMode = patch.linkMode;
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
    el.textContent = p || t("settings.path.selectDir");
    el.style.color = p ? "" : "var(--accent)";
  };
  cardRefreshers.push(refresh);
  el.addEventListener("click", async () => {
    if (isBusy()) return; // 防连点：目录选择进行中忽略后续点击
    setBusy(true);
    try {
      // 平台分支：桌面 Wails Dialog / Android 授权检查+路径输入（ADR-046 P2）
      const dir = await pickDirectory();
      if (!dir) return;
      await onSelect(dir);
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
function showPathPicker(root: ShadowRoot, paths: string[]): Promise<string | null> {
  return new Promise(function (resolve) {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;z-index:var(--z-modal);inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center";
    const box = document.createElement("div");
    box.style.cssText =
      "background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:12px;padding:16px;max-width:500px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4)";
    let listHtml = "";
    for (let i = 0; i < paths.length; i++) {
      listHtml +=
        "<div class='mc-pick-item' data-idx='" +
        i +
        "' style='padding:8px 10px;border-radius:6px;cursor:pointer;font-size:var(--fs-sm,11px);color:var(--txt,#cdd6f4);display:flex;align-items:center;gap:8px;transition:background var(--tr-fast)' onpointerenter='this.style.background=\"var(--hover,#3a3a4a)\"' onpointerleave='this.style.background=\"\"'>" +
        "<span style='color:var(--accent,#89b4fa);flex-shrink:0'>📁</span>" +
        escHtml(paths[i]) +
        "</div>";
    }
    box.innerHTML =
      "<div style='font-weight:600;font-size:13px;margin-bottom:8px'>" + t("content.pickMcDirTitle") + "</div>" +
      "<div style='font-size:10px;color:var(--muted,#888);margin-bottom:12px'>" + t("content.pickMcDirDesc") + "</div>" +
      listHtml +
      "<div style='margin-top:12px;text-align:right'>" +
      "<button class='mc-pick-cancel' style='padding:4px 12px;border-radius:4px;border:1px solid var(--bd,#444);background:transparent;color:var(--txt,#cdd6f4);cursor:pointer;font-size:var(--fs-sm,11px);font-family:inherit'>" + t("common.cancel") + "</button>" +
      "</div>";
    overlay.appendChild(box);
    (root.getRootNode() === document
      ? document.body
      : root.host?.parentElement || document.body
    ).appendChild(overlay);

    box.querySelectorAll(".mc-pick-item").forEach(function (el) {
      el.addEventListener("click", function () {
        const idx = parseInt((el as HTMLElement).dataset.idx || "0", 10);
        overlay.remove();
        resolve(paths[idx] || null);
      });
    });
    box
      .querySelector(".mc-pick-cancel")
      ?.addEventListener("click", function () {
        overlay.remove();
        resolve(null);
      });
  });
}

/** 扫描提示气泡：hover 时显示扫描到的所有路径 + 搜索范围 */
function showScanTooltip(
  root: ShadowRoot,
  anchor: HTMLElement,
  paths: string[],
): HTMLElement {
  const rect = anchor.getBoundingClientRect();
  const tip = document.createElement("div");
  tip.id = "mc-scan-tooltip";
  tip.style.cssText =
    "position:fixed;z-index:var(--z-toast);background:var(--surf,#2a2a3a);border:1px solid var(--bd,#444);border-radius:8px;padding:10px 14px;font-size:var(--fs-sm,11px);color:var(--txt,#cdd6f4);box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:420px;max-height:350px;overflow-y:auto;pointer-events:none;line-height:1.6";
  tip.style.left = Math.max(4, rect.left) + "px";
  tip.style.top = rect.bottom + 4 + "px";

  // 搜索范围
  let html =
    "<div style='font-weight:600;margin-bottom:4px'>" + t("content.scanScope") + "</div>" +
    "<div style='font-size:10px;color:var(--muted,#888);margin-bottom:8px;padding-left:4px'>" +
    t("content.scanScopeLine1") +
    t("content.scanScopeLine2") +
    "</div>" +
    "<div style='border-top:1px solid var(--bd,#444);margin:6px 0'></div>";

  // 搜索结果
  if (!paths.length) {
    html +=
      "<div style='color:var(--muted,#888);padding:4px 0'>" + t("content.noMcDirFound") + "</div>" +
      "<div style='font-size:10px;color:var(--muted,#888);padding-top:2px'>" + t("content.noMcDirHint") + "</div>";
  } else {
    html +=
      "<div style='font-weight:600;margin-bottom:4px'>" +
      t("content.foundCount", { n: paths.length }) +
      "</div>";
    for (let i = 0; i < paths.length; i++) {
      html +=
        "<div style='padding:1px 0;display:flex;align-items:center;gap:6px;font-size:10px'>" +
        "<span style='color:var(--accent,#89b4fa);flex-shrink:0'>📁</span>" +
        escHtml(paths[i]) +
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
  reg: Record<string, ResourceTypeEntry>,
): () => Promise<void> {
  // 从注册表构建高级设置条目
  interface AdvancedType {
    rtype: string;
    icon: string;
    name: string;
    cfgKey: string;
  }
  const advancedTypes: AdvancedType[] = Object.values(reg).map((entry: ResourceTypeEntry) => ({
    rtype: entry.id,
    icon: entry.icon as string,
    name: (entry.name as string) || entry.id,
    cfgKey: entry.configField
      ? String(entry.configField).charAt(0).toLowerCase() + String(entry.configField).slice(1)
      : "",
  }));

  // cfg 动态索引辅助（cfgKey 来自配置字段，类型收窄为字符串索引）
  const cfgAny = cfg as unknown as Record<string, unknown>;
  const cfgStr = (key: string): string => (typeof cfgAny[key] === "string" ? (cfgAny[key] as string) : "");

  const refreshAdvanced = async (): Promise<void> => {
    const grid = root.getElementById("set-advanced-grid");
    if (!grid) return;
    let html = "";
    for (const at of advancedTypes) {
      const canOverride = !!at.cfgKey;
      const overridePath = canOverride ? cfgStr(at.cfgKey) : "";
      const defaultPath = cfg.filesRoot
        ? cfg.filesRoot + "/" + (groupStorageRootOf(at.rtype) || at.rtype || "")
        : t("settings.path.notSetStorage");
      const currentPath = overridePath || defaultPath;
      const isOverridden = !!overridePath;
      html +=
        '<div class="stg-card' +
        (isOverridden ? ' stg-card-overridden' : '') +
        '">' +
        '<div class="stg-card-hdr">' +
        "<span>" +
        at.icon +
        "</span><span>" +
        at.name +
        "</span>" +
        (isOverridden
          ? '<span class="stg-custom-badge">' + t("settings.path.customized") + '</span>'
          : "") +
        (isOverridden
          ? '<button class="btn-base sm stg-adv-reset" data-rtype="' +
            at.rtype +
            '" style="font-size:var(--fs-btn-tool);padding:2px 6px">↩️ ' + t("settings.path.default") + '</button>'
          : "") +
        "</div>" +
        '<div class="stg-card-body">' +
        '<div class="stg-path-picker" data-rtype="' +
        at.rtype +
        '" title="' + t("settings.path.clickToChange") + '">' +
        escHtml(currentPath) +
        "</div>" +
        "</div></div>";
    }
    grid.innerHTML = html;

    // 点击路径文字更改路径
    grid.querySelectorAll(".stg-path-picker").forEach((el) => {
      el.addEventListener("click", async () => {
        const rtype = (el as HTMLElement).dataset.rtype || "";
        try {
          // 平台分支：桌面 Wails Dialog / Android 授权检查+路径输入（ADR-046 P2）
          const dir = await pickDirectory();
          if (!dir) return;
          const { SetResourceRoot } =
            await getApp();
          await SetResourceRoot(rtype, dir);
          const found = advancedTypes.find((a) => a.rtype === rtype);
          if (found && found.cfgKey) cfgAny[found.cfgKey] = dir;
          refreshAdvanced();
          bus.emit("toast:show", {
            msg: t("settings.path.set"),
            duration: TOAST_MS.success,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError((e as Error)?.message || e, t("settings.saveFailed")),
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
          const { ResetResourceRoot } =
            await getApp();
          await ResetResourceRoot(rtype);
          const found = advancedTypes.find((a) => a.rtype === rtype);
          if (found && found.cfgKey) cfgAny[found.cfgKey] = "";
          refreshAdvanced();
          cardRefreshers.forEach((fn) => fn());
          bus.emit("toast:show", {
            msg: t("settings.resetDefault"),
            duration: TOAST_MS.success,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError((e as Error)?.message || e, t("settings.resetFailed")),
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
  const detectBtn = root.getElementById("set-mc-detect") as HTMLElement | null;
  detectBtn?.addEventListener("click", async () => {
    if (isBusy()) return; // 防连点：检测进行中忽略后续点击
    setBusy(true);
    try {
      const { GetMinecraftPaths, SaveAppConfig } = await getApp();
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
        selected = await showPathPicker(root, paths);
        if (!selected) return; // 用户取消
      }
      const theme = safeGet("theme") || "dark";
      await SaveAppConfig(
        cfg.filesRoot || "",
        cfg.resourcepackRoot || "",
        selected,
        cfg.linkMode || "copy",
        theme,
      );
      cfg.mcRoot = selected as string; // 语义上此处非空（单路径为 paths[0]，多路径已 return null）
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
        const { GetMinecraftPaths } = await getApp();
        _scanPaths = await GetMinecraftPaths();
      }
      // P2 修复（审核，资源泄漏）：原实现先 await 再无条件挂气泡——鼠标快速移出后
      // 工具提示仍出现在 pointerleave 之后并滞留可见；仅当仍悬停时才挂载
      if (!_scanHovered) return;
      _scanTooltip = showScanTooltip(root, detectBtn, _scanPaths || []);
    } catch (e) {
      // P3 修复（审核）：hover 预加载失败有出口——原裸 await 逸出 unhandled rejection
      // （hover 非用户主动操作，静默降级不 toast，避免打扰）
      console.warn("[scan-tooltip] 预加载路径失败:", e);
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
