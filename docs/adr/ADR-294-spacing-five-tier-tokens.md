# ADR-294：间距五档令牌体系 --sp-*：为 UI-Design.md §5 间距系统补 CSS 变量（承接刀㉝ 架构断层）

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-22
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/UI-Design.md` §5 间距系统；`frontend/css/variables.css`；`scripts/_lib/design-tokens.ts`；`scripts/check-design-tokens.ts`；`tests/test_design_tokens.ts`；`docs/knowledge/frontend_design_critique.md` 刀㉝

---

## 1. 背景（Context）

2026-09 padding 立闸（刀㉝，提交 `355686a0a`/`a3525967a`）实测确认一个**架构断层**：

1. **§5 间距系统只有文档、无 CSS 变量**。`docs/UI-Design.md` §5 明文定义「5 档间距」（0 / 4px / 6-8px / 10-12px / 14-16px / 20-24px）与规则「不要使用 3px、7px、9px 等非标准值。要么 4 的倍数，要么用上述层级」——但**没有对应 CSS 变量**可供引用，条款形同虚设（「有规范无断言」的又一处）。
2. **存量 padding 主语义是「内容间距」而非「按钮内边距」**。立闸实测全仓 **454 处硬编码 padding、113 种值**；定量分析（442 处高频值）显示仅 **46 处**能精确映射到既有 `--btn-padding-*`/`--pad-*`（按钮/标签缩放档），其余 **319 处**是 `2px 8px`/`12px`/`0 4px`/`6px 10px`/`8px 12px` 这类**内容/列表/卡片间距**——`--pad-*` 语义上承载不了（它们是按钮/标签的 3-6px 垂直缩放档），硬套即「语义冒充」。
3. **判定闸已立、无档可归**（刀㉝ 交付）：`css-padding`/`inline-style-padding` 已入 `check-design-tokens` 门禁行级拦截（新增零债），存量 454 处入基线 463 条。但存量**无处可收敛**——缺一个与 §5 语义对齐的令牌目标。

## 2. 决策（Decision）

**D1 新建 `--sp-*` 间距五档令牌**（`frontend/css/variables.css` :root，随 `--fs-scale` 缩放，与 `--pad-*` 同构）：

| 令牌 | 基准值 | §5 对应 | 用途 |
|------|--------|---------|------|
| `--sp-1` | 4px | 层级 1 | 图标与文字之间、小元素内边距 |
| `--sp-2` | 8px | 层级 2（6-8px） | 列表项间距、小元素间距 |
| `--sp-3` | 12px | 层级 3（10-12px） | 卡片内边距、段落间距 |
| `--sp-4` | 16px | 层级 4（14-16px） | 区块间距、大按钮边距 |
| `--sp-5` | 24px | 层级 5（20-24px） | 页面主间距 |

取各档**代表值（4 的倍数）**而非区间值——§5 规则「要么 4 的倍数，要么用上述层级」，代表值是「4 的倍数 ∩ 层级」的交点，语义最稳。缩放系数沿用 `--pad-*` 同款 `calc(Npx + var(--fs-scale) * X)` 形态（`--fs-scale` 是用户可调字号，间距随字号缩放是既有体系的设计意图）。

**D2 padding 判定建议升级为 `--sp-*` 优先**：`suggestPaddingToken` 新增 `--sp-*` 档表；单值 padding 在「距某 `--sp-*` ≤2px」时建议 `--sp-*`（优先于 `--pad-*` 垂直档，因内容间距语义归 `--sp-*` 更贴切）；`--pad-*` 仅当「按钮/标签角色」语义明确时由人工选用。组合值仍建议 null（存量收敛人工按元素归档）。

**D3 存量收敛方向 = 按元素语义归 `--sp-*`/`--pad-*`**：`4px`/`8px`/`12px`/`16px`/`24px` 单值优先 `--sp-*` 档；`2px 8px`/`4px 12px` 这类「横竖组合」若元素是按钮/标签角色归 `--btn-padding-*`，否则归 `--pad-*` 垂直档 + 横向保留或新组合档（本轮不新增组合档，组合值收敛见 D4）。

**D4 明拒（防止体系膨胀）**：本轮**不建** `--sp-*` 的「横竖组合」变体（`--sp-2x-3` 之类）——组合值语义需逐元素判断，新增组合档会以 4 倍速度膨胀令牌面；组合值收敛留在存量分批时按需决策。`--space-sm`/`--space-md`（既有缩放间距，消费仅 `ui-prefs.ts` 算行高）**不动**——它们是「垂直缩放间距」语义，与 `--sp-*`「内容间距标量」不同轨，勿合并（同源反例：刀④ 删死令牌的教训）。

## 3. 后果（Consequences）

- **正面**：§5「5 档间距」从「文档口头规范」变成「可引用令牌」，判定闸对新单值 padding 能给 `--sp-*` 建议；存量 319 处「内容间距」有了语义正确的收敛靶；与 `--fs-*`/`--pad-*` 同构（随 `--fs-scale` 缩放），体系自洽。
- **负面**：新增 5 个令牌需在 `variables.css` + 契约测试表 + 知识卡同步登记；`--sp-*` 与 `--pad-*` 界限（内容间距 vs 按钮垂直档）需成文口径防混用（同刀㉜ 成文纪律）。
- **已知遗留**：组合值（`2px 8px` 等）仍无机械建议、需人工归档；存量 454 处分批收敛的完整清账不在本 ADR 实施范围（基线收缩是渐进目标）；`--space-*` 与 `--sp-*` 的并存是刻意（语义不同轨）。

## 4. 数据溯源

`docs/UI-Design.md §5`（五档规范）→ `frontend/css/variables.css :root`（`--sp-1..5` 声明）→ `scripts/_lib/design-tokens.ts|PAD_TOKEN_VERTICAL`/`suggestPaddingToken`（判档表 + 建议升级，`--sp-*` 优先）→ `scripts/check-design-tokens.ts`（ERROR_KINDS/KIND_LABEL 复用既有 padding 类目）→ `tests/test_design_tokens.ts`（契约用例锁定档表与 variables.css 对账）→ `docs/knowledge/frontend_design_critique.md` 刀㉝（架构断层记录）。