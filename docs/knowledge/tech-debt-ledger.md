---
kind: tech-debt-ledger
name: 技术债台账（探查快照 2026-10-08）
tier: leaf
category: core
status: snapshot
affected: false
source_files:
  - go/fsutil/safe_walk.go
use_when:
  - 技术债
  - tech debt
pitfalls:
  - 子代理探查易夸大债规模：H1 死链误报、H3「30+ 处吞错」实为 12 处且多已 log、G3「重复函数」多为有意保留的兼容入口——动手前必亲自 grep 核实
  - 第二轮新增陷阱：① `grep 'C:\Users'` 漏掉 JS **双反斜杠字面量**（源码为 `C:\\Users\\`），两次 grep 空结果都判「已修」仍错——需读原文或匹配 `C:\\Users`；② PowerShell 单破折号不引号 `-coverprofile=x.out` 会被吞扩展名/不落地，与「Go bug」无关，`test.yml:361` 已用引号修好；③ `Get-ChildItem -Recurse` 遇断开的 symlink（`.codegraph`）会抛错中断枚举
quick_groups:
  - 技术债探查
quick_intents:
  - 已还债 / 待还债 / 债的查证修正
quick_risk_lines:
  - 凡子代理报的债，先亲自 grep 真实代码 + 跑对应门禁验证，再决定是否动手；不要盲信「N 处违反」的计数
---

# 技术债台账（探查快照 2026-10-08）

> 快照卡：`status: snapshot` + `affected: false`，不进日常 AI 路由、不干扰 `use_when` 命中。
> 本卡是 2026-10-08 **第一轮**（4 子代理）+ **第二轮**（3 子代理）的结构化结论 + 主模型对探查报告的**查证修正**。
> 三轮报告（时点快照，2026-10-09 归档 `docs/archive/`，文首有活指针头）：`docs/archive/tech-debt-audit-2026-10-06.md`（第一轮）· `docs/archive/tech-debt-audit-2026-10-08.md`（第二轮，含 9 项误判纠正与全部命令原始输出）· `docs/archive/tech-debt-audit-2026-10-08-round3.md`（第三轮）。账实以本卡为准。
> 后续还债进展请更新本卡或迁 `docs/archive/`。

## 探查方法

4 个子代理按域并行：Go+Rust 后端 / 前端 TS / 架构·ADR·治理 / 测试·CI·依赖。
主模型对每条「高危债」亲自 grep 源码 + 跑门禁（`pre-push-gate --static`、`check-redlines`、`doctor --docs`）复核，修正了若干被夸大的项。

## 已归还（2026-10-08 提交 338d10748）

- **H2 · ADR-051 错误分类单源收敛（高）**
  - `go/cli/json.go` 的 `NewJsonError` 新增 `errors.As(&types.AppError)` 分支，优先透传 `types.ErrorCode`（如 `INVALID_PATH`）到 `JsonResponse.Error.Code`，前端 `friendlyError` 据此做 i18n；`ErrParam/ErrRuntime → param_error/runtime_error` 原有契约保持不变。
  - `go/importer/importer.go` 的 `sanitizeImportPaths` 由返回 `(string,string,string)` 改为返回 `(string,string,error)`，返回结构化 `types.AppError`（带 `Code`），消除 `Import` 内 `errors.New` 裸字符串漂移；`Import` 直接透传。
  - Go 单测钉死：`TestNewJsonError_PassthroughAppErrorCode` / `_LegacyErrParamUnchanged` / `_LegacyErrRuntimeUnchanged`。
- **H3 · ADR-030 WalkDir 失败可见（高）**
  - 新增 `go/fsutil/safe_walk.go` 的 `SafeWalk`（回调对访问失败的条目返回 nil 时补记日志）。
  - 收口 4 处真实「纯吞 err」站点：`ysm/extracted.go:259`（纹理查找）、`launcher/detect.go:116`（实例探测）、`cli/cli_scan_dir.go:186`、`cli/bench_concurrent.go:331`（两处"尽力而为"工具）。
  - **查证修正**：子代理报「30+ 处 `_ = WalkDir` 吞错」不成立——实际 12 处生产 `_ = WalkDir` 中，`watcher/recycle/sync/extracted:390/mmd` 等回调内**已 `log.Printf`/计数**，仅 2 处（`extracted:259`、`launcher/detect:116`）是真·静默吞错；其余 `_ =` 只是丢弃根目录不可读的顶层 error（下层已 log）。已自 log 的站点**不**改走 `SafeWalk` 以免重复记录。
  - Go 单测：`TestSafeWalk_LogsSkippedError` / `TestSafeWalk_PassthroughNonNil`。

## 待还债（按优先级，含查证修正）

