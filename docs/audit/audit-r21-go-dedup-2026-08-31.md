# R21 审核 — go/dedup 去重检测 + 哈希策略

**审核日期**：2026-08-31
**审核者**：主模型（串行模式）
**范围**：`go/dedup/`（427 行源码 + 1361 行测试 = 1788 行，1:3.19）+ 消费方 `internal/app/resource_bindings.go:548-595`（binding）+ `go/cli/dedup.go`（×3）+ `go/repoaudit/repoaudit.go`（×1）
**方向岔开依据**：最近 50 条提交 `go/dedup` 零命中（最近一次 b84da528 于 2026-08-24，方向完全岔开）；R20 报告点名推荐本模块为下一次审核对象
**门禁状态**：`go build ./go/...` ✅；`go test -race -timeout 120s ./go/dedup/...` → `ok 2.038s` ✅；`go test -race ./go/repoaudit/...`（消费方连带）→ `ok 1.208s` ✅

---

## 总体结论

**通过**——本模块是项目里**测试密度最高的 Go 包**（1361 测试 / 427 源码 ≈ 1:3.19，超 avatar 的 1:1.95），**未发现 P2 级真实缺陷**。3 项 P3 观察 + 4 项 P4 轻微，无需结构改动，建议知识卡/注释级收口。与 R19（watcher 1 项 P2）/ R20（avatar 1 项 P2）形成对照：**测试密度最高、且唯一零 P2**——黄金对照测试把 ADR-119 确定性契约钉死是决定性差异。

> 行数修正：R20 报告称「386 行 + 测试」，实测 **427 行**（dedup.go 330 + strategy.go 97）——与 avatar 的 2605→2862 同类汇总误差，不影响结论。

---

## 亮点（16 项）

| # | 模式 | 位置 |
|---|------|------|
| 1 | **并行确定性黄金对照**：串行参照实现 `serialReference` 全字段逐字节比对（组序 + 组内路径 + Size/ModTime），ADR-119「并行输出与串行一致」被硬锁死——任何 idx 对齐破坏/组序漂移确定性变红 | `dedup_parallel_test.go:211-283` `TestParallelEqualsSerial_Golden` |
| 2 | **size 预分组零语义损失**：唯一 size 必不成组、跳过哈希（消解大文件长尾），注入 `computeHash` 计数验证「不触发」 | `dedup.go:128-155` + `TestHashFilesParallel_UniqueSizeSkipsHash` |
| 3 | **sentinel 错误分类（陷阱 #11 锚）**：`ErrSymlinkRoot` + `errors.Is`，三个身份测试（自身成立 / `%w` 包裹 / 无关错误不误判） | `dedup.go:22` + `dedup_extra_test.go:171-228` |
| 4 | **根 symlink 假绿防御**：WalkDir 首条目 `p == dir` 即硬报错，不静默返回「无重复」 | `dedup.go:79-84` |
| 5 | **NUL 字节路径显式报错**：`filepath.Abs` 失败不退回入参形态（否则 WalkDir→Lstat 失败被 log 吞掉 = 假绿） | `dedup.go:174-180` + `TestFindDuplicateFiles_UnparseableRootError` |
| 6 | **共享并行管道防双实现漂移**：FindDuplicateFiles/CountDuplicates 同源（P1 契约），一致性测试锁定 | `dedup.go:39-41` + `TestCountDuplicates_ParallelConsistency` |
| 7 | **读失败 log-and-skip 并行/串行语义一致**：注入 `computeHash` 模拟失败，验证不进组、计数同跳过 | `TestFindDuplicateFiles_ReadFailureSkipped` |
| 8 | **`computeHash` 可注入变量**（测试承重点）：49afd979 曾删除致测试编译失败（go vet 兜住），知识卡不变量记录该历史 | `dedup.go:61-63` + `go-dedup.md` 不变量 |
| 9 | **WalkDir 回调无 defer**（框架反模式-15 样板）+ worker goroutine 全 `wg.Wait()` 收口（零泄漏） | `dedup.go:73, 136-159` |
| 10 | **回收站排除 EqualFold**（`fsutil.IsRecycleDir`，知识卡 P3 修复，Windows `.RECYCLE` 不漏排） | `dedup.go:87` |
| 11 | **CleanEmptyDirs 根目录保护**（P2 修复）：root 参数 + 5 个测试（含嵌套/混合/根不删） | `dedup.go:303-321` + `dedup_test.go:142-214` |
| 12 | **空文件跳过**：占位符/空 .animation 等不同用途空文件不判重 | `dedup.go:98-101` + `TestAdversarial_EmptyFileSkip` |
| 13 | **策略接口化**（`HashAlgorithm`）：deep/quick/name_size 三态 + 默认回退，前端三值对齐（dedup.ts:153-155） | `strategy.go:15-96` |
| 14 | **对抗测试**：symlink 子目录逃逸（Linux 硬断言）、相对路径穿越/NUL（by-design 记录）、百文件性能测量 | `adversarial_test.go` |
| 15 | **Windows 路径卫生**：TrimSpace + 空判 + 全量 Abs 化（`recycle.Move` 下游按 CWD 解析的坑被提前消解） | `dedup.go:168-181` |
| 16 | **并发写零竞争设计**：`results[f.idx]` 每槽单写者（f 只被一个 worker 消费），-race 验证 | `dedup.go:148` |

