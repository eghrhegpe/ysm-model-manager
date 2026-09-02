---
kind: commit-with-check
name: 提交脚本 commit-with-check
tier: architecture
category: utils
source_files:
  - scripts/commit-with-check.ts
  - scripts/_lib/commit-temp-index.ts
  - scripts/_lib/gen-cmds.ts
  - scripts/_lib/gen-stage.ts
  - scripts/reproduce-commit-interrupt.ts
auto_fields:
  symbols_with_lines:
    - CommitTempIndexOptions
    - CommitTempIndexResult
    - commitWithTempIndex
    - computeStageList
    - GEN_CMDS
    - isHookArtifact
    - normPath
    - parsePorcelain
    - PorcelainEntry
    - StageInput
  use_when:
    - commit-with-check
    - 自动提交
    - 并发提交
    - 临时索引
    - 白名单提交
    - 门禁后自动 commit
use_when:
  - commit-with-check
  - 自动提交
  - 并发提交
  - 临时索引
  - 白名单提交
  - 门禁后自动 commit
pitfalls:
  - 并行会话活跃时禁止裸 git commit（含 --only 路径限定）——钩子快照窗口内会误判并行手改的卡为 gen 产物并 stage
  - 忘记传 --files 且主 index 为空 → 脚本 exit 1 报「无提交目标」
  - 越界文件校验是硬拦截（exit 1）：提交包含不在白名单 ∪ 生成物/测试清单内的文件时，需 git reset --soft HEAD~1 后重新用 --files
  - 临时索引进程被强杀时 finally 无法执行，index.ymm 临时索引文件恒残留（pid 后缀）
  - 非 ASCII 文件名八进制转义问题需保留 -c core.quotepath=false
quick_intents:
  - 一键验证 + 提交（门禁全绿才 commit）
  - 白名单路径提交（无需先 git add）
  - 仅验证不提交（--check 模式）
  - 并发隔离提交（多 AI 会话共享 checkout）
  - 排查门禁失败原因（看 FAIL 块）
status: active
---

# 提交脚本 commit-with-check

## 概览

`commit-with-check.ts` 把「改代码→tsc→build→test→git add→commit」压缩为单条命令：门禁委托 `pre-push-gate.ts`（唯一检查清单源头），全绿后**临时索引白名单提交**（ADR-151）——并发会话共享 checkout 下替代裸 `git commit`，根治「add→commit 暂存窗口被并行会话卷走」的漂移。

## 核心职责

- **白名单路径**：`--files <paths>` 直取（无需先 `git add`）；不传则读主 index staged 清单（向后兼容）
- **门禁委托**：`pre-push-gate --files <paths> --dry-run --no-banner`（按域裁剪；`--docs` 仅文档域）
- **临时索引提交**（`commit-temp-index.ts`）：`GIT_INDEX_FILE=index.ymm.<pid>` → `read-tree HEAD` → `add -- paths` → `commit -m` → finally 删临时索引。pre-commit 钩子继承临时索引，其 `git add`（gen 产物/gofmt 修复/智能 stage 测试）全部落进本次提交；主 index 零接触
- **提交后双条件校验**：越界文件（不在 `paths ∪ 生成物/测试白名单`）→ exit 1 打清单；并发插队（`HEAD^ != HEAD_BEFORE`）→ 仅 notice 不失败
- **收尾清主 index**：`git reset -q HEAD -- <committed>`（仅当主 index 含这些路径）；`--keep-index` 关闭
- **gen 清单单一事实源**：预刷新用 `_lib/gen-cmds.ts`（15 个全集，与原 pre-commit GEN_CMDS 对齐）

## 对外 API / 入口

```bash
node scripts/commit-with-check.ts -m "feat: xxx"                  # 全量门禁 + 提交（读 staged）
node scripts/commit-with-check.ts -m "feat: xxx" --files a.ts b.ts # 白名单直取（无需先 add）
node scripts/commit-with-check.ts -m "feat: xxx" --docs            # 仅文档域门禁
node scripts/commit-with-check.ts --check                          # 仅验证不提交
node scripts/commit-with-check.ts -m "feat: xxx" --keep-index      # 提交后不清主 index
```

退出码：0 全绿已提交 / 1 门禁失败或越界 / 2 用法错误。`--json` 输出 `_summary` 结构化摘要。

## 与其他子系统关系

- **pre-push-gate**：检查清单唯一源头；本脚本只做门禁编排 + 提交
- **pre-commit 钩子**：提交时继承临时索引，gen/gofmt/智能 stage 产物进本次提交（无 `--only` 的「钩子 stage 写主 index 丢失」盲区）
- **ADR-151**：并发隔离决策记录；**ADR-086**：thin wrapper 重构；**ADR-150**：pre-commit 兜底收窄（配套并发防护）

