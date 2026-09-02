// ===== toolbar-search.ts — 工具栏搜索/筛选/导入逻辑（从 toolbar-events.ts 拆出，ADR-040 P1）=====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { bus } from "../../bus.ts";
import { getExts } from "../../utils/resource/extensions.ts";
import { modalAdvFilter, type AdvFilterValue } from "../../utils/dom/dialogs/adv-filter.ts";
import { dbg } from "../../utils/debug/debug.ts";
import { isWebPlatform } from "../../backend/platform-web.ts";
import { importWebFiles } from "../../backend/browser-adapter.ts";
// 网页版数值条件降级标记消费（web-stats.ts 经 browserAdapter 链 re-export——与
// searchWebModels 同一模块实例；Worker 批量统计不可用时置位，此处 toast 提示）
import { consumeWebSearchDegraded, onStatsProgress, getStatsPoolSize } from "../../backend/browser-adapter.ts";
import type { AppTree } from "./index.ts";
import { getApp } from "../../backend/app.ts";

type $Id = (id: string) => HTMLElement | null;

// --- 多线程统计角标（网页版证明 off-main-thread：主线程 + stats Worker 并行）---
// 右下角 fixed 小角标：数值条件搜索时显示 "🧵×2 ⚙️ x/y"（Worker 批进度），
// 统计完成隐藏；Worker 降级时短暂显示 ⚠️ 提示。仅 web 模式（isWebPlatform）创建。
let statsBadge: HTMLElement | null = null;

function showStatsBadge(html: string): void {
  if (!statsBadge) {
    statsBadge = document.createElement("div");
    statsBadge.id = "web-stats-badge";
    statsBadge.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:9999;padding:4px 10px;border-radius:8px;" +
      "font-size:12px;font-family:monospace;background:rgba(0,0,0,.72);color:#7ee787;" +
      "border:1px solid rgba(126,231,135,.4);pointer-events:none;user-select:none";
    document.body.appendChild(statsBadge);
  }
  statsBadge.innerHTML = html;
  statsBadge.style.display = "";
}

function hideStatsBadge(): void {
  if (statsBadge) statsBadge.style.display = "none";
}

// --- advFilter* = dialog-adv-filter 子函数（openAdvFilterDialog 按 8 段拆出）---

function advFilterIsUnset(v: unknown): boolean {
  return v == null || v === "";
}

function advFilterToNum(v: unknown): number {
  return v == null ? 0 : parseInt(String(v), 10) || 0;
}

function advFilterHasNumRange(rv: AdvFilterValue): boolean {
  return (
    !advFilterIsUnset(rv.minBones) ||
    !advFilterIsUnset(rv.maxBones) ||
    !advFilterIsUnset(rv.minCubes) ||
    !advFilterIsUnset(rv.maxCubes) ||
    !advFilterIsUnset(rv.minTex) ||
    !advFilterIsUnset(rv.maxTex)
  );
}

function advFilterHasRange(rv: AdvFilterValue, kw: string): boolean {
  return advFilterHasNumRange(rv) || !!kw;
}

async function advFilterReadCurAndOpenDialog($: $Id): Promise<AdvFilterValue | null> {
  const $v = (id: string): string => ($(id) as HTMLInputElement | null)?.value || "";
  const cur: Record<string, string> = {
    keyword: $v("srch"),
    minBones: $v("af-minBones"),
    maxBones: $v("af-maxBones"),
    minCubes: $v("af-minCubes"),
    maxCubes: $v("af-maxCubes"),
    minTex: $v("af-minTex"),
    maxTex: $v("af-maxTex"),
  };
  dbg("adv-filter", "dialog:open", { cur });
  const result = await modalAdvFilter({
    value: cur as unknown as Partial<AdvFilterValue>,
  });
  dbg("adv-filter", "dialog:return", { result });
  if (!result) {
    dbg("adv-filter", "dialog:cancelled-or-null");
    return null;
  }
  return result as AdvFilterValue;
}

