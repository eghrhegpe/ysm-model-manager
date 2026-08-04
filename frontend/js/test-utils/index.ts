// ===== 测试公共工具（test-utils/index）=====
// 入口导出：查询 / 事件 / 渲染 / 等待
export {
  queryByTestId,
  getByTestId,
  queryAllByTestId,
  getAllByTestId,
} from "./query-by-testid.ts";

export {
  fireEvent,
  fireClick,
  fireFocus,
  fireBlur,
  fireKeyDown,
  fireInput,
  fireDrop,
} from "./events.ts";

export { renderComponent } from "./render.ts";

/**
 * 同步渲染自定义元素到 body，返回已创建元素。
 * 与 renderComponent 不同：不返回 RenderResult，适合简单测试。
 */
export function mountCustomElement<T extends Element = HTMLElement>(
  tagName: string,
  container: Element = document.body,
): T {
  const el = document.createElement(tagName) as unknown as T;
  container.appendChild(el);
  return el;
}

/**
 * 卸载元素：从 DOM 移除。
 */
export function unmountElement(el: Element): void {
  el.remove();
}

/**
 * 简单睡眠（测试中等待异步渲染）。
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 轮询等待条件满足（兼容现有测试风格，作为统一导出）。
 * @param fn 条件函数，返回 truthy 即通过
 * @param timeout 超时毫秒
 */
export async function waitFor(
  fn: () => unknown,
  timeout = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        if (fn()) resolve();
        else if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else reject(new Error(`waitFor timed out after ${timeout}ms`));
      } catch {
        if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else reject(new Error(`waitFor condition threw after ${timeout}ms`));
      }
    };
    tick();
  });
}

/**
 * 轮询等待元素被移除。
 * @param fn 返回目标元素
 * @param timeout 超时毫秒
 */
export async function waitForElementToBeRemoved(
  fn: () => Element | null,
  timeout = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        const el = fn();
        if (!el || !el.isConnected) resolve();
        else if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else reject(new Error(`waitForElementToBeRemoved timed out after ${timeout}ms`));
      } catch {
        if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else reject(new Error(`waitForElementToBeRemoved condition threw after ${timeout}ms`));
      }
    };
    tick();
  });
}