---

## 风险清单

### 🟡 P3（观察，建议收口）

#### P3-1 `collectFiles` WalkDir 回调 err **log-and-continue**——遍历中子树访问失败软跳过，与假绿防御不对称
**位置**：`dedup.go:74-77`
**观察**：

```go
err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
    if err != nil {
        log.Printf("[dedup] 访问 %s 失败: %v", p, err)
        return nil
    }
```

根 symlink 是硬报错（ErrSymlinkRoot），但**遍历中**权限拒绝/IO 失败的子树只留日志、`FindDuplicateFiles` 返回 nil error——「无重复」结果可能漏掉整棵子树。与 ErrSymlinkRoot 的「静默漏扫 = 假绿」关切不对称。
**严重性**：低-中（有 log 留痕，非完全静默；诊断页环形日志可见）。
**建议**：知识卡不变量段记录该语义（「子树访问失败 log-and-skip，可能漏扫」）；或 CollectFiles 返回「跳过子树数」供调用方提示。**不改行为**。

#### P3-2 `dedup.CleanEmptyDirs` 与 `fsutil.CleanEmptyDirs` **双实现**，dedup 版零生产消费
**位置**：`dedup.go:286-298` vs `go/fsutil/walk.go:96`
**观察**：fsutil 版带 `skipRecycle` 参数并被 `recycle_clean.go:112` 消费；dedup 版无 skipRecycle、**grep 全仓生产零消费**（知识卡已标 P3 观察）。反模式-4 显著重复（≥2 文件）。
**建议**：确认 CLI/文档无引用后删除 dedup 版，或收敛为 fsutil 薄转发。**涉及 API 删除，需用户拍板**。

#### P3-3 `FindDuplicateFiles` / `CountDuplicates` 入口段 ~25 行重复
**位置**：`dedup.go:167-193` vs `241-262`
**观察**：TrimSpace / 空判 / `filepath.Abs` / config 解析四段几乎逐行相同（同一文件内双函数重复）。
**建议**：收敛为入口 helper（低风险纯重构，行为不变）。

### 🟢 P4（不修，审计记录）

| # | 位置 | 问题 |
|---|------|------|
| P4-1 | `dedup.go:94-97` | `d.Info()` 失败静默跳过（并发删除竞态），无日志——与 WalkDir err 的 log 口径不一致 |
| P4-2 | `strategy.go:66-80` | `NameSizeHash` 跨目录同名同 size 判重复（如 `a/foo.txt` 与 `b/foo.txt`）——设计取舍，建议注释说明「快速不精确」语义 |
| P4-3 | `strategy_test.go:267, 285` | `TestFindDuplicateFiles_NameSizeStrategy` 断言为 `t.Logf` 软断言（name_size 语义边界无硬锁定） |
| P4-4 | `strategy.go:92` | `case "hash"` 兼容别名无前端消费（前端只写 deep_hash/quick_hash/name_size）；`types.DedupConfig` 注释以 `"hash"` 为名与前端实际值 `"deep_hash"` 口径不一致——注释对齐即可 |

