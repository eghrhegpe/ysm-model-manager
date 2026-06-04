# AI 索引 — YSM 模型管理器

## 项目结构速览

```
ysm-model-manager/
├── app.go                  ← Go 后端（Wails Binding，~520行，全部在此文件）
├── main.go                 ← Go 入口
├── wails.json              ← Wails 配置
├── go/                     ← Go 工具包（6个子包）
├── frontend/               ← 前端源码
│   ├── index.html          ← 入口页面
│   ├── css/
│   ├── js/
│   │   ├── bus.js          ← 事件总线
│   │   ├── app-modules.js  ← 所有 ES module 组件统一入口
│   │   ├── utils/          ← 共享工具
│   │   │   ├── fmt.js      ← 文件大小/日期格式化
│   │   │   ├── dom.js      ← HTML 转义/搜索高亮
│   │   │   └── icon.js     ← 文件图标映射
│   │   └── components/     ← 所有 Web Components
│   │       ├── app-tree/        ✅ 已拆（含 loader.js 对接 Go）
│   │       ├── app-sidebar/     ✅ 已拆（含 loader.js 对接 Go）
│   │       ├── app-preview/     ✅ 已拆
│   │       ├── app-content/     ✅ 已拆
│   │       ├── app-toast.js     ✅ 精简
│   │       ├── app-nav.js       🔄 待评估 (109行)
│   │       ├── context-menu.js  🔄 待评估 (90行)
│   │       └── app-header.js    ⏸️ 未引用 (90行)
│   └── wailsjs/           ← * Wails 自动生成
├── docs/ARCHITECTURE.md    ← 拆分规则
├── AI_INDEX.md             ← 本文（AI 索引）
└── .cursorrules            ← AI 行为规则
```

---

## 🚨 重要约束

### 文件创建规则

- 新组件：在 `frontend/js/components/app-xxx/` 创建目录，每文件 ≤ 80 行
- 新工具函数：在 `frontend/js/utils/` 创建
- 永远不要直接在 `frontend/` 根下创建 .js 文件（除了 app-modules.js）
- ES module 组件 → 在 `app-modules.js` 添加 import（不要在 index.html 加 type="module"）
- 非 module 组件 → 在 `index.html` 加 `<script src="...">`

### 搜索策略

- 找后端函数 → 搜索 `app.go`
- 找前端组件 → 搜索 `frontend/js/components/`
- 找 bus 事件 → 搜索 `bus\.(on|emit)`
- 找 CSS 类名 → 搜索对应组件的 shadow-root 里的 style 块

---

## Go 后端 Binding 一览 (app.go)

### 配置

| 函数                                               | 用途                | 参数     | 返回值            |
| -------------------------------------------------- | ------------------- | -------- | ----------------- |
| `SaveAppConfig(repoRoot, mcRoot, linkMode, theme)` | 保存配置（含主题）  | string×4 | error             |
| `LoadAppConfig()`                                  | 加载配置            | -        | AppConfig         |
| `SelectDirectory()`                                | 系统目录选择对话框  | -        | (string, error)   |
| `GetMinecraftPath()`                               | 自动检测 .minecraft | -        | string (含 emoji) |

### 仓库

| 函数                    | 用途                                    | 参数   | 返回值       |
| ----------------------- | --------------------------------------- | ------ | ------------ |
| `SetRepoRoot(dir)`      | 设置仓库路径                            | string | void         |
| `ScanModelEntries(dir)` | 扫描目录下所有 .ysm/.zip/.7z（含 hash） | string | []ModelEntry |
| `ScanCustomModels(dir)` | 同上（别名）                            | string | []ModelEntry |

### 整合包

| 函数                           | 用途                              | 参数   | 返回值            |
| ------------------------------ | --------------------------------- | ------ | ----------------- |
| `ListVersionInstances(mcRoot)` | 列出 versions 下所有子目录        | string | []VersionInstance |
| `GetGlobalCustomDir(mcRoot)`   | 全局 custom 目录路径              | string | string            |
| `ListFileNames(dir)`           | 列出目录下模型文件名（不含 .ban） | string | []string          |
| `CheckFileExists(path)`        | 文件存在检查                      | string | bool              |
| `OpenFolder(dir)`              | 在资源管理器中打开                | string | error             |

