---
kind: go-testutil
name: 测试辅助函数 go/internal/testutil
tier: leaf
category: go
source_files:
  - go/internal/testutil/testutil.go
tests:
  - go/internal/testutil/testutil_test.go
use_when:
  - 跨包复用测试 helper
  - 创建测试文件
  - 构造内存 ZIP
invariant_anchors:
  - go/internal/testutil/testutil.go|CreateTestFile
  - go/internal/testutil/testutil.go|MakeZipBytes
status: active
---

# 测试辅助函数 go/internal/testutil

## 概览

`go/internal/testutil/` 包提供跨包复用的 Go 单元测试辅助函数，解决原先各包各自实现同名 helper 导致的重复维护问题。

## 核心职责

- 统一 `CreateTestFile`（原先 dedup/fsutil/recycle 三处各自实现）
- 统一内存 ZIP 构造（原先 geometry/packs/ysm 五个包各自实现的 `makeZipBytes`/`writeZip` 变体）
- 提供写临时目录 ZIP 文件的快捷函数

## 对外 API / 入口

- `CreateTestFile(t, dir, name, content string) string` — 在 `dir` 下创建 `name` 文件（自动建父目录），返回完整路径
- `MakeZipBytes(t, entries map[string]string) []byte` — 构造内存 ZIP（条目名→内容），返回字节
- `WriteZipFile(t, name string, entries map[string]string) string` — 构造 ZIP 并写入 `t.TempDir()/name`，返回文件路径

## 与其他子系统关系

- **消费方**：`go/dedup`、`go/fsutil`、`go/recycle`（测试文件创建）；`go/geometry`、`go/packs`、`go/ysm`（ZIP 构造）
- 无生产代码依赖，仅供 `*_test.go` 使用

## 不变量

- 所有函数均调用 `t.Helper()`，确保错误栈定位到调用方测试代码
- `CreateTestFile` 使用 `t.Fatal` 而非返回错误（测试上下文惯例）
- `WriteZipFile` 的临时目录由 `t.TempDir()` 管理，测试结束自动清理

## 相关

- `go/dedup/`、`go/fsutil/`、`go/recycle/`（测试文件）
- `go/geometry/`、`go/packs/`、`go/ysm/`（ZIP 构造）
