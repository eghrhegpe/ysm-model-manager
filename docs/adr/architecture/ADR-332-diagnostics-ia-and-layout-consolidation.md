# ADR-332：诊断页信息架构与版式收口：四项拍板决策

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-12
- **拍板**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：诊断页积累了跨模块 CSS 词汇归属、平台能力缺席策略、控件门禁语义三类跨域决策，各自都难逆转且影响面跨 features/views/platform，不拍板会继续以行内 hack 与静默漂移的形式沉淀
- **相关**：`frontend/src/views/app-content/diagnostics/, frontend/src/views/app-content/tpl.ts, frontend/src/views/app-content/css/content-diag.ts, docs/knowledge/app-content-diagnostics.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

一次以「锐评诊断页设计」为切入的走查，在 8 个子屏（logs 三 pill / bench 三 pill / audit 两 pill）的真实浏览器截图 + 度量 + 源码核查中，暴露出一类共性问题：**同一段视觉意图散落在多个未声明的契约上**，既没有单一事实源，也没有任何门禁守着。

期间**已完成三项技术债修复**（均已提交、均补了变异验证过的防线）：

| 提交 | 问题 | 修法 |
|------|------|------|
| `1b080dccb` | `.diag-msg` / `.diag-warn` 行内「SVG 图标 + 整句提示」被基类 `space-between` 撕到两端（1440px 实测相距 ≈740px） | 两条派生类各加 `flex-start + gap`，基类不动 |
| `81d01dfa7` | 「操作类型」下拉在运行时子屏是**空操作控件**（`RuntimeLog` 无 `Operation` 字段），且其值跨屏残留污染操作日志 | 补 `data-sub-pane="op"`，随子屏门控退场 |
| `8a7aa6227` | bench 三屏主 CTA 待遇不一（`conc` 独行、`single`/`scan` 夹在参数中） | 抽成独占末行，动线统一「填参数 → 点运行」 |

**遗留的都不再是技术债，而是没有拍板人就不能动的决策**。本 ADR 的职责是把这四项摆到台面上：每项给出证据、可选方案与推荐，**决策本身留给拍板人**。

### 1.1 一个必须记下的方法论教训

走查中我基于**静态模板与源码**的推断有三条被实测推翻：

- 「窄屏 chips 会被 `overflow:hidden` 静默裁掉」→ **证伪**（1280/1100/900/760 四档 rect 逐字相同，760 档尚余 220px）
- 「空态不居中是 `.stat-row` 的 `space-between` 造成的」→ **完全错**（运行期 class 被 JS 换成 `stat-row diag-stat diag-stat-muted`，居中来自 `.diag-stat{display:block;text-align:center}` **后置覆盖 flex**）
- 「`<input type=number>` 宽 245–275px」→ **错**（实测恒 177px，命中规则 origin 全是 `user-agent`，仓内根本没有 `input[type=number]` 规则）

**模板里的 class 不是运行期最终 class。** 只读 tpl 与 CSS 会稳定地得出错误结论——这正是本仓把版面防线压在 e2e 真实浏览器度量上的理由。

---

## 2. 待拍板决策（Decision）

> 以下四项**已于 2026-10-13 拍板**，结论见各节「决策（拍板）」子节。本 ADR 只记决策方向，落地进度归各自治理/知识卡。

### D1. 跨模块状态行外壳的归属

**现状**：`features/maintenance/recycle-bin.ts:246` 复用 app-content 的 `.stat-row` 画「图标 + 错误文案」，**不带 `.diag-msg`**，故 `1b080dccb` 的修复没覆盖它——它仍在被 `space-between` 撕开。该处已在**手写三条行内样式**（`padding`/`color`/`fontSize`），说明当初就是因为没有可用的外壳类才将就。全仓 grep 确认：**不存在**跨域的公共消息行类。

**选项**：
- **A. 提炼跨域外壳**（如 `views/app-content/css/` 迁出一族 `.msg-row`）：语义最正确，但牵动 CSS 归属决策（app-content 的样式层是否该服务 features）。
- **B. recycle-bin 就近加族**（维护页自持 `rc-msg` 类）：边界最干净，代价是两族相似词汇并存。
- **C. 维持现状**：接受一处低频路径的版式瑕疵，补注释标记即可。

**推荐**：**A**，但归到「CSS 归属治理」而非「诊断页修复」名下做——它是 CSS 分层问题借诊断页冒出来的。

**决策（拍板，2026-10-13）**：采纳 **A 提炼跨域外壳**。落地归口「CSS 分层治理」而非诊断页修复——提炼一族跨域消息行外壳，使 features 等跨模块消费点（如 `recycle-bin.ts:246` 的三条行内样式）不再手写行内样式。具体归属与文件波及见后续治理落地（不在本 ADR 记进度）。

### D2. 状态行/空态的「居中」有两套词汇

**现状**：logs 空态走 `.diag-stat`（`display:block` + `text-align:center`），bench/audit 空闲态走 `.stat-row-idle`（`flex-direction:column` + `text-align:center`）。两族都能居中，但是两套词汇、各自覆盖基类的机制不同。取证确认二者当前**行为等价**（文字中心与列表中心偏移恒为 0），差异只在 CSS 机制。

**选项**：
- **A. 统一到一族**：消除两份真相，但要确认两族是否真有视觉区分诉求（`status-row.ts` 注释自陈「字号与对齐是刻意的视觉区分」）。
- **B. 保留两族 + 写明各自适用面**：承认是两种语义（列表内状态行 vs 结果区空闲态），但补注释固化边界。

**推荐**：先查清 `status-row.ts` 注释所称的「刻意视觉区分」是否仍被产品需要；若否，选 A。

**决策（拍板，2026-10-13）**：先查「刻意视觉区分」诉求 → **诉求仍在**：`status-row.ts`（2026-09-18 单点收口）显式声明两族是「用户已定，不是待办」，字号/对齐为刻意区分、不在收敛范围。故**不统一**，保留两族（即选项 B：保留 + 注释固化边界，已由 `status-row.ts` 落实）。本 ADR 不再推动合并。

### D3. bench `single` 行2 的参数组混排

**现状**：该行是「超宽路径输入框（`flex:1`，900 档仍 280px）+ 两个 checkbox + 超宽阈值框（UA 固有 177px 装 2 位数）」的无栅格混排，且**基准三件套与路径输入框同属一行却无容器边界**——用户看不出它们是一组。窄屏（900px）折行时 `Sample cap` 标签与输入框被拆到两行，标签—控件分离。

**选项**：
- **A. 引入「参数组」容器**：把路径输入与基准三件套分成两个有边界的组，并给 `input[type="number"]` 显式收窄宽度。
- **B. 只拆行**：把基准三件套拆到独立行，不引入容器（改动小，但仍然无分组感）。
- **C. 不动**：现状可用，分组感属偏好。

**推荐**：**A**，且必须同批给数字框加显式宽度规则（否则 UA 固有 177px 会长期误导后续判断）。

**决策（拍板，2026-10-13）**：采纳 **A 引入参数组容器 + 收窄数字框**。路径输入与基准三件套拆为两个有边界的组，并给 `input[type="number"]` 显式宽度规则，消除 UA 固有 177px 误导。

### D4. 同一组功能在两个平台有**两种缺席方式**

**现状**：bench / audit 两组是 `desktopOnly`。
- **Android viewer**（`isViewerMode`）：`renderTabs` 整组不渲染 + 顶部挂告知行——用户**知道**这里没有。
- **web**（`browserAdapter`）：组**照样渲染**，只在点击时由 `web-gate.ts` 弹 toast 拦截——用户会**以为坏了**。

**问题**：两种缺席传递的信息量完全不同。web 用户看到一整排可点的按钮，点了却被拒绝，且没有前置告知。

**选项**：
- **A. 统一为「可见缺席」**：web 也整组不渲染 + 告知行（Android 范式）。
- **B. 统一为「点时告知」**：Android 也渲染 + toast（web 范式）。
- **C. 保留现状**：认为 web 的 toast 拦截已足够。

**推荐**：**A**——「看得见却不能用」比「明确告知不可用」更伤信任；且 Android 侧已有告知行实现，web 侧改动路径更短。

**决策（拍板，2026-10-13）**：采纳 **A 统一为「可见缺席」**。

**落地修订（拍板后查证）**：本决策原立论「web 仍渲染组 + 点击时 toast 拦截」是 **ADR-300 §2.5 之前的状态快照**——现 `isViewerMode() === (mode !== "desktop")`（platform.ts:87-94，含 web），且 `tpl.ts:198` 早已 `viewerMode: isViewerMode()` + `viewerNotice`（"性能基准与仓库体检仅桌面版可用"）。故 web **已经**走 `renderTabs` 的 `desktopOnly` 隐藏 + 告知行，与 Android viewer 同构。三项 `webGate(...)` 拦截（conflicts.ts:151 / perf-concurrent.ts:294 / perf-scan-bench.ts:243）因此已是 **dead code**（web 组不渲染 → 处理器不接线；桌面/Android `isWebPlatform()` 恒 false → 空操作）。故 D4 的实际落地 = **移除这三处 dead guard + `web-gate.ts` 模块 + 其「web→toast」旧范式测试**，而非「新增隐藏」。

---

## 3. 后果（Consequences）

**正面**：
- 四项决策集中一处，避免继续以「行内 hack + 事后解释」的形式各自漂移。
- 本 ADR 顺带固化了走查方法论教训（模板 ≠ 运行期；只读源码的推断不可信），降低下一个人重犯的概率。

**负面**：
- 本 ADR **不产生代码改动**，四项决策全部待拍板；在此期间相关问题不得被当作「已知 bug」顺手改掉。

**已知遗留**：
- D1 若选 A，牵动的是 **CSS 分层归属**（app-content 样式层能否服务 features），其影响面大于诊断页本身，归口 CSS 分层治理而非诊断页修复。

---

## 4. 数据溯源

| 结论 | 来源 → 结果 |
|------|------------|
| 撕裂根因 = 基类 `space-between` vs SVG+文本两个 flex item | 源码 `content-diag.ts|.stat-row` + `status-row.ts` → 1440px 实测图标→文本间距 740px → 修复后 4px |
| 操作类型下拉是空操作 | 源码 `init.ts|dgInBindLogOpFilter`（runtime 分支无动作）+ `types.RuntimeLog` 无 `Operation` → e2e 复现 → 门控修复 |
| bench 三屏 CTA 不一致 | 源码 `tpl.ts` 行构成 + 1440px 实测行内控件 id 分布 → 拆行后三屏统一 |
| chips 窄屏裁切不成立 | Playwright 四档实测 rect 逐字相同、容器 `scrollWidth-clientWidth=0` |
| 空态居中机制 = `.diag-stat` 后置覆盖 | 运行期 class 实测 + 逐层 `getComputedStyle` → `display:block` / `textAlign:center` |
| 数字框 177px 源自 UA | CDP `CSS.getMatchedStylesForNode` → 命中规则 origin 全 `user-agent`，作者样式 0 条 |
| 两条改 bench 工具栏的硬纪律 | `perf-mode.test.ts` 行归属门禁失配 + `tpl-structure.test.ts` 配平 `expected 55 to be 56`（本次各踩一次） |

---

<!-- 文件名: diagnostics-ia-and-layout-consolidation.md → 实际文件 architecture/ADR-332-diagnostics-ia-and-layout-consolidation.md（ADR-320 architecture 全量模板） -->
