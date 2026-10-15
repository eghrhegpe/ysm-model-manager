---
kind: commit-granularity
name: 提交密度公约——工作单元批量提交
tier: leaf
category: config
status: draft
source_files:
  - scripts/commit-with-check.ts
use_when:
  - 要提交一批改动，纠结拆几个 commit 时
  - 锐评/处置回填要写 commit 号引用时
  - 发版前想压历史密度时
pitfalls:
  - 一个锐评条目一个提交 + 一条 docs(锐评) 回填一个提交 = 密度虚高主因（2026-10-24 实测：v1.15.0 后 3 周 1114 提交，纯文档占 21%，中位数每提交 4 文件，达同类仓 12 倍）
  - 分段压缩不可用 reset --soft 迭代——--soft 不动暂存区，每段会装入「剩余全部改动」且弃用前段；正解 = git commit-tree 按边界树重建提交链（2026-10-24 实证）
  - 已推送历史不要重写：知识卡/锐评文档哈希锚、协作者远端、CI 历史都挂在上面
quick_groups:
  - 提交单元 = 工作单元（一轮锐评处置/一个 feature/一次重构收口）：fix+test+docs 回填合体，生成物由 pre-commit 搭车
  - 处置引用以条目号为主（如 锐评P2⑤），commit 号为辅；压缩场景在合并提交消息体列原哈希清单
  - 压缩先例：2026-10-24 未推 85→7（commit-tree 边界树重建，终树逐字节一致，备份 backup/pre-squash-20261024）
quick_intents:
  - 「该拆几个提交」→ 按工作单元合体，见 quick_groups
  - 「历史太密能压吗」→ 未推的可压（commit-tree 法）；已推送的不压，见 pitfalls
  - 「旧哈希引用失效」→ 查合并提交消息体映射或 backup/pre-squash-20261024 分支
quick_risk_lines:
  - 改写已推送历史 = force push = 哈希锚全断（ADR-338-d3 明令不做）
  - 压缩收工前必须验证 `git diff <备份分支> HEAD` 为空（树逐字节一致），否则说明压缩序列出错
---

# 提交密度公约——工作单元批量提交

## 概览

约束提交粒度与处置引用口径，治 AI 并行会话的提交密度虚高（对比基线：dsh 插件仓同期约 1/12 密度）。决策见 ADR-338-d3（提议中）；本卡承载操作口径与压缩方法论。

## 核心职责

- 定义提交单元：工作单元（一轮锐评处置 / 一个 feature / 一次重构收口）→ 一个提交；fix+test+docs 回填合体，生成物搭 pre-commit 便车。
- 定义引用口径：条目号优先、commit 号为辅；合并提交的消息体列原哈希清单保映射。

## 对外 API / 入口

- 提交工具链不变：仍走 `scripts/commit-with-check.ts`（门禁按 staged 裁剪）——公约只改「拆几个」，不改「怎么提」。
- 历史压缩走 `git commit-tree`（方法见 pitfalls 第二条）。

## 与其他子系统关系

- ADR-338-d1 提交信息减负闸：批量提交后「多主题 subject」提示会变常见——消息体条目清单即补偿口径（采集期提示不阻断）。
- pre-commit GEN_CMDS：生成物搭车进所属工作单元提交，不单独成提交。
- 知识卡哈希锚体系：压缩后旧哈希→合并提交映射在各合并提交消息体；受影响 docs 已加「哈希注记」；原始历史在 backup/pre-squash-20261024。

## 不变量

- 已推送历史不重写（不 force push main）。
- 压缩收工前 `git diff <备份分支> HEAD` 必须为空（树逐字节一致）。

## 相关

- `docs/adr/decisions/ADR-338-d3-commit-granularity.md`（决策，提议中）
- `docs/knowledge/commit-message-gate.md`（提交信息减负闸）
- `backup/pre-squash-20261024`（2026-10-24 压缩先例的原始历史）
