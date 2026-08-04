// ===== 创意工坊站点视图（为 _initWorkshop 减负） =====
import { friendlyError } from "../../../utils/dom/errors.ts";
import { bus } from "../../../bus.ts";
import { dbg } from "../../../utils/debug/debug.ts";
import { showProgress, tryFetchModels } from "../../../features/community/data.ts";
import {
  getCreatorIdentity,
  getTagFromRole,
  parseDescTags,
  loadFavs,
  isFaved,
  toggleFav,
  type CreatorIdentityInput,
} from "./workshop-data.ts";
import { getSiteIcon, getTagIconFromRole } from "./workshop-icons.ts";
import type { WorkshopSite, WorkshopCreator, WorkshopPresetSearch } from "../../../../bindings/ysm-model-manager/go/types/models.ts";

import { getApp } from "../../../wails/app.ts";
import { buildSiteHtml, createCrCard, type CrCardCtx } from "./site-view-render.ts";
import { bindBrowseEvents } from "./site-view-events.ts";
import type { SiteViewState, CleanupFn } from "./site-view-types.ts";

/** 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） */
export type RepoAuthorLike = string | { Name?: string; Count?: number };

/** 站点视图渲染上下文（index.ts _initWorkshop 传入） */
export interface RenderSiteViewCtx {
  esc: (s: unknown) => string;
  searchResults: HTMLElement;
  creatorView: HTMLElement;
  allSites: WorkshopSite[];
  allCreators: LocalCreatorLike[];
  repoAuthors: RepoAuthorLike[];
  wsEditModeRef: { v: boolean };
  showRepoModels: (repo: string, models: unknown[], source: string) => Promise<void>;
  fillSearch: (tpl: string, q: string) => string;
  repoModelCache: Map<string, { models: unknown[]; source: string }>;
  openUrl: (url: string) => void;
  backToSite: () => void;
  avatarCache: Record<string, string>;
}

/** 本地创作者（绑定 + 运行时附加字段） */
export interface LocalCreatorLike extends WorkshopCreator {
  _fromLocal?: boolean;
  _fromCommunity?: boolean;
  [key: string]: unknown;
}

/** @type {Function|null} 当前注册的 storage 监听器（模块私有，防泄漏） */
let _storageSyncFn: ((e: StorageEvent) => void) | null = null;

