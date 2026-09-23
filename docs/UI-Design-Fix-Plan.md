# YSM 模型管理器 — 界面一致性落地改动方案

> 配套报告：`docs/UI-Design-Audit-2026-09.md`
> 性质：**只读改动方案**（本文件不改任何代码，只给出 文件:行号 + diff 思路，供逐条拍板/审查）
> 审查基准：`docs/UI-Design.md` + `frontend/css/variables.css`
> 复核说明：报告原文部分行号/措辞与当前真实源码有出入，本方案以**当前源码树实测行号**为准，并在 §6 标注了与报告的差异。

---

## 0. 落地总原则

1. **先 token 后消费**：凡消费点缺令牌，先确认令牌是否在 `variables.css` 已存在；已存在的直接引用，不存在的先在 `:root` 补令牌再引用（不要内联值）。
2. **同类漂移一次性扫**：P0-2/3/4 是同一模式的多份副本（详见 §2），按模式全仓扫一遍，别单点修补。
3. **硬门禁兜底**：所有改动落地后，立 `scripts/css-token-check.ts`（参照 `scripts/css-layer-check.ts` 模式，见 §5），把"裸值在视图层出现"变成可阻断信号，债务才停扩大。
4. **不动 3D 预览域**（`frontend/src/preview-3d/`）：该域是独立渲染栈，70+ 处 `rgba(255,255,255,...)` / 裸 z-index 是其自身视觉体系，不在本次范围（审计已正确排除）。

---

## 1. P0-1 卡片阴影只在 1/6 主题生效

**病根**：`--card-shadow` / `--card-shadow-hover` 仅定义在 `.theme-warm`（`frontend/css/variables.css:100-101`），其余 5 主题无定义。6 个消费点全部写 `var(--card-shadow, none)`，换主题时静默回落 `none`。

**消费点（当前实测行号）**：
- `frontend/src/views/app-content/css/content-gh.ts:18,19,20`
- `frontend/src/views/app-content/css/content-layout.ts:92,97,126,131`

**改动思路**：

A. 在 `frontend/css/variables.css` 的 `:root` 块（与 `--shadow-sm` 同区，约 `:308-312`）补两条共享令牌：
```css
--card-shadow: var(--shadow-sm);        /* 新增：6 主题统一基线 */
--card-shadow-hover: var(--shadow-md);  /* 新增 */
```
B. 删除 `.theme-warm` 内重复的 `:100-101` 两行（已无意义，避免双源漂移）。
C. 消费点**无需改**（已写 `var(--card-shadow, none)`，改 A 后自动全主题生效）。

**收益**：一行基元消除唯一的跨主题功能缺失，零消费点改动。

---

## 2. P0-2/3/4 同类漂移（一次性扫描清单）

三条是同一 bug 的副本：修了一处、漏了同文件/同模式另一处。建议**按模式全仓扫**，不要逐条单修。

### 2a. P0-2 列表主名被 `--muted` 压暗
规范口径（`variables.css:14-17`）：`--txt = 列表主名`；`--muted` 仅真次要。
同一文件 `content-gh.ts:141` 已修并注释「错误正文须可读，muted 属误用」，但 `:83` 没跟上。

| 应改 | 文件:行 | 当前 | 改为 |
|---|---|---|---|
| 列表主名 | `content-gh.ts:83` | `.gh-row-exists .gh-name { color: var(--muted); }` | `color: var(--txt);`（存在态已用 `--bg` 底，主名用 `--txt` 与 `:85` 常态口径一致） |
| 同类扫描（全仓 `.name`/主名用 muted 处） | 见 §2d | — | 同上口径 |

**注意**：`.gh-row-exists` 是"已存在"绿色指示态，`:83` 压暗主名会让主信息不可读；`:85` 常态行已用 `--txt`，故改 `:83` 为 `--txt` 即与常态对齐。

### 2b. P0-3 accent 底固定白字（对比度不足）
`.skip-link` 在 `variables.css:361-364` 已改取 `var(--bg)` 并注释原因（pro/ocean accent 上白字仅 2.31:1）。但 `.preview-fab` 没改。

