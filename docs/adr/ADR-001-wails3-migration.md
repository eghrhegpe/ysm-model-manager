# ADR-001：升级至 Wails 3

- **状态**：已采纳（Accepted）
- **日期**：2026-07-14
- **决策人**：Jieling（人类首席架构师）、Riku（联邦首席架构师 AI）
- **相关**：wails.json / go.mod / main.go / app*.go / frontend/src

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
- 前端：`frontend/package.json`、`frontend/src/wails/app.js`、~50 处绑定导入、
  5 处 `window.runtime.*` 事件监听、`frontend/index.html`（如需移除 v2 runtime 注入）
- 构建：`wails.json`、`build-release.ps1`
- 暂缓：`tests/python/test_config_syntax.py`（不在本次范围）

---

## 7. Wails 3 开发期（dev）运行教训

迁移落地后，`wails3 dev` 暴露一组运行期陷阱，记录以避免重蹈。

| # | 现象 | 根因 | 处置 |
|---|------|------|------|
| 1 | `open ./build/config.yml: The system cannot find the file specified` | v3 dev 读 `./build/config.yml` 的 `dev_mode.executes` 驱动刷新引擎，缺文件即报错 | 新建 `build/config.yml`，dev_mode 经 `cmd /C` 执行 `executes` |
| 2 | `panic: nil pointer dereference` @ `app.go` `Window.Current()` | 启动期 `ServiceStartup` 时窗口尚未 `Current()`（返回 nil） | `App` 直接持有 `mainWindow *application.WebviewWindow` 字段，`main.go` 建窗后 `SetMainWindow(wnd)`，6 处 `Window.Current()` 改为 `mainWindow` + nil 守卫 |
| 3 | `ExternalAssetHandler Proxy error: dial tcp4 127.0.0.1:9245: connectex: No connection could be made` | dev asset 代理走 `tcp4 127.0.0.1:9245`，而 vite 默认绑 IPv6（::1）导致代理连不上 | vite 启动加 `--host 127.0.0.1`，强制 IPv4 |
| 4 | `'bin' 不是内部或外部命令` | 早期 `executes` 用 `cmd /C` 且路径含 `/` 被当成开关 | 对齐联邦标准，改用 **Taskfile 编排**（`wails3 task windows:build:dev` 等），消除 `cmd /C` 路径 hack |
| 5 | 用户配置 `ysm_config.json` 落在仓库根且含本机路径 | 配置默认存 cwd，违反「随附数据不进仓库」 | `configPath()` 改 `os.UserConfigDir()/YSM-Model-Manager/ysm_config.json`，新增 `migrateLegacyConfig()` 迁移旧位置；`.gitignore` 加 `/ysm_config.json` |
| 6 | 四个随附 JSON 想移出根目录但契约测试报错 `MISSING` | `tests/python/*.py` 硬编码 `ROOT / "*.json"`，**禁止移动/改名** | 改用 embed 基线：`exe同级 → exe上级(bin/..=仓库根) → embed`，永不依赖 cwd；文件留在根、内容不改，契约测试全过 |

**要点**：dev 期窗口引用必须显式持有、vite 必须锁 IPv4、构建编排统一走 Taskfile、`//go:embed`
基线优先于「移动文件」——后者会撞契约测试红线。

---

## 8. 根目录分类下沉 internal/app

### 8.1 动机
根目录 `package main` 文件膨胀至 17 个（12 个 `app_*.go` + `main.go`/`proxy.go`/
`resource_bindings.go`/`wasm_decoder.go`/`wasm_embed.go`），对标相邻城邦 MikuMikuAR 的
「根仅留薄入口、逻辑下沉 `internal/app`」分类。

### 8.2 两条硬约束
1. **`package main` 不可跨目录拆分** → 17 个文件整包下沉 `internal/app/`，改为
   `package app`（库包）；`main.go` 留根作 `!cli` 薄入口，`cli_export.go` 留根作 `cli` 薄壳
   （实现抽为 `internal/app.CLIMain()`）。
2. **`//go:embed` 禁止上溯（`..`）** → 仓库根的 `frontend/dist`、四个资源 JSON、`YSMParser.wasm/js`
   无法在子目录 embed。在**根目录**新建 `embed.go`（`package main`，无 build tag）持有全部 embed，
   `init()` 调 `app.SetEmbedded(...)` 注入 `internal/app`；两构建标签通用，无需分支。

