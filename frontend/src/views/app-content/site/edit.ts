// ===== 站点视图编辑模式事件（从 site-view.ts 拆出，ADR-034 方向①）=====

import { t } from "@/core/i18n/t.ts";
import * as m from "@/features/community/community-data.ts";
import { safeSet } from "@/utils/base/primitives/storage.ts";
import { moveItemMut } from "@/utils/base/pure/array.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { qsa } from "@/utils/dom/qsa.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { allResourceTypes } from "@/utils/resource/schema.ts";
import type { WorkshopPresetSearch } from "@/utils/types-re-export.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { bindDragSort, type DragStateShell } from "./edit-drag.ts";
import { buildCreatorEditCard } from "./render.ts";
import type { CleanupFn, LocalCreatorLike, SiteViewState } from "./types.ts";
import { joinSiteIds, parseSiteIds } from "./workshop-data.ts";

interface FilterStateShell {
  activeTag: string;
}

// ===== P1-3a 锐评：编辑态 dirty 守卫 =====
// 快照 = 本站创作者 + 预设搜索词的可编辑字段序列化；退出编辑前比较判定「未保存变更」。
// 刻意序列化**可编辑子集**（name/desc/type/role + preset label），不整对象快照——
// 运行时附加字段（_fromLocal/_fromCommunity）不属于用户可改数据，计入会造成假 dirty。
function takeEditSnapshot(creators: LocalCreatorLike[], site: SiteViewState["site"]): string {
  const creatorsView = creators.map((cr) => ({
    name: cr.name || "",
    desc: cr.desc || "",
    type: cr.type || "",
    role: cr.role || "",
  }));
  const presets = (site.presetSearches || []).map((p) => ({ label: p.label || "" }));
  return JSON.stringify({ creatorsView, presets });
}

/** 单个输入控件 → creators[idx][fld] 回写。
 *  SELECT 多选拼 ";" 已退役（P1-5 锐评：platform 多选控件改 badge 组）；badge 组
 *  （.cr-site-chip-group[data-fld]）按组内 active chip 的 data-site-id 收拢为分号串；
 *  其余带 value 的控件 trim 后直写。2026-09 锐评 P0：原 SELECT/INPUT 分支在
 *  eeSyncAllEditInputs 与 eeBindCreatorsEdit 重复 2 处，抽此处收口。 */
function syncFieldToCreator(
  inp: HTMLElement,
  creators: LocalCreatorLike[],
  idx: number,
  fld: string,
): void {
  if (!creators[idx]) return;
  if (inp.classList.contains("cr-site-chip-group")) {
    // P1-5：badge 组 → 组内 active chip 的站点 id 集合 → 分号串
    creators[idx][fld] = joinSiteIds(
      [...inp.querySelectorAll<HTMLElement>(".cr-site-chip.active")]
        .map((chip) => chip.dataset.siteId || "")
        .filter(Boolean),
    );
  } else if (inp instanceof HTMLSelectElement) {
    creators[idx][fld] = joinSiteIds(
      Array.from(inp.selectedOptions)
        .map((o) => o.value)
        .filter(Boolean),
    );
  } else if ("value" in inp && typeof inp.value === "string") {
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
  // P1-4 锐评：计数格式统一为 (visible/total)——原初始态 `(N)` 与筛选后 `(5/12)` 跳变；
  // 筛选结果无可见卡时网格全折叠成空白，用户以为是页面坏了 → 显式空态 + 清除按钮出口。
  if (countEl) countEl.textContent = `(${visible}/${cards.length})`;
  // 空态容器：布局于网格之后（全折叠时 grid 高度收缩，空态紧贴标题栏），id 供切换复用
  let emptyEl = searchResults.querySelector<HTMLElement>("#cr-filter-empty");
  if (visible === 0 && cards.length > 0) {
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.id = "cr-filter-empty";
      emptyEl.className = "placeholder-box placeholder-box--roomy";
      emptyEl.dataset.testid = "cr-filter-empty";
      emptyEl.innerHTML =
        t("content.noMatchCreators") +
        '<br><button class="cr-local-btn" data-clear-filter>' +
        t("content.clearFilter") +
        "</button>";
      const grid = searchResults.querySelector("#cr-creator-grid");
      (grid || searchResults).appendChild(emptyEl);
      // 清除按钮走事件委托已在 eeBindGithubFilter 里绑定（点击即复位筛选）
    }
  } else if (emptyEl) {
    emptyEl.remove();
  }
}

