---
kind: go_repoaudit
name: 仓库审计 go/repoaudit
tier: architecture
category: go
source_files:
  - go/repoaudit/
use_when:
  - 仓库审计
  - 健康分数
  - 完整性检查
  - 缓存命中率
  - repoaudit
  - health-report
  - 去重
perf:
  - io-bound
  - memory-heavy
invariant_anchors:
  - go/repoaudit/repoaudit.go|func Audit
  - go/repoaudit/repoaudit.go|func Classify
  - go/repoaudit/repoaudit.go|sync.Once
---

# 仓库审计 go/repoaudit

## 概览

`go/repoaudit/` 包提供仓库健康审计核心逻辑——资源扫描、完整性校验、缓存状态、健康分数、警告生成、去重汇总。从 `go/cli`（原 `resource.go` 的 `collectRepoHealth`）提取为独立包，CLI 与 GUI 绑定（`internal/app`）共用同一实现，消除「前端算一遍、CLI 算一遍」的双轨口径漂移。

## 核心职责

- `Audit(dirPath)` — 一次遍历完成：资源扫描 + 完整性检查（.json/.ysm 合法性验证）+ 缓存状态 + 健康分数 + 警告生成
- `HealthReportFor(dirPath)` — 完整体检：Audit + 去重（`dedup.FindDuplicateFiles`），返回 `HealthReport` 统一载荷
- `Classify(ext)` — 扩展名→注册表资源类型 id 映射，注册表驱动（新增类型只改 `resource_types.json`），首次调用 `sync.Once` 构建预计算 ext→id map，后续 O(1) 查表
- `isModelFileValid` — 模型文件完整性验证：.json/.ysm 必须合法 JSON 且含 `format_version`（或 `minecraft:geometry`/`bones`），拒绝空对象/数组

## 对外 API / 入口

- `Audit(dirPath string) (Result, error)` — 审计核心，返回 `Result`（完整性 + 缓存 + 资源统计 + 分数 + 警告）
- `HealthReportFor(dirPath string) (HealthReport, error)` — 完整体检（审计 + 去重）
- `Classify(ext string) string` — 扩展名分类（导出供 resource-scan 等共用）
- `Result` / `HealthReport` / `Completeness` / `CacheStatus` / `ResourceSummary` / `DedupSummary` — 结果类型

## 与其他子系统关系

- 被 `go/cli/resource.go`（`repo-audit` 命令）和 `go/cli/health.go`（`health-report` 命令）调用
- 被 `internal/app/resource_bindings.go`（GUI 绑定 `RepoHealthAudit`）调用
- 依赖 `go/dedup`（去重扫描）、`go/texture_cache`（缓存统计）、`go/fsutil`（FormatSize）、`go/types`（注册表）

## 不变量

- CLI 与 GUI 共用同一 `Audit` 实现，审计口径唯一（防双轨漂移）
- 目录不存在/不可用必须先报错——`filepath.Walk` 对不存在目录只回错误回调却返回 nil，会静默产出「空报告 = 假绿」
- 符号链接守卫：拒绝根目录符号链接，跳过子树内符号链接（与 dedup 包对齐）
  - **R34 P2-3 根 symlink 守卫 filepath.Clean 修复**（repoaudit.go:159）：原 `path == dirPath` 字符串比较，含尾斜杠/`..`/未 clean 路径时比较失败，根符号链接被静默跳过，产出空报告。修复：`path == filepath.Clean(dirPath)`。
- 健康分数有下限 `scoreFloor = 30`，避免多问题叠加直接归零失去区分度
- `Classify` 未命中任何注册表类型 → `"other"`（不报错）

## 已知问题 / 待治理（R34 审计记录）

- **无界 JSON 解码 OOM 风险**（repoaudit.go:337-353，R34 P3-4 待修）：`json.NewDecoder(f).Decode(&v map[string]interface{})` 无大小上限/无 `io.LimitReader`，单个数 GB 的恶意或损坏 `.json/.ysm` 文件会全量载入内存。修复方向：先 `st.Size()` 上限校验，或包 `io.LimitReader`。
- **无 context/超时**（repoaudit.go:125/256，R34 P3-5 待修）：`Audit` 与 `HealthReportFor` 无 `context.Context`/超时，大仓库审计可能长时阻塞 GUI 绑定层。
- **P2-4 WalkDir 回调对 `err != nil`**（无权限目录）仅 `append` warning 后 `return nil`，部分目录不可达时 `TotalFiles` 偏低但分数仍可能 100，静默偏绿。修复方向：累计访问异常计数，超过阈值标记 `partial=true`。
- **P2-5 `isModelFileValid` 对未识别扩展名 `return true` 放行**，若未来调用方放宽 gate，未知扩展名被误判有效。修复方向：函数内对未识别扩展名 `return false` 防御性收紧。
- **P3-6 `HealthReportFor` 中 dedup 扫描失败直接 `return HealthReport{}, err`**，丢弃已成功的 `audit` 结果。修复方向：dedup 失败时保留 audit 部分、Dedup 置零并在 warnings 追加。

## 相关

- [go-dedup](./go-dedup.md) — 去重核心（HealthReportFor 调用）
- [go-fsutil](./go-fsutil.md) — 文件工具（FormatSize）
- CLI 命令 `audit-split` / `rollback-impact` — 操作此包
