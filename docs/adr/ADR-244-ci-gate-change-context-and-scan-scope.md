# ADR-244：CI 门禁的变更上下文与扫描域收口——post-push 不可得须显式给定，扫描域限于仓库跟踪文件

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/check-deadcode-baseline.ts · scripts/_lib/deadcode-attrib.ts · scripts/link-checker.ts · .github/workflows/{ci,test,release}.yml · scripts/_lib/changed-scope.ts（同类病理先例）`

---

## 1. 背景（Context）

2026-09-15 夜间剥 CI 洋葱时暴露两个独立红点，**根因同源**：门禁所依赖的「变更上下文」在 CI 不可得。

**病根一：`check-deadcode-baseline` 在 CI 结构性恒红。**
该脚本按「归属裁剪」分流：新增发现项落在**责任文件集**（staged / 未暂存 / 未跟踪 → 回退未推送提交 diff）内才阻断，
他人遗留债务收编进基线放行。CI 跑在 **push 之后**：`origin/main` 已推进到本次提交 ⇒ 三源全空、
`origin/main...HEAD` 也空 ⇒ 责任集恒 `null` ⇒ **严格模式全阻断**；而 CI 传 `--json`，自动收编写的条件是
`!JSON_OUT` ⇒ **既全阻断、又无法自愈**。实证（run `34984982311`，`_summary.errors: 6`）：

```
[新增死代码/重复代码·归属本次改动] src/preview-3d/adapters/vrm/vmd-retarget.ts|types|VmdBoneBinding
... 其余 5 条分别属 icon-kit（他人会话）与测试重复
严格模式：无 staged / 未推送上下文可归属，全部新增按阻断处理
```

6 条里没有一条出自本笔改动 —— 门禁退化成了「谁提谁背锅」的盲盒，且 main 因此连红两天
（`5b136da16` 09-14 → `4ddd72711` → `a57e0b14e`，均非当笔引入）。

**病根二：`link-checker` 扫描域含未跟踪文件。**
它以裸 `fs.readdirSync` 遍历工作树，未跟踪 / 未忽略的 md 照样进扫描。实证：并行 agent 落在**仓库根**的
`SOUL.md` / `TOOLS.md`（内含模板链接 `/concepts/soul`、`/concepts/agent-workspace`）使 pre-push 报
3 条断链并**阻断推送**；时间线可证其无关性——两文件 mtime `14:57:14Z`，而上一笔推送 `14:55:54Z` 时
link-checker 仍是 `[OK]`。⇒ 任何人往仓库里丢一个 md 就能拦住全仓推送。

**同类病理先例（同一晚已修）**：`_lib/changed-scope.ts` 的空 diff 曾退化成「空 scope ⇒ 扫 0 文件恒绿」
（`a57e0b14e`）。三处的共同形状：**上下文缺失时的退化路径，要么静默放行、要么无差别归罪**。

## 2. 决策（Decision）

**D1 — 变更上下文类门禁必须支持「显式给定范围」，CI 由调用方传入；范围为空 ≠ 无从归属。**

- `check-deadcode-baseline` 新增 `--base <rev>` / env `YSM_DEADCODE_BASE`；解析顺序：
  **⓪ 显式 base（可解析为提交对象）→ `git diff --name-only <base>...HEAD`**；①②③ 本地三源；④ 未推送 diff；
  全空 → `null`（严格模式，保留 fail-closed 兜底）。
- **空范围返回 `[]` 而非 `null`**：「本次范围没改到相关文件 ⇒ 谁都不该背锅」与「无从归属」语义不同，
  前者若退化成严格模式，CI 重演恒红。
- base 不可解析（全零 sha / 拼错 / tag 新推）→ 记 INFO 并**退回既有本地链**，不新增失败模式。
- 该解析逻辑下沉 `_lib/deadcode-attrib.ts`（注入式 `GitRunner`），脚本侧只留 `spawnSync` 适配器：
  原实现是 `main()` 内联闭包、零覆盖，下沉后可确定性契约测试（假 git 注入，零 IO）。
- 管道：`test.yml` 是 `workflow_call`（拿不到 event），故新增 `inputs.changed-base`；
  `ci.yml` 传 `github.event.before || pull_request.base.sha`，`release.yml` 传 `event.before`。

**D2 — 门禁扫描域必须限于「仓库跟踪文件」，不得检查工作树杂物。**

- `link-checker` 的扫描域改为 `git ls-files ∩ isScannable`（`SKIP_DIRS` / `SKIP_FILES` 规则保留，
  因 `upstream/`、`archive/` 等是**被跟踪**但不应计断链的目录）；`_summary.scan_source` 留痕。
- git 不可用（导出的 tarball 等）才退回 `walkMd`，并在 stderr 显式告警（退化路径可见，不静默）。
- 补 `main` 守卫（同 `check-menu-health` 先例），使其可被契约测试 import。

**明确不做（反例）**：
- ❌ 收编基线 / 放宽 `test_changed_scope` 断言 —— 把「结构性失明」当成「没违规」，治症不治因。
- ❌ 要求协作者「别往仓库根放文件」 —— 用约定替代机制，下一个人必然再踩。
- ❌ 给 CI 传 `--all` 或让 CI 走全库 —— 存量债会淹没本次变更，门禁只能被迫常关。

## 3. 后果（Consequences）

**正面**
- CI 死代码门禁恢复「只拦本次范围」语义：本次范围外的新增死代码不再无故阻断（可选收编，记账留痕）。
- 未跟踪 / 被忽略文件不再能拦住全仓推送（已实证：`SOUL.md`、`TOOLS.md` 仍在仓库根时
  `--strict` rc=0，`files_scanned 560`）；门禁权威口径回到「仓库里的文档」。
- 两处判定逻辑可测：新增 `tests/test_link_checker_scope.ts`（扫描域 ≡ 跟踪 ∩ 可扫，构造性相等断言）、
  `tests/test_deadcode_attrib.ts` 扩 5/6 两组（`parseBaseRef` + `resolveResponsibleFiles` 六情形）。

**负面 / 代价**
- 调用方必须传范围：`workflow_call` 内拿不到 event，靠 `inputs.changed-base` 显式传递；
  漏传即退回旧行为（严格模式），不会更坏但也不会变好 —— 该耦合由本 ADR 记明。
- `--base` 传错（例如误传很新的提交）会缩小责任集，让本次真引入的死代码逃逸。
  缓解：范围与文件数写入 INFO 留痕；本地无 `--base` 语义完全不变。

**已知遗留**
- 各 AI 工具的 agent 工作区文件仍会落在仓库根（`.openclaw` 已由该工具自行加入 `.gitignore`）；
  D2 使门禁对其免疫，但仓库整洁仍归各工具自理。
- 知识卡 frontmatter 的 YAML 合法性**本地无闸门**（`check-knowledge-drift` 不校验，VitePress 构建只在
  Pages workflow 跑）——本轮 `pre_push_gate.md` 第 91 行未加引号的半角 `:` 就是这条缝隙
  （已在 `adbe2358a` 修，闸门缺口另案）。

## 4. 数据溯源

| 来源 | 结果 |
|---|---|
| CI run `34984982311`（`a57e0b14e`） | 契约测试步骤 **success**（前一层已修）；死代码步骤 failure，`errors: 6` + 「严格模式」info |
| `scripts/check-deadcode-baseline.ts:188`（旧 `resolveResponsibleFiles`） | 三源 → 未推送 diff → `null`；`--json` 下 `!JSON_OUT` 关掉自动收编 ⇒ 结构性恒红 |
| pre-push 报告 `2026-09-15T15-07-40` | link-checker `[本次引入]` 3 条断链，全在 `SOUL.md` / `TOOLS.md`（未跟踪，mtime `14:57:14Z`） |
| `git ls-files --others --exclude-standard` vs 扫描域 | 改造前 `files_scanned 568`（含 8 个未跟踪 md）；改造后 `560`，`links_broken 0`，`scan_source git` |
| `node scripts/check-deadcode-baseline.ts --json --base a57e0b14e` | 责任范围 = 4 个变更文件（本笔 2 + 并行会话 2）；`errors: 2`（`vmd-retarget` 两条，归属正确） |
| 同上 + `--base 000…0`（不可解析） | 记「不可解析，已退回本地上下文解析」INFO，rc=0 —— 不新增失败模式 |
| `tests/test_link_checker_scope.ts` | 扫描域 ≡ 跟踪 ∩ 可扫；未跟踪 md 泄漏 0 个；扫描域 560 个 md |


<!-- 文件名: ci-gate-change-context-and-scan-scope.md → 实际文件 ADR-244-ci-gate-change-context-and-scan-scope.md -->
