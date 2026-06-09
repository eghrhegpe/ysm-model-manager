# 待清除清单

测试完成后需清理的调试代码。提交前逐项确认。

| #   | 文件                           | 内容                                                                                              | 说明                 |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | `go/threejs/spec.go`           | `debugLog []string`, `_debug` 字段, `ftoa/ftoa3/ftoaRot/ptrStr/itoa` 辅助函数                     | Go spec 生成调试日志 |
| 2   | `frontend/js/app-modules.js`   | `window.$spec` 中的 JS 兜底 (`buildSpecFromModel` import)                                         | 调试用 spec 获取函数 |
| 3   | `frontend/js/utils/model3d.js` | `window.__lastModel`, `window.__buildSpecFromModel`, `window.$forceJSSpec`, `window.__last3DSpec` | 调试用全局变量       |
