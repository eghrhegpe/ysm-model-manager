---
name: "ts-giant-function-surgery"
description: "按五步流水线拆前端 TS/JS 超长巨函数：闭包升格/类型提级/路由解耦/双门禁/路径限定提交。Invoke when: 单函数>100 行 or 闭包≥3 or 用户说「拆前端函数/精简 TS 长函数」。"
---

# 前端巨函数解剖（TS 版，YSM 项目沉淀）

基于「巨函数解剖手术」通用 Skill，专用于 **TypeScript/JS 前端源码**（本项目：`frontend/src/**/*.ts`，原生 Web Components + Shadow DOM，构建工具 Vite + tsc --noEmit）。

固化本项目 ui-rows.ts / animation+web-fs / preview-menu.ts 三刀累计 12 次前端重构的**专属红线**，避免每刀都重述同一套约束。

严禁改变任何运行时行为，等价结构提纯。

---

## 0. 触发条件（三选一即启用）

1. `frontend/src/**/*.ts` 单函数 **> 100 行**（含注释与空行，`(Get-Content file | Select-Object -Skip L-1 | Select-Object -First N | Measure-Object -Line)` 统计）
2. 函数体内**闭包 ≥ 3 个**（嵌套 `const fn = () => {}` / `function fn(){}`，尤其是捕获外部 let 循环变量的）
3. 用户明确：「拆前端 xxx 函数 / 精简 TS 长函数 / 重构 UI 代码」

---

## 1. 五步流水线（必走，无捷径）

### Step 1 — 查证与解剖（不动手，只摸底）

**动作清单：**
1. `Grep -n "^export? ?function <名字>" frontend/src/...` 锁起始行号；用 `Read` 读 `起始行 ~ 起始行+预估行数+50`，自算结束 `}` 的上一行 → 得真实行数。
2. 手工标自然分段：
   - **阶段型**：壳装配 → 路由表 → 行工厂 → 视图渲染 → 句柄返回（mountPreviewRootMenu 范式）
   - **闭包型**：内部 `const fnA/fnB/fnC`（fillSwitch/fillRoles 范式）——逐闭包列捕获的外部变量清单，这是升格时参数量化的依据
   - **声明式+过程式混排**：schemaBuilders 映射 + fillers 过程式函数（preview-menu 路由衰退链）
   - **事件监听型**：pointerdown/up、onclick、oninput 等带副作用段，结尾必须有 dispose/abort 解绑
3. **查复用**：`Grep -n "同名片段" frontend/src/`，找已拆兄弟函数（ui-rows.ts 的 `updateSliderDisplay` / `createHeaderToggle`），确认能否搬运。
4. **查消费方**：若函数被 `export`，`Grep -rn "import.*<函数名>" frontend/src/` 列出所有调用处，签名改动不能断链——**主函数签名保持不动，子函数一律包级非导出**。

**产出：** TodoWrite 拆成「1查证 2基线 3分拆(按目标函数数×N子) 4验证 5提交」五段。

### Step 2 — 跑基线（留对照组）

**双门禁固定顺序：**
```powershell
cd frontend
npm run typecheck 2>&1 | Select-Object -Last 20
npx vite build 2>&1 | Select-Object -Last 12
```

**⚠️ 红线（重要，踩坑实锤）：**
- 基线报错分两类：**本文件的 vs 其他同事遗留的**。判定法：`npx tsc --noEmit --pretty false 2>&1 | Select-String "<目标文件名>"`——0 条 = 本刀基线干净；遗留错误不动也不背锅（说明里注明「site-view.test.ts 基线错误，非本刀范围」）。
- **判定不清 → git stash 改了的文件跑 baseline**（第12刀 preview-menu.ts 就是这么做的），stash pop 还原再动刀。
- vite build 的 `chunk size >500KB` 警告是全局配置问题，不判定为失败。

### Step 3 — 自然边界分拆（核心手术）

**拆分模式优先级 + 项目命名口径：**

