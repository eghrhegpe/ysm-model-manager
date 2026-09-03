// ===== 树事件层（事件委托版，兼容虚拟滚动） =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { t } from "../../core/i18n/t.ts";
import { bus } from "../../bus.ts";
import { selectState, toggleSelect, selectSingle } from "./data.ts";
import type { AppTree } from "./index.ts";
import { getVsRows } from "./render.ts";
import { safeSet } from "../../utils/dom/storage.ts";
import type { TreeEntry } from "./loader.ts";
import { getApp } from "../../backend/app.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";
import { can } from "../../utils/dom/capabilities.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { flashBtn } from "../../utils/dom/feedback.ts";
import { rememberModelPath } from "../app-content/init-pages.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

const ENABLE_MULTI_SELECT = true;

// ===== 类型提级：AtTeCtx 收纳上下文 =====
interface AtTeCtx {
  container: HTMLElement;
  vm: AppTree;
  disposed: boolean;
}

// ===== 闭包升格：辅助函数（atTe* 前缀） =====
function atTeFindRow(container: HTMLElement, path: string): HTMLElement | null {
  const rows = getVsRows(container);
  const idx = rows.findIndex((r) => r.key === path);
  if (idx === -1) return null;
  const selector = `[data-fullpath="${CSS.escape(path)}"], [data-path="${CSS.escape(path)}"]`;
  return container.querySelector(selector);
}

function atTeStartRename(ctx: AtTeCtx, path: string): void {
  if (ctx.disposed) return;
  const row = atTeFindRow(ctx.container, path);
  if (!row) return;
  const nmEl = row.querySelector(".nm") as HTMLElement | null;
  if (!nmEl) return;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "rename-inp";
  inp.value = path.split(/[/\\]/).pop() || "";
  nmEl.replaceWith(inp);
  inp.focus();
  inp.select();
}

function atTeGetRtype(vm: AppTree): string {
  return vm._rootAttr || RESOURCE_TYPES.YSM;
}

// ===== 事件段 1：DnD 拖入 — 由 import-dnd.ts bindTreeDnD 在 document 层处理，此处不重复注册 =====

