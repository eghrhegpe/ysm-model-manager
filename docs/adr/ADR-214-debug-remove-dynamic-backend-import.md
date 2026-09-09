# ADR-214：debugGetSpec 控制台钩子搬离 debug.ts——职责纯度回归

- **状态**：✅ 已采纳
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-189`（src/core 准入准则 D4）、`ADR-203`（平台门控归位 backend）

---

## 1. 背景（Context）

`frontend/src/utils/debug/debug.ts` 当前在模块顶层挂载 `window.debugGetSpec` 钩子：

```ts
if (typeof window !== "undefined") {
  window.debugGetSpec = async (path?: string): Promise<unknown> => {
    try {
      const { getApp } = await import("@/backend/app.ts");
      const { GetModel3DSpec } = await getApp();
      ...
```

**问题**：

1. **职责不纯**：`debugGetSpec` 是开发期便利钩子（控制台手动调用），不属于 debug 工具的核心职责（`dbg()` / `safeStr()` / `isDebugEnabled()`）。`debug.ts` 作为 layer-0 叶子工具，不应绑定 backend 桥——无论静态还是动态 import，utils 层引 backend 本身就是反向依赖。

2. **启动耦合**：`debugGetSpec` 挂载在 `window` 上，模块顶层 `if (typeof window !== "undefined")` 无条件执行——意味着只要 `debug.ts` 被 import（全库皆如此），`window.debugGetSpec` 就存在，但它内部绑定了 backend 桥。如果 backend 加载失败（Go 未就绪），`debugGetSpec` 在调用时才暴露问题。

3. **测试污染**：`debugGetSpec` 引用了 `GetModel3DSpec`，测试 `debug.ts` 时若未 mock `@/backend/app.ts`，可能触发真实 backend 调用链。

**关于门禁的澄清**：`check-layering` R5 只管 features 层（禁 features→backend），**utils→backend 不在其射程**。`check-circular.ts` 覆盖动态 import，但此处无环。所以「门禁兜底失效」不是真实论据——真实论据是**职责纯度**：debug 叶子工具不该绑桥，钩子生命周期应由装配层管理。

## 2. 决策（Decision）

### 2.1 移除 debugGetSpec 从 debug.ts

`debug.ts` 精简为纯 debug 工具函数：
- `dbg(tag, ...args)` — 保留
- `safeStr(v)` — 保留
- `isDebugEnabled()` — 保留
- `window.debugGetSpec` — **移除**

### 2.2 控制台钩子移至装配层

`debugGetSpec` 挂载逻辑搬到 `frontend/src/app-modules.ts`（装配层，负责启动链编排）。复用 app-modules 现成的 `_devMode` 模式（`?dev=1` / `_devtools`，F12 devtools 同款判定），不发明第二个 debug 开关：

```ts
// app-modules.ts 启动链中（dev 模式 + 桌面/网页通用）
import { isDebugEnabled } from "@/utils/debug/debug.ts";

if (_devMode && isDebugEnabled()) {
  window.debugGetSpec = async (path?: string): Promise<unknown> => {
    try {
      const { getApp } = await import("@/backend/app.ts");
      const { GetModel3DSpec } = await getApp();
      const spec = await GetModel3DSpec(path || "");
      dbg("model3d", "spec:", spec);
      return spec;
    } catch (e) {
      console.error("[DEBUG]", e);
      return null;
    }
  };
}
```

**关键改进**：
- `_devMode` 复用现有判定（`?dev=1` / `_devtools`），不引入新 URL 参数
- `isDebugEnabled()` 保留 `?nodebug=1` 关闭能力
- 动态 import 有 try/catch 兜底，`check-dynamic-import.ts` 不会报「无失败处理」

### 2.3 接口注入（备选）

如果多个模块需要注册 debug 钩子，可引入 sink 模式。但当前仅 `debugGetSpec` 一个钩子，直接搬入 `app-modules.ts` 更简洁。暂不引入 sink，留作后续扩展点。

## 3. 后果（Consequences）

### 正面
- `debug.ts` 回归纯工具层（~80 行），零上层依赖，职责单一
- 测试 `debug.ts` 不再需要 mock backend 桥
- `debugGetSpec` 挂载延迟到装配期，与 backend 启动链对齐
- 复用 `_devMode` 判定，不引入新开关

### 负面
- `app-modules.ts` 增加 ~15 行 debug 钩子挂载逻辑——但装配层本就负责启动链编排，职责匹配
- 控制台调用 `window.debugGetSpec` 时若 backend 未就绪，需等待——但这是预期行为（dev 工具）

### 风险
- `window.debugGetSpec` 在 `app-modules.ts` 中挂载，若 `app-modules.ts` 被 tree-shaking 或条件加载影响——但 `app-modules.ts` 是应用入口，不会被 shake

## 4. 实施计划

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `debug.ts` | 删除 `if (typeof window !== "undefined")` 块（`debugGetSpec` 定义） |
| 2 | `debug.ts` | 删除 `declare global` 中 `debugGetSpec` 类型声明（或移至 `app-modules.ts`） |
| 3 | `app-modules.ts` | 在启动链中增加 `debugGetSpec` 挂载逻辑（`_devMode && isDebugEnabled()` 条件） |
| 4 | `debug.ring.test.ts` | 确认无 `debugGetSpec` 相关断言（如有则移除） |
| 5 | `app-modules.test.ts` / `boot.test.ts` | 新增 `debugGetSpec` 挂载测试（如需要） |
| 6 | 验证 | `npx vite build && npm run typecheck && npx vitest` |
| 7 | 提交 | `node scripts/commit-with-check.ts -m "refactor: debugGetSpec 钩子搬离 debug.ts 到装配层"` |

## 5. 数据溯源

- 当前文件：`frontend/src/utils/debug/debug.ts`
- 问题代码：`debugGetSpec` 定义 + `Window` interface 中的 `debugGetSpec` 类型声明
- 全局类型：`Window` interface 中的 `debugGetSpec` 声明
- 装配层：`frontend/src/app-modules.ts`（StartupStep 模式现成）
- 测试：`debug.ring.test.ts`、`app-modules.test.ts`、`boot.test.ts`
- Go 绑定：`GetModel3DSpec`（binding 生成）
