# YSM 模型管理器 — 界面视觉与布局一致性诊断报告

> 审查日期：2026-09-23 ｜ 范围：整体视觉与布局一致性 ｜ 模式：只读诊断，未修改任何代码
> 审查对象：`frontend/css/*`（全局层）+ `frontend/src/views/**`（Shadow DOM 层）+ `docs/UI-Design.md`（规范层）
> 判定基准：`docs/UI-Design.md`（962 行规范）+ `frontend/css/variables.css`（token 实现）

---

## 0. 结论先行

**你的担心成立，但病根不是「没有设计」。**

这个项目拥有相当成熟的设计资产：一份 962 行的 `UI-Design.md` 规范、6 套主题、完整的字号缩放体系（`--fs-scale`）、5 档间距令牌、圆角/阴影/z-index/过渡时长分级。这在个人项目里是高于平均线的水准。

真正的问题是一条：**规范建成了，但没有强制力。** 规范 §10 白纸黑字写着「❌ 禁止硬编码」，而实现层仍在大量绕过令牌；更麻烦的是出现了**同类问题治一处、漏一处**的漂移——同一文件里，一处修好了还写了注释说明原因，隔壁同一类问题原封不动。

所以这不是「设计不好」，是**设计债务**：规范与实现之间存在系统性落差，且缺口在缓慢扩大。好消息是这类债可量化、可批量收敛，不需要推倒重来。

**一句话定位**：缺的不是设计能力，是**执行门禁**。

---

## 1. 诊断方法

| 层次 | 审查内容 | 手段 |
|---|---|---|
| 规范层 | `docs/UI-Design.md` 全部 14 章 | 精读 §1 设计哲学 / §2 布局 / §5 间距 / §8 按钮 / §10 色彩规则 |
| 令牌层 | `frontend/css/variables.css`（409 行） | 逐主题比对 6 套主题变量定义的**对称性** |
| 布局层 | `frontend/css/layout.css`（401 行） | 主 grid 尺寸、响应式断点 |
| 组件层 | `frontend/css/components.css` + `dialogs.css` | 按钮系统、对话框系统 |
| 视图层 | `app-tree` / `app-sidebar` / `app-nav` / `app-content` / `app-preview` / `context-menu` / `app-toast` / `settings` | 两路并行审查裸 px、硬编码色、token 语义错配 |

所有 P0 条目均已**逐条打开文件复核原文**，非仅凭子代理转述。P1/P2 中标注「抽样」的为抽样核实，未逐条穷举。

---

## 2. P0 — 跨主题错乱 / 规范明令禁止（建议优先修）

这四条的共同特征：**在某个主题下会露出明显缺陷，或已被本仓自己判定为错误却漏改**。

| # | 问题 | 证据 | 为何是 P0 |
|---|---|---|---|
| **P0-1** | **卡片阴影只有 1/6 主题生效** | `--card-shadow` / `--card-shadow-hover` 仅在 `.theme-warm` 定义（`variables.css:100-101`），其余 5 主题无定义；6 个消费点全部写 `var(--card-shadow, none)` → 默默回落到 `none`（`content-gh.ts:18,19,20`、`content-layout.ts:92,97,126,131`） | 换主题时卡片立体感凭空消失/出现。这是**跨主题视觉错乱**，用户直接可见，且与「6 主题等价」的承诺相悖 |
| **P0-2** | **列表主名被压暗（同类漂移）** | `content-gh.ts:83` `.gh-row-exists .gh-name { color: var(--muted) }` —— 而同文件 `:141` 的注释明写「错误正文须可读，muted 属误用（2026-09 层级口径）」 | 同一个文件里，`:141` 已按新口径修正并留下注释，**`:83` 没跟上**。规范 `variables.css:14-17` 明确「--txt = 列表主名」。是典型的「治一处漏一处」 |
| **P0-3** | **accent 底色上固定白字，对比度不足（同类漂移）** | `app-preview/css.ts:68` `.preview-fab{ background:var(--accent); color:#fff }` | pro 主题 accent `#ff8a65` 配白字对比度约 2.3:1。**同案** `.skip-link` 已在 `variables.css:362-364` 改取 `var(--bg)` 并注明原因——又一处治了、一处没治 |
| **P0-4** | **亮色主题下白色半透明 hover 不可见** | `app-preview/css.ts:82,84` `rgba(255,255,255,0.05)`、`detail-3d.ts:54` 同款 | warm/sakura/mint 三套亮色主题下，白叠白等于没有 hover 反馈。同时违反规范 §10「禁止硬编码」 |

> **P0 的收敛思路**：这四条里有三条（P0-2/3/4）是同一类 bug 的漂移副本。建议**按模式全仓扫一遍**（accent 底配白字、muted 压正文、白色半透明叠亮底），一次性根治，而不是见到一处改一处——否则下次还漏。

---

