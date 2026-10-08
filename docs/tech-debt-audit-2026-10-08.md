# YSM 模型管理器 技术债审计 · 第二轮（2026-10-08）

> 前一轮：[tech-debt-audit-2026-10-06.md](./tech-debt-audit-2026-10-06.md)。台账卡：`docs/knowledge/tech-debt-ledger.md`。
> 方法与纪律：**3 个子代理分域只读探查 + 主模型逐条二次核实**。本报告只收录带文件:行号或命令原始输出的结论；凡主模型复核与子代理结论不一致的，以实测为准并在文中标注。
> **凡子代理报的债，先亲自 grep 真实代码 + 跑对应门禁验证，再决定是否动手**——本次共纠正 9 项子代理/自有误判，见 §7。

---

## 0. 头条（一句话版）

**代码债已被前两轮基本清偿，新债全在「治理与文档」一侧。** 本轮唯一能推翻"全绿"的项是一个**僵尸门禁**：Go 覆盖率门禁读取的覆盖率产物**全链路无人生成**，`gate-config.ts` 的注释声称"push 前已生成"与事实相反；一旦换成新鲜产物，门禁立刻转红（`cmd/ccheck` 0.0% 漏登记 `SKIP_PACKAGES`）。

| 项 | 判定 | 依据 |
|---|---|---|
| **P1-a 覆盖率门禁与代码脱钩** | 🔴 真债 | `gate-config.ts:237` 注释为假；实测无人生成 `.coverage/go-cover.out` |
| **P1-b `cmd/ccheck` 漏登记 `SKIP_PACKAGES`** | 🔴 真债 | 新鲜产物跑门禁 → `❌ ysm-model-manager/cmd/ccheck: 0.0% (阈值 20%)`，exit 1 |
| **P2 六处常驻文档称"pre-push 全量门禁"** | 🟠 真债 | 与 `YSM_FAST_PUSH` 默认轻量档现实相反，含 `SECURITY.md:74` |
| 代码债（Go 侧） | 🟢 已清 | errcheck 生产 0、ysmwasi 61.3%、并发安全、错误分类单源 |
| 复杂度债（前端侧） | 🟢 已清 | RED 函数 **52 → 0** |

---

## 1. 方法

- **A 组**：前端运行时与资源债（事件配对 / dispose / 缓存 / MenuNode 合规 / 性能）
- **B 组**：Go 后端健壮性与覆盖率债（errcheck / 覆盖率盲区 / build tag / SafeWalk / goroutine / 错误分类 / god object）
- **C 组**：测试有效性与跨语言契约债（覆盖率产物新鲜度 / binding / i18n / 契约域登记 / false-green / 门禁双轨 / 治理）
- **主模型**：不派活的并行核查（git 增量 / gate 状态 / ADR 状态分布 / 仓库卫生 / 契约登记），并对每组头条结论逐条复核

探查窗口：2026-10-08。基线：10-06 审计 + 台账卡。

---

## 2. 🔴 P1-a 覆盖率门禁与代码脱钩（本轮头号发现）

**结论：`check-go-coverage-threshold` 是一个需要人工喂料的门禁，它的接入注释声称自动化，实际既不自动也不容错。**

### 2.1 声称与事实

`scripts/_lib/gate-config.ts:236-238`：

```ts
// check-go-coverage-threshold：包级最低函数覆盖率（语句加权，2026-09 口径修正后）。
// 依赖 .coverage/go-cover.out（push 前 gate 已生成）；实测 144ms、errors=0 → debt 接入。
{ tool: "check-go-coverage-threshold.ts", blockPolicy: "debt" },
```

「push 前 gate 已生成」**为假**。全仓 `grep -rn "\.coverage/go-cover\.out"` 共 11 处命中，**全部是读取方或文档**，无一处写入：

