---
name: "frontend-batch-sweep"
description: "前端TS批量清膘流水线：全目录扫描超长函数→分级排档→多方案供选→并行拆分→双门禁总验→路径限定提交。Invoke when 用户说「扫描 frontend/src 其余目录/批量拆前端视图层/清膘前端剩余肥膘/前端批量巨函数处理」或一次要拆>=3个前端文件时。"
---

# 前端批量清膘流水线（frontend-batch-sweep）

**定位**：批量编排层。当一次需要处理 ≥3 个前端 TS 文件或用户明确说「批量/全目录扫描/清膘/剩下的肥膘」时启用；单文件/单函数处理请直接用下层 Skill `ts-giant-function-surgery`。

**先决条件**：项目栈为 Web Components + Shadow DOM + Vite + `npx tsc --noEmit`；已有兄弟 Skill `ts-giant-function-surgery` 可用。

---

## 0. 触发条件（满足任一即启用）

1. 用户说「扫描 frontend/src 其余目录 / 批量拆前端视图层 / 清膘前端剩余肥膘 / 前端目录一扫光 / 剩下的前端巨函数」
2. 候选函数清单中有 **≥3 个未处理目标** 且用户希望一组一组推进
3. 一次要拆 **≥3 个独立文件**（跨语义域：视图层、社区域、3D 核心等可按域编组并发）

---

## 1. 八步流水线（按顺序走，不可跳步）

### Step 1 — 全目录扫描（主模型一手数据）

**目标**：拿到 `frontend/src/**/*.ts` 所有 **≥80 行** 的函数/类清单，排除已拆文件和 vendor/test。

**动作**：用正式肥膘扫描器 `scripts/line-counter.ts --funcs`（`--threshold 80` 对齐本流水线黄档阈值），`--scope` 限定要扫的域。示例如下：

```powershell
node scripts/line-counter.ts --funcs --scope frontend/src --threshold 80
node scripts/line-counter.ts --funcs --scope frontend/src/preview-3d --threshold 80   # 按域收窄
```

> 它是括号匹配定边界 + 新顶层声明护栏的正式工具，**不虚高**（对比：手写正则无护栏会吞后续函数/类，行数虚高；`_scan_frontend.mjs` 临时脚本已废弃，勿再造）。结尾 `[护栏截断]` 标记=该函数体后紧跟新顶层声明，行数为保守截断值，拆前以鲁棒为准复核。

**输出**：按 🟥>240 / 🟧>160 / 🟨>80 三档降序的候选清单，每条标注 `函数名 <kind> | 行数 | 文件路径:L起`；统计「命中合计」。再按 git log 前 N 条 `refactor(ui): 拆 ...` 剔除已拆文件。

### Step 2 — 候选分级（三档制，便于方案组合）

按行数+语义域贴标签，同一语义域聚成一组：

| 档级 | 行数阈值 | 标签 | 典型代表 |
|------|---------|------|---------|
| 🟥 真·巨鲸 | >240 行（=3×80） | 跨视图/跨域主类 | 主视图 WebComponent 类、大段事件绑定聚合函数（≥400 行必进） |
| 🟧 大鲨鱼 | >160 行（=2×80） | 域级核心 | 3D 渲染管线、同步下载队列、对话框组装函数 |
| 🟨 剑鱼 | >80 行（=1×80） | 高价值单点 | 模块 init 函数、子视图 render、独立解析器 |

**过滤规则**：
- ✂️ 排除 `**/vendor/**`（第三方 loader/parser，不动上游）
- ✂️ 排除 `*.test.ts / *.spec.ts`（测试文件不在生产重构范围）
- ✂️ 排除 `[✓已拆]` 标记：本仓库 git log 前 N 条 `refactor(ui): 拆 xxx.ts ...` 命中的文件
- ✂️ 排除 `scripts/`、`docs/`、`frontend/dist/` 生成物

### Step 3 — 推荐开刀组合（3-4 套方案，必有 1 套标「推荐」）

按「语义域邻近 + 并行子代理数 ≤4」编组方案。命名规范：**方案A/B/C/D + 中文域标签**。

**例（第17刀方案A写法模板）**：
```
- 方案A（推荐·骨架清场）：视图层 4 巨头连拆 —— bindEditEvents(471) / AppTree(411) / AppSidebar(403) / AppNav(299)
- 方案B（社区域专项）：community 5 连拆 —— bindRepoEvents/_storageSyncFn/bindBrowseEvents/createDownloadQueue/createProgressGuard
- 方案C（app-tree 全家桶）：树组件 4 连拆 —— bindTreeEvents/bindToolbarEvents/bindBusEvents/flattenVisible
- 方案D（3D 核心残余）：5 连拆 —— drawView/createYsmAnimPlayer/buildModelGroup/buildCubeMeshData/SceneRegistry
```

**AskUserQuestion 选项最多 4 项，用户选定进入下一步。**

