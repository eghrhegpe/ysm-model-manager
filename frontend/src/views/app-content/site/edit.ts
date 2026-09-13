// ===== 站点视图编辑模式事件（从 site-view.ts 拆出，ADR-034 方向①）=====

import { t } from "@/core/i18n/t.ts";
import * as m from "@/features/community/community-data.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { safeSet } from "@/utils/base/primitives/storage.ts";
import { moveItemMut } from "@/utils/base/pure/array.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { qsa } from "@/utils/dom/qsa.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import type { WorkshopPresetSearch } from "@/utils/types-re-export.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { bindDragSort, type DragStateShell } from "./edit-drag.ts";
import type { CleanupFn, LocalCreatorLike, SiteViewState } from "./types.ts";

interface FilterStateShell {
  activeTag: string;
}

/** 单个输入控件 → creators[idx][fld] 回写（SELECT 多选拼 ";"，其余 trim 后直写）。
 *  2026-09 锐评 P0：原 SELECT/INPUT 分支在 eeSyncAllEditInputs 与 eeBindCreatorsEdit 重复 2 处，抽此处收口。 */
function syncFieldToCreator(
  inp: HTMLElement,
  creators: LocalCreatorLike[],
  idx: number,
  fld: string,
): void {
  if (!creators[idx]) return;
  if (inp instanceof HTMLSelectElement) {
    creators[idx][fld] = Array.from(inp.selectedOptions)
      .map((o) => o.value)
      .filter(Boolean)
      .join(";");
  } else if (inp instanceof HTMLInputElement) {
    creators[idx][fld] = inp.value.trim();
  }
}

function eeSyncAllEditInputs(
  searchResults: HTMLElement,
  creators: LocalCreatorLike[],
  site: SiteViewState["site"],
): void {
  qsa<HTMLElement>(
    searchResults,
    ".cr-edit-card:not([data-edit='preset']) [data-idx][data-fld]",
  ).forEach((inp) => {
    const idx = parseInt(inp.dataset.idx || "-1", 10);
    const fld = inp.dataset.fld || "";
    syncFieldToCreator(inp, creators, idx, fld);
  });
  qsa<HTMLInputElement>(
    searchResults,
    ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
  ).forEach((inp) => {
    const idx = parseInt(inp.dataset.idx || "-1", 10);
    if (site.presetSearches?.[idx]) {
      site.presetSearches[idx].label = inp.value.trim();
    }
  });
}

// 清理拖拽视觉态 + 复位双 src 键的逻辑已随双胞胎块收编进 edit-drag.ts|bindDragSort（dragend 内联）

function eeApplyFilters(
  searchResults: HTMLElement,
  searchInput: HTMLInputElement | null,
  fs: FilterStateShell,
): void {
  const kw = (searchInput?.value || "").trim().toLowerCase();
  const cards = qsa<HTMLElement>(searchResults, ".gh-card[data-name]");
  let visible = 0;
  cards.forEach((card) => {
    const name = (card.dataset.name || "").toLowerCase();
    const desc = (card.querySelector(".cr-card-desc")?.textContent || "").toLowerCase();
    const cardTag = (card.dataset.tag || "").toLowerCase();
    const matchName = !kw || name.includes(kw) || desc.includes(kw);
    const matchTag = !fs.activeTag || fs.activeTag === cardTag;
    card.classList.toggle("cr-card-hidden", !(matchName && matchTag));
    if (matchName && matchTag) visible++;
  });
  const countEl = searchResults.querySelector("#ws-cr-count");
  if (countEl) countEl.textContent = `(${visible}/${cards.length})`;
}

