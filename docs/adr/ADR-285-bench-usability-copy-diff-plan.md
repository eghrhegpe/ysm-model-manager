# ADR-285：跑基准可用性收口：动作与参数同序、文案去重、术语本地化

- **状态**：📝 提议中（Proposed）—— **待 Jieling 逐条拍板**，清单见 §2.0（勾选采纳 / 否决 / 改法）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）。**本 ADR 是方案文书：只出 diff 预案，未动任何源码**
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-278 / ADR-262 / frontend/src/views/app-content/tpl.ts / frontend/src/views/app-content/diagnostics/perf.ts / frontend/src/locales`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->
**本轮审核（2026-09-20）以四问切入「跑基准」tab**：上手难度 / 按钮布局 / 开放的按钮是否难以调整 / 三语翻译是否奇葩。全部结论均以源码与脚本实测取证，不靠记忆推断：

### 1.1 行序实测（`tpl.ts:200-277`）

| 单模型模式可见行 | 行号 | 并发模式可见行 | 行号 |
|---|---|---|---|
| ① 怎么跑（模式下拉）+ hint | 202-209 | ① 怎么跑 | 202-209 |
| ② 测什么（目标集） | 210-215 | ② 测什么（标签改写为「测哪些」） | 210-215 |
| ③ 排序 | 216-221 | ③ 排序 | 216-221 |
| ④ **▶ 运行按钮** + 模型路径框 + hint | 222-226 | ④ **▶ 运行按钮** + worker 数 | 231-235 |
| ⑤ 迭代次数 | 227-230 | ⑤ 最多模型数 | 240-243 |
| ⑥ 最多模型数 | 236-239 | | |
| ⑦ 基准三件套（记录 / 对比 / 阈值） | 244-251 | | |

**病**：运行按钮排在自己消费的**一半参数之前**（迭代 / 上限 / 基准三件套全在按钮下方）；同页三处运行入口三种排法（`scan` tab 是正面样本：按钮与它唯一的参数同行，`tpl.ts:268-270`）。按 F 型扫视者会在第 4 行先撞到按钮，用默认值直接跑。

### 1.2 主按钮权重实测

| 按钮 | class | 出处 |
|---|---|---|
| `#diag-perf-run` | `btn-base accent` | `tpl.ts:223` |
| `#diag-perf-conc-run` | **只有 `btn-base`** | `tpl.ts:232` |
| `#diag-perf-scan-bench` | `btn-base accent` | `tpl.ts:268` |

切到并发模式，页面上唯一的主按钮掉了强调色。

### 1.3 「开放的按钮」是否摆设：逐个回查 Go flag（**结论：无摆设**）

| 控件 | 落到哪 | 证据 |
|---|---|---|
| `#diag-perf-conc-workers` | `--workers`（1~256 校验） | `go/cli/bench_concurrent.go:82,93-97` |
| `#diag-perf-conc-max` | `--max-models` | `go/cli/bench_concurrent.go:33` |
| `#diag-perf-iter` / `#diag-perf-scan-iter` | `--iterations` | `bench_concurrent.go:469` / `scan_bench.go:340` |
| 基准三件套 | `--baseline` / `--save-baseline` / `--threshold-pct` | `bench_concurrent.go:523` |

**但有一处语义落差**：`--workers` 不是「就用这么多」，而是**档位上限**——`concurrentWorkerCounts` 取 `{2,4,workers} ∩ ≤workers` 并集（`go/cli/bench_concurrent_json.go:101-119`，`:228` 的文件读取阶段才用原值）。填 8 → 实测 **2/4/8 三档**。hint 提了「含 2 / 4 / 目标值三档」，但 label「并发 worker 数」读起来像「就用 8」。**难点不在「能不能调」，在「调了什么算数」**。

### 1.4 三语体检（脚本实测）

`node scripts/i18n-check.ts` **全绿**：1492 键 × 3 语，`en`/`ja` missing=0 extra=0，占位符一致，zh 无漏译。故不是缺键 / 半英文的系统病，而是下面 5 类**具体措辞**（§2.3 逐条给 diff）：

