// ===== 🥉 slide-menu 外壳构建器（ADR 去桶化配套；MikuMikuAR 外壳迁移，仅外壳不搬导航引擎）=====
// 卡片外壳（menu-wrapper/slide-viewport/slide-panel/slide-list/slide-header）+ 一组【轻量导航栈】能力
// （home/navigate/back/refresh/isShowing/reset/isAtRoot），供调用方以最小成本组织多级菜单。
// 内容由调用方经视图（SlideMenuView.render）注入——生产内容 = preview-3d/menu 的 renderMenu
// 分派产物（MenuNode schema 声明式：folder 折叠组 / row 行动态行 / cap 栈控件）。
//
// 解耦要点：
//  - 关闭/返回按钮均用 **SVG 图标**（`UI_ICONS.close` / `UI_ICONS.back`，ADR-238 §1.4：结构槽图标位走 SVG；
//    原为字面量 glyph "✕"——那条注释的理由「不依赖 iconify 运行时」基于过时前提，
//    UI_ICONS 是内联 SVG 字符串，本就不需要任何运行时）；
//  - 原 `closeIcon?: string` 覆盖参数已同批删除——它把未转义 HTML 串做成公开注入面
//    （触发 check-redlines R8），而全仓唯一调用方 core.ts 从不需要它；
//  - 外壳恒含行级组件样式（.slide-item/.cs-bar 等），故安装外壳样式时一并安装 ui-components 样式；
//  - 零业务依赖，可被任意预览/面板复用；
//  - 向后兼容：不调用 home/navigate 的调用方（直接操作 menu.list）行为不变——
//    此时导航栈为空，slide-back 在根级仍触发 onClose（即关闭）。
//
// 键盘可达性（ADR-076 a11y 补全；ADR-308 D2 收敛至 bind-roving 原语，2026-09）：
//  - 方向键 ↑↓ 导航菜单项（roving tabindex：当前项 tabindex=0，其余 -1，cyclic 回绕）
//  - Enter/Space 激活聚焦项（触发 click 事件，复用已有行 click handler）
//  - Escape 返回/关菜单（外壳语义，独立监听）+ Home / End 首尾
//  - onShow() / onHide() 管理焦点记忆恢复 + 输入阻断栈（menu.openId →
//    isInputBlocked()=true → input-and-animation 暂停相机 WASD/方向键）