function eeBindToolbarBtns(state: SiteViewState, refreshView: () => void, sig: AbortSignal): void {
  const { searchResults, wsEditModeRef, site, creators, allSites, bus: busRef } = state;

  searchResults.querySelector(".cr-edit-btn")?.addEventListener(
    "click",
    () => {
      wsEditModeRef.v = true;
      refreshView();
    },
    { signal: sig },
  );

  searchResults.querySelector(".cr-cancel-btn")?.addEventListener(
    "click",
    () => {
      wsEditModeRef.v = false;
      refreshView();
    },
    { signal: sig },
  );

  searchResults.querySelector(".cr-save-btn")?.addEventListener(
    "click",
    async () => {
      try {
        if (!site?.id) {
          busRef.emit("toast:show", {
            msg: t("workshop.siteInfoLost"),
            duration: TOAST_MS.normal,
            type: "error",
          });
          return;
        }
        if (allSites && site) {
          const { SaveWorkshopPresetsBySite } = await backendGetApp();
          const newPresets: WorkshopPresetSearch[] = [];
          qsa<HTMLInputElement>(
            searchResults,
            ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
          ).forEach((inp) => {
            const val = inp.value.trim();
            if (val) newPresets.push({ label: val } as WorkshopPresetSearch);
          });
          await SaveWorkshopPresetsBySite(site.id, newPresets);
          site.presetSearches = newPresets;
        }
        eeSyncAllEditInputs(searchResults, creators, site);
        const siteCreators = creators.filter((cr) => cr.type?.split(";").includes(site.id));
        const { SaveWorkshopCreatorsBySite } = await backendGetApp();
        await SaveWorkshopCreatorsBySite(site.id, siteCreators);
        wsEditModeRef.v = false;
        busRef.emit("toast:show", {
          msg: t("workshop.action.saved"),
          duration: TOAST_MS.success,
          type: "success",
        });
        refreshView();
      } catch (e) {
        busRef.emit("toast:show", {
          msg: `❌ ${friendlyError(e, t("workshop.saveFailed"))}`,
          duration: TOAST_MS.verbose,
          type: "error",
        });
      }
    },
    { signal: sig },
  );
}

function eeBindFetchBtn(state: SiteViewState, refreshView: () => void, sig: AbortSignal): void {
  const { searchResults, allCreators, allSites, bus: busRef } = state;

  searchResults.querySelector(".cr-fetch-btn")?.addEventListener(
    "click",
    async () => {
      const btn = searchResults.querySelector(".cr-fetch-btn") as HTMLButtonElement;
      btn.textContent = "⏳";
      btn.disabled = true;
      try {
        const App = await backendGetApp();
        const results = await Promise.all([
          m.fetchCommunityCreators(m.DEFAULT_COMMUNITY_URL),
          m.fetchCommunitySites(),
          App.LoadGitHubRepos().catch(() => []),
          App.LoadResourceTypes().catch(() => null),
        ]);
        const community = results[0],
          sitesData = results[1],
          gitHubRepos = results[2],
          resourceTypesRaw = results[3];
        const logs: string[] = [];
        let changed = false;

        if (community?.length) {
          // ADR-172：落盘并入下沉 Go（Load 磁盘最新全量 → desc/role 空补 + type 分号段
          // 并入 → 备份 → 单次 SaveWorkshopCreators 原子写），前端只传拉取结果、不重算。
          // 原「TS mergeCommunityCreators + SaveWorkshopCreators(allCreators) 整存」用 UI
          // 会话态覆盖磁盘——会连带持久化本地作者展示条目（_fromLocal，mergeLocalAuthorsInto
          // 注入）且与磁盘并行修改互踩；现整存移除。计数以 Go 返回为准（权威）。
          let added = 0,
            updated = 0;
          // 落盘失败自然冒泡到外层 catch 走 toast 错误提示
          const [ga, gu] = await App.MergeCommunityCreatorsFromJSON(JSON.stringify(community));
          added = ga;
          updated = gu;
          if (added || updated) {
            // UI 即时并入（仅内存展示，不驱动写回；输入与 Go 同源，结果等价）
            m.mergeCommunityCreators(allCreators, community);
            logs.push(t("workshop.logCreators", { added, updated }));
            changed = true;
          }
        }
        if (sitesData?.length) {
          // ADR-172 对称（站点侧双轨收口）：社区站点增量并入下沉 Go——原
          // 「TS mergeCommunitySites + SaveWorkshopSites(allSites) 整存」用 UI 会话态
          // 覆盖磁盘（与磁盘并行修改互踩）；现整存移除，计数以 Go 返回为准（权威）。
          const sa = await App.MergeCommunitySitesFromJSON(JSON.stringify(sitesData));
          const siteAdded = sa ?? 0;
          if (siteAdded > 0) {
            // UI 即时并入（仅内存展示，不驱动写回；输入与 Go 同源，结果等价）
            m.mergeCommunitySites(allSites, sitesData);
            logs.push(t("workshop.logSites", { added: siteAdded }));
            changed = true;
          }
        }
        if (gitHubRepos?.length) {
          logs.push(t("workshop.logGithub", { n: gitHubRepos.length }));
          changed = true;
        }
        let resourceTypes: unknown[] = [];
        try {
          const reg = resourceTypesRaw;
          if (reg && Array.isArray(reg.resourceTypes)) {
            resourceTypes = reg.resourceTypes;
          }
        } catch (e) {
          logWarn("site-edit", "parse resourceTypes", e);
        }
        if (resourceTypes.length) {
          logs.push(t("workshop.logTypes", { n: resourceTypes.length }));
          changed = true;
        }

        if (changed) {
          busRef.emit("toast:show", {
            msg: `🌐 ${logs.join(" · ")}`,
            duration: TOAST_MS.verbose,
            type: "success",
          });
          refreshView();
        } else {
          busRef.emit("toast:show", {
            msg: t("workshop.upToDate"),
            duration: TOAST_MS.normal,
            type: "success",
          });
        }
      } catch (e) {
        const err = e as Error;
        const errMsg =
          err.message === "NetworkOffline"
            ? t("workshop.networkOffline")
            : err.message === "NoIndex"
              ? t("workshop.indexMissing")
              : err.message === "RateLimited"
                ? t("workshop.rateLimited")
                : `🌐 ${friendlyError(e, t("workshop.fetchFailed"))}`;
        busRef.emit("toast:show", {
          msg: errMsg,
          duration: TOAST_MS.long,
          type: "error",
        });
      } finally {
        btn.textContent = t("workshop.updateConfig");
        btn.disabled = false;
      }
    },
    { signal: sig },
  );
}