| 应改 | 文件:行 | 当前 | 改为 |
|---|---|---|---|
| FAB 文字色 | `app-preview/css.ts:68` | `background:var(--accent);color:#fff` | `color: var(--bg);`（与 `.skip-link` 同口径；`.btn-base.primary` 也是 `color:var(--bg)`） |
| 同类扫描 | 见 §2d | — | 任何 `accent` 底 + 固定 `#fff` 处 |

### 2c. P0-4 亮色主题下白色半透明 hover 不可见
warm/sakura/mint 三套亮色主题下，`rgba(255,255,255,0.05)` 叠亮底 ≈ 无反馈，且违反规范 §10 禁止硬编码。

| 应改 | 文件:行 | 当前 | 改为 |
|---|---|---|---|
| hover 底色 | `app-preview/css.ts:82` | `.morph-item:hover{background:rgba(255,255,255,0.05)}` | `background: var(--hover);`（与同文件 `:43` `.pv-hint` 等已用 `--hover` 一致） |
| hover 底色 | `app-preview/css.ts:84` | `.pack-model-item:hover{background:rgba(255,255,255,0.05)}` | `background: var(--hover);` |
| hover 底色 | `app-preview/detail-3d.ts:54` | `background:rgba(255,255,255,0.06)` | `background: var(--hover);` |

### 2d. 按模式全仓扫描命令（落地前跑一遍）
```
# 模式1：accent 底配固定白字
grep -rn "var(--accent)" frontend/src/views --include=*.ts | grep "#fff"
# 模式2：主名/列表名被 muted 压暗（人工核对 .*name / .*title 配 color:var(--muted)）
grep -rn "color:var(--muted)" frontend/src/views --include=*.ts | grep -iE "name|title|label"
# 模式3：白色半透明叠底（应改 var(--hover)）
grep -rn "rgba(255,255,255" frontend/src/views --include=*.ts   # 排除 preview-3d/ 域
```
扫出结果并入本方案 §2a–2c 表格，一次性修完。

---

## 3. P1 拼凑感来源（收敛三大基础组件）

### 3.1 P1-1 弹窗尺寸无统一口径
**真实消费点（当前实测）**：
- document 层 `components.css`：`.dlg-box` 宽 640px / 最大高 85vh（`:98-100`）；`.te-box` 380px / 80vh（`:343-345`）；`.mc-pick-box` 500px / 70vh（`:627-628`）；`.mc-scan-tooltip` 420px / 350px（`:653`）
- shadow 层：`.cr-detail-box` 420px / 90vw（content-creator.ts:302）；`modal-picker.ts:125` 480px；`modal-select.ts:52` 400px；`adv-filter.ts:183` 420px；`content-creator.ts:302` 420px
- 遮罩浓度 3 种：`.dlg-overlay` `.6`（components.css:87）、`.mc-pick-overlay` `.4`（:624）、`.cr-detail-overlay` `.4`（content-creator.ts:301）

**改动思路**：
1. 在 `variables.css` 增弹窗令牌（与 `--shadow-*` 同区）：
```css
--dlg-width: 640px;   /* 标准弹窗宽 */
--dlg-width-sm: 420px;/* 紧凑弹窗宽（te/mc-pick/cr-detail/adv-filter 收敛到此） */
--dlg-max-h: 85vh;    /* 统一最大高 */
--overlay-scrim: rgba(0,0,0,.5);  /* 遮罩统一浓度（取 .6/.4 中值，或定 .55） */
```
2. 各弹窗消费点改为 `width:var(--dlg-width)` / `var(--dlg-width-sm)`、`max-height:var(--dlg-max-h)`、遮罩 `background:var(--overlay-scrim)`。
3. 80vh / 70vh / 350px 等差异：要么全收 `--dlg-max-h`，要么保留 1–2 档语义（长列表 vs 短表单），但需**显式命名**而非裸值。

### 3.2 P1-2 卡片圆角三档并存
规范 §2.3 规定卡片 10px（`--radius-xl`），实现 10/8/6 混用。
- `--radius-xl`(10px)：content-layout.ts:44（.stat-card）、:154（.rec-card）；content-repo.ts:63（.oldest-section）
- `--radius-lg`(8px)：content-layout.ts:87,120（.model-card/.model-card-sm）；content-gh.ts:18；content-stg.ts:112（.stg-card）；app-preview/css.ts:46；content-repo.ts:69（.pick-card）
- `--radius-md`(6px)：content-creator.ts:53（.cr-creator-card）；content-diag.ts:181,213