1. **按钮 title 把同一件事播报三遍**（结构性问题）：`perfScopeHint` = 短 scope 句 + 该模式机制句（`perf.ts:91-97`），而机制句自身已含 scope 尾巴 →
   - conc 串起来 =「测什么：**一批模型的串行 vs 并行** · **串行 vs 并行**的实测加速比…；测的对象 = **一批模型**」（`zh-CN.ts:357+359+417`）
   - scan =「测什么：**整库目录树扫描（不解析模型文件）** · …；测的对象 = **整库目录树，不解析模型文件**」（`zh-CN.ts:360+441`）——首尾近乎逐字重复
2. 中 / 日界面夹英文 `workers`（`zh-CN.ts:415,421,425`、`ja.ts:424,428,432`）
3. zh `perfMaxModels` =「最多模型数」（`zh-CN.ts:487`）名不副实：目标集选「每个类型各取几条」时该值是**每类条数**，总数远超它（title 自陈，`zh-CN.ts:489-490`）；en「Sample cap」/ ja「サンプル上限」都中性
4. 诚实层改口信息量≈0：单模型「测什么」（`zh-CN.ts:468`）→ 并发「测哪些」（`:368`），差异只在单复数，用户读不出「语义变了」
5. 撞名与风格不齐：`perfScopeHint` 前缀「测什么：」与目标集 label「测什么」撞名；en 模式选项 `Single model` / `Batch concurrency`（`en.ts:360-361`）；en `perfConcurrentHint` 用内部黑话 "tiers 2 / 4 / target"（`en.ts:426-427`）；tab 词性不齐（en「Benchmark」名词 vs zh「跑基准」动词，`en.ts:532`）

### 1.5 既有 ADR 的内部矛盾

`ADR-278 §2.7` item 1 称「公共区（测什么 / 排序 / **最多模型数**）置于控制条**最上**且模式无关」，而 `§2.3` 明确「取样上限**有意不合并**」（single 默认 5 / conc 默认 20，故仍是两条按模式显隐）；实装选了 §2.3，且模式行在最上。同一份 ADR 里两种说法并存，需补注。

## 2. 决策（Decision）

### 2.0 拍板清单（逐条勾选；勾「采纳」即按下方 diff 执行）

| 编号 | 改动 | 批次 | 触点 | 风险 | 拍板 |
|---|---|---|---|---|---|
| P0-1 | 运行按钮 title 去重复播报（删机制句尾部的 scope 尾巴） | 零风险 | 三语 6 文件各 2 处 | 极低（已核契约测试不锁全文） | ☐ 采纳 ☐ 否 ☐ 改法 |
| P0-2 | `#diag-perf-conc-run` 补 `accent` | 零风险 | `tpl.ts:232` | 极低（无 class 断言） | ☐ 采纳 ☐ 否 |
| P0-3 | zh「最多模型数」→「取样上限」 | 零风险 | `zh-CN.ts:487` + 2 处注释 | 低（e2e 只比较三次读数相等） | ☐ 采纳 ☐ 否 |
| P0-4 | 中 / 日 `workers` 术语本地化 | 零风险 | zh 4 处 + ja 4 处 | 极低（键名不变） | ☐ 采纳 ☐ 否 |
| P1-1 | 运行按钮移到该模式参数**之后**（先配置后执行） | 布局 | `tpl.ts:222-251` | 低（门槛：input/select 行的 `data-perf-mode` 不变） | ☐ 采纳 ☐ 否 ☐ 选方案 |
| P1-2 | 公共区提到最上（落实 §2.7 原话，模式行下移） | 布局 | `tpl.ts:200-251` | 中（阅读顺序变更，需用户拍） | ☐ 采纳 ☐ 否 |
| P1-3 | `.perf-controls` 内加视觉分组（公共区 / 该模式参数 / 基准） | 布局 | `content-diag.ts:98-108` + `tpl.ts` | 中（新 CSS 类要走 css-layer-check 命名域） | ☐ 采纳 ☐ 否 |
| P2-1 | worker label →「最大并发路数」（说清是档位上限） | 语义 | 三语 6 文件 | 低 | ☐ 采纳 ☐ 否 |
| P2-2 | 并发目标集改口带原因：「测哪些（并发没有单模型）」 | 语义 | 三语 6 文件 | 低 | ☐ 采纳 ☐ 否 |
| P2-3 | `perfScopeHint` 前缀「测什么：」→「这次测的是：」（消撞名） | 语义 | `perf.ts:93` + 三语 | 低 | ☐ 采纳 ☐ 否 |
| P3-1 | `ADR-278 §2.7` 补注（与 §2.3 的分工） | 文档 | `docs/adr/ADR-278-*.md` | 极低 | ☐ 采纳 ☐ 否 |
| P3-2 | 知识卡补记本轮审核结论 | 文档 | `docs/knowledge/app_content_diagnostics.md` | 极低 | ☐ 采纳 ☐ 否 |

