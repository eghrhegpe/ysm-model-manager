// ===== 页面导航纯函数（类型化 — ADR-014 P3）=====
// 本模块只提供共享纯函数：页面名合法性守卫（isValidPage）与启动初始页解析（resolveInitialPage）。
// 导航事实由事件总线（bus "nav:changed"）承载，组件各自响应；本模块不持有状态、不镜像。
import type { PageName } from "@/bus";
import { safeGet } from "@/utils/base/primitives/storage.ts";

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

/** 解析启动初始页面（app-nav / app-content 两处同源调用）。
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
