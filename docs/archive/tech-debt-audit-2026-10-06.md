# YSM 模型管理器 — 技术债探索报告（2026-10-06）

> **⚠️ 活指针（时点快照，非现行状态，2026-10-09 归档）**：审计基准 ≈ commit `57993440c`（§二复跑点）。现行账实以 `docs/knowledge/tech-debt-ledger.md`（10-08 各轮 + 第三轮 20:42 段）为准。
> 已知失效项（动手前必读）：P1#2「拆 molang」= 假靶（10-07 `ff5495150` 已把 vendored `molang-lib` 列入 `VENDORED_DIRS` 排除）；P1#3「caps 纳入硬红线」= 10-06 当日已补登（台账 T5 自认 drift）；P1#4 zzz-fm 卡 / P2#9 `.tmp_commit_diff.txt` = 已清；P2#8 半修（`perf-fixtures` 4 处 10-08 才清）；§十一 736/623 口径已被 §十二 实测 114 取代。§九根因 5 条与文末复现命令清单在归档正文内仍可供查阅。

> 审计基线：ADR-034（2026-08-04 遗留债盘点）+ 本次三路侦查（Go 侧 / 前端侧 / 治理工具链侧）+ `doctor` 全量闸门 + 主线程独立核实。
> 方法：只读侦查，未改任何代码。所有结论均带文件:行号或命令输出为证。

---

## 一、总体判定

**健康度：🟢 优（防恶化机制极有效，存量债透明化良好）**

三条回归红线全通过、`tsc --noEmit` 零错误、类型擦除为零、循环依赖 0、生产 Go 代码 TODO/FIXME 仅 9 条、`jscpd-go` 无新增重复对、i18n 死键已从 182 清到 17。

但 **ADR-034 的 4 大方向修完后，债务「迁址」而非「消失」**：8 月的 site-view.ts 拆分成功后，新债集中在 `preview-3d/caps/` 大文件族与治理工具自身。这是本次探索最值得注意的结构性结论。

---

## 二、doctor 全量闸门实测（2026-10-06）

`node scripts/doctor.ts`（--all）：**61 项 / 60 通过 / 1 失败 / 总耗时 566s**。

**首次跑 2 项 FAIL，复跑 61/61 全绿**：
- `test_commit_clean_staged_filter.ts` 未登记 `CONTRACT_TEST_DOMAINS`（新契约测试漏标验证域）
- `gen-docs-index.ts --check`：`knowledge/index.md` 过期

> 两项均为在途改动，已被最新 commit `57993440c`（ADR 进度化石清理）修复：补 `scripts/_lib/contract-tests.ts:63` 的 `CONTRACT_TEST_DOMAINS["test_commit_clean_staged_filter.ts"]` 登记并刷新 index。复跑（`.git/gate-report-2026-10-05T17-35-15-556Z.json`）**61/61 全绿**。

**耗时 Top 5（维护成本信号）**：
| 检查 | 耗时 |
|---|---|
| `cd frontend && npx vitest run` | 168.7s |
| `go test` 全包 | 90.4s |
| `node scripts/css-token-check.ts` | **88.4s** |
| `contract tests (115, 全量)` | 87.6s |
| `npx tsc -p scripts/tsconfig.json` | 18.9s |

> `css-token-check` 88s 是全库扫 CSS 裸值，未进静态工具清单（走前端域检查），`--all` 模式无 diff 裁剪，每次 doctor 都付出这 88 秒。

---

## 三、量化债务全景

| 维度 | 数字 | 来源 |
|---|---|---|
| 复杂度债 | **302 errors**（52 🟥 / 56 🟠 / 194 🟡） | `check-complexity.ts` |
| 行数红线 | 仅 3 个文件登记，`preview-3d/caps/*` 900+ 行脱管 | `check-file-lines.ts` |
| 事件监听 | addEventListener 270 / removeEventListener 96，48 生产文件不配对 | 前端子代理实测 |
| 分层基线 | 17 条唯一边长期=基线（零增长但不清） | `check-layering.ts` |
| 红线基线 | 57 条违规冻结（多为测试/CSS 字面量误报） | `check-redlines.ts --baseline` |
| 孤儿导出 | 6 条（unregisterDevtools / fbm2 / registerWaterBodyStrategy / uiIconNames 等） | `check-orphan-exports.ts` |
| i18n 死键 | 17 个（占 1542 键 1%） | `check-i18n-unused.ts --baseline` |
| Go 覆盖率 FAIL | `go/ysmwasi` 33.3% / `go/wasispike` 0% / root 19.6% | `check-go-coverage-threshold.ts` |
| 知识卡覆盖 | 52 个 frontend/src 文件无任何知识卡引用 | `check-knowledge-drift.ts` |
| 部分采纳 ADR | 14 个登记为 debt（全 P3） | `check-adr-health.ts` |
| 治理脚本规模 | **196 个 .ts / 50,310 行**，8 个超 700 行 | 主线程统计 |
| 仓库规模 | 5097 commits / 3049 tracked 文件 / 66.95 MiB pack | git |

