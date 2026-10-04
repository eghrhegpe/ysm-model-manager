---
kind: fe_go_boundary
name: 前端只读不判边界与豁免
tier: leaf
category: feature
status: active
source_files:
  - frontend/src/views/app-tree/render.ts
  - frontend/src/preview-3d/menu/shell/switch.ts
auto_fields:
  symbols_with_lines:
    - buildSwitchNodes
    - buildTree
    - cleanupVirtualScroll
    - createTreeRenderCtx
    - flattenVisible
    - getRenderMode
    - getVsMode
    - getVsRows
    - makeSwitchState
    - RenderMode
    - renderTree
    - ROW_H_GRID_COMPACT
    - ROW_H_GRID_NORMAL
    - ROW_H_LIST_COMPACT
    - ROW_H_LIST_NORMAL
    - rowHeightGrid
    - rowHeightList
    - setRenderMode
    - setVsRows
    - switchNormPath
    - SwitchState
    - switchTabHighlightBg
    - TreeNode
    - TreeRenderCtx
    - TreeRow
    - updateStat
use_when:
  - 判断某个过滤/归类逻辑该放前端还是 Go
  - 树内即时搜索/排序想下沉磁盘前
  - 跨资源类型切换的实现选型
  - Wails 绑定生成相关疑问
pitfalls:
  - 展示端豁免仅限「内存全量 entries 的展示层收窄」，触及磁盘 I/O 或归属语义重算即越界
  - 绑定命令漏 `-ts` 会产出 `.js` 并清掉 git 跟踪的 `.ts`（回归红线）
  - 跨类型切换误用 `switchTo`（同源替换才走它）
quick_groups:
  - 边界与豁免
quick_intents:
  - 输入端（磁盘 → 列表）归 Go，展示端（列表 → 视图）豁免
  - 树内即时过滤是对 Go 已交付内存全量的 UI 收窄，不是归属重算
  - 磁盘级筛选与高级搜索归 Go（SearchModels），前端不扫磁盘
quick_risk_lines:
  - 前端扫磁盘 / 重算归属语义 = 违反回归红线
invariant_anchors:
  - frontend/src/views/app-tree/render.ts|entry.path.toLowerCase().includes(searchLower)
  - frontend/src/preview-3d/menu/shell/switch.ts|switchExternal
---

# 前端只读不判边界与豁免

## 概览

回归红线「前端只读不判」的完整版（原 AGENTS.md「职责归属——前端 vs Go」豁免注脚全文迁入，2026-10-04 常驻层瘦身）。

## 红线本体

- 类型判定唯一事实源 = `resource_types.json` + Go（`internal/app/`）；前端只读不判（tab / preview / 3d / resourcepack 归类一律由 Go 扫描结果 + 该 JSON 派生）。
- 筛选 / 去重 / 聚合归 Go；前端消费 Go 的已筛已归类结果，不本地重算。

## 豁免注脚（S3 收口 2026-09-03，全文）

树内即时过滤属 UI 交互层——app-tree 等对 Go 已交付的**内存全量 entries** 做 search 子串过滤 / 排序 / 展开折叠，数据集归属已由 Go 筛定、前端不重算「哪个文件该出现在哪」的归属语义，仅展示层即时收窄（每次击键本地响应，下沉磁盘 RPC 荒谬）。磁盘级归属筛选与高级搜索（关键词 + 骨骼/立方体/纹理范围，`SearchModels`，adv-filter 消费）仍归 Go，前端不得自行扫描磁盘或重算归属。界线：**输入端（磁盘 → 列表）归 Go，展示端（列表 → 视图）豁免**。

实现锚：树内 search 子串过滤在 `frontend/src/views/app-tree/render.ts`（`entry.path.toLowerCase().includes(searchLower)`）。

## 切换与绑定

- 跨类型切换走 `switchExternal`（同源替换走 `switchTo`）；前端实现在 `frontend/src/preview-3d/menu/shell/switch.ts`。
- 数据经 Wails 桥（`window.go`）消费；绑定统一 `cd frontend && npm run generate:bindings`（script 已内置 `-ts`；在根目录裸跑会 Missing script，无 `-ts` 会产出 `.js` 并清掉 git 跟踪的 `.ts`，回归红线）。

## 相关

- Go 侧分类实现 → 知识卡 `classify-routing.md`；ADR-230 代际守卫 → `load_guard.md`
