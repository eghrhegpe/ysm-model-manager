/**
 * token-tables.ts — 设计令牌**值表**（2026-10-25 从 design-tokens.ts 沿真缝拆出）。
 *
 * 内容：字号/圆角基准表、间距五档、按钮垂直档、组合 padding 档与其展开值，
 * 以及阴影 / 过渡时长 / 过渡简写三张令牌值表。**纯数据 + 原注释**，不含判定逻辑。
 *
 * 为什么与建议器分家：本表是「唯一事实源」，与 frontend/css/variables.css 的一致性
 * 由 tests/test_design_tokens.ts 解析真实 CSS 比对锁定；建议器（token-suggest.ts）
 * 只是它的消费者。表改动与判定逻辑改动是两类审阅关注点，分开后 diff 语义更清楚。
 *
 * 导出面经 ./design-tokens.ts 透出，消费方零改动。
 */

/**
 * 硬编码 px 值 → 令牌名 的候选表（值必须精确相等才建议）。
 *
 * 数据来源：`frontend/css/variables.css` 的 `--fs-*` / `--radius-*` 基准值注释
 * （如 `--fs-md: calc(var(--fs-base-size) + 1px + var(--fs-scale)); /* 13px @ 基准 *\/`）。
 * 之所以**硬编码此表**而非运行时解析 calc()：calc 表达式里 `--fs-scale` 是运行时变量，
 * 静态求值需要一套 CSS calc 解释器，收益为零——这里是「建议替换」不是「语义判定」，
 * 表与 variables.css 的一致性由 tests/test_design_tokens.ts 的契约用例锁定
 * （解析 variables.css 真实文本比对，漂移即测试红）。
 */
export const TOKEN_PX_BASELINE: Readonly<Record<string, number>> = {
  // 基础字号（--fs-base-size: 13px 为基准）
  "--fs-tiny": 8,
  "--fs-xs": 11,
  "--fs-sm": 12,
  "--fs-base": 13,
  "--fs-md": 14,
  "--fs-lg": 15,
  "--fs-xl": 25,
  // 语义字号（同样派生自 --fs-base-size；此处为基准 13px 时的等价像素）
  "--fs-nav": 16,
  "--fs-tab": 13,
  "--fs-filter": 12,
  "--fs-btn-primary": 13,
  "--fs-btn-secondary": 12,
  "--fs-btn-tool": 12,
  // 圆角
  "--radius-xs": 3,
  "--radius-sm": 4,
  "--radius-md": 6,
  "--radius-lg": 8,
  "--radius-xl": 10,
  "--radius-pill": 20,
};

/**
 * padding 硬编码判定（2026-09 立闸；2026-09 ADR-294 升级 --sp-* 优先）。
 *
 * 为什么补：`docs/UI-Design.md` §5 间距系统明文「不要使用 3px、7px、9px 等
 * 非标准值。要么 4 的倍数，要么用上述层级」，且 §语义化间距变量定义了
 * [--pad-*] 垂直语义档、[--btn-padding-*] 完整简写档——但判定层原只覆盖
 * font-size/radius/color/emoji/shadow/transition，**padding 长期零守护**。
 * 实测全仓 454 处硬编码 padding（值高达 113 种），规范与实际严重漂移。
 *
 * [ADR-294 D2] 判定建议升级为 [--sp-*] 优先：存量 padding 主语义是**内容间距**
 * （4/8/12/16/24px，对应 §5 五档），非按钮垂直档（--pad-*）。故单值先落 [--sp-*]
 * （内容间距默认），[--pad-*] 仅承接 3/5/6px 这类 [--sp-*] 无档的按钮/标签垂直值。
 *
 * 判定口径（与 transition 反转同哲学——硬编码即债，能安全归位才给建议）：
 *   - **一律报**：`padding: Npx`（内联或 CSS 块，含 `0` 与组合值）→ 应走令牌档；
 *   - **只给精确建议**：单值 `padding: Npx` → 就近 [--sp-*]（内容间距）或 [--pad-*]；
 *     组合值（`4px 8px` 等）涉及横向语义，机械收敛是存量的事，建议给 null
 *     （照报但宁可不猜，与 transition 先例一致）。
 *
 * 档位基准值见下方表格，与 variables.css 的一致性由测试契约锁定。
 */
/** 间距五档（ADR-294）：内容间距标量，4 的倍数 ∩ §5 层级。 */
export const SP_TOKEN_VERTICAL: Readonly<Record<string, number>> = {
  "--sp-1": 4,
  "--sp-2": 8,
  "--sp-3": 12,
  "--sp-4": 16,
  "--sp-5": 24,
};
/** 按钮/标签垂直档（3-6px）。 */
export const PAD_TOKEN_VERTICAL: Readonly<Record<string, number>> = {
  "--pad-btn-tool": 3,
  "--pad-filter": 4,
  "--pad-btn-secondary": 4,
  "--pad-tab": 5,
  "--pad-btn-primary": 5,
  "--pad-nav": 6,
};

