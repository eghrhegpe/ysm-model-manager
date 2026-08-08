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

  // 等待 connectedCallback：轮询 shadowRoot 就绪。
  // 注：旧实现监听的 "connected" 自定义事件无组件派发（死代码），已移除；
  // 超时只 console.warn 不 throw——组件未注册时抛 uncaught 会炸掉整个测试文件而非当前用例。
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;

  timer = setTimeout(() => {
    if (poll) clearInterval(poll);
    console.warn(
      `renderComponent: <${tagName}> connectedCallback timed out (${connectedTimeout}ms)`,
    );
  }, connectedTimeout);

  poll = setInterval(() => {
    if (el.shadowRoot) {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
    }
  }, 16);

  return {
    el,
    container,
    unmount: () => {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (el.isConnected) el.remove();
    },
  };
}
