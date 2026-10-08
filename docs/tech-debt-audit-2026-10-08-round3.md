# YSM 模型管理器 技术债审计 · 第三轮（2026-10-08 复测）

> 前两轮：[第一轮](./tech-debt-audit-2026-10-06.md) · [第二轮](./tech-debt-audit-2026-10-08.md)。台账卡：`docs/knowledge/tech-debt-ledger.md`。
> 口径：本仓「技术债」= **棘轮基线账本**（`scripts/check-*.ts` 以 `--update` 收紧、放宽须 `--force` 且提交说明写理由）。因此「清除效果」只从**基线 git delta + 门禁实测输出**判断，不采信 TODO 计数，也不采信提交关键词。
> 方法：主模型单线程复测。全部门禁实跑 + 关键账本取 `git show <sha>:<path>` 历史曲线 + 逐条回源码核验。
> 纪律：**凡二手报的债，先亲自 grep 真实代码 + 跑对应门禁验证**。本轮纠正自有误判 3 项（§6.1）、驳回二手数据 2 项（§6.2）。

---

## 0. 头条（一句话版）

**增量维度清除效果优秀，存量维度接近零。** 已挂载门禁全绿（`doctor --docs` PASS 23/23），第一轮/第二轮的 🔴 项在数日内全部落地；真正的问题不是「新的债在堆积」，而是**一批存量债被账本合法冻结后无人收回**（knip 185 ↑ / jscpd 119 ↑ / css-token 308 / design-tokens 112 / redlines 63 / 复杂度 269 无基线），外加**一处执法真空**：`drift-scan.ts` 常年 exit 1、全仓零挂载，而门禁覆盖率指标在结构上看不见它（§5）。

| 项 | 判定 | 依据（可复现） |
|---|---|---|
| 已挂载门禁 | 🟢 全绿 | `node scripts/doctor.ts --docs` → 结论 PASS ✅ 23/23 |
| 前两轮 🔴 项 | 🟢 已清 | P1-a 覆盖率新鲜度断言、P1-b `cmd/ccheck` 0%→83.9%、六处 pre-push 文案、A1 ADR 治理、R1 file-lines 硬违规 |
| `drift-scan.ts` | 🔴 **执法真空** | exit 1，全仓零挂载（§5） |
| 存量账本池 | 🟠 **冻结不清** | knip 185（09-15 为 128）、jscpd 119（86）、css-token 308、design-tokens 112、redlines 63 |
| 复杂度 | 🟠 **无基线 = 无绳** | 🟥0 🟧46 🟨223 = 269，`scripts/baseline/` 无对应文件（§4.2） |
| Go 覆盖率阈值 | 🟠 口径低 22.5pt | 实测 77.5% vs 阈值 55 vs 账本下界 78.1（下界反而**高于**实测） |

---

## 1. 方法与本轮窗口

- **实跑**：`doctor.ts --docs`、`check-file-lines`、`check-adr-health`、`check-knowledge-drift`、`check-worker-lifecycle`、`drift-scan`、`go test ./...`、`go build ./...`、`gofmt -l go`、覆盖率统计。
- **历史曲线**：`git show <sha>:scripts/baseline/deadcode-baseline.json` 逐版本取 `.knip.Count` / `.jscpd.Count`；`git ls-files` / `git status -u` 判跟踪态。
- **回源码核验**：凡门禁报出的违规，逐条读对应源码判断「真债 / 误报」（本轮因此改判 1 条严重项，见 §5.2）。
- 窗口：2026-10-08 晚。基线：10-06 + 10-08 两轮审计 + 台账卡。

**基数校准（本轮重要副产品）**：`scripts/` 下现役 `check-*.ts` = **44 个**（含 `_attic` 45；`scripts/*.ts` 共 103；递归 274）。`doctor` 自述覆盖口径 **42/44 已接入门禁**，刻意旁路恰为 2 个（`check-biome-lines.ts`、`check-diff-coverage.ts`）——分母自洽。`AGENTS.md` 两处「约 118 个检查脚本」与任一现役口径都对不上（§4.5）。

---

## 2. 清除效果：三轮同口径对照