- `.githooks/pre-push`（44 行薄壳）：grep `coverage` = **0 命中**
- `scripts/_lib/gate-blocks/go-domain.ts`：跑 `go test -race` / `go test`，**无 `-coverprofile`**
- `scripts/_lib/gate-blocks/static-tools.ts`：只跑 `node scripts/<tool> --json`
- `scripts/_lib/gate-blocks/schedule.ts:88`：仅 `if (ctx.plan.go) runTools(ctx, GO_STATIC_TOOLS)`
- 唯一写文件的是 CI `.github/workflows/test.yml:361`，而该步 `if: github.ref == 'refs/heads/main'` + `continue-on-error: true`（**非门禁**）
- `.gitignore:132` 忽略 `.coverage/` ⇒ CI 产物**无法交回本地**

旁证（仓内脚本自己说"无持久产物"）：

- `scripts/check-go-diff-coverage.ts:48`：「Go 无持久覆盖率产物，本脚本对受影响包现跑 `go test -coverprofile`」——用的是临时文件
- `scripts/hooks/go-coverage-hint.ts:74`：同样用临时文件
- 知识卡 `docs/knowledge/go-coverage-gate.md:94`：「`.coverage/go-cover.out` **无代码自动生成（脚本只读不写）**，靠手动/CI 跑 go test 生成」——**与 `gate-config.ts:237` 直接矛盾**

### 2.2 容错缺失

脚本 `scripts/check-go-coverage-threshold.ts:174` 用 `readFileSync(file, "utf-8")` 裸读，未被 try/catch 包裹。产物缺失时**抛未捕获异常**：

```
读取覆盖率文件失败: Error: ENOENT: no such file or directory,
open 'C:\Users\zhujieling11\ysm-model-manager\.coverage\go-cover.out'
    at readFileSync (node:fs:441:20)
    at loadPackageStats (.../check-go-coverage-threshold.ts:174:51)
exit = 1
```

`blockPolicy: "debt"` 使这个 crash 只记为一条 debt 行、不阻断——于是它既不能守门，又持续制造噪声。

### 2.3 与"全绿"的关系

`scripts/_lib/gate-coverage.ts` 按"是否注册进 gate-config"计**已接入门禁**的分母，与本门禁是否有效无关。因此覆盖口径尾行在报一份**与当前代码无关**的 PASS。这正是 10-06 审计「全绿 ≠ 无风险」结论的实例化，且比当时诊断的更隐蔽：当时以为"旁路 = 完全不可见"，实际是"可见但恒为陈旧快照"。

### 2.4 建议

1. **给门禁加产物新鲜度断言**（性价比最高）：`go-cover.out` 的 mtime 早于 `git log -1 --format=%ct` 即 exit 2 显式 FAIL，而不是拿着两天前的快照报绿。
2. **脚本对缺失产物优雅降级**：ENOENT → `WARN 无覆盖率产物，跳过` + exit 0，而不是 crash。
3. **修 `gate-config.ts:237` 的注释**，与知识卡 `go-coverage-gate.md:94` 对齐。
4. 若要走内联解析（脚本内现跑 `-cover`），需接受该步从 144ms 变到分钟级——不建议。

前置条件：无。风险：零（`debt` 级不阻断）。

---

## 3. 🔴 P1-b `cmd/ccheck` 漏登记 `SKIP_PACKAGES`

**这是唯一让覆盖率门禁在新鲜产物上真正转红的包。**

```
❌ ysm-model-manager/cmd/ccheck: 0.0% (阈值 20%)
总体覆盖率: 78.7%
❌ 覆盖率门禁失败：有包低于阈值
exit = 1
```

`scripts/check-go-coverage-threshold.ts:152-161` 的 `SKIP_PACKAGES` 表：

```ts
const SKIP_PACKAGES = [
  "ysm-model-manager/go/litematic/gen",      // 代码生成器
  "ysm-model-manager/go/internal/testutil",  // 测试基建
  "ysm-model-manager/build/android/scripts/deps",
  "ysm-model-manager/cmd/updater",           // ← 同类进程入口，已登记
  "ysm-model-manager",                       // ← 根包，已登记
  ...
```

`go list ./cmd/...` 实际输出两个包：

```
ysm-model-manager/cmd/ccheck
ysm-model-manager/cmd/updater
```

