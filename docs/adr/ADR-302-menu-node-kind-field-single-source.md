# ADR-302：菜单节点类型不做一次性判别联合——以类型级字段表为单一事实源

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-195（cap 控件单类型化，走法乙）、ADR-194（MenuControlDef 判别联合，从未实施）、ADR-240（kind 形态脱钩）、frontend/src/preview-3d/menu/schema/node-validation.ts、frontend/src/preview-3d/menu/schema/menu-node-types.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`PreviewMenuNode` 是「菜单即数据」的单一声明类型：25 个**全部可选**的字段平铺在一个宽接口上，`kind: PreviewMenuNodeKind`（16 种）只是其中一个普通字段——**TS 不把它当判别器**。后果是类型系统对「字段 ⇄ kind」的配对关系完全失明：

- `{ kind: "field", radio: { … } }` 编译通过，渲染器静默忽略 `radio`（挂了不生效、零告警）；
- `{ kind: "divider", controls: […] }` 同理；
- 缺陷要到渲染期才可能暴露，且「未生效」与「未声明」在 UI 上无法区分。

2026-09 已就该缺口补上**运行期 + 测试期**三重防线（本 ADR 的**前提设施**，非本 ADR 的决策对象）：
`menu/schema/node-validation.ts` 的 `KIND_SPECIFIC_FIELDS` 逐 kind 白名单 + `validateNodeTree`；core 侧 `node-validation.test.ts` 与 cap 侧 `caps/cap-menu-trees.test.ts` 两门（覆盖 core 手写节点 + 全部内置 cap 自产节点）；adapter 注入点 `menu/engine/core.ts|validateAdapterItemIds` 的 warn（刻意置于非热路径）。

相邻先例决定了本 ADR 的问题形式：

- **ADR-194** 曾为 cap 旧类型 `MenuControlDef` 立「判别联合」方向，**从未实施**，且其范围不含 `PreviewMenuNode`；
- **ADR-195** 对 cap 控件单类型化明确选择**走法乙（渐进）**、否决**走法甲（一次性切）**，理由写作「回归面不对称」——但当时**未给出量级**。

于是问题收敛成一个可实证的问题：**`PreviewMenuNode` 是否该改成判别联合（`FolderNode | PanelNode | …`）？一次性还是渐进？**

## 2. 决策（Decision）

**否决「一次性切判别联合」（走法甲）；采纳「类型级字段表单源 + 可选窄类型」的渐进走法（走法丙）**——即 ADR-195 走法乙精神在节点类型层的延伸。

1. **不做**把 `PreviewMenuNode` 别名一次性替换为联合的迁移：实证代价 680 处编译错误，且今天**零真实违规**可抓（见 §4）。
2. **建立类型级字段表为单一事实源**：逐 kind 字段集合以类型形式声明一次（类型级 `KindFields`），运行期 `KIND_SPECIFIC_FIELDS` 保持手写但由**编译期赋值断言**锁死与类型级表一致（类型在运行期被擦除，故只能「断言一致」而非「派生」）——消除「类型层与运行期门各写一份、可能漂移」的隐患。
3. **提供可选窄类型 `NodeFor<K>`**（逐 kind 接口，或 `Extract` 派生）：新增构造点与渲染器逐 kind 处理器（`MENU_HANDLERS`）**可选用**它以取得内建收窄；`PreviewMenuNode` 宽别名维持不变，既有引用零改动。
4. **保留运行期门**：类型层管不到动态与外来输入（adapter 注入项、cap 聚合树），故 `validateAdapterItemIds` warn 与两门测试**不因本 ADR 退役**——类型层与运行期门是**互补**关系，不是替代关系。
5. **复评触发条件**：若出现「新代码仍漏过字段⇄kind 错配」的实证（即走法丙的编译期覆盖被证明不足），以 §4 的 **120 处生产侧清单**为已知成本，重新评估别名翻转。

## 3. 后果（Consequences）

**正面**

