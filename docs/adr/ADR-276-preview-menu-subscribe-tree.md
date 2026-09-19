# ADR-276：Preview 菜单 schema 补跨域订阅与树形行抽象评估

- **状态**：✅ 已采纳（ADR-193 §2.2② 的收尾）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/menu/engine/sanctioned.ts; frontend/src/preview-3d/menu/render/render.ts; frontend/src/preview-3d/menu/panels/bones-panel-node.ts; frontend/src/preview-3d/adapters/vrm/vrm-bone-ui.ts; frontend/src/utils/base/pure/label.ts; ADR-193 §2.2（骨骼唯一永久例外二选一）; ADR-195（控件双轨收窄）; ADR-207 D3（t/tOf 双入口）; ADR-240（内容型 panel 折叠卡）; ADR-242（动作组入口行导航）`

---

## 1. 背景（Context）

### 1.1 一次误读暴露了豁免理由的口径问题

2026-09 排查「表情界面整列没有文字」时，先给出的解释是「骨骼名这类随模型变的动态数据无法穷举进语言包，所以骨骼面板走手写 DOM」。**该解释不成立**，且有据可查：

- **动态名早有正规通道**：`PreviewMenuNode.label`（`menu/schema/menu-node-types.ts:196`）注释原文即「明文标签（动态数据名，不经 i18n）：仅当节点无 labelKey、且显示名是运行时数据（**表情名/材质名/角色名**等）时承载」——动态数据名恰恰是它被设计出来承载的东西。
- **动态列表早有正规 kind**：`PreviewMenuNodeKind` 含 `| "row" // 列表行（纹理/材质/bone 等动态列表）`（`menu-node-types.ts:113`），注释直接点了 bone。
- **例外理由的原始出处**是豁免名单单一事实源 `menu/engine/sanctioned.ts`：骨骼树浏览器 =「动态树形列表 + 跨域拾取联动（`viewContainer` click → 写 `activeId`）」，schema 化须新增抽象，ROI 为负。ADR-193 §2.2 当时给的是二选一（① 给 node 模型加声明式 `tree` kind；② 明示 bones 为唯一永久例外），人类首席架构师选 ②。

即：**「动态」不是豁免理由，「缺能力面」才是**。而「动态 = 只能手写」这个误读，正是 ADR-193 选项②留下的那个「洞」最容易招来的理解偏差。

### 1.2 同一个「洞」还派生了一次真实事故

豁免的代价不止于手写 DOM 本身：`label` 契约（无 labelKey → 用明文）在**两套渲染栈里被读成了两种行为**——`render.ts` 的 `rmLabel` 读了明文兜底，`cap-controls.ts` 的控件渲染器只读 `labelKey`。声明式节点（`morphNodes` 表情开关）只写 `label`，于是 `tOf("")` 三级回退全 miss、原样返回空串，整列表情有开关无文字。

事故的根不是骨骼手写，而是**「例外」与「主路」各自演进时，主路上同一个契约缺少唯一出口**。已收口为 pure 层唯一决策 `utils/base/pure/label.ts|resolveLabel`（`rmLabel` / `capLabel` 双双委托）。

### 1.3 为什么现在要评估

- ADR-193 §2.2 明示「拒绝挂着不动」——选 ② 不等于允许例外永久躺着。当前 `sanctioned.ts` 有条目级 `decidedBy` + `rationale` 与审计门，但**没有「什么情况下这个例外不再成立」**：一份无到期日的债。
- 骨骼面板是「活对象 + 副作用生命周期 + 外部事件回流」的完整样本；**若第二个同构消费者出现**，它就不再是例外，而是一个待抽象的模式。判据需要一个明确的触发条件，而不是靠「有人嫌不统一」。

## 2. 决策（Decision）

### 2.1 维持②（骨骼为唯一 sanctioned 过程式面板），但豁免条目必须带假释条件

豁免条目 `SanctionedProceduralPanel` 增加必填字段 `exitWhen`（假释条件）：写明「什么情况下本例外不再成立」，满足即触发抽象提取、条目应从名单移除。**永久例外 ≠ 永久特权**。

落地形态（决策要求，非进度记录）：`SanctionedProceduralPanel` 增必填 `exitWhen`；审计门 `adapters/render-custom-audit.test.ts` 断言**自证三件**——`decidedBy`（ADR 依据）+ `rationale`（具体性质，非套话）+ `exitWhen`（假释条件），缺一即红，并锁定名单长度恒为 1（增长即触发 §2.3）。缺此字段的豁免从此无法裸加。

### 2.2 豁免判据收敛为「能力面缺口」，并给出可操作的三条

新面板**不得**以「数据动态」「名字无法进语言包」「列表项数不定」为由申请豁免——这些主路均已支持。唯一合法判据是下列**能力面**缺口，且需满足**至少两条**：