同类项 `cmd/updater` 已登记且注释写明理由（「进程入口：main() 起 Wails 应用 / 等待更新，测试内不可达」），`cmd/ccheck` 是 2026-09-11（`23bfeb9ac`）引入的真实 `main()` 入口（`cmd/ccheck/main.go` 2733B，`scripts/README.md:126` 登记），却漏登记。它在 10-06 的旧快照里不存在，所以旧快照恒绿。

**根因**：`SKIP_PACKAGES` 是静态表，新增进程入口包**必然漏登记**——这是结构性缺口，不是疏忽。

**建议**：一行补入 `"ysm-model-manager/cmd/ccheck"`；更根治是改为按启发式判定（`main()` 入口 / 无被调用函数 / 生成代码），或配合 P1-a 的新鲜度断言让漏登记显式暴露而非静默恒绿。

---

## 4. 🟠 P2 六处常驻文档称"pre-push 全量门禁"

`YSM_FAST_PUSH` 默认（`!== "0"`）时 pre-push 是**轻量档**：跳过 `vite build` / `tsc --noEmit` / `vitest` / `go test -race`，只留静态治理层 + `go build` + `go vet`。实测跳过点 4 处：

- `scripts/_lib/gate-blocks/frontend-domain.ts:164`（→ :168 / :173 / :239 分别为 vite build / typecheck / vitest）
- `scripts/_lib/gate-blocks/go-domain.ts:100`（→ :104 为 go test -race）

知识卡 `docs/knowledge/pre-push-gate.md:275` **已正确记录**此变更（2026-10-07）。但下列六处仍描述旧行为：

| 位置 | 原文 | 性质 |
|---|---|---|
| `AGENTS.md:101` | 「pre-push：全量门禁，失败阻断」 | **每个 AI 会话的常驻系统提示，最伤** |
| `CONTRIBUTING.md:161` | 「全量门禁（测试 + 类型 + 契约），失败阻断」 | 新人第一入口 |
| `SECURITY.md:74` | 「全量门禁（Go 测试 + 前端 vitest + 契约测试 + typecheck）」 | **安全文档失真，最误导** |
| `docs/knowledge/gate-chain-map.md:140` | 「pre-push 是唯一全量阻断的本地闸」 | |
| `docs/knowledge/pre-commit-hook.md:78` / `:105` | 「全量门禁仍留给 pre-push」/「pre-push 全量门禁阻断」 | |
| `docs/knowledge/pre-push-gate.md:291` | 「pre-push 全量阻断」 | **与同卡 `:275` 自相矛盾** |

另：`AGENTS.md:173` 「契约测试（**95 个** tests/\*.ts）」→ 实测 **122 个**。

**误报排除**：ADR 里的同类表述（ADR-086:113、ADR-155:43、ADR-156:24、ADR-208:22、ADR-234:44、ADR-269:25）是**决策时历史快照**，按「ADR 只记决策方向」元规则不是债。

**建议**：六处统一改为「本地轻量档：静态治理 + `go build`/`go vet`；重型构建与测试交 CI（`YSM_FAST_PUSH=0` 恢复本地全量）」；`SECURITY.md` 优先改（安全评审者会据此判断门禁强度）。风险：零，纯文案。

---

## 5. 代码债：已清偿（正面结论）

### 5.1 Go 侧 —— 全部清零

| 维度 | 10-06 | 本轮实测 |
|---|---|---|
| errcheck 生产违规 | 114 条 | **0 条**（`golangci-lint run ./go/... ./internal/... .` → 530 → 过滤后 0） |
| golangci-lint 总违规 | 736 条 | **0 条**（518 errcheck + 8 gocyclo 全在 `_test.go` 已排除，4 个 `//nolint` 均有意） |
| `go/ysmwasi` 覆盖率 | 33.3% 🔴 | **61.3%**（超 50% 阈值） |
| `go/wasispike` | 0%、无 build tag | **已排除**（`//go:build wasispike`） |
| `internal/app` | — | **58.8%**（阈值 20%） |
| `internal/app/install` | — | **92.8%**（阈值 50%） |

