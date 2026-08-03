# ADR-003：业务逻辑从 Binding 层下沉至纯 Go 包（Logic Sinking）

- **状态**：部分采纳（Partially Accepted，P0/P1/P1.5 已完成，P2/P3 进行中）
- **日期**：2026-08-03（初定），原方案记录于 2026-06-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/app_*.go` / `go/download/` / `go/avatar/` / `go/sync/` / AGENTS.md §2.2

---

## 1. 背景（Context）

Wails Binding 文件（`app_*.go` + `resource_bindings.go`）共 **4,609 行**，
大量业务逻辑混在 Wails runtime 依赖中，`go test` 跑不了。

| 文件 | 行数 | 可提取逻辑 | 依赖 Wails runtime |
|------|------|-----------|-------------------|
| `app_download.go` | 318 | ~85%（HTTP 下载、进度计算） | 10 处 EventsEmit |
| `app_avatar.go` | 488 | ~95%（头像提取、缓存） | 0 处 |
| `app_scan.go` | 577 | ~70%（文件扫描、哈希） | 少量 |
| `app_install.go` | 1,315 | ~80%（安装、链接、回收站） | 少量 |
| `app_files.go` | 337 | ~75%（文件 CRUD） | 少量 |
| `resource_bindings.go` | 414 | ~20%（配置保存、类型检测） | 0 处 |

**后果**：AI 改了逻辑后无法用 `go test` 验证，必须人肉开 WebView2 窗口测。
一次误改 + 一次编译 + 一次开 app = 10 分钟。一天改 5 次 = 50 分钟浪费。

---

## 2. 决策（Decision）

将业务逻辑从 Wails Binding 层（`internal/app/app_*.go`）抽到纯 Go 包（`go/`），
采用「**薄壳 + 内核**」分层模式：

```
internal/app/app_download.go（薄壳 ~30 行）
  仅处理 Wails 事件发射 + 类型转换
  ↓ 调用
go/download/downloader.go（内核 ~200 行）
  纯 HTTP 下载、进度计算、文件保存
  ← go test 可测
```

### 2.1 提取条件

一个函数能否从 `app_*.go` 提取到 `go/` 包，必须同时满足：

1. 不 import `github.com/wailsapp/wails/v2/pkg/runtime`
2. 不引用 `package app` 中的类型（如 `App` struct）
3. 不依赖前端事件命名约定（如 `queue:file-done` 字符串）

满足全部条件 → 整体搬出。不满足 → 按「接收 Callback」模式解耦。

### 2.2 提取模式

**模式 A：纯搬（无 Runtime 依赖）**

内核直接暴露纯 Go 接口，薄壳只负责 Wails 事件发射。

**模式 B：Callback 解耦（有 Runtime 依赖）**

无法去掉的 `EventsEmit` 通过 Callback 参数传递，薄壳注入 Wails 事件，
内核对 Runtime 零感知。测试时传入 mock callback 即可验证。

---

## 3. 优先级（Priority）

| 优先级 | 模块 | 当前行数 | 预估内核 | 预估壳 | 状态 | 理由 |
|--------|------|---------|---------|--------|------|------|
| **P0** | 下载器 `go/download/` | 318 | 200 | 30 | ✅ 完成 | 最易提取，Runtime 依赖少 |
| **P1** | 头像提取 `go/avatar/` | 488 | 400 | 20 | ✅ 完成 | 零 Runtime 依赖 |
| **P1.5** | 哈希对比 `go/sync/` | 96 | 70 | 25 | ✅ 完成 | 体量小，边界清晰 |
| **P2** | 扫描 `go/scanner/` | 577 | 400 | 50 | 🟡 进行中 | 文件系统边界 |
| **P3** | 文件操作 `go/fileops/` | 337 | 250 | 30 | 🔴 待处理 | 边界 bug 多 |

> 注：`app_install.go`（1,315 行）为最大债务，未在原始优先级表中列入。
> 建议补充为独立 P1 项，详见 ADR-002 §4。

---

## 4. 后果（Consequences）

### 正面
- `go test ./go/...` 可直接验证业务逻辑，无需启动 WebView2
- AI 工作流从"改 → 编译 → 开 app → 点 → 发现 bug"缩短为"改 → go test → 通过 → 编译"
- `go/` 包可独立测试、独立重构，解耦 Binding 层的变更影响

### 负面
- 薄壳层仍需维护 Wails 事件发射逻辑，前后端事件名变更需同步改
- P2/P3 模块涉及文件系统边界（权限、跨分区、硬链接），单元测试需 mock 文件系统
- `DownloadQueue ↔ App` 对象级循环引用尚未打破（P0 完成时遗留），影响 `DownloadQueue` 独立测试

---

## 5. 验收标准

1. `go build ./go/...` 通过
2. `go test ./go/...` 通过（mock HTTP server / mock callback）
3. 前端对应功能在 WebView2 中正常（进度条、完成通知等）
4. AI 改对应逻辑后只需跑 `go test`，不需要开 app

---

## 6. AI 工作流（对应 AGENTS.md §2.2）

```
1. 先读 go/xxx/ 现有代码
2. 改 go/xxx/core.go（纯逻辑层）
3. 跑 go test ./go/xxx/...
4. 失败 → 修 → 再跑
5. 通过 → 改 internal/app/app_*.go（薄壳层）
6. go build ./go/... 确认编译
7. 告知用户开 app 最终确认
```

---

## 7. 回滚方案（Rollback）

- 已完成的 P0/P1/P1.5：内核包留在 `go/`，薄壳层回退到 `internal/app/` 内联调用原逻辑即可。
- 由于内核包为纯 Go、不依赖 Wails，回滚不影响 Binding 层结构。
- 无数据迁移风险（下沉仅改代码组织，不动运行时行为）。

---

## 8. 数据溯源

| 来源 | 结果 |
|------|------|
| `internal/app/` 全量扫描 | 6 个 `app_*.go` + `resource_bindings.go` = 4,609 行 |
| P0/P1/P1.5 验证 | `go test ./go/download/... ./go/avatar/... ./go/sync/...` 均通过 |
| ADR-002 §3.1 | 记录 `app_install.go` 为最大遗留债务 |

---

*原文档：`docs/architecture/logic-sinking.md`，内容整篇迁入本文档。*