### Step 4 — 查证解剖（并行可；不动代码只读）

对方案中每个目标文件做「结构快照」：

| 快照项 | 命令/动作 |
|--------|----------|
| 方法/闭包分布 | `Grep -n` 正则：`^\s+(?:export\s+)?(?:function|const|let|class)\s+(\w+)\|^\s+(?:private\|public\|protected)?\s*\w+\s*\([^)]*\)\s*[:{]` |
| 类 Web Component 生命周期 | 标出 constructor / connectedCallback / attributeChangedCallback / disconnectedCallback / render 各段行号范围 |
| 事件绑定型函数 | 按自然段编号：fetch-btn / edit-oninput / drag-sort / filter-apply 等域段 |
| 闭包清单 | 列出所有内联 `const fn = () => {}` 的**捕获变量表**（升格后需全参数化） |
| 消费方检查 | 若 export，`Grep -rn "import.*<名字>" frontend/src/` 列出调用处，**主函数签名必须原封不动** |

**产出**：每个文件写一段自然分段说明（类似 `bindEditEvents: 顶部fetch-btn + creators编辑+拖拽 + presetSearches编辑+同步 + github卡片过滤`）。

### Step 5 — 基线验证（主模型一手，留对照组）

**双门禁固定顺序，过滤本文件错 vs 其他同事遗留错**：

```powershell
# 1. 目标文件逐个过滤检查（0 条 = 干净）
cd frontend
npx tsc --noEmit --pretty false 2>&1 | Select-String "edit\.ts|app-tree|app-sidebar|app-nav"

# 2. 整仓 vite build（chunk size >500KB 警告忽略，属全局配置）
npx vite build 2>&1 | Select-Object -Last 10
```

**判定口径**：tsc 过滤后 0 条 + vite build `✓ built in Xs` = 基线通过。遗留错记在提交消息备注里，不背锅。

### Step 6 — 并行拆分（N 子代理并发，≤4 个最优）

**子代理数 = min(方案中文件数, 4)**。每子代理拿单文件，**严格委托 `ts-giant-function-surgery` 五步流水线**（查证→基线→分拆→双门禁）。

#### 子代理任务 Query 模板（复制即可用，改 `<占位符>`）

```
按 ts-giant-function-surgery 五步流水线拆 frontend/src/<相对路径> 的 <主函数/主类名>（<起始行>-<结束行>，<N>行）。
<自然分段描述，如：按事件域拆 7 段：fetch-btn/creators编辑+拖拽/presetSearches编辑+同步/github卡片过滤；或：类肥段集中在 render() 方法 L84-L266 183行，内3段长闭包升格>
目标：主函数 ≤70 行纯分派；主类方法每段 ≤ 原段行数 40%；最长子函数 ≤ 100 行；原签名不动。
改完自验：cd frontend ; npx tsc --noEmit --pretty false 2>&1 | Select-String "<文件名过滤>" 0 错 + npx vite build 全绿。
不要 commit，留主模型统一处理。返回：主函数/主类各段行数变化、抽了几个子函数/包级函数、命名前缀列表。
```

#### 命名前缀约定（防包级命名冲突，按文件/域统一）

