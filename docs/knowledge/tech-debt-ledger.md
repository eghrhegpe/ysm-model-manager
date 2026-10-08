---
kind: tech-debt-ledger
name: 技术债台账（探查快照 2026-10-08）
tier: leaf
category: go
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
> 第二轮完整报告：`docs/tech-debt-audit-2026-10-08.md`（含 9 项误判纠正与全部命令原始输出）。前一轮审计：`docs/tech-debt-audit-2026-10-06.md`。
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
- **F1 · 死代码基线**：`check-deadcode-baseline` knip 183 + jscpd 118，ERROR 0、无新增（门禁只减不增）；优先回收 `preview-3d/caps`、`adapters`、`parsers`。
- **F2 · 巨型前端文件（子代理夸大·2026-10-08 核实 >500 行多为测试/locale）**：子代理报「32 个 >500 行巨型前端文件」，实测 >500 行清单里**绝大多数是测试文件**（`water-capability.test.ts` 2460、`mmd-adapter.test.ts` 1868、`postprocessing-capability.test.ts` 1771 等，属 T3 fixture 拆分范畴）和 **locale 数据**（`ja/en/zh-CN.ts` 各 ~1700 行——i18n 语言包是数据文件，**拆分即反模式**）。**真生产文件** >300 行仅约 15 个：`caps/{sky,postprocessing,ground,environment,light}-capability.ts`（各 846-995 行）、`state/env-state-schema.ts`(897)、`adapters/{vmd-retarget,mount-preview-core,ysm-adapter,vrm-adapter}`(728-827)、`parsers/ysm-header.ts`(807)、`menu/engine/core.ts`(786)。**但 AGENTS 明确"新组件一个文件放一个可独立工作的功能，不按行数机械切割"**——拆分依据是**职责过载**而非行数，需逐文件判断职责边界，非机械切。若真要拆，优先看 `sky-capability.ts`(995)/`env-state-schema.ts`(897) 是否混了多个子职责。
- **T2 · 薄弱测试（子代理误报·2026-10-08 核实 `utils/base` 覆盖极好）**：子代理称「`utils/base`(纯函数核)、`utils/storage`(隐私安全层) 无单测」——**完全错误**。`frontend/src/utils/base/` 下**每个模块均有对应测试**（共 19 个 `.test.ts`：`storage/async/debounce/base64/lock/listener-set/disposable/log/main-thread-watch/apperror-text/array/clamp/guards/label/recycle-path/safe-error-msg/tex-size/web-path`）；`utils/storage` 实为 `utils/base/primitives/storage.ts`，其 `storage.test.ts`(127 行) 覆盖**极其完善**——正常透传、存储抛错降级（`safeGet→null`、`safeSet/safeRemove` 静默不抛）、**隐私模式降级**（mock localStorage 抛错 → `isStorageAccessible=false`）、损坏 JSON→fallback、key 互不污染、`logWarn` 日志验证。**真实小缺口**：`internal/app/app.go`(400 行主编排) 无直接 `app_test.go`——但 `internal/app/` 包内按职责拆分 20+ 个 `app_*_test.go`（`app_config/app_files/app_install_import_coverage/...`），整体覆盖好，主编排靠集成/间接覆盖属常规取舍，补直接单测价值低。
- **F3 · features 越 seam 软接触 backend 非绑定 helper**：`context-menu/version-updater/dnd/community/import/platform` 直引 `capabilities/platform/runtime/browser-adapter`，收口受许模块或经 seam 暴露（非硬违规，ADR-190/208 精神）。
- **G3 · 重复辅助函数（子代理部分夸大）**：`copyDirRecursive`/`copyFile` 等多数已在注释中声明「已收敛至 fsutil，保留双入口避免改名 churn（测试直接引用）」——是有意兼容入口，非真债；新代码务必走 `fsutil.*`，存量双入口按需收敛。
- **T1 · 依赖审计信息缺口**：本环境 `goproxy.cn` `Forbidden`、`npm outdated` 超时，无法实测 `go list -u -m all`/`npm audit`；已知风险 `@wailsio/runtime ^3.0.0-beta.26`（beta）、`typescript ^7`、`vite ^8` 大版本。需联网环境 `govulncheck` + `npm audit` 补全。
- **T2 · 薄弱测试**：已核实误报，见上方 F2 条目的"T2 误报"段落——`utils/base` 19 个测试文件全覆盖、`storage.test.ts` 覆盖隐私降级。**移除本项**（原报「无单测」不成立）。
- **T3 · 巨型 fixture 测试（第二轮复核修正）**：`water-capability.test.ts` 125.6KB 等。但最大的契约测试 `tests/test_design_tokens.ts` 63.2KB 是 **1270 行 / 213 断言 / 0 个 `test()` 调用**的线性纯函数对拍脚本（~6 行/断言）→ 高密度数据驱动测试，**非 fixture**，勿报。
- **T4 · `vi.mock(".js")` 旧写法（第二轮修正计数 + 降为低危）**：实测 **21 处，真债仅 11 处**（`bindings/ysm-model-manager/internal/app/app.js`，实际只有 `app.ts`）。`check-mock-paths` 的 M3 detail 明写「spec 以 .js 结尾但**实际解析到** `.../app.ts`」→ **vitest 不会 mock 错模块，不构成 false-green 通道**，纯属后缀陈旧。**统一改 `.ts` 会误伤另 10 处**：`@/wasm/ysm-wasm-data*.js`（4 处，`frontend/src/wasm/` 确为真 `.js` + `.d.ts`）与 `three/addons/**/*.js`（6 处，three 官方发行 `.js`）。`docs/.mock-path-exempt.json` 实测 `files: []`、`specs: []` **豁免账本为空**，故「永久豁免已无意义」不成立。