// ===== 事件段 2：行复选框多选（文件夹/文件开关 ck） =====
function atTeBindSelCheckboxes(ctx: AtTeCtx, e: MouseEvent, target: HTMLElement): boolean {
  const { vm } = ctx;
  const fhCk = target.closest(".fh .ck, .fh-list .ck");
  if (fhCk) {
    e.stopPropagation();
    toggleFolderBatch(fhCk.closest(".fh, .fh-list") as HTMLElement, vm);
    return true;
  }
  const flCk = target.closest(".fl .ck, .fl-list .ck") as HTMLElement | null;
  if (flCk) {
    e.stopPropagation();
    if (!can("ToggleEnable")) {
      bus.emit("toast:show", {
        msg: t("tree.webNoToggle"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return true;
    }
    if (vm._toggleBusy || vm._batchBusy) {
      bus.emit("toast:show", {
        msg: t("ctx.busyWait"),
        duration: TOAST_MS.quick,
        type: "info",
      });
      return true;
    }
    vm._toggleBusy = true;
    const fullPath = flCk.dataset.fullpath || flCk.dataset.path;
    const fl = flCk.closest(".fl, .fl-list") as HTMLElement | null;
    flashBtn(fl);
    getApp()
      .then(({ ToggleEnable }) => ToggleEnable(fullPath || ""))
      .then(async () => {
        const gen = vm._gen;
        await vm._load();
        if (gen !== vm._gen) return;
        vm._renderTree();
        if (atTeGetRtype(vm) === RESOURCE_TYPES.YSM) {
          bus.emit("sync:toggle:status");
        }
        bus.emit("stats:refresh");
      })
      .catch((err) => {
        console.warn("[tree] ToggleEnable 失败:", fullPath, err);
        bus.emit("toast:show", {
          msg: t("tree.toggleFail", {
            name: fullPath ? (fullPath.split(/[/\\]/).pop() || "") : "",
          }),
          duration: TOAST_MS.normal,
          type: "error",
        });
      })
      .finally(() => {
        vm._toggleBusy = false;
      });
    return true;
  }
  return false;
}

// ===== 事件段 3：行点击分派（目录展开/文件选中/悬停操作） =====
function atTeOpenAuthor(author: string): void {
  const url =
    "https://search.bilibili.com/all?keyword=" + encodeURIComponent(author);
  if (isViewerMode()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  getApp()
    .then(({ OpenInBrowser }) => OpenInBrowser(url))
    .catch((err) => {
      console.warn("[tree] OpenInBrowser 失败:", err);
      bus.emit("toast:show", {
        msg: "❌ " + t("tree.browserFailed"),
        duration: TOAST_MS.normal,
        type: "error",
      });
    });
}

function atTeClickRowFolder(ctx: AtTeCtx, e: MouseEvent, fh: HTMLElement): boolean {
  const { vm } = ctx;
  e.stopPropagation();
  const dir = fh.dataset.dir;
  if (!dir) return true;
  const isOpen = vm._dirOpen[dir];
  vm._dirOpen[dir] = !isOpen;
  if (isOpen) {
    const prefix = (dir + "/").replace(/\\/g, "/");
    for (const key of Object.keys(vm._dirOpen)) {
      const nk = key.replace(/\\/g, "/");
      if (nk !== dir && nk.startsWith(prefix)) delete vm._dirOpen[key];
    }
  }
  safeSet("at_dirs", JSON.stringify(vm._dirOpen));
  vm._renderTree();
  if (!isOpen) {
    bus.emit("model:select", { path: dir, isDir: true });
    rememberModelPath(null);
  }
  return true;
}

function atTeClickRowPreview(_ctx: AtTeCtx, e: MouseEvent, haPreview: HTMLElement): boolean {
  e.stopPropagation();
  const path = haPreview.dataset.path;
  const name = path?.split(/[/\\]/).pop() || "";
  import("../../utils/dom/display.ts")
    .then(({ parseModelName }) => {
      const { author } = parseModelName(name);
      if (author) {
        atTeOpenAuthor(author);
      } else {
        bus.emit("toast:show", {
          msg: t("tree.noAuthor"),
          duration: TOAST_MS.success,
          type: "warn",
        });
      }
    })
    .catch((err) => {
      console.warn("[tree] 加载 display 模块失败:", err);
      bus.emit("toast:show", {
        msg: "❌ " + t("tree.parserLoadFailed"),
        duration: TOAST_MS.normal,
        type: "error",
      });
    });
  return true;
}

function atTeClickRowCopy(_ctx: AtTeCtx, e: MouseEvent, haCopy: HTMLElement): boolean {
  e.stopPropagation();
  const path = haCopy.dataset.path;
  const name = path?.split(/[/\\]/).pop() || "";
  navigator.clipboard
    ?.writeText(name)
    .then(() => {
      bus.emit("toast:show", {
        msg: "📋 " + t("tree.copied", { name }),
        duration: TOAST_MS.quick,
        type: "info",
      });
    })
    .catch(() => {
      bus.emit("toast:show", {
        msg: "❌ " + t("tree.copyFailed"),
        duration: TOAST_MS.success,
        type: "error",
      });
    });
  return true;
}

function atTeClickRowFile(ctx: AtTeCtx, e: MouseEvent, fl: HTMLElement): boolean {
  const { container, vm } = ctx;
  e.stopPropagation();
  const fullPath = fl.dataset.fullpath || fl.dataset.path;
  if (!fullPath) return true;
  const isCtrl = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;
  if (isShift) {
    e.preventDefault();
    document.getSelection()?.removeAllRanges();
    if (!selectState.lastKey) return true;
    const allPaths = getVsRows(container)
      .filter((r) => r.type === "file")
      .map((r) => r.key);
    const startIdx = allPaths.indexOf(selectState.lastKey);
    const endIdx = allPaths.indexOf(fullPath);
    if (startIdx !== -1 && endIdx !== -1) {
      const [min, max] = [
        Math.min(startIdx, endIdx),
        Math.max(startIdx, endIdx),
      ];
      for (let i = min; i <= max; i++) {
        selectState.keys.add(allPaths[i]);
      }
    }
    selectState.lastKey = fullPath;
    vm._renderTree();
    updateSelectCount(vm._root);
    return true;
  }
  if (isCtrl) {
    toggleSelect(fullPath);
    vm._renderTree();
    updateSelectCount(vm._root);
    return true;
  }
  selectSingle(fullPath);
  vm._renderTree();
  updateSelectCount(vm._root);
  // 带上已分类 rtype（当前浏览类型）：消费端优先用，避免歧义扩展名重复探测
  bus.emit("model:select", { path: fullPath, rtype: atTeGetRtype(vm) });
  rememberModelPath(fullPath);
  return true;
}

function atTeBindRowClick(ctx: AtTeCtx, e: MouseEvent, target: HTMLElement): boolean {
  const fh = target.closest(".fh, .fh-list") as HTMLElement | null;
  if (fh) return atTeClickRowFolder(ctx, e, fh);
  const haPreview = target.closest(".ha-preview") as HTMLElement | null;
  if (haPreview) return atTeClickRowPreview(ctx, e, haPreview);
  const haCopy = target.closest(".ha-copy") as HTMLElement | null;
  if (haCopy) return atTeClickRowCopy(ctx, e, haCopy);
  const fl = target.closest(".fl, .fl-list") as HTMLElement | null;
  if (fl && e.button === 0) return atTeClickRowFile(ctx, e, fl);
  return false;
}

// ===== 事件段 4：双击 =====
function atTeBindRowDoubleClick(ctx: AtTeCtx): void {
  const { container } = ctx;
  container.addEventListener("dblclick", (e: MouseEvent) => {
    if (ctx.disposed) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const fl = target.closest(".fl, .fl-list") as HTMLElement | null;
    if (!fl) return;
    const fullPath = fl.dataset.fullpath || fl.dataset.path;
    if (!fullPath) return;
    e.stopPropagation();
    atTeStartRename(ctx, fullPath);
  });
}

// ===== 事件段 5：右键菜单（显示+定位） =====
function atTeBindContextMenu(ctx: AtTeCtx): void {
  const { container, vm } = ctx;
  container.addEventListener("contextmenu", (e: MouseEvent) => {
    if (ctx.disposed) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const fh = target.closest(".fh, .fh-list") as HTMLElement | null;
    if (fh) {
      e.preventDefault();
      e.stopPropagation();
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "dir",
        dir: fh.dataset.dir,
        rtype: atTeGetRtype(vm),
      });
      return;
    }
    const fl = target.closest(".fl, .fl-list") as HTMLElement | null;
    if (fl) {
      e.preventDefault();
      e.stopPropagation();
      const fullPath = fl.dataset.fullpath || fl.dataset.path;
      const nameEl = fl.querySelector(".nm");
      const name = nameEl?.textContent?.replace(/^\S+\s/, "") || "";
      const selectedPaths = getVsRows(container)
        .filter((r) => r.type === "file" && selectState.keys.has(r.key))
        .map((r) => r.key);
      if (
        ENABLE_MULTI_SELECT &&
        selectedPaths.length > 0 &&
        selectedPaths.includes(fullPath || "")
      ) {
        bus.emit("ctx:show", {
          x: e.clientX,
          y: e.clientY,
          type: "batch",
          count: selectedPaths.length,
          paths: selectedPaths,
          rtype: atTeGetRtype(vm),
        });
        return;
      }
      const banned = !fl.querySelector(".ck")?.classList.contains("on");
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "file",
        path: fullPath || "",
        banned,
        name,
        rtype: atTeGetRtype(vm),
      });
    }
  });
}

