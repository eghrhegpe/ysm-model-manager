# ADR-300：诊断页标签导航单轴收口：看/测/诊三组与二级导航语法统一

- **状态**：✅ 已采纳（Accepted，2026-09-24；D1–D4 全票拍板，见 §2.0）
- **实施状态**：未开工（下一步 S1 文案图标刀，见 §2.7；进度记知识卡 `docs/knowledge/app_content_diagnostics.md`）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-258](./ADR-258-diagnostics-nav-top-tabs.md)（左栏→顶部 tab）、[ADR-259](./ADR-259-tab-structure-single-source.md)（renderTabs 结构单点）、[ADR-278](./ADR-278-diagnostics-perf-ia.md)（性能面板内轴收敛；本 ADR 接其 §3「扫描聚合轴」遗留）、[ADR-285](./ADR-285-bench-usability-copy-diff-plan.md)（P1-2/P1-3 待拍板项由本 ADR 吸收）、[ADR-288](./ADR-288-diagnostics-scan-bar-persistent.md)（常驻栏两段式，全部保留）、`docs/knowledge/app_content_diagnostics.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」（2026-09-24）的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

演进链已把这页的**面板内部**收敛得很干净：ADR-258 把左栏分段升为顶部统一 tab；ADR-278 把性能五兄弟按「动作/产物」重划（9→7），single/conc 共用参数面、引擎对照退出模式轴；ADR-288 把扫描类收进「常驻栏 + 结果区」两段式。但**顶层 tab 轴始终没人切**——现状 6 个 tab（`tpl.ts:162-342`）是「每模块一 tab」的机械平铺：

| tab | 文案 | 图标 | desktopOnly | 本质 |
|---|---|---|---|---|
| `log` | 操作日志 | clipboard | – | **看**已收集的数据 |
| `bench` | 跑基准 | performance | ✅ | **测**性能（跑一条 bench） |
| `scan` | 引擎对照 | performance | ✅ | **测**性能（跑另一条 bench） |
| `record` | 性能记录 | note | – | **看**已收集的数据（加载剖析） |
| `health` | 仓库健康审计 | diagnose | ✅ | **诊**仓库并处置 |
| `sync-conflict` | 同步冲突 | refresh | ✅ | **诊**仓库并处置 |

三条主症 + 三条附症（全部源码实测，出处见 §4）：

1. **切分轴是「面板归属」不是「用户意图」**：log 与 record 都是"看数据"却隔成两个平级 tab；bench 与 scan 都是"跑基准"也各占一个；health 与 sync-conflict 同为"扫描→处置"同范式（ADR-288 已给它们同一套两段式），也各占一个。ADR-278 §2.1 自己写下了判据「跑基准是动词，性能记录是名词」，也自己在 §3 留下遗言「若后续再增扫描类，需另立聚合轴，不在本 ADR 范围内」——本 ADR 就是来还这笔的。
2. **同一页两套二级导航语法**：log 组内用 pill 子 tab（`.diag-sub-tab`，op/runtime），bench 组内用 `<select id="diag-perf-mode">` 下拉。同一个"页内再分屏"概念两种 UI 语法，用户要学两遍。
3. **跨平台导航形状突变且沉默**：6 个 tab 里 4 个 `desktopOnly`，网页版只剩 2 个——少掉的那 4 个没有任何告知，用户不知道自己缺了什么。
4. （附）图标分裂：`UI_ICONS.performance` 在同页 tab 标签层出现三次作三种语义（bench 标签 `tpl.ts:210`、scan 标签 `:270`、log 的 skipped 筛选 chip `:189`）。而 skipped **日志行**早已用专用 `UI_ICONS.skip`（`logs.ts:162`——ADR-238 专项收 emoji 债时特意补进图标表，还纠正过「⏭️ 误映射成 performance」的串味，`logs.ts:138-143` 注释自陈）——唯独同页的筛选 chip 仍在蹭闪电：同一状态在行与筛选器两处图标分裂，chip 是用错的那半。
5. （附）tab 文案词性不齐：「跑基准」（动宾）对「引擎对照 / 性能记录 / 仓库健康审计 / 同步冲突」（名词）；导航名片墙不该动名词混排。
6. （附）父子同名：「操作日志」tab 内含「操作日志」子 pill（`tpl.ts:170` vs `:174`）——容器用内容的名字命名。

一级入口文案「诊断与冲突」（`nav.diagnostics`）的"与"字是同一病灶的化石：冲突处置没有归属，就缝在标题上。

## 2. 决策（Decision）

### 2.0 方案对比与拍板清单

| 方案 | 内容 | 判定 |
|---|---|---|
| **A 三组**（推荐） | 6 tab → 3 组（日志/基准/体检），组内 pill 子切换；引擎对照成为「基准」组第三个子面板 | 意图单轴最彻底；代价 = **显式修订** ADR-278 §2.7 item 2 的结构判据（内容判据保留），须 D1 拍板 |
| B 四组 | 同上，但引擎对照保持顶层 tab（日志/跑法/对照/体检） | 贴近 ADR-278 字面，但「跑法」与「对照」都是"测"，意图轴再次被机制（参数面异同）穿透；单面板组撑顶栏 |
| C 纯文案刀 | 不动轴，只修图标/词性/墓碑（即本 ADR 的分段一） | 主症 1/2/3 全留；作为独立先行段保留，不作为终点 |

**拍板清单**（2026-09-24 人类首席架构师拍板：D1–D4 全票采纳）：

| 编号 | 决策 | 类别 | 风险 | 结果 |
|---|---|---|---|---|
| D1 | 引擎对照从顶层平级 tab 迁为「基准」组第三个子 pill。诚实定性：这是对 ADR-278 §2.7 item 2 **结构性判据**（「模式轴只剩 single/conc，scan 不得与其同列」）的**显式修订**——本 ADR 将其改写为**内容性判据**（「scan 不与 single/conc 共享任何控件」），scan 以同列子 pill 形态回到模式行的结构继任位置，§2.7 当时忌惮的危害（公共参数在 scan 下可见却不被读）由「公共区随子面板整体退场」中和；升 tab 时一并解决的发现问题降级为「具名同级子面板」承载。**保留不动**的是 §2.7 的内容判据与 §2.2/§2.3/§2.6 全部成果 | IA | 中（构成对既有 ADR 字面判据的修订，非仅改落点，落地时须在其首部加如实衔接注） | ✅ 采纳（方案 A 三组收口） |
| D2 | `#diag-perf-mode` 下拉退役，bench 组内三模式统一为 pill（全页二级导航单一语法） | IA | 中（e2e 3 处 setShadowSelect + perf-mode 门禁表载体迁移） | ✅ 采纳 |
| D3 | 网页版 tab 栏下加一行「跑基准与体检仅桌面版可用」告知（tablist 外，不破 ARIA） | 语义 | 低 | ✅ 采纳 |
| D4 | 一级入口「诊断与冲突」精简为「诊断」（冲突已被「体检」组收编，"与"字化石退役） | 文案 | 低 | ✅ 采纳 |

