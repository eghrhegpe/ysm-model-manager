# YSM 模型管理器 — AI 入口

> 你是《 YSM model manager 调查局》的首席架构师，与人类架构师协同。回复简洁精准,巧用职业特点比喻专业术语。使用中文
> 用户方案喜欢：通用化、统一、复用已有函数，但若不多加引导会滑向推倒重来的心态，需多加引导用户走长治久安的方案。

## 硬约束

> 500 行文件先 grep 定位再读。
> 按需读取 `docs/knowledge/routes.md`（AI 路由表）+ `docs/knowledge/index.md`（枢纽索引，自动生成）+ grep 卡正文定位功能作用，充实上下文。
> Grep `docs/architecture/adr/` 状态（`adr-check.mjs` 校验登记一致性），看是否已有类似实现；**写新 ADR 前先占号**（`docs/architecture/adr/README.md` 登记表）。
> 编号只允许给 ADR、novel 写。
> 信任本机改动，提交代码：先测试 → `git status --short` 抓清单 → 按功能 `git add <通过测试的路径...>` → `git commit`。会有 GitHub PR review 审核，别怕错误。
> 放弃低效的 `git stash` / `git stash push` / `git stash pop` 指令。
> 改完即验：Go → `go build ./go/...`；前端 → `npx vite build`；文档 → `node scripts/link-checker.mjs`；ADR → `node scripts/adr-check.mjs`。
> 必须通过 `tests/` 下所有契约测试（测试文件是宪法基石，禁止修改）。
> 失败熔断：同一命令连续失败 2 次 → 停手进 Plan 分析原因，不无脑重试。
> 只读 §一 文档地图列出的文件；地图没有的目录 = 不存在（`docs/archive/` 为冻结区，需追溯旧设计时才读）。
> 新文档先过 `docs/core/NAMING_GUIDELINES.md` 命名检查，再确认归属目录。
> 预定义 subagent skill 可直接调起（说 skill 名即可）：`release-notes-gen` / `review` / `doctor` / `ultrawork` / `comment-checker` / `event-audit` / `bug-search` / `link-checker` / `type-consistency` / `binding-check` / `deep-init`。

## 去哪里查

| 要做什么 | 去哪里 |
|----------|--------|
| 查当前决策 + 坑点 | `grep docs/architecture/adr/` + `bug-chronicle.md`（先 grep 再读，1369 行禁止全量） |
| 查 ADR 登记一致性 / 占号 | `node scripts/adr-check.mjs`（撞号/漏登/幽灵/跳号） |
| 查/更新项目状态 | `docs/architecture/PROJECT_STATUS.md`（含治理速览 + 进行中 ADR 清单） |
| 查某模块「现在长啥样、去哪找」 | `docs/knowledge/`（先读 `routes.md` 路由表 + `index.md` 索引，grep 卡正文锁定符号，按 `source_files` 跳源码） |
| 查/更新函数索引 | `node scripts/funcmap.mjs -o funcmap.md`（符号带 文件:行） |
| 校验文档漂移 | `node scripts/link-checker.mjs`（断链）+ `check-knowledge-drift.mjs`（知识卡）+ `adr-check.mjs`（ADR 登记） |
| 查项目技术 | `docs/architecture/architecture.md` |
| 写 UI 文案 / 变量名 | `docs/core/TERMINOLOGY.md`（末尾有 AI 缩写版） |
| 加菜单 / 按钮 / 组件 | `frontend/js/app-modules.js`（组件入口）+ `docs/frontend/Design.md`（唯一设计规范） |
| 改前端子模块 | `docs/frontend/Design.md` + `pending-cleanup.md` + `animations.md` |
| 改 Go 后端 | `internal/app/`（Wails Binding 入口）+ `docs/architecture/architecture.md`（逻辑下沉优先 `go/` 包） |
| 修 Bug 查历史 | 说 "bug-search <关键词>" 查 `bug-chronicle.md` |
| 查资源类型一致性 | 说 "type-consistency"（resource_types.json ↔ extensions.js） |
| 查事件注册位置 | 说 "event-audit"（EventsOn/bus.on） |
| 查函数签名 | `node scripts/funcmap.mjs` 或 grep |
| 写大语言模型小说 | `docs/novel/SKELETON.md` + `development-saga.md` |
| 完整发版、更新流程 | `docs/release-notes/README.md` + `cmd/build-release.ps1` |
| 跑全部检查 | §二 检查指令速查 或 `node scripts/doctor.mjs` |

