---
kind: knowledge_frontend_drift_audit
name: 知识库×前端语义脱节审计
tier: architecture
adr:
  - ADR-132
category: ui
status: snapshot
affected: false            # 审计快照卡：结论指向具体文件，不随单次文件变更提示复核
source_files:
  - frontend/src/views/app-nav/index.ts
  - frontend/src/views/app-content/index.ts
  - frontend/src/views/app-tree/toolbar-search.ts
  - frontend/src/preview-3d/state/preview-paths.ts
  - frontend/src/theme-core.ts
  - frontend/src/app-modules.ts
  - frontend/src/views/app-preview/skeleton-fill-panel.ts
  - frontend/src/features/context-menu/context-menu-handlers.ts
  - scripts/check-knowledge-drift.ts
tests:
  - frontend/src/app-modules.boot.test.ts
  - frontend/src/app-modules.test.ts
  - frontend/src/test-utils/index.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-preview/skeleton-fill-panel.test.ts
  - frontend/src/views/app-sync-manager/index.branches.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/index.extra.test.ts
  - frontend/src/views/app-tree/toolbar-search.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 知识库脱节
  - 幽灵事件
  - nav:changed
  - invariant_anchors
  - status 字段
  - 机制锚
  - 卡片漂移
quick_groups:
  - 知识库治理与审计
quick_intents:
  - 知识库与代码脱节清单、幽灵事件
  - invariant_anchors 定义归属、status 收编
quick_risk_lines:
  - 知识卡正文写事件名/计数/归属前必须先 grep 生产代码实证，禁止凭记忆或测试名推断（nav:change→nav:changed 教训）
  - invariant_anchors 的弱断言只验「文本出现」不验「定义归属」——锚应指定义文件，指 import/re-export/注释处会让 AI 摸错文件
pitfalls:
  - 把测试文件的 it() 描述名当权威 → 测试名与断言名实不符是系统性问题（nav:change 残留测试层）
  - 用「2026-XX」占位日期 → 掩盖"已完成 vs 待办"，AI 分不清；完成项填实际日期、计划项标「待办」
invariant_anchors:
  - frontend/src/views/app-content/index.ts|nav:changed
  - frontend/src/preview-3d/state/preview-paths.ts|KNOWN_PATHS
---

# 知识库×前端语义脱节审计

## 概览

2026-09-05 三子代理串行只读锐评（views+features / preview-3d+parsers / core+ui+utils+backend），主模型逐条抽查背书。审计对象：`docs/knowledge` 166 张知识卡 × 前端实现的**语义脱节**（非机器可查的路径漂移——`check-knowledge-drift --json` 基线 0 error / 0 warn，机器层全绿，脱节全在语义层）。

**总判**：机器层全绿是一次完美伪装——语义层藏着 3 个幽灵事件、1 个定义归属校验盲区、1 批计数失真、目录级 source_files 精度退化与 17 处卡片缺口。最该修的**不是任何一张卡，是校验器本身**。

## 审计方法

- 三域切分防限流：A views+features(27 卡) / B preview-3d+parsers(26 卡) / C core+ui+utils+backend(51 卡)
- 每份报告主模型抽查最强断言（grep 实证源码，不信报告原文）
- 三条子代理失误教训（后卡吸收）：① 漏测测试层残留 ② 句子归属错卡 ③ re-export 误判为"找不到符号"

## 确认脱节清单（抽查背书，修复状态随 git 演进）

### P0 — 会直接让 AI 写出断裂的代码

| 幽灵事件 | 实证 | 修复 |
|---|---|---|
| `nav:change`（app-nav.md / app-content.md） | `git log -S` 溯源 `4e4e3494`（2026-08-17）从 bus.ts **删除 nav:change 契约**统一为单事件 `nav:changed`；生产代码仅 `nav:changed`（app-nav/index.ts:40,198 emit / app-content/index.ts:144 on / page-store.ts:68 on） | ✅ `e33e1f49` 五卡叙事统一 + 测试名回填 |
| `nav:change` 残留测试层 | app-nav/index.test.ts:121 `it("点击 nav-item → 发射 nav:change")` 实际断言 `bus.on("nav:changed")`——测试名与注释系统性名实不符 | ✅ `e33e1f49` it 名回填 |
| `filter:results`（dialog-adv-filter.md:69,76） | 前端全项目 grep 零命中；真实流程 = `toolbar-search.ts` 调 `SearchModels` → 写 `AppTree._filterPaths`；Design.md D6 已登记"已清理移出契约" | ✅ `e33e1f49` 改指真实流程 |

### P1 — 描述失真 / 归属错位

