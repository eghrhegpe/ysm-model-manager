// @vitest-environment node
// ===== deferred —— 延迟注入哨兵的不变量 =====
// 锁：返回值必须是 null（**不是 undefined**）。下游一律用宽松比较 `x != null` 当
// 「已注入」判据（mount-preview-core 的 viewContainer / loadingEl / menuHandle /
// camBridge 等构造期字段）；一旦改成 `undefined as unknown as T`，该判据全部翻转为
// 「已赋值」，「构造期未注入」的守卫静默失效——本文件是这条等价的回归锁。
import { describe, it, expect } from "vitest";
import { deferred } from "./deferred.ts";

describe("deferred —— 延迟注入哨兵", () => {
  it("任意类型参数都返回 null：与 T 无关（运行期类型参数已擦除）", () => {
    expect(deferred<number>()).toBeNull();
    expect(deferred<string>()).toBeNull();
    expect(deferred<{ id: string }>()).toBeNull();
    expect(deferred<() => void>()).toBeNull();
    expect(deferred<null>()).toBeNull();
  });

  it("`!= null` 判据恒为「未注入」——下游守卫依赖此等价", () => {
    const v = deferred<{ close(): void }>();
    // 契约本体就是宽松比较：== null 同时覆盖 null 与 undefined，
    // 这里断言「判据取 false 分支」，即下游 `if (x != null) x.close()` 不会空跑。
    expect(v == null).toBe(true);
    expect(v != null).toBe(false);
  });

  it("严格同一性是 null 而非 undefined（宽松比较掩盖不了这类漂移）", () => {
    expect(Object.is(deferred<unknown>(), null)).toBe(true);
    expect(deferred<unknown>() === undefined).toBe(false);
    // 也不是任何「假值占位对象」——改成 {} as T 同样会击穿 `!= null` 守卫
    expect(deferred<unknown>()).not.toEqual({});
    expect(deferred<unknown>()).not.toBe(false);
    expect(deferred<unknown>()).not.toBe(0);
  });
});
