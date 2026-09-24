// ===== app-sync-manager 事件层（events） =====
// 职责：容器级事件委托（状态标签 / 单行按钮 / dir 展开折叠）。
// 一次性绑定到组件根，render 重建 DOM 后无需重绑——消除并发 _doRender 双绑竞态
//（原 bindEvents 每次 render 后 .then 全量重绑，两次并发渲染对同一存活元素各绑
// 一遍，目录行「点一次=翻转两次」点不开）。
// 依赖 DAG：index → events → network（单行按钮触发 push/pull）
// events ←→ network 无循环：events 通过回调调用 network

import type { SyncManagerSelf } from "./self-type.ts";

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
 *
 * 并发重入防护：handler 通过 self._cbRef 间接读取回调，后续 _init 只更新
 * self._cbRef.cb 而不重绑 addEventListener，消除多 _init 并发双绑竞态。
 */
export function bindDelegatedEvents(self: EventSelf, cb: EventCallbacks): () => void {
  // 首次调用：初始化 _cbRef 容器；后续 _init 直接替换 _cbRef.cb
  if (!self._cbRef) {
    self._cbRef = { cb };
  } else {
    self._cbRef.cb = cb;
  }

  // 仅首次绑定 DOM handler（一次性），后续复用已绑 listener
  if (!self._clickHandler) {
    const onClick = (e: Event): void => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const cbRef = self._cbRef;
      if (!cbRef) return;

      // ① 单行按钮（push / pull）
      const btn = target.closest(".sm-item-btn");
      if (btn) {
        // 保持旧 per-button handler 的 stopPropagation 对等性：本组件根部 return 只
        // 阻断③ dir 翻转，事件仍会冒泡到 document 级监听（app-sidebar closeAll /
        // context-menu hide 等）——旧代码在按钮处截断，点击 push/pull 不会误关
        // 侧栏弹出层/右键菜单；此处截断即恢复该契约
        e.stopPropagation();
        const row = btn.closest("[data-path]");
        if (row) {
          const path = (row as HTMLElement).dataset.path || "";
          const action = (btn as HTMLElement).dataset.action;
          if (action === "push") void cbRef.cb.doPerformOp("push", path);
          else if (action === "pull") void cbRef.cb.doPerformOp("pull", path);
        }
        return;
      }

      // ② 状态标签切换
      const tab = target.closest(".sm-status-tab");
      if (tab) {
        self._statusFilter = (tab as HTMLElement).dataset.status || "all";
        cbRef.cb.doRender();
        return;
      }

      // ③ dir 行：点击整行切换展开/折叠（箭头 + 内部文件可见性）
      const dir = target.closest(".sm-dir");
      if (dir) {
        const path = (dir as HTMLElement).dataset.path || "";
        const dirOpen = self._dirOpen || {};
        dirOpen[path] = !dirOpen[path];
        cbRef.cb.doRender();
        return;
      }
    };

    self._clickHandler = onClick;
    self.addEventListener("click", onClick);
  }

  // keydown 委托（a11y，2026 复测补缺）：状态筛选 radio group 键盘导航——与 click 委托
  // 同款「一次性绑定到组件根」：render 重建 .sm-status-radios innerHTML 不影响（closest
  // 动态查找）。键盘语义（仓内先例 tabs-shell bindSubBar 同口径）：
  //   ArrowRight/Down、ArrowLeft/Up = 循环移动**且激活**（radio 语义，点选走既有 ② 点击委托）
  //   Home/End = 只移焦点不激活（radiogroup 规范）
  // 激活 = 对目标 radio 调 .click()（doRender 同步重渲染后旧节点被替换，须按 data-status
  // 重查再 focus——roving tabindex 由模板随重渲染自动迁移，本层不手写属性）
  if (!self._keyHandler) {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".sm-status-radios")) return;
      if (!self._cbRef) return;
      const radios = Array.from(self.querySelectorAll(".sm-status-tab")) as HTMLElement[];
      if (!radios.length) return;
      // 焦点在 radio 本体上（radiogroup 规范：组内仅 roving tabindex 项可被键盘聚焦）；
      // indexOf 走引用相等（与 findIndex(r => r === target) 同语义，biome useIndexOf）
      const idx = radios.indexOf(target as HTMLElement);
      if (idx < 0) return;
      const focusAndActivate = (next: number): void => {
        const status = radios[next].dataset.status || "";
        const slot = () => self.querySelector(`.sm-status-tab[data-status="${status}"]`);
        slot()?.click(); // 点击委托②：_statusFilter 迁移 + doRender 同步重渲染
        slot()?.focus(); // 重渲染后的新节点（旧焦点节点已被 innerHTML 替换）
      };
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          focusAndActivate((idx + 1) % radios.length);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          focusAndActivate((idx - 1 + radios.length) % radios.length);
          break;
        case "Home":
          e.preventDefault();
          radios[0]?.focus();
          break;
        case "End":
          e.preventDefault();
          radios[radios.length - 1]?.focus();
          break;
      }
    };
    self._keyHandler = onKey;
    self.addEventListener("keydown", onKey);
  }

  return () => {
    if (self._clickHandler) {
      self.removeEventListener("click", self._clickHandler);
      self._clickHandler = null;
    }
    if (self._keyHandler) {
      self.removeEventListener("keydown", self._keyHandler);
      self._keyHandler = null;
    }
    // code_review 47e68917b #3（P2）：unsub 需与 disconnectedCallback 对齐清 cbRef——
    // 否则重连后 _eventsBound=true 且 _cbRef=undefined，else 分支 `if (self._cbRef)`
    // 不命中 → 委托监听器永不重绑（push/pull/状态页签/目录行点击全死）
    self._cbRef = undefined;
  };
}
