// ===== 测试等待工具（test-utils/wait）=====
// 简单睡眠、微任务队列刷新、条件轮询等待。
// 所有函数依赖 vitest 的 DOM 环境，仅测试上下文使用。

/** 把任意异常归一为消息字符串：优先 Error.message，否则整体 String。 */
function errMessage(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

/**
 * 条件轮询内核——waitFor / waitForElementToBeRemoved 共用骨架。
 *
 * check 返回真即 resolve；check 抛错则记录首个异常并继续轮询；超时 reject
 * 时统一带上首个异常（根因），若末次异常与之不同则附 last error 作上下文。
 *
 * 设计意图（对齐 P2 修复）：超时消息始终暴露根因，不被通用文案掩盖；
 * catch 不静默吞错。原先两函数各写一套 tick/firstErr/超时 reject，且
 * 抛错超时分支报末次异常（与首异常根因意图相悖）、分隔符与文案不一致——
 * 抽本内核后策略与口径单点收敛。
 */
function pollUntil(check: () => boolean, timeout: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let firstErr: unknown = null;
    let lastErr: unknown = null;
    const tick = () => {
      let done = false;
      try {
        done = check();
      } catch (e) {
        if (firstErr === null) firstErr = e;
        lastErr = e;
      }
      if (done) return resolve();
      if (Date.now() - start < timeout) {
        requestAnimationFrame(tick);
        return;
      }
      const parts = [`${label} timed out after ${timeout}ms`];
      if (firstErr !== null) {
        parts.push(`first error: ${errMessage(firstErr)}`);
        if (lastErr !== firstErr) parts.push(`last error: ${errMessage(lastErr)}`);
      }
      reject(new Error(parts.join("; ")));
    };
    tick();
  });
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
export async function waitFor(fn: () => unknown, timeout = 5000): Promise<void> {
  return pollUntil(() => Boolean(fn()), timeout, "waitFor");
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
  return pollUntil(() => !fn()?.isConnected, timeout, "waitForElementToBeRemoved");
}
