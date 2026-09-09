// ===== 页面导航状态（类型化 — ADR-014 P3）=====
// 页面状态唯一来源 PageStore（AGENTS.md 4.1）：nav:changed 广播（app-content 单向）
// 经闭包 set 写入；运行时广播非法值一律拒绝（兜底重定向会把非用户意图写进状态）。
// 历史教训（setCurrentPage 幽灵路径、resources 死页）→ docs/knowledge/page-store.md
import { bus, type PageName } from "@/bus";
import { safeGet } from "@/utils/base/storage.ts";

/** 合法页面名全集（与 bus.ts PageName 联合双向约束：satisfies 防多写 + 覆盖断言防漏写） */
const VALID_PAGES = [
  "repository",
  "instances",
  "workshop",
  "github",
  "diagnostics",
  "settings",
] as const satisfies readonly PageName[];
// 全量覆盖断言：PageName 新增页面而未同步本表时编译期报错（防 isValidPage 静默拒绝新页）
type _AssertPageCoverage = PageName extends (typeof VALID_PAGES)[number] ? true : never;
const _assertPageCoverage: _AssertPageCoverage = true;
void _assertPageCoverage;

/** 运行时页面名校验（类型守卫）：nav:changed 是已发生事实，非法 emit 拒绝而非兜底 */
export function isValidPage(v: unknown): v is PageName {
  return typeof v === "string" && (VALID_PAGES as readonly string[]).includes(v);
}

/** 启动恢复的宽容解析：历史名 resources 映射回 repository，未知值兜底 repository
 *  （仅服务 resolveInitialPage；运行时广播走 isValidPage 严格拒绝） */
function sanitizePage(v: string | null): PageName {
  if (v === "resources") return "repository";
  return isValidPage(v) ? v : "repository";
}

/** 解析启动初始页面（app-nav / app-content / PageStore 三处同源调用）。
 *  优先级：① 设置项「启动默认页面」（ui-default-page）② 上次停留页（nav_page）③ 仓库页 */
export function resolveInitialPage(): PageName {
  const configured = safeGet("ui-default-page");
  if (configured) {
    return sanitizePage(configured);
  }
  const saved = safeGet("nav_page");
  if (saved) {
    return sanitizePage(saved);
  }
  return "repository";
}

// 状态闭包（ADR-189 D5）：写入路径共两条——nav:changed listener 调 set（导航事实同步）
// + get 首次触碰懒解析（消除模块求值期副作用）；文件内其他代码无法裸写
const pageState = (() => {
  let current: PageName | undefined;
  return {
    get(): PageName {
      const cur = current;
      if (cur !== undefined) return cur;
      const init = resolveInitialPage();
      current = init;
      return init;
    },
    /** 导航写入：仅 registerPageStore 的 nav:changed listener 调用 */
    set(p: PageName): void {
      current = p;
    },
  };
})();

export const PageStore = {
  get currentPage(): PageName {
    return pageState.get();
  },
};

/** 注册页面状态同步（app-content 编排调用，bus.on 的 unsub 收集进 unsubs 清理） */
export function registerPageStore(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("nav:changed", ({ page }) => {
      // 非法 emit 直接忽略：兜底重定向会让 _currentPage 与真实视图脱节
      if (!isValidPage(page)) return;
      if (page !== pageState.get()) {
        pageState.set(page);
      }
    }),
  );
}
