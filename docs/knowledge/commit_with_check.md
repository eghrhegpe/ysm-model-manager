---
kind: commit_with_check
name: 提交脚本 commit-with-check
tier: architecture
category: utils
source_files:
  - scripts/commit-with-check.ts
  - scripts/_lib/commit-temp-index.ts
  - scripts/_lib/gen-cmds.ts
  - scripts/_lib/gen-stage.ts
  - scripts/reproduce-commit-interrupt.ts
use_when:
  - commit-with-check
  - 自动提交
  - 并发提交
  - 临时索引
  - 白名单提交
  - 门禁后自动 commit
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

## 相关

- ADR-151 — 临时索引白名单提交（并发隔离取代裸 git commit）
- [pre_commit_hook](./pre-commit-hook.md) — 提交前钩子（gen 同步/gofmt/智能 stage）
- [scripts_readme_index](./scripts_readme_index.md) — 钩子/脚本总览
