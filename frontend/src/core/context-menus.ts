// ===== 右键菜单映射（类型化版 — ADR-014 P3 core 收官；ADR-021 B 层声明式化）=====
// 将 ctx:show 事件转换为新版组件使用的 menu:show 事件
// 菜单结构来自 menu-defs.ts（唯一事实来源），此处只保留 orchestrator。
import { bus, type CtxShowPayload, type MenuItem } from "../bus.ts";
import { isViewerMode } from "../utils/dom/android-bridge.ts";
import { can } from "../utils/dom/capabilities.ts";
import { getMenuDef } from "./menu-defs";
// P1 修复（ADR-040）：handler 表已拆至 context-menu-handlers.ts；此处仅消费 HANDLERS，
// 不再 re-export 其余共享符号（无外部消费者，消除死代码）
import { HANDLERS } from "./context-menu-handlers.ts";
type MenuCtx = import("./context-menu-handlers.ts").MenuCtx;

// 查看器模式（Android/网页版 ADR-049）下仍可用的纯前端右键菜单动作：
// 其余 action 均调 Wails binding，查看器模式默认无本地文件系统写能力，一律隐藏。
const VIEWER_OK_ACTIONS = new Set([
  "noop",
  "batch.copy-paths",
  "batch.export-list",
  "file.copy-path",
]);

// ADR-071 判断修正：查看器模式（web）下已实现 binding 的右键动作——web 端
// RenameFile/RenameDir/GetModelTags/MoveModelFile/CopyModelFile 已实现
// （web-fs/web-store），can() 探测放行；Android viewer 同样可达（Go binding
// 全量，授权 MANAGE_EXTERNAL_STORAGE 后 os.* 直读公共仓库，见 capabilities.ts
// ANDROID_UNAVAILABLE 黑名单），can() 按黑名单判定（code_review P3 注释同步）。
const VIEWER_WEB_ACTION_BINDINGS: Record<string, string> = {
  "file.rename": "RenameFile",
  "dir.rename": "RenameDir",
  "dir.batch-rename": "RenameDir",
  "file.edit-tags": "GetModelTags",
  // 移动/复制解锁（P0 翻案）：runBatchFileOp / file.move / file.copy 均走
  // MoveModelFile/CopyModelFile binding（web-fs webFsBindings 已实现组级 rekey）
  "file.move": "MoveModelFile",
  "file.copy": "CopyModelFile",
  "batch.move": "MoveModelFile",
  "batch.copy": "CopyModelFile",
};

function buildMenuItems(ctx: CtxShowPayload): MenuItem[] {
  const def = getMenuDef(ctx.type);
  if (!def) return [];
  const paths = ctx.paths || [];
  const norm: MenuCtx = { ...ctx, paths };
  const isViewer = isViewerMode();
  // 过滤链（自上而下 AND，任一失败即丢弃）：
  //   1. 节点级 visibleWhen(ctx)（菜单即数据 P1 扩展；未定义 → 通过）
  //   2. viewer-mode 全局过滤（纯前端白名单 + can 探测 binding 可用性）
  // 连续 divider 会在渲染时折叠，无需此处去重。
  const items = def.items.filter((item) => {
    if (item.visibleWhen && !item.visibleWhen(norm)) return false;
    if (item.divider) return true;
    if (!item.action) return true;
    if (!isViewer) return true;
    if (VIEWER_OK_ACTIONS.has(item.action)) return true;
    const b = VIEWER_WEB_ACTION_BINDINGS[item.action];
    return b !== undefined && can(b);
  });
  return items.map((item) => {
    if (item.divider) return { divider: true };
    const label = typeof item.label === "function" ? item.label(norm) : item.label;
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