function eeBindToolbarBtns(state: SiteViewState, refreshView: () => void, sig: AbortSignal): void {
  const { searchResults, wsEditModeRef, site, creators, allSites, bus: busRef } = state;

  searchResults.querySelector(".cr-edit-btn")?.addEventListener(
    "click",
    () => {
      wsEditModeRef.v = true;
      // P1-3a：进入编辑态取基线快照（此后任何修改都会让 dirty 判定成立）
      state.editSnapshot = takeEditSnapshot(creators, site);
      refreshView();
    },
    { signal: sig },
  );

  searchResults.querySelector(".cr-cancel-btn")?.addEventListener(
    "click",
    async () => {
      // P1-3a 锐评：dirty 守卫——编辑 5 行后点取消/切走，原实现静默丢弃全部修改。
      // 有未保存变更 → modalConfirm；确认才退出（并清快照），取消则留在编辑态。
      const snapshot = state.editSnapshot;
      const dirty = snapshot !== null && takeEditSnapshot(creators, site) !== snapshot;
      if (dirty) {
        const ok = await modalConfirm({
          title: t("workshop.discardTitle"),
          message: t("workshop.discardMessage"),
          okText: t("workshop.discardConfirm"),
          danger: true,
        });
        if (!ok) return;
      }
      wsEditModeRef.v = false;
      state.editSnapshot = null;
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
        // 锐评 P0-2a 配套：空名条目（cr-add 新增后未改名）不落盘——防未填写的占位行
        // 变垃圾数据；语言串不再当默认名（见 eeBindCreatorsEdit 的 cr-add）。
        const siteCreators = creators.filter(
          (cr) => (cr.name || "").trim() && parseSiteIds(cr.type).includes(site.id),
        );
        // P1-2 锐评：跨站点创作者「解除本站关联」（type 去本站段）的写回——
        // 若漏掉它们，Go 按站整存会移除磁盘上 type 含本站的所有旧条目（包括这些
        // 仍属他站的创作者），导致他站条目被连带抹掉。保存时併入 siteCreators：
        // type 已无本站段，Go 追加后本站不再命中、他站照常可见。
        const { SaveWorkshopCreatorsBySite } = await backendGetApp();
        await SaveWorkshopCreatorsBySite(site.id, [
          ...siteCreators,
          ...state.detachedCreators.filter((cr) => (cr.name || "").trim()),
        ]);
        wsEditModeRef.v = false;
        // P1-3a：保存成功即视为无 dirty（下次进入编辑态重新取快照）
        state.editSnapshot = null;
        busRef.emit("toast:show", {
          msg: t("workshop.action.saved"),
          duration: TOAST_MS.success,
          type: "success",
        });
        refreshView();
      } catch (e) {
        busRef.emit("toast:show", {
          // ADR-267：error 图标由 type 驱动，msg 不带 ❌ 前缀
          msg: friendlyError(e, t("workshop.saveFailed")),
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
      btn.innerHTML = UI_ICONS.refresh;
      btn.disabled = true;
      try {
        const App = await backendGetApp();
        const [community, sitesData, gitHubRepos] = await Promise.all([
          m.fetchCommunityCreators(m.DEFAULT_COMMUNITY_URL),
          m.fetchCommunitySites(),
          App.LoadGitHubRepos().catch(() => []),
        ]);
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
        // ADR-269 D3⑤：资源类型计数同步读 resource_types.json（allResourceTypes），废 LoadResourceTypes RPC
        if (allResourceTypes.length) {
          logs.push(t("workshop.logTypes", { n: allResourceTypes.length }));
          changed = true;
        }

        if (changed) {
          busRef.emit("toast:show", {
            msg: logs.join(" · "), // 成功态图标由 type=success 驱动，原文案 🌐 前缀属冗余装饰
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
                : friendlyError(e, t("workshop.fetchFailed"));
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

// ===== P1-3b 锐评：编辑态局部 DOM 操作 =====
// 删除/新增不再整树 refreshView（整树重建会把用户正在输入的焦点归零，连续编辑体验断裂）。
// 局部操作后**按 DOM 顺序重编号**创作家卡的 data-edit-idx 与其内全部 data-idx——
// 数组已同步（splice/push），DOM 序号必须跟着变，否则后续保存的 syncFieldToCreator
// 会把「第 N 张卡」的输入写进错误的数组槽。
function reindexCreatorCards(searchResults: HTMLElement): void {
  qsa<HTMLElement>(searchResults, ".cr-edit-card:not([data-edit='preset'])").forEach((card, i) => {
    card.dataset.editIdx = String(i);
    qsa<HTMLElement>(card, "[data-idx]").forEach((el) => {
      el.dataset.idx = String(i);
    });
  });
}

function eeBindCreatorsEdit(state: SiteViewState, sig: AbortSignal): void {
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

  // P1-5 锐评：platform badge 组点击切换选中（type 段的 site 归属）——
  // 与浏览态 badge 同语义；点已选中的 chip 即解除该站归属（可到空，保存时由空名/空归属过滤兜底）。
  qsa<HTMLElement>(
    searchResults,
    ".cr-edit-card:not([data-edit='preset']) .cr-site-chip-group",
  ).forEach((group) => {
    group.addEventListener(
      "click",
      (e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>(".cr-site-chip");
        if (!chip) return;
        chip.classList.toggle("active");
        const idx = parseInt(group.dataset.idx || "-1", 10);
        syncFieldToCreator(group, creators, idx, "type");
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
        const cr = creators[idx];
        if (!cr) return;
        // P1-2 锐评：跨站点越权修复——type:"A;B" 的创作者在 A 站删除必须是「解除 A 关联」，
        // 不得从 allCreators 全删：Go 按站整存（移除 type 含本站的旧条目→追加新列表）会把
        // 属于 B 站的条目一并抹掉。多站条目：type 去本站段 + 移入 detached 待保存写回；
        // 单站条目（或 type 缺失/空）：全量删除（本就只属本站，他站无依赖）。
        const segs = parseSiteIds(cr.type);
        const belongsToOtherSites = segs.some((s) => s !== site.id);
        if (belongsToOtherSites) {
          cr.type = joinSiteIds(segs.filter((s) => s !== site.id));
          state.detachedCreators.push(cr);
        } else {
          const realIdx = allCreators.indexOf(cr);
          if (realIdx >= 0) allCreators.splice(realIdx, 1);
        }
        // P1-3b：局部 DOM 移除 + 数组 splice + 重编号，不整树重建（保焦点）
        creators.splice(idx, 1);
        btn.closest(".cr-edit-card")?.remove();
        reindexCreatorCards(searchResults);
      },
      { signal: sig },
    );
  });

  searchResults.querySelector(".cr-add")?.addEventListener(
    "click",
    () => {
      eeSyncAllEditInputs(searchResults, creators, site);
      // 锐评 P0-2a：新增条目不以 i18n 文案当默认 name/desc（原 t("workshop.newCreatorName")
      // 会被保存路径落盘，语言串污染 creators.json）；空值交给编辑卡 placeholder 引导，
      // 未填名的条目在保存时被挡在门外（见 eeBindToolbarBtns 的空名过滤）。
      creators.push({
        name: "",
        desc: "",
        type: site.id,
        tag: "",
      } as LocalCreatorLike);
      const newCr = creators.at(-1);
      if (!newCr) return; // push 后必然存在，守卫仅为类型收窄（biome 禁 ! 断言）
      allCreators.push(newCr);
      // P1-3b：局部 DOM append 新卡（buildCreatorEditCard 纯函数），不整树重建（保焦点）
      const newIdx = creators.length - 1;
      const newCardHtml = buildCreatorEditCard(newCr, newIdx, state.allSites, state.esc);
      const addArea = searchResults.querySelector(".cr-add-area");
      if (addArea) {
        addArea.insertAdjacentHTML("beforebegin", newCardHtml);
      } else {
        searchResults.insertAdjacentHTML("beforeend", newCardHtml);
      }
      reindexCreatorCards(searchResults);
      // 焦点落到新卡 name 输入，连续「新增」不丢操作链
      const newName = searchResults.querySelector(
        `.cr-edit-card:not([data-edit='preset'])[data-edit-idx="${newIdx}"] input[data-fld="name"]`,
      ) as HTMLInputElement | null;
      newName?.focus();
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

  // P1-4 锐评：零结果空态的「清除筛选」出口——复位关键词 + 标签 + 计数 + 移除空态。
  // 空态按钮在 eeApplyFilters 动态创建（#cr-filter-empty），此处用文档级事件委托
  //（searchResults 容器），空态节点创建后可点击，重渲染后仍可命中。
  searchResults.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-clear-filter]")) return;
      fs.activeTag = "";
      safeSet("ysm-ws-active-tag", "");
      if (searchInput) {
        searchInput.value = "";
        safeSet("ysm-ws-search-kw", "");
      }
      searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((b) => {
        b.classList.toggle(
          "active",
          b === searchResults.querySelector('.cr-tag-filter-btn[data-tag=""]'),
        );
      });
      eeApplyFilters(searchResults, searchInput, fs);
    },
    { signal: sig },
  );

  qsa<HTMLElement>(searchResults, ".cr-tag-filter-btn").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        fs.activeTag = btn.dataset.tag || "";
        safeSet("ysm-ws-active-tag", fs.activeTag);
        searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
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
  eeBindCreatorsEdit(state, sig);
  eeBindCreatorsDrag(state, refreshView, ds, sig);
  eeBindPresetsEdit(state, refreshView, sig);
  eeBindPresetsDrag(state, refreshView, ds, sig);
  eeBindGithubFilter(state, fs, sig);

  return () => ac.abort();
}
