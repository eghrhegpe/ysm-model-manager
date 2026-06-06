# 架构变动追踪表

> 记录每次影响架构的变更，帮助新 AI 快速理解代码库演进。
> **原则**：不写"优化性能"，写具体的改动内容和影响。

| 日期 | 改动文件 | 架构层级 | 影响范围 | 破坏性? | 描述 |
|---|---|---|---|---|---|
| 0606 | `app-content/index.js` → `features/`, `pages/` | 组件拆分 | 导入/回收站/更新/仓库页 | 否(仅重构) | 2114 行拆为 5 个模块（主文件 1342 + 4 个业务模块），降低认知负荷 |
| 0606 | `dialogs/modal.js` | 新建 | 所有弹窗 | 是(需清缓存) | 统一模态弹窗系统，替代散落的 `alert/prompt/confirm` |
| 0605 | `app.go` / `go/sync/sync.go` | Go 后端 | 文件锁定/回收站 | 是(需重编译) | 新增 `isFileLocked` 检测游戏运行时锁定文件；`CreateDir` 支持绝对路径 |
| 0605 | `frontend/wailsjs/go/main/App.js` | Binding | 导入覆盖 | 是(需重编译) | 新增 `ImportModelFileOverwrite` Binding |
| 0605 | `go/watcher/watcher.go` | 新建 | .ban 自动同步 | 是(需重编译) | fsnotify 文件监听器，仓库 .ban 变更即时同步整合包 |
| 0605 | `go/paths/safe.go` | 新建 | 路径安全 | 是(需重编译) | 统一 IsInside / ContainsMinecraftMarker，替换散落各包的路径校验 |
| 0604 | `index.html` / `bus.js` | 前端基建 | 全局 | 是(需清缓存) | 统一 ESM 入口，`app-modules.js` 接管所有组件加载 |
| 0604 | `frontend/js/` 死代码清理 | 清理 | 全局 | 否 | 删除 20+ 未引用文件（`ui/`, `versions/`, `lib/`, `sync.js` 等） |
| 0604 | `frontend/js/dialogs/confirm.js` | 删除 | 全局 | 是(需清缓存) | 统一 `window.showConfirm` → `modalConfirm`，修复 9 处静默失效 |
| 0603 | `app.go` BOM 处理 | Go 后端 | JSON 配置读取 | 是(需重编译) | `readJSONFile` 自动去除 UTF-8 BOM，修复配置回退为默认值 |
| 0603 | `go/sync/link_windows.go`, `link_unix.go` | 新建 | 硬链接检测 | 是(需重编译) | platform build tag 分离硬链接检测逻辑 |
| 0602 | `app.go` Config 回退链 | Go 后端 | 配置读取 | 是(需重编译) | `findConfigFile` 三级回退：exe 目录 → 父目录 → 当前目录 |
