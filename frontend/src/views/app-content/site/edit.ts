// ===== 站点视图编辑模式事件（从 site-view.ts 拆出，ADR-034 方向①）=====

import { t } from "@/core/i18n/t.ts";
import * as m from "@/features/community/community-data.ts";
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
import { joinSiteIds, parseSiteIds, saveActiveTag, saveSearchKw } from "./workshop-data.ts";

interface FilterStateShell {
  activeTag: string;
}

/** 搜索框输入的筛选防抖窗口（ms）。逐键全量扫描卡片在百人站点上是可见卡顿；关键词**持久化仍即时**
 *  （切页/重进不丢），只有「可见性重算」延后到停手后一次。
 *  导出供回归锁共用同一数值（非 test-only 导出：生产消费即本文件的 `eeBindCreatorFilter`）。 */
export const SEARCH_FILTER_DEBOUNCE_MS = 120;

// ===== 编辑态 dirty 守卫 =====
// 快照 = 本站创作者 + 预设搜索词的可编辑字段序列化；退出编辑前比较判定「未保存变更」。
// 刻意只序列化**可编辑子集**（name/desc/type/role + preset label）：运行时附加字段
// （_fromLocal/_fromCommunity）非用户可改，计入会造成假 dirty。
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

/** 单个输入控件 → creators[idx][fld] 回写（**唯一收口点**，勿在绑定点另抄一份分支）。
 *  badge 组（.cr-site-chip-group[data-fld]）按组内 active chip 的 data-site-id 收拢为分号串；
 *  其余带 value 的控件 trim 后直写。 */
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
    // 单选 select（唯一消费者 = role 下拉）**直取 value**，不得经 joinSiteIds——那是站点归属的
    // 分号拼装器；role 单选时二者巧合等价，但一旦 role 加 multiple 或新增非站点 select，就会拼出
    // "official;vup" 式脏值直接落盘。新 select 接入先判归属：多值走 chip 组，单值取 value。
    creators[idx][fld] = inp.value;
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
  creators: LocalCreatorLike[],
): void {
  const kw = (searchInput?.value || "").trim().toLowerCase();
  const cards = qsa<HTMLElement>(searchResults, ".gh-card[data-name]");
  // desc 判定读 creators 数据层（口径同 render.ts|createCrCard，本地条目 _fromLocal 现取 i18n 提示），
  // 不读 .cr-card-desc 的 DOM 文案（经 esc()/i18n 渲染后可能与数据层不同）；数据层查无时兜底读 DOM。
  // 索引表：每卡 find() 是卡数×创作者数的 O(n²)，且筛选挂在无 debounce 的 input 事件上会逐键放大；
  // 故按小写 name 建 Map 一次、每卡 O(1) 命中（与 authorCountMap 同范式）。
  const creatorByName = new Map<string, LocalCreatorLike>();
  creators.forEach((c) => {
    creatorByName.set((c.name || "").toLowerCase(), c);
  });
  let visible = 0;
  cards.forEach((card) => {
    const name = (card.dataset.name || "").toLowerCase();
    const creator = creatorByName.get(name);
    const desc =
      creator !== undefined
        ? (creator.desc || (creator._fromLocal ? t("community.fromLocal") : "")).toLowerCase()
        : (card.querySelector(".cr-card-desc")?.textContent || "").toLowerCase();
    const cardTag = (card.dataset.tag || "").toLowerCase();
    const matchName = !kw || name.includes(kw) || desc.includes(kw);
    const matchTag = !fs.activeTag || fs.activeTag === cardTag;
    card.classList.toggle("cr-card-hidden", !(matchName && matchTag));
    if (matchName && matchTag) visible++;
  });
  const countEl = searchResults.querySelector("#ws-cr-count");
  // 计数统一 (visible/total)：初始态与筛选后格式一致，不跳变；零结果时另渲染显式空态 + 清除出口
  //（否则网格全折叠成空白，用户以为页面坏了）。
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
      // 挂到网格**之后**（`role=list` 内部不得塞非 listitem 子节点——2026-10-15 复核 P2；
      // 旧代码 `(grid || searchResults).appendChild(...)` 把空态塞进了 list 内部，与此处注释不符）
      if (grid) grid.after(emptyEl);
      else searchResults.appendChild(emptyEl);
      // 清除按钮走事件委托已在 eeBindCreatorFilter 里绑定（点击即复位筛选）
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
            if (!val) return;
            // q 必须从原数组回读、不得丢：Go 侧 SaveWorkshopPresetsBySite 是**整数组替换**，
            // 而编辑界面只有 label 一个输入位（q 不由用户改）→ 恒取原值。漏掉 q 会让用户一个字
            // 没改、点一次保存就把真实的「label→q」映射永久覆盖成 q=label。
            const idx = parseInt(inp.dataset.idx || "-1", 10);
            const original = site.presetSearches?.[idx];
            newPresets.push({ label: val, q: original?.q ?? "" });
          });
          await SaveWorkshopPresetsBySite(site.id, newPresets);
          site.presetSearches = newPresets;
        }
        eeSyncAllEditInputs(searchResults, creators, site);
        // 空名条目（cr-add 新增后未改名）不落盘——防未填写的占位行变垃圾数据
        const siteCreators = creators.filter(
          (cr) => (cr.name || "").trim() && parseSiteIds(cr.type).includes(site.id),
        );
        // 跨站创作者「解除本站关联」以**名字**交给 Go（ADR-335）：Go 基于磁盘副本去本站段，
        // 前端不再重建全量列表——旧契约漏併 detached 条目就会把他站的条目一并抹掉。
        const { SaveWorkshopCreatorsBySite } = await backendGetApp();
        await SaveWorkshopCreatorsBySite(site.id, siteCreators, state.detachedNames);
        wsEditModeRef.v = false;
        // 保存成功即视为无 dirty（下次进编辑态重新取快照）
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
          // 落盘并入下沉 Go（ADR-172：Load 磁盘全量 → 空补/段并入 → 备份 → 单次原子写），
          // 前端只传拉取结果、不重算。**不得**改回「TS 合并 + 整存 allCreators」——那会用 UI
          // 会话态覆盖磁盘（连带落盘 _fromLocal 展示条目，且与磁盘并行修改互踩）。计数以 Go 为准。
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
          // 站点侧同理（ADR-172 对称）：并入下沉 Go，不得改回「TS 合并 + SaveWorkshopSites 整存」。
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
        // 资源类型计数同步读 resource_types.json（allResourceTypes），不再走 RPC（ADR-269 D3⑤）
        if (allResourceTypes.length) {
          logs.push(t("workshop.logTypes", { n: allResourceTypes.length }));
          changed = true;
        }

        if (changed) {
          busRef.emit("toast:show", {
            msg: logs.join(" · "), // 图标由 type=success 驱动，文案不再缀装饰字符
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
        // 本 catch 保护的是回退拉取（fetchCommunityCreators/Sites 全败返回 []，
        // 从不抛竞速 token）与 Go 绑定——竞速分类 token 在此生产不可达，不写判别分支
        // （子代理复核判 P3 死码，2026-10-13 删除）；错误展示统一走 friendlyError。
        const errMsg = friendlyError(e, t("workshop.fetchFailed"));
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

// ===== 编辑态局部 DOM 操作 =====
// 删除/新增不整树 refreshView（整树重建会归零用户正在输入的焦点）。
// ⚠️ 局部操作后必须**按 DOM 顺序重编号**每张卡的 data-edit-idx 与其内全部 data-idx——
// 数组已 splice/push，DOM 序号必须跟着变，否则保存路径 syncFieldToCreator 会把「第 N 张卡」
// 的输入写进错误的数组槽（静默写错创作者并落盘）。详见知识卡 §不变量。
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
        const siteId = chip.dataset.siteId || "";
        syncFieldToCreator(group, creators, idx, "type");
        // 取消本站归属必须登记 detachedNames（锐评高危修复，2026-10-14：静默数据丢失）。
        // 病：保存路径 `siteCreators = creators.filter(cr => parseSiteIds(cr.type).includes(site.id))`
        // 把「type 已不含本站」的条目整条滤出，而 Go 侧 SaveWorkshopCreatorsBySite
        // （internal/app/app_workshop.go）对「不在 siteCreators 也不在 detachedNames」的
        // 本站条目**直接丢弃**（:222 注释原文）——取消 chip 既不进 list 也不进名单，
        // 于是多站创作者在别站的条目**一并消失**，单站创作者整条蒸发，
        // 且无 toast 无确认（旧契约的 `.cr-del` 路径有 detachedNames，chip 路径漏了）。
        // 修法与 .cr-del 对称：还属他站 → 记名走 Go 段级解除；不属他站（type 变空）→ 整条删。
        if (!chip.classList.contains("active") && siteId === site.id) {
          const cr = creators[idx];
          if (!cr) return;
          if (parseSiteIds(cr.type).some((s) => s !== site.id)) {
            if (!state.detachedNames.includes(cr.name)) state.detachedNames.push(cr.name);
          } else {
            const realIdx = allCreators.indexOf(cr);
            if (realIdx >= 0) allCreators.splice(realIdx, 1);
          }
        }
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
        // 多站点创作者在 A 站删除 = 「解除 A 关联」：只把**名字**记入 detachedNames，交由 Go
        // 基于磁盘副本去本站段（ADR-335）。不得从 allCreators 全删（会抹掉他站条目），
        // 也不得就地改 cr.type——旧实现会污染 allCreators 的内存显示（跨站条目「少了一站」）。
        const belongsToOtherSites = parseSiteIds(cr.type).some((s) => s !== site.id);
        if (belongsToOtherSites) {
          state.detachedNames.push(cr.name);
        } else {
          const realIdx = allCreators.indexOf(cr);
          if (realIdx >= 0) allCreators.splice(realIdx, 1);
        }
        // 局部 DOM 移除 + 数组 splice + 重编号，不整树重建（保焦点）
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
      // 新增条目落空 name/desc——**不得**用 i18n 文案当默认值（会被保存路径落盘，语言串污染
      // creators.json）；空值交编辑卡 placeholder 引导，未填名的条目在保存时被挡在门外。
      creators.push({
        name: "",
        desc: "",
        type: site.id,
        tag: "",
      } as LocalCreatorLike);
      const newCr = creators.at(-1);
      if (!newCr) return; // push 后必然存在，守卫仅为类型收窄（biome 禁 ! 断言）
      allCreators.push(newCr);
      // 局部 DOM append 新卡（复用 buildCreatorEditCard 纯函数），不整树重建（保焦点）
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
  // 拖拽排序统一走 bindDragSort；creators 组须经 allCreators 真实索引换算后移动
  //（编辑视图是过滤后的子集，索引不能直接拿来用）
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

/** 创作者筛选接线（搜索框 / 标签按钮 / 清除出口）。
 *  ⚠️ 旧名 eeBindGithubFilter 是化石：它绑的是**创作者频道**筛选，与 GitHub 页面无关，
 *  名实不符曾误导定位——勿按旧名去找 GitHub 逻辑。 */
function eeBindCreatorFilter(state: SiteViewState, fs: FilterStateShell, sig: AbortSignal): void {
  const { searchResults, creators, site } = state;
  // 筛选态按本站 id 分域存储（全局单键会让旧站标签套到新站 → 网格空白）
  const siteId = site?.id || "";

  const searchInput = searchResults.querySelector("#ws-cr-search") as HTMLInputElement | null;
  // 防抖定时器归本接线函数私有：AbortSignal abort（组件卸载/重渲）与「清除筛选」都必须取消在途一次，
  // 否则停手前切页会把一次 eeApplyFilters 打到已废弃的 DOM 上（2026-10-15）。
  let searchTimer: number | undefined;
  const cancelPendingFilter = (): void => {
    if (searchTimer !== undefined) {
      window.clearTimeout(searchTimer);
      searchTimer = undefined;
    }
  };
  if (searchInput) {
    searchInput.addEventListener(
      "input",
      () => {
        saveSearchKw(siteId, searchInput.value);
        cancelPendingFilter();
        searchTimer = window.setTimeout(() => {
          searchTimer = undefined;
          if (sig.aborted) return;
          eeApplyFilters(searchResults, searchInput, fs, creators);
        }, SEARCH_FILTER_DEBOUNCE_MS);
      },
      { signal: sig },
    );
    sig.addEventListener("abort", cancelPendingFilter);
  }

  // 零结果空态的「清除筛选」出口：复位关键词 + 标签 + 计数 + 移除空态。
  // 空态节点由 eeApplyFilters 动态创建，故此处用容器级事件委托——节点新建后可点、重渲染后仍命中。
  searchResults.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest("[data-clear-filter]")) return;
      cancelPendingFilter(); // 在途防抖一次作废：本次已同步全量重算，避免延迟一拍再覆盖
      fs.activeTag = "";
      saveActiveTag(siteId, "");
      if (searchInput) {
        searchInput.value = "";
        saveSearchKw(siteId, "");
      }
      searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((b) => {
        b.classList.toggle(
          "active",
          b === searchResults.querySelector('.cr-tag-filter-btn[data-tag=""]'),
        );
      });
      eeApplyFilters(searchResults, searchInput, fs, creators);
    },
    { signal: sig },
  );

  qsa<HTMLElement>(searchResults, ".cr-tag-filter-btn").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => {
        fs.activeTag = btn.dataset.tag || "";
        saveActiveTag(siteId, fs.activeTag);
        searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((b) => {
          b.classList.toggle("active", b === btn);
        });
        eeApplyFilters(searchResults, searchInput, fs, creators);
      },
      { signal: sig },
    );
  });

  eeApplyFilters(searchResults, searchInput, fs, creators);
}

/** 绑定编辑模式事件：编辑入口 / 拉取配置 / 取消 / 保存 / 行内编辑 / 删除 / 拖拽排序 / 搜索词增删 / 筛选。 */
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
  eeBindCreatorFilter(state, fs, sig);

  return () => ac.abort();
}
