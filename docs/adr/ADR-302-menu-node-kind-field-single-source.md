# ADR-302：菜单节点类型不做一次性判别联合——以运行期字段表为单一事实源（类型层派生）

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
2. **建立字段表为单一事实源，方向为「运行期 const → 类型层派生」**：逐 kind 字段集合**只写一次**，落成运行期 `KIND_SPECIFIC_FIELDS`（`as const satisfies Record<PreviewMenuNodeKind, readonly (keyof PreviewMenuNode)[]>`——`as const` 保留字面量类型供类型层投影，`satisfies` 保住穷尽性与字段名拼写）；类型层经 `KindSpecificFieldOf<K>` → `CommonNodeField`（= 宽接口字段全集减 `kind` 与全部专有字段并集，自动推导）→ `NodeFor<K>` 依次派生。
   - **方向不可反**：类型在运行期被擦除，故「类型表为源、运行期表由赋值断言锁死」最多只能做到**断言一致**（两张手写表 + 一道断言）；本方向则是**结构上不可能漂移**（只有一张手写表）。
   - 自动推导引入一个副作用——新增字段若**既不入任何 kind、也不进 `COMMON_NODE_FIELDS`**，会静默落进公共集从而逃过 per-kind 判定。故另设 `AssertCommonFieldIsExact` 编译期断言（双向相等才为 `true`），把这一步从「静默通过」改为「编译期必须显式决定归属」。
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
- **走法丙的收窄边界（2026-09 实施刀2 时实证得出）**：窄类型只适用于**按 kind 分派的叶路径**（`MENU_HANDLERS` 各臂 → `menu/render/rows.ts` 的叶原语），**不适用于「形状前置」的折叠路径**——`menu/render/render.ts|appendFoldedShape` 按 `menu/schema/node-types.ts|isPreviewFolderNode`（`kind==="folder" || Array.isArray(children)`）判定形态，**刻意与 kind 脱钩**（ADR-240），故 `rmAppendFolder`/`rmAppendCard` 天然是 kind 无关的，只能保持宽类型。
  - 推论一（已随之修正）：`children`/`defaultOpen`/`headerToggle` **对任意 kind 都被读取**（任何带 `children` 的节点都会被形状前置渲染为折叠卡），故三者属**通用字段**而非 folder/panel/card 专有——把它们留在逐 kind 白名单里会对其余 kind 产生**误报**。
  - 推论二：不要试图给折叠路径加 kind 判别式类型谓词——「带 children 即折叠」这一语义本身就跨 kind，谓词化只会把 ADR-240 的脱钩重新绑回 kind。
- **校验粒度是 kind 级，不是路径级（已知取舍，非缺陷）**：白名单按 kind 建模，故「同一字段在不同消费路径下读 / 不读」的混合情形不报警——已确证两例：`custom` 的 `action`/`danger` 在 `renderCustomDirect: true`（schema 面板路径 `menu/engine/core.ts|renderPreviewPanel`）下被 `runCustomMount` 静默忽略；`button` 的 `action` 在 `control` 携带按钮语义时被 `rmAppendButton` 忽略。同理**公共字段不参与判定**，故「某公共字段在某个 kind 被忽略」也不报（如 `{kind:"divider", icon}`——`rmAppendDecor` 的 divider 臂不读 `icon`）。若将来要求完整检测，须升级为**路径级**校验（复杂度与收益需另行评估，不在本 ADR 范围）。
- **窄类型的推荐接入形态**：不要逐字面量包壳（`menuNode({…})` 会淹没「菜单即数据」的声明式观感），而是**给单节点工厂注返回类型**——`function fcMasterToggleNode(cap): NodeFor<"toggle">`。零运行期开销、零嵌套噪音，一行换取该工厂产出的编译期字段校验；多形态聚合器（返回 `PreviewMenuNode[]`）不适用。
  - 收益实证（实施中真实发生）：注窄**当场抓出一个命名谎言**——`menu/panels/settings.ts|bsBuildPerfPresetRow` 这类名含 `Row` 而实际返回 `kind: "select"` 的工厂，编译器以 `TS2322 '"select"' is not assignable to '"row"'` 直接点名。**不下断言就没人会发现名字在骗人**——这是「把字段/形态错配前移到编译器」的直接收益。
  - 代价实证：**零上下文类型损失**。过程中曾出现成片 `TS7006`（形参隐式 any），一度被误读为「窄类型的固有代价」；实为缺 `NodeFor` import 使返回类型退化成错误类型所致的**级联假象**，补 import 后全数消失（最小探针并列对照组全清）。教训已入 `skills/pitfalls.md` #22——引用 §4 的 108 处 TS7006 时勿与这类假象混为一谈。
- **契约表是「多对多」关系，而非「字段唯一归属」（2026-09 纠正）**：一个字段可被多个 kind 合法共用——`action` 5 个 kind、`control` 5 个、`danger` 3 个、`renderCustom`/`rowDensity`/`value` 各 2 个。这是**设计而非漂移**（同一字段对多类行都有意义）。曾按「字段唯一归属」误写下成对互斥断言，被 `action` 当场证伪（失败信息点名 panel ⇄ action），特此纠正以免后人重蹈。
- **「表被误放宽」的守卫已完整（推翻先前的「只能靠 tsc」结论）**：往任意 kind 的字段集加任意字段 F，跨 kind 共用图**必变**——F 此前无人登记则图中新增一项；F 此前只属一个 kind 则它**变成**共用项；F 此前已共用则该项**计数 +1**。故运行期只需一条「共用图恒等于预期」断言即可穷举**全部**改宽方式。配合编译期三重 `satisfies`（`COMMON_NODE_FIELDS` 自身、逐 kind 表项、`AssertCommonFieldIsExact`），四种改宽方式——加通用字段 / 加他 kind 的专有字段 / 加接口里未登记的字段 / 加不存在的字段名——**全部有守卫**。
  - 反向边界（同样要记）：类型级「每 kind 一条 `@ts-expect-error`」负控**只**覆盖「用**被断言的那个**字段放宽」这一种情形（负控实证：给 `slider` 加 `radio` 时，断言 `opacity` 的指令仍绿）。它的价值是逐 kind 的**拒绝语义证据**，不是任意放宽的守卫——两者勿互相替代。

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