import { t } from "@/core/i18n/t.ts";
import { installComponentsStyles } from "@/preview-3d/menu/style/components-styles.ts";
import { installSlideMenuStyles } from "@/preview-3d/menu/style/slide-menu-styles.ts";
import { bindRoving } from "@/utils/dom/bind-roving.ts";
import { popInputBlock, pushInputBlock } from "@/utils/dom/input-block-stack.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/** 单个菜单视图：标题 + 把内容渲染进给定的 list 容器。 */
export interface SlideMenuView {
  /** 视图标题（写入标题栏；根级即菜单名） */
  title: string;
  /** 渲染该视图内容到 list（每次进入/刷新都会调用，须幂等）——
   *  **清空归属在视图**：render 须自行清空 list（`list.replaceChildren()` / `innerHTML=""`）
   *  再 append；shell 的 smRenderTop 不再代清（2026-10 收口，消除双重清空）。 */
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

/**
 * 构建 slide-menu 卡片外壳（含轻量导航栈 + 键盘导航）。
 *
 * 关闭图标固定为 `UI_ICONS.close`（SVG，ADR-238 §1.4）。原 `closeIcon?: string`
 * 覆盖参数已删：它把未转义的 HTML 串做成公开注入面（触发 check-redlines R8），
 * 而唯一调用方从不需要它。将来若确需换图标，请传**语义图标名**而非 HTML 串。
 */
export function createSlideMenu(opts?: { title?: string }): SlideMenuHandle {
  smInstallStyles();
  const shell = smBuildShell(opts);
  const stack: SlideMenuView[] = [];
  let onClose: (() => void) | undefined;
  let _prevFocus: HTMLElement | null = null;
  const MENU_BLOCK_ID = "slide-menu";

  // ADR-308 D2：键盘导航收敛到 bind-roving 原语（选项按本文件冻结契约选配）：
  // - itemsOf = smGetNavItems（可见直接子元素过滤，offsetParent!==null）
  // - activeElementBase：键派发到容器，实际焦点项才是移动/激活基准
  // - stateAttr null：菜单项无 ARIA role，写状态位即 ARIA 非法
  // - preset "tab"：方向键只移动聚焦，Enter/Space 激活（点项自身或第一个交互子元素，
  //   兼容 section header / row / toggle）
  // - cyclic：首尾回绕（slide-menu 语义，冻结契约）
  // Escape 属外壳语义（返回/关菜单）而非 roving，保留独立小监听（见下）
  const roving = bindRoving({
    root: document,
    container: shell.list,
    itemSelector: ".slide-item", // 名义值：实际 items 由 itemsOf 提供
    itemsOf: (c) => smGetNavItems(c),
    preset: "tab",
    orientation: "vertical",
    cyclic: true,
    activeElementBase: true,
    stateAttr: null,
    onActivate: (item: HTMLElement): void => {
      const clickable =
        item.querySelector<HTMLElement>("button, a[href], [role='button'], input") ?? item;
      clickable.click();
    },
  });

  const renderTop = (): void => {
    smRenderTop(stack, shell.list, shell.title, shell.backBtn);
    // roving 跟随焦点：smRenderTop 已把焦点恢复到记忆位；焦点不在 items 内
    // （新菜单 / 焦点在外部）回落首项——取代原 smSetupNavItems（无条件重置首项，
    // 重渲染后焦点与 roving 失位的固有 quirk 一并消除）
    const items = smGetNavItems(shell.list);
    const cur = document.activeElement ? items.indexOf(document.activeElement as HTMLElement) : -1;
    roving.syncIndex(cur >= 0 ? cur : 0);
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
  shell.list.addEventListener("keydown", (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleBack();
    }
  });

  // handle 直接以闭包捕获本函数状态（onClose/prevFocus/stack）——不再经 SmHandleDeps
  // 注入舞绕一圈（原实现把私有闭包变量拆成 getter/setter 喂给同文件私有函数，零收益）。
  return {
    root: shell.root,
    list: shell.list,
    setTitle: (t: string): void => {
      shell.title.textContent = t;
    },
    setOnClose: (fn: () => void): void => {
      onClose = fn;
    },
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
    refresh: (): void => {
      renderTop();
    },
    isShowing: (view: SlideMenuView): boolean => stack[stack.length - 1] === view,
    reset: (): void => {
      stack.length = 0;
    },
    isAtRoot: (): boolean => stack.length <= 1,
    dispose: (): void => {
      roving.dispose();
      shell.root.remove();
    },

    // ── a11y：焦点管理 + 输入阻断 ──
    onShow: (): void => {
      // 记住触发元素（首次显示时；后续 navigate 不覆盖）
      if (!_prevFocus && document.activeElement instanceof HTMLElement) {
        _prevFocus = document.activeElement;
      }
      pushInputBlock(MENU_BLOCK_ID);
      // 焦点给首项（rAF 保证 DOM 已渲染完）
      requestAnimationFrame((): void => {
        const items = smGetNavItems(shell.list);
        smFocusItem(items, 0);
      });
    },
    onHide: (hideOpts?): void => {
      popInputBlock(MENU_BLOCK_ID);
      if (hideOpts?.restoreFocus !== false) {
        const el = _prevFocus;
        _prevFocus = null;
        if (el?.isConnected) {
          try {
            el.focus();
          } catch {
            /* 元素不可聚焦时静默 */
          }
        }
      }
    },
  };
}

function smInstallStyles(): void {
  installSlideMenuStyles();
  installComponentsStyles();
}

interface SmShell {
  root: HTMLDivElement;
  list: HTMLDivElement;
  title: HTMLSpanElement;
  backBtn: HTMLSpanElement;
}

function smBuildShell(opts?: { title?: string }): SmShell {
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
  // 关闭图标恒为 UI_ICONS.close（ADR-238 §1.4 结构槽走 SVG）。
  // 原 `closeIcon?: string` 覆盖参数已删——它把「未转义的 HTML 串」作为公开注入面，
  // 触发 check-redlines R8（innerHTML XSS）；而全仓唯一调用方 core.ts 早就不传它。
  // 若将来确需换图标，请改为传**语义图标名**（如 UiIconName），而不是 HTML 串。
  backBtn.innerHTML = UI_ICONS.close;
  backBtn.title = t("common.close");

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
): void {
  const top = stack[stack.length - 1];
  if (!top) return;

  // 刷新前记住焦点位置（索引），刷新后恢复
  const active = document.activeElement;
  const focusedIdx = active ? Array.from(list.children).indexOf(active) : -1;

  // [清空归属·2026-10 收口] shell 不再代清 list——清空唯一归属 = 各 SlideMenuView.render
  // （幂等契约，见 SlideMenuView 注释）。此前此处 `list.innerHTML=""` 与视图自清空重复，
  // 每次渲染白跑一次 DOM 清空；且会掩盖「视图忘了自清空」的重复 append 类缺陷。
  title.textContent = top.title;
  const atRoot = stack.length <= 1;
  // 根级 = close 图标，子级 = back 图标（均为 UI_ICONS SVG，ADR-238 §1.4）。
  // 刻意用 if/else 而非三元赋 innerHTML：三元会被 check-redlines R8 视为未转义注入面，
  // 且分开后每条赋值各自命中既有豁免（ICONS 常量 / 纯字面量），语义也更直白。
  if (atRoot) {
    backBtn.innerHTML = UI_ICONS.close;
  } else {
    backBtn.innerHTML = UI_ICONS.back;
  }
  backBtn.title = atRoot ? t("common.close") : t("common.back");
  top.render(list);

  // 恢复焦点到原索引位置的菜单项
  if (focusedIdx >= 0) {
    const newItems = list.children;
    const target = newItems[Math.min(focusedIdx, newItems.length - 1)];
    if (target instanceof HTMLElement) {
      target.focus();
    }
  }
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

/** list 可见直接子节点（菜单项 / section wrapper）；Element 入参 = 兼作 bindRoving itemsOf 提供器 */
function smGetNavItems(list: Element): HTMLElement[] {
  return Array.from(list.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null,
  );
}

/** roving tabindex：当前项 0，其余 -1；focus（onShow 首项聚焦用；导航 roving 已归 bindRoving） */
function smFocusItem(items: HTMLElement[], idx: number): void {
  items.forEach((el, i) => {
    el.tabIndex = i === idx ? 0 : -1;
  });
  items[idx]?.focus();
}
