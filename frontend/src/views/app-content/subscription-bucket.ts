// ===== 订阅桶管理器（ADR-091 D22）=====
// 封装 app-content 的三桶订阅生命周期。
// 语义约定：
// - navUnsub:       全局单订阅（nav:changed），连入注册、卸载清除
// - globalUnsubs:   全局多订阅（lang:changed / repo:search-creator / handlers），
//                    连入注册、卸载清除，不随切页清空
// - pageUnsubs:     页面级订阅（各 initXxx 注入的 bus.on 退订）。**随页面常驻保留**，
//                    仅在 lang:changed 全量重建、与 disconnectedCallback 时清空。
//                    ⚠️ 不要在 _render() 开头清：ADR-163 让页面面板常驻缓存、每页 init 只跑一次，
//                    切页只是「换挂面板节点」而不重跑 init——此时若清了订阅，DOM 还在但事件已死
//                    （僵尸页：看着正常、点击无反应）。清理时机与面板缓存策略是绑定的，
//                    改其一必须同时改其二。
// 未来新增订阅必须二选一入桶，禁止裸 bus.on。
//
// 收异步清理（ADR-260）：addPage 接受 `() => void | Promise<void>`，桶内统一
// 经 swallowError fire-and-forget——拆除流程不得因单项失败中断，也不制造旁路字段。

import { swallowError } from "@/utils/base/primitives/async.ts";

export class SubscriptionBucket {
  navUnsub: (() => void) | null = null;
  globalUnsubs: Array<() => void> = [];
  /** addGlobalOnce 已用 key（随 cleanupAll 清空） */
  private globalKeys = new Set<string>();
  pageUnsubs: Array<() => void | Promise<void>> = [];
  /** addPageOnce 已用 key（同一代页面生命周期内去重；随 drainPage 清空） */
  private pageKeys = new Set<string>();

  /** 注册全局单订阅 */
  setNavUnsub(fn: () => void): void {
    this.navUnsub = fn;
  }

  /** 添加全局订阅 */
  addGlobal(fn: () => void): void {
    this.globalUnsubs.push(fn);
  }

  /**
   * 幂等注册全局订阅（ADR-261）：同一 `key` 在组件生命周期内只注册一次。
   * 与 `addPageOnce` 对称——key 随 `cleanupAll()` 清空，组件重建后天然可再注册。
   *
   * ⚠️ 收**工厂**而非现成退订函数（ADR-264）：`bus.on(...)` 在实参位置会被**立即求值**，
   * 于是「key 已存在 → 直接 return」的幂等分支会造出一个**已生效但未入桶**的孤儿订阅——
   * 没人持有它的退订函数，`cleanupAll()` 也清不掉，同一事件每重复 init 一次就多一个幽灵
   * 处理器（实测：二次 init 后一次 emit 触发两次）。改用 `() => bus.on(...)` 后，
   * 订阅只在 key 真正认领时才创建，孤儿不可能产生。
   */
  addGlobalOnce(key: string, subscribe: () => () => void): void {
    if (this.globalKeys.has(key)) return;
    this.globalKeys.add(key);
    this.globalUnsubs.push(subscribe());
  }

  /**
   * 注册页面级清理（bus 退订 / DOM 拆除 / 异步释放皆可）。
   * 收 `() => void | Promise<void>`：**异步清理不再另开旁路**——此前本方法只收同步，
   * 迫使异步清理在 AppContentState 上开了 `repoEventsCleanup` 专用字段，并经
   * github/workshop 两页的 getter/setter 注入链传递（2026-09 收口，见 ADR-260）。
   */
  addPage(fn: () => void | Promise<void>): void {
    this.pageUnsubs.push(fn);
  }

  /**
   * 幂等注册页面级订阅（ADR-261）：同一 `key` 在本代页面生命周期内只注册一次。
   *
   * 取代「各页在 AppContentState 上开布尔标志 + 由 index.ts 在 lang:changed 手工复位」
   * 的旧模式——那套标志的复位时机必须与面板世代同步，却散落在各页与协调器之间。
   * 此处把幂等交给**已经掌管页面生命周期**的桶：`drainPage()` 清空订阅的同时清空 key，
   * 故 lang:changed 全量重建后天然允许重新注册，无需任何外部复位。
   *
   * ⚠️ 同样收**工厂**（ADR-264，与 `addGlobalOnce` 同因）：现成退订函数在实参位置已求值，
   * 幂等分支 return 后它会成为入不了桶的孤儿订阅。
   */
  addPageOnce(key: string, subscribe: () => () => void | Promise<void>): void {
    if (this.pageKeys.has(key)) return;
    this.pageKeys.add(key);
    this.pageUnsubs.push(subscribe());
  }

  /** 清理页面级订阅（**仅** lang:changed 全量重建 / 卸载调用；切页不调，理由见文件头 ⚠️） */
  cleanupPage(): void {
    this.drainPage();
  }

  /**
   * 执行并清空页面级清理项。同步抛错与异步 reject 一并吞掉——
   * 拆除流程不得因单项失败而中断（与旧实现的 fire-and-forget 行为一致）。
   */
  private drainPage(): void {
    if (!this.pageUnsubs.length) return;
    for (const fn of this.pageUnsubs) {
      if (typeof fn !== "function") continue; // 历史容错：调用方可能 push 了非函数
      try {
        swallowError(Promise.resolve(fn()));
      } catch (e) {
        // 同步抛错：包装成 rejected promise 走同一日志出口，不逸出到调用方
        swallowError(Promise.reject(e));
      }
    }
    this.pageUnsubs = [];
    this.pageKeys.clear(); // 与订阅同寿命：清空后同 key 可再次注册（lang:changed 重建）
  }

  /** 清理所有订阅（disconnectedCallback 调用） */
  cleanupAll(): void {
    if (this.navUnsub) {
      this.navUnsub();
      this.navUnsub = null;
    }
    if (this.globalUnsubs.length) {
      this.globalUnsubs.forEach((fn) => {
        fn();
      });
      this.globalUnsubs = [];
      this.globalKeys.clear(); // 与订阅同寿命
    }
    this.drainPage();
  }
}
