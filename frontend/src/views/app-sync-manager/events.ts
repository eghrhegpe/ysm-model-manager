// ===== app-sync-manager 事件层（events） =====
// 职责：容器级事件委托（状态标签 / 单行按钮 / dir 展开折叠）。
// 一次性绑定到组件根，render 重建 DOM 后无需重绑——消除并发 _doRender 双绑竞态
//（原 bindEvents 每次 render 后 .then 全量重绑，两次并发渲染对同一存活元素各绑
// 一遍，目录行「点一次=翻转两次」点不开）。
// 依赖 DAG：index → events → network（单行按钮触发 push/pull）
// events ←→ network 无循环：events 通过回调调用 network

import type { SyncManagerSelf } from "./index.ts";

export type EventSelf = SyncManagerSelf;

interface EventCallbacks {
  doRender: () => void;
  doPerformOp: (op: "push" | "pull", path: string) => Promise<void>;
}

/**
 * 一次性容器级事件委托，返回 unsub 供 disconnectedCallback 清理。
 * render 重建 DOM 不影响委托：绑定对象是组件根（light DOM），closest 动态查找。
 * 命中优先级：按钮 > 状态标签 > dir 行——按钮位于 .sm-dir 行内时命中即消费，
 * 等价原按钮 handler 的 stopPropagation（不冒泡到 dir 行翻转展开）。
 */
export function bindDelegatedEvents(self: EventSelf, cb: EventCallbacks): () => void {
  const onClick = (e: Event): void => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    // ① 单行按钮（push / pull）
    const btn = target.closest(".sm-item-btn");
    if (btn) {
      const row = btn.closest("[data-path]");
      if (row) {
        const path = (row as HTMLElement).dataset.path || "";
        const action = (btn as HTMLElement).dataset.action;
        if (action === "push") void cb.doPerformOp("push", path);
        else if (action === "pull") void cb.doPerformOp("pull", path);
      }
      return;
    }

    // ② 状态标签切换
    const tab = target.closest(".sm-status-tab");
    if (tab) {
      self._statusFilter = (tab as HTMLElement).dataset.status || "all";
      cb.doRender();
      return;
    }

    // ③ dir 行：点击整行切换展开/折叠（箭头 + 内部文件可见性）
    const dir = target.closest(".sm-dir");
    if (dir) {
      const path = (dir as HTMLElement).dataset.path || "";
      const dirOpen = self._dirOpen || {};
      dirOpen[path] = !dirOpen[path];
      cb.doRender();
      return;
    }
  };

  self.addEventListener("click", onClick);
  return () => self.removeEventListener("click", onClick);
}