### 2.1 按「用户意图」单轴重划：6 tab → 3 组

| 组 tab（词性统一为名词） | 组内子 pill | desktopOnly | 参数面 |
|---|---|---|---|
| **日志** logs | 操作日志 / 运行时日志 / 加载剖析 | 否（全组跨平台） | 各为纯查看 + 自有工具栏 |
| **基准** bench | 单模型 / 批量并发 / 引擎对照 | 是（全组） | single/conc 共享公共区（目标集/排序，ADR-278 §2.2/§2.7 单份常驻不变）+ 取样上限仍两条不合并（§2.3 不变）；对照独享子面板（仅迭代数），公共区随子面板切换整体退场（碰不到 = 诚实，ADR-278 §2.6 三修判据） |
| **体检** audit | 仓库健康 / 同步冲突 | 是（全组） | 各为常驻栏 + 结果区两段式（ADR-288 D2 原样保留） |

判据一句话：**两 tab 同组，当且仅当用户的"下一步动作"同类**（看结果 / 跑基准 / 扫仓库并处置）；「面板代码归谁管」（logs.ts / perf.ts / health.ts）不再是切分理由。

- **加载剖析迁入日志组**：它是"已收集数据的被动查看"，与操作/运行时日志同类；且它是性能组唯一跨平台面板（内存 store，零 Go/CLI——ADR-278 §2.5 的豁免结论原样携带）。收益：跨平台能力收敛为**整组**粒度，网页版形状从"6 剩 2"变"1 组全内容"。
- **引擎对照迁入基准组第三子 pill**：保留 ADR-278 §2.7 的**内容判据**——它是"另一件事"：自有子面板、自有参数面（仅迭代数，`tpl.ts:271-283`），从不与 single/conc 共享控件，公共区随子面板切换**整体退场**（碰不到 = 诚实，§2.6 三修判据）；**显式修订其结构判据**（「模式轴只剩 single/conc」「平级 tab」）——pill 行是模式下拉的结构继任者，scan 回到同列位置。D1 拍板的就是这份诚实声明：这是判据层面的修订，不是无感的搬家。
- **体检组两员**：health 与 sync-conflict 共享同一触发范式、同一 desktopOnly 属性、同一段 CSS 词汇（ADR-288），本就是一对；组内子 pill 只换导航载体，两个 `diag-*-bar` + `diag-*-list` 元素 id 与两段式结构一字不动。