### 高 / 中（建议近期）
- **H1 · 文档死链阻断 push（子代理误报·已核实跳过）**：`docs/architecture.md:773` 的 `bundled_data.go cli.go` 是 ASCII 目录树美术字，非 markdown 链接；`check-doc-drift errors=0`、`pre-push-gate --static` 全绿。仓库本可推，**跳过**。
- **H4 · 悬空 ADR（子代理误报·2026-10-08 核实已完备）**：子代理称 ADR-122/139/186/251「零知识卡进度跟踪」，实测四篇均已在 ADR 头部自标 🔄部分采纳的**精确范围**——ADR-122（tier3 Builder 化否决）、ADR-139（L3 跨 OS 不在批准范围）、ADR-186（含「被取代」字段指向 ADR-210）、ADR-251（顶部 blockquote 声明 §2.2 被 ADR-252 取代、其余有效）。状态字段已足够，符合 ADR 体系「状态记生命周期、不记实施进度」约定；ADR-186/251 更优地把取代链内嵌进 ADR 自身。**无需补卡，移除本项**。
- **A2 · ADR 陈旧路径（中·已推进，2026-10-08 修正 17 处事实锚点型）**：子代理称「92 篇 utils/3d 陈旧路径」被夸大——`frontend/src/utils/3d/` 已整体升格 `frontend/src/preview-3d/`（ADR-129/138/235），143 处 `utils/3d` 引用多为 ADR **历史叙述**（迁移旧名），不可机械替换；`check-adr-drift` 不查散文路径故门禁不报错。真实可修的是**事实锚点型**引用（「相关」/「新建」/「落点」行指向当前代码）。进展：① 已据 `audit-20260922.md` 实锤修正 ADR-127（2 处路径→preview-3d）、ADR-122「相关」行（旧路径+失效命名 BuildCtx）、同步 audit 自身（提交 7c268fe69）；② **子代理分域判定**：`grep docs/adr/` 命中 56 处，其中 **17 处事实锚点型已修正（跨 16 篇 ADR，提交 56d257823）**，每个新路径经 `Test-Path` 验证存在于 `frontend/src/preview-3d/` 下（按新目录结构补齐子目录：`model3d.ts→mesh/model3d.ts`、`mmd-adapter.ts→adapters/mmd/mmd-adapter.ts`、`multi-model.ts→menu/panels/multi-model.ts` 等）；**其余 39 处保留**——为历史叙述（迁移动作描述，如 ADR-072「迁入 utils/3d/」、ADR-049「纯 TS 移植到」）或目标不存在（`perception/` 已迁 `adapters/shared/perception/`、菜单子系统已重构为 `menu/{engine,panels,...}/`，旧文件名不复存在）。行号保留（ADR 历史陈述性质），未改状态/决策。
- **A4 · R7 rtype 魔法串（子代理误报·2026-10-08 核实 3 处均为"值形似、语义非 rtype"）**：`check-redlines` R7（WARN 级，`fix: RESOURCE_TYPES`）报 3 处，逐处实锤均非 rtype 魔法串——
  - `preview-3d/state/model-defaults.ts:17` `| "ysm"`：是 `ModelType` 预览预设类别 union 的成员（同 union 含 `"default"`/`"mmd-scene"` 等**非 rtype 值**），语义域是"场景预设 key"而非资源类型 ID；硬改引用 `types.YSM` 会破坏类型语义。
  - `utils/cache/with-cached.ts:27` `DEFAULT_NS = "ysm"`：是**缓存命名空间前缀**（localStorage 缓存 key 前缀），与 rtype 无涉；值是 `ysm` 纯属巧合，引用 `types.YSM` 反而让"缓存命名空间"语义不清。
  - 第 3 处 snippet `"ysm",` 同理为值形似。**结论：误报，不修**——R7 的文本匹配无法区分"值=ysm 但语义非 rtype"的场景。真正该引用 `types.YSM` 常量的点已被 `type-consistency`/`binding-check` 覆盖。
- **A1 · 129/333 ADR 缺 emoji 状态标记 + 取代链错配（ADR-125/136/137/138）**：治理口径自相矛盾，建议归一状态行 + 补取代导航。
- **G1 · Rust 组件层空目录（子代理误判为"未实现"·2026-10-08 实锤为"已退役"并已清理）**：子代理称 `rust-core/`、`rust-wails-bridge/` 是空目录需定性为"未实现/已弃用/已迁 Go"——实测 `git log --diff-filter=D -- docs/knowledge/rustbridge.md` 命中 `3bf77cd63`「refactor: 删除 Rust 扫描基础设施（Go 并行遍历取代）」，**Rust 桥已明确退役**，非未实现。两目录为空壳（0 条目、未 git 跟踪、无构建脚本依赖），`go/rustbridge` 亦不存在。**已删除两个空壳目录**（净化退役残留）。唯一幸存 crate 为 `rust-test-utils`（`TempRoot` 61 行，git 跟踪）。**遗留可清理项**：`.gitignore:146-150` 的 4 条死规则（`rust-core/target/`、`rust-wails-bridge/target/`、`go/rustbridge/static-lib/`、`go/rustbridge/android-lib/`）指向不存在的路径，无害但为退役残留，团队可择机清除（本轮保留以防 Rust 回归）。

