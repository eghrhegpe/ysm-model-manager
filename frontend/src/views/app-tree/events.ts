// ===== 树事件层（事件委托版，兼容虚拟滚动） =====

import { can } from "@/backend/capabilities.ts";
import { isViewerMode } from "@/backend/platform.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { rememberModelPath } from "@/core/model-path-store.ts";
import { batchAllSettled } from "@/utils/async/batch-all-settled.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { flashBtn } from "@/utils/dom/feedback.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { parseModelName } from "@/utils/model-name/display.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { selectSingle, toggleSelect } from "./data.ts";
import { entryKey } from "./entry-key.ts";
import { withFooterProgress } from "./footer-progress.ts";
import type { AppTree } from "./index.ts";
import type { TreeEntry } from "./loader.ts";
import { getVsRows, invalidateBuildCache, type TreeRenderCtx } from "./render.ts";

// ===== 类型提级：AtTeCtx 收纳上下文 =====
// 注：原 disposed 字段已删——ctx 为闭包局部变量，无处可置 true，5 处 `if (ctx.disposed)
// return` 早退分支是死代码（P1.4 死字段清理）。
interface AtTeCtx {
  container: HTMLElement;
  vm: AppTree;
  /** 渲染上下文（实例级，含 WeakMap 缓存） */
  treeRenderCtx: TreeRenderCtx;
}

/**
 * Shift 区间选的单次跨度上限（锐评 2026-10-15）。
 *
 * 病灶：区间按**当前可见行序**（getVsRows）取 lastKey→目标行之间的一切文件，而
 * `lastKey` 与选中集是跨搜索/排序存活的。用户在搜索态 Shift 选一小段（此时可见行只有
 * 几条命中）→ 清除搜索词 → 再 Shift 点远处一行：allPaths 已换成**全树行序**，
 * 同一个手势从「选 3 行」变成「选几千行」——一次 Shift 吞掉整个仓库，随后任何批量
 * 操作（批量删除/回收/重命名）的作用域都失控。
 *
 * 阈值只拦「异常大的单次跨度」，不影响正常区间选择；命中时**不选中**并提示改用全选，
 * 让用户明确知道手势被拒（静默截断到 N 项会更糟：选中的集合与视觉区间不一致）。
 */
const SHIFT_RANGE_MAX = 500;

// ===== 闭包升格：辅助函数（atTe* 前缀） =====
function atTeFindRow(ctx: AtTeCtx, path: string): HTMLElement | null {
  const rows = getVsRows(ctx.treeRenderCtx, ctx.container);
  const idx = rows.findIndex((r) => r.key === path);
  if (idx === -1) return null;
  const selector = `[data-fullpath="${CSS.escape(path)}"], [data-path="${CSS.escape(path)}"]`;
  return ctx.container.querySelector<HTMLElement>(selector);
}

