# ADR-248：图标字段类型化：用类型取代清单与扫描（ADR-238 边界落地）

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-238（图标语义名规范，本 ADR 落地其 §1.3/§1.4 边界）、[ADR-245](./ADR-245-context-menu-adr-238.md)（右键菜单图标迁语义名）、[ADR-239](./ADR-239-toolbar-menu-declarative.md)（工具栏下拉）；`frontend/src/utils/icon/ui-icons.ts`、`frontend/src/utils/icon/resolve.ts`、`frontend/src/utils/resource/types.ts`、`frontend/src/preview-3d/menu/menu-node-types.ts`

---

## 1. 背景（Context）

ADR-238 把 UI 图标收敛到 `UI_ICONS` 语义名，并划了两条边界：§1.3「数据图标 ≠ UI 图标」、
§1.4「结构槽 / 文本槽 / 处理逻辑」。2026-09 的分域迁移（3D 菜单 → 导航 → 能力行）把存量
emoji 全部清完，但**清债的过程本身产出了一层机器**：

- 契约测试里两份**人工清单**（已迁文件 / 文本槽豁免，后者每条还要带「通道标记」做自检）；
- 一条**仓级正则扫描**（递归扫 `icon:` 字形，白名单放行）；
- 扫描口径在四轮里被补了四次：**按字段名 → 按渲染槽 → 按标点形态（`icon:` vs `icon =`）→ 剥注释**。

根因不是「图标复杂」，而是三件事叠在同一个 `icon: string` 字段上：

| 语义 | 来源 | 能否迁 SVG |
|---|---|---|
| **UI 图标** | `UI_ICONS` 语义名 | 能 |
| **数据图标** | `resource_types.json` 的 `icon`/`groupIcon`（§1.3 🚨不可动） | **不能** |
| **文本装饰** | toast/对话框标题前缀、`<option>` 标签 | **不能**（目标槽只吃文本） |

三者**在源码里长得一样**，而 `icon: string` 让类型系统无从分辨；再叠加四种渲染目标
（`innerHTML` / `textContent` / `<option>` / `esc()` 后的 `innerHTML`，同一段 SVG 字符串
只在其中一两种合法），于是每个消费端都得靠约定重新鉴别，约定就得靠闸守——
**而正则扫描只能看见它被写死的那一类位置，任何新维度都是一次「发现盲区 → 补口径」的循环。**

一句话：**这是本仓「有门禁的规矩守得住」哲学的固有成本；但更深一层，能用类型表达的约束
不该用闸表达**——闸是给类型表达不了的横切不变量用的。

## 2. 决策（Decision）

### D1：图标语义名升级为**字面量联合类型**

`UI_ICONS` 由 `Record<string, string>` 收紧为字面量键对象，导出
`type UiIconName = keyof typeof UI_ICONS`。拼错图标名从「运行时静默无图标」变为**编译期报错**。

### D2：数据图标升级为**品牌类型** `DataGlyph`

`resource_types.json` 派生的图标（`typeIconOf` / `fileIcon` 的返回值）打上品牌：

```ts
declare const dataGlyphBrand: unique symbol;
export type DataGlyph = string & { readonly [dataGlyphBrand]: true };
```

品牌不可由裸字符串字面量构造——**`icon: "🏗️"` 这样的表达式对 `DataGlyph` 不成立**，
数据图标只能经构造函数取得（单一入口，与 §1.3「前端只读不判」同源）。

### D3：结构槽字段类型为 `UiIconName | DataGlyph`

菜单节点 / 坞站组 / 能力 / 导航项 / 卡片 meta 等**结构槽**的 `icon` 字段改此联合类型：

- 写语义名 ✓（`icon: "model"`）
- 写数据图标产物 ✓（`icon: typeIconOf(id)`）
- **写裸 emoji 字面量 ✗ 编译失败** ← 正是 ADR-238 §1.3/§1.4 要守的那条线

### D4：文本槽**不是图标字段**，其 API 参数与结构槽区分命名

标题前缀类 API（`modal-core`/`createDialog`/`modalConfirm`/`modalPicker`/`modalSelect`/
`modalProgress`/`modalPrompt`）的参数由 `icon` 更名 `titleIcon`，并保持 `string`（它本就是
**文本装饰**，经 `esc()` 内联）。命名即边界：`icon` 只属于结构槽。

### D5：删除由上述类型取代的机器

人工清单（已迁文件 / 文本槽豁免 + 通道标记自检）与仓级正则扫描**全部删除**——
它们要守的约束已由 D1–D3 在编译期保证。保留的只有**另一目的**的资产：
`scripts/_lib/icon-map.ts`（字形 → 语义名映射，供 emoji 扫描器出建议）与其对拍测试。

## 3. 后果（Consequences）

**正面**：
- 加一个图标 = 写一个 SVG + 加一个字面量键；**拼错即 `tsc` 报错**，无需清单、无需扫描；
- ADR-238 §1.3 的跨层边界（数据图标不可动）从**审查纪律**升格为**类型约束**；
- 删掉两份人工清单 + 仓级扫描 + 每轮的「补口径」循环，治理成本从"线性随位置种类增长"变为常量；
- `icon` / `titleIcon` 的命名差异让结构槽与文本槽**在调用点自解释**。

**负面 / 代价**：
- `DataGlyph` 引入品牌类型，数据图标的产生点必须走构造函数（一次性的机械改造）；
- 结构槽字段类型变宽（联合），渲染端仍需运行时区分「语义名 vs 数据字形」——
  `resolveIcon()` 的兜底分支**因此保留**（它对数据图标是承重的，非迁移残留）。