逐条核实的健康项：

- **SafeWalk（ADR-030 / H3）**：141 处 `WalkDir` 命中，12 处生产 `_ = WalkDir` **全部回调内已 log**，0 处真·静默吞错
- **并发安全**：`go func` 共 64 处，逐处均有 `WaitGroup` / channel+Close / `context` 取消；`resolvedRootCache`、`containerTypeCache`、`geoCache`、`proxySessions`、`httpServers` 全有 Mutex 保护
- **错误分类（ADR-051 / H2）**：83+5 处 `errors.New` 逐处核实，均为哨兵错误或内部实现错误；领域错误已结构化，3 个 Go 单测钉死
- **god object**：`internal/app/app.go` **435 行、9 个导出方法**，纯门面（struct 定义 / 构造 / 生命周期 / 薄方法）；真实领域逻辑分布在 66 个 `app_*.go` 伴生文件（10,567 行）→ **稳定门面，非 god object**
- **测试卫生**：0 处 `if err != nil { t.Log(...) }` 吞错；97 处 `t.Skip` **全为合法平台/环境条件跳过**，无永久跳过
- **Rust 退役**：`go/rustbridge`、`rust-core`、`rust-wails-bridge` 三目录全部不存在；38 处 `//go:build` 逐条核实，无「方向相反」残留

残余 🟡（无害清理项）：

- `.gitignore:146-150` 4 条 Rust 死规则（`rust-core/target/`、`rust-wails-bridge/target/`、`go/rustbridge/static-lib/`、`go/rustbridge/android-lib/`）
- `go/scanner/scanner_singleflight_test.go` 的 `//go:build !rust_backend` 已恒 true（`rust_backend` 退役）
- `cmd/genindex/` 只有未跟踪的 `genindex.exe`（3.1MB），无 `.go` 文件、不在 `go list ./cmd/...` → 残留构建产物目录

### 5.2 前端侧 —— RED 函数归零

| 指标 | 10-06 | 本轮 |
|---|---|---|
| errors 总数 | 302 | **270** |
| 🟥 RED 函数 | 52 | **0** |
| 🟧 ORANGE | 56 | **47** |
| 🟨 YELLOW | 194 | **223** |
| 最高认知复杂度 | Molang 876 | **41** |

**RED 52→0 有两个成因，性质不同**（主模型复核 `molang-lib` 后修正措辞）：

1. `Molang` 876 → **vendored 排除**。`frontend/src/utils/animation/molang-lib/` 是 MIT 第三方库（文件头 `Author: JannisX11 / License: MIT`），排除合理；`check-complexity.ts:71` 的 `VENDORED_DIRS` 有 fail-closed 守卫（禁通配符、路径不存在即报错，`:291-294`）且 `_summary.vendoredExcluded` 显式披露——**属"噪声移出统计面"，不是债被清偿**。
2. 其余 4 个 RED 函数（`bindRoving` 139 / `parseBedrockGeometry` 129 / `buildPmxScene` 125 / `webAnalyzeBedrockModel` 117）→ **真重构**。如 `bind-roving.ts` 现为 270 行，`bindRoving` 降为 `:203` 的薄入口 + `:172 rovingOnKeydown` + 多个小纯函数。

YELLOW +29 与 RED 重构同源（拆出的碎片函数），值得单独确认是"自然增长"还是"可再合并"。

其余四域健康（无新增真债）：

- **事件监听**：addEventListener 270→276、removeEventListener 96→95、`.onclick` 57→55；**不配对文件 48→67 但逐文件核实全部为有意设计**（DOM 重建即销毁 / 返回 cleanup 函数 / `AbortController` / `{once:true}`）。window/document 级监听逐一验证成对或有防护。
- **资源 dispose**：`preview-3d/` 下 250+ 处 `.dispose()`；10 个 cap 能力类全实现 `dispose()` 并由 `sceneCapabilityRegistry.dispose()` 统一调用；`model-cache` FIFO(50)+`onEvict` 释放 blob URL；`texture-cache` LRU(200)+`disposeAll()`
- **MenuNode schema**：100% 合规。`renderCustom` 逃生舱**仅 1 个生产文件**（`bones-panel-node.ts`），`sanctioned.ts` 单一事实源仅 1 条记录，豁免必自证 `decidedBy`/`rationale`/`exitWhen`，`render-custom-audit.test.ts` 静态扫描 + 断言 `length === 1` 增长即红；ADR-311 三分法基线 **0/0**
- **缓存与首屏**：`with-cached`（TTL + LRU(128) + STALE/NORMAL/FORCE + 失效接口）、`page-store`、`startup-reveal`（`DOMContentLoaded` + 2 帧 rAF + 1.5s 超时竞速）均完备

