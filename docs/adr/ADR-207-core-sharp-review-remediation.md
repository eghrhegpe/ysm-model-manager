# ADR-207：frontend core 锐评整改：去重键净化后判定 / AppError 跨语言契约 / tr-trDynamic 双入口 / 残留占位符守卫

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-09
- **决策人**：Jieling（人类首席架构师）、AI 代理（锐评发起 + 整改实施）
- **相关**：[ADR-189](./ADR-189-frontend-core-backend-utils-core-feedback.md)（core 准入 D1/D4/D6 注释纪律）、`docs/knowledge/core-error-diary.md`、`docs/knowledge/i18n.md`

---

## 1. 背景（Context）

ADR-189 收敛 `src/core` 目录（断 core⇄backend 环 + 准入准则）后，2026-09 对 `frontend/src/core` 二次锐评，实测留下五处未收敛：

| 现象 | 实证 |
|------|------|
| **P1 去重键用净化前原文** | `core/error-diary.ts` `logUiMsg` 先以原始 `msg` 算去重键、后做净化：仅路径段不同的两条原始消息去重键不同 → 双双落盘，净化后 title/detail 近乎逐字相同；单槽 last-dedup 令 A-B 交错风暴逐条穿透，注释「按设计逐条记录」把弱点粉饰成设计 |
| **P1 AppError 文案跨语言无契约** | `stripPathSegments` 正则匹配 Go `AppError.Error()` 拼的 `源路径：`/`目标路径：`（全角冒号）token；Go 改文案前端静默失效、内部路径漏进日记（ADR-051 红线），两侧均无机械锚点 |
| **P2 tr() 类型洗白 + 插值半套** | `tr(key: LocaleKey \| (string & {}))` + 体内 `as LocaleKey` cast 放行动态 key 不检查；`LocaleParams` 全放行——模板含 `{n}` 而调用漏传参时裸占位符上屏，无测试覆盖该类 bug |
| **P2 注释考古化（D6 未落地）** | error-diary 注释占比近 45%（ADR-189 D6 自认「首个治理样本」后未收敛）；P2/P3/P4 修史标签、`（2026-XX P2-1 抽取）` 占位日期嵌在源码；`warnedKeys` 可变 Set 跨模块导出（smell 被注释记录而非重构） |
| **P3 附带发现** | ① `scripts/gen-knowledge-autogen.ts:392/435` 用 `String.replace(正则, 替换串)`，替换串含 frontmatter 的 `$&/$1` 序列 → `$&` 展开为整个旧 frontmatter，`docs/knowledge/i18n.md` 被反复自追加（15 层重复 frontmatter 实锤）；② `utils/base/log.ts` 4 条 `eslint-disable` 残留（门禁是 biome）；③ app-toast `import { t as tr }` 别名与 core `tr`（安全取值）语义撞名 |

## 2. 决策（Decision）

### D1 去重键改净化后判定 + 按 key 窗口 Map（error-diary）

- 去重键 = `status + 净化后 title`（先净化 + 剥 emoji + 截断，后算 key）：仅路径段不同的原始文本塌缩为同键 → 同类错误 5s 窗口内落一条。
- 单槽 last-dedup → `dedupAt: Map<string, number>`（按 key 独立 5s 窗口；`DEDUP_MAX_KEYS = 32`，超限淘汰时间戳最旧项）。
- 语义变化：A-B-A 交错风暴**按 key 各自抑制**（取代原「交错风暴逐条记录」注释粉饰）；33+ 种错误风暴淘汰最旧后 fail-open 重新记录（宁可多记，不可静默吞）。
- 理由：去重语义是「同类错误」，同类由净化后文本定义；单槽 last-write 是早期简化，Map 在有界 cap 下 O(1)。

### D2 AppError 文案契约下沉 + 共享 fixture（跨语言）

- 纯函数 `stripPathSegments`（error-diary 私有）下沉 `utils/base/apperror-text.ts`，更名 `stripAppErrorPaths`——名字声明契约主体（Go AppError 文案），位置声明分层（utils/base 零依赖叶，Node 契约测试与 vitest 双端可引）。
- 共享 fixture `tests/fixtures/apperror-sample.json`（withPaths / noPaths 两条规范 Go 输出）：
  - Go 侧 `go/types/apperror_test.go` 钉 `AppError.Error()` 全串 == fixture（文案漂移 → Go 测试红）；
  - Node 契约测试 `tests/test_apperror_strip.ts`（登记 `CONTRACT_TEST_DOMAINS: ["go","frontend"]` + `CONTRACT_TEST_TARGETS` 精确文件）读 fixture 跑 `stripAppErrorPaths`，断言路径段已剥、描述/操作/建议保留。
- 正则本体不变（对 Go 输出已实证），只搬家 + 改名。知识卡 `core-error-diary` 的 `invariant_anchors` 增补 `go/types/types.go|AppError`。
- 理由：跨语言契约要双侧机器锚点，fixture 是单一事实源；Go 文案变更先红 Go 测试 → 同 PR 同步 fixture + 前端正则，杜绝静默漏剥。

### D3 i18n 双入口：`tr`（严格 LocaleKey）+ `trDynamic`（string）+ `tOf`（内部 string 版 t）