### 维护性（低·已知且被门禁冻结）
- **F1 · 死代码基线（2026-10-08 晚已治噪·债账与噪声分离）**：`check-deadcode-baseline` 原账本混装三类「非债噪声」——① knip 的 15 条 `unresolved` 全是 Playwright 页面内 `await import("/src/...")` 运行时 URL import（knip 结构上解析不了）+ `wails3`/`jscpd` 两条工具链 bin（经 spawnSync / 全局 CLI 调用，knip 看不见，天真还债会砍掉绑定生成唯一命令）；② jscpd 120 条里 **99 条是测试参与**（57 测试自克隆 + 40 测试↔测试 + 2 混合），把「拆一个测试文件」算成生成一条债；③ `duplicates` 键存成 `file|duplicates|`（空名残渣，因 knip v5+ 该项是嵌套数组对 `[[{name},{name}]]`、解析器只取标量 `.name`）。**清偿**：出口过滤落 `frontend/knip.json`（`ignoreIssues` 精确静音 e2e/e2e-web 的 unresolved——非整目录 ignore，后者会把 biome/ts-morph 连带误报成未用 devDep，e2e 是其唯一消费者）+ jscpd `--ignore "**/*.test.ts"`（实测非 no-op：570 文件仍全扫、21 对与生产对 100% 吻合；brace `{test,spec}` 形态实测无效）；键派生下沉单源 `scripts/_lib/deadcode-keys.ts`（duplicates 展开为 `a#b` 可读键 + 空名回归锁，契约 `tests/test_deadcode_keys.ts`）。**账本 305→189**（knip 168 + jscpd 21），jscpd 剩余 21 条全为生产↔生产/自克隆、0 测试对。⚠️ 剩余 168 条 knip 里 88 types + 78 exports **多为「导出面宽于消费面」**（抽样 PLACEHOLDER_RE/isViewerPlatform/applyAnimationFootIK/ARCHIVE_ALIAS 皆本文件内有用、只欠 `export` 关键字或 re-export 面），非死码、量级远低于「整文件未引用」（全账本仅 1 条 `file`）——回收时先分「删 export 关键字」与「真删代码」两档。
- **F2 · 巨型前端文件（子代理夸大·2026-10-08 核实 >500 行多为测试/locale）**：子代理报「32 个 >500 行巨型前端文件」，实测 >500 行清单里**绝大多数是测试文件**（`water-capability.test.ts` 2460、`mmd-adapter.test.ts` 1868、`postprocessing-capability.test.ts` 1771 等，属 T3 fixture 拆分范畴）和 **locale 数据**（`ja/en/zh-CN.ts` 各 ~1700 行——i18n 语言包是数据文件，**拆分即反模式**）。**真生产文件** >300 行仅约 15 个：`caps/{sky,postprocessing,ground,environment,light}-capability.ts`（各 846-995 行）、`state/env-state-schema.ts`(897)、`adapters/{vmd-retarget,mount-preview-core,ysm-adapter,vrm-adapter}`(728-827)、`parsers/ysm-header.ts`(807)、`menu/engine/core.ts`(786)。**但 AGENTS 明确"新组件一个文件放一个可独立工作的功能，不按行数机械切割"**——拆分依据是**职责过载**而非行数，需逐文件判断职责边界，非机械切。若真要拆，优先看 `sky-capability.ts`(995)/`env-state-schema.ts`(897) 是否混了多个子职责。
- **T2 · 薄弱测试（子代理误报·2026-10-08 核实 `utils/base` 覆盖极好）**：子代理称「`utils/base`(纯函数核)、`utils/storage`(隐私安全层) 无单测」——**完全错误**。`frontend/src/utils/base/` 下**每个模块均有对应测试**（共 19 个 `.test.ts`：`storage/async/debounce/base64/lock/listener-set/disposable/log/main-thread-watch/apperror-text/array/clamp/guards/label/recycle-path/safe-error-msg/tex-size/web-path`）；`utils/storage` 实为 `utils/base/primitives/storage.ts`，其 `storage.test.ts`(127 行) 覆盖**极其完善**——正常透传、存储抛错降级（`safeGet→null`、`safeSet/safeRemove` 静默不抛）、**隐私模式降级**（mock localStorage 抛错 → `isStorageAccessible=false`）、损坏 JSON→fallback、key 互不污染、`logWarn` 日志验证。**真实小缺口**：`internal/app/app.go`(400 行主编排) 无直接 `app_test.go`——但 `internal/app/` 包内按职责拆分 20+ 个 `app_*_test.go`（`app_config/app_files/app_install_import_coverage/...`），整体覆盖好，主编排靠集成/间接覆盖属常规取舍，补直接单测价值低。
- **F3 · features 越 seam 软接触 backend 非绑定 helper**：`context-menu/version-updater/dnd/community/import/platform` 直引 `capabilities/platform/runtime/browser-adapter`，收口受许模块或经 seam 暴露（非硬违规，ADR-190/208 精神）。
- **G3 · 重复辅助函数（子代理部分夸大）**：`copyDirRecursive`/`copyFile` 等多数已在注释中声明「已收敛至 fsutil，保留双入口避免改名 churn（测试直接引用）」——是有意兼容入口，非真债；新代码务必走 `fsutil.*`，存量双入口按需收敛。
- **T1 · 依赖审计信息缺口**：本环境 `goproxy.cn` `Forbidden`、`npm outdated` 超时，无法实测 `go list -u -m all`/`npm audit`；已知风险 `@wailsio/runtime ^3.0.0-beta.26`（beta）、`typescript ^7`、`vite ^8` 大版本。需联网环境 `govulncheck` + `npm audit` 补全。
- **T2 · 薄弱测试**：已核实误报，见上方 F2 条目的"T2 误报"段落——`utils/base` 19 个测试文件全覆盖、`storage.test.ts` 覆盖隐私降级。**移除本项**（原报「无单测」不成立）。
- **T3 · 巨型 fixture 测试（第二轮复核修正）**：`water-capability.test.ts` 125.6KB 等。但最大的契约测试 `tests/test_design_tokens.ts` 63.2KB 是 **1270 行 / 213 断言 / 0 个 `test()` 调用**的线性纯函数对拍脚本（~6 行/断言）→ 高密度数据驱动测试，**非 fixture**，勿报。
- **T4 · `vi.mock(".js")` 旧写法（第二轮修正计数 + 降为低危）**：实测 **21 处，真债仅 11 处**（`bindings/ysm-model-manager/internal/app/app.js`，实际只有 `app.ts`）。`check-mock-paths` 的 M3 detail 明写「spec 以 .js 结尾但**实际解析到** `.../app.ts`」→ **vitest 不会 mock 错模块，不构成 false-green 通道**，纯属后缀陈旧。**统一改 `.ts` 会误伤另 10 处**：`@/wasm/ysm-wasm-data*.js`（4 处，`frontend/src/wasm/` 确为真 `.js` + `.d.ts`）与 `three/addons/**/*.js`（6 处，three 官方发行 `.js`）。`docs/.mock-path-exempt.json` 实测 `files: []`、`specs: []` **豁免账本为空**，故「永久豁免已无意义」不成立。