---

### 2.1 P0 零风险批（4 条，可一批提交）

#### P0-1 运行按钮 title 去重复播报

**现状**（`perf.ts:91-97`）：

```ts
export function perfScopeHint(mode: string): string {
  const nameKey = PERF_MODE_NAMES[mode];
  const scope = t("diagnostics.perfScopeHint", { mode: nameKey ? t(nameKey) : mode });
  if (mode === "conc") return `${scope} · ${t("diagnostics.perfConcurrentHint")}`;
  if (mode === "scan") return `${scope} · ${t("diagnostics.perfScanBenchHint")}`;
  return scope;
}
```

**diff 预案（方案 A，推荐）**：不动组装，只删机制句尾部的 scope 尾巴（scope 句已在前半播过一次）：

| 文件:行 | before（尾段） | after |
|---|---|---|
| `zh-CN.ts:416-417` | `…加速比与判决由 Go 判定；测的对象 = 一批模型` | `…加速比与判决由 Go 判定` |
| `zh-CN.ts:440-441` | `…而不是 0ms；测的对象 = 整库目录树，不解析模型文件` | `…而不是 0ms` |
| `en.ts:426-427` | `…decided in Go; scope = a batch of models` | `…decided in Go` |
| `en.ts:453-454` | `…not 0ms; scope = the whole repo directory tree, no model parsing` | `…not 0ms` |
| `ja.ts:425-426` | `…判定は Go が決定します；対象 = 複数モデル` | `…判定は Go が決定します` |
| `ja.ts:449-450` | `…（0ms ではない）；対象 = リポジトリ全体のディレクトリツリー、モデル解析なし` | `…（0ms ではない）` |

**替代方案 B（不推荐）**：`perf.ts:94-95` 不再拼机制句，机制句搬去结果区首行。信息不重复且结果区自带「这次怎么跑」，但会撞 `perf-mode.test.ts:217` 的 `expect(perfScopeHint("single")).not.toContain("·")`（组装形态断言）与 `:205-206` 关键词断言，须同步改测试；收益小于成本。

**风险（已核）**：
- `tests/test_cli_gui_flow_contract.ts:755-767` 只断言「三语都有该键」+「`perf-scan-bench.ts` / `tpl.ts` 引用了它」，**不锁文案全文** → 删尾句不红 ✓
- `perf-mode.test.ts:205-206` 只断言 title 含「一个模型」/「一批模型」语义关键词 → 不红 ✓
- 生成物 `frontend/public/locales/*.json` 由 pre-commit 的 GEN_CMDS 同步，手改只改 `src/locales/` ✓

#### P0-2 并发运行按钮补 accent

`tpl.ts:232`：

```diff
-        <button class="btn-base" id="diag-perf-conc-run" data-testid="diag-perf-conc-run">${UI_ICONS.performance} ${t("diagnostics.perfRunConcurrent")}</button>
+        <button class="btn-base accent" id="diag-perf-conc-run" data-testid="diag-perf-conc-run">${UI_ICONS.performance} ${t("diagnostics.perfRunConcurrent")}</button>
```

**风险（已核）**：`grep 'accent|btn-base' frontend/e2e/diagnostics.spec.ts` = 0 命中；单测也不断言 class ✓

#### P0-3 zh 上限标签改中性措辞

`zh-CN.ts:487`：

```diff
-  "diagnostics.perfMaxModels": "最多模型数",
+  "diagnostics.perfMaxModels": "取样上限",
```

