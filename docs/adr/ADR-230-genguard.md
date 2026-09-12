# ADR-230：GenGuard 统一收敛：内建状态源为唯一出口，外部状态源模式退役

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-12
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - 代码：`frontend/src/utils/async/load-guard.ts`（收敛目标，唯一出口）、`frontend/src/views/app-preview/gen-guard.ts`（迁移源①）、`frontend/src/views/app-content/diagnostics/perf-common.ts`（迁移源②）、`frontend/src/views/app-tree/bus-handlers.ts`（迁移源③）、`frontend/src/views/app-tree/index.ts` / `events.ts` / `toolbar-events.ts`（raw `_gen` 散落 22 处）
  - 知识卡：`docs/knowledge/frontend_design_critique.md` §动刀进度 刀⑮「未动」第 1 项（GenGuard 4 套并存）

---

## 1. 背景（Context）

全仓存在 **4 套代际守卫实现**，语义同构（`next`/`stale`/`invalidate` 三件套），但形态各异、散落两处：

| 实现 | 位置 | 状态源 | 形态 | 消费者 |
|------|------|--------|------|--------|
| `class GenGuard` | `views/app-preview/gen-guard.ts`（35 行） | **内建**（`#gen` 私有字段） | class + `current` getter | app-preview 域 6 文件 |
| `createLoadGuard()` | `utils/async/load-guard.ts`（25 行） | **内建**（闭包 `let gen`） | factory + 接口 | `features/oldest-models`、`features/recycle-bin` |
| `makeGenGuard(seqRef)` | `views/app-content/diagnostics/perf-common.ts:86-94` | **外借**（读外部 `seqRef.current`） | 函数工厂，返回 `{gen, stale()}` | `perf-single-bench` / `perf-gui-flow` / `perf-log` |
| `atBeGenGuard(vm, gen)` | `views/app-tree/bus-handlers.ts:20-22` | **外借**（读外部 `vm._gen`） | 包装函数 | 仅 reload 路径 |

外加 **app-tree 侧 22 处 raw `_gen` 散落**（4 文件：`index.ts` / `events.ts` / `toolbar-events.ts` / `bus-handlers.ts`，11 处比较 + 4 处自增 + 7 处捕获，`index.ts:100` 声明），是 `atBeGenGuard` 的宿主。

**问题**：
1. `GenGuard`（class）与 `createLoadGuard`（factory）语义等价，仅形态差异——`current` getter 只被 1 处测试消费，非生产依赖；重复维护两套无必要。
2. `makeGenGuard` / `atBeGenGuard` 是「**外部状态源**」模式：自身不持有代数，读调用方传入的外部计数器。与内建模式**架构不兼容**——强行套进 `createLoadGuard` 签名（`next()` 自增）会破坏"外部自增"语义；要收敛须先把消费方改造为自持 guard，这是宿主 class/模块重构。
3. app-tree 22 处 raw `_gen` 是同一问题的极端形态：`AppTree` class 直接暴露 `public _gen`，4 个文件各自读/写/比较，无统一守卫对象。

刀⑮（`frontend_design_critique.md`）将「4 套并存」列为未动项，判语「收敛面大宜先立 ADR」——本 ADR 即该拍板。

## 2. 决策（Decision）

**收敛目标**：`createLoadGuard()`（`utils/async/load-guard.ts`）为全仓**唯一代际守卫出口**；`GenGuard` class 与 `makeGenGuard` 函数退役（过渡期可留适配层再删）。

**三条决策**：

### D1. 内建状态源模式归一

`GenGuard`（`views/app-preview/gen-guard.ts`）整体迁移为 `createLoadGuard()`：
- 6 个消费者文件 `import { GenGuard } from .../gen-guard.ts` → `import { createLoadGuard } from "@/utils/async/load-guard.ts"`；构造点 `new GenGuard()` → `createLoadGuard()`
- 语义映射无损：`next()`/`stale(g)`/`invalidate()` 一一对应；`GenGuard.current` getter 仅被 `gen-guard.test.ts` 1 处消费——迁移时补 `LoadGuard` 接口一个 `get current(): number`（factory 闭包返回对象加一个 getter，零成本），测试改写后 `gen-guard.test.ts` 并入 `load-guard.test.ts` 后删除 `gen-guard.ts`
- `utils` 层是更低的层（views 可引 utils，反向禁止——check-layering R1），放置方向合规

### D2. 外部状态源模式退役，宿主自持

