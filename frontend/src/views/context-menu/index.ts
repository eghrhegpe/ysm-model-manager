// ===== <context-menu> — 右键菜单（类型化版 — ADR-014 P3 components）=====
// 事件：menu:show, menu:hide
// 监听：menu:show({ x, y, items: [{label, icon?, onClick}] })
import { bus, type MenuItem } from "../../bus.ts";
import { esc } from "../../utils/dom/html.ts";
import { WebComponentBase } from "../../utils/dom/web-component-base.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = ["ctx-item"];

class ContextMenu extends WebComponentBase {
  _unsub: (() => void) | undefined;
  _docClick: () => void;
  _docCtx: () => void;
  _docKeydown: (e: KeyboardEvent) => void;
  _prevFocus: Element | null = null; // show() 时记录打开前焦点，hide() 归还

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._docClick = (): void => this.hide();
    this._docCtx = (): void => this.hide();
    this._docKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        this.hide();
        return;
      }
      const menu = this.shadowRoot?.getElementById("menu");
      if (!menu || this.style.display === "none") return;
      // 深焦解析：document.activeElement 对 shadow 内聚焦元素 retarget 成 host——
      // 沿 shadowRoot.activeElement 下钻到真实聚焦元素（范式见 utils/dom/focus-restore.ts
      // trapFocusAcrossShadow），否则 indexOf/classList 对 host 恒 false，键盘导航整体失效
      let active: Element | null = document.activeElement as Element | null;
      while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      const activeEl = active as HTMLElement | null;
      // 焦点不在本菜单（Tab 逃逸 / 外部点击后菜单未关 / 空 items 未聚焦）→ 不接管
      // 方向键/Enter：防劫持页面滚动/光标、防误触发页面上恰好同 class 的元素
      if (!activeEl || !menu.contains(activeEl)) return;
      const items = Array.from(menu.querySelectorAll<HTMLElement>(".item")).filter(
        (el) => el.style.display !== "none",
      );
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (items.length === 0) return;
        const current = items.indexOf(activeEl);
        let next: number;
        if (e.key === "ArrowDown") {
          next = current < 0 ? 0 : (current + 1) % items.length;
        } else {
          next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        }
        items[next]?.focus();
      }
      if (e.key === "Enter") {
        if (activeEl.classList.contains("item")) activeEl.click();
      }
    };
  }

  connectedCallback(): void {
    this._unsub = bus.on("menu:show", ({ x, y, items }) => {
      this.show(x, y, items);
    });
    document.addEventListener("click", this._docClick);
    document.addEventListener("contextmenu", this._docCtx);
    this.render();
  }

  disconnectedCallback(): void {
    if (this._unsub) this._unsub();
    document.removeEventListener("click", this._docClick);
    document.removeEventListener("contextmenu", this._docCtx);
    document.removeEventListener("keydown", this._docKeydown);
  }

  render(): void {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    this.shadowRoot!.innerHTML = `
      <style>
        :host {
          position: fixed;
          z-index: var(--z-popover);
          display: none;
          font-family: var(--font-ui);
          font-size: var(--fs-base);
        }
        .menu {
          background: var(--card);
          border: 1px solid var(--bd);
          border-radius: 8px;
          padding: 4px;
          min-width: 160px;
          box-shadow: 0 8px 24px rgba(0,0,0,.5);
          animation: menuPop .2s cubic-bezier(.34,1.56,.64,1);
        }
        .item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 5px;
          font-size: var(--fs-btn-secondary);
          color: var(--txt);
          cursor: pointer;
          transition: background .1s;
        }
        .item:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent); }
        .item.danger:hover { background: var(--paid); color: var(--bg); }
        .item .icon { font-size: var(--fs-base); width: 16px; text-align: center; }
        .divider {
          border: none;
          border-top: 1px solid var(--bd);
          margin: 3px 8px;
        }
        @keyframes menuPop { 0% { opacity: 0; transform: scale(.85) translateY(-6px); } 60% { opacity: 1; transform: scale(1.02) translateY(0); } 100% { transform: scale(1); } }
        @keyframes itemSlideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
      </style>
      <div class="menu" id="menu" role="menu" aria-label="context menu"></div>
    `;
  }

  _esc(s: unknown): string {
    return esc(s == null ? "" : String(s));
  }

  show(x: number, y: number, items: MenuItem[]): void {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const menu = this.shadowRoot!.getElementById("menu") as HTMLElement;
    // 记录打开前焦点（hide 归还；host 自身/body 不入账——防归还闭环与整页焦点丢失）
    const docActive = document.activeElement;
    if (docActive && docActive !== this && docActive !== document.body) {
      this._prevFocus = docActive;
    }
    // 防御：遗留 .js/内联调用方可能缺 items emit——直接 .map 会崩在 bus handler
    // 里（被 bus try/catch 吞成「menu:show 处理出错」，菜单无内容也不给位置）；
    // 回退空数组保持「空菜单 + 定位 + 可关闭」行为一致，不静默
    menu.innerHTML = (items || [])
      .map((item, i) => {
        if (item.divider) return '<hr class="divider">';
        const label = this._esc(item.label || "");
        const icon = item.icon ? this._esc(item.icon) : "";
        const danger = item.danger ? "danger" : "";
        // ADR-133 阶段 C+：action 落到 DOM 供测试语义定位。MenuItem.action 本就是
        // 「行为标识（测试按此匹配）」，此前只存在于 JS 层，e2e 只能按 i18n 文案
        // filter（改文案/切 locale 即静默失效）；输出属性后定位与文案彻底解耦。
        const action = item.action ? ` data-action="${this._esc(item.action)}"` : "";
        return `
        <div class="item ${danger}" role="menuitem" tabindex="${i === 0 ? "0" : "-1"}" data-testid="ctx-item" data-idx="${i}"${action} style="animation: itemSlideIn .15s ease ${i * 25}ms both;">
          ${icon ? `<span class="icon">${icon}</span>` : ""}
          <span>${label}</span>
        </div>
      `;
      })
      .join("");

    // 绑定点击
    menu.querySelectorAll(".item").forEach((el) => {
      (el as HTMLElement).onclick = (e: MouseEvent) => {
        e.stopPropagation();
        try {
          const idx = parseInt((el as HTMLElement).dataset.idx || "", 10);
          if (items[idx]?.onClick) items[idx].onClick();
        } finally {
          // 无论 onClick 是否抛异常都收菜单，防残留（异常另有全局兜底）
          this.hide();
        }
      };
    });

    // Esc 关闭菜单：show 注册、hide 移除（先 remove 再 add 防连续 show 累积）
    document.removeEventListener("keydown", this._docKeydown);
    document.addEventListener("keydown", this._docKeydown);

    // 边界检测：先测量菜单尺寸再设置位置，避免 RAF 跳变
    this.style.display = "block";
    this.style.left = "-9999px";
    this.style.top = "-9999px";
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const iw = window.innerWidth;
      const ih = window.innerHeight;
      const mw = rect.width;
      const mh = rect.height;
      let l = x;
      let t = y;
      if (x + mw > iw) l = Math.max(0, iw - mw);
      if (y + mh > ih) t = Math.max(0, ih - mh);
      this.style.left = l + "px";
      this.style.top = t + "px";
      // 焦点移到首个菜单项，启用键盘导航
      const firstItem = menu.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus();
    });
  }

  hide(): void {
    this.style.display = "none";
    document.removeEventListener("keydown", this._docKeydown);
    // 归还焦点（打开时被移入菜单项；hide 不归还会掉到 body，键盘上下文丢失）
    const prev = this._prevFocus;
    this._prevFocus = null;
    if (prev && (prev as HTMLElement).focus) {
      try {
        (prev as HTMLElement).focus({ preventScroll: true });
      } catch {
        /* 元素已从 DOM 移除等 → 忽略 */
      }
    }
  }
}
// 注册组件（防 HMR/重复 import 时重复 define）
if (typeof customElements !== "undefined" && !customElements.get("context-menu")) {
  customElements.define("context-menu", ContextMenu);
}
