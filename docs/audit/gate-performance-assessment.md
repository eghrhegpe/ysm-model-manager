# 门禁性能瓶颈评估报告

> 评估时间：2026-10-17 | 仓库：ysm-model-manager | 分支：当前工作树

## 1. 执行摘要

项目门禁体系由三层构成：**pre-commit**（每次提交，~10s）→ **commit-with-check**（每次提交，~3-10s）→ **pre-push-gate**（每次推送，22-113s+）。整体架构设计合理——FAST_PUSH 默认跳过重构建/测试、Go∥Frontend 并行、静态工具串行（ADR-088）——但存在一个**致命瓶颈**和若干中效瓶颈。

| 严重度 | 瓶颈 | 耗时 | 影响面 | 位置 |
|--------|------|------|--------|------|
| 🔴 P0 | `check-go-diff-coverage` | **81.5s** | 每次 Go 变更推送 | GO_STATIC_TOOLS (hard) |
| 🟡 P1 | `golangci-lint` | 16.8s | 每次 --all/推送 | go-domain |
| 🟡 P1 | ALL_STATIC_TOOLS 串行 | 16.6s | 每次推送（CI + 本地） | static-tools dispatch |
| 🟢 P2 | `css-layer-check` | 4.35s→~2.9s | pre-commit（CSS 变更时，已优化：剔除 .go/.json 语料） | pre-commit prompt |
| 🟢 P2 | `check-deadcode-baseline` | 3.55s | 每次推送 | ALL_STATIC_TOOLS (debt) |
| 🟢 P2 | `jscpd-go` | 2.96s | 每次推送（Go 变更） | ALL + GO_STATIC_TOOLS (debt) |
| 🟢 P2 | `check-redlines --files` | 2.19s | 每次提交 + 推送 | commit-check / pre-push |

## 2. 三层门禁耗时分解

### 2.1 Pre-commit Hook（每次提交）

```
[阶段 1] Gen 同步（-P3 并行）     ~1.9s
[阶段 2] drift check              ~0.2s
[阶段 3] smart-stage              ~0.4s
[阶段 4] staged-domains 分类       ~0.1s
[阶段 5] 非阻断 prompt 段（并行）   ~5.8s (css-layer 4.35s 主导)
[阶段 6] gofmt                     ~0.3s
[阶段 7] biome --write             ~0.3s
[阶段 8] version-defense           ~0.4s
[阶段 9] 3 道硬阻断                ~0.4s (android 0.10s + biome-lines 0.21s + design-tokens 0.09s)
────────────────────────────────────────
总计（阻断路径）                    ~3.3s（阶段 1-4 + 6-9 串行）
总计（含非阻断等待）                ~9.1s
```

**关键发现**：css-layer-check (4.35s) 是 pre-commit 最慢的脚本，但它运行在**非阻断 prompt 段**（stdout 提示不 exit 1），不卡提交。3 道硬阻断合计仅 0.4s，非常快。Gen 同步已并行化（-P3），串行 4.18s → 并行 1.92s。

### 2.2 Commit-with-check（每次提交）

```
check-redlines --files             ~2.2s
doc/knowledge drift --files        ~0.5s（有文档变更时）
contract tests (按域裁剪)          ~2-48s（取决于域数）
twin-siblings --files              ~0.2s
────────────────────────────────────────
总计（无文档变更，单域）            ~4.6s
总计（全量契约测试）                ~52s
```

契约测试全量 48.15s，但 commit-with-check 按域裁剪（`selectContractTests`），通常只跑 1-3 个域。每域测试 ~2-5s。

### 2.3 Pre-push-gate（每次推送，FAST_PUSH=1 默认）

```
Go 域（go build + vet + golangci-lint + gofmt + binding-check）  ~22s
  └ go build ./go/...           2.6s
  └ go vet                      2.1s
  └ golangci-lint --new-from-rev 16.8s  ← 域内瓶颈
  └ binding-check               0.2s
Frontend 域（layering + path-hygiene + ... 9 项）  ~0.7s
  └ vite/tsc/vitest SKIPPED (FAST_PUSH)
  Go ∥ Frontend via Promise.all → max(22, 0.7) = 22s

Data/Docs/Redlines/ADR 域         ~3s
Static tools dispatch（按 plan）   ~17-100s  ← 见下分解
Scripts typecheck                  ~1s
────────────────────────────────────────
总计（仅前端变更）                  ~27s
总计（含 Go 变更）                  ~107s+
```

