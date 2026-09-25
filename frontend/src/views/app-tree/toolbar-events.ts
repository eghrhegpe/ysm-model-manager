// ===== 工具栏事件绑定（表现层委托 → 命令表分派，ADR-298 D1）=====
//
// 本文件只做三件事：① 非下拉类控件（全选/仓库/排序/视图/搜索/筛选）的事件接线；
// ② 三个 .dd-wrap 下拉的通用控制器接管（展开/ARIA/键盘，见 utils/dom/dropdown.ts）；
// ③ `data-batch` / `data-more` 委托 → `runToolbarCommand` 表查找。
//
// 行为本体在 toolbar-commands.ts（命令注册表）；本文件不再持有任何菜单命令实现，
// 原 ~80 行内联 async if-else 链（open-folder/import-file/import-dir/refresh/genindex）
// 已整体迁入命令表，消灭「声明表裸字符串 ↔ 散落分派」的静默断链面。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { initDropdown } from "@/utils/dom/dropdown.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { flashBtn } from "@/utils/dom/feedback.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { AuthorInfo } from "./authors.ts";
import { updateSelectCount } from "./events.ts";
import type { AppTree } from "./index.ts";
import { getVsRows, type RenderMode } from "./render.ts";
import { runToolbarCommand } from "./toolbar-commands.ts";
// P1 修复（ADR-040）：搜索/筛选/导入逻辑已拆至 toolbar-search.ts
import { openAdvFilterDialog } from "./toolbar-search.ts";

type $Id = (id: string) => HTMLElement | null;

interface AtTlCtx {
  root: ShadowRoot;
  vm: AppTree;
  $: $Id;
}

/** 每次展开重填（原 children.length 缓存闸已退役：_authors 异步加载完成前误触一次
 *  即永久缓存「暂无作者」占位——竞态根修，见 ADR-238 无障碍统一 / dropdown onOpen 契约） */
