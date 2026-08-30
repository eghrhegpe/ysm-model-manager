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

function buildMenuItems(ctx: CtxShowPayload): MenuItem[] {
  const def = getMenuDef(ctx.type);
  if (!def) return [];
  const paths = ctx.paths || [];
  const norm: MenuCtx = { ...ctx, paths };
  const isViewer = isViewerMode();
  // 过滤链（自上而下 AND，任一失败即丢弃）：
  //   1. 节点级 visibleWhen(ctx)（菜单即数据 P1 扩展；未定义 → 通过）
  //   2. viewer-mode 全局过滤（canWebAction 单一判定：纯前端 + binding 探测）
  // 连续 divider 会在渲染时折叠，无需此处去重。
  const items = def.items.filter((item) => {
    if (item.visibleWhen && !item.visibleWhen(norm)) return false;
    if (item.divider) return true;
    if (!item.action) return true;
    if (!isViewer) return true;
    return canWebAction(item.action);
  });
  return items.map((item) => {
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