function atTeStartRename(ctx: AtTeCtx, path: string): void {
  const row = atTeFindRow(ctx, path);
  if (!row) return;
  const nmEl = row.querySelector<HTMLElement>(".nm");
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
    const fhEl = fhCk.closest<HTMLElement>(".fh, .fh-list");
    if (!fhEl) return true;
    toggleFolderBatch(fhEl, vm);
    return true;
  }
  const flCk = target.closest<HTMLElement>(".fl .ck, .fl-list .ck");
  if (flCk) {
    e.stopPropagation();
    if (!can("ToggleEnable")) {
      toast(t("tree.webNoToggle"), TOAST_MS.normal, "warn");
      return true;
    }
    if (!vm.toggleLock.tryStart()) {
      toast(t("ctx.busyWait"), TOAST_MS.quick, "info");
      return true;
    }
    const fullPath = flCk.dataset.fullpath || flCk.dataset.path;
    // P1-2 乐观更新（2026-10-13）：banned 是本地布尔位——先翻转 entries 内该条目并
    // 局部重渲（行高随数据变化，.ck on/.ban 态即时反馈），IPC 落盘成功后后台 reload 校正
    // 真值。替代原「IPC 成功 → _load() 全盘重扫 → 全量重渲」串行链：2000 模型仓库点一次
    // 开关不再付一次全量扫描（Go InvalidatePath 会打掉 30s 缓存，重载必真扫盘）。
    // 失败回滚：revert 本地位再重渲，防 UI 与磁盘状态假一致。
    const flipLocal = (): boolean => {
      const entry = vm.entries.find((e) => entryKey(e) === fullPath);
      if (!entry) return false;
      entry.banned = !entry.banned;
      invalidateBuildCache(vm.treeRenderCtx);
      return true;
    };
    if (flipLocal()) {
      vm._renderTree();
      // flash 必须在乐观重渲**之后**取新行——旧行 DOM 已被重渲整体重建，先 flash 后
      // 重渲会把闪烁加在即将被丢弃的节点上（用户看不到；本卡初版即此回归，
      // app-tree.state.test.ts「flash 同步添加、渲染异步重建」回归锁为证）
      flashBtn(flCk.closest<HTMLElement>(".fl, .fl-list"));
    }
    const rollbackGen = vm._guard.current;
    backendGetApp()
      .then(({ ToggleEnable }) => ToggleEnable(fullPath || ""))
      .then(async () => {
        // 后台校正取真值：Go 侧 InvalidatePath 已使本次扫描缓存失效，重载拿到磁盘真实态
        const gen = vm._guard.current;
        await vm._load();
        if (vm._guard.stale(gen)) return;
        vm._renderTree();
        // ADR-339：带当前树类型发射，Go 侧按 dirLevelSync 过滤同步（非 dirLevelSync 自动 no-op）
        bus.emit("sync:toggle:status", { rtype: atTeGetRtype(vm) });
        bus.emit("stats:refresh");
      })
      .catch((err) => {
        logWarn("tree", `ToggleEnable 失败: ${fullPath}`, err);
        // 乐观位回滚（reload 拿真值也可，但失败路径走全量重扫太重——本地 revert 即可）。
        // 双守卫：① 代际（回滚期间 root 已切换/树已重载 → 旧 entries 引用上的 revert
        // 是过期写入，新树由新数据渲染自洽）；② 条目换出（reload 后 entries 不再含该
        // 路径 → 无从 revert）。两者任一命中都跳过 revert，但 toast 必达——失败不可静默。
        if (!vm._guard.stale(rollbackGen)) {
          const entry = vm.entries.find((e) => entryKey(e) === fullPath);
          if (entry) {
            entry.banned = !entry.banned;
            invalidateBuildCache(vm.treeRenderCtx);
            vm._renderTree();
          }
        }
        toast(
          t("tree.toggleFail", {
            name: fullPath ? fullPath.split(/[/\\]/).pop() || "" : "",
          }),
          TOAST_MS.normal,
          "error",
        );
      })
      .finally(() => {
        vm.toggleLock.finish();
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
  backendGetApp()
    .then(({ OpenInBrowser }) => OpenInBrowser(url))
    .catch((err) => {
      logWarn("tree", "OpenInBrowser 失败:", err);
      toast(`${t("tree.browserFailed")}`, TOAST_MS.normal, "error");
    });
}

function atTeClickRowFolder(ctx: AtTeCtx, e: MouseEvent, fh: HTMLElement): boolean {
  const { vm } = ctx;
  e.stopPropagation();
  const dir = fh.dataset.dir;
  if (!dir) return true;
  // ADR-334 第三读点：目录名恰为 `__proto__` 时裸 `dirOpen[dir]` 读到 Object.prototype
  //（truthy）→ 判为已展开 → 点开不 emit model:select。对齐 index.toggleDir 与 render.flattenVisible。
  const isOpen = Object.hasOwn(vm.snapshot.dirOpen, dir)
    ? vm.snapshot.dirOpen[dir] === true
    : false;
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
    toast(t("tree.noAuthor"), TOAST_MS.success, "warn");
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
      toast(`📋 ${t("tree.copied", { name })}`, TOAST_MS.quick, "info");
    })
    .catch(() => {
      toast(`${t("tree.copyFailed")}`, TOAST_MS.success, "error");
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
      // 跨度守卫（锐评 2026-10-15）：锚点（lastKey）与选中集跨搜索/排序存活，而区间按
      // **当前**可见行序取——搜索态选一小段后清除搜索词再 Shift，同一手势的作用域会从
      // 几行变成全树。超阈值即拒选并引导改用全选（不静默截断：截断会让选中集合与视觉
      // 区间不一致，比拒绝更坏）。
      const span = max - min + 1;
      if (span > SHIFT_RANGE_MAX) {
        toast(
          t("tree.shiftRangeTooLarge", { n: span, max: SHIFT_RANGE_MAX }),
          TOAST_MS.normal,
          "warn",
        );
        return true;
      }
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
  const fh = target.closest<HTMLElement>(".fh, .fh-list");
  if (fh) return atTeClickRowFolder(ctx, e, fh);
  const haPreview = target.closest<HTMLElement>(".ha-preview");
  if (haPreview) return atTeClickRowPreview(ctx, e, haPreview);
  const haCopy = target.closest<HTMLElement>(".ha-copy");
  if (haCopy) return atTeClickRowCopy(ctx, e, haCopy);
  const fl = target.closest<HTMLElement>(".fl, .fl-list");
  if (fl && e.button === 0) return atTeClickRowFile(ctx, e, fl);
  return false;
}

// ===== 事件段 4：双击 =====
function atTeBindRowDoubleClick(ctx: AtTeCtx): () => void {
  const { container } = ctx;
  const onDblClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const fl = target.closest<HTMLElement>(".fl, .fl-list");
    if (!fl) return;
    const fullPath = fl.dataset.fullpath || fl.dataset.path;
    if (!fullPath) return;
    e.stopPropagation();
    atTeStartRename(ctx, fullPath);
  };
  container.addEventListener("dblclick", onDblClick);
  return () => container.removeEventListener("dblclick", onDblClick);
}

// ===== 事件段 5：右键菜单（显示+定位） =====
function atTeBindContextMenu(ctx: AtTeCtx): () => void {
  const { container, vm } = ctx;
  const onContextMenu = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const fh = target.closest<HTMLElement>(".fh, .fh-list");
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
    const fl = target.closest<HTMLElement>(".fl, .fl-list");
    if (fl) {
      e.preventDefault();
      e.stopPropagation();
      const fullPath = fl.dataset.fullpath || fl.dataset.path;
      // 菜单名 = 磁盘 basename（2026-09 收债）：原 `.nm` textContent 剥首词是「图标
      // 内嵌文本」时代的遗留，图标独立 .ficon 后对含空格名误剥（"My Model.ysm" →
      // "Model.ysm"）；右键菜单的操作对象就是磁盘文件，basename 语义无歧义
      const name = (fullPath || "").split(/[/\\]/).pop() || "";
      const selectedPaths = getVsRows(ctx.treeRenderCtx, container)
        .filter((r) => r.type === "file" && vm.selectState.keys.has(r.key))
        .map((r) => r.key);
      if (selectedPaths.length > 0 && selectedPaths.includes(fullPath || "")) {
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
  };
  container.addEventListener("contextmenu", onContextMenu);
  return () => container.removeEventListener("contextmenu", onContextMenu);
}

// ===== 事件段 6：输入框 rename（keydown Enter/blur 保存） =====
function atTeBindRenameInput(ctx: AtTeCtx): () => void {
  const { container, vm } = ctx;
  const onKeyDown = (e: Event): void => {
    if (!(e instanceof KeyboardEvent)) return;
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("rename-inp")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      target.blur();
    } else if (e.key === "Escape") {
      // P1 修复（审核）：Esc 取消重命名不能直接 _renderTree()——聚焦的 .rename-inp 被
      // DOM 移除时 Chromium 会同步派发 focusout（冒泡到 container）→ 走下方保存链，
      // 用户按 Esc 想放弃修改实际却把改动写盘。先置取消标记：DOM 移除同步触发 focusout
      // 时 input.dataset 仍可读（节点只是从文档断开，对象还在内存），focusout 分支据此跳过保存。
      target.dataset.cancelRename = "1";
      target.value = ""; // 双保险：即使标记丢失，空值也走下方"放弃重命名"分支
      vm._renderTree();
    }
  };
  const onFocusOut = (e: FocusEvent): void => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("rename-inp")) return;
    // P1 修复（审核）：Esc 取消标记——跳过保存链（见上方 Escape 分支注释）
    if (target.dataset.cancelRename === "1") {
      delete target.dataset.cancelRename;
      return;
    }
    const inp = target;
    const newName = inp.value.trim();
    if (!newName) {
      vm._renderTree();
      return;
    }
    const row = inp.closest<HTMLElement>(".fl, .fl-list");
    const path = row?.dataset.fullpath || row?.dataset.path || "";
    if (!path) {
      vm._renderTree();
      return;
    }
    // 直接调用 RenameFile，不走 bus（bus 无订阅者，原设计遗留半成品）
    // 对齐 context-menu-file-handlers.ts "file.rename" 范式
    backendGetApp()
      .then(({ RenameFile }) => RenameFile(path, newName))
      .then(async () => {
        // 只摘被改名的这一条（锐评 2026-10-15 P2）：原实现 keys.clear() 连坐清空全部选中项。
        // 双击改名与选中集是两条正交路径（dblclick 分支不触碰 selectState，见 atTeBindRowDoubleClick），
        // 故「选 5 个、改其中 1 个」不该把 5 个都丢掉——旧键已失效（磁盘上已不存在），
        // 但其余选中项仍然有效，保留它们才与「移动/删除后清空」的语义区分开
        // （那两条链是全体失效，这里只有一条失效）。
        vm.selectState.keys.delete(path);
        if (vm.selectState.lastKey === path) vm.selectState.lastKey = null;
        updateSelectCount(vm._root, vm.selectState);
        bus.emit("stats:refresh");
        // 守卫（2026-09 收债）：改名 IPC 在途切类型时丢弃过期渲染，防旧类型
        // entries 覆盖新树（对齐删除链 stale 检查）
        const gen = vm._guard.current;
        await vm._load();
        if (!vm._guard.stale(gen)) vm._renderTree();
      })
      .catch((err) => {
        toast(`${friendlyError(err, t("ctx.renameFail"))}`, TOAST_MS.verbose, "error");
      });
  };
  container.addEventListener("keydown", onKeyDown);
  container.addEventListener("focusout", onFocusOut);
  return () => {
    container.removeEventListener("keydown", onKeyDown);
    container.removeEventListener("focusout", onFocusOut);
  };
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
// 2026-10-15 P1-C 收口：本链是**持锁的串行 IPC 长操作**（数百项 = 数十秒），原实现全程零
// 反馈——点下去 UI 毫无变化，期间单文件开关只会撞「请稍候」；而同一页面的单文件开关早已
// 是「乐观翻转 + 失败回滚 + 后台校正」范式。本次把单文件那套范式推广到批量链，并补可见
// 进度（页脚槽，见 footer-progress.ts），与单文件开关共用同一把 toggleLock（ADR-341）。
async function toggleFolderBatch(fhEl: HTMLElement, vm: AppTree): Promise<void> {
  // ADR-341 归一：tryStart 原子抢锁（原「batchBusy||toggleBusy 互查再置位」三段式退役，
  // 单临界区单锁——单文件开关与文件夹批量共用 vm.toggleLock，互斥语义不变）
  if (!can("ToggleEnable")) {
    toast(t("tree.webNoToggle"), TOAST_MS.normal, "warn");
    return;
  }
  if (!vm.toggleLock.tryStart()) {
    toast(t("ctx.busyWait"), TOAST_MS.quick, "info");
    return;
  }
  try {
    const { ToggleEnable } = await backendGetApp();
    const ck = fhEl.querySelector(".ck");
    if (!ck) return;
    const dirKey = fhEl.dataset.dir;
    if (!dirKey) return;
    const prefix = dirKey.replace(/\\/g, "/");
    const targets = collectDirEntries(vm.snapshot.entries, prefix);
    if (!targets.length) return;
    const allEnabled = targets.every((e) => !e.banned);
    const enable = !allEnabled;
    const action = enable ? t("tree.enable") : t("tree.disable");
    // 注：原 `if (e.banned === !enable) continue` 处理「banned 与目标态不一致」的项，
    // filter 取同集（banned !== !enable），勿写反。
    const targetsToToggle = targets.filter((e) => e.banned !== !enable);
    // 注：`targetsToToggle` 恒非空（`enable` 由「是否全启用」派生，故 filter 必取到至少
    // 一项），无需空集早退分支——写了也是死代码。

    // ① 乐观翻转（单文件开关同款）：本地先翻 banned 位再重渲，IPC 在途即见结果。
    //    `.ck` 的 on/partial/空三态由 dirFlags 数据渲染派生，故重渲即得到正确视觉。
    for (const e of targetsToToggle) e.banned = !e.banned;
    invalidateBuildCache(vm.treeRenderCtx);
    vm._renderTree();
    // ② 进度可见 + ③ 失败回滚 + 收尾（withFooterProgress 保证四条出口都清槽；
    //    回滚守卫代数必须在 **await 之前**捕获：`stale(gen)` 判据是 `gen !== current`，
    //    拿 await 之后的 `current` 去问恒为 false——那是个死判据，单文件开关链同律）
    const rollbackGen = vm._guard.current;
    const r = await withFooterProgress(
      vm._root,
      (done, total) => t("tree.batchProgress", { action, done, total }),
      targetsToToggle.length,
      (onProgress) =>
        batchAllSettled(
          targetsToToggle.map(
            (e) => () =>
              ToggleEnable(e.fullPath).then(
                () => e,
                (err: unknown) => {
                  logWarn("tree", `toggleFolderBatch 失败: ${e.fullPath}`, err);
                  throw err;
                },
              ),
          ),
          undefined, // 缺省批大小（8）——保持与其余四条批量链同源
          onProgress,
        ),
    );
    const ok = r.fulfilled.length;
    const fail = r.rejected.length;
    // 失败项本地回滚（代际守卫：期间切类型/重载 → 旧 entries 引用上的写是过期写，
    // 新树自会由新数据渲染自洽）。成功项不回滚：下面用 _load 取磁盘真值校正。
    if (fail > 0 && !vm._guard.stale(rollbackGen)) {
      let dirty = false;
      for (const rej of r.rejected) {
        const e = targetsToToggle[rej.index];
        if (e) {
          e.banned = !e.banned;
          dirty = true;
        }
      }
      if (dirty) invalidateBuildCache(vm.treeRenderCtx);
    }
    if (ok > 0) {
      // ⚠️ 不直接信本地翻转，reload 取真值防幽灵状态（单文件链同律）
      const gen = vm._guard.current;
      await vm._load();
      // 渲染补齐 + 守卫（2026-09 收债）：原依赖 YSM 链 sync:toggle:status 的
      // tree:reload 兜底刷新——非 YSM 类型勾选态陈旧到下次任意重渲，sync 忙锁
      // 命中（sync.ts 入口拦）时 YSM 也会断；本地重渲走 buildCache 快路径
      if (vm._guard.stale(gen)) return;
      vm._renderTree();
      // ADR-339：带当前树类型发射，Go 侧按 dirLevelSync 过滤同步（非 dirLevelSync 自动 no-op）
      bus.emit("sync:toggle:status", { rtype: vm.snapshot.rootAttr || RESOURCE_TYPES.YSM });
    } else {
      // 全失败：上述回滚后的本地态即真值，无需为「什么都没变」付一次全量重扫
      vm._renderTree();
    }
    bus.emit("stats:refresh");
    toast(
      t("tree.folderToggleResult", { action, ok, fail }),
      TOAST_MS.long,
      fail > 0 ? "warn" : "success",
    );
  } catch (err) {
    toast(`${friendlyError(err, t("tree.batchToggleFail"))}`, TOAST_MS.long, "error");
  } finally {
    vm.toggleLock.finish(); // ADR-341：单文件开关/文件夹批量共用的同一把锁
  }
}

// ===== 主函数：纯分派，原签名不变 =====
export function bindTreeEvents(container: HTMLElement, vm: AppTree): () => void {
  const ctx: AtTeCtx = { container, vm, treeRenderCtx: vm.treeRenderCtx };

  const unsubs: (() => void)[] = [
    atTeBindRowDoubleClick(ctx),
    atTeBindContextMenu(ctx),
    atTeBindRenameInput(ctx),
  ];

  const onClick = (e: MouseEvent): void => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (atTeBindSelCheckboxes(ctx, e, target)) return;
    if (atTeBindRowClick(ctx, e, target)) return;
  };
  container.addEventListener("click", onClick);

  // 返回清理函数（供 disconnectedCallback 显式移除）
  return (): void => {
    container.removeEventListener("click", onClick);
    for (const fn of unsubs) fn();
  };
}
