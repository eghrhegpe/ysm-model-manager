# ADR-259：tab 结构单点产出——renderTabs 工厂与结构契约

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/tabs-shell.ts`（新，`renderTabs` 工厂）、`frontend/src/views/app-content/tpl.ts`、`frontend/src/views/app-content/init-pages.ts`（`bindTabs` 运行期分发）、`frontend/src/views/app-content/tpl-structure.test.ts`、ADR-258（诊断页导航收敛，本 ADR 修其未对齐的容器结构）、`skills/pitfalls.md` #20

---

## 1. 背景（Context）

2026-09-17 用户报「诊断看不见界面了」。定位：`tpl.ts|diagnosticsHTML()` 漏一个 `</div>`，`#diag-tab-log` 把后续 7 个面板吞进自己内部；`bindTabs` 切页时把 `#diag-tab-log` 置 `display:none`，嵌在里面的面板一并消失——**切任何 tab 都只剩空 tab 栏**。单点缺陷已修（提交 `294f285e5`），但复盘指出病根不在那一行，而在**写法未标准化**：

1. **`bindTabs()` 只标准化了运行期**：它按 `${prefix}-tab-${id}` 查找面板、切 `display`、并统一 ARIA / roving tabindex / 键盘 / 懒加载。这部分是健康的单源。
2. **标记产出（tab 栏 + 面板容器）六页各手写一遍**：无工厂、无约束，于是并存两种结构范式——

   | 页面 | 面板容器写法 |
   |------|-------------|
   | repository / instances / github / workshop / settings | **每 tab 一个 `.tab-body`**（5/6 页） |
   | **diagnostics** | **一个共享 `.tab-body` 包 8 个 `.diag-panel`**（唯一例外） |

3. **唯一偏离主流的那页，正是出事的那页**：共享容器模型更脆——面板闭合一旦错位，「兄弟」就变成「子节点」，且被父级隐藏时整片陪葬。另外 `.diag-panel` 的布局规则与 `.tab-body` **逐字重复**（`flex:1;display:flex;flex-direction:column;overflow:hidden`）。
4. **按钮类与选择器也不统一**：settings 用 `.stg-tab`，其余用 `.repo-tab`，故 `bindTabs` 的 `tabSelector` 每页各传各的（`init-pages.ts:30/47/76/314`）。
5. **ADR-258 §3 自称与仓库页/设置页「100% 同范式」——该断言不成立**：其 §2 只对齐了 **id 规则**（`diag-tab-<name>` 对齐 `${prefix}-tab-${id}`），**未对齐容器结构**，且没有任何检查验证过「同范式」这句话。

**结论**：新增一个 tab 目前有 2 种写法可选，选错不会被任何门禁拦下——结构性风险长期敞开。

## 2. 决策（Decision）

1. **标准机构范式 = 每 tab 一个 `.tab-body`**（五页主流写法）。面板即 `.tab-body`，作为 `.repo-wrap` 的直接子节点；首个面板不写 `display`（回落 `.tab-body` 布局），其余写 `display:none`——与 `bindTabs.activate` 的 `style.display = "" / "none"` 翻转口径两侧一致。
2. **单点产出**：新增叶模块 `views/app-content/tabs-shell.ts`，导出 `renderTabs(spec)`，由它产出「`.repo-tabs` 栏 + N 个 `.tab-body` 面板」。**结构正确性由代码保证，不由模板作者记忆**：标签配平、面板层级、id 规则在工厂里只写一次。
   - 面板 id 一律 `${prefix}-tab-${tab.id}`——与 `bindTabs` 的运行期查找约定**同源**（此前是两处各写一遍、靠人对齐）。
   - 差异项全部降为**声明参数**（每面板额外行内样式、附加属性、栏 id/testid、按钮类、附加面板类），不再手写脚手架。