### 8.3 连带改动
- **前端绑定路径同步**：Wails v3 按 Go 包目录镜像生成绑定，service 进 `internal/app` 后落点变为
  `frontend/bindings/ysm-model-manager/internal/app/app.js`。全局替换 **35 个前端文件**的导入
  （`app.js → internal/app/app.js`），全仓无旧路径残留。
- **`build-release.ps1` 归位 `cmd/`**：`$ProjectRoot` 改为 `git rev-parse --show-toplevel`，
  主包仍在根（`go build .` 路径不变）。
- **`go/types/resource.go`**：registry 加载改读注入的 embed 字节（`loadRegistryBytes()`），
  保留 `SetRegistryPath` 钩子兼容 exe 同级/上级回退。

### 8.4 落点对照（原 §6 清单已迁移）
| 原根路径 | 新位置 |
|----------|--------|
| `app.go` `app_*.go` `proxy.go` `resource_bindings.go` `wasm_decoder.go` | `internal/app/` |
| `cli_export.go` | 根（薄壳）→ 实现 `internal/app/cli.go` 的 `CLIMain()` |
| `bundled_data.go` `wasm_embed.go` | 删除，逻辑并入根 `embed.go` + `internal/app/{assets,bundled_data}.go` |
| `main.go` | 根（保留 `//go:embed all:frontend/dist`） |
| `build-release.ps1` | `cmd/build-release.ps1` |

> 注：§6「受影响文件清单」中的 `app.go`/`app_config.go` 等现已位于 `internal/app/`，
> 以本节落点对照为准。

---

## 9. 已知限制（2026-08-05 补充，迁移后实测）

v3 迁移落地后实测踩坑汇总，供后续会话/维护者规避。

| # | 限制 | 说明 | 防线 / 现状 |
|---|------|------|-------------|
| 1 | **CLI 必须写 `wails3`** | v2/v3 并存时 PATH 同时有 `wails`（v2）与 `wails3`（v3）；写裸 `wails` 命中 v2 CLI，bindings 生成路径/格式完全不同。AI/文档从旧资料抄命令极易踩中（相邻城邦知识卡曾漂移为 `wails generate bindings`） | `scripts/check-wails3-cli.mjs` 扫描活跃文档/脚本，命中裸 `wails (generate\|build\|dev\|bindings\|doctor)` 即红（退出码 1）；口令 `wails3-cli-check` |
| 2 | **bindings 必须带 `-ts`** | 无 `-ts` 生成 `.js`，带 `-ts` 生成 `.ts`；前端以 `.js` 后缀 import、由 vite `wailsBindingsResolve` 重定向到 `.ts`，故 `.ts` 是硬依赖。2026-08-05 发布脚本漏 `-ts`，曾致 17 个跟踪 `.ts` 被 `-clean` 清掉、换为 `.js`（回归，已修复） | **统一入口** `npm run generate:bindings`（`frontend/package.json`，内部 `cd .. && wails3 generate bindings -clean=true -ts -i`）；ps1/sh/Taskfile 全部对齐该入口 |
| 3 | **生成路径相对 CWD** | `-d` 默认 `frontend/bindings` 是相对当前目录的，且 wails3 扫描 Go 包要求 CWD 在模块根。错误目录下执行会错位生成（历史遗留 `frontend/frontend/wailsjs/runtime/` 错误产物，v1.6.5 误提交入仓，2026-08-05 清理） | npm 脚本内部 `cd ..` 强制仓库根执行；`check-wails3-cli.mjs` 不覆盖此场景，靠单入口约束 |
| 4 | **alpha 系列行为可漂移** | 当前 CLI 为 `v3.0.0-alpha2.117`（较 §1 目标 alpha2.105 已更新）；bindings 输出格式（`.ts`/`.js` 默认、目录结构）随 alpha 迭代可能变化 | 升级/降级 `wails3` CLI 后必须重跑 `npm run generate:bindings`，确认产物为 `.ts` 且 `git status frontend/bindings` 无意外 diff |
| 5 | **v2 生成物残留** | `frontend/wailsjs/`（v2 产物）与 v3 的 `frontend/bindings/` 并存；`scripts/binding-check.mjs` 仍读 v2 路径 `frontend/wailsjs/go/main/App.js` | 遗留项：binding-check 需迁移至 v3 路径（`frontend/bindings/`）后校验 Go 签名一致性 |
