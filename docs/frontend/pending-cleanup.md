# 待清除清单（调试代码清理台账）

测试完成后需清理的调试代码。提交前逐项确认。本文件为**清理台账**，仅记录调试代码 / 临时方案的清除；前端增强待办（问题 / 方案 / 落点）已迁至 **[ADR-017](../adr/ADR-017-frontend-enhancement-backlog.md)**。

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

## 新增清理（v1.7.5）

| #    | 文件                               | 内容                                                            | 说明      |
| ---- | ---------------------------------- | --------------------------------------------------------------- | --------- |
| 11   | `frontend/js/core/handler-dnd.js`  | v1.7.4 遗留 `[DnD]` console.log（2 处 drop/collected 日志）     | ✅ 已清理 |
| 12   | `frontend/.../toolbar-events.js`   | v1.7.4 遗留 `[DBG:toolbar-bind]` console.log                    | ✅ 已清理 |
| 13   | `frontend/.../preview-utils.js`    | v1.7.4 遗留 `[YSM]` console.log（4 处，绕过 devLog 守卫）       | ✅ 已清理 |
| 14   | `resource_bindings.go`             | v1.7.4 遗留 `[push]` fmt.Printf（9 处流程追踪）                 | ✅ 已清理 |

---

> 前端**增强待办**（列表/网格视图切换、model2d 预览缓存等带方案与落点的改进项）统一收录于 **[ADR-017](../adr/ADR-017-frontend-enhancement-backlog.md)**，不在本台账重复登记。