// ===== 事件段 6：输入框 rename（keydown Enter/blur 保存） =====
function atTeBindRenameInput(ctx: AtTeCtx): void {
  const { container, vm } = ctx;
  container.addEventListener("keydown", (e: Event) => {
    if (ctx.disposed) return;
    const ke = e as KeyboardEvent;
    const target = ke.target as HTMLElement | null;
    if (!target || !target.classList.contains("rename-inp")) return;
    if (ke.key === "Enter") {
      ke.preventDefault();
      (target as HTMLInputElement).blur();
    } else if (ke.key === "Escape") {
      vm._renderTree();
    }
  });
  container.addEventListener("focusout", (e: FocusEvent) => {
    if (ctx.disposed) return;
    const target = e.target as HTMLElement | null;
    if (!target || !target.classList.contains("rename-inp")) return;
    const inp = target as HTMLInputElement;
    const newName = inp.value.trim();
    if (!newName) {
      vm._renderTree();
      return;
    }
    const row = inp.closest(".fl, .fl-list") as HTMLElement | null;
    const path = row?.dataset.fullpath || row?.dataset.path || "";
    if (!path) { vm._renderTree(); return; }
    // 直接调用 RenameFile，不走 bus（bus 无订阅者，原设计遗留半成品）
    // 对齐 context-menu-file-handlers.ts "file.rename" 范式
    getApp()
      .then(({ RenameFile }) => RenameFile(path, newName))
      .then(async () => {
        await vm._load();
        vm._renderTree();
        bus.emit("stats:refresh");
      })
      .catch((err) => {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(err, t("ctx.renameFail")),
          duration: TOAST_MS.verbose,
          type: "error",
        });
      });
  });
}

