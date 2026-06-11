# 待清除清单

测试完成后需清理的调试代码。提交前逐项确认。

| #     | 文件                               | 内容                                                                                                  | 说明      |
| ----- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- | --------- |
| ~~1~~ | ~~`go/threejs/spec.go`~~           | ~~`debugLog []string`, `_debug` 字段, `ftoa/ftoa3/ftoaRot/ptrStr/itoa` 辅助函数~~                     | ✅ 已清理 |
| ~~2~~ | ~~`frontend/js/app-modules.js`~~   | ~~`window.$spec` 中的 JS 兜底 (`buildSpecFromModel` import)~~                                         | ✅ 已清理 |
| ~~3~~ | ~~`frontend/js/utils/model3d.js`~~ | ~~`window.__lastModel`, `window.__buildSpecFromModel`, `window.$forceJSSpec`, `window.__last3DSpec`~~ | ✅ 已清理 |
