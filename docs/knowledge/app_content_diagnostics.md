---
kind: app_content_diagnostics
name: 诊断与冲突页 diagnostics
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/diagnostics/init.ts
  - frontend/src/views/app-content/diagnostics/logs.ts
  - frontend/src/views/app-content/diagnostics/dedup.ts
  - frontend/src/views/app-content/diagnostics/dedup-policy.ts
  - frontend/src/views/app-content/diagnostics/health.ts
  - frontend/src/views/app-content/diagnostics/conflicts.ts
  - frontend/src/views/app-content/diagnostics/perf.ts
  - frontend/src/views/app-content/diagnostics/perf-common.ts
  - frontend/src/views/app-content/diagnostics/perf-single-bench.ts
  - frontend/src/views/app-content/diagnostics/perf-mode.test.ts
  - frontend/src/views/app-content/diagnostics/perf-trace.ts
auto_fields:
  symbols_with_lines:
    - BASELINE_CONTROL_IDS
    - bindPerfCopyHandlers
    - CLIResp
    - createDedupSession
    - DedupConfigShape
    - DedupFileLike
    - DedupSession
    - EscFn
    - formatSize
    - getDefaultKeepIdx
    - initDiagnostics
    - initPerfPanel
    - loadDiagnosticsLogs
    - loadRuntimeLogs
    - PERF_RUN_BUTTON_MODE_KEYS
    - PERF_UNREAD_MODES
    - PERF_UNREAD_TARGETS
    - PerfIdentity
    - perfScopeHint
    - populatePerfTargetOptions
    - renderHealthReport
    - renderLoadTraceSection
    - runHealthAudit
    - runSingleBench
    - scanSyncConflicts
    - sectionHeader
    - singleBenchReadIterations
    - syncPerfBaselineControls
  tests:
    - frontend/src/views/app-content/diagnostics/conflicts.test.ts
    - frontend/src/views/app-content/diagnostics/health.test.ts
    - frontend/src/views/app-content/diagnostics/init.test.ts
    - frontend/src/views/app-content/diagnostics/perf.test.ts
    - frontend/src/views/app-content/diagnostics/perf-common.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 诊断页、仓库体检、冲突 / 去重
  - 日志查看、性能分析
  - initDiagnostics、createDedupSession
  - oldest 资历排行
quick_risk_lines:
  - 去重 / 体检必须经 diagnostics 页发起，禁止在其他页直接调 doDedup
pitfalls:
  - 在仓库页直接调 doDedup → 缺上下文、无法展示冲突视图；必须走 diagnostics 页 initDiagnostics
  - 性能 trace 未释放 → 长时占用内存；file-bench / perf-trace 完成后必须 stop 回收
use_when:
  - 诊断页
  - 冲突
  - 去重流程
  - 诊断页日志 tab
  - 性能
  - oldest
perf:
  - cpu-bound
  - gpu-bound
  - concurrent
invariant_anchors:
  - frontend/src/views/app-content/diagnostics/dedup.ts|createDedupSession
status: active
---

# 诊断与冲突页 diagnostics

## 概览

`diagnostics/` 是 `app-content` 的「诊断与冲突」页子域，顶部 **5 个** `repo-tab`（log / bench / record / health / sync-conflict——ADR-258 由左栏分段收敛而来，ADR-278 再把「机制导向」的性能五兄弟重划为「动作（bench）× 产物（record）」；gui tab 已随 a1e26419d「砍除 gui-flow 面板」下线；conflict tab 于 2026-09-21 下线，见下文「冲突检测（跨实例同名扫描）退役」），由主卡 `app-content` 的 `init-pages.ts` 经 `bindTabs(host, ".repo-tab", "diag", [...])` 接入全站统一范式分发初始化。内部高内聚：`init.ts` 汇聚全部子模块，子模块之间只依赖 `logs.ts`（操作日志渲染），对外只依赖 `core/i18n` / `bus` / `backend` / `utils` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据）。

> 导航结构演进（ADR-258）：原左栏 `diag-left`（6 个 `diag-btn` + 复制/刷新/清空）已删除，分段提升为顶部 `repo-tab`；日志合并为 1 个 tab（op/runtime 子 tab 切换），性能拆为 single/gui/hist/trace 4 个 tab；清空按钮归位日志面板工具栏且仅操作日志视图可见（仅 `ClearImportLogs` 生效，运行时日志无清空后端能力）。

## 核心职责

- `init.ts` — 诊断页 `initDiagnostics`；去重会话 `createDedupSession`（由 `init-pages.ts` 持有会话实例，`session.start` 派发 `model:select` / `stats:refresh` / `tree:reload`）
- `web-gate.ts` — **web 模式能力门禁单点**（`webGate(key)`，2026-09-18 诊断页重复实现审计 C1）：`isWebPlatform()` 为真则弹 warn toast 并返回 `true`，调用方 `if (webGate("diagnostics.xxx")) return;` 中止。此前同一段 8 行样板在本页抄了 **5 份**且各起名字（`concWebModeCheck` / `guiFlowWebModeCheck` / `scanBenchWebModeCheck` / `dgCfWebGate` / `dgCfSyncWebGate`），唯一差异是文案键。**新增需要 web 门禁的入口一律调它**，不再照抄——照抄哪一份都不能保证提示级别与中止行为一致。键类型是 `LocaleKey`（`@/core/i18n/t.ts`），故键名由调用方给；本页不止性能面板需要（conflicts 同步冲突扫描同样要拦），所以不放进 `perf-common.ts`（那是性能面板共享层，冲突扫描 import 它是跨域依赖）
- `copy-toast.ts` — **复制并如实回执单点**（`copyWithToast(text, okKey)`，2026-09-18 审计 C5）：本页所有复制入口（整份日志 / 单行日志 / 性能面板「复制原始输出」）**一律**经它；内部消费既有单点 `utils/dom/clipboard.ts|copyText` 的 `{ok}` 结果——成功 `✅ <成功文案>`，失败 `❌ diagnostics.copyFail` 且 `type: "error"`。**失败必须说失败**：此前本页自写 textarea 降级两份（返回 `void`，失败不可见）并**无条件**弹「已复制」，剪贴板被拒且 `execCommand` 也失败时界面在撒谎（单行日志那条还把失败标成了 `success` 类型）；全仓范式早已写在 `features/pack-ops/instance-ops.ts:73-80` 的注释里——`copyText` 永不 reject，**必须消费布尔结果**。成功文案键由调用方给（整份日志 `copiedLogPrivacy` 带隐私提示 / 单行 `copiedLog` / 性能 `perfCopied`）；失败键原名 `perfCopyFail`，已去 perf 前缀改为 `diagnostics.copyFail`（日志与性能共用）。墓碑：`copy-toast.test.ts` 3 条 + `init.test.ts` 入口层 2 条（含「写入与降级全失败 → 绝不弹已复制」），已用变异体反向验证（改回一律说成功 → 3 条立刻红）
- **空态不是日志**（2026-09，`dgInCopyActiveLog`）：判「列表里有没有 `.log-row`」，零行即视为无内容。此前判 `textContent` 非空——而空态/错误态占位（「暂无日志」/「无匹配日志」/「加载失败」）本身就非空，于是整份日志入口把**占位文案当日志复制**并弹「已复制」，`diagnostics.noLogsToCopy` 兜底生产不可达（只有列表元素整个缺失才走到）。墓碑：`init.test.ts`「加载完成为空（列表只剩占位文案）→ 仍不复制」（反向验证：回退成判 `textContent` 即红）；另有 **3 条旧用例原先依赖占位文案提供「可复制内容」**（注释自陈「否则撞『无日志』早退分支」），本次一并改为播种真实日志——**测试把缺陷固化成契约**的典型。判「内容来源」而非「文本非空」
- `css/content-diag.ts` 的 `.perf-wrap` / `.perf-controls` / `.perf-row` / `.perf-mode-off` — **性能面板控制条样式**（2026-09 由 `css-layer-check` 报出后补）：这几个类此前**在整个 `frontend/` 零 CSS 规则**（类名是空头支票），性能面板 11+ 控件靠 UA 默认 inline 流换行，功能分组不可见、窄屏折行语义全散。现按日志工具栏（`.diag-log-bar` + `.diag-log-row`）已验证的范式：`.perf-controls` = 纵向堆叠的框，`.perf-row` = 语义行（`tpl.ts` 的跑基准 tab 按**模式**分行，同时只呈现一套控件——ADR-278）。同批修 `.perf-conc-filerow`（补进 `.perf-conc-row` 选择器，原缺 flex 致行内 label 不伸展）与 `.log-copy`（原无规则 → 每个日志行里一个 UA 默认灰底按钮）。`.perf-mode-off` 是基准模式显隐的**唯一**机制（class），与查看器降级的 inline `display:none` 分工不重叠——inline 胜过 class，故模式接线不可能把查看器藏掉的桌面专属按钮又「显示」回来（ADR-278 §2.4）。闸为何曾漏检见 `docs/adr/ADR-274`
- `perf-common.ts|renderLoadFailure(out, resp, esc, emptyKey)` — **载荷不可用时的统一失败渲染单点**（2026-09-18 审计 C4）：`status === "success"` 却拿不到载荷 = **契约漂移**（比「执行失败」更值得暴露），渲染该模块的空载荷文案；其余（error / 部分失败）转述 Go 原话。此前同一段三元分支在 **5 个模块**各写一遍（`perf-single-bench` 的 `renderBenchFailure`、`perf-concurrent`、`perf-scan-bench`、`perf-gui-flow`、`perf-log`），唯一差异是空载荷文案键——**键必须留在调用点**：契约测试 `tests/test_cli_gui_flow_contract.ts` 按源码子串锚定 `perfScanBenchEmpty` 出现在 `perf-scan-bench.ts`，把键收进单点会立刻转红。唯一行为变化：`perf-log` 在「status=error 且条目解析失败」时改为转述 Go 原话（原先一律通用文案，会吞掉 Go 已给出的原因）。测试 `perf-common.test.ts` 的 `renderLoadFailure` 三条（成功态空载荷 / error 转述 / error 无 message 兜底）
- `health.ts` — 仓库体检面板：调 Go 端 `RepoHealthAudit`（go/repoaudit 同源，GUI/CLI 消双轨），渲染分数环/完整性/缓存/资源/去重/警告
- `dedup.ts` — 去重检测（类型元数据同步读 `utils/resource/schema.ts` 的 `resourceTypesById`（ADR-269 D3④：废 `services/resource-registry.ts` RPC 旁路）+ Go 绑定）；`createDedupSession()` 会话工厂把 busy/exec 重入守卫与去重配置收进闭包，经 `init.ts` re-export 接线。keep 保留策略纯函数于 2026-09-03 抽至 `dedup-policy.ts`（策略决策零 DOM/会话依赖，渲染默认保留索引与 exec 删除共用同一决策源，防规则漂移）
- `dedup-policy.ts` — keep 保留策略纯函数层（`getDefaultKeepIdx` + `pickByTime` 共享 pick 辅助 + `DedupFileLike`），自 `dedup.ts` 抽出（2026-09-03，ADR-040 拆分线延续）；零 mock 单测聚焦策略分支
  - `toTimestamp` 缺失/非法返回 `null`（「无时间信息」），不参与时间裁决；全缺失时 `pickByTime` 严格比较保序回退首项（2026-09-12 P0 收口，修「newest 侧 MAX 哨兵反判最新」潜伏语义缺陷——Go 扫描恒带回 modTime，生产不可达）
- `conflicts.ts` — 同步冲突检测与解决（本文件现只剩这一条链）：
  - **`scanSyncConflicts`（sync-conflict tab，实例↔仓库）**：调 Go `DetectConflicts`（真比两端 SHA256，哈希不同→`ConflictContentModified`），需手选 rtype + instance，带解决区（`ResolveConflicts` 三策略 + 1.5s 自动复扫，list 分离时作废迟到复扫）
  - **冲突检测（跨实例同名扫描）退役**（2026-09-21，用户拍板「直接下线」）：原 conflict tab 的 `scanConflicts` 聚合各整合包 CustomDir 条目判定「同名 + 哈希不唯一」，退役理由三条——① 扫描成本全页最重（遍历所有实例）而输出**只读无后续动作**；② 判据覆盖面已被 sync-conflict tab（内容级 + 可解决）与仓库页去重 tab 挤压，其注释自陈的漏报场景（两实例同名且哈希均缺失）本就「由 sync-conflict tab 兜底」；③ 与 sync-conflict 在用户视角同叫「冲突」难以区分。曾有的护栏修正（2026-09-18：只按名聚合会把 PushResources 正常分发产物误报成冲突，改判「同名 + 哈希不唯一」）不回滚——那是判据正确性，与本次「要不要这个入口」是两回事。Go `DetectConflicts` 本体保留（`handleSyncConflicts` 同步链仍在用）；同批清理仅本 tab 消费的 i18n 死键（`diagnostics.conflict`/`startScan`/`scanningDot`/`webNoConflictScan`/`noModpacks`/`noNameConflict`/`conflictsFound`/`modpackCount`/`contentDiffers`/`moreCount`）、无主 CSS（`.btn-base.accent.scanning` + `@keyframes scanPulse`）与 `dgInHideDesktopOnly` 名单项；`scanHint` 文案改指「扫描同步冲突」按钮；若日后重建，参考 git 历史中 `scanConflicts` 的哈希判据版本。
- `logs.ts` — 操作日志渲染：`OP_META` 七种中文标签+图标，状态图标优先读 `Level`（error→❌ / warn→⚠️ / debug→🔍 / fatal→💀 / info→✅），无 Level 按 `Status` 兜底；消费 Go `logs` 包（见知识卡 `go_logs`）
- `perf.ts` — 性能面板 facade：事件接线 + re-export，业务逻辑拆至：
  - `perf-common.ts` — 共享工具层（sectionHeader / 复制按钮 / 守卫 / 错误辅助）
  - `perf-single-bench.ts` — single-bench（CLI 文本流消费 + 柱状图 + 趋势图）
  - （`perf-gui-flow.ts` 已随 a1e26419d「砍除 gui-flow 面板」删除；Go `gui-flow` 命令保留，契约测试的前端消费断言同步退役）
  - perf-trend.ts — 性能趋势（localStorage `perf-history` + SVG 折线；原 `perf-log.ts`「优化历史卡片」区已由 380fa163f「remove perf-log UI section」移除，趋势图保留）
  - `perf-trace.ts` — 加载剖析（load-trace store 消费）

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-pages.ts` 调用：切诊断页 → `diagnostics/init.ts` 的 `initDiagnostics(root)`
- 监听 bus：`model:select` / `stats:refresh` / `tree:reload`（去重流程派发）
- 样式：`.diag-*` / `.perf-*` / `.log-row` / `.conflict-row` / `.scan-*` 动画定义在 `app-content` 样式层 `content-diag.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `go-logs`（Go 操作日志）→ `diagnostics/logs.ts` 消费端
- `go-repoaudit`（Go 仓库审计）→ `diagnostics/health.ts` 消费端
- `preview-3d/infra/load-trace.ts` → `diagnostics/perf-trace.ts` 加载轨迹
- 主卡 `app-content` 负责页面编排与分发；本卡只管诊断页自身的初始化与渲染

## 不变量

- 去重会话 `session.start` 派发的 `model:select` / `stats:refresh` / `tree:reload` 必须齐全，否则去重后界面不刷新
- 性能轨迹读取 `preview-3d` 的 `getLoadTraces` 为只读快照，不写回
- 冲突列表顺序与 `logs.ts` 的 `Operation` 分组一致（`OP_META` 标签为单一事实源）
- exec 读用户选中态按组容器查 `input[type="radio"]:checked`（2026-09-03）：组容器按渲染平铺序与 `allResults.groups` 一一对应，替代按 `name="dedup-keep-<gi>"` 全局拼串——组间插入其它控件不致错位，消除「渲染计数 gi / exec 计数 gi2」双轨对齐依赖；keep-all 值为 `-1` 的 radio 同属组内