export function renderSiteView(site: WorkshopSite, ctx: RenderSiteViewCtx): void {
  const {
    esc,
    searchResults,
    creatorView,
    allCreators,
    allSites,
    repoAuthors,
    wsEditModeRef,
    showRepoModels,
    fillSearch,
    repoModelCache,
    openUrl,
    backToSite,
    avatarCache,
  } = ctx;

  searchResults.innerHTML = "";
  creatorView.style.display = "none";

  const creators = allCreators.filter(
    (cr) => cr.type && cr.type.split(";").includes(site.id),
  );

  // 作者模型计数查找表
  const authorCountMap: Record<string, number> = {};
  if (repoAuthors) {
    repoAuthors.forEach((a) => {
      const name = typeof a === "string" ? a : a.Name;
      const count = typeof a === "object" && a ? a.Count || 0 : 0;
      if (name) authorCountMap[name] = count;
    });
  }

  // 按仓库模型数降序排列（高产创作者优先）
  creators.sort(
    (a, b) => (authorCountMap[b.name] || 0) - (authorCountMap[a.name] || 0),
  );

  // 构建 HTML（纯函数，实现在 site-view-render.ts）
  const html = buildSiteHtml({
    esc, site, creators, allSites, wsEditModeRef, repoAuthors, authorCountMap, avatarCache,
  });
  searchResults.innerHTML = html;

  // 主入口编排：构造共享状态 → 调各块事件绑定 → 聚合 cleanup
  const refreshView = (): void => renderSiteView(site, ctx);
  const state: SiteViewState = {
    esc, searchResults, creatorView, allSites, allCreators, repoAuthors,
    wsEditModeRef, showRepoModels, fillSearch, repoModelCache, openUrl,
    backToSite, avatarCache, site, creators, authorCountMap, bus, ctx,
  };
  const unsubs: CleanupFn[] = [];
  unsubs.push(bindBrowseEvents(state, refreshView));

  // ===== 创作者编辑模式 =====
  searchResults.querySelector(".cr-edit-btn")?.addEventListener("click", () => {
    wsEditModeRef.v = true;
    refreshView();
  });

  // 拉取社区索引（creators + sites + github 仓库 + 资源类型）
  searchResults
    .querySelector(".cr-fetch-btn")
    ?.addEventListener("click", async () => {
      const btn = searchResults.querySelector(".cr-fetch-btn") as HTMLButtonElement;
      btn.textContent = "⏳";
      btn.disabled = true;
      try {
        const m = await import("./core.ts");
        const App = await getApp();
        const results = await Promise.all([
          m.fetchCommunityCreators(m.DEFAULT_COMMUNITY_URL),
          m.fetchCommunitySites(),
          App.LoadGitHubRepos().catch(function () {
            return [];
          }),
          App.LoadResourceTypes().catch(function () {
            return "{}";
          }),
        ]);
        const community = results[0],
          sitesData = results[1],
          gitHubRepos = results[2],
          resourceTypesRaw = results[3];
        const logs: string[] = [];
        let changed = false;

        if (community && community.length) {
          const r1 = m.mergeCommunityCreators(allCreators, community);
          await App.SaveWorkshopCreators(allCreators);
          if (r1.added || r1.updated) {
            logs.push(
              "创作者: +" + r1.added + " 补" + r1.updated,
            );
            changed = true;
          }
        }
        if (sitesData && sitesData.length) {
          const r2 = m.mergeCommunitySites(allSites, sitesData);
          if (r2.added > 0) {
            await App.SaveWorkshopSites(allSites);
            logs.push("站点: +" + r2.added);
            changed = true;
          }
        }
        if (gitHubRepos && gitHubRepos.length) {
          logs.push("GitHub: " + gitHubRepos.length + " 仓库");
          changed = true;
        }
        // resourceTypesRaw 是 JSON 字符串，解析后取 resourceTypes 数组
        let resourceTypes: unknown[] = [];
        try {
          const parsed = JSON.parse(resourceTypesRaw || "{}") as { resourceTypes?: unknown[] };
          resourceTypes = parsed.resourceTypes || [];
        } catch (_) {}
        if (resourceTypes.length) {
          logs.push("类型: " + resourceTypes.length + " 种");
          changed = true;
        }

        if (changed) {
          bus.emit("toast:show", {
            msg: "🌐 " + logs.join(" · "),
            duration: 4000,
            type: "success",
          });
          refreshView();
        } else {
          bus.emit("toast:show", {
            msg: "🌐 已是最新配置",
            duration: 3000,
            type: "success",
          });
        }
      } catch (e) {
        const err = e as Error;
        const errMsg = err.message === "NetworkOffline"
          ? "🌐 无网络连接，请检查网络后重试"
          : err.message === "NoIndex"
            ? "📭 社区索引文件不存在"
            : err.message === "RateLimited"
              ? "⏱️ GitHub API 频率限制，请稍后重试"
              : "🌐 " + friendlyError(e, "拉取失败");
        bus.emit("toast:show", {
          msg: errMsg,
          duration: 5000,
          type: "error",
        });
      } finally {
        btn.textContent = "🌐 更新配置";
        btn.disabled = false;
      }
    });

  searchResults
    .querySelector(".cr-cancel-btn")
    ?.addEventListener("click", () => {
      wsEditModeRef.v = false;
      refreshView();
    });

  // 保存（创作者 + 搜索词）
  searchResults
    .querySelector(".cr-save-btn")
    ?.addEventListener("click", async () => {
      try {
        // 校验数据完整性
        if (!site || !site.id) {
          bus.emit("toast:show", {
            msg: "❌ 站点信息丢失",
            duration: 3000,
            type: "error",
          });
          return;
        }

        // 保存搜索词 — 按站点原子保存
        if (allSites && site) {
          const { SaveWorkshopPresetsBySite } =
            await getApp();
          const newPresets: WorkshopPresetSearch[] = [];
          searchResults
            .querySelectorAll(
              ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
            )
            .forEach((inp) => {
              const val = (inp as HTMLInputElement).value.trim();
              // 原 JS 仅传 {label}，q 字段 Go 端 JSON 缺省兼容——类型上 cast 补齐
              if (val) newPresets.push({ label: val } as WorkshopPresetSearch);
            });
          await SaveWorkshopPresetsBySite(site.id, newPresets);
          site.presetSearches = newPresets;
        }
        // 保存创作者：先收集输入框值
        syncAllEditInputs();
        // 按站点保存 — 只传当前站点的创作者
        const siteCreators = creators.filter(
          (cr) => cr.type && cr.type.split(";").includes(site.id),
        );
        const { SaveWorkshopCreatorsBySite } =
          await getApp();
        await SaveWorkshopCreatorsBySite(site.id, siteCreators);
        wsEditModeRef.v = false;
        bus.emit("toast:show", {
          msg: "✅ 已保存",
          duration: 2000,
          type: "success",
        });
        refreshView();
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "保存失败"),
          duration: 4000,
          type: "error",
        });
      }
    });

  // ===== 拖拽 JSON 导入创作者/站点配置 =====
  const dropZone = searchResults.querySelector("#cr-drop-zone");
  if (dropZone) {
    let _dragCounter = 0;

    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      _dragCounter++;
      dropZone.classList.add("cr-drop-zone-active");
    };
    const onDragLeave = (): void => {
      _dragCounter--;
      if (_dragCounter <= 0) {
        _dragCounter = 0;
        dropZone.classList.remove("cr-drop-zone-active");
      }
    };
    const onDrop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      _dragCounter = 0;
      dropZone.classList.remove("cr-drop-zone-active");

      const file = e.dataTransfer?.files?.[0];
      if (!file || !file.name.endsWith(".json")) {
        bus.emit("toast:show", {
          msg: "❌ 请拖拽 .json 文件",
          duration: 3000,
          type: "error",
        });
        return;
      }

      const resetLabel = (): void => {
        dropZone.innerHTML =
          '<span class="cr-drop-icon">📥</span>' +
          '<span class="cr-drop-text">拖拽 JSON 文件到此处，导入创作者/站点配置</span>';
      };

      try {
        const text = await file.text();
        const data = JSON.parse(text) as Array<Record<string, unknown>>;
        if (!Array.isArray(data) || !data.length) {
          throw new Error("JSON 必须是对象数组");
        }

        const first = data[0];
        if (first && typeof first.name === "string") {
          // 创作者 JSON → Go 端 MergeWorkshopCreatorsFromJSON
          dropZone.textContent = "⏳ 正在合并创作者…";
          const { MergeWorkshopCreatorsFromJSON, LoadWorkshopCreators } =
            await getApp();
          const result = await MergeWorkshopCreatorsFromJSON(text);
          let added: number, updated: number;
          if (Array.isArray(result)) {
            added = result[0]; updated = result[1];
          } else {
            added = result; updated = 0;
          }
          // 刷新内存中的 allCreators
          const fresh = (await LoadWorkshopCreators()) || [];
          allCreators.length = 0;
          allCreators.push(...(fresh as LocalCreatorLike[]));
          bus.emit("toast:show", {
            msg: "✅ 创作者: 新增 " + added + "，更新 " + updated,
            duration: 3000,
            type: "success",
          });
        } else if (first && typeof first.id === "string" && typeof first.label === "string") {
          // 站点 JSON → 前端合并后调用 SaveWorkshopSites
          dropZone.textContent = "⏳ 正在合并站点…";
          const { SaveWorkshopSites } =
            await getApp();
          const existMap = new Map(allSites.map((s) => [s.id, s]));
          let added = 0, updated = 0;
          data.forEach((s) => {
            const sid = String(s.id);
            if (existMap.has(sid)) {
              Object.assign(existMap.get(sid) as object, s);
              updated++;
            } else {
              existMap.set(sid, s as unknown as WorkshopSite);
              allSites.push(s as unknown as WorkshopSite);
              added++;
            }
          });
          await SaveWorkshopSites(allSites);
          bus.emit("toast:show", {
            msg: "✅ 站点: 新增 " + added + "，更新 " + updated,
            duration: 3000,
            type: "success",
          });
        } else {
          throw new Error("JSON 格式无法识别（需含 name 字段或 id+label 字段）");
        }
      } catch (e) {
        bus.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "导入失败"),
          duration: 4000,
          type: "error",
        });
      } finally {
        resetLabel();
        refreshView();
      }
    };

    dropZone.addEventListener("dragenter", onDragEnter as EventListener);
    dropZone.addEventListener("dragover", (e) => e.preventDefault());
    dropZone.addEventListener("dragleave", onDragLeave);
    dropZone.addEventListener("drop", onDrop as unknown as EventListener);
  }

  // 行内编辑
  searchResults.querySelectorAll("[data-idx][data-fld]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
      const fld = (inp as HTMLElement).dataset.fld || "";
      if (creators[idx]) {
        if (inp.tagName === "SELECT") {
          creators[idx][fld] = Array.from((inp as HTMLSelectElement).selectedOptions)
            .map((o) => o.value)
            .filter(Boolean)
            .join(";");
        } else {
          creators[idx][fld] = (inp as HTMLInputElement).value.trim();
        }
      }
    });
  });

  // 删除创作者
  searchResults.querySelectorAll(".cr-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (creators[idx]) {
        const realIdx = allCreators.indexOf(creators[idx]);
        if (realIdx >= 0) allCreators.splice(realIdx, 1);
        refreshView();
      }
    });
  });

  // 创作者拖拽排序 — 仅拖拽柄触发
  let dragSrcIdx = -1;
  // 拖拽状态清理：防止 JS 异常后 class 卡死在 DOM 上
  const clearDragState = (): void => {
    dragSrcIdx = -1;
    dragPresetSrcIdx = -1;
    searchResults.querySelectorAll(".cr-edit-card").forEach((c) => {
      c.classList.remove("cr-dragging", "cr-drag-target", "cr-drag-before", "cr-drag-after");
    });
  };

  searchResults
    .querySelectorAll(".cr-edit-card:not([data-edit='preset'])")
    .forEach((card) => {
      const handle = card.querySelector(".cr-drag-handle");
      if (!handle) return;
      // 点拖拽柄时暂时让卡片可拖拽
      handle.addEventListener("mousedown", () => {
        (card as HTMLElement).draggable = true;
      });
      card.addEventListener("dragstart", (e: Event) => {
        const de = e as DragEvent;
        (card as HTMLElement).draggable = false;
        dragSrcIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        card.classList.add("cr-dragging");
        de.dataTransfer!.effectAllowed = "move";
        de.dataTransfer!.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).draggable = false;
        clearDragState();
      });
      card.addEventListener("dragover", (e: Event) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (dragSrcIdx >= 0) {
          const tgt = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
          if (dragSrcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (dragSrcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target", "cr-drag-before", "cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        if (dragSrcIdx < 0 || dragSrcIdx === targetIdx) return;
        syncAllEditInputs();
        const [removed] = creators.splice(dragSrcIdx, 1);
        creators.splice(targetIdx, 0, removed);
        allCreators.length = 0;
        allCreators.push(...creators);
        dragSrcIdx = -1;
        refreshView();
      });
    });

  // 搜索词拖拽排序 — 仅拖拽柄触发
  let dragPresetSrcIdx = -1;
  searchResults
    .querySelectorAll(".cr-edit-card[data-edit='preset']")
    .forEach((card) => {
      const handle = card.querySelector(".cr-drag-handle");
      if (!handle) return;
      handle.addEventListener("mousedown", () => {
        (card as HTMLElement).draggable = true;
      });
      card.addEventListener("dragstart", (e: Event) => {
        const de = e as DragEvent;
        (card as HTMLElement).draggable = false;
        dragPresetSrcIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        card.classList.add("cr-dragging");
        de.dataTransfer!.effectAllowed = "move";
        de.dataTransfer!.setData("text/plain", "");
      });
      card.addEventListener("dragend", () => {
        (card as HTMLElement).draggable = false;
        clearDragState();
      });
      card.addEventListener("dragover", (e: Event) => {
        e.preventDefault();
        (e as DragEvent).dataTransfer!.dropEffect = "move";
      });
      card.addEventListener("dragenter", (e) => {
        e.preventDefault();
        card.classList.add("cr-drag-target");
        if (dragPresetSrcIdx >= 0) {
          const tgt = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
          if (dragPresetSrcIdx < tgt) {
            card.classList.add("cr-drag-before");
          } else if (dragPresetSrcIdx > tgt) {
            card.classList.add("cr-drag-after");
          }
        }
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("cr-drag-target", "cr-drag-before", "cr-drag-after");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("cr-drag-target");
        const targetIdx = parseInt((card as HTMLElement).dataset.editIdx || "-1", 10);
        if (
          dragPresetSrcIdx < 0 ||
          dragPresetSrcIdx === targetIdx ||
          !site.presetSearches
        )
          return;
        syncAllEditInputs();
        const [removed] = site.presetSearches.splice(dragPresetSrcIdx, 1);
        site.presetSearches.splice(targetIdx, 0, removed);
        dragPresetSrcIdx = -1;
        refreshView();
      });
    });
  function syncAllEditInputs(): void {
    // 同步创作者输入框
    searchResults
      .querySelectorAll(
        ".cr-edit-card:not([data-edit='preset']) [data-idx][data-fld]",
      )
      .forEach((inp) => {
        const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
        const fld = (inp as HTMLElement).dataset.fld || "";
        if (creators[idx]) {
          if (inp.tagName === "SELECT") {
            creators[idx][fld] = Array.from((inp as HTMLSelectElement).selectedOptions)
              .map((o) => o.value)
              .filter(Boolean)
              .join(";");
          } else {
            creators[idx][fld] = (inp as HTMLInputElement).value.trim();
          }
        }
      });
    // 同步搜索词输入框
    searchResults
      .querySelectorAll(
        ".cr-edit-card[data-edit='preset'] input[data-fld='label']",
      )
      .forEach((inp) => {
        const idx = parseInt((inp as HTMLElement).dataset.idx || "-1", 10);
        if (site.presetSearches && site.presetSearches[idx]) {
          site.presetSearches[idx].label = (inp as HTMLInputElement).value.trim();
        }
      });
  }
  // 删除搜索词
  searchResults.querySelectorAll(".cr-del-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && site.presetSearches[idx]) {
        site.presetSearches.splice(idx, 1);
        refreshView();
      }
    });
  });
  // 搜索词排序
  searchResults.querySelectorAll(".cr-order-up").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && idx > 0) {
        const arr = site.presetSearches;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        refreshView();
      }
    });
  });
  searchResults.querySelectorAll(".cr-order-down").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncAllEditInputs();
      const idx = parseInt((btn as HTMLElement).dataset.idx || "-1", 10);
      if (site.presetSearches && idx < site.presetSearches.length - 1) {
        const arr = site.presetSearches;
        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
        refreshView();
      }
    });
  });

  // 新增创作者
  searchResults.querySelector(".cr-add")?.addEventListener("click", () => {
    syncAllEditInputs();
    creators.push({ name: "新作者", desc: "描述", type: site.id, tag: "" } as LocalCreatorLike);
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });
  // 新增搜索词
  searchResults
    .querySelector(".cr-add-preset")
    ?.addEventListener("click", () => {
      syncAllEditInputs();
      if (!site.presetSearches) site.presetSearches = [];
      site.presetSearches.push({ label: "", q: "" });
      refreshView();
    });

  // 🔍 创作者搜索 + 标签过滤
  let _activeTag = "";
  const applyFilters = (): void => {
    const kw = (searchInput?.value || "").trim().toLowerCase();
    const cards = searchResults.querySelectorAll(".gh-card[data-name]");
    let visible = 0;
    cards.forEach((card) => {
      const name = ((card as HTMLElement).dataset.name || "").toLowerCase();
      const desc = (
        card.querySelector(".cr-card-desc")?.textContent || ""
      ).toLowerCase();
      const cardTag = ((card as HTMLElement).dataset.tag || "").toLowerCase();
      const matchName = !kw || name.includes(kw) || desc.includes(kw);
      const matchTag = !_activeTag || _activeTag === cardTag;
      card.classList.toggle("cr-card-hidden", !(matchName && matchTag));
      if (matchName && matchTag) visible++;
    });
    const countEl = searchResults.querySelector("#ws-cr-count");
    if (countEl) countEl.textContent = "(" + visible + "/" + cards.length + ")";
  };

  const searchInput = searchResults.querySelector("#ws-cr-search") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  // 标签筛选按钮
  searchResults.querySelectorAll(".cr-tag-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      _activeTag = (btn as HTMLElement).dataset.tag || "";
      searchResults
        .querySelectorAll(".cr-tag-filter-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      applyFilters();
    });
  });
}