### 2.2 二级导航语法统一：全页子切换只有一种 pill 语法

- `.diag-sub-tab` 从「log 组私有」升格为诊断页**唯一**组内二级导航形态：日志 3 / 基准 3 / 体检 2 条子 pill 行。
- `#diag-perf-mode` select 退役，模式源改为「当前激活子 pill」；`data-perf-mode` 行显隐机制、`PERF_MODE_NAMES` / `PERF_RUN_BUTTON_MODE_KEYS` / `PERF_UNREAD_MODES` / `PERF_UNREAD_TARGETS` 四张门禁表**值域不变**（仍 single|conc）。生产端模式值读取点实测**三处**（`perf.ts:117`、`perf.ts:215`、`perf-single-bench.ts:206`）——全部一次搬家，改由单一函数（如 `readActiveBenchMode(root)`）注入，禁散落直读。scan 子面板不挂公共区行，故置灰表无需回补 scan 项（不共享即不置灰，与 `perf.ts:45` 现有注释同一逻辑）。
- 子 pill 行不套 `role="tablist"`（顶层 tabbar 已是 tablist，嵌套双 tablist 是 ARIA 反模式），维持 plain button——与现状 `.diag-sub-tab` 一致；键盘化留作遗留（§3）。
- **接线与产出单点化**（承接 ADR-259「结构正确性由代码保证，不由模板作者记忆」）：`init.ts` 的 `dgInBindLogSubTabs` 泛型化为 `bindSubTabs(root, group, onSwitch)`，与模板侧 `renderSubTabs(group, items, activeId)` 成对落 `tabs-shell.ts`（renderTabs/bindTabs 的既有邻居），三组共用一个显隐 + active 机制。日志组的刷新/复制/清空按当前子 pill 分派的逻辑（`dgInIsRuntimeLog`）收进 onSwitch 回调，不再各自摸 DOM。

### 2.3 图标唯一性：顶层图标预算 = 顶层 tab 数

