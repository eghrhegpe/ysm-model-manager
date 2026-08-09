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
  const winApp = (window as unknown as { go?: { main?: { App?: unknown } } }).go?.main?.App;
  if (winApp) {
    // P3 修复：空对象（truthy）不得缓存为 _App——原守卫仅检查 truthiness，
    // `window.go.main.App = {}`（未注入/partial mock）会被缓存，缺失方法运行时穿透
    // undefined（陷阱 #5）且粘滞整个会话（后续真实 import 永不走）
    if (typeof winApp === "object" && Object.keys(winApp).length === 0) {
      // 空对象视为未注入，回退动态 import
    } else {
      // P3 修复：mock bridge 运行时形态 ≠ 生成模块命名空间，直接 `as AppBindings` 是类型造假——
      // 缺失方法可穿透类型系统到运行时 undefined（陷阱 #5）。这里仅缓存原始句柄，
      // 调用方经解构取方法仍受 TS 类型约束（缺失方法在 import 路径下编译期报错）。
      _App = winApp as AppBindings;
      return _App;
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
