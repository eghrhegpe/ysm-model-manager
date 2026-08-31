# ADR-087：AI 自动化取巧——pre-commit 智能 stage 与无脑指令下沉

- **状态**：✅ 已采纳
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-086`、`.githooks/pre-commit`、`scripts/check-knowledge-drift.mjs`

---

## 1. 背景（Context）

ADR-086 完成了**检查体系减负**（星级评定 + 职责去重 + AI 调用公约），但 AI 在**开发侧**的无脑指令仍依赖手动输入。以 15 分钟功能周期为单位计算：

| 指令类型 | 占比 | 典型 | 能否自动化 |
|----------|------|------|-----------|
| **无脑指令**（验证 + 状态） | ~30% | `git add` / `check-knowledge-drift --affected` / `git status --short` / `doctor --docs` | ✅ 可下沉 pre-commit |
| **思考指令**（探索 + 决策） | ~70% | `read` / `edit` / `grep` 定位 / `subagent` 委派 / `Select-String` 定向调查 | ❌ 不可替代 |

**核心判断**：只自动化「无脑」30%，让 AI 把宝贵的 15s/轮思考时机留给逻辑链，不替代思考本身。

**关键约束**：pre-commit 是秒级约束（实测 1-2s，目标 < 5s），不触碰阻断逻辑（阻断留给 pre-push，ADR-086 已确认）。

### 1.1 实测数据

| 操作 | 实测耗时 | 备注 |
|------|----------|------|
| 5 个 gen 脚本（docs-index + funcmap + knowledge-index + novel + project-map） | 1.0s | ADR-087 draft 估计 3-5s 偏保守 |
| `check-knowledge-drift --affected` 单文件 | 0.3s | 实测 2 张卡受影响 |
| `git diff --cached --name-only` | < 0.05s | 极快 |
| `git status --short` | < 0.05s | 极快 |

**当前 pre-commit 总耗时：~1-2s**，距 5s 预算有充足余量。

---

## 2. 决策（Decision）

### Take巧 #1：智能 stage（改源码 → 自动 stage 对应测试文件）

**规则**：当 `git diff --cached` 检测到新增/修改的 `.ts` 源码文件时，pre-commit 自动 stage 同目录/同名的 `.test.ts` / `.test.js`。

**实现位置**：`.githooks/pre-commit` gen 循环之后，`git add docs/` 之前。

**幂等保证**：`git add <file>` 对已 stage 文件无副作用（exit 0），已 test 文件被 stage 时 `git status` 无变化。

**防误 stage 守卫**：
- 仅当 `git diff --cached` 中**存在对应源码文件改动**时才 stage 测试文件
- 同名匹配规则：`foo.ts` ↔ `foo.test.ts`，`foo.ts` ↔ `foo.test.js`
- 已 stage 的测试文件不重复 stage（幂等）

**示例**：
```
用户: edit 修改 frontend/src/core/context-menus.ts
pre-commit:
  gen 脚本循环...
  [intelligent-stage] git add frontend/src/core/context-menus.test.ts
  git add docs/
  gofmt...
```

**收益**：消除「改了源码忘了 stage 测试」的低级错误；AI 少打一条 `git add`。

---

### Take巧 #2：drift --affected 秒级接入

**规则**：gen 脚本跑完后，取 `git diff --cached --name-only`（本次 stage 的文件），调用 `check-knowledge-drift.mjs --affected <files>`。

**输出**：stderr（非阻断），格式与 prepare-commit-msg 钩子一致（卡片 stem 列表）。

**实现位置**：`.githooks/pre-commit` gen 循环结束后、`git add docs/` 之前。

**性能**：
```
gen 循环:        ~1s（实测）
drift --affected: +0.3s（只扫变更文件相关卡，非全量）
取 diff 文件:    <0.05s
总增量:          +0.35s/commit
```

**收益**：每次 commit 自动知道「N 张卡受影响」，AI 不需要手动 `check-knowledge-drift --affected`。

**防误报守卫**：
- 过滤生成物文件（`docs/knowledge/index.md`、`docs/funcmap.md` 等 gen 脚本输出）
- 仅扫描实际源码/文档变更文件

---

### Take巧 #3：git status 摘要（commit 前预览）

**规则**：pre-commit 末尾 stderr 输出 `git status --short` 的最后 15 行（已 stage + 未 stage），非阻断。

**格式**：
```
[pre-commit] 当前 git status（提交前预览）:
M  docs/knowledge/model3d.md
 M frontend/src/core/context-menus.ts
