// ===== Wails App 绑定访问（类型化版 — ADR-014 P1 渐进迁移）=====
// 统一从 getApp() 取绑定，禁止 window.go.main.App.*（治理红线）。
// 类型红利：App.SomeBinding() 参数/返回值全程类型化（Wails v3 生成 .ts 绑定源）。

type AppBindings = typeof import("../../bindings/ysm-model-manager/internal/app/app.js");

let _App: AppBindings | null = null;
let _appPromise: Promise<AppBindings> | null = null;

/** 获取 Go App 绑定的缓存引用，避免重复动态 import */
export const getApp = async (): Promise<AppBindings> => {
  // 缓存已就绪 → 直接返回
  if (_App) return _App;

  // 并发保护：已有同名 import 在进行中 → 复用 Promise
  if (_appPromise) return _appPromise;

  // 优先检查 window.go.main.App（E2E/vite dev 环境，mock bridge 注入点）
  const winApp = (window as unknown as { go?: { main?: { App?: AppBindings } } }).go?.main?.App;
  if (winApp) {
    _App = winApp as AppBindings;
    return _App;
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
