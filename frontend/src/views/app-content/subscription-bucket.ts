// ===== 订阅桶管理器（ADR-091 D22）=====
// 封装 app-content 的三桶订阅生命周期。
// 语义约定：
// - navUnsub:       全局单订阅（nav:changed），连入注册、卸载清除
// - globalUnsubs:   全局多订阅（lang:changed / repo:search-creator / handlers），
//                    连入注册、卸载清除，不随切页清空
// - pageUnsubs:     页面级临时订阅（各 initXxx 注入的 bus.on 退订），
//                    每次 _render() 开头清空（防跨页累积）+ disconnectedCallback 兜底
// 未来新增订阅必须二选一入桶，禁止裸 bus.on。

export class SubscriptionBucket {
  navUnsub: (() => void) | null = null;
  globalUnsubs: Array<() => void> = [];
  pageUnsubs: Array<() => void> = [];

  /** 注册全局单订阅 */
  setNavUnsub(fn: () => void): void {
    this.navUnsub = fn;
  }

  /** 添加全局订阅 */
  addGlobal(fn: () => void): void {
    this.globalUnsubs.push(fn);
  }

  /** 添加页面级订阅 */
  addPage(fn: () => void): void {
    this.pageUnsubs.push(fn);
  }

  /** 清理页面级订阅（_render 开头调用，防跨页累积） */
  cleanupPage(): void {
    if (this.pageUnsubs.length) {
      this.pageUnsubs.forEach((fn) => {
        if (typeof fn === "function") fn();
      });
      this.pageUnsubs = [];
    }
  }

  /** 清理所有订阅（disconnectedCallback 调用） */
  cleanupAll(): void {
    if (this.navUnsub) {
      this.navUnsub();
      this.navUnsub = null;
    }
    if (this.globalUnsubs.length) {
      // biome-ignore lint/suspicious/useIterableCallbackReturn: forEach 惯用副作用，返回值无需消费
      this.globalUnsubs.forEach((fn) => fn());
      this.globalUnsubs = [];
    }
    if (this.pageUnsubs.length) {
      this.pageUnsubs.forEach((fn) => {
        if (typeof fn === "function") fn();
      });
      this.pageUnsubs = [];
    }
  }
}