**行数红线**：3 个受控文件全部达标；18 个肥膘文件与 10-06 **完全一致**（`sky-capability.ts` 1068 行仍超 `mount-preview-core.ts` 的红线值 1045，但仅软告警）——10-06 P1「把 caps 族纳入硬红线」**仍未做**，可复列。

---

## 6. 治理与契约：增量对比

| 维度 | 10-06 | 本轮 | 判定 |
|---|---|---|---|
| 未接入门禁的 check-\* | 6 个 | **0 个**（仅 2 个刻意旁路） | 🟢 已修 |
| 契约测试域登记 | 有 1 处漏登记（FAIL） | **104/104 全覆盖，零漏登记** | 🟢 已修 |
| i18n 死键 | 17 | **13**（total 1542 / testOnly 4） | 🟢 改善 |
| 知识卡 kind snake_case | 181:1 反向 | **196:1 kebab**（仅 `debt_ledger_release.md`… 实为 `debt_ledger_refresh.md` 1 个残留） | 🟢 已收口 |
| 无卡引用的源码文件 | 52（frontend/src） | **14**（全仓，TOP: `go/geometry`×6、`frontend/src`×5、`go/sync`×3） | 🟢 改善 |
| `scripts/` 规模 | 194 文件 / ~50,310 行 | **178 文件 / 44,599 行**（↓16 / ↓5,711） | 🟢 改善 |
| ADR 📝 提议中 | 3（滞留 2 周） | **6**（284/292/301 + 新增 321/325/151-d1） | 🟠 恶化 |
| ADR 含进度化石 | 226 | **213/333** | ⚪ 微降 |
| 已采纳 ADR 缺 emoji 前缀 | — | **126/304** | 🟡 无守护 |
| 仓库卫生（10-06 §7 六项） | 6 项 | **1 项未修** | 🟢 大部已修 |

**契约面全部健康**：

- `binding-check --json`：`go_functions:176 / js_functions:176 / issues:0`，两侧严格一致
- i18n 三语 key 集合严格相等（`locales-consistency.test.ts`）
- JSON 数据卫生：creators 231 / workshop_sites 10 / workshop-github 5，空值 0、重复 0
- **ADR-311 有序快照禁令完全执行**：`frontend/src` + `frontend/e2e*` 下 `toMatchSnapshot`/`toMatchInlineSnapshot` = **0**
- 全套 vitest：**473 文件 7719/7719 全绿**
- `docs/knowledge` 死链、`check-doc-drift`、`check-adr-health`、`gen-* --check` 全部 `errors=0`
- **e2e 防假绿纪律在当前提交仍在生效**：`0c6763185` 把 context-menu 4 处 `test.skip` 改硬断言（commit message 明写「skip 洗绿即三重门第二门」）并新增**截图 sha256 两两互异闸**防"点了但没变"；`f2f4d6e6f` 把 1×1 占位纹理升为彩色棋盘格修黑剪影假绿灯；`web-ready.ts` 被 e2e-web **9/9** spec 全 import；`playwright.web.config.ts:35` project 级钉 swiftshader 真 WebGL 软渲染

---

## 7. 🟡 其余待还债

