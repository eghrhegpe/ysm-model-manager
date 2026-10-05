# ADR-323：pre-commit 钩子逻辑下沉 commit-blocks 与薄壳化

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-10-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：钩子内联 sh 逻辑不可测、方言脆弱，需将纯逻辑下沉为契约测试守护的 TS 模块（延伸 ADR-152 范式）
- **相关**：ADR-152（gen-stage 下沉先例）、ADR-206（gate-blocks 分块范式）、ADR-087（pre-commit 智能 stage 起源）、ADR-232（并发配对/逃生留痕）、ADR-234（秒级承诺与降级）、`.githooks/pre-commit`、`scripts/_lib/commit-blocks/`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`.githooks/pre-commit` 是仓库最重的钩子（每次 commit 必经），但它是**唯一没有享受「薄壳 + TS 模块」范式的钩子**：

- `.githooks/pre-push` = 41 行薄壳 → `scripts/pre-push-gate.ts` 调度器 → `_lib/gate-blocks/`×6 → `_lib/gate-config.ts` 清单，每环可单测、有契约测试守护。
- `.githooks/pre-commit` = 17 个段落全部内联，其中**四段是真逻辑而非调用**，被写死在 shell 字符串里：
  1. **智能 stage**（ADR-087）：`git diff --cached` 取 TS/JS → 推导同名 `.test.ts` → `git add`。
  2. **gofmt 自动修复**：staged go 文件 → 跳过含未暂存编辑者 → `gofmt -w` + 重新 stage。
  3. **版本防御三查**：`$` 开头文件名 / Go 覆盖率 profile 首行 / 跨层夹带（frontend+go 同提交）。
  4. **`snap_docs` 快照**：node 一行内联（虽已优先 node，但仍是 sh 里的字符串，无法单测）。

**为什么这是问题**（不是风格洁癖）：

- **不可测**：这四段无任何测试守护。对比 `gen-stage.ts`（ADR-152 下沉后由 `tests/test_gen_stage.ts` 守护）——同一份钩子里的同类逻辑，一个有测试一个没有。
- **方言脆弱**：shell 的后缀截断、分词、引号规则是已知坑源。实证：智能 stage 的 `base="${f%.ts}"` 用**最短后缀匹配**，`foo.d.ts` → base `foo.d` → 去探测不存在的 `foo.d.test.ts`；仓内有真实 `.d.ts` 文件（`three-glsl.d.ts` 等），该边界是活的。此坑已被知识卡记为 pitfall，但因无法单测而**只能靠注释提醒，不能靠断言拦截**。
- **注释考古负担**：426 行里 ADR-232/234/256/151/184 与历次锐评交织，读「现在做什么」需先剥离「当年为什么改」——这正是「从 git 钩子找流程困难」的直接来源。
- **并发场景的判定逻辑（最该被测试的部分）恰恰写在最难测的地方**：共享 checkout 下 10+ AI 并发提交，跳过「含未暂存编辑的文件」、只 stage「本次 gen 实际 touch 者」等判定，全部内联在 sh 里。

同时，**本仓已有两条成熟范式可直接沿用**，无需发明新手法：

- ADR-152：把 pre-commit 内联判定下沉 `_lib/gen-stage.ts`（单一事实源 + 契约测试），已验证有效。
- ADR-206：把 pre-push 的调度块拆 `_lib/gate-blocks/`，每块自守卫、可独立测。

## 2. 决策（Decision）

**决定**：按 ADR-152 手法**延伸**（非新范式），把 pre-commit 的**纯逻辑段**下沉 `scripts/_lib/commit-blocks/`，钩子改为「薄壳编排 + 调块」；每块配契约测试。

**必须留在 shell 的部分**（不强行下沉，尊重 git 钩子的语义边界）：

- 逃生阀判定与环境探测（`node` 可用性、PATH 修正）；
- `PARENT_OID` 取用与 `trap` 清理、`exec 1>&2`（stdout 管道语义）；
- 「跑哪些 gen 脚本」的编排调用（`gen-cmds.ts` 已是单一事实源）。