## 3. P1 — 跨区域不一致（用户能感知「拼凑感」）

这类不报错、不崩，但会让界面**看起来不像同一个产品做的**。

| # | 问题 | 证据 | 落差量化 |
|---|---|---|---|
| **P1-1** | **弹窗尺寸无统一口径** | 宽度 8 种：`components.css:98` 640px、`:344` 380px、`:628` 500px、`:653` 420px、`modal-picker.ts:125` 480px、`modal-select.ts:52` 400px、`adv-filter.ts:183` 420px、`content-creator.ts:302` 420px；最大高度 6 种：85vh / 80vh / 70vh / 350px / 55vh / 无上限；遮罩浓度 3 种：`.6` / `.4` / `.4` | 8 种宽 × 6 种高，弹窗之间毫无家族感 |
| **P1-2** | **卡片圆角三档并存** | `--radius-xl`(10px)：`content-layout.ts:44,154`、`content-repo.ts:63`；`--radius-lg`(8px)：`content-layout.ts:87`、`content-gh.ts:18`、`content-stg.ts:112`、`app-preview/css.ts:46`；`--radius-md`(6px)：`content-creator.ts:53`、`content-diag.ts:181` | 规范 §2.3 规定卡片 `border-radius: 10px`，实际 10/8/6 三档混用 |
| **P1-3** | **卡片内边距四套回退值（已漂移）** | `var(--card-padding,10px 12px)`（`content-layout.ts:88`）、`,6px 10px`（`:119`）、`,7px 10px`（`content-gh.ts:18`）、`,6px 10px`（`content-repo.ts:69`）；token 真值 `variables.css:244` = `6px 10px` | 令牌有真值，但 4 个消费点各自手抄了不同的兜底值——正是注释警告过的「手抄即漂移」 |
| **P1-4** | **空态/加载/错误三态 8 套口径（抽样）** | `content-layout.ts:60`、`content-gh.ts:15,16,79,136`、`content-diag.ts:89,199`、`app-preview/css.ts:22` | 字号 fs-xs/sm/md/base 四档、padding 四种、居中方式（flex vs text-align）两种 |
| **P1-5** | **布局尺寸不随字号缩放** | `layout.css:16` `grid-template-rows: 44px 1fr`（顶栏高度硬编码）；`variables.css:242-243` `--sidebar-width:300px` / `--preview-width:240px` 均为定值 | 已有完整的 `--fs-scale` 字号缩放体系，但**容器尺寸是死的** → 放大字号后顶栏内容挤压溢出。缩放系统在布局层缺一环 |
| **P1-6** | **预览面板宽度三值并存** | `app-preview/css.ts:13` `:host{width:200px}` vs `variables.css:243` `--preview-width:240px` vs `tpl.ts:117` inline 回退 `220px` | 200 / 220 / 240 三个值，inline 样式胜出，token 名存实亡 |
| **P1-7** | **侧栏宽度双令牌分裂** | `variables.css:242` `--sidebar-width:300px` vs `content-layout.ts:14` `--sidebar-w:200px` | 命名仅差一个 `-width`/`-w`，值差 100px，极易误用 |
| **P1-8** | **同区同角色元素取值不同（抽样）** | `app-tree-styles.ts:57` `.srch-inp{padding:5px 8px;radius:--radius-md}` vs `:59` `.sort-sel{padding:5px 6px;radius:--radius-sm}`——同一行内的相邻控件横向差 2px、圆角差 2px；`sidebar-css.ts:56` `.footer-btn{padding:5px 8px}` 裸 px | 相邻控件肉眼可见的不对齐 |
| **P1-9** | **导航栏左边缘错位** | `app-nav/tpl.ts:47,119` logo/version padding-x **14px** vs `.menu` 8px + `.nav-item` 横 10px = **18px** | logo 与导航项左边缘差 4px，整列视觉不对齐 |

---

## 4. P2 — 打磨项（不影响观感，影响长期维护）

