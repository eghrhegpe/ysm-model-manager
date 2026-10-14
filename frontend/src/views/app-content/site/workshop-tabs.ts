// ===== 创意工坊 Tab 管理 =====

import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";
import { t } from "@/core/i18n/t.ts";
import {
  type CommunityData,
  type LocalCreator,
  loadCommunityData,
  loadLocalAuthors,
  mergeLocalAuthorsInto,
} from "@/features/community/community-data.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc as escUtil } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { getSiteIcon } from "@/utils/icon/workshop-icons.ts";
import { bindTabA11y } from "@/views/app-content/tabs-a11y.ts";
import type { EditSession, RepoAuthorLike } from "./site-view.ts";
import { WS_LAST_TAB_KEY } from "./workshop-data.ts";
import type { WorkshopPageState } from "./workshop-page-state.ts";

/** 创意工坊 Tab 延迟加载毫秒数。恒为 0（loading 占位即首帧，人为延迟纯成本）；
 *  保留 setTimeout 机制仅为让壳层清理槽（ADR-265）能在重渲染时取消在途加载。 */
const WS_TAB_LOAD_DELAY_MS = 0;

/**
 * 创意工坊页的共享状态集合——单一事实来源。
 * 所有可变状态由 `createWorkshopRefs()` 生成一份，tabs 写入、showSiteView 读取同一实例，
 * 杜绝「形状相同、实例不同」的 stale-closure 错位。
 *
 * 为什么不套 `{ v: T }` 包装器（原写法）：数组与函数**整体替换**由持有 refs 的闭包
 * 天然可见（闭包捕获的是 refs 对象本身），无需再包一层间接层——那层只在
 * 「需要重绑原语/值语义」时才有意义，此处全是引用语义。
 * `wsEditModeRef` 仍保留 `{ v: boolean }`：它被 render/edit/site-view 等 7 处按
 * 「可变布尔句柄」消费（值语义传递，闭包捕获的是值的拷贝），拆它属另一维度改造。
 */
export interface WorkshopRefs {
  allSites: WorkshopSite[];
  allCreators: LocalCreator[];
  repoAuthors: RepoAuthorLike[];
  wsEditModeRef: { v: boolean };
  /**
   * 编辑期跨重渲会话状态（锐评高危修复，2026-10-14）：与 `wsEditModeRef` 同生命周期
   * ——编辑态下 enrich 补渲 / preset 增删排序等都会整站重渲，而 renderSiteView 每次
   * 重建 state；这两份状态（detachedNames / editSnapshot）必须由外层持有，
   * 否则重渲即清空（前者致保存时 Go 整条丢弃跨站条目 = 静默数据丢失，后者致 dirty 守卫失效）。
   */
  editSessionRef: EditSession;
  /** 站点视图渲染入口，由 init-workshop 注入（重建即新实例——模块级单例会让旧实例
   *  的迟到回调读到新注入闭包，造成跨实例串扰）。 */
  showSiteView: (site: WorkshopSite | null) => void;
}

/** 创建创意工坊页的共享状态对象（单一入口，所有消费者共享同一实例） */
export function createWorkshopRefs(): WorkshopRefs {
  return {
    allSites: [] as WorkshopSite[],
    allCreators: [] as LocalCreator[],
    repoAuthors: [] as RepoAuthorLike[],
    wsEditModeRef: { v: false },
    editSessionRef: { detachedNames: [], editSnapshot: null },
    showSiteView: () => {},
  };
}

/** 重建站点 tab 栏：清容器 → 逐站建按钮（initial 带 active）→ 交共享 a11y 原语接管语义与导航。
 *  自 reloadWorkshopTabs 抽出（认知复杂度收口）：本段是纯 DOM 装配，无 refs 写、无异步，
 *  分拆后 initWorkshopTabs 只剩「拉数 → 装配 → 渲染」的编排骨架。 */
