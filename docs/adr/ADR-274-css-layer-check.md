# ADR-274：css-layer-check 类归属判定：手写前缀表改为自推导命名空间

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/css-layer-check.ts`（检查 3 判定域 + 两个提取器）、`scripts/_lib/css-layer-utils.ts`（`expandStyleInterpolations`）、`tests/test_css_layer_check.ts`、[ADR-121](./ADR-121-shadow-dom.md)（§2.4 被本 ADR 取代）

---

## 1. 背景（Context）

2026-09 诊断菜单锐评深挖时发现：`frontend/src/views/app-content/tpl.ts` 里的 `.perf-wrap` / `.perf-controls` 在**整个 `frontend/` 零 CSS 规则**——性能面板 11+ 控件的"控制条"没有任何布局样式，靠 UA 默认 inline 流换行。而 `scripts/css-layer-check.ts` 检查 3（「shadow 类无定义 → WARN」，正是为抓这类问题而生）**全绿零告警**。

逐层取证，查出检查 3 有**三个互相独立的结构性缺陷**：

1. **FN-1 · 手写前缀表漏一族 = 整族静默失明**。判定域来自 `DOMAIN_PREFIXES["app-content"]`，该表列了 `stg-`/`repo-`/`cr-`/`gh-`/`ws-`/`diag-`/`recy-`… 却**没有 `perf-`**，尽管 app-content 自己的 CSS 定义了 12 个 `.perf-*` 类。于是 `perf-*` 族"用了但没定义"对本闸完全不可见。ADR-121 §2.4 把它记作**有意设计**（"若需专属前缀锁定，在 `DOMAIN_PREFIXES` 增补前缀数组"）——opt-in 子集，漏登记纯靠人记。
2. **FN-2 · 共享注入样式对闸不可见（两半）**。
   - `extractClasses` 的正则 `/\.([a-zA-Z][\w-]*)/g` **不剥注释**：`content-layout.ts` 一句说明注释 `/* … .btn-base（utils/dom/css.ts 注入）… */` 让 `.btn-base` 被当成"已定义"——**判定随"有没有那句话"漂移**。
   - 真正定义 `.btn-base` / `.dd-wrap` / `.dd-menu` 的是运行期注入的共享常量（`${btnBaseCSS}` / `${dropdownBaseCSS}`），而 `expandKeyframeInterpolations` 有一条 `!/@keyframes/.test(lit) → continue` 的过滤，**刻意不展开非 keyframes 常量**（原注释点名 `btnBaseCSS`，理由是"不扰动检查 3 基线"）。结果是这些**真实生效的定义**既看不见、又被注释侥幸掩护。
3. **FP-1 · 拼接模板里的变量名被当类名**。`extractHtmlClasses` 的注释自称"过滤拼接噪声"，但只滤标点不滤标识符——`class="' + healthTagClass + '"` 把变量名 `healthTagClass` 收作类名。

三者的共同后果：闸报告的**不是**"哪些类没定义"，而是"哪些类在'手写前缀表 ∩ 非注释 ∩ 非注入常量'这个交集里没定义"。**判定面与实际事实无关，与清单的完整度有关**——这正是 design-tokens 预筛关键词表、emoji 闸位置口径之后，同一规律的第三次现形（"闸只看得见它被写死的那一类位置"）。

## 2. 决策（Decision）

**检查 3 的判定域改为「本域 CSS 自己定义过的命名空间」自推导，删除 `DOMAIN_PREFIXES`。**

1. **判定域自推导**（`deriveNamespaceStems`）：本域 CSS 里出现 `.perf-bar-row` → 认定 `perf-` 属本域 → `perf-wrap` / `perf-controls` 落在域内、无定义即 WARN。把"该不该锁"从**人手记忆**变成**证据**：本域没定义过该族就不锁（不误报 document 层 `.dlg-*` 这类跨层模板），本域定义了该族却用了没定义的类，就是漏定义。
2. **两个提取器修缺陷**：`extractClasses` 先剥 CSS 注释（注释不是定义）；`extractHtmlClasses` 遇到含 `$` 或 `+` 的属性值整组跳过（动态表达式里的标识符是变量名，不是类名）。**宁漏勿误报**。
3. **共享样式常量一律展开**：`expandKeyframeInterpolations` 更名为 `expandStyleInterpolations`，删除 `@keyframes` 过滤。插值进来的常量**就是本 shadow 实际 adopt 的样式**，判定基线本就该建立在"shadow 真正拿到什么"之上。（对检查 1/1b/1c 无影响：共享常量里唯一的 `animation` 声明是 `noAnimationsCSS` 的 `animation: none !important`，`extractAnimationRefs` 显式跳过含 `none` 的体。）
4. **豁免面唯一**：合法但无规则的类（样式写在内联 `style` 用 token、或纯 JS/e2e 钩子）一律登记进既有的 `KNOWN_NO_CSS_CLASSES`，**逐类附理由**。判定面无第二处白名单。
5. **已知边界（写明而非假装没有）**：本域**从未**定义过任何该族类时无法判定——此时该族可能定义在别的层或靠内联样式，不报。与 gpu-budget 的 `textureBytes` 覆盖盲区同款处置。

**拒绝的替代方案**：① 只往 `DOMAIN_PREFIXES` 补一个 `perf-`——治标，下一族照漏；② 只加"注册表完备性锁"（要求前缀表覆盖全部实际命名空间）——实测 app-content 有 26 个命名空间未登记，锁会要求登记 80+ 条（含 `.dlg-*`/`.btn-*` 等跨层族），登记完立刻灌进 79 条 WARN（含 `sm`/`danger`/`tag` 等由 FN-2 制造出的假阳性），**用噪声换盲区**；③ 全仓一次性修 79 条——`perf-*` 之外的多数是 FN-2 假阳性，方向错了。

## 3. 后果（Consequences）

**正面**

- `perf-*` 盲区消除，且**不再依赖任何人记得登记新前缀**：新增一族（本域先定义几个 `.foo-*`）自动纳入判定。
- 首跑即交出 **19 条精准 WARN**，零虚假噪声（`dlg-*`/`btn-*`/`sm` 等跨层与变量名假阳性全部不报）。经逐一取证：**6 条是真缺陷**（`.perf-wrap`/`.perf-controls` 控制条零样式、`.perf-conc-filerow` 缺 flex 行规则、`.log-copy` 行内复制按钮裸 UA 默认样式、`.toast-container` 缺规则致 `:host` 的 `gap:8px` 从未生效），**13 条为合法豁免**（内联 token 样式 / JS·e2e 钩子），全部登记并附理由。
- 契约测试新增第 8 条锁：`${dropdownBaseCSS}` 这类非 @keyframes 共享常量必须展开（回归锁 + 反向验证）。

**负面 / 代价**

- 检查 3 的 WARN 语义从"本域**专属**前缀"变为"本域**命名空间**"——判定面变宽，新增一类告警需人工确认（这正是 WARN 的设计用途）。
- `DOMAIN_PREFIXES` 的 opt-in 能力消失：不再能"只锁我关心的族"。替代品是 `KNOWN_NO_CSS_CLASSES`（登记豁免）+ 自推导域（登记即覆盖），能力等价但语义不同。

**已知遗留**

- FN-2 的另一半（**注释洗白**）已修，但"共享常量是否被真正 adopt"仍靠文本插值推断，不解析运行期 `adoptedStyleSheets` 实际内容。
- 检查 3 仍为 WARN（不阻断），与 ADR-121 §3 的分级一致。

## 4. 数据溯源

- 用户 2026-09 提出「锐评诊断菜单的设计」→ 深挖发现 `.perf-wrap`/`.perf-controls` 零 CSS 规则，反查闸为何全绿 → 本 ADR 立项。
- `node scripts/css-layer-check.ts --json`（拆前缀筛 dry-run）：**0 → 79 WARN**，坐实 FN-1 与 FN-2 的假阳性面；改用自推导域后收敛为 **19 条**。
- `grep 'DOMAIN_PREFIXES|extractClasses'` → 确认判定域唯一来源；`content-layout.ts:71` 注释 + `utils/dom/css.ts` 共享常量 → 坐实 FN-2。
- `grep 'dropdownBaseCSS'` → `app-tree-styles.ts:51` 确有 `${dropdownBaseCSS}${dropdownHoverCSS}` 注入 → 坐实 `dd-wrap`/`dd-menu` 为假阳性。
- 修复后实测：`css-layer-check` ✅ 全绿；`tests/test_css_layer_check.ts` 8 条全绿。
