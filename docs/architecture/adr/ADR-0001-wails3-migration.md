# ADR-0001：升级至 Wails 3

- **状态**：已采纳（Accepted）
- **日期**：2026-07-14
- **决策人**：Jieling（人类首席架构师）、Riku（联邦首席架构师 AI）
- **相关**：wails.json / go.mod / main.go / app*.go / frontend/js

---

## 1. 背景（Context）

项目当前基于 **Wails v2.12.0**（`github.com/wailsapp/wails/v2`），采用单体
`wails.Run(&options.App{})` 入口、`Bind: []any{app}` 显式绑定、`pkg/runtime`
全局函数驱动窗口/事件/对话框。

在 MikuMikuAR 联邦生态中，Wails 3 已被验证足够稳定（相邻城邦已发布安卓版、
累计 100+ ADR）。本项目需要将桌面端底座从 v2 迁移至 v3，以对齐联邦技术栈、
获得原生多窗口/菜单/系统托盘能力，并消除 v2 runtime 包在并发与类型安全上的历史负担。

目标版本：**`github.com/wailsapp/wails/v3 v3.0.0-alpha2.105`**（对齐本机已装 `wails3` CLI）。

---

## 2. 决策（Decision）

将项目从 Wails v2 升级到 Wails v3（alpha2 系列），遵循 v3 架构范式：

| 维度 | v2 做法 | v3 做法 |
|------|---------|---------|
| 应用入口 | `wails.Run(&options.App{})` | `application.New(application.Options{...})` + `app.Run()` |
| 绑定 | `Bind: []any{app}` 显式列表 | `Services: []application.Service{ application.NewService(app) }` 自动发现 |
| 资源 | `assetserver.Options{Assets}` | `Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets)}` |
| 上下文 | 结构体存 `context.Context` | 结构体存 `*application.App` 引用（`SetApp`） |
| 窗口 | `runtime.WindowSetSize(ctx,...)` | `app.Window.Current().SetSize(...)` |
| 事件 | `runtime.EventsEmit(ctx, name, a, b, c)` | `app.Event.Emit(name, []any{a,b,c})`（单 payload） |
| 对话框 | `runtime.OpenFileDialog(ctx, opts)` | `app.Dialog.OpenFile().SetTitle(...).AddFilter(...).PromptForSingleSelection()` |
| 浏览器 | `runtime.BrowserOpenURL(ctx, url)` | `app.Browser.OpenURL(url)` |
| 退出 | `runtime.Quit(ctx)` | `app.Quit()` |
| 前端 runtime | `window.runtime.*` + 生成 `wailsjs/` | npm `@wailsio/runtime`（`Events.On`/`Window.*` 等） |
| 前端绑定 | `wailsjs/go/main/App.js` | `wails3 generate bindings` → `frontend/bindings/...` |
| 构建 CLI | `wails build` | `wails3 build`（构建前先 `wails3 generate bindings`） |

---

## 3. 关键约束与风险

- **🔴 alpha 状态**：v3 仍无稳定版（alpha2.105）。已确认联邦内成熟使用，风险可接受。
- **🔴 契约测试冲突**：`tests/python/test_config_syntax.py` 校验 `wails.json` 的
  `bind` 数组与平铺 `frontend:*` 键；v3 已弃用 `bind` 且 wails.json 改嵌套结构。
  **经议会决议：迁移期暂缓该契约测试**（wails.json 改 v3 结构，测试由 Jieling 另行处理），
  不触碰 AGENTS.md「禁止修改测试文件」红线。
- **🟡 事件多参断点**：v3 `Event.Emit` 仅单 payload。原 `EventsEmit(ctx, name, a, b, c)`
  的多个实参在 JS 端由多形参变为 `event.data` 单对象。5 个事件
  （`config-loaded` / `queue:status` / `queue:file-start` / `queue:file-done` /
  `download:progress`）的 Go 发送与 JS 监听需协同改写为「数组打包 + 解构」。
- **🟡 验证盲区**：CI/沙箱无桌面与 WebView2，无法真机启动 GUI。验证限于
  `go build ./...`、`go build -tags cli .`、`wails3 generate bindings`、`vite build`。

---

## 4. 后果（Consequences）

- 正面：对齐联邦 Wails 3 技术栈；获得原生多窗口/菜单/托盘；更清晰的 service 架构。
- 负面：引入 alpha 依赖；事件 payload 形态变更需前后端协同维护；
  `wails.json` 结构变更使既有契约测试在迁移窗口期内失效（已暂缓）。

---

## 5. 回滚方案（Rollback）

- 保留 v2 于 `main` 分支；本次迁移在独立工作区落地，验证通过后合入。
- 若 alpha 出现阻塞性回归：Revert 全部改动回到 v2.12.0，`go.mod` 回退 `wails/v2`，
  前端恢复 `wailsjs/` 引用与 `window.runtime.*`，`wails.json` 恢复 v2 平铺结构。

---

## 6. 受影响文件清单

- Go：`go.mod`、`main.go`、`app.go`、`app_config.go`、`app_download.go`、`resource_bindings.go`
- 前端：`frontend/package.json`、`frontend/js/wails/app.js`、~50 处绑定导入、
  5 处 `window.runtime.*` 事件监听、`frontend/index.html`（如需移除 v2 runtime 注入）
- 构建：`wails.json`、`build-release.ps1`
- 暂缓：`tests/python/test_config_syntax.py`（不在本次范围）