3. **迁移 `tpl.ts` 的 repo / instances / diagnostics / github 四页**改用工厂。**`workshop` 页面除外**：其 tab 栏由 `initWorkshopPage` 在运行期动态注入（`workshop-tabs.ts`），不是静态声明，属另一种机制，强行套工厂反而制造语义谎。
4. **结构契约机检**（落于 `tpl-structure.test.ts`）：任一带 tab 壳的模板必须同时满足——① `<div>` 开合配平；② 面板数 == 该栏按钮数；③ 全部面板**等深同层**且为壳容器直接子节点；④ 每个面板 id 与某个按钮的 `data-tab` 一一对应。把「同范式」从口号变成机检。
5. **范围外**（本 ADR 不涉，避免与并行施工撞车）：`settings` 页自有 `renderStgTabBody`，其结构**已符合本标准**，后续可换用工厂；`.stg-tab` 是否统一为 `.repo-tab` 另议。

6. **运行期真值同源（本 ADR 的另一半）**：`init-pages.ts|bindTabs` 此前要求调用方手传 `ids` **id 白名单**，它与模板里的 `data-tab` 是**第二份手工真值**；新增 tab 时漏同步，`activate` 遍历的是白名单而非 DOM——新面板永远不被设为可见，表现为「按钮在、点了没反应、内容区空白」且**不报错**（2026-09 设置页新增「操作」tab 的真实事故，其回归测试注释留有自白）。现改为**从 DOM 派生**（`tabs.map(btn => btn.dataset.tab)`），`ids` 参数删除：新增 tab 只需改模板一处，ARIA / 键盘 / 懒初始化 / 面板切换自动覆盖。契约违例（按钮缺 `data-tab` / 面板缺失）改为 `logWarn` **响亮告警**，不再静默。防线：`init-pages.test.ts`（无白名单也能切第三个 tab / ARIA 全集 / 缺面板告警）+ `tpl-structure.test.ts` 的静态闸（禁止 `bindTabs` 调用点再出现数组白名单）。
**拒绝的替代方案**：① 保留两种范式共存——共享容器无收益且更脆；② 只在文档里写「请用每 tab 一个 `.tab-body`」而不建工厂——无机器守护的约定已在 ADR-258 证伪（自称同范式而实际不同）；③ 全仓一次性重写六页（含 settings）——与并行会话撞车，且违反「按刀递减」的迁移纪律。

## 3. 后果（Consequences）

**正面**：新增 tab = 填一个声明数组，结构错误在工厂层写不出来；面板 id 规则单源（工厂与 `bindTabs` 共享同一条）；`.diag-panel` 的重复布局规则可删（仅留动画钩子）；结构契约把「同范式」从 ADR 措辞变成机检不变量；`#repo-tab-tree` / `#diag-tab-log` 等被代码与测试引用的 id 保持不变。

**负面 / 代价**：一次性迁移 diff（4 页 + 测试）；工厂参数面需覆盖各页差异（额外行内样式 / 附加属性），比纯手写多一层抽象。

**已知遗留**：`workshop` 的动态 tab 栏不走工厂（机制不同，§2.3 已排除）；`settings` 未迁（§2.5，等其施工窗口）；按钮类 `.stg-tab` / `.repo-tab` 并存；**治理教训**——ADR 声称两处「等价 / 同范式」时必须附机检，否则就是不可验证的口号（已写入 `skills/pitfalls.md` #20）。

## 4. 数据溯源

- 用户 2026-09-17 报「诊断看不见界面了」→ 本 ADR 立项（先修单点缺陷，再治写法标准）。
- `grep 'repo-tabs|tab-body' frontend/src/views/app-content` 六页写法横向对比 → §1.2「两种范式并存」表。
- `bindTabs` 四处调用 `init-pages.ts:30/47/76/314`（diag/ins/repo/stg）→ §1.1 运行期已单源、§2.2 id 约定同源；同时确认 github/workshop **不调用** `bindTabs`（退化栏 / 动态栏）→ §2.3 排除 workshop。
- ADR-258 §3「诊断页与仓库页/设置页 100% 同范式」 vs 实测容器结构 → §1.5、§3 已知遗留。
- 已落地修复：`294f285e5`（`tpl.ts` 补 `</div>`）、`tpl-structure.test.ts`（结构守卫）、`e2e/diagnostics.spec.ts`（真实浏览器可见性防线）→ §2.4 契约来源。

<!-- 文件名: tab-rendertabs.md → 实际文件 ADR-259-tab-rendertabs.md -->