- **面板结构由 `renderTabs` 工厂单点产出**（ADR-259，2026-09-17 事故收口）：诊断页此前是全仓唯一的例外范式——「一个共享 `.tab-body` 包 8 个 `.diag-panel`」。该范式更脆：`.diag-log-bar` 漏一个 `</div>` 就让 `#diag-tab-log` 把后续 7 个面板吞进自己内部，而 `bindTabs` 切页时把 `#diag-tab-log` 置 `display:none`，嵌在里面的面板一并消失 → **切任何 tab 都只剩空 tab 栏**。现改用 `views/app-content/tabs-shell.ts|renderTabs`（与其他 tab 页同构：每 tab 一个 `.tab-body`），面板 id 与 `bindTabs` 的 `${prefix}-tab-${id}` 共享同一条规则；`.diag-panel` 退化为纯入场动画钩子（布局归 `.tab-body`）。防线三层：`tabs-shell.test.ts`（工厂产出契约）+ `tpl-structure.test.ts`（各页 div 配平 / 按钮↔面板一一对应 / 面板必为 `.tab-body` 且等深同层）+ `e2e/diagnostics.spec.ts`（真实浏览器逐 tab 测 `getBoundingClientRect` 尺寸——`display` 口径对此失明）。泛化规则见 `skills/pitfalls.md` #20。
- **日志面板工具栏按语义分两行**（2026-09-17 版面收口，方案 A）：行1 = 子 tab（操作 / 运行时）+ 动作（刷新 / 复制 / 清空日志），行2 = 状态筛选 chips + 搜索框；两行容器为 `.diag-log-row`，`.diag-log-bar` 退化为纵向堆叠的框。立因：9 按钮 + 1 输入框挤单行时，`flex:1` 的 spacer 把「清空」（破坏性动作、且只清操作日志）与筛选 chips 划成一组、却把刷新 / 复制推到行尾，视觉分组 ≠ 功能分组，且窄宽下 spacer 随 `flex-wrap` 折行挤散动作组。清空恒排行尾；行2 搜索框 `flex:1; min-width:110px; max-width:320px` 吃掉腾出的宽度。类名 ↔ 规则同步由 `css/content-diag-classes.test.ts` 兜底（`.diag-log-row` 属布局类，有规则即通过）。
- **日志搜索是「共用输入框 + 按子 tab 分派」**（2026-09-17 收口）：`#diag-log-search` 同时服务操作日志与运行时日志，`init.ts|dgInBindLogSearch` 按当前子 tab 分派（op → `loadDiagnosticsLogs`，runtime → `loadRuntimeLogs`）。命中域：操作日志用 `logs.ts|dgLsMatchDiagSearch` 把 ModelName / ErrorMsg / TargetDir / SourcePath / Operation 拼成串做子串匹配（此前只匹配 ModelName，搜报错内容必然空手）；运行时日志只匹配 Message（无 Status/路径概念）。两侧同为「最新 N 条窗口内检索」（op 500 / runtime 300），超窗口历史条目不召回；无命中统一落 `diagnostics.noMatchLogs` 占位。状态 chips 只作用于操作日志（运行时日志 Level 恒为 info），运行时子 tab 下点击仅更新选中态、**不回落拉 op 列表**（避免白跑一次 GetImportLogs）。placeholder 因此改为「搜索日志内容...」（key 未改名，值在 `src/locales/*.ts`）。
- **single-bench 走结构化出口，不再正则解析中文文案**（ADR-262 D1，2026-09-17 切片 1）：前端 `perf-single-bench.ts` 传 `--format json` 并消费 `resp.data`（`SingleBenchPayload`，字段与 `go/cli/bench_concurrent.go|singleBenchJSON` 逐字对齐）；Go 侧 `ctx.SetResult(&output)` + `AttachSidecar`（ADR-200 D5）让桥的 data 承载对象本体，`output` 只作「复制原文」。**total 双口径**：`total_ms` = N 次迭代累计墙钟，`per_iteration_ms` = 单次平均——旧 UI 拿累计当单次展示（「6ms 谁信」的机制性来源之一）。阶段分级（bottleneck / warn / slow / ok）由 Go `stageStatus` 单一口径给出（阈值 100/50/10ms 只在 Go），前端只做 emoji/配色映射，不得自算阈值；`stagesToJSON` 改两趟识别唯一最慢阶段（旧实现可产出多个 `bottleneck=true`）。Go 侧 `hints` 仍是中文散文，未 i18n 前不上 UI（结构化保留供 AI 消费）。契约由 `go/cli/bench_internal_test.go` 锁字段名 + sidecar 注入。
- **性能报告带 identity 身份块**（ADR-262 D2，2026-09-17）：`go/cli/perf_identity.go|buildPerfIdentity` 产出 `{rtype, rtype_source, rtype_label, form, filesRoot, relPath, absPath}`，`single-bench`（`runSingleBenchJSON`）与 `benchmark`（`perf.go|runBenchIterations`）都填。判定**复用** `classifyForScan` 三段口径（目录归属 > 扩展名 > 容器兜底，`flow.go`），不另立类型表：`rtype_source` ∈ location / extension / container 说明「凭什么判成这个类型」；`form` ∈ dir / file 由 `registry.IsYsmEntryJSON(base)` 派生（打包形态不可能以 ysm.json 结尾）。立因：旧的 `format`（YSM/PMX/…）是 `detectModelFormat` 扩展名表派生的展示标签，推不出归属（`.zip` 被 14 类型声明、MMD 子类型共享 `.vpd`/`.vmd`），且载荷只有绝对路径 → 换机器后测试/AI 无法回溯识别。**测试只断言 `rtype` + `relPath`，不断言 `absPath`**（`bench_internal_test.go|TestBuildPerfIdentity_Sources` 覆盖三段来源）。
- **目录式模型 = `<dir>/ysm.json`，入口单点归一化**（ADR-262 D7，2026-09-17 切片 C）：目录形态**不是散的**——`scanner.go` 把 ysm.json 条目的 `Path` 保持文件路径、`Name` 取父目录名，`fileops`/`avatar`/`importer`/`app_model` 全用 `registry.IsYsmEntryJSON` 判定，所以新功能**不需要**各自实现目录分支。唯一缺口在 perf 入口：`resolveBenchModelTarget`（`perf_identity.go`）把目录折叠为 `<dir>/ysm.json`，经 `perf.go|resolveTargetModel` 供 single-bench 与 perf-snapshot 共用；传目录曾直接 ① 读盘失败（`os.ReadFile(目录)`）+ 失败被吞 → 载荷全绿。目录内无 ysm.json 时明确报 param 错误，不静默降级。端到端锁在 `go/cli/bench_dirform_test.go`（复用 `tests/fixtures/ysm/shen-fengling` 极简目录样本，ADR-054）。
- **阶段失败优先于耗时分级**（ADR-262 D8，2026-09-17）：`singleBenchStage.Failed` 独立成字段，`stagesToJSON` 中 `failed` 覆盖 `stageStatus(ms)`（失败常为 0ms，只按 ms 分级会被判 `ok`）；`avgBenchStages` 保留 `Notes`（首个非空）/`Bytes`（平均）/`Failed`（或），原实现只留 Duration → 失败原因在到达载荷前就丢了。前端 `STAGE_STATUS_META.failed = ❌ + perf-bar-danger`。另修 `detectModelFormat(".../ysm.json")` 返回 `JSON` 与 `identity.rtype=ysm` 打架 → 现按 `IsYsmEntryJSON` 归 `YSM`；目录式 `size_bytes` 记 0（ysm.json 只是清单一角，模型体量看 ④⑤ 阶段），① 阶段名在目录形态下如实标「① 清单读取」。
- ⚠️ **已被取代（2026-09-18，ADR-262 D3 修订）**：下文两条是**当时的事实记录**——`--all-types`、`--top-largest`、`scanTargetsGrouped`、`scanTopLargestTargets`、`pickCliAnalyzable` 均已退役，现行面是 `--target` × `--order` × `--max-models`（见下方「目标集 Go 半：一个枚举 + 一个排序 + 薄 selector」）。保留原文是因为其中「体量口径」「发现白名单 ≠ 可分析白名单」「`expected_stages` 运行期自检」等**判据**仍然有效，只有 flag 名与函数名过期。
- **类型矩阵 `--rtype` / `--all-types`**（ADR-262 D3，2026-09-17 切片 C）：`go/cli/perf_targets.go` 提供目标集解析——`scanBenchTargets`（单类型/默认可分析类型）与 `scanTargetsGrouped`（按类型归并，供 `--all-types`），发现权复用 `scanner.ScanEntries`（**发现权单点**）、类型判定复用 `classifyForScan`、类型与组内路径均**字典序**（Walk 顺序依文件系统而变，测试/AI 断言需可复现）。载荷 `{spec:{rtype,all_types,max_models,iterations,analyzed,unsupported,cli_analyzable,types[]}, models:[单模型载荷…]}`，与 `--model` 互斥、仅 `--format json`（text 模式明确拒绝而非静默降级）。~~**样本清单 = `perfTypeManifest`（Go 表）**：登记 `{cli_analyzable, expected_stages, note}`，`cliAnalyzable()` 未登记即不可分析~~（⚠️ 2026-09-21 订正：`cli_analyzable` 已迁 `resource_types.json` 的 `cliAnalyzable` 声明，`perfTypeManifest` 只留 `{expected_stages, note}`；见下方「可分析性事实源迁入 resource_types.json」）；**发现白名单 ≠ 可分析白名单**——PMX/PMD/VRM/FBX/GLTF 的解析器只在前端 3D adapter，CLI 拿到是空模型 → 这类类型在矩阵里**只出身份、`stages` 为空**并附解释性 hint，绝不拿空模型阶段数据冒充实测。清单的 `expected_stages` 是**运行期自检依据**：实际阶段链长度不符即置 `types[].stage_mismatch`（如 MMD 缺 ④⑤⑥）。`scanFirstModel` 同时补认目录式入口（`IsYsmEntryJSON`），纯解包目录仓库不再「未找到模型」。测试 `go/cli/bench_matrix_test.go`（fixtures 跑 2 个真实目录样本 + 不可分析类型不伪造 + 清单一致性 + text/互斥拒绝）。
- ⚠️ **已被取代**：`--top-largest N` ≡ 现行 `--target repo --order size --max-models N`（逐字等价，已用换 flag 前的黄金输出核对）；`scanTopLargestTargets` 归位到 `repoPerfTargets`。
- **全库前 N 大 `--top-largest N`**（ADR-262 D3 第三种目标集，2026-09-18）：`perf_targets.go|scanTopLargestTargets` 扫全库 → 每条算**体量** → 体量降序、**同体量路径升序**（ADR 未定义 tie-break，此处补定并回显；Walk 顺序不可依赖）→ 取前 N。**体量口径是这功能的全部要害**：`scanner` 给目录式模型的 `ModelEntry.Size` 是入口清单 `ysm.json` 本身（fixture 实测 115B），按它排名 = 「按入口文件大小找最大的模型」，会把最大的解包模型排到最后——故 `targetFootprint` 对目录式取 `fsutil.DirSize(<dir>)`、其余取 `e.Size`，口径 token `spec.size_source="dir_total"` 回显；`fsutil.DirSize` 是目录占用的**唯一出口**（`recycle.dirSize` 原包私有实现已收敛过去，同一语义不留两份）。**候选池是全库**（含 CLI 不可分析类型）：问的是「最大的模型是谁」，PMX 恰好最大时静默剔掉只会得到一份无人解释的空报告 → 入选后由既有 `identity_only` 路径标 `unsupported`。**排名依据必须可见**：`models[i].footprint_bytes` 回填（`size_bytes` 在目录式下是 0，只给规则不给数值读者无法复核「凭什么排第一」），`models[]` 严格按**排名顺序**（前 N 大的意义就在「谁最大」，按类型归并会丢），`types[].found` 仍是**全库未截断**总数（「跑了 2 个 / 一共 5 个」）。三张目标集共用一条采集路径 `collectBenchTarget`（可分析 → 真跑 + 核阶段链；不可分析 → 只出身份），差异只在选谁/什么顺序。守卫：与 `--model`/`--rtype`/`--all-types` 互斥、与 `--max-models` 互斥（**显式传入才判**，`explicitFlagSet` 泛化自 `explicitMatrixBaselineFlags`，比对默认值精确）、仅 `--format json`、拒基准参数。测试 `go/cli/bench_top_largest_test.go`（**判别性命名**：`z_big` 目录式 vs `a_small` 目录式，按占用与按清单大小序**相反**——退回 `e.Size` 立刻红，已反向验证 + tie-break/cap/全库池/载荷形状/排序一致/互斥守卫）；`go/fsutil/dirsize_test.go`（递归合计 / 单文件 / 不存在报错 / 空目录）。
- **目标集 Go 半：一个枚举 + 一个排序 + 薄 selector（`perf_target_set.go`，ADR-262 D3 修订，2026-09-18）**：旧面的债不止在参数形状上——`scanBenchTargets` / `scanTargetsGrouped` / `scanTopLargestTargets` 是**三份并行实现**，各自 `scanner.ScanEntries` + `classifyForScan` 把仓库扫一遍。现收敛为一组原语：`collectPerfTargets(filesRoot) ([]perfTarget, map[string]int)`（**唯一枚举**：全库候选池 + 逐类型**未截断**总数，服务 `types[].found`「一共有几条」）/ `orderPerfTargets(ts, order)`（**唯一排序**：`path` 字典序；`size` 体量降序 + 同体量路径升序，并**把体量固化进 `perfTarget.Footprint`**——排序键与回显值同源，回读会二次统计、目录一变即自相矛盾）/ `groupPerfTargets`（矩阵口径按类型切分，组内体量随 `Footprints` 带出）/ `capFlat`（扁平上限；**`0` = 未设上限**，不是取 0 条）/ `filterAnalyzable`（**命令能力过滤**）/ `pathsOf` / `repoPerfTargets(filesRoot, order, maxModels)`。**统一规则一条**：`--max-models` 的单位 = `--target` 的展开单位（`model`=单条且**显式传上限即报错**，不静默吞参；`rtype`=该类型 N 条、`all`=每类型各 N 条、`repo`=全库扁平 N 条）——`repo` 与 `all` **必须分开**：前者全库扁平（前 N 大即此形态），后者矩阵口径（每类各取 N，类型间可比），共用一个取值会互相踩。**过滤权归命令，不归 selector**：`order=size` 只产出有序候选池，可分析性由命令能力决定——single-bench 的 repo 池含不可分析类型并标 `unsupported`（全库池），`concurrent-bench` 必须 `filterAnalyzable` **且在截断之前**（否则「N 个可分析模型」变成「前 N 个里恰好可分析的几个」）；同一 selector 在不同命令上过滤不同，正说明「选与排序」与「过滤与上限」是两层职责。**Selector 四值而非三值**：`all`（每类各 N）与 `repo`（全库扁平）是两种真实口径，旧面用 `--all-types` 与 `--top-largest` 两个 flag 各表一支，正是它们共用 `all` 会互相踩的证据。**等价性有实证**：换 flag **之前**抓下 4 份黄金输出（`--top-largest 2` / `--all-types --max-models 2` / `--rtype ysm --max-models 2` / `concurrent-bench --workers 2 --max-models 3`），换后逐字核对**选中模型序列 + 逐条体量**（并发只比选中集合，耗时是真实墙钟）→ 4/4 等价；映射：`--top-largest N` ≡ `--target repo --order size --max-models N`、`--all-types --max-models N` ≡ `--target all --order path --max-models N`、`--rtype X` ≡ `--target rtype --rtype X --max-models N`（`--order` 缺省 `path`）。**新能力随正交性免费**：`--target all --order size --max-models N` = 「每类最重的 N 个」、`--target repo --order path` = 全库前 N 条（旧面两条都表达不出，因为排序与条数被焊死在一个 flag 里）。**两处退役**（本次切片自己造的第二种路径，实测在生产代码里已无调用方）：`pickCliAnalyzable(entries)` 归位到 `filterAnalyzable([]perfTarget)`；`scanTopLargestTargets(filesRoot, n)` 归位到 `repoPerfTargets(filesRoot, order, n)`——**同一个组合同时服务生产与测试**，否则测试打具名函数、生产直接拼原语，测试便证明不了生产在跑什么。测试 `go/cli/perf_target_knobs_test.go`（校验矩阵 11 行 / 显式性判定 / 路径序确定性 / 体量序 + 同体量 tie-break + 体量固化 + **不改动入参** / 每类型上限与未截断 `Found` / 扁平上限 0 语义 / 能力过滤）、`bench_matrix_test.go`、`bench_top_largest_test.go`（改打 `repoPerfTargets`，断言强度未降：体量递减、排名顺序、全库池含不可分析类型、`found` 未截断）。
- **gui-flow 实测 / 估算分离 + 「能测的不要估」**（ADR-262 D2/D8，2026-09-17）：`guiFlowStageItem` 增 `kind`（measured/estimated）、`estimated_ms`、`note`，`guiFlowStructured` 增顶层 `estimated_ms` 合计；`total_ms` 语义 = **实测墙钟**，估算**不计入**。⑤ 数据准备 = **实测** JSON 序列化（载荷字节数 `len(json.Marshal(model))` + 实测耗时）+ 仅传输时间按 `ipcAssumedBytesPerSec`（50MB/s）假设外推进 `estimated_ms`（`note` 同时说明「实测了什么/假设了什么」）；⑥ 渲染预估 = `kind=estimated`、`ms=0`（无实测工作量）+ 首帧公式区间中值进 `estimated_ms` + `note` 写公式。**能测的不要估**：只有 CLI 观测不到的环节（Wails IPC 传输时间）才允许估算；single-bench ⑥ 的 IPC 字节数同样从 `(几何+纹理)*4/3` 估算改为实测 `len(json.Marshal)`，随之删除失去唯一消费者的 `estimateTextureSize`。文本报告标 `[估算]` 并单列「其中估算 X ms（不计入总耗时）」；前端 `perf-gui-flow.ts` 渲染 `估算` 角标 + 「实测 + 估算」分列 + 估算单独一行（i18n key `diagnostics.perfEstimated` / `perfEstimatedHint` / `perfEstimatedTotal`，CSS `.perf-gui-est`）。**同一工作不重复计时**：③⑤⑥ 曾各调一次 `AnalyzeBedrockModel`（同一解析计 3 次），现 ③ 分析一次传模型给 ⑤⑥。`estimated_ms` 用**纳秒精度**换算——`Microseconds()` 截断会让亚毫秒估算恒为 0 并被 `omitempty` 整个吞掉。测试 `go/cli/flow_estimated_test.go`（计数桩锁「只分析一次」+ 估算/实测分离 + 合计契约）与 `go/cli/bench_serialize_measured_test.go`（⑥ 字节数 = 实测序列化长度）。
- **目标集三旋钮前端接入（`--target` × `--order` × `--max-models`）**（ADR-262 D3 修订，2026-09-18，取代本卡此前的「类型矩阵 + 前 N 大」四态派发）：单模型 tab 的目标集选择器 `#diag-perf-rtype`（**testid 同名，e2e 契约不动**）现在承载 selector——`""` = 单模型（按路径）、`__all__`（`PERF_TARGET_ALL`）= 全部类型、`__repo__`（`PERF_TARGET_REPO`）= 全库扁平、其余即 registry 类型 id → rtype；选项由 `perf-matrix-render.ts|populatePerfTargetOptions(root, selectId, includeModel)` 从 **`resourceTypesById`（同步直读 `resource_types.json`，ADR-269 D3④；原 `loadResourceRegistry()` 异步 RPC 旁路已删）** 填充，并**只列 `cliAnalyzable=true` 的类型**（2026-09-21 起；CLI 无解析链路的类型不再渲染——选了必报 `unsupported`。见下方「可分析性事实源迁入 resource_types.json」）（**类型表单一事实源是 Go/`resource_types.json`，前端不写死**；注册表不可用时**不动 DOM**，保留 tpl 静态首项回落，而不是把「加载失败」伪装成「没有类型」；重填前记住当前值，异步到达不重置用户已选目标集）。**排序独立成控件** `#diag-perf-order`（path/size）：它是与「选谁」正交的真实维度，故不塞进选择器哨兵（旧面 `--top-largest` 把 order 与 limit 焊死正是这次要拆的）——选项文案收敛在 `tpl.ts|perfOrderOptionsHTML()`，single / conc 两个控制条共用一份。**上限控件 `#diag-perf-max` 的标签恒为「取样上限」**（`syncPerfCountLabel` 已删）：单位随 selector 变（rtype=该类型 N 条 / all=每类各 N 条 / repo=全库 N 条）这件事**只进 `title`**（`perfMaxModelsHint`）——「一个数字控件两种含义、标签跟着模式改义」正是本次清掉的账。参数组装（`singleBenchReadMode`）：`model` → `{model, iterations, format}`（+基准三件套；**绝不带 `max-models`**——Go 对 target=model 显式传上限直接报错，不静默吞参）；`rtype/all/repo` → `{target, order, "max-models", iterations, format}`（rtype 另带 `--rtype`）。基准三件套改按 target 判定禁用（`parsePerfTargetValue(...).target !== "model"`）。**并发 tab 复用同一套**：`#diag-perf-conc-target`（默认 repo、`includeModel=false`——该 tab 没有路径输入框）/`#diag-perf-conc-order`，共用 `populatePerfTargetOptions` / `parsePerfTargetValue` / `readPerfOrder`（不写第二份），提交 `{target, order, "max-models", workers, format}`。**载荷消费**：single-bench 走 `spec.{target, order, rtype?, size_source?, max_models}`；concurrent-bench 是**扁平**载荷（无 `spec` 包装），三旋钮是顶层字段与 `max_models` 并列；回显统一走 `perfTargetEchoHTML`（`目标集 X · 排序 Y · 上限 N`），**仅 `order=size`** 追加体量口径 token 的人话（`dir_total` → 「目录式按目录内容合计」）与逐条 `footprint_bytes` 徽标——**排序依据不可见 = 不可复核**；`order=path` 时 Go 不给这两个字段，前端凭空补一个就是误导。**诚实红线在展示层同样成立**：`cli_analyzable=false` 的类型显示「未采集」而**不是 0.00ms**。契约：`tests/test_cli_gui_flow_contract.ts` §3.7 锚定新 tag（target/order/size_source/max_models/footprint_bytes）并**反向断言** `all_types`/`top_largest`/`syncPerfCountLabel` 已不存在（残留即回归）；三语新键齐备且被引用、已死键（`perfRtype*`/`perfTopLargestEcho`）不得复活。测试：`perf-matrix.test.ts`（三目标集 `toEqual` 锁精确键集 / 切 order 改变提交参数 / model 模式不带 max-models / 回显只在 size 带口径 / 选项来自 registry / **标签三模式逐字相同**）+ `perf-concurrent.test.ts`（三旋钮组装 + size 口径回显）+ e2e `diagnostics.spec.ts`（`__repo__` + `diag-perf-order`，并用 `#diag-perf-max-label` 的正文与 title 断言「标签不改义」）。
- **阶段三要素补齐：`runtime` 归属 + 样本统计 `n`/`median`/`p95`**（ADR-262 D2，2026-09-17）：此前阶段只有 N 轮**均值**且无归属——ADR-262 §背景 #6 记的「无样本统计、无方差可言」+「Go / Rust / WASM / Three 耗时构成是黑箱」。**数据本已在手**（`runSingleBenchSamples` 一直保留全部原始样本），只是被 `avgBenchStages` 当场平均掉，故本次**不新增仪表**，只新增汇总：`collectStageStats(allStages)` 按阶段名归集 `msOf` 样本 → `benchStageStats{n, median_ms, p95_ms}`，经 `stagesToJSON(avg, allStages)`（签名新增第二参，5 处调用点同步；传 `nil` 的纯汇总路径**不产出 stats**，不伪造 `n=0`）。
  - **分位数口径 = 最近秩法**（`percentileNearestRank`，升序取 `ceil(p*n)-1` 号），非线性插值：默认只跑 3 轮，插值会产出「不存在的样本」（从未实测到的值），与「数字必须来自实测」冲突；最近秩保证结果必是某次真实样本，且对 `p` 单调 → **`p95 >= median` 对任意 n 恒成立**（ADR-262 D6 要的结构不变量）。`n=1` 退化但如实（median=p95=该唯一样本），故前端**仅在 `n>1` 时渲染分布**——展示单样本的 p95 等于把退化包装成分布，`n` 仍留在 tooltip 供追问。`n` 是**该阶段实际出现次数**（阶段可因失败提前返回而缺席某轮），不是迭代轮数。
  - **runtime 归属如实报，不为好看编造分层**：single-bench 全链路（`os.ReadFile` / `AnalyzeBedrockModel` / 校验 / 几何 / 纹理 / `json.Marshal` / 缓存）确实全在 Go，故 `runSingleModelBench` 出口统一打 `singleBenchRuntime = "go"`（不逐个 stage 字面量重复写，漏一个就是一个无归属阶段）。gui-flow 归属在**装配点**按「调了哪个阶段函数」打（`withRuntime`）：② 模型扫描取 `scanner.ScanBackend`（新增构建期常量——`rust_backend.go` = `"rust"` / `rust_backend_stub.go` = `"go"`），③④⑤ 为 `go`，⑥ 渲染预估归 `three`（它估的是 Three.js 首帧，**估算性质由 `kind=estimated` 承载**，二者不互相替代）。② 的归属是「Rust 扫描器收益可被度量」的落点；边界：`ScanBackend` 是**构建期事实**而非单次调用实际处理方——`rust_backend` 构建下 Rust 仍可能运行时不可用而静默回退 Go（`rust_backend.go` 返回 `handled=false`），报告口径以构建为准。**未采用**：给 `ScanEntriesWithHitCtx` 加「本次由谁处理」返回值——该函数多 return 点 + goto/缓存/单飞/重试逻辑，穿新返回值风险远大于收益。
  - 契约：`bench_internal_test.go|TestSingleBenchJSON_JSONShape` 字段锁增 `runtime`/`stats`/`n`/`median_ms`/`p95_ms`；`bench_stage_stats_test.go` 锁最近秩数学、`p95 >= median`、ragged 时 `n` 如实、runtime 在 `avgBenchStages` 聚合与出荷两段不丢、gui-flow 各阶段归属（②=`scanner.ScanBackend`、⑥=`three`）；`tests/test_cli_gui_flow_contract.ts` 新增 `SB_STAGE_FIELDS` 双端字段锚定；前端 `perf.test.ts` 锁徽标逐阶段与 `n=1` 不渲染分布。前端不重算任何判据：归属与分位数全由 Go 给出，i18n key `diagnostics.perfStageRuntimeHint` / `perfStageStats` / `perfStageStatsHint`，CSS 新增共用类 `.perf-rt-tag`（徽标）/`.perf-stats`（等宽数字）。
