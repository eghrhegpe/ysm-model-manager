# ADR-150：pre-commit 兜底收窄：禁用 git add -u docs/ 吞并发漂移 (P2-2 加固)

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`.githooks/pre-commit`

---

## 1. 背景（Context）

pre-commit 钩子用「gen 前后快照 diff」精确 stage 本次文档产物（2026-08-17 P2-2 修复，杜绝并发共享 checkout 下把他人未提交 docs/locales 半成品扫进 commit）。

但其兜底分支（`GEN_SNAP` 快照缺失时）执行 `git add -u docs/ frontend/public/locales/ completions/`——把**整个 `docs/` 下所有已跟踪的未暂存修改**全 stage。当 `snap_docs()` 依赖的 `find -printf`（Windows Git Bash 下偶发不可靠）或 node 兜底失败、`GEN_SNAP` 缺失时，该兜底层被触发，吞掉并行会话留工作树的未提交漂移。

**实证**：`ebb921a5` 本应只含 2 张知识卡同步（dialog-modal 2 行、utils-dom 1 行），实际被兜底分支撑成 **98 文件**，其中 ~96 张 `docs/knowledge/*.md` 的 `+11/+12` 行全为并行会话漂移（含 `dom-fab.md` 占位符卡）。该兜底分支与 P2-2「不吞他人半成品」目标自相矛盾，是钩子自身漏洞。

## 2. 决策（Decision）

两处加固 `.githooks/pre-commit`：

1. **`snap_docs()` 改 node 优先**（第 46–58 行）：跨平台用 node 遍历生成快照，find `-printf` 仅作 GNU 快路径。使精确 stage 路径在 Windows 可靠，`GEN_SNAP` 不再缺失，兜底分支几乎不触发。
2. **兜底分支收窄**（第 106–108 行）：`GEN_SNAP` 缺失时**严禁 `git add -u docs/`**，仅置 `GEN_SKIPPED=1` 标志跳过，由第 111 行统一告警「不吞未提交 docs 漂移」。代价：快照缺失时本次 gen 产物不自动 stage，需调用方手动 `git add`（比吞他人代码安全，符合 P2-2 优先级）。

## 3. 后果（Consequences）

- **正面**：彻底消除「提交被未暂存漂移卡住」的误吞；路径限定提交纪律可被钩子守住；并发会话半成品不再被卷进他人 commit。
- **负面**：`GEN_SKIPPED` 场景下本次 gen 产物不自动 stage（漏 stage），需手动 add 或重跑 commit；属可接受退化。
- **已知遗留**：gen 产物清单未显式枚举，兜底跳过时无法精准补 stage；未来若需「快照缺失仍安全 stage gen 产物」，可改为枚举 `GEN_CMDS` 输出路径白名单（独立于快照）。

## 4. 数据溯源

- 来源：`ebb921a5` 误提交 96 张知识卡漂移 → 诊断 `.githooks/pre-commit` 第 106–108 行 `git add -u docs/` + 第 46–58 行 `find -printf` 不可靠。
- 结果：改 `.githooks/pre-commit`（snap_docs node 优先 + 兜底收窄 + 第 111 行 `GEN_SKIPPED` 告警分支）；记知识卡 `pre-commit-hook.md`。
