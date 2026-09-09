# ADR-216：域状态订阅提级原语层：createListenerSet

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/base/primitives/、frontend/src/features/community/download-queue-store.ts、frontend/src/preview-3d/caps/scene-capability.ts`

---

## 1. 背景（Context）

「订阅 / 通知」在仓内有三套并存机制：

| 机制 | 位置 | 语义 |
|---|---|---|
| `bus` | `frontend/src/bus.ts` | 类型化**全局事件流**（payload = 事实/增量），emit 对 handler 包 try/catch |
| 手搓 Set | `frontend/src/features/community/download-queue-store.ts`（`listeners`） | **状态快照订阅**：`subscribe(fn: (s: DownloadState) => void)`，notify 传活体 STATE 引用 |
| `createListenerSet` | `frontend/src/preview-3d/caps/scene-capability.ts` | **无参变更通知工厂**（ground / water / scene 样板收敛，已有 3 用例） |

前提澄清（锐评修正）：`core/page-store.ts` 是 46 行页面路由纯函数模块（文件头明示「不持有状态、不镜像」），**并非通用状态容器**——域状态订阅此前没有公共基座可收口，于是 `download-queue-store` 与 `scene-capability` 各自手搓了两套监听器 Set（「双订阅哲学」批评的真实落点）。

## 2. 决策（Decision）

把**已被 3D 域验证**的 `createListenerSet` 工厂提级为 `utils/base/primitives/listener-set.ts` 共享原语，并泛型化 payload 形态：

- 签名：`createListenerSet<T = void>()` → `{ subscribe(fn: (payload: T) => void): () => void; notify(payload?: T): void }`。
  - 无参场景（scene/ground/water）：`createListenerSet()` + `notify()`，`T = void` 零改动；
  - 状态订阅场景（download-queue-store）：`createListenerSet<DownloadState>()` + `notify(STATE)`，`subscribe` / `notify` 对外 API 形状不变（薄包装），消费者零改动。
- 落点 `utils/base/primitives/` 而非 `core`：零上层依赖满足 primitives 红线；与 `lock.ts` / `disposable.ts` 同为「资源句柄」族。core 准入三条虽满足但 core 现为 i18n / page-store / error-diary 三件套，为 2 个消费方扩核属 YAGNI。
- **否决收口到 `bus`**：三重语义失配——① bus emit 吞 handler 异常（console.error），store notify 直接传播；② 活体 STATE 引用进全局事件流即给「单一写入纪律」（ADR-187 D3：STATE 修改必须经 store 写函数）开门——模块本地通道的保护力正是纪律的载体；③ 域状态 payload 稀释进全局 `BusEvents` 类型表。`bus` 保持「跨模块事件流」，`listener-set` 承载「域内订阅」，两层语义边界。

## 3. 后果（Consequences）

**正面**

- 手搓监听器 Set 2 → 0；订阅原语统一为一套共享工厂，回归护栏（`listener-set.test.ts`）单一事实源。
- 单一写入纪律不变：`download-queue-store` 的 STATE 写入仍全部经模块导出写函数，仅通知通道换装。

**负面 / 代价**

- `scene-capability.ts` 移除 `createListenerSet` 导出，`ground-capability.ts` / `water-capability.ts` 改从 primitives import（多一条依赖边，均向下，check-layering 合法）。
- `download-queue-store` 新增 `@/utils/base/primitives/listener-set.ts` 依赖（features → utils 有既成先例，`primitives/async.ts` 已在用）。

**已知遗留**

- `preview-3d/menu/env.test.ts` 测试工具手搓 Set 属测试域，不收敛。
- 若未来第三消费方出现「带 payload + 事件流」语义的域内订阅需求，再评估 core 是否需要状态容器原语（本 ADR 不预支）。

## 4. 数据溯源

- `download-queue-store.ts` `listeners`（`new Set<(s: DownloadState) => void>`）+ `subscribe` / `notify` → 「第二套手搓 Set」结论
- `scene-capability.ts` `createListenerSet` 定义 + `ground-capability.ts` / `water-capability.ts` 消费 + `scene-capability.test.ts` 3 用例 → 「工厂已验证，提级而非新设计」结论
- `bus.ts` `emit` 的 handler try/catch（吞错 → console.error）与 `BusEvents` 全局类型表 → 否决收口 bus 论据
- `core/page-store.ts` 文件头「本模块只提供共享纯函数…不持有状态、不镜像」 → 前提修正（page-store ≠ 通用状态容器）
- AGENTS.md「src/core 准入准则（ADR-189 D4）」三条 + core 现状三件套 → 落点 primitives 而非 core 论据
- ADR-187 D3 单一写入纪律（download-queue-store 文件头） → 「模块本地通道是纪律保护力」论据

<!-- 文件名: listener-set-primitive.md → 实际文件 ADR-216-listener-set-primitive.md -->