- **引擎对照前端接入（`perf-scan-bench.ts`，2026-09-18，ADR-262 D3 收尾）**：入口是单模型 tab 控制条尾部的按钮 `#diag-perf-scan-bench`，结果进**独立容器** `#diag-perf-scan-bench-out`——两个命令都整块 `innerHTML` 替换，与 single-bench 共用 `#diag-perf-single` 会互相冲掉结果。**迭代次数复用 `#diag-perf-iter`**（`singleBenchReadIterations` 由私有改 export）：同一语义「同一基准重复几次」共用控件即消灭第二个口径，不为一个数字新开输入框。**诚实红线全部映到界面**（Go 把「测到」与「没测到」分成两件事，前端必须原样映）：`used=false` 的引擎三列一律 `—`，**绝不显示 0.00ms**（0ms 会被读成「快到测不出」，与事实相反）；`entries` 同理不上屏（未采集时的 0 是「没扫」不是「扫到 0 条」）；`skipped>0` 明说「另有 N 次未计入样本」（默认构建 `rust.skipped=2`——请求了 Rust 却一次都没归它，静默丢弃等于把缓存命中当没发生）；`parity.comparable=false` 只说「无法比对」并走 `perf-sb-parity-warn`，**不画 ✅/❌**（单侧数据比的是空气）。分位数与原始样本一律用 Go 交出的值（前端不自算、不重排），原始样本进 `title`（抖动可见 = 可复核）。载荷守卫 `scanBenchParsePayload` 接受 `status=success|error`（Go 规律六：错误分支同样 `SetResult`，把已测出的数字丢掉只会让用户更看不懂），`engines` 缺席/非数组/元素非对象即拒（`.map` 会抛未捕获异常）；代际守卫走 `createLoadGuard()`（ADR-230）。`SCAN_BENCH_REASON_KEYS` 把 4 个原因 token 映人话，**未知 token 带上原文兜底**（绝不把 Go 的中文散文当默认文案上屏）。`scan-bench` 已进前端静态白名单 `backend/cli-allowlist.ts`（curated 子集 20→21）：该文件是 web 模式**唯一**判据、也是桌面端动态拉取失败时的兜底，漏了会表现为「桌面能跑、网页静默 `command_not_allowed`」。测试：`perf-scan-bench.test.ts`（7 条：默认/双端/无法比对/分叉明细/skipped/畸形载荷/web）+ e2e `diagnostics.spec.ts` 两条**真实载荷**（`SCAN_BENCH_REAL` 未采集面 / `SCAN_BENCH_RUST_REAL` 双端实测面）；红线做过反向验证——把未采集渲染回 `0.00ms` 后 e2e 立即红（断在三列 `—` 与「全页无 `0.00`」两处）。
- **「CLI 可分析模型」判定收编为单点**（ADR-262 D3 收口，2026-09-18）：ADR-262 记的「三张硬编码类型表」**数得少了**——审计发现同一问题「这个文件 CLI 能不能真分析」在 `go/cli` 里散在四处，各写各的扩展名白名单：① `bench_concurrent.go` 并发基准 `ext == ".ysm"`（且无命中时**退化为取任意条目**）；② `perf.go|scanFirstModel|allowedExts`（ADR 漏记的第 4 张）；③ `flow.go|scanSummaryByType` 首模型 `ext == ".ysm"`；④ `detectModelFormat`（属展示标签，另案）。而两个事实源**早已存在**：可分析性 = `cliAnalyzable`（`perf_targets.go` 单点出口；⚠️ 2026-09-21 起其**事实源**是 `resource_types.json` 的 `cliAnalyzable` 声明，不再是 `perfTypeManifest`——见下方「可分析性事实源迁入 resource_types.json」）、归属 = `classifyForScan`（三段口径）。本次只新增一个谓词把它们合起来：`cliAnalyzablePath(path, ext, reg)` + 从条目挑选的 `pickCliAnalyzable(entries)`——**不新建表，只删表**。
  - ⚠️ **这不只是 DRY，是诚实缺陷**：`scanFirstModel` 原白名单含 `.vrm/.gltf/.glb/.litematic`，而这些类型的解析器只在前端 3D adapter（CLI 拿到是空模型）；它的两个消费方 `perf.go|resolveTargetModel` 与 `health --bench` **直接把返回值喂进 `runSingleModelBench`** → 产出「空模型数据当实测」，直接违反 D3 与 D8。故 `perf_test.go|TestScanFirstModel` 原断言「跳过 .txt 命中 .vrm」是**锁住了缺陷**，本次就地改写为正确口径（不是等价重构，故必预改测试）。
  - `scanFirstModel` 现 = `scanBenchTargets(filesRoot, "", 1)[0]`：顺带得到路径字典序（原为 Walk 首命中，依文件系统而变→测试/AI 不可复现）、目录式入口 `<dir>/ysm.json` 由 scanner 折叠工序覆盖（不再需单独的 `IsYsmEntryJSON` 分支）、以及新的容器形态能力（ysm 目录下的 `.zip` 也算可分析）。**语义变化须知情**：发现权归 `scanner.ScanEntries` 后**继承其目录缓存**（TTL 内同目录复用，变更由 `InvalidatePath` 失效）——原直读 Walk 无缓存；命令级调用只调一次无实际影响，但测试必须先落盘再调用（故相关用例按场景各用独立 root）。
  - **已核查、判定为非类型表（不改）**：`bench_concurrent.go|collectTestFiles` 的 `case ".ysm", ".json", ".zip", ".7z"` 是**并发文件读取的取样集**（其契约由 `cli_test.go` 明确锁定「任意 .json 都算候选」——其集合与 registry 里 ysm 的扩展名重合只是巧合），改用 `cliAnalyzablePath` 会反而破坏它。**仍待办的展示层遗留**：`detectModelFormat`/`parseStageName`（扩展名→展示标签，非归属；`format` 字段已被 `identity.rtype_label` 取代，退役需同步载荷契约与前端回落，另案）。
  - 测试：`perf_cli_analyzable_test.go`（归属驱动真值表含 location 优先的 ysm `.zip` 与 mmd `.pmx` / 挑选保持扫描序 / 并发基准只含不可分析类型时**如实报错**而非跑空模型 / 首模型随清单与归属自动扩展）；`bench_matrix_test.go|TestScanFirstModel_DirForm` 与 `TestScanBenchTargets_DeterministicAndTyped` 无需改动即绿（它们本就走 scanBenchTargets，正是本次对齐的目标口径）。
- **gui-flow ④⑤⑥ 门控改为「有没有真分析出模型」**（ADR-262 D3/D8，2026-09-18，上一条牵出的缺陷）：`runGUIFlow` 原按 `ext != ".pmx" && ext != ".pmd"` 门控派生阶段，而 `runPhaseModelAnalyze` 只在 PMX/PMD 上短路。于是三类**空数据当实测**同时存在：① `--model x.vrm`（及 FBX/GLTF/litematic）→ ③ 报「❌ 分析失败」**但 ④⑤⑥ 照跑**，在空 `types.BedrockModel{}` 上产出三个阶段；② 损坏的 `.ysm` 同理——**按类型门控永远挡不住这一类**（类型判定会说「ysm 可分析」）；③ VRM 等连一句提示都没有（只有 PMX 有）。
  - 两处改动：**③ 的分派依据**由扩展名改为 `cliAnalyzablePath`（同一条单点谓词；PMX/PMD 保留专属人话点明 `@moeru/three-mmd`，其余类型统一告知「解析器只在前端 3D adapter」）——至此 `flow.go` 里最后一张扩展名表（`ext == ".pmx" || ext == ".pmd"`）消失；**④⑤⑥ 的门控**改为 `len(model.Bones) > 0`，即「真实产出」而非类型：它比类型谓词更强，同时覆盖「前端专属类型」与「解析失败/损坏」两种空数据来源，且不依赖任何名单。
  - 测试：`flow_analyze_gate_test.go`——不可分析类型**不得调 AnalyzeBedrockModel**（省一次必然失败的分析）且 ④⑤⑥ 全不产出；损坏模型时 ③ 如实标 ❌ 且 ④⑤⑥ 全不产出；**正向护栏**：真能分析时 ④⑤⑥ 必须照常产出（防「一刀切跳过」误伤好路径）。既有 `cli_test.go|TestGUIFlow_PmxTarget`（③ 提示 + 无 ④ + 不报「分析失败」）无需改动即绿。
- **基准判决入载荷 + 基准槽 + stdout 纯度**（ADR-262 D8/D1，2026-09-18）：退化门禁（`--baseline` / `--save-baseline` / `--threshold`）此前**只有 CLI 能用、GUI 用不了**，且两个消费者都拿不到东西——这就是背景缺陷 #2「永远没有好还是坏的判定」的机制：判决只活在 stdout 散文与 error 字符串里，载荷（`SetResult`）没有它，界面顶多转述一句「退化超过 50%」。
  - **纯搬运式拆分**：`compareSingleBenchBaseline` 原先「边遍历阶段边 `fmt.Println`，退化时返回 error」；现拆为 `evaluateBaseline`（**只算不说**，零 stdout 副作用，返回 `perfBaselineDiff`）与 `compareSingleBenchBaseline`（text 模式渲染人话）。判据（阈值 / **两层**噪声下限 / 六类判决 regressed·slower·ok·faster·new·noise）逐字沿用，`pre_push_gate` 记录的两侧断言无需改动。基准特性独立成文件 `go/cli/bench_baseline.go`。
  - **判决进载荷**：`singleBenchJSON.baseline = {saved_to?, diff?}`，`diff = {path, threshold_pct, noise_floor_ms, verdict, degraded, stages[{name, base_ms, now_ms, delta_pct, verdict}]}`——前端因此能逐阶段说「哪个慢了、慢了多少」，且 `base_ms`/`now_ms` 都给，前端**不重算**百分比。未用基准参数时连 `baseline` 键都不出现（`omitempty` 的诚实性：缺席就是缺席，不是 `{"diff":null}`）。
  - ⚠️ **顺带修掉 stdout 纯度缺陷（同一处代码的另一面）**：JSON 模式下 `compareSingleBenchBaseline` 把中文散文打在 JSON _后面_，`--format json --baseline` 的输出不再可 `json.Unmarshal`——与 `runSingleBenchJSON`「静默运行，输出结构化数据」的契约直接冲突。现 JSON 路径改走 `buildBaselineJSON`（装配载荷），人类文案只走 text 路径；**写入者也静默**（`saveBenchBaseline` 不再打印，「💾 基准已保存到」由 text 模式的 `applyBenchBaseline` 宣布）——端到端实证正是这条抓出来的：`--save-baseline` 时 JSON 后仍跟一行中文。基线：`ysm` 包的加载日志走 **stderr**，验证 `--format json` 纯度时必须分离 1>/2>，否则会把它当成 stdout 污染（`2>&1` 会把 `2026/...` 混进来，`JSON.parse` 报 `position 4`）。
  - **「基准放哪里」的策略留在 Go**：哨兵值 `default`（`--baseline default` / `--save-baseline default`）解析到标准基准槽 `os.UserConfigDir()/YSM-Model-Manager/perf-baseline.json`（与 `avatar`/`texture_cache` 同根，ADR-046 P2，避免多套基准目录分叉）；平台配置根不可用时**报错而非静默**。前端只说「要基准」，不编路径——与「类型判定唯一事实源在 Go」同一条职责红线。CI/高级用法仍可传显式路径。
  - **矩阵模式拒绝基准参数**：基准是**单模型**概念，而 `--rtype`/`--all-types` 的载荷是 `models[]`——原先这三个参数被**静默吞掉**（用户以为在跟基准比，其实没有）。现用 `fs.Visit` 精确判断「显式传入」并报 param 错误（对比默认值更准：用户可能手写同一个数）。
  - 测试：`go/cli/bench_baseline_test.go`。判据数学用**合成 stages** 锁（确定性）；集成用例只锁「stdout 纯 JSON」与「判决装配进载荷」——**不锁判决取值**，因为 fake app 的真实采集只耗几十微秒、正确落进 1ms 噪声下限判 noise（那是判据在起作用），且自对比在整包负载下可能偶发误判（既有 flake，见 `pre_push_gate`）。⚠️ **本仓测试坑**：`captureOutput` 接管的是**进程级** stdout，并行用例的打印会漏进另一用例的捕获 → 「单跑必绿、并跑偶红」；故凡抓/写 stdout 的用例一律**不并行**（Go 顶层并行用例在串行用例结束后才启动，串行即 stdout 独占），覆盖包级变量（`defaultBaselinePath`）的用例同理。
