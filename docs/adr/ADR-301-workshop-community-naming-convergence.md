# ADR-301：创作者频道与创意工坊命名轴收敛

- **状态**：📝 提议中（Proposed，待拍板 D1–D4）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-300](./ADR-300-diagnostics-nav-axis-convergence.md)（诊断页导航轴收敛，同族「导航单轴化」——但那是页**内部** tab 轴，本 ADR 是**顶层页名**轴，二者正交不冲突）、[ADR-259](./ADR-259-tab-rendertabs.md)（结构单点产出）、`docs/knowledge/community-feature.md`（社区/创作者频道功能知识卡）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」（2026-09-24）的状态快照，落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

应用有两张彼此相邻的页，它们的**内部 id、对用户显示的标签、页面代码文件名、i18n 键命名空间、CSS 前缀**五套词汇互相错位，交叉接线。2026-09-24 一次前端锐评以「你看得懂吗」为题眼命中此病灶，故立项。

**四方错位实测**（`frontend/src/views/app-nav/nav-items.ts:32-33`，逐行）：

| 顶层 `id`（`PageName`） | 显示标签（`key`） | 页面真实内容 | 页面代码 | i18n 命名空间 | CSS 前缀 |
|---|---|---|---|---|---|
| `workshop` | `nav.community` = **创作者频道** | 创作者卡 / 站点 tab / 浏览模式（外链·内嵌·窗口） | `init-workshop.ts` / `workshopHTML()` | `content.*` + `workshop.*` | `cr-` |
| `github` | `nav.workshop` = **创意工坊** | GitHub 仓库模型浏览（读「创意工坊」`index.json` 索引） | `init-github.ts` / `githubHTML()` | `workshop.*`（GitHub 键） | `gh-` |

读法即歧义源：

1. **id↔label 交叉**：`id:workshop` 显示「创作者频道」，`id:github` 显示「创意工坊」。新人读到 `nav.workshop`（"创意工坊"）会去找工坊页，点进去是 GitHub 页；读 `id:"workshop"` 以为是工坊，实际是创作者频道。
2. **标签语义本身没错**：`nav.community`=创作者频道、`nav.workshop`=创意工坊 各自贴合其内容（「创意工坊索引」见 `workshop.githubNoIndex` 键 `zh-CN.ts:735`）。**错位发生在 id 侧与文件名/类型侧，不在标签侧**——这决定了收敛方向是"改 id/文件名去追标签"，而非"改标签去迁就 id"。
3. **i18n 命名空间分裂**：`workshop.*` 键横跨两页——`workshop.activeCreators`（创作者频道页）与 `workshop.downloadSelected` / `workshop.github*`（创意工坊页）。命名空间前缀 `workshop.` 既指「id=workshop 页」又指「创意工坊（id=github）页」，一义两指。
4. **类型名穿到 Go**：站点与创作者的数据类型是 **Go 生成绑定** `WorkshopSite` / `WorkshopCreator`（`frontend/bindings/.../models.ts`，源在 `go/internal/app/`），被两页共用语义又都带 `Workshop` 前缀——但「站点 tab」属创作者频道页，「创意工坊」标签属 GitHub 页。改名会穿到「类型判定唯一事实源 = `resource_types.json` + Go」红线，非纯前端可动。
5. **历史包袱先例可参照**：`PageName` 落进 localStorage（`nav:changed` 持久化启动页），`core/page-store.ts` 的 `sanitizePage`（`:33-35`）已为「历史名 `resources` → `repository`」建了**宽容解析 + 别名迁移**范式——本 ADR 的 id 迁移有成熟先例，不是开先河。

**为什么是 ADR 而非直接改**：命名轴收敛触及 `PageName`（`@/bus`）、`VALID_PAGES`（`@/core`，双向覆盖断言 `page-store.ts:24`）、`PAGE_REGISTRY`（`page-registry.ts`）、Go 绑定类型、i18n 三语、CSS 前缀、localStorage 键、e2e 触点——是跨 Go/前端边界、需回归锁定的系统性重命名，按仓库铁律「大改动（架构级）写 ADR、连环询问拍板，再动手」。

