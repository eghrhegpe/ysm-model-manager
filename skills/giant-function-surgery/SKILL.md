---
name: "巨函数解剖手术"
description: "按五步流水线重构超长函数：查证→基线→分拆→双包验→提交。触发：函数>100行/多闭包内联/用户要求拆超长函数时。"
---

# 巨函数解剖手术（Giant Function Surgery）

本 Skill 固化《YSM 模型管理器》项目八刀累计沉淀的「长函数→主+子小函数」重构范式。适用于 Go/TS/Node 等任意带包/模块系统的源码树，**严禁改变任何运行时行为**，仅做等价的结构提纯。

---

## 0. 触发条件

满足任一即启用本 Skill：
- 单文件中单函数**超过 100 行**（LoC 含注释与空行，`(Get-Content file | Measure-Object -Line)` 统计）
- 函数体内**闭包 ≥2 个**或**内嵌匿名 struct ≥2 个**
- 单一函数体内混合了 ≥3 个语义阶段（例如：IO→解析→排序→回写 挤在一个函数）
- 用户明确说「拆 xxx 函数 / 重构巨函数 / 精简长函数」

---

## 1. 五步流水线（必走，无捷径）

### Step 1 — 查证与解剖（不动手，只摸底）
> 🐋 查证优先——不凭记忆写边界。

**动作清单：**
1. 用 `Glob pattern` 或 `Grep -n "^func " file` 锁定函数所在文件与起始行号。
2. `Read` 读取目标函数完整上下文，**自算起止行数**（函数名下一行 → 闭合 `}` 的上一行）。
3. 手工标注**自然分段**：格式分支 / 解析阶段 / I/O 调用 / 副作用边界 / 循环体 / 错误处理。分段 ≥5 个就需要画括号图。
4. **查复用：** `Grep -rn "相同逻辑片段" 相关包`，确认已拆的兄弟包（如 `ysm/extracted.go` 的 helper）有没有能直接搬运的。⚠️ 跨包存在 import cycle 时，**镜像实现而不是 import**（如 geometry 包的 texSlot 逻辑不能直接引 ysm）。
5. 查 fixture：`tests/` 或 `*/testdata/` 下是否有同名用例的测试数据，这是改完即验的生命线。

**产出：** TodoWrite 拆成 `(1解剖, 2基线, 3分拆, 4验证, 5提交)` 五段任务树，分拆段再按函数粒度下钻。

### Step 2 — 跑基线（留对照组）
> 🐋 先写测试再动刀（TDD 精神），已有测试先跑绿证明测试框架本身没病。

**动作清单：**
1. `go build ./go/<pkgA>/ ./go/<pkgB>/` 编译通过（涉及的包**至少** 2 个：改动包 + 消费包）。
2. `go test ./go/<pkgA>/ ./go/<pkgB>/ -timeout 120s` 跑相关包测试，记录用时（识别 flaky）。
3. 前端改动：`cd frontend && npm run typecheck && npx vite build` 走双门禁。
4. 任一失败→**停下不动**，先修基线（失败原因不在改动范围时，报告主模型决定）。

### Step 3 — 自然边界分拆（核心手术）
> 🐋 按职责拆，不按行数硬切；每子函数**只做一件事**。

**拆分模式优先级：**
| 模式 | 适用场景 | 子函数命名口径 |
|---|---|---|
| ① 按阶段 | 长函数内先做 A 再做 B 再做 C（流水线） | `buildXXXFromYYY / appendZZZ / detectNNN` |
| ② 闭包升格 | 原函数内嵌套 `func()`（尤其是捕获外部循环变量的） | 把闭包参数量化，提为包级函数，必要时把 `type X struct` 一并提级 |
| ③ 类型提级 | 函数内匿名 `type foo struct{}` 被 2+ 个闭包共享 | 提为包级导出/非导出类型，放原函数声明正上方 |
| ④ 循环提纯 | WalkDir/forEach 回调体 >30 行 | 拆 `processXXEntry`，返回 (result, skip, error) 三态；原回调只做 glue |
| ⑤ 分支镜像 | `if a {...20行...} else {...20行...}` 两个分支高度对称 | 抽 `handleA / handleB` 双子函数，条件判断留在主函数 |

**黄金约束（红线，不可破）：**
- 🚫 **严禁触碰语义**：已有的 `goto retry / return error / panic` 路径原封不动保留在主函数
- 🚫 **严禁变更排序行为**：`sort.SliceStable` / `sort.Slice` 的选择不动，map 遍历引入不确定性时必须 `sort.XXX` 定序
- 🚫 **循环依赖避坑**：需要跨包复用 helper 时，**在本包内镜像实现**同名函数（参数签名可略简化），不新增 `import "ysm-model-manager/go/A"` 导致 A→B→A 循环
- 🚫 **不引入新依赖**：所有子函数只用原函数已经 import 的包