| 债目 | 10-06 | 10-08 | **本轮实测** | 判定 |
|---|---|---|---|---|
| P1-a 覆盖率门禁与代码脱钩 | 漏洞 | 必做未修 | `stalenessWarning()` 已落地（`check-go-coverage-threshold.ts:179-209`），注释自署「2026-10-08 技术债审计 P1-a 根治项」 | 🟢 **已还** |
| P1-b `cmd/ccheck` 覆盖 0% | — | 必做 | 0% → **83.9%**（`28c2c7de8`，补测试而非加 SKIP） | 🟢 **已还** |
| 六处文档称「pre-push 全量门禁」 | 6 | 6 | **0**（`AGENTS.md` / `README*` / 三张知识卡全改「默认轻量档」） | 🟢 **已还** |
| file-lines 硬违规 R1 | — | 1（water 660 > 655） | **0**（660→637，`a3371cf81`） | 🟢 **已还** |
| e2e 活 `test.skip` | — | 1 | **0** | 🟢 **已还** |
| e2e 硬编码本机路径 | 4 | 4 | **0** | 🟢 **已还** |
| A1 ADR 治理无守护 | 未拦 | 未拦 | 守卫上线，缺 emoji 前缀 **126 → 1 WARN**（`check-adr-health`：0 ERROR / 1 WARN） | 🟢 **已还** |
| 台账卡 `category` 错位 | — | K2 | `core`（`21d262ae3`） | 🟢 **已还** |
| `cmd/genindex` 残留 exe | 有 | 有 | **0** | 🟢 **已还** |
| `check-arch-health` 双轨 | — | — | 退役并入契约层（`contract-tests.ts` 92/92），基线文件已删 | 🟢 **已收敛** |
| Go 静态分析 736 条 | 736 | 463→346→316 | CI 已迁 Linux 并行 + 只跑增量（`--new-from-rev`） | 🟡 **决策性豁免** |
| 复杂度 | — | 🟥0 🟧47 🟨222 | 🟥0 🟧**46** 🟨**223** = **269**，**无基线文件** | 🟠 **冻结·不受执法** |
| deadcode（knip / jscpd） | 188 / 109 | 185 / 118 | **185 / 119**（09-15 起点 128 / 86） | 🟠 **持续上涨** |
| design-tokens 存量 | — | — | **112**（ERROR 108） | 🟠 冻结·「存量债不拦」 |
| css-token | 308 | 308 | **308**（3 次触碰，**0 次收紧**） | 🟠 冻结 |
| jscpd-go | 177 对 | — | 实测 **14 生产对**，门禁自报「已修复 11 对可 `--update` 收紧」 | 🟡 **债已清、账未收** |
| i18n 死键 | 182→21 | 17 | **17**（真死键 13 + 仅测试引用 4） | 🟡 已还大半后冻结 |
| redlines 候选 | 58（09-25 冻结） | 63 | 账本 63，**实测 WARN ≈22** | 🟠 账粗于实 |
| `docs/audit-*.md` 根部堆积 | 6 | 6 | **9** | 🟠 **回潮 +3** |
| `vi.mock("…app.js")` 真债 | 19(误) | 11 | **10** | 🟠 未动 |

---

## 3. 为什么有的还得上、有的还不上

账本上「192 笔技术债提交 / 收紧:放宽 ≈17:1」掩盖了真正的结构——三层执法力：

### 3.1 第一层｜硬闸 + 基线（真还得上）

`layering` 唯一边 **0**、`menu-test-layout` **0**、`doc-drift` **0**、`path-hygiene` 冻结 12/12、`a11y` 下界守卫（tabindex 60 ≥ 下界 59）、`singleton-hygiene` 基线内。这一层的债在**消失**，且守住不回流（`b0716294f` 修 `frontend/src`→根循环时重划 6 条 glob，属收紧而非放水）。

### 3.2 第二层｜report-only / exit 0（盘点而非偿还）