- **T1 · `vi.mock(".js")` 后缀陈旧（低危·纯洁癖）**：实测 **21 处，真债仅 11 处**（`bindings/ysm-model-manager/internal/app/app.js`，实际只有 `app.ts`）。`check-mock-paths` 的 M3 detail 明写「spec 以 .js 结尾但**实际解析到** `.../app.ts`」——**vitest 不会 mock 错模块，不构成 false-green 通道**。台账「19 处统一改 .ts」**会误伤另 10 处**：`@/wasm/ysm-wasm-data*.js`（4 处，`frontend/src/wasm/` 确为真 `.js` + `.d.ts`）与 `three/addons/**/*.js`（6 处，three 官方发行 `.js`）。`docs/.mock-path-exempt.json` 实测 `files: []`、`specs: []` **豁免账本为空**，故"永久豁免已无意义"这条不成立。
- **T2 · `frontend/e2e/file-tree.spec.ts:51-53` 残留条件 skip**：`if (dirCount === 0) { test.skip(true, ...); return; }`。同文件 `:48-49` 注释显示团队已修过一次同类假绿，但保留了这层 skip；而 `:55` 断言 mock 恒含 `subdir/subdir-model.ysm`，`dirCount===0` 意味着加载链回归，应硬红。全 27 个 e2e spec 仅此 1 处活 skip。
- **T3 · 硬编码本机路径**：`frontend/e2e/perf-fixtures.ts:460,578,724,842` 四处 `C:\Users\zhujieling11\ysm-model-manager\tests\fixtures\ysm\...`（10-06 P2 唯一未修项）。⚠️ **这些是 JS 双反斜杠字面量**（源码为 `C:\\Users\\zhujieling11\\`），`grep 'C:\Users'` 与 `git grep` 都漏不掉，需用 `C:\\\\Users` 或读原文。另：`scripts/android-build.ts:78-84` 的 `C:\Android\Sdk` **已改**为 `LOCALAPPDATA\Android\Sdk` 候选探测 + `ANDROID_HOME` 单一事实源 → 10-06 该项属半修半未修。
- **A1 · ADR 治理无守护**：`check-adr-health.ts` grep `化石|进度|排期` = **0 命中**，输出仅「状态机与登记表同步」+ 15 条技术债（P1=1: ADR-317；P3=14）后 PASS。故 10-06 P1 #16（加进度化石正则）与「126 篇已采纳缺 emoji 前缀」**均未被拦**，全靠人肉巡检。6 个 📝 提议中 ADR 已滞留 2 周以上（284/292/301/321/325/151-d1）。**建议先 `--suggest`/debt 级观察一轮再升 hard**（需先定化石字样白名单，否则误伤历史叙述）。
- **K1 · 知识卡认领冗余**：`check-knowledge-drift` errors 0 / warns 10。0 独占 `source_files` 的 6 卡共 25 条重复登记（`dnd-shared` 4 / `doctor-gate-overlap` 3 / `features-dialogs` 6 / `model-stats` 4 / `ui-slide-menu` 3 / `ysm-anim-pipeline` 5）；`model3d.md` **1042** 个派生符号、`wails-bindings.md` **118** 个（`source_files` 认领过宽、目录级递归）；auto_fields 全仓零信息消费者。另有 `go-repoaudit.md` 机制锚 `go/repoaudit/repoaudit.go|extClassifierCache` 疑似指向引用处而非定义处。
- **K2 · 台账卡自身分类错位**：`docs/knowledge/tech-debt-ledger.md:5` `category: go`，但内容横跨 Go / 前端 / ADR / 测试四域，会误导按 category 路由。
- **G1 · `scripts/gate-inventory.json` 未建**（10-06 §11.6 建议）。部分缓解：`gate-config.ts` 本身已是单一工具清单，`gate-coverage.ts` 动态枚举 `check-*.ts` 计分母，分母不会烂。
- **S1 · `gen-knowledge-*` 六个生成器仍并存**（adr/autogen/h1/index/symbols/tests），未收口为单入口。另：10-06 说的"6 个 coverage 类脚本重叠"**被夸大**——`check-diff-coverage`(264) 与 `check-go-diff-coverage`(710) 已共享 `_lib/diff-coverage-core.ts`，`e2e-coverage-report`(118)/`test-coverage-report`(253) 是报告非门禁，`line-counter`(693) 是行数统计非覆盖率。真重叠只剩 diff-coverage 对且已收口。
- **H1 · `docs/` 根 6 份历史审计 critique（~130KB）可迁 `docs/archive/`**：`audit-env-review`、`audit-ground-review`、`audit-knowledge-accuracy`、`audit-knowledge-reliability`、`audit-postprocessing-critique`、`audit-water-critique`（均 10-05~10-07）。⚠️ `audit-src-map.md`(11.1KB) 是 `gen-project-map.ts` 的**生成物，不可归档**。`docs/archive/` 已有先例（`audit-doc-utility-2026-10-05.md`、`go-design-critique.md`）。