## 第二轮新增（2026-10-08，3 子代理：前端运行时 / Go 后端 / 测试契约治理）

详见 `docs/archive/tech-debt-audit-2026-10-08.md`（2026-10-09 归档，文首活指针头）。代码债（Go 侧 + 复杂度 RED）已清偿，**新债全在治理与文档一侧**。

### 🔴 高
- **P1-a · 覆盖率门禁与代码脱钩**：`scripts/_lib/gate-config.ts:237` 注释称「依赖 `.coverage/go-cover.out`（push 前 gate 已生成）」——**实测全链路无人生成**。`.githooks/pre-push` grep `coverage` = 0；`gate-blocks/go-domain.ts` 跑 `go test` 不带 `-coverprofile`；`gate-blocks/static-tools.ts` 只跑 `node scripts/<tool> --json`；唯一写文件的 CI 步 `test.yml:361` 是 `main`-only + `continue-on-error`（非门禁），且 `.gitignore:132` 让产物无法交回本地。知识卡 `go-coverage-gate.md:94` 早已记录「**无代码自动生成（脚本只读不写）**」——**与 `gate-config.ts:237` 直接矛盾**。另：脚本 `check-go-coverage-threshold.ts:174` 用 `readFileSync` 裸读、产物缺失**抛未捕获 ENOENT crash**（exit 1），`blockPolicy: debt` 使其不阻断 → 既不能守门又持续制造噪声。**✅ 已修（2026-10-08 晚间）**：① 产物缺失 → 明确 WARN（含生成命令）+ exit 1，不再抛裸 ENOENT stack；② 新增 `stalenessWarning` 新鲜度断言——产物 mtime 早于 `git log -1 --format=%ct` 即打印醒目「比最新 commit 旧约 N 小时/天」警告（仍正常判定，debt 级不阻断）；③ `gate-config.ts` 注释与 `go-coverage-gate.md` 对齐，声明「只读不写、需先喂料」。契约测试 `test_check_go_coverage_threshold.ts` 钉死缺失降级路径。注：自动化生成产物仍未接（需接 pre-push 或 CI 写 `-coverprofile`），当前为「读前显式校验陈旧」的半根治——下次若谁接了自动生成，新鲜度断言会自动放行。
- **P1-b · `cmd/ccheck` 漏登记 `SKIP_PACKAGES`**：`go list ./cmd/...` 输出 `cmd/ccheck` + `cmd/updater` 两个真实 `main()` 入口包，后者已登记（`:161`，注释写明「进程入口测试内不可达」），前者（2026-09-11 `23bfeb9ac` 引入）漏登记。**决定性实证**：换成新鲜覆盖率产物后门禁立刻转红 `❌ ysm-model-manager/cmd/ccheck: 0.0% (阈值 20%)` exit 1——它在 10-06 旧快照里不存在，所以旧快照恒绿。根因：`SKIP_PACKAGES` 是静态表，新增进程入口包**必然漏登记**。建议补一行 + 改启发式判定。**✅ 已修（2026-10-08）**：不走豁免——把 `main()` 里的参数解析/扫描/输出逻辑收敛到可测的 `run(args, stdout, stderr) int`（`cmd/ccheck/main.go`），新增 `cmd/ccheck/main_test.go` 直测核心路径（文本/JSON 输出、`--threshold` 过滤、`--top` 负值夹取、目录不存在、非法 flag、`--tests` 开关），包覆盖率 **0% → 83.9%** 稳过 20% 门槛。