### 启用/禁用

| 函数                      | 用途                        | 参数   | 返回值        |
| ------------------------- | --------------------------- | ------ | ------------- |
| `ToggleModelEnable(path)` | 切换启用/禁用（加/删 .ban） | string | (bool, error) |
| `IsFileBanned(path)`      | 检查是否已禁用              | string | bool          |

### 安装

| 函数                                      | 用途                            | 参数                           | 返回值          |
| ----------------------------------------- | ------------------------------- | ------------------------------ | --------------- |
| `InstallModelFile(src, mcRoot)`           | 安装到全局 custom               | string×2                       | (string, error) |
| `InstallModelTo(src, customDir)`          | 安装到指定目录（根据 linkMode） | string×2, 含 RepoRoot/LinkMode | error           |
| `InstallModelWithOverlay(src, customDir)` | 覆盖安装                        | string×2                       | (string, error) |
| `SyncCustomToRepo(customDir, repoDir)`    | 整合包→仓库同步                 | string×2                       | (int, error)    |
| `ImportModelFile(fileName, base64Data)`   | Base64 导入（含校验）           | string×2                       | error           |

### 回收站

| 函数                                | 用途                   | 参数     | 返回值            |
| ----------------------------------- | ---------------------- | -------- | ----------------- |
| `MoveToRecycle(src)`                | 移入回收站             | string   | error             |
| `MoveToRecycleEx(src)`              | 同上（返回状态字符串） | string   | (string, string)  |
| `ListRecycleBin(repoRoot)`          | 列出回收站             | string   | []ModelEntry      |
| `RestoreFromRecycle(src, repoRoot)` | 恢复                   | string×2 | error             |
| `DeleteFromRecycle(src)`            | 永久删除               | string   | error             |
| `EmptyRecycleBin(repoRoot)`         | 清空回收站             | string   | (int, error)      |
| `ClearCustomDir(customDir)`         | 清空整合包（安全删除） | string   | (int, error)      |
| `DeduplicateCustomDir(customDir)`   | 整合包去重（按 hash）  | string   | (int, int, error) |

### 状态同步

| 函数                                                 | 用途              | 参数     | 返回值            |
| ---------------------------------------------------- | ----------------- | -------- | ----------------- |
| `GetInstanceStatus(mcRoot, repoDir)`                 | 各整合包同步状态  | string×2 | []InstanceStatus  |
| `SyncModelToggleStatus(instanceCustomDir, repoRoot)` | 同步启用/禁用状态 | string×2 | (int, int, error) |

### 其他

| 函数                         | 用途           | 参数                        | 返回值      |
| ---------------------------- | -------------- | --------------------------- | ----------- |
| `HasYSMMod(modsDir)`         | 检测 YSM 模组  | string                      | bool        |
| `SetLinkMode(mode)`          | 设置链接模式   | "copy"/"hardlink"/"symlink" | error       |
| `GetLinkMode()`              | 获取链接模式   | -                           | string      |
| `GetImportLogs()`            | 获取操作日志   | -                           | []ImportLog |
| `ClearImportLogs()`          | 清空日志       | -                           | void        |
| `CreateDir(dir)`             | 仓库内建文件夹 | string                      | error       |
| `MoveModelFile(src, dstDir)` | 仓库内移动文件 | string×2                    | error       |

---

## Go 工具包 (go/)

| 包        | 路径            | 关键导出                                                                                               |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| installer | `go/installer/` | `Install`, `InstallToGlobal`, `InstallWithOverlay`, `IsValidRepoRoot`, `CopyFile`                      |
| logs      | `go/logs/`      | Logger (Add, GetAll, Clear)                                                                            |
| recycle   | `go/recycle/`   | `Move`, `MoveEx`, `List`, `Restore`, `Delete`, `Empty`                                                 |
| sync      | `go/sync/`      | `GetInstanceStatus`, `SyncToggleStatus`                                                                |
| types     | `go/types/`     | `AppConfig`, `ModelEntry`, `VersionInstance`, `InstanceStatus`, `ImportLog`, `AppError`, `WindowState` |
| ysm       | `go/ysm/`       | `HasYSMMod`                                                                                            |

