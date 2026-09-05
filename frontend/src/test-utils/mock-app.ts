// ===== backend/app.ts 测试 mock 工厂（vi.mock 治理 L1）=====
// 用法（测试文件内，路径统一用 @/backend/app.ts 别名，归一历史 4 种相对路径写法）：
//   vi.mock("@/backend/app.ts", async () => {
//     const { setupAppMock } = await import("@/test-utils/mock-app.ts");
//     return setupAppMock();
//   });
//   mockAppMethods({ LoadAppConfig: { mcRoot: "/mc" } });  // 配置方法返回值
//
// 设计要点：
// - fail-closed：未配置的方法调用即 throw（显式失败，杜绝静默假成功）；
// - Proxy get trap 放行 then/catch/finally 探针（await getApp() 会探查 thenable）；
// - 每文件独立模块环境（isolate:true），store 挂 globalThis 即可，无跨文件共享问题。
// 不采用 setup 级全局 vi.mock：app.test.ts 等测真实 app.ts 的文件会被劫持，
// 且 importOriginal 直通会破坏 vi.resetModules 语义（app.ts 内部缓存状态不再重置）。
import { vi } from "vitest";

type AppFn = ReturnType<typeof vi.fn>;

interface AppMockStore {
  app: unknown;
  fns: Map<string, AppFn>;
}

function ensureStore(): AppMockStore {
  const g = globalThis as Record<string, unknown>;
  if (!g.__YSM_TEST_APP__) {
    const fns = new Map<string, AppFn>();
    const app = new Proxy(
      {},
      {
        get(_t, prop) {
          // thenable 探针放行：await getApp() 会探查 .then/.catch/.finally，
          // 不能被 fail-closed 陷阱拦截（否则 await 直接炸）
          if (
            typeof prop !== "string" ||
            prop === "then" ||
            prop === "catch" ||
            prop === "finally"
          ) {
            return undefined;
          }
          let fn = fns.get(prop);
          if (!fn) {
            fn = vi.fn((..._args: unknown[]) => {
              throw new Error(
                `backend/app 方法 ${String(prop)} 未在测试中配置（用 test-utils/mock-app 的 mockAppMethods 设置）`,
              );
            });
            fns.set(prop, fn);
          }
          return fn;
        },
      },
    );
    g.__YSM_TEST_APP__ = { app, fns };
  }
  return g.__YSM_TEST_APP__ as AppMockStore;
}

/** vi.mock 工厂：返回 backend/app.ts 的 mock 模块形态（getApp → fail-closed Proxy）。 */
export function setupAppMock(): { getApp: () => Promise<unknown> } {
  return { getApp: async () => ensureStore().app };
}

/** 取指定 backend/app 方法的 vi.fn 实例（懒创建，未配置时调用即 throw）。 */
export function appFn(name: string): AppFn {
  const app = ensureStore().app as Record<string, AppFn>;
  return app[name];
}

/**
 * 批量配置本次测试关心的 backend/app 方法集。
 * 值为普通对象/标量 → mockResolvedValue；值为函数 → mockImplementation。
 * 返回 { 方法名: vi.fn } 便于断言 toHaveBeenCalled*。
 * 每个列入的方法先 mockReset（清历史 + 清旧实现），再注入新值。
 */
export function mockAppMethods(methods: Record<string, unknown>): Record<string, AppFn> {
  const out: Record<string, AppFn> = {};
  for (const [name, value] of Object.entries(methods)) {
    const fn = appFn(name);
    fn.mockReset();
    if (typeof value === "function") {
      fn.mockImplementation(value as (...args: unknown[]) => unknown);
    } else {
      fn.mockResolvedValue(value);
    }
    out[name] = fn;
  }
  return out;
}
