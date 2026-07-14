let _App = null;

/** 获取 Go App 绑定的缓存引用，避免重复动态 import */
export const getApp = async () => {
  if (_App) return _App;
  _App = await import("../../bindings/ysm-model-manager/app.js");
  return _App;
};

/** 重置缓存（测试用） */
export const resetAppCache = () => {
  _App = null;
};