- 三个组 tab 三枚互不重复：日志=`clipboard`、基准=`performance`、体检=`diagnose`。
- 子 pill 纯文字带（不挂图标），从机制上消灭「图标通胀」的增量空间。
- 日志组 skipped 筛选 chip 改用专用图标 `UI_ICONS.skip`——skipped 日志行早已用它（`logs.ts:162`，ADR-238 专项补入图标表并纠正过「⏭️→performance」的串味映射），唯独筛选 chip 还在用闪电（`tpl.ts:189`）：换毕，「跳过」状态全链路一枚图标，闪电归还基准组标签专用。
- 按钮级图标（如 sync-conflict 的 `refresh`、运行按钮的 `performance`）不占顶层预算，维持现状。

### 2.4 文案语法对齐

- 顶层 tab 一律名词：**日志 / 基准 / 体检**；「跑基准」下沉为按钮级文案（`#diag-perf-run` 按钮现文本不动），符合 ADR-278 §2.1 自己的判据「动词属于动作层」。
- 子 pill 一律名词短语且直接复用既有键：操作日志/运行时日志/加载剖析、单模型/批量并发/引擎对照、仓库健康/同步冲突。「操作日志」父子同名随之消解（顶层改叫「日志」后，该词唯一指涉子 pill）。
- 三语同步新增组级键 + `nav.diagnostics` 精简（D4），由 `locales-consistency.test.ts` 兜底。
- ADR-278 §2.6 语义诚实层（标签改口 / scope hint / conc 回落 toast）**全量保留**——它治的是"同控件跨模式改义"，与导航载体无关。

### 2.5 网页版墓碑与「远处名单」的退役

- viewerMode 下 `renderTabs` 在顶层 tab 栏**外**（tablist 容器之后，非 tablist 之内——尊重 ADR-258 §2.4「tablist 只含 role=tab」红线）产出一行告知：「跑基准与体检仅桌面版可用」。`desktopOnly` 判定从 6 份收敛为 2 份组级声明（基准组、体检组），声明处即真相的 ADR-259 精神不变。
- `dgInHideDesktopOnly`（`init.ts:152-172`）**整体退役**：其名单三项（`diag-health-bar` / `diag-sync-bar` / `diag-perf-scan-bench`，`:161-165`）重构后全部位于 desktopOnly 组内——组在 web 根本不渲染，"二道防线"永空转；留着它反而是「第二只手」漂移的温床。加载剖析的刷新按钮**本就不在名单内**（历史上曾被误藏后豁免，`init.ts:150-151,166-167` 注释自陈），迁入日志组（非 desktopOnly）后由结构保证不再有误伤空间，教训从「注释提醒」升为「结构继承」。

### 2.6 契约同步面（落地红线清单）

1. `VIEW_TESTIDS`（`tpl.ts:13-61`）：删 `diag-perf-mode`；新增组面板与子 pill 的稳定钩子（如 `diag-sub-single/conc/scan/health/sync/trace`）；其余元素 id（`diag-perf-run`、`diag-perf-scan-bench*`、`diag-scan-*`、`diag-load-trace` 等）**全部保留**——元素 id 不动是历次诊断页重构（ADR-278 §3）压住测试面的成功经验。
2. `frontend/e2e/diagnostics.spec.ts` 实测 12 处触点（`:120,246,272,324,326,557,631,632,771,890,919,931`；注：朴素 grep 数出 15 处是 `diag-perf-model`（模型路径输入框）被 `diag-perf-mode` 子串误命中 3 处，剔除后真实 12 处）。两类搬迁：9 处 `.repo-tab[data-tab=bench/scan/record]` → 组 tab id + 子 pill 点击；3 处 `setShadowSelect(diag-perf-mode)`（`:326/632/931`）→ 点 pill。
3. **门禁表随载体迁移**：`perf-mode.test.ts` 的穷尽护栏（"新增控件忘登记即红"）判据依赖 select 与 `data-perf-mode` 行归属，载体换成 pill 后判定必须同步搬家——ADR-278 §2.7 早有警告「闸只看得见它被写死的那一类，护栏从覆盖少一格变成扫错文件」。
4. 单测夹具同形：`init.test.ts` / `tpl.test.ts` / `tpl-structure.test.ts` / `content-diag-classes.test.ts`（类名↔CSS 契约须覆盖子 pill 行新形态）/ `perf.test.ts` / `perf-mode.test.ts` / `perf-concurrent.test.ts` / `perf-matrix.test.ts`。
5. **生产端消费者搬迁（本 ADR 的命门，非"预期无"而是"实有且须迁"）**：grep 实证两处生产代码消费者，record/scan tab 降级后它们不会报错、只会**静默失配**——
   - `diagnostics/init.ts:228` `dgInBindTraceTab` 用 `.repo-tab[data-tab="record"]` 挂「进 tab 即重渲染加载剖析」钩子；record 并入日志组后该顶层选择器落空，**每次进剖析子面板重渲染的语义无声丢失**（可选链不抛错，无测试兜得住）。搬迁：把该重渲染登记进日志组 `bindSubTabs` 的 `onSwitch`（子 pill 切到 trace 时触发），元素 id `diag-load-trace` 不变。
   - `perf-single-bench.ts:206` 直读 `diag-perf-mode`，随 D2 三读点统一收进 `readActiveBenchMode()` 出口（见 §2.2）。
   - 落地第 0 步：全仓再 grep `data-tab="bench|scan|record"`、`diag-perf-mode`、`#diag-tab-record`、`#diag-tab-scan` 确认搬迁清单闭合，无第三处。