| 模式 | 适用场景 | 子函数命名口径（YSM 约定） |
|---|---|---|
| ① 按阶段 | 壳装配→路由→渲染→句柄（流水线） | `build<Domain>Shell` / `build<Domain>Routers` / `render<Domain><Part>` / `bind<Domain><Event>` |
| ② 闭包升格（最常见） | 内部 `const fn = () => {...}` 嵌套≥3个 | 把闭包捕获的 5~12 个外部变量**全参数量化**成入参；前缀 `<domain>` 防包级命名冲突（`switchNormPath` / `makePreviewMenuRow`） |
| ③ 类型提级 | 函数内匿名接口 `interface X{...}` 被 2+ 闭包共享 | 放主函数声明正上方，包级非导出；命名 `PreviewHandleShell` / `PreviewMenuRouters`（domain 前缀） |
| ④ 前向引用解壳 | handle 在函数末尾才赋值，fillRoles 回调要引用 → `{ handle: T \| null }` 对象壳 | 接口名 `*Shell`（如 `PreviewHandleShell`），回调处 `shell.handle?.<method>(args)` 可选链安全读 |
| ⑤ 事件监听提纯 | pointerdown/up、AbortController、addEventListener 段 >20 行 | 独立 `bind<Domain><Event>(viewEl, popup): () => void`，返回 cleanup/abort 闭包，dispose 单调用 |
| ⑥ 重复 inline onclick 抽取 | 2+ 段 onclick 里 `!sameType && ctx.switchExternal ? ... : ctx.switchTo(...)` 完全同构 | `apply<Domain><Action>(p, sameType, ctx, keepInScene)`（如 `applySwitchRowClick`） |
| ⑦ 共用 filter 链提纯 | renderDock 内部 `allItems.filter.filter.filter.filter` 5段链式过滤，2+ 处复用 | `dockGroupItemsFor(g, allItems, ctx)` 包级函数，中间合成变量 `hasEnv` 一次计算防 4 次 registry 查询 |

**黄金约束（红线，不可破）：**
- 🚫 **主函数签名不动**：export 函数的参数列表/返回类型原封不动；调用方零改动（回归红线）。
- 🚫 **闭包升格严禁留自由变量**：每个子函数里用到的「原函数外部变量」必须显式入参，不能「偷偷捕获包级同名变量」——否则两处调用不同上下文时行为漂移（preview-menu mount 的 `hideMenu` 曾是闭包内自由引用，升格后全部作为 `hideMenu: () => void` 入参）。
- 🚫 **DOM 结构与 class/id 不变**：`data-testid="preview-switch-append"`、`id="preview-close-3d"` 这些 e2e 选择器**一个字符都不能改**，`dataset.testid` 赋值位置不能变。
- 🚫 **onclick 的 stopPropagation 不能丢**：dock button / append 按钮 / row 本体点击内的 `ev.stopPropagation()` 是防冒泡杀弹窗的护栏，不能省。
- 🚫 **try-catch 错误边界不能撤**：`renderPreviewPanel` 的 `catch(err)` 要把 `console.error + safeErrorMessage + 红色 errRow` 三件套保留，不能省成空 catch。
- 🚫 **localStorage 持久化口径不能改**：`safeSet(PREVIEW_LAST_RTYPE_KEY, key if key!=="" else skip)` 的「空串不落盘」是跨会话记忆污染的护栏，不能动。
- 🚫 **不引入新 import**：只用原函数已经 import 的包；需要新类型 → 在本文件 `interface`/`type` 镜像声明，不加新依赖。

**主函数瘦身目标：**
- 原 150+ 行 → 主函数 ≤ 70 行（纯流水线：6 次阶段调用 + 句柄组装）
- 每个子函数 ≤ 原函数行数的 40%，且最长子 ≤ 80 行（dock render 分支密集的可放宽到 100，但要继续拆内部段级子）

### Step 4 — 双门禁验证（每拆完一个函数验一次，别攒雷）

**顺序与验证粒度：**
1. **每改完一个子函数（约 50~80 行编辑）→ `cd frontend ; npm run typecheck`**：单步即时发现 TS2345 参数不对 / TS2339 属性不存在 / TS7006 隐 any，此时行号漂移最小。
2. **三目标函数全拆完 → `cd frontend ; npx tsc --noEmit --pretty false 2>&1 | Select-String "<目标文件名>"`**：0 条 = 改的文件干净。
3. **最终双门禁**：
   ```powershell
   cd frontend
   npm run typecheck     # 整仓类型检查（其他同事遗留错误标注清楚）
   npx vite build        # 产线构建；built in < 10s 正常
   ```