---

## 四、六大类债务详述

### 4.1 复杂度债（🔴 最高，且近 2 个月恶化）

`check-complexity.ts`：**302 errors，52 个 🟥 RED 函数**（8 月 gate-config 注释记录是 27 个 🟥——**2 个月翻倍**）、56 个 🟠、194 个 🟡。

最严重 RED 函数：
| 函数 | 位置 | 认知复杂度 |
|---|---|---|
| `Molang` | `frontend/src/utils/animation/molang-lib/molang.js:11` | **876** |
| `bindRoving` | `frontend/src/utils/dom/bind-roving.ts:70` | 139 |
| `parseBedrockGeometry` | `preview-3d/model/spec-builder.ts:152` | 129 |
| `buildPmxScene` | `preview-3d/adapters/mmd/mmd-pmx-parser.ts:68` | 125 |
| `webAnalyzeBedrockModel` | `backend/web-fs-bedrock.ts:286` | 117 |

集中在 `parsers/*`（`ysm-header.ts` 多个 >70）与 `preview-3d/adapters/mmd/*`。子代理实测：**无复制粘贴、无死代码、无循环依赖**——属固有结构复杂，需靠拆分而非清码。

> 根因：`molang.js:11` 的 Molang 解析器认知复杂度 876 是单一巨型函数，是全项目复杂度债的「单点之王」。

### 4.2 大文件治理盲区（🔴）

`check-file-lines` 硬红线只登记 3 个前端文件（mount-preview-core 1045 / water-capability 655 / vrm-adapter 790），而：

- `sky-capability.ts` **1068 行**，已超过 mount-preview-core 的红线值 1045，**却无人拦截**（只有 advisory）
- 生产文件 Top10 中 **8 个属 `preview-3d/`**（sky 1068 / web-fs 1064 / mount-preview-core 1037 / postprocessing 955 / light 943 / ground 932 / env-state-schema 925 / environment 917）
- >500 行生产文件共 **35 个**

**这是「打地鼠」式治理的直接证据**：ADR-034 拆掉 site-view.ts 后，债务迁至 `preview-3d/caps/`，行数红线覆盖面没跟上。

> 子代理 B 的关键建议：`light-capability.ts`（ADR-177）已示范拆 4 份范式，其余 7 个 caps 未跟进——把该范式复制到 sky/ground/postprocessing/environment，并把 caps/ 族纳入 `check-file-lines` 硬红线。

### 4.3 事件监听未成对（🟠）

addEventListener **270** / removeEventListener **96**，48 个生产文件不配对；`onclick=` 57 处逐元素绑定。

- ADR-034 §5.1 的 `recycle-bin.ts:324-357` 已收编委托+teardown+防御 `innerHTML=""`（✅ 已修）
- 但范式**未扩散**到 `download-queue.ts:159`、`preview-3d/menu/*`、`settings/*` 等

### 4.4 分层基线债失去灵敏度（🟠）

- `check-layering` R3/R4/R8 = 17 条唯一边（=基线，零增长但不清）
- `features/dialogs/rename.ts:27-37`、`tag-editor.ts:30-86` 仍写 HTML 字面量（R8）
- `views/app-preview/*` → `preview-3d/decoder` 15 条反向边
- `env-state-schema.ts` → `caps/ground-surface-spec.ts` 反向

> 根因：基线债长期「零增长但不清零」，闸门对存量失去灵敏度——17 条长期等于基线，门禁形同虚设于这些边。

### 4.5 Go 测试盲区（ADR-034 已清，但新增 3 个）

**ADR-034 §2.2 的 3 个零测试包已全部清收**（超出预期）：

