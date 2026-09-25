---
kind: frontend_test_audit
name: 前端测试基建审计
tier: architecture
category: core
source_files:
  - tests/test_resource_schema.ts
  - tests/test_mock_contract.ts
  - tests/test_bus_contract.ts
  - tests/test_cli_doc_parity.ts
  - tests/test_api_break.ts
  - tests/test_cli_completion_parity.ts
  - tests/test_check_layering.ts
  - tests/test_testid_contract.ts
  - tests/test_html_integrity.ts
  - tests/check-knowledge-drift-affected.ts
  - tests/verify-adr-042.ts
  - tests/test_codemod_guards.ts
  - tests/test_private_access_contract.ts
  - tests/test_scripts_json.ts
  - tests/test_config_defaults.ts
auto_fields:
  symbols_with_lines: []
affected: false
use_when:
  - 代码审核
  - 测试基建
  - 契约测试
  - e2e
  - flaky
  - 假绿
  - 覆盖盲区
status: snapshot
pitfalls:
  - "verify-adr-042 失败不 exit(1) → 假门禁（已修复，GAP_FOUND 应阻断 pre-push）"
  - "testid_contract 跳过测试文件 fixture HTML → 删真实钩子忘删 VIEW_TESTIDS 时契约仍绿"
  - "vi.useFakeTimers 不取消已挂起真实 timer → 跨用例污染断言；治本需模块级登记 + afterEach clearTimeout"
  - "装配层 mock 缺新导出 → 每次 boot 抛 No-export 误判初始化失败、toast 计数 +1 连锁红；源与 mock 导出面需同步（app-modules.boot 主题三件套案例）"
  - "test_config_defaults CI 无 UserConfigDir 时整体跳过 = 零覆盖假绿"
  - "orch-test 零断言属开发笔记不应进 tests/ → 应移至 poc/ 脱离套件"
  - "test_scripts_json 12 脚本串行 spawn 最坏 720s timeout → 可并行化或排除已知慢脚本"
quick_intents:
  - "审计前端测试基建覆盖率与质量"
  - "定位契约测试盲区（binding/mock/bus 协议漂移）"
  - "排查 e2e flaky / 假绿 / 残留 waitForTimeout"
  - "补测高交互路径（sync-manager/recycle-bin/import-queue/community）"
  - "治理测试耦合私有字段（孤儿守卫）"
invariant_anchors:
  - tests/test_bus_contract.ts|runOnFixture
---

# 前端测试基建审计

## 概览

2026-08-26 对测试基建层全量只读评审（两子代理并行）：`tests/*.ts` 契约层（33 文件，核心 4039 LOC；`port-verification/` 为一次性迁移诊断工具不计分）+ `frontend/e2e`（15 spec+3 支撑件 1668L）+ `e2e-web`（2 spec ~720L）。总分：契约层 **4/5**、e2e 整体 **4.3/5**。与 `frontend_repo_audit`（源码层）配套。

## 分层评分

