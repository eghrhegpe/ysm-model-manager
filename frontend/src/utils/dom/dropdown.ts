// ===== utils/dom/dropdown.ts — 通用下拉控制器（ADR-238 无障碍统一）=====
//
// 是什么：`.dd-wrap` 下拉体系（app-tree 工具栏 batch/more/authors、app-sidebar push/pull）
// 的统一行为层。此前各处各写一半——app-tree 纯 hover 展开（键盘/触屏/外点关闭全缺、
// 零 ARIA），app-sidebar 手写 click toggle + 模块级 document-click 单槽 hack。本控制器
// 把「click 展开 ⇄ 收起 + ARIA 落位 + 键盘导航 + 外点关闭 + 多下拉互斥」收敛成一份，
// 消费方经 dispose 纳入组件生命周期（_unsubs / SubscriptionBucket）。
//
// 键盘契约对齐 views/context-menu（其 ↑↓循环/Enter/Esc 为本仓活体先例），但不合并实现：
// context-menu 挂在 document 级（需要深焦下钻 shadowRoot.activeElement），本控制器挂在
// .dd-wrap 上——同 shadow 树内事件冒泡自足，无需 document 监听技巧。
//
// 展开方式与 CSS 的分工：基础 display:none 在 `dropdownBaseCSS`（utils/dom/css.ts），
// JS 改内联 style.display 优先级更高（既有约定）。历史 hover 展开串已随本案退役
// （hover + JS 控制互斥打架的问题整体消解）。

/** initDropdown 选项 */
export interface DropdownOptions {
  /** 每次展开前回调（惰性填充菜单内容的挂载点，如作者菜单按 vm._authors 重填） */
  onOpen?: () => void;
}

/**
 * initDropdown 句柄（function-with-properties 形态，既有调用点零改动）：
 * - 调用本身 = dispose（解绑全部监听，内联样式交还 CSS）；
 * - `.close()` = 控制器路径程序化收起（幂等：已关时 no-op；不回焦——回焦由
 *   控制器自身 close(restoreFocus) 路径管理，见 Esc / 菜单项点击）。
 * 消费方需要「程序化收起」时一律走 .close()，禁止手动改 display / aria-expanded
 * （2026-09 收口：app-sidebar closeAllMenus 手改 DOM 的后门已退役，状态/ARIA 单源留在控制器）。
 */
export type DropdownHandle = (() => void) & { close(): void };

/** 当前打开的下拉关闭器（模块级登记 = 同页多下拉互斥的最小实现） */
let _closeActive: (() => void) | null = null;

/**
 * 把一个 `.dd-wrap`（内含 trigger button + `.dd-menu`）接管为可访问下拉。
 *
 * 结构约定（dropdownBaseCSS / toolbar-menus renderDropdown 的产物形态）：
 *   - trigger = wrap 内首个 button（`.dd-wrap > button`）
 *   - 菜单 = `.dd-menu`，其内可点击项为 `.dd-item`（回退到任意 button）
 * 结构缺失 / wrap 为 null → 静默 no-op（返回可调用且带 close 的空句柄），容忍渐进接管。
 *
 * @returns DropdownHandle：调用本身 = dispose（解绑全部监听 click/keydown/外点，内联样式交还 CSS）；
 *         句柄 `.close()` = 控制器路径程序化收起（幂等，不回焦）
 */
export function initDropdown(
  wrap: HTMLElement | null | undefined,
  opts?: DropdownOptions,
): DropdownHandle {
  const trigger = wrap?.querySelector<HTMLElement>("button");
  const menu = wrap?.querySelector<HTMLElement>(".dd-menu");
  if (!wrap || !trigger || !menu) {
    const noop = (() => {}) as DropdownHandle;
    noop.close = () => {};
    return noop;
  }

  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const itemEls = (): HTMLElement[] =>
    Array.from(menu.querySelectorAll<HTMLElement>(".dd-item, button, [role=menuitem]"));

  const isOpen = (): boolean => trigger.getAttribute("aria-expanded") === "true";

  /** 菜单项 role 每次展开重刷：onOpen 动态填充后新节点也须带 role（幂等） */
  const decorateItems = (): void => {
    menu.setAttribute("role", "menu");
    for (const el of itemEls()) {
      if (el.getAttribute("role") !== "menuitem") el.setAttribute("role", "menuitem");
    }
  };

  const open = (): void => {
    _closeActive?.(); // 互斥：先关别家
    opts?.onOpen?.();
    decorateItems();
    menu.style.display = "block";
    trigger.setAttribute("aria-expanded", "true");
    _closeActive = close;
    itemEls()[0]?.focus(); // 展开即焦首项，方向键零门槛续走
  };

  const close = (restoreFocus = false): void => {
    if (!isOpen()) return;
    menu.style.display = "none";
    trigger.setAttribute("aria-expanded", "false");
    if (_closeActive === close) _closeActive = null;
    if (restoreFocus) trigger.focus();
  };

  const onTriggerClick = (e: Event): void => {
    e.stopPropagation();
    if (isOpen()) {
      close();
      return;
    }
    open();
  };

  // Enter/Space 在原生 <button> 上合成 click → trigger 监听天然覆盖，无需额外 keydown 分支。
  const onWrapKeydown = (e: KeyboardEvent): void => {
    if (!isOpen()) return;
    const items = itemEls();
    if (items.length === 0) return;
    const active = wrap.getRootNode() as ShadowRoot | Document;
    const focused = active.activeElement as HTMLElement | null;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close(true);
        return;
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End":
        break;
      default:
        return;
    }
    e.preventDefault();
    const cur = focused ? items.indexOf(focused) : -1;
    let next: number;
    if (e.key === "ArrowDown") next = cur < 0 ? 0 : (cur + 1) % items.length;
    else if (e.key === "ArrowUp")
      next = cur < 0 ? items.length - 1 : (cur - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else next = items.length - 1;
    items[next]?.focus();
  };

  // 点击菜单项 → 收起 + 焦点归还 trigger。
  // capture 阶段挂在 menu 容器上：既有委托 handler（batch/more 的 stopPropagation）
  // 发生在 target/冒泡阶段，无法拦在关闭之前——capture 先于它们触发，收起到达无忧。
  const onMenuClick = (e: Event): void => {
    const target = e.target as Element | null;
    if (!target || target === menu) return;
    if (!target.closest(".dd-item, [role=menuitem]")) return;
    close(true);
  };

  // 外点关闭：document 级 click 经 composedPath 判定（shadow 内 target 被 retarget，
  // 路径仍完整包含 .dd-wrap）；happy-dom 等无 composedPath 的环境退化为 contains 判定。
  const onDocClick = (e: MouseEvent): void => {
    if (!isOpen()) return;
    const target = e.target as Node | null;
    if (target && (wrap === target || wrap.contains(target))) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (path.includes(wrap)) return;
    close();
  };

  trigger.addEventListener("click", onTriggerClick);
  wrap.addEventListener("keydown", onWrapKeydown);
  menu.addEventListener("click", onMenuClick, true);
  document.addEventListener("click", onDocClick);

  const dispose = (() => {
    if (_closeActive === close) _closeActive = null;
    trigger.removeEventListener("click", onTriggerClick);
    wrap.removeEventListener("keydown", onWrapKeydown);
    menu.removeEventListener("click", onMenuClick, true);
    document.removeEventListener("click", onDocClick);
    // 内联样式交还 CSS：dispose 后 display 复位由 dropdownBaseCSS 的 display:none 接管
    menu.style.display = "";
    trigger.removeAttribute("aria-expanded");
  }) as DropdownHandle;
  dispose.close = () => close(false);
  return dispose;
}
