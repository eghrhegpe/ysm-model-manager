---
kind: go-dedup
name: 去重 go/dedup
tier: architecture
category: go
source_files:
  - go/dedup/
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 去重、重复检测、dedup
  - filepath.WalkDir 路径安全
  - IsRecycleDir 守卫
quick_risk_lines:
  - 去重必须走 go/dedup，禁止在业务代码里手写文件指纹比较
pitfalls:
  - 手写去重比较 → 与 go/dedup 判定不一致、漏检；必须经 go/dedup
  - filepath.WalkDir 跟符号链接 → 目录遍历循环；必须跳过 ModeSymlink 条目

use_when:
  - 去重
  - 重复检测
  - dedup
perf:
  - io-bound
invariant_anchors:
  - go/dedup/dedup.go|fsutil.IsRecycleDir
---

# 去重 go/dedup

## 概览

`go/dedup/` 包提供资源去重检测，避免重复导入相同资源。

**路径安全（BUG-1 已免疫）**：`filepath.WalkDir` 不跟随符号链接（Go 标准库语义，仅 root 自身例外）+ 显式跳过 `ModeSymlink` 条目 + 根为 符号链接时返回 `ErrSymlinkRoot`。Go 1.25.0 处于 GO-2026-4970 受影响范围，若未来考虑 `os.Root` 迁移需先升 go1.25.12+。

## 核心职责

- 基于文件哈希（**纯 SHA256 内容哈希，元数据 name/size/modtime 仅随 FileEntry 展示、不参与重复判定**——知识卡旧文「哈希/元数据检测」表述漂移已修正）检测重复
- 返回重复匹配信息

## 对外 API / 入口

- `FindDuplicateFiles` — 扫描目录，按文件哈希分组，返回重复文件组（`FileEntry`/`Group`）；符号链接跳过防环、空文件跳过、超大文件流式全量哈希（`io.Copy` 错误已检查）；**共享并行哈希管道（ADR-119：串行收集 + 并行 SHA256 + 序号还原）**，组顺序 = hash 首次出现于遍历的顺序、组内 Files 按 Path 排序，输出与串行实现逐字节一致（确定性契约，CLI `dedup clean` 依赖组内排序）；**size 预分组（零语义损失）**——唯一 size 的文件必不成组、跳过其哈希，把大文件长尾收窄到"同尺寸大文件"
- `CountDuplicates` — 统计重复文件总数（**消费同一并行管道，与 `FindDuplicateFiles` 同源，禁止双实现漂移**）

## 与其他子系统关系

- **实际消费方**：`internal/app/resource_bindings.go`（Wails 绑定，`FindDuplicateFiles`/`CountDuplicates`）；前端 `app-content/diagnostics/init.ts` 去重页
- **无 `go/importer` 引用**（导入前去重的旧表述为幽灵关系，知识卡已自纠）；**无 `go/ysm` 引用**（元数据比对同为幽灵关系）
- 去重只检测不删除；实际删除走 `go/recycle.DeduplicateEntries`（recycle_clean.go），已安装资源不受影响

## 不变量

- 重复检测不影响已安装资源
- **遍历中子树访问失败 log-and-skip，可能漏扫**（R21 审核 P3-1）：`collectFiles` 的 WalkDir 回调 err（权限拒绝/IO 失败）仅留日志、不向上报错——「无重复」结果可能漏掉整棵子树；与根 symlink 的 `ErrSymlinkRoot` 硬报错不对称（有意为之：日志留痕、诊断页可见，不阻断扫描）
- **`.recycle` 判定大小写不敏感**（P3 修复：`strings.EqualFold`，与 fsutil.isRecycleDir 对齐——原大小写敏感，Windows `.RECYCLE` 目录会漏排）
- **`computeHash` 是包级可注入变量（测试承重点，删改须同步测试）**：`dedup_parallel_test.go` 通过替换它验证「并行管道确定性」「size 预分组跳过哈希」。49afd979 重构时曾将其内联删除，测试包 `undefined: computeHash` 编译失败（go vet 兜住）。重构此文件时保留该注入点；若确需移除，必须同步改写两个测试
- **R27 修复链（2026-08-31）**：
  - `hashFilesParallel` worker panic 死锁（P3-1）：worker goroutine 加 `defer func() { if r := recover(); r != nil { log.Printf(...) } }()`。无缓冲 `jobs` channel 在 `jobs <- f` 处阻塞发送，worker panic 后 `wg` 永不 Done、`close(jobs)` 永不执行，主 goroutine 死锁。panic 的槽位 `results[idx]` 留零值（`ok=false`），调用方见 log-and-skip。
  - `hashFilesParallel` 读失败可见性不对称是有意取舍（P3-2 确认）：唯一 size 文件不进 job（有意跳过哈希），其读失败不可见、不记日志；同 size 文件读失败会 log-and-skip。唯一 size 文件本就不参与成组（无重复可能），跳过哈希省一次 I/O。代价是「唯一 size 但读失败」的文件静默归类为「唯一 size 跳过」。
  - `QuickHash` MD5 碰撞风险（P3-3）：MD5 非抗碰撞，对抗场景下可构造碰撞。去重结果直接驱动 `recycle.Move`（删除文件），MD5 碰撞虽概率极低但非零。QuickHash 组通过 size 预分组隐含二次 size 校验（同组必同 size），降低碰撞窗口。对抗环境下应改用 DeepHash（SHA256）。

## 相关

- `go/fsutil/`（`CleanEmptyDirs` 唯一实现——dedup 版已于 R21 审核删除，去重后空目录清理走 fsutil 版）
