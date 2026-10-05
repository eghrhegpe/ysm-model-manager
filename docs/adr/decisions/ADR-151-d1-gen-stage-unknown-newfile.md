# ADR-151-d1：gen-stage 未知新建文件默认排除（并发卷带硬化）

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-151

---

## 背景（一句）

`gen-stage.computeStageList` 对「不在 gen 前 porcelain 中的文件」**无条件 stage**（判为 gen 新建产物）——但「未被 git 跟踪且 gen 前不存在」与「gen 期间并发会话新建」在观测上**完全同形**，故并发下会把他人新建的未跟踪文件卷进本次提交（实证：`docs/knowledge/zzz-fm-delimiter-tmp.md` 被卷入 `6de3c8d5c`）。

## 决策（三行）

1. `!dirty` 分支由「无条件 stage」收紧为「**命中已知 gen 产出集合才 stage**」，未知新建文件**默认排除**并打 stderr 提示。
2. 已知产出集合 = `machine-diff.ts` 既有的 `GEN_WHOLE_OUTPUTS` + `GEN_WHOLE_PREFIXES`（生成物白名单，单一事实源复用），**不新增第二份清单**。
3. 判据方向遵循 ADR-151 既有红线：**漏 stage 无害**（生成物滞留，后续 commit 收编路径可兜）／**误 stage 有害**（吞并行会话工作）。故未知一律保守排除。

## 后果（一句）

白名单外的**新生成物**（未来新增 gen 脚本首次产出）不再自动搭车，需补进 `GEN_WHOLE_OUTPUTS` 或手动 stage——以一次显式登记换取并发隔离不再有静默缺口；回退方式：`YSM_SKIP_GEN_STAGE=1` 或改回无条件 stage（不推荐）。

<!-- 文件名: gen-stage-unknown-newfile.md → 实际文件 decisions/ADR-151-d1-gen-stage-unknown-newfile.md（ADR-320 decisions 轻量模板） -->
