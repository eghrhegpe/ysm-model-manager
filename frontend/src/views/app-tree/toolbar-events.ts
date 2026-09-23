// ===== 工具栏事件绑定 =====

import { resolveAndroidRepoDir } from "@/backend/directory-picker.ts";
import { isViewerMode } from "@/backend/platform.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { currentRepoType } from "@/features/repo/repo-rtype.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { flashBtn } from "@/utils/dom/feedback.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { getExts } from "@/utils/resource/extensions.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { AuthorInfo } from "./authors.ts";
import { updateSelectCount } from "./events.ts";
import type { AppTree } from "./index.ts";
import { getVsRows, type RenderMode } from "./render.ts";
// P1 修复（ADR-040）：搜索/筛选/导入逻辑已拆至 toolbar-search.ts
import { openAdvFilterDialog, pickWebFilesAndImport } from "./toolbar-search.ts";
import { spinnerHTML } from "./tpl.ts";

type $Id = (id: string) => HTMLElement | null;

interface AtTlCtx {
  root: ShadowRoot;
  vm: AppTree;
  $: $Id;
}

async function atTlShowConfirm(
  vm: AppTree,
  api: () => Promise<string | null>,
  importByType: (rtype: string, path: string) => Promise<unknown>,
  rtype: string,
  successMsg: string,
): Promise<void> {
  const path = await api();
  if (!path) return;
  // Go 侧 ImportByType 返回 error（非 string）：bindings 为 Promise<void>，
  // 失败走 reject（@wailsio/runtime Call 语义），必须 try/catch 捕获，
  // 不能用 resolve 值判错（那是旧 string 签名时代的残留，失败路径永远进不去）。
  try {
    await importByType(rtype, path);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    bus.emit("toast:show", {
      msg: t("tree.importFail", { msg: errMsg }),
      duration: TOAST_MS.verbose,
      type: "warn",
    });
    return;
  }
  const gen = vm._guard.current;
  await vm._load();
  if (vm._guard.stale(gen)) return;
  vm._renderTree();
  bus.emit("toast:show", {
    msg: `✅ ${successMsg}`,
    duration: TOAST_MS.success,
    type: "success",
  });
}

