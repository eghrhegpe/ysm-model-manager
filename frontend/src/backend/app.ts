// ===== Wails App 绑定访问（类型化版 — ADR-014 P1 渐进迁移）=====
// 统一从 getApp() 取绑定，禁止 window.go.main.App.*（治理红线）。
// 类型红利：App.SomeBinding() 参数/返回值全程类型化（Wails v3 生成 .ts 绑定源）。
// 平台路由（ADR-049 Phase 1）：网页版（__YSM_BACKEND__=browser / MODE=web）
// 走 browserAdapter（browser-adapter.ts），桌面/Android 走 Wails 原逻辑——
// 业务调用零改动。

import { browserAdapter } from "./browser-adapter.ts";
import { isWebPlatform } from "./platform-web.ts";
import type { AppBindings } from "./types.ts";

export type { AppBindings };

let _App: AppBindings | null = null;
let _appPromise: Promise<AppBindings> | null = null;

/**
 * P1 修复：Proxy 包装 winApp 做运行时 fail-fast。
 * 直接 `winApp as AppBindings` 是类型造假——缺失方法编译期不报错、运行时 undefined 穿透。
 * 用 Proxy 包装后，访问不存在的方法会立即抛错（fail-fast），而非静默返回 undefined。
 */
function makeSafeAppBindings(raw: Record<string, unknown>): AppBindings {
  return new Proxy(raw as AppBindings, {
    get(target, prop) {
      if (typeof prop === "symbol") return undefined;
      const val = target[prop as keyof AppBindings];
      if (val === undefined) {
        throw new Error(
          `[app] binding ${String(prop)} 在 window.go.main.App mock 中未实现（类型造假防护）`,
        );
      }
      return val;
    },
  });
}

/** 获取 Go App 绑定的缓存引用，避免重复动态 import */
export const getApp = async (): Promise<AppBindings> => {
  // 网页版（ADR-049 Phase 1）：无 Wails 壳，路由到 browser adapter——
  // 未实现 binding fail-fast（WebUnsupportedError），杜绝 undefined 穿透。
  // 置于缓存检查之前：browserAdapter 无状态（Proxy），每次返回即可，不污染缓存
  if (isWebPlatform()) return browserAdapter;

  // 缓存已就绪 → 直接返回
  if (_App) return _App;

  // 并发保护：已有同名 import 在进行中 → 复用 Promise
  if (_appPromise) return _appPromise;

  // 优先检查 window.go.main.App（E2E/vite dev 环境，mock bridge 注入点）
  const winApp = (window as unknown as { go?: { main?: { App?: unknown } } }).go?.main?.App;
  if (winApp) {
    // P3 修复：空对象（truthy）不得缓存为 _App——原守卫仅检查 truthiness，
    // `window.go.main.App = {}`（未注入/partial mock）会被缓存，缺失方法运行时穿透
    // undefined（陷阱 #5）且粘滞整个会话（后续真实 import 永不走）
    if (typeof winApp === "object" && Object.keys(winApp).length === 0) {
      // 空对象视为未注入，回退动态 import
    } else {
      // P4 修复（P1-5）：partial mock 检测——非空对象但缺失核心 binding 方法时，
      // 仍回退动态 import，避免 partial mock 粘滞整个会话。
      // 例：test harness 只注入 AddOpLog → 非空，但缺失 ScanModelEntries 等 → 穿透 undefined
      const winAppRec = winApp as Record<string, unknown>;
      // 核心启动集（browser-adapter 已实现的最小集 + 桌面高频绑定）——
      // code_review 53e59e02 #2/#5：须全核心集命中（.every）才视为完整 mock；
      // 原 .some 下「只注入 AddOpLog」（AddOpLog 恰在清单内）算出 hasCore=true，
      // partial mock 仍被缓存粘滞——正是注释声称要防的反例
      const CORE_METHODS = [
        "ScanModelEntries",
        "GetRepoRoot",
        "AddOpLog",
        "AddImportLog",
        "ImportModelFile",
        "GetImportLogs",
        "GetRuntimeLogs",
      ];
      const hasCore = CORE_METHODS.every((m) => typeof winAppRec[m] === "function");
      if (!hasCore) {
        // partial mock → 回退动态 import，不缓存
      } else {
        // P3 修复（P1-9）：用 Proxy 包装 winApp 做运行时 fail-fast——
        // 直接 `winApp as AppBindings` 是类型造假，缺失方法编译期不报错、运行时 undefined 穿透。
        // Proxy 包装后访问不存在的方法立即抛错（fail-fast），防陷阱 #5 静默穿透。
        _App = makeSafeAppBindings(winAppRec);
        return _App;
      }
    }
  }

  // 生产环境：动态 import Wails 生成的 bindings，通过 Promise 缓存避免并发重复 import
  _appPromise = import("../../bindings/ysm-model-manager/internal/app/app.js")
    .then((mod) => {
      _App = mod;
      _appPromise = null;
      return _App;
    })
    .catch((err) => {
      // P2 修复（code_review）：import 失败必须重置缓存并 rethrow——
      // 否则 _appPromise 永久持有 rejected promise，后续所有 getApp() 调用
      // （含 window.go.main.App mock bridge 回退路径）全部返回同一失败，
      // 一次瞬态错误永久毒化整个 Go bridge，无恢复路径
      _appPromise = null;
      throw err;
    });
  return _appPromise;
};