- `orphan-exports`：6 孤儿，「审计模式不阻断，`--strict` 可升级为 ERROR」。
- `check-file-lines`：**硬红线仅 4 条**（`check-frontend-critical-contracts.ts` 123、`check-downloader.go` 700、`go/downloader/downloader.go` 700、`go/downloader/batch.go` 693），阈值 900 只出 advisory（「软告警，不阻断；驱动拆分排期」），本轮 **18 个 advisory**，最重 `preview-3d/caps/water-capability.test.ts` **2708 行**、`frontend/src/views/app-content.ts` 1323、`_lib/design-tokens.ts` 1391/400、`check-knowledge-drift.ts` 1192/700。
- `design-tokens`：「上表为**全库存量债**盘点，存量债不拦」。
- `check-knowledge-content`：脚本头第 31 行自述「**退出码：恒 0**（纯 WARN 探针，不阻断 CI/钩子；fail-open 只提醒，fail-closed 由 `invariant_anchors` 兜底）」——分层设计，非缺陷，但计入「弱闭环」面。

### 3.3 第三层｜没有绳子

复杂度 269 处**无任何基线文件**（§4.2）；`drift-scan` 连执行点都没有（§5）。

### 3.4 还债的三种真实模式

1. **真偿还**（水/环境 cap 拆分、`_attic` 归档、P1 三项、G1/G2/G4 三闸）——债没了，账也动了。
2. **制度化收编**（账跟着债一起涨）：`285f60b70` 标题直写「check-deadcode-baseline **自动收编**」；`f9e051f76`「3 项销账 + 8 项收编」；`66ce63f33`「死代码基线收编 14 项（发版窗口存量债）」。**只有一条写了理由，无一写 `--force`**。注意 101 次触碰 `scripts/baseline/*` 中 **0 条**提交说明含「放宽」——**提交关键词不是棘轮方向的有效代理**，必须读账本数值。
3. **未入账偿还**（债清了、账没收）：jscpd-go 11 对；redlines 实测 ≈22 vs 账本 63。

而且「清债不自动化」是刻意设计：`deadcode-baseline.ts:190`「不自动更新基线：收紧账本该由人看一眼再 `--update`，不做『绿了就把绳子拉紧』的自动写回」；`check-file-lines.ts:113`「不自动写基线——棘轮该由人在收债后收紧」。**代价：凡按行级/增量判定的闸（`--staged --added-lines`），存量数字永远不会自己下降。**

---

## 4. 存量未清的债（按机制分档）

### 4.1 收编型基线（最大一笔）

- `scripts/baseline/deadcode-baseline.ts`：knip **185** / jscpd **119**。曲线：`43290b1c5`(09-15) **128/86** → 09-17 144/90 → 09-19 155/97 → 09-24 158/101 → 09-25 157/107 → `66ce63f33`(10-03) 172/110 → 10-04 186/110 → 10-06 188/109 → 10-07 183/118 → `285f60b70`(10-08) 185/118 → HEAD **185/119**。**≈3 周 knip +57（+45%）、jscpd +33（+38%）**。
- `scripts/baseline/redlines-baseline.json`：**count 63**（`f9e051f76` 09-25 冻结 58，**+5/两周**）。该闸自述「候选清单，非审核结论——violations 需逐条人工确认，勿直接采信」。
- `scripts/.css-token-baseline.txt`：**308** 条，3 次触碰、**0 次收紧**。
- `scripts/baseline/design-tokens-baseline.json`：**112**（ERROR 108 / WARN 4）。
- `scripts/baseline/i18n-unused-baseline.json`：**17**（该闸自述「刻意不自动删键…误删活键比留死键严重」）。

**判定**：这批不是「无人管的乱账」，而是**有账无人收**。风险不在数字大，在于**账本增长无理由约束**——收编一条新债的成本 ≈ 跑一次 `--update`，而清一条债的成本是改代码。

### 4.2 无基线：复杂度

`complexity` 报 2285 函数中 🟥0 / 🟧46 / 🟨223 = **269 处**，最重者 `features/dnd/pack-dnd.ts:45 handleInstanceDrop` 认知复杂度 **41**。`scripts/baseline/` 与 `docs/` 下均**无任何 complexity 基线文件** ⇒ 这 269 处**不受任何棘轮执法**，是最容易无声恶化的大数。

### 4.3 口径与实际脱节

