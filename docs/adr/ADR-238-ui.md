# ADR-238：UI 图标规范与命名体系

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/UI-Design.md` §8（按钮）、`frontend/src/utils/icon/`、`scripts/check-design-tokens.ts`、ADR-190（features→backend seam）、`resource_types.json`

---

## 1. 背景（Context）

### 1.1 问题

界面用 **emoji 充当 UI 图标**，实测（`check-design-tokens` 全仓扫描）**331 处硬编码字形、101 个不同字形**，横跨 51 个文件，最大热点 `tpl-settings.ts` 单文件 54 处。

同一仓库**已经有一套可用的 SVG 图标系统**（`utils/icon/workshop-icons.ts`，17 个图标），其样式约定是正确的：

```css
.ws-icon { width:1em; height:1em; vertical-align:-.15em; fill:none; stroke:currentColor; flex-shrink:0; }
.ws-icon[fill] { fill:currentColor; stroke:none; }
```

问题不是「没有体系」，而是**该体系只覆盖创作者/平台徽标域，UI chrome（按钮、标签页、状态提示）无图标可用**，于是开发者顺手写 emoji。这与设计令牌债同构——**体系与野路子并存**。

### 1.2 emoji 当 UI 图标的四个具体危害

| 危害 | 具体表现 |
|------|----------|
| **不受主题控制** | emoji 自带颜色，切主题时图标不跟随（`--accent`/`--muted` 失效），破坏一致性 |
| **跨平台渲染不一致** | WebView2 / Android WebView / 浏览器各用不同 emoji 字体，同一界面对不上 |
| **不参与缩放** | `--fs-scale`（无障碍字号）调节时 emoji 尺寸不可控，与相邻文字脱节 |
| **无法精细对齐** | emoji 内建 padding 与基线，`vertical-align` 难统一，密集 UI（工具条/标签）参差 |

### 1.3 关键边界：数据图标 ≠ UI 图标

**必须区分两类，混淆即违反治理红线**：

- **数据图标**（🚨不可动）：资源类型图标来自 `resource_types.json` 的 `icon`/`groupIcon` 字段，经 `typeIconOf()` / `fileIcon()` / `GROUP_META` 消费。依据根 `AGENTS.md`「类型判定唯一事实源 = `resource_types.json` + Go，前端只读不判」——**改它即越层重判归属**。
- **UI 图标**（本 ADR 范围）：硬编码在模板里的 chrome 字形（如 `>⚠️ ${errMsg}`、`>✅ ${t(...)}`）。

判定口径简单可靠：**扫描只报「字面量 emoji」**，`typeIconOf(X)` 这类调用点不含字形字面量，天然不被命中。故本 ADR 只治理后者。

### 1.4 边界补全：符号字形 / 文本槽 / 处理逻辑（2026-09 补）

§1.3 划的是「数据图标 ≠ UI 图标」。实测还留下三个**未明说的边界**——不写清就会出现
「按 D1 字面该迁、按危害论证可不迁、wiki 查不到结论」的空白（2026-09 菜单勘察时撞上）：

| 类别 | 判定 | 依据 |
|---|---|---|
| **结构槽的图标位** | **属 D1 范围，应走 SVG** | 含 `textContent = "✕"`（JS 赋值当图标）、CSS `::before{content:"✕"}`（样式生成当图标）、模板内联 `>✕</button>`。这些位置的符号与 emoji 同属「结构化图标位」，D1「一律走 SVG」按其字面即覆盖 |
| **文本槽内的符号** | **允许保留** | i18n 文案正文（`t("msg.done")` 里的装饰）与**文本标签拼接**（如 `'← ' + t("…")`）。理由：D1 已为 i18n 文案正文开豁免；且文本槽插 SVG 会破坏语义——同一串既投 `textContent` 又投 `title=` 属性时 SVG 会字面渲染（详见刀㉓ 的文本槽/结构槽分界） |
| **危险字形的处理逻辑** | **允许保留** | 如 `error-diary.ts` 的 `replace(/^[❌⚠]️?\s*/, "")` —— 那是**数据清洗**（消费已有文本），不是渲染图标位 |

**为什么符号字形危害较弱、优先级低于 emoji**：`✕` / `←` / `⟲` 是**单色且继承 `currentColor`**，
故 §1.2 四条危害里「不受主题控制」**不成立**、「不参与缩放」**部分不成立**（随 `font-size` 缩放）；
真正成立的只有「跨平台渲染不一致」与「无法精细对齐」（字形度量随字体漂移）。方向一致但急迫性低。

**图标库缺对应语义名时（关键纪律）**：**记为债，不得用外观近似的图标硬塞**——
例如用 `pointerLeft` 冒充「返回」，会把 D2 的语义命名体系腐蚀成外观匹配。
补图标属独立设计工作，且须遵 D2 命名（`back` / `panelHide`，而非 `arrowLeft` / `chevronLeft`）。

---

## 2. 决策（Decision）

### D1：UI 图标一律走 SVG，禁止硬编码 emoji 字形

新增/修改 UI 一律使用 `<svg>` 图标，经统一出口取用。emoji 仅允许出现在 **i18n 文案正文**（如 `t("msg.done")` 里的装饰）与**数据图标消费点**，不得作为结构化的「图标位」。

### D2：命名体系 = 语义名，不用字形名、不用外观名

图标以**用途**命名（`UI_ICONS.warning` / `.search` / `.delete`），而非外观（`.triangle` / `.magnifier`）或字形（`.emoji-warning`）。

理由：外观名把「实现」写进「调用点」——将来把 ⚠️ 三角换成圆形感叹号，语义名调用方零改动，外观名要全局改名。这是命名体系能否长命的唯一分水岭。

### D3：单一出口 `utils/icon/ui-icons.ts`，复用既有 `.ws-icon` 样式约定

- 图标集导出为 `UI_ICONS: Record<UiIconName, string>`，与既有 `ICONS` 同构（`workshop-icons.ts` 已验证此形态可行）；
- 尺寸/颜色**复用既有 `.ws-icon` 约定**（`1em` + `currentColor`），不新造第二套样式——避免「两套图标样式」成为新的漂移源；
- 调用方：`${UI_ICONS.warning}`（模板串直接嵌入，与既有 `ICONS`/`typeIconOf` 用法一致）。

### D4：字形 → 语义名 映射表纳入扫描器，债可追踪

`check-design-tokens` 的 emoji 命中项**附带建议语义名**（如 `⚠️ → UI_ICONS.warning`），使 275 处 UI chrome 债从「一堆 emoji」变成「按名字可机械收敛的清单」。这与令牌债的 `13px → var(--fs-md)` 建议同构。

### D5：不追求一次清完，按文件热度分批，且**不得新欠**

沿用 `check-design-tokens --baseline` 的「只减不增」策略：存量 331 处记入基线不阻塞提交，新增 UI 图标一律走 SVG。清债按热点文件（`tpl-settings` 54 → `detail-3d` 32 → …）分批推进。

---

## 3. 后果（Consequences）

### 正面

- 图标随主题变色（`currentColor`）、随 `--fs-scale` 缩放、跨平台渲染一致——三个危害同时消除；
- 语义命名让「换个图标长相」成为零调用方改动的局部变更；
- 债可度量：`check-design-tokens --kind emoji-icon` 给出精确清单与建议名。

### 负面 / 代价

- **SVG 体积略大于 emoji 字符**：单图标约 150–250 字节 vs emoji 4 字节。以 275 处估算增量约 40–70KB **未压缩**，gzip 后远低于此（重复图标串高度可压缩）。对桌面应用可接受。
- **需要建图标集**：未在集合内的字形需补 SVG 路径，是持续投入。

### 已知遗留（不在本 ADR 范围）

- **数据图标（`resource_types.json` 的 emoji）保持不动**——它们由 Go/JSON 驱动，改 SVG 属跨层重判，需另案（且要动 Go 侧契约）。
- **i18n 文案内 emoji** 不治理（非图标位）。
- 未在 `UI_ICONS` 覆盖的长尾字形（如 🦴🎤🙏😊 等约 30 个低频道具）暂留，按需增补。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `node scripts/check-design-tokens.ts --json --list --kind emoji-icon` | 331 处 / 101 字形 / 51 文件 |
| `frontend/src/utils/icon/workshop-icons.ts` | 既有 17 个 SVG 图标 + `.ws-icon` 样式约定（复用而非新造） |
| `resource_types.json` → `typeIconOf()` | 数据图标链路，本 ADR 明确排除 |
| `frontend/src/views/app-content/css/content-layout.ts`（`.ws-icon` 定义） | `1em` + `currentColor` 约定来源 |
| 根 `AGENTS.md` 职责归属红线 | 数据图标不可前端重判的依据 |

<!-- 文件名: ui.md → 实际文件 ADR-238-ui.md -->
