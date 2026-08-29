// ===== 🥉 slide-menu 外壳构建器（ADR 去桶化配套）=====
// 复刻 MikuMikuAR 的 slide-menu 卡片外壳（menu-wrapper/slide-viewport/slide-panel/slide-list/slide-header），
// 但不搬其菜单导航引擎（registry/schema/stack 等业务层）——而是在外壳层提供一组【轻量导航栈】能力
// （home/navigate/back/refresh/isShowing/reset/isAtRoot），供调用方以最小成本组织多级菜单
// （例如 YSM 的「模型信息 → 表情 / 切换模型」两级）。外壳仍是卡片视觉 + 标题栏 + 关闭/返回按钮，
// 内容由调用方经视图（SlideMenuView.render）注入，通常填 🥉 行组件：slideRow/addCollapsible/...。
//
// 解耦要点：
//  - 关闭/返回按钮用字面量 glyph（根级 ✕，子集 ←），不依赖 iconify 运行时；
//  - 外壳恒含 🥉 行组件，故安装外壳样式时一并安装 ui-components 样式；
//  - 零业务依赖，可被任意预览/面板复用；
//  - 向后兼容：不调用 home/navigate 的调用方（直接操作 menu.list）行为不变——
//    此时导航栈为空，slide-back 在根级仍触发 onClose（即关闭）。
//
// 键盘可达性（ADR-076 a11y 补全）：
//  - 方向键 ↑↓ 导航菜单项（roving tabindex：当前项 tabindex=0，其余 -1）
//  - Enter/Space 激活聚焦项（触发 click 事件，复用已有行 click handler）
//  - Escape / Home / End 辅助导航
//  - onShow() / onHide() 管理焦点记忆恢复 + 输入阻断栈（menu.openId →
//    isInputBlocked()=true → input-and-animation 暂停相机 WASD/方向键）

import { installUiComponentsStyles } from "./ui-components-styles.ts";
import { installSlideMenuStyles } from "./ui-slide-menu-styles.ts";
import { pushInputBlock, popInputBlock } from "../utils/dom/focus-restore.ts";

/** 单个菜单视图：标题 + 把内容渲染进给定的 list 容器。 */
export interface SlideMenuView {
  /** 视图标题（写入标题栏；根级即菜单名） */
  title: string;
  /** 渲染该视图内容到 list（每次进入/刷新都会调用，须幂等） */
  render(list: HTMLElement): void;
}

export interface SlideMenuHandle {
  /** 卡片根（.menu-wrapper.slide-menu），挂到定位容器即可 */
  root: HTMLElement;
  /** 内容挂载点（.slide-list.render-card），legacy 直接操作时可用 */
  list: HTMLElement;
  /** 设置标题栏文字（legacy 直接操作；经导航栈时由视图 title 托管） */
  setTitle(t: string): void;
  /** 注册关闭回调（根级返回按钮点击 / 回车 / 空格触发） */
  setOnClose(fn: () => void): void;
  /** 以给定视图为根重置导航栈并渲染（用于顶部菜单进入一级） */
  home(view: SlideMenuView): void;
  /** 下钻到子视图（压栈并渲染） */
  navigate(view: SlideMenuView): void;
  /** 返回上一级；已在根级则触发关闭回调 */
  back(): void;
  /** 重渲染当前栈顶视图（内容变化后调用，如开关态更新） */
  refresh(): void;
  /** 当前栈顶是否为给定视图（异步填充场景守卫用） */
  isShowing(view: SlideMenuView): boolean;
  /** 清空导航栈（不渲染、不关闭，供调用方关闭弹窗时复位） */
  reset(): void;
  /** 当前是否处于根视图（栈深 ≤ 1） */
  isAtRoot(): boolean;
  /** 移除整个外壳 */
  dispose(): void;