**改动思路**：规范口径二选一——
- **方案 A（收一档）**：所有卡片统一 `--radius-xl`（10px），改 `--radius-lg`/`--radius-md` 的卡片消费点为 `--radius-xl`。改动点多但最贴合规范。
- **方案 B（双档语义化）**：在 `variables.css` 增 `--radius-card: var(--radius-xl)` 与 `--radius-card-lg`（大卡/段卡用），规范 §2.3 改为"卡片统一走 `--radius-card`"。消费点引用 `--radius-card`。
- 推荐 **B**：把"卡片圆角"收敛成单一语义令牌，未来调一档全站生效，且不动 `--radius-lg`/`--radius-md`（它们服务于按钮/输入/弹窗，语义不同）。

### 3.3 P1-3 卡片内边距四套回退值（纠正报告）
**报告措辞偏差纠正**：`--card-padding` 已在 `variables.css:244` 的 `:root` 定义为 `6px 10px`，故消费点的 `var(--card-padding, 10px 12px)` / `,7px 10px` / `,6px 10px` **回退值永不触发**（只在 token 缺失时兜底）。真实问题不是"四套值并存"，而是**回退值写错/写多套**造成的代码异味与潜在误解。

| 文件:行 | 当前回退值 | 建议 |
|---|---|---|
| content-layout.ts:88 | `var(--card-padding,10px 12px)` | 删回退值 → `var(--card-padding)`（真值 6px 10px 已在 :root） |
| content-layout.ts:119 | `var(--card-padding,6px 10px)` | 同上 |
| content-gh.ts:18 | `var(--card-padding,7px 10px)` | 同上 |
| content-repo.ts:69 | `var(--card-padding,6px 10px)` | 同上 |
| sidebar-css.ts:25 | `var(--card-padding,5px 10px)` | 同上（sidebar 用 `--card-pad-x` 派生补偿选中边框，见 :29，保留其水平逻辑但去手抄回退） |

**收益**：消除 4 套手抄回退值，token 真值唯一事实源生效（与 `css-layer-check` 注释警告的"手抄即漂移"同源）。

### 3.4 P1-5 布局尺寸不随字号缩放
- `layout.css:16` `grid-template-rows: 44px 1fr`（顶栏高度硬编码）
- `variables.css:242-243` `--sidebar-width:300px` / `--preview-width:240px`（定值）

**改动思路**：
1. 顶栏高度接入缩放：定义 `--topbar-h: calc(44px + var(--fs-scale) * 0.5)`，`layout.css:16` 改 `grid-template-rows: var(--topbar-h) 1fr`；`.topbar` 内 padding 已用 `var(--sp-*)`，配合即可。
2. 侧栏/预览宽：若只做"字号放大不挤爆"，侧栏 300px 一般够；预览 240px 在最大字号下可能挤压（见 P1-6）。建议先把顶栏接缩放（最高杠杆），侧栏/预览宽保持定值但**约束**为 token（P1-6/P1-7 已用 `--preview-width`/`--sidebar-width`，只是还有内联 200/220 打架）。

### 3.5 P1-6 预览面板宽度三值并存
- `app-preview/css.ts:13` `:host{width:200px}`
- `variables.css:243` `--preview-width:240px`（#root grid 用，`layout.css:13-15`）
- `app-content/tpl.ts:117` inline `style="width:var(--preview-width,220px)"`（inline fallback 220px 胜出）

**改动思路**：
1. `app-preview/css.ts:13` 的 `:host` 是 shadow 根宽度，应与宿主 grid 列宽一致——改为 `width: var(--preview-width)`（不写死 200px）。
2. `app-content/tpl.ts:117` 删 inline fallback 的 `220px`，改 `style="width:var(--preview-width)"`（已 `safeGet/set preview-width` 持久化，见 init-preview.ts:26-58）。
3. `variables.css:243` `--preview-width:240px` 为唯一事实源，三处统一引用。

