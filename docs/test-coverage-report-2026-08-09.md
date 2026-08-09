# YSM 模型管理器 — 前端测试覆盖专项报告

> 报告日期：2026-08-09
> 专项范围：前端 vitest 覆盖提升 + 源码可测性改造 + 组件测试样板（ADR-023 L3 / ADR-035 G-1）
> 提交清单：`ab0e036a` / `e9b7a4dd` / `7366e52a` / `e2789151` / `9fd77ddb` / `edc5012d`（另有契约收敛 `61ff1228`）

---

## 一、专项背景：给代码「建档」的三步

测试覆盖率低，不等于测试数量少，而是**测不到该测的地方**。专项开启时，剩余的 30 个低覆盖文件几乎全是 DOM/WebGL 密集的大文件（skeleton.ts、wasm.ts、model3d.ts、community/events.ts、dialogs 系列），硬补 mock 测试成本显著上升、收益存疑。于是按「先判断成本、再选策略」的思路，走了三步，对应三种测试形态：

| 阶段 | 策略 | 形态 | 解决的问题 |
|------|------|------|-----------|
| ① 抽 | 决策逻辑抽成纯函数 | 零 mock 单测 | 大文件里"裸奔"的核心逻辑没有身份证 |
| ② 收 | 收敛到单一事实来源 | 复用既有纯函数 | 相似逻辑散落多文件，改一处漏三处 |
| ③ 挂 | 编排层挂进真实 DOM | 组件测试（G-1 样板） | 纯函数测不出"选择器命中错误"这类编排 bug |

---

## 二、覆盖数据总览

| 指标 | 专项前（08-09 校准基准） | 专项后 | 变化 |
|------|--------------------------|--------|------|
| 用例数 | 773（81 文件） | 863（88 文件，本专项） | **+90** |
| statements | 42.68% | **51.10%** | +8.42pt |
| branches | 36.19% | **42.60%** | +6.41pt |
| functions | 43.75% | **52.57%** | +8.82pt |
| lines | 43.80% | **52.51%** | +8.71pt |

> 阈值随之从 08-04 的旧布局基准校准为 40/31/40/40（防回退确定性红线，覆盖提升后仍可上调）。
> 注：coverage 模式下并发会话的 `download-queue.test.ts` 出现一次 fake-timers 时序 flaky（普通跑全绿），与专项无关，已记录。

---

## 三、阶段①：抽纯函数（零 mock 可测）

把 DOM 编排层里的决策逻辑抽成无环境依赖的纯函数，编排层保持原样——不改变任何行为语义，只给逻辑发"身份证"。

| 新模块 | 纯函数 | 来源 | 用例 |
|--------|--------|------|------|
| `utils/dom/dialogs/tag-set.ts` | `addTagToSet`（去重/20字符/字典序排序） | tag-editor.ts | 6 |
| `utils/dom/dialogs/adv-filter-util.ts` | `parseFilterNumber` / `validateAdvFilter` | adv-filter.ts | 13 |
| `features/community/render.ts` | `filterModels` / `formatSize` / `groupSites` | events.ts | 15 |
| `utils/array.ts` | `moveItem` | site/edit.ts 两处拖拽 | 6 |
| `utils/dom/dialogs/batch-rename-util.ts` | `rebuildParsedName` / `applyReplaceToName` | batch-rename.ts | 21 |
| `utils/debug/debug.ts`（导出） | `safeStr`（多分支 + 200 字符截断） | dbg 内部 | 14 |

**四场验证战役（测试对齐真实路径）**：纯函数抽取看似简单，但测试期望必须对齐真实调用路径——期间修正了「回退角色名含解析前缀」「Set 省略号在括号内」「仓库头部 ⬇️ 徽章 vs 下载按钮恒常存在」「missingCount=0 断言精确到类名」四处想当然。

---

## 四、阶段②：收敛单一事实来源（复用而非新建）

摸底时发现 import-queue 的 `updatePreview` 拼装逻辑与 rename-format 的 `buildRenameName` **逐字重复**——rename 系第三份拷贝（前两份已在更早收敛）。按「复用已有函数」原则消除，而非再抽新模块：

