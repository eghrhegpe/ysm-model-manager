# ADR-210：core 收编：locale host 注入、手工缓存与死 API 清理

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/core/i18n/locale.ts / frontend/src/core/i18n/t.ts / frontend/src/core/error-diary.ts / docs/knowledge/i18n.md / docs/knowledge/core-error-diary.md / ADR-189（core 准入 D4）/ ADR-207（core 锐评整改）`

---

## 1. 背景（Context）

`frontend/src/core` 准入（ADR-189 D4）声称「引擎无关内核」，实际二轮锐评核实出四类病灶：

1. **引擎无双标**：`error-diary` 全注入（DiarySink），`locale.ts` 却把 `fetch`/`import.meta.env`/`navigator`/`document` 直接内联——绕门禁方式即「不 import utils/dom，但自己写 DOM 调用」。准入③「无 Wails 可单测」成立，但测试被迫 happy-dom + mock fetch + mock navigator。
2. **手工缓存失效契约**：`_activeBundle` 把 `getBundle()` 热路径退化为「一次属性读取」，代价是「bundles/_currentLang 任一写点必须配对调 refreshActiveBundle」的**口头纪律**——漏一次配对即幽灵缓存 bug。为纳秒级收益引入正确性风险，且无 benchmark 支撑。
3. **死 API 常驻内核**：`tr.ts`（`tr`/`trDynamic`，ADR-207 D3 产物）生产调用方实测为零（menu-defs 等 ~120 处调用点已全量迁移 `t()`，仅知识卡/ADR 文档未同步，`tr.ts` 连同 `tr.test.ts` 成孤儿模块）；内核里躺 deprecated 出口 = 无人对 core API 面负责。
4. **事实源双写**：`t.ts` 硬编码 `DEFAULT_LANG = "en"`，`SUPPORTED_LANGS` 却在 `locale.ts`——「en 是兜底语言」同一事实两处定义、零守卫；项目 `check-redlines` 在外杀双写，core 自家后院放行。
5. **日记系统静默失活**：`pushToDiary` 未注册时静默 no-op——装配顺序错误导致全局错误丢失，无任何留痕，而「日记失活」恰是 error-diary 该记录的那类错误。

另有一组核实后**维持现状**的项（记录取舍，防止下次锐评重提）：
- `page-store` 严格（`isValidPage` 拒绝）/宽容（`sanitizePage` 兜底）双轨：启动恢复 vs 运行时广播语义分叉是有意设计且已注释，命名再拆收益 < 成本。
- error-diary 去重键（status + 净化后 title）：仅首 200 字完全相同的两条不同错误才误杀，罕见；改键会破坏 ADR-207 D1「路径段变体塌缩同键」特性。
- 两个「warn-once」Set（`warnedKeys` 切语言清空 / `warnedResiduals` 永不清空）：仅 2 调用点且清空语义不同，抽通用节流原语属投机性抽象。
- 注释携带 ADR 编号（ADR-xxx Dn 引用）：是项目知识卡交叉引用约定，非噪音，不批量改写。

## 2. 决策（Decision）

**D1 locale host 注入**：`locale.ts` 的 DOM/网络副作用全部下沉到 `LocaleHost` 接口（`loadBundle(lang): Promise<Bundle | null>` / `systemLanguages(): string[]` / `setHtmlLang(code): void`），经 `setLocaleHost(host)` 注入（沿用 `setLogSink` 注入范式）；宿主实现 `makeLocaleHost()` 放 `utils/dom/locale-host.ts`（DOM 原语层），装配层 `app-modules.ts` 在 i18n 启动步内先 `setLocaleHost(makeLocaleHost())` 再 `initI18n()`。`detectSystemLang` 改为纯策略函数 `detectFromLangs(langs: string[])`（输入 string[]，无 navigator 依赖）；`zh-CN → zh-Hans` 映射留在 core（策略），host 只设属性。未注入 host 时 fail-open：`loadLocale` 告警一次 + 不缓存（host 就绪后自愈），`systemLanguages`/`setHtmlLang` 缺省 zh-CN / no-op。

**D2 删除 `_activeBundle` 手工缓存**：`getBundle()` 无参直查表（多两次属性读取，纳秒级），同步删 `refreshActiveBundle` 与「刷新契约」注释；`setCurrentLang` 回归单一职责（只改 `_currentLang`）。正确性由结构保证，不再靠纪律。

**D3 根除 `tr.ts`**：`tr`/`trDynamic` 连同 `tr.test.ts` 整体删除（生产零调用，`tOf` 已内置多级回退）；同提交同步 `i18n.md` 知识卡（source_files/anchors/pitfalls/API 全部去 tr）+ `test-setup.ts` 注释 + `context-menu.md`/`preview-menu.md` 过时 tr 描述；ADR-207 首部落「D3 之 tr/trDynamic 被 [ADR-210 D3] 根除」标注（其余 D 项仍有效）。`i18n-check.ts` 影子包扫描（`tr("key",…)` 字面量）随调用归零而恒绿，脚本本体不动（扫描器对空输入无害）。

**D4 兜底语言单一事实源**：`FALLBACK_LANG: LangCode = "en"` 定义在 `locale.ts`（与 `SUPPORTED_LANGS` 同处），`t.ts` 删本地 `DEFAULT_LANG` 改引 `FALLBACK_LANG`；`locales-consistency.test.ts` 新增守卫「`FALLBACK_LANG` ∈ `SUPPORTED_LANGS` codes」——en 被移出支持列表时编译/测试即报。

**D5 `pushToDiary` 失活留痕**：未注册态由静默 no-op 改为**一次性 `console.warn`**（模块级 flag，注册成功复位；重入卸载-再注册可再告警）——日记系统自身失活从此有痕，且只告一次不打扰。

## 3. 后果（Consequences）

正面：
- core 恢复字面意义的引擎无关：`locale.test.ts` 可切 `@vitest-environment node`（免 happy-dom 重建成本），DOM/网络 mock 收敛为单个 fake host 对象。
- 消灭「刷新契约」口头纪律与幽灵缓存面；`_currentLang`/`bundles` 写点回归直查表语义。
- 内核 API 面收窄：`tr`/`trDynamic`（2 个 deprecated 出口 + 1 测试文件）根除，`t`/`tOf` 双入口收口。
- 兜底语言漂移获得机器守卫；日记失活获得可观测性。

负面 / 成本：
- `initI18n`/`setLang` 语义不变但依赖装配层先 `setLocaleHost`——测试漏注入时语言包加载静默降级（fail-open 告警一次可见），属可控。
- `SUPPORTED_LANGS` 字面量形式须保持 `= [ ... ] as const;`（`scripts/i18n-check.ts` 正则解析锚点），本 ADR 不动它。
- 知识卡 3 张 + ADR-207 标注同提交同步，diff 面稍宽。

已知遗留：
- `navigator.languages` 兜底逻辑（undefined → `navigator.language`）移入 `makeLocaleHost`，语义不变。
- error-diary 去重键误杀罕见情形与 page-store 双轨语义按 §1 取舍维持现状。

## 4. 数据溯源

| 来源 | 结果 |
|---|---|
| 锐评核实：`grep "from .*tr\.ts"` 全仓 | 生产 tr 调用方 = 0（仅 tr.test.ts）→ D3 根除而非设期 |
| 锐评核实：`menu-defs.ts` 27 处全 `t(` | 知识卡 tr 描述为 ADR-207 期过时记录，非代码事实 |
| 锐评核实：`t.ts:13` vs `locale.ts:11-15` | 兜底语言双写无守卫 → D4 |
| 锐评核实：`locale.ts` 内联 `fetch`/`navigator`/`document` + happy-dom 测试 | 引擎无双标 → D1 |
| 锐评核实：`_activeBundle` 刷新契约注释（ADR-189 D5 口头纪律） | 手工缓存 + 幽灵缓存面 → D2 |
| 锐评核实：`pushToDiary` 未注册静默（error-diary.ts） | 日记失活无留痕 → D5 |
| `scripts/i18n-check.ts:211` 正则 / `:239-289` 影子包扫描 | `SUPPORTED_LANGS` 字面量冻结仍有效；**tr 扫描已退役（2026-09）**——被扫对象已根除故恒空，见 `i18n-check.ts` 原位退役说明 |

<!-- 文件名: core-convergence-locale-host.md → 实际文件 ADR-210-core-convergence-locale-host.md -->
