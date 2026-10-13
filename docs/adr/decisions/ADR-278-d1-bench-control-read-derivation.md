# ADR-278-d1：bench 控件消费派生化：read* 声明读集，PERF_UNREAD 登记表退役

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：[ADR-278](../ADR-278-diagnostics-perf-ia.md)
- **相关**：`diagnostics/perf.ts`（PERF_UNREAD_* 两表 + apply）、`perf-single-bench.ts`（singleBenchReadMode / syncPerfBaselineControls）、`perf-concurrent.ts`（concReadParams）、`perf-scan-bench.ts`、`perf-common.ts`（BASELINE_CONTROL_IDS）、`perf-mode.test.ts`（门禁护栏族）

---

## 背景（一句）

ADR-278 §2.6「可见但不被读 = 欺骗」的判据靠 `PERF_UNREAD_MODES` / `PERF_UNREAD_TARGETS` 两张**手工登记表**表达，注释自陈「真相源 = 各命令模块的 read*，表只是登记面」——正是本页 GetLogCaps 单源化干掉的模式（真相在别处、镜像手工抄）；基准三件套的 `syncPerfBaselineControls`（模式∧目标集双维）是同一判据的第三种写法；穷尽性护栏按 **tpl 行开标签字面量 + div 配平**反查控件归属，防线建在字符串巧合上（行加 class 即失配、注释写开标签即配平炸，实测各踩过一次）。

## 决策（三行）

1. **读点即声明**：`singleBenchReadMode` / `concReadParams` / scan 的读路径经可选 collector（`Set<string>`）登记每个 `getElementById(id)` 读取点——「此状态实测读哪些控件」由读取路径本身回答，不再由第二份表转述；collector 为纯增量参数，读函数其余逻辑零改动，且**不得有副作用**（apply 会跑纯读）。
2. **apply 门禁派生化**：`initPerfMode` 按当前 bench 模式跑对应 read* 的纯读取 readIds，对 bench 组可输入控件统一 `disabled = !readIds.has(id)`——模式维 ∧ 目标集维由「当前 selector 值下的真实读路径」**自动坍缩**；`PERF_UNREAD_MODES` / `PERF_UNREAD_TARGETS` / `BASELINE_CONTROL_IDS` 与 `syncPerfBaselineControls` 的门禁身份随之退役（模型路径框的「除 model 外都不读」特判由读路径自然表达，不再单独写）。
3. **护栏改等价对账**：perf-mode.test 穷尽性护栏改为「apply 产出的 disabled 判定 === read* collector 集合」（逐模式 × 逐目标态）+「可见控件至少被某状态读到」；行归属扫描保留（它防布局问题非门禁真值），但「控件行禁加 class」旧纪律由对账取代。变异验证锁非空转。

## 后果（一句）

新增/删改控件读取点时门禁自动跟随，「改 read* 忘改表」漂移面消失；代价是 pill 切换多跑 1~3 次纯 DOM 读（微秒级）。回退 = revert 本刀。显示维不动：标签改写 / scope hint / conc 回落 toast / `data-perf-mode` 行显隐维持 §2.6 现状。

