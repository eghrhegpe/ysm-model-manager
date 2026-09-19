# ADR-275：css-layer-check 检查 6：跨层存在性——收口命名空间盲区

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-274](./ADR-274-css-layer-check.md)（检查 3 判定域自推导，本 ADR 补它的对偶盲区）、[ADR-121](./ADR-121-shadow-dom.md)、`scripts/css-layer-check.ts`（检查 6）、`scripts/_lib/css-layer-utils.ts`（`findUndefinedAnywhereClasses`）、`tests/test_css_layer_check.ts`（第 9 条锁）

---

## 1. 背景（Context）

ADR-274 把检查 3 的判定域从手写前缀表改为「本域 CSS 自己定义过的命名空间」自推导，消除了「漏登记一族 = 整族静默失明」。但该决策同时写明了一条**有意边界**：

> 本域**从未**定义过任何该族类时无法判定——此时该族可能定义在别的层或靠内联样式，不报。

2026-09 实测这条边界盖住了 **42 个类**（关掉自推导域过滤跑全量）：

| 类目 | 数量 | 定性 |
|---|---|---|
| `dlg-*` / `br-*` | 30 | **边界正确**——document 层对话框模板，由 `components.css` 服务；域归属是目录级，模板住在 app-tree 目录却发 document 层标记 |
| `stage-item` / `model-detail-title` | 2 | **正确**——样式完全内联 |
| `lt-*` | **7** | **真缺陷** |
| `heatmap-bar-*` | 3 | 装饰性无操作类（布局由内联容器与 bar 的 height/color 承载） |

**`.lt-*` 是真缺陷**（`views/app-preview/litematic-meta.ts`）：

- `.lt-color-swatch` 只有内联 `background`、**没有尺寸** ⇒ 空 inline span **恒不可见**，方块颜色色块根本没渲染；
- `.lt-meta-row` / `.lt-meta-label` 无规则 ⇒ label/value 不分离、label 不弱化；
- 同文件 121 行那一行是**全内联**的（`display:flex;justify-content:space-between;padding:4px 0;…`）⇒ 证明作者本意如此，只是没落进 CSS。

该命名空间（`lt-`）在 app-preview 域内从未被定义过，故检查 3 的自推导域**结构上不可能覆盖它**——不是漏判，是判定面不含。

**同时实测否决了「对偶检查」**（定义了但没人用）：naive 版报 **617** 条，排除样式源后 ≤1 次出现的仅 15 条，其中真死 **0**（`perf-conc-warn/bad` 是 JS `cls:` 引用、6 个 `stg-*` 另有引用）。仅凭 `class="..."` 的文本出现与否判「没人用」，必然被 `classList.add` / `querySelector` 的运行时类淹没。此结论写入本 ADR，避免后人重走。

## 2. 决策（Decision）

**新增检查 6「跨层存在性」：shadow 域模板用到的类，若在「所有 shadow 域 CSS ∪ document 层 `frontend/css/*.css`」都没有定义 → WARN。**

1. **换全局口径**，而不是继续扩大检查 3 的域：检查 3 问「本域命名空间里用了却没定义」，检查 6 问「**哪儿都没定义**」。二者对偶，覆盖两类错名形态——前者抓「改名后新名没写进本域 CSS」，后者抓**整族错名 / 从未实现**（`lt-*` 即后者）。
2. **判定面刻意不含 JS 引用启发式**。`classList` / `querySelector` / 字符串引用的全仓扫描会引入巨量假阳性（实测 617 / 0），故**不做**。判据只有一条：**在任何 CSS 层里出现过定义没有**。
3. **豁免走既有单点** `KNOWN_NO_CSS_CLASSES`（逐类附理由），不新增第二处白名单。检查 3 与检查 6 共用它。
4. **保守口径：定义过即放行**。document 层定义**并不穿透 shadow 边界**，严格说「在 `components.css` 定义 + 在 shadow tpl 使用」才是真越界；但那属检查 3 的域判定职责，检查 6 只做「存在性」这一最弱断言——**宁漏勿误报**，不与检查 3 重叠。
5. **级别 WARN**（与检查 3 一致）：「内联承载」是合法形态，需人工确认；不看就不阻断。