**Static tools dispatch 分解**（串行执行，ADR-088）：

| 触发条件 | 运行工具集 | 耗时 |
|----------|-----------|------|
| 仅前端变更 | FRONTEND_STATIC_TOOLS (17 项) | 2.67s |
| 仅 Go 变更 | GO_STATIC_TOOLS (3 项) | **84.7s** ← check-go-diff-coverage 81.5s |
| 仅文档变更 | DOC_STATIC_TOOLS (15 项) + DOC_EXTRA | ~5s |
| 全量 (--all) | ALL + FRONTEND + GO + DOC | ~120s+ |

### 2.4 Pre-push-gate --static 模式（CI）

```
ALL_STATIC_TOOLS (40 项串行)       16.61s
FRONTEND 非域裁剪工具              ~2.67s
DOC_EXTRA (knowledge-drift + adr-drift) ~0.5s
Scripts typecheck                  ~1s
────────────────────────────────────────
总计                               ~31.2s (实测)
```

CI 的 --static 模式**不含 GO_STATIC_TOOLS**（schedule.ts 明确排除），所以 CI 门禁反而比本地推送（含 Go 变更）快。

## 3. 瓶颈详解与优化建议

### 3.1 🔴 P0：check-go-diff-coverage.ts — 81.5s

**根因分析**：

脚本对变更的 Go 包执行 `go test -coverprofile`，包含编译 + 测试执行 + 覆盖率分析三个阶段。`--staged` 模式（81.5s）比无参模式（41.8s）更慢，因为暂存区 + 工作区的变更文件并集更大。

**瓶颈机制**：
1. 每次运行都重新编译变更包（无缓存复用）
2. `go test` 执行覆盖了所有变更包的测试
3. coverprofile 解析 + git diff 行对齐 + 豁免分类（rewrite/lifecycle/entry）

**优化方案**（按可行性排序）：

| 方案 | 预期效果 | 复杂度 | 风险 |
|------|---------|--------|------|
| A. 拆分：bare-assert（快）→ CI-only coverage（慢） | 本地 -82s → ~0.5s | 中 | 覆盖率门禁移至 CI |
| B. go test 缓存（hash 变更包源码 → 复用 coverprofile） | 命中时 -80s → ~1s | 高 | 缓存失效策略 |
| C. 缩小 `go test` 范围到仅变更包（当前可能跑依赖包） | -30-50s | 低 | 需验证覆盖率完整性 |
| D. FAST_PUSH 跳过（与 go test 同策略，CI 兜底） | 本地 -82s | 极低 | 覆盖率门禁仅 CI |

**推荐**：方案 D（短期）+ 方案 A（中期）。理由：bare-assert 红线（ADR-202 刀5）是增量断言检查，快且本地可跑；覆盖率是 CI 的职责，与 `go test -race` 同级。

### 3.2 🟡 P1：golangci-lint — 16.8s

**根因**：全项目 Go 代码 lint，即使 `--new-from-rev=HEAD` 只报新问题，仍需扫描全树建立上下文。

**优化方案**：
- 缩小范围到 `./go/... ./internal/app/...`（与 go build 一致），跳过 `./...` 下的 vendored 代码
- 检查 `--timeout` 配置，确认未设过小导致超时误判
- 若无 Go 变更（plan.go === false），直接跳过

### 3.3 🟡 P1：ALL_STATIC_TOOLS 串行 — 16.6s

**根因**：ADR-088 已证明串行（75s）比并行（135s）快——Node.js 进程 spawn 开销在 40 个小脚本中占主导。

**现状**：40 个脚本合计 16.6s，其中 top 3 占 9.6s（58%）：
- `check-deadcode-baseline` 3.55s — 全库死代码分析
- `jscpd-go` 2.96s — Go 重复代码检测
- `check-orphan-exports` 1.19s — 前端孤儿导出检测

