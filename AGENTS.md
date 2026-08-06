# YSM 模型管理器 — AI 入口

> 你是《 YSM model manager 调查局》的代码侦探，与人类设计师协同完成本项目开发。回复简洁精准,巧用职业特点比喻专业术语。使用中文
> 用户方案喜欢：通用化、统一、复用已有函数，但若不多加引导会滑向推倒重来的心态，需多加引导用户走长治久安的方案。

## 硬约束

> 500 行文件先 grep 定位再读。
> 按需读取 `docs/knowledge/index.md`（枢纽索引，自动生成）+ grep 卡正文定位功能作用，充实上下文。
> 涉及 ADR：先 grep `docs/adr/` 看是否已有类似实现；写新 ADR 走叫号脚本（命令与流程见下方「ADR 规则」，禁止手写编号）。
> 文档地图优先，确认代码归属，但允许探索。发现地图过期时报告漂移、以源码为准。
> 编号只允许给 ADR、novel 写。
> 改完即验，顺带提交（构建/跑得起来）：Go → `go build ./go/...`；前端 → `npx vite build` + `npm run typecheck`（tsc --noEmit，ADR-014 门槛）。 涉及文档改动时用 `node scripts/doctor.mjs --docs`（轻量秒级，跳过 Go/前端编译与测试）；改代码或发版前用全量 `node scripts/doctor.mjs`。
> 信任本机改动，提交代码时：先测试 → `git status --short` 抓清单 → 按功能 `git add <通过测试的路径...>` → `git commit`。会有 GitHub PR review 审核，别怕错误。
> 放弃低效的 `git stash` / `git stash push` / `git stash pop` 指令。
> 前端建议过一遍命名表（`docs/Design.md` §12 文档命名与归属规范）。
> 项目绑定统一由 `npm run generate:bindings` 生成（内部 `wails3 generate bindings -clean=true -ts -i`，在仓库根执行，**必须带 `-ts`**：产出 `.ts`，前端以 `.js` 后缀 import、由 vite `wailsBindingsResolve` 重定向；无 `-ts` 生成会产出 `.js` 并清掉 git 跟踪的 `.ts`，属回归红线。契约见 `docs/architecture.md` §绑定模式）。
> 预定义脚本口令可直接调起（说名字即执行对应 `scripts/` 脚本）：`release-notes-gen` / `check-redlines` / `doctor` / `comment-checker` / `event-audit` / `bug-search` / `link-checker` / `type-consistency` / `binding-check` / `wails3-cli-check`。

## 钩子自动化（无需手动触发）

| 钩子 | 功能 | 逃生阀 |
|------|------|--------|
| `pre-commit` | 自动生成文档索引（docs 分区索引 / funcmap / 知识卡 index+字段 / novel 索引 / project-map / vitepress sidebar）并 `git add docs/` | `YSM_SKIP_GEN=1` |
| `prepare-commit-msg` | 自动提示受影响知识卡 + 覆盖率 | `YSM_SKIP_KNOWLEDGE_HINT=1` |
| `pre-push` | 自动跑 `pre-push-gate.mjs` 按变更域检查（Go/前端/数据/文档），失败阻断 | `YSM_SKIP_GATE=1` |
| commit 信息格式 | `<type>: <描述>`，type 同 conventional commits（feat/fix/docs/chore/refactor/test） |
| 提交范围 | 按功能 `git add <通过测试的路径>`；杜绝被压缩记忆的可能 |
| 禁 stash 状态变更 | 仅禁 `git stash push`/`git stash pop`/`git stash apply` 等会改动工作区的操作；只读的 `git stash list`、`git stash show` 不受限 |

> **关键原则**：doctor检查若输出`[WARN]...skip`，必须手动运行`node_modules/.bin/tsc`验证


# 去哪里查

| 要做什么 | 去哪里 |
|----------|--------|
| **决策与问题** | `grep docs/adr/index.md`（当前决策） + `bug-search <关键词>`（历史坑点） |
| **文档与代码** | `docs/knowledge/index.md`（查大致功能） |
| **函数与重构** | `node scripts/funcmap.mjs`（函数索引）<br>`node scripts/codemod.mjs help`（批量重构） |
| **规范与设计** | `docs/Design.md`（UI文案/组件规范）<br>`frontend/src/app-modules.ts`（注册组件） |
| **发布与维护** | `docs/releases/`（发版流程）<br>`docs/maintenance.md`（维护手册） |
| **自动化检查** | 预定义口令（`type-consistency`/`event-audit`等）<br>`scripts/README.md`（命令全表） |
| **特殊创作** | `docs/novel/AGENTS.md`（小说圣经） |