## 第二轮新增（2026-10-08，3 子代理：前端运行时 / Go 后端 / 测试契约治理）

详见 `docs/tech-debt-audit-2026-10-08.md`。代码债（Go 侧 + 复杂度 RED）已清偿，**新债全在治理与文档一侧**。

### 🔴 高
- **P1-a · 覆盖率门禁与代码脱钩**：`scripts/_lib/gate-config.ts:237` 注释称「依赖 `.coverage/go-cover.out`（push 前 gate 已生成）」——**实测全链路无人生成**。`.githooks/pre-push` grep `coverage` = 0；`gate-blocks/go-domain.ts` 跑 `go test` 不带 `-coverprofile`；`gate-blocks/static-tools.ts` 只跑 `node scripts/<tool> --json`；唯一写文件的 CI 步 `test.yml:361` 是 `main`-only + `continue-on-error`（非门禁），且 `.gitignore:132` 让产物无法交回本地。知识卡 `go-coverage-gate.md:94` 早已记录「**无代码自动生成（脚本只读不写）**」——**与 `gate-config.ts:237` 直接矛盾**。另：脚本 `check-go-coverage-threshold.ts:174` 用 `readFileSync` 裸读、产物缺失**抛未捕获 ENOENT crash**（exit 1），`blockPolicy: debt` 使其不阻断 → 既不能守门又持续制造噪声。建议加**产物新鲜度断言**（mtime 早于 `git log -1 --format=%ct` 即 exit 2）+ 缺产物优雅降级 + 修注释。
- **P1-b · `cmd/ccheck` 漏登记 `SKIP_PACKAGES`**：`go list ./cmd/...` 输出 `cmd/ccheck` + `cmd/updater` 两个真实 `main()` 入口包，后者已登记（`:161`，注释写明「进程入口测试内不可达」），前者（2026-09-11 `23bfeb9ac` 引入）漏登记。**决定性实证**：换成新鲜覆盖率产物后门禁立刻转红 `❌ ysm-model-manager/cmd/ccheck: 0.0% (阈值 20%)` exit 1——它在 10-06 旧快照里不存在，所以旧快照恒绿。根因：`SKIP_PACKAGES` 是静态表，新增进程入口包**必然漏登记**。建议补一行 + 改启发式判定。

### 🟠 中
- **P2 · 六处常驻文档称「pre-push 全量门禁」**：`AGENTS.md:101`、`CONTRIBUTING.md:161`、**`SECURITY.md:74`**（安全文档失真最误导）、`gate-chain-map.md:140`、`pre-commit-hook.md:78`+`:105`、`pre-push-gate.md:291`（与同卡 `:275` **自相矛盾**）。`YSM_FAST_PUSH` 默认轻量档实测跳过 4 处（`frontend-domain.ts:164`→168/173/239、`go-domain.ts:100`→104）。另 `AGENTS.md:173`「95 个 tests/\*.ts」→ 实测 **122**。ADR 内同类表述是历史快照，不算债。
- **A1 · `check-adr-health` 无进度化石正则、无 emoji 前缀检查**：grep `化石|进度|排期` = 0 命中。213/333 ADR 含化石字样、**126/304 已采纳缺 emoji 前缀**全靠人肉巡检；6 个 📝 提议中 ADR（284/292/301/321/325/151-d1）滞留 2 周+，10-06 为 3 个 → **恶化**。建议先 `--suggest`/debt 观察一轮（需先定化石白名单防误伤历史叙述）。
- **T3′ · `file-tree.spec.ts:51-53` 残留条件 skip**：`if (dirCount === 0) { test.skip(true, ...); return; }`，而同文件 `:55` 断言 mock 恒含 `subdir/subdir-model.ysm` → `dirCount===0` 意味着加载链回归，应硬红。全 27 个 e2e spec 仅此 1 处活 skip（其余 3 处命中是「已移除 skip」的说明性注释）。
- **T5 · caps 族未纳入 `check-file-lines` 硬红线**（10-06 P1 遗留）：`sky-capability.ts` 1068 行已超 `mount-preview-core.ts` 的红线值 1045，仍只软告警。

