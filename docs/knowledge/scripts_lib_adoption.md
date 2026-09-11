---
kind: scripts_lib_adoption
name: _lib 共享层采用率闸门
tier: architecture
category: config
status: active
source_files:
  - scripts/check-lib-adoption.ts
auto_fields:
  symbols_with_lines: []
use_when:
  - lib adoption
  - 采用率
  - 共享层
  - 有能力未用
  - 手搓
  - 重复实现检测
  - RULES 表
  - toPosix 收敛
pitfalls:
  - 「文件级豁免吞残留」→ import 过 ≠ 用到底；豁免必须下沉到行级，否则「接入三成」的文件长期逃检
  - 「扫描面漏掉定义者」→ collectScripts 排除 _ 前缀目录，_lib 自身成法外之地；闸门须自省
  - 「能力定义文件自指误报」→ 每条规则必须豁免自身模块文件（to-posix.ts 的实现本体就是一条 replace）
  - 「smell 形态不全漏检」→ 同一能力常有等价写法（split 反斜杠 join 斜杠 逃过 replace 形态），补 smell 而非只认一种
  - 「孤儿判定口径过窄」→ 只数 scripts/ 侧 import 会把在役模块误报「建议归档」；_lib 互引、.githooks CLI 调用、tests 消费都是真实引用
  - 「零引用 ≠ 该归档」→ 必须先查 git 历史与 ADR：gate-ctx.ts 零引用是 ADR-206 阶段 1a 的「先建后接」预备件（战役未完成），不是废弃设计。归档前须排除「未落地战役半成品」
  - 「薄包装误报」→ `return walk(dir, {...})` 体内无 readdirSync，须靠自研特征而非函数名判定
  - 「名字过泛误报」→ collectSymbols 这类通用名可能是聚合上层逻辑，列入 smell 会持续误报
quick_groups:
  - 新增/调整守护规则（RULES 表）
  - 违规研判与误报排除
  - 共享层自身收敛（_lib 内手搓）
  - 采用率全景解读
quick_intents:
  - 检查某 _lib 模块是否被绕开手搓
  - 为新的共享模块加一条守护规则
  - 判定违规是「真残留」还是「误报」
  - 查看 _lib 模块被多少脚本引用
quick_risk_lines: []
invariant_anchors:
  - scripts/check-lib-adoption.ts|RULES
---

# _lib 共享层采用率闸门

## 概览

`scripts/check-lib-adoption.ts` 把 `check-proc-adoption` 的成功经验（非直调占比 100% 全收敛）推广为**规则驱动的通用闸门**：RULES 表声明「某 `_lib` 模块 → 手搓特征 / import 采用特征 / 迁移建议」，逐文件判定「手搓了该模块能覆盖的能力，却没用它」。默认 WARN 不阻断（退出码 0），`--strict` 有违规即 1。属治理/门禁类（config）脚本，由 `doctor` 消费。

## 核心职责

- **规则表驱动**：RULES 现有 6 条——`scan-files.ts`（自研遍历）/ `parse-args.ts` / `frontmatter.ts` / `source-graph.ts` / `to-posix.ts` / `git-ref.ts`。新增模块只需加一行。`proc.mjs` 刻意不在表内（归 `check-proc-adoption.ts` 专管，避免重复告警）。
- **行级判定（2026-09 下沉）**：违规分两类——`missing`（完全未 import，有能力却手搓）/ `remnant`（已 import 但文件内仍有手搓残留，「接入了，没用尽」）。旧实现是**文件级豁免**（import 过即整文件放过），实证 `gen-vitepress-sidebar.ts` 第 28 行早已 import `toPosix`、同文件内仍有 7 处手搓却全部逃检——「进过门」不等于「用到底」。
- **扫描面自省（2026-09 补齐）**：扫描面 = `collectScripts()` 的 scripts/ 脚本 ∪ `_lib` 非测试模块。`collectScripts` 有意排除 `_` 前缀目录（其余守卫不适用共享层），但这让**能力的定义处**反成唯一无人看守之地——实证 `_lib` 内藏 10 处斜杠归一（`collect-scripts` / `gen-stage` / `gen-cmds` / `machine-diff` / `jscpd-pairs`），因扫描面缺口长期无告警。
- **精确自身豁免**：每条规则跳过 `_lib/<rule.lib>` 对应文件——`to-posix.ts` 内那条 `replace` 正是 `toPosix` 的实现本体，报它「手搓 toPosix」属自指悖论。豁免精确到文件，**非目录级放行**。
- **注释遮蔽**：`//` 行注释、`/* */` 块注释整行清空（保留行号），smell 在遮蔽后全文上全局匹配，故支持**有界跨行正则**表达「自研实现」特征。行尾注释不清（`code(); // 说明` 仍是代码行，应按违规计）。
- **引用方池（2026-09 补正）**：采用率与「孤儿判定」的引用方池 = `scripts/`（含 `_lib` 自身）∪ `.githooks` ∪ `tests`（实测 213 文件）。旧口径只数 scripts/ 侧 import，把 6 个零引用中的 5 个误报为「建议归档」——`machine-diff` / `gen-config` 只被 `_lib/gen-stage.ts` import；`ts-alias-register` 经 `contract-tests.ts` 的 `execArgv --import` 路径字符串接线；`ts-alias-resolver` 经 `register()` 调用接线；`gen-stage` 经 `.githooks/pre-commit` CLI 调用。故采用信号补第二类：**路径字符串引用**（非 import 形态），仅在采用率/孤儿判定生效，不参与违规判定。
- **误报治理**（三条真实教训）：① `walk` 规则以「函数体内直接 `readdirSync`」判自研——薄包装 `return walk(dir, {...})` 体内无 `readdirSync`，自然豁免（实证 `css-layer-check.ts`）；② 从 `source-graph` 规则移除 `collectSymbols`——该名语义过泛，`gen-knowledge-symbols.ts` 的同名函数是「遍历 + 逐个调 `getExportedSymbolsAny` + 聚合」的上层逻辑，非重复实现；③ `to-posix` smell 须覆盖等价形态（`split("\\").join("/")` 曾逃过 `replace` 形态，首度补入即抓出 `jscpd-go.ts` 残留）。