理由：该值是「目标集的展开单位 × 条数」，选「每个类型各取几条」时总数远超它。en「Sample cap」/ ja「サンプル上限」本已中性，**只有 zh 名不副实**；改后与自身 title（`zh-CN.ts:489-490`）自洽。

**风险（已核）**：
- e2e 确实读该标签正文（`diagnostics.spec.ts:484-490` `readMaxLabelText`），但断言是 `expect(texts).toEqual([texts[0], texts[0], texts[0]])`（`:734`）——**比较三种目标集下的读数彼此相等**，不比对字面量 → 改文案不红 ✓
- 命中字面量的两处注释须同步：`diagnostics.spec.ts:483`（helper 文档注释）、`tpl.ts:26-27`（`VIEW_TESTIDS` 注释自陈「标签文案恒为『最多模型数』」）→ 属同一批顺手改，避免注释与实装脱节

#### P0-4 中 / 日 `workers` 术语本地化

| 键 | 文件:行 | before | after |
|---|---|---|---|
| `perfConcurrentWorkers` | `zh-CN.ts:415` | 并发 worker 数 | 并发路数 |
| `perfConcurrentWorkersN` | `zh-CN.ts:421` | {n} workers | {n} 路并行 |
| `perfConcurrentRow` | `zh-CN.ts:425` | 并行 {workers} workers | 并行 {workers} 路 |
| `perfConcurrentParamInvalid` | `zh-CN.ts:434-435` | …worker 数须为 1~256… | …并发路数须为 1~256… |
| `perfConcurrentWorkers` | `ja.ts:424` | 並列 worker 数 | 並列数 |
| `perfConcurrentWorkersN` | `ja.ts:428` | {n} workers | 並列 {n} |
| `perfConcurrentRow` | `ja.ts:432` | 並列 {workers} workers | 並列 {workers} |
| `perfConcurrentParamInvalid` | `ja.ts:442-443` | …worker 数は 1~256… | …並列数は 1~256… |

**风险（已核）**：键名与占位符不变 → 消费点 `perf-concurrent.ts:168-169,225` 零改动；`en` 保持 "workers"（英文语境合法），仅可选把 `perfConcurrentRow` 的 "Parallel {workers} workers" 收紧为 "Parallel ({workers} workers)"。

---

### 2.2 P1 布局批（3 条，需拍板选方案）

#### P1-1 运行按钮移到「该模式参数之后」（推荐方案 A）

**现状**：按钮与模型路径框同行（`tpl.ts:222-226`），而它消费的迭代 / 上限 / 基准三件套在下方（`:227-251`）。

**diff 预案**：把两处运行按钮各自拆成独立行，置于本模式参数之后——

```
单模型模式（data-perf-mode="single"）   并发模式（data-perf-mode="conc"）
  ① model 路径框 + hint                   ① conc-workers
  ② iter                                  ② conc-max
  ③ max                                   ③ ▶ 运行并发基准      ← 从第 4 行移到这里
  ④ baseline 三件套
  ⑤ ▶ 运行单模型基准   ← 从第 1 行移到这里
```

**风险（已核）**：
- 穷尽护栏的扫描面只收 `<input|select>`（`perf-mode.test.ts:338-341`），**button 不入账** → 按钮换行不影响两道护栏 ✓
- **硬门槛**：拆行后每个 `input/select` 必须仍落在**带相同 `data-perf-mode`** 的 `perf-row` 内（第一道 `perf-mode.test.ts:396-408`「行归属 ∨ 不读表 ∨ 公共区」；第二道 `:422-439`「single 下可见者须声明单模型目标读不读」）。逐行补 `data-perf-mode="single"` / `"conc"` 即满足。
- 护栏是**顺序无关**的（`:343-354` 只做包含性抽样）→ 重排行序本身不红 ✓
- `perfIdle`「点上方按钮开始」仍成立（按钮仍在结果容器之上）✓

#### P1-2 公共区提到最上（可选，落实 ADR-278 §2.7 原话）

**现状**：模式行在最上，公共区（测什么 / 排序）在其下——与 §2.7「公共区置于控制条**最上**」字面不符（§1.5）。

**diff 预案**：把「测什么」「排序」两行整体上移到模式行之前（阅读顺序 = 范围 → 命令 → 参数 → 执行）。

