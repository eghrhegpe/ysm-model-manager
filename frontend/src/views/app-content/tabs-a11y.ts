// ===== tabs-a11y.ts — tab 栏可访问性原语（ARIA + roving tabindex + 键盘导航）=====
//
// 背景：`bindTabs`（init-pages.ts）把两件正交的事捆在一起：
//   ① tab 栏的**可访问性**——tablist/tab/aria-selected 语义、roving tabindex、WAI-ARIA Tabs 键盘导航；
//   ② **静态面板切换**——按 `${prefix}-tab-${id}` 找预声明面板、display/hidden 翻转、首次懒初始化。
// ①对所有 tab 栏通用；②只适配「每 tab 一个预声明 .tab-body」的静态页。
// 创作者频道的站点 tab 是**动态生成 + 单一内容区**（数据加载后 innerHTML 建按钮、点切重渲染右侧），
// 套不进②的静态面板契约——但它同样需要①，否则就是全应用唯一一处键盘不可达、无 ARIA 的 tab 栏。
//
// 本模块把①从②剥离为可独立复用的原语：以 `root` 为入参（不绑 AppContentHost/AppContentState），
// 由调用方提供 panelId 计算与 onActivate 副作用。`bindTabs` 与本原语共享同一份可访问性真值，
// 静态页与动态页各取所需，不再各搓一套。
//
// 分层：本文件是 app-content 内部 views 层的纯 helper（无 DOM 副作用之外的上层依赖），
// 与 tabs-shell.ts 同族（结构/行为原语，非组件），故不触 HTML 字面量红线、不进桶。

import { logWarn } from "@/utils/base/primitives/log.ts";

/** bindTabA11y 的绑定契约 */
export interface BindTabA11ySpec {
  /** shadow 根（按钮与面板都在其内查询） */
  root: ShadowRoot;
  /** tab 按钮选择器（如 `.repo-tab` / `.stg-tab`） */
  tabSelector: string;
  /** tab 标识 → 面板 id 的映射（静态页 = `${prefix}-tab-${id}`；动态单区页可返回固定 id） */
  panelId: (tabId: string) => string;
  /** 激活某 tab 的副作用（切 active / aria-selected / roving tabindex / 内容切换或重渲染）。点击与键盘共用。 */
  onActivate: (btn: HTMLElement, tabId: string) => void;
  /** 初始 tab（可选）：按钮无 `.active` 类时，给该 id 的按钮 role=tab + tabindex=0 回落；否则首个可见按钮。 */
  initialTabId?: string;
  /** 校验开关：对缺 data-tab / 重复 data-tab 响亮告警，并把被剔者从导航集合排除。静态 bindTabs 用 true。 */
  validate?: boolean;
  /** 每次 attach（含 refresh）完成按钮侧可访问性后回调，交回去重后的按钮与 id，供调用方补面板侧静态语义。 */
  onBound?: (nav: HTMLElement[], ids: string[]) => void;
}

/** 一次绑定的产物：refresh() 在 tab 按钮集合动态变化后重挂可访问性 */
export interface TabA11yHandle {
  /** 重新查询按钮集合，重挂 ARIA/roving/键盘/点击绑定（先移除旧监听，防动态重挂叠加） */
  refresh(): void;
}

/**
 * 给一页的 tab 栏挂上 WAI-ARIA Tabs 可访问性：tablist 语义 + roving tabindex + 键盘导航 + 点击分派。
 * 不触碰面板 display / 懒初始化——那些是各页调用方在 onActivate 里自己的事。
 */
export function bindTabA11y(spec: BindTabA11ySpec): TabA11yHandle {
  const { root, tabSelector, panelId, onActivate, initialTabId, validate, onBound } = spec;

  const unsubs: Array<() => void> = [];

  const attach = (): void => {
    // 先拆旧监听（动态 refresh 前不叠加）
    for (const off of unsubs.splice(0)) off();

    const tabs = Array.from(root.querySelectorAll<HTMLElement>(tabSelector));
    if (!tabs.length) return;

    // 真值源 = 按钮自身的 data-tab。validate 时剔掉缺 data-tab / 重复 data-tab 者并告警
    // （点了没反应的哑按钮、双控同一面板的违例都不静默）。
    const seenIds = new Set<string>();
    const nav: HTMLElement[] = [];
    const ids: string[] = [];
    for (const btn of tabs) {
      const id = btn.dataset.tab ?? "";
      if (!id) {
        if (validate) logWarn("tabs", `tab 按钮缺 data-tab，已跳过（该按钮不可切换）`, btn);
        continue;
      }
      if (seenIds.has(id)) {
        if (validate) {
          logWarn(
            "tabs",
            `重复 data-tab="${id}"（两个按钮控制同一面板，违反 ARIA Tabs，已去重）`,
            btn,
          );
        }
        continue;
      }
      seenIds.add(id);
      nav.push(btn);
      ids.push(id);
    }
    if (!nav.length) return;

    const listEl = tabs[0].parentElement;
    if (listEl && listEl.getAttribute("role") !== "tablist") {
      listEl.setAttribute("role", "tablist");
    }

    // 初始激活：优先 initialTabId；其次调用方已预置 `.active` 的按钮（renderTabs 首个 / 动态重挂的目标）；
    // 都无则回退首个可见按钮。
    const firstVisible = nav.find((b) => b.style.display !== "none") ?? nav[0];
    const preSeeded = nav.find((b) => b.classList.contains("active"));
    const initialBtn = initialTabId
      ? (nav.find((b) => b.dataset.tab === initialTabId) ?? preSeeded ?? firstVisible)
      : (preSeeded ?? firstVisible);

    onBound?.(nav, ids);

    nav.forEach((btn) => {
      const id = btn.dataset.tab ?? "";
      const isActive = btn === initialBtn;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", panelId(id));
      // 初始视觉态与 roving：active 类 / aria-selected / 整组仅一个 tabindex=0
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    // 激活 = 可访问性态迁移（active 类 + aria-selected + roving tabindex，全组互斥）交原语统一持有；
    // 内容切换 / 面板 display / 懒初始化 / 重渲染属调用方，落在 onActivate 里。
    const activate = (btn: HTMLElement): void => {
      const id = btn.dataset.tab ?? "";
      nav.forEach((b) => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", String(on));
        b.setAttribute("tabindex", on ? "0" : "-1");
      });
      onActivate(btn, id);
    };

    nav.forEach((btn) => {
      const onClick = (): void => {
        btn.focus();
        activate(btn);
      };
      const onKey = (e: KeyboardEvent): void => {
        // 键盘导航集合 = 当前可见按钮全集（与 roving tabindex 同口径）
        const vis = nav.filter((t) => t.style.display !== "none");
        const vIdx = Math.max(0, vis.indexOf(btn));
        let next: HTMLElement | undefined;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          next = vis[(vIdx + 1) % vis.length];
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          next = vis[(vIdx - 1 + vis.length) % vis.length];
        } else if (e.key === "Home") {
          e.preventDefault();
          next = vis[0];
        } else if (e.key === "End") {
          e.preventDefault();
          next = vis[vis.length - 1];
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate(btn);
          return;
        }
        if (next) {
          next.focus();
          // automatic activation：切 tab 即切换内容
          activate(next);
        }
      };
      btn.addEventListener("click", onClick);
      btn.addEventListener("keydown", onKey);
      unsubs.push(() => btn.removeEventListener("click", onClick));
      unsubs.push(() => btn.removeEventListener("keydown", onKey));
    });
  };

  attach();
  return { refresh: attach };
}