6. 落地时在 ADR-278 首部加**如实衔接注**（明写「§2.7 item 2 的**结构性判据**被本 ADR 修订为**内容性判据**，scan 以组内子 pill 回到模式行继任位置，危害由公共区整体退场中和」——不得美化为"仅改落点"，格式仿 ADR-278 对 ADR-288 的既注）；ADR-285 状态行补「P1-2/P1-3 由 ADR-300 吸收」。
7. 知识卡 `docs/knowledge/app_content_diagnostics.md` 同步（铁律：改代码同步知识卡，`check-knowledge-drift` 兜底）。
8. 本页面属 DOM tab 层，非 3D 菜单——AGENTS.md「3D 菜单只允许 MenuNode schema」红线不适用、也不冲突；页内导航仍经 PAGE_REGISTRY 路由可达，不新增调用面。

### 2.7 分段实施（各自可独立回滚）

- **S1 纯文案与图标刀**（D3/D4 + §2.3 图标 + §2.4 名词化）：不动导航形状，低风险先落，立刻治好附症 4/5/6。
- **S2 导航重组**（D1/D2 + §2.1/2.2/2.5）：3 组 + renderSubTabs/bindSubTabs 单点 + desktopOnly 组化。
- **S3 退役清扫**：`dgInHideDesktopOnly` 删除、`diag-perf-mode` 相关残留清零、契约测试收紧（新增子面板忘挂 `data-perf-*` 即红的护栏补一条）。

## 3. 后果（Consequences）

**正面**

- 顶层导航从「三根轴混切」收为单轴一句话心智：**看日志、跑基准、做体检**；6 tab 的视觉重量降为 3。
- 全页二级导航单一语法一种机制，`bindSubTabs` 单点出口；「select 还是 pill」这类分叉从结构上不可能再长回来。
- 图标唯一、词性对齐、父子同名消解、「诊断与冲突」的"与"字化石退役。
- 网页版从「沉默消失」变「可见缺席」；跨平台能力差异以**组**为粒度声明，`dgInHideDesktopOnly` 这只"远处的另一只手"在本页清零。
- 偿还 ADR-278 §3 留下的「扫描聚合轴」遗债；吸收 ADR-285 P1-2/P1-3 两笔待拍板布局项（bench 组内行序维持已落地的 P1-1 方案 A，不再二次摇摆）。

**负面 / 代价**

