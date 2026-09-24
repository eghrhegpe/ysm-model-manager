// ===== 页面导航纯函数（类型化 — ADR-014 P3）=====
// 本模块只提供共享纯函数：页面名合法性守卫（isValidPage）与启动初始页解析（resolveInitialPage）。
// 导航事实由事件总线（bus "nav:changed"）承载，组件各自响应；本模块不持有状态、不镜像。
import type { PageName } from "@/bus";
import { safeGet } from "@/utils/base/primitives/storage.ts";

/** 合法页面名全集（与 bus.ts PageName 联合双向约束：satisfies 防多写 + 覆盖断言防漏写） */
const VALID_PAGES = [
  "repository",
  "instances",
  "community",
  "github",
  "diagnostics",
  "settings",
] as const satisfies readonly PageName[];
// 全量覆盖断言：PageName 新增页面而未同步 VALID_PAGES 时编译期报错。
// 报错形如 "Type 'X' is not assignable to type 'never'" → 修复：在 VALID_PAGES 追加 X
//
// 为什么需要它：PageName 定义在 @/bus（导航事件载荷），VALID_PAGES 定义在本模块——
// 同一集合的双份声明无法自动同步。上一行 `satisfies readonly PageName[]` 只保证
// VALID_PAGES ⊆ PageName（防多写），本断言补 PageName ⊆ VALID_PAGES（防漏写），
// 两者合起来 = 集合相等。TS 对「数组字面量 ↔ 联合类型」没有原生等价断言，
// 条件类型 + never 是表达该不变量的唯一编译期手段。
type _AssertPageCoverage = PageName extends (typeof VALID_PAGES)[number] ? true : never;
const _assertPageCoverage: _AssertPageCoverage = true;
void _assertPageCoverage;

/** 运行时页面名校验（类型守卫）：nav:changed 是已发生事实，非法 emit 拒绝而非兜底 */
export function isValidPage(v: unknown): v is PageName {
  return typeof v === "string" && (VALID_PAGES as readonly string[]).includes(v);
}

/** 历史页名 → 现名别名表（启动恢复用；ADR-301 D2）。
 *  - `resources`：早期页名（既有）
 *  - `workshop`：创作者频道页 ADR-301 D1-a 改名前的 id，归位到 `community`。
 *    ⚠️ D1-b（`github→workshop`）暂缓，故 `workshop` 当前**不是**任何合法 PageName，
 *    别名 `workshop→community` 与合法值集无交集 → 历史 `nav_page="workshop"` 无歧义。
 *    若未来做 D1-b（workshop 重新成为合法值），此别名会与「新 workshop 值」撞语义，
 *    须同步改用一次性迁移 flag，勿只加映射（见 ADR-301 §2.0a / §2.3）。 */
const LEGACY_PAGE_ALIASES: Record<string, PageName> = {
  resources: "repository",
  workshop: "community",
};

/** 启动恢复的宽容解析：历史名经别名表归位，未知值兜底 repository
 *  （服务 resolveInitialPage 与设置页回显；运行时广播走 isValidPage 严格拒绝）。
 *  导出面：设置页「固定页」下拉框回显 legacy 值时也须过此函数——否则别名迁移
 *  只治启动读、不治 UI 回显（legacy workshop 存值 + community 选项 = 货不对板）。 */
export function sanitizePage(v: string | null): PageName {
  const alias: PageName | undefined = v ? LEGACY_PAGE_ALIASES[v] : undefined;
  if (alias) return alias;
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