`makeGenGuard`（perf-common）与 `atBeGenGuard`（app-tree bus-handlers）的「读外部计数器」语义**退役**——宿主改为自持 guard：
- **perf-common**：3 个调用方（perf-single-bench / perf-gui-flow / perf-log）各自持有 `seqRef` 共享同一外部 seq → 改为调用方自持 `createLoadGuard()`，`makeGenGuard(seqRef)` 及其 `GenGuard` 接口（`perf-common.ts:86-94`）删除；若 3 调用方确需共享同一计数器（需核实），共享的是「一次 bench 会话」语义，应提升为该会话对象上的单个 guard 字段，而非自由函数外部参数
- **app-tree**：`AppTree` class 加 `private _guard = createLoadGuard()` 字段（`index.ts:100` 的 `_gen = 0` 声明替换）；22 处 raw `_gen` 逐点映射：
  - 4 处自增 `++this._gen` → `this._guard.next()`（其中 3 处 `const gen = ++this._gen` 的捕获合并进 `next()` 返回值）
  - 11 处比较 `gen !== this._gen` / `gen === this._gen` / `atBeGenGuard(vm, gen)` → `this._guard.stale(gen)` / `!this._guard.stale(gen)`
  - 7 处纯捕获 `const gen = this._gen` → `this._guard.current`（接口补 `current` 后）
  - `bus-handlers.ts` 的 `atBeGenGuard` 包装函数整体删除（其语义 = `vm._guard.stale(gen)`，直接内联）
- 测试适配：`events.test.ts:107` 假 vm 的 `_gen: 0` 字段 → 假 vm 加 `_guard` mock；`index.extra.test.ts:309/317` 的 `(el as unknown as { _gen: number })._gen += 1` 篡改手法 → `(el as unknown as { _guard: LoadGuard })._guard.invalidate()`（等价语义：作废全部在途代）

### D3. 迁移顺序（一次动作，防二次重构）

①②③ **同一次提交/会话内完成**，不拆三次 PR——拆开会反复重构 `AppTree` class 与 perf 三兄弟：
1. `load-guard.ts` 补 `current` getter（接口 + 实现 + 测试）
2. `GenGuard` → `createLoadGuard`（app-preview 域 6 文件 + 测试合并）
3. `makeGenGuard` 退役（perf-common 删除 + 3 调用方改自持）
4. `AppTree` 加 `_guard` + 22 处替换 + `atBeGenGuard` 删除 + 测试适配
5. 跑 views 全量测试（81 文件 ~1100+ 用例）+ typecheck + vite build + check-layering 全绿

**明确排除（不做的）**：
- 不给 `LoadGuard` 加 abort/取消语义——现有 4 套均只有代数比较，无 Promise 取消；引入 cancel token 是新功能，超本 ADR 范围（oldest-models/recycle-bin 现状即不依赖）
- 不动 `utils/async/load-guard.ts` 文件位置——它是合规的 utils 层出口，无需迁移

## 3. 后果（Consequences）

**正面**：
- 代际守卫全仓单一事实源（`createLoadGuard`），新代码不再面临「用哪套」的选择
- 消除 4→1 的形态碎片：class / factory / 外部 seq 函数 / 裸包装 4 种写法收敛为 1 种
- app-tree 的 `public _gen` 收为 `private _guard`，守卫对象化后 4 文件散落读写失去载体（外部要作废只能经对象方法）
- 与既有 `LoadGuard` 消费方（oldest-models / recycle-bin）无行为差异，回归面小

**负面 / 成本**：
- 爆炸半径：~13 个生产文件 + ~6 个测试文件（app-preview 6 文件 / perf 3 文件 / app-tree 4 文件 + 各自测试）
- `AppTree` 的 `public _gen` 是测试既有的篡改入口（`index.extra.test.ts`），改私有需同步改测试手法——本 ADR D2 已给出等价改写
- 外部状态源 → 内建的语义变化点：`makeGenGuard` 的「共享外部 seq」若实为跨文件共享（核实点 D2），改自持后共享需显式提升到会话对象，有一处设计决策要在实施时落定

**已知遗留**：
- `GenGuard.current` 补进 `LoadGuard` 接口后，接口从 3 方法变 4——既有 2 消费方（oldest-models / recycle-bin）零改动（新增 getter 不破坏兼容）
- perf 三兄弟是否真共享 seq 需实施时核实（`grep seqRef`），共享则按 D2 提升，独立则纯替换

## 4. 数据溯源

<!-- TODO: 来源 → 结果 -->
- 核实来源：`frontend_design_critique.md` 刀⑮「未动」清单（2026-09 三子代理只读审核沉淀）；本 ADR 创建前主模型 + 子代理对 4 套实现与 22 处 raw `_gen` 逐点实地核实（文件:行号 全量定位），统计与卡原文吻合（11 比较 / 4 自增 / 7 捕获 / 4 文件）