- **Go 覆盖率阈值**：`coverageThreshold = 55`（`check-go-coverage-threshold.ts:34`），实测 **77.5%**（4165 stmts / 3218 covered）⇒ 阈值低 **22.5pt**，门禁对真实退化几乎无感；同时 `baseline.go_coverage` 下界 **78.1** 反而**高于**实测 77.5（账本自身偏高约 1.2pt）。
- **新鲜度断言是 WARN-only**：`stalenessWarning()` 存在（L188）、`latestCommitUnixTime()`（L193）、非 git 逃逸 `return null`（L199）、`ageSec <= 0` 早退（L203-205），但调用点 L253 之后是 **`if (stale) { console.log(\`⚠️ ${stale}\`); continue }`** —— 只打印并**跳过该包**，永不 exit 2。即「产物陈旧」当前不会拦住任何人。

### 4.4 软告警堆积

18 个 file-lines advisory（含 2708 行的 caps 测试）、6 个 orphan-exports 孤儿、11 条 knowledge-drift WARN（多为人工策展层 `use_when`/`pitfalls`）。

### 4.5 文档层

- `AGENTS.md` L101/L173 两处「**约 118 个检查脚本**」对不上任一现役口径（44 / 103 / 274）⇒ 与 `392ec5f48` 刚删掉的腐数同类。
- `docs/` 根 `audit-*.md` **9 份**（H1 待归档清单从 6 → 9）；`audit-src-map.md` 是 `gen-project-map.ts` 生成物，**勿动**。
- 6 篇 ADR 滞留 `📝 提议中` 最久至 2026-09-20（ADR-284），即 **18 天未拍板**（ADR-292/301/321/325/151-d1）。注：ADR-321 自标「实施状态：查知识卡（ADR 只记决策方向，不记实施进度）」，且当日 `9e742a6da` 已实施其一部分（`restoreBySchema` 下沉 `water-persist.ts`）——**不构成「状态与实施脱钩」**，属人类拍板瓶颈。
- **新增（本轮发现）**：`docs/knowledge/drift-scan.md:54`「8+ 处」是知识卡 `AGENTS.md` 明令禁止的硬编码计数（「数字随代码演化必腐」）；同卡 L65 自称「JSON 输出（供 CI 集成）」而该脚本**从未入 CI**（§5）。

---

## 5. 🔴 执法真空：`drift-scan.ts`

### 5.1 事实

```
$ node scripts/drift-scan.ts          # exit=1
❌ 严重 (1)：INLINE_BAN_STRIP: go\scanner\scanner_repo_index.go:142
⚠️  警告 (1)：TIMER_LEAK: frontend\src\preview-3d\adapters\mount-preview-core.ts:580

$ git grep -n 'drift-scan'            # 命中全部在文档链：docs/knowledge/drift-scan.md、sidebar.gen.mjs
$ git log -S 'drift-scan' -- .githooks scripts/doctor.ts    # 空
```

即：**不是被摘下来的，而是从未挂进任何门禁**（`.githooks/`、`gate-blocks/`、`gate-coverage.ts`、CI 四处零引用）。

**为什么覆盖率指标看不见它**：`doctor` 的「覆盖口径 42/44」只枚举文件名匹配 `check-*.ts` 的脚本；`drift-scan.ts` 命名不符，**结构性地落在指标视野之外**。这正是 `doctor` 自己印的那行免责声明的活体实例——「覆盖口径: 42/44 项 check-* 已接入门禁——**全绿 ≠ 仓库无风险**」。

三层叠加：① 零执行点 ⇒ 6 条漂移规则（`formatSize` / `.ban` / 非法字符 / 权限常量 / 读取上限…）实际无人执法；② exit 1 ⇒ 想接也接不上（一接 push 就断）；③ 唯一严重项是**误报** ⇒ 连「先修红再接闸」都不成立。

### 5.2 那条「严重」的判定：误报

源码 `go/scanner/scanner_repo_index.go:142` 确有 `p[:len(p)-len(".ban")]`，规则 `drift-scan.ts:123` 正则 `\[:len\([^)]+\)-(?:4|len\("\.ban"\))\]` 命中无误——但该行落在 **L123 `cat > genindex.go << 'GOEOF'` ⋯ L168 `GOEOF`** 之内，是被拼进字符串的 **GitHub Actions YAML 模板中的独立生成器源码**（`package main` + 仅 stdlib import），不是本包可执行 Go。规则不识别 raw string / heredoc 边界，`exclude: [/types\/extensions\.go/, /test/]` 也拦不住 ⇒ **文本真、语境假**。

