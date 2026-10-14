# ADR-338-d2：broad_claim 巨兽卡符号封顶：auto_fields 死重止血与拆卡排期

- **状态**：✅ 已采纳（Accepted，2026-10-14 用户「来吧」拍板 B 先落地、A 排入复测批）
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-338（§2.2 域合并的续刀——同一病灶「派生死重每会话全价付费」的机器止血）
- **关联**：`scripts/gen-knowledge-autogen.ts`（SYMBOLS_CAP_KEEP）、`scripts/_lib/machine-diff.ts`（MACHINE_ITEM_RE 扩标记形态）、`docs/knowledge/model3d.md`（1100→99+标记）、`docs/knowledge/wails-bindings.md`（118→99+标记）、`tests/check-gen-autogen-symbols-cap.ts`（契约）

---

## 背景（一句）

5.14 护栏头注早已实证 `auto_fields.symbols_with_lines` **全仓零信息消费者**（仅 gen 生产、5.7 验格式、machine-diff 用形状不用值），但目录级宽认领卡（model3d 1134 条 / frontmatter 1162 行）每次检索命中都让 AI 全价吞下这坨死重——旗标 `broad_claim` 只申报豁免、不止血。

## 决策（三行）

1. **封顶只对 `broad_claim: true` 卡生效**：全量 >99 时只写前 99 条符号 + 块末标记 `- symbols_total: N`（全量计数）；普通卡、冻结卡不受影响——源头处方不变（5.14 WARN 仍指「收窄目录认领」）。
2. **标记行是旗标新鲜度的机器信号**（闭环自愈、drift 零改动）：5.14/5.17 计数含标记行 → 封顶卡恒 100 ≥ 阈值，broad_claim 豁免不漂；卡真收窄后 gen 写全量无标记、计数 <100 → 5.17 提示移除旗标。比对域含标记值，全量数增删被 `--check` 如实检出——封顶不成遮蔽死角；冻结路径比对域剔除标记防「已删符号」误判永动。
3. **machine-diff 的 MACHINE_ITEM_RE 扩认 `- symbols_total: N` 形态**（zone 上下文已保证人工区不误入），滞留封顶卡 diff 仍可自动收编。**A 案（治本）排入 10-27 复测批**：preview-3d 126 个仅靠 model3d 目录级存活的文件按 infra/caps/mmd-adapter 三域拆新卡、model3d 收窄归「数据→Three 对象」核心链、摘 broad_claim——与「合并卡变长是否伤检索」的复测数据同台裁决。

## 后果（一句）

model3d frontmatter 1162→~140 行、wails-bindings 164→~35 行，检索命中 token 成本降一个数量级；回退 = 删 applySymbolsCap 一处调用 + 正则还原，gen --full 即恢复全量态，零数据丢失（真相源本就在源码）；字典序前缀轮换噪音由 pre-commit GEN_CMDS 在提交周期内收敛。

<!-- 文件名: broad-claim-auto-fields.md → 实际文件 decisions/ADR-338-d2-broad-claim-auto-fields.md（ADR-320 decisions 轻量模板） -->