function fillAuthorMenu(menuAuthors: HTMLElement, vm: AppTree, $: $Id): void {
  if (menuAuthors.children.length) return;
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
  viewModeBtn.textContent = vm.snapshot.renderMode === "list" ? "▦" : "☰";
  viewModeBtn.addEventListener("click", () => {
    const next = (vm.snapshot.renderMode === "list" ? "grid" : "list") as RenderMode;
    vm.setRenderMode(next);
    viewModeBtn.textContent = next === "list" ? "▦" : "☰";
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
        msg: `❌ ${friendlyError(e, t("tree.advFilterFail"))}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    });
  });
  // 原 #af-clear 死绑定已随僵尸面板退役：清除入口 = 模态框 afv-clear（cleared 回执
  // → advFilterClearAll 全清），未来命令表化时以 tree.filter.clear 命令复活。
}

function atTlBindAuthorMenu(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  const menuAuthors = $("menu-authors");
  if (!menuAuthors) return;
  const ddWrap = menuAuthors.closest(".dd-wrap");
  if (!ddWrap) return;
  ddWrap.addEventListener("pointerenter", () => fillAuthorMenu(menuAuthors, vm, $));
  ddWrap.addEventListener("click", () => fillAuthorMenu(menuAuthors, vm, $));
}

function atTlBindBatchMenu(ctx: AtTlCtx): void {
  const { $ } = ctx;
  const menuBatch = $("menu-batch");
  if (!menuBatch) return;
  menuBatch.querySelectorAll("[data-batch]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.batch;
      if (action === "enable-all") bus.emit("batch:enable-all");
      else if (action === "disable-all") bus.emit("batch:disable-all");
    });
  });
}

async function atTlHandleImportFile(ctx: AtTlCtx): Promise<void> {
  const { vm } = ctx;
  const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
  if (isViewerMode()) {
    await pickWebFilesAndImport(
      rtype,
      () => vm._load(),
      () => vm._renderTree(),
    );
    return;
  }
  const { SelectImportFile, ImportByType } = await backendGetApp();
  const exts = getExts(rtype);
  const extFilter = exts.length ? exts.map((e) => `*${e}`).join(";") : "*.*";
  await atTlShowConfirm(
    vm,
    () =>
      SelectImportFile(
        `${t("tree.importFileFilter", { rtype })}|${extFilter}`,
        t("tree.selectFileTitle", { rtype }),
      ),
    ImportByType,
    rtype,
    t("tree.importOk"),
  );
}

async function atTlHandleImportDir(ctx: AtTlCtx): Promise<void> {
  const { vm } = ctx;
  const rtype = vm.snapshot.rootAttr || RESOURCE_TYPES.YSM;
  if (isWebPlatform()) {
    const gen = vm._guard.current;
    await pickWebFilesAndImport(
      rtype,
      () => vm._load(),
      () => {
        if (!vm._guard.stale(gen)) vm._renderTree();
      },
    );
    return;
  }
  if (isViewerMode()) {
    const dir = await resolveAndroidRepoDir();
    if (!dir) return;
    const gen = vm._guard.current;
    await vm._load();
    if (vm._guard.stale(gen)) return;
    vm._renderTree();
    return;
  }
  const { SelectDirectory, ImportByType } = await backendGetApp();
  await atTlShowConfirm(vm, () => SelectDirectory(), ImportByType, rtype, t("tree.importDirOk"));
}

function atTlBindMoreMenu(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  const menuMore = $("menu-more");
  if (!menuMore) return;
  menuMore.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const item = target ? target.closest("[data-more]") : null;
    if (!item) return;
    e.stopPropagation();
    const action = (item as HTMLElement).dataset.more;
    void (async (): Promise<void> => {
      if (action === "open-folder") {
        if (isViewerMode()) {
          await resolveAndroidRepoDir();
          return;
        }
        if (!vm.snapshot.filesRoot) return;
        const { OpenFolder } = await backendGetApp();
        await OpenFolder(vm.snapshot.filesRoot);
      } else if (action === "import-file") {
        await atTlHandleImportFile(ctx);
      } else if (action === "import-dir") {
        await atTlHandleImportDir(ctx);
      } else if (action === "refresh") {
        const tree = $("tree");
        if (tree) tree.innerHTML = spinnerHTML();
        const gen = vm._guard.current;
        await vm._load();
        if (vm._guard.stale(gen)) return;
        vm._renderTree();
      } else if (action === "genindex") {
        const btn = item as HTMLButtonElement;
        btn.innerHTML = UI_ICONS.refresh;
        btn.disabled = true;
        try {
          const { GenerateRepoIndex, GetRepoRoot } = await backendGetApp();
          const filesRoot = await GetRepoRoot(currentRepoType());
          if (!filesRoot) {
            bus.emit("toast:show", {
              msg: t("tree.needStoragePath"),
              duration: TOAST_MS.success,
              type: "warn",
            });
            return;
          }
          const idx = await GenerateRepoIndex(filesRoot);
          if (isWebPlatform() && typeof idx === "string") {
            const blob = new Blob([idx], { type: "application/json;charset=utf-8" });
            const a = document.createElement("a");
            a.download = "index.json";
            a.href = URL.createObjectURL(blob);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
          }
          bus.emit("toast:show", {
            msg: t("tree.indexGenerated"),
            duration: TOAST_MS.normal,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: `❌ ${friendlyError(e)}`,
            duration: TOAST_MS.verbose,
            type: "error",
          });
        } finally {
          btn.textContent = t("tree.moreGenIndex");
          btn.disabled = false;
        }
      }
    })().catch((err) => {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(err)}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    });
  });
}

export function bindToolbarEvents(root: ShadowRoot, vm: AppTree): void {
  const $: $Id = (id) => root.getElementById(id);
  const ctx: AtTlCtx = { root, vm, $ };

  atTlBindSelectAll(ctx);
  atTlBindRepoSwitch(ctx);
  atTlBindSortToggle(ctx);
  atTlBindViewMode(ctx);
  atTlBindSearch(ctx);
  atTlBindAdvFilter(ctx);
  atTlBindAuthorMenu(ctx);
  atTlBindBatchMenu(ctx);
  atTlBindMoreMenu(ctx);
}
