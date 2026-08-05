# 验证记录 — `import-queue.ts` 模块（子代理审核流水线实跑）

> 目的：验证「大模块审核子代理流水线」（subagent-review-playbook.md）的合理性，重点验证「子代理与主模型思维链不互通」这一核心约束是否会被流水线消化。
> 验证日期：2026-08-05

---

## 1. 验证目标

- 模块：`frontend/src/features/import-queue.ts`（本轮未改动，保证冷审查）
- 知识卡单元：`docs/knowledge/import-queue.md`
- 验证命题：**子代理思维链对主模型不可见的前提下，流水线仍能产出可信、可独立核实的审查结论。**

---

## 2. Phase 0 / Phase 1 执行记录

**Phase 0 — 知识库诊断**
```
node scripts/doctor.mjs --docs
  [OK] link-checker.mjs
  [OK] check-knowledge-drift.mjs
  [OK] adr-check.mjs
  [OK] check-doc-drift.mjs / check-adr-health.mjs / gen-docs-index.mjs ...
  [OK] Git Status: clean
```
结论：知识库可信，进入扇出。

**Phase 1 — 发散种子**
```
node scripts/ai-mistake-tracker.mjs --limit 12 --json
  fix_chains: 状态多源/三源不同源(DnD 遮罩失效根因) / 半截文件清理 / 临时诊断埋点遗留
  file_hotspots: page-store.ts(2) / dnd.ts(2) / recycle.go(2)
```
结论：反模式锚定「状态一致性」「半截文件」「生命周期清理缺失」，作为子代理优先关注项。

---

## 3. 子代理结论摘要（结构化报告，主模型未读其思维链）

- **总体结论**：有条件通过。主链路正确，但存在 5 处 P2。
- **P2 关键项**：
  1. `import:pending-files` 子系统在生产已死（`PendingImport.setQueue/setFolders` 无生产调用方，事件无生产 emit）。
  2. `DnDLock` 惰性化：生产唯一 `acquire()` 在死路径，`dnd.ts:115` 守卫永假。
  3. `import-queue.ts` 15 个顶层 `addEventListener` 零 `removeEventListener`，cleanup 不移除。
  4. `currentBase64 || ""` 可静默落 0 字节文件。
  5. `⚠️ 重名预警` 因 `repoFiles` 异步时序恒不显示。
- **知识卡漂移**：12 处不符，含 3 处方向性错误（最重：`shouldEnterForm` 现仅 `ysm.json` 进表单，卡片称 `.ysm`/`ysm.json` 恒进表单）。

---

## 4. 主模型独立复核（Phase 3 verify，不依赖子代理思维链）

| # | 子代理结论 | 主模型独立核实（命令/源码） | 判定 |
|---|---|---|---|
| 1 | `import:pending-files` 无生产 emit | `Grep` 全仓：仅 `bus.ts:95` 类型声明 + `import-queue.test.ts` 测试 emit，无生产 `.ts` emit | ✅ 证实 |
| 2 | `DnDLock` 生产惰性化 | `Grep DnDLock.(acquire\|locked\|release)`：生产 `acquire()` 仅 `import-queue.ts:837`（死路径）；`dnd.ts:115` 读 `.locked` 但永真源缺失 | ✅ 证实 |
| 3 | `shouldEnterForm` 仅 `ysm.json`→true | `Read dnd-shared.ts:22-29`：`if (ext===".json" && name==="ysm.json") return true; return false;` | ✅ 证实（知识卡方向性漂移） |
| 4 | 15 顶层 `addEventListener` 零解绑 | `Grep` 全文件：15 处 `addEventListener`、0 处 `removeEventListener`，cleanup 仅 `clearTimeout`+2 bus unsub | ✅ 证实 |

复核方法：主模型仅用 `Grep`/`Read` 直接读源码，未读取子代理任何中间推理。

---

## 5. 结论

- **流水线合理**：Phase 0 诊断确认知识库可信 → Phase 1 反模式锚定发散方向 → Phase 2 子代理限定上下文只读审查 → Phase 3 主模型独立 verify。四阶段闭环成立。
- **「思维链不互通」被消化而非放大**：子代理在完全隔离的上下文中，仅凭 `source_files` + 知识卡 + 显式 rubric，产出了 4 项可被主模型独立读源码逐一证实的高影响结论。主模型无需子代理的思维链即可完成可信复核——这正是 §4 结构化输出契约 + §5 verify 协议的设计意图。
- **附带产出**：本次验证同时暴露 `import-queue.ts` 的真实技术债（pending 子系统死代码、`DnDLock` 惰性化、监听器泄漏、知识卡 12 处漂移），建议另起一轮按特性 scope 处理，不并入本次方法论验证。
