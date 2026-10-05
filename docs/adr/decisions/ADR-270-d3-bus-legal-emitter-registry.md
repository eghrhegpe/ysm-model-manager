# ADR-270-d3：bus 合法发射者登记表闸（刀 B）：发射端从自由裸 emit 收敛为在册登记

- **状态**：✅ 已采纳（Adopted，2026-10-05；耦合全景 v2 报告刀 B，用户「继续」授权推进、方案呈报后「尝试实施」拍板）
- **日期**：2026-10-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-270

---

## 背景（一句）

耦合全景 v2 病根 #5「bus 扇入」：event-graph 只查事件是否声明/缺参/孤儿/鬼订阅，**不查「谁有权发射」**——发射端完全自由（toast:show 52 文件 172 点、stats:refresh 17/26、tree:reload 11/15，全仓发射端去重 66 文件），新代码随手裸 `bus.emit` 无任何摩擦，扇入只增不减。

## 决策（三行）

1. event-graph.ts 增「合法发射者」登记表闸：`docs/.bus-emitters.json` 登记 `{事件: [合法发射文件]}`，扫描到登记表外的文件发射该事件 → `emitterAdditions` **硬错误**（--strict 阻断，与未声明/缺参/漂移同级）；登记表有而扫描无（已收敛条目）→ `emitterRemovable` 仅提示不阻断。
2. 首版由 `--update` 按当前扫描自动种入全部 66 发射文件（现状即合法，**不重构代码**）；此后只减不增——新增发射文件必须先 `--update --force` 显式登记（承认在册发射者）或改走既有收敛通道，收敛动作（如 toast 助手化）从表里删条目即为量化抓手。
3. 口径：仅扫生产文件（collectSrcFiles 已排除 *.test/*.spec，测试发射天然豁免）；HTML 内联发射同表登记；登记表缺失 = 闸未武装（--update 种入前不阻断，fixture/新仓无感）；粒度=文件级，仿 R10 精确闭集。

## 后果（一句）

发射端从「自由裸 emit」变为「登记在册、新增即红、只减不增」——扇入膨胀被闸锁死，toast:show 收敛（172→助手单点）成为可逐项销账的后续战役；回退 = 摘 event-graph.ts 登记表段 + 删 docs/.bus-emitters.json + 还原测试与文档，闸独立于 event-graph 既有五类检查，不影响 R1-R10 分层基线。

<!-- 文件名: bus-legal-emitter-registry.md → 实际文件 decisions/ADR-270-d3-bus-legal-emitter-registry.md（ADR-320 decisions 轻量模板） -->
