// ===== 树事件层（事件委托版，兼容虚拟滚动） =====

import { getApp } from "@/backend/app.ts";
import { can } from "@/backend/capabilities.ts";
import { isViewerMode } from "@/backend/platform.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { flashBtn } from "@/utils/dom/feedback.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { parseModelName } from "@/utils/model-name/display.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { rememberModelPath } from "@/views/app-content/init-pages.ts";
import { selectSingle, toggleSelect } from "./data.ts";
import type { AppTree } from "./index.ts";
import type { TreeEntry } from "./loader.ts";
import { getVsRows, type TreeRenderCtx } from "./render.ts";

const ENABLE_MULTI_SELECT = true;

// ===== 类型提级：AtTeCtx 收纳上下文 =====
// 注：原 disposed 字段已删——ctx 为闭包局部变量，无处可置 true，5 处 `if (ctx.disposed)
// return` 早退分支是死代码（P1.4 死字段清理）。
interface AtTeCtx {
  container: HTMLElement;
  vm: AppTree;
  /** 渲染上下文（实例级，含 WeakMap 缓存） */
  treeRenderCtx: TreeRenderCtx;
}

// ===== 闭包升格：辅助函数（atTe* 前缀） =====
function atTeFindRow(ctx: AtTeCtx, path: string): HTMLElement | null {
  const rows = getVsRows(ctx.treeRenderCtx, ctx.container);
  const idx = rows.findIndex((r) => r.key === path);
  if (idx === -1) return null;
  const selector = `[data-fullpath="${CSS.escape(path)}"], [data-path="${CSS.escape(path)}"]`;
  return ctx.container.querySelector(selector);
}

function atTeStartRename(ctx: AtTeCtx, path: string): void {
  const row = atTeFindRow(ctx, path);
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
  return vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
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
    if (vm.toggleBusy || vm.batchBusy) {
      bus.emit("toast:show", {
        msg: t("ctx.busyWait"),
        duration: TOAST_MS.quick,
        type: "info",
      });
      return true;
    }
    vm.toggleBusy = true;
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
        logWarn("tree", `ToggleEnable 失败: ${fullPath}`, err);
        bus.emit("toast:show", {
          msg: t("tree.toggleFail", {
            name: fullPath ? fullPath.split(/[/\\]/).pop() || "" : "",
          }),
          duration: TOAST_MS.normal,
          type: "error",
        });
      })
      .finally(() => {
        vm.toggleBusy = false;
      });
    return true;
  }
  return false;
}

