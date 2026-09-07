// ===== 测试等待工具（test-utils/wait）=====
// 简单睡眠、微任务队列刷新、条件轮询等待。
// 所有函数依赖 vitest 的 DOM 环境，仅测试上下文使用。

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
export async function waitFor(fn: () => unknown, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    // P2 修复：记录首个异常，超时 reject 时带上原始错误——原实现 catch 静默吞错，
    // 真实根因被通用消息掩盖，调试成本高
    let firstErr: unknown = null;
    const tick = () => {
      try {
        if (fn()) resolve();
        else if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else
          reject(
            new Error(
              `waitFor timed out after ${timeout}ms${firstErr ? `; first error: ${String((firstErr as Error)?.message ?? firstErr)}` : ""}`,
            ),
          );
      } catch (e) {
        if (firstErr === null) firstErr = e;
        if (Date.now() - start < timeout) requestAnimationFrame(tick);
        else
          reject(
            new Error(
              `waitFor condition threw after ${timeout}ms: ${String((e as Error)?.message ?? e)}`,
            ),
          );
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
        if (!el?.isConnected) resolve();
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