**主函数瘦身目标：** 原 150+ 行 → 主函数≤60 行；每子函数 ≤ 目标原函数行数的 40%。

### Step 4 — 双包编译验证（每步至少 2 次）
> 🐋 改完立刻验，拆完一个函数验一次，别攒到最后攒雷。

**改动完每个子函数后：**
1. `go build ./go/<改动包>/` 即时编译（语法错误即时发现）。
2. **全部拆完后** → 跑 `go build ./go/<A>/ ./go/<B>/` 跨包编译（消费包引用变更要过）。
3. `go test ./go/<A>/ ./go/<B>/ -timeout 120s` 全绿。前端走 `typecheck + vite build`。
4. 任一失败**仅 1 轮修复**仍不过→暂停，向主模型报告（符合 AGENTS.md 损害控制条款）。

### Step 5 — 路径限定提交（单步单 Commit）
> 🐋 每刀一刀一提交，动了多少文件就只提交那些，绝不把平行工作混进同一个提交。

**动作清单：**
1. `git add <只动了的源码文件>` — 生成物（docs/funcmap.md 等）由 pre-commit 自动 gen+stage，你不手动加也不手动删。
2. Commit 消息模板：
   ```
   refactor(<包名>): 拆 <主函数A/主函数B/主函数C> 共 N 行→X主+Y子(≤M行/子) <闭包升格/类型提级/循环提纯等核心动作>
   ```
   例：`refactor(scanner): 拆 scanner.go 三巨 ScanEntriesWithHit/ScanLocalAuthors/GenerateRepoIndex 共 287 行→3主+9子(≤70行/子) walk闭包升格+indexEntry类型提级`
3. `git commit -m "<msg>" -- <源码文件路径...>`（路径限定，平行会话活跃时尤其关键）。
4. pre-push 全门禁留到多刀完成后统一触发，单刀完成时**不主动 push**。

---

## 2. 典型错误与修复（踩坑速查）

| 错误类型 | 根因 | 修复 |
|---|---|---|
| 编译 `undefined: xxxType` | 闭包升格时误发明了新类型名（把 `playerTex` 写成 `ysmTexEntry`） | `Grep` 原包内实际定义，以源码为准 |
| 测试 `跨平台路径不匹配` | Unix 写死绝对路径，Windows `filepath.IsAbs` 返回 false | 测试内动态 `filepath.Abs + filepath.ToSlash` 构造期望 |
| 双包编译 `import cycle` | geometry 新增 `import .../ysm` 或反过来 | 本包内镜像实现 helper，参数按最小必要集裁剪 |
| pre-push `doc drift` | 知识卡未跟新动改动同步 | `node scripts/check-knowledge-drift.mjs --affected` 列出受影响卡，读卡正文同步 |

---

## 3. 本项目特殊约定（AGENTS.md 重申）

- Go 包改动 → 验证：`go build ./go/<pkg>/` + `go test ./go/<pkg> ./go/ysm/ -timeout 120s`（ysm 是全量消费侧哨兵包）。
- 前端改动 → 验证：`cd frontend && npm run typecheck && npx vite build`。
- 文档改动 → 轻量验证：`node scripts/doctor.mjs --docs`（秒级）。
- 临时回退：`git commit -m "tmp: ..."` + `git reset --soft HEAD~1`，**不用 git stash**。
- 逃生阀：`git commit --no-verify` 跳 commit 钩子；`YSM_SKIP_GATE=1 git push` 连 pre-push 一起跳（仅限紧急合并，事后补 doctor）。

---

## 4. 一次完整手术的预期产物（可核对清单）

- [ ] TodoWrite 任务树：1 解剖 + 1 基线 + N 拆分 + 1 验证提交，共 ≥4 段 todo
- [ ] 改动源码文件 ≤ N（目标函数所在单一文件为最佳；多文件改动必须各自提供独立边界说明）
- [ ] 主函数行数：原行数的 30%~50%
- [ ] 子函数个数：≥ceil(原行数/40)
- [ ] 最长子函数行数：≤原行数的 40%，且 ≤80 行（walk 回调可放宽到 100）
- [ ] go build + 双包 test：全绿，无 warning
- [ ] 路径限定 commit 一条，msg 包含包、函数、原行数、拆后结构、核心手法五项