---

## 反模式 / 致命陷阱 排查清单

按 audit-framework.md §一 §二 全量比对：

| 编号 | 检查项 | 结果 |
|------|--------|------|
| 反模式-1 | 隐式状态写入 | ✅ `computeHash` 注入点是有意测试承重点（知识卡记录），非生产状态写入 |
| 反模式-2 | 职责过载 | ✅ 11 符号职责分明（收集/并行哈希/分组/计数/清理） |
| 反模式-3 | 魔法数值/硬编码 | ⚠️ strategy 字符串三态有前端对齐；`"hash"` 别名 P4-4 |
| 反模式-4 | 显著重复 | ⚠️ `CleanEmptyDirs` 双实现（P3-2）+ 入口段同文件重复（P3-3） |
| 反模式-10 | 已关闭 channel 复用 | ✅ jobs channel 每次新建 |
| 反模式-12 | 文本匹配错误分类 | ✅ sentinel + `errors.Is`（陷阱 #11 锚）+ 3 测试 |
| 反模式-13 | `sync.Once` 重置 | ✅ 无 Once |
| 反模式-14 | goroutine 泄漏 | ✅ 全部 `wg.Wait()` 收口 |
| 反模式-15 | defer 在循环内 | ✅ WalkDir 回调无 defer（本模块即框架样板） |
| 反模式-16 | for 闭包捕获循环变量 | ✅ worker 闭包不引用循环变量；`go vet loopclosure` 零报告 |
| 反模式-17 | io.Reader 未 Close | ✅ DeepHash/QuickHash `defer f.Close()`；NameSizeHash 走 Stat 不打开 |

致命陷阱 §二：

| # | 检查项 | 结果 |
|---|--------|------|
| 5 | Go Binding 函数名 | ✅ `resource_bindings.go:551,583` `FindDuplicateFiles`/`CountDuplicates` grep 一致，签名 `(dir, configStr...)` ↔ `dedup.FindDuplicateFiles(dir, true, cfg)` |
| 8 | 回收站误删 | ✅ dedup 只检测不删除；删除走 `recycle.DeduplicateEntries`（recycle_clean.go） |
| 17 | 零值哨兵 | ✅ 读失败用显式 `ok bool` 标志而非零值 hash；`idx=0` 首文件槽位无哨兵误用 |

治理红线 §三：

| # | 检查项 | 结果 |
|---|--------|------|
| 3.4 ③ | 边界对称 | ✅ 路径 Abs 化 + 根 symlink 双侧；CleanEmptyDirs 根不删 |
| 3.4 ③ | 字符串比较 | ✅ `fsutil.IsRecycleDir` EqualFold（大小写不敏感，Windows `.RECYCLE`） |

---

## ADR 关联

| ADR | 关联点 | 状态 |
|-----|--------|------|
| ADR-119 并行哈希 | ✅ 共享管道 + size 预分组 + 黄金对照锁定确定性 | 已采纳、已落地 |
| ADR-044 防御范式 | ✅ EqualFold / 边界对称 / 错误分类 | 已采纳 |
| 陷阱 #11 错误分类 | ✅ ErrSymlinkRoot sentinel + errors.Is | 已修复、已测试 |

无新 ADR 建议。

---

## 修复清单

本轮**无必修项**（零 P2）。P3 收口建议：

- **R21-FIX-1**（P3-1）：`go-dedup.md` 不变量段补「子树访问失败 log-and-skip，可能漏扫」语义记录（+5 行文档）
- **R21-FIX-2**（P3-2）：`dedup.CleanEmptyDirs` 删除或收敛——**待用户拍板**（API 删除）
- **R21-FIX-3**（P3-3）：入口段收敛 helper（+15 −30 行，纯重构，行为不变；`TestFindDuplicateFiles_WhitespacePathError` 等现有测试兜底）