- **⚠️ 独立复核抓到的真缺陷：对比失败不得吞掉记录动作**（2026-09-18，`710f4cc72` 的补丁）。审核子代理实测：`--baseline <不存在> --save-baseline <文件>` → **退出 1 且保存文件根本没生成**，stderr 还指引用户「请先用 --save-baseline 记录一次基准」——而他刚刚点过。
  - 根因：`buildBaselineJSON` / `applyBenchBaseline` 在 `evaluateBaseline` 出错时**早退**（`return nil, err`），后面的 save 分支永不执行。而 GUI 新入口最自然的首次用法正是**两个勾同时打上**（记录 + 对比），此刻基准文件本来就不存在 → 首次必踩。属本仓诚实红线「参数被吞 = 不诚实」的**内部违例**：参数没被拒，而是被静默丢弃（比报错更坏——报错至少说明发生了什么）。
  - 修法：只记 `compareErr` 不早退，继续 save；`reconcileBaselineErrors` 在「记录确实发生」时把说明改成「（本次已记录新基准到 X，下次运行即可对比）」——**不能让错误文案指引用户去做他刚做完的事**。顺序仍是先比后存（先比旧基准再覆盖）。**规律**：`A 失败则跳过 B` 在「A、B 是同一用户意图的两半」时是错的——首次路径天然满足「A 必然失败」，于是 B 永不发生。
  - ⚠️ **包错误的二次包装陷阱**：`ErrRuntime.Error()` 自带「运行时错误: 」前缀，`newRuntimeErrf("%v", errRuntime)` 会打成「运行时错误: 运行时错误: …」（实测）。要在新文案里引用内层原因，必须先 `errors.Unwrap` 一层（对本包 `ErrParam`/`ErrRuntime` 都适用）。凡 `fmt.Errorf`/`newXxxErrf` 拼接既有 error 的地方都该按这条自查。
- **契约断言的强度：断言「组装点」而非字段名子串**（2026-09-18，同一次复核）。原断言 `singleCode.includes('"save-baseline"')` 想守「GUI 真的会传参」，但类型声明 `"save-baseline"?: BaselineSlot;` 本身就含该子串——**把整个组装分支删掉，门禁照样绿**（典型空转门禁）。改为正则锚定赋值形态（`/\[\s*"save-baseline"\s*\]\s*=/`、`/\.baseline\s*=\s*"default"/`、`/\.threshold\s*=/`），并**用「删掉组装点后断言必转红」实证非空转**（一次性脚本核验后删除）。**规律**：凡语义为「X 真的发生了」的门禁，必须能指出「把它删掉就变红」的反例，否则它只是在重复声明。
- **基准的 GUI 入口与判决渲染**（ADR-262 D8，2026-09-18，同一切片的前端半）：单模型 tab 控制条新增「记录基准 / 对比基准 / 退化阈值 %」三件套（`#diag-perf-baseline-save|compare|th`，testid 同名并登记 `VIEW_TESTIDS`）；`perf-single-bench.ts|singleBenchReadMode` 只在**单模型**模式读它们，勾了就传 `--save-baseline default` / `--baseline default` / `--threshold N`——**值传哨兵 `default`，路径由 Go 解析**（与「类型判定唯一事实源在 Go」同一条职责红线：前端不编文件路径）。
  - **⚠️ 载荷守卫必须放宽 `status === "success"`**（本切片最容易踩空的一步）：基准判「退化」时 Go 返回 **error 状态**，但载荷已随 `SetResult` 交出（规律六）。而 `singleBenchParsePayload` 原本第一句就是 `if (resp.status !== "success") return null;`——判决会被**整块丢弃**，UI 上「退化」只剩一句错误文案，「永远没有好还是坏的判定」等于没修。现改为「形状校验通过即可消费」，并在 status=error 时**额外叠加**错误横幅（`out.innerHTML = 柱状图 + banner`）——数字是实测的、判决是结构化的、错误原因是必要的，三者都要给。为此把 `perf-common.ts|errorHTML` 导出（`setErrorResp` 是整块替换 innerHTML，无法叠加）。
  - **判决渲染只做映射，不重算**（同 `STAGE_STATUS_META` 口径）：`BASELINE_VERDICT_META` 把 Go 的六类 token（regressed/slower/ok/faster/noise/new）映射成 emoji + 既有配色类；`base_ms`/`now_ms`/`delta_pct` 全部**直接展示**，前端不做除法、不判阈值。`noise`/`new` 的 `delta_pct` 在 Go 侧恒为 0（不编造无意义百分比），故这两类**改说原因**（「噪声区间，不判退化」/「基准里没有该阶段」）而非显示 `+0.0%`。`saved_to` 正文只说「基准已记录」，长路径进 `title` 不占版面。未用基准参数时 `baseline` 键缺席 → 整个基准块零存在感（不渲染空框）。
  - **矩阵模式禁用而非吞参**：`perf.ts` 在 `#diag-perf-rtype` 的 `change` 上同步 `syncPerfBaselineControls`（切到类型/全部类型即 `disabled` 三件套）——Go 侧对矩阵模式的基准参数是**明确拒绝**的，「被禁用」比「勾了却没生效」诚实。
  - 测试：`perf.test.ts` 新增 7 例（参数只组装勾选项且传哨兵 / 退化时结果+判决+错误横幅三者并存 / 未用基准零元素 / 只保存不回显路径 / 矩阵模式禁用且不传参 / 畸形基准载荷被守卫拒绝 / `iterations=0` 全零空载荷被拒）；契约测试加第 5 条断言面（基准字段双端锚定 + **前端真的传** `--baseline`/`--save-baseline`——只声明接口不传参 = 功能不可达）；e2e `diagnostics.spec.ts` 断言三件套就位 + 切矩阵即禁用。**e2e 抓到一个静态门禁抓不到的缺陷**：`perfBaselineHint` 带 `{noise}` 占位符却在模板期（拿不到载荷）被 `tpl.ts` 使用，页面残留字面量 `{noise}` 并触发 i18n 运行时告警——占位符键只允许在能拿到数据的渲染路径用，模板期文案另立无占位符键（`perfBaselineHint` vs `perfBaselineJudgeHint`）。
- **concurrent-bench 结构化出口 + GUI tab**（ADR-262 D1/D5，2026-09-18）：`concurrent-bench` 此前**只有文本**——没有 `--format`、没有 ParamSpec 登记（桥因此走 legacy 告警路径）、GUI 里连入口都没有，而「串行 vs 并行的加速比」正是 D5 主动压测的第一手数据。现新增 `go/cli/bench_concurrent_json.go|concurrentBenchJSON`（`{workers, max_models, model_count, models[perfIdentity], serial{total_ms, per_model_ms}, parallel[{workers, total_ms, speedup, verdict}], file_read?, hints?}` + ADR-200 D5 sidecar），`--format json` 时 `runConcurrentBenchJSON` 静默采集 + `SetResult`；**text 路径仍是流式打印**（每阶段跑完即出结果，长跑时看得见进度），两条线共用同一批底层函数（`benchSerialAnalyze`/`benchParallelAnalyze`/`benchSerialRead`/`benchParallelRead`/`collectTestFiles`）与同一份判据（`concurrentWorkerCounts`/`concurrentSpeedVerdict`/`concurrentVerdictLabel`/`concurrentHints`）。**断言加速比判决必须单点**：text 的「优秀/良好/一般/无提升」与载荷的 `verdict` token（excellent/good/fair/none）都出自 `concurrentSpeedVerdict` 一处阈值，前端只做 emoji/配色/i18n 映射（同 `stageStatus` 口径）。
  - **重构 text 输出必须实证「逐字未变」**：用 `git worktree add <tmp> HEAD` 检出旧版、补上 `go:embed` 需要的构建产物（`frontend/dist`、`ysm-updater-helper.exe`——worktree 里缺这两样 `go build` 直接失败），两版二进制同跑同一夹具，输出**把数字归一化后逐行 diff**。这一步当场抓出两个旧缺陷：`并行(4 workers): 0.00ms` 与 `加速比: +Infx`——根因都是 `float64(d.Microseconds())/1000`（亚毫秒截断成 0）与除零。故本命令的耗时换算统一改走 `durationMs`（纳秒精度，`msOf` 的重载语义是 `singleBenchStage`，两者不可混用），并给 Phase 3 加速比加除零守卫；截断还会把「并行快得多」显示成 `0.0x 🔴 无提升`——**截断制造的不只是难看的数字，是假结论**。
  - **档位去重 / 越界**：原 `{2,4,*workers}` 在目标值为 2/4 时把同一档位测两遍（报告出现两行同名「并行(4 workers)」，新载荷里会带两条 `workers: 4`），且 `--workers 1` 时竟跑 2 个 worker。现 `concurrentWorkerCounts` 取 `{2,4,目标值}` 并集（≤目标值、去重），实测 1/2/4/5 分别得 1/1/2/3 档。
  - **测量字段禁 `omitempty`**：`per_model_ms` 与 single-bench 的 `total_ms` 同属实测值，`omitempty` 会把「测到 0」和「没测」合并（ADR-262 D2 的 `estimated_ms` 被整个吞掉就是这坑）；缺席语义只留给**整块**没测的东西（`file_read` 无候选文件时整块不出现）。
  - **测试夹具要「量得到」**：假 app 无耗时 + 单文件 512KB 读，会让 `SerialMs/ParallelMs` 在时钟粒度下随机为 0（单跑 5 次里 2 次为 0），把断言变成测时钟——改用 `benchTimedFakeApp`（每次分析 sleep 200µs）+ 30 × 512KB（≈15MB，恰为 `benchFileLimit` 上限）后稳定。契约：`go/cli/bench_concurrent_json_test.go`（stdout 纯度 + 字段齐备 + 档位不重复不越界 + 判决 token 域 + text 模式 `ctx.result` 保持 nil + 无候选时 `file_read` 缺席）。
  - **前端半**：新 tab `conc`（`tpl.ts` 的 `renderTabs` 列表 + `VIEW_TESTIDS` 三项），`perf-concurrent.ts` 传 `{workers, "max-models", format:"json"}` 并消费载荷——`concParsePayload` 显式校验形状（`serial.total_ms` 是 number、`parallel` 非空数组且每项有 `workers`），**不要求 `status === "success"`**（规律六：判决为「无提升」时 Go 返回 error 但载荷是实测的）；判决 token 用**字面量联合类型**当 i18n 键（`ConcVerdictKey`），未知 token 按最保守的 `none` 渲染（不假装优秀）。`hints` 是未 i18n 的中文散文 → 结构化保留但**不在界面渲染**（与 single-bench 同口径）。契约测试新增第 6 条断言面（Go json tag ↔ TS 接口 ↔ 判决 token 域双端一致 + `--max-models`/`format=json` 组装点 + 反文本解析），e2e 断言 tab 真实可见且初始为空容器（不预置假数据）。
- **基准不可用的结构化原因 + 本地化横幅（D-7）**（2026-09-18，基准切片收尾）：`--baseline` 指向的文件不存在/损坏/读不了时，原因原本**只以中文散文**出现在 error 串里——`未找到基准文件 C:\Users\…\perf-baseline.json：请先用 --save-baseline 记录一次基准`。GUI 原样上屏 → ① 英文/日文界面冒出未翻译中文；② 泄露本机绝对路径；③ 把 CLI 口令当给 GUI 用户的指引。修法：载荷加 `baseline.error`（token：missing / unreadable / invalid / slot_unavailable）与 `baseline.detail`（中文细节含路径），前端 `BASELINE_ERR_KEYS` 映射 token → i18n 句，`detail` **只进 title**（追问问得到，版面不泄露）。
  - **token 只说「为什么不可用」，不说「本次是否已记录」**：后者由既有 `saved_to` 承载，前端把两个事实组合成句子（`perfBaselineErrSavedNote`）。同一事实存两份必然漂移——D-1 的教训（首次「记录+对比」时对比必然失败）正落在这条上：GUI 现在说「还没有记录过基准（本次已记录新基准，下次运行即可对比）」，不再指引用户去做他刚做完的事。
  - **包装层与二次前缀陷阱**：新增 `baselineUnavailable{Token, Err}`，其 `Unwrap()` 让 `ExitCodeOf` 的 errors.As 与文本观感（`运行时错误: ` 前缀、退出码 1）逐字不变——D-7 只**增加**出口，不改 CLI。连带把 `reconcileBaselineErrors` 的 `errors.Unwrap` 一层换成 `unwrapCliPrefix`（errors.As）：多一层包装后原写法只会拿到 `*ErrRuntime` 本身，「运行时错误: 运行时错误: …」立刻复发（本次实测抓回）。
  - **契约与测试**：`test_cli_gui_flow_contract.ts` 第 7 条断言面——Go json tag（error/detail）↔ TS 接口、四个 token 双端一致、**每个 i18n 键都要在 zh-CN/en/ja 三语有落点且真被映射使用**（加了键却漏接线 = 界面显示 key 名）。Go：`TestBuildBaselineJSON_UnavailableCarriesToken`（四类原因各一个 token + detail 含路径 + 没比成不给判决）、`TestReconcileBaselineErrors_NoDoublePrefix`、`TestEvaluateBaseline_TextProseUnchanged`；前端 `perf.test.ts` 新增 4 例（本地化正文 + 中文散文/绝对路径/CLI 口令都不上屏 + detail 进 title + 结果本体照旧渲染 / 已记录时同句说明 / 未知 token 走通用兜底而非中文散文 / 非基准类错误仍转述 Go 原话）。真 CLI 实证：`--format json --baseline <缺失>` → `exit=1`、stdout 纯 JSON 且 `baseline.error=missing`、`iterations`/`total_ms` 照旧；`--baseline <缺失> --save-baseline <文件>` → token + `saved_to` 并存且文件真的写出（D-1 不回归）。
- **性能面板真实渲染断言（ADR-262 D5，2026-09-18）**：性能面板的渲染断言此前只在 vitest（jsdom + mock `executeCLI`）——jsdom 不跑布局/CSS，「元素被 display:none 吞掉」「i18n 占位符原样上屏」这类缺陷全都漏网。新增 `frontend/e2e/perf-fixtures.ts`（**真实 CLI 输出**，只用 `go run . --cli --files-root tests/fixtures/ysm … --format json` 采一遍，裁掉界面不读的键，数值原样）+ `diagnostics.spec.ts` 四例：阶段条/基准判决行按载荷成行、红条数 = 载荷里 bottleneck/failed 阶段数（映射一致，前端不重算阈值）、并发档位与加速比取 Go 给的数字、D-7 本地化横幅（按**界面当前语言**断言，`detail` 只进 title）、以及通用的 `/\{[a-z_]+\}/` 占位符残留守卫。
  - **两条只在真实浏览器踩得到的坑**（helper 注释里钉住）：① mock CLI 必须**页面加载后**注入（`page.evaluate` 改 `window.go.main.App.ExecuteCLI`）——fixture 的 mock bridge 脚本会整体重建 `window.go`，用 `addInitScript` 抢跑会被覆盖，`ExecuteCLI` 退回 undefined，`parseCLIResponse` 拿 undefined 去 `.slice` 抛一句无信息量的 TypeError；② mock 必须给**完整响应信封** `{status, command, data}`，裸载荷会被判「CLI 响应 status 非字符串」——载荷正确但被信封挡在门外，界面同样空白（两次都不是产品缺陷，而是测试夹具踩坑，值得记）。
  - **e2e 立刻抓出一个真缺陷**：读几百字节时 `time.Since` 常返回 0（时钟粒度），`float64(bytes)/0s` 把 ① 阶段文案打成「✅ 115B, **+Inf MB/s**」——GUI 上真的显示了 `+Inf`。修法：抽 `singleBenchReadNote(bytes, d)` 纯函数，`d <= 0` 只报体量、不报速率（诚实红线：测不出的速率宁可不报），判据由纯函数单测确定性锁定（真实计时不可控，不在集成层赌 0 时长），集成层只加「任何阶段不得出现 Inf/NaN」的粗保护。真 CLI 复验：note 变为 `✅ 115B`。
  - **同族守卫扩到 gui-flow tab**（同日追加）：`GUI_FLOW_REAL` 取自 `runGUIFlow` 真实组装路径（`ctx.SetResult` 落盘，非手编），断言阶段行数、估算标记数 = 载荷里「估算成分 > 0」的阶段数、⑤ 的实测+估算**分列**文案、汇总不得把估算计入总耗时（D2 硬判据）、占位符残留。**又抓出两处真缺陷**：① `runPhaseModelScan` 的「(%.0f models/sec)」在 0 时长下同样打出 **`+Inf models/sec`**（GUI ② 阶段描述里可见）→ 抽 `scanRateSuffix(count, d)`，`d <= 0` 返回空串；② `guiFlowRenderStages` 的 `esc(e.desc.join("<br>"))` 把 `<br>` 自己也转义了 → 界面直接显示字面量「<br>」（单元层子串断言对此**失明**：两种写法的 textContent 都含 `<br>` 字符）→ 改同目录 `perf-log.ts` 的既有正确写法 `.map((line) => esc(line)).join("<br>")`，并补 DOM 结构断言（`querySelectorAll("br")`）做反向验证（改回旧写法立刻 `expected +0 to be 1`）。夹具统一把本机绝对路径前缀归一为 `<repo>`（换机器必然不同的部分），数值文案逐字未动。