---

## 6. 勘误与本轮误判清单

### 6.1 主模型自有误判（3 项，已在本报告正文修正）

| # | 曾报 | 实测 | 修正 |
|---|---|---|---|
| 1 | 「89 个检查脚本」 | 现役 `check-*.ts` = **44**（`doctor` 分母同为 44） | §1 基数已改口径 |
| 2 | 「`drift-scan` 未挂载？」——首次 `git grep` 搜索域仅 `.githooks scripts/doctor.ts .github`，据此怀疑新闸 `check-worker-lifecycle` 也未挂载 | 实挂在 `scripts/_lib/gate-blocks/frontend-domain.ts:141` + `gate-coverage.ts:43` 登记 + 契约测试 + README 卡片 + 基线 `docs/.worker-lifecycle-baseline.json` | **搜索域过窄致假阴性**；`drift-scan` 的「未挂载」结论经全仓 `git grep` 复验成立 |
| 3 | 「jscpd-go 回归（457→465）」 | `465` 是 JSON 内 `duplicates` 块计数，**账本单位是 `clones` 177 对**；实测 **14 生产对** | 结论由「回归」改为**净清偿** |

### 6.2 驳回的二手数据（2 项，不入结论）

- **「71 处裸文本死锚 / 27 卡」**：全仓无任何脚本产出「死锚」度量（`git grep '死锚|deadAnchor'` 仅命中一处无关 CSS 注释），系自造启发式产物。仓内三把文档闸的真实口径为：link-checker **0 断链 / 1750 链**、`check-doc-drift` **0 ERROR / 0 WARN**、`check-knowledge-drift` **0 ERROR / 11 WARN**。11 不能换算成 71。
- **「跟踪区残留 4 个垃圾文件」**：驳。`git ls-files` 只捞出 `build/windows/wails.exe.manifest` ×2（Wails 合法清单）与账本 `scripts/.css-token-baseline.txt`；根目录那批 `.exe` / `.tmp.log` / `.dbg-*.md` **全部 gitignored**，untracked 为空 ⇒ 属**本地磁盘卫生**，不是仓库债。

### 6.3 沿用上两轮的休眠清单（不修，非新债）

Go「不做」清单（零 `t.Parallel()`、`InstallLock` 粒度、`SearchModels` 8 参）；`scripts/_attic/` 20 个死脚本（`check-script-hygiene --strict` warns=0 确认真死）；根目录杂物。另：`check-test-hygiene` ERROR 1→0（`check-sensevoice-cuda.test.ts` → `.passthrough.test.ts`）已在窗口内清掉。

---

## 7. 优先级动作

### 立刻（分钟级，纯收账）

1. `node scripts/jscpd-go.ts --update` —— 11 对已清债入账，唯一「白捡」的收紧。
2. `redlines` 63 逐条人工确认后收账：实测 WARN ≈22，其中 R2 的 5 处全在注释/函数签名，W1 的 2 处是 `split(/[\\/]+/)`（`frontend/src/utils/format/format.ts:40`、`preview-3d/adapters/fbx/fbx-parser.worker.ts:39`）**皆误报**。
3. `docs/` 根 9 份 `audit-*.md` 迁 `docs/archive/`（**勿动** `audit-src-map.md`；迁出前三查见知识卡目录 `AGENTS.md`）。

### 立刻（`drift-scan` 收口，本轮新债）

4. `INLINE_BAN_STRIP` 加 heredoc / raw-string 排除（或 `exclude` 该内嵌模板区），消掉唯一误报。
5. 定 `drift-scan` 归宿：**接进门禁（先修红）或明确退役入 `_attic/`**；同时把 `docs/knowledge/drift-scan.md` 的「供 CI 集成」与「8+ 处」改口径——**不要让一个不执行的闸以已生效的口径留在文档里**。

### 短期（需一点设计）

