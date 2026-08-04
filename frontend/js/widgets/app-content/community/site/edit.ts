// ===== 站点视图编辑模式事件（从 site-view.ts 拆出，ADR-034 方向①）=====
import { friendlyError } from "../../../../utils/dom/errors.ts";
import { bus } from "../../../../bus.ts";
import { getApp } from "../../../../wails/app.ts";
import type { WorkshopPresetSearch } from "../../../../../bindings/ysm-model-manager/go/types/models.ts";
import type { LocalCreatorLike } from "./index.ts";
import type { SiteViewState, CleanupFn } from "./types.ts";

/**
 * 绑定编辑模式事件：编辑入口 / 拉取配置 / 取消 / 保存 / 行内编辑 /
 * 删除创作者 / 拖拽排序 / 增删搜索词 / 搜索过滤。
 * 拖拽排序属编辑模式强相关，一并迁此。
 */
export function bindEditEvents(state: SiteViewState, refreshView: () => void): CleanupFn {
  const {
    esc: _esc, searchResults, allCreators, allSites,
    wsEditModeRef, site, creators, bus: busRef, ctx,
  } = state;
  void _esc; // esc 目前编辑块未直接用，保留接口对称

  // ===== 编辑入口 =====
  searchResults.querySelector(".cr-edit-btn")?.addEventListener("click", () => {
    wsEditModeRef.v = true;
    refreshView();
  });

  // ===== 拉取社区索引（creators + sites + github 仓库 + 资源类型）=====
  searchResults
    .querySelector(".cr-fetch-btn")
    ?.addEventListener("click", async () => {
      const btn = searchResults.querySelector(".cr-fetch-btn") as HTMLButtonElement;
      btn.textContent = "⏳";
      btn.disabled = true;
      try {
        const m = await import("../core.ts");
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
          busRef.emit("toast:show", {
            msg: "🌐 " + logs.join(" · "),
            duration: 4000,
            type: "success",
          });
          refreshView();
        } else {
          busRef.emit("toast:show", {
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
        busRef.emit("toast:show", {
          msg: errMsg,
          duration: 5000,
          type: "error",
        });
      } finally {
        btn.textContent = "🌐 更新配置";
        btn.disabled = false;
      }
    });

  // ===== 取消 =====
  searchResults
    .querySelector(".cr-cancel-btn")
    ?.addEventListener("click", () => {
      wsEditModeRef.v = false;
      refreshView();
    });

  // ===== 保存（创作者 + 搜索词）=====
  searchResults
    .querySelector(".cr-save-btn")
    ?.addEventListener("click", async () => {
      try {
        // 校验数据完整性
        if (!site || !site.id) {
          busRef.emit("toast:show", {
            msg: "❌ 站点信息丢失",
            duration: 3000,
            type: "error",
          });
          return;
        }

        // 保存搜索词 — 按站点原子保存
        if (allSites && site) {
          const { SaveWorkshopPresetsBySite } = await getApp();
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
        const { SaveWorkshopCreatorsBySite } = await getApp();
        await SaveWorkshopCreatorsBySite(site.id, siteCreators);
        wsEditModeRef.v = false;
        busRef.emit("toast:show", {
          msg: "✅ 已保存",
          duration: 2000,
          type: "success",
        });
        refreshView();
      } catch (e) {
        busRef.emit("toast:show", {
          msg: "❌ " + friendlyError(e, "保存失败"),
          duration: 4000,
          type: "error",
        });
      }
    });

  // ===== 行内编辑 =====
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

  // ===== 删除创作者 =====
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

  // ===== 创作者拖拽排序 — 仅拖拽柄触发 =====
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

  // ===== 搜索词拖拽排序 — 仅拖拽柄触发 =====
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

  // ===== 删除搜索词 =====
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

  // ===== 搜索词排序 =====
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

  // ===== 新增创作者 =====
  searchResults.querySelector(".cr-add")?.addEventListener("click", () => {
    syncAllEditInputs();
    creators.push({ name: "新作者", desc: "描述", type: site.id, tag: "" } as LocalCreatorLike);
    allCreators.push(creators[creators.length - 1]);
    refreshView();
  });

  // ===== 新增搜索词 =====
  searchResults
    .querySelector(".cr-add-preset")
    ?.addEventListener("click", () => {
      syncAllEditInputs();
      if (!site.presetSearches) site.presetSearches = [];
      site.presetSearches.push({ label: "", q: "" });
      refreshView();
    });

  // ===== 🔍 创作者搜索 + 标签过滤 =====
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

  // 编辑块无全局监听需清理，返回空 cleanup（统一接口）
  return () => {};
}