**⚠️ 连带改动（易漏）**：`perfModeHint` 三语都写着「**下方**「测什么」」/ "「What to test」**below**" / 「**下**の「何を測るか」」（`zh-CN.ts:517-518`、`en.ts:530-531`、`ja.ts:525-526`）→ 上移后必须同步改成「上方」/ "above" / 「上」。漏改就是**界面自我矛盾**。

**风险**：中。阅读顺序是产品判断，且 §2.7 的「最上」是否真要照办（模式行在最上其实符合「先选命令再圈范围」的另一种直觉）需用户拍板。

#### P1-3 控制条视觉分组

**现状**：`.perf-controls` 是无分组纵向框（`content-diag.ts:99`），single 下 7 行控件仅靠底部一条 border 收口。

**diff 预案**：模板加三个分组的包裹行 + `content-diag.ts` 增 `.perf-group` / `.perf-group-title` 两条规则（标题小字、`--fs-xs`、`color:var(--muted)`，与既有 `.perf-section` 同语汇）。分组：① 公共区（怎么跑 / 测什么 / 排序）② 该模式参数 ③ 基准对比。

**风险**：中。新类名走 `scripts/css-layer-check.ts` 检查 3 的**自推导命名域**（本域已定义 `.perf-*` ⇒ `perf-` 属本域，新同类名自动纳入判定 ✓）；若分组标题用文案，须补三语键（+3 键 × 3 语）。

---

### 2.3 P2 语义批（3 条）

#### P2-1 worker 输入标签说清「档位上限」

`perfConcurrentWorkers` 三语：zh「最大并发路数」（`zh-CN.ts:415`）、en「Max concurrent workers」（`en.ts:425`）、ja「最大並列数」（`ja.ts:424`）。

**⚠️ 与 P0-4 同键**：若两条都采纳，P0-4 对该键的那一行直接落 P2-1 的最终值，**不要先改「并发路数」再改一次**（避免同键两次改写）。

**风险（已核）**：键名不变；e2e 无对该 label 的正文断言 ✓

#### P2-2 并发目标集改口带原因

| 文件:行 | before | after |
|---|---|---|
| `zh-CN.ts:368` | 测哪些 | 测哪些（并发没有单模型，已回落到全库） |
| `en.ts:365` | Which to test | Which to test (no single model in concurrent runs) |
| `ja.ts:367` | 何を測るか（複数） | 何を測るか（並列に単一モデルはない） |

理由：诚实层要求「同控件跨模式改义当场说清」（ADR-278 §2.6），而现措辞只在单复数上微调，信息量≈0；真正变的是**选项集语义**（单模型项被禁 + 值回落到全库）。

**风险（已核）**：e2e 是**英文界面**断言，`:921` 用 `expect(got.target).toContain("Which to test")` —— 子串匹配，加括号后缀仍绿 ✓；但 en 改文案时**必须保留子串 `Which to test`**，否则该 e2e 转红（`diagnostics.spec.ts:899` 注释明说「语义关键词不锁拼接形态」）。

#### P2-3 消撞名：`perfScopeHint` 前缀（**zh 独有**）

- 撞名只发生在 zh：`perfScopeHint` =「测什么：{mode}」（`zh-CN.ts:357`）与目标集 label「测什么」（`zh-CN.ts:468`）同词 → 用户会把按钮 title 读成下拉说明。
- en（"Measures: {mode}"）/ ja（「測定対象：{mode}」）与各自 label（"What to test" / 「何を測るか」）不同词，**不撞名，无需改**。
- diff：`zh-CN.ts:357` `"测什么：{mode}"` → `"这次测的是：{mode}"`。

**风险（已核）**：`perf-mode.test.ts:205-206` 只断言 title 含「一个模型」/「一批模型」；`:217-219` 只断言未知模式落通用句且不含 `·` → 改前缀不红 ✓

---

### 2.4 P3 文档批（2 条）

#### P3-1 `ADR-278 §2.7` 补注

在 §2.7 item 1 的公共区句后追加一句：

> ⚠️ 「最多模型数」**不在**公共区常驻：§2.3 明确它有 single/conc 两个真实口径（默认 5 / 20），故实装仍是两条按模式显隐；本 item 的「公共区」仅指「测什么 / 排序」。另：模式行位于公共区**之上**（先选命令再圈范围），与「公共区置于最上」的字面表述以本节为准。