| 包 | ADR-034 断言 | 现状 | 状态 |
|---|---|---|---|
| `go/version` | 6 行零测试 | `version_test.go` 已补 | ✅ 已清 |
| `go/logs` | 121 行零测试 | 6 测试文件，覆盖率 **97.7%** | ✅ 已清 |
| `go/litematic` | 4,889 行零测试 | 10 源 + 9 测，覆盖率 **90.6%** | ✅ 已清 |

**新增 3 个盲区**：
| 包 | 现状 | 严重度 |
|---|---|---|
| `go/ysmwasi` | 覆盖率 **33.3%**，低于 50% 阈值 | 🔴 P1 |
| `go/wasispike` | **0% 覆盖率**，0 测试，spike 使命已完成（ADR-316 生产化） | 🟠 P2 |
| `go/rustbridge` | 全部 `//go:build rust_backend`，默认构建零测试（CI 才跑） | 🟠 P2 |

> 根因：`wasispike` 与 `rustbridge` 的测试隔离策略**方向相反**——spike 无 build tag 被默认测试覆盖（暴露 0% 红灯），生产 rust 路径反而用 tag 隐藏。ADR-316 生产化时把 spike 代码留在默认构建里、却把生产路径藏起来。

### 4.6 治理工具自身复杂度债（🟠，本次最有价值的独立发现）

**scripts/ 共 196 个 .ts / 50,310 行**，8 个超 700 行：

| 脚本 | 行数 |
|---|---|
| `_lib/design-tokens.ts` | **1391** |
| `check-redlines.ts` | 965 |
| `port-align.ts` | 947 |
| `check-knowledge-drift.ts` | 923 |
| `event-graph.ts` | 892 |
| `check-design-tokens.ts` | 821 |
| `token-shift-audit.ts` | 755 |
| `check-go-diff-coverage.ts` | 751 |

**功能重叠**：3 个 CSS 治理脚本并存（`css-token-check` 424 行 / `check-design-tokens` 821 / `css-layer-check` 727）；`check-design-tokens` 在门禁里挂载 2 次（`--baseline` 全量账本 + `--added-lines` 行级增量，ADR-256 设计内）。

**门禁脱节**：`css-token-check`（88s 最慢检查之一）门禁清单挂载=0，只走前端域检查，`--all` 模式无 diff 裁剪每次付 88 秒。

---

## 五、治理盲区（门禁未挂全）

doctor 报告的「覆盖口径」明示：**6 个 check-\* 脚本未接入门禁**——刻意旁路 4 个（check-biome-lines / check-diff-coverage / check-go-coverage-threshold / check-twin-siblings）+ 未接入 2 个（check-comment-history / check-unread-fields）。

**特别值得注意**：`check-go-coverage-threshold` 被旁路，导致 **`go/ysmwasi` 33.3% 与 `go/wasispike` 0% 的覆盖不足在推送时不会被阻断**。这是「全绿 ≠ 仓库无风险」的活例。

另：`check-go-coverage-threshold` 只读 `.coverage/go-cover.out` 里 `go/` 条目，对 root 包判 0%，实际 `go test ./ -cover` 是 19.6%——**脚本阈值口径与实际测试命令不同步**。

---

## 六、ADR 与文档治理

- **317 ADR**：294 已采纳 / 10 部分采纳 / 8 已取代 / 3 提议中
- **14 个部分采纳 ADR 登记为 debt**（全 P3，`check-adr-health`），多为演进正常（被后继 ADR 吸收）
- **3 个提议中**：ADR-284（sky 参数解耦）/ ADR-292（env 归属）/ ADR-301（频道命名收敛）——9 月 20-24 提出，**滞留 2 周未拍板**
- **ADR-034 明确「ADR 只记决策方向，不记实施进度」**，但 42 个 ADR 仍含「排期/待办/未完成」字样（部分为合理表述，部分是历史漏网）
- **193 张知识卡**：174 active / 4 archived / 3 draft / 2 superseded / 1 snapshot；孤儿 source_file **0 个**（全部指向真实文件）

---

## 七、仓库卫生债（独立发现，最易修）