### 3.6 P1-7 侧栏宽度双令牌分裂
- `variables.css:242` `--sidebar-width:300px`（grid 用）
- `content-layout.ts:14` `--sidebar-w:200px`（shadow 内 `.gh-left`/`.cr-left` 用）

**改动思路**：二选一——
- **方案 A（统一名）**：shadow 内改引用 `--sidebar-width`（已 300px），删 `--sidebar-w` 定义（content-layout.ts:14）。代价：gh/creator 左栏从 200→300，需视觉确认。
- **方案 B（保留双档语义）**：若 200px 是 gh/creator 有意收窄，则在 `variables.css` 显式定义 `--sidebar-w:200px` 并注释"gh/creator 域专用左栏宽"，消除"命名仅差 -width 易误用"的隐患。
- 推荐 **B**：不动布局观感，只补显式定义+注释，消除命名歧义。

### 3.7 P1-9 导航栏左边缘错位（纠正报告）
**报告算错纠正**：`.menu` 是 `padding:4px 8px`（app-nav/tpl.ts:78），`.nav-item` 内 `padding:var(--sp-vh-card)` = `6px 10px`（`:86`，横向 10px）。故**导航项内容左边缘 = 10px**（不是报告说的 18px）。logo/version 是 `padding:16px 14px`（:47 / :119），左边缘 14px。
错位是 **logo/version 14px vs nav-item 10px**，差 4px，整列视觉不对齐。

**改动思路**：
- `app-nav/tpl.ts:78` `.menu` 改 `padding:4px 14px`（横向与 logo/version 对齐 14px）；或
- `:47`/`:119` logo/version 改 `padding:16px 10px`（与 nav-item 对齐 10px）。
- 二选一，推荐前者（顶栏/导航整体左缩进统一 14px 更常见）。

---

## 4. P2 打磨项（不影响观感，长期维护）

| # | 文件:行 | 当前 | 改为 |
|---|---|---|---|
| P2-2 | `content-gh.ts:58`（.gh-popup box-shadow 裸值） | `box-shadow:0 8px 24px rgba(0,0,0,.35)` | `box-shadow: var(--shadow-lg)` |
| P2-2 | `content-repo.ts:40`（.batch-menu） | `box-shadow:0 4px 12px rgba(0,0,0,.3)` | `box-shadow: var(--shadow-md)` |
| P2-2 | `app-tree-styles.ts:53`（.batch-menu） | `box-shadow:0 6px 16px rgba(0,0,0,.4)` | `box-shadow: var(--shadow-md)`（与 content-repo 同档） |
| P2-2 | `app-preview/css.ts:68`（.preview-fab） | `box-shadow:0 4px 16px rgba(0,0,0,.4)` | `box-shadow: var(--shadow-lg)` |
| P2-4 | `app-tree-styles.ts:53`（.batch-menu z-index） | `z-index:100` | `z-index: var(--z-popover)`（1100） |
| P2-4 | `content-repo.ts:40`（.batch-menu z-index） | `z-index:100` | `z-index: var(--z-popover)` |
| P2-4 | `app-preview/css.ts:68`（.preview-fab z-index） | `z-index:20` | `z-index: var(--z-popover)` 或新建 `--z-fab`（若需低于 popover） |
| P2-4 | `toolbar-search.ts:27`（.ts-badge） | `z-index:9999` | `z-index: var(--z-fullscreen)`（9999） |
| P2-6 | `content-diag.ts:14,243`（warn 色硬编码回退） | `var(--status-warning, #e6b800)` | `var(--status-warning)`（token 6 主题已定义，回退多余） |
| P2-6 | `content-gh.ts:58,62`（popup 回退 #2a2a3c/#444/#cdd6f4） | `var(--surf,#2a2a3c)` 等 | `var(--surf)` / `var(--bd)` / `var(--txt)`（6 主题已定义） |
| P2-6 | `app-preview/css.ts:51`（badge 回退 #1971C2） | `var(--status-success,#1971C2)` | `var(--status-success)`（6 主题已定义） |
| P2-3 | `app-tree-styles.ts:17`（字体栈手写） | `-apple-system, BlinkMacSystemFont,...` | `font-family: var(--font-ui)`（与 sidebar-css.ts:11 / app-nav/tpl.ts:11 一致） |
| P2-8 | 多文件 opacity:.6/.7/.8 与 muted 混用 | `opacity:.6` 等 | 弱化统一走 `--muted`（语义弱化）或显式 `--disabled` 令牌；纯动效透明度保留但加 `/* tr-exempt */` 注释（参照 content-creator.ts:135 涟漪写法） |