6. **复杂度登记基线**（哪怕先只锁 🟥 + 🟧 = 46）——269 处无绳是当前最大治理空洞。
7. 覆盖率阈值 55 → 75，并把 `stalenessWarning` 的 `continue` 升级为 exit 2（否则新鲜度断言等于没有）。
8. 5 个 caps 文件入 `check-file-lines` 硬红线，并把其**测试文件**（2708 行等）一并纳入，避免「拆了实现、测试成新巨物」。
9. 10 处 `vi.mock("…app.js")` → `.ts`；**勿碰** wasm 与 three/addons 的合法 `.js`。
10. `AGENTS.md` 两处「约 118」改不变量口径（如「`doctor` 覆盖口径 42/44，见 `doctor` 输出」）。

### 中期（需拍板）

11. 6 篇 `📝 提议中` ADR 拍板（最久 18 天）。
12. 存量债收缩排期：design-tokens 112 / css-token 308 分批，knip 185 按模块切；拆分只动可拆的 3 个（`web-fs.ts` 1030 / `tpl-settings.ts` 703 / `wasm-decode.ts` 831），**勿为拆而拆**。
13. 建立「收编须写理由」的硬约束（提交说明或基线 `note` 字段），堵住 §3.4 的模式 2。

---

## 8. 不确定与未验证

- 复杂度 269 的「趋势」未取历史曲线（无基线文件 ⇒ 无历史可比），本轮只能给现状。
- `docs/` 根 `audit-*.md` 9 份中，部分属并行会话在途产出（如 `audit-host-env-coupling-review.md` 同期被 `011400f03` 更新），归档清单须以最终态为准。
- 三份 caps advisory（1960 / 1932 / 1807 行测试）未逐行判「是否含实质断言」，只按体量计入。
- 未测量：Windows 本地 `golangci-lint` 全量（316 条口径取自 CI 增量决策，非本地复现）。
- 本报告写于 HEAD `011400f03`；实测确认 `392ec5f48..011400f03` 区间**零账本改动**，故 §2 / §4 的基线数字在两 HEAD 上等价；此后新提交可能使个别数字漂移（台账卡自述「台账快照会随并行提交过期」）。

---

## 9. 修复轮追加（2026-10-08 深夜，本报告写成后立即执行）

本报告 §7 的建议在写完后**当场执行了一轮**，此处如实记录哪些已落地、哪些被实测推翻。

| 项 | 结果 | 提交 |
|---|---|---|
| 覆盖口径分母漏 12 条真闸 | ✅ **已修**：口径改为「清单条目 ∪ check-*」，`41/44 → 53/56`；加回归网钉死（非 `check-*` 命名项必须同时进分子分母） | `1e58f6ed4` |
| 本地 push 重复跑契约测试 | ✅ **已修**：CI `contracts` job 已全量跑同一脚本（`test.yml:98`，注释自明「与本地同源」），本地不再重复；**push 63.0s → 28.4s** | `6c858f0e9` |
| CI 可视化空洞 | ✅ **已修**：加 `summary` job（8 个 job 结论/门控压成一页 `GITHUB_STEP_SUMMARY`），`needs` 列全 + `if: always()`；needs 解析失败显式红（拒绝假绿） | `ec9b61439` |
| `frontend-gates` 单点无门控 | ✅ **已修**：加 `needs: [contracts]`（契约红则治理结论不可信），实测不拉长关键路径 | `a5e6c354b` |
| 输出策略分裂（4 处 `--json`） | ✅ **改 2 留 2**：`check-redlines` / `check-go-diff-coverage` 改人读；`check-deadcode-baseline` **必须留 `--json`**（它是 CI「不写盘」开关，见下）；`e2e-coverage-report` 留（产物采集） | `a5e6c354b` |
| 静态工具段无时限 | ✅ **已加**：耗时预算护栏（默认 30s），超时点名最慢项；含**瞬态复跑校验**（防冷缓存假红——上线当日即误报一次 `go list` 33.5s vs 复跑 1.0s） | `78a78ebae` / `4a749b3c0` |
| 契约测试双表不一致（CI 红） | ✅ **已修**：`test_check_worker_lifecycle.ts` 补登记进 `CONTRACT_TEST_TARGETS`；契约测试 125/127 → **126/127** | `4a749b3c0` |
| `check-unread-fields` 18.3s 独占 | ✅ **已摘**：rc 恒 0 从不拦人 + 判定 72% 归属存疑 + 18.3s，移出手动跑 | `78a78ebae` |
| `drift-scan` 挂 push | ⚠️ **加了又撤**：我误挂（未量集成耗时、信号未验证），同日撤销，保持手动可用 | `76651c051` → `945f1cbbe` |