| 债务 | 位置 | 处置 |
|---|---|---|
| **临时文件被 git 跟踪** | `.tmp_commit_diff.txt`（9 月 25 日误提交，内容是 commit 头部） | `git rm` + 补 .gitignore |
| **测试夹具混入生产文档** | `docs/knowledge/zzz-fm-delimiter-tmp.md`（kind=`zzz-fm-delimiter-tmp`，名字就叫「重排事故模拟卡」） | 移到 `tests/` 或加测试标记 |
| **知识卡 frontmatter 损坏** | 同上，`***` 代替 `---`，整卡被当正文序列化（`check-knowledge-drift` ERROR） | `git log` 定位回滚或重组 frontmatter |
| **一次性审计文档散落** | docs 根目录 4 份 10-05 审计 critique（audit-env-review / audit-postprocessing-critique / audit-water-critique / audit-doc-utility，约 100KB） | 归档到 `docs/archive/` |
| **spike 代码滞留** | `go/wasispike/main.go`（149 行，使命已完成）+ `probe.mjs` | 补 `//go:build wasispike` 或归档 |
| **跨平台硬编码残留** | `scripts/android-build.ts:80` `C:\Android\Sdk`；`frontend/e2e/perf-fixtures.ts:460,578,724,842` 四处 `C:\Users\zhujieling11\...` | 改环境变量 / `path.resolve` |

---

## 八、跨平台（ADR-034 §2.5）逐条核实

**10 项：6 已清 / 3 部分修 / 1 未修**。

- ✅ 已清：wasm_decoder node.exe（随 ADR-316/317 连根拔除）、cli.go YSMParser.exe、recycle/installer syscall、logs 注释漂移、frontend tpl.ts %APPDATA%、community/settings.ts %APPDATA%、updater helper build tag（共 7 项实质已清，含 §2.5-1/2/5/6半/7/8/10）
- 🟡 部分修：updater Windows-only（错误类型化但硬拒，设计有意）、app_config Windows 盘符（已拆 build tag 隔离）、build-release.ps1（bash 版已补但 `release.ps1` 无对称）
- ⬜ 未修：`go/tags/tags.go:2` 注释仍写 `%APPDATA%`（实际用 `os.UserConfigDir()`）

---

## 九、根因级发现（5 条）

1. **「治理打地鼠」：拆 A 长 B**——ADR-034 拆掉 site-view.ts（1314→110 行）后，债务迁至 `preview-3d/caps/` 族；行数红线覆盖面没跟上，`sky-capability.ts` 1068 行超红线值却无人拦截。**治理规则与债务位置错位**。

2. **复杂度债在恶化而非收敛**——RED 函数 2 个月从 27 涨到 52。`light-capability.ts`（ADR-177）已示范拆 4 份，其余 7 个 caps 未跟进，缺执行纪律。

3. **基线债「零增长但不清零」**——check-layering 17 条、check-redlines 57 条长期等于基线，闸门对存量失去灵敏度。基线机制防恶化有效，但**永远不归零**意味着门禁在这些边上是摆设。

4. **Go 测试隔离策略方向相反**——wasispike（spike）无 build tag 被默认测试覆盖（0% 红灯），rustbridge（生产）反而用 `rust_backend` tag 隐藏。ADR-316 生产化时把两者弄反了。

5. **治理工具自身成为债务**——196 个 .ts / 50,310 行，8 个超 700 行（`design-tokens.ts` 1391 行），3 个 CSS 治理脚本功能重叠，`css-token-check` 88s 未进静态清单。**治理复杂度本身不设上限**。

---

## 十、建议优先级

### 🔴 P1（本批最该做）
1. **补 `go/ysmwasi` 覆盖率到 50%**——Decode 主路径/护栏/畸形输入单测（对齐 `ysmwasi_test.go` 已锁的 imports 闭集）
2. **拆分 `molang-lib/molang.js` 的 `Molang` 函数**（认知复杂度 876，单一巨型函数，全项目复杂度单点之王）
3. **把 caps/ 族纳入 `check-file-lines` 硬红线**——sky-capability 1068 行已超红线值，先登记再拆
4. **修复 `zzz-fm-delimiter-tmp.md`**——frontmatter 损坏（`***`）+ 测试夹具混入生产文档 + tracked 污染，`git log` 定位回滚

### 🟠 P2
5. 复制 `light-capability.ts` 拆分范式到 sky/ground/postprocessing/environment 4 个 caps（治「拆 A 长 B」）
6. 给 `go/wasispike` 补 `//go:build wasispike` 或归档
7. 统一 `check-go-coverage-threshold` 判定口径（跑 `go test ./go/... ./internal/app/... ./ -cover` 全量）
8. 事件范式（recycle-bin 已示范）扩散为默认：`download-queue.ts:159`、`preview-3d/menu/*`、`settings/*`
9. `git rm .tmp_commit_diff.txt` + 补 .gitignore