| 收敛点 | 动作 |
|--------|------|
| import-queue `updatePreview` | 改用 `buildRenameName`（删 15 行内联重复） |
| community `renderList` | 改用 `filterModels`（删 `isMissing` 包装） |
| batch-rename `updateAll`/`applyReplace` | 改用 `rebuildParsedName`/`applyReplaceToName`（删 40+ 行内联） |
| instance-actions `addImportLog`（前轮） | 参数对齐 Go 签名，uploaded 直接取返回 |

**收益**：改一处预览逻辑，三个入口同步生效；jscpd 死代码基线的「新增重复」红线同时被守住（本专项还亲自挨过一次：events.test.ts 四段重复构造被抓，抽 `makeCardState` helper 消除）。

---

## 五、阶段③：组件测试 G-1 样板（挂进真实 DOM）

纯函数层补得再满，也测不出"选择器命中自己"这类只有真实 DOM 才暴露的 bug。专项末尾把 ADR-035 G-1 的组件测试样板推广到站点视图与社区页：

| 目标文件 | 用例 | 覆盖路径 |
|----------|------|----------|
| `app-tree`（已有） | 7 | 多选/连点/Shift/文件夹展开 |
| `features/community/events.ts` | 12 | 搜索/缺失切换/勾选计数/下载三分支/B站搜索/右键/cleanup |
| `views/app-content/site-view.ts` | 6 | 编排壳：过滤计数/编辑模式/cleanup 聚合 |
| `views/app-content/site/drag.ts` | 7 | JSON 导入识别三分支/dragenter 计数 |
| `views/app-content/site/edit.ts` | 8 | 创作者/搜索词拖拽排序/增删/搜索过滤 |
| `views/app-content/site/events.ts` | 7 | 空态/预设搜索/星标/storage 同步/cleanup |

**样板模式**：data-testid/data-action 稳定钩子 + 程序化种子数据 + mock bindings/queue + 断言状态值而非 DOM 结构（ADR-035 §G-1 抗脆弱规范）。

### 5.1 抓到的真实 P1 bug

> **community 单文件下载后勾选同步从未生效**（commit `e2789151`）
>
> `dlBtn.closest("[data-name]")` 命中的是**下载按钮自身**——按钮也带 `data-name` 属性。于是 `row.querySelector(".gh-sel")` 恒为 null，`cb.checked = true; selectedSet.add()` 是静默死代码：用户点击单文件下载后，复选框不勾选、选中计数不更新。
>
> 这是纯函数层测不出来的编排 bug——只有把真实 DOM 挂进去、点击真实的下载按钮才暴露。修复：`.closest(".gh-row")`。contextmenu 同款问题一并修正。

### 5.2 环境坑记录（happy-dom 实证）

| 坑 | 现象 | 解法 |
|----|------|------|
| DragEvent init 忽略 `dataTransfer` | 全走"非 .json"分支假绿 | `Object.defineProperty(ev, "dataTransfer", { value, writable: true })` |

---

## 六、剩余低覆盖与归因

| 文件 | 覆盖 | 归因 |
|------|------|------|
| `model3d.ts` | 4.16% | 坐标变换 9 次 fix 历史（陷阱 #11），WebGL 密集，纯 mock 收益低 |
| `skeleton.ts` / `detail.ts` / `litematic-3d.ts` | <1% | 3D 渲染管线，行覆盖不是正确度量（归 G-1/ADR-037 E2E） |
| `toolbar-events.ts` | 12.65% | 编排层，交互路径可归后续 G-1 批次 |
| `community/events.ts` 未覆盖分支 | — | 网络失败/缓存命中等路径已由组件测试覆盖主链路 |

按 ADR-035 G-4 立项约定：低覆盖大文件归组件测试 / E2E 覆盖广度报告（人工观察面，不进确定性门禁），不硬补行覆盖。

---

## 七、结论

1. **覆盖提升**：statements 42.68% → 51.1%，用例 +90，阈值保持确定性防回退；
2. **可测性改造**：6 个纯函数模块 100% 覆盖，3 处重复实现收敛到单一事实来源；
3. **组件测试**：G-1 样板落地 6 个编排文件 47 用例，抓出 1 个 P1 静默失效 bug——验证了「组件测试抓编排 bug、纯函数测逻辑」的分层分工；
4. **全部门禁**：每次提交 vitest + tsc + doctor + pre-push 门禁全绿。

> 一句主题：**纯函数给逻辑发身份证，收敛把同名者归户口，组件测试让代码在真实 DOM 里演练——测试覆盖不是数字游戏，是给每次交互路径留下证词。**