### 🟠 中
- **P2 · 六处常驻文档称「pre-push 全量门禁」**：`AGENTS.md:101`、`CONTRIBUTING.md:161`、**`SECURITY.md:74`**（安全文档失真最误导）、`gate-chain-map.md:140`、`pre-commit-hook.md:78`+`:105`、`pre-push-gate.md:291`（与同卡 `:275` **自相矛盾**）。`YSM_FAST_PUSH` 默认轻量档实测跳过 4 处（`frontend-domain.ts:164`→168/173/239、`go-domain.ts:100`→104）。另 `AGENTS.md:173`「95 个 tests/\*.ts」→ 实测 **122**。**✅ 已修（2026-10-08 晚间）**：六处统一改为「默认轻量档（静态治理 + `go build`/`go vet`，`YSM_FAST_PUSH=0` 恢复全量），重型测试与构建交 CI」；`AGENTS.md:173` 计数 95→122。纯文案，零风险。
- **A1 · `check-adr-health` 无进度化石正则、无 emoji 前缀检查**：grep `化石|进度|排期` = 0 命中。213/333 ADR 含化石字样、**126/304 已采纳缺 emoji 前缀**全靠人肉巡检；6 个 📝 提议中 ADR（284/292/301/321/325/151-d1）滞留 2 周+，10-06 为 3 个 → **恶化**。**✅ 已落地 + 部分升 hard（2026-10-08 晚间）**：① 加 `--suggest` 非阻断观察模式（debt 级、不进 gate）摊开三类数据——①-a 决策态缺 emoji 4 条、①-b 已采纳缺 ✅ 126 条（与审计精确吻合）、② 决策未定 ADR 含进度化石 21 条（含审计点名 6 个 📝 滞留）；② 把 **①-a 决策态（proposed/partial/deprecated/superseded）缺 emoji 前缀升为默认全量 WARN**（数量可控、真格式不一致、不阻断），ADR-218 真 partial 缺 🔄 现被自动守护。③ 升 WARN 时暴露并修复 `normalizeState` 的否定词误判（`非废弃` 里的「废弃」子串被 `_RE_DEPRECATED` 误抢为 deprecated，ADR-181/182/183 被错归 deprecated）——加 `非废弃|不废弃|未废弃|并非废弃` 豁免后归位 accepted，并联动 `gen-docs-index` 重生成校正这 3 个 ADR 登记表 drift（🧊 已废弃→✅ 已采纳），`check-adr-health` 默认全量 ERROR 0。①-b（126 条已采纳缺 ✅）与 ②（21 条进度化石）维持 `--suggest` 观察，升 hard 待团队拍板 emoji 强制范围。
- **T3′ · `file-tree.spec.ts:51-53` 残留条件 skip**：`if (dirCount === 0) { test.skip(true, ...); return; }`，而同文件 `:55` 断言 mock 恒含 `subdir/subdir-model.ysm` → `dirCount===0` 意味着加载链回归，应硬红。全 27 个 e2e spec 仅此 1 处活 skip（其余 3 处命中是「已移除 skip」的说明性注释）。
- **T5 · caps 族未纳入 `check-file-lines` 硬红线**（10-06 P1 遗留）：`sky-capability.ts` 1068 行已超 `mount-preview-core.ts` 的红线值 1045，仍只软告警。**✅ 已解决（2026-10-06 补登，本卡遗漏同步 → drift）**：`check-file-lines.ts` 的 `ADVISORY_RULES` 第三条（前端生产层 preview-3d/backend >900 行软告警）正是为消解「caps 900+ 脱管」而加；实测当前 caps 最大 **sky 967** 仍 < mount-preview-core 红线 **1045**（且 mount 本身已被拆到 814），caps 经 ADR-315 锐评持续瘦身，无超硬红线项。非真债，是台账未同步 10-06 补登。

