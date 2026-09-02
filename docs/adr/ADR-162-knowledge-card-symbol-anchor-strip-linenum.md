# ADR-162：知识卡符号锚点去行号（行号减噪）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/gen-knowledge-autogen.ts; scripts/check-knowledge-drift.ts; docs/knowledge/AGENTS.md`

---

## 1. 背景（Context）

- 知识卡 `auto_fields.symbols_with_lines` 以「`符号:行号`」对记录机制锚点，`check-knowledge-drift` / `gen-knowledge-autogen --check` 消费之，检测「源码改了、知识卡没跟上」的漂移。
- 实证（本次 `mmd-adapter` / `preview-core` 拆分）：~10 张卡因纯行号位移触发重写，其中仅 1 处是真失准（`preview_core.md` 的 `_singletonScene.background` 随拆分挪到 `shared-infra.ts`）。
- 结论：行号是「防倒退护栏的输入」，**不改善**质量、**守卫**质量；但纯行号位移（符号未变）产生大量无害重写与提交噪音，重构一次就震 ~10 张卡，diff 被行号淹没、真漂移信号被稀释。
- 本 ADR 承继被 revert 的 **ADR-159 草案**（2026-09-02，标题「知识卡符号锚点降级为文件名清单（行号减噪）」），将其决策落地为已采纳状态。原 159 号已被 `ADR-159-scene-registry-container-semantics.md` 占用，故本 ADR 占新号 162。

## 2. 决策（Decision）

将锚点表达方式从「行号坐标」降级为「符号名清单」，行号不再进入卡片：

1. `symbols_with_lines` 去掉行号，改为纯符号名清单（`- SymbolName`，无 `:NN`）。字段名沿用 `symbols_with_lines`（因 `symbols:` 已被 `gen-knowledge-symbols.ts` 占用，重名会冲突）。
2. 行号不再进入卡片——文件路径已由 `source_files` 覆盖，文件级定位足够。
3. `gen-knowledge-autogen.ts` 比对语义改为「**仅按符号名集合比对**」：行号漂移不再触发重写；只有符号真实增删（改名/新增/移除）才重写该卡。
4. `check-knowledge-drift.ts` 仅做格式校验（纯符号名），不重新抽取符号；符号增删由 gen 自动同步（不阻断）。
5. 改动面：`scripts/gen-knowledge-autogen.ts`（产出格式 + 比对语义）+ `scripts/check-knowledge-drift.ts`（格式文案）+ 相关文档（`docs/knowledge/AGENTS.md`、`scripts/README.md`）。

## 3. 后果（Consequences）

- **正向**：重构不再震卡片，提交噪音↓，卡片 diff 聚焦真漂移；审阅负担↓。门禁 `gen-knowledge-autogen.ts --check` 与 `check-knowledge-drift.ts` 仍全绿。
- **负向 / 风险**：
  - 丧失「精确行号」哨兵——但 `source_files` 仍给文件级定位，符号级存在性才是真护栏，影响有限。
  - gen / drift / 文档三处耦合，有回归风险 → 已 TDD 思路改完即 `doctor --docs` 全量验证（21/21 PASS）。
  - 若其他工具/索引消费「`符号:行号`」格式，需同步适配——经查证仅 `gen-knowledge-autogen.ts` 与 `check-knowledge-drift.ts` 消费该字段，已同步。
- **已知遗留**：
  - `docs/knowledge/i18n.md` 正文含 13 处 `symbols_with_lines:` **示例块**（手写的旧 `Symbol:NN` 格式），非自动生成产物（gen 只处理第一份 frontmatter），属独立文档一致性残留，待专项清理，不阻塞本 ADR。
  - 符号删除目前由 gen 自动同步（不阻断），未升级为 ERROR 级门禁（ADR-159 草案第 3 项「待定」分支，本次按用户拍板选「仅去行号」）。

## 4. 数据溯源

- 来源：ADR-159 草案（revert 后状态 `📝 草案（未采纳）`）→ 用户要求落实「自动生成文档不带行号」→ 本 ADR 落地为 `✅ 已采纳`。
- 实施（2026-09-02）：
  - `scripts/gen-knowledge-autogen.ts`：L309 产物改为纯符号名；L315-329 比对改为符号名集合相等、删除 `moved`（行号漂移）分支；L333-337 drift push 改用 `added/removed + moved:[]`。
  - `scripts/check-knowledge-drift.ts`：L530 WARN 文案去「或 Symbol:行号」；格式正则保留 `:\d+` 兼容旧卡片。
  - 文档：`docs/knowledge/AGENTS.md`（L33/67/161）、`scripts/README.md`（L136）改为「纯符号名清单（无行号）」。
  - 跑 `gen-knowledge-autogen.ts --full` 重写全部 149 张卡剥掉 `:NN`。
- 结果：`gen-knowledge-autogen.ts --check` 一致（扫描 154 张卡）、`check-knowledge-drift.ts --json` 零 ERROR、`doctor --docs` 21/21 PASS。

<!-- 文件名: knowledge-card-symbol-anchor-strip-linenum.md → 实际文件 ADR-162-knowledge-card-symbol-anchor-strip-linenum.md -->