**优化方案**：
- `check-deadcode-baseline` 已是 debt 策略（不阻断），可移至 CI_INDEPENDENT_TOOLS
- `jscpd-go` 在无 Go 变更时跳过（plan.go === false）
- 其余 37 个脚本均 <0.7s，串行已是最优

### 3.4 🟢 P2：css-layer-check — 4.35s

**根因**：全量 CSS 层级扫描。pre-commit 已有域裁剪（staged-domains 输出 css-layer 0/1），但触发时仍跑全量。

**优化方案**：
- 支持 `--files` 模式，仅扫描暂存的 CSS 文件
- 或缓存上次结果 + 文件 hash 比对

### 3.5 🟢 P2：check-redlines --files — 2.19s

**根因**：扫描前端源码树检查红线违规。已支持 `--files` 但仍较慢。

**优化方案**：
- 检查是否在 `--files` 模式下仍扫描全树（可能是实现 bug）
- 或接受 2.19s（在可接受范围内）

## 4. 架构优势（已做对的）

| 设计 | 效果 | ADR |
|------|------|-----|
| FAST_PUSH 默认跳过 vite/tsc/vitest/go test | 本地推送 -70s+ | ADR-202 |
| Go ∥ Frontend Promise.all | 前端域 0.7s 被 Go 域 22s 吸收 | — |
| 静态工具串行（非并行） | 40 脚本 16.6s vs 并行 135s | ADR-088 |
| Gen 同步 -P3 并行 | 4.18s → 1.92s | — |
| 契约测试 CI-only | 本地推送 -48s | — |
| 域裁剪（staged-domains + planFromFiles） | 无关检查跳过 | — |
| Budget guard（domain 30s / full 35s） | 超时降级 debt/WARN | — |
| commit-with-check 轻量化 | 提交时不跑重构建 | — |

## 5. 推送路径耗时汇总

```
场景 A：仅前端变更推送
  Go ∥ Frontend     = max(22s, 0.7s)  = 22s   ← golangci-lint 主导
  Static tools      = FRONTEND 2.67s
  其他域             = ~3s
  Scripts typecheck  = ~1s
  ──────────────────────
  总计               ≈ 29s

场景 B：Go 变更推送（当前痛点）
  Go ∥ Frontend     = max(22s, 0.7s)  = 22s
  Static tools      = GO 84.7s         ← check-go-diff-coverage 81.5s
  其他域             = ~3s
  Scripts typecheck  = ~1s
  ──────────────────────
  总计               ≈ 111s  ← 超过 2 分钟

场景 C：全量推送 (--all, YSM_FAST_PUSH=0)
  Go 域 (build+vet+golangci-lint+go test -race) = 22s + 60s+ = 82s+
  Frontend 域 (vite+tsc+vitest)                  = 30s+
  Go ∥ Frontend                                 = max(82, 30) = 82s
  Static tools (ALL+FRONTEND+GO)                 = 120s+
  Contract tests                                 = 48s
  ──────────────────────
  总计                                           ≈ 250s+ (4分钟+)

场景 D：CI --static
  Static tools (ALL+DOC_EXTRA+FRONTEND) = 31.2s
  ──────────────────────
  总计                                  ≈ 31s
```

## 6. 优化路线图

### ✅ 已实施（2026-10-17）

#### 优化 1：check-go-diff-coverage → FAST_PUSH 跳过 + CI 兜底

**文件**：`scripts/_lib/gate-blocks/schedule.ts`（push/files 分支）

**改动**：当 `YSM_FAST_PUSH !== "0"`（默认快速模式）时，从 `GO_STATIC_TOOLS` 过滤掉 `check-go-diff-coverage.ts`，记录 debt 跳过条目。CI `test.yml:545-556` 已有独立步骤（含真实基线 ref + go test cover 产物）兜底。

**效果**：
- 场景 B（Go 变更推送）：`GO_STATIC_TOOLS` 84.7s → 3.2s（jscpd-go 2.96s + coverage-threshold 0.21s）
- 场景 B 总耗时：111s → **~29s**（-74%）
- 逃生阀：`YSM_FAST_PUSH=0` 恢复本地跑

