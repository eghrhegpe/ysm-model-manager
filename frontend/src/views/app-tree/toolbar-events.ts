// ===== 工具栏事件绑定 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { currentRepoType } from "../../features/repo-rtype.ts";
import { bus } from "../../bus.ts";
import { flashBtn } from "../../utils/dom/feedback.ts";
import { spinnerHTML } from "./tpl.ts";
import { selectState } from "./data.ts";
import { modalAdvFilter, type AdvFilterValue } from "../../utils/dom/dialogs/adv-filter.ts";
import { updateSelectCount } from "./events.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { setRenderMode, type RenderMode } from "./render.ts";
import { getApp } from "../../backend/app.ts";
import { isWebPlatform } from "../../backend/platform-web.ts";
import { getAndroidBridge, isViewerMode } from "../../utils/dom/android-bridge.ts";
import { getExts } from "../../utils/resource/extensions.ts";
import { resolveAndroidRepoDir } from "../../utils/dom/directory-picker.ts";
import type { AppTree } from "./index.ts";
import type { AuthorInfo } from "./authors.ts";
// P1 修复（ADR-040）：搜索/筛选/导入逻辑已拆至 toolbar-search.ts
import { openAdvFilterDialog, pickWebFilesAndImport } from "./toolbar-search.ts";

type $Id = (id: string) => HTMLElement | null;

interface AtTlCtx {
  root: ShadowRoot;
  vm: AppTree;
  $: $Id;
}

async function atTlShowConfirm(
  vm: AppTree,
  api: () => Promise<string | null>,
  importByType: (rtype: string, path: string) => Promise<string>,
  rtype: string,
  successMsg: string,
): Promise<void> {
  const path = await api();
  if (!path) return;
  const errMsg = await importByType(rtype, path);
  if (errMsg) {
    bus.emit("toast:show", {
      msg: "❌ 导入失败: " + errMsg,
      duration: TOAST_MS.verbose,
      type: "warn",
    });
    return;
  }
  const gen = vm._gen;
  await vm._load();
  if (gen !== vm._gen) return;
  vm._renderTree();
  bus.emit("toast:show", {
    msg: "✅ " + successMsg,
    duration: TOAST_MS.success,
    type: "success",
  });
}

function fillAuthorMenu(
  menuAuthors: HTMLElement,
  vm: AppTree,
  $: $Id,
): void {
  if (menuAuthors.children.length) return;
  const authors: Array<AuthorInfo | string> = vm._authors || [];
  if (!authors.length) {
    menuAuthors.innerHTML =
      `<div style="padding:4px 10px;font-size:10px;color:var(--muted)">${t("tree.authorsEmpty")}</div>`;
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
    const rows = vm._root.getElementById("tree")?._vsRows || [];
    const visible = rows.filter((r) => r.type === "file");
    const keys = visible.map((r) => r.key).filter(Boolean);
    const allSelected = keys.every((k) => selectState.keys.has(k));
    keys.forEach((k) => {
      if (allSelected) selectState.keys.delete(k);
      else selectState.keys.add(k);
    });
    vm._renderTree();
    updateSelectCount(ctx.root);
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
    vm._sort = ($("sort") as HTMLSelectElement | null)?.value || "name";
    vm._renderTree();
  });
}

function atTlBindViewMode(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  const viewModeBtn = $("btn-view-mode");
  if (!viewModeBtn) return;
  viewModeBtn.textContent = vm._renderMode === "list" ? "▦" : "☰";
  viewModeBtn.addEventListener("click", () => {
    vm._renderMode = (vm._renderMode === "list" ? "grid" : "list") as RenderMode;
    setRenderMode(vm._renderMode);
    viewModeBtn.textContent = vm._renderMode === "list" ? "▦" : "☰";
    vm._renderTree();
    flashBtn(viewModeBtn);
  });
}

