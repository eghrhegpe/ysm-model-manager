---
kind: go-testutil
name: 测试辅助函数 go/internal/testutil
tier: leaf
category: go
source_files:
  - go/internal/testutil/testutil.go
  - go/internal/testutil/testutil_windows.go
  - go/internal/testutil/assert.go
  - go/internal/testutil/determinism.go
auto_fields:
  symbols_with_lines:
    - BytesZip
    - CleanAbsPath
    - CreateTestFile
    - ErrorContains
    - ErrorIs
    - FileExists
    - FileNotExists
    - InjectRootRegistry
    - LockDirExclusive
    - MakeZipBytes
    - Nil
    - NoError
    - NotNil
    - WaitForCall
    - WaitForCallNoSleep
    - WithFixedClock
    - WriteFile
    - WriteTestFile
    - WriteTestFileBytes
    - WriteZip
    - WriteZipFile
  tests:
    - go/internal/testutil/testutil_test.go
use_when:
  - 跨包复用测试 helper
  - 创建测试文件
  - 构造内存 ZIP
  - go/internal/testutil 包在哪
quick_groups:
  - 测试与验证
quick_intents:
  - 测试辅助函数、go/internal/testutil 包在哪
  - 创建测试文件、构造内存 ZIP、跨包复用测试 helper
  - 测试窗口、固定时钟、确定性等待 helper
quick_risk_lines:
  - 测试 helper 必须走 go/internal/testutil 跨包复用，禁止各包各自实现同名 helper
pitfalls:
  - 各包自行实现同名测试 helper → 重复维护、行为漂移；一律复用本包
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

## 已知债（ADR-202 刀5 裸断言增量）

- **2026-10-11 修复批次审计登记（未收口）**：`check-go-diff-coverage` 的「测试断言增量红线」（新增/变更 `*_test.go` 行禁裸 `t.Fatal`/`t.Fatalf`，须走 testutil 断言）是**增量闸**——只扫 diff 窗口。2026-10-10/11 批次中 6 个测试文件 ~24 处裸 t.Fatal 已随推送窗口 grandparent 化，闸不再复扫；`45a6a8177` 只收了同族 1/6（tags_relocate_test）。（清单以 `node scripts/check-go-diff-coverage.ts --base 47f9ccd83` 实测为准，2026-10-11 审计记录：10 文件红、6 属该批次——tags_commit_order / fileops_target_plan / app_files_tags_migrate / app_config_preserve / app_prune_disabled / app_files_toggle。）收口 = 一次性改走 testutil 断言（参照 `45a6a8177` 先例），改完以债前 commit 为 base 重跑该闸转绿。

## 相关

- `go/dedup/`、`go/fsutil/`、`go/recycle/`（测试文件）
- `go/geometry/`、`go/packs/`、`go/ysm/`（ZIP 构造）