- 类型层与运行期门从「两套并行、可能漂移」变为「单源 + 编译期锁死」。该风险已被本轮实证暴露：联合下 `keyof PreviewMenuNode` 折叠为**公共键**，既有字段表 33 处立即报错——若无人锁死，两表漂移将是静默的。
- 新增节点构造点可即刻选择编译期防错（`NodeFor<K>`），把「字段挂了不生效」从运行期前移到编译器，接入成本近零。
- 规避 680 处 churn（其中 560 处在测试），延续 ADR-195「拒绝回归面不对称」的判断。

**负面 / 代价**

- 宽别名保留 ⇒ `PreviewMenuNode` 仍非判别器，**默认路径**（未主动使用 `NodeFor<K>`）依旧拿到宽类型，编译期防线是**可选**而非**强制**；纪律依赖代码评审 + 运行期门兜底。
- 类型层与运行期门双轨并存的认知负担仍在（虽由断言锁死一致性）。

**已知遗留**

- 泛型遍历工具在联合下需改用 `in` 守卫 / `Extract`：`menu/schema/node-types.ts|collectPreviewLeafNodes`、`collectPreviewNodeIds`、`menu/engine/menu-graph.ts` 的树遍历、`menu/engine/core.ts|panelNodeToRow`。走法丙下不阻塞；若将来翻转别名，这些是**结构性改动点**（非机械替换）。
- 判别联合会**丢失无法判别字面量的上下文类型**（实证 108 处 TS7006，集中在 spread 与变量 kind）：翻转时需逐个显式标注。这是宽接口今天白送的便利，属翻转的隐性成本。

## 4. 数据溯源

**方法（可复现、零残留）**：将 `frontend/src/preview-3d/menu/schema/menu-node-types.ts` 的 `export interface PreviewMenuNode` 改名为 `PreviewMenuNodeWide`，并在文件尾追加**等价**判别联合原型（逐 kind 接口按 §4 表字段划分；公共字段 `id / labelKey / label / hintKey / settingsOrder / icon / visibleWhen / dockGroup` 抽为 `PreviewMenuCommon`），执行 `cd frontend && npx tsc --noEmit` 统计，随后 `git checkout --` 回滚该文件。回滚后 tsc 复归 exit 0、`git status` 干净、**原型未提交**。

**结果：680 处编译错误。**

| 维度 | 数值 |
|---|---|
| 生产文件 / 测试文件 | **120 / 560**（测试占 82%） |
| 按错误码 | TS2339「属性不存在」539、TS7006「参数隐式 any」108、TS2322「不可赋值」33 |
| 生产侧分布 | `render/rows.ts` 37、`schema/node-validation.ts` 35、`render/render.ts` 25、`engine/menu-graph.ts` 8、`engine/core.ts` 7、`schema/node-types.ts` 5、`panels/env.ts` 3 |
| 最高频误读属性 | `control` 266、`children` 151（二者占 539 的 **77%**）、`renderCustom` 25、`value` 23、`action` 18 |
| TS2322 落点 | **33 处全部在 `schema/node-validation.ts`**（前提设施的运行期表因 `keyof 联合` 折叠为公共键而报错）⇒ **真实字面量违规 0 处** |
| 丢失上下文类型 | 108 处（spread / 变量 kind 的字面量无法判别） |

**三条决策依据**

1. **今天零真实违规** ⇒ 联合的收益是**面向未来**的编译期防错，而非清理现存缺陷；ADR-195 悬置未量的「回归面」由本次实证落到具体量级（680，测试占 560）。
2. **同等收益有更便宜的走法**：类型级表单源 + 可选窄类型已覆盖「防新增错配」与「防两表漂移」两项核心收益，无需触碰既有引用。
3. **翻转成本已被定量且可分域**：生产侧仅 120 处、集中于 7 个文件（渲染器占 62 处，而收窄本就是渲染器**应当**做的事）；测试侧 560 处且**逐文件独立**。若将来复评，这是一份可直接排期的清单，而非未知深渊。

<!-- 文件名: menu-node-kind-field-single-source.md → 实际文件 ADR-302-menu-node-kind-field-single-source.md -->