## 2. 决策（Decision）

> 状态：**提议中**。下表为待 D1–D4 拍板的推荐方向，非已决。拍板后再按 §2.6 红线清单实施。

### 2.0 方案对比与拍板清单

| 方案 | 内容 | 判定 |
|---|---|---|
| **甲 双页各归本名**（推荐） | `id:workshop → community`（追 `nav.community`「创作者频道」）；`id:github → workshop`（追 `nav.workshop`「创意工坊」）；文件名/类型/CSS/i18n 随之各归其页 | 五套词汇一次对齐到「标签=真相」；代价 = Go 绑定 + 历史 localStorage 迁移 |
| 乙 只修 id 不动类型/键 | 仅 `PageName` 两值互换语义（社区页→`community`、GitHub 页→`workflow`? ）| Go `WorkshopSite`/`WorkshopCreator`、`workshop.*` i18n 仍错位，只治了表 | 单点、快，但不根治；可作为分段的先行段 |
| 丙 纯注释刀 | 不改任何名，仅在 `nav-items.ts` 加醒目对照注释 | 主症全留 | 不作为终点 |

**拍板清单**（推荐，待人类首席架构师表决）：

| 编号 | 决策 | 类别 | 风险 | 建议 |
|---|---|---|---|---|
| D1 | 采纳方案甲：两页 `id` 各归标签本名（`community` / `workshop`），确立「**用户可见标签 = 命名真相源**」的收敛原则 | IA | 中（穿 `PageName`/`VALID_PAGES`/`PAGE_REGISTRY`） | 📝 待拍板 |
| D2 | localStorage 页名走 `sanitizePage` 别名迁移（`workshop→community`、`github→workshop`），**不破坏历史用户启动页**（先例 `resources→repository`） | 数据 | 低（有现成范式） | 📝 待拍板 |
| D3 | Go 绑定类型 `WorkshopSite`/`WorkshopCreator` 是否改名——**独立评估，默认本次不动**（触「类型判定唯一事实源」红线，收益不足以覆盖 Go 侧回归面）；仅当 D1 落地且 Go 侧无消费者歧义时再议 | 边界 | 高 | 📝 待拍板（倾向**暂不动 Go 类型**，先做前端 id/i18n/CSS 对齐） |
| D4 | i18n `workshop.*` 命名空间按「哪页用哪键」拆分：创作者频道页键归 `community.*`、创意工坊(GitHub)页键留 `workshop.*` 或归 `github.*`——三语同步，`locales-consistency.test.ts` 兜底 | 文案 | 中 | 📝 待拍板 |

### 2.0a 落地修订（2026-09-24 实施时定，编译器实证驱动）
拍板「立即落地 D1+D2 最小闭环」后，编译器 + 数据流实证迫使把 D1 拆为**两刀**，本次只做第一刀：

- **D1-a（本次做）`workshop → community`**：创作者频道页 id 归标签本名。**关键红利**：单改使 `workshop` 从 `PageName` 联合**消失** →（①）所有 `page:"workshop"` / `{id:"workshop"}` 处 `tsc` 当场逼红逐个修正，**零静默漏网**；（②）历史 `nav_page="workshop"` 变成**无歧义纯别名**（比照 `resources→repository`），`sanitizePage` 先查别名表即可，**不需迁移 flag、不破坏 core 纯读函数契约**。
- **D1-b（暂缓）`github → workshop`**：**主动推迟**。理由：它把 `workshop` 重新引入为合法值，与 D1-a 的别名 `workshop→community` 撞**语义歧义**（旧 `workshop`=创作者页 / 新 `workshop`=工坊页 运行时不可分），正是 §2.3 链式陷阱；且 `id:github` **忠于数据源（GitHub），无 ID 层矛盾**（仅与产品名「创意工坊」有语义张力，靠标签 `nav.workshop` 表达即可，不靠 id 说谎）。真·「看得懂吗」的核心错位（创作者页挂着 `workshop` 名）已由 D1-a 消除。
- **D2（本次随 D1-a 做）**：`sanitizePage` 前置 `LEGACY_PAGE_ALIASES = { workshop: "community" }` 一次性查表；因 `workshop` 已非合法值，别名与合法值集无交，天然无歧义。`page-store.test.ts` 补：`nav_page="workshop"` → 解析为 `community`。
- **D3 冻结**（§2.3a：Go CLI/站点 id 不碰）、**D4 推迟**（纯文案债，单独一行 churn 不值当）——维持上表建议不变。

