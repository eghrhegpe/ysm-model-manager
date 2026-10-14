// ===== 创意工坊页初始化（为 app-content/index.ts 减负，ADR-040）=====
// 本文件是纯编排入口（~80行），所有具体逻辑已拆到子模块：
// - workshop-tabs.ts: Tab 管理、创作者列表加载
// - workshop-browse-mode.ts: 浏览模式（外链/内嵌/窗口）
// - workshop-site-opener.ts: 站点打开、内嵌浏览器、导出/导入
// - workshop-avatar.ts: 创作者头像提取

import { Events } from "@/backend/runtime.ts";
import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";
import { bus } from "@/bus";
import { fillSearch } from "@/features/community/community-data.ts";
import {
  getAvatar,
  getAvatarSnapshot,
  setAvatar,
} from "@/features/community/creator-avatar-store.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { esc } from "@/utils/html/html.ts";
import { type RenderSiteViewCtx, renderSiteView } from "@/views/app-content/site/site-view.ts";
import {
  type BrowseMode,
  createBrowseModeRef,
  loadBrowseMode,
  saveBrowseMode,
} from "@/views/app-content/site/workshop-browse-mode.ts";
import type { AppContentHost } from "./host.ts";
import { captureEditFocus, restoreEditFocus } from "./site/focus-restore.ts";
import { extractAvatars } from "./site/workshop-avatar.ts";
import { loadActiveTag, loadSearchKw } from "./site/workshop-data.ts";
import { createWorkshopPageState } from "./site/workshop-page-state.ts";
import { bindSiteEvents, openSite } from "./site/workshop-site-opener.ts";
import { createWorkshopRefs, initWorkshopTabs } from "./site/workshop-tabs.ts";

/**
 * 初始化创意工坊页（编排入口）
 */
