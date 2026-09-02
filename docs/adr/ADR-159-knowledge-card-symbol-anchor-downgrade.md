# ADR-159：知识卡符号锚点降级为文件名清单，行号仅作文件级坐标

- **状态**：📝 草案（待审，未采纳）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/gen-knowledge-autogen.ts; scripts/check-knowledge-drift.ts; docs/knowledge/*`

---

## 1. 背景（Context）

- 知识卡 `auto_fields.symbols_with_lines` 以「`符号:行号`」对记录机制锚点，`check-knowledge-drift` 消费之，检测「源码改了、知识卡没跟上」的漂移（ERROR 级拦 commit）。
- 实证（本次 `mmd-adapter` / `preview-core` 拆分）：~10 张卡行号批量漂移触发重写；其中仅 1 处是真失准——`preview_core.md` 的 `_singletonScene.background` 随拆分挪到 `shared-infra.ts`，被门禁拦下。
- 结论：行号是「防倒退护栏的输入」，**不改善**质量、**守卫**质量（防止文档与代码脱节）。但纯行号位移（符号未变）产生大量无害重写与提交噪音。
- 痛点：每次重构震 ~10 张卡，diff 被行号淹没，真漂移信号被稀释。

## 2. 决策（Decision）

将锚点表达方式从「行号坐标」降级为「符号名清单」，行号仅保留文件级：

1. `symbols_with_lines` 去掉行号，改为纯符号名清单。
2. 行号不再进入卡片——文件路径已由 `source_files` 覆盖，文件级定位足够。
3. `check-knowledge-drift` 语义改为「**符号必须存在、行号可漂移**」：
   - 符号位移（行号变、符号仍在）→ 不触发重写；
   - 符号删除（符号不复存在）→ ERROR 级报警（真漂移）；
   - 新增符号 → WARN 提示或自动补登（待定）。
4. 改动面：`scripts/gen-knowledge-autogen.ts`（产出格式）+ `scripts/check-knowledge-drift.ts`（判定语义）+ 相关契约测试，需 TDD 协同改、改完即 `doctor` 全量验证。

## 3. 后果（Consequences）

- 正向：重构不再震卡片，提交噪音↓，卡片 diff 聚焦真漂移；审阅负担↓。
- 负向 / 风险：
  - 丧失「精确行号」哨兵——但 `source_files` 仍给文件级定位，符号级存在性才是真护栏，影响有限。
  - gen / drift / 契约测试三处耦合，有回归风险 → 必须 TDD、改完即验。
  - 若其他工具/索引消费「`符号:行号`」格式，需同步适配（实施前 grep 消费者）。
- 已知遗留：本 ADR 仅立项，**暂不实施**（当前 mmd 提交已完成，不在该提交顺手做）。

## 4. 数据溯源

- 来源：本次 `mmd-adapter` / `preview-core` 拆分 → ~10 卡行号漂移 + 1 处真锚点失准（`_singletonScene.background` → `shared-infra.ts`）。
- 结果：批量行号重写为噪音，真失准仅 1 处 → 实证「行号守卫质量而非改善质量」→ 提案将行号减噪、保留符号级护栏。

<!-- 文件名: knowledge-card-symbol-anchor-downgrade.md → 实际文件 ADR-159-knowledge-card-symbol-anchor-downgrade.md -->