/**
 * [--sp-*] 的地板值 = §5 层级1（4px）。低于它的值不属内容间距语义
 * （见 nearestPadToken 的 ADR-295 附则）。
 */
export const SP_FLOOR_PX = 4;

/**
 * 组合 padding 档（ADR-295 D1 — 高频「垂直+横向」组合值的标准归档）。
 *
 * 为什么补：ADR-294 三波收债后剩 377 条，量化显示前 13 高频值占 185 条（52%），
 * 垂直分量全对齐既有档、横向无档可归（10/6/8px 属 §5 层级区间下沿非标准值）。
 * D4 原「明拒不建组合档」的保守立场以本档表**取代**（见 ADR-295），但保留防膨胀
 * 精神——只建覆盖率高的档，不为孤品建档。
 *
 * 键 = 源组合值（`垂直px 横向px`），值 = 目标令牌名。
 * ⚠️ 本表只给**精确命中**建议，不做就近——组合值就近会给错答案（横向语义是作者裁量）。
 * 与 SP/PAD 垂直表的「近档 ≤2px」哲学不同轨。
 *
 * 展开值对账由契约测试锁定（tests/test_design_tokens.ts：解析 variables.css 的声明，
 * 须等于 COMBO_EXPANSION 的期望 px）——**防「令牌名写对、展开值写错」的静默位移**
 * （本表初稿即踩过：--sp-vh-btn 误写 var(--sp-3)=12px，而源值是 10px）。
 *
 * 覆盖高频值（2026-09-22 实测）：
 *   `2px 8px`×25 按钮/标签小控件 → --btn-padding-tool-lg（垂直 2→3px，+1px 映射按钮最小档，已拍板）
 *   `3px 8px`×6  与 tool-lg 同展开值的既有写法 → --btn-padding-tool-lg（值等价，补建档遗漏——表键曾只认源值 2px 8px，漏了同展开值的 3px 8px）
 *   `4px 8px`×12 次要按钮/列表项 → --btn-padding-md（值等价，复用既有档）
 *   `3px 6px`×3  工具栏小按钮   → --btn-padding-sm（值等价，复用既有档）
 *   `2px 6px`×14 紧凑按钮      → --btn-padding-sm（垂直 2→3px，+1px 映射按钮最小档，同 tool-lg 哲学）
 *   `2px 4px`×14 紧凑输入/选择器 → --btn-padding-xs（值等价，新档）
 *   `4px 10px`×16 标准按钮/输入载体 → --btn-padding-std（值等价，新档）
 *   `6px 12px`×9  栏/头部/配置行容器 → --sp-vh-hdr（值等价，新档）
 *   `8px 10px`×11 内容卡片行/菜单行 → --sp-vh-card（值等价，新档；2D 卡片 + 3D 面板行共用同一组合）
 *   `8px 2px`×5   性能诊断图表容器   → --sp-vh-perf（值等价，新档；perf-trend/trace/concurrent/single-bench 同源；横向 2px 为图表贴边刻意极窄）
 *   `4px 12px`×12 筛选/操作按钮 → --btn-padding-filter-lg（值等价）
 *   `6px 10px`×13 列表行/菜单项 → --sp-vh-btn（值等价，内容间距组合）
 *   `8px 12px`×15 滚动容器/卡片正文/设置行 → --sp-vh-pane（值等价）
 *   `24px 12px`×6 进度块/空态区块 → --sp-vh-block（值等价）
 *
 * ⚠️ 只收录**内容/按钮语义明确且覆盖率≥5** 的组合（ADR-295 D4 防膨胀口径）；
 * `8px 0`/`12px 0`/`12px 16px`/`0 8px` 这类低频或方向残缺值**不建档**（留存量债）。
 * ⚠️ 例外（用户拍板 2026-09-22）：`2px 0`×14 / `1px 0`×6 —— 纯垂直呼吸簇
 *   （hint 文本/列表行/错误行的「上下内边距 + 横向贴边 0」语义），覆盖率远超 D4 门槛，
 *   故打破「方向残缺不建档」条目，建 `--pad-v-2`/`--pad-v-1`。其余方向残缺值（`8px 0`
 *   等）仍不建档。
 */
export const COMBO_PADDING_TOKENS: Readonly<Record<string, { token: string }>> = {
  "2px 8px": { token: "--btn-padding-tool-lg" },
  "3px 8px": { token: "--btn-padding-tool-lg" },
  "4px 8px": { token: "--btn-padding-md" },
  "3px 6px": { token: "--btn-padding-sm" },
  "2px 6px": { token: "--btn-padding-sm" },
  "2px 4px": { token: "--btn-padding-xs" },
  "4px 10px": { token: "--btn-padding-std" },
  "6px 12px": { token: "--sp-vh-hdr" },
  "8px 10px": { token: "--sp-vh-card" },
  "8px 2px": { token: "--sp-vh-perf" },
  "2px 0": { token: "--pad-v-2" },
  "1px 0": { token: "--pad-v-1" },
  "4px 12px": { token: "--btn-padding-filter-lg" },
  "6px 10px": { token: "--sp-vh-btn" },
  "8px 12px": { token: "--sp-vh-pane" },
  "24px 12px": { token: "--sp-vh-block" },
};