4. **pre-commit 的 css-layer-check**：Shadow DOM `keyframe 名称越界 / 类归属错误**会被钩子阻断**，若改函数涉及 `document.createElement("style")` 注入规则 → 注入前查 `ensure*Styles()` 幂等守卫，重复注入 no-op。
5. **任一失败仅 1 轮修复仍不过 → 暂停报告主模型**（损害控制条款）。

### Step 5 — 路径限定提交（单刀单 Commit）

**动作清单：**
1. `git add <只动了的 TS 文件>` —— frontend/coverage、dist/ 等生成物**绝不手动加**
2. **Commit 消息模板（中文，对齐 12 刀历史）：**
   ```
   refactor(ui): 拆 <filebasename> <主函数A/主函数B/主函数C> 共 N 行→X主+Y子(≤M行/子) <闭包升格/类型提级/路由解耦/共用过滤提纯/tap识别独立>
   ```
   例：`refactor(ui): 拆 preview-menu.ts 三巨 mountPreviewRootMenu/fillSwitch/fillSettings 共 634 行→3主+20子(≤63行/子) 9闭包升格+路由衰退链解耦+dock过滤提纯+tap识别独立`
3. **路径限定 commit**：`git commit -m "<msg>" -- frontend/src/.../xxx.ts`（不带上游同事在改的 init-workshop / site/edit）
4. pre-push 全门禁留到多刀后统一触发，单刀不主动 push。

---

## 2. 典型踩坑速查（本项目前端专属）

| 现象 | 根因 | 修复 |
|---|---|---|
| `TS2454: Variable 'routers' is used before being assigned` | 子函数 `buildPreviewMenuRouters` 内部 routers 被闭包引用前还没赋值（TS 流分析看不到「下面立即赋值」） | 在 routers 声明前写注释，或把 makePanelView 闭包内用到 routers 的地方改成闭包**延迟调用时再读**（routers 声明后把 makePanelView 包一层 factory 即可） |
| `闭包升格后 onclick 丢了 activeTab` | 升格成包级函数后没把 activeTab 作为 `getActiveTab: () => string` getter 入参，变成读包级变量 | 把 let activeTab 主函数变量包装成 getter 函数 `() => activeTab` 传给子函数（`runSwitchRenderRows` 的范式） |
| `e2e 选择器变了 preview-switch-append 找不到` | 改了 `append.dataset.testid` 的赋值位置或字符串 | diff 时逐行核对所有 `dataset.testid = "..."` 和 `row.id = node.legacyTestId` 段 |
| `git stash pop 后多出 init-workshop.ts CRLF warning` | 非本刀文件，Git 跨平台行尾自动转换 | 与本刀无关，直接忽略；只 commit 自己的目标文件即可 |
| `typecheck 报 site-view.test.ts 错，但我没改那个` | 其他同事遗留的基线错误 | 用 `npx tsc --noEmit --pretty false 2>&1 \| Select-String "<目标文件名>"` 过滤，确认 0 条即通过；提交消息里注明遗留错误不属本刀 |

---

## 3. 与通用 Skill 的关系

- 若改动涉及 Go/Node/TS **跨语言或跨前端模块链** → 优先用 `巨函数解剖手术`（通用父 Skill）。
- 纯前端 TS/JS、Web Components + Shadow DOM + Vite 栈 → **直接启用本 Skill**（ts-giant-function-surgery），踩坑直接查上表。
- 共用父 Skill 模板：五步流水线、黄金约束 40% 行数上限、损害控制 1 轮修复叫停。
- 专属扩展：三目标函数（settings/switch/mount）的 7 种模式命名口径 + Shadow DOM 样式检查通过 css-layer-check + Select-String 过滤基线错误。

---

## 4. 一次完整手术的验收清单

- [ ] TodoWrite 任务树：≥ 1 查证 + 1 基线 + N 分拆（每函数×3-6子）+ 1 验证 + 1 提交
- [ ] 改动源码文件 = 1（单一文件路径限定为最佳；若 2+ 需独立边界说明）
- [ ] 主函数行数 = 原行数的 25%~40%（原 312 → 64 为优秀；原 157 → 9 为优秀）
- [ ] 子函数个数 ≥ ceil(原行数/40)；最长子 ≤ 80 行
- [ ] 原函数内所有闭包都升格为包级函数（无嵌套 `const fn = () => {}` 留在主函数里）
- [ ] `npx tsc --noEmit --pretty false 2>&1 \| Select-String "<目标文件名>"` → 0 条
- [ ] `npx vite build` → `✓ built in Xs` 成功
- [ ] css-layer-check pre-commit 钩子（若有样式注入）：✅ 通过
- [ ] 路径限定 commit 1 条，msg 含：文件、函数、原行数、拆后结构、核心手法五项
