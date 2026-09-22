# ADR-295：组合间距档 --sp-vh-*：为高频「垂直+横向」组合值补标准化令牌（承接 ADR-294 D3 存量收敛）

- **状态**：✅ 已采纳（D1/D2/D3 落地；D4 取代 ADR-294 的「明拒不建组合档」）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-22
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-294（`--sp-*` 五档体系）；`docs/UI-Design.md` §5 间距系统；`frontend/css/variables.css`；`scripts/_lib/design-tokens.ts`

---

## 1. 背景（Context）

ADR-294 三波收债后（基线 463→377 条），剩 377 条 padding 债的**量化构成**（2026-09-22，`quantify-debt.cjs`）：
- **前 13 个高频值占 185 条（52%）**：`2px 8px`×25、`4px 6px`×17、`4px 10px`×16、`8px 12px`×15、`2px 6px`×14、`2px 4px`×14、`2px 0`×14、`6px 10px`×13、`8px 10px`×12、`4px 12px`×12、`4px 8px`×12、`6px 8px`×9、`6px 12px`×9。
- **共性**：绝大多数**垂直分量完全对齐既有档**（`4px→--pad-filter`、`6px→--pad-nav`、`2px→--pad-btn-tool`），**横向分量是无档自由值**（10/6/8px 等）。元素角色几乎全是「按钮/标签/菜单项/cursor:pointer」或「行/面板内容」。

**关键事实**（查证 `docs/UI-Design.md` §5）：横向 10px 属于层级 3（**10–12px** 区间下沿）、6/8px 属于层级 2（**6–8px** 区间）——**不是非标准值**。但 `--sp-1..5` 只取了区间**上沿**单值（12/8/4px），没有「下沿」抽取；`--btn-padding-*` 只有 sm/md/lg/filter 四个固定横向组合（6/8/12px）。

**既有约束**：`--btn-padding-*` 补档要防「横向 10/6px 无处归」；方案不能引入闸豁免漏洞（`design-tokens.ts` ⑥ padding 段：含 var() 即不判——混合态 `var(--x) 10px` 会让硬编码分量逃逸审计）。

## 2. 决策（Decision）

**D1 新增一组「垂直+横向」标准组合档 `--sp-vh-*`**（`frontend/css/variables.css` :root，随 `--fs-scale` 缩放）：

| 令牌 | 展开 | 垂直 | 横向 | 定位 |
|------|------|------|------|------|
| `--sp-vh-btn` | `var(--pad-nav) 10px` | 6px | 10px | 列表行/菜单项 |
| `--sp-vh-pane` | `var(--sp-2) var(--sp-3)` | 8px | 12px | 滚动容器/卡片正文/设置行（覆盖率×15，实测最高） |
| `--sp-vh-block` | `var(--sp-5) var(--sp-3)` | 24px | 12px | 进度块/空态区块 |

命名遵循 `--sp-vh-*`（vertical-horizontal）前缀，语义=「内容间距的 垂直+横向 组合」，承接 §5 层级但**不占 `--btn-padding-*` 按钮专属语义**。横向为**字面量**（与 `--btn-padding-*` 既有四档同构：横向定值、垂直随 `--fs-scale` 缩放）。

**D2 不新增「横向下沿」令牌**（不建 `--sp-2b`/`--sp-3b` 之类）——下沿值是**裁量区间**，建档会以 2 倍速度膨胀令牌面（同 ADR-294 D4 反对膨胀的理由）。横向 10/6px 这类**下沿仅按钮/标签角色**用，按 D3 归 `--btn-padding-*` 扩展或留人工。

**D3 新增 `--btn-padding-*` 的两个横向扩展档**（按钮/标签专属，横向 10/8px 下沿）：

| 令牌 | 展开 | 垂直 | 横向 | 覆盖高频值 |
|------|------|------|------|-----------|
| `--btn-padding-tool-lg` | `var(--pad-btn-tool) var(--sp-2)` | 2→3px* | 8px | `2px 8px`×25 |
| `--btn-padding-filter-lg` | `var(--pad-filter) var(--sp-3)` | 4px | 12px | `4px 12px`×12 |

\* 垂直 2px 无 §5 档（`--pad-btn-tool`=3px 是按钮最小垂直档），归位会 +1px 位移——**此为按钮最小垂直档的自然映射**，与既有 `--btn-padding-sm` 同哲学（刀㉝ 已认可 3px 是工具按钮标准）。

**D4 修订 ADR-294 的「明拒不建组合档」**：ADR-294 D3 曾说「组合值收敛见 D4」「本轮不新增组合档」——现以新档补足高频值，**取代 D4 的保守立场**。但保留其「防膨胀」精神：**只建覆盖率高的档，不为孤品建档**（实测执行口径：可展开的 10 种值里只取覆盖率 Top 2，其余 8 种合计 15 条留存量债）。

## 3. 后果（Consequences）

- **正面**：`2px 8px`×25 + `4px 12px`×12 + 部分 `8px 12px`/`6px 10px` 等可一把归位 **~70-90 条**；横向下沿值（10/6px）获得 §5 合法归档而非「无档可归」。
- **负面**：新增 5 个令牌需同步 `variables.css` + 契约测试表 + 知识卡；`--sp-vh-*` 与 `--btn-padding-*` 界限（内容 vs 按钮垂直）需成文防混用；`2px→3px` 的 +1px 位移在极小按钮上可感知。
- **已知遗留**：仍孤品（`5px 14px`、`7px 16px`、三/四值非对称）约 50 条继续留人工；D4 只覆盖 Top 高频，不保证清零。

## 4. 数据溯源

`docs/UI-Design.md §5` → `frontend/css/variables.css`（`--sp-vh-*`/`--btn-padding-*` 新档）→ `scripts/_lib/design-tokens.ts`（判档表扩容）→ `tests/test_design_tokens.ts`（契约锁档）→ `scripts/baseline/design-tokens-baseline.json`（存量收缩）→ 知识卡刀㉝（实施进度）。