?? frontend/src/utils/dom/capabilities.ts
```

**收益**：AI 不需要额外打 `git status --short` 看状态——commit 前的最后一次确认自动弹出来。

---

## 3. 与 ADR-086 的分工

| 维度 | ADR-086（检查减负） | ADR-087（git 自动化） |
|------|---------------------|----------------------|
| 关注点 | 33 个检查脚本的星级/去重 | pre-commit 扩展（+3 项） |
| 范围 | pre-push / doctor 调度 | pre-commit 钩子 |
| AI 指令减少 | AI 调用公约（防一轮打三次） | 智能 stage + drift 反馈 + status 摘要 |
| 决策性质 | 减负（删/降级/并行） | 赋能（加/自动化） |

---

## 4. 性能预算

```
当前 pre-commit 耗时:  ~1-2s（实测，10 个 gen 脚本）

Take巧 #1: 智能 stage
  git diff --cached:    <0.05s
  git add <files>:      <0.1s（平均 1-2 个文件）

Take巧 #2: drift --affected
  git diff --cached:    <0.05s
  drift 调用:           +0.3s

Take巧 #3: status 摘要
  git status --short:   <0.05s

总增量:                +0.45s/commit（从 1-2s → 1.5-2.5s）
目标上限:              < 5s（ADR-086 约束：pre-commit 秒级）

15 分钟功能周期内（~2-3 次 commit）:
  累计增量:             ~0.9-1.4s
  占功能周期:           <0.1%（从 900s 里扣）
```

---

## 5. 收益估算

> ⚠️ 以下为**认知成本估算**（把「敲命令 + 上下文切换 + 等待确认」折算成时间），**不是纯命令耗时**。纯命令耗时仅 <0.5s/commit；真正的收益在「免记忆 + 免切换」，量化为 25s/commit 属估算口径，不可与 ADR-086 §5.1.3 的性能账（纯耗时）直接相加。

| 指令 | 当前（手动） | 自动化后 | 节省/commit（估算） |
|------|------------|---------|--------------------|
| `git add` 测试文件 | 1-2 次 | 0（智能 stage） | ~5s（打字+思考） |
| `check-knowledge-drift --affected` | 1 次 | 0（pre-commit 自动跑） | ~10s（输入+等输出） |
| `git status --short` | 2-3 次 | 0（commit 时已出摘要） | ~10s（打字×2-3） |
| **合计** | **4-6 次** | **0** | **~25s/commit（估算）** |

按 2-3 次 commit/15 分钟周期：节省 **~50-75s（估算）** 的无脑输入 + 上下文切换时间，留给思考逻辑链。

---

## 6. 后果（Consequences）

**正面**：
- AI 每次 commit 自动收到「N 张卡受影响」反馈 + 当前 status 预览，无需额外打指令
- 「改源码忘 stage 测试」从人工记忆变成机械保证
- pre-commit 从「10 个 gen 脚本」升级为「gen + drift + stage + status」四合一

**负面 / 风险**：
- 🟡 **智能 stage 误 stage**：如果 `.test.ts` 文件存在但本次未改源码（旧测试文件），会被错误 stage。翻转条件：`git diff --cached` 中**必须同时存在对应源码文件的改动**（同目录 + 同名 + `.ts`/`.js` 前缀），才 stage 其测试文件。
- 🟡 **drift --affected 误报**：如果 gen 脚本本身改动了 knowledge 卡（如 `gen-knowledge-index` 更新了 `index.md`），这些变更在 `git diff --cached` 中会出现，drift 会提示「index.md 改动影响所有卡」。翻转条件：drift 的 input 过滤 `docs/knowledge/index.md`（生成物，pre-commit 自身产物）。
- 🟢 **Take巧 #3** 纯输出层改造，无行为风险

---

## 7. 实现计划

### T1：智能 stage（~15 行 shell）

```sh
# 在 gen 循环之后、git add docs/ 之前插入
echo "[pre-commit] 智能 stage 测试文件..."
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM -- '*.ts' '*.js' 2>/dev/null || true)
if [ -n "$STAGED_TS" ]; then
  STAGED_TESTS=""
  for f in $STAGED_TS; do
    # 找同名 .test.ts / .test.js
    base="${f%.ts}"; base="${base%.js}"
    for ext in ".test.ts" ".test.js"; do
      candidate="${base}${ext}"
      if [ -f "$candidate" ]; then
        STAGED_TESTS="$STAGED_TESTS $candidate"
      fi
    done
  done
  if [ -n "$STAGED_TESTS" ]; then
    git add $STAGED_TESTS
    echo "[pre-commit] ✅ 智能 stage: $STAGED_TESTS"
  fi