- **tab 的「进入语义」必须统一：进入即有内容**（2026-09 补齐，起因是评审实测：诊断页九个 tab 混了**三套**范式——`log` 进即加载（`loadDiagnosticsLogs`）；扫描三兄弟（conflict/health/sync-conflict）进即有**引导空态 + 主按钮**（`scanHint`/`healthHint` 写在 tpl 初始 HTML 里）；而**性能五兄弟**（single/gui/conc/hist/trace）进去是**裸空 div + 工具栏一个孤零零的按钮**，用户得先去别处「制造数据」再回来手动刷新——`trace` 的文案甚至自己写着「加载模型后自动记录，点击刷新查看」，即**必须先去 3D 预览转一圈**）。现统一为**两级**：
  - **能零成本渲染的 → 进即渲染**：`trace` 读的是 3D 适配器写入的**内存 store**（`getLoadTraces()`，零 I/O、零 Go/CLI 依赖），故 `init.ts|dgInBindTraceTab` 在**初始化 + 每次激活 trace tab** 两处调 `renderLoadTraceSection`（初始化那次顺带覆盖「语言切换重建面板」）。**为何不登记进 `bindTabs` 的 `TAB_INIT` 懒加载表**：那张表是「**首次**切换只跑一次」语义（`if (!inited[tab] && tab !== ids[0])`，且实际只登记了仓库页的 recycle/dedup/oldest 三个），表达不了「每次激活都刷新」——而用户每次从 3D 预览回来都该看到最新的一份。
  - **需要跑进程/CLI 的 → 引导空态 + 显式按钮**：`single`/`gui`/`conc`/`scan-bench-out`/`hist` 的输出容器在 `tpl.ts` 预置 `diagnostics.perfIdle` 引导空态（照抄扫描三兄弟的 `stat-row` 内联配方，**进入即有话说**），按钮仍留在工具栏；**不做「进 tab 自动 spawn CLI」**——与扫描三兄弟同口径（进 tab 不跑进程，跑不跑由用户点）。
  - 反向验证：`init.test.ts` 新增两例，实现前双双红——「激活 trace tab → 即渲染内存 store（无需先手点刷新）」与「查看器模式：trace 刷新入口不隐藏」。
- **模式降级按「这个面板靠什么活」判，不按「它挂在哪个组」判**（2026-09 修正）：`dgInHideDesktopOnly` 原把 `diag-perf-refresh-trace` 与其它桌面按钮一并隐藏，可加载剖析**恰恰是性能组里唯一跨模式可用的**（纯内存 store，网页/查看器模式下 3D 适配器同样在写）——藏它等于把唯一可用面板的**唯一入口**藏掉，与该函数「避免可见但不可用」的本意**反向**成立。现该入口不隐藏，隐藏清单只留真正依赖 Go/CLI 的项。同批顺手删掉 `init-pages.ts` 里一份**重复的 doc 注释**（`/** 初始化诊断页 */` 紧跟着另一份同主题注释，谁也没doc到），并补上注释里漏列的 `conc` tab（陈旧声明与实装脱节）。
- **诊断页性能分组按「动作 / 产物」两轴（ADR-278，2026-09）**：9 → **7 个 tab** —— `log` / **`bench` 跑基准** / `gui` 端到端 / **`record` 性能记录** / `conflict` / `health` / `sync-conflict`。起因是三件实测事实：① 性能五兄弟并存**三套进入语义**（已先收口为两级，见上条）；② tab 按「哪段代码跑」（**机制**）切而非按「想干什么」（**意图**）——`single` 与 `conc` 是**同一个基准**的串行/并行两态却各摆一遍参数，第 4 个基准（引擎对照）藏在 `single` 的工具条里当按钮，`trace` 的数据全来自 3D 加载管线却挂在性能组；③ **ADR-262 自己写了却没落地的意图**——`tpl.ts|VIEW_TESTIDS` 注释声明「并发 tab 复用同一套目标集 / 排序控件……不写第二份」，实现却写了 `diag-perf-conc-target` / `-order` 两份 DOM（`perf-concurrent.ts` 的注释同样自称「不另立第二套」）。落地要点：
  - **`bench`**：模式选择器 `#diag-perf-mode`（`single` / `conc` / `scan`，默认 single）+ 按模式分行的参数（`data-perf-mode="single conc"` 声明归属，切模式时给非当前模式的行加 `.perf-mode-off`）。**所有 `diag-perf-*` 元素 id 保持不变**——测试面按 id 操作的断言远多于按 tab（实测全仓按 tab 切页只有 e2e 6 处 + 单测夹具 4 处）。
  - **同义控件去重**：目标集 / 排序只留 `#diag-perf-rtype` / `#diag-perf-order`（`perf-concurrent.ts` 改读、`perf-concurrent.test.ts` 夹具随之改），两份 conc 专有 DOM 删除，`populatePerfTargetOptions` 只剩一次调用（`includeModel=false` 那条能力保留为 helper 契约，由 `perf-matrix.test.ts` 用中性 id 锁定）。
  - **取样上限有意不合并**：单模型深测默认 **5** / 并发广度扫默认 **20** 是两个真实口径，合并 = 用「看起来整洁」换掉语义。
  - **静默 no-op → 可见的不可选**：并发不能选「单模型」（没有模型路径输入），原实现只是 `return null`；现在切到并发时**禁用该选项**并把已选值回落到全库扁平。同批修一句**会撒谎的文案**：`perfConcurrentParamInvalid` 只讲「worker / 上限」数值，而它同时是「目标集选了单模型」的出口——三语都补上了目标集原因。
  - **`record`**：加载剖析（内存 store → 进即渲染），且已是该 tab 的**唯一入口**。原「基准历史」段（`diag-perf-log` / `diag-perf-hist-row` / `diag-perf-hist`，CLI 支撑 → 引导空态 + 按钮）已由 380fa163f「remove perf-log UI section」整块移除，本行随之订正——**卡比代码晚了一步**，正是 `check-doc-drift` 该抓、而只抓得着 `source_files` 的那类半截漂移。查看器模式隐藏 `bench` / `health` / `sync-conflict` **整 tab**（每个入口都是桌面专属 CLI；只藏按钮会留下「满屏引导空态却点不着任何东西」的空壳 tab；`conflict` 曾在此列，2026-09-21 随该 tab 下线退出），**保留** trace 入口。隐藏机制已下沉声明处（ADR-259 §2.7）：tab 名单写在 `tpl.ts` 的 `desktopOnly: true`，由 `renderTabs(viewerMode)` 产出时整块不渲染；`dgInHideDesktopOnly` 只剩面板内局部控件的按 id 隐。
  - 测试：新增 `perf-mode.test.ts` 5 例（默认只显 single / 切 conc 的「禁用 + 回落」/ 切回恢复 / scan 复用迭代行 / 填充重建 `<option>` 后模式态重放）；**变异检查**——注释掉禁用+回落两行 → **恰好 2/5 红**（证明测试绑定行为、非空转）。e2e `diagnostics.spec.ts` 同步 18 例（`DIAG_TABS` 改 7 项且仍**全量严格相等**、4 处 tab 就绪等待 `>=8`→`>=7`、并发两例与 scan 一例改用既有 `setShadowSelect(page, "diag-perf-mode", …)` 切模式）。
  - **§2.6 语义诚实层（2026-09-20 补，同日二修收敛 + 三修反向半边）**：三模式共用控件后审计出两处「同名不同义」接缝，落地在 `initPerfMode` 的 apply 内（重放幂等）：① `#diag-perf-iter-label` 随模式改写（single=重复解析 / scan=全库重扫，悬停 hint 说口径）；② conc 下目标集标签改「取样范围」（`#diag-perf-target-label`）且单模型回落不再静默（toast `perfConcTargetFallback`）；③ 三个运行按钮 title 收进单点 scope hint。**维护成本约束是二修的立因**：首版每模式一套平行键（`perfScopeHint{Single,Conc,Scan}`/`perfIterations{Single,Scan}`），加一个模式要改 ≈3N 处（N=语言数）；收敛为 `perf.ts` 接线表（`PERF_MODE_NAMES`/`PERF_RUN_BUTTON_MODE_KEYS`/`PERF_ITER_SUFFIX_KEYS`）+ `perfScopeHint()` 组装 + `{mode}` 插值文案本体，新增模式 = 表各加一行 + 一个 `perfModeName*`，O(模式数)→O(1)。反例护栏：**不碰**「取样上限」标签（单位变但语义不变，恒定性由 perf-matrix.test 钉死）。测试：`perf-mode.test.ts` +5 例（标签改写双向 / 目标集改口 / 三按钮 hint / 接线表单点性+未知模式不编造 / 回落 toast 含重放不双弹），断言只锁语义关键词不锁拼接形态（改措辞不应红测试）；e2e 新增 describe 3 例钉真实浏览器链路（拨选择器→当场改口 / conc 回落 toast 上屏 / 三按钮 hint 无 `{mode}` 残留；⚠️ e2e 浏览器被 playwright.config 钉 locale: "en-US"，文案断言用 en 包关键词，写死 zh-CN 必红；toast 节点在 `app-toast` 组件的 shadowRoot 内，选择器必须穿透）；新键入 `VIEW_TESTIDS`（diag-perf-iter-label / diag-perf-target-label），locale 三语同步经 `generate-locale-json.ts`。
  - **§2.6 三修：「可见但不被读」也是欺骗（第四张表 `PERF_UNREAD_MODES`）**：首版只管「同控件改义要改名」，漏了对偶面——控件在当前模式**不进载荷**却仍可交互。原状靠「整行 `data-perf-mode` 隐藏」兼任不可用门禁，而排序行实为 single/conc/scan 三模式共用控件（Go single-bench 矩阵与 concurrent-bench 都吃 `--order`，仅 scan 不读）——行拆分后兼任碎掉，scan 下排序变成「能改不被读」。收口：`tpl.ts` 排序行登记 `single conc scan` + 独立标签 id `diag-perf-order-label`；`perf.ts` 新增 `PERF_UNREAD_MODES`（控件 id → 不读它的模式集，真相源 = 各命令模块 read\*：model/max/baseline×3 只归 single，conc-workers/conc-max 只归 conc，order 不归 scan），apply 内按表置 disabled。与 `syncPerfBaselineControls`（目标集维门禁，ADR-262 D8）正交共存：基准可用 = 模式 single ∧ 目标集 model。**双维兼并判定补丁（同日四修）**：两维各自赋值式写 `disabled`，但 `syncPerfBaselineControls` 也被 rtype change / 选项填充回调**独立触发**——旧版只判目标集维，scan/conc 下拨一下选择器就把载荷不读的基准三件套解禁（护栏测试当场抓出）；现该函数也读当前模式，基准禁用 = ¬(single ∧ model) 两路同口径。回归钉：「非 single 下拨目标集不得解禁基准」（变异检查：撤模式维判定恰好红该例）。护栏测试逐模式×逐控件扫「可见即可用可用性 = 载荷读不读」。
  - **同日五修（大刀）：门禁单源化 + 登记面穷尽护栏**：四修只拆了 rtype 路径的雷，apply 循环里残留同型第二颗——它按表直写 `el.disabled = unread.includes(mode)`，对基准三件套（表登 [conc,scan] 不读）在 single 下会**无条件启用**，盖掉目标集维（single+全库勾选基准照样可点）。修法：`perf.ts` 新增导出 `BASELINE_CONTROL_IDS` 单点名单，apply 遇名单成员跳过、统一末尾委托 `syncPerfBaselineControls` 兼并判定；⚠️ 名单放 perf.ts 使 perf ↔ perf-single-bench 构成模块环（两边只在函数体内读绑定，TDZ-safe；禁止顶层求值，注释已钉）。同时补**穷尽性护栏**（此前「未登记 = 所有模式可读」是静默宽容，新控件忘登记永远绿）：`perf-mode.test.ts` 静态扫 tpl.ts bench tab body 模板串（起点 `id: "bench",` 后首个反引号、终点 `id: "record",`；happy-dom 下 `import.meta.url` 是 http:// 不可用 `new URL`，读文件走 `process.cwd()`）内全部 input/select，每个控件必须有归宿：**行归属（所属 perf-row 开标签带 data-perf-mode→缺席即整行隐藏）∨ 不读表/基准名单（共用行可见但置灰），二选一即可**；两者都没=可见可改不被读，当场红。两个实现坑：行归属不能拿控件自身所在行（run+model 同行合排，data-perf-mode 挂在 div 上），也不能拿「向前最近 <div>」（row-label 嵌套误抓）——取控件前最后一个 perf-row 开标签再沿 <div/</div> 配平验证仍开着；抽样断言防正则空转假绿。变异检查：往 tpl 注入裸 `<input id="diag-perf-newprobe">` 恰好红该例。
  - **同日六修：门禁的「目标集」半边在 single+model 默认态缺失（上手难度根因，2026-09 用户锐评「跑基准上手难度高」修复）**：五修的穷尽护栏判据是「**行归属 ∨ 不读表**」二选一，于是漏掉一个**同时满足两者却仍不被读**的格子——`#diag-perf-max` 与 `#diag-perf-order` 在 `single` 模式默认目标集（单模型）下**整行可见（行归属 single，护栏判合格）**，但 `singleBenchReadMode` 在 `target==="model"` 时**提前 return**，`maxModels`/`order` 根本不进载荷（`perf-single-bench.ts` 的 model 分支只读 model+iterations+基准三件套）。即护栏把「行可见」误当成了「必被读」——**可见性（模式维）≠ 被读性（模式 ∧ 目标集维）**，两维都满足才是可用。危险在于这是**默认路径**：新手进 tab 就是 single+model，看到「排序」「最多模型数 5」两个框、按直觉填完跑，结果完全不生效。**落地形态（当日即收敛成表，不留散在分支）**：新增 `PERF_UNREAD_TARGETS`（控件 id → 不读它的目标集集，当前 `{max:[model], order:[model]}`），与 `PERF_UNREAD_MODES` **对称**；apply 改为表驱动循环、两维取**并集**（模式维已置灰的叠加目标集维，不覆盖——如 scan 下的 order 两维都命中）；`max` 的 title 改由 `disabled` 驱动（任一维禁用原因都显示「何时才生效」）。rtype change 监听补调 `applyPerfMode()`（否则拨目标集后门禁不重放）。**判据升级：控件可用 = 模式维被读 ∧ 目标集维被读**。⚠️ 为何必须成表而非散写：六修首版把判定硬编码在 apply（`if (maxEl)` / `if (orderEl)`），**护栏管不到**——新一轮漂移源。**护栏补第三维**（`perf-mode.test.ts`）：single 下可见的控件必须显式声明「单模型目标下读不读它」（model 分支实读白名单 `{rtype, iter, model, run}` ∨ `PERF_UNREAD_TARGETS` ∨ 基准名单），沉默即红；变异检查（撤掉 max 登记）精确报「六修同款漏判」。**教训（同本卡反复出现的病）：护栏只看得见它被写死的那一维**——登记表解决「模式维穷尽」，但「行可见」被当成「被读」，于是同一句欺骗从默认态漏过；新增「可交互性 = 载荷读不读」时，务必问「这个控件还有没有**第二维**决定它读不读」。**测试操作的坑**：新用例忘写 `initPerfPanel(root, esc)` 会得到「实现正确却断言红」的假失败（未接线 → 无监听 → 初值），排查时先用探针确认被测函数真被调用，别先怀疑元素身份/时序。
  - **§2.6 配套文案改造（同日，与六修同批）**：① 模式下拉**去撞车**——原 single 模式选项与运行按钮**同用** `perfRunSingle`（下拉选「运行单一模型基准」再点同名按钮，读起来像重复），且三选项结构不平行（动宾 / 名词 / 名词+括号）；新增 `perfModeOpt{Single,Conc,Scan}` = 单模型 / 批量并发 / 引擎对照 承载**下拉**，`perfRun{RunSingle,Concurrent}`/`perfScanBenchRun` 改「运行××基准」承载**按钮**，模式=名词、按钮=动词，两类彻底脱钩（含 `（Go/Rust）` 这类后端实现细节从用户可见标签移除）。② 黑话替换（三语同步）：`perfTarget` 目标集→**测试范围**、`perfMaxModels` 取样上限→**最多模型数**、`perfOrderSize` 体量降序→**体积从大到小**（`perfTargetSetEcho` 前缀同步改，避免标签与回显口径分叉）。⚠️ **改文案必同步两处硬编码字面量**：单测 fixture 直接写死中文（`perf-mode.test.ts` 的 `<option value="conc">并发</option>`、`perf-matrix.test.ts` 的 `取样上限` label 与 `toBe("取样上限")`、`perf-concurrent/perf.test.ts` 的 `体量降序` option、echo 断言的 `排序 体量降序`），e2e 因 playwright 钉 `locales: en-US` 而断言 en 包（`Target set`→`Test scope`）——改 zh 值不会红单测 fixture，但改 en 值必红 e2e。③ 模型路径引导（ADR-221 延伸）：路径框下补 `perfModelHintFromTree` 常驻提示（`.perf-hint`，随 single 行显隐），并订阅 `bus` 的 `model:select` 使**进入 bench tab 后再去资源树点模型也能实时带入**（此前只在 `initPerfPanel` 时 `getLastModelPath()` 预填一次）——仅 single 模式带、仅输入框为空时带（不覆盖手填），按 `Map<ShadowRoot, unsub>` 去重防重绑叠加；⚠️ mode select 缺席时按 single 回落（`modeEl?.value ?? "single"`），否则夹具/异常态会静默不填充。护栏：`perf.test.ts` +4 例（实时带入 / 不覆盖手填 / 非 single 不带 / isDir 不带）。
  - **同日七修：目标集下拉分组 —— 解开「两个下拉都说单模型」的撞名耦合（2026-09 用户锐评「全库扁平 / 全库类型看起来让人迷惑」）**：用户先问「这四项真的需要吗」，追问一层后暴露出**真正的病灶**——模式下拉与目标集下拉**都在说「单模型」**（前者 = 跑哪条命令，后者 = 测谁），而目标集项**只在 single 模式可用**（故 live DOM 里它带 `disabled=""`）。两个看似独立的井排下拉实则**耦合**，第一眼无人能回答「这俩什么关系」。⚠️ **先说不能砍的原因**（避免误改）：四档不是冗余——`--max-models` 的单位随 target 变（`1 条 / 该类型 N / 每类各 N / 全库 N`，见 `bench_concurrent_json.go:77`），`all` 与 `repo` 的差是**分组**；`repo --order size --max-models 2` = 「全库最重的 2 个」是单类给不了的（用户不知道哪类最重），Go 侧有测试锁着。**真正的因是命名与呈现，不是存在性**。落地：① 目标集下拉拆**三个 `<optgroup>`**：单个模型 / 按模型类型 / 跨类型对比（进阶）——按「测一个 → 测一类 → 测跨类」递进（`optionRows` 是 conflicts 共用叶，**没改它签名**，改在 `populatePerfTargetOptions` 里分段拼）；② 黑话退到 title、标签改人话：`全部类型` →「每个类型各取几条」、`全库扁平` →「全库最重的几条（不分类型）」、`目标集` →「测什么」（conc 下「测哪些」）；③ 模式下拉标签「基准模式」→「怎么跑」+ 新增 `perfModeHint` 常驻一句说清两轴关系（「怎么跑 = 用哪种基准命令；下方测什么 = 这次测多大范围」）；④ **控制条重排**：「测什么」行从运行按钮**下方**移到**上方**，贴合提示宣称的「先选命令 → 再圈范围 → 再点运行」（原先按钮先出现、它依赖的选择器在 3 行之后）。⚠️ **同日发现的真 bug：`.perf-hint` 在 shadow 内零 CSS 规则**——`.perf-row` 是 `display:flex`，提示 `<div>` 会被当成 flex item 与 select **挤在同一行**（上一轮加的 `perfModelHintFromTree` 一并中招）。修法：`.perf-hint { flex-basis:100%; color:var(--muted); font-size:var(--fs-xs); line-height:1.4 }`（`flex-basis:100%` 强制换行）。**教训（同本卡反复出现的病，第三次同型）**：类名在模板里写得漂亮 **≠ 样式存在**——`content-diag.ts:94` 已明写「.perf-wrap / .perf-controls 类名是空头支票」的前科，`.perf-hint` 是**同一坑未扫干净的另一半**；新增 class 时应搜一次 CSS 规则存不存在，别只信模板里的命名。⚠️ **改文案三处同步清单**：zh 值改不红单测 fixture（写死中文）但**必改**；en 值改**必红 e2e**（`diagnostics.spec.ts` 钉 en-US）；`perfMaxModelsHint` / `perfConcTargetFallback` 这类 tooltip/toast 里**容易漏**的黑话一并换。护栏：`perf-matrix.test.ts` 新增 optgroup 断言（组标题顺序 + `inGroup()` 逐个验值归属，防「分组拼错层级」）+ 两组 `includeModel` 分支断言。
  - **同日八修（根治）：公共区常驻 + 引擎对照退出模式轴（ADR-278 §2.7）**。用户接着锐评：「相关的 cli 指令相对统一吗，如果统一的话，为啥相似的概念要做成不同的按钮呢，漂移风险极高」「并发与单模型均可以选择范围，那反而应该是范围放第一个」。**核实 CLI 后发现用户的判断准确，但病因比「按钮不统一」更深**：
    - `perf_target_set.go:255` 原话：single-bench 与 concurrent-bench「两命令**共享同一套参数面（同名同义）**，差异只在默认值」——两者由**同一个** `registerPerfTargetFlags` 注册 `--target/--order/--rtype/--model/--max-models`。前端却把它们**各写一份**、还都藏在 `data-perf-mode` 块里：§2.2 说的「共用」被实现成了「两个模式都显示」而非「模式之外常驻」——**这就是「臃肿」的真因**。
    - `scan-bench` **只有 `--iterations` + `--format`**（`scan_bench.go:338` 的 FlagSet 就这两个），**根本没有目标集参数**。它测的是「扫一遍仓库」（Go/Rust 引擎对照），与「解析一个模型」的输入/阶段/可比对象**全不同**（源码原话：「混进同一份报告只会让**读者算错账**」）。所以用户问「scan 能提供扫描范围吗」——**不能，且不应该能**：同机同 fixture 才可比，范围必须固定全库。
    - 落地：① `测什么 / 排序` 行去掉 `data-perf-mode` → **模式无关常驻**，置于控制条最上；② 模式下拉只剩 `single / conc`（真正的「同一件事两种跑法」），`scan` 升为**平级 top tab**（新 `perfScanBench` 文案 + `#diag-perf-scan-iter` 自己的迭代框）；③ 运行按钮仍并排三条（CLI 是三条命令，命令名必须可见）。
    - ⚠️ **护栏必须同步扩扫描域**：`perf-mode.test.ts` 的穷尽闸原本只扫 bench tab；scan 独立成 tab 后若不扩，**scan 自己的控件落在闸外**——再次是「闸只看得见它被写死的那一类」（从「覆盖少一格」退成「扫错区间」）。已改为 `bodyOf("bench","scan") + bodyOf("scan","record")`，并新增两类显式登记：`SHARED_CONTROLS`（公共区：常驻且两模式都读）与 `SCAN_TAB_CONTROLS`（不在模式轴上）。**为何公共区要单独立名而不能滥用 `PERF_UNREAD_MODES`**：把常驻控件写成「不读它的模式 = 空」语法上能混进门禁，但那张表回答的是「哪个模式不读它」，回答不了「它为何不随模式显隐」——名字错了下一个人就会把两者当一回事。
    - ⚠️ **顺手发现的存量红**（与本改无关，已修）：e2e「类型选择器选项来自 registry」断言 `resourcepack` 在选项里，但 `8d448bb3f`（可分析性迁入 `resource_types.json` + 选择器只列 `cliAnalyzable`）之后就**必红**——全库只有 `ysm`/`maid-model` 带 `cliAnalyzable: true`。该断言与它引用的 ADR 意图相反，已改为 `not.toContain`。孤键 `perfModeOptScan`/`perfIterationsSuffixScan` 一并删除（locale 1499→1498），`perfIterationsHint` 里「引擎对照下 = 全库重扫」的旧口径也改了（那句话现在指错框）。