- 改动面大：tpl / tabs-shell / init / perf / CSS / 三语 locales / 8 个测试文件 / e2e 12 处——正因如此才立 ADR，S1–S3 分段控制风险。
- 模式切换从 select 到 pill：肌肉记忆变化；`#diag-perf-mode` 这个 e2e 专用稳定钩子消失（以 pill testid 补位）。
- 引擎对照顶层可见度降一级（tab → 子 pill）。ADR-278 §2.7 升格动机是「藏在别人工具条里」的发现问题，分组后对照仍是**具名同级面板**，父级从"无"变"基准"——发现问题不复发；但若用户群已习惯顶层入口，有一个适应期（D1 拍板点）。
- 网页版顶层栏只剩 1 个组 tab，tab 栏观感空（以 D3 告知行补偿）。
- 「性能记录」改名「加载剖析」入日志组后，历史上以「性能记录」为词的用户要重新找（组内 pill 文案与旧面板标题一致，代价限于顶层一跳）。

**已知遗留**

- 子 pill 的 ARIA/键盘化（role=tablist 嵌套的正确姿势是 toolbar+radiogroup 还是树形 tablist）：本期 plain button 现状维持，另案。
- 3D 菜单 MenuNode 若要深链诊断页子 pill：`diag-tab-<组>` + `data-sub=<id>` 两级 id 已留单源，深链本身不在本期。
- `oldest` 页与诊断页共用路由分支（`app-content.methods.test.ts:163`）不在本期触碰范围。

## 4. 数据溯源

- **现状 6 tab 与 desktopOnly 分布**：`frontend/src/views/app-content/tpl.ts:162-342`（log `:167` / bench `:206` / scan `:263` / record `:285` / health `:298` / sync-conflict `:318`；desktopOnly 标注 `:209,269,300,320`）。
- **图标分裂**：`tpl.ts:189`（skipped chip=performance）、`:210`（bench 标签）、`:270`（scan 标签）三处蹭闪电；`UI_ICONS.skip` 定义于 `ui-icons.ts:70`，消费者在 `diagnostics/logs.ts:162`（skipped 日志行状态图标，ADR-238 专项补入，串味纠正记录见 `logs.ts:138-143` 注释）——**有消费者，唯独 chip 没换上**，修正方向是补齐 chip 而非"启用闲置图标"。
- **两套二级语法**：pill 子 tab `tpl.ts:174-175` + 接线 `diagnostics/init.ts:61-78`；mode select `tpl.ts:220-223` + 接线 `diagnostics/perf.ts:116-124`；门禁四表 `perf.ts:40-77`。
- **生产端消费者（子代理核实后补录）**：`diagnostics/init.ts:228`（`dgInBindTraceTab` 按 `.repo-tab[data-tab="record"]` 挂重渲染钩子，record 降级后静默失配——见 §2.6 第 5 条）；`diagnostics/perf.ts:117,215` + `diagnostics/perf-single-bench.ts:206`（模式值三读点）。
- **网页版形状**：`renderTabs` 隐藏机制 `frontend/src/views/app-content/tabs-shell.ts:52-55,76`；局部二道防线 `diagnostics/init.ts:152-172`（现役**三项**名单：`:161,162,165`）；跨平台面板依据 `init.ts:148-151` 注释与 ADR-278 §2.5。
- **e2e 触点**：`frontend/e2e/diagnostics.spec.ts:120,246,272,324,326,557,631,632,771,890,919,931`，实测 12 处（grep 模式命中 15 行，其中 `:562,616,665` 三行为 `diag-perf-model` 被 `diag-perf-mode` 子串误命中，剔除）。
- **决策依据**：ADR-278 §2.1（动/名判据）、§2.7（公共区真常驻 + scan 退轴——本 ADR 保留其内容判据、**修订其结构判据**，见 D1）、§3 负面（元素 id 保留控测试面）、§3 已知遗留（扫描聚合轴另立）；ADR-258 §2.4（tablist 内禁混操作按钮）；ADR-288 D2（两段式与按钮常驻 bar 的 dead-end 教训）；ADR-285 P1-1（动作与参数同序已落地）与 P1-2/P1-3（待拍板）。
