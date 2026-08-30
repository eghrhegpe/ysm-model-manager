// ===== 创意工坊 Tab 管理 =====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { t } from "../../core/i18n/t.ts";
import { bus } from "../../bus.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { getSiteIcon } from "../../utils/icon/workshop-icons.ts";
import { esc as escUtil } from "../../utils/dom/html.ts";
import { loadCommunityData, loadLocalAuthors, mergeLocalAuthorsInto, type LocalCreator, type CommunityData } from "./community-data.ts";
import type { WorkshopSite } from "../../../bindings/ysm-model-manager/go/types/models.ts";
import type { RepoAuthorLike } from "./site-view.ts";
import type { AppContentHost } from "./init-workshop.ts";

/** 创意工坊 Tab 延迟加载毫秒数（等首帧渲染后再异步拉数据） */
const WS_TAB_LOAD_DELAY_MS = 100;

/**
 * 创意工坊页的共享 ref 集合——单一事实来源。
 * 所有可变状态（sites/creators/repoAuthors/editMode）由 `createWorkshopRefs()` 生成一份，
 * tabs 写入 `.v`，showSiteView 读取 `.v`——杜绝「形状相同、实例不同」的 stale-closure 错位 bug。
 */
export interface WorkshopRefs {
  allSitesRef: { v: WorkshopSite[] };
  allCreatorsRef: { v: LocalCreator[] };
  repoAuthorsRef: { v: RepoAuthorLike[] };
  wsEditModeRef: { v: boolean };
}

/** 创建创意工坊页的共享 ref 对象（单一入口，所有消费者共享同一实例） */
export function createWorkshopRefs(): WorkshopRefs {
  return {
    allSitesRef: { v: [] as WorkshopSite[] },
    allCreatorsRef: { v: [] as LocalCreator[] },
    repoAuthorsRef: { v: [] as RepoAuthorLike[] },
    wsEditModeRef: { v: false },
  };
}

/**
 * 初始化创意工坊 Tab
 */
export function initWorkshopTabs(host: AppContentHost, refs: WorkshopRefs): void {
  const root = host._root;
  const searchResults = root.getElementById("ws-search-results") as HTMLElement | null;
  const creatorView = root.getElementById("ws-creator-view") as HTMLElement | null;

  // 本地扫描作者的后台补充：首屏渲染不依赖磁盘扫描（曾阻塞 tab 栏秒级~分钟级），
  // 扫描完成后再合并进 allCreatorsRef 并重渲染当前站点视图。
  // enrichPending 在途去重（防双渲染）；完成后置 null，下次数据替换（切 tab 重拉）可再补充；
  // 合并前重读 refs.allCreatorsRef.v——在途期间用户切 tab 换了新数组也能补到最新数据上
  let enrichPending: Promise<void> | null = null;
  const maybeEnrich = (): void => {
    if (enrichPending) return;
    enrichPending = (async () => {
      try {
        const localAuthors = await loadLocalAuthors();
        if (localAuthors.length) {
          refs.allCreatorsRef.v = mergeLocalAuthorsInto(refs.allCreatorsRef.v, localAuthors);
          _showSiteView(host._currentSite);
        }
      } catch {
        // 补充失败不影响首屏（首屏已可用），静默降级
      } finally {
        enrichPending = null;
      }
    })();
  };

  // B站/爱发电 tab 点击 → 在右侧显示对应站点的创作者（不打开网站）
  // data 可选：定时器首次加载复用同一份数据，避免进页双重 loadCommunityData
  const showCreatorsBySite = async (siteType: string, data?: CommunityData): Promise<void> => {
    try {
      const { sites, creators, authors } = data ?? (await loadCommunityData());
      refs.allSitesRef.v = sites;
      refs.allCreatorsRef.v = creators;
      refs.repoAuthorsRef.v = (authors || []) as RepoAuthorLike[];
      const site = sites.find((s) => s.id === siteType);
      if (!site) return;
      host._setCurrentSite(site);
      safeSet("ysm-ws-last-tab", site.id);
      // tab 切换高亮
      root
        .querySelectorAll(".repo-tab")
        .forEach((t) => t.classList.remove("active"));
      root.querySelector(`[data-tab="${siteType}"]`)?.classList.add("active");
      _showSiteView(host._currentSite);
      // 首屏已渲染，后台补充本地扫描作者（STALE 缓存，通常立即返回旧值）
      maybeEnrich();
    } catch (e) {
      // P2 修复（审核）：async handler 最外层 catch 出口（ADR-044 ①）——
      // loadCommunityData/showSiteView 抛错原逸出为 unhandled rejection
      bus.emit("toast:show", {
        msg: "❌ " + (e as Error)?.message || t("workshop.loadCommunityFailed"),
        duration: TOAST_MS.normal,
        type: "error",
      });
    }
  };

  // 默认显示第一个站点
  host._setWorkshopTimer(setTimeout(async () => {
    try {
      const data = await loadCommunityData();
      refs.allSitesRef.v = data.sites;
      // 动态生成 Tab
      const tabsEl = root.getElementById("ws-tabs");
      if (tabsEl && data.sites.length) {
        tabsEl.innerHTML = "";
        data.sites.forEach((s, i) => {
          const btn = document.createElement("button");
          btn.className = "repo-tab" + (i === 0 ? " active" : "");
          btn.dataset.tab = s.id;
          btn.innerHTML = getSiteIcon(s.id) + " " + escUtil(s.label);
          btn.addEventListener("click", () => showCreatorsBySite(s.id));
          tabsEl.appendChild(btn);
        });
        // 默认显示第一个（复用本次已加载数据，避免 showCreatorsBySite 二次拉取）
        if (data.sites[0]) {
          // 恢复上次选中的 tab
          const last = safeGet("ysm-ws-last-tab") || data.sites[0].id;
          const target = data.sites.find((s) => s.id === last) || data.sites[0];
          await showCreatorsBySite(target.id, data);
        }
      } else if (tabsEl) {
        // 空态提示（e2e 反推）：原实现 sites 为空时永久停留 loading 占位，
        // 加载失败/无配置用户无感知——显示「暂无数据」并允许手动导入站点配置；
        // 加载失败则提示「加载失败」（ADR-082 续：区分失败与真无数据，不再空白无感知）
        const { t } = await import("../../core/i18n/t.ts");
        const emptyText = data.failed ? t("common.loadFailed") : t("common.empty");
        tabsEl.innerHTML =
          '<span style="padding:4px 12px;font-size:var(--fs-sm);color:var(--muted)">' +
          emptyText +
          " 📤 " +
          t("workshop.exportSite") +
          "</span>";
      }
    } catch (e) {
      // P3 修复（审核）：定时器回调最外层 catch 出口——原 loadCommunityData 在 try 外，
      // getApp 失败逸出 unhandled rejection（与 showCreatorsBySite 同出口）
      bus.emit("toast:show", {
        msg: "❌ " + (e as Error)?.message || t("workshop.loadCommunityFailed"),
        duration: TOAST_MS.normal,
        type: "error",
      });
    }
  }, WS_TAB_LOAD_DELAY_MS));
}

// 实际函数由 init-workshop.ts 注入
let _showSiteView: (site: WorkshopSite | null) => void = () => {};

export function setShowSiteView(fn: (site: WorkshopSite | null) => void): void {
  _showSiteView = fn;
}