| 问题 | 实证 | 修复 |
|---|---|---|
| `ClearScanCache` 仍在切页路径（app-content.md） | app-content 生产代码零调用（index.ts:146 注释"不再每次 nav:changed 清扫描缓存"）；仅测试 mock | ✅ `e33e1f49` |
| `KNOWN_PATHS` 计数 9→11（preview-settings.md / preview_menu_settings_state.md） | `preview-paths.ts:24-44` 实为 11 项（ADR-125 六条 → ADR-126 扩） | ✅ `029721d4` |
| invariant_anchors 定义归属错位（theme / preview_menu_session_key / app-tree / app_cycle_injection / app_content_diagnostics / app-modules） | 锚指 import/re-export/注释处：`app-modules.ts\|normalizeTheme`(真义 theme-core.ts:17)、`ysm-adapter.ts\|buildYsmModelSchema`(真义 skeleton-fill-panel.ts:359, ysm-adapter 仅注释)、`bus-handlers.ts\|selectState`(真义 data.ts:4) | ✅ `029721d4` 七卡锚点改指定义文件 |
| 校验器盲区（机制级） | `checkKnowledgeAnchors` 弱断言（子串包含）不验定义归属；287 锚中 ref-only 高置信 4-5 个 | ✅ `029721d4` 增强 + 契约测试 |
| 目录级 source_files 精度退化 | model3d.md→preview-3d/（⏳ 结论已修正：**无需拆卡**——72 处引用含指向 model3d.ts 单文件与渲染层整体的混合查询，实为「单文件名打头的域总览卡」，source_files 用目录是恰当粒度，同 ui_components/test-utils）；resource-packs.md→views/app-nav/（✅ 结论已修正：**归档卡无需改**——status: archived + affected:false + pitfalls 已明示功能删除与迁移路径，source_files 指当初关联组件属归档卡可接受） | ✅ 无待办 |
| context-menu HANDLERS 归属 | `HANDLERS` 拆至 `context-menu-handlers.ts:161`，context-menus.ts:9 仅消费 | ✅ `31bf4ae5` |
| core_utils 漏 nbt-guards.ts | `utils/core/` 实有 6 非测试文件，正文表格只列 5 | ✅ `31bf4ae5` |
| 「2026-XX」占位日期（context-menu / i18n / utils-dom） | git log -S 溯源全部完成于 **2026-08-30 P3 收敛批**（be99f7ee/42179349/eb01dcdb/98eadbf9/a200c5e7）；一处（对账升级）实为**未完成待办**被 XX 掩盖 | ✅ `5d5a20b0` 完成项填日期、计划项标「待办(P2)」 |

### 机制级发现：status 字段野生化（2026-09 收编）

审计中确认 `status:` 是 151 卡自发手写、**模板不生成、零脚本消费、零值域校验**的野生字段；且无 draft 槽位表达起草/待办——ADR「✅ 已采纳」只表采纳不表实施（设计有意），被赶去知识卡的"实施进度"却无结构化接住（断层）。收编为正式字段：CARD_STATUS 词表 + draft 槽位 + snapshot/affected 联动校验 + 模板默认 draft。

## 遗留缺口（建议补卡，未执行）

- `utils/dom/capabilities.ts`（viewer 能力门控，21+ 消费点）、`features/repo-rtype.ts`（资源类型状态枢纽）、`preview-3d/menu/`（声明式菜单系统）、`preview-3d/state/preview-paths.ts`（KNOWN_PATHS 契约锚点）、`features/dnd-shared.ts`（WebView2 DnD）、下载队列（download-queue-store + download-tasks）、`backend/runtime.ts`、`features/community/virtual-list.ts`（✅ 已立卡，见立卡批）
- model3d.md 结论已修正：**无需拆卡**（域总览卡定位合理）；resource-packs.md 结论已修正：**归档卡无需改**（status: archived + pitfalls 已明示功能删除迁移路径）

## 修复后校验器状态

- `check-knowledge-drift.ts` 现含：source_files 存在性/格式/语义、invariant_anchors 弱断言 + **定义归属增强(WARN)**、正文禁行号/计数、**status 词表校验(ERROR) + snapshot/affected 联动(WARN)**、覆盖盲区、affected 匹配
- 全量基线：0 ERROR / 4 WARN（皆"机制出现语义"可接受：deleted_link 字符串动作 / StatusCode 字段消费 / ldflags 构建参数 / mmdMenuItems 优化日志 re-export）

## 相关

- [frontend_design_critique](./frontend_design_critique.md) — 2026-09-05 前端设计锐评（并行审计，主模型抽查背书同款方法论）
- [frontend_repo_audit](./frontend_repo_audit.md) — 2026-08-26 代码质量审计（本卡基线）
- 修复提交：`029721d4` `e33e1f49` `31bf4ae5` `5d5a20b0` `98c13f6d`