#### P3-2 知识卡补记

`docs/knowledge/app_content_diagnostics.md` 追加本轮审核结论要点：无摆设控件（逐个对账 Go flag）、`--workers` 是档位上限、i18n parity 全绿 + 5 类措辞问题索引、两道穷尽护栏的位置与判据。**知识卡承担实施进度与事实**（ADR 只记决策方向）。

---

### 2.5 护栏影响矩阵（已逐条核实，实施时照此裁剪验证）

| 检查 | 是否受影响 | 核实结论 |
|---|---|---|
| `tests/test_cli_gui_flow_contract.ts §3.8`（`SCAN_BENCH_I18N_KEYS`，`:727-767`） | 否 | 只断言「三语有键 + 被 `perf-scan-bench.ts`/`tpl.ts` 引用」，不锁文案全文 |
| `perf-mode.test.ts:205-206` | 否 | 语义关键词 `toContain`，不锁拼接形态 |
| `perf-mode.test.ts:217-219` | 否（方案 A）／是（方案 B） | 锁 `perfScopeHint` 拼接形态（`not.toContain("·")`） |
| `perf-mode.test.ts:338-408`（第一道穷尽护栏） | P1 需配合 | input/select 必须落在带 `data-perf-mode` 的行内（button 不入账） |
| `perf-mode.test.ts:416-439`（第二道：single 可见者须声明） | P1 需配合 | 拆行后逐行补 `data-perf-mode`；`diag-perf-iter` 靠行 gate 合格 |
| `frontend/e2e/diagnostics.spec.ts:483-490,734` | P0-3 只动注释 | 断言是「三种目标集读数彼此相等」，非字面量 |
| `frontend/e2e/diagnostics.spec.ts:905,921` | P2-2 需保留子串 | en 界面断言 `toContain("What to test")` / `toContain("Which to test")` |
| `frontend/e2e/diagnostics.spec.ts`（class 断言） | 否 | `accent`/`btn-base` 零命中 |
| `scripts/i18n-check.ts` | 否 | 只改值不改键/占位符，parity 保持全绿 |
| `scripts/css-layer-check.ts` | P1-3 需过 | 新 `perf-*` 类自动纳入本域命名域检查 |
| `frontend/public/locales/*.json` | 生成物 | 只改 `src/locales/*.ts`，pre-commit 的 GEN_CMDS 自动同步 |

**实施后统一验证口令**：`cd frontend && npx vite build && npm run typecheck` + `node scripts/check-biome.ts --files <改动文件...>` + `node scripts/contract-tests.ts`；e2e 若跑则须覆盖 `diagnostics.spec.ts`。

### 2.6 未纳入本方案的观察项（仅备案，不拍板）

| 观察 | 为何暂不动 |
|---|---|
| en 模式选项 `Single model` / `Batch concurrency`（`en.ts:360-361`）风格不齐 | 属文案品味；收益低于一次全站术语对齐的成本 |
| tab 词性不齐：en「Benchmark」名词 vs zh「跑基准」动词（`en.ts:532`） | zh 的动词短语与 ADR-278 §2.1「动作组」命名一致；动 en 会牵动 tab 契约测试，留待全站 tab 命名统一时一起做 |
| 网页版 `bench` tab 整体消失且无解释文案 | `desktopOnly`（`tpl.ts:193`）是 ADR-278 §2.5 的既定决策；要加解释文案须先定「隐藏 tab 是否给占位」的全站规则 |
| `#diag-perf-iter` 无 `data-testid`（同页 `#diag-perf-max` 有） | e2e 不直接改它（只用 `iter-label`），无实际缺口；属 ADR-133 阶段 C+ 的收尾账 |
| 两处上限同键不同默认（5 / 20） | ADR-278 §2.3 明确「有意不合并」（深测 vs 广度扫），不是债 |
| `--workers` 跑 {2,4,该值} 三档 | Go 侧刻意设计（`bench_concurrent_json.go:101-119` 注释记录了重复档 / 越界档两处修复史），属机制非缺陷 |

---

## 3. 后果（Consequences）

**正面**