> P2-1 裸 px 间距、`P2-5` 重复定义/死规则：逐项人工核对后再改，不在本方案预先给 diff（避免误删仍在用的规则）。

---

## 5. 门禁脚本（止血工具，报告 5.2 第 3 步）

**目标**：把"视图层出现裸值"变成可阻断信号，债务停止扩大。

**参照**：`scripts/css-layer-check.ts`（零依赖、自动发现 shadow 域、复用 `_lib/scan-files.ts` / `_lib/css-layer-utils.ts`）。

**新脚本 `scripts/css-token-check.ts` 草案**：
- 扫描 `frontend/src/views/**` + `frontend/src/preview-3d` 可选。
- 检查项（WARN 起步，成熟后转 ERROR）：
  1. `padding/gap/border-radius/box-shadow/z-index` 出现**裸数值**（非 `var(--*)`、非 `calc(var(--*))`）→ 报警。
  2. 白名单豁免：
     - 领域色：`rgba(255,255,255,...)` / `rgba(0,0,0,...)` 在 `preview-3d/` 域全豁免（独立渲染栈）。
     - 内联 `style="width:128px"` 等图片缩略图尺寸（detail.ts / maid-3d.ts / litematic-meta.ts）豁免或登记。
     - `KNOWN_NO_CSS_CLASSES` 同范式：维护 `TOKEN_CHECK_ALLOW` 集（如 `.cr-avatar` 的 `width:28px` 等图标定尺寸，或改为 `--icon-sm` 令牌）。
  3. 复用 `css-layer-check.ts` 的 `stripComments` / `extractClasses` 思路剥注释再扫（避免注释伪命中）。
- 接入 pre-push：在 `.githooks/pre-push` 加 `node scripts/css-token-check.ts --strict`，或先 `--json` 由 doctor 汇总。
- 渐进策略：首版只报 WARN，把现有裸值全登记进 `TOKEN_CHECK_ALLOW`，之后新增裸值才报警——避免一次性 100+ 误报淹没信号。

**注意**：本脚本是"防扩大"工具，不修存量；存量按 §1–4 人工收敛。

---

## 6. 本方案相对审计报告（UI-Design-Audit-2026-09.md）的实测纠正

| 报告条目 | 报告原文 | 实测纠正 |
|---|---|---|
| P1-3 | "4 个消费点各自手抄了不同的兜底值——正是注释警告过的手写即漂移" | `--card-padding` 已在 `variables.css:244` 的 `:root` 定义，**回退值永不触发**；真实问题是代码异味+潜在误解，非"四套值并存生效"。改法：删回退值而非对账。 |
| P1-9 | "logo/version padding-x 14px vs .menu 8px + .nav-item 横 10px = 18px" | `.menu` 是 `padding:4px 8px`，导航项内容左边缘 = 自身 `padding` 横向 **10px**（非 18px）。错位是 logo/version 14px vs nav-item 10px，差 4px。 |
| P1-1 | 列 8 种宽含 `modal-picker.ts:125 480px` / `modal-select.ts:52 400px` / `adv-filter.ts:183 420px` / `content-creator.ts:302 420px` | 已实测复核：modal-picker.ts:125 `width: width || "480px"`、modal-select.ts:52 `"400px"`、adv-filter.ts:183 `"420px"`、content-creator.ts:302 `420px` 全部命中。三处 JS 字符串宽改 `var(--dlg-width-sm)`（需 DOM 内联时走 `getComputedStyle` 或定义同名 CSS 变量；modal 系 document 层浮层，可直接引用 `--dlg-width-sm`）。 |
| P0-1 | "6 个消费点" 列 content-layout.ts:92,97,126,131 + content-gh.ts:18,19,20 | 经实测核对，content-gh.ts 实际为 `:18,19,20` 三处（`.gh-card`/`.gh-card:hover`/`.gh-card.active`），content-layout.ts 为 `:92,97,126,131` 四处（`.model-card`/`:hover`/`.model-card-sm`/`:hover`），共 7 处消费点（报告数 6 为漏算 `.gh-card.active`）。改动思路不变。 |

