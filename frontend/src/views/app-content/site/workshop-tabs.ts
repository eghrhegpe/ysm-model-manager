// ===== 创意工坊 Tab 管理 =====

import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import {
  type CommunityData,
  type LocalCreator,
  loadCommunityData,
  loadLocalAuthors,
  mergeLocalAuthorsInto,
} from "@/features/community/community-data.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc as escUtil } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { getSiteIcon } from "@/utils/icon/workshop-icons.ts";
import { bindTabA11y } from "@/views/app-content/tabs-a11y.ts";
import type { RepoAuthorLike } from "./site-view.ts";
import type { WorkshopPageState } from "./workshop-page-state.ts";

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
export function initWorkshopTabs(
  root: ShadowRoot,
  refs: WorkshopRefs,
  page: WorkshopPageState,
  registerDefaultSiteTimer: (t: ReturnType<typeof setTimeout>) => void,
): void {
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
          _showSiteView(page.getCurrentSite());
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
      page.setCurrentSite(site);
      safeSet("ysm-ws-last-tab", site.id);
      // tab 高亮 / roving tabindex / aria-selected 由 tabs-a11y 原语在 activate 时统一切换，
      // 此处只负责内容区重渲染（原手搓 querySelectorAll 去 active + add active 已收敛）。
      _showSiteView(page.getCurrentSite());
      // 首屏已渲染，后台补充本地扫描作者（STALE 缓存，通常立即返回）
      maybeEnrich();
    } catch (e) {
      // P2 修复（审核）：async handler 最外层 catch 出口（ADR-044 ①）——
      // loadCommunityData/showSiteView 抛错原逸出为 unhandled rejection
      bus.emit("toast:show", {
        msg: `❌ ${(e as Error)?.message || t("workshop.loadCommunityFailed")}`,
        duration: TOAST_MS.normal,
        type: "error",
      });
    }
  };

  // 默认显示第一个站点——定时器经 registerDefaultSiteTimer 交回 app 壳层持有（ADR-265）：
  // 壳层在 _render 开头清它（清理点必须早于 page.init，覆盖「未 init 就被切走」的窗口），
  // tabs 只负责创建，不再经 host.state 直达壳层字段。
  registerDefaultSiteTimer(
    setTimeout(async () => {
      try {
        const data = await loadCommunityData();
        refs.allSitesRef.v = data.sites;
        // 动态生成 Tab
        const tabsEl = root.getElementById("ws-tabs");
        if (tabsEl && data.sites.length) {
          // 恢复上次选中的 tab（用于决定首个激活项，与 bindTabA11y 的 pre-seeded active 对齐）
          const last = safeGet("ysm-ws-last-tab");
          const initial = data.sites.find((s) => s.id === last) || data.sites[0];
          tabsEl.innerHTML = "";
          data.sites.forEach((s) => {
            const btn = document.createElement("button");
            btn.className = `repo-tab${s.id === initial.id ? " active" : ""}`;
            btn.dataset.tab = s.id;
            btn.innerHTML = `${getSiteIcon(s.id)} ${escUtil(s.label)}`;
            tabsEl.appendChild(btn);
          });
          // 可访问性 + 点击/键盘分派交共享原语（与仓库/设置页同一份 ARIA/roving/键盘真值）：
          // 站点 tab 是「动态生成 + 单一内容区」，套不进 bindTabs 的静态面板契约，但同样
          // 需要 tablist/tab 语义、roving tabindex、方向键导航——原语只接管这些，内容切换走 onActivate。
          // 选择器限定在 #ws-tabs 内，避免误伤同 shadow 下其他页的 .repo-tab。
          bindTabA11y({
            root,
            tabSelector: "#ws-tabs .repo-tab",
            panelId: () => "ws-search-results",
            validate: true,
            onActivate: (btn) => {
              const id = btn.dataset.tab ?? "";
              if (id) void showCreatorsBySite(id);
            },
          });
          // 默认显示初始站点（复用本次已加载数据，避免 showCreatorsBySite 二次拉取）
          if (initial) await showCreatorsBySite(initial.id, data);
        } else if (tabsEl) {
          // 空态提示（e2e 反推）：原实现 sites 为空时永久停留 loading 占位，
          // 加载失败/无配置用户无感知——显示「暂无数据」并允许手动导入站点配置；
          // 加载失败则提示「加载失败」（ADR-082 续：区分失败与真无数据，不再空白无感知）
          // 锐评 P0-1 修复：原此处 import 图标配「导出站点」文案——恢复路径指反了门
          //（空配置的正确解法是导入，不是导出空数据），图标与文案一并对齐 importSite。
          const emptyText = data.failed ? t("common.loadFailed") : t("common.empty");
          tabsEl.innerHTML =
            '<span style="padding:var(--btn-padding-filter-lg);font-size:var(--fs-sm);color:var(--muted)">' +
            emptyText +
            " " +
            UI_ICONS.import +
            " " +
            t("workshop.importSite") +
            "</span>";
        }
      } catch (e) {
        // P3 修复（审核）：定时器回调最外层 catch 出口——原 loadCommunityData 在 try 外，
        // getApp 失败逸出 unhandled rejection（与 showCreatorsBySite 同出口）
        bus.emit("toast:show", {
          msg: `❌ ${(e as Error)?.message || t("workshop.loadCommunityFailed")}`,
          duration: TOAST_MS.normal,
          type: "error",
        });
      }
    }, WS_TAB_LOAD_DELAY_MS),
  );
}

// 实际函数由 init-workshop.ts 注入
// 【保留不 reset】initWorkshopPage 每次调用都覆盖 _showSiteView（init-workshop.ts:139），
// 旧闭包残留但无实际泄漏风险（组件未重挂载时旧 host 也未销毁，闭包仍有效）。
let _showSiteView: (site: WorkshopSite | null) => void = () => {};

export function setShowSiteView(fn: (site: WorkshopSite | null) => void): void {
  _showSiteView = fn;
}