| # | 问题 | 证据 |
|---|---|---|
| **P2-1** | 裸 px 间距遍布视图层 | `app-nav/tpl.ts:31,47,78,79,119`（`6px 8px 8px` / `16px 14px 12px` / `8px 10px 4px` / `10px 14px`）；`app-tree-styles.ts:20,21,22,30,31,32,61,143,148,151`；`sidebar-css.ts:56` |
| **P2-2** | 阴影绕过 `--shadow-*`（7 处抽样） | `content-gh.ts:58`、`context-menu/index.ts:102`、`app-toast/index.ts:65`、`content-creator.ts:88`、`content-repo.ts:40`、`app-preview/css.ts:68`、`settings/path-cards.ts:121` |
| **P2-3** | 字体栈手写不走 `--font-ui` | `app-tree-styles.ts:17` 手写 `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC"...`，与 `sidebar-css.ts:11`、`app-nav/tpl.ts:11`（均用 token）三方不一致 |
| **P2-4** | z-index 裸数字 | `app-tree-styles.ts:53` `.batch-menu{z-index:100}`、`toolbar-search.ts:27` `z-index:9999` —— 应为 `--z-popover`(1100) / `--z-fullscreen` |
| **P2-5** | 重复定义与死规则 | `content-creator.ts` 内 `.cr-section`(27/259)、`.cr-section-title-lg`(28/263) 等重复；`content-gh.ts` `.gh-section-title`(34/110) 值冲突；`app-tree-styles.ts` 部分规则疑无引用 |
| **P2-6** | 主题色硬编码回退值 | `content-gh.ts:58,60,62`(#2a2a3c/#444/#cdd6f4)、`content-diag.ts:14,243`(#e6b800)、`app-preview/css.ts:51`(#1971C2)、`path-cards.ts:135,139,144,147`(#888/#444) |
| **P2-7** | 规范与实现的死引用 | 规范 §2.3 与 `variables.css:319` 注释均称卡片圆角走 `--r` 变量，但 `--r` **零消费**（全仓不存在该令牌） |
| **P2-8** | 弱化手法不统一 | `opacity:.6/.7/.8`（`content-gh.ts:142`、`content-diag.ts:200,201`、`app-preview/css.ts:61,77`）与 `--muted` 令牌混用 |

> **合法豁免**（不计入问题）：`litematic-meta.ts` 方块色（56 处）、`mc-format.ts` MC 格式化色（16 处）、`content-layout.ts:14` 的 `--tag-*` / `--badge-*` 平台品牌色、`preview-3d` 材质与特效色。这些属**领域语义色**，硬编码正确。
>
> 补充：全仓 147 处 hex 硬编码中，绝大多数属上述合法领域色，真正违规的 UI 色约 20–30 处。**问题不在数量，在缺门禁。**

---

## 5. 根因分析与建议路径

### 5.1 根因

1. **令牌层建好了，但没有强制消费的机制。** 规范 §10 写了禁止硬编码，可没有脚本拦得住——`--card-padding` 有真值却仍被 4 处手抄兜底，就是缺门禁的直接后果。
2. **治理是「发现一处改一处」，不是「按模式扫全仓」。** P0-2/3/4 三条是同一类 bug 的副本：`.skip-link` 修了、`.preview-fab` 没修；`content-gh.ts:141` 修了、`:83` 没修。修的人写了注释说明原因，但没回头扫同类。
3. **规范文档自身有滞后。** §2.3 引用的 `--r` 变量从未存在；卡片圆角规范写 10px，实现早已分化成 10/8/6 三档而规范未更新。

### 5.2 建议路径（按投入产出排序）

| 优先级 | 动作 | 说明 |
|---|---|---|
| **第 1 步** | **补 P0 的同类漂移**（约 3 类模式，全仓扫） | accent 底配白字、muted 压正文、白色半透明叠亮底 —— 一次性根治，别再单点修补 |
| **第 2 步** | **补齐 6 主题的 `--card-shadow`** | 一行对齐即可消除唯一的跨主题功能缺失 |
| **第 3 步** | **立硬编码门禁脚本** | 参照仓内已有的 `scripts/css-layer-check.ts` 模式，加一条：视图层 `padding/gap/border-radius/box-shadow/z-index` 出现裸值即报警（带白名单豁免领域色）。这是**唯一能阻止债务继续扩大的手段** |
| **第 4 步** | **收敛三大基础组件口径**：卡片（圆角+内边距）、弹窗（宽/高/遮罩）、空态（字号+padding+居中） | 这三类是「拼凑感」的主源，收敛收益最大 |
| **第 5 步** | **布局尺寸接入 `--fs-scale`** | 顶栏 44px、侧栏 300px、预览 240px 改为随缩放计算，补齐缩放体系最后一环 |
| **第 6 步** | **回写规范** | 修正 §2.3 的 `--r` 死引用，把实际的三档圆角写清或收成一档 |

### 5.3 关于「要不要推倒重来」

**不需要。** 令牌层、主题层、字号缩放层都是扎实的地基，值得保留。当前缺口集中在**消费纪律**上——这是可以用门禁 + 一次批量收敛解决的，属于可偿还的债，不是架构性缺陷。

如果按 5.2 走完第 1–3 步，界面一致性的观感会有明显改善，且**债务停止扩大**；第 4 步之后，「不像一个产品」的拼凑感基本消除。

---

## 附录：本次审查未覆盖

- 3D 预览区内部（`src/preview-3d/`）的视觉表现——属独立渲染域，仅在 P0-4 涉及 hover 色时抽样触碰
- Android 端布局（`docs/knowledge/android-dev.md` 域）
- 动效手感、信息密度、交互流程等**体验层**议题——本次聚焦静态视觉与布局，如需可另开一轮