// ===== 导出：更新底部选中统计 =====
export function updateSelectCount(root: ShadowRoot): void {
  const stat = root?.getElementById("ftr-stat");
  if (!stat) return;
  const n = selectState.keys.size;
  // data-count 数据通道：e2e 读数字而非文案，与 locale 解耦（ADR-133 导向）
  stat.setAttribute("data-count", String(n));
  if (n > 0) {
    stat.textContent = t("tree.selectedCount", { n });
    stat.style.color = "var(--accent)";
  } else {
    stat.style.color = "";
  }
}

// ===== 递归收集文件夹下所有条目 =====
function collectDirEntries(
  entries: TreeEntry[],
  prefix: string,
): TreeEntry[] {
  const result: TreeEntry[] = [];
  for (const e of entries) {
    if (!e.path) continue;
    const normalized = e.path.replace(/\\/g, "/");
    if (normalized === prefix || normalized.startsWith(prefix + "/")) {
      result.push(e);
    }
  }
  return result;
}

// ===== 文件夹批量启用/禁用 =====
async function toggleFolderBatch(fhEl: HTMLElement, vm: AppTree): Promise<void> {
  if (vm._batchBusy || vm._toggleBusy) {
    bus.emit("toast:show", {
      msg: t("ctx.busyWait"),
      duration: TOAST_MS.quick,
      type: "info",
    });
    return;
  }
  if (!can("ToggleEnable")) {
    bus.emit("toast:show", {
      msg: t("tree.webNoToggle"),
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return;
  }
  vm._batchBusy = true;
  try {
  const { ToggleEnable } = await getApp();
  const ck = fhEl.querySelector(".ck");
  if (!ck) return;
  const dirKey = fhEl.dataset.dir;
  if (!dirKey) return;
  const prefix = dirKey.replace(/\\/g, "/");
  const targets = collectDirEntries(vm._entries, prefix);
  if (!targets.length) return;
  const allEnabled = targets.every((e) => !e.banned);
  const enable = allEnabled ? false : true;
  let ok = 0,
    fail = 0;
  const flipped: TreeEntry[] = [];
  for (const e of targets) {
    if (e.banned === !enable) continue;
    try {
      await ToggleEnable(e.fullPath);
      ok++;
      flipped.push(e); // 只登记实际成功的项，失败项不翻转（不靠重载纠正）
    } catch (err) {
      fail++;
      console.warn("[tree] toggleFolderBatch 失败:", e.fullPath, err);
    }
  }
  if (ok > 0) {
    for (const e of flipped) {
      if (!e.banned && !enable) e.banned = true;
      else if (e.banned && enable) e.banned = false;
    }
    vm._renderTree();
    if ((vm._rootAttr || RESOURCE_TYPES.YSM) === RESOURCE_TYPES.YSM) {
      bus.emit("sync:toggle:status");
    }
  }
  bus.emit("toast:show", {
    msg: t("tree.folderToggleResult", {
      action: enable ? t("tree.enable") : t("tree.disable"),
      ok,
      fail,
    }),
    duration: TOAST_MS.long,
    type: fail > 0 ? "warn" : "success",
  });
  } catch (err) {
    bus.emit("toast:show", {
      msg: "❌ " + friendlyError(err, t("tree.batchToggleFail")),
      duration: TOAST_MS.long,
      type: "error",
    });
  } finally {
    vm._batchBusy = false;
  }
}

// ===== 主函数：纯分派，原签名不变 =====
export function bindTreeEvents(container: HTMLElement, vm: AppTree): void {
  const ctx: AtTeCtx = { container, vm, disposed: false };

  atTeBindRowDoubleClick(ctx);
  atTeBindContextMenu(ctx);
  atTeBindRenameInput(ctx);

  container.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (atTeBindSelCheckboxes(ctx, e, target)) return;
    if (atTeBindRowClick(ctx, e, target)) return;
  });
}
