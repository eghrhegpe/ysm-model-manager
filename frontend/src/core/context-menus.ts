// ===== 右键菜单映射（类型化版 — ADR-014 P3 core 收官；ADR-021 B 层声明式化）=====
// 将 ctx:show 事件转换为新版组件使用的 menu:show 事件
// 菜单结构来自 menu-defs.ts（唯一事实来源），此处只保留 orchestrator。
import { bus, type CtxShowPayload, type MenuItem } from "../bus.ts";
import { isViewerMode } from "../utils/dom/android-bridge.ts";
import { canWebAction } from "../utils/dom/capabilities.ts";
import { getMenuDef } from "./menu-defs";
// P1 修复（ADR-040）：handler 表已拆至 context-menu-handlers.ts；此处仅消费 HANDLERS，
// 不再 re-export 其余共享符号（无外部消费者，消除死代码）
import { HANDLERS } from "./context-menu-handlers.ts";
type MenuCtx = import("./context-menu-handlers.ts").MenuCtx;

// 查看器模式（Android/网页版 ADR-049）下仍可用的右键菜单动作判定全部收敛至
// utils/dom/capabilities.ts 的 canWebAction()（纯前端恒可达 + binding 走 can() 探测，
// 2026-XX P3 收敛）——本文件不再持有任何硬编码白名单。

/**
 * 安全求值节点级 visibleWhen：谓词可能抛异常（如访问 ctx.foo.bar 而 foo 为 undefined），
 * 若直接炸穿会拖垮整条菜单渲染。此处异常兜底为「不可见 + console.warn」，
 * 单条谓词 bug 不应让整份菜单消失（ADR-021 B 层 P1 扩展护栏）。
 */
function isItemVisible(item: { action?: string; visibleWhen?: (ctx: MenuCtx) => boolean }, ctx: MenuCtx): boolean {
  if (!item.visibleWhen) return true;
  try {
    return item.visibleWhen(ctx);
  } catch (err) {
    console.warn(
      `[context-menus] visibleWhen 抛异常（action=${item.action ?? "divider"}），按不可见处理`,
      err,
    );
    return false;
  }
}

function buildMenuItems(ctx: CtxShowPayload): MenuItem[] {
  const def = getMenuDef(ctx.type);
  if (!def) return [];
  const paths = ctx.paths || [];
  const norm: MenuCtx = { ...ctx, paths };
  const isViewer = isViewerMode();
  // 过滤链（自上而下 AND，任一失败即丢弃）：
  //   1. 节点级 visibleWhen(ctx)（菜单即数据 P1 扩展；未定义 → 通过；抛异常 → 不可见）
  //   2. viewer-mode 全局过滤（canWebAction 单一判定：纯前端 + binding 探测）
  // divider 折叠在此处（filter 之后）统一收口，渲染层 views/context-menu/index.ts 不再做去重。
  const items = def.items.filter((item) => {
    if (!isItemVisible(item, norm)) return false;
    if (item.divider) return true;
    if (!item.action) return true;
    if (!isViewer) return true;
    return canWebAction(item.action);
  });
  // divider 折叠：移除首/尾 divider 与相邻（连续）divider，避免渲染层出现多余/重复分割线。
  // 渲染层 show() 仅 item.divider → <hr>，无折叠逻辑，故折叠在此处（菜单即数据）收口。
  const collapsed = items.filter((it, i) => {
    if (!it.divider) return true;
    const prev = items[i - 1];
    const next = items[i + 1];
    const prevDivider = prev?.divider === true;
    const nextDivider = next?.divider === true;
    const atEdge = i === 0 || next === undefined;
    return !(prevDivider || nextDivider || atEdge);
  });
  return collapsed.map((item) => {
    if (item.divider) return { divider: true };
    const label = item.label ? item.label(norm) : undefined;
    const action = item.action;
    const handler = action ? HANDLERS[action] : undefined;
    if (action && !handler) {
      // menu-defs.ts 的 action 与 HANDLERS 表键失配（测试应断言零警告）
      console.warn(`[context-menus] 未注册 action: ${action}（见 menu-defs.ts）`);
    }
    const out: MenuItem = {
      action,
      label,
      onClick: handler ? () => handler(norm) : undefined,
    };
    if (item.icon) out.icon = item.icon;
    if (item.danger) out.danger = true;
    return out;
  });
}

/** 注册右键菜单映射（ctx:show → menu:show）；由 registerGlobalHandlers 统一调用，unsub 收集进 unsubs 清理 */
export function registerContextMenus(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("ctx:show", (payload) => {
      bus.emit("menu:show", {
        x: payload.x,
        y: payload.y,
        items: buildMenuItems(payload),
      });
    }),
  );
}