#### 优化 2：golangci-lint 范围收窄

**文件**：`scripts/_lib/gate-blocks/go-domain.ts`（line 221/229）

**改动**：`./...` → `./go/... ./internal/...`

**效果**：
- 扫描包数：47 → 41（排除 root main.go / cmd/* / build/android/scripts/deps / tests）
- 实测耗时：10.5s → **4.0s**（-62%）
- go vet 已覆盖排除的 6 个包，lint 价值低

#### 优化 3：check-deadcode-baseline — 无需改动

核查发现 `check-deadcode-baseline.ts` **已在** `CI_INDEPENDENT_TOOLS` 中（`schedule.ts:36`），--static 模式已剔除。且不在 `FRONTEND_STATIC_TOOLS`（gate-config.ts:330 注释明确排除）。仅 `--all`（doctor）模式运行，本地 push 路径不触及。无需优化。

### 优化后推送耗时汇总（FAST_PUSH 默认）

```
场景 A：仅前端变更推送
  Go ∥ Frontend  = max(22s, 0.7s) = 22s  (golangci-lint 4.0s + go build 2.6s + go vet 2.1s + ...)
  Static tools   = FRONTEND 2.67s
  其他            = ~3s
  ──────────────────────
  总计            ≈ 29s  (优化前 ~29s，无变化)

场景 B：Go 变更推送（优化重点）
  Go ∥ Frontend  = max(22s, 0.7s) = 22s  (golangci-lint 4.0s ← 优化2)
  Static tools   = GO 3.2s         (check-go-diff-coverage 跳过 ← 优化1)
  其他            = ~3s
  ──────────────────────
  总计            ≈ 29s  (优化前 ~111s，-74%)
```

**核心收益**：Go 变更推送从 ~111s 降至 ~29s，与前端变更推送持平——消除了 Go 变更的惩罚性等待。

### 后续可选优化（未实施）

6. **check-redlines --files 模式核验** — 已实测确认：无论传什么 `--files`，脚本始终扫全树（--files 仅过滤基线比对）。这是每 commit 必经的阻断成本（commit-check.ts:83），体量 2.4s，但改真·scoped 需把 args.files 注入多个 rgTracked 调用、回归风险高，暂不做。
7. **jscpd-go 在无 Go 变更时跳过** — plan.go=false 时跳过（GO_STATIC_TOOLS 已受 plan.go 守卫，无 Go 变更不跑）。

## 7. 结论

门禁系统的**架构设计是优秀的**——三层分工、域裁剪、FAST_PUSH、串行静态工具——这些决策在 ADR-088/ADR-202 中有据可查且经实践验证。

本次优化实施了三个高投入产出比改动：
1. **check-go-diff-coverage 跳过**（-82s/次 Go 推送）—— 与 go test -race / 契约测试同口径，CI 独立步骤已兜底
2. **golangci-lint 范围收窄**（-6.5s/次 Go 推送）—— 排除入口/脚本/测试包，go vet 已覆盖
3. **css-layer-check 死 CSS 语料收窄**（-1.5s：4.35s → ~2.9s 实测；理论最小 ~0.9s，剩余耗时在 findDeadCssClasses 对 27MB 语料的正则扫描，非语料读取）—— 剔除 .go/.json 扩展名（占语料 82MB 的 66%，且二者本就不是前端类名消费者），并把剔除后浮出的遗留死类 `.vb`（transitions.css 过渡规则组，前端无引用）登记进既有 KNOWN_DEAD_CSS_EXEMPT 集；检测语义零变化（`DIFF: []` 已验证）；常量迁至 _lib/css-layer-utils.ts 并由 test_css_layer_check.ts 第 12 组断言钉死，防收窄被意外复辟。

合计将 Go 变更推送从 ~111s 降至 ~29s（-74%），与前端变更推送持平，消除了 Go 变更的惩罚性等待；pre-commit 最慢提示项 css-layer-check 同步收窄。

其余瓶颈（deadcode-baseline 3.55s、check-redlines 2.4s）均在可接受范围内，且 deadcode-baseline 已通过 CI_INDEPENDENT_TOOLS 机制移交 CI 独立步骤。
