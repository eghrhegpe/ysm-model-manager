// ===== Wails App 绑定访问（类型化版 — ADR-014 P1 渐进迁移）=====
// 统一从 getApp() 取绑定，禁止 window.go.main.App.*（治理红线）。
// 类型红利：App.SomeBinding() 参数/返回值全程类型化（Wails v3 生成 .ts 绑定源）。

type AppBindings = typeof import("../../bindings/ysm-model-manager/internal/app/app.js");

let _App: AppBindings | null = null;

/** 获取 Go App 绑定的缓存引用，避免重复动态 import */
export const getApp = async (): Promise<AppBindings> => {
  if (_App) return _App;
  _App = await import("../../bindings/ysm-model-manager/internal/app/app.js");
  return _App;
};
