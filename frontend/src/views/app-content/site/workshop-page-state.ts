// ===== 创意工坊页作用域状态（ADR-263）=====
//
// 为什么需要这一层：`currentSite` 曾借宿 `AppContentState`（app 壳层共享容器），但它
// 的语义是**页私有**——「用户此刻在工坊页浏览哪个站点」。借宿的代价不是命名不雅，
// 而是契约：三个消费者拿到的都是整个 `AppContentState` 接口，谁都以为自己可以在上面
// 写点别的（tabs 就顺手写了 `workshopTimer`）。给它一个只含页语义的句柄，越界就编译不过。
//
// 形态与 `createWorkshopRefs()` 同族（同因同治）：**单源实例，消费者共享同一份**。
// 历史教训——`initWorkshopTabs` 写入的 ref 与 `showSiteView` 读取的 ref 不是同一对象，
// 造成「形状相同、实例不同」的 stale 闭包错位：tabs 更新了 `.v`，视图却永远读空数组。
// 因此本模块只提供工厂，**不提供模块级单例**——谁创建谁负责往下传。
//
// 与 `WorkshopRefs` 的分工：refs 收的是**可替换的整份数据**（sites/creators 数组会被
// 整体换新），page-state 收的是**页面级游标**（当前站点）。两者都不进 store，都不跨页。
//
// 生命周期归位：`currentSite` 为 null 仅发生在 `initWorkshopPage` 首次装配时——页面
// 面板常驻（ADR-163，切页不重跑 init），故切回工坊页时游标仍在，与「回到上次浏览的
// 站点」的期望一致，无需清理。真正的身份校验由 tabs 完成：`showCreatorsBySite` 在
// `sites.find()` 未命中时**直接 return**，不会写入不属于本次数据的站点（p7 修复）。
import type { WorkshopSite } from "@/bindings/ysm-model-manager/go/types/models.ts";

/**
 * 创意工坊页作用域状态句柄。
 *
 * 传给 `initWorkshopTabs` / `bindSiteEvents`，承载它们唯一需要的页语义：当前站点。
 *
 * ⚠️ 边界诚实说明：这两个模块**仍收 `host`**（它们还要 `host.state.root` 查 DOM、tabs 还要写
 * `workshopTimer`），所以「够不着 `root`」并非事实。本句柄兑现的是**更窄但确定**的一条：
 * 站点游标的读写**只能**经此接口——`host.state.currentSite` 已随字段删除而**编译不过**，
 * 而 `page` 上没有任何其他字段可写。要封死全部越界（含 `workshopTimer`），需把 `host` 也拆成
 * 最小面，属已知遗留（ADR-263 §3）。
 */
export interface WorkshopPageState {
  /** 当前浏览站点（未进入任何站点时为 null）；返回引用而非拷贝，调用方勿缓存 */
  getCurrentSite(): WorkshopSite | null;
  /** 写入当前站点；`null` 立即生效（showSiteView 的守卫读实时值，不读渲染快照） */
  setCurrentSite(site: WorkshopSite | null): void;
}

/** 创建页作用域状态（单一入口；所有消费者必须共享同一实例） */
export function createWorkshopPageState(): WorkshopPageState {
  let currentSite: WorkshopSite | null = null;
  return {
    getCurrentSite: () => currentSite,
    setCurrentSite: (site) => {
      currentSite = site;
    },
  };
}