### 已修（10-06 遗留项，本轮确认）

- `.tmp_commit_diff.txt` 已删、`zzz-fm-delimiter-tmp.md` 已删
- `go/wasispike/main.go` 已加 `//go:build wasispike`（10-06 P2 已修）
- `scripts/android-build.ts` 的 `C:\Android\Sdk` 已改
- `go/tags/tags.go` 注释已改（`:3` 说 `%AppData%`，`:5` 标注「2026-10-06 技术债审计修正」）
- `test_commit_clean_staged_filter.ts` 已登记 `CONTRACT_TEST_DOMAINS`（`contract-tests.ts:70`）
- 6 个未接入 check-\* → 0（`check-go-coverage-threshold`/`check-twin-siblings`/`check-comment-history`/`check-unread-fields` 已接入，均 `debt`）
- `check-go-coverage-threshold` 阈值口径已重做：语句数加权 + `DEFAULT_THRESHOLDS`（`internal/app/install` 50 / `internal/app` 20 / `go/` 50 / `DEFAULT` 20）+ `SKIP_PACKAGES`，并处置了 10-06 报的幽灵包 `go/probe_fmt.go`（`:163` 注释）
- `_attic/` 20 个死脚本：全仓仅 2 处 `_attic` 字符串引用且**均在 `_attic/build-ysm-wasm.ts` 内部自指**，零活引用；`check-script-hygiene --strict` warns=0 → **确认真死**

---

## 8. 本轮纠正的误判（9 项）

**纪律价值证明：盲信任何一方的计数都会写错报告。**

| # | 误判 | 纠正依据 |
|---|---|---|
| 1 | **B 组**「Go 1.26.8 `-coverprofile` 不写文件」 | 是 **PowerShell 单破折号不引号的引用 bug**。实测矩阵：`-coverprofile=x.out`（不引号）→ 产出 `x`（扩展名被吞）或什么都不写；`"-coverprofile=x.out"` / `--coverprofile=x` → ✅ 正常写 134KB/715KB。CI `test.yml:354-356` 早已逐字记录并修好（`:361` 带引号）；知识卡 `go-coverage-gate.md:95` 也已记录。**主模型自己也踩了同一个坑** |
| 2 | **主模型**「e2e 硬编码路径 4 处 → 0 处已修」 | 错。JS 源码里是双反斜杠字面量，`Select-String 'C:\Users'` 与 `git grep 'C:\Users'` **都漏**；读 `perf-fixtures.ts:460` 原文才命中。10-06 P2 唯一未修项 |
| 3 | **C 组**「workshop_sites.json 10 处空值 + 10 处重复」 | 查错字段名（用 `.name` 而非 `.label`/`.id`）→ 空值 0、重复 0 |
| 4 | **C 组**「📝 提议中 10 个」 | 实为 6 个；ADR-162/245/317 均「✅ 已采纳」，是正文含"草案"/"📝"/"待办"导致字面误命中 |
| 5 | **C 组**「`vi.mock(".js")` 可能静默 mock 错模块」 | **不会**。M3 detail 明证解析到正确 `.ts`；豁免账本为空，"永久豁免"子问题不成立 |
| 6 | **C 组**「ADR-311 有序快照残留」 | `frontend/src` + `frontend/e2e*` 实测 **0** |
| 7 | **C 组**「`test_design_tokens.ts` 63KB 是巨型 fixture」 | 1270 行 / 213 断言 / **0 个 `test()` 调用**的线性纯函数对拍脚本（~6 行/断言）→ 高密度数据驱动测试，非 fixture |
| 8 | **C 组**「`_attic` 被活引用」 | 2 处引用均在 `_attic` 内部自指 → 零活引用 |
| 9 | **台账**「T4 `vi.mock(".js")` 19 处，统一改 `.ts`」 | 实测 21 处，真债 11 处；照办会**误伤** 4 处 wasm + 6 处 three/addons 的正确 `.js` mock |