fi
```

### T2：drift --affected（~10 行 shell）

```sh
# 在 gen 循环结束后、智能 stage 之前插入
echo "[pre-commit] drift 检查受影响知识卡..."
CHANGED_FILES=$(git diff --cached --name-only 2>/dev/null || true)
if [ -n "$CHANGED_FILES" ]; then
  # 过滤生成物
  FILTERED=$(printf '%s\n' "$CHANGED_FILES" | grep -v '^docs/knowledge/index.md$' | grep -v '^docs/funcmap.md$' | grep -v '^docs/project-map.md$' | grep -v '^frontend/public/locales/' || true)
  if [ -n "$FILTERED" ]; then
    # 批量调用：一次 node 进程 + 一次索引构建（~0.3s）
    node scripts/check-knowledge-drift.mjs --affected $FILTERED 2>&1 || echo "⚠️  drift 检查失败（不阻断）"
  fi
fi
```

### T3：status 摘要（~5 行 shell）

```sh
# 在 pre-commit 末尾插入（exit 0 之前）
echo ""
echo "[pre-commit] 当前 git status（提交前预览）:"
git status --short 2>/dev/null | tail -15 || true
```

---

## 7.5 落地确认（2026-08-17 补充）

### 已落地

| 项 | 状态 | 实现位置 | 实测 |
|----|------|---------|------|
| T1 智能 stage | ✅ | `.githooks/pre-commit`（gen 循环后、gofmt 前） | +0.1s/commit |
| T2 drift --affected | ✅ | `.githooks/pre-commit`（gen 循环后、智能 stage 前） | +0.3s/commit |
| T3 status 摘要 | ✅ | `.githooks/pre-commit` 末尾 | +0.05s/commit |
| pre-commit 合计 | ✅ | — | ~1.5s（预算 5s 内） |

### 指令节省实证（ADR-086 §5.1 真实指令审计）

3D 菜单重构轮实测：`git add` 测试文件 / `check-knowledge-drift --affected` / `git status --short` 三类无脑指令从 **4-6 次/功能 → 0**；pre-commit 自动输出「智能 stage ✅」「drift 受影响卡」「status 预览」，AI 不再需要为这三类事打指令。

### 翻转条件保持待命

- pre-commit 总耗时 > 5s → 回退 T1/T2 只留 T3（当前 1.5s，远未触发）
- 智能 stage 误 stage 率 > 10%（月度统计）→ 收紧匹配规则
- drift --affected 误报率 > 20% → 收紧过滤规则

---

## 8. 数据溯源

- 用户「是不是该参与门禁 adr 讨论了」→ 摸底 pre-push-gate / pre-commit / domain-classify 三层现状 → 识别「无脑 30% vs 思考 70%」边界 → 起草 3 个 Take巧
- ADR-086 已落地：检查体系星级 + 重叠对 + AI 调用公约（防一轮打三次）——ADR-087 聚焦其未覆盖的 git hook 侧
- 性能预算来源：实测 gen 脚本 1s + drift --affected 0.3s + git diff/status < 0.1s
- ADR-086 §2.3 明确「pre-commit 秒级文档同步」保留——本 ADR 在其上扩展，不改动原有 gen 脚本
- 补充：T1/T2/T3 已写入 `.githooks/pre-commit` 并实测（见 §9 待办表）；ADR-086 §5.1 的真实指令审计确认「候选池 N1-N6 边际收益低，不建议继续加 hook」

---

## 9. 待办（按序推进）

| 项 | 描述 | 优先级 | 状态 |
|----|------|--------|------|
| T1 | 修改 `.githooks/pre-commit`：gen 循环后加智能 stage | P1 | ✅ 已落地 |
| T2 | 修改 `.githooks/pre-commit`：gen 循环后加 drift --affected | P1 | ✅ 已落地 |
| T3 | 修改 `.githooks/pre-commit`：末尾加 status 摘要 | P2 | ✅ 已落地 |
| T4 | 若 pre-commit 超 5s，回退非阻断部分 | P3（翻转条件） | ⏸️ 待命（当前 1.5s） |

---

## 10. 翻转正则

| 条件 | 动作 |
|------|------|
| pre-commit 总耗时 > 5s | 回退 T1/T2，只保留 T3 |
| 智能 stage 误 stage 率 > 10%（月度统计） | 收紧匹配规则或移除 T1 |
| drift --affected 误报率 > 20%（月度统计） | 收紧过滤规则或移除 T2 |

---

## 11. 锐评反馈（子代理独立审计，2026-08-17）

> 子代理独立锐评（不接触本 ADR 正文），从架构师角度审视 T1/T2/T3 设计。
> 来源：用户「放个子代理探索并锐评这个改动」→ 派独立 subagent 读 ADR-087 + pre-push-gate + pre-commit 三层现状 → 输出锐评报告。

### 11.1 判定摘要

| Take巧 | 判定 | 核心理由 |
|--------|------|---------|
| #1 智能 stage | ✅ **保留**（小缝，Windows 路径分隔符） | 幂等保证成立；防误 stage 守卫（`git diff --cached` 中必须有对应源码改动）已设计 |
| #2 drift --affected | ⚠️ **已修**（逐文件循环→批量 + `head -20` SIGPIPE） | 见 11.2 修复记录 |
| #3 status 摘要 | ⚠️ **已改**（`status --short`→`diff --cached --stat`） | 见 11.3 修复记录 |

### 11.2 T2 修复：逐文件循环 → 批量调用

**原实现（有 2 个 bug）**：
```sh
printf '%s\n' "$FILTERED" | while IFS= read -r f; do
  node scripts/check-knowledge-drift.mjs --affected "$f" 2>&1 | head -20