### 2.1 命名真相源：标签优先
确立原则：**当 `id`、文件名、类型名与用户可见标签冲突时，一律以标签为准回改其余四项**（标签是给用户的契约，id/文件名是给开发者的，可迁移）。据此：
- 创作者频道页：`PageName` `workshop → community`；页面代码 `init-workshop.ts → init-community.ts`、`workshopHTML → communityHTML`；CSS 前缀已是 `cr-`（creator，正名）保留；`views/app-content/site/` 目录归属此页。
- 创意工坊页：`PageName` `github → workshop`；页面代码 `init-github.ts`/`githubHTML` 是否随之更名**留 D3/D4 细分**（GitHub 是其**数据来源**，创意工坊是其**产品名**，二者都有正当性，见 §2.4）。

### 2.2 迁移安全（吸取 `page-store.ts` 教训）
`PageName` 是编译期联合 + `VALID_PAGES` 运行时白名单双声明（`page-store.ts:16-26` 全量覆盖断言）。改名时两处 + `PAGE_REGISTRY` 键 + `nav-items.ts` 四处**必须同一提交闭合**，否则覆盖断言编译即红——这正是护栏，勿绕过。

### 2.3 localStorage 别名（D2）——⚠️ 链式改名陷阱（对撞真实数据流后钉死）
启动页 `nav_page` 落 localStorage，值即 `PageName`。方案甲是**语义置换**：旧 `workshop`(创作者频道页)→新名 `community`；旧 `github`(创意工坊页)→新名 `workshop`。注意 **`workshop` 同时出现在迁移的定义域与值域**（新 `workshop`=旧 `github`）。
- **必须单趟快照映射** `{workshop→community, github→workshop}`，**严禁迭代替换**：否则旧 `github` 用户先 `→workshop`，再被 `workshop→community` 规则二次吞成 `community`（错，应落 `workshop`）。
- 落地：`resolveInitialPage` 读 `nav_page` 时过一张 `LEGACY_PAGE_ALIASES: Record<string, PageName>` 一次性查表（仿 `resources→repository`），`page-store.test.ts` 补链式用例：旧 `github`→新 `workshop` 且**不得**二跳到 `community`。
- 站内 `ysm-ws-*` 键（`workshop-tabs.ts:89` 等）：`ws-` 前缀语义本就是 workshop-site，改页名后前缀含义漂移——**按 §2.6 红线 2，保留旧键只读兼容**，比照 `workshop-browse-mode.ts:23-24` 旧 boolean 键范式，不做破坏性改名。

### 2.3a 命名空间边界（D1/D3 的**前置硬裁决**，先于一切改名）
实测：`"workshop"` 与 `"github"` 二词在全仓被**三个互不相干的命名空间**复用（`resource_types.json` 经核验不撞，是干净第四层）：

| 命名空间 | `"workshop"` 语义 | `"github"` 语义 | 出处 | 本 ADR 可否动 |
|---|---|---|---|---|
| **① `PageName` 页 id**（前端导航） | 创作者频道页 | 创意工坊页 | `bus.ts:33-34` / `nav-items.ts:32-33` | ✅ 这是唯一收敛对象 |
| **② Go CLI 命令** | `workshop` 子命令（站点管理） | – | `go/cli/workshop.go:9` | ❌ 冻结：CLI 契约，`docs/cli-commands.md` 事实源 |
| **③ 站点/平台 id**（用户数据值） | – | `github` = 那个*站点* | `app_workshop.go:144` `ID:"github"`、`workshop_sites.json`、`creators.json` 的 `type` 段 | ❌ 冻结：Go 扫描产出的数据语义，穿「类型判定唯一事实源」红线 |