---

## 7. 落地顺序建议（按投入产出）

1. **P0-1**（variables.css 补 2 行）— 零风险、消跨主题缺陷。
2. **P0-2/3/4 + §2d 全仓扫描** — 同类漂移一次性根治。
3. **P1-6 / P1-7 / P1-9** — 预览宽/侧栏宽/导航对齐，纯 token 引用 + 1 处 padding，低风险。
4. **P1-2 / P1-3** — 卡片圆角/内边距语义令牌化（B 方案）。
5. **P1-1 / P1-5** — 弹窗尺寸 + 顶栏缩放，需视觉确认。
6. **P2 系列** — 打磨，按 §4 表格逐条。
7. **§5 门禁脚本** — 最后立，兜住 1–6 的债不再扩大。

> 每步改完跑 `cd frontend && npx vite build && npm run typecheck`；非测试文件跑 `node scripts/check-biome.ts --files <改动文件>`。

---

## 8. 执行记录（2026-09-23 已落地）

### 8.1 已提交改动

| commit | 内容 | 验证 |
|---|---|---|
| `a586946d2` | P0×4 + P1×6 + P2 打磨 + 立 `css-token-check.ts` + 审计/方案文档 | vite build ✅ / typecheck ✅ / biome ✅ / check-design-tokens 新增行 0 违规 |
| `9904fd63b` | 将 `css-token-check` 接入 `pre-push-gate.ts` 前端域（非阻断，基线债务口径） | pre-push --files dry-run PASS，token-check 0.6s 命中 |

### 8.2 门禁形态（落定）

- **脚本**：`scripts/css-token-check.ts`（复用 `css-layer-check.ts` 的 `walk`/`expandStyleInterpolations`）
- **基线**：`scripts/.css-token-baseline.txt`（首次运行自动建，416 条存量）
- **判定**：默认只报基线外**新增**裸值、rc=0（不阻断 push，仅可见）；`--strict` 升阻断；`--rebuild-baseline` 存量收敛后更新；`YSM_SKIP_TOKEN_CHECK=1` 逃生阀
- **接入**：`pre-push-gate.ts` 前端域块（`frontend-domain.ts`），`blockPolicy:"debt"` —— 存量债只报告不阻断，新增裸值日后升 `--strict` 即拦
- **令牌合规闸**：`check-design-tokens --added-lines`（pre-commit 已挂）负责"新增行零容忍"，与本脚本"存量基线"互补——两道闸合力：新增行立即拦 + 存量渐进收敛

### 8.3 存量债盘点（截止 2026-09-23）

`check-design-tokens` 全量：违规 **206** 处（ERROR 201 / WARN 5），`可建议替换: 0 处`。

| 类别 | 数量 | 收敛策略 |
|---|---|---|
| CSS 块硬编码 padding | 156 | 人工：逐文件引 `--sp-*`/`--pad-*`（语义间距体系已全） |
| 内联硬编码 padding | 39 | 人工：内联 style 改 `var(--sp-*)`（shadow 内 var() 穿透已证实） |
| 内联硬编码字号 | 4 | 人工：改 `var(--fs-*)` |
| CSS 块硬编码颜色 | 3 | **不自动替换**（语义需人工判定，机械猜测必错） |
| emoji 当图标 | 2 | 改 `utils/icon` SVG 体系（跨平台/主题一致） |
| CSS 块硬编码字号 | 2 | 人工：改 `var(--fs-*)` |

热点文件：`content-diag.ts`(26) / `content-gh.ts`(18) / `content-creator.ts`(18) / `components.css`(16) / `layout.css`(12) / `app-preview/css.ts`(11) / `app-nav/tpl.ts`(9)。

**结论**：存量是人工渐进游戏（0 处可机械 `--fix`），不在单次任务范围。门禁已立，债务停止扩大；后续按文件域认领收敛即可。

### 8.4 知识卡

已写回 `docs/knowledge/` 知识卡记录 `css-token-check` 用法（基线/接入/逃生阀），供下次直接命中。
