# ADR-183：SearchModels 8 参数封装

- **状态**：🧊 已废弃（deferred）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/app_scan.go:63`、`go/cli/appservice.go:19`、`go/cli/model.go:54/337/358`、`frontend/src/views/app-tree/toolbar-search.ts:195-204`、[go_design_critique](../knowledge/go_design_critique.md)

---

## 1. 背景（Context）

`SearchModels` 是 Wails 绑定，当前签名 8 个参数：

```go
func (a *App) SearchModels(filesRoot string, keyword string, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult
```

2026-09-05 三路子代理串行锐评发现：
- 前端真实消费仅 1 处（`toolbar-search.ts:195-204`）
- 后端消费面：`go/cli` 3 处 + `app_scan_test.go` 30+ 处 + browser-adapter/web-fs 契约测试 60+ 处
- 封装收益仅可读性（int 同类型可随意重排参数），非修复 bug
- 8 参数签名已成契约锚点（ADR-174 D3 明确声明「web kw 快路径降级语义」是有意差异）

## 2. 决策（Decision）

**标记技术债，本轮不动**。下轮路径：

1. 若新增过滤维度（如骨骼名模糊匹配），届时统一封装 `types.SearchFilters` struct
2. 封装时需同步：types 定义 + SearchModels 签名 + appservice.go 接口 + CLI 3 处 + 测试 60+ 处 + 前端绑定 re-gen
3. 属 Wails 绑定契约变更（破坏性），需独立 ADR 级评估

已补技术债注释：`app_scan.go:62`「参数固定 8 个，新增过滤维度走 types.SearchFilters struct（技术债，后续 ADR 封装）」。

## 3. 后果（Consequences）

| 正面 | 负面 |
|------|------|
| 不破坏现有契约（前端 1 处 + CLI 3 处 + 60+ 测试零改动） | 8 参数签名保留，新开发者可能重排参数 |
| 技术债注释标记认知锚点 | 封装被推迟，未来重构成本累积 |
| 新增过滤维度时强制走 ADR 评估 | — |

## 4. 数据溯源

- 锐评报告：视角C 2026-09-05 三路串行锐评
- 前端消费面：`frontend/src/views/app-tree/toolbar-search.ts:195-204`（唯一真实消费）
- 后端定义：`internal/app/app_scan.go:63`、`go/cli/appservice.go:19`
- 契约锚点：ADR-174 D3「web kw 快路径降级语义是有意差异」

---

*ADR 只记决策方向和理由，不记实施进度。实施进度见知识卡 [go_design_critique](../knowledge/go_design_critique.md) 动刀进度。*