---

## bus 事件总线

| 事件名                   | 方向                   | 载荷                               | 说明                                  |
| ------------------------ | ---------------------- | ---------------------------------- | ------------------------------------- |
| `nav:change`             | → app-content          | `{ page }`                         | 切换主页面                            |
| `nav:changed`            | app-content →          | `{ page }`                         | 页面已切换                            |
| `toast:show`             | → app-toast            | `{ msg, undo?, duration?, type? }` | 显示通知                              |
| `entry:toggle`           | app-tree →             | `{ path }`                         | 启用/禁用（自动同步整合包）           |
| `ctx:show`               | app-tree →             | `{ x, y, path, name, banned }`     | 显示右键菜单                          |
| `dir:select-repo`        | 各组件 →               | -                                  | 选择仓库目录                          |
| `dir:select-mc`          | 各组件 →               | -                                  | 选择游戏目录                          |
| `stats:refresh`          | → 全部                 | -                                  | 刷新所有统计                          |
| `stats:upload`           | app-preview →          | -                                  | 上传待上传                            |
| `menu:show`              | → context-menu         | `{ x, y, items }`                  | 显示右键菜单                          |
| `config:updated`         | settings →             | -                                  | 配置变更                              |
| `tree:reload`            | app-content → app-tree | -                                  | 刷新仓库树                            |
| `logs:refresh`           | → app-content          | -                                  | 刷新操作日志                          |
| `package:selected`       | app-sidebar →          | `{ pkg }`                          | 选中整合包                            |
| `model:select`           | app-tree →             | `{ path }`                         | 选中模型文件                          |
| `sync:download-missing`  | app-preview/sidebar →  | -                                  | 导入缺失模型（app-content 常驻监听）  |
| `sync:download-complete` | app-content →          | -                                  | 导入完成                              |
| `sync:toggle-status`     | app-preview/sidebar →  | -                                  | 同步启用/禁用（app-content 常驻监听） |
| `sync:toggle-complete`   | app-content →          | -                                  | 同步完成                              |
| `sync:upload-complete`   | app-content →          | -                                  | 上传完成                              |
| `instance:export-list`   | → app-content          | `{ name }`                         | 导出文件清单到剪贴板                  |
| `instance:clear`         | → app-content          | `{ name }`                         | 清空整合包（有确认窗）                |

---

## Legacy 旧版代码 (frontend/js/)

以下文件按旧架构编写（全局变量 + 直操作 DOM），未来逐步迁移：

| 文件                            | 行数 | 涉及功能                                      |
| ------------------------------- | ---- | --------------------------------------------- |
| `lib/parse.js`                  | -    | esc/fmt/parseModelName/isBannedEntry/safeCall |
| `lib/state.js`                  | -    | 全局变量 + DOM 引用 + localStorage            |
| `lib/tree.js`                   | -    | buildTree 仓库树渲染（含复选框）              |
| `core/theme.js`                 | -    | 主题切换                                      |
| `core/directories.js`           | -    | 目录选择 + saveConfig                         |
| `core/lifecycle.js`             | -    | loadAll / autoDetect                          |
| `core/buttons.js`               | -    | 按钮事件绑定                                  |
| `core/sync.js`                  | -    | doSyncAll / doSyncMissing / doDeduplicate     |
| `ui/cm-*.js` + `contextmenu.js` | -    | 右键菜单                                      |
| `ui/drop.js`                    | -    | 拖拽导入                                      |
| `ui/toggle.js`                  | -    | 侧栏/预览折叠                                 |
| `dialogs/*.js`                  | -    | 确认/日志/回收站/设置/统计 弹窗               |
| `versions/data.js`              | -    | filterInstances / calcVersionCounts           |
| `versions/stats.js`             | -    | updateVersionStats                            |
| `versions/renderer.js`          | -    | renderVersionCard                             |
| `versions/events.js`            | -    | bindVersionEvents                             |
| `versions/ops.js`               | -    | handleInstall / handleSyncBack                |
| `versions/versions.js`          | -    | renderVersions / refreshAll                   |