export function initWorkshopPage(host: AppContentHost): void {
  const root = host.state.root;
  const searchResults = root.getElementById("ws-search-results");
  if (!searchResults) return; // 骨架缺失即页面残废，早退（原下游 !/as 断言）
  // 页作用域状态（ADR-263）：currentSite 归工坊页——不再借宿 AppContentState。
  // 单一入口创建一份实例，tabs（写）/ opener（读）/ 本文件的注入链（读写）共享同一份，
  // 与 refs 同构：杜绝「形状相同、实例不同」的 stale 错位 bug。
  const page = createWorkshopPageState();
  // 单一入口：tabs 写入、showSiteView 读取，共享同一实例（杜绝「形状相同、实例不同」错位）
  const refs = createWorkshopRefs();

  // 浏览模式：单源 ref（{ v }）＋ setter——setBrowseMode 改 .v 即让
  // re-render 高亮与 openUrl 打开同时读到新值，无需退出页面、无值拷贝 stale。
  const browseModeRef = createBrowseModeRef(loadBrowseMode());
  const setBrowseMode = (mode: BrowseMode): void => {
    browseModeRef.v = mode;
    saveBrowseMode(mode);
  };

  // 后台批量提取创作者头像（写入 community 层 store，ADR-264：不再置空 host.state.avatarCache——
  // 那个缓存跨页存活，每次进工坊页清零会把下载期间累积的增量抹掉）
  extractAvatars();
  // 配置加载完成后重新提取
  if (!_avatarConfigLoadedRegistered) {
    _avatarConfigLoadedRegistered = true;
    _avatarConfigLoadedUnsub = Events.On("config-loaded", () => {
      dbg("avatar", "配置已加载，重新提取头像");
      extractAvatars();
    });
  }

  // 站点视图切换（先定义，再注册给 tabs）
  // 保存上一次渲染的 cleanup 函数，切站点时先清理旧监听再渲染新视图
  let _prevSiteViewCleanup: (() => void) | null = null;
  // 统一清理入口：所有 renderSiteView 调用（首次渲染 + refreshView 重渲染）先跑旧
  // cleanup 再存新 cleanup——确保切站点清理的是**最新**视图的监听，且旧渲染 DOM 不被
  // 闭包链保留（此前 refreshView 直接调 renderSiteView 丢弃 cleanup，_prevSiteViewCleanup
  // 永远只持有首次渲染的 cleanup，首次渲染 DOM 保留到下次切站点）。
  const runPrevSiteViewCleanup = (): void => {
    if (_prevSiteViewCleanup) {
      _prevSiteViewCleanup();
      _prevSiteViewCleanup = null;
    }
  };
  const showSiteView = (site: WorkshopSite | null): void => {
    if (!site) return;
    // 清理旧站点视图的监听器，防止切页时事件泄漏
    runPrevSiteViewCleanup();
    const openUrl = (url: string): void => {
      // 透传目标 URL：搜索按钮拼好的带词链接（fillSearch）需真正打开，不能丢弃只开首页
      openSite(root, site, browseModeRef.v, url);
    };
    const ctx: RenderSiteViewCtx = {
      esc: (s) => esc(s == null ? "" : String(s)),
      searchResults,
      allSites: refs.allSites,
      allCreators: refs.allCreators,
      repoAuthors: refs.repoAuthors,
      wsEditModeRef: refs.wsEditModeRef,
      fillSearch,
      openUrl,
      // 头像表直接取 store 活体引用（ADR-264）：增量写是原地改写，已渲染 ctx 能立即看到新值
      avatarCache: getAvatarSnapshot(),
      browseMode: browseModeRef,
      setBrowseMode,
      // 筛选态按本站 id 分域读取（历史缺陷：全局单键，切站点后旧标签套到新站 → 网格全空白）
      activeTag: loadActiveTag(site.id),
      searchKw: loadSearchKw(site.id),
      // 重渲染（编辑切换/保存/拖拽/搜索等）经同一 wrapper：先跑旧 cleanup 再存新
      // cleanup（见 runPrevSiteViewCleanup 注释），供 site-view 的 refreshView 调用。
      reRender: () => {
        // 锐评 Perf #3（2026-10-14）：整站重渲会销毁重建 preset 编辑按钮，键盘/连点
        // 排序时第二次操作落回body。渲染前记锚点、渲染后按 preset 稳定身份恢复焦点。
        const focusAnchor = captureEditFocus(searchResults);
        runPrevSiteViewCleanup();
        _prevSiteViewCleanup = renderSiteView(site, ctx);
        restoreEditFocus(searchResults, focusAnchor);
      },
    };
    _prevSiteViewCleanup = renderSiteView(site, ctx);
  };

  // 注册 showSiteView 给 tabs 模块使用（必须在 initWorkshopTabs 之前）
  // P1-8：渲染入口收进 refs（原 setShowSiteView 模块级单例已删），重建即新实例
  refs.showSiteView = showSiteView;

  // 初始化 Tab（返回完整重载入口——站点导入成功后复用同一链路刷新）
  // 定时器交回壳层持有（ADR-265）：清理点在 _render 开头（早于本 init），归属不变，
  // 只是 tabs 不再经 host.state 直达壳层字段。
  const reloadWorkshopTabs = initWorkshopTabs(root, refs, page, (t) => {
    host.state.workshopTimer = t;
  });

  // 绑定站点打开事件（导入成功 → 注入 tabs 重载入口，刷新 tab 栏与创作者列表）
  bindSiteEvents(root, page, () => reloadWorkshopTabs());

  // 下载完成后增量刷新创作者头像。幂等注册（ADR-261）：原靠 `state.avatarRefreshRegistered`
  // 布尔标志 + cleanupTransient 手工复位；现交给订阅桶的 addGlobalOnce——key 与全局订阅同寿命，
  // cleanupAll() 清空订阅时一并清 key（组件重建后天然可再注册）。
  //
  // ⚠️ 这个订阅仍住 global 桶（ADR-264）：其数据源（下载队列）跨页存活，事件在任意页面派发。
  // 区别是它现在写的是 community 层 store 而非工坊页借宿字段——「替页面写数据」的错位已消除。
  host.subs.addGlobalOnce(
    "workshop:avatar-refresh",
    // 工厂形式（ADR-264）：订阅只在 key 真正认领时创建——否则重复 init 会遗留孤儿订阅
    () =>
      bus.on("avatar:refresh", ({ author, dataUri }) => {
        if (getAvatar(author) === dataUri) return;
        setAvatar(author, dataUri);
        let found = false;
        root.querySelectorAll(".cr-creator-card").forEach((c) => {
          if ((c as HTMLElement).dataset.name === author) {
            const img = c.querySelector(".cr-avatar") as HTMLImageElement | null;
            if (img && img.tagName === "IMG") img.src = dataUri;
            found = true;
          }
        });
        const cur = page.getCurrentSite();
        if (!found && cur) showSiteView(cur);
      }),
  );
}

// ==================== 模块级状态 ====================

/** 防止 avatar:config-loaded 事件重复注册（模块级状态，经 reset 函数与 index.ts 协作） */
let _avatarConfigLoadedRegistered = false;
let _avatarConfigLoadedUnsub: (() => void) | null = null;

/** 供 app-content disconnectedCallback 调用：回收 config-loaded 订阅并复位注册 flag */
export function resetAvatarConfigLoaded(): void {
  if (_avatarConfigLoadedUnsub) {
    _avatarConfigLoadedUnsub();
    _avatarConfigLoadedUnsub = null;
  }
  _avatarConfigLoadedRegistered = false;
}