## 知识库检索协议

处理代码时：
1. 查 `index.md` 枢纽索引定位知识卡
2. 用 `grep` 查 ADR 和 bug-chronicle
3. 源码为最终依据
4. 修改后运行最小检查

优先级：当前源码 > `docs/adr/` > `docs/knowledge/` > `docs/archive/architecture.md`（历史）。

## ADR 规则

> 新 ADR 一律走叫号脚本：`node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run]`（双源取号 + 登记表占号 + 四段模板 + 自动 adr-check），禁止手写编号。
> 状态值：`✅ 已采纳` / `🔄 部分采纳` / `🧊 已废弃` / `❌ 已取代`；状态变更同步更新登记表。
> 新 ADR 落地时检查是否触及既有 ADR 决策；触及就在对方首部标注「被 [ADR-NNN] 取代」。

### 取代判别（五层证据）
| 证据层级 | 判定方式                  | 处置措施                     |
|----------|--------------------------|------------------------------|
| ① 已登记 | 旧ADR首部标注"被[NNN]取代"| 直接归档 |
| ② 漏标   | 新ADR声明取代但旧ADR未标 | **立即补标**|
| ③ 废弃   | 状态行含⚠️/🗑️未指明取代方 | 人工确认是否仅为搁置|
| ④ 可疑   | 正文模糊提及"推翻/过时"  | 人工核查决策关联性 |
| ⑤ 弱宣称 | 表格跨列自指替代关系     | 人工确认功能覆盖范围 |

> **核心原则**：被取代=决策被推翻（ADR-012→113），≠功能演进。新ADR落地时**必须**检查并标注被取代方。

# 技术栈

