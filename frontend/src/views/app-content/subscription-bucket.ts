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
  pageUnsubs: Array<() => void | Promise<void>> = [];

  /** 注册全局单订阅 */
  setNavUnsub(fn: () => void): void {
    this.navUnsub = fn;
  }

  /** 添加全局订阅 */
  addGlobal(fn: () => void): void {
    this.globalUnsubs.push(fn);
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
    }
    this.drainPage();
  }
}