  // ── a11y：焦点管理 + 输入阻断 ──
  /** 菜单显示时调用：记住触发焦点，push 输入阻断栈，给首个菜单项 focus */
  onShow(): void;
  /** 菜单隐藏时调用：pop 输入阻断栈，归还焦点给触发元素
   *  @param opts.restoreFocus 传 false 跳过归还（3D overlay 关闭时由 closeOverlay 处理） */
  onHide(opts?: { restoreFocus?: boolean }): void;
}

/** 构建 slide-menu 卡片外壳（含轻量导航栈 + 键盘导航）。 */
export function createSlideMenu(opts?: { title?: string; closeIcon?: string }): SlideMenuHandle {
  smInstallStyles();
  const shell = smBuildShell(opts);
  const stack: SlideMenuView[] = [];
  let onClose: (() => void) | undefined;
  let _prevFocus: HTMLElement | null = null;
  const MENU_BLOCK_ID = "slide-menu";

  const renderTop = (): void => {
    smRenderTop(stack, shell.list, shell.title, shell.backBtn, opts);
    smSetupNavItems(shell.list);
  };
  const handleBack = (): void => {
    if (stack.length > 1) {
      stack.pop();
      renderTop();
    } else {
      onClose?.();
    }
  };
  smBindBackButton(shell.backBtn, handleBack);
  smBindKeyboardNav(shell.list, handleBack);

  return smBuildHandle(shell, stack, renderTop, handleBack, {
    getOnClose: () => onClose,
    setOnClose: (fn) => { onClose = fn; },
    getPrevFocus: () => _prevFocus,
    setPrevFocus: (el) => { _prevFocus = el; },
    pushBlock: () => pushInputBlock(MENU_BLOCK_ID),
    popBlock: () => popInputBlock(MENU_BLOCK_ID),
  });
}

function smInstallStyles(): void {
  installSlideMenuStyles();
  installUiComponentsStyles();
}

interface SmShell {
  root: HTMLDivElement;
  list: HTMLDivElement;
  title: HTMLSpanElement;
  backBtn: HTMLSpanElement;
}

function smBuildShell(opts?: { title?: string; closeIcon?: string }): SmShell {
  const root = document.createElement("div");
  root.className = "menu-wrapper slide-menu";
  root.tabIndex = -1;

  const viewport = document.createElement("div");
  viewport.className = "slide-viewport";

  const header = document.createElement("div");
  header.className = "slide-header";

  const backBtn = document.createElement("span");
  backBtn.className = "slide-back";
  backBtn.setAttribute("role", "button");
  backBtn.tabIndex = 0;
  backBtn.textContent = opts?.closeIcon ?? "✕";
  backBtn.title = "关闭";

  const title = document.createElement("span");
  title.className = "slide-title";
  title.textContent = opts?.title ?? "";

  header.appendChild(backBtn);
  header.appendChild(title);

  const panel = document.createElement("div");
  panel.className = "slide-panel";

  const list = document.createElement("div");
  list.className = "slide-list render-card";

  panel.appendChild(list);
  viewport.appendChild(header);
  viewport.appendChild(panel);
  root.appendChild(viewport);
  return { root, list, title, backBtn };
}

function smRenderTop(
  stack: SlideMenuView[],
  list: HTMLElement,
  title: HTMLSpanElement,
  backBtn: HTMLSpanElement,
  opts?: { closeIcon?: string }
): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  list.innerHTML = "";
  title.textContent = top.title;
  const atRoot = stack.length <= 1;
  backBtn.textContent = atRoot ? opts?.closeIcon ?? "✕" : "←";
  backBtn.title = atRoot ? "关闭" : "返回";
  top.render(list);
}

function smBindBackButton(backBtn: HTMLSpanElement, handleBack: () => void): void {
  backBtn.onclick = handleBack;
  backBtn.onkeydown = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBack();
    }
  };
}

// ── 键盘导航 ──────────────────────────────────────────────────────

/** list 可见直接子节点（菜单项 / section wrapper） */
function smGetNavItems(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null,
  );
}

/** roving tabindex：当前项 0，其余 -1；focus */
function smFocusItem(items: HTMLElement[], idx: number): void {
  items.forEach((el, i) => { el.tabIndex = i === idx ? 0 : -1; });
  items[idx]?.focus();
}