interface advFilterBackfillResult {
  kw: string;
  hasTag: boolean;
  hasNumRange: boolean;
  isAllEmpty: boolean;
}

function advFilterBackfillInlinePanel(
  $: $Id,
  rv: AdvFilterValue,
  vm: AppTree,
): advFilterBackfillResult {
  const setVal = (id: string, v: unknown): void => {
    const el = $(id) as HTMLInputElement | null;
    if (el) el.value = v == null ? "" : String(v);
  };
  setVal("af-minBones", rv.minBones);
  setVal("af-maxBones", rv.maxBones);
  setVal("af-minCubes", rv.minCubes);
  setVal("af-maxCubes", rv.maxCubes);
  setVal("af-minTex", rv.minTex);
  setVal("af-maxTex", rv.maxTex);
  const srchEl = $("srch") as HTMLInputElement | null;
  if (srchEl && rv.keyword !== undefined) {
    srchEl.value = rv.keyword;
    vm._search = rv.keyword;
  }
  const kw = srchEl?.value || "";
  const hasTag = !!(rv.tag && !(rv.tag === ""));
  const hasNumRange = advFilterHasNumRange(rv);
  const isAllEmpty =
    !kw &&
    !hasTag &&
    advFilterIsUnset(rv.minBones) &&
    advFilterIsUnset(rv.maxBones) &&
    advFilterIsUnset(rv.minCubes) &&
    advFilterIsUnset(rv.maxCubes) &&
    advFilterIsUnset(rv.minTex) &&
    advFilterIsUnset(rv.maxTex);
  return { kw, hasTag, hasNumRange, isAllEmpty };
}

function advFilterEarlyEmpty(vm: AppTree): void {
  vm._filterPaths = null;
  vm._renderTree();
}

async function advFilterFetchTagPaths(tag: string): Promise<Set<string> | null> {
  try {
    const { ListByTag } = await getApp();
    const paths = await ListByTag(tag);
    return new Set(paths || []);
  } catch (e) {
    bus.emit("toast:show", {
      msg: t("tree.tagQueryFail", { msg: friendlyError(e) }),
      duration: TOAST_MS.verbose,
      type: "error",
    });
    return null;
  }
}

type advFilterSearchResult = Set<string> | "cancel" | "error";

async function advFilterSearchModelPaths(
  vm: AppTree,
  rv: AdvFilterValue,
  kw: string,
  hasNumRange: boolean,
): Promise<advFilterSearchResult> {
  const filesRoot = vm._filesRoot;
  if (!filesRoot) {
    bus.emit("toast:show", {
      msg: t("tree.needRepoDir"),
      duration: TOAST_MS.success,
      type: "warn",
    });
    return "cancel";
  }
  const isWebNum = isWebPlatform() && hasNumRange;
  const poolN = getStatsPoolSize();
  if (isWebNum) {
    showStatsBadge(t("tree.statsBadgePreparing", { n: poolN }));
    onStatsProgress((done, total) => {
      showStatsBadge(`🧵×${poolN} ⚙️ ${done}/${total}`);
    });
  }
  try {
    const { SearchModels } = await getApp();
    const results = await SearchModels(
      filesRoot,
      kw,
      advFilterToNum(rv.minBones),
      advFilterToNum(rv.maxBones),
      advFilterToNum(rv.minCubes),
      advFilterToNum(rv.maxCubes),
      advFilterToNum(rv.minTex),
      advFilterToNum(rv.maxTex),
    );
    return results?.length ? new Set(results.map((r) => r.path)) : new Set();
  } catch (e: unknown) {
    dbg("adv-filter", "search:error", { err: String(e) });
    bus.emit("toast:show", {
      msg: "❌ " + t("tree.advFilterFail") + ": " + friendlyError(e),
      duration: TOAST_MS.long,
      type: "error",
    });
    return "error";
  } finally {
    if (isWebNum) {
      onStatsProgress(null);
      hideStatsBadge();
    }
  }
}

