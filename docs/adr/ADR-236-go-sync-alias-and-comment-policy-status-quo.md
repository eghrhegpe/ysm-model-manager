# ADR-236：命名 stutter（go/sync alias）与注释篇幅：维持现状决策

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/sync/sync.go`、`internal/app/app_install_instance.go`、`internal/app/app_sync.go`、`internal/app/app_install_import.go`、`go/instance/instance.go`、`frontend/src/features/dnd/pack-dnd.ts`、`docs/knowledge/go-instance.md`、ADR-064、ADR-130、ADR-182、`go/AGENTS.md`

---

## 1. 背景（Context）

代码审计遗留两项「未动」待办：① 命名 stutter（`ysmsync.SyncResources` 观感重复，被定性为「API 级 churn，建议单独立项」）；② 注释篇幅过长（提议全仓统一风格）。本 ADR 先行复核再裁决，复核结果**推翻了议题的原始定性**。

### 1.1 定性修正：`ysmsync` 不是 stutter 包名，是编译期强制 alias

```go
// go/sync/sync.go:1
package sync            // ← 与标准库 sync 同名
import ( "sync" ... )   // ← 包内还自引标准库 sync（锁原语）
```

病根是**包名与标准库撞名**，外部引用必须 alias，`ysmsync` 是该约束的产物，而非「命名不够讲究」。推论很硬：**仅改包名消不掉 stutter**——改成 `modelsync` 后 `modelsync.SyncResources` 依然重复；要真消除，须连函数名一起改（`SyncResources → Resources`），调用点语义随之丢失，可读性反降。

### 1.2 实证数据（2026-09-14 实测）

`ysmsync.` 引用总量 **31 处 / 6 文件**：

| 文件 | 处数 | 归属层 |
|------|------|--------|
| `internal/app/app_install_instance.go` | 14 | Wails 绑定层 |
| `internal/app/app_install_import.go` | 6 | Wails 绑定层 |
| `internal/app/app_sync.go` | 5 | Wails 绑定层 |
| `go/instance/instance.go` | 4 | 领域层 |
| `internal/app/app_scan.go` | 1 | Wails 绑定层 |
| `internal/app/app.go`（import 声明） | 1 | Wails 绑定层 |

- **26 / 31 落在 `internal/app`** —— 多会话并行高频修改区。
- 前端：生成的 bindings（`frontend/wailsjs`、`frontend/src`）**零命中** `ysmsync`；仅 `features/dnd/pack-dnd.ts:3` 注释提及 1 处（文档级，非编译依赖）。「前端不受影响」的真正前提是**只改 alias/包名、不动 App 方法名**，而非「绑定层碰巧解耦」。

---

## 2. 决策（Decision）

### D1 命名：维持现状，不改包名、不改 alias、不改函数名

| # | 理由 | 性质 |
|---|------|------|
| 1 | **stutter 不可消**：改包名后仍重复；真消除须改函数名，可读性反降 | 收益端归零 |
| 2 | **收益 ≈ 0**：纯观感问题，不修 bug、不降耦合、编译器无感 | 收益端归零 |
| 3 | **成本实打实**：31 处 Go 引用 + 1 处前端注释；`docs/knowledge/go-instance.md` 的 `invariant_anchors: go/instance/instance.go\|ysmsync.SyncResources` 锚不命中 → `check-knowledge-drift` 判 **ERROR**（fail-closed，`check-knowledge-drift.ts:329`） | 成本端确定性 |
| 4 | **ADR 正文被牵连**：ADR-064 / ADR-130 / ADR-182 正文提及 `ysmsync.*`，改写违反 ADR 追加式不可变 | 成本端确定性 |
| 5 | **并行会话冲突**：26/31 在 `internal/app`，与兄弟 AI 改动面高度重叠 | 成本端概率性 |
| 6 | **反向约束更强**：Effective Go 对 stutter 用词是 *avoid* 非 *must*；而「撞名 stdlib」是硬约束 | 规范权衡 |

> 取舍结论：一边是「没法真正拿到」的观感收益，一边是「确定会发生」的 ERROR 级漂移 + ADR 改写 + 并行冲突。不立项。

### D2 注释篇幅：不做全仓瘦身，改为增量约束

- 本仓注释承载 ADR 编号与历史 bug 上下文，是「查证优先」体系的检索入口——删注释等于拆检索索引。
- `internal/app` 为高频并行修改区，大规模动注释的冲突面与 D1 第 5 条同源。
- **替代动作**（已落地）：新增「注释规范（增量约束，存量不动）」小节至 `go/AGENTS.md` —— 新注释必须携带代码读不出的信息（ADR 号 / bug 上下文 / 平台坑点 / 非显然取舍），禁止复述代码；踩坑类注释收敛进 AGENTS 而非各文件留副本。

### D3 留痕：以本 ADR 钉死决策

该议题已在本仓反复出现、每轮重新调研。成本最低的解法不是「做」或「不做」，而是**把实证数据与理由写下来**，让后续会话一次命中。

### D4 补偿动作：包注释解释成因（唯一执行的源码改动）

`go/sync/sync.go` 顶部补包注释，写明「包名撞 stdlib → alias 必需 → 勿发起消除 stutter 的重命名」。1 处改动，直接消解后来者的困惑——这是本议题中**唯一有正收益**的动作。

---

## 3. 后果（Consequences）

**正面**

- 终结反复调研：后续会话读本 ADR 即可，31 处引用零 churn。
- 知识卡锚点与 ADR-064/130/182 正文保持原样，无 drift、无 ADR 改写。
- 新增注释质量有闸（增量约束），存量检索价值不损。

**负面 / 已知遗留**

- `ysmsync.SyncResources` 的观感 stutter 保留 —— 已接受，由包注释就地解释。
- 注释篇幅全仓不统一保留 —— 由增量约束逐步收敛「新增」，存量不强行拉平。

**Revisit trigger（重开条件）**

> 若 `go/sync` 因**其他独立理由**（如架构拆分、包重组）必须改名，则顺势一并消除 stutter，本 ADR 作废并由新 ADR 取代。除此外不因「命名观感」单独立项。

---

## 4. 数据溯源

| 结论 | 命令 / 来源 | 结果 |
|------|-------------|------|
| 引用总量与分布 | `grep -rn "ysmsync\." --include=*.go .` + `awk` 分组 | 31 处 / 6 文件；`internal/app` 26、`go/instance` 4 |
| alias 为强制项 | `grep -rn "ysmsync \"" --include=*.go .` + `go/sync/sync.go:1` | 6 处 alias 声明；包名 `sync` 且自引 stdlib `sync` |
| 前端绑定解耦 | `grep -rl "ysmsync" frontend/wailsjs frontend/src` | 仅 `features/dnd/pack-dnd.ts:3` 注释 1 处 |
| 知识卡 ERROR 级 | `docs/knowledge/go-instance.md:35` + `scripts/check-knowledge-drift.ts:329` | `invariant_anchors` 锚不命中 → ERROR（fail-closed） |
| ADR 正文牵连 | `grep -rn "ysmsync" docs/adr/` | ADR-064 / ADR-130 / ADR-182 |
| 反方规范依据 | Effective Go · Package Names | stutter 用词 *avoid*，非强制 |

<!-- 文件名: go-sync-alias-and-comment-policy-status-quo.md → 实际文件 ADR-236-go-sync-alias-and-comment-policy-status-quo.md -->
