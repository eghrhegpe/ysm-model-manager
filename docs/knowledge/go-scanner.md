---
kind: go-scanner
name: 扫描核心 go/scanner
tier: architecture
category: go
source_files:
  - go/scanner/
use_when:
  - 扫描
  - 扫描条目
  - 文件树
  - 哈希
  - 缓存
  - 作者提取
  - ScanEntries
  - 索引生成
---

# 扫描核心 go/scanner

## 概览

`go/scanner/` 包实现仓库文件扫描、哈希计算、缓存失效、作者提取、索引生成（ADR-003 P2 下沉，薄壳 `internal/app/app_scan.go` 仅保留依赖 App 的方法）。

## 核心职责

- `ScanEntries` 递归扫描目录产出 `ModelEntry[]`（支持 `.ban` 后缀还原扩展名）
- `.json` 白名单：仅 `ysm.json` 作为模型条目（ADR-038 D2，几何/动画/语言 json 不单独扫描）
- 30s 扫描缓存 + 路径级失效
- SHA256 哈希（同步系统文件匹配用）
- 作者提取（`[作者]` 前缀统计）、本地作者扫描、`index.json` 生成

## 白名单口径（ADR-038 D2）

| 扩展名 | 扫描行为 |
|--------|---------|
| `.ysm` / `.zip` / `.7z` / `.nbt` / `.schematic` / `.litematic` | ✅ 扫描 + 哈希 |
| `.json` | 仅 `ysm.json`（base name 级，`.ban` 后缀兼容），其余 json 跳过 |
| `.ban` 后缀 | 还原原始扩展名后按上述判断 |

## 对外 API / 入口

- `ScanEntries(dir)` — 扫描核心（缓存 30s，`.recycle` 跳过）
- `InvalidateCache()` / `InvalidatePath(dir)` — 缓存失效（导入/启用禁用后调用）
- `ComputeFileHash(path)` — SHA256
- `ListModelAuthors` / `ScanLocalAuthors` — 作者统计
- `GenerateRepoIndex(repoPath)` — 生成 `index.json`（GitHub Actions workflow 模板）

## 与其他子系统关系

- `go/fileops/`：`ToggleModelEnable` 成功后代调用 `InvalidatePath`（薄壳层）
- `go/types/`：`ModelEntry` / `IsSupportedExt` / `IsYsmEntryJSON`
- `internal/app/app_scan.go`：薄壳转发（`AnalyzeBedrockModel` / `tagsStore` / `AddOpLog` 保留在薄壳）

## 不变量

- 扫描结果受 30s 缓存保护，直接改盘后需显式失效缓存
- `.json` 只允许 `ysm.json` 与 Go importer / 前端 `isImportableFile` 三处口径一致（ADR-038 D2 纵深防御）
- **目录级 `.ban` 目录整体跳过**（P2 修复：`fileops.ToggleModelEnable` 对文件夹模型整组禁用时把父目录改名 `modelA.ban`，ADR-038 D3.7——原实现只过滤文件级 `.ban`，目录级禁用模型会以活跃身份进入 sync 的 repoHash 被列为 Missing 或被 SyncToggleStatus 重新启用）

## 相关

- ADR-003（逻辑下沉）、ADR-038（ysm.json 白名单统一 D2）