- **性能域只覆盖「一条资源链路」，且这件事必须写在面板里而不是标签里**（2026-09 文案校准，承 ADR-278）：用户追问「蓝图呢」逼出的事实——性能诊断 7 个命令全部围绕「BedrockModel 加载」建成，当时**只有 YSM 登记为有完整链路**（⚠️ 2026-09-19 订正：`maid-model` 同链、7 段齐全，是**清单漏登记**的假阴性——「只有 YSM」是**清单的声明**而非**引擎的事实**，与本卡反复出现的「闸只看得见它被写死的那一类」同源，详见下方同日条目）；MMD/VRM/FBX/GLTF 只到「如实告知不模拟 + 引导去 3D 预览实测」；**蓝图/投影零入口**（`file-bench` 只量原始读取吞吐，`detectModelFormat` 只是**叫得出名字**）。最刺眼的不对称：`go/litematic` 是 Go 侧最成熟的解析链路之一（三层 + 中文方块名 + fuzz 测试，知识卡明令「禁止前端手写」），比 MMD/VRM 更「CLI 可测」却更没入口。落地：
  - **`(YSM)` 后缀退休**：`diagnostics.perfRunGui` 去掉括号后缀，新增 `diagnostics.perfGuiScopeNote`（三语）作为 gui tab 的**常驻范围说明**（`.perf-scope-note` + `data-testid="diag-perf-gui-scope"`）。⚠️ 该说明原写「完整 6 阶段仅 YSM」——**当日即错**（见下方 2026-09-19 条：`maid-model` 同样 7 段齐全，只是清单漏登记），已订正为「完整 6 阶段链路覆盖 YSM 与车万女仆」，并补「同类型里没有几何的条目（音效包等）会自动顺延到下一个候选」一句。判据：**该在面板里说清楚的事，不该藏在标签里**——标签是给未点进来的人看的，而误导恰恰发生在点进来之后。（⚠️ 2026-09-20 后续：gui-flow 面板整体砍除于 `a1e26419d`，`perfGuiScopeNote` 键与 `.perf-scope-note` CSS 先后成孤儿；CSS 死规则已于同日审计清除，钩子会重生 auto_fields 行，故此处只记事实不列符号。）
  - **`file-bench` 描述对齐实现**（`go/cli/mmd.go` 注册处）：原「测试大文件读取性能（**模拟 MMD/PMX/VRM 加载**）」而它只迭代原始读取（>1MB 文件 + 吞吐），既无解压也无解析——格式无关的能力被写成了格式专属，还顺带承诺了没做的事。
  - **③ 的两种「没有可分析模型」分开说**（`go/cli/flow.go`）：① 仓库真没模型 → 保留 ❌ + 「未找到可分析的模型」；② 有模型但都不在 CLI 分析链路上 → **✅ + ℹ️ + 类型分布 + 下一步**（去哪测 / 用什么参数）。原实现两种共用一句只描述 ① 的话 + ❌：对 ② 字面不算错，但把**能力边界标成了失败**，还丢掉了 ② 已算好的分布（用户既看不出原因，也看不出下一步）。同源口径参照：`--model x.pmx` 的「CLI 不模拟」分支本就是 `Success: true` + ℹ️——**同一个条件，两个分支不该一个说失败一个说限制**。
  - **结构化直传，不反解析文案**：`guiFlowResult` 新增 `ModelCount` / `ByType`（② 填充），③ 据此转述；类型分布格式化收成单点 `formatTypeDist`（② 的描述与 ③ 共用，避免两处各排一遍序）。`flow.go` 既有教训「人类可读输出不是内部 API」在此再次生效。
  - 测试：Go 两条（`TestGUIFlow_UnanalyzableOnlyRepoExplainsWhy` 锁「✅ + 都不可分析 + 数量 + 类型分布 + 不产出 ④⑤⑥」；`TestGUIFlow_NoModelsAtAllKeepsOriginalWording` 反向护栏锁「真空仓库仍是 ❌ + 原文案」——防我改过头）；前端 `tpl.test.ts` 一条锁「范围说明在面板里 + 全页不出现 `(YSM)`」。
  - **未做（需另立 ADR）**：`voxel-bench`（复用 `go/litematic` 四段 + `single-bench` 的阶段/瓶颈/基线范式）+ `bench` 模式选择器加第 4 模式 `voxel`。ADR-278 选「模式选择器」而非「每链路一 tab」时没料到这层红利——**「模式」的正确语义是「跑哪条链路」**，于是它能天然容纳未来的资源链路；若当初按 tab 一分到底，加一条链路就得加一个 tab（回到 9→10 的老路）。
- **加载剖析的「全过程」是前端侧的实测，不是模拟——但此前只展示 1/50**（2026-09 展示层补全）：`load-trace` 是**跨格式**通用 trace，YSM / MMD / VRM / FBX / Litematic 五个 adapter + 兜底 loader 都在写（`LoadTraceAssets` 带格式专属字段：MMD 的 `pmxWorker`/`ktx2Hits`、YSM 的 `cubes`、VRM 的 `vrmaClips`、FBX 的 `fbxAnimations`），**YSM 与 MMD 共用同一套 4 段骨架**（读取/解析/纹理加载/build）故本就可比。这正是 `gui-flow` ③ 说「请到 GUI 3D 预览实测」所指向的载体。修的是**展示层**：
  - **只渲染最后一条 → 最近 5 条 + 其余计数**：store 保留 50 条（`MAX_RECORDS`），而唯一消费者只取 `traces[traces.length-1]`——**存了 49 条没人看**（「定义了没人用」的同类）。现按 `TRACE_MAX_SHOWN=5` 展开、新的在前，其余报「还有 N 条更早的记录未显示」。
  - **跨记录统一刻度**：甘特条长按**本批所有记录的最大阶段耗时**归一化，而不是每条自归一化——否则「快记录的小段」和「慢记录的大段」看起来一样长，多记录并排反而产生错觉（这是「对比」的前提）。测试对这个决策做了变异检查。
  - **两处格式间差异写在脸上**：① 阶段粒度不同（YSM/MMD 4 段、VRM ≥2 段、**FBX/Litematic 各 1 段**）——1 段时显式说明「该格式只记了 1 段合并耗时」，而不是让人以为它只有一个阶段；② **GPU 口径只有 MMD 采集**（`gpuMb`）——缺的格式显式标「未采集」，**不省略**：省略会让「没测」和「测出来是 0」长得一模一样。
  - 测试：`perf-trace.test.ts` 6 条（多次记录展开+计数 / 超 5 条报数 / 粒度 1 段说明 / GPU 未采集 / 跨记录刻度 / 空态回归），每条自带 `clearLoadTraces`（store 是模块级全局，不吃同文件其它用例的残留）；**变异检查**——把统一刻度改回各记录自归一化 → **恰好 1 条红**（那条刻度用例），其余 5 条不受影响。
  - **仍未做（需 ADR）**：面板不能**驱动**加载（数据只能来自用户自己去 3D 预览点一次），Go 段与前端段仍是两次独立观测、落在两个 tab 两条时间轴——「一次加载的全过程」尚未缝成一条链。三个待拍板点：离屏是否复用当前预览 / 是否开独立 WebGL 上下文 / 纹理缓存必然命中会污染第二次测量。
