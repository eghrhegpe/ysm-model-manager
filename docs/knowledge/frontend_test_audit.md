---
kind: frontend_test_audit
name: 前端测试基建审计
tier: architecture
category: core
source_files:
  - tests/
  - frontend/e2e/
  - frontend/e2e-web/
use_when:
  - 代码审核
  - 测试基建
  - 契约测试
  - e2e
  - flaky
  - 假绿
  - 覆盖盲区
---

# 前端测试基建审计

## 概览

2026-08-26 对测试基建层全量只读评审（两子代理并行）：`tests/*.mjs` 契约层（33 文件，核心 4039 LOC；`port-verification/` 为一次性迁移诊断工具不计分）+ `frontend/e2e`（15 spec+3 支撑件 1668L）+ `e2e-web`（2 spec ~720L）。总分：契约层 **4/5**、e2e 整体 **4.3/5**。与 `frontend_repo_audit`（源码层）配套。

## 分层评分

| 层 | 分 | 一句话 |
|----|----|--------|
| tests/*.mjs 资源 Schema 簇 | 4 | test_resource_schema 6 道 P0 守卫与 Go validateRegistrySchema 严格对齐 |
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
2. **假门禁**（✅ 已于 2026-08-26 修复）：verify-adr-042.mjs 已补 `process.exit(1)` 门禁（GAP_FOUND 即阻断 pre-push）；theory-matrix-layout.mjs 零断言已 `git mv` 至 `poc/theory-matrix-layout.mjs` 脱离 tests/ 套件。
3. **冗余**（✅ 已于 2026-08-26 修复）：test_testid_hooks 的 4 个 tree-* testid 已被 test_testid_contract 注册表（row-tpl.ts 四项）覆盖；其独有的 2 项 G-1 基础设施存在性检查（test-utils/index.ts、app-tree.state.test.ts）已作为前导并入 test_testid_contract，test_testid_hooks.mjs 已删除。html_integrity 的 module script 检查（no-op 双空分支）已移除，保留真实 script-src 物理文件校验。
4. **e2e-web 重复**：dropFile/allShadowText/idbKeys/clearIdb 四辅助函数在两个 spec 完全重复 ~120L，应抽 e2e-web/helpers.ts。
5. **契约真实性（✅ 2026-08-30 修复，ADR-133）**：test_testid_contract.mjs 补反向孤儿扫描（关键前缀 testid 未登记 → 红）+ canonical 修复指引（删条目、禁补假按钮）；**跳过测试文件**——fixture HTML 字面量不再算真实钩子（否则删真实钩子忘删 VIEW_TESTIDS 时契约仍绿，G-1「删能红」被静默打穿）；两趟遍历合并单趟（消双重 readFileSync）。
6. **真竞态：useFakeTimers 不取消已挂起真实 timer（✅ 2026-08-30 修复）**：app-modules.boot.test.ts 上一用例 boot 的 IIFE 注册真实 `setTimeout(2000)`（stats.worker 预取），`vi.useFakeTimers()` 只劫持新注册定时器、**不取消已挂起的真实定时器**，会在下一用例 await 间隙触发污染断言。治本：**文件级登记真实 timer（模块级 Set，boot 内 spy 全局 setTimeout 透传登记句柄）+ afterEach 统一 clearTimeout**。坑（实测踩过）：spy 全局 setTimeout 与 `vi.useFakeTimers` 的恢复链互相干扰——fake 用例里 spyOn 保存/恢复的是 fake 实现，会把全局 setTimeout 恢复错乱，导致后续用例 flush 泵挂起 20s 超时；故 spy 仅在真实计时器环境激活（`microFlush` fake 用例不登记，其 timer 由 advance + useRealTimers 丢弃）。另：重装配用例（resetModules + 动态 import + 20 轮宏任务泵）负载下易超默认 5s testTimeout，文件级 `vi.setConfig({ testTimeout: 20000 })` 放宽。

## 中低优先级

- test_scripts_json 12 脚本串行 spawn 最坏 720s timeout，可并行化或排除已知慢脚本
- test_cli_doc_parity:81 硬编码命令数下限 `>=38` 手动维护易忘
- test_config_defaults CI 无 UserConfigDir 时整体跳过 = 零覆盖假绿，建议强制 FAIL 或显式 skip 标注
- node:assert 与 node:assert/strict 混用；check-knowledge-drift-affected ROOT 用 process.cwd() 应改 import.meta.url
- e2e 残留 2 处 waitForTimeout：preview.spec.ts:321、file-tree.spec.ts:40（后者有轮询兜底纯冗余）
- e2e 文本定位器 4 处硬编码文案（已选 N）：tree-multiselect `已选\s*(\d+)`、context-menu「已复制到剪贴板」、workshop「B站」、diagnostics「No logs yet」——locale 固定 en-US 下可接受，i18n 化时需同步

## 治理复核

- R5 `settings.spec.ts:127` 判定：`rgba(0,0,0,0)` 是否定断言哨兵值（证 shadow DOM CSS 隔离生效），**诊断豁免成立非问题**。

## 覆盖盲区（对照 views）

sync-manager 仅覆盖页面切换未覆盖实际 push/pull 执行链路；recycle-bin / import-queue / community 三条用户高交互路径完全无 e2e——补测优先级 P3。

## 不变量

- tests/*.mjs 保持 Node 零依赖（仅 node:* + ../scripts/），失败必须 exit(1)——凡进 tests/ 的脚本要么是真门禁要么移走
- e2e 定位器默认走 data-testid（helpers 统一入口）；新增等待一律轮询/expect.poll，禁新增 waitForTimeout
- mock 数据只出自 e2e/mock-data.ts 单源（编译期双向校验兜底），禁止 spec 私造
- 双边锁定测试是防漂移核心资产：改动 binding/mock/bus 协议须同步对应契约测试

## 相关

- [frontend_repo_audit](frontend_repo_audit.md)：源码层对应审计卡
- [cli_quality_audit](cli_quality_audit.md)：Go 侧审计沉淀
