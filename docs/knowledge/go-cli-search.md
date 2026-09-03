---
kind: go-cli-search
name: CLI 搜索命令 search
tier: architecture
category: go
source_files:
  - go/cli/model.go
  - go/cli/cli.go
auto_fields:
  symbols_with_lines:
    - ExecuteCLIWithApp
    - RunCLI
  tests:
    - go/cli/cli_test.go
tests:
  - go/cli/cli_test.go
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - CLI 搜索、命令行搜索、search 命令
  - 关键词搜索、数值范围搜索
  - runSearch
quick_risk_lines:
  - CLI 搜索必须复用 go/cli 的 SearchModels 后端，禁止 CLI 层手写搜索逻辑
pitfalls:
  - CLI 手写搜索 → 与 GUI 搜索结果不一致、参数不统一；必须复用 go/cli 的 SearchModels
  - runSearch 未传范围参数 → 数值筛选失效；必须完整传 6 个范围参数

use_when:
  - CLI 搜索
  - 命令行搜索
  - search 命令
  - 关键词搜索
  - 数值范围搜索
  - 模型搜索
  - go run search
  - runSearch
invariant_anchors:
  - go/cli/model.go|runSearch
  - go/cli/model.go|printSearchTable
status: active
---

# CLI 搜索命令 search

## 概览

`go/cli/model.go` 的 `search` 命令是 YSM CLI 模式的模型搜索入口，注册为 `RegisterCommandC("search", CatModel, "搜索模型（支持关键词过滤）", runSearch)`。它通过 Wails Binding 调用 `ctx.App.SearchModels` 执行搜索，以 JSON 或表格格式输出结果。

## 命令格式

```bash
go run . --cli --files-root <仓库根目录> search --keyword <关键词> [选项...]
```

## 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `--keyword` | string | "" | 搜索关键词（匹配模型名或路径，trim + tolower） |
| `--min-bones` | int | 0 | 最小骨骼数（>0 才参与过滤） |
| `--max-bones` | int | 0 | 最大骨骼数 |
| `--min-cubes` | int | 0 | 最小立方块数 |
| `--max-cubes` | int | 0 | 最大立方块数 |
| `--min-tex` | int | 0 | 最小贴图尺寸 |
| `--max-tex` | int | 0 | 最大贴图尺寸 |
| `--format` | string | "json" | 输出格式: `json` 或 `table` |

## 核心实现

### `runSearch`（行 24-58）

1. 解析 CLI 参数（`newCmdFlagSet("search")`）
2. 调用 `ctx.App.SearchModels(ctx.FilesRoot, keyword, minBones, maxBones, minCubes, maxCubes, minTex, maxTex)`
3. 空结果 → 输出 `📭 未找到匹配的模型`
4. `--format table` → `printSearchTable` 表格输出（名称截断 38 字）
5. 默认 JSON 输出 → `json.MarshalIndent` 格式化

### `printSearchTable`（行 61-72）

列：名称、骨骼、立方块、贴图（宽x高），名称超 38 字截断加 `...`

### 后台搜索能力

`SearchModels` 由 Go 后端 `internal/app/app_scan.go` 实现：
- 关键词：`strings.ToLower(strings.TrimSpace(keyword))`，匹配 name OR path
- 数值范围：>0 才参与过滤，min/max 闭区间
- 返回 `types.SearchResult`（name, path, boneCount, cubeCount, texWidth, texHeight, hasError）

## 与其他搜索入口的差异

| 维度 | CLI search | 前端 SearchModels | 工具栏搜索 |
|------|-----------|------------------|-----------|
| 后端 | Go 直接调用 | 桌面 Go / 网页版 web-fs + Worker | 同前端 SearchModels |
| 数值范围 | 全部支持 | 桌面全支持 / 网页版需 Worker | 同左 |
| 标签过滤 | ❌ 不支持 | 需单独调 ListByTag | ✅ 三路交集 |
| 降级 | 无（始终 Go） | 网页版 Worker 降级 | toast 提示降级 |
| 输出 | JSON/table 文本 | 内存数据结构 | 树渲染 |

## 相关

- `go/cli/cli.go` — CLI 命令注册与调度框架
- `internal/app/app_scan.go` — SearchModels 后端实现
- `go/types/` — SearchResult 类型定义
- [toolbar-search.md](./toolbar-search.md) — 前端搜索编排
- [model-stats.md](./model-stats.md) — 网页版 Worker 统计
- `docs/cli-commands.md` — CLI 命令完整参考（自动生成）