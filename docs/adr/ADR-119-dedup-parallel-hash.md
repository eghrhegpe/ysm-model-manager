# ADR-119：dedup 并行化：共享并行哈希管道（串行收集+并行哈希+序号还原）

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/dedup/dedup.go; go/cli/dedup.go; internal/app/resource_bindings.go; go/repoaudit/repoaudit.go`

---

## 1. 背景（Context）

`go/dedup` 的去重核心 `walkHashedFiles`（dedup.go:39-47）是两函数共享的顺序遍历：对每个非空普通文件串行计算 SHA256。文件内容哈希是 CPU 密集 + 磁盘 I/O 混合负载，大仓库（数万文件）下成为明显的耗时瓶颈，且**全量哈希无并行、无大小上限**。

约束（不可破坏）：
- **确定性输出**：组顺序 = "hash 首次出现于遍历的顺序"（dedup.go:117、148），组内 Files 按 Path 排序（dedup.go:151）。CLI `dedup clean` 依赖组内排序取首个保留。并行化后输出必须与串行实现逐字节一致。
- **错误语义**：`ErrSymlinkRoot`（根是符号链接）sentinel、`d.Info()` 失败跳过、空文件/非普通文件跳过、`skipRecycle` 跳过 `.recycle`。
- **调用方零改动**：`FindDuplicateFiles` / `CountDuplicates` 签名不变，调用方 `go/cli/dedup.go`（×3）、`internal/app/resource_bindings.go`（×2）、`go/repoaudit/repoaudit.go`（×1）均免改。

## 2. 决策（Decision）

采用**共享私有并行管道**：串行收集 → 并行哈希 → 序号还原 → 串行分组。

```
WalkDir 串行收集（保留遍历顺序，分配 idx）
        │  有效文件 → job{idx, path} → 有缓冲 channel
        ▼
  worker pool（workers = min(files, GOMAXPROCS)）并行 SHA256
        │  各 worker 算完写 results[idx]（按 idx 槽位，无共享写竞争）
        ▼
  results 按 idx 顺序还原 → 复用现有分组逻辑（hashGroups + orderedKeys + 路径排序）
```

**共享归属（评审 P1，落字为硬约束）**：管道为包内私有，`FindDuplicateFiles` 与 `CountDuplicates` **两个公开函数都必须消费同一份实现**——禁止只改一个、禁止复制一份并行逻辑。拆分后 `walkHashedFiles` 两相化（收集 / 哈希），两函数共享。

**物化路径列表（评审 P2）**：两段式必须先物化全部有效文件路径（`[]fileInfo{idx,path,size,mod}`）才能计算 `workers = min(files, GOMAXPROCS)`。路径字符串为 O(files) 内存（10 万文件约 20MB，可忽略），**明确承认并接受**，不做流式 producer（WalkDir 中止语义复杂化不值）。

**消灭双路径（评审 P4）**：**不设**"文件数 < 阈值回退串行"分支。统一走并行管道，小文件集自然得 `workers = 1`，与串行开销等价。少一条代码路径，`ParallelEqualsSerial` 一致性测试天然全覆盖。

**不混入语义变更**：本 ADR **不**顺带引入"超大文件跳过哈希"上限——那会改变"哪些文件被识别为重复"，影响 clean 受害者清单，属独立语义决策，另行评估。

**size 预分组（零语义损失增强，已落地）**：并行化落地后痛点从"总耗时"变为"长尾延迟"（一个 2GB 文件占死一个 worker）。采用 size 预分组：不同 size 的文件不可能同 hash（SHA256 同 ⟹ 内容同 ⟹ size 同），唯一 size 的文件必不成组，`hashFilesParallel` 仅把出现次数 >1 的 size 送进 worker——**跳过其哈希，输出逐字节不变**。把大文件问题收窄到"同尺寸大文件"这一极小集合，规避了"盲区 vs 误删"两难（整文件跳过=假阴性盲区；部分哈希=弱哈希误删，clean 是破坏性操作、代价不对称）。

## 3. 后果（Consequences）

**正面**：大仓库去重/统计耗时显著下降（SHA256 并行）；输出逐字节不变，现有测试与 CLI 确定性契约不受影响；两公开函数共享单一路径，杜绝收敛回退。

**负面**：物化路径列表带来 O(files) 内存；并行读文件对磁盘 I/O 压力上升（可接受——哈希本就是读盘密集）。

**已知遗留**：超大文件哈希上限**明确不做**——size 预分组已把大文件长尾收窄到"同尺寸大文件"，无需拍阈值也规避两难；WalkDir 收集阶段仍串行（stat 级轻量，非瓶颈）；`-race` 已验证 results 槽位零竞争。

## 4. 数据溯源

- 现状与确定性语义：`go/dedup/dedup.go`（walkHashedFiles 39-47、orderedKeys 117、Path 排序 151）
- 调用方实证：`go/cli/dedup.go`（FindDuplicateFiles ×3）、`internal/app/resource_bindings.go`（FindDuplicateFiles/CountDuplicates ×2）、`go/repoaudit/repoaudit.go`（×1）——签名不变则零改动
- 确定性证明链：分组逻辑零改动 + 输入流保序（idx 还原）→ 输出与串行逐字节一致

<!-- 文件名: dedup-parallel-hash.md → 实际文件 ADR-119-dedup-parallel-hash.md -->
