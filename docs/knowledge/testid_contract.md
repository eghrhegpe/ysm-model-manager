---
kind: testid_contract
name: testid 契约与 VIEW_TESTIDS 注册表
tier: architecture
category: ui
status: draft
source_files:
  - tests/test_testid_contract.ts
  - frontend/src/views/app-content/tpl.ts
auto_fields:
  symbols_with_lines:
    - diagnosticsHTML
    - githubHTML
    - instancesHTML
    - repositoryHTML
    - VIEW_TESTIDS
    - workshopHTML
use_when:
  - 在 frontend/src 任何位置新增 data-testid / dataset.testid / buttonTestid / panelTestid
  - 修改某个视图的 VIEW_TESTIDS 数组
  - testid 契约测试报 ORPHAN 或 MISSING
  - 想给诊断页/仓库页/工坊等顶层 tab 补测试钩子
pitfalls:
  - VIEW_TESTIDS 数组字面量（含其内部注释）禁止出现裸 `]`——契约测试用非贪婪正则 `export const VIEW_TESTIDS ... = [([\s\S]*?)]` 取数组体，遇到注释里的第一个 `]` 会提前截断，导致数组后半段全部失注册、集体被判 ORPHAN（2026-09-25 实证：tpl.ts 注释 `.repo-tab[data-tab=...]` 触发整页 diag-*/ws-* 失注册）
  - 命中 KEY_PREFIXES 的 testid 必须进某视图的 VIEW_TESTIDS，否则判 ORPHAN
  - 注册了却不出现在任何源码字面量（data-testid / dataset.testid / buttonTestid / panelTestid）→ 判 MISSING（G-1 删钩子能红，靠 seen 集不包含 VIEW_TESTIDS 自身保证）
quick_groups:
  - frontend/src 内所有 data-testid 字面量
  - 各视图 VIEW_TESTIDS 数组声明
quick_intents:
  - 给页面顶层 tab 按钮加测试钩子
  - 给子 pill 行加稳定测试钩子（renderSubBar 已派生 data-testid）
quick_risk_lines:
  - VIEW_TESTIDS 数组内注释出现 `]`
  - 新增 testid 忘记登记 VIEW_TESTIDS
invariant_anchors:
  - tests/test_testid_contract.ts|VIEW_TESTIDS
  - tests/test_testid_contract.ts|KEY_PREFIXES
---

# testid 契约与 VIEW_TESTIDS 注册表

## 概览

`tests/test_testid_contract.ts`（ADR-133 阶段 B）是前端测试钩子的红线门禁：所有 `data-testid`
必须「声明于某视图的 `VIEW_TESTIDS`」且「在源码有对应字面量」。它取代手工维护的注册表，
改为单趟遍历 `frontend/src` 聚合。诊断页修复（`11a1db05d`）期间，一次注释改动触发了它的误报，
由此暴露一个**通用地雷**，值得单独立卡。

## 核心职责

契约测试做三件事：

1. **注册表聚合**：用正则 `export const VIEW_TESTIDS: readonly string[] = [([\s\S]*?)]` 从各视图
   顶部 `VIEW_TESTIDS` 数组提取声明的 testid，首个声明为准。
2. **孤儿扫描（ORPHAN）**：源码中 `data-testid="..."` / `dataset.testid="..."` /
   `buttonTestid:"..."` / `panelTestid:"..."` 字面量，命中 `KEY_PREFIXES`
   （`tree-` `sm-` `gh-` `ctx-` `dlg-` `recy-` `sidebar-` `nav-` `content-` `toast` `diag-`
   `ws-` `set-` `ins-`）却**未**进任何 `VIEW_TESTIDS` → 判 ORPHAN。
3. **缺失扫描（MISSING）**：声明于 `VIEW_TESTIDS` 却没在源码字面量出现 → 判 MISSING。
   靠 `seen` 集**不包含** `VIEW_TESTIDS` 自身保证——否则「删真实钩子忘删声明」会被静默打穿。

## 对外 API / 入口

- 视图侧：`export const VIEW_TESTIDS: readonly string[] = [...]`（每个视图文件顶部一份）。
- 模板侧：`renderSubBar(group, items, activeId, ariaLabel)`（`tabs-shell.ts`）已自动派生
  `data-testid="diag-sub-<group>-<id>"`，无需手写。
- 顶层 tab 按钮：通过 `TabSpec.buttonTestid` 声明（如诊断页 `"diag-tab"`），由 `renderTabs`
  写进 `data-testid` 并自动纳入 `VIEW_TESTIDS` 登记面。

## 与其他子系统关系

- 与 `app-content/tpl.ts` 强耦合：`VIEW_TESTIDS` 数组是契约测试的**唯一事实源**，模板里新增
  顶层 tab / 子 pill 的钩子必须同步进对应数组。
- 与 i18n/预提交门禁正交：本契约只在「红线合规」阶段被 `commit-with-check` 调用，不参与 locale 校验。

## 不变量

- **`VIEW_TESTIDS` 数组字面量（含其内部注释）中禁止出现裸 `]` 字符。**
  正则 `\[([\s\S]*?)\]` 是非贪婪匹配，遇到数组体内**第一个** `]` 即终止捕获。若注释里写了
  `]`（如 `[data-tab=...]`、`array[0]` 之类描述），捕获就在该注释处截断——数组后半段全部
  失注册，连带老牌 testid（如 `diag-log`）也被误判 ORPHAN。
  **反例（已修）**：`tpl.ts` 注释 `// 测试只能靠 .repo-tab[data-tab=...] 抓 class` 触发整页
  `diag-*` / `ws-*` / `ins-content` 失注册；删掉注释里的 `]` 后复跑 ORPHAN=0、MISSING=0。
  **写法约定**：需要举例方括号时改用中文描述（「方括号选择器」）或拆词，绝不在 `VIEW_TESTIDS`
  数组附近写 `]`。
- 命中 `KEY_PREFIXES` 的关键 testid 必须有归宿，否则 ORPHAN 必红。

## 相关

- `docs/knowledge/app_content_diagnostics.md`（bench 双轨显隐 / 诊断页结构，含 `VIEW_TESTIDS` 登记面）
- `frontend/src/views/app-content/tabs-shell.ts`（`renderSubBar` / `bindSubBar` 钩子派生）
- `frontend/src/views/app-content/tpl.ts`（`VIEW_TESTIDS` 声明 + 顶层 tab `buttonTestid`）
