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

### ~~1. 下载哈希校验~~ ✅ v1.6.0 完成

- `build-release.ps1` 生成 `SHA256SUMS`
- `go/updater/update.go` `Download` 后校验 SHA256
- 不匹配则删除已下载文件并返回错误

**涉及文件**：`go/updater/update.go`, `build-release.ps1`

### ~~2. Windows 自更新替换策略~~ ✅ v1.6.0 完成

- 新建 `cmd/updater/main.go` 独立 helper
- 主进程退出后由 helper 替换 EXE 并重启

**涉及文件**：`cmd/updater/main.go`, `go/updater/update.go`, `build-release.ps1`

### ~~3. 导入日志文件位置迁移~~ ✅ v1.6.0 完成

- 日志文件改用 `os.UserConfigDir()` 写入 `%APPDATA%/YSM-Model-Manager/`
- 前端读取路径已同步更新

**涉及文件**：`go/logs/logs.go`

### ~~4. 标签系统数据后端~~ ✅ v1.6.3 完成

- Go 端：`go/tags/tags.go` + `app_tags.go`
- 前端：`dialogs/tag-editor.js`

---

## 未来待办

### 1. 列表/网格视图切换（低）

**问题**：仓库列表只支持卡片视图，紧凑列表视图可提升浏览效率。

**方案**：

1. 在 `app-tree` 工具栏加切换按钮（🗂 网格 / ☰ 列表）
2. 新增 `tpl-list-row.js` 紧凑行模板
3. `render.js` 增加 `renderListView()` 模式
4. 用户选择持久化到 `localStorage`

**涉及文件**：`frontend/js/components/app-tree/tpl.js`、`render.js`、`row-tpl.js`（新）、`toolbar-events.js`

### 2. model2d 预览缓存（中）

**问题**：浏览社区仓库时重复解析同一模型骨骼图，浪费 CPU。

**方案**：

1. 在 `utils/preview-cache.js`（已存在）扩展 2D 骨骼图缓存
2. 缓存键：`sha256 + 文件大小`
3. LRU 上限 50 项（已有）
4. 命中时跳过 `ExtractYsmSummary` 调用

**涉及文件**：`frontend/js/utils/preview-cache.js`、`features/community/events.js`

### 3. 系统暗色模式变化自动切换（低）

**问题**：系统从浅色切深色时，应用不响应（除 theme === "system"）。

**现状**：`app-modules.js` 已注册 `matchMedia('change')` 监听器，但需确认在所有 4 套主题间切换正常。

**方案**：

1. 验证 `applyTheme("system")` 在 `change` 事件触发时正确切换 cyber ↔ warm
2. 增强：监听 OS 主题变化时，toast 提示用户（"已跟随系统切换至深色")
3. 用户可选择关闭 toast（localStorage 标记）

**涉及文件**：`frontend/js/app-modules.js`

### 4. 右键"打开文件位置"（低）

**问题**：仓库内文件右键菜单缺少"在资源管理器中显示"动作。

**方案**：

1. Go 端：新增 `RevealInExplorer(path)` 调用 `explorer /select,path`
2. 注册 binding
3. `context-menus.js` `type === "file"` 分支加菜单项

**涉及文件**：`app_files.go`、`wails.json`、`frontend/js/core/context-menus.js`