- **`perfTypeManifest` 登记 `maid-model` + 「按类型提升的候选须过几何验证」**（2026-09-19，实证修复）：清单此前声称「只有 YSM 有 CLI 分析链路」，**那句是错的**——TLM 女仆包 `.zip` 走 `go/geometry` 的 maid L0 清单（`detectMaidNs`/`collectMaidManifest`/`resolveL0`），与 YSM 容器同一个 `parseBedrockFromZip` 入口、同样 7 段（用户仓库实测 961 bones / 7 textures / 4696 cubes）。假阴性代价：`cliAnalyzable("maid-model")=false` → 自动挑选首个模型（`scanFirstModel`）、`--target all`、面板显式选「女仆」跑基准全被判 `unsupported` + 「CLI 无解析器」。**但只登记清单会让用户结果更差**（故必须成对修）：`maid-model\` 目录下还有音效包（实测 `atri_sound_pack-1.0.0.zip` → 0 bones / 1 texture），按路径序排最前，`scanSummaryByType` 只按类型提升首个条目、不校验分析结果 → `gui-flow` 会从「分析 ysm」退化成「❌ 分析失败」并丢掉 ④⑤⑥。
  - **判据分层（本次的核心教训）**：`perfTypeManifest`/`cliAnalyzable` 回答的是「CLI 有没有该**类型**的解析链路」，**不**回答「这条**条目**是否真有几何」——目录归属会把音效包/纯资源包与真模型归成同一类。后一问由新出口 `firstWithGeometry(a, candidates, maxProbe)`（`perf_targets.go`，上限 `maxGeometryProbe=5`）在末端验证：**不新写挑选器**，只复用既有有序候选（`gui-flow` 走 `scanSummaryByType`、「挑首个模型」走 `scanBenchTargets`）再判 `hasGeometry(model)`（`len(Bones)>0 || CubeCount>0`，与 ④⑤⑥ 门控同一谓词）。
  - **`gui-flow` 顺延**：`scanSummaryByType` 增第三个返回值 `[]string`（路径字典序的 CLI 可分析候选，`firstModel` 恒 = `candidates[0]`，同源不另立挑选器）→ `guiFlowResult.AnalyzableCandidates` → ③ 经 `runPhaseModelAnalyzeTarget` 顺延（它还返回**实际被分析的路径**，调用方回写 `targetModel`——④ 的纹理哈希按 `targetModel` 取，不回写就是「模型换了、④ 还在算旧文件」）；**`--model` 显式指定不做顺延**（用户点名要那个）；顺延的多次分析**全部计入 ③ 耗时**（开销不藏）；成功时文案如实写「⚠️ 首个候选无几何…已改测第 N 个候选 / 已跳过: …」（`describeModelAnalysis` 是 ③ 描述的唯一出口）；全部无几何时单候选保留原文案 `❌ 分析失败: <path>`，多候选给出「N 个候选均未解析出几何，可能是音效包/纯资源包」——**数据问题不得谎报成能力边界**。
  - **另两个入口同修**：`perf.go|resolveTargetModel`（→ `perf-snapshot`）与 `health.go --bench` 都曾把 `scanFirstModel` 的返回值**直接喂进 `runSingleModelBench`**；`scanFirstModel(a AppService, filesRoot)` 改为取前 `maxGeometryProbe` 个候选做几何验证（无命中如实返回空串）。测试替身须**物化 Bones**（`benchFakeApp`/`benchTimedFakeApp` 原只填 `BoneCount`，会在自动挑选路径上被判成空模型——那是替身失真，不是被测逻辑）。
  - 测试：`go/cli/maid_geometry_test.go`（真 zip 夹具 `archive/zip` 现造，落在 `<root>/maid-model/单女仆/` 复现用户目录形态）——①女仆可被采集（`cli_analyzable=true`/`unsupported=0`/`analyzed=1`/7 段 + `scanBenchTargets` 含女仆）；②顺延（首个候选是空包 → ③ 成功且报第二个模型的骨骼数、④⑤⑥ 齐全、文案提到跳过；并**预置真包的纹理缓存**断言 ④ 报「缓存命中」——这是一条做过变异检查的判据：去掉 `targetModel` 回写后该用例立即红）；③反向护栏（只有空包 → ③ ❌ 且文案不含「能力边界/CLI 不模拟」）；④`--model` 显式不换模型；⑤`scanFirstModel` 跳过无几何候选。既有用例随签名同步更新（`scanSummaryByType` 三返回值、`resolveTargetModel`/`scanFirstModel` 加 app 参数），**未弱化断言**（新增候选序与 `first==candidates[0]` 断言）。
  - 端到端实证（用户真实仓库）：② 首个模型 = `atri_sound_pack-1.0.0.zip` → ③「⚠️ 首个候选无几何…已跳过: atri_sound_pack-1.0.0.zip」→ 分析 `ba_aru_pack-1.2.1.zip` 得 **118 骨骼**，④⑤⑥ 齐全；④ 的哈希随回写从音效包切到真包（`6088998b…` → `b1c09072…`），正是上面那条回写的实测证据。
- **可分析性事实源迁入 `resource_types.json`（`cliAnalyzable`）+ 目标集选择器改为只列可分析类型**（2026-09-21，审核修复）：审核发现目标集 selector 渲染 registry 全部 15 类，其中 13 类 CLI 无解析链路（PMX/PMD/VRM/FBX/GLTF 的解析器只在前端 3D adapter）、`resourcepack`/`shaderpack` 更不是模型——用户选中即被 Go 判 `unsupported`，是「渲染出必然失败的选项」的诚实语义反面（ADR-278 §2.6）。
  - **为什么不是前端本地过滤**：判定归 Go 是回归红线（前端只读不判），此模块历史一贯做法是「Go 拥有事实、前端消费、再加机检护栏」（`1c5a654d9` 登记 maid-model、`5aaba80f3` 单源化 `BASELINE_CONTROL_IDS`、`8a76da041` 加「登记面穷尽」护栏）。前端自写一份「哪些类型能跑基准」= 第二份真值。
  - **为什么迁 JSON 而不是新开异步绑定**：ADR-269 D3④ 刚把前端类型数据从异步 RPC 改为同步直读 `resource_types.json`（`resourceTypesById`），可分析性跟随同一通路，零新接口、天然同源。
  - **落地**：`resource_types.json` 的 ysm / maid-model 标 `"cliAnalyzable": true`（其余默认 false）；`registry.ResourceType` 增 `CliAnalyzable bool json:"cliAnalyzable"`；`perfTypeManifest` **删去 `CliAnalyzable` 字段**（只留 `ExpectedStages`/`Note` —— 阶段链长度是 Go 内部验证语义，不与前端共享），`cliAnalyzable()` 改为 `registry.RegistryType(rtype).CliAnalyzable`（单点出口不变，消费方 `bench_concurrent.go` 三处、`perf_target_set.go|filterAnalyzable` 均无感）；前端 `ResourceType` 增 `cliAnalyzable?`，`populatePerfTargetOptions` 过滤 `Object.values(reg).filter(t => t.cliAnalyzable)`。
  - **哨兵不受过滤**：`单模型`/`__all__`/`__repo__` 保留——`--target all` 由 Go 侧对不可分析条目顺延（`firstWithGeometry`），语义仍成立。
  - **护栏三处**：① Go `perf_manifest_registry_test.go|TestCliAnalyzable_DeclaredSetIsKnown` 双向拦漏标/误标（声明集合必须恰好 = `{ysm, maid-model}`）；② `bench_matrix_test.go|TestPerfTypeManifest_Consistent` 改读新事实源（可分析 ↔ `ExpectedStages`）；③ 契约 `tests/test_cli_gui_flow_contract.ts` §3.7b 锁「JSON 字段名 ↔ Go 单点读取 ↔ 前端过滤」三者，并反向断言旧字段 `perfTypeManifest[rtype].CliAnalyzable` 不再出现。
  - 前端测试 `perf-matrix.test.ts`：受控子集 `ysm(cliAnalyzable:true)` / `EntityPlayer(无)` 同时覆盖「可分析入选项」与「不可分析被滤除」两侧（断言 `["", "__all__", "__repo__", "ysm"]`）。
- **渲染与数据的差异：兜底 token 人话 + 哨兵覆盖面说清**（2026-09-21，审核续）：上一轮改动后复查「渲染层实际显示什么 vs 载荷实际说什么」，捞出两处**数据诚实但渲染失真**。
  - **① `container container`（真缺陷）**：`classifyForScan` 的兜底 token `container`（容器未命中目录消歧）/ `other`（扩展名未命中）**永远不在 registry 里**（正因「不猜任意类型」才诚实标出来），故 `rtypeDisplayName` 返回空串 → 载荷 `omitempty` 不发 `rtype_label` → 前端 `typeLabel` 的 `s.rtype_label ? label : rtype` 与紧随的 id span 印出**同一 token 两遍**（表格里 `container container`）。实测证据：真实仓库 `--target repo` 的 `container` 行 `found=33`。
    - **修法（人话归 Go 单点）**：`perf_targets.go` 增 `rtypeFallbackLabels{container: "容器（未定类型）", other: "其他（未识别扩展名）"}`，`rtypeDisplayName` 查表命中即返回。**为什么不进 `resource_types.json`**：那里是「真实资源类型」的表，兜底 token 是判定**来源**而非类型（`perf_identity.go` 的 `rtype`/`rtype_source` 字段分别承载这两件事），塞进去会让它参与类型枚举、扩展名归属等一切下游消费。**只给这两个语义确定的兜底编人话**，其他未登记 id 仍返回空串（凭空造名会掩盖 manifest 里的拼写漂移）。
  - **② `__all__` 哨兵与过滤后的类型面脱节**：选择器已按 `cliAnalyzable` 过滤（只剩 ysm/maid-model），但「全部类型」在 Go 侧仍扫**全类型**（不可分析条目顺延）→ 用户能选到「全部类型」，表里却冒出选择器里根本没有的 `container`。**选项集 ⊊ 数据的类型集**。
    - **修法（不隐藏信息，只说清）**：给该哨兵挂 `title`（新 i18n 键 `perfTargetAllHint`，三语齐备）说明它覆盖注册表**所有**类型、不可分析的那类只出身份不采集阶段耗时——与 `perfTargetRepoHint` 既有做法同构。**不收窄 `__all__`**：矩阵口径本意就是看全类型分布（`found=33` 的容器行也是有用信息），收窄反而丢数据。
  - **护栏**：Go `perf_manifest_registry_test.go|TestRtypeDisplayName_FallbackTokens`（兜底 token 必须有标签**且标签 ≠ id**——只判非空挡不住「印两遍同样的话」；并反向断言非兜底的未登记 id 仍为空）；契约 §3.7c 锁「标签表存在 + 每 token 的标签与 token 有别 + 哨兵 title 已挂」。**两条断言都做过变异检查**：把 `container` 标签改回 token / 去掉哨兵 title → 各自精确变红，还原即绿（第一版只查 token 字面量存在，变异检查证明它恒真，已改成正则要求标签与 token 有别）。
  - ⚠️ **改 i18n TS 后必须 `node scripts/generate-locale-json.ts`**（根目录，不是 `frontend/scripts/`）：vite build 的 `check-locales-sync` 会挡（实测报「locales/*.ts 与 public/locales/*.json key 不一致」）。
- **载荷表达力：把「不适用」从零值里救出来（`stages_declared` / `unsupported_reason`）**（2026-09-21，审核续二）：上一条记的两处「数据诚实但渲染失真」修完后，继续追查明细区/表格里剩下的两处差异，发现**同一个根因**——**Go 用「零值 / 空数组」承载「不适用」，前端被迫用旁路字段反推语义**。
  - **① 阶段列的 `—` 是补丁**：`perfTypeSummary.ExpectedStages` 的 Go 零值 `0` 兼作两种含义——`perfTypeManifest` 里**没有这个 key**（未声明，如 container/other 及全部不可分析类型）与「登记了但声明 0 段」。前端因此只能写 `s.cli_analyzable ? s.expected_stages : "—"`——**用一个字段解释另一个字段的零值**。风险实在：载荷一旦不发 `cli_analyzable`（或二者口径分叉），`—` 会**静默变成 0**，「未采集」被渲染成「测了，是 0 段」。
    - **修法**：`perfTypeSummary` 增 `StagesDeclared bool \`json:"stages_declared"\``，由新单点 `perf_targets.go|stagesDeclared(rtype)`（`_, ok := perfTypeManifest[rtype]`，与 `cliAnalyzable` 配对但语义不同）在两处回填；前端 `typeRow` 改判 `s.stages_declared ? s.expected_stages : "—"`。**二者当前一致但不可互相替代**：`cliAnalyzable` 答「CLI 能不能解析」（resource_types.json 声明），`stagesDeclared` 答「解析该出几段」（Go 内部自检依据）。
  - **② 明细区丢掉了 Go 已算好的逐条原因**：`identityOnlyPayload` 一直带中文散文 `Hints`（「⛔ CLI 无 X 解析器…」），但**前端不渲染 hints**（未 i18n，英/日界面会冒中文——`perf-concurrent.ts|载荷里的 hints …**不在界面渲染**` 是明确取舍）。于是明细区只能 `len(stages)==0` 反推一句通用文案，**逐条语义丢失**。
    - **修法**：`singleBenchJSON` 增 `UnsupportedReason string \`json:"unsupported_reason,omitempty"\``，取值来自新常量 `unsupportedReasonNoCLIParser = "no_cli_parser"`；前端 `UNSUPPORTED_REASON_KEYS` 映射表 + `unsupportedReasonText()`（未知 token 落 `perfReasonUnknown` 而非空串——「原因缺失」看起来像界面坏了）。**与 size_source 完全同构**：枚举值不随语言变，文案在 locale 里。**用 token 而非布尔**：将来出现第二种未采集原因（格式损坏/体积超限）时前端结构不动，只加一条映射。新增 i18n 键 `perfReasonNoCliParser` / `perfReasonUnknown`（三语）。
  - **护栏**：Go `bench_matrix_test.go|TestPerfTypeSummary_StagesDeclared`（一次 `--target all` 扫描同时覆盖「已声明」与「未声明」两侧，显式断言 JSON 里 `stages_declared` 的 **true 与 false 都出现**——只断言 true 会漏掉「全都发 true」的退化，那等于回到用 0 反推）；契约 §3.7b 增四条锚点（字段 + 单点出口 + 前端读 `stages_declared` + 反向断言不再用 `cli_analyzable` 反推）、§3.7 增三条（token 回填 + 映射表配对 + 反向断言不渲染 `m.hints`）。
  - ⚠️ **变异检查又一次救下空转断言**（本轮共 4 次）：①`unsupported_reason` 首版只查 `concurrentGo.includes("unsupportedReasonNoCLIParser")`——**常量声明就满足它**，删掉回填仍绿；改查 `UnsupportedReason: unsupportedReasonNoCLIParser,`（接线形态）。②前端映射表首版正则过宽，把键改名仍绿；改成要求 token→键**配对**。③`StagesDeclared` 首版测试用 `--target rtype EntityPlayer`——**该类型在夹具里不存在**，扫描直接报错（改用 `--target all` + 造 PMX 文件）。④前端渲染测试首版用 `toContain("CLI 无该类型解析器")`——**通用句本来就含这个子串**，恒真；改用专用键的独有措辞。**教训：断言必须查「接线/配对/独有措辞」，查「符号存在」几乎必然空转。**
- **「Go 发了 / 前端声明了 / 没人读」字段摸排（2026-09-21）**：以「前端在 `diagnostics/` 下声明的 interface 字段」为全集，逐字段统计**全目录**读取点（`x.field` / `x?.field` / `x["field"]`），再回查 Go 是否真在发。164 个声明字段里 **7 个零读取**，分三类：
  - **① 真未消费（1 个）**：`SingleBenchStage.bytes`（Go `bench_concurrent.go` 发）+ 载荷级 `hints`（两处声明）。已加 `@non-ui` 标注说明为何不渲染——`bytes` 各阶段口径不同（读入 vs 纹理 vs 网格），并排展示会**诱导横向比较不可比的量**。
  - **② 合法非界面消费（4 个）**：`PerfIdentity.{absPath, filesRoot, rtype_source}`、`SingleBenchPayload.size_bytes`——测试/AI 断言与排错用。**它们与①在静态检查里长得一样**，这正是危险处：将来加「未消费字段」门禁会一起误伤。故本轮先用 `@non-ui` 把它们**在源码里区分开**，门禁留待标注体系成型。
  - **③ 结构重复（根因）**：`PerfIdentity` 被声明**两次且形状不同**——`perf-single-bench.ts`（含 `filesRoot`/`absPath`，`rtype_source` 必填）与 `perf-matrix-render.ts`（内联匿名，只有 5 个字段，`rtype_source` 可选）。**于是没有任何一处能回答「这个结构的消费面有哪些字段」**，②类字段就藏在这个盲区里。已合并为 `perf-common.ts|export interface PerfIdentity` 单一声明（`perf-matrix-render` 不再内联匿名）；字段可选性按 Go tag 如实对齐（`rtype_source`/`absPath` 无 `omitempty` → 必填；`filesRoot` 有 `omitempty` → 可选）。
  - ⚠️ **摸排方法本身的坑（记下来免得重犯）**：首轮 census 用「外层 `if ($l -match ...)` 取 `$Matches[1]`、内层 `foreach` 扫全文件」的嵌套写法——**内层正则把 `$Matches` 覆盖了**，导致字段名被污染成上一轮的值（PowerShell 经典陷阱）。结论侥幸未错（`runtime` 本就不在零读取名单里），但当时口头把它误报为「未消费」。**教训：抓组后立刻落变量，且不要在循环里复用 `$Matches`。** 另：判「未消费」必须查**属性访问形态**（`.field`/`?.field`）而非 `\bfield\b` 裸词——后者会被注释里的同名字段名满足（`hints` 在 `perf-matrix-render.ts:208` 就是这么一条注释）。
  - **护栏**：契约 §3.7 增 6 条锚点锁「单一声明 + 两个消费方不得重复声明或回退内联匿名 + 三个 `@non-ui` 字段必须紧邻标注」。`@non-ui` 正则要求标签在**该字段自己的 doc comment 内**——首版用 `{0,400}` 宽泛窗口，被相邻字段的 `@non-ui` 满足（变异检查：去掉 `absPath` 的标注仍绿），改成逐注释块匹配后才精确变红。
### 全仓字段级摸排 + 信封 timing 落地（2026-09-21 续）

把摸排从 `diagnostics/` 扩到全仓后，**结论收窄**（这是本轮最重要的认知修正）：

- 全仓 `frontend/src` 共 **2707 个 interface 字段，263 个零读取（≈10%）**——但这是**噪音占比**，不是问题规模。绝大多数是**第三方格式类型**（`PmxMaterialData`/`FbxMaterialData`/`VrmBuildArtifacts` 解析后重整形）、**mock**（`IdbMock`）、**内部 UI 状态**，零读取多为合理。
- 收窄到**契约类 interface**（名字以 `Payload|Resp|Response|JSON|Snapshot|Echo|Summary|Info` 收尾）后：**194 个字段，仅 14 个零读取**，其中 3 个已在上一轮处理。**真正的问题面是 14 而非 263**——差点被大数字带偏方向。
- `scripts/check-orphan-exports.ts` **看不见这一层**（实测 `--min-consumers 3` 对 `perf-common` 零命中）：它管**导出符号**，而 `PerfIdentity` 被两个文件 import，不是孤儿。**盲区在符号之下的一层**——这正是要补的。

### 信封 `timing` 的真相（三轮修正，记下以免再错）

1. **首判错**（我说「Go 在白白计时」）：以为 `timing` 全仓无意义。
2. **二判修正**：`--format json`（CLI stdout）**根本不发信封**——`single-bench`/`scan-bench`/`concurrent-bench`/`health-report`/`version` 实测全是裸载荷（无 `status`/`command`/`timing`/`meta`）。信封**只走 GUI 桥路径** `internal/app/cli_bridge.go|ExecuteCLI`（`go/cli/cli.go` 两处 `NewJsonSuccess`/`NewJsonError`）。所以 `meta.platform` 有 7 处读取是自洽的。
3. **三判**：真正的缺陷是 `command`/`timing` 在**桥路径真字段**前提下全仓零读取，且 `timing` 用 `float64(time.Since(start).Milliseconds())` **整毫秒截断**——比业务载荷的 `durationMs`（纳秒精度）差一档，快命令（`version`/缓存查询）恒报 `0`，而 `0` 在本仓口径里是「没测到」。

**处置（按实用度）**：
- **修精度**：两处组装点改 `durationMs(time.Since(start))`，与包内唯一耗时出口对齐。护栏 `TestEnvelopeTiming_UsesDurationMs`（源码断言 `Milliseconds()` 不得回现 + `durationMs(time.Since(start))` 至少两处）+ `TestDurationMs_SubMillisecondNotTruncated`（500µs 必须为正，`Milliseconds()` 会得 0）。均过变异检查。
- **接消费端**：`perf-common.ts|sectionHeader` 增第四参 `timingMs`，渲染 `.perf-section-ms` 耗时徽标（`clock` 图标 + `toFixed(2)ms`），tooltip 说明「量的是命令本身，不含本页解析渲染」。三个 perf 区段（single-bench / concurrent / scan-bench）透传 `resp.timing?.total_ms`。**缺席或 0 一律不渲染**——印 `0.00ms` 等于把没测到包装成实测（ADR-278 §2.6）。两条变异检查（徽标恒空 / 去掉 `>0` 守卫）均精确变红。
- **`command` 不接**：调用方本就知道自己调了什么，界面渲染它是噪音；改加 `@non-ui` 标注（保留在契约里是为了让失败响应自证哪条命令失败）。**「能读却硬要读」与「该读却没读」要分开判**——这是本轮 `@non-ui` 体系的又一次实操。
- ⚠️ **曾误以为「日志面板是 timing 的自然归宿」**：`utils/base/primitives/log.ts` 的 sink 只有 `warn`/`error` 两级，而 error-diary 是**问题册**不是**流水账**——把每次 CLI 调用记进去是类别错误。**别为了「有个地方放」而污染诊断通道。**

### 摸排方法（可复用）

1. 枚举 `frontend/src/**/*.ts`（排除 `*.test.ts`/`*.d.ts`/`vendor`）的 interface 成员行（两空格缩进 + `?` 可选）。
2. 每字段统计**全仓**读取点：`(?:\.|\?\.)$field\b|\["$field"\]`——**必须查属性访问形态**，裸词会被注释命中。
3. 按 interface 名收窄到契约类，再回查 Go JSON tag 是否真在发。
4. ⚠️ **PowerShell 陷阱**：外层 `-match` 取 `$Matches[1]`、内层循环再跑正则 → 内层覆盖 `$Matches`，字段名被污染。**抓组后立刻落变量**。

### 可搜索性：字段级审计脚本落地（2026-09-21）

**问题**：`check-orphan-exports.ts` 只回答「这个**符号**有人用吗」。`PerfIdentity` 被两个文件 import，不是孤儿——可它的零读取字段正是盲区。**符号层之下没有工具。**

**落地** `scripts/check-unread-fields.ts`（审计模式 rc=0，`--strict` 升级阻断）：
- 提取 `frontend/src` 的 interface 成员 → 按属性访问形态统计全仓读取点 → 只报契约类 interface → 用 `@non-ui` 标注把「故意不渲染」与「疑似漏读」拆开。
- 当前实测：**可疑 12 条**（含 `CLIResponse.command`、`SizeInfo.{centerX,centerY,centerZ,maxDim,zChunks}`、`BoneSelectInfo.{localPos,localRot,cubeRot,cubePos}`、`PmxParseResponse.additionalDataFlags`、`RawGeometryJSON.identifier` 等），**`@non-ui` 豁免 3 条**。
- 这 12 条**尚未逐个定性**——多数看似第三方解析类型的中间态（`PmxParseResponse`/`SizeInfo`/`BoneSelectInfo` 由 adapter 产出后重整形），但**「看似合理」不等于核过**。下一步应逐条判「删字段 / 补消费方 / 补 `@non-ui`」，判完才谈接 doctor。