## 不变量

- **禁止裸 `git commit` 替代本脚本**（并行会话活跃时）：裸 commit 打包整个共享主 index，吞他人暂存
- 临时索引从 HEAD 构建：空树起点会误删全部未白名单文件（`read-tree HEAD` 不可省）
- 无 HEAD（空仓库首提交）时 `read-tree HEAD` 降级继续（不回归旧裸 commit 建 initial commit 行为）
- 越界文件必须 exit 1（并发夹带/意外 stage 检出口）；插队仅 notice 不自动回退（共享 checkout 下 reset 会撤他人提交）
- 临时索引成功/失败两路径均清理（`.git` 无 `index.ymm.*` 残留）
- `--files` 白名单路径内容取工作区，不依赖主 index 已暂存
- **中断残留边界**：进程被 `kill -9` / 工具层强杀时 `finally` 无法执行——临时 index 恒残留；若 git 子进程已写 ref 则 HEAD 推进（commit 落地）、未写完则丢弃。复现：`node scripts/reproduce-commit-interrupt.ts`（双变体：A 未完成被中断 / B 已完成清理未跑，即实战场景）。启动时清扫遗留 `index.ymm.*`（按 pid 存活判定）为待落地对策
- **并发卷带边界（ADR-151 续，2026-09-01 实证）**：裸 `git commit -- <paths>`（`--only`）会运行 pre-commit 钩子；钩子的 snap_docs 快照 diff 用「mtime/size 变化」判定 gen 产物，**并发下失效**——并行会话手改的卡恰在快照窗口内被 touch → 误判 gen 产物 → stage 进 index → 被 `--only` 提交卷带（实证 fbx-cli-pipeline.md / frontend_test_audit.md 卷进 e96b47e3）。修复：stage 判定下沉 `_lib/gen-stage.ts`（stage = 快照变化 ∩ 非并行 dirty，`??` 按 gen 前后存在性区分），契约测试 `tests/test_gen_stage.ts` 守护。**并行会话活跃时禁用裸 `git commit -- <paths>`，一律走 commit-with-check（临时 index + gen-stage 双隔离）**。实证验收：`b659efae` 门禁 19/19 PASS、outOfScope=`[]`、interleaved=false。

## 并发隔离演进方向（2026-09 评估）

当前双隔离（临时索引 + gen-stage）是**应用层逻辑隔离**，够用但非真事务：git 暂存区仍全局共享，多 AI 会话共享 checkout 时，一个会话的 `git add` 仍会影响另一个会话的 `git status`。根因 = git 无「提交锁」，`index.lock` 只在 commit 毫秒级存在，真正危险窗口是「add 之后、commit 之前」。解法可行性评估：

| 解法 | 可行性 | 成本 | 收益 | 结论 |
|------|--------|------|------|------|
| A：git worktree 物理隔离 | 高（git 原生，AGENTS.md 已有 worktree 同步规范） | 低（会话启动 `git worktree add ../ysm-wt-<session>`） | 并发卷带根除——暂存区/工作区物理隔离，b659efae 类补丁全不需要 | ✅ 架构级正解 |
| B：暂存区 flock | 中（Windows flock 兼容性差） | 中（需跨平台锁机制） | 只防 commit 冲突，不防 gen 产物覆盖 | ❌ 否决 |
| C：push 前 doctor --docs 预检 | 高（autoFix 已落地） | 已付 | 缓解生成物滚雪球，不解决并发根因 | ⚠️ 缓解方案 |

**结论**：ADR-151+152 双隔离是**够用解**（当前规模实证 b659efae 19/19 PASS、outOfScope=`[]`）；worktree 是**完美解**。触发条件（并发会话 >5 或 gen 冲突频率上升）满足后再评估 worktree——届时需：① AGENTS.md worktree 规范从「串行 rebase 事后同步」升级为「并发隔离」；② 会话启动流程加 `git worktree add`；③ 合并流程走 `git merge` 非 rebase。

## 相关

- ADR-151 — 临时索引白名单提交（并发隔离取代裸 git commit）
- ADR-152 — gen-stage 并发卷带根除（快照变化 ∩ 非并行 dirty 判定）
- [pre_commit_hook](./pre-commit-hook.md) — 提交前钩子（gen 同步/gofmt/智能 stage）
- [scripts_readme_index](./scripts_readme_index.md) — 钩子/脚本总览