done
```

**Bug 1 — 逐文件循环**：每次调用启动新 Node.js 进程 + 重建知识卡索引（O(n) × m），10 文件 ≈ 3s。
**Bug 2 — `head -20` 截断**：Node.js 输出 >20 行时触发 SIGPIPE（exit 141），外层 `|| echo "⚠️ 失败"` 误报；且第 21 行起的真正 ERROR 被静默丢弃。

**修复后**：
```sh
node scripts/check-knowledge-drift.mjs --affected $FILTERED 2>&1 || echo "⚠️  drift 检查失败（不阻断）"
```

- 单次 Node.js 进程 + 单次索引构建（0.3s）
- 输出完整 stderr（含全部 ERROR/WARN），无 SIGPIPE

### 11.3 T3 修复：status 摘要 → diff --cached --stat

**原实现**：
```sh
git status --short 2>/dev/null | tail -15
```

**问题**：`status` 显示整个工作区状态（含未 stage 噪音），而 pre-commit 在 commit 前运行，AI 真正需要的是「本次 commit 包含什么」。

**修复后**：
```sh
git diff --cached --stat 2>/dev/null | tail -10 || true
```

直接显示 staged 文件的变更统计（行数增删），与本次 commit 内容直接对应。

### 11.4 未采纳建议

| 建议 | 判定 | 理由 |
|------|------|------|
| Take巧 #4：`git diff --cached --stat` 预览 | ✅ 采纳 | 见 11.3 |
| Take巧 #5：drift 加 `--quiet` 模式 | ❌ 不采纳 | `--quiet` 仅输出 stem 列表，丢失 ERROR/WARN 详情，对 AI 不如完整输出有用 |
| Take巧 #6：commit 后 SHA 确认 | ❌ 不采纳 | 与 `prepare-commit-msg` 钩子的 commit message 回显重叠，且 pre-commit 在 commit 前运行，看不到 SHA |
| Windows 路径分隔符归一化 | ⚠️ 观察 | 当前 `git diff --name-only` 在 Windows Git Bash 下输出 `/` 分隔符（MinGit 默认），暂未发现问题；若出现异常再添加 `tr '\\' '/'` |

---

## 12. 翻转正则（修订版）

| 条件 | 动作 |
|------|------|
| pre-commit 总耗时 > 5s | 回退 T1/T2，只保留 T3 |
| 智能 stage 误 stage 率 > 10%（月度统计） | 收紧匹配规则或移除 T1 |
| drift --affected 误报率 > 20%（月度统计） | 收紧过滤规则或移除 T2 |
| pre-commit 输出 >50 行 | 截断为 30 行 + `[...] N 行省略`（防终端刷屏，但不丢 ERROR） |