### 🟢 低 / 已修确认
- **T6 · 硬编码本机路径 4 处未修**：`frontend/e2e/perf-fixtures.ts:460,578,724,842`（`C:\Users\zhujieling11\...`）。⚠️ **JS 双反斜杠字面量陷阱**，`grep 'C:\Users'` 与 `git grep` 都漏，须匹配 `C:\\Users` 或读原文（本轮主模型连判两次「已修」，实为陷阱）。另 `scripts/android-build.ts:78-84` 的 `C:\Android\Sdk` **已改**为 `LOCALAPPDATA` 探测 + `ANDROID_HOME` 单一事实源 → 10-06 该项半修。
- **K1 · 知识卡认领冗余**：`check-knowledge-drift` errors 0 / warns 10。0 独占 `source_files` 的 6 卡共 25 条重复登记（`dnd-shared`4/`doctor-gate-overlap`3/`features-dialogs`6/`model-stats`4/`ui-slide-menu`3/`ysm-anim-pipeline`5）；`model3d.md` **1042**、`wails-bindings.md` **118** 派生符号（目录级认领）；auto_fields 全仓零信息消费者；`go-repoaudit.md` 机制锚疑似指向引用处。
- **K2 · 本卡 `category: go` 错位**：内容横跨 Go/前端/ADR/测试四域，误导按 category 路由。
- **S1 · `gen-knowledge-*` 六个生成器仍并存**未收口；`gate-inventory.json` 未建（部分缓解：`gate-config.ts` 已是单一工具清单 + `gate-coverage` 动态枚举分母）。**维持**：属 generator 收口优化，非阻断；`gate-config.ts` 单一事实源已实质替代 `gate-inventory.json` 职能，待生成器重构时一并收敛。
- **H1′ · `docs/` 根 6 份历史审计 critique（~130KB）可迁 `docs/archive/`**：`audit-env-review`/`audit-ground-review`/`audit-knowledge-accuracy`/`audit-knowledge-reliability`/`audit-postprocessing-critique`/`audit-water-critique`。**⚠️ `audit-src-map.md` 是 `gen-project-map.ts` 生成物，不可归档。** **暂缓（2026-10-08 晚间复评）**：经 grep 全仓入链，这 6 份**有活消费者**而非纯死文档——`audit-env-review.md` 被 `ADR-292`/`ADR-305`/`drafts/ground-design-exploration.md` 引用（上游缺陷锚点）；`audit-water-critique.md` 被 `water.md`/`ADR-322`/`fog-capability.ts`/`layer-offsets.ts` **源码注释**硬引用；`audit-postprocessing-critique.md` 被 `preview-env-state.md` 引用（且 `preview-env-state.md` 当前正被并行会话锐评重构在途改动）。机械 `git mv` 会断 4+ 处 `.ts` 注释路径（不被 `check-doc-drift` 捕获）+ 多个 ADR/草稿入链。按「迁出前三查」纪律，须先改代码侧入链再迁。**✅ 已迁移（2026-10-09，锐评收敛 `799ac4aa8` 后）**：8 份快照（env-coupling / ground / host-env-coupling / knowledge-accuracy / knowledge-reliability / postprocessing / water / preview-env-critique-10-09）`git mv docs/archive/` + 文首活指针头；代码侧硬引用 3 处改指 `docs/archive/audit-*`（`fog-capability.ts` / `layer-offsets.ts` → archive/audit-water-critique，`mmd-ktx2-encoder.ts` → archive/audit-host-env-coupling-review）；ADR-322 / ground-design-exploration / model3d / preview-core 入链同步改指；上轮 tech-debt-audit 迁移遗留的 2 处旧名裸引用（`go/wasispike/main.go` / `check-file-lines.ts`）一并补指 `docs/archive/`。判定修正两处：`audit-water-critique` 的 `water.md:337` 入链已随 10-08 锐评收口消失（无需改指）；**`audit-env-review.md` 留 docs 根不迁**——文首自标「环境系统审查台账（活文档）」且是 ADR-292/305 活锚点，冻结区不适用。`audit-src-map.md` 生成物不碰。docs 根审计件终态 = 1 活台账 + 1 生成物。
- **已修确认**：errcheck 生产 **0** 条（10-06 为 114）、ysmwasi **61.3%**（原 33.3%）、复杂度 RED **0**（原 52；Molang 876 → MIT 第三方 vendored 排除有 fail-closed 守卫，属噪声移出统计面而非债清零；另 4 个 RED 真重构）、契约测试域登记 **104/104 零漏**、binding 176/176、i18n 死键 **13**（原 17）、ADR-311 快照 **0**、`scripts/` 194→**178** 文件（↓5711 行）、未接入 check-\* **0**、知识卡 kind snake_case 仅剩 1 个、无卡引用源码文件 52→**14**、全套 vitest **473 文件 7719/7719 全绿**、SafeWalk 无真吞错、并发安全、`app.go` 435 行纯门面（非 god object）、`_attic` 20 脚本零活引用（真死）。

## 2026-10-08 晚间复测（HEAD = 28c2c7de8 之后 14 提交）

> 主模型对审计「已清偿」项逐项目前 HEAD 重新实测，全部复现；审计后新提交未把债带回。