// ===== 事件段 3：行点击分派（目录展开/文件选中/悬停操作） =====
function atTeOpenAuthor(author: string): void {
  const url = `https://search.bilibili.com/all?keyword=${encodeURIComponent(author)}`;
  if (isViewerMode()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  getApp()
    .then(({ OpenInBrowser }) => OpenInBrowser(url))
    .catch((err) => {
      logWarn("tree", "OpenInBrowser 失败:", err);
      bus.emit("toast:show", {
        msg: `❌ ${t("tree.browserFailed")}`,
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
  const isOpen = vm.snapshot.dirOpen[dir];
  vm.toggleDir(dir);
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
  // P1.5 修复：原动态 import("@/utils/model-name/display.ts") 改静态——render.ts 已静态
  // 引入同模块的 renderDisplayName，懒加载无意义（首屏已加载该 chunk）。
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
        msg: `📋 ${t("tree.copied", { name })}`,
        duration: TOAST_MS.quick,
        type: "info",
      });
    })
    .catch(() => {
      bus.emit("toast:show", {
        msg: `❌ ${t("tree.copyFailed")}`,
        duration: TOAST_MS.success,
        type: "error",
      });
    });
  return true;
}

function atTeClickRowFile(ctx: AtTeCtx, e: MouseEvent, fl: HTMLElement): boolean {
  const { container, vm } = ctx;
  const state = vm.selectState;
  e.stopPropagation();
  const fullPath = fl.dataset.fullpath || fl.dataset.path;
  if (!fullPath) return true;
  const isCtrl = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;
  if (isShift) {
    e.preventDefault();
    document.getSelection()?.removeAllRanges();
    if (!state.lastKey) return true;
    const allPaths = getVsRows(ctx.treeRenderCtx, container)
      .filter((r) => r.type === "file")
      .map((r) => r.key);
    const startIdx = allPaths.indexOf(state.lastKey);
    const endIdx = allPaths.indexOf(fullPath);
    if (startIdx !== -1 && endIdx !== -1) {
      const [min, max] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
      for (let i = min; i <= max; i++) {
        state.keys.add(allPaths[i]);
      }
    }
    state.lastKey = fullPath;
    vm._renderTree();
    updateSelectCount(vm._root, vm.selectState);
    return true;
  }
  if (isCtrl) {
    toggleSelect(state, fullPath);
    vm._renderTree();
    updateSelectCount(vm._root, vm.selectState);
    return true;
  }
  selectSingle(state, fullPath);
  vm._renderTree();
  updateSelectCount(vm._root, vm.selectState);
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
        ...(fh.dataset.dir !== undefined ? { dir: fh.dataset.dir } : {}),
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
      const selectedPaths = getVsRows(ctx.treeRenderCtx, container)
        .filter((r) => r.type === "file" && vm.selectState.keys.has(r.key))
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
      // banned 不入 ctx:show（契约零消费，2026-09 清理）：树行的启用/禁用切换走
      // 下方 enable/disable 事件链（events.ts 段内 .ck 处理），不经右键菜单
      bus.emit("ctx:show", {
        x: e.clientX,
        y: e.clientY,
        type: "file",
        path: fullPath || "",
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
    const ke = e as KeyboardEvent;
    const target = ke.target as HTMLElement | null;
    if (!target?.classList.contains("rename-inp")) return;
    if (ke.key === "Enter") {
      ke.preventDefault();
      (target as HTMLInputElement).blur();
    } else if (ke.key === "Escape") {
      // P1 修复（审核）：Esc 取消重命名不能直接 _renderTree()——聚焦的 .rename-inp 被
      // DOM 移除时 Chromium 会同步派发 focusout（冒泡到 container）→ 走下方保存链，
      // 用户按 Esc 想放弃修改实际却把改动写盘。先置取消标记：DOM 移除同步触发 focusout
      // 时 input.dataset 仍可读（节点只是从文档断开，对象还在内存），focusout 分支据此跳过保存。
      const inp = target as HTMLInputElement;
      inp.dataset.cancelRename = "1";
      inp.value = ""; // 双保险：即使标记丢失，空值也走下方"放弃重命名"分支
      vm._renderTree();
    }
  });
  container.addEventListener("focusout", (e: FocusEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains("rename-inp")) return;
    // P1 修复（审核）：Esc 取消标记——跳过保存链（见上方 Escape 分支注释）
    if ((target as HTMLInputElement).dataset.cancelRename === "1") {
      delete (target as HTMLInputElement).dataset.cancelRename;
      return;
    }
    const inp = target as HTMLInputElement;
    const newName = inp.value.trim();
    if (!newName) {
      vm._renderTree();
      return;
    }
    const row = inp.closest(".fl, .fl-list") as HTMLElement | null;
    const path = row?.dataset.fullpath || row?.dataset.path || "";
    if (!path) {
      vm._renderTree();
      return;
    }
    // 直接调用 RenameFile，不走 bus（bus 无订阅者，原设计遗留半成品）
    // 对齐 context-menu-file-handlers.ts "file.rename" 范式
    getApp()
      .then(({ RenameFile }) => RenameFile(path, newName))
      .then(async () => {
        // P2 修复（审核）：内联重命名成功后清空选中态——对齐 bus-handlers 的
        // dir:recycle / dir:batch-rename / batch:rename 三条链路。被重命名的文件若在
        // 选中集内，旧路径残留会让底部「已选 N 个文件」滞留、右键 batch 菜单携带
        // 已不存在的路径（误删风险）。
        vm.selectState.keys.clear();
        vm.selectState.lastKey = null;
        await vm._load();
        vm._renderTree();
        bus.emit("stats:refresh");
      })
      .catch((err) => {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(err, t("ctx.renameFail"))}`,
          duration: TOAST_MS.verbose,
          type: "error",
        });
      });
  });
}

// ===== 导出：更新底部选中统计 =====
export function updateSelectCount(root: ShadowRoot, state: { keys: Set<string> }): void {
  const stat = root?.getElementById("ftr-stat");
  if (!stat) return;
  const n = state.keys.size;
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
function collectDirEntries(entries: TreeEntry[], prefix: string): TreeEntry[] {
  const result: TreeEntry[] = [];
  for (const e of entries) {
    if (!e.path) continue;
    const normalized = e.path.replace(/\\/g, "/");
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      result.push(e);
    }
  }
  return result;
}

// ===== 文件夹批量启用/禁用 =====
async function toggleFolderBatch(fhEl: HTMLElement, vm: AppTree): Promise<void> {
  if (vm.batchBusy || vm.toggleBusy) {
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
  vm.batchBusy = true;
  try {
    const { ToggleEnable } = await getApp();
    const ck = fhEl.querySelector(".ck");
    if (!ck) return;
    const dirKey = fhEl.dataset.dir;
    if (!dirKey) return;
    const prefix = dirKey.replace(/\\/g, "/");
    const targets = collectDirEntries(vm.snapshot.entries, prefix);
    if (!targets.length) return;
    const allEnabled = targets.every((e) => !e.banned);
    const enable = !allEnabled;
    let ok = 0,
      fail = 0;
    const flipped: TreeEntry[] = [];
    // P2 修复：原串行 for...of await → 并发批处理（限并发 8）——
    // 文件夹批量启用/禁用时串行 IPC 阻塞主线程。Promise.allSettled 保原语义：
    // 每项独立 try/catch，统计 ok/fail 不短路；flipped 仅登记成功项（失败项不翻转）。
    // 注：原 `if (e.banned === !enable) continue` 处理「banned 与目标态不一致」的项，
    // filter 取同集（banned !== !enable），勿写反。
    const targetsToToggle = targets.filter((e) => e.banned !== !enable);
    const BATCH = 8;
    for (let i = 0; i < targetsToToggle.length; i += BATCH) {
      const batch = targetsToToggle.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((e) =>
          ToggleEnable(e.fullPath)
            .then(() => e)
            .catch((err: unknown) => {
              logWarn("tree", `toggleFolderBatch 失败: ${e.fullPath}`, err);
              throw err;
            }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          ok++;
          flipped.push(r.value);
        } else {
          fail++;
        }
      }
    }
    if (ok > 0) {
      // ⚠️ 不直接 mutate Go 端原始 entry 对象，reload 取真值防幽灵状态
      await vm._load();
      if ((vm.snapshot.rootAttr || RESOURCE_TYPES.YSM) === RESOURCE_TYPES.YSM) {
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
      msg: `❌ ${friendlyError(err, t("tree.batchToggleFail"))}`,
      duration: TOAST_MS.long,
      type: "error",
    });
  } finally {
    vm.batchBusy = false;
  }
}

// ===== 主函数：纯分派，原签名不变 =====
export function bindTreeEvents(container: HTMLElement, vm: AppTree): void {
  const ctx: AtTeCtx = { container, vm, treeRenderCtx: vm.treeRenderCtx };

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