**首跑结果**：9 条 WARN，**0 假阳性**——`heatmap-bar-*`(3) / `stage-item` / `model-detail-title` / `stat-item` / `gray` / `br-preset` / `br-file-cb`，逐一取证后全部登记豁免：

- `br-preset` / `br-file-cb` 是**共类 + JS 钩子**（分别与 `.dlg-preset-chip` / `.br-cb` 同用，后者在 `components.css` 有定义；且被 `batch-rename-form.ts` 的 `querySelectorAll` 消费）；
- `heatmap-bar-*` 的布局由内联容器（`display:flex;align-items:end;gap:4px`）与 bar 的内联 `height` / `background` 承载，bar 宽度由 label 文本撑开 ⇒ **实际渲染为合法柱状图**（初判「严重」属过度）；
- `gray` 是 `app-sidebar`「无YSM」标记的灰变体：`.tag` 基类已定义，green/red/orange 变体均限 `.instance-card-header` 作用域，`gray` **从未定义** ⇒ 记为**设计缺口**（非漏迁），标记仍继承 `.tag` 样式。

## 3. 后果（Consequences）

**正面**

- **42 类盲区全部归因收口**：30 类 document 层（边界正确）+ 7 类 `lt-*`（真缺陷，已补 `app-preview/css.ts` 真规则）+ 9 类豁免（逐类附理由）= **0 未归因**。
- `lt-*` 这类「错名断链」第一次可被机检发现——补检查之前，它在样式侧与标记侧**同时静默**（用了的族从未定义 ⇒ 检查 3 不报；定义的没人用 ⇒ 当时也没有对偶检查）。
- 顺手抓出 `br-preset` / `br-file-cb` 两个「族内特例漏定义」与 `gray` 设计缺口——检查 3 因整族在 `components.css` 有定义而从不细看。

**负面 / 代价**

- 新增一类 WARN，合法「内联承载」类需登记豁免（本次 9 条）。这是**有意的**：豁免面就是这份名单，看得见、可复核，且「从名单移除即重新告警」倒逼复核。
- 保守口径会漏掉「仅在 document 层定义却在 shadow tpl 使用」的真越界（那属检查 3 职责，此处刻意不重复）。

**已知遗留**

- 不做 JS 引用感知，故「纯 JS 钩子且无共类的类」会被误报——目前全仓 0 例（`ha-preview` / `ha-copy` 等既有豁免即此类），出现时按豁免登记处理。
- `gray` 的设计缺口**未修**（灰底色取值属设计决策），仅登记豁免并在评审报告中提出。

## 4. 数据溯源

- 关闭自推导域过滤实测残余盲区：**42 类**（分类见 §1 表）。
- 对偶检查实测否决：naive 版 **617** 条 → 排除样式源后 ≤1 次出现 15 条 → 真死 **0**。
- 检查 6 首跑：**9 条 WARN / 0 假阳性**；逐类取证见 §2（`br-preset` 共类 `dlg-preset-chip` 定义于 `components.css`；`br-file-cb` 共类 `br-cb` 同；`gray` 与 `.tag.green|red|orange` 的对比见 `sidebar-css.ts:39-42`）。
- `lt-*` 全仓零规则取证：`grep '\.lt-'` 仅命中 `litematic-meta.ts` 自身模板（无任何 CSS 层定义）。
- `.hm-*` 死 CSS（13 条）+ 孤儿令牌 `--hm-0..4`：`grep` src 与 e2e 零消费者；git 考古 `-S 'hm-grid'` 显示引入后从未被消费 ⇒ 与 `heatmap-bar-*` 构成错名孪生体，本次一并删除。
- 契约测试第 9 条锁：`findUndefinedAnywhereClasses` 三态（未定义→报 / 已定义→不报 / 已豁免→不报）。
