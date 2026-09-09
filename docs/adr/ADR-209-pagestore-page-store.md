# ADR-209：移除 PageStore 孤儿状态机，page-store 收敛为纯函数模块

- **状态**：已采纳（Accepted）
- **实施状态**：已落地（源码 + 测试 + 文档 + 治理脚本同步；知识卡随 pre-commit 自动再生）
- **日期**：2026-09-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-207（命名裁决，原 PageStore/registerPageStore 保留项被本 ADR 取代）、docs/knowledge/page-store.md、frontend/src/core/page-store.ts

---

## 1. 背景（Context）

`frontend/src/core/page-store.ts` 原含三部分：
1. 纯函数 `isValidPage`（运行时页面名守卫）与 `resolveInitialPage`（启动初始页解析）；
2. 模块级状态机 `PageStore.currentPage`（getter）+ 闭包 `pageState`；
3. `registerPageStore(unsubs)`：订阅 `bus "nav:changed"` 写入闭包。

经 grep 实证（已过滤测试 / 覆盖率 / 构建产物，`frontend/src` 范围）：
- `PageStore.currentPage` 生产读取方为 **零**（仅出现在 `*.test.ts` mock）；
- `registerPageStore` 唯一生产调用点在 `app-content/index.ts:104`，但其 listener 仅做 `pageState.set(page)`——写进一个无人读取的闭包，纯 no-op；
- 真正被生产消费的符号只有 `isValidPage` 与 `resolveInitialPage`。

导航事实由事件总线 `bus "nav:changed"` 承载，app-nav / app-content 各自订阅并维护自身状态。`PageStore` 是 bus 之上的冗余镜像，且因无人读取而沦为写-only 幽灵。

冲突点：ADR-207:49 曾显式「保留 `PageStore/registerPageStore`」，理由为改名纯 churn；该裁决未论及「零读者」这一新证据，故需本 ADR 取代其保留项。

## 2. 决策（Decision）

采用方案 B（删虚拟）：
- **删除** `pageState` 闭包、`PageStore` 对象、`registerPageStore`；
- **保留** `VALID_PAGES` + 编译期覆盖断言 `_AssertPageCoverage`、`isValidPage`、`sanitizePage`（内部）、`resolveInitialPage`；
- `page-store.ts` 收敛为引擎无关、无状态、纯函数模块（仍满足 ADR-189 D4 core 准入：不 import three/Wails、不依赖上层）。

否决方案 A（给真消费者）：让组件改读 `PageStore.currentPage` 需补 subscribe/notify，等于在 bus 旁再造 bus，与事件驱动 spine 冲突，且仍留双源。否决方案 C（仅加 logWarn）：不消除死代码，仅固化嫌疑。

## 3. 后果（Consequences）

**正面**
- 消除写-only 死代码（~37 行）+ 一个无副作用的 bus listener；
- 模块语义更诚实：纯函数、无隐藏状态，core 准入更干净；
- 文档 / 知识卡 / 治理脚本不再维护「状态唯一来源」的错误宣称。

**负面 / 成本**
- 同步 1 处消费调用（app-content）、2 个测试文件、知识卡、architecture.md、UI-Design.md、check-redlines.ts；
- ADR-207 保留项需标注「被取代」。

**已知遗留**
- app-nav（`_current`）/ app-content（`state.current`）仍各自持有当前页，由 `nav:changed` 事件驱动收敛——此为既有事实，非本次引入；本 ADR 仅移除第三方冗余镜像，不重构该双源。
- `PageName` 双源（bus.ts 联合 + page-store `VALID_PAGES`，satisfies 断言兜底）维持现状（同 ADR-207 遗留）。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| grep `PageStore.currentPage` / `registerPageStore` 于 `frontend/src`（排除 `*.test.ts`） | 生产零读取；唯一调用 `app-content/index.ts:104` 为 no-op 写入 |
| `frontend/src/core/page-store.ts` 源码审查 | listener 仅 `pageState.set(page)`，无其它副作用 |
| ADR-207:49 | 原保留项，被本 ADR 取代 |

<!-- 文件名: pagestore-page-store.md → 实际文件 ADR-209-pagestore-page-store.md -->