- 主按钮权重统一（三处运行入口同 `accent`），新手不必在「哪个是要点的」上做判断。
- 运行按钮 title 不再把同一件事播报三遍——三语皆然。
- zh 上限标签名实相符（与 en / ja 的中性措辞对齐），消掉「叫最多模型数，却出现更多模型」的读后困惑。
- 中 / 日界面不再夹英文 `workers`。
- P1-1 若采纳：阅读顺序变成「范围 → 命令 → 参数 → 执行」，与 ADR-278 §2.7「先选命令，再圈范围」的心智模型同向。
- 全部改动均为**文案 / class / 行序**级：**零 Go 改动、零契约载荷改动**，可分批提交、逐条回退。

**负面 / 代价**

- P1-1 移动用户肌肉记忆（运行按钮从第 4 行到末行），老用户需一次适应。
- P1-2 若采纳，必须连带改三语 `perfModeHint` 的「下方 / below / 下」（§2.2 已标）——漏改即界面自相矛盾，正是本 ADR 要防的那类账。
- P0-3 改文案后老用户一时找不到「最多模型数」，但 title 解释仍在（`zh-CN.ts:489-490`）；按「标签恒定、单位只进 title」的既有契约，这是唯一正确落点。
- P1-3 是本节唯一「增加维护面」的项（新 CSS 类 + 可选 3 个文案键 × 3 语）。

**已知遗留 / 边界（明确不做）**

- 不改默认值（single 5 / conc 20）——有 ADR-278 §2.3 的依据。
- 不合并两处上限控件；不改 `--workers` 的三档机制。
- 不为网页版补 `bench` tab 或占位说明。
- 不动 CLI 参数面与载荷字段（本 ADR 是纯前端可用性收口）。
- `gui`（端到端流程）是否并入 `bench`：沿用 ADR-278 §3 的「暂不并」。

---

## 4. 数据溯源

| 来源（实测） | 结果 |
|---|---|
| `tpl.ts:200-277` 通读 | 行序表（§1.1）、按钮 class 三态（§1.2）、控件与 `data-perf-mode` 的绑定关系 |
| `perf.ts:91-97` / `:122-192` | `perfScopeHint` 组装式 → title 三重复述的机制（§1.4-1） |
| `perf.ts:45-65` + `perf-mode.test.ts:338-439` | 两道穷尽护栏的确切判据（§2.5）——**护栏只收 input / select，button 不入账**，故 P1-1 的按钮换行不触发它们 |
| `perf-concurrent.ts:261-280` + `go/cli/bench_concurrent.go:82,93-97,469,523` + `scan_bench.go:340` | 每个暴露控件的 Go 落点（§1.3）→「无摆设控件」结论 |
| `go/cli/bench_concurrent_json.go:101-119,228` | `--workers` = 档位上限（`{2,4,workers} ∩ ≤workers`）→ 语义落差（§1.3） |
| `node scripts/i18n-check.ts` | 1492 键 × 3 语 parity 全绿，占位符一致，zh 无漏译（§1.4 前置结论） |
| `node scripts/check-i18n-unused.ts` | 热点前缀与真死键样例中**无 `diagnostics.perf*`** → 本族键无孤儿迹象 |
| `tests/test_cli_gui_flow_contract.ts:727-767` | `SCAN_BENCH_I18N_KEYS` 只断言「三语有键 + 被引用」→ 删尾句不红 |
| `frontend/e2e/diagnostics.spec.ts:483-490,734,905,921` | `readMaxLabelText` 的比较方式（三态读数互等）与英文界面子串断言（`What to test` / `Which to test`）→ §2.5 的两条风险边界 |
| `content-diag.ts:93-108` | `.perf-*` 命名域已由 css-layer-check 自推导纳入 → P1-3 新类自动受检 |
| `ADR-278` §2.3 / §2.7 对读 | 内部矛盾（「最多模型数」是否常驻 + 「最上」字面）→ P3-1 补注 |
| `node scripts/new-adr.ts ... --dry-run` | 最大编号 284 → 本 ADR 占 285，无撞号 |

<!-- 文件名: bench-usability-copy-diff-plan.md → 实际文件 ADR-285-bench-usability-copy-diff-plan.md -->