**踩坑（子代理实现漏掉的真 bug，主模型修）**：`findDocStart` 只认「上一行是 `*/`」的**多行**注释形态，于是**单行** `/** @non-ui … */` 紧贴字段时直接回退哨兵 → 已标注的 `ConcPayload.hints`、`PerfTypeSummary.cli_analyzable` **仍被报可疑**（豁免数 1 而非 3）。修法是补单行注释分支。
- ⚠️ 教训：这个 bug **恰好会让人误以为「标注没用」**——若不复核豁免明细就接受输出，会得出「@non-ui 机制不生效」的错误结论，进而可能去改一个本来正确的机制。**审计脚本自己的输出也要抽查明细，不能只看总数。**
- 该修复过变异检查：删掉 `hints` 的标注 → 可疑 12→13、豁免 3→2，且 `hints` 被点名。
### 12 条可疑的逐条定性 + 工具自身的重大缺陷（2026-09-21 续二）

**12 条分四类**（实地看过源码，不是看工具输出）：

| 组 | 字段 | 定性 |
|---|---|---|
| A | `SizeInfo.{centerX,centerY,centerZ,maxDim,zChunks}`（5 条，`litematic-adapter.ts`） | **真冗余**。第 105-119 行用的是**函数内局部 const**（`centerX` 等），算完存进 `sizeInfo` 后没人取；实际消费的只有 `sizeX/sizeY/sizeZ/xChunks/yChunks`（第 185/219/297-305 行）。**接口未导出**，纯内部中间态。 |
| B | `BoneSelectInfo.{localPos,localRot,cubeRot,cubePos}`（4 条，`model3d.ts`） | **非缺陷，是归属误判**。注释写明「`window._3dOnBoneSelect` 回调参数」，生产侧 `assembleBoneSelectInfo` 认真填、`bone-raycast.test.ts:123-170` 认真断言——**消费方是宿主页面，不在本仓**。 |
| C | `PmxParseResponse.additionalDataFlags` | 第三方 PMX 头字段原样透传，本仓不从 PMX header 取这项。 |
| D | `RawGeometryJSON.identifier?` | Bedrock 几何中间态，形状来自 MC 格式规范；**接口未导出**。 |

**A 与 B 的区别不在「零读取」而在「导出与否 + 有无外部消费方」**——工具只报零读取，判不了这个，所以定性必须人工。

### ⚠️ 本轮最重要的发现：工具存在结构性假阴性

读计数用「属性访问形态全仓匹配」，**它只认名字、不认归属**；零依赖文本解析做不到类型推断。

**可复现实证**（不是推测）：`filesRoot` 在 4 个 interface 里声明——`CLIData` / `PerfIdentity` / `ConcPayload` / `ScanBenchPayload`。其中 `PerfIdentity.filesRoot` 经上一轮人工核定为零读取（已加 `@non-ui`），但另外三个有 22 处读取 → **工具从不报它**。同组的 `absPath` / `rtype_source` 因名字全局唯一而照实报出——**同一结构里三个同性质字段，工具只抓到 2 个**。

**规模量化**：全仓 **451 个字段名跨 interface 重名**（`name` 出现在 **84 个** interface 里）；契约类 **219 个「已读」字段中 158 个（72%）读数归属存疑**。只有 61 个名字全局唯一、读数可信。

**为什么这个缺陷比误报危险**：误报会让人去核实（有摩擦力，能发现）；**假阴性静默通过**——报告全绿，人以为核过了。而且它恰好**长成「工具有用」的样子**。

**处置（不做假承诺）**：不假装能判归属（真做需 TS Compiler API，与本仓零依赖脚本风格相悖），而是**把不确定性印在报告里**——顶部新增「读数可信度」行给出可信分母，逐条带歧义者标注「← 名字跨 interface 重名」；JSON 同步 `contractReadAmbiguous` / `suspiciousAmbiguous` / `nonUiOkAmbiguous`。当前实测：`suspiciousAmbiguous=0`（12 条可疑的名字都全局唯一，**它们的零读取结论可信**）而 `nonUiOkAmbiguous=2`。

⚠️ **但 `suspiciousAmbiguous=0` 不等于没漏报**：歧义字段被洗白后**根本不进名单**。`PerfIdentity.filesRoot` 正是这种「可疑名单干净却仍漏报」的活证据——**别把「12 条可疑」读成「契约面已全核过」**。

### 工具踩坑（累计）

1. **单行 `@non-ui` 漏认**：`findDocStart` 只认多行注释（上一行是 `*/`），单行 `/** @non-ui … */` 直接回退哨兵 → 已标注字段仍报可疑。**这个 bug 会让人误以为「`@non-ui` 机制不生效」**，进而去改一个本来正确的机制。
2. **同名跨 interface 洗白**（本轮）：见上，结构性假阴性。

**共同教训：审计脚本自己的输出必须抽查明细，且要主动问「它可能以什么方式骗我」**——两个 bug 都属于「输出看起来合理，实际判别力缺失」。

### 12 条闭环：可疑 12 → 0（2026-09-21 续三）

按上表逐类处置，**可疑归零、豁免 10 条**：

- **A 组真冗余已删**（`litematic-adapter.ts|SizeInfo` 的 `centerX/centerY/centerZ/maxDim/zChunks`）：接口未导出、零消费者，留注释说明「需要时从 `sizeX/Y/Z` 现算（center = size/2，maxDim = max(…,10)），别再存一份」。删后 typecheck + vite build + preview-3d 2622 测试全绿——**删对了**。
- **B/C/D 组加 `@non-ui`**：`BoneSelectInfo` 四条（消费方是宿主页面 `window._3dOnBoneSelect`）、`PmxParseResponse.additionalDataFlags`（PMX 规范字段）、`RawGeometryJSON.identifier`（Bedrock 规范字段）。C/D 是第三方格式镜像——**类型要忠于规范，否则可选性/形状与真实 JSON 不符**，这是保留它们的正当理由。

### ⚠️ 第三个 `findDocStart` 形态（修第一个坑时自己挖的）

修复「单行 `@non-ui` 漏认」时，我把判定写成 `/^\s*\*\/\s*$/`（**收尾行必须只有 `*\/`**），于是**带尾文本的多行注释**被判为无注释：

```
/** @non-ui 骨骼局部坐标。消费方是**宿主页面**…
 * 不在本仓… 是跨界导出。 */        ← 收尾行 `*/` 前还有正文
localPos: number[];
```

结果 `localPos` 加了 `@non-ui` **却仍报可疑**（4 条全中）。正解：只要上一行**含** `*\/` 即视为注释结尾（`prev.includes("*/")`）。

**教训：修一类特例时要想「还有哪些同族形态」。** 注释收尾其实有三种写法——一行式 / 收尾行只含 `*\/` / 收尾行带正文；只堵住眼前那一种，就会把下一个形态留成新坑。变异检查确认修复是承重的：退回旧判定 → 可疑 0→4、豁免 10→6。

### 收尾：这份审计现在的可信度

- **可疑 0 / 豁免 10**，`--strict` 可安全接入。
- 但**读数可信度仍是 61/219**（158 个字段名跨 interface 重名）——`filesRoot` 那个假阴性**依然存在**，只是已知。**「可疑 0」指的是「名字唯一的那些字段都核过了」，不是「契约面全部核过」。** 要让结论覆盖到歧义字段，需要类型级归属分析（TS Compiler API）——与本仓零依赖脚本风格相悖，故有意不做，只在报告里公开分母。

### 前后端「对劲」从设计正确升级为漂移即红（契约补锁 + 刻意不根治的边界决定，2026-09-21）

用户就 bench tab（`#diag-perf-*`）锐评「前后端对劲」，查清后落地 WP1–WP4（纯加锁/注释订正，**零 Go 生产改动**），并把「为什么不根治」钉成可命中的判断——因这正是下一个人会重踩的决策点。

- **已锁的跨界契约**（`tests/test_cli_gui_flow_contract.ts` 新增 §3.7d / §3.7e，全过真绿）：
  - **§3.7d 默认值三端逐字对齐**：`iterations=3` / `max-models=5(单模型)·20(并发)` / `threshold=50` / `workers=4` 一次性钉死 Go `fs.Int`/`Float64` ↔ tpl `value=` ↔ 前端 `?? "N"` fallback 三端。立因：`perf_target_set.go` 自己把 flag 默认值称「哑弹」并归一化为 0，而前端 fallback 是同颗哑弹的镜像副本——三处手抄，Go 调默认忘改任一→控件缺席/异常态按旧值提交、护栏不红。
  - **§3.7e verdict / stage status token 集双端锁**：verdict 六档（Go 有 `stageVerdict*` 常量→锚 `= "v"`，前端 `BASELINE_VERDICT_META` 须有同名键）；stage status 的 `ok/slow/warn/bottleneck`+旁路 `failed`。立因：Go 加第 7 档、前端未跟上→静默落 `?? { icon: "⚪" }`，用户看不出这档（「兜底静默」盲区）。
- **stage status 刻意不提 Go 常量（重要）**：`bench_concurrent.go|stageStatus()` 是裸 `switch` 按耗时阈值（>100/>50/>10）产出，非命名常量集。为锁 token 而给它提一组 `statusXxx = "…"` const=为边际护栏动生产 switch + 其表驱动测（`cli_test.go|TestStageMarkAndStatus`），违「不碰骨架」。改走轻量法：正则从函数体抽 `return "x"` + 补 `failed`→逐个比对前端 `STAGE_STATUS_META`。**代价（诚实标注）**：Go 改了 return 字面量而函数体形状不变仍能绿——但前端漏映射新值仍红，方向安全。
- **`PERF_UNREAD_MODES`/`PERF_UNREAD_TARGETS` 的「读法漂移」刻意不根治（这是本节的判断重点）**：两张表是前端镜像 Go `singleBenchReadMode` 的读法。唯一真「根治」路=让 Go 声明「每个命令×模式×目标集实际吃哪几个 flag」、前端派生——但这是把「某控件此刻是否被消费」的展示层决策交回 Go，**正撞 AGENTS.md S3 收口的「输入端归 Go，展示端豁免」边界**（视图态每次击键本地响应，下沉 RPC 荒谬）。故保留镜像=边界两侧的合理分工（Go 拥有读法真相、前端拥有禁用态展示），**不是欠账**。本轮只用 `perf-mode.test.ts` 反向闸挡低级漂移（登记表每个 id 必须是 tpl 真实控件，幽灵 id 即红），深层「读法变了表没跟」归 review + 真相源注释管。
- **触发条件（满足任一再议根治，不凭「看起来不够干净」）**：① 目标集加第三根正交轴（8 控件→ 20+ 镜像表失控）；② 第三条命令加入共用目标集面（现只 single/conc）；③ 真因「读法改了表没跟」ship 了一次线上回归（用事故换立法）。
- **护栏**：上述均在 `test_cli_gui_flow_contract.ts`（§3.7d/3.7e）+ `perf-mode.test.ts`（登记面反向自审）。契约测验绿（6 个 stageVerdict 常量 / 4+failed status / 5 个默认值三端逐字对齐均真实存在，非假红）。
- **文案漂移附带订正**：「取样上限→最多模型数」一次未完成的迁移留下多处「注释冒充当前标签名」的失真（含与不变量直接矛盾的 `tpl.ts:26`「标签恒为取样上限」），保守改法：只修「当标签名引用」处，保留 `--max-models`/旋钮概念等合法用法；test 标题/describe 名是标识符非断言字面量，`toBe("最多模型数")` 未触碰。
- ⚠ **改 i18n / 文案时同步硬编码字面量**（本仓反复撞的账）：单测 fixture 直接写死中文、e2e 被 playwright 钉 `locale:en-US`——改 zh 不红 fixture、改 en 必红 e2e；本例只动注释/test 标题未碰 locale 值，无需重跑 `generate-locale-json.ts`。

### ADR-285 跑基准可用性收口（2026-09-20 首轮拍板，部分落地）

**这轮做了什么（一句话）**：把「跑基准」面板的按钮和文案收拾了一通——运行按钮挪到参数后面、并发按钮补上主按钮颜色、三语里重复的说明删掉、中/日界面里夹的英文 `workers` 换成当地话。全是文案/布局改动，没动 Go 和命令参数。

**怎么核实的（不靠猜）**：
- **面板上的控件都不是摆设**：一个个对照了 Go 的命令参数，`并发路数`→`--workers`、`取样上限`→`--max-models`、`迭代次数`→`--iterations`、基准三件套→`--baseline`/`--save-baseline`/`--threshold-pct`，每个都能落到真参数。唯一容易误会的是 `--workers` 其实是**「最多跑到这档」**：填 8 会实际跑 2/4/8 三档（`concurrentWorkerCounts` 取 `{2,4,workers}`，`go/cli/bench_concurrent_json.go`）——提示里写了，但标签读起来像「就是 8」。
- **三语翻译没缺、只是不够口语**：`node scripts/i18n-check.ts` 实测 1492 键 × 3 语 missing=0 extra=0。毛病是 5 类措辞：① 按钮的悬停说明把同一件事说了三遍 ② 中/日界面夹英文 `workers` ③ zh「最多模型数」在选『每个类型各取几条』时叫得名不副实 ④ 「测什么/测哪些」就差个单复数，看不出语义真变了 ⑤ 有些标签撞名。
- **防呆护栏在哪**（`perf-mode.test.ts`）：穷尽检查只数 `input/select`、**不数按钮**，所以按钮挪行不会触发；每个控件必须能说出「我在哪个模式可见、谁读我」，说不出的会红。

**已落地（P0 全批 + P1-1 + P3）**：
1. 三语 `perfConcurrentHint`/`perfScanBenchHint` 删掉结尾重复的「测的对象」尾巴。
2. 并发运行按钮补 `accent`（主按钮色），和单模型/引擎对照仨按钮一致。
3. 中/日 `workers` 本地化，且一步到位用终值：zh「最大并发路数」/ en「Max concurrent workers」/ ja「最大並列数」（键名没变，引用处不用动）。
4. **按钮移到参数后面**（先配置再点跑）：单模型的按钮从模型框那行拆出来、挪到基准三件套下面；并发的按钮挪到取样上限下面。
5. 文档：ADR-278 补了段说明，本卡记了这轮结论。

**有一项决定不做（P0-3）**：本想把 zh「最多模型数」改回「取样上限」，但一是会推翻 ADR-278 当年「取样上限是黑话」的结论，二是单测有断言锁死「最多模型数」（`perf-matrix.test.ts:610,615`）会连带 6+ 处——说它是「零风险」不实，于是保持原样。真要继续就另立 ADR 全量改。

**留到以后**：P1-2（公共区上移）、P1-3（分组显示）、P2-2（并发目标集改口带原因）、P2-3（scopeHint 前缀消撞名）。

**追查：`最多模型数` 名不副实，会不会是前后端对劲出了错？（2026-09-20 续）**

结论：**对劲没问题，是「设计如此」**。逐项实证：
- **参数传递是诚实的**：前端把输入框里的数字**原样**当 `--max-models` 传给 Go（`perf-single-bench.ts`/`perf-concurrent.ts`），不偷偷换算；Go 按 `--target` 展开（`go/cli/perf_target_set.go`）——`all` = 每类型各取 N 条（`groupPerfTargets`，**无总上限**，类型多时总数远超 N）、`repo` = 全库扁平 N 条（`capFlat`）、`rtype` = 该类型 N 条。e2e 锁「数字原样传 + 回显一致」，契约测试锁「target=model 绝不带 max-models」。
- **target=model 时这个数字根本不用**（单模型就一个，没「取几条」的事）。界面怎么处理：**输入框变灰**（`PERF_UNREAD_TARGETS` 目标集维）+ title 换成 `perfMaxUnreadHint`（「单模型目标下不生效（只在选了类型 / 全库时才用）」）——不是靠改标签，是靠置灰 + 悬停说明。
- **真正的可读性缺口**：这个输入框在 all 模式下是「每个类型都取 N 条」，但标签原叫「最多模型数」，读起来像「总共最多 N 个」。语义其实在 title 里（`perfMaxModelsHint`），但原文案没把「每类都取、类型多会翻倍」讲透。本轮已把三语 `perfMaxModelsHint` 改直白（zh：…每个类型都取 N 条（类型多时总数会远超 N）…），且 zh 标签改名「**最多跑几个**」（与「跑几次」对称，更贴语义；en「Sample cap」/ja「サンプル上限」本已中性不动）。
- **为什么标签不能跟着 target 变**：ADR-278 特意锁死「标签不随目标集改义」(e2e 用例 ⑦ + perf-matrix 墓碑)——因为旧版 `syncPerfCountLabel` 就是「标签跟着模式改义」那笔账，改回=重蹈覆辙。所以单位解释**只进 title、不进标签正文**是既定决策，不是漏写的 bug。

**模型路径框的目标集维收口（2026-09-20 后续，含一次反逻辑修正）**：
- 用户困惑：选了「类型/全库」目标集后，`#diag-perf-model` 路径框还亮着（它的显隐只跟模式 `data-perf-mode="single"` 绑定），填了却不进载荷——「填了没用」。
- **第一次实现是错的（登记进 `PERF_UNREAD_TARGETS`）**：那张表的语义是「枚举**不读它**的目标集」，`max`/`order` 登记 `["model"]` = 单模型时灰（单模型没有 N 条）。但模型路径框**恰好相反**——它只在单模型才读、非单模型才灰，且非单模型的目标集（rtype 动态类型）**不可枚举**。照搬 `["model"]` 导致**单模型反而被置灰**，用户一眼抓出（「灰色逻辑写反了」）。
- **正确实现**：不走表，显式 `modelInputNeeded = mode==="single" && targetKey==="model"`，`disabled = !modelInputNeeded`（与 `syncPerfBaselineControls` 同口径）。加回归测试「单模型亮 / 全库灰」防再写反。
- **教训**：`PERF_UNREAD_TARGETS` 是「枚举不读面」，只适合「在少数静态目标集不读」的控件；「除某类外全不读」的控件必须显式判断，塞表里必然方向反或漏枚举。
- **为什么不整组隐藏**：基准三件套已由 `syncPerfBaselineControls` 按目标集置灰，且 ADR-278 §2.6 明确倾向「置灰 + title 说清」而非隐藏（隐藏=用户不知道有这个功能）。故维持置灰体系。
- **布局**：单模型专属行（路径框 / 跑几次 / 上限 / 基准 / 运行按钮）已挪成连续一块，与并发的（并发路数 / 上限 / 运行按钮）分开——选哪种模式就看哪块，不再交错穿插。
## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`go-logs`、`go-repoaudit`、`app-content`
- `frontend/src/views/app-content/css/content-diag.ts` — 诊断/工坊样式层（主卡持有）