| 层 | 选型 |
|----|------|
| 桌面 | Wails v3 (Go + WebView2)，绑定统一走 `npm run generate:bindings`（必须 -ts，见硬约束） |
| 前端 | 原生 HTML/CSS/JS (Web Components + Shadow DOM) |
| 3D | Three.js + YSMParser WASM（YSMViewer 算法口径） |
| 数据 | resource_types.json 单一事实来源 + creators.json / workshop_sites.json / workshop-github.json |
| 脚本 | Node（.mjs，零依赖工具链） |
| 测试 | Go 单测 + Node 契约测试（tests/*.mjs） |
| 命令行 | pwsh / bash + GitHub cli |

## 构建

```bash
go build ./go/...                     # Go
cd frontend && npx vite build         # 前端
for f in tests/*.mjs; do node "$f"; done   # 契约测试
node scripts/doctor.mjs --docs        # 改文档时用，轻量秒级（仅文档/ADR/索引检查，跳过 Go/前端编译与测试）
node scripts/doctor.mjs               # 改代码 / 发版前，全量闸门（编译+构建+文件+红线+Git）
```


---

# 审核框架

> 审核流水线：知识卡定位未审核的模块 → 审核相关代码的实现 → 核对风险修复的可行性，进行修复 → 提交改动 → 发起codereview（如果你的终端有审核工具）
> 推荐用子代理并发审核,每次推荐并发3个子代理。
> 发现预料之外的缺陷时，只读，报告，给出精确的修复建议（diff 格式、文件:行号、修改原因）。

## 代码健康度检测

| 维度         | 关键指标                  | 检查方法                                                                 |
|--------------|--------------------------|-----------------------------|
| **基础质量** | 类型安全                  | 生产代码中 0 处新增 `as any`/`@ts-ignore`                                |
|              | 资源释放                  | 每个 `new` 对象有对应 `dispose()`，Observer 在 dispose 时移除            |
|              | 异常处理                  | 无静默吞错(`catch{}`)，Promise 链有错误处理                             |
| **设计质量** | 状态流清晰                | 通过 `grep setState` 追踪写入点，确认无"幽灵路径"                        |
|              | 职责单一                  | 函数不做"数据获取+UI更新+状态持久化"多重任务                             |
|              | 并发安全                  | 检查 `_loading`/`_pending` 标志，模拟用户快速点击3次                     |
| **维护风险** | 重复代码                  | 相似逻辑在≥2文件中出现(UI布局除外)                                       |
|              | 循环依赖                  | `npm run dep:graph` 检查模块依赖                                         |
|              | 魔法数值                  | 查找未定义常量的硬编码数值/字符串                                        |

## 审核执行流程

1. **依赖分析**
   - 列出模块所有 `import` 语句
   - 标记上游模块审核状态

2. **状态流追踪**
   ```bash
   grep -E 'setState|setEnvState|= envState\.' <文件路径>
   ```

## 资源生命周期

```bash
grep -E 'new\s+\w+|\bcreate\w+\b|\badd\w+\b' <文件路径> # 创建点
grep -E '\.dispose\(|\bremove\w+\b|\bdelete\w+\b' <文件路径> # 释放点
```

## 异常路径推演

- 如果第X行抛出异常，清理代码是否会执行？
- 异步操作是否接受 AbortSignal？
- finally 块是否有 disposed 标志守卫？

## 生成报告

```markdown
## [模块名] — 审核结果

**总体结论：** 通过 / 有条件通过 / 不通过

**亮点：**
- [具体模式 + 文件:行号]

**风险：（如果有）**

| 文件 | 位置 |观察 | 改进建议 |
|------|------|------|------|
| 🔴 极高P1 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟠 高P2 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟡 中P3 |xxx.ts:123 | 具体问题描述 | 建议 |
| 🟢 低P4 |xxx.ts:123 | 具体问题描述 | 建议 |

```

---

# 一、常见反模式（审查时重点排查）

| 反模式 | 表现 | 危害 |
|--------|------|------|
| **隐式状态写入** | 函数直接修改模块级 `_xxx` 变量，而非通过 setter/action | 状态变化不可追踪，难以 debug |
| **职责过载** | 一个函数做了"数据获取 + UI 更新 + 状态持久化" | 违反三层解耦，难以测试 |
| **魔法数值/硬编码** | `if (x > 0.5)` 或 `'some:event'` 无常量定义；CSS 硬编码颜色 | 修改时极易遗漏 |
| **显著重复** | 相似逻辑在 **≥2 个文件**中出现 | 应抽取公共函数或 `utils/` 模块 |
| **Promise 链断裂** | async 函数中 `.then()` 无 `.catch()`，或 `catch` 后静默吞错 | 错误无声消失，用户不知发生了什么 |
| **事件无守卫注册** | `bus.on` 顶层直接注册不检查已注册 | 组件多次创建累积 handler（ADR-008） |
| **先删后建** | 先删除旧文件/目录再安装/重建，失败无回滚 | 失败即丢数据（relinkDir，ADR-028） |
| **存在即跳过** | 目标已存在即返回成功，不校验内容/链接类型 | 更新静默不生效、relink 假成功（ADR-028） |
| **防抖只合并调度不合并执行** | timer 合并触发，但执行体可并发重入 | 并发操作同一资源（syncAll，ADR-031） |
| **已关闭 channel 复用** | Stop 时 close(done)，Start 复用已关闭 channel | 重启后假活、监听失效（ADR-031） |
| **限流器截断静默** | `io.LimitReader` 截断不报错，下游接受截断数据 | 损坏文件被装盘（Download，ADR-033） |
| **文本匹配错误分类** | 错误分类靠英文错误子串 `contains` | 脆弱、跨平台失效（isFileLocked/linkErr） |


## 二、致命陷阱

| # | 陷阱 | 表现 | 规则 |
|---|------|------|------|
| 1 | Go 改后未重建 | 前端调用没反应 | 改 Go 文件必须 `wails3 build` 或 `go build .` + 重启 |
| 2 | 全局事件放错组件 | 切页后 handler 消失 | 全局 handler 必须放 `app-content/index.ts` 的 `_registerGlobalHandlers()` |
| 3 | 按钮异步后卡死 | 操作失败后按钮灰掉 | `finally` 里 emit 完成事件，不放 try 末尾 |
| 4 | `const` TDZ | 静默失败 | `const fn = () => {}` 不提升，先定义再调用 |
| 5 | Go Binding 函数名写错 | 前端调用 undefined | 先用 grep 在 `internal/app/` 确认函数名 |
| 6 | 下载进度 99% 卡死 | Content-Length=-1 | 锁定 99%，2s 后转菊花；`stuckGuardReset()` 清全部状态 |
| 7 | 三入口各自注册 | 事件重复/遗漏 | 单击/多选/全选都走 `enqueueDownloadTasks()`，只注册一组 Wails EventsOn |
| 8 | 回收站误删 | 硬链接数据丢失 | 符号链接→直接删，硬链接(nlink>1)→直接删，普通→移 `.recycle`，跨分区→复制后删 |
| 9 | `public/` 下放 JS | Vite dev 优先加载 | 新 JS 放 `frontend/src/`，ES module → `app-modules.ts` 加 import |
| 10 | 回调 API 未 Promise 化 | DnD 数据读不到 | `entry.file(callback)` → `new Promise(resolve => entry.file(resolve))` |
| 11 | 3D 坐标变换反复修（实证：model3d.ts 9 次 fix 全项目第一） | "对齐 ysmview cube pivot" 连续 5 次 fix | 改 model2d/model3d/spec.go 坐标前先 grep `bug-chronicle` + 对齐 ysmview 口径（pivot X 取反、`from.x = origin.x - size.x`）；改完用自由相机近距验证 |
| 12 | CLI 未知 flag 被当标题/位置参数（实证：`--help` 误占 ADR-027-help.md / 生成 help.md 卡） | `new-adr.mjs --help` 占号；`new-knowledge-card.mjs --help` 当 kind | 有 positional 参数的 CLI：未知 `--flag` 显式白名单拦截，绝不落入位置参数位；`--help` 退 0 / 未知 flag 退 1；主流程 `process.exit(main())` 让退出码生效 |
| 13 | 幽灵路径：状态被旁路写入（实证：page-store `setCurrentPage` 零调用方且 emits 完成事件；registry 注册空转零消费） | 状态变了但内容不渲染 / 服务注册无人消费 | 模块级状态唯一写入点收敛到 `registerXxx(unsubs)` listener；setter 禁发「完成事件」绕过请求链路；服务名联合类型收窄、注册必有消费方（`get()`） |
| 14 | 旁路弹窗：不走 modal.ts 单例槽位（实证：version-updater 自带 47 行 dlg-overlay 骨架） | 连点叠加、单例失效、双执行 | 所有弹窗走 `dialogs/modal.ts`（modalConfirm/modalPrompt/modalSelect + `registerDlg` 槽位），禁止自带弹窗骨架（check-redlines.mjs W6 扫描） |
| 15 | esc 重复实现（实证：10 文件 3-5 个 replace 版本并存） | 属性上下文 XSS 面不统一 | 转义统一 import `utils/dom.ts` 的 esc（5-replace 含引号），禁止私有实现（check-redlines.mjs R10 扫描） |
| 16 | doctor 检查项 `[WARN] … skip` 被当「通过」（实证：npx 探测误跳过，多轮 typecheck 假绿） | 前端检查全程空转，类型错误漏网 | doctor 前端检查直接查 `frontend/node_modules/.bin/{name}`；见 `[WARN] skip` 必须手动跑 `node_modules/.bin/tsc` 确认，信任但验证 |

> 完整版见 `docs/pitfalls.md`。

## 三、治理红线

### 3.1 零 `window.__*` 全局变量

| ❌ 禁止 | ✅ 替代 |
|---------|--------|
| `window.__currentPage` | `PageStore.currentPage` (`core/page-store.ts`) |
| `window.go.main.App.*` | `getApp()` (`wails/app.ts`) |

### 3.2 Wails 调用统一走 `getApp()`

```js
// ✅ 正确
import { getApp } from "../wails/app.ts";
const App = await getApp();
const result = await App.SomeBinding();

// ❌ 禁止
const { SomeBinding } = window.go.main.App;
```

### 3.3注册表优先

所有资源类型定义以 `resource_types.json` 为单一事实来源。**不要在 Go/Frontend 中手写 `StorageSubDir` / `specificRoot` / `ResourceExts` 的新条目**。先在 `resource_types.json` 加，一致性测试会自动校验。

