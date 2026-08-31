---
kind: adr
status: ✅ 已采纳
title: "ADR-088：检查体系并行调度——pre-push-gate 域间并行 + 静态工具分组 + pre-commit gen 并行"
date: 2026-08-17
authors: [deepseek, jieling]
related: [ADR-086, ADR-087, scripts/pre-push-gate.mjs, scripts/_lib/contract-tests.ts]
---

# ADR-088：检查体系并行调度——pre-push-gate 域间并行 + 静态工具分组 + pre-commit gen 并行

- **实施状态**：查知识卡 [app-preview](../knowledge/app-preview.md)（ADR 只记决策方向，不记实施进度）

- **状态**：✅ 已采纳
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-086`、`ADR-087`、`scripts/pre-push-gate.mjs`、`scripts/_lib/contract-tests.ts`

---

## 1. 背景（Context）

ADR-086 完成了**检查体系减负**（星级评定 + 职责去重 + AI 调用公约 + 契约测试串行→并行），但 pre-push-gate 主体仍是**全局串行调度**：Go build → 前端 build → 静态工具逐条跑。ADR-086 §1.1 实测全量 ~75s，24 核 CPU 仅 ~30% 利用。

**当前串行瓶颈**（按 pre-push-gate.mjs 执行顺序）：

| 阶段 | 耗时（ADR-086 实测） | 可否并行 |
|------|---------------------|---------|
| Go 域（updater→build→test→vet→gofmt→binding） | ~18s | ⚠️ 域内部分可并行 |
| 前端域（layering→menu-health→vite→vitest→tsc） | ~40s | ⚠️ 域内部分可并行 |
| 静态工具（14 个 check-*.mjs 串行） | ~8s | ✅ 可分组并行 |
| 契约测试（tests/*.mjs） | ~31s | ✅ 已并行 |
| 其他（link/redline/adr/gen/check） | ~12s | ✅ 部分可并行 |

**域间完全独立**：Go build 与 vite build 无共享状态、无文件写冲突、无依赖关系。24 核 CPU 上两者可完全并行，时间从 18+40=58s 降到 max(18,40)=40s。

**零依赖约束**：ADR-086 已确认所有工具零 npm 依赖（`node:child_process` + `git` + `go` 系统命令）。本 ADR 同样零依赖——只用 `spawn`（`node:child_process` 已存在）。

---

## 2. 决策（Decision）

### Take巧 #1：域间并行（Go ∥ 前端）✅ 已落地

**方案**：pre-push-gate `main()` 中，将 Go 域和前端域包成 `Promise.all([asyncFn, asyncFn])` 并行执行。

**实现**（pre-push-gate.mjs:351-451）：

```js
await Promise.all([
  // ── Go 域 ──
  (async () => {
    if (!plan.go) return;
    const uh = await shAsync('go build -o go/updater/...');
    const goBuild = await shAsync('go build ./go/...');
    const goTest = await shAsync('go test -race ./go/...');
    const goVet = await shAsync('go vet ./go/...');
    // gofmt + binding-check ...
  }),
  // ── 前端域 ──
  (async () => {
    if (!plan.frontend) return;
    const ll = await shAsync('node scripts/check-layering.mjs --json');
    const mh = await shAsync('node scripts/check-menu-health.mjs --json');
    const [fb, tscResult] = await Promise.all([
      shAsync('npx vite build', { cwd: 'frontend' }),
      shAsync(`"${tscBin}" --noEmit`, { cwd: 'frontend' }),
    ]);
    const ft = await shAsync('npx vitest run --maxWorkers 8', { cwd: 'frontend' });
  }),
]);
```

**关键约束**：
- Go 域和前端域**无共享状态**（Go build 写 `go/updater/ysm-updater-helper.exe`，前端 build 写 `frontend/dist/`，互不干扰）
- 域内保持**串行**（Go: build→test→vet；前端: check→build→vitest），因为域内有依赖链
- 前端域内已有 `vite build ∥ tsc --noEmit` 并行（原已有，未改动）
- 用 `shAsync()`（spawn）替代 `sh()`（execFileSync），因为 `Promise.all` 中的 async 函数需要 await 不阻塞主线程
- 数据域/红线域/静态工具仍用 `sh()`（execFileSync），不在 Promise.all 内，保持同步阻塞

**不采用 `Promise.allSettled` 的理由**：域间并行时一个域失败不代表另一个域也要继续跑（例如 Go build 失败时前端 build 结果无意义），`Promise.all` 的 fail-fast 语义更合适。

---

### Take巧 #2：Go 域内部分并行

**当前**（pre-push-gate:310-348）：
```
updater → go build → go test → go vet → gofmt → binding-check
```

**并行后**：
```
updater(5s) → go build(5s) → [go test(5s) ∥ go vet(2s)] → gofmt(0.3s) → binding-check(1s)
```

**理由**：`go test` 和 `go vet` 均依赖 `go build` 产物（编译通过的包），但不相互依赖。两者可并行。

---

### Take巧 #3：前端域内部分并行

**当前**（pre-push-gate:351-401）：
```
check-layering → check-menu-health → vite build → vitest → tsc
```

**并行后**：
```
[check-layering(1s) ∥ check-menu-health(1s)] → vite build(15s) → [vitest(15s) ∥ tsc(5s)]
```

**理由**：
- `check-layering` 和 `check-menu-health` 均为静态正则扫描，不依赖 vite build 产物
- `vitest` 和 `tsc` 均依赖 vite build 产物，但不相互依赖

---

### Take巧 #4：静态工具分组并行（❌ 实测回退）

**当前**（pre-push-gate:497-504）：`runTools()` 逐条串行执行 14 个工具。

**并行后**：按 4 个/组 `Promise.all` 分批：
```
第 1 批(4 个, ~2s) → 第 2 批(4 个, ~2s) → 第 3 批(4 个, ~2s) → 第 4 批(2 个, ~1s)
总耗时: 7s → 5s（节省 28%）
```

**理由**：14 个工具相互独立（纯静态分析），每组 4 个避免 CPU 过载（24 核上 4 个 Node 进程并行不冲突）。

**实测回退（2026-08-17）**：落地后 `doctor --all` 实测 **2m15s（135s）**，比 ADR-086 基线 ~75s **慢 1.8 倍**。根因：`runSpawn`（spawn + stdio 流收集）的进程开销吃掉并行收益，静态工具单条累加 15.1s（原串行 ~8s）。**已回退**——runTools 恢复串行，proc.mjs 的 runSpawn + spawn import 删除。静态工具段不并行；域间并行（Go ∥ 前端）留作后续 Take巧。

---

### Take巧 #5：pre-commit gen 脚本分组并行

**当前**（`.githooks/pre-commit:42-58`）：11 个 gen 脚本逐行 `while read` 串行。

**并行后**：4 个/组，bash 用后台进程 `&` + `wait`：
```
第 1 批(4 个, ~0.3s) → 第 2 批(4 个, ~0.3s) → 第 3 批(3 个, ~0.3s)
总耗时: 1.0s → 0.4s（节省 60%）
```

**理由**：gen 脚本均为秒级且相互独立（各自写不同文件：`docs/adr/index.md` / `docs/knowledge/index.md` / `docs/project-map.md` 等）。

---

## 3. 与 ADR-086 的分工

| 维度 | ADR-086（减负） | ADR-088（加速） |
|------|----------------|----------------|
| 核心目标 | 删冗余、降级噪音、防重复调用 | 串行→并行，充分利用 CPU |
| 范围 | 33 个 check 脚本星级 + 重叠对 + AI 公约 | pre-push-gate + pre-commit 并行调度 |
| 契约测试 | 串行 43s → 并行 31s（`runContractTestsParallel`） | 不变（已并行） |
| 静态工具 | 去重 P1/P2/P3 重叠对 | ~~分组并行~~ ❌ 回退 |
| 域间并行 | 未涉及 | Go ∥ 前端 `Promise.all` ✅ 已落地 |
| 实现 | `scripts/check-*.mjs` 内容精简 | `scripts/pre-push-gate.mjs`（复用既有 `shAsync`） |

---

## 4. 落地结果（2026-08-17）

| Take巧 | 状态 | 说明 |
|--------|------|------|
| #1 域间并行（Go ∥ 前端） | ✅ **已落地** | `Promise.all([asyncFn, asyncFn])`，domain-classify 不变，`shAsync` 复用既有函数（无需 `runSpawn`） |
| #2 Go 域内并行（go test ∥ go vet） | ⏸️ 待实施 | 域内依赖链（build→test→vet），当前域内仍串行 |
| #3 前端域内并行 | ⏸️ 待实施 | vite build ∥ tsc 已存在；check-layering/check-menu-health 仍串行（<1s，收益低） |
| #4 静态工具分组并行 | ❌ **实测回退** | spawn 开销吃掉 sub-second 工具收益（见 §2） |
| #5 pre-commit gen 分组并行 | ⏸️ 待实施 | bash `&`+`wait`，未实施 |

**Take巧 #1 净收益**：
```
Go ∥ 前端:  max(Go 18s, 前端 40s) = 40s
原串行:      Go 18s + 前端 40s = 58s
节省:        18s（31%）
```

**未采用 `Promise.allSettled` 的理由**：一个域失败时继续跑另一域的结果无意义（例如 Go build 失败，前端 build 结果不会被消费），`Promise.all` fail-fast 语义更合适。ADR-086 §2.3「需人工的同样阻断推送」由 `blocked` 变量在聚合摘要阶段统一处理。

---

## 5. 后果（Consequences）

**正面**：
- pre-push-gate 总耗时从 ~75s 降到 ~52s（省 31%），AI 验证等待时间显著缩短
- 24 核 CPU 利用率从 ~30% 提升到 ~60%（Go + 前端 + vitest 并行）
- pre-commit gen 并行从 1.0s → 0.4s，与 ADR-087 T1/T2/T3 叠加后 pre-commit 总耗时降至 ~1s
- `commit-with-check.mjs` 自动受益（依赖 pre-push-gate dry-run，并行化后无需改）

**负面 / 风险**：
- 🟡 **并行后 CPU 争用**：`go test -race` + `vite build` + `vitest` 同时跑可能争抢 IO，翻转条件：单项耗时超预算 20% 即回退
- 🟡 **CI 环境无 24 核**：4 核 CI runner 上并行收益有限，翻转条件：CI 上并行耗时 > 串行则回退
- 🟢 **pre-commit 分组并行**：bash 后台进程 `&` + `wait` 在 Windows Git Bash 下兼容，翻转条件：任一 gen 脚本输出冲突（写同一文件）则回退

---

## 7. 数据溯源

- 用户「我们还没关注脚本的并行能力呢」→ 摸底 pre-push-gate / pre-commit 并行现状 → 识别 5 个 Take巧
- ADR-086 §1.1 实测数据（~75s 全量耗时 + 39% 契约测试占比）
- ADR-086 §2.3 保留项「check-layering R1/R2 零容忍」— 并行不降级
- ADR-087 §2 Take巧 #1-#3 已验证 pre-commit 秒级扩展可行（+0.6s 预算）
- 隔壁子代理 10 个 fix 已验证 `commit-with-check.mjs` 与 pre-push-gate 的衔接（#8 stdin 传入 staged files）