- `tr(key: LocaleKey, fallback, params?)`：字面量 key，拼错编译期报红（原 `LocaleKey | (string & {})` 洗白路径退役）；
- `trDynamic(key: string, fallback, params?)`：数据驱动 key（`labelKey/group` 数据字段 + 原文兜底，cap-controls / 右键菜单 tpl / FPS 选项等 ~30 处）；
- 二者共享 `tOf(key: string, params?)`（string 版 t：缺失键返回 key 本身 + 单次告警，`v === key` 判定语义单一事实源不变），`as LocaleKey` cast 全部清除（LocaleKey → string 自然子类型，无需 cast）；
- `interpolate` 增**残留占位符守卫**：替换后文本仍含 `{ident}` → 按残留签名 `console.warn` 一次（堵「模板有 `{n}` 漏传参」静默裸占位符类 bug；调用处传 key 作诊断上下文）；
- `warnedKeys` 可变 Set 收编 `locale.ts` 内部，对外只暴露 `warnMissingKey(key)`（跨模块可变导出变 API）；
- app-toast `import { t as tr }` → `import { t as translate }`（消与 core `tr` 的撞名，单参 t 语义不变）。
- 命名裁决（不做的与理由）：diary 全家（`DiaryEntry/DiarySink/DiaryStatus/DiaryHandle/registerErrorDiary`）与 `PageStore/registerPageStore/isValidPage/sanitizePage/resolveInitialPage` **保留**——diary 是 ADR-189 D1 + 知识卡 + Go 侧既定隐喻，生产 import 面仅 2 文件，改名纯 churn；`LocaleParams` 保持 `Record<string, string|number>`（key→params 签名绑定需生成器，收益不成比例，残留守卫已覆盖主要风险）。
- 理由：严格入口与动态入口共用一个名字 + cast 是「想同时服务两类调用方」的洗白设计；拆开是诚实 API，字面量站点免费获得编译期检查。

### D4 D6 注释纪律在 core 落地（锐评输入，一次收敛）

- `page-store / error-diary / t / tr / locale` 源码注释收敛为「一句 why + 指向 ADR/知识卡链接」；P 级修史标签、历史教训段落、`2026-XX` 占位下沉 `docs/knowledge/core-error-diary.md` / `i18n.md`；
- 修正 `page-store.ts` 不准确的「唯一写入函数」注释（写入路径实为两条：`set` + `get` 懒初始化）；
- 清除 `utils/base/log.ts` 4 条 `eslint-disable` 残留。

### D5 附带根治（锐评顺藤摸瓜）

- `scripts/gen-knowledge-autogen.ts:392/435`：`text.replace(正则, 替换串)` → 函数替换（`$&` 展开是替换串一字符类 bug，可复现于任何 frontmatter 含 `$` 序列的卡）；
- 重建损坏的 `docs/knowledge/i18n.md`（15 层重复 frontmatter → 单层）；`routes-quick.md` 等生成物随 pre-commit GEN_CMDS 再生。
- 理由：根因一字符，卡损坏可自复发，不修等于没修。

## 3. 后果（Consequences）

**正面**

- 去重语义与宣称一致（同类去重 + 交错风暴抑制 + 有界淘汰 fail-open）；
- AppError 文案漂移有了 Go 单测 + Node 契约双侧机器锚点（fixture 单一事实源）；
- i18n API 面诚实：无 cast、无洗白，字面量 key 全量获得编译期检查；裸占位符上屏有告警 + 测试兜底；
- 知识卡 / 生成脚本损坏根除（`$&` 展开 bug + i18n.md 重建）。

**负面 / 成本**

- `trDynamic` / `tOf` / `stripAppErrorPaths` / `warnMissingKey` 新增 4 个公共符号（记忆面 +4，换取 ~30 处动态调用点类型诚实）；
- 字面量 tr 调用点（~90 处）首次接受 LocaleKey 编译期检查——若发现拼错 key，须同步补三语言包或改 trDynamic（按 case 修）；
- 注释收敛 diff 面大（core 5 文件 + 知识卡 2 张），与并行会话撞车概率中等（文件面已限定）；
- fixture 契约测试增加 ~40 行双侧维护面（Go 测试 + Node 契约测试 + 1 个 JSON）。

**已知遗留**

- core「Wails 无关 ≠ 引擎无关」（locale.ts 的 `fetch(import.meta.env.BASE_URL)` / `document.documentElement.lang` / `navigator.languages`）不在本轮：D4 准入字面合规，改名/分层待 core 再膨胀时评估；
- `PageName` 双源（bus.ts 联合 + page-store VALID_PAGES，satisfies 断言兜底）维持现状——page registry 属另起一轮的架构动作，不混入本轮；
- `registerPageStore(unsubs)` 与 `registerErrorDiary(handle)` 两套生命周期范式保留（各负其责，统一说明写进知识卡）。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `grep tr(` 字面量调用点 / `tr(变量|属性)` 动态调用点 | 字面量 ~90 处（menu-defs 28 + context-menu 24 + preview-3d/menu 38）；动态 ~30 处（cap-controls 13 + handlers 7 + shared 2 + core 2 + env 2 + render 2 + settings 2） |
| `gen-knowledge-autogen.ts:392,435` 源码 | `text.replace(/^---...---/, \`---\n${newFm}\n---\`)`——替换串含 newFm 原文（i18n.md frontmatter 有 `$&/$1` 字面）→ 实锤 `$&` 展开自追加 |
| `grep -c "^kind: i18n" docs/knowledge/i18n.md` | 15 → 15 层重复 frontmatter；`routes-quick.md:819-825` 7 行 `参数值含 ---` 为其生成物投影 |
| `AppError.Error()`（go/types/types.go） | `问题描述：… 操作：… [ 源路径：…] [ 目标路径：…] 解决建议：…`（全角冒号、单空格分隔）——前端正则匹配面 |
| `frontend/src/core` 测试 | 锐评前 67 用例全绿（ADR-189 §1 地基）；本轮改后须保持同数量级通过 |
