---
kind: shared-styles
name: 共享样式 shared-styles
tier: leaf
category: ui
source_files:
  - frontend/src/utils/dom/css.ts
  - frontend/src/views/app-tree/app-tree-styles.ts
auto_fields:
  symbols_with_lines:
    - btnBaseCSS
    - dropdownBaseCSS
    - focusVisibleCSS
    - metaTagCSS
    - noAnimationsCSS
    - tabBtnCSS
    - treeCSS
    - wsIconCSS
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 共享样式、btn-base、focus-visible
  - tree 样式、Shadow DOM 样式、CSS 变量
quick_risk_lines:
  - 按钮样式必须走 btnBaseCSS 统一体系，禁止手写按钮 CSS
pitfalls:
  - 手写按钮 CSS → 与 btn-base 不一致、主题切换失效；必须经 btnBaseCSS
  - 颜色 / 间距 / 字号不消费 CSS 变量 → 主题切换后样式残留；必须用 var(--*) 变量

use_when:
  - 共享样式
  - 按钮样式
  - btn-base
  - focus-visible
  - tree 样式
  - Shadow DOM 样式
  - CSS 变量
invariant_anchors:
  - frontend/src/utils/dom/css.ts|btnBaseCSS
  - frontend/src/views/app-tree/app-tree-styles.ts|treeCSS
status: active
---

# 共享样式 shared-styles

## 概览

两个样式模块为 Shadow DOM 组件提供可复用的 CSS 字符串：`utils/dom/css.ts` 导出全应用统一的按钮体系 `.btn-base`、通用 focus-visible 规则、`.ws-icon` 图标规则与 `.no-animations` 通配桥；`views/app-tree/app-tree-styles.ts` 导出 app-tree 组件的完整样式 `treeCSS`（内联插入 `${btnBaseCSS}` 复用按钮体系）。样式独立成文件可避免 JS 热更新时重编译 CSS，所有颜色/间距/字号均消费 CSS 变量，随主题切换自动适配。

## 核心职责

- `btnBaseCSS`：`.btn-base` 基础按钮（hover/active/focus-visible/disabled 全状态）+ 尺寸变体（`.sm`/`.lg`）+ 语义变体（`.primary`/`.danger`/`.accent`/`.warn`），padding/圆角/过渡全走 `var(--btn-*)` 变量
- `focusVisibleCSS`：Shadow DOM 内通用 `:focus-visible` 焦点环（`color-mix` 取 `var(--accent)` 30% 透明）
- `dropdownBaseCSS`：`.dd-wrap`/`.dd-menu`/`.dd-item` 下拉外观；**下拉指示符 `▾` 亦由此单源生成**（`.dd-wrap > button::after`）——箭头是结构性 affordance，**不进 i18n 值**（历史债：`tree.authors`/`tree.batch`/`tree.more` 曾以「作者 ▾」形式把箭头混进三语 locale，翻译侧被迫抄箭头、样式无处统一；sidebar push/pull 亦曾手拼 `▾` 造成双箭头风险）。`.dd-menu` 内菜单项非 `.dd-wrap` 直接子元素，不受该规则影响
- `treeCSS`：app-tree 完整样式——头部工具栏（`.hdr`/搜索框/排序）、虚拟滚动容器（`.vs-wrap`）、作者分组行（`.fh`）与文件行（`.fl`）及紧凑列表模式（`.fh-list`/`.fl-list`）、启用开关（`.ck` 含 partial 半态）、选中/悬停/锁定/`.ban` 态、元数据彩色标签（`.tag-author`/`.tag-work`/`.tag-date`，走 `var(--meta-*)`）、悬停快捷操作（`.hover-actions`）、下拉菜单（`.dd-menu`/`.batch-menu`，展开交互归 `utils/dom/dropdown.ts` 控制器，`dropdownHoverCSS` 已退役）、空态（`.empty`）
- `noAnimationsCSS`：`.no-animations` 在 Shadow DOM 内的通配桥（`:host-context(.no-animations) *` → `animation: none` / `transition-duration: 0s` / `transition-delay: 0s` 全 `!important`）。**凡自带动画或过渡的 shadow 域必须拼接本片段**——文档层通配不穿透 shadow 边界；漏带由 `scripts/css-layer-check.ts` 检查 4 阻断
- `wsIconCSS`：`.ws-icon` 尺寸（`1em`）与着色（`currentColor`），ADR-238 的唯一定义出处