function rebuildSiteTabBar(
  root: ShadowRoot,
  tabsEl: HTMLElement,
  sites: WorkshopSite[],
  initial: WorkshopSite,
  onActivate: (id: string) => void,
): void {
  tabsEl.innerHTML = "";
  for (const s of sites) {
    const btn = document.createElement("button");
    btn.className = `repo-tab tab-btn${s.id === initial.id ? " active" : ""}`;
    btn.dataset.tab = s.id;
    btn.innerHTML = `${getSiteIcon(s.id)} ${escUtil(s.label)}`;
    tabsEl.appendChild(btn);
  }
  // a11y + 点击/键盘分派交共享原语（与仓库/设置页同一份 ARIA/roving 真值）：站点 tab 是
  // 「动态生成 + 单一内容区」，套不进 bindTabs 的静态面板契约，故原语只接管语义与导航、
  // 内容切换走 onActivate。选择器限定 #ws-tabs 内，避免误伤同 shadow 下其他页的 .repo-tab。
  bindTabA11y({
    root,
    tabSelector: "#ws-tabs .repo-tab",
    panelId: () => "ws-search-results",
    validate: true,
    onActivate: (btn) => {
      const id = btn.dataset.tab ?? "";
      if (id) onActivate(id);
    },
  });
}

/** tab 栏空态：区分「加载失败」与「真无数据」（ADR-082 续），二者都不再永久停留 loading 占位。
 *  引导指向 importSite（空配置的正确解法是导入，不是导出空数据）。 */
function renderTabsEmptyState(tabsEl: HTMLElement, failed: boolean): void {
  const emptyText = failed ? t("common.loadFailed") : t("common.empty");
  tabsEl.innerHTML =
    '<span style="padding:var(--btn-padding-filter-lg);font-size:var(--fs-sm);color:var(--muted)">' +
    emptyText +
    " " +
    UI_ICONS.import +
    " " +
    t("workshop.importSite") +
    "</span>";
}

/**
 * 初始化创意工坊 Tab。
 * @returns `reloadWorkshopTabs()` — 完整重载入口（拉数据 → 重建 tab 栏 → 渲染初始站点），
 *   初次加载由内部 0ms 定时器发起；外部数据源变化（如站点导入成功）复用同一链路刷新，
 *   杜绝「导入成功但列表陈旧」。
 */
