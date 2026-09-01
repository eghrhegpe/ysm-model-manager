---
kind: toolbar-search
name: 工具栏搜索编排 toolbar-search
tier: leaf
category: ui
source_files:
  - frontend/src/views/app-tree/toolbar-search.ts
  - frontend/src/views/app-tree/toolbar-events.ts
tests:
  - frontend/src/views/app-tree/toolbar-events.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 搜索编排、高级筛选、关键词搜索
  - 数值范围搜索、标签过滤
  - 多线程统计角标、网页版导入
  - 降级提示、consumeWebSearchDegraded
quick_risk_lines:
  - toolbar-search 编排必须单点分发搜索链路（弹窗 → 后端 → 标签交集 → 降级 → 渲染），禁止各层各自调 SearchModels
pitfalls:
  - 各层各自调 SearchModels → 重复请求 / 结果不一致；必须经 toolbar-search 单点编排
  - 网页版降级不走 consumeWebSearchDegraded → 用户在受限环境无反馈；必须经该函数给出降级提示

use_when:
  - 搜索编排
  - 高级筛选
  - 关键词搜索
  - 数值范围搜索
  - 标签过滤
  - 多线程统计角标
  - 网页版导入
  - tool-bar-search
  - 工具栏搜索
  - 降级提示
  - consumeWebSearchDegraded
invariant_anchors:
  - frontend/src/views/app-tree/toolbar-search.ts|openAdvFilterDialog
  - frontend/src/views/app-tree/toolbar-search.ts|consumeWebSearchDegraded
  - frontend/src/views/app-tree/toolbar-search.ts|pickWebFilesAndImport
---

# 工具栏搜索编排 toolbar-search

## 概览

`toolbar-search.ts` 是 YSM 前端搜索/筛选/导入逻辑的编排核心（272 行，从 `toolbar-events.ts` 拆出，ADR-040 P1）。它管理从用户输入到搜索结果渲染的完整链路：弹窗交互 → 后端搜索 → 标签交集 → 降级消费 → 树渲染。

## 核心职责

### `openAdvFilterDialog` — 高级筛选全流程编排（行 42-232）

1. **收集当前值**：从 inline 面板读取 keyword、minBones/maxBones、minCubes/maxCubes、minTex/maxTex
2. **打开弹窗**：调用 `modalAdvFilter`（`dialog-adv-filter.md`），用户确认后回填 inline 面板
3. **标签搜索**：如果有标签条件，调 `ListByTag(tag)` 获取标签路径集合
4. **数值/关键词搜索**：如果有关键词或数值范围条件，调 `SearchModels(filesRoot, kw, minBones, ..., maxTex)` 获取后端结果
5. **多线程统计角标**（网页版专用）：数值条件搜索时显示 `🧵×N ⚙️ x/y` 浮动角标证明 Worker 并行统计；完成后隐藏
6. **降级消费**：网页版 Worker 不可用时，`consumeWebSearchDegraded()` 返回 true → toast 提示"数值条件已忽略"
7. **取交集**：标签 ∩ 搜索条件（如果两者都有），存到 `vm._filterPaths`
8. **触发渲染**：`vm._renderTree()` 刷新树，`render.ts` 的 `buildTree` 按 `_filterPaths` 过滤

### `pickWebFilesAndImport` — 网页版导入（行 236-272）

- 桌面版走 Wails 原生对话框
- 网页版无此 binding → 创建 `<input type=file>` 触发选择
- 调 `importWebFiles` 直写 IndexedDB，完成后回调刷新

### 多线程统计角标（行 18-39）

- 右下角 fixed 小角标，仅 web 模式（`resolveWebMode()`）创建
- 数值条件搜索时显示 `🧵×N ⚙️ x/y`（Worker 批进度），统计完成隐藏
- Worker 降级时短暂显示 `⚠️` 提示，3s 后隐藏

## 流通链路

```
用户点击 🔍 弹窗 → modalAdvFilter 采集条件
  ↓
回填 inline 面板（keyword + 6 个数值输入框）
  ↓
（有标签）ListByTag → tagPaths
  ↓
（有关键词/数值）SearchModels → modelPaths
  ├─ 网页版数值条件 → 显示 🧵×N 角标 → onStatsProgress 更新进度
  └─ Worker 降级 → consumeWebSearchDegraded → toast ⚠️
  ↓
tagPaths ∩ modelPaths 交集 → vm._filterPaths
  ↓
vm._renderTree() → render.ts buildTree 过滤
```

## 与其他子系统关系

- `dialog-adv-filter.md` — 弹窗 UI 层（采集条件），本卡为编排层
- `model-stats.md` — Web Worker 统计层，`consumeWebSearchDegraded` 降级标记来源
- `web-stats.ts` — Worker 池编排，`onStatsProgress` / `getStatsPoolSize` 消费方
- `app-tree.md` — 资源树组件，`_filterPaths` / `_search` 驱动渲染
- `render.ts` — `buildTree` 按 `search`（路径匹配）和 `filterPaths`（精确路径交集）过滤

## 相关

- [model-stats.md](./model-stats.md) — Worker 统计与降级标记
- [dialog-adv-filter.md](./dialog-adv-filter.md) — 高级筛选弹窗
- [app-tree.md](./app-tree.md) — 资源树组件
- ADR-040（P1 搜索逻辑拆分），ADR-071（#6 数值条件 Worker 统计）