验收：`go test -race ./go/dedup/...` 保持绿。

**修复状态**：三项已随本提交落地——FIX-1 知识卡不变量已补；FIX-2 经全仓零引用确认（含测试/docs/CLI）后删除 `CleanEmptyDirs`/`removeEmptyDirs`/`isEmptyDir` 及 8 个连带测试；FIX-3 收敛为 `resolveScanRoot`/`resolveHashAlgorithm`（错误消息逐字不变，`EmptyPathError`/`WhitespacePathError`/`UnparseableRootError` 定向测试兜底）。门禁 `go build ./go/...` + `go test -race ./go/dedup/...` + `go vet` 全绿。

---

## 审核元数据

- 审核耗时：单轮串行审，约 30 分钟（1788 行：427 源码 + 1361 测试）
- 阅读文件：
  - `go/dedup/dedup.go`（330 行，全文）
  - `go/dedup/strategy.go`（97 行，全文）
  - `go/dedup/dedup_test.go`（231 行，全文）
  - `go/dedup/dedup_extra_test.go`（333 行，错误分类/假绿防线段全读）
  - `go/dedup/dedup_parallel_test.go`（283 行，全文）
  - `go/dedup/adversarial_test.go`（194 行，全文）
  - `go/dedup/strategy_test.go`（320 行，配置驱动段全读）
  - `internal/app/resource_bindings.go:548-595`（binding 签名核对）
  - `go/recycle/recycle_clean.go:112`、`go/fsutil/walk.go:96`（CleanEmptyDirs 双实现实证）
  - `go/types/config.go:84-91`（DedupConfig 注释口径）
  - `frontend/src/views/app-content/diagnostics/dedup.ts:153-155`（strategy 三值实证）
  - `docs/audit/audit-framework.md`（反模式/陷阱/红线清单）
- 工具：`git log -50`、`glob`、`grep`、`go build`、`go test -race`、`docs/knowledge/go-dedup.md`
- 未触达：CLI `dedup clean` 端到端（`go/cli/dedup.go` 仅 grep 消费点，未逐行审——下次可补）

---

## 与 R20 审核的对照

| 维度 | R20 (go/avatar) | R21 (go/dedup) |
|---|---|---|
| 源码体量 | 970 行（报告误记 910） | 427 行（报告误记 386） |
| 测试体量 | 1892 行（1:1.95） | 1361 行（1:3.19） |
| 测试设计深度 | 假胶水端到端 Node 管线 / Zip-bomb / CRC 损坏 | **黄金对照锁定并行确定性** / size 预分组注入计数 / sentinel 身份测试 |
| **真实 P2 缺陷** | BatchExtractCreatorAvatars 缓存命中硬编码 png | **零 P2** |
| 真实 P3 | SetNodeJS 非并发安全 / MkdirAll 吞咽 / .7z 缺位 | WalkDir 子树软跳过 / CleanEmptyDirs 双实现 / 入口重复 |
| 核心契约保障 | 多条 binding 口径一致性（曾被漏测） | **单一黄金对照 + 同源管道契约**（无漏测点） |

**对照结论**：R19/R20 各藏 1 项「测试未覆盖的契约不一致」，R21 零 P2——差异不在测试数量（1:1.95 vs 1:3.19），而在**测试是否锁死了契约本身**：avatar 靠分散断言，dedup 靠「并行 vs 串行参照逐字节比对」的黄金对照。这验证并反衬了 R20 的审计结论——「测试密度高 ≠ 契约全覆盖」，密度要长在契约锚点上才有免疫力。

---

**下次审核建议**：`internal/app/app_workshop.go`（352 行创意工坊 UI 编排，零提交）；或 `go/recycle`（去重删除执行侧，与 dedup 契约衔接点，`DeduplicateEntries` 组内排序取首个保留的消费方）。
