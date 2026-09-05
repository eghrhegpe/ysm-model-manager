// ===== 页面导航状态（类型化版 — ADR-014 P3 组件层）=====
// 治理红线：页面状态唯一来源是 PageStore（AGENTS.md 4.1）
import { bus, type PageName } from "../bus.ts";
import { safeGet } from "../utils/dom/storage.ts";

// 唯一写入点：_currentPage 只允许被 registerPageStore 的 nav:changed listener
// 修改（app-content 完成导航后单向广播）；禁止新增其他写入路径，否则页面
// 状态出现幽灵路径（历史教训：setCurrentPage 曾绕过渲染链路，且 emits 完成
// 事件而非请求事件，被调用即"状态变、内容不渲染"）。

/**
 * 解析启动初始页面（app-nav / app-content / PageStore 三处同源调用）。
 * 优先级：① 设置项「启动默认页面」（ui-default-page，用户显式配置）
 *        ② 上次停留页（nav_page，app-nav 每次切页写入）
 *        ③ 仓库页（repository，兜底）
 * "resources" 为历史页面名，映射回仓库页。
 * 未知值（遗留/损坏的 localStorage）回退 repository，防止 _render 落入
 * default 分支却无对应 init 分发（死页，历史教训：resources 遗留值）。
 */
const VALID_PAGES: PageName[] = [
  "repository",
  "instances",
  "workshop",
  "github",
  "diagnostics",
  "settings",
];

/** 运行时页面名校验（类型守卫）。广播守卫用：nav:changed 是已发生事实的广播，
 *  非法 emit 应拒绝（保持状态不变）而非兜底重定向——兜底会把非用户意图值写进
 *  状态/持久化，造成高亮与视图脱节（P2 修复，2026-09-05 增量深评） */
export function isValidPage(v: unknown): v is PageName {
  return typeof v === "string" && (VALID_PAGES as readonly string[]).includes(v);
}

/** 启动恢复的宽容解析：历史名 resources 映射回 repository，未知值兜底 repository
 *  （防死页——_render 落入 default 分支却无对应 init 分发，历史教训：resources 遗留值）。
 *  仅服务 resolveInitialPage 读 localStorage 旧值；运行时广播一律用 isValidPage 严格拒绝 */
function sanitizePage(v: string | null): PageName {
  if (v === "resources") return "repository"; // 历史页面名映射
  return isValidPage(v) ? v : "repository";
}

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

let _currentPage: PageName = resolveInitialPage();

export const PageStore = {
  get currentPage(): PageName {
    return _currentPage;
  },
};

/** 注册页面状态同步（由 app-content 编排调用（ADR-185），bus.on 的 unsub 收集进 unsubs 清理） */
export function registerPageStore(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("nav:changed", ({ page }) => {
      // P2 修复（增量深评，2026-09-05）：非法 emit 直接忽略，不做 sanitize 兜底——
      // nav:changed 是「已发生事实」的广播（视图已切），兜底重定向成 repository
      // 会让 _currentPage 与真实视图脱节；宽容解析只属于启动恢复（resolveInitialPage）
      if (!isValidPage(page)) return;
      if (page !== _currentPage) {
        _currentPage = page;
      }
    }),
  );
}