## 对外 API / 入口

- 导出：`btnBaseCSS: string`、`focusVisibleCSS: string`、`wsIconCSS: string`、`noAnimationsCSS: string`（frontend/src/utils/dom/css.ts）；`treeCSS: string`（frontend/src/views/app-tree/app-tree-styles.ts）
- 消费方式：组件在 Shadow DOM 内经 `adoptedStyleSheets` 或 `<style>` 注入（如 app-tree 注入 `treeCSS`）
- 无 bus 事件、无 Go 调用

## 与其他子系统关系

- `treeCSS` 被 [app_tree](./app-tree.md) 组件注入使用；`btnBaseCSS` 被各 Shadow DOM 组件（tree/sidebar/sync-manager 等）拼接复用
- 所有变量值来自主题系统（frontend/css/variables.css，见知识卡 [theme](./theme.md)），Shadow DOM 跨主题特判用 `:host-context(.theme-*)`
- 按钮交互一致性（UX 维度「交互一致性」）依赖全应用按钮统一走 `.btn-base`

## 不变量

- 所有颜色/尺寸必须走 CSS 变量（`var(--txt)`/`var(--bd)`/`var(--btn-*)` 等），禁止引入硬编码主题色（治理红线 §3.3；`#a6e3a1` 等少量状态色为历史存量）。**`--accent-btn-*` 三变量已补入默认 cyber 主题**（P2 修复：原仅在 warm/pro/sakura/ocean/mint 定义，默认暗色主题下 `.btn-base.accent` 主操作按钮静默失去 accent 样式）
- 新增按钮样式必须扩展 `.btn-base` 变体，禁止另起一套按钮类（UI-Design.md 唯一设计规范）；`components.css` 存在 `.btn-base` 平行副本（light DOM 用，primary:hover 混色与 css.ts 分叉，P3 观察待统一）
- `treeCSS` 内联 `${btnBaseCSS}` **与 `${focusVisibleCSS}`**（P2 修复：原仅内联按钮体系，`.srch-inp`/`.sort-sel` 显式 `outline:none` 导致键盘聚焦无可见焦点环，a11y 缺口）；保持按钮体系单一来源，不得复制改写
- 动画必须可被 `no-animations` 类关闭，且实现是**双层通配**而非逐类白名单：文档层 `variables.css` 的 `.no-animations *`（含 `::before/::after`）覆盖光 DOM 全域；Shadow 层各域 adopt `utils/dom/css.ts` 的 `noAnimationsCSS`（`:host-context(.no-animations) *`）。**禁止新增逐类 `.no-animations .foo` 条目**——2026-09 核实：原文档层白名单里的 `.menu` / `.toast` / `.sm-*` 住在 shadow 内部，文档选择器恒不匹配（死规则），实测 app-toast（toastIn）、context-menu（menuPop/itemSlideIn）、app-sidebar（instance-card/sk-shimmer）、app-content（.cr-*/.stg-*/.recy-item/.gh-card…）的动画都关不掉；白名单还必漏新组件（漏登记无警报，承诺退化成假话）。机检 `scripts/css-layer-check.ts` 检查 4：含 `animation`/`transition` 的 shadow 域无桥 → ERROR 阻断。历史：2026-08-09 曾把 content-css/app-nav/app-preview 的 `.no-animations` 后代选择器改为 `:host-context`，但仍逐类登记，覆盖不全
- ~~**`--bg2` 幽灵变量**（P3 观察）：`app-tree-styles.ts` `.adv-filter` 消费 `var(--bg2)` 全库无定义（content-css.ts 已用 `var(--bg2,transparent)` fallback 佐证）——计算值失效静默降级，待定义或补 fallback~~ —— **已治愈（`53621060b`，2026-09-22 核实）**：`.adv-filter` 归位 `var(--surf)`，全仓 `--bg2` 消费零命中，幽灵消除。
- **@keyframes 不穿 Shadow DOM 边界**（2026-08-24 铁律，区别于 CSS 变量）：CSS 自定义属性可跨界上溯/下穿 shadow，但 `@keyframes` 只能在其定义的同一 shadow 树（或 document 层 light DOM）内被 `animation` 引用生效。任何 Shadow DOM 组件若 `animation: <name>` 引用一个仅定义在 `frontend/css/components.css`（全局 `<link>`，document 层）的 keyframe，则该动画**静默失效**（`getAnimations()` 返回 0，无动画不破功能故长期潜伏）。修复范式：把所需 keyframe 复制进该 shadow 层的 CSS 源（如 `contentLayoutCSS` / `sidebar-css.ts`），全局副本保留给 light DOM 的 dialog 用。机检 `scripts/css-layer-check.ts`（pre-push 阻断）已覆盖此断言
- **注释体内误写闭合符会吞掉紧随的 `@keyframes`**（2026 实测新坑，比上一条更隐蔽）：块注释按「首个星号+斜杠」闭合。若注释正文里再写该组合（例：`fadeSlide*/breathe-subtle`、`.dlg-*/.afv-*`），注释提前结束，其后文本成为裸 CSS → 解析器将其当作选择器、并**吞掉紧随的第一个 `{...}` 块**。实测后果：`content-layout.ts` 注释写成 `fadeSlide*/breathe-subtle`，吞掉紧随的 `@keyframes fadeSlideUp`，导致 app-content 全 shadow 的入场动画（`.stg-card`/`.settings-group`/`.setting-row`/`.gh-card`/`recy-item`… 均用 `fadeSlideUp`）**静默失效**——`getComputedStyle().animationName` 仍显示 `fadeSlideUp`（声明解析成功），但 `getAnimations()` 为 0、无 `animationstart`；只有定义在破注释**之前**的旧 keyframe（`card-in`/`pageIn`）还能播，造成「只有旧动画能播」的假象。判据：按首闭合语义剥注释后不应残留游离闭合符。机检 `scripts/css-layer-check.ts` 检查 5（pre-push 阻断）+ `content-css.test.ts` 单测双锁定
- **同在模板串内的 CSS 注释不得含反引号**（写 `.stg-desc` 注释时实测撞上）：shadow CSS 以 TS 模板串承载，注释里的反引号会**提前终止模板串**，esbuild 报 `Expected ";" but found "font"`。与上一条的区别：反引号是**响亮失败**（构建期即红），`*/` 是静默失效——所以只需人记住，无需门禁。引用配方请用单引号。
- **检查 3 的判定域 = 本域 CSS 自己定义过的命名空间**（2026-09，ADR-274）：shadow tpl 用到的类若在本 shadow 层无定义即 WARN。判定域**自推导**（本域出现 `.perf-bar-row` → 认定 `perf-` 属本域），**不再用手写前缀表**——旧 `DOMAIN_PREFIXES` 是 opt-in 子集，app-content 定义了 12 个 `.perf-*` 类却没登记 `perf-`，于是 `.perf-wrap` / `.perf-controls`（**零 CSS 规则**、性能控制条裸奔）对本闸完全不可见。同批修两处提取缺陷：`extractClasses` **先剥注释——块注释与 `//` 行注释都要剥**（闸的输入是**整份 .ts 文件**，`content-diag.ts` 的 `// …（.dlg-*/.afv-*/.mc-pick-*/.br-* 等）` 曾凭空造出 `ws-`/`stg-`/`dlg-`/`afv-`/`mc-pick-`/`br-` **6 个伪类名**，`content-layout.ts` 的块注释则让 `.btn-base` 隐身——同一洗白机制、两种注释风格，故必须都剥 + 丢弃尾随连字符；`(?<![:/])` 避开 `https://`）、`extractHtmlClasses` 跳过含 `$`/`+` 的动态属性值（`class="' + healthTagClass + '"` 曾把变量名当类名）；并把 `expandStyleInterpolations`（原 `expandKeyframeInterpolations`）的 `@keyframes` 过滤删掉——`${btnBaseCSS}` / `${dropdownBaseCSS}` 这类共享常量**就是本 shadow 实际 adopt 的样式**，不展开会让 `.dd-wrap`/`.dd-menu` 被误判为未定义。合法却无规则的类统一登记 `KNOWN_NO_CSS_CLASSES`（逐类附理由，判定面无第二处白名单）。已知边界：本域**从未**定义过该族时无法判定（不报；该盲区由**检查 6** 用全局口径补上，见下条）——实测残余盲区 **42 类**，其中 30 个 `dlg-*`/`br-*` 是 document 层对话框模板（边界正确）、2 个完全内联样式、**7 个是真缺陷**（`lt-*` 全族，色块空 span 无尺寸恒不可见）、3 个是装饰性无操作类（`heatmap-bar-*`，布局由内联容器与 bar 的 height/color 承载）。**对偶检查（定义了没人用）经实测否决**：naive 版报 617 条、真死 0 条（绝大多数是 `classList.add`/JS 字符串引用的运行时类），不值一建。
- **检查 7（死 CSS 反向闸）**（2026-10，ADR-312）：定义了、但**全仓无任何消费者**的类 → ERROR（pre-push 阻断，`KNOWN_DEAD_CSS_EXEMPT` 逐类登记理由，无基线文件）。⚠️ **本卡此处曾写「对偶检查已实测否决、别重走」——那个结论只对 naive 版成立**：naive 版（把每个类直接拿去正则搜全仓）报 617 条 / 真死 0，因为 `classList`/`className` 运行时类与**定义源自身的选择器**都被当成消费者。检查 7 的四个修正点是它能用的前提：① 定义侧只在**选择器位**提类名（挡掉 TS 属性访问 `x.foo`）；② 定义源的消费者语料**掩码选择器位**（否则规则自我证明存活）；③ 语料排除 `docs/`（叙述）/ `scripts/`（治理正则把旧选择器当模式串，`tb-btn` 病例）/ `upstream/`（vendor 同名）；④ 前缀拼接族**显式登记豁免**，不做前缀启发式自动放行（实测 `sidebar-${verb}-selected` 会误栽给 `sidebar-header`）。立项首跑即抓出真实化石层并清零（清单与判据见 ADR-312 §4；清完 `--strict` 0 ERROR / 0 WARN）：`frontend/css/layout.css` 整表（旧光 DOM 外壳，`.topbar*`/`.sidebar*`/`.main*`/`.preview*` 全族零消费者）、`components.css` 的 `.mc-pick-*` 与 `.mc-scan-*`（改走共享 modalPicker 后残留，而文案早已称其已删）、`components-styles.ts` 的旧菜单 `clr-*`/`vec3-*`/`collapsible-*` 一族、app-content 旧代 `gh-*`/`ws-*`/`perf-hist-*` 等。**已知边界**：本闸只覆盖**类选择器**——零引用 `@keyframes`（本轮人工清出 `rmItemIn`/`rmContentIn`/`recyItemIn`，其中 `recyItemIn` 是 v1.7.6 keyframe 合并的遗漏本体）、ID 选择器与「零 var() 引用」的自定义属性都不在闸内；前两者靠人工核证，token 级联另有 `preview-3d` 域测试的「无零引用 token」断言兜底。
- **检查 6（跨层存在性）**（2026-09，ADR-275）：shadow 域模板用到的类，若在「所有 shadow 域 CSS ∪ document 层 `frontend/css/*.css`」都无定义 → WARN（豁免走既有 `KNOWN_NO_CSS_CLASSES` 单点，无第二处白名单）。它补的是检查 3 的**对偶盲区**：检查 3 问「本域命名空间里用了却没定义」，它问「**哪儿都没定义**」。首跑 9 条 / **0 假阳性**，把 ADR-274 写明的 42 类盲区**全部归因收口**——30 类 document 层对话框模板（边界正确）、**7 类 `lt-*` 真缺陷**（`litematic-meta.ts` 的色块是空 span 无尺寸 ⇒ 恒不可见，已补 `app-preview/css.ts` 真规则）、9 类豁免（`heatmap-bar-*` 靠内联容器+bar 的 height/color 承载、`br-preset`/`br-file-cb` 是共类+JS 钩子、`gray` 是设计缺口）。同批删 `.hm-*` 13 条死 CSS + 孤儿令牌 `--hm-0..4`（全仓 src 与 e2e 零消费者，与 `.heatmap-bar-*` 构成错名孪生体）。

## 相关

- [theme](./theme.md) — CSS 变量来源与主题切换
- [app_tree](./app-tree.md) — treeCSS 消费方
- `docs/UI-Design.md` — 唯一设计规范（按钮/动画口径）