### 🟢 P3（随手闭环）
10. `go/tags/tags.go:2` 注释改 `os.UserConfigDir()` 描述
11. `scripts/android-build.ts:80` 硬编码 `C:\Android\Sdk` 改 `ANDROID_HOME`
12. 4 份一次性审计 critique 归档 `docs/archive/`
13. `test_commit_clean_staged_filter.ts` 补 `CONTRACT_TEST_DOMAINS`（门禁 FAIL 修复）
14. 3 个提议中 ADR（284/292/301）拍板或关闭

---

## 附：ADR-034 债务核实总表

| ADR-034 方向 | 状态 |
|---|---|
| §2.1 site-view.ts 拆分 | ✅ **已完成**（1314 → 110 行，拆成 site/ 下 7 模块） |
| §2.2 Go 测试盲区（version/logs/litematic） | ✅ **全部已清**（覆盖率 90.6%-97.7%） |
| §2.3 治理违规（ADR-011/012） | ✅ **已清零**（bindings 直接 import 0 处、反斜杠自拼 0 处） |
| §2.4 契约测试扩充 | ✅ **已大幅推进**（tests/ 从 8 件涨到 116 件，含 binding 契约） |
| §2.5 跨平台 10 项 | 🟡 **6 已清 / 3 部分修 / 1 未修**（tags.go:2 注释） |
| §5.1 recycle-bin 双绑定 | ✅ **已修**（`recycle-bin.ts:324-357` 收编委托+teardown），但范式未扩散 |

---

*审计方法：3 路子代理并行侦查（Go 侧/前端侧/治理工具链侧）+ 主线程 `doctor` 全量闸门 + 独立核实。所有数字均可复现：`node scripts/doctor.ts`、`node scripts/check-complexity.ts --json`、`node scripts/check-redlines.ts --json --baseline`、`node scripts/check-go-coverage-threshold.ts --json`。*

---

## 十一、治理工具链侧深度发现（第三路子代理补登）

以下 8 条为工具链侧子代理带回的独特发现，前几章未覆盖，**其中第 1 条是本项目被静默跳过的最大存量债**。

### 11.1 golangci-lint 736 条存量债（🔴 全项目最大被跳过债）

doctor 输出中 golangci-lint 块明确跳过：
> "无法解析 --new-from-rev 基线… **全量跑会撞 736 条存量债（errcheck 623 占 85%）**，故跳过而非阻断"

即：**Go 侧 736 条 lint 违规从未被门禁看到**，其中 errcheck（未检查错误返回值）623 条占 85%。这些是真实的生产债——错误被静默吞掉。doctor 把它跳过而非阻断，属合理权衡（避免推送恒红），但债本身一直在。**这是 Go 侧最大的一块隐藏债，比覆盖率盲区严重得多。**

### 11.2 ADR 实施进度化石 ~250 篇（🔴 文档侧最大债）

AGENTS.md 元规则明令「ADR 只记决策方向，不记实施进度」，但仓内 **约 250/330 篇 ADR 仍含「遗留/待办/排期/实施进度/TODO/已确认/可行性已解除」化石**。

最新 commit `57993440c`（"ADR 进度化石清理"）**只修了 24 篇**，剩余 **~226 篇** 仍污染。ADR-017 11 处、ADR-126 13 处、ADR-272 9 处。这是文档侧最大的一块债——ADR 承载了不该承载的东西。

### 11.3 ADR-034 §2.4 落地路径漂移（🟡 需回写）

ADR-034 §2.4 原方案：新增 `tests/test_binding_contract.ts` 扫描 bindings。**实测 0 张该文件**——实际由 `scripts/binding-check.ts`（Go 176↔JS 176 issues=0）+ `frontend/scripts/check-binding-usage.ts` + `web-binding-check.ts` 三工具覆盖。

> 方向正确（Go Binding 契约已守护），但 **ADR 写的具体文件名已演化，未回写**——后人若按原方案会建一张冗余测试。建议 ADR 只记不变量，实现工具记知识卡 `fe-go-boundary.md`。

### 11.4 ADR-042 / ADR-321 脱节残留（🟡）