| # | 缺口 | 骨骼面板实证 |
|---|------|--------------|
| ① | **活对象注入**：需要相机/场景/容器等实时引用 | `VrmBonePanelCtx { viewContainer, camera, scene }`（raycaster 拾取） |
| ② | **副作用注册 + 生命周期**：需要挂外部事件监听，并有 cleanup 归属 | `viewContainer` click 监听；返回 cleanup 交 `runCustomMount` 注册表管销毁 |
| ③ | **DOM 位置依赖运行时选中态** | 详情块插在选中行**下方**（`activeId` 变了就搬家）+ `paddingLeft = depth*12+6` 缩进 |

三条不满两条 → 必须走声明式（节点 + `children` / `controls` / schema-registry），不接受「图省事走逃生舱」。

### 2.3 触发条件（两次法则）与届时抽象面定义

**触发条件**：出现**第二个**需要 ①②③ 中至少两条的声明式面板时，本例外升级为模式提取，触发选项①——届时须以独立 ADR 细化契约，抽象面预定义为两块：

1. **节点级订阅通道**：`subscribe?: (notify: () => void) => () => void`——节点声明「我监听什么」，框架负责注册/销毁与重绘。与既有订阅链（`PreviewControlSpec.refreshOnChange` → `menu.refresh()`）**合流**，不得另立第三套刷新机制。
2. **树形行表达**：`row` kind 补深度/缩进（或 folder 树形变体）+ 选中态内联详情。注意——**缺的是「树形 + 选中态内联详情」，不是「动态 row」**（后者已存在，见 §1.1）。

⚠️ 明确风险：`subscribe` 若设计成「节点可塞任意副作用」，就是换皮的新逃生舱。触发时单列 ADR 的首要任务是把契约定窄（只允许「外部事件源 → notify」一种形状，cleanup 强制返回）。

### 2.4 明确否定项

- ❌ 以「动态数据」为豁免或手写理由（主路已支持，见 §1.1）。
- ❌ 新增第三方刷新通道（`subscribe` 若落地必须与 `refreshOnChange`/`menu.refresh()` 合流）。
- ❌ 为「审美上不统一」而给 schema 加抽象：抽象提取的触发器是**第二个同构消费者**，不是观感。

## 3. 后果（Consequences）

**正面**

- 例外从「永久特权」变成「带触发器的欠账」：`exitWhen` 机器守护，判据可审、可追溯。
- 豁免申请有了**可操作的三条能力面**判据，替代「很复杂」「是动态的」这类无法反驳的说辞——直接压掉误读土壤（本次事故的起点）。
- 主路契约的教训被固化：同一契约在多栈消费时必须有唯一出口（`resolveLabel` 先例）。

**负面 / 代价**

- 维持手写意味着骨骼面板的 DOM 逻辑与声明式面板继续双轨；📌 已知遗留：ADR-242 后骨骼已在二级菜单，但一级入口与二级内容仍分属两套实现。
- 选项① 一旦触发，给 schema 补两个抽象成本不低（`subscribe` 触及渲染器生命周期与状态层契约）——这正是 ADR-193 判 ROI 为负的原因，本 ADR 不翻案，只是把翻案条件写清。

**已知遗留**

- `exitWhen` 依赖人工判断「第二个消费者是否同构」，尚无自动检测（可考虑 `render-custom-audit` 未来从菜单图统计「需外部回流的声明式面板」数量，作为预警而非阻断）。
- ~~「写入侧滥用」未清理~~ **已清理（2026-09）**：六处把明文/id 塞进 `labelKey` 的写入点已归一到 `label` 明文通道（P1，走 `resolveLabel` 唯一出口），并由 ADR-277 把 `labelKey` 全链收窄为 `LocaleKey` 作编译期守卫——滥用不可复发。动态名走 `label`、动态列表走 `row` kind，仍不构成豁免理由。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户排查「表情界面没有文本行」+ 追问「为啥骨骼无需 fallback」 | §1.1 误读暴露、§1.2 主路契约事故、立项动机 |
| `menu/schema/menu-node-types.ts:196`（`label` 明文通道注释） | 证明动态名有正规通道 |
| `menu/schema/menu-node-types.ts:113`（`row` 注释点名 bone） | 证明「动态 row」已存在，缺的是树形/选中态 |
| `menu/engine/sanctioned.ts`（bones 条目 rationale / decidedBy） | 例外原始理由 = 跨域拾取联动 + 动态树；ADR-193 §2.2② |
| `adapters/vrm/vrm-bone-ui.ts`（ctx 三对象 / click 监听 / cleanup / paddingLeft / activeId 详情块） | §2.2 三条能力面判据的实证 |
| `utils/base/pure/label.ts` + `render.ts:rmLabel` + `cap-controls.ts:capLabel`（2026-09 收口） | §1.2「同一契约唯一出口」先例 |
| `adapters/render-custom-audit.test.ts`（自证三件断言扩展） | §2.1 机器守护落地 |
| 人类首席架构师 2026-09 拍板（选②，拒绝「挂着不动」） | §2.1 维持②、§2.3 触发条件待确认 |

<!-- 文件名: preview-menu-subscribe-tree.md → 实际文件 ADR-276-preview-menu-subscribe-tree.md -->