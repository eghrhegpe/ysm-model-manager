# ADR-017: 前端增强待办决策

- **状态**：🔄 部分采纳
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/`（前端增强待办）/ `docs/Design.md` / 原 `docs/frontend/pending-cleanup.md`（已删除，2026-08-03）

---

> 决策真相源：本 ADR（前端增强待办部分）；原 `docs/frontend/pending-cleanup.md` 清理台账已于 2026-08-03 删除（items 1–14 清理完成证据见 git 历史）。

## 背景

`docs/frontend/pending-cleanup.md`（已于 2026-08-03 删除）原本混合了两类性质不同的内容：

1. **调试代码清理台账**（items 1–14，全部 ✅ 已清理）：记录 `window.*` 全局变量、`[YSM]`/`[DnD]` 调试日志等的清除，已被 `CLEANUP_RULES.md` 作为清理完成的证据引用，属于**运维台账**，非决策。
2. **前端增强待办**（带「问题 / 方案 / 涉及文件」的改进提案）：列表/网格视图切换、model2d 预览缓存等，属于**决策材料**。

若整篇转为 ADR，会把运维台账强行塞进「决策记录」格式，违背「复用已有、走长治久安方案」的治理原则。故本 ADR 仅承接**增强待办**部分作为决策真相源；原文件已删除，本 ADR 仅保留增强待办部分作为决策真相源，清理台账（items 1–14）随文件移除。

## 决策

将前端增强待办统一纳入本 ADR 管理，作为后续 UI / 功能改动的评判基准与实施台账。已交付项沉淀为历史追溯，未交付项作为开放决策持续跟踪。

### 开放决策（待实施）

| 编号 | 增强项 | 优先级 | 状态 |
| ---- | ------ | ------ | ---- |
| E-1 | 列表/网格视图切换 | 低 | ⬜ 待开始 |
| E-2 | model2d 预览缓存 | 中 | ⬜ 待开始 |

**E-1 列表/网格视图切换（低）**

- **问题**：仓库列表只支持卡片视图，紧凑列表视图可提升浏览效率。
- **方案**：
  1. 在 `app-tree` 工具栏加切换按钮（🗂 网格 / ☰ 列表）
  2. 新增 `tpl-list-row.js` 紧凑行模板
  3. `render.js` 增加 `renderListView()` 模式
  4. 用户选择持久化到 `localStorage`
- **涉及文件**：`frontend/js/components/app-tree/tpl.js`、`render.js`、`row-tpl.js`（新）、`toolbar-events.js`

**E-2 model2d 预览缓存（中）**

- **问题**：浏览社区仓库时重复解析同一模型骨骼图，浪费 CPU。
- **方案**：
  1. 在 `utils/preview-cache.js`（已存在）扩展 2D 骨骼图缓存
  2. 缓存键：`sha256 + 文件大小`
  3. LRU 上限 50 项（已有）
  4. 命中时跳过 `ExtractYsmSummary` 调用
- **涉及文件**：`frontend/js/utils/preview-cache.js`、`features/community/events.js`

### 已完成项（历史追溯，非遗漏）

| 编号 | 增强项 | 落地版本 | 涉及文件 |
| ---- | ------ | -------- | -------- |
| F-1 | 下载哈希校验（SHA256SUMS + 不匹配删除） | v1.6.0 | `go/updater/update.go`、`build-release.ps1` |
| F-2 | Windows 自更新替换策略（独立 helper 替换 EXE） | v1.6.0 | `cmd/updater/main.go`、`go/updater/update.go`、`build-release.ps1` |
| F-3 | 导入日志文件位置迁移（`os.UserConfigDir()`） | v1.6.0 | `go/logs/logs.go` |
| F-4 | 标签系统数据后端 | v1.6.3 | `go/tags/tags.go`、`app_tags.go`、`dialogs/tag-editor.js` |
| F-5 | 系统暗色模式变化自动切换 | v1.7.5 | `frontend/js/app-modules.js` |
| F-6 | 右键"打开文件位置"（`RevealInExplorer`） | v1.7.5 | `app_files.go`、`wails.json`、`frontend/js/core/context-menus.js` |

> 注：F-1~F-6 若已有专属 ADR，以专属 ADR 为真相源；本表仅作跨版本追溯锚点。

## 实施范围

- **P（待实施）**：E-1、E-2 共 2 项，按上表「方案 / 涉及文件」落点推进。
- **已完成**：F-1~F-6 全部 ✅，属计划内沉淀，非遗漏。

## 后果

- **正面**：增强待办从「散落的任务清单」收敛为统一决策记录，与 ADR-015（动画系统）、ADR-016（UI 体验）形成前端治理三件套；原清理台账已随文件删除，决策内容不再与之混合。
- **负面 / 成本**：新增增强提案须直接登记到本 ADR 的开放决策 / 已完成项，不再写入独立台账。
- **约束**：E-1 / E-2 实施时若涉及动画，须复用 ADR-015 的 3 个固定 keyframe 与 `.stagger-in`，不得新定义。

## 关系

- 前置：`ADR-015`（统一动画系统）、`ADR-016`（UI 体验优化）
- 关联：`docs/governance-rules.md`（治理规则条文；原 `docs/core/CLEANUP_RULES.md` 已删除）
- 被引用：前端改动涉及「列表/网格」「预览缓存」时，以本 ADR 的 E-1 / E-2 为实施依据

## 数据溯源

- 来源文件：`docs/frontend/pending-cleanup.md`（已删除，2026-08-03）；增强待办（E-1 / E-2、F-1~F-6）已由本 ADR 承接，调试代码清理台账（items 1–14）随文件移除
- 治理依据：`AGENTS.md` 硬约束「写新 ADR 前先占号」；`docs/adr/README.md` 登记表
- 校验：`scripts/gen-docs-index.mjs --adr` + `scripts/adr-check.mjs`
