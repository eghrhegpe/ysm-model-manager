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
// - store 挂 globalThis（所有 mock-app 采用文件共享同一 store，无每文件独立模块态）。
//   ⚠️ 隔离契约（code_review 7be20003）：不要假设 isolate:true 保证每文件干净——
//   `test:audit` 跑 isolate=false + sequence.shuffle，worker 内 globalThis 跨文件存活，
//   先跑文件 mockResolvedValue 的实现/调用历史会残留给后跑文件。每采用文件的
//   afterEach 必须调 resetAppMock()（清实现 + 历史，回到 fail-closed 起点），
//   否则未配置方法的「未配置即 throw」保证被静默击穿、结果随 shuffle 顺序漂移。
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

/**
 * 重置共享 store 到 fail-closed 起点（code_review 7be20003 #3/#4/#6）：
 * test:audit 跑 isolate=false + sequence.shuffle，worker 内 globalThis store 跨文件
 * 存活——先跑文件 mockResolvedValue 的实现/调用历史若不清理会残留给后跑文件
 * （vi.clearAllMocks 只清历史不清实现），未配置方法的「未配置即 throw」保证被
 * 静默击穿、断言随 shuffle 顺序漂移。每个采用文件的 afterEach 必须调用本函数
 *（与 browser-adapter 族 setup 级 __YSM_TEST_IDB__ 的每文件显式清理同范式）。
 */
export function resetAppMock(): void {
  const g = globalThis as Record<string, unknown>;
  const store = g.__YSM_TEST_APP__ as AppMockStore | undefined;
  if (!store) return;
  for (const [name, fn] of store.fns) {
    fn.mockReset();
    // 回到 fail-closed：未配置方法调用即 throw（mockReset 只清实现/历史，
    // 默认实现需重新挂上——否则变回 vi.fn() 的 undefined 成功语义，静默假成功）
    fn.mockImplementation((..._args: unknown[]) => {
      throw new Error(
        `backend/app 方法 ${name} 未在测试中配置（用 test-utils/mock-app 的 mockAppMethods 设置）`,
      );
    });
  }
}