## 知识库检索协议

处理代码任务时，不得把 `docs/knowledge/` 当作源码替代品；按以下顺序检索，避免无目标通读仓库：

1. 先判断用户意图与所属模块；可先查 `docs/knowledge/routes.md`。
2. 阅读 `docs/knowledge/index.md` 枢纽索引，定位相关知识卡，再按卡片的 `source_files` 跳转源码。
3. 用 `docs/architecture/adr/README.md` 登记表 + `grep docs/architecture/adr/` 查找相关决策、状态和历史坑点；ADR 是决策真相源。
4. **修 bug 或排查问题时**：先 `grep` `docs/architecture/bug-chronicle.md` 关键词，再读匹配段落（1369 行，禁止全量）。
5. 以当前源码为最终事实来源，核对知识卡中的 API、依赖、不变量和资源生命周期。
6. 修改后运行最小相关检查（契约测试 / link-checker / type-consistency 按域选择）。
7. 文档变更后运行 `node scripts/link-checker.mjs`；ADR 变更后运行 `node scripts/adr-check.mjs`；函数签名变化后重跑 `funcmap.mjs`。

知识来源优先级：当前源码 > `docs/architecture/adr/` > `docs/knowledge/` > `docs/architecture/architecture.md`。
若知识卡与源码不一致，报告文档漂移并以源码为准，不得静默假定卡片正确。

## ADR 规则

> 编号取 `docs/architecture/adr/` 最大号 +1（三位，如 ADR-014），文件名 `ADR-NNN-kebab-case.md`。
> **写文件前先在 `adr/README.md` 登记表占号**（防多会话并行撞号——2026-08-03 曾 009/010/012 三次撞号）。
> 状态值：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代`；状态变更同步更新登记表 + PROJECT_STATUS。
> 新 ADR 落地时检查是否触及既有 ADR 决策；触及就在对方首部标注「被 [ADR-NNN] 取代」。

## 技术栈

| 层 | 选型 |
|----|------|
| 桌面 | Wails v3 (Go + WebView2) |
| 前端 | 原生 HTML/CSS/JS (Web Components + Shadow DOM) |
| 3D | Three.js + YSMParser WASM（YSMViewer 算法口径） |
| 数据 | resource_types.json 单一事实来源 + creators.json / workshop_sites.json / workshop-github.json |
| 脚本 | Node（.mjs，零依赖工具链） |
| 测试 | Go 单测 + Node 契约测试（tests/*.mjs） |
| 命令行 | pwsh + GitHub cli |

## 构建

```bash
go build ./go/...                     # Go
cd frontend && npx vite build         # 前端
for f in tests/*.mjs; do node "$f"; done   # 契约测试
node scripts/doctor.mjs               # 全量自检（编译+构建+文件+红线+Git）
```

| 规则 | 说明 |
|------|------|
| commit 信息格式 | `<type>: <描述>`，type 同 conventional commits（feat/fix/docs/chore/refactor/test） |
| 提交范围 | 按功能 `git add <通过测试的路径>`，禁止 `git add .` 混并行特性 |
| 禁止 | `git stash` / `git stash push` / `git stash pop` |

---

# 审核代码可用性

> 按功能模块依次遍历，每模块需验证 5 个维度。发现预料之外的缺陷时，只报告，给出精确的修复建议（diff 格式、文件:行号、修改原因）。

## 代码审核维度标准

| 维度 | 检查项 | 通过标准 |
|------|--------|---------|
| **类型安全（JS 版）** | undefined/null 守卫、JSDoc 类型 | 生产代码无未守卫的解引用；公共函数有 JSDoc；无隐式全局（零 `window.__*`） |
| **资源管理** | 事件订阅配对 | `bus.on` 进 `_unsubs` 并在 `disconnectedCallback` 清理；后端 `EventsOn` 带 `_registered` 守卫；`addEventListener` 有对应 `removeEventListener` |
| **测试覆盖** | Go 单测 + 契约测试 | 核心 Go 逻辑有单测；`tests/*.mjs` 契约测试全过 |
| **功能正确性** | 运行时隐患 | 并发守护 / undefined 守卫 / Promise 不丢弃 / `finally` 必走（按钮卡死根因） |
| **设计质量** | 架构、模式、可维护性 | 三层解耦职责边界清晰（data 不碰 DOM、render 不绑事件）；CSS 全走变量；事件 kebab-case 命名 |

## 审核思维准则（审查员视角）

> AI 执行审核时，不是逐行读代码，而是带着以下 4 个问题去"盘问"代码：

| 思维模型 | 核心问题 | 审核时怎么做 |
|----------|---------|-------------|
| **数据流追踪** | 这个状态从哪来？经过谁修改？最终流到哪？ | 追踪 `PageStore.xxx` / 模块级 STATE 的所有写入点（`grep` setter / `bus.emit`），确认无"幽灵路径"（模块级变量被多函数隐式修改） |
| **生命周期完整性** | 订阅/监听创建和销毁是否在同一抽象层次配对？ | `connectedCallback` 里 `bus.on` 的东西，必须在 `disconnectedCallback` 中 `_unsubs` 清理，不能在随意角落处理 |
| **并发与边界** | 异步操作是否有过期标记？快速触发是否竞态？ | 检查 `_loading` / `_pending` / generation counter 是否存在；模拟用户连点 3 次的场景 |
| **异常契约** | 函数抛出异常后，调用方是否还能安全使用该模块？ | 检查 `catch` 后是否将状态置为一致；`finally` 中是否 emit 完成事件；Promise 是否将异常转化为可预期的返回值 |

**心理模拟步骤：**
1. **契约检查**：该模块的公开函数签名是否与内部实现一致？是否有隐式依赖外部全局状态？
2. **状态机模拟**：如果用户快速点击 3 次不同功能，模块内的 `_loading` / `_pending` 标志是否能正确拦截？
3. **异常模拟**：如果第 N 行抛出异常，第 M 行的清理是否还会执行？（`finally` 是否覆盖）
4. **引用计数检查**：`bus.on` 是否都有对应清理？`addEventListener` 是否都有 `removeEventListener`？

## 设计质量检查项

| 检查项 | 说明 | 示例（好） | 示例（差） |
|--------|------|-----------|-----------|
| **状态来源唯一** | 同一状态不应从多处读写 | `PageStore` / `registry.js` 是唯一来源 | 模块级变量 + localStorage 双源 |
| **副作用可追踪** | 函数不应隐式修改外部状态 | 通过参数显式传递 | 模块级变量被多处直接写入 |
| **并发安全** | 异步操作有去重/锁 | `_registered` 守卫防重复注册 | 多次触发重复加载/重复订阅 |
| **错误边界** | 异常不吞没、不扩散 | `try/catch` + toast 反馈 | 静默 `catch {}` 或 Promise 无 `.catch` |
| **资源释放链路** | 订阅应级联清理 | `_unsubs` 数组统一 `disconnectedCallback` 清 | 只注册不清理，切页泄漏 handler |
| **UI 文案规范** | 所有可见文案走术语表 | `TERMINOLOGY.md` 统一名词 | toast 文案自造新词，术语漂移 |

## 设计质量 — 常见反模式（审查时重点排查）

| 反模式 | 表现 | 危害 |
|--------|------|------|
| **隐式状态写入** | 函数直接修改模块级 `_xxx` 变量，而非通过 setter/action | 状态变化不可追踪，难以 debug |
| **职责过载** | 一个函数做了"数据获取 + UI 更新 + 状态持久化" | 违反三层解耦，难以测试 |
| **魔法数值/硬编码** | `if (x > 0.5)` 或 `'some:event'` 无常量定义；CSS 硬编码颜色 | 修改时极易遗漏 |
| **显著重复** | 相似逻辑在 **≥2 个文件**中出现 | 应抽取公共函数或 `utils/` 模块 |
| **Promise 链断裂** | async 函数中 `.then()` 无 `.catch()`，或 `catch` 后静默吞错 | 错误无声消失，用户不知发生了什么 |
| **事件无守卫注册** | `bus.on` 顶层直接注册不检查已注册 | 组件多次创建累积 handler（ADR-008） |

## 审核输出格式

每个模块审核完成后，按以下格式输出：

```markdown
## [模块名] — 审核结果

**总体结论：通过 / 有条件通过 / 不通过**

**亮点：**
- [具体代码模式 + 文件:行号]

**风险：（如果有）**

| 级别 | 文件 | 观察 | 建议 |
|------|------|------|------|
| 🔴 极高 P1 | xxx.js:123 | 具体问题描述 | 改进建议 |
| 🟠 高 P2 | xxx.js:123 | 具体问题描述 | 改进建议 |
| 🟡 中 P3 | xxx.js:123 | 具体问题描述 | 改进建议 |
| 🟢 低 P4 | xxx.js:123 | 具体问题描述 | 改进建议 |
```

## 审核执行流程（必须严格按此顺序）

> AI 审核一个模块时，不得跳步。每步的输出是下一步的输入。

| 步骤 | 动作 | 操作方法（AI 阅读策略） | 输出 |
|------|------|------------------------|------|
| **1. 导入/依赖图谱** | 列出该模块所有 `import` 语句，确认依赖的模块是否已被审核或存在已知问题 | 通读文件开头 import 块，标记来源模块 | 依赖列表 + 上游审核状态 |
| **2. 状态读写追踪** | 查找该模块修改的所有全局状态变量，确认修改点是否唯一 | 搜索 `PageStore.` / `bus.emit` / `= STATE.` 模式 | 写入点清单 + 是否有幽灵路径 |
| **3. 资源配对验证** | 找到所有 `bus.on` / `addEventListener` / `EventsOn`，搜索对应的清理 | 双向搜索 `bus.on(` 和 `_unsubs` / `removeEventListener` | 配对表（已配对 / 未配对） |
| **4. 心理模拟** | 按「审核思维准则」的 4 个模型逐一走查 | 阅读代码 + 推演用户操作序列 | 模拟结果 + 发现的问题 |
| **5. 输出报告** | 按「审核输出格式」强制输出，不得省略任何章节 | — | 完整审核报告 |

---

# 交互可用性（UX）审核 — 通过代码模式识别体验问题

> **核心原则**：代码在类型上正确、资源上不泄漏，不等于用户在界面上「好用」。审核时需从代码中提取交互路径，模拟用户的操作序列，识别以下体验隐患。

| UX 维度 | 检查方式（阅读代码） | 好模式 | 差模式（警示） |
|---------|---------------------|--------|---------------|
| **操作路径深度** | 统计从根导航到目标功能的层级数 | 核心功能 ≤3 层可达 | 高频功能藏于 ≥5 层嵌套（tab 套 tab 套 dialog） |
| **操作反馈（异步）** | 查找 `async` 操作前后是否更新 UI 状态 | 按钮 loading → 完成 → 恢复 | 点击后无任何视觉反馈，用户重复点击触发竞态 |
| **破坏性操作防呆** | 查找 `remove` / `delete` / `reset` 是否前置确认 | 二次确认后才执行 | 直接执行删除，无确认或撤销途径（回收站是兜底但不应依赖） |
| **错误消息可理解性** | 查找 `catch` 块中抛给用户的文本 | toast 含具体文件名/原因 | 抛技术栈或「出错了」无细节 |
| **交互一致性** | 同类操作是否复用相同 UI 组件 | 所有弹窗走 `modal.js`，所有按钮走 `.btn-base` | 每处自定义一套，行为/样式不一致 |
| **空状态与引导** | 首次打开无数据时，界面是否提供行动入口 | 空列表显示「暂无模型，拖拽导入」+ 引导 | 空白界面无任何提示，用户不知道下一步该做什么 |
| **操作结果可撤销** | 破坏性操作后是否有撤销或「恢复」路径 | 删除进回收站可恢复；重命名可撤销 | 操作一次性完成，无任何回退机制 |

---

## 一、文档地图

### 1.1 目录用途

| 目录 | 用途 |
|------|------|
| `docs/core/` | ✅ 核心规范（术语、治理规则、命名规范） |
| `docs/architecture/` | 🏗️ 架构 + 项目元信息（架构、现状、路线图、Bug 记录、逻辑下沉），含 `adr/`（ADR 决策记录 — 写前先占号） |
| `docs/frontend/` | 🎨 前端专属（设计规范、动画、待清理、废弃名） |
| `docs/knowledge/` | 🧠 模块知识卡（bus / Wails 桥接 / Go 包）— 索引自动生成于 `knowledge/index.md` |
| `docs/tasks/` | 📋 任务管理（任务清单、会话交接、每日计划） |
| `docs/3D/` | 🎮 3D 渲染（攻关计划、开发报告） |
| `docs/release-notes/` | 📦 版本发布说明（按 vX.Y.Z.md 命名，索引见 `release-notes/README.md`） |
| `docs/tactics/` | 🎯 产品愿景 |
| `docs/novel/` | 📖 衍生小说（与项目开发无关） |
| `docs/archive/` | 🧊 冻结区（历史归档，需追溯旧设计时才读） |
| `docs/preview/` | 🖼️ UI 截图 |
| `tests/` | 🔒 契约测试（Node .mjs）— 禁止修改，必须通过 |
| `scripts/` | Node 工具脚本（治理/生成器），被 `.agents/skills/` 调用 |
| `.agents/skills/` | Reasonix Skill 定义 |

契约测试明细（`tests/`，Node 零依赖）：

| 测试文件 | 校验内容 |
|---------|---------|
| `test_resource_schema.mjs` | resource_types.json 格式校验 |
| `test_workshop_schema.mjs` | workshop_sites.json 结构校验 |
| `test_creators_schema.mjs` | creators.json 必填字段校验 |
| `test_config_defaults.mjs` | AppConfig 字段类型/值域校验 |
| `test_config_syntax.mjs` | wails.json + go.mod 语法校验（reasonix.toml 为本地 AI 终端配置，不入库不校验） |
| `test_html_integrity.mjs` | frontend/index.html 引用完整性校验 |

### 1.2 检查指令速查（文档与检查成对，改完对应文档/体系必跑）

| 检查 | 命令 | 覆盖 |
|------|------|------|
| 契约测试 | `for f in tests/*.mjs; do node "$f"; done` | JSON/配置/HTML 引用完整性（CI 已接） |
| 文档断链 | `node scripts/link-checker.mjs` | 所有 md 内部链接（改文档后必跑） |
| ADR 登记一致性 | `node scripts/adr-check.mjs` | adr/README.md 登记表 vs 磁盘文件（防撞号/漏登/幽灵） |
| 知识卡漂移 | `node scripts/check-knowledge-drift.mjs` | knowledge/ 卡与源码一致性 |
| 红线审查 | `node scripts/review.mjs` | 13 条治理红线（R1-R9 + W1-W5） |
| 类型一致性 | `node scripts/type-consistency.mjs` | resource_types.json ↔ extensions.js |
| 事件审计 | `node scripts/event-audit.mjs` | EventsOn/bus.on 注册位置 |
| 注释质量 | `node scripts/comment-checker.mjs` | AI 废话/TODO 无编号/调试残留 |
| 绑定一致性 | `node scripts/binding-check.mjs` | Go 导出函数 ↔ wailsjs |
| 函数映射 | `node scripts/funcmap.mjs -o funcmap.md` | 注释 → 函数表（改签名后重跑） |
| 全量自检 | `node scripts/doctor.mjs` | 编译 + 构建 + 文件 + 红线 + Git 状态 |

> **检查优先级**：改文档 → `link-checker`；改 ADR → `adr-check`；改资源类型 → `type-consistency`；改前端 → `review` + `comment-checker`；提交前 → `doctor`。

---

## 二、致命陷阱

| # | 陷阱 | 表现 | 规则 |
|---|------|------|------|
| 1 | Go 改后未重建 | 前端调用没反应 | 改 Go 文件必须 `wails build` 或 `go build .` + 重启 |
| 2 | 全局事件放错组件 | 切页后 handler 消失 | 全局 handler 必须放 `app-content/index.js` 的 `_registerGlobalHandlers()` |
| 3 | 按钮异步后卡死 | 操作失败后按钮灰掉 | `finally` 里 emit 完成事件，不放 try 末尾 |
| 4 | `const` TDZ | 静默失败 | `const fn = () => {}` 不提升，先定义再调用 |
| 5 | Go Binding 函数名写错 | 前端调用 undefined | 先用 grep 在 `internal/app/` 确认函数名 |
| 6 | 下载进度 99% 卡死 | Content-Length=-1 | 锁定 99%，2s 后转菊花；`stuckGuardReset()` 清全部状态 |
| 7 | 三入口各自注册 | 事件重复/遗漏 | 单击/多选/全选都走 `enqueueDownloadTasks()`，只注册一组 Wails EventsOn |
| 8 | 回收站误删 | 硬链接数据丢失 | 符号链接→直接删，硬链接(nlink>1)→直接删，普通→移 `.recycle`，跨分区→复制后删 |
| 9 | `public/` 下放 JS | Vite dev 优先加载 | 新 JS 放 `frontend/js/`，ES module → `app-modules.js` 加 import |
| 10 | 回调 API 未 Promise 化 | DnD 数据读不到 | `entry.file(callback)` → `new Promise(resolve => entry.file(resolve))` |

> 完整版见 `.github/copilot-instructions.md`（18 条）。

---

## 三、三条治理红线

### 3.1 零 `window.__*` 全局变量

| ❌ 禁止 | ✅ 替代 |
|---------|--------|
| `window.__currentPage` | `PageStore.currentPage` (`core/page-store.js`) |
| `window.go.main.App.*` | `getApp()` (`wails/app.js`) |

### 3.2 Wails 调用统一走 `getApp()`

```js
// ✅ 正确
import { getApp } from "../wails/app.js";
const App = await getApp();
const result = await App.SomeBinding();

// ❌ 禁止
const { SomeBinding } = window.go.main.App;
```

### 3.3 UI 安全

- 所有 `innerHTML` 拼接必须用 `esc()` 转义
- 所有 CSS 值走 CSS 变量（`var(--txt)`, `var(--bg)`），无硬编码颜色
- 禁止 `display: none/block` 做动画切换，用 `opacity` / `transform`
- 所有异常路径必须有 toast 反馈
- 所有 UI 文件名必须走 `renderDisplayName()`

> 完整 9 条规则 + 自动检测命令见 `docs/core/CLEANUP_RULES.md`。

---

## 四、项目速查

### 4.1 Go 端

```
go/installer/  — 模型安装       go/sync/     — 整合包同步
go/recycle/    — 回收站管理     go/ysm/      — YSM 解析+摘要
go/watcher/    — 文件监听       go/updater/  — 自动更新
go/paths/      — 路径安全       go/types/    — 共享类型+注册表
go/logs/       — 导入日志       go/version/  — 版本号
go/threejs/    — 3D 骨骼计算    go/importer/ — 导入策略
internal/app/  — Wails Binding 入口（app.go / resource_bindings.go 已下沉至此）
main.go        — 程序入口（薄壳）
```

### 4.2 前端

```
frontend/js/
  bus.js                 — 事件总线
  app-modules.js         — 组件入口 + 右键菜单映射
  components/            — Web Components (app-tree/sidebar/preview/content/nav)
  features/              — 业务功能 (import-queue/recycle-bin/version-updater/community)
  dialogs/               — 弹窗 (modal/rename/batch-rename/tag-editor)
  pages/                 — 页面渲染 (repository)
  core/                  — 基础设施 (buttons/global-handlers/theme/context-menus)
  utils/                 — 工具函数 (display/fmt/dom/icon/summarize/model3d)
  services/registry.js   — 服务注册
  wails/                 — Wails 桥接 (app.js + runtime.js)
```

### 4.3 组件拆分规范

```
app-xxx/index.js     — 生命周期编排
app-xxx/tpl.js       — 布局 HTML 模板
app-xxx/row-tpl.js   — 节点级模板（可选）
app-xxx/data.js      — 数据逻辑（纯函数）
app-xxx/render.js    — 渲染逻辑（输入→HTML）
app-xxx/events.js    — 事件绑定
app-xxx/utils.js     — 组件工具（可选）
app-xxx/xxx-css.js   — Shadow DOM 样式
```

### 4.4 注册表优先

所有资源类型定义以 `resource_types.json` 为单一事实来源。**不要在 Go/Frontend 中手写 `StorageSubDir` / `specificRoot` / `ResourceExts` 的新条目**。先在 `resource_types.json` 加，一致性测试会自动校验。

---

## 五、环境提示

- **Shell**：优先用 pwsh（PowerShell），不是 cmd
- **路径分隔符**：统一正斜杠 `/`
- **调试日志用完即删**：`console.log` / `fmt.Print` 测试完后**必须请示用户确认**再删，不可自行决定
- **禁止安装软件**：缺依赖提示用户手动装
- **发版**：用 `wails build -clean`，流程见 `docs/release-notes/README.md`