function eeBindCreatorsEdit(state: SiteViewState, refreshView: () => void, sig: AbortSignal): void {
  const { searchResults, creators, allCreators, site } = state;

  qsa<HTMLElement>(
    searchResults,
    ".cr-edit-card:not([data-edit='preset']) [data-idx][data-fld]",
  ).forEach((inp) => {
    inp.addEventListener(
      "input",
      () => {
        const idx = parseInt(inp.dataset.idx || "-1", 10);
        const fld = inp.dataset.fld || "";
        syncFieldToCreator(inp, creators, idx, fld);
      },
      { signal: sig },
    );
  });

  qsa<HTMLElement>(searchResults, ".cr-del").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        eeSyncAllEditInputs(searchResults, creators, site);
        const idx = parseInt(btn.dataset.idx || "-1", 10);
        if (creators[idx]) {
          const realIdx = allCreators.indexOf(creators[idx]);
          if (realIdx >= 0) allCreators.splice(realIdx, 1);
          refreshView();
        }
      },
      { signal: sig },
    );
  });

  searchResults.querySelector(".cr-add")?.addEventListener(
    "click",
    () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      creators.push({
        name: t("workshop.newCreatorName"),
        desc: t("workshop.newCreatorDesc"),
        type: site.id,
        tag: "",
      } as LocalCreatorLike);
      allCreators.push(creators[creators.length - 1]);
      refreshView();
    },
    { signal: sig },
  );
}

function eeBindCreatorsDrag(
  state: SiteViewState,
  refreshView: () => void,
  ds: DragStateShell,
  sig: AbortSignal,
): void {
  const { searchResults, creators, allCreators } = state;
  // 拖拽排序事件统一走 bindDragSort（原 ~90 行双胞胎块去重，2026-09）；
  // creators 组经 allCreators 真实索引换算后移动（编辑过滤视图 → 全量列表的索引映射）
  bindDragSort({
    root: searchResults,
    selector: ".cr-edit-card:not([data-edit='preset'])",
    ds,
    srcKey: "srcIdx",
    sig,
    syncInputs: () => eeSyncAllEditInputs(searchResults, creators, state.site),
    commit: (srcIdx, targetIdx) => {
      const src = creators[srcIdx];
      const realSrc = allCreators.indexOf(src);
      const realTgt = allCreators.indexOf(creators[targetIdx]);
      if (realSrc < 0 || realTgt < 0) return false;
      moveItemMut(allCreators, realSrc, realTgt);
      return true;
    },
    refreshView,
  });
}