| 维度 | 审计记录 | 晚间复测 | 判定 |
|---|---|---|---|
| Go errcheck 生产违规 | 0 | **0**（golangci 全量） | ✅ 守住 |
| `go/ysmwasi` / `internal/app` / `install` 覆盖率 | 61.3% / 58.8% / 92.8% | **61.3% / 58.8% / 92.8%** | ✅ |
| 前端复杂度 RED / ORANGE / YELLOW | 0 / 47 / 223 | **0 / 47 / 222** | ✅ 守住 |
| binding 双侧契约 | 176/176 · 0 | **176/176 · 0** | ✅ |
| 契约测试域登记 | 104/104 | **125/125** | 🟢 改善 |
| i18n 死键 | 13 | **13** | ✅ |
| 知识卡漂移 | errors 0 / warns 10 | **errors 0 / warns 10** | ✅ 一致 |
| vitest 全量 | 473 文件 7719 全绿 | **473 文件 7733 全绿**（增 14 用例） | 🟢 改善 |
| 死代码基线 | knip 183 / jscpd 118 · ERROR 0 | **knip 185 / jscpd 118 · ERROR 0**（基线内放行） | ✅ |
| 覆盖率门禁（P1-b） | ccheck 0%→83.9% 已修 | **全包达标、总体 79.0% 全绿**（新鲜产物） | ✅ 修复生效 |
| 文件行数红线 | 18 个超阈值（软告警） | **18 个一致** | ✅ |

附带：`go build ./...` 0、`golangci-lint` 全量 0 errcheck、`binding-check` 0 issues、`check-knowledge-drift` errors 0、`check-complexity` 最新认知复杂度 41（警告列表全 37–41）均守住。唯一一次 vitest 失败经双跑确认为 **flaky**（download-queue 定时器用例），非真回归。

### 本次（2026-10-08 晚间）动手清偿
- **P1-a 半根治**（见上「高」段）：缺产物优雅降级 + 新鲜度断言 + gate-config 注释对齐 + 契约测试钉死。
- **P2 全修**（见上「中」段）：六处文档「pre-push 全量门禁」失真统一改轻量档表述；`AGENTS.md` 契约测试计数 95→122。
- **T3′ 已修**：`frontend/e2e/file-tree.spec.ts` 删除 `dirCount===0` 的 `test.skip` 分支，改为 `expect(dirCount).toBeGreaterThan(0)` 硬断言——mock 恒含 `subdir/subdir-model.ysm`（tree-dir 必渲染），回归即硬红，不再被 skip 掩蔽（三重门纪律对齐）。
- **T6 已修**：`frontend/e2e/perf-fixtures.ts` 4 处 `absPath` 硬编码本机路径（`C:\\Users\\...`）改为相对路径 `tests/fixtures/ysm/...`（`perf-common.ts:100` 注释明确测试/断言用 `relPath` 不用 `absPath`，无消费者破坏）。
- **K2 已修**：本卡 `category: go` → `core`（内容横跨四域，`affected:false` 已退出路由，但仍消除误导性）。
- **A1 已落地 + 部分升 hard**：`scripts/check-adr-health.ts` 加 `--suggest` 非阻断观察项（debt 级、不进 gate），摊开三类治理数据——①-a 决策态缺 emoji 前缀 4 条、①-b 已采纳缺 ✅ 126 条（与审计精确吻合）、② 决策未定 ADR 含进度化石 21 条（含审计点名 6 个 📝 滞留）；并把 **①-a 决策态缺 emoji 升为默认全量 WARN**（ADR-218 真 partial 缺 🔄 现被自动守护）。升 WARN 时暴露并顺手修复 `normalizeState` 的「非废弃」否定词误判（ADR-181/182/183 被错归 deprecated），联动 `gen-docs-index` 重生成校正 3 个 ADR 登记表 drift，默认全量 ERROR 0。
- **T5 已解决（台账 drift）**：`check-file-lines.ts` 的 `ADVISORY_RULES` 第三条（前端生产层 >900 软告警）已在 2026-10-06 补登消解「caps 脱管」，本卡遗漏同步；实测 caps 最大 967 < mount 红线 1045，无超硬红线项。
- **S1 维持**：generator 收口优化，`gate-config.ts` 单一事实源已实质替代 `gate-inventory.json` 职能，非阻断。
- **H1′ 暂缓**：经 grep 发现 6 份 audit critique 有活入链（含 `fog-capability.ts`/`layer-offsets.ts` 源码注释硬引用 `audit-water-critique.md`、`preview-env-state.md` 正被并行会话锐评在途），机械归档会断 4+ 处 `.ts` 注释路径；待 preview-3d 锐评收口后单独断链迁移。
- **K1 维持**：6 张卡 `source_files` 全被认领（warn 级），多为有意跨切面聚合卡，不盲目收窄。→ **2026-10-09 后续**：「有意跨切面」决策已机器表达——`broad_claim: true` 旗标收编进 `CARD_TOP_KEYS` + `check-knowledge-drift` 5.14/5.15 豁免 + **5.17 stale 自清理**（卡收窄后旗标失需 → WARN 提示移除，防豁免退化成永久逃生阀），契约测试 `check-knowledge-claim-overlap` / `check-knowledge-derived-symbol-count` 各补豁免 + stale 用例；8 张卡（6 全重复认领 + model3d / wails-bindings 符号体量）登记旗标。drift warns 由 21 收敛至 **1**（余 14 个代码→卡覆盖盲区，非阻断）。
- **审计台账全卡已账实相符**：P1-a/P2/T3′/T6/K2/A1 已修或落地，T5/S1 已澄清（非真债/drift/优化），H1′ 暂缓（活入链），K1 维持（有意跨切面）。剩余真正未动手项仅 A1 的"升 hard 检查"（待团队拍板 emoji 强制与否）与 H1′ 的断链迁移（待 preview-3d 锐评收口）。

