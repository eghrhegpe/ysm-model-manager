# 逻辑下沉架构（Logic Sinking）

> 将业务逻辑从 Wails Binding 层（`app_*.go`）抽到纯 Go 包（`go/`），使代码可测试。
> 解决「AI 改逻辑 → 无法自动验证 → 开 app 手动测 → 反复返工」的问题。

---

## 问题

Wails Binding 文件（`app_*.go` + `resource_bindings.go`）共 **4609 行**，大量业务逻辑混在 `package main` 里，依赖 Wails runtime，`go test` 跑不了。

| 文件 | 行数 | 可提取逻辑 | 依赖 Wails runtime |
|------|------|-----------|-------------------|
| app_download.go | 318 | ~85%（HTTP 下载、进度计算） | ✅ 10 处 EventsEmit |
| app_avatar.go | 488 | ~95%（头像提取、缓存） | ❌ 0 处 |
| app_scan.go | 577 | ~70%（文件扫描、哈希） | ✅ 少量 |
| app_install.go | 1315 | ~80%（安装、链接、回收站） | ✅ 少量 |
| app_files.go | 337 | ~75%（文件 CRUD） | ✅ 少量 |
| resource_bindings.go | 414 | ~20%（配置保存、类型检测） | ❌ 0 处 |

**后果**：AI 改了逻辑后无法用 `go test` 验证，必须人肉开 WebView2 窗口测。一次误改 + 一次编译 + 一次开 app = 10 分钟。一天改 5 次 = 50 分钟浪费。

---

## 方案：薄壳 + 内核

```
app_download.go（薄壳 30 行）
  仅处理 Wails 事件发射 + 类型转换
  ↓ 调用
go/download/downloader.go（内核 200 行）
  纯 HTTP 下载、进度计算、文件保存
  ← go test 可测
```

### 提取条件

一个函数能否从 `app_*.go` 提取到 `go/` 包，看它是否满足：

1. **不 import `github.com/wailsapp/wails/v2/pkg/runtime`**
2. **不引用 `package main` 中的类型**（如 `App` struct）
3. **不依赖前端事件命名约定**（如 `queue:file-done` 字符串）

满足上述条件的函数可以整体搬出。不满足的按「接收 Callback」模式解耦。

---

## 提取模式

### 模式 A：纯搬（无 Runtime 依赖）

```go
// 内核（go/download/downloader.go）
package download
type Downloader struct { client *http.Client }
func (d *Downloader) Download(ctx, url) ([]byte, error)

// 薄壳（app_download.go）
func (a *App) StartDownload(url string) error {
    data, err := a.dl.Download(a.ctx, url)
    runtime.EventsEmit(a.ctx, "download:complete", len(data))
    return err
}
```

`go test` 直接测内核：

```go
func TestDownload(t *testing.T) {
    ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("test data"))
    }))
    d := download.NewDownloader()
    data, err := d.Download(context.Background(), ts.URL)
    assert.Equal(t, "test data", string(data))
}
```

### 模式 B：Callback 解耦（有 Runtime 依赖）

无法去掉的 `EventsEmit` 调用通过 Callback 参数解耦：

```go
// 内核接受 progress callback
func (d *Downloader) DownloadWithProgress(ctx, url string, onProgress func(downloaded, total int64)) ([]byte, error)

// 薄壳传入 Wails 事件
a.dl.DownloadWithProgress(ctx, url, func(downloaded, total int64) {
    runtime.EventsEmit(a.ctx, "download:progress", downloaded, total)
})
```

测试时传入 mock callback 即可验证进度是否按预期触发。

---

## 优先级

| 优先级 | 模块 | 当前行数 | 预估内核 | 预估壳 | 理由 |
|--------|------|---------|---------|-------|------|
| **P0** | 下载器（go/download/） | 318 | 200 | 30 | *完成 |
| **P1** | 头像提取（go/avatar/） | 488 | 400 | 20 | *完成 |
| **P1.5** | 哈希对比（go/sync/） | 96 | 70 | 25 | *完成 |
| **P2** | 扫描（go/scanner/） | 577 | 400 | 50 | 文件系统边界 |
| **P3** | 文件操作（go/fileops/） | 337 | 250 | 30 | 边界 bug 多 |

---

## 工作流变化

改前：
```
改 app_download.go → wails build → 开 app → 点点点 → 发现有 bug → 再改 → ...
```

改后：
```
改 go/download/downloader.go → go test ./go/download/... → 通过 → wails build → 开 app 确认
```

AI 工作流（对应 AGENTS.md 约束）：
```
1. 先读 go/download/ 现有代码
2. 改 go/download/downloader.go（纯逻辑层）
3. 跑 go test ./go/download/...
4. 失败 → 修 → 再跑
5. 通过 → 改 app_download.go（薄壳层）
6. go build ./go/... 确认编译
7. 告知用户开 app 最终确认
```

---

## 验收标准

1. `go build ./go/...` 通过
2. `go test ./go/download/...` 通过（mock HTTP server）
3. 前端下载功能在 WebView2 中正常（进度条、完成通知）
4. AI 改下载逻辑后只需跑 `go test`，不需要开 app
