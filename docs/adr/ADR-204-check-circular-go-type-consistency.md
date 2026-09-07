# ADR-204：废弃 check-circular-go 与收敛 type-consistency 为派生守卫

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-08
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/check-circular-go.ts`、`scripts/type-consistency.ts`、`scripts/_lib/gate-config.ts`、`scripts/pre-push-gate.ts`、`go/types/registry/resource_types_consistency_test.go`；取代 `ADR-086` §2.3 第 69 行（type-consistency 保留项）与 §4.1 第 198 行 / §4.2 P4（check-circular-go）

---

## 1. 背景（Context）

治理审计发现两个「常绿」门禁，名义职责已随架构演进失效：

### 1.1 type-consistency — JSON↔JS 比对死代码
`type-consistency.ts` 原做 `resource_types.json ↔ extensions.ts` 字面量比对。T2（schema.ts 单一解析入口，ADR-014）后 `extensions.ts` 改为构建期从 `schema.ts` / `resource_types.json` 派生（`Object.fromEntries`），不再手写 `RESOURCE_EXTS` 字面量。

后果：`readJsExtensions()` 派生完好即返回 `null`、派生被破坏即 `throw`(fatal)——`jsTypes !== null` 的 JSON↔JS 比对分支（87–120 行）在**任何路径都不可达**，正常态恒绿。

### 1.2 check-circular-go — 与 go build 冗余
`pre-push-gate.ts:470` 已跑 `go build ./go/...`，Go 编译器在编译期即拒绝包级 import 循环（struct 级互引环同样被编译器拒）。`check-circular-go.ts` 仅提供「不依赖完整编译的可读环链」，无独立约束力，属重复卡点。

### 1.3 关键修正
用户初判「派生被改坏会被 tsc 先抓」不成立：手写 `export const RESOURCE_EXTS = {...}` 是合法 TS，`tsc` 抓不到；当前唯一拦截它的就是 `readJsExtensions` 正则守卫（fail-closed）。故该守卫**非冗余、有真实价值**，不可随比对逻辑一并删。

## 2. 决策（Decision）

| 脚本 | 决策 | 理由 | 翻转条件 |
|------|------|------|----------|
| type-consistency | **收敛为「单一事实来源派生守卫」** | 删除不可达的 JSON↔JS 比对块（87–120 行）+ 冗余的 `dup_id` 检查（已由 `go/types/registry/resource_types_consistency_test.go:53` 覆盖）；保留 `readJsExtensions` 派生守卫（fail-closed，拦手写副本回潮）。继续挂在数据域门禁（pre-push-gate:711） | 若 extensions.ts 改为非派生写法且需新契约守护 → 评估构建期断言 |
| check-circular-go | **废弃（删文件 + 去门禁接线）** | 与 `go build ./go/...` 完全冗余，无独立约束力；`scripts/_lib/cycles.ts` 共享核心保留（仍被前端 `check-circular.ts` 使用） | 若 go build 不再覆盖某类环（如泛型/embed 特殊环）→ 重新引入定向检测 |

## 3. 后果（Consequences）

**正面**：
- type-consistency 不再是「常绿」——名义职责（死比对）移除，仅余真实 fail-closed 派生守卫，能真 FAIL。
- 移除一个与 `go build` 重复的 Go 门禁，门禁清单瘦身，维护面收敛。
- 单一事实来源（ADR-014/T2）红线仍由派生守卫兜底，未留下保护真空。

**负面 / 风险**：
- 🟢 type-consistency 现仅守「extensions.ts 必须派生」单点；若未来派生链路重构（如改走新入口），需同步更新正则——已是 fail-closed，误改即阻断，风险可控。
- 🟢 check-circular-go 删除后，包级环仅由 `go build` 守；编译器拒环是强约束，无降级风险。

**已知遗留**：
- `orphan-classify.test.ts:71` 仍用 `'check-circular-go.ts'` 作分类单测的兄弟文件名样例——为纯字符串 mock，不依赖磁盘真实文件，删除真实文件不影响该测试，保留以守护分类逻辑。

## 4. 数据溯源

来源：治理审计 `type-consistency.ts:84` / `pre-push-gate.ts:470` 两处「常绿」标记 → 核查 `readJsExtensions` 返回值路径（确认比对分支不可达）+ `go/types/registry/resource_types_consistency_test.go:53`（dup_id 已由 Go 覆盖）+ `go build` 编译期拒环实证 → 决策：type-consistency 收敛为派生守卫、check-circular-go 废弃 → 本 ADR 取代 ADR-086 相关保留项。

<!-- 文件名: check-circular-go-type-consistency.md → 实际文件 ADR-204-check-circular-go-type-consistency.md -->