### 9.1 本节纠正的自身误判（写进正文以免后人重蹈）

1. **「push 走 `allMode` 分支无条件全量」——错**。`allMode = args.all`（`pre-push-gate.ts:138`），而 push 不传 `--all`（`.githooks/pre-push:44` 只透传 git refs）⇒ push 落 `schedule.ts` 的**域裁剪分支**。域分组**是生效的**（实测输出显示 frontend/docs/go 三组分别执行）。
2. **「静态段 24.4s 是 push 成本」——误导**。24.4s 是我手测清单条目之和；真实 push 是 **63.0s**，其中**契约测试 32.6s 占一半**，静态段只约 25s。
3. **「`drift-scan` 那条 INLINE_BAN_STRIP 是误报」——错**。该行位于 heredoc 内且随后有 `go run genindex.go`（L169），**是真被执行的 Go 代码**，即真违规；真正的缺陷是「同一段 heredoc 里权限规则开了定点豁免、这条 error 级规则没开」→ 扫描永久红且无人挂载，两个沉默互相遮蔽。
4. **「redlines 账粗于实（63 vs ≈22），应收账到 22」——错**。实测 live 是 **66**，账本 63 反而**低于**实测；且 `count` 字段不参与比较（棘轮键集是 `violations`），`--baseline` 判决为 `newViolations: 0 / ok: true`。真正的活儿是修误报规则（R2 漏豁免单行 JSDoc `/**`、W1 只排了一种字符类顺序），修后 66 → 62。
5. **门禁时间的账要从「运行时实测」取，不能从清单条目手测累加**——第 2 条就是栽在这上面。

### 9.2 仍未做（留待后续）

- `_summary.errors[]` → `::error file=,line=::` annotation 化（每脚本 2–3 行）。
- `ALL_STATIC_TOOLS` 31 项由 `schedule.ts` 无条件并入 push（域无关的通用项），可再按域筛一层。
- 分支保护（建议放最后：job 粒度粗时先开会得到「红了不知红在哪」）。
- `check-diff-coverage.ts` 有实现、有契约测试，但 **CI 与本地均无独立执行入口**（本地缺覆盖率产物恒 rc=2）——「暂未接线」而非「设计豁免」。
- 工作区遗留：`scripts/baseline/deadcode-baseline.json` 有未提交改动（一次无 `--json` 的验证运行触发了脚本的**自动收编**，把并行会话漏收编的 2 项写入账本）。该改动**不属于本次修复范围，未提交**，留待归属方处置。**（实测补充见 §10.3：差异已精确到 3 项，且它是 CI 绿的必要条件。）**

---

## 10. 可复现台账（2026-10-08 23:5x 实测）

> **本节的写法受 `docs/knowledge/verify-before-conclude.md`「可复现结论纪律」约束**：每条断言必须能贴出一条可复跑命令，并给出**当次原始输出**。给不出命令的结论只能标「未验证」。
> 复跑方式：在仓库根逐条执行「命令」列；数值为 2026-10-08 深夜本机（Windows + go/node 齐备）实测。

### 10.1 门禁现状（每条附复跑命令）