- **ADR-042** §2.2 内嵌「> 已确认：C++ 解析器…已从二进制直读」「> 可行性已解除」等进度/验证记录；§2.3 收敛度、`### 实施顺序` 段均为进度化石。与 `57993440c` 同类，需清理。
- **ADR-321** 状态行「实施状态：查知识卡（ADR 只记决策方向，不记实施进度）」——**指针本身是反模式的实现**。AGENTS.md 明令「ADR 状态字段只记生命周期」。

### 11.5 脚本职责重复簇（🟠）

- **6 个 coverage 类脚本**职责重叠：`check-diff-coverage` / `check-go-coverage-threshold` / `check-go-diff-coverage` / `e2e-coverage-report` / `test-coverage-report` / `line-counter`
- **6 个 `gen-knowledge-*` 生成器并存**：`gen-knowledge-{adr,autogen,h1,index,symbols,tests}`——建议收口为 `gen-knowledge.ts --section <x>` 单入口

### 11.6 CI 双轨不同步（🟠 架构级）

本地 `pre-push-gate.ts --all` 与 CI `test.yml` 各自独立承担 vite build/vitest/go test。CI 刻意用 `--static` 而非 `--all` 避免重复付费，但**每次新增检查要在本地 gate + CI 两处注册，漏一处就出现"本地红 CI 绿"或反向**。

**建议**：把 `ALL_STATIC_TOOLS` / `ALL_DOMAIN_TOOLS` 收敛为 `scripts/gate-inventory.json` 单一事实源，本地与 CI 都读它。

### 11.7 知识卡覆盖盲区细节（🟡）

- **5 张卡无 `source_file`**：`android-dev` / `extensibility-index` / `extensibility-round2` / `README` / `routes-quick`（index/README 类可豁免）
- **22 张卡含占位/过时锚**（TODO/待补/占位/anchor）
- **49 个 use_when 关键词被多张卡共用**（路由歧义，如「3D 预览」→ app-preview/go-threejs/preview-core 三张）
- 已确认：孤儿 source_file **0 个**（第 7 章）

### 11.8 CI 文件体量与重复样板（🟢）

- `test.yml` **414 行**，大量 20-40 行长注释块说明 PowerShell 路径解析坑、`git fetch` depth 陷阱等——建议迁到 `docs/knowledge/ci-gotchas.md`
- **三套 e2e job 重复 6 步 setup 样板**（checkout → pnpm/action-setup → setup-node → 缓存 Playwright → install → Chromium）×2 ——建议抽 composite action
- ADR 编号空缺：`ADR-009` / `ADR-078`（疑似历史废弃未登记），327/330 登记一致、零撞号

---

## 十二、补充建议（合并工具链侧）

### 🔴 P1（新增）
15. **errcheck 建 baseline 冻结存量，新增即阻断（2026-10-06 实测评估）**——实测 `golangci-lint run ./go/...` 6.6s 跑完，errcheck **114 条**（doctor 所述 736 为含其他 linter 的全仓数；623 是 --new-from-rev 基线下按改动行放大估算）。**不建议 `--fix` 批量机械修**：errcheck 每条需人工判断语义（log / return / 有意忽略），`golangci-lint --fix` 对 errcheck 无效；机械加 `//nolint:errcheck` 又违反 AGENTS.md「新注释必须携带代码读不出的信息」（纯噪声注释反而掩盖真实风险）。**正确路线 = 复用项目既有 baseline 范式**（对标 `scripts/baseline/redlines-baseline.json` / `jscpd-go-baseline.json`）：建 `errcheck-baseline.json` 冻结 114 条存量，doctor/gate 接入 golangci-lint 时以 `--new-from-rev` + baseline 只阻断新增，存量按包分批人工清（优先 `os.Remove`/`tmpFile.Close` 这类可安全忽略的）。
16. **给 ADR 加"进度文本"硬门禁**——扩展 `check-adr-health.ts` 加正则（`实施进度|待办|排期|已确认：|可行性已解除`），一次性清 ~226 篇存量后长期保持。

### 🟠 P2（新增）
17. **建 `scripts/gate-inventory.json` 单一事实源**——本地 pre-push-gate 与 CI 都读它，消灭双轨不同步
18. **按域合并 check-\* 与 gen-knowledge-\***——6 coverage 收 2、6 gen-knowledge 收 1
19. **ADR-034 §2.4 状态改「✅ 已解决（经三工具，非原文件）」**——避免后人建冗余测试
20. **ADR-042 / ADR-321 与 `57993440c` 同款清理**——进度记录迁知识卡，ADR 只留不变量