# ADR-181：processForEpoch 枚举化——竞态测试先行

- **状态**：🧊 已废弃（deferred）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[go_design_critique](../knowledge/go_design_critique.md)、`internal/app/install/queue.go`、[install_domain_split](../knowledge/install_domain_split.md)

---

## 1. 背景（Context）

`processForEpoch` 是 `DownloadQueue` 的并发控制协议：每次 Enqueue 启动新 process 时 `q.epoch++`，process 启动时快照 `myEpoch = q.epoch`，defer 内比对代际以判断 spawn 是否被后续 Cancel/Enqueue 取代。当前三处递增（`queue.go:64/84/144`）+ 三重守卫（`queue.go:119/132/162`）。

2026-09 三路子代理串行锐评发现：
- 守卫注释（L113-116 / L127-158）已把隐式协议讲清，可读性可接受
- 3 个现有测试（`queue_test.go`）均未带 `-race`，未覆盖 cancel-restart 竞态路径
- 枚举化重构成本中（6 处读写点 + 状态转移表 + 3-4 个新测试），属 ADR 级评估

锐评共识：**先补竞态测试，再谈枚举化**。

## 2. 决策（Decision）

**暂缓枚举化，本轮只标记技术债**。下轮独立立项路径：

1. **先补测试**：在 `queue_test.go` 补 3 个竞态测试（cancel-restart / 死队列 / 多批 Enqueue 并发），全带 `-race`，用 `withFakeNode` 式注入 epoch 推进钩子
2. **测试全绿后**，再评估枚举化必要性（若有实际 bug 再动，否则保留现状）

## 3. 后果（Consequences）

| 正面 | 负面 |
|------|------|
| 代码可读性已可接受，不急于重构 | 隐式协议仍靠注释续命，编译器零保护 |
| 避免无测试背书的重构引入回归 | 枚举化被长期推迟可能积累更多技术债 |
| 测试先行原则被锚定为下轮前提 | — |

## 4. 数据溯源

- 锐评报告：视角A2 2026-09-05 三路串行锐评（https://dsh://session/...）
- 代码位置：`internal/app/install/queue.go:64/84/113-116/127-158/144`
- 测试缺口：`internal/app/install/queue_test.go` 仅 4 个测试，无并发场景
- 历史快照：`docs/knowledge/go_design_critique.md` 记录「暂缓，需 ADR 级评估」

---

*ADR 只记决策方向和理由，不记实施进度。实施进度见知识卡 [go-design-critique](../knowledge/go_design_critique.md) 动刀进度。*
