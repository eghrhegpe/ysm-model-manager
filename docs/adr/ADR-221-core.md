# ADR-221：跨视图共享状态归位 core 以消除视图域环

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/core/model-path-store.ts, frontend/src/views/app-content/init-pages.ts, frontend/src/views/app-tree, frontend/src/views/app-nav, frontend/src/views/app-preview`

---

## 1. 背景（Context）

「最近选中模型路径」（`rememberModelPath` / `getLastModelPath`）是一份跨视图共享态，却寄居在 `views/app-content/init-pages.ts` 内。一处错位引发两类结构病变：

- **越权访问**：三个视图域伸手进 app-content 私有模块取用——`app-tree/index.ts`、`app-tree/events.ts` 静态 import；`app-preview/index.ts`、`app-nav/index.ts` 经 `await import` 动态绕过。`init-pages.ts` 因此从「页面装配器」退化为「装配器 + 全局状态仓库」的兼职袋，并携带 `__resetLastModelPathForTest` 这类测试钩子，作为模块级状态泄漏的止痛药。
- **视图域成环**：`app-content/index.ts` 副作用导入 `@/views/app-preview/index.ts`（注册组件），而 `app-preview/index.ts` 又动态回指 `init-pages.ts`，构成 `app-content → app-preview → app-content` 环。动态 import 只把硬环拆成软环，环本身靠「谁先加载谁别炸」的时序维持，在 HMR 与测试 mock 下脆弱。

该状态引擎无关、零 Wails、零 DOM 依赖，符合 ADR-189 D4 的 core 准入三条，本就该住在 `core`。

## 2. 决策（Decision）

把跨视图共享态归位 `frontend/src/core/model-path-store.ts`：

- `_lastModelPath` 模块级状态 + `rememberModelPath` / `getLastModelPath` / `__resetLastModelPathForTest` 三函数整体迁入 core（引擎无关内存态，与 `core/page-store.ts` 同类）。
- `views/app-content/init-pages.ts` 摘除该状态段，回归单一职责（页面装配器）。
- 四个消费点统一改为 `@/core/model-path-store.ts`：app-tree 两处静态 import 直改；app-preview / app-nav 两处 `await import` 改为顶部静态 import——核心态不牵拉装配链，动态加载的唯一理由随之消失。
- 测试跟随被测单元：用例迁入 `core/model-path-store.test.ts`；原 `app-content.methods.test.ts` 的重复用例删除；两处 `vi.mock` 路径同步。

**边界限定**：本 ADR 只处理「共享态归位」。「app-content → app-preview」的组件注册装配边保留——它承载 `customElements.define` 的装配职责，单向且合法。若后续要进一步解耦，应把注册上移至装配层（`app-modules.ts` 的 `loadView` 范式），另行决策。

## 3. 后果（Consequences）

正面：

- 三条越权边（app-tree ×2 / app-nav / app-preview）全断；`app-content ↔ app-preview` 环随之消失——回边的唯一来源就是 app-preview 对 init-pages 的引用。
- `init-pages.ts` 卸下第二重身份，不再需要测试钩子为其背书。
- 状态落 core 后可由纯单测覆盖，不再依赖 app-content 的装配环境。

负面 / 已知遗留：

- `core` 新增一份模块级可变状态。core 现有 `page-store`（无状态纯函数）与 `error-diary`（注入式），本模块是首个「就地持有状态」的 core 成员。后续若此类状态增多，应评估统一收敛为显式 store，避免 core 退化为状态垃圾桶。
- 状态仍是模块级单例，测试隔离依赖 `__resetLastModelPathForTest` 钩子（isolate:false 共享模块图下的既有约束，本次未改变）。
- `app-content → app-preview` 装配边仍在（见 §2 边界限定）。

## 4. 数据溯源

来源 → 结果：

- `grep -rn "@/views/app-content/init-pages" frontend/src` → 改造前 7 处（生产越权 4 处 + 测试 mock/import 3 处），改造后零残留。
- `grep -rn "rememberModelPath\|getLastModelPath" frontend/src` → 消费者穷举为 app-tree / app-nav / app-preview 三域，无第四方。
- `frontend/src/bus.ts:70 BusEvents`、`:126 BusEventName`、`:149` 泛型 `on<K extends BusEventName>` → 事件名编译期约束**已存在**（27 事件 100% 在表内），故本 ADR 不涉及「事件名类型化」议题。
- `frontend/src/core/page-store.ts` → core 内同类纯状态模块先例，归位有据。

<!-- 文件名: core.md → 实际文件 ADR-221-core.md -->
