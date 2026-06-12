# 待清除清单

测试完成后需清理的调试代码。提交前逐项确认。

| #      | 文件                                 | 内容                                                                                                  | 说明      |
| ------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------- |
| ~~1~~  | ~~`go/threejs/spec.go`~~             | ~~`debugLog []string`, `_debug` 字段, `ftoa/ftoa3/ftoaRot/ptrStr/itoa` 辅助函数~~                     | ✅ 已清理 |
| ~~2~~  | ~~`frontend/js/app-modules.js`~~     | ~~`window.$spec` 中的 JS 兜底 (`buildSpecFromModel` import)~~                                         | ✅ 已清理 |
| ~~3~~  | ~~`frontend/js/utils/model3d.js`~~   | ~~`window.__lastModel`, `window.__buildSpecFromModel`, `window.$forceJSSpec`, `window.__last3DSpec`~~ | ✅ 已清理 |
| ~~4~~  | ~~`app_model.go`~~                   | ~~v1.5.1 调试 `[YSM]` 日志 (13 处 `fmt.Printf`)~~                                                     | ✅ 已清理 |
| ~~5~~  | ~~`app_files.go`~~                   | ~~v1.5.1 调试 `[YSM]` 日志 (2 处 `fmt.Printf`)~~                                                      | ✅ 已清理 |
| ~~6~~  | ~~`go/ysm/summary.go`~~              | ~~v1.5.1 调试 `[YSM]` 日志 (4 处 `fmt.Printf`)~~                                                      | ✅ 已清理 |
| ~~7~~  | ~~`frontend/.../preview-wasm.js`~~   | ~~v1.5.1 调试 console.log（.json 分支）~~                                                             | ✅ 已清理 |
| ~~8~~  | ~~`frontend/.../index.js`~~          | ~~v1.5.1 调试 console.log (\_loadPreviewImage)~~                                                      | ✅ 已清理 |
| ~~9~~  | ~~`frontend/.../preview-detail.js`~~ | ~~v1.5.1 调试 console.log (summary/header 日志)~~                                                     | ✅ 已清理 |
| ~~10~~ | ~~`frontend/.../preview-loader.js`~~ | ~~v1.5.1 调试 console.log (缓存/Go 日志)~~                                                            | ✅ 已清理 |

## 注意

- `frontend/js/components/app-preview/preview-wasm.js` 中原有的 `[YSM]` 日志（WASM init/解码流程）是常规调试日志，非本次新增，保留
