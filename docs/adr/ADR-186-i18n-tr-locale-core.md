# ADR-186：i18n 治理：tr 单轨收敛 + 影子包卡口 + locale 数据外移 core

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-045（i18n 架构）、ADR-185（core 分层治理）、ADR-161（§2.5 注册器）

---

## 1. 背景（Context）

ADR-185 后 core 复审发现三笔 i18n 债：

1. **tr 第四轨**：`preview-3d/menu/{cap-controls,roles,settings,switch}.ts` 各自内嵌
   一份 `const tr = (key, fallback) => ...` 私有实现（4 份重复），与 `core/i18n/tr.ts`
   并存。内嵌版判定语义（`v === key`）与 t() 缺失行为强耦合，t() 行为一变即全部
   静默漂移；且内嵌版不做 fallback 插值。
2. **影子包温床**：`tr(key, fallback)` 的英文/中文 fallback 是散落在代码里的事实
   第四语言包——不进生成链、不进一致性测试。key 忘入语言包时用户永远看到 fallback，
   无任何机制报警。实际抓到 3 处真实命中（`preview.noEnvironment/roleNoMotion/unloadModel`）。
3. **core 数据仓库化**：`core/i18n/locales/*.ts` 三包 ~4600 行占 core 目录 76% 行数，
   纯数据与内核运行时（t/tr/locale.ts ~360 行）混居，审阅/grep 噪声大。

## 2. 决策（Decision）

按 ROI 三步（第 3 步 TS/JSON 源合一暂缓，`--check` 已兜住滞后，攒到生成链需求再动）：

1. **tr 单轨**：删除 4 处内嵌 tr，统一 import `core/i18n/tr.ts`（fallback 插值顺带补齐）；
   `tr()` 首参收窄为 `LocaleKey | (string & {})`——字面量仍编译期拦拼错，动态 string
   （labelKey/group 数据驱动）放行且不丢自动补全。
2. **影子包卡口**：`scripts/i18n-check.ts` 新增静态扫描——源码全部 `tr("key", …)` 字面量
   调用的 key 必须存在于 zh-CN 基准包，缺失即报警（--strict 时 CI 失败）。原则：
   **fallback 是保险丝，不是正文；先入语言包，再写 tr()**。
3. **数据外移**：`core/i18n/locales/` → `frontend/src/locales/`（git mv 保历史）；
   同步 `generate-locale-json.ts` SRC_DIR、`i18n-check.ts`、`check-ctx-menu-i18n.ts`、
   `check-menu-health.ts`、`i18n-key-naming.ts` 及 3 个消费测试的 import。
   `core/i18n` 只留 t / tr / locale 运行时三件套 + 一致性测试。

## 3. 后果（Consequences）

- **正面**：tr 判定语义单点化（t() 行为变更只需同步一处）；缺译降级从「随模块漂移」
  变「保险丝 + CI 报警」；core 目录瘦身 76%，审阅噪声消除。
- **负面/代价**：i18n-check 每次全仓扫源码（零依赖 fs 扫描，秒级，可接受）；
  脚本路径硬编码 5 处需与目录布局同步（已被本次迁移实证）。
- **已知遗留**：TS 源 + 运行时 JSON 双源结构保留（`--check` 兜底）；`t()` 与 `tr()`
  双函数保留——语义不同（严格查表 vs 缺失兜底），非重复实现。

## 4. 数据溯源

- 发现来源：ADR-185 后 core 复审（src/core 锐评任务链）。
- 影子包首跑命中 4 处：3 真实缺 key（已补三包）+ 1 处注释示例误伤
  （`menu-defs.ts` 注释改 `tr(<key>, …)` 写法规避正则）。
- 验证：i18n-check --strict 全绿、三包 parity 1437 keys 对齐、
  vitest + vite build（触发 generate --check）+ typecheck 全绿。
