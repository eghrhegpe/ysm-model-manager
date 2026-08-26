// ===== 测试公共工具（test-utils/index）=====
// 入口导出：查询 / 事件 / 渲染 / 等待
export {
  queryByTestId,
  getByTestId,
  queryAllByTestId,
  getAllByTestId,
} from "./query-by-testid.ts";

// fireEvent / fireClick 等 + renderComponent 不经 barrel：
// 消费方（各测试文件）直接从 ./events.ts / ./render.ts 导入，
// barrel re-export 无消费方（2026-08-26 deadcode-baseline 清理移除）。

/**
 * 测试自愈工具：菜单表单一事实来源场景下的自适应断言。
 * expectContainsAtLeast / expectNotContains / deriveTestIds / extractIds
 * 依赖 vitest expect，仅测试上下文使用。
 */
export {
  expectContainsAtLeast,
  expectNotContains,
  deriveTestIds,
  extractIds,
} from "./self-healing.ts";

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
 * 刷新微任务队列——让 async 函数链路的全部 await 解包。
 *
 * `await Promise.resolve()` 只让 1 个微任务跑，多层 async 链（如
 * `openAdvFilterDialog` 内部 `await modalAdvFilter(...)`）需要多个微任务
 * 才能完成。本函数用 `setTimeout(0)` 把回调排到宏任务队列，此时所有
 * pending 微任务已跑完。
 *
 * 使用场景：点击触发 async handler 后，断言前等 handler 完成。
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
    // P2 修复：记录首个异常，超时 reject 时带上原始错误——原实现 catch 静默吞错，
    // 真实根因被通用消息掩盖，调试成本高
    let firstErr: unknown = null;
    const tick = () => {
      try {
        if (fn()) resolve();
        else if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else reject(new Error(`waitFor timed out after ${timeout}ms${firstErr ? `; first error: ${String((firstErr as Error)?.message ?? firstErr)}` : ""}`));
      } catch (e) {
        if (firstErr === null) firstErr = e;
        if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else reject(new Error(`waitFor condition threw after ${timeout}ms: ${String((e as Error)?.message ?? e)}`));
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
  // P4 修复：对齐 waitFor 的 firstErr 设计——原 catch 静默吞错，超时只报通用消息，
  // 真实根因被掩盖（fn 抛出的断言/查询错误无法定位）
  let firstErr: unknown = null;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        const el = fn();
        if (!el || !el.isConnected) resolve();
        else if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else
          reject(
            new Error(
              `waitForElementToBeRemoved timed out after ${timeout}ms` +
                (firstErr !== null ? ` (first error: ${String(firstErr)})` : ""),
            ),
          );
      } catch (e) {
        if (firstErr === null) firstErr = e;
        if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else
          reject(
            new Error(
              `waitForElementToBeRemoved timed out after ${timeout}ms (first error: ${String(e)})`,
            ),
          );
      }
    };
    tick();
  });
}
