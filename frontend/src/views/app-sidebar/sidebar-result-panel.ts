// ===== app-sidebar 同步变更明细浮层（sync-flow.ts 拆分出，锐评 P1-2）=====
// 2026-10-15 UX 补：toast 只给计数摘要；明细走 sidebar shadow 内持久浮层，可滚动、可关闭、
// 点击遮罩空白/ESC 关闭。内容由 runPush/runPull 收尾注入。重渲染（_renderLayout）
// 会重建容器回 hidden 态，故无需在 disconnectedCallback 单独清理。
// ESC 监听挂在 document（浮层覆盖侧栏、焦点未必在面板内），用模块级 escHandler
// 跟踪以便在关闭时精确 remove，避免每次同步叠加匿名监听泄漏（P2-2 收口）。
// push / pull 两侧共用，故独立成文件，避免任一侧为关闭它而依赖编排侧。

import { type SyncResultData, syncResultContentHTML } from "./tpl.ts";

/** ESC 关闭句柄（模块级跟踪，closeSyncResultPanel 时移除） */
let escHandler: ((e: KeyboardEvent) => void) | null = null;

/** 注入并展示同步变更明细浮层（先清旧监听再建新，天然幂等） */
export function renderSyncResultPanel(root: ShadowRoot, data: SyncResultData): void {
  closeSyncResultPanel(root); // 清旧 ESC/点击监听 + 重置容器
  const panel = root.getElementById("sync-result-panel");
  if (!panel) return;
  panel.innerHTML = syncResultContentHTML(data);
  panel.hidden = false;
  // 打开即把焦点移到关闭按钮（键盘可达性：焦点落在界面上，Enter/Tab 可继续操作）
  panel.querySelector<HTMLButtonElement>("[data-sync-result-close]")?.focus();
  // 事件委托：点关闭按钮或点面板自身空白（target 即 panel，bottom-sheet 无全屏遮罩）即关闭；点明细列表不关
  panel.onclick = (e: MouseEvent) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest("[data-sync-result-close]") || tgt === panel) {
      closeSyncResultPanel(root);
    }
  };
  escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeSyncResultPanel(root);
  };
  document.addEventListener("keydown", escHandler);
}

/** 关闭浮层（保留容器，下次 push/pull 复用；精确移除 ESC 监听防泄漏） */
export function closeSyncResultPanel(root: ShadowRoot): void {
  if (escHandler) {
    document.removeEventListener("keydown", escHandler);
    escHandler = null;
  }
  const panel = root.getElementById("sync-result-panel");
  if (!panel) return;
  panel.hidden = true;
  panel.innerHTML = "";
  panel.onclick = null;
}