### 🟢 低 / 已修确认
- **T6 · 硬编码本机路径 4 处未修**：`frontend/e2e/perf-fixtures.ts:460,578,724,842`（`C:\Users\zhujieling11\...`）。⚠️ **JS 双反斜杠字面量陷阱**，`grep 'C:\Users'` 与 `git grep` 都漏，须匹配 `C:\\Users` 或读原文（本轮主模型连判两次「已修」，实为陷阱）。另 `scripts/android-build.ts:78-84` 的 `C:\Android\Sdk` **已改**为 `LOCALAPPDATA` 探测 + `ANDROID_HOME` 单一事实源 → 10-06 该项半修。
- **K1 · 知识卡认领冗余**：`check-knowledge-drift` errors 0 / warns 10。0 独占 `source_files` 的 6 卡共 25 条重复登记（`dnd-shared`4/`doctor-gate-overlap`3/`features-dialogs`6/`model-stats`4/`ui-slide-menu`3/`ysm-anim-pipeline`5）；`model3d.md` **1042**、`wails-bindings.md` **118** 派生符号（目录级认领）；auto_fields 全仓零信息消费者；`go-repoaudit.md` 机制锚疑似指向引用处。
- **K2 · 本卡 `category: go` 错位**：内容横跨 Go/前端/ADR/测试四域，误导按 category 路由。
- **S1 · `gen-knowledge-*` 六个生成器仍并存**未收口；`gate-inventory.json` 未建（部分缓解：`gate-config.ts` 已是单一工具清单 + `gate-coverage` 动态枚举分母）。
- **H1′ · `docs/` 根 6 份历史审计 critique（~130KB）可迁 `docs/archive/`**：`audit-env-review`/`audit-ground-review`/`audit-knowledge-accuracy`/`audit-knowledge-reliability`/`audit-postprocessing-critique`/`audit-water-critique`。**⚠️ `audit-src-map.md` 是 `gen-project-map.ts` 生成物，不可归档。**
- **已修确认**：errcheck 生产 **0** 条（10-06 为 114）、ysmwasi **61.3%**（原 33.3%）、复杂度 RED **0**（原 52；Molang 876 → MIT 第三方 vendored 排除有 fail-closed 守卫，属噪声移出统计面而非债清零；另 4 个 RED 真重构）、契约测试域登记 **104/104 零漏**、binding 176/176、i18n 死键 **13**（原 17）、ADR-311 快照 **0**、`scripts/` 194→**178** 文件（↓5711 行）、未接入 check-\* **0**、知识卡 kind snake_case 仅剩 1 个、无卡引用源码文件 52→**14**、全套 vitest **473 文件 7719/7719 全绿**、SafeWalk 无真吞错、并发安全、`app.go` 435 行纯门面（非 god object）、`_attic` 20 脚本零活引用（真死）。

## 总体判断

治理体系成熟度**高于**同类项目（红线脚本 `type-consistency`/`binding-check`/`check-redlines` 全绿、前端 `typecheck`/`vite build` 通过、零循环依赖、零生产 `any`/`@ts-ignore`、i18n 三语 parity 完美）。
真实高危债集中在两条已还的 ADR 红线（H2/H3）；其余多为「已知/可收敛/被门禁冻结」的维护性债，且子代理探查对 **H1（死链误报）、H3（30+ 吞错夸大，实为 2 处）、H4（悬空 ADR 误报，四篇状态已完备）、G3（重复函数多为有意保留入口）、A2（92 篇夸大，实为历史叙述+审计已盘 3 处）** 存在系统性夸大，动手前务必亲自核实。

## 相关

- ADR-051（错误分类单源）、ADR-030（后端健壮性契约）、ADR-010/065（rtype 单源）、ADR-190/208（features→backend seam）
- 受影响知识卡：`go-fsutil.md`（`SafeWalk`）、`go-importer.md`、`go-cli-layout.md`、`go-launcher.md`、`go-ysm-parser.md`