function eeBindPresetsEdit(state: SiteViewState, refreshView: () => void, sig: AbortSignal): void {
  const { searchResults, site, creators } = state;

  qsa<HTMLElement>(searchResults, ".cr-del-preset").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        eeSyncAllEditInputs(searchResults, creators, site);
        const idx = parseInt(btn.dataset.idx || "-1", 10);
        if (site.presetSearches?.[idx]) {
          site.presetSearches.splice(idx, 1);
          refreshView();
        }
      },
      { signal: sig },
    );
  });

  qsa<HTMLElement>(searchResults, ".cr-order-up").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        eeSyncAllEditInputs(searchResults, creators, site);
        const idx = parseInt(btn.dataset.idx || "-1", 10);
        if (site.presetSearches && idx > 0) {
          const arr = site.presetSearches;
          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
          refreshView();
        }
      },
      { signal: sig },
    );
  });
  qsa<HTMLElement>(searchResults, ".cr-order-down").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        eeSyncAllEditInputs(searchResults, creators, site);
        const idx = parseInt(btn.dataset.idx || "-1", 10);
        if (site.presetSearches && idx < site.presetSearches.length - 1) {
          const arr = site.presetSearches;
          [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
          refreshView();
        }
      },
      { signal: sig },
    );
  });

  searchResults.querySelector(".cr-add-preset")?.addEventListener(
    "click",
    () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      if (!site.presetSearches) site.presetSearches = [];
      site.presetSearches.push({ label: "", q: "" });
      refreshView();
    },
    { signal: sig },
  );
}

function eeBindPresetsDrag(
  state: SiteViewState,
  refreshView: () => void,
  ds: DragStateShell,
  sig: AbortSignal,
): void {
  const { searchResults, site, creators } = state;
  // presets 组：presetSearches 就地按编辑视图索引移动（无 allCreators 间接层）
  bindDragSort({
    root: searchResults,
    selector: ".cr-edit-card[data-edit='preset']",
    ds,
    srcKey: "presetSrcIdx",
    sig,
    syncInputs: () => eeSyncAllEditInputs(searchResults, creators, site),
    commit: (srcIdx, targetIdx) => {
      if (!site.presetSearches) return false;
      moveItemMut(site.presetSearches, srcIdx, targetIdx);
      return true;
    },
    refreshView,
  });
}

function eeBindGithubFilter(state: SiteViewState, fs: FilterStateShell, sig: AbortSignal): void {
  const { searchResults } = state;

  const searchInput = searchResults.querySelector("#ws-cr-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener(
      "input",
      () => {
        safeSet("ysm-ws-search-kw", searchInput.value);
        eeApplyFilters(searchResults, searchInput, fs);
      },
      { signal: sig },
    );
  }

  qsa<HTMLElement>(searchResults, ".cr-tag-filter-btn").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        fs.activeTag = btn.dataset.tag || "";
        safeSet("ysm-ws-active-tag", fs.activeTag);
        searchResults
          .querySelectorAll(".cr-tag-filter-btn")
          // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
          .forEach((b) => b.classList.toggle("active", b === btn));
        eeApplyFilters(searchResults, searchInput, fs);
      },
      { signal: sig },
    );
  });

  eeApplyFilters(searchResults, searchInput, fs);
}

/**
 * 绑定编辑模式事件：编辑入口 / 拉取配置 / 取消 / 保存 / 行内编辑 /
 * 删除创作者 / 拖拽排序 / 增删搜索词 / 搜索过滤。
 * 拖拽排序属编辑模式强相关，一并迁此。
 */
export function bindEditEvents(state: SiteViewState, refreshView: () => void): CleanupFn {
  const ds: DragStateShell = { srcIdx: -1, presetSrcIdx: -1 };
  const fs: FilterStateShell = { activeTag: state.activeTag };

  const ac = new AbortController();
  const sig = ac.signal;

  eeBindToolbarBtns(state, refreshView, sig);
  eeBindFetchBtn(state, refreshView, sig);
  eeBindCreatorsEdit(state, refreshView, sig);
  eeBindCreatorsDrag(state, refreshView, ds, sig);
  eeBindPresetsEdit(state, refreshView, sig);
  eeBindPresetsDrag(state, refreshView, ds, sig);
  eeBindGithubFilter(state, fs, sig);

  return () => ac.abort();
}