## 2026-10-08 20:42 探索抓现行 + 清偿（第三轮，主模型单人）

> 缘起：用户「探索项目技术债及效果」——逐门禁实跑对账时**当场抓到 2 条溜进 main 的新债**，随即动手清偿。

### 🚨 抓现行

- **R1 · `water-capability.ts` 超硬红线（真债·已修）**：元凶 `9e742a6da`（19:53 锐评两刀收口）把文件 **644 → 660 行**，跨过 `check-file-lines` 的 655 硬红线（ADR-315 D1/D3），且**已推上 `origin/main`**——本地 `pre-push-gate --static` exit 1、CI run `37777054773` 的「静态治理门禁（本地 hard 项的远端兜底）」job **failure**，双层防线：本地层当时被逃生阀绕过、远端兜底抓住（ADR-244 设计意图的活证据）。
  - **清偿（真缝下沉，非注水）**：`loadState` 首段「存档源 + legacy ground 双轨解析」下沉 `water-persist.ts|resolveWaterRestoreState`（同族先例 = restoreBySchema / light-persist 数据面下沉），`loadState` 只留恢复编排；**660 → 637 行**。TDD：先写 5 例单测（红）→ 实现绿，`water-capability.test.ts` legacy 迁移组 144 例守行为等价；build/typecheck/biome/layering(0 回归)/circular(0) 全绿，全量 vitest **474 文件 7750/7750**。
- **R2 · jscpd 118 → 119（同构薄封装 clone·确认保留）**：`ground-capability#water-capability` 新增克隆（`setEnvState`+`subscribe`+`notify` 同段，51 tokens）——根因是 water 的 `setWaterMode` 改走 `writeOpts(opts)` 后与 ground 同形，克隆跨过 min-lines/min-tokens 阈值。**处置 = 确认保留 + `--update-baseline` 吸收**：该 4 行委托是 9 个 cap 的统一范式（共享原语已提级 `createListenerSet`，ADR-216），基线已有 `environment#fog` / `environment#sky` / `postprocessing#shadow` 三对同族先例；为消一条 jscpd 行去改 9 个 cap 的类结构 = 风险 > 收益。**已知代价**：基线键是文件对粒度，该对后续新增克隆会一并放行。复检 ERROR 0。
- **晚间复测表修正**：「文件行数红线 18 个超阈值（软告警）一致」在 19:53 提交后失真——晚间复测时点实为 18 advisory + **1 hard violation**（即 R1）。台账快照会随并行提交过期，复测结论只对当时 HEAD 有效。

### 效果面（本轮实测）

`doctor --docs` 23/23 · `go build` 0 · 覆盖率门禁 79.0% 全包达标 · binding 176/176 · 复杂度 RED 0/ORANGE 47/YELLOW 222 · redlines baseline exit 0 · i18n 死键 13 · knowledge-drift errors 0 · adr-health --suggest（21 化石观察中）· 死代码 ERROR 0（吸收后）。

## 总体判断

治理体系成熟度**高于**同类项目（红线脚本 `type-consistency`/`binding-check`/`check-redlines` 全绿、前端 `typecheck`/`vite build` 通过、零循环依赖、零生产 `any`/`@ts-ignore`、i18n 三语 parity 完美）。
真实高危债集中在两条已还的 ADR 红线（H2/H3）；其余多为「已知/可收敛/被门禁冻结」的维护性债，且子代理探查对 **H1（死链误报）、H3（30+ 吞错夸大，实为 2 处）、H4（悬空 ADR 误报，四篇状态已完备）、G3（重复函数多为有意保留入口）、A2（92 篇夸大，实为历史叙述+审计已盘 3 处）** 存在系统性夸大，动手前务必亲自核实。

## 相关

- ADR-051（错误分类单源）、ADR-030（后端健壮性契约）、ADR-010/065（rtype 单源）、ADR-190/208（features→backend seam）
- 受影响知识卡：`go-fsutil.md`（`SafeWalk`）、`go-importer.md`、`go-cli-layout.md`、`go-launcher.md`、`go-ysm-parser.md`