/**
 * 组合档的**期望展开值**（[垂直, 横向] px @ `--fs-scale:0`），供契约测试与
 * variables.css 声明文本对账——单一事实源是 CSS，本表是「期望」侧。
 * 与源值的差值即**已拍板的位移**（当前仅 tool-lg 垂直 +1px）。
 */
export const COMBO_EXPANSION: Readonly<Record<string, readonly [number, number]>> = {
  "--btn-padding-tool-lg": [3, 8],
  "--btn-padding-md": [4, 8],
  "--btn-padding-sm": [3, 6],
  "--btn-padding-xs": [2, 4],
  "--btn-padding-std": [4, 10],
  "--btn-padding-filter-lg": [4, 12],
  "--sp-vh-btn": [6, 10],
  "--sp-vh-pane": [8, 12],
  "--sp-vh-block": [24, 12],
  "--sp-vh-hdr": [6, 12],
  "--sp-vh-card": [8, 10],
  "--sp-vh-perf": [8, 2],
  "--pad-v-2": [2, 0],
  "--pad-v-1": [1, 0],
};

/**
 * `--shadow-*` 令牌的**归一化值**（供 box-shadow 精确比对）。
 *
 * 归一化口径见 `normalizeShadowValue`——把 `rgba(0,0,0,.25)` 与
 * `rgba(0, 0, 0, 0.25)` 归到同一形态。值来自 `frontend/css/variables.css`。
 *
 * ⚠️ **只用于「精确相等才建议」的比对**，不做数值近似：实测全仓硬编码 box-shadow
 * 里绝大多数是刻意的非令牌值（焦点环 `0 0 0 3px color-mix(...)`、比 `--shadow-xl`
 * 更重的浮层阴影 `0 8px 24px rgba(0,0,0,.5)`）。对这些报违规＝把设计意图当债务，
 * 属本模块注释里批判过的「自造规则」，故一律不报。仅「与某令牌完全同值」者报。
 */
export const SHADOW_TOKEN_VALUES: Readonly<Record<string, string>> = {
  "--shadow-sm": "0 1px 3px rgba(0, 0, 0, 0.06)",
  "--shadow-md": "0 2px 8px rgba(0, 0, 0, 0.1)",
  "--shadow-lg": "0 4px 16px rgba(0, 0, 0, 0.15)",
  "--shadow-xl": "0 8px 32px rgba(0, 0, 0, 0.25)",
};

/**
 * `--tr-*` 令牌的**时长分量**（秒）→ 令牌名。
 *
 * 为什么只比时长分量、不比整条 transition：实测 transition 是复合值
 * （`background .12s ease` / `all .15s ease` / `transform .2s cubic-bezier(...)`），
 * 属性名与缓动函数千变万化，整值精确相等几乎永不命中（实测全仓 0 例），
 * 而**时长**才是令牌真正约定的部分（`--tr-fast/normal/enter` 的差异就在时长与缓动）。
 * 故口径：transition 里出现「与某令牌时长相等」的时长分量 → 提示改用该令牌。
 *
 * 取 0.12 / 0.15 / 0.25 三档（对应 --tr-fast / --tr-normal / --tr-enter）。
 * 注意 `--tr-fast` 与 `--tr-normal` 的缓动同为 ease、仅时长不同，故按值即可区分。
 */
export const TRANSITION_TOKEN_DURATIONS: Readonly<Record<string, number>> = {
  "--tr-fast": 0.12,
  "--tr-normal": 0.15,
  "--tr-enter": 0.25,
};

/**
 * `--tr-*` 令牌的**完整简写值**（时长 + 缓动），供「整值等价替换」判定。
 *
 * 与 `TRANSITION_TOKEN_DURATIONS` 分工：
 *   - 前者供**报告**（时长撞车即提示，即使缓动不同也让作者知道有此令牌可对齐）；
 *   - 本表供 **--fix**（整值替换，必须时长与缓动**双双**一致才动，否则会改语义）。
 *
 * 为什么必须分两档（实测教训）：`transform .25s ease` 与 `--tr-enter`（`0.25s ease-out`）
 * 时长相同但缓动不同——若只看时长就自动替换，会把「平滑 ease」偷偷变成「减速 ease-out」，
 * 属**静默改变动效观感**。这类必须留给人工判断（是要对齐令牌，还是令牌该加一档）。
 */
export const TRANSITION_TOKEN_VALUES: Readonly<Record<string, { dur: number; ease: string }>> = {
  "--tr-fast": { dur: 0.12, ease: "ease" },
  "--tr-normal": { dur: 0.15, ease: "ease" },
  "--tr-enter": { dur: 0.25, ease: "ease-out" },
};