**裁决**：本 ADR 的改名**严格限定在 ① 前端页 id 层**（及其派生：`init-*.ts` 文件名、`*HTML` 函数、`nav.*` 标签、i18n 键、`data-page` 钩子）。②③ 两层的 `workshop`/`github` 字面量**一个都不能碰**——`grep -rn '"github"' go/` 与 `resource_types` 类改动即越界。
**推论**：不存在"全局 workshop→community"式改法；任何跨层统一替换都会把三层从"共享一处错位"改成"各自错位"，比现状更糟。落地第一步（§2.6 红线 0）：`grep -rn '\bworkshop\b\|\bgithub\b'` 全仓分类到 ①②③ 三桶，仅 ① 桶进入改名集。

### 2.4 GitHub / 创意工坊 之辨（D3 前置澄清）
本 ADR 的边界判断：创意工坊页**同时**是「GitHub 仓库浏览」（数据源）与「创意工坊索引消费」（产品），`gh-` CSS、`init-github.ts`、`workshop.github*` 键三处用「github」、标签用「创意工坊」。**建议：保留 `github` 作为该页数据源层的正当命名**（features/community 的 repo 事件链、`show-repo-models.ts` 均按 GitHub 建模），仅统一**顶层 `PageName` 与导航标签**这一层——即 D1 对第二页可弱化为「只改标签轴不改文件名」。此取舍须拍板明确，避免为对齐强改 `init-github.ts` 而牵动 ADR-190 features/backend seam。

### 2.5 与相邻 ADR 的关系
- **不取代 ADR-300**：300 收敛诊断页**内部** tab 轴，301 收敛顶层**页**名轴，正交。但 301 落地 `bindSubTabs`/`tabs-a11y` 复用面与 300 §2.2 同源，实施顺序无强制。
- **衔接 ADR-190 / ADR-208**：若 D3/D4 触及 `features/community` 文件更名，须尊重 features↔backend seam（`community-deps.ts` 出口不变）。

### 2.6 契约同步面（落地红线清单，拍板后逐条核实）
1. `PageName`（`@/bus`）、`VALID_PAGES`（`core/page-store.ts`）、`PAGE_REGISTRY`（`app-content/page-registry.ts`）、`nav-items.ts` 四处同提交。
2. localStorage 启动页 + 站内 `ysm-ws-*` 键（`ysm-ws-last-tab`/`-active-tag`/`-search-kw`、`ysm-browse-mode`/`ysm-embed-mode`）：命名前缀 `ws-`（workshop-site）归属，若页名改 `community` 则前缀宜 `cm-`——**但 localStorage 键改动=用户偏好丢失红线**，须同步 `sanitize`/迁移或**保留旧键只读兼容**，比照 `workshop-browse-mode.ts:23-24` 旧 boolean 键兼容范式。
3. Go 绑定类型 `WorkshopSite`/`WorkshopCreator` 改名与否（D3），若动须 `npm run generate:bindings`（带 `-ts`，红线）重生成 + Go 侧 `internal/app/` 同步 + `resource_types.json` 核对。
4. i18n `workshop.*`/`content.*` 拆分（D4），三语 + `locales-consistency.test.ts`。
5. CSS 前缀与 `content-creator.ts`（`cr-`）、`content-diag` 等 `check-design-tokens`/样式契约测试同步。
6. 全仓 grep 实证搬迁清单闭合（比照 ADR-300 §2.6 落地第 0 步）：`grep -rn '"workshop"\|"github"\|PageName\|initWorkshop\|initGithub\|workshopHTML\|githubHTML\|WorkshopSite\|WorkshopCreator'`。
7. e2e 触点清点（`frontend/e2e/` 内按 data-testid / `#ws-tabs` 定位处）。
8. 知识卡 `community-feature.md` 同步（铁律：改代码同步知识卡）。