function fillAuthorMenu(menuAuthors: HTMLElement, vm: AppTree, $: $Id): void {
  menuAuthors.replaceChildren();
  const authors: Array<AuthorInfo | string> = vm._authors || [];
  if (!authors.length) {
    menuAuthors.innerHTML = `<div style="padding:var(--btn-padding-std);font-size:var(--fs-xs);color:var(--muted)">${t("tree.authorsEmpty")}</div>`;
    return;
  }
  authors.forEach((a) => {
    const name = typeof a === "string" ? a : a.Name || "";
    const count = typeof a === "object" ? a.Count || 0 : 0;
    if (!name) return;
    const btn = document.createElement("button");
    btn.className = "dd-item";
    btn.dataset.author = name;
    btn.textContent = name + (count ? ` (${count})` : "");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const srch = $("srch") as HTMLInputElement | null;
      if (srch) {
        srch.value = name;
        srch.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    menuAuthors.appendChild(btn);
  });
}

function atTlBindSelectAll(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  const selAllBtn = $("sel-all");
  if (!selAllBtn) return;
  selAllBtn.addEventListener("click", () => {
    const treeEl = vm._root.getElementById("tree");
    const rows = treeEl ? getVsRows(vm.treeRenderCtx, treeEl) : [];
    const visible = rows.filter((r) => r.type === "file");
    const keys = visible.map((r) => r.key).filter(Boolean);
    const allSelected = keys.every((k) => vm.selectState.keys.has(k));
    keys.forEach((k) => {
      if (allSelected) vm.selectState.keys.delete(k);
      else vm.selectState.keys.add(k);
    });
    vm._renderTree();
    updateSelectCount(ctx.root, vm.selectState);
    flashBtn(selAllBtn);
  });
}

function atTlBindRepoSwitch(ctx: AtTlCtx): void {
  const { $ } = ctx;
  $("btn-repo")?.addEventListener("click", () => {
    bus.emit("nav:changed", { page: "settings" });
  });
}

function atTlBindSortToggle(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  $("sort")?.addEventListener("change", () => {
    vm.setSort(($("sort") as HTMLSelectElement | null)?.value || "name");
    vm._renderTree();
  });
}

function atTlBindViewMode(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  const viewModeBtn = $("btn-view-mode");
  if (!viewModeBtn) return;
  // 图标一律走 UI_ICONS 常量 + 三元选择（红线 R8 白名单形态，勿拼模板串）；
  // 原 textContent="☰"/"▦" 文本字符在绑定瞬间处决模板渲染的 SVG，双轨打架（ADR-238 结案）
  // 借用说明：图标集无独立「列表」语义名（2026-09 审计登记），列表态借用 menu（☰
  // 即列表/汉堡）；图标集补入 list 字形后改此处与 icon-map 对拍，勿擅改。
  const applyViewModeIcon = (mode: RenderMode): void => {
    const icon = mode === "list" ? UI_ICONS.grid : UI_ICONS.menu;
    viewModeBtn.innerHTML = icon;
  };
  applyViewModeIcon(vm.snapshot.renderMode);
  viewModeBtn.addEventListener("click", () => {
    const next = (vm.snapshot.renderMode === "list" ? "grid" : "list") as RenderMode;
    vm.setRenderMode(next);
    applyViewModeIcon(next);
    vm._renderTree();
    flashBtn(viewModeBtn);
  });
}

function atTlBindSearch(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  $("srch")?.addEventListener("input", () => {
    vm.setSearch(($("srch") as HTMLInputElement | null)?.value || "");
    if (vm._searchTimer) clearTimeout(vm._searchTimer);
    vm._searchTimer = setTimeout(() => {
      vm._searchTimer = null;
      vm._renderTree();
    }, 150);
  });
}

function atTlBindAdvFilter(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  const advBtn = $("btn-adv-filter");
  advBtn?.addEventListener("click", () => {
    dbg("adv-filter", "btn:click");
    openAdvFilterDialog($, vm).catch((e) => {
      bus.emit("toast:show", {
        msg: `${friendlyError(e, t("tree.advFilterFail"))}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    });
  });
  // 清除入口 = 模态框 afv-clear（cleared 回执 → advFilterClearAll 全清）；
  // 命令表落地后以 tree.filter.clear 命令复活（ADR-298 D1 挂载点已备）
}

function atTlBindAuthorMenu(ctx: AtTlCtx): () => void {
  const { vm, $ } = ctx;
  const menuAuthors = $("menu-authors");
  const ddWrap = menuAuthors ? (menuAuthors.closest(".dd-wrap") as HTMLElement | null) : null;
  if (!ddWrap || !menuAuthors) return () => {};
  // 展开/收起/键盘/ARIA 全权交通用控制器；onOpen 每次展开重填（替代原
  // pointerenter + click 双填 + children.length 缓存闸，竞态根修）
  return initDropdown(ddWrap, { onOpen: () => fillAuthorMenu(menuAuthors, vm, $) });
}

/**
 * 下拉菜单项统一委托 → 命令表（ADR-298 D1）。
 *
 * 原实现是 batch 逐按钮 `addEventListener` + more 容器委托 + ~80 行内联 if-else 两种范式；
 * 现统一为「容器委托 → `data-batch`/`data-more` 取值 → 命令表查找」。
 * `stopPropagation` 保留：防冒泡到 wrap 触发收起逻辑（收起由 dropdown 控制器承担）。
 */
function atTlBindMenuCommands(ctx: AtTlCtx): void {
  const { $ } = ctx;
  const menuBatch = $("menu-batch");
  const menuMore = $("menu-more");
  const dispatch = (e: Event, attr: "batch" | "more"): void => {
    const target = e.target as HTMLElement | null;
    const item = target?.closest(`[data-${attr}]`) as HTMLElement | null;
    if (!item) return;
    e.stopPropagation();
    const action = attr === "batch" ? item.dataset.batch : item.dataset.more;
    if (!action) return;
    runToolbarCommand(action, { vm: ctx.vm, $ }, item);
  };
  menuBatch?.addEventListener("click", (e) => dispatch(e, "batch"));
  menuMore?.addEventListener("click", (e) => dispatch(e, "more"));
}

export function bindToolbarEvents(root: ShadowRoot, vm: AppTree): () => void {
  const $: $Id = (id) => root.getElementById(id);
  const ctx: AtTlCtx = { root, vm, $ };

  atTlBindSelectAll(ctx);
  atTlBindRepoSwitch(ctx);
  atTlBindSortToggle(ctx);
  atTlBindViewMode(ctx);
  atTlBindSearch(ctx);
  atTlBindAdvFilter(ctx);
  // 三个 .dd-wrap 下拉统一交通用控制器（ADR-298 D3）：
  // click 展开/收起 + ARIA 落位 + 键盘导航 + 外点关闭 + 互斥；
  // 原 hover 展开（dropdownHoverCSS）已退役——触屏生产形态（Android/viewer）下
  // hover 语义不成立，键盘此前完全无法打开菜单。
  // 命令委托（atTlBindMenuCommands）绑在菜单容器自身，
  // 生命周期随 shadow 内容重建（_renderLayout）自然终结，无泄漏面。
  const disposeAuthors = atTlBindAuthorMenu(ctx);
  const disposeBatch = initDropdown($("dd-batch"));
  const disposeMore = initDropdown($("dd-more"));
  atTlBindMenuCommands(ctx);
  return () => {
    disposeAuthors();
    disposeBatch();
    disposeMore();
  };
}
