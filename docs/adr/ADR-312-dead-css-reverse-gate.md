# ADR-312：死 CSS 反向闸——定义侧零消费者类纳入 css-layer-check 检查 7

- **状态**：✅ 已采纳（Adopted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-25
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/css-layer-check.ts`（检查 7 本体）、`scripts/_lib/css-layer-utils.ts`（判定纯函数）、`tests/test_css_layer_check.ts`（契约锁）、[ADR-274](./ADR-274-css-layer-check.md)（闸本体决策）、[ADR-275](./ADR-275-css-layer-check-6.md)（检查 6 = 本闸对偶）、[ADR-015](./ADR-015-unified-animation-system.md)（`.stagger-in` 随本闸退役）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

- 本仓样式分两层：**文档层** `frontend/css/*.css`（`index.html` 全局 `<link>`）与 **shadow 层**（各视图 `export const XxxCSS` 模板串 / `adoptedStyleSheets`）。`css-layer-check` 此前只有**一个方向**的类存在性检查——检查 2/3/6 都是「**用了但没定义**」（错名 / 漏迁 / 从未实现）。
- 「**定义了却没人用**」结构上不可见：它是**阴性证据**，grep 不出（要遍历全仓才能确认「没有任何地方引用」），`vite build` / `typecheck` / 现有门禁全绿也能过境。于是化石层只增不减。
- 2026-10 锐评实测的病灶规模：
  - `frontend/css/layout.css` **整表 400 行零消费者**——它是 Shadow DOM 迁移前的光 DOM 外壳样式（`#root` grid / `.topbar*` / `.sidebar*` / `.main*` / `.preview*` / `.tb-btn`）。外壳早已被 `app-nav` + `app-content` 两个 shadow 组件取代，`index.html` 里连 `#root` 元素都不存在了；
  - `components.css` 的 `.mc-pick-*`（7 条）与 `.mc-scan-*`（8 条）：路径选择改用共享 `modalPicker`（`dlg-*` 测试契约）后整族留在原地——而知识卡早已写「`.mc-pick-item`/`.mc-pick-cancel` 类已删」，**文案删了、样式没删**，两处事实源长期背离；
  - `preview-3d/menu/style/components-styles.ts` 47 条（旧菜单实现的 `clr-*` / `vec3-*` / `collapsible-*` / `info-*` / `preset-chip` 一族）在 MenuNode 菜单体系接手后残留；
  - app-content / app-tree 各族 60+ 条（`gh-*` 旧代、`ws-*`、`batch-*`、`perf-hist-*`…）。
- 更难发现的是**假存活**：`tb-btn` 仅因 `scripts/check-redlines.ts` 的一句治理正则写进了它的名字而「有消费者」；`topbar` 仅因 `upstream/` 里第三方 vendor 自带上古样式表而同名存活。

## 2. 决策（Decision）

- **D1｜在 `css-layer-check.ts` 增检查 7（ERROR）：定义侧零消费者类 = 死类**，与检查 6 构成**双向对偶**（6 管「用了没定义」，7 管「定义了没人用」）。
  - 定义侧 = `frontend/css/*.css` ∪ `frontend/src` 内命中 CSS 资产标记（`export const *CSS` / `:host` / `adoptedStyleSheets`）的 `.ts`；
  - 判定 = `extractSelectorClasses`（**选择器位**类名提取）→ 在全仓消费者语料里找 token。
- **D2｜不引入基线文件，改为显式豁免表**（`scripts/css-layer-check.ts` 的 `KNOWN_DEAD_CSS_EXEMPT`，逐类附理由）。
  原设想是「基线只减不增」，但存量可一次清零（本轮 200+ 条全部删除或登记）；清零之后**基线的唯一作用就是给新死类开后门**——不如让新死类直接红。豁免只留给「全仓无法以字面量出现」的动态拼接族：`theme-${t}`、`preview-ic--${icon}`、`cr-tag-${kind}`。
- **D3｜前缀拼接只作线索，不自动豁免**：`前缀 + ${` 的启发式实测会把 `sidebar-${verb}-selected` 栽给 `sidebar-header`（同前缀、不同族）。自动放行会**静默吞掉真死类**，故只把 `dynHint` 附在告警正文里供人工核实，豁免一律走 D2 的显式登记。
- **D4｜消费者语料排除 `docs/`、`scripts/`、`upstream/`**：文档里的 `.foo` 只是叙述（不产生 DOM 节点）；治理脚本把旧选择器当**模式串**引用（`tb-btn` 病例）；上游 vendor 自带上古样式表（`topbar` 病例）。三者都会制造假存活，使闸门退化成计数器。
- **D5｜定义源自身的消费者语料须掩码**（`maskSelectorClasses`）：否则每条规则的选择器**自我证明**「有人在用」，闸门恒绿。掩码只作用于选择器位，`class="foo"` / `querySelector(".foo")` / `classList.add("foo")` / Go 侧模板串仍是有效证据。
- **D6｜判定纯函数下沉 `_lib/css-layer-utils.ts` 并由契约测试锁死四个方向**：选择器位提取不误收 TS 属性访问与注释（假 ERROR 防线）、掩码不误伤字符串引用（真活类被判死防线）、无消费者才报、豁免命中即静默。

## 3. 后果（Consequences）

**正面**
- 「定义了没人用」从阴性证据变成**可执行断言**，与检查 6 合起来覆盖「类名 ↔ 消费者」的完整双向。
- 本轮据此清出并删除存量死类规则（`layout.css` 整表 400 行、`components-styles.ts` 47 条、`components.css` 21 条、`content-gh.ts` 30 条、`fab.ts` 20 条、app-content/app-tree 各族 60+ 条），顺手暴露并收敛了两处事实源背离（知识卡称 `.mc-pick-*` 已删 / CSS 仍在）。
- 附带收益：`frontend/css/` 由 5 张样式表收敛为 4 张，文档层唯一存活的主题 `color-scheme` 规则迁入 `variables.css` 与主题变量同居（原 `layout.css` 整表删除，`index.html` / `style.css` 引用同步摘除）。

**负面 / 已知遗留**
- 检查 7 需读全仓语料（数千文件），单次约数秒 → pre-push 硬闸成本上升（`YSM_SKIP_CSS_LAYER=1` 逃生阀仍在，未新增绕过点）。
- token 判定对**极短类名**（1–2 字符）无判别力（与正文用词/属性名碰撞）——本仓现无此类；将来若出现，按 D2 显式登记豁免并写明理由。
- 只覆盖**类选择器**：ID 选择器（`#root` 一族）与「定义了没人用的 CSS 变量」不在本闸范围。本轮 `#root` 与其 `--sidebar-width` / `--topbar-h` 是**人工核证**后随 `layout.css` 删除的，不享受机器兜底。
- 检查 7 的判定面比检查 6 窄一档是有意的：**宁漏勿误报**（假 ERROR 会让整条 pre-push 硬闸失去信任，即「闸门恒红 → 无人接线」的已知病理）。

## 4. 数据溯源

| 来源 | 结果 |
|---|---|
| `node scripts/css-layer-check.ts --json`（实现后首次实跑，2026-10） | 153 条死类告警，归 11 个定义源 → 按文件归组并逐条核证：删除或登记豁免 |
| 全仓 grep 复核（`eicon` / `stagger-in` / `mc-pick-*` / `mc-scan-*` / `ws-preview*` / `ysm-ovl-*` / `ysm-3d-pop*` / `gh-*` / `ws-*` / `batch-*` / `stat-card` / `rec-card` / `repo-bar-btn`） | 仅命中自身定义处与注释/文档，零模板、零 JS 消费者 |
| `frontend/index.html`（当前外壳 = `app-nav` + `app-content` + `app-toast` + `context-menu`，无 `#root`） | 促成 `layout.css` 整表删除 |
| `scripts/check-redlines.ts:504`（`tb-btn` 正则）、`upstream/YesSteveModel-Parser/web/index.html:72`（`.topbar`） | 假存活证据 → 促成 D4 |
| `docs/knowledge/app_content_settings.md`（称 `.mc-pick-*` 已删）vs `frontend/css/components.css:622-641`（规则仍在） | 两处事实源背离 → 促成检查 7 立项 |