## 对外 API / 入口

```bash
node scripts/check-lib-adoption.ts           # 文本报告（违规清单 + 采用率全景）
node scripts/check-lib-adoption.ts --json    # JSON（doctor/CI 消费）
node scripts/check-lib-adoption.ts --strict  # 有违规 → 退出码 1
```

- 退出码：默认 0（提示工具，WARN 不阻断）；`--strict` 且存在违规 → 1。
- `_summary` 契约：`{scripts, libs, violations, unusedLibs, ok}`；`violations[]` 每项带 `script / lib / capability / advice / kind / lines`。

## 与其他子系统关系

- `scripts/_lib/collect-scripts.ts`：脚本清单采集。其排除 `_` 前缀目录的语义**保持不变**（其余守卫依赖它），闸门侧单独补采 `_lib`。
- `scripts/check-proc-adoption.ts`：专管子进程 `proc.mjs`，本卡显式跳过该模块，两者分工不重叠。
- `scripts/check-script-hygiene.ts`：管文件头 / 退出码 / 契约，其共享层口径只认 `^function walk(` 等**窄命名**（改名即绕过）；本卡按「能力是否被手搓」判定，覆盖 `frontmatter` / `source-graph` / `to-posix` 等 hygiene 未触及的模块。
- `scripts/doctor.ts`：登记 `check-lib-adoption.ts --json`，输出 `violations=N` 作为结论行。
- 被守护模块：`_lib/{scan-files,parse-args,frontmatter,source-graph,to-posix,git-ref}.ts`。

## 不变量

- **两套口径，各有用途，不可混用**：① 违规扫描面 = `scripts/` ∪ `_lib` 自身，只认「能力是否被手搓」（严格）；② 引用方池 = `scripts/` ∪ `_lib` ∪ `.githooks` ∪ `tests`，含路径字符串引用（宽）。前者判违规——放宽会漏检；后者判采用率与孤儿——收窄会误报。
- **豁免精确到文件**：`selfFile = "_lib/" + rule.lib` 全等判定，不做目录级 / 前缀级放行。
- **判定不依赖文案**：**违规判定**的采用特征锚定**真实 import 语句**（行首 `import` + 引号路径），而非文本中出现模块名——否则 RULES 里的 advice 字符串、模块头部注释提及自身名都会被误判为「已接入」。引用方池的 `usedBy` 另有第二类路径字符串信号，但**只用于采用率/孤儿计数**，不参与违规 kind 判定。
- **默认不阻断**：仅 `--strict` 才以退出码表态；接入 doctor 的是 `--json`（提示语义）。

## 相关

- `scripts/check-lib-adoption.ts`（本卡 source）
- `scripts/_lib/{collect-scripts,scan-files,to-posix,parse-args,frontmatter,source-graph,git-ref}.ts`（采集底座与受守护模块）
- `scripts/check-proc-adoption.ts`（同类闸门，proc 专属）
- `scripts/check-script-hygiene.ts`（相邻守卫，口径互补）
- `scripts/doctor.ts`（消费方：`--json` 取 `violations=N`）
- `.githooks/{pre-commit,pre-push}`（CLI 消费方，引用方池成员）
- `tests/test_gen_stage.ts` / `tests/test_machine_diff.ts`（契约测试消费方，引用方池成员）
- `scripts/_lib/gate-ctx.ts`（当前唯一零引用模块。**非废弃、勿归档**：ADR-206「pre-push-gate 收敛分拆」阶段 1a 的预备件——含不可变接口方案未定、阶段 1b 未实施，`pre-push-gate.ts` 仍 1070 行未接线。零引用是战役中断的正常中间态，归档=毁掉已完成的工作）
- `docs/knowledge/scripts_jscpd_go.md`（`_lib/jscpd-pairs.ts` 消费方；本轮收敛触及）
