// ===== 页面导航状态（类型化版 — ADR-014 P3 组件层）=====
// 治理红线：页面状态唯一来源是 PageStore（AGENTS.md 4.1）。
// 写入路径：_currentPage 只允许被 nav:changed 广播（app-content 完成导航后单向
// 广播）经闭包内 set 修改；禁止新增其他写入路径——历史教训：setCurrentPage 曾绕过
// 渲染链路且 emits 完成事件而非请求事件（被调用即「状态变、内容不渲染」的幽灵路径）。
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

/** 运行时页面名校验（类型守卫）。nav:changed 是已发生事实的广播，非法 emit 应拒绝
 *  （保持状态不变）而非兜底重定向——兜底会把非用户意图值写进状态/持久化 */
export function isValidPage(v: unknown): v is PageName {
  return typeof v === "string" && (VALID_PAGES as readonly string[]).includes(v);
}

/** 启动恢复的宽容解析：历史名 resources 映射回 repository，未知值兜底 repository
 *  （防死页——_render 落入 default 分支却无对应 init 分发，历史教训：resources 遗留值）。
 *  仅服务 resolveInitialPage 读 localStorage 旧值；运行时广播一律 isValidPage 严格拒绝 */
function sanitizePage(v: string | null): PageName {
  if (v === "resources") return "repository";
  return isValidPage(v) ? v : "repository";
}

/** 解析启动初始页面（app-nav / app-content / PageStore 三处同源调用）。
 *  优先级：① 设置项「启动默认页面」（ui-default-page）② 上次停留页（nav_page）③ 仓库页。
 *  "resources" 历史页面名映射回仓库页。 */
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

/** 页面状态闭包（ADR-189 D5）：读写仅经闭包内 get/set，写入点收敛为编译期事实——
 *  文件内其他代码无法绕过 set 裸写（原「唯一写入点」注释约定升级为闭包隔离） */
const pageState = (() => {
  let current: PageName | undefined;
  return {
    /** 首次触碰才解析 localStorage（消除模块求值期副作用，防初始页快照抢跑） */
    get(): PageName {
      const cur = current;
      if (cur !== undefined) return cur;
      const init = resolveInitialPage();
      current = init;
      return init;
    },
    /** 唯一写入函数：仅 registerPageStore 的 nav:changed listener 调用 */
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

/** 注册页面状态同步（由 app-content 编排调用，bus.on 的 unsub 收集进 unsubs 清理） */
export function registerPageStore(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("nav:changed", ({ page }) => {
      // nav:changed 是「已发生事实」的广播（视图已切）：非法 emit 直接忽略，不做
      // sanitize 兜底——兜底重定向成 repository 会让 _currentPage 与真实视图脱节，
      // 宽容解析只属于启动恢复（resolveInitialPage）
      if (!isValidPage(page)) return;
      if (page !== pageState.get()) {
        pageState.set(page);
      }
    }),
  );
}