/** list 级 keydown 委托：↑↓ 导航 / Enter·Space 激活 / Escape 返回 / Home·End 首尾 */
function smBindKeyboardNav(list: HTMLElement, handleBack: () => void): void {
  list.addEventListener("keydown", (e: KeyboardEvent): void => {
    const items = smGetNavItems(list);
    if (!items.length) return;
    let idx = items.indexOf(document.activeElement as HTMLElement);
    const key = e.key;
    if (key === "ArrowDown") {
      e.preventDefault();
      smFocusItem(items, idx < 0 ? 0 : (idx + 1) % items.length);
    } else if (key === "ArrowUp") {
      e.preventDefault();
      smFocusItem(items, idx < 0 ? 0 : (idx - 1 + items.length) % items.length);
    } else if (key === "Home") {
      e.preventDefault();
      smFocusItem(items, 0);
    } else if (key === "End") {
      e.preventDefault();
      smFocusItem(items, items.length - 1);
    } else if (key === "Enter" || key === " ") {
      e.preventDefault();
      const target = items[idx >= 0 ? idx : 0];
      if (target) {
        // 触发项自身或其第一个交互子元素的 click（兼容 section header / row / toggle）
        const clickable = target.querySelector<HTMLElement>("button, a[href], [role='button'], input")
          ?? target;
        clickable.click();
      }
    } else if (key === "Escape") {
      e.preventDefault();
      handleBack();
    }
  });
}

/** 每次 smRenderTop 后：为 list 可见直接子节点设 roving tabindex（首项 0，其余 -1） */
function smSetupNavItems(list: HTMLElement): void {
  const items = smGetNavItems(list);
  items.forEach((el, i) => { el.tabIndex = i === 0 ? 0 : -1; });
}

// ── handle 构造 ──────────────────────────────────────────────────

interface SmHandleDeps {
  getOnClose: () => (() => void) | undefined;
  setOnClose: (fn: () => void) => void;
  getPrevFocus: () => HTMLElement | null;
  setPrevFocus: (fn: HTMLElement | null) => void;
  pushBlock: () => void;
  popBlock: () => void;
}

function smBuildHandle(
  shell: SmShell,
  stack: SlideMenuView[],
  renderTop: () => void,
  handleBack: () => void,
  deps: SmHandleDeps
): SlideMenuHandle {
  return {
    root: shell.root,
    list: shell.list,
    setTitle: (t: string): void => { shell.title.textContent = t; },
    setOnClose: (fn: () => void): void => { deps.setOnClose(fn); },
    home: (view: SlideMenuView): void => {
      stack.length = 0;
      stack.push(view);
      renderTop();
    },
    navigate: (view: SlideMenuView): void => {
      stack.push(view);
      renderTop();
    },
    back: (): void => handleBack(),
    refresh: (): void => { renderTop(); },
    isShowing: (view: SlideMenuView): boolean => stack[stack.length - 1] === view,
    reset: (): void => { stack.length = 0; },
    isAtRoot: (): boolean => stack.length <= 1,
    dispose: (): void => { shell.root.remove(); },

    // ── a11y：焦点记忆 + 输入阻断 ──
    onShow: (): void => {
      // 记住触发元素（首次显示时；后续 navigate 不覆盖）
      if (!deps.getPrevFocus() && document.activeElement instanceof HTMLElement) {
        deps.setPrevFocus(document.activeElement);
      }
      deps.pushBlock();
      // 焦点给首项（微任务保证 DOM 已渲染完）
      requestAnimationFrame((): void => {
        const items = smGetNavItems(shell.list);
        smFocusItem(items, 0);
      });
    },
    onHide: (opts?): void => {
      deps.popBlock();
      if (opts?.restoreFocus !== false) {
        const el = deps.getPrevFocus();
        deps.setPrevFocus(null);
        if (el && el.isConnected) {
          try { el.focus(); } catch { /* 元素不可聚焦时静默 */ }
        }
      }
    },
  };
}
