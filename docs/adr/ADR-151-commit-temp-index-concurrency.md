# ADR-151：commit-with-check 临时索引白名单提交：并发隔离取代裸 git commit

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/commit-with-check.ts, scripts/_lib/commit-temp-index.ts, scripts/_lib/gen-cmds.ts, .githooks/pre-commit`

---

## 1. 背景（Context）

`commit-with-check.ts` 旧实现要求调用方先 `git add`（无 staged 直接 exit 1），再用裸 `git commit -m`（`:155`）。在**共享 checkout 的单例 index** 下，这构成「add → commit」暂存窗口：并行会话的裸 commit 会把整个主 index 打包，卷走他人已暂存未提交的文件。

**实证**：`go/conc` 5 个文件已 `git add`，在等待门禁/提交期间被并行会话的 `b4d23b78`（fix(hooks)…ADR-150）裸 commit 一并带走——代码内容入库正确，但提交信息挂在了他人名下（ADR-150 钩子要防的「`git add -u docs/` 吞并发漂移」只堵了钩子层小口，主 index 暂存窗口这个大口仍在）。

git 本身没有「提交锁」：`index.lock` 只在 commit 进行的毫秒级存在；真正危险的窗口是「add 之后、commit 之前」。

## 2. 决策（Decision）

`commit-with-check` 提交阶段改用**临时索引白名单提交**（`scripts/_lib/commit-temp-index.ts`）：

1. `GIT_INDEX_FILE=<gitdir>/index.ymm.<pid>` 指向独立临时索引（与主 index 零 lock 竞争）。
2. `git read-tree HEAD` → 临时索引从 HEAD 构建（空树起点会误删全部未白名单文件）。
3. `git add -- <paths>` → 白名单路径入临时索引，内容取工作区（不依赖主 index 已暂存）。
4. `git commit -m`（无 `--only`、无 pathspec）→ pre-commit 钩子继承 `GIT_INDEX_FILE`，其 `git add`（gen 产物 / gofmt 修复 / 智能 stage 测试，`.githooks/pre-commit` 四处）全部落进临时索引 → 本次提交；主 index 零接触。
5. `finally` 删临时索引（成功/失败两路径均清理）。

选 `GIT_INDEX_FILE` 而非 `--only -- pathspec`：`--only` 的临时 index 不继承给钩子——钩子的 `git add` 写主 index，gen 产物 / gofmt 修复 / 智能 stage 测试**永不入库**（下次 `doctor --check` 恒报漂移、未格式化 go 文件阻断 push）。显式 `GIT_INDEX_FILE` 让钩子与提交共用同一临时索引。

配套决策：
- **新增 `--files <paths>`**：白名单直取，无需先 `git add`（主 index 空也能提交）；不传时读主 index staged 清单（向后兼容旧用法）。
- **提交后双条件校验，不自动回退**：
  - a) `git show --name-only HEAD` 越出 `paths ∪ 生成物/测试白名单` → exit 1 打印清单。
  - b) `HEAD^ != HEAD_BEFORE`（并发插队）→ 仅打印 notice 不失败。插队是良性的：临时 index 从 HEAD 构建，本次提交自动基于插队后的最新 HEAD，天然 rebase 语义、不分叉；共享 checkout 下 `reset --soft` 可能撤掉他人提交，整体重试有活锁风险，两者均否决。
- **收尾清主 index**：`git reset -q HEAD -- <committed>`（仅当主 index 含这些路径），`--keep-index` 关闭——避免提交后 `git status` 仍显示「已暂存」误判。
- **gen 清单单一事实源**：commit-with-check 内联 11 个与 pre-commit 内联 15 个 gen 已漂移 4 个命令；收敛到 `scripts/_lib/gen-cmds.ts`（15 个全集），TS 侧 import、sh 侧 `node scripts/_lib/gen-cmds.ts` 逐行消费。

## 3. 后果（Consequences）

- **正面**：并发隔离由机制保证而非纪律——「我夹带别人」在机制上不可能（临时 index 只含白名单），「别人夹带我」也失效（主 index 不参与本次提交）；钩子 stage 产物仍正确入库（无 `--only` 盲区）。
- **负面**：多一层 git 状态机复杂度（read-tree + 临时 index + 双条件校验 + 收尾 reset）；`--files` 直取时若主 index 有同名路径旧暂存，收尾 reset 会清掉该暂存（属预期清理，`--keep-index` 可关）。
- **已知遗留**：read-tree → add → commit 之间（毫秒级）若插队，本次提交树基于旧 HEAD 树（父 ref 为插队后的新 HEAD），interleaved 标记让调用方 notice；不做整体重试。sh 侧（`.githooks/pre-commit`）迁移到 gen-cmds.ts 暂缓（并行会话 ADR-150 未提交，避免撞车）。

## 4. 数据溯源

- 来源：`b4d23b78` 并发漂移实证 → 诊断 `commit-with-check.ts:78-84`（只读 staged 不做 add）+ `:155`（裸 `git commit -m`）→ 手动实验验证 `GIT_INDEX_FILE` + `read-tree HEAD` + 钩子继承 stage 语义。
- 结果：`commit-temp-index.ts` + `gen-cmds.ts` 落地；契约测试 `tests/test_commit_temp_index.ts` 8 用例覆盖（隔离/钩子 stage/生成物/无 staged 直取/清理/白名单/越界/插队）。

<!-- 文件名: commit-temp-index-concurrency.md → 实际文件 ADR-151-commit-temp-index-concurrency.md -->