**下沉的判据（须同时满足）**：

1. 是**判定/推导逻辑**，而非单纯调用既有脚本；
2. 输入可显式化（staged 文件列表、配置），不依赖 shell 现场状态；
3. 有边界条件值得断言（后缀截断、点号文件名、并发 dirty 判定等）。

**改造顺序（按「风险低 × 收益高」推进，每步保持行为等价）**：

1. **版本防御三查**（最纯，零副作用，最易测）→ `commit-blocks/version-defense.ts`
2. **智能 stage 的候选推导**（纯函数：staged 列表 → 待 stage 列表；`git add` 仍由外层执行）→ `commit-blocks/smart-stage.ts`
3. **gofmt/biome 修复的前置筛选**（纯函数：文件列表 + 「是否有未暂存编辑」判定 → 可安全格式化列表）
4. **snap_docs 快照**（node 内联 → 模块函数，含跨平台回退）

**硬约束**：

- 每步**行为等价**（含输出文案与退出码），不得夹带语义变更；发现真 bug（如 `.d.ts` 截断）**先下沉复现、单独立项修**，不与搬迁混做。
- 下沉不增加 commit 时延（ADR-234 的「秒级承诺」优先于结构美观）：块须零重依赖，node 冷启次数不得显著增加。
- 钩子薄壳化后，**逃生阀语义与留痕行为不变**（`YSM_SKIP_*` 命中仍写 `SKIPPED_PRECOMMIT`）。

## 3. 后果（Consequences）

**正面**：

- 四段最难维护的判定逻辑获得契约测试，`foo.d.ts` 一类边界由断言而非注释拦截；
- 钩子读起来是编排（「先跑 gen，再查漂移，再拦硬阻断」），历史注脚随逻辑一并迁入模块，缓解注释考古；
- 与 pre-push 形成**同构双钩子**（薄壳 + blocks），心智成本减半——「找流程」有统一套路可循。

**负面 / 代价**：

- 增加一层间接（sh → TS 模块），调试时需多跳一次；缓解：块自守卫、`--json`/详细输出保留，且模块可被**直接单跑**（比读 sh 更快）。
- node 冷启次数若控制不当会拖慢提交；缓解：同类判定合并进**单次** node 调用。
- 搬迁期存在「旧路仍在跑、新路已写」的双实现窗口；缓解：每步一次提交内完成「实现 + 接线 + 删旧段」，不跨提交留半成品。

**已知遗留（有意不做）**：

- **不重写为单一 TS 入口**（如 `pre-commit.ts` 全权接管）：钩子仍需 shell 承担 git 环境探测与逃生阀，且完全脱离 shell 会让「钩子为何没跑」更难诊断（对比 pre-push 薄壳仍保留 node 探测与 SKIP 分支）。
- **不在此刀修 `.d.ts` 截断 bug**：按硬约束「先下沉复现、单独立项」，避免搬迁与行为修复耦合成难审查的 diff。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `.githooks/pre-commit`（17 段实测分类：调用型 9 / sh 语义必需 3 / 真逻辑 4） | 划定可下沉范围 = 4 段真逻辑 |
| `.githooks/pre-push`（41 行薄壳）对比 | 确立「薄壳 + blocks + 契约测试」为仓内已验证范式 |
| `scripts/_lib/gen-stage.ts` + `tests/test_gen_stage.ts`（ADR-152） | 同钩子内已有下沉先例，证明该手法对本场景有效 |
| 本地复算 `base="${f%.ts}"` 对 `foo.d.ts` | 得 `foo.d` → 探测不存在的 `foo.d.test.ts`；仓内 `*.d.ts` 真实存在，边界为活 |
| 知识卡 `pre-commit-hook.md` 记录的 pitfall「含多个点号的文件名可能截断错误」 | 该坑已被人肉发现但无法断言拦截 → 佐证「不可测」是根因而非风格问题 |

<!-- 文件名: pre-commit-commit-blocks.md → 实际文件 architecture/ADR-323-pre-commit-commit-blocks.md（ADR-320 architecture 全量模板） -->