| 层 | 分 | 一句话 |
|----|----|--------|
| tests/*.ts 资源 Schema 簇 | 4 | test_resource_schema 6 道 P0 守卫与 Go validateRegistrySchema 严格对齐 |
| tests 绑定契约簇 | 4.5 | mock_contract 双向扫描、bus_contract spawnSync+fixture 场景、android_bridge 锁 4 层隐式契约 |
| tests CLI/脚本门禁簇 | 4 | cli_doc_parity 三锁联防、api_break 真实 git ref 端到端 |
| tests 变更域/分层簇 | 4 | check_layering 纯函数+集成合体 |
| tests testid/文档簇 | 4.5 | testid_hooks 已并入 testid_contract（✅ 已修复）；html_integrity 空壳已移除（✅ 已修复） |
| tests 知识卡治理簇 | 4.5 | findStaleSnippets 12 种边界；perf-tags 端到端脏写测试 |
| tests 迁移验证簇 | 3 | verify-adr-042 失败不 exit(1) 是假门禁；theory-matrix-layout 零断言属开发笔记 |
| e2e 桌面 | 4 | testid 使用率 ~90%、mock 单源双向编译期校验、flaky 防御到位 |
| e2e-web | 4.5 | 真实链路无 mock + IDB 直读断言 + pageerror 零容忍，与桌面 mock 模式互补 |

## 高优先级发现

1. **契约盲区**：近期四大重构均无对应契约测试——createWorkerBridge 工厂、backend/runtime.ts 桥收口、model2d 三件拆分、dedupConfig。前两者影响面最大。~~**已补测**（2026-08-26）：`worker-bridge.test.ts`（20 case，覆盖 resolve/reject 双模式往返、超时、onerror 两分支、dispose/clearPending、id 递增+round-robin）+ `runtime.test.ts`（6 case，覆盖桌面透传/web no-op 桩/导出面锁定）。~~
2. **假门禁**（✅ 已于 2026-08-26 修复）：verify-adr-042.ts 已补 `process.exit(1)` 门禁（GAP_FOUND 即阻断 pre-push）；theory-matrix-layout.mjs 零断言已 `git mv` 至 `poc/theory-matrix-layout.mjs` 脱离 tests/ 套件。
3. **冗余**（✅ 已于 2026-08-26 修复）：test_testid_hooks 的 4 个 tree-* testid 已被 test_testid_contract 注册表（row-tpl.ts 四项）覆盖；其独有的 2 项 G-1 基础设施存在性检查（test-utils/index.ts、app-tree.state.test.ts）已作为前导并入 test_testid_contract，test_testid_hooks.mjs 已删除。html_integrity 的 module script 检查（no-op 双空分支）已移除，保留真实 script-src 物理文件校验。
4. **e2e-web 重复**：dropFile/allShadowText/idbKeys/clearIdb 四辅助函数在两个 spec 完全重复 ~120L，应抽 e2e-web/helpers.ts。
5. **契约真实性（✅ 2026-08-30 修复，ADR-133）**：test_testid_contract.mjs 补反向孤儿扫描（关键前缀 testid 未登记 → 红）+ canonical 修复指引（删条目、禁补假按钮）；**跳过测试文件**——fixture HTML 字面量不再算真实钩子（否则删真实钩子忘删 VIEW_TESTIDS 时契约仍绿，G-1「删能红」被静默打穿）；两趟遍历合并单趟（消双重 readFileSync）。
6. **真竞态：useFakeTimers 不取消已挂起真实 timer（✅ 2026-08-30 修复）**：app-modules.boot.test.ts 上一用例 boot 的 IIFE 注册真实 `setTimeout(2000)`（stats.worker 预取），`vi.useFakeTimers()` 只劫持新注册定时器、**不取消已挂起的真实定时器**，会在下一用例 await 间隙触发污染断言。治本：**文件级登记真实 timer（模块级 Set，boot 内 spy 全局 setTimeout 透传登记句柄）+ afterEach 统一 clearTimeout**。坑（实测踩过）：spy 全局 setTimeout 与 `vi.useFakeTimers` 的恢复链互相干扰——fake 用例里 spyOn 保存/恢复的是 fake 实现，会把全局 setTimeout 恢复错乱，导致后续用例 flush 泵挂起 20s 超时；故 spy 仅在真实计时器环境激活（`microFlush` fake 用例不登记，其 timer 由 advance + useRealTimers 丢弃）。另：重装配用例（resetModules + 动态 import + 20 轮宏任务泵）负载下易超默认 5s testTimeout，文件级 `vi.setConfig({ testTimeout: 20000 })` 放宽。
7. **测试耦合私有字段治理第一道闸（✅ 2026-09-01 落地，ADR-147）**：`tests/test_private_access_contract.ts` 孤儿守卫——扫描 app-tree 测试对私有字段的写入（`. _xxx =`）与断言（`as unknown as X & {` / `as X & {`，支持跨行，括号平衡窗口收集全部 `_xxx`），引用了已从 AppTree 类删除的字段即红。已实证捕获 `_typeFilter` 死字段自证用例；跨行形态（`as unknown as AppTree & {` 换行 `_filterPaths:`）与 `as HTMLElement & {` 均覆盖（code_review 洞已补，4378e57b）。后续删私有字段时测试残留引用会被此契约拦截；终态收敛层 `test-internals.ts` 未建。
8. **装配层 mock 导出面与新导出失步（✅ 2026-09-21 修复，commit 316f6550d）**：`app-modules.boot.test.ts` 的 theme-core mock 缺 `applyThemeAuto`（commit 721b33ff8 在启动链 `initTheme` 后新增 `applyThemeAuto()` 调用，但 boot 测试的 mock 导出面未同步）→ 每次 boot 抛「No applyThemeAuto export」被当成主题初始化失败，theme 步骤 toast 计数 +1 连锁 6 条用例红（registerErrorDiary/i18n/app-nav/ui-prefs 的 toast 断言 + 系统主题跟随两例）。**成因**：boot 测试用 hoisted mock 池 + `vi.mock` factory 双处声明，源侧新增导出只需补一处即漏。治本原则：改 `theme-core.ts` / `app-modules.ts` 启动链后，同步核对 boot 测试的 `m.hoisted` 池与 `vi.mock("./theme-core.ts")` factory 两处导出面。

## 中低优先级

- test_scripts_json 12 脚本串行 spawn 最坏 720s timeout，可并行化或排除已知慢脚本
- test_cli_doc_parity:81 硬编码命令数下限 `>=38` 手动维护易忘
- test_config_defaults CI 无 UserConfigDir 时整体跳过 = 零覆盖假绿，**✅ 已于本轮（2026-09）修复**：`cfg === null` 分支在 CI（`CI`/`GITHUB_ACTIONS`）下显式 `process.exit(1)` + 明确报错；本地首次运行打印 `SKIP` 标注并 exit 0（合法首跑不误伤）。
- node:assert 与 node:assert/strict 混用；check-knowledge-drift-affected ROOT 用 process.cwd() 应改 import.meta.url
- e2e 残留 waitForTimeout（**本轮 2026-09 复核现状**）：审计快照记「2 处」数量仍准，但**行号已漂移**——`preview.spec.ts:321→246`、`file-tree.spec.ts:40→42`（均为固定 sleep 后跟轮询，属 flake 源）。`sidebar-menu.spec.ts:42/63` 的 `waitForTimeout` 在 `while` 轮询循环内作轮询节拍，**非固定等待、非 flake 源，不动**。✅ 本轮已删除 preview/file-tree 两处固定 sleep，改由后续 `waitForPreviewEl`/`waitForTreeCount` 轮询吸收。
- e2e 文本定位器 4 处硬编码文案（已选 N）：tree-multiselect `已选\s*(\d+)`、context-menu「已复制到剪贴板」、workshop「B站」、diagnostics「No logs yet」——locale 固定 en-US 下可接受，i18n 化时需同步

## 治理复核

- R5 `settings.spec.ts:127` 判定：`rgba(0,0,0,0)` 是否定断言哨兵值（证 shadow DOM CSS 隔离生效），**诊断豁免成立非问题**。

## 覆盖盲区（对照 views）

- **sync-manager 执行链路**：审计时（2026-08-26）仅 e2e 页面切换、未覆盖 push/pull 执行；**✅ 已由 `frontend/src/features/sync/sync.test.ts`（351 行 / 13 case，覆盖 download-missing + toggle-status 的成功/失败/并发守卫/配置缺失/边界）补齐**——执行逻辑归单测守护，e2e 仍只测「按钮可见 + 页切换」（sync-manager.spec.ts）。
- **recycle-bin**：审计时列「完全无 e2e」。**✅ 已于本轮（2026-09）补 `frontend/e2e/recycle-bin.spec.ts`**——覆盖 repository 页 → recycle 子 tab 切换 + 清空/刷新控件真实可见 + 条目级 restore/delete 钩子（有条目时）。`npx playwright test recycle-bin.spec.ts` → 2 passed。
- **community（创作者频道页）**：审计时列「完全无 e2e」系**快照过期**——实际 `frontend/e2e/workshop.spec.ts` 早已覆盖（navItem("community") → ws-tabs 站点 tab 动态渲染 + 默认选中）。执行逻辑另由 community/*.test.ts 单测守护。
- **import-queue（= community download-queue）**：**仍无 e2e 且当前无法低flake补测**——源码 `features/community/download-queue*.ts` / roles-views / slide-menu **无任何 data-testid 钩子**（grep `dlq|import|queue|download` testid = 0 命中），仅用 innerHTML+UI_ICONS 渲染。补 e2e 需先给 download-queue UI 加 testid（属源码改动，超出本轮测试范围）；其执行逻辑已由 `download-queue.test.ts` + `download-queue-ui.test.ts` + `download-queue-store.test.ts` 单测覆盖。结论：**该盲区应标为「受阻：待源码插桩」，而非「未补」**——盲写 CSS/XPath e2e 违反 AGENTS.md 禁 flake 原则，属假覆盖。

## 不变量

- tests/*.ts 保持 Node 零依赖（仅 node:* + ../scripts/），失败必须 exit(1)——凡进 tests/ 的脚本要么是真门禁要么移走
- e2e 定位器默认走 data-testid（helpers 统一入口）；新增等待一律轮询/expect.poll，禁新增 waitForTimeout
- mock 数据只出自 e2e/mock-data.ts 单源（编译期双向校验兜底），禁止 spec 私造
- 双边锁定测试是防漂移核心资产：改动 binding/mock/bus 协议须同步对应契约测试

## 相关

- [frontend_repo_audit](frontend_repo_audit.md)：源码层对应审计卡
- [cli_quality_audit](cli_quality_audit.md)：Go 侧审计沉淀