| 断言 | 复跑命令 | 当次实测输出 |
|---|---|---|
| 契约测试全绿 | `node scripts/contract-tests.ts` | `[contract-tests] 127/127 通过（32.5s）` |
| 覆盖口径 | `node scripts/doctor.ts --docs` | `覆盖口径: 53/56 项门禁清单条目已接入`（含非 `check-*` 命名；未接入：`check-unread-fields.ts`） |
| 文档门禁全绿 | `node scripts/doctor.ts --docs` | `结论: PASS ✅ （DRY-RUN） 23/23 项通过` |
| 红线候选 62 条 | `node scripts/check-redlines.ts --json` | `"_summary":{"rules":20,"violations":62…}` |
| deadcode 债 | `node scripts/check-deadcode-baseline.ts --json` | `_summary: {"errors":0,"knip":185,"jscpd":120}` |
| `drift-scan` 已绿且**未挂载** | `node scripts/drift-scan.ts` → 应 exit 0；`git grep -n 'drift-scan' -- .githooks scripts/_lib/gate-coverage.ts` → 应无命中 | `📊 总计: 0 处漂移`；零挂载命中 |
| 脚本类型检查 | `npx tsc --noEmit -p scripts/tsconfig.json` | `exit=0`（无输出即通过） |
| 本地 push 时长 | 见 §10.2 的 stdin 构造 | 4.9s（域裁剪命中窄域时）～28.4s（宽域） |

### 10.2 本地 push 复现（含 stdin 构造，否则 exit 2）

`pre-push-gate` 是 stdin 驱动且**必须传 remote 位置参数**（`pre-push-gate.ts` 的 `if (!remoteName) return 2`）：

```powershell
$local  = git rev-parse HEAD
$remote = git rev-parse '@{u}'
$url    = git remote get-url origin
$stdin  = "refs/heads/main $local refs/heads/main $remote`n"
$stdin | node scripts/pre-push-gate.ts origin $url
```

- 缺 `<remote-name> <remote-url>` ⇒ **exit 2 + 0.1s**（我本轮踩过，误判为「工具坏了」）。
- 想看域裁剪命中情况：输出首行的 `变更域:` 行。

### 10.3 `deadcode-baseline.json` 未提交改动（归属与必要性）

**差异已精确到 3 项**（复跑：比对工作区与 `git show HEAD:…`）：

| 类型 | 项 | 来源 |
|---|---|---|
| jscpd +1 | `preview-3d/infra/render-host.raf-contract.test.ts#…session-restart.test.ts` | `764e013e6`（G1/G4 测试） |
| knip +1 | `src/preview-3d/state/env-state-schema.ts\|exports\|ARCHIVE_ALIAS` | `de3ce7cf7`（ADR-326） |
| knip −1 | `src/preview-3d/infra/render-host.ts\|exports\|RendererHost`（已清） | 同上 |

净变化：knip 185（+1−1 抵消）、jscpd **119 → 120**。

- **成因**：一次**无 `--json`** 的验证运行触发了脚本的自动收编（`check-deadcode-baseline.ts` 的 `!JSON_OUT` 分支会写盘）。这是脚本的设计行为，非异常。
- **性质**：它补的是**并行会话漏收的账**（两个 commit 新增了死键/重复对却没同步账本）。
- ⚠️ **未验证项（如实标注）**：知识卡记载「基线自动收编必须随提交入库，否则 CI 结构性红」。本轮**未能直接实证**该步——干净 worktree 里缺 `frontend/node_modules`，knip/jscpd 未安装，跑出来是 `[工具缺失]`（`knip=0 jscpd=0`），**属假信号**。故此处只引用既有机理 + 上述差异证据，**不宣称已实测**。
- **处置建议**：由**归属方**（并行会话）提交该账本，或在其确认后由主模型提交。

### 10.4 本轮新增的机器防线（供后人复用）

| 防线 | 位置 | 拦什么 |
|---|---|---|
| `invariant_anchors` 锚校验 | `check-knowledge-drift` | 改工作流依赖图却不同步知识卡（**本轮实测抓到 2 次**：`needs: [contracts]` 失效、`checkAdrHealth` 凭空捏造） |
| 静态工具段耗时预算 | `gate-blocks/static-tools.ts` | 无预算地把慢项塞进全队 push（含**瞬态复跑校验**，防冷缓存假红） |
| 覆盖口径按清单条目计 | `_lib/gate-coverage.ts` | 按文件名过滤导致真闸隐身（`41/44 → 53/56`） |
| 域裁剪 + 空集保守全量 | `test.yml` 的 `changes` job | 「四域全 false ⇒ 全 job 跳过 ⇒ CI 假绿」 |
| summary 的 `unknown` 判红 | `test.yml` 的 `summary` job | `needs` 解析失败静默回落「全部通过」 |

