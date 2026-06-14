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

## 未来待办（非调试代码，需单独实施）

### 1. 下载哈希校验

**问题**：`go/updater/update.go` 的 `Download` 直接下载 GitHub Release asset，未校验文件完整性。攻击者 MITM 或 GitHub 被污染时可注入恶意代码。

**方案**：

1. 在 release assets 中上传 `SHA256SUMS` 文件（`build-release.ps1` 生成）
2. `Download` 后计算文件 SHA256，与 `SHA256SUMS` 中对应条目比对
3. 不匹配则删除已下载文件并返回错误

**涉及文件**：`go/updater/update.go`, `build-release.ps1`

### 2. Windows 自更新替换策略

**问题**：`InstallUpdate` 使用 `os.Rename(exe, oldPath)` 替换当前运行中的 EXE，Windows 会因文件锁定而失败。

**方案**：

1. 新建 `cmd/updater/` 目录，编译独立 helper 可执行文件（如 `ysm-updater-helper.exe`）
2. `InstallUpdate` 下载更新包后，将 helper + 更新包写入临时目录
3. 启动 helper，等待主进程退出
4. helper 完成替换（复制新 exe → 原位置），然后重新启动主程序
5. 发布脚本需将 helper 也打包进 release

**涉及文件**：`cmd/updater/main.go`, `go/updater/update.go`, `build-release.ps1`

### 3. 导入日志文件位置迁移

**问题**：`go/logs/logs.go` 的日志文件存放在 EXE 所在目录，受保护目录（如 `Program Files`）可能无写权限。当前会 `log.Printf` 记录失败，但日志本身无法保存。

**方案**：改用 `os.UserConfigDir()` 获取用户配置目录（如 `%APPDATA%/YSM-Model-Manager/`），更可靠。

**注意**：需确认前端读取日志的路径需同步更新。

**涉及文件**：`go/logs/logs.go`