function advFilterWarnWebDegraded(hasNumRange: boolean): void {
  if (isWebPlatform() && hasNumRange && consumeWebSearchDegraded()) {
    bus.emit("toast:show", {
      msg: t("tree.webStatsDegraded"),
      duration: TOAST_MS.normal,
      type: "warn",
    });
    showStatsBadge(t("tree.statsBadgeDegraded"));
    setTimeout(hideStatsBadge, 3000);
  }
}

function advFilterIntersectPaths(
  vm: AppTree,
  tagPaths: Set<string> | null,
  modelPaths: Set<string> | null,
): void {
  if (tagPaths && modelPaths) {
    vm._filterPaths = new Set([...tagPaths].filter((p) => modelPaths.has(p)));
  } else if (tagPaths) {
    vm._filterPaths = tagPaths;
  } else if (modelPaths) {
    vm._filterPaths = modelPaths;
  } else {
    vm._filterPaths = null;
  }
}

function advFilterToastAndRender(vm: AppTree): void {
  const size = vm._filterPaths?.size ?? 0;
  if (size > 0) {
    bus.emit("toast:show", {
      msg: t("tree.filterFound", { n: size }),
      duration: TOAST_MS.quick,
      type: "success",
    });
  } else if (vm._filterPaths && size === 0) {
    bus.emit("toast:show", {
      msg: t("tree.filterNone"),
      duration: TOAST_MS.success,
      type: "warn",
    });
  }
  vm._renderTree();
}

// 打开弹窗版筛选器（应用结果到 inline 面板 + 后端搜索）
export async function openAdvFilterDialog($: $Id, vm: AppTree): Promise<void> {
  dbg("adv-filter", "open:start", { filesRoot: vm._filesRoot });
  const rv = await advFilterReadCurAndOpenDialog($);
  if (!rv) return;

  const { kw, hasTag, hasNumRange, isAllEmpty } = advFilterBackfillInlinePanel($, rv, vm);
  if (isAllEmpty) {
    advFilterEarlyEmpty(vm);
    return;
  }

  let tagPaths: Set<string> | null = null;
  if (hasTag) {
    tagPaths = await advFilterFetchTagPaths(rv.tag!);
  }

  let modelPaths: Set<string> | null = null;
  if (advFilterHasRange(rv, kw)) {
    const r = await advFilterSearchModelPaths(vm, rv, kw, hasNumRange);
    if (r === "cancel") return;
    if (r === "error") {
      advFilterEarlyEmpty(vm);
      return;
    }
    modelPaths = r;
  }

  advFilterWarnWebDegraded(hasNumRange);
  advFilterIntersectPaths(vm, tagPaths, modelPaths);
  advFilterToastAndRender(vm);
}

// 网页版「导入文件」：桌面走 SelectImportFile（Wails 原生对话框）；网页版无该 binding →
// 用浏览器 <input type=file> 触发选择，importWebFiles 直写 IndexedDB，导入完成后回调刷新。
export async function pickWebFilesAndImport(
  rtype: string,
  onLoaded: () => Promise<void>,
  onRendered: () => void,
): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  const exts = getExts(rtype);
  input.accept = exts.length ? exts.join(",") : "*.*";
  input.addEventListener("change", () => {
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    void (async () => {
      try {
        const r = await importWebFiles(files, rtype);
        await onLoaded();
        onRendered();
        bus.emit("toast:show", {
          msg:
            r.failed > 0
              ? t("tree.webImportPartial", { imported: r.imported, failed: r.failed })
              : t("tree.webImportOk", { imported: r.imported }),
          duration: TOAST_MS.verbose,
          type: r.failed > 0 ? "warn" : "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e),
          duration: TOAST_MS.verbose,
          type: "error",
        });
      }
    })();
  });
  input.click();
}
