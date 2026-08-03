# OpenCode 治理型 AI — 项目风格手册

> 适用于 YSM Model Manager 项目。记录本 AI 的工作模式、约定和已知陷阱，供后续 AI 参考。

---

## 一、工作流

### 1.1 先读文档，再改代码

每次会话开始时读取（按顺序）：
1. `.github/copilot-instructions.md` — 致命陷阱
2. `docs/architecture.md` — 项目架构
3. `docs/TERMINOLOGY.md` — 术语统一
4. `docs/CLEANUP_RULES.md` — 治理规则
5. `docs/TASK_PLAN.md` — 当前任务计划
6. `docs/SESSION_HANDOFF.md` — 上一 AI 的发现
7. `docs/pending-cleanup.md` — 待清除清单
8. `docs/release-notes/README.md` — 最新版本索引
9. `docs/release-notes/v{latest}.md` — 最近做了什么

### 1.2 改前读文件

每次修改文件前必须用 `Read` 工具确认最新内容。禁止基于记忆修改。

### 1.3 改完立即构建

```powershell
# Go 改了
go build ./go/... 2>&1 | Select-String error

# 前端改了
cd frontend ; npx vite build 2>&1 | Select-String error
```

不攒多个修改。一个改一个 build。

### 1.4 回滚规则

如果 `multi_replace_string_in_file` 后构建失败，检查 import 语句是否完整、JSON/JS 语法是否正确，修复后继续。不要盲目撤销。

---

## 二、技术栈与约定

### 前端
- **框架**: Wails v2 + Web Components + Shadow DOM
- **构建**: Vite（`frontend/` 下 `npx vite build`）
- **组件架构**: `index.js`(编排) + `data.js` + `render.js` + `events.js` + `tpl.js`
- **样式**: CSS 变量 + `color-mix()` + `adoptedStyleSheets`
- **主题**: 4 套（cyber / warm / pro / default-dark），通过 CSS 变量切换
- **状态管理**: 模块级 `let` + getter/setter + `bus.js` 事件广播
- **无框架**: 无 React/Vue/Svelte
- **动态 import**: 统一走 `wails/app.js` → `getApp()`
- **动画**: 全部支持 `.no-animations` 无障碍关闭

### 后端 (Go)
- **Wails v2 绑定**: `resource_bindings.go` 中定义
- **配置**: `types.AppConfig` struct，`app_config.go` 中持久化
- **注册表**: `resource_types.json` 驱动，通过 `go/types.LoadRegistry()` 加载
- **缓存**: `scanCache` (sync.Map, 30s TTL)，`ClearScanCache()` 清除
- **文件监听**: `go/watcher/` 基于 fsnotify，800ms 防抖
- **扫描**: `ScanModelEntries()` → `computeFileHash()` (SHA256)
- **导入策略**: `go/importer/` 注册表模式，Handler 接口
- **安装**: `go/installer/` 支持 copy/hardlink/symlink

### 测试
- Go 测试: `go test ./go/...`（11 个包有测试）
- 前端测试: 暂无

---

## 三、三条治理红线

### 3.1 零 `window.__*` 全局变量

| ❌ 禁止 | ✅ 替代 |
|---------|--------|
| `window.__currentPage` | `PageStore.currentPage` (`core/page-store.js`) |
| `window.__YSMPendingLock` | `DnDLock` (`features/dnd-state.js`) |
| `window.__ysmPendingImport` | `PendingImport` (`features/dnd-state.js`) |
| `window.__ysmStorageSync` | 模块私有 `let _storageSyncFn` |
| `window.go.main.App.*` | `getApp()` (`wails/app.js`) |

### 3.2 Wails 调用统一走 `getApp()`

```js
// ✅ 正确
import { getApp } from "../wails/app.js";
const App = await getApp();
const result = await App.SomeBinding();

// ❌ 禁止
const { SomeBinding } = window.go.main.App;
const { SomeBinding } = await import("../../wailsjs/go/main/App.js");
```

### 3.3 UI 安全

- 所有 `innerHTML` 拼接必须使用 `esc()` 转义
- 所有 CSS 值走 CSS 变量 (`var(--txt)`, `var(--bg)`)，无硬编码颜色
- 禁止 `display: none/block` 做动画切换，使用 `opacity`/`transform`
- 所有异常路径必须有 toast 反馈

---

## 四、注册表优先

所有资源类型定义现在以 `resource_types.json` 为单一事实来源：

```json
{ "id": "create-blueprint", "extensions": [".nbt", ".schematic", ".litematic"],
  "storageSubDir": "schematics", "configField": "SchematicRoot" }
```

Go 端查询:
```go
types.StorageSubDir("create-blueprint")   // "schematics" — from registry
types.RegistryType("create-blueprint")    // *ResourceType — full object
```

前端查询:
```js
import { loadResourceRegistry } from "../utils/resource-registry.js";
const reg = await loadResourceRegistry();
reg["create-blueprint"].icon              // "⚙️"
reg["create-blueprint"].storageSubDir     // "schematics"
```

**不要直接在 Go/Frontend 中手写 `StorageSubDir` / `specificRoot` / `ResourceExts` 的新条目**。先在 `resource_types.json` 加，一致性测试会自动校验。

---

## 五、已知陷阱

| 陷阱 | 表现 | 原因 | 修复 |
|------|------|------|------|
| 蓝图卡片显示 `tag 0` | 同步统计为 0 | `app_scan.go:372` 没对 `.nbt/.schematic/.litematic` 算 hash | 加入 `computeFileHash` |
| 模型预览统计重复 | 骨骼/立方体/纹理显示两次 | `tpl.js statsCardHTML` + `preview-skeleton.js` 常驻面板数据一致 | 删除常驻面板 |
| watcher 不触发更新 | 文件改了等 30s 才刷新 | watcher 不清 scan cache | `ClearScanCache()` 在 `syncAll()` 中调用 |
| Node.js 路径硬编码 | 用户机器上找不到 Node | `wasm_decoder.go` 的硬编码用户路径 | 修复中 |
| `specificRoot` 不识别新类型 | 新类型不能设专属根目录 | 旧 switch 语句未更新 | 已改注册表驱动 ✅ |
| Go 测试 `init()` 路径问题 | `LoadRegistry()` 找不到 JSON | `go test` 工作目录是包目录 | 用 `SetRegistryPath()` 设置 |
| 前端 import 缓存 | 改了 `extensions.js` 但拖拽还走旧数据 | ES module 缓存 + 拖拽必须同步 | 注释说明，不可改成异步 |

---

## 六、会话交接

每次会话结束更新 `docs/SESSION_HANDOFF.md`，包含：
- 本会话完成的工作
- 发现的问题/陷阱
- 推荐下一步
- 块状问题

---

## 七、沟通风格

- 简洁：能用 1 句话不说 2 句
- 精确：给行号、文件路径、函数名
- 结构化：表格 > 段落
- 不废话：不做无谓的「总的来说」「总结一下」
- 不夸自己：改完说「done」即可
- 不改不拆：发现不够改的问题先问「要修吗」