export function initWorkshopTabs(
  root: ShadowRoot,
  refs: WorkshopRefs,
  page: WorkshopPageState,
  registerDefaultSiteTimer: (t: ReturnType<typeof setTimeout>) => void,
): () => Promise<void> {
  // 本地扫描作者的后台补充：首屏不依赖磁盘扫描，扫完再合并进 allCreators 并重渲染当前站点。
  // enrichPending 在途去重（防双渲染），完成置 null 以便下次数据替换后再补；
  // 合并前重读 refs.allCreators——在途期间用户切 tab 换了新数组也能补到最新数据上。
  let enrichPending: Promise<void> | null = null;
  const maybeEnrich = (): void => {
    if (enrichPending) return;
    enrichPending = (async () => {
      try {
        const localAuthors = await loadLocalAuthors();
        if (localAuthors.length) {
          // mergeLocalAuthorsInto 是**原地**改（给命中条目置 _fromLocal），返回同一数组引用
          // ——对象身份保留，故行内输入的编辑值本身不会被这一步丢弃。
          refs.allCreators = mergeLocalAuthorsInto(refs.allCreators, localAuthors);
          // ⚠️ 编辑态不补渲（锐评 2026-10-14）。
          // 数据安全已由 `refs.editSessionRef` 治本（detachedNames/editSnapshot 跨重渲存活，
          // 覆盖 enrich 与 preset 增删排序等**所有**重渲路径，见 types.ts|EditSession 注释）；
          // 此处抑制是第二层：编辑态重渲会冲掉输入焦点与滚动位置，而 enrich 只是后台补充
          // 本地作者标记（`_fromLocal`，弱提示），不值得打断正在输入的用户。
          // 视觉生效推迟到退出编辑态的 refreshView（save/cancel 两条路径都已调，见 edit.ts）。
          if (!refs.wsEditModeRef.v) refs.showSiteView(page.getCurrentSite());
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
      refs.allSites = sites;
      refs.allCreators = creators;
      refs.repoAuthors = (authors || []) as RepoAuthorLike[];
      const site = sites.find((s) => s.id === siteType);
      // 站点已从新配置中消失（锐评修复，2026-10-14）：后台 tryAutoMergeCommunity /
      // 站点同步可能删站，而 tab 栏是上一份 sites 建的——此时 a11y 原语已把高亮切到被点的
      // 那颗「幽灵 tab」，内容区却因本分支早退而不动 → 用户看到「点了没反应」，
      // 且 tab 栏与 refs.allSites 脱节。修：按新 sites 重建 tab 栏并落到首个合法站点
      //（与 reloadWorkshopTabs 的 initial 回退同口径）。
      if (!site) {
        const tabsEl = root.getElementById("ws-tabs");
        const fallback = sites[0];
        // sites 为空 → 无合法落点，交给 reloadWorkshopTabs 的空态分支（下次重载时建空态）
        if (!tabsEl || !fallback) return;
        rebuildSiteTabBar(root, tabsEl, sites, fallback, (id) => void showCreatorsBySite(id));
        page.setCurrentSite(fallback);
        safeSet(WS_LAST_TAB_KEY, fallback.id);
        refs.showSiteView(page.getCurrentSite());
        maybeEnrich();
        return;
      }
      page.setCurrentSite(site);
      safeSet(WS_LAST_TAB_KEY, site.id);
      // tab 高亮 / roving tabindex / aria-selected 由 tabs-a11y 原语统一切换，此处只负责内容区重渲染
      refs.showSiteView(page.getCurrentSite());
      // 首屏已渲染，后台补充本地扫描作者（STALE 缓存，通常立即返回）
      maybeEnrich();
    } catch (e) {
      // async handler 最外层 catch 出口（ADR-044 ①）——否则抛错逸出为 unhandled rejection
      toast((e as Error)?.message || t("workshop.loadCommunityFailed"), TOAST_MS.normal, "error");
    }
  };

  // 完整重载链路（初载 + 导入后刷新共用）：拉数据 → 写 refs → 重建 tab 栏（复用 WS_LAST_TAB_KEY）→ 渲染初始站点。
  const reloadWorkshopTabs = async (): Promise<void> => {
    try {
      const data = await loadCommunityData();
      refs.allSites = data.sites;
      const tabsEl = root.getElementById("ws-tabs");
      if (!tabsEl) return; // 骨架缺失即页面残废，早退（与调用方 searchResults 同判据）
      // 空态优先短路：无站点不建按钮、不绑 a11y
      if (!data.sites.length) {
        renderTabsEmptyState(tabsEl, Boolean(data.failed));
        return;
      }
      // 恢复上次选中的 tab（用于决定首个激活项，与 bindTabA11y 的 pre-seeded active 对齐）
      const last = safeGet(WS_LAST_TAB_KEY);
      const initial = data.sites.find((s) => s.id === last) ?? data.sites[0];
      if (!initial) return; // sites 非空时不可达；防御下标越界（noUncheckedIndexedAccess）
      rebuildSiteTabBar(root, tabsEl, data.sites, initial, (id) => void showCreatorsBySite(id));
      // 默认显示初始站点（复用本次已加载数据，避免 showCreatorsBySite 二次拉取）
      await showCreatorsBySite(initial.id, data);
    } catch (e) {
      // 定时器回调最外层 catch 出口——与 showCreatorsBySite 同出口，不逸出 unhandled rejection
      toast((e as Error)?.message || t("workshop.loadCommunityFailed"), TOAST_MS.normal, "error");
    }
  };

  // 默认显示第一个站点。定时器经 registerDefaultSiteTimer 交壳层持有（ADR-265）：壳层在
  // _render 开头清它（清理点须早于 page.init，覆盖「未 init 就被切走」的窗口），tabs 只创建。
  registerDefaultSiteTimer(
    setTimeout(() => {
      void reloadWorkshopTabs();
    }, WS_TAB_LOAD_DELAY_MS),
  );

  // 导出重载入口给 init-workshop 注入 bindSiteEvents（站点导入成功后刷新列表，清旧 TODO）
  return reloadWorkshopTabs;
}
// 渲染入口收进 refs.showSiteView（init-workshop 注入），重建即新实例——
// 模块级单例会让旧实例迟到回调读到新闭包，造成跨实例串扰。
