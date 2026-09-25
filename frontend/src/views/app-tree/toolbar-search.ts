// ===== toolbar-search.ts — 工具栏搜索/筛选/导入逻辑（从 toolbar-events.ts 拆出，ADR-040 P1）=====

// 网页版数值条件降级标记消费（web-stats.ts 经 browserAdapter 链 re-export——与
// searchWebModels 同一模块实例；Worker 批量统计不可用时置位，此处 toast 提示）
import {
  consumeWebSearchDegraded,
  getStatsPoolSize,
  importWebFiles,
  onStatsProgress,
} from "@/backend/browser-adapter.ts";
import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import {
  type AdvFilterResult,
  type AdvFilterValue,
  modalAdvFilter,
} from "@/features/dialogs/adv-filter.ts";
import type { AppliedAdvFilter } from "@/features/dialogs/adv-filter-util.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import type { UiIconName } from "@/utils/icon/ui-icons.ts";
import { getExts } from "@/utils/resource/extensions.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { AppTree } from "./index.ts";
import { advFilterTpl } from "./tpl-adv-filter.ts";

// P1 批次11:统计角标样式(cssText 抽类;挂 document.body light DOM,head 注入适用)
const tsCss = `
.ts-badge { position:fixed; right:12px; bottom:12px; z-index:var(--z-fullscreen); padding:var(--btn-padding-std); border-radius:var(--radius-lg); font-size:var(--fs-base); font-family:monospace; background:rgba(0,0,0,.72); color:var(--status-success); border:1px solid color-mix(in srgb, var(--status-success) 40%, transparent); pointer-events:none; user-select:none; } /* 审计 P2-4：z-index 走 --z-fullscreen（9999） */
`;
let _tsBadgeStylesInjected = false;
function ensureTsBadgeStyles(): void {
  if (_tsBadgeStylesInjected) return;
  _tsBadgeStylesInjected = true;
  const el = document.createElement("style");
  el.textContent = tsCss;
  document.head.appendChild(el);
}

type $Id = (id: string) => HTMLElement | null;

// --- 多线程统计角标（网页版证明 off-main-thread：主线程 + stats Worker 并行）---
// 右下角 fixed 小角标：数值条件搜索时显示 "🧵×2 ⚙️ x/y"（Worker 批进度），
// 统计完成隐藏；Worker 降级时短暂显示 ⚠️ 提示。仅 web 模式（isWebPlatform）创建。
// 模块级单例 by-design：全局 light DOM 角标，跨组件挂载复用同一节点（hide 走 display:none
// 而非 remove，避免重复创建/样式重注入）；非越权全局状态，无 reset 路径属故意豁免
// （对照红线要求：模块级可变 let 须有 reset 或注释豁免——此处为注释豁免）。
let statsBadge: HTMLElement | null = null;

function showStatsBadge(text: string, icon?: UiIconName): void {
  if (!statsBadge) {
    statsBadge = document.createElement("div");
    statsBadge.id = "web-stats-badge";
    ensureTsBadgeStyles(); // P1 批次11:cssText 抽类注入(幂等)
    statsBadge.className = "ts-badge"; // 规则在文件头 tsCss;show/hide 的 style.display 属性级保留
    document.body.appendChild(statsBadge);
  }
  // 图标只喂 resolveIcon 产物（内部常量 SVG），永不是用户数据；文本走 esc() 文本槽
  statsBadge.innerHTML = `${icon ? `${resolveIcon(icon)} ` : ""}${esc(text)}`;
  statsBadge.style.display = "";
}

function hideStatsBadge(): void {
  if (statsBadge) statsBadge.style.display = "none";
}

// 高级筛选状态：advFilter* 子函数（openAdvFilterDialog 按段拆出）
// 状态真相源 = vm（TreeState.advFilter + search），不再寄生 #adv-filter 隐藏 input
// （23d8868f9 状态容器化的补票；面板 DOM 已退役）。

/** 条件是否视为未设置（null / undefined / 空串 → 不限制） */
function advFilterIsUnset(v: unknown): boolean {
  return v == null || v === "";
}

/** 数值条件 → SearchModels 实参（未设置 = 0，Go 侧语义 0 即不限制） */
function advFilterToNum(v: unknown): number {
  return v == null ? 0 : parseInt(String(v), 10) || 0;
}

function advFilterHasNumRange(adv: Partial<AppliedAdvFilter>): boolean {
  return (
    !advFilterIsUnset(adv.minBones) ||
    !advFilterIsUnset(adv.maxBones) ||
    !advFilterIsUnset(adv.minCubes) ||
    !advFilterIsUnset(adv.maxCubes) ||
    !advFilterIsUnset(adv.minTex) ||
    !advFilterIsUnset(adv.maxTex)
  );
}

function advFilterHasRange(adv: Partial<AppliedAdvFilter>, kw: string): boolean {
  return advFilterHasNumRange(adv) || !!kw;
}