另需记录一个**工具陷阱**（已写入知识卡）：`Get-ChildItem -Recurse` 在 `.codegraph`（断开的 symlink）上抛 `Could not find a part of the path` 并中断枚举——需 `-ErrorAction SilentlyContinue` 或显式排除。

---

## 9. 建议优先级

### 🔴 本轮必做（零风险、收益最高）

1. **`SKIP_PACKAGES` 补 `ysm-model-manager/cmd/ccheck`**（一行）+ **`check-go-coverage-threshold` 加产物新鲜度断言**（mtime 早于最新 commit 即 exit 2）。这是唯一让"全绿"与代码脱钩的漏洞。
2. **修 6 处"pre-push 全量门禁"文档**（`AGENTS.md:101`、`CONTRIBUTING.md:161`、`SECURITY.md:74`、`gate-chain-map.md:140`、`pre-commit-hook.md:78/105`、`pre-push-gate.md:291`）+ `AGENTS.md:173` 的 95→122。纯文案，但这些是每个 AI 会话与新人的常驻提示。

### 🟠 近期

3. **`check-adr-health` 补进度化石正则 + 已采纳 emoji 前缀检查**（先 `--suggest`/debt 观察一轮）；顺手处置 6 个滞留 📝 ADR（284/292/301/321/325/151-d1）。
4. **`frontend/e2e/perf-fixtures.ts` 4 处硬编码改夹具相对路径**（注意双反斜杠陷阱）。
5. **caps 族纳入 `check-file-lines` 硬红线**（10-06 P1 遗留，`sky-capability.ts` 1068 行已超 1045 红线值却只软告警）。

### 🟢 随手

6. `file-tree.spec.ts:51-53` 的 `test.skip` 改硬断言（与 `0c6763185` 的三重门纪律对齐）。
7. 11 处 `vi.mock(".js")` 批量改 `.ts`（**勿碰** 4 处 wasm + 6 处 three/addons）；`.gitignore:146-150` 4 条 Rust 死规则；`scanner_singleflight_test.go` 的 `!rust_backend`；`cmd/genindex/` 残留 exe；6 份 `audit-*.md` 迁 `docs/archive/`（**勿动** `audit-src-map.md`）。
8. 台账卡 `category: go` → 跨域；6 张卡 `source_files` 收窄至独有路径。

---

## 附：核查命令

```bash
# 覆盖率门禁（需先有新鲜产物；产物缺失会 crash）
go test ./... -cover -coverprofile="$PWD/.coverage/go-cover.out"   # 注意 PowerShell 须引号
node scripts/check-go-coverage-threshold.ts                        # 默认读 .coverage/go-cover.out
node scripts/check-go-coverage-threshold.ts --cover-profile <path>

# 复杂度 / 契约 / 文档
node scripts/check-complexity.ts --json          # red/orange/yellow 计数 + vendoredExcluded
node scripts/check-file-lines.ts
node scripts/binding-check.ts --json             # go_functions / js_functions / issues
node scripts/check-i18n-unused.ts --json
node scripts/check-knowledge-drift.ts --json
node scripts/check-adr-health.ts --json
node scripts/check-mock-paths --json
node scripts/doctor.ts --docs                    # 23/23 全绿（本轮）

# 门禁
node scripts/pre-push-gate.ts --static --json    # 本地轻量档（YSM_FAST_PUSH=0 恢复全量）

# 陷阱
grep 'C:\Users'  # ❌ 漏掉 JS 双反斜杠字面量；用 'C:\\Users' 或直接读原文
```
