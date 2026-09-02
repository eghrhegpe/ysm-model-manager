---
kind: go_conc
name: 通用泛型并发工具 go/conc
tier: leaf
category: go
source_files:
  - go/conc/pool.go
use_when:
  - 并发
  - 并行
  - worker 池
  - 批量并发
  - 输入序收集
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - 并发工具、Parallel 泛型并行
  - worker 池、批量并发
  - 输入序收集
invariant_anchors:
  - go/conc/pool.go|Parallel
tests:
  - go/conc/pool_test.go
status: active
---

# 通用泛型并发工具 go/conc

## 概览

`go/conc` 提供唯一泛型并行入口 `Parallel[T,R]`，收敛 `internal/app` 三处手写 worker 池（`app_scan.go:runConcurrentAnalyze` / `app_model.go:readFileBytesBatchConcurrent` / `readFileBytesBatchWithMeta`）。

**现状（2026-08）**：包已提取、测试已写（8 个用例全绿），但**尚未接线**——`conc.Parallel` 目前零调用方，`internal/app` 三处仍使用各自的 `runConcurrentAnalyze` / `readFileBytesBatchConcurrent` 手写实现。ADR-119 语义（串行收集 + 并行 SHA256 + 序号还原）已在 `go/dedup` 落地，`go/conc` 是同一确定性契约在通用层的抽象。

## 核心职责

- 对任意 `[]T` 做泛型并行映射，结果**按输入序收集**（确定性契约，不依赖 goroutine 完成序）
- worker 数 = `max(NumCPU, 2)`，不超过输入长度（空输入返回 nil）
- 支持 `ok=false` 跳过项（结果中不出现该位置）

## 对外 API

```go
func Parallel[T, R any](items []T, fn func(i int, item T) (R, bool)) []R
```

- `fn(i, item) → (R, bool)`：`bool=false` 表示跳过
- 返回 `[]R`，仅含 `ok=true` 的项，**保持输入序**
- 不提供 `context.Context` 取消（当前无取消语义需求，将来可扩展变体）

## 与其他子系统关系

- **上游**：无（纯工具包，无外部依赖）
- **下游**：预期收敛 `internal/app/app_scan.go` 的 `runConcurrentAnalyze`（搜索分析并发）、`internal/app/app_model.go` 的 `readFileBytesBatchConcurrent` / `ReadFileBytesBatchWithMeta`（批量读取文件字节）
- **同类**：`go/dedup` 的并行哈希管道（ADR-119）是同一确定性契约在 dedup 场景的落地

## 不变量

1. **结果顺序 = 输入顺序**——内部按 index 写入预留切片，不依赖 resultCh 到达序（ADR-119 确定性契约）
2. **worker 数 ≤ min(NumCPU, len(items))**——防止 n=1 时启动多余 goroutine
3. **空输入返回 nil**——与 `make([]R, 0)` 的 `AllSkipped` 测试区分
4. **每个元素恰好处理一次**——taskCh 每个 index 只发送一次

## 相关

- ADR-119：dedup 并行化（通用层抽象的契约来源）
- `go/dedup`：dedup 并行哈希管道
- `internal/app/app_scan.go:runConcurrentAnalyze`：当前未收敛的调用方之一
- `internal/app/app_model.go:readFileBytesBatchConcurrent`：当前未收敛的调用方之二