function atTlBindSearch(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  let srchTimer: ReturnType<typeof setTimeout> | null = null;
  $("srch")?.addEventListener("input", () => {
    vm._search = ($("srch") as HTMLInputElement | null)?.value || "";
    if (srchTimer) clearTimeout(srchTimer);
    srchTimer = setTimeout(() => {
      srchTimer = null;
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
        msg: "❌ " + friendlyError(e, "高级筛选失败"),
        duration: TOAST_MS.verbose,
        type: "error",
      });
    });
  });
  $("af-clear")?.addEventListener("click", () => {
    [
      "af-minBones",
      "af-maxBones",
      "af-minCubes",
      "af-maxCubes",
      "af-minTex",
      "af-maxTex",
    ].forEach((id) => {
      const el = $(id) as HTMLInputElement | null;
      if (el) el.value = "";
    });
    const srchEl = $("srch") as HTMLInputElement | null;
    if (srchEl) {
      srchEl.value = "";
      vm._search = "";
    }
    vm._filterPaths = null;
    vm._renderTree();
  });
}

function atTlBindAuthorMenu(ctx: AtTlCtx): void {
  const { vm, $ } = ctx;
  const menuAuthors = $("menu-authors");
  if (!menuAuthors) return;
  const ddWrap = menuAuthors.closest(".dd-wrap");
  if (!ddWrap) return;
  ddWrap.addEventListener("pointerenter", () =>
    fillAuthorMenu(menuAuthors, vm, $),
  );
  ddWrap.addEventListener("click", () =>
    fillAuthorMenu(menuAuthors, vm, $),
  );
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
  const rtype = vm._rootAttr || RESOURCE_TYPES.YSM;
  if (isViewerMode()) {
    await pickWebFilesAndImport(rtype, () => vm._load(), () => vm._renderTree());
    return;
  }
  const { SelectImportFile, ImportByType } = await getApp();
  const exts = getExts(rtype);
  const extFilter = exts.length ? exts.map((e) => "*" + e).join(";") : "*.*";
  await atTlShowConfirm(
    vm,
    () =>
      SelectImportFile(
        rtype + " 文件|" + extFilter,
        "选择" + rtype + "文件",
      ),
    ImportByType,
    rtype,
    "导入成功",
  );
}

async function atTlHandleImportDir(ctx: AtTlCtx): Promise<void> {
  const { vm } = ctx;
  const rtype = vm._rootAttr || RESOURCE_TYPES.YSM;
  if (isWebPlatform()) {
    const gen = vm._gen;
    await pickWebFilesAndImport(
      rtype,
      () => vm._load(),
      () => {
        if (vm._gen === gen) vm._renderTree();
      },
    );
    return;
  }
  if (isViewerMode()) {
    const dir = await resolveAndroidRepoDir();
    if (!dir) return;
    const gen = vm._gen;
    await vm._load();
    if (gen !== vm._gen) return;
    vm._renderTree();
    return;
  }
  const { SelectDirectory, ImportByType } = await getApp();
  await atTlShowConfirm(
    vm,
    () => SelectDirectory(),
    ImportByType,
    rtype,
    "文件夹导入成功",
  );
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
        if (!vm._filesRoot) return;
        const { OpenFolder } = await getApp();
        await OpenFolder(vm._filesRoot);
      } else if (action === "import-file") {
        await atTlHandleImportFile(ctx);
      } else if (action === "import-dir") {
        await atTlHandleImportDir(ctx);
      } else if (action === "refresh") {
        const tree = $("tree");
        if (tree) tree.innerHTML = spinnerHTML();
        const gen = vm._gen;
        await vm._load();
        if (gen !== vm._gen) return;
        vm._renderTree();
      } else if (action === "genindex") {
        const btn = item as HTMLButtonElement;
        btn.textContent = "⏳";
        btn.disabled = true;
        try {
          const { GenerateRepoIndex, GetRepoRoot } = await getApp();
          const filesRoot = await GetRepoRoot(currentRepoType());
          if (!filesRoot) {
            bus.emit("toast:show", {
              msg: "请先配置存储路径",
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
            msg: "✅ index.json 已生成",
            duration: TOAST_MS.normal,
            type: "success",
          });
        } catch (e) {
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e),
            duration: TOAST_MS.verbose,
            type: "error",
          });
        } finally {
          btn.textContent = "📇 生成索引";
          btn.disabled = false;
        }
      }
    })().catch((err) => {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(err),
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