**已知遗留（含 2026-09 核实更正）**：
- ~~`isIconName()` 保留~~ → **已删除**（本条 D3 补齐后）：两处剩余结构槽字段（右键菜单项
  `features/context-menu/menu-defs.ts`、工具栏项 `views/app-tree/toolbar-menus.ts`）本次一并
  类型化；`views/context-menu/index.ts` 的「命中语义名 → SVG；否则 → `esc()` 文本」双源分支
  随之退役（该分支在生产侧本就不可达——菜单项早已全语义名，仅测试夹具喂过字形）。
  运行时判别统一为「`resolveIcon()` 是否返回空串」，不再需要二次查表函数。
  ⚠️ 更正：本节初稿把它的使用处误记为 `views/app-nav/index.ts`（实为 `views/context-menu/index.ts`）——
  同一处**凭印象书写**，与下面对 ICON_KIT 的误述同源。
- **两条语义名来源未收敛**：`utils/icon/icon-kit/`（`ICON_KIT`）与 `UI_ICONS`，由 `resolveIcon()`
  定优先级（ICON_KIT 优先）。2026-09 核实其现状：
  - `ICON_KIT` 只注册 **2 个图标**（树工具栏的 `enableAll` / `disableAll`），且**两者 `src` 均为 `"svg"`**；
    其多源能力（`emoji` / `font`）**生产零使用**，仅 `icon-kit/index.test.ts` 断言过；
  - **无任何 ADR 建立它**（ADR-244 仅一处提及「属 icon-kit（他人会话）」）；
  - 其自述理由「承接 ADR-238…**破掉「只支持 SVG」的限制**」**与本 ADR 及 ADR-238 D1 的
    SVG-only 方向相反**——两个方向都缺少成文决策，故本 ADR 只**记录事实、不动它**；
  - ⚠️ 更正：本节初稿把 `ICON_KIT` 描述为「上游 Mascot/徽标图标」，**是错的**（同一处凭印象书写）。
    它实为**多源图标中介层**，并导出了自己的 `IconSpec`（`{src:"svg"|"emoji"|"font"}`）——
    与本 ADR D3 新增的 `IconSpec`（结构槽字段类型）**同名不同义**。
  - **本次处置**：ICON_KIT 也收紧为字面量键并导出 `IconKitName`（否则 `keyof` 退化为 `string`，
    类型形同虚设）；`resolve.ts` 定义 `IconName = UiIconName | IconKitName`（**如实表达「当前有两个
    来源」而非假装只有一个**）；本 ADR 初版新增的 `IconSpec` 更名为 **`IconRef`**，把 `IconSpec`
    一名让回 icon-kit，消除同树重名。
- **待收敛项**：`ICON_KIT` 是否并入 `UI_ICONS`（删除该模块及其第二命名空间）——涉及他人产物
  与「SVG-only vs 多源」的取向选择，留待专门决策。
- **已收敛（2026-09，本节末尾决策）**：`ICON_KIT` **并入 `UI_ICONS`**，模块整体删除。
  依据即上列事实：**2 个图标、两者 `src` 均 `svg`、多源能力生产零使用、无 ADR 背书、
  且其立论与 ADR-238 D1 方向相反**——留着它换来「第二命名空间 + 解析优先级 + 类型并集
  + 同树重名」四项持续成本，而收益（emoji/字体源）从未被使用过。
  处置：
  - `enableAll` / `disableAll`（**动作语义，合 ADR-238 D2**）原样搬进 `UI_ICONS`，
    消费点零改动（`views/app-tree/toolbar-menus.ts` 的图标名不变）；
  - `icon-map.ts` 为二者补字形映射 `☑️` / `⛔`（纯 SVG 设计、无字形来源，取最贴近者以满足
    「映射表 ↔ 实现双向对拍」；刻意避开已被 `success`/`error` 占用的 `✅`/`🚫`，防建议串味）；
  - `resolve.ts` 由「两表按优先级查找」简化为**单表查找**；过渡类型 `IconKitName` / `IconName`
    一并删除，结构槽字段直接写 `UiIconName`（或 `IconRef`）；
  - 知识卡 `icon_kit.md` 转为 **superseded 存根**（保留「曾有此设计、为何移除」的可检索性）；
  - 多源能力（`emoji` / `font` 源与 `renderIcon`）随之删除；`.ficon` 样式另有独立消费者
    （app-tree 文件列表），不受影响。
  **方法论收获**：这是本 ADR「用类型取代清单」的延伸——**类型收紧会逼出隐藏的第二来源**：
  `ICON_KIT` 的 `keyof` 退化为 `string` 时它看起来"无害"，一旦要求字面量联合，
  它作为第二命名空间的成本立刻显形。

## 4. 数据溯源

| 来源 | 结果 |
|---|---|
| 2026-09 分域迁移实测（5 批，见知识卡 `frontend_design_critique` 刀㉕） | 结构槽字形已归零；清债过程产出 2 份人工清单 + 1 条仓级扫描 |
| 扫描口径四轮补盲：字段名 → 渲染槽 → 标点形态 → 剥注释 | 每次都是「闸只看得见被写死的位置」；证明文本扫描法的结构性成本 |
| `UI_ICONS: Record<string, string>`（收紧前） | 无字面量联合 → 拼错图标名在编译期无任何提示 |
| `resource_types.json` + Go 为类型判定唯一事实源（根 `AGENTS.md` 红线） | 数据图标必须与 UI 图标分流，故用品牌类型而非同名字符串 |

<!-- 文件名: icon-field-typing.md → 实际文件 ADR-248-icon-field-typing.md -->