/** 打开模态框：预填 = vm 已应用态（数值六范围 + 标签 + 关键词）；取消返回 null */
async function advFilterReadCurAndOpenDialog(vm: AppTree): Promise<AdvFilterResult> {
  const adv = vm.snapshot.advFilter;
  const cur: Partial<AdvFilterValue> = {
    keyword: vm.snapshot.search,
    minBones: adv.minBones,
    maxBones: adv.maxBones,
    minCubes: adv.minCubes,
    maxCubes: adv.maxCubes,
    minTex: adv.minTex,
    maxTex: adv.maxTex,
    tag: adv.tag,
  };
  dbg("adv-filter", "dialog:open", { cur });
  const result = await modalAdvFilter({ value: cur, tpl: advFilterTpl });
  dbg("adv-filter", "dialog:return", { result });
  if (!result) {
    dbg("adv-filter", "dialog:cancelled-or-null");
    return null;
  }
  return result;
}

/** 把模态框应用结果写回 vm 态（advFilter + keyword→search），并派生判定量 */
function advFilterApplyResult(
  $: $Id,
  rv: AdvFilterValue,
  vm: AppTree,
): { kw: string; hasTag: boolean; hasNumRange: boolean; isAllEmpty: boolean } {
  vm.setAdvFilter({
    minBones: rv.minBones,
    maxBones: rv.maxBones,
    minCubes: rv.minCubes,
    maxCubes: rv.maxCubes,
    minTex: rv.minTex,
    maxTex: rv.maxTex,
    tag: rv.tag,
  });
  const srchEl = $("srch") as HTMLInputElement | null;
  if (srchEl && rv.keyword !== undefined) {
    srchEl.value = rv.keyword;
    vm.setSearch(rv.keyword);
  }
  const kw = rv.keyword ?? "";
  const hasTag = !!rv.tag;
  const hasNumRange = advFilterHasNumRange(rv);
  const isAllEmpty = !kw && !hasTag && !hasNumRange;
  return { kw, hasTag, hasNumRange, isAllEmpty };
}

/**
 * tree.filter.clear 语义：关键词 + 高级条件 + 结果集全清并重渲染。
 * 供模态框 cleared 回执复用；C 案命令表落地后即 tree.filter.clear 命令本体。
 */
export function advFilterClearAll($: $Id, vm: AppTree): void {
  const srchEl = $("srch") as HTMLInputElement | null;
  if (srchEl) srchEl.value = "";
  vm.setSearch("");
  vm.setAdvFilter({
    minBones: null,
    maxBones: null,
    minCubes: null,
    maxCubes: null,
    minTex: null,
    maxTex: null,
    tag: "",
  });
  vm.setFilterPaths(null);
  vm._renderTree();
}

function advFilterEarlyEmpty(vm: AppTree): void {
  vm.setFilterPaths(null);
  vm._renderTree();
}

async function advFilterFetchTagPaths(tag: string): Promise<Set<string> | null> {
  try {
    const { ListByTag } = await backendGetApp();
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
  const filesRoot = vm.snapshot.filesRoot;
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
    showStatsBadge(t("tree.statsBadgePreparing", { n: poolN }), "diagnose");
    onStatsProgress((done, total) => {
      showStatsBadge(`${t("tree.statsBadgeWorkers", { n: poolN })} · ${done}/${total}`, "diagnose");
    });
  }
  try {
    const { SearchModels } = await backendGetApp();
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
      msg: `${t("tree.advFilterFail")}: ${friendlyError(e)}`,
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
    showStatsBadge(t("tree.statsBadgeDegraded"), "warning");
    setTimeout(hideStatsBadge, 3000);
  }
}

function advFilterIntersectPaths(
  vm: AppTree,
  tagPaths: Set<string> | null,
  modelPaths: Set<string> | null,
): void {
  if (tagPaths && modelPaths) {
    vm.setFilterPaths(new Set([...tagPaths].filter((p) => modelPaths.has(p))));
  } else if (tagPaths) {
    vm.setFilterPaths(tagPaths);
  } else if (modelPaths) {
    vm.setFilterPaths(modelPaths);
  } else {
    vm.setFilterPaths(null);
  }
}

function advFilterToastAndRender(vm: AppTree): void {
  const size = vm.snapshot.filterPaths?.size ?? 0;
  if (size > 0) {
    bus.emit("toast:show", {
      msg: t("tree.filterFound", { n: size }),
      duration: TOAST_MS.quick,
      type: "success",
    });
  } else if (vm.snapshot.filterPaths && size === 0) {
    bus.emit("toast:show", {
      msg: t("tree.filterNone"),
      duration: TOAST_MS.success,
      type: "warn",
    });
  }
  vm._renderTree();
}

// 打开弹窗版筛选器（预填/应用走 vm 态 + 后端搜索）
export async function openAdvFilterDialog($: $Id, vm: AppTree): Promise<void> {
  dbg("adv-filter", "open:start", { filesRoot: vm.snapshot.filesRoot });
  const rv = await advFilterReadCurAndOpenDialog(vm);
  if (!rv) return;
  if ("cleared" in rv) {
    // 清除回执：全清（关键词 + 高级条件 + 结果集）——afv-clear「清除全部」语义
    advFilterClearAll($, vm);
    return;
  }

  const { kw, hasTag, hasNumRange, isAllEmpty } = advFilterApplyResult($, rv, vm);
  if (isAllEmpty) {
    advFilterEarlyEmpty(vm);
    return;
  }

  let tagPaths: Set<string> | null = null;
  if (hasTag && rv.tag) {
    tagPaths = await advFilterFetchTagPaths(rv.tag);
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
          msg: `${friendlyError(e)}`,
          duration: TOAST_MS.verbose,
          type: "error",
        });
      }
    })();
  });
  input.click();
}