## 3. 后果（Consequences）

**正面**
- 五套词汇一次对齐「标签=真相」，新人读 `id` 不再需要脑内翻译表；`nav.community`/`nav.workshop` 与其页一一对应。
- 确立「标签优先」命名原则，为后续同类错位提供裁决依据，不必每页重新论证。

**负面 / 代价**
- 跨 Go/前端边界、面大：`PageName` + 绑定类型 + i18n 三语 + CSS + localStorage + e2e——**正因如此才立 ADR、分段（乙先行→甲全量）控制风险**。
- localStorage 键若改动触及老用户偏好，须以只读兼容兜底，额外维护成本。
- D3「GitHub vs 创意工坊」若强行二选一，会牵动 features/community 数据源层命名，风险高于收益——故推荐分层（仅统一顶层轴）。

**已知遗留**
- 本 ADR 不触碰 3D 菜单 MenuNode schema（此二页非 3D 场景，AGENTS「3D 菜单只允许 MenuNode」红线不适用、不冲突）。
- 页**内部**状态组织（`{v}` ref 手递手、编辑态整页 innerHTML 对调、持久化多策略）——锐评原判④⑤⑥，其中⑤「拖拽手柄说谎」经 `edit-drag.ts` 核实为**误判已撤回**；④⑥ 属页内状态层，是否并入本 ADR 或另立，留拍板时定。

## 4. 数据溯源

- **id↔label 交叉**：`frontend/src/views/app-nav/nav-items.ts:32-33`（`id:workshop→nav.community` / `id:github→nav.workshop`）。
- **标签值**：`frontend/src/locales/zh-CN.ts:21`（`nav.community`=创作者频道）、`:22`（`nav.workshop`=创意工坊）；`en.ts:13`（Creators Channel）/`:22` 区。
- **PageName 联合**：`frontend/src/bus.ts:30-36`；**运行时白名单 + 覆盖断言**：`frontend/src/core/page-store.ts:8-31`；**别名迁移先例 `resources→repository`**：`page-store.ts:33-35`。
- **页面注册**：`frontend/src/views/app-content/page-registry.ts:30-31`；**页面代码**：`init-workshop.ts`（46-204 `initWorkshopPage`）/ `init-github.ts:1`。
- **Go 绑定类型**：`frontend/bindings/ysm-model-manager/go/types/models.ts` `WorkshopSite`/`WorkshopCreator`（源 `go/internal/app/`，`config.go` WorkshopCreator json tag `name/desc/type`）。
- **i18n 混合命名空间**：`zh-CN.ts:693-747`（`workshop.*` 跨两页：`:695 activeCreators` 属创作者频道、`:702 downloadSelected`/`:735 githubNoIndex` 属创意工坊）。
- **CSS 前缀**：`content-creator.ts:19`（`cr-` 创作者频道）；`gh-*` 散落于 github/render。
- **localStorage 键**：`workshop-tabs.ts:89,118`（`ysm-ws-last-tab`）、`init-workshop.ts:150-151`（`ysm-ws-active-tag`/`-search-kw`）、`workshop-browse-mode.ts:21-34`（`ysm-browse-mode` + 旧 `ysm-embed-mode` 兼容先例）。
- **误判撤回依据**：`frontend/src/views/app-content/site/edit-drag.ts:47-53,58,72`（`.cr-drag-handle` pointerdown→draggable=true，dragend→false，手柄非摆设）。
- **同族导航 ADR**：[ADR-300](./ADR-300-diagnostics-nav-axis-convergence.md)（页内 tab 轴，正交）；[ADR-259](./ADR-259-tab-rendertabs.md)（结构单点）。