| 文件/域 | 子函数前缀 | 类型提级接口前缀 |
|---------|-----------|----------------|
| site/edit.ts | `ee*`（edit-events） | `Ee*Shell` / `Ee*State` |
| app-sidebar | `asb*`（app-sidebar） | `Asb*Context` / `Asb*Flags` |
| app-nav | `an*`（app-nav） | `An*Deps` / `An*Shell` |
| app-tree | `at*`（app-tree） | `At*Row` / `At*SelState` |
| community/* | `cm*`（community） | `Cm*DownloadCtx` |
| 3d/model-*.ts | `md*`（model） | `Md*RenderState` |

### Step 7 — 双门禁总验（主模型一手，合并后必跑）

子代理全部交付后，主模型重新跑一次全集过滤 + vite build，**不要信任子代理各自的局部验证**（并行修改可能有 import 顺序或类型声明交叉污染）。

```powershell
cd frontend
npx tsc --noEmit --pretty false 2>&1 | Select-String "<文件A>\|<文件B>\|<文件C>\|<文件D>"
# 期望输出：空（0 条错误）

npx vite build 2>&1 | Select-Object -Last 6
# 期望输出：✓ built in <10s
```

**失败兜底**：
- 任一失败且 1 轮修复未过 → 暂停，让出错子代理回滚单文件重拆，不耽误其他已通过文件。
- 类型冲突跨文件 → 主模型仲裁，统一类型提级位置（优先放被双方 import 的文件，或放公共 `types/` 镜像声明）。

### Step 8 — 路径限定提交（主模型一手，串行 commit，禁止并行抢 index.lock）

**黄金动作**：单文件 = 单 commit，绝不多文件捆一起；并行 commit 会撞 `index.lock`，所以必须顺序串行。

#### 提交消息模板（中文，对齐历史 17 刀口径）

```
refactor(ui): 拆 <filebasename> <主函数A/主类B> 共 N 行→X主+Y子(≤M行/子) <闭包升格/类型提级/路由解耦/分段装配/键盘三段拆分>
```

例：
```
refactor(ui): 拆 app-sidebar/index.ts AppSidebar 403 行→_bindSyncSelected206行→壳3行+10asb*包级函数 2类型提级(AsbSidebarContext/AsbSyncFlags) push/pull菜单双百行闭包全升格(asbHandlePushMenuClick89行/asbHandlePullMenuClick53行)
```

#### Commit 顺序与锁保护

```powershell
# ✅ 正确：顺序串行（每 commit 间有 pre-commit 钩子生成时间隙）
git add frontend/src/views/X.ts ; git commit -m "..." -- frontend/src/views/X.ts
# → 等成功后再下一条
git add frontend/src/views/Y.ts ; git commit -m "..." -- frontend/src/views/Y.ts
# ...

# ❌ 错误：4 条并行 RunCommand → index.lock 冲突（第17刀A8初犯）
```

**路径限定的正确性验证**：`git show --stat HEAD` 只改了目标文件 + 少量 auto-generated `docs/knowledge/`（pre-commit 钩子同步生成物，属正常范围）。

---

## 2. 正式扫描器（Step 1 用，不需要写脚本）

**直接用 `scripts/line-counter.ts --funcs`，不写任何临时脚本**。它是全仓既有的正式肥膘扫描器（前端 TS/JS + Go 双栈），`--funcs` 模式输出 🟥/🟧/🟨 三档函数级清单，自动豁免生成文件与测试文件。

**关键参数**（对齐本流水线口径）：

```
--scope <路径>     限定扫描目录（默认 frontend/src + go）
--threshold <N>    黄档阈值，橙=2N / 红=3N（本流水线统一 N=80）
--json             输出 JSON（含 scannedFiles / counts / items，子代理或脚本化消费）
```

**本流水线标准调用**：

```powershell
# 全前端候选（🟨>80 🟧>160 🟥>240）
node scripts/line-counter.ts --funcs --scope frontend/src --threshold 80

# 按域收窄某个语义域
node scripts/line-counter.ts --funcs --scope frontend/src/preview-3d --threshold 80

# JSON 消费（主模型筛选方案时）
node scripts/line-counter.ts --funcs --scope frontend/src --threshold 80 --json
```

**已拆文件剔除**：line-counter 输出全量命中（不含已拆历史）。主模型对照 `git log --oneline -N --grep=refactor(ui)` 手动剔除已拆文件/函数，别依赖内嵌清单（易过期）。

**护栏截断说明**：命中项带组织简写若尾随 `[护栏截断]`，表示该函数体后紧跟同/上级顶层声明，行数为「下一个声明之前」的保守截断值——非精确体长，仅作分级锚点；确定为拆分目标后在 `#L起` 处用编辑器区间复核真实体长，不因护栏值误判「未超线」而放过。

---

## 3. 验收清单（一次完整批量清膘的交付物）

- [ ] Step1 `node scripts/line-counter.ts --funcs --scope ... --threshold 80` 已执行，候选清单 ≥ 方案中文件数
- [ ] Step2 三档分级表输出，🟥 档都落在方案里（或明确说明为何延后）
- [ ] Step3 AskUserQuestion 4 套方案，用户有明确选中记录
- [ ] Step4 每目标文件 1 份结构快照（方法分布+闭包清单+自然分段）
- [ ] Step5 基线验证：tsc 过滤 0 条 + vite build `✓ built in Xs` 截图/输出
- [ ] Step6 N 子代理并发交付：每子代理返回「行数变化+子函数数+命名前缀」，≤1轮修复
- [ ] Step7 双门禁总验：全集过滤 0 条 + vite build 二次通过
- [ ] Step8 N 条路径限定 commit，每条 `git show --stat HEAD` 只带目标文件 + 自动同步的 docs/knowledge

---

## 4. 与兄弟 Skill 的关系

| 下层 Skill | 分工边界 |
|-----------|---------|
| `ts-giant-function-surgery` | 单文件/单函数级，五步流水线（查证→基线→分拆→双门禁→提交），**本 Skill Step6 的每子代理直接调用它** |
| `巨函数解剖手术` | 跨语言（Go/TS/Node）通用父 Skill，跨层跨模块链用它 |

**组合规则**：
- 纯前端批量 → `frontend-batch-sweep`（本 Skill）编排，每子代理内走 `ts-giant-function-surgery`
- 单文件前端 → 直接 `ts-giant-function-surgery`，不启用本 Skill
- 跨前端+Go 批量 → 上层 `巨函数解剖手术`，内部 TS 段仍可复用本 Step1/2/6 逻辑
