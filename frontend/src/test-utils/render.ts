// ===== 渲染辅助（test-utils/render）=====
// 在测试环境中挂载 Web Component 到 body 或指定容器，等待 connectedCallback 完成。
// 自动处理自定义元素的 customElements.define（如未注册则跳过，假设被测模块已自行注册）。

/** 渲染配置 */
export interface RenderOptions {
  /** 挂载容器（默认 document.body） */
  container?: Element;
  /** 等待 connectedCallback 完成的超时（ms，默认 1000） */
  connectedTimeout?: number;
}

export interface RenderResult<T extends Element> {
  /** 挂载的 DOM 元素 */
  el: T;
  /** 容器（可能等于 el，如果自定义了 container） */
  container: Element;
  /** 卸载回调 */
  unmount: () => void;
}

/**
 * 渲染一个自定义元素到 DOM。
 *
 * @example
 *   import { renderComponent } from "../test-utils/render";
 *   const { el, unmount } = renderComponent("app-resource-manager");
 *   // ... 断言 ...
 *   unmount();
 */
export function renderComponent<T extends Element = HTMLElement>(
  tagName: string,
  options?: RenderOptions,
): RenderResult<T> {
  const { container = document.body, connectedTimeout = 1000 } = options ?? {};
  const el = document.createElement(tagName) as unknown as T;
  container.appendChild(el);

  // 等待 connectedCallback（通过检测 shadowRoot 是否就绪）
  const timer = setTimeout(() => {
    throw new Error(`renderComponent: connectedCallback for <${tagName}> timed out (${connectedTimeout}ms)`);
  }, connectedTimeout);

  el.addEventListener("connected", () => clearTimeout(timer), { once: true });

  // 兼容无 connected 事件的组件：轮询 shadowRoot
  const poll = setInterval(() => {
    if (el.shadowRoot) {
      clearTimeout(timer);
      clearInterval(poll);
    }
  }, 16);

  return {
    el,
    container,
    unmount: () => {
      clearTimeout(timer);
      clearInterval(poll);
      if (el.isConnected) el.remove();
    },
  };
}
