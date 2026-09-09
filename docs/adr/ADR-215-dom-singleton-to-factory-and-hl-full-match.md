# ADR-215：dom 单例模式改工厂 + html hl 全匹配高亮

- **状态**：✅ 已采纳
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-189`（src/core 准入准则 D4）、`ADR-044`（存储与隐私模式）

---

## 1. 背景（Context）

`frontend/src/utils/dom/` 下有三个文件使用**模块级可变单例状态**：

| 文件 | 单例变量 | 问题 |
|------|---------|------|
| `tooltip.ts` | `st: TooltipState` + `_observer` + `_scrollHandler` + `_scrollRef` | 4 个模块级变量 + ref-count 手动管理，HMR 时 `_scrollRef` 不归零 |
| `focus-restore.ts` | `_triggerStack: HTMLElement[]` | 异常路径泄漏，`MAX_TRIGGER_STACK=10` 日志无人看 |
| `input-block-stack.ts` | `_inputBlockStack: Map<string, number>` | 菜单/弹窗 push 后异常不 pop 则永久阻断 |

此外，`html.ts` 的 `hl()` 函数仅高亮**首次**命中，搜索场景需要全匹配。

**共性问题**：模块级单例在工具函数中是反-pattern——HMR 状态残留、测试间污染、异常路径泄漏。

**tooltip 单例是设计而非事故**：文件头声明「同一时刻至多一个 tooltip 可见」——这是有意的单可见语义。工厂模式若在生产多开会破此语义，需显式约束。

## 2. 决策（Decision）

### 2.1 tooltip.ts — 工厂模式 + 默认实例

将单例状态封装为 `createTooltipManager()` 工厂：

```ts
export interface TooltipManager {
  attachTooltip(el: HTMLElement, getText: string | (() => string), opts?: TooltipOptions): () => void;
  promoteTitle(el: HTMLElement): () => void;
  promoteTitleIfPresent(el: HTMLElement | null): () => void;
  dispose(): void;
}

export function createTooltipManager(): TooltipManager;
```

**不变量**：生产环境只使用默认实例 `defaultManager`，保证「同一时刻至多一个 tooltip 可见」语义不被破坏。测试/HMR 场景可创建隔离实例。

**迁移路径**：
- 默认实例 `defaultManager = createTooltipManager()` 保持兼容
- 现有 `attachTooltip` / `promoteTitle` / `promoteTitleIfPresent` 作为 `defaultManager` 方法的 re-export
- HMR 安全：`import.meta.hot?.dispose(() => defaultManager.dispose())`

### 2.2 focus-restore.ts — 工厂模式

```ts
export interface FocusRestoreManager {
  rememberTrigger(): void;
  returnFocus(): boolean;
  clearTrigger(): void;
}

export function createFocusRestoreManager(maxDepth?: number): FocusRestoreManager;
```

**说明**：`returnFocus()` 栈空时返回 `false`——现状已如此，此处是复述确认而非改进。

### 2.3 input-block-stack.ts — 工厂模式

```ts
export interface InputBlockStack {
  push(id: string): void;
  pop(id: string): void;
  isBlocked(): boolean;
  depth(): number;
}

export function createInputBlockStack(maxSize?: number): InputBlockStack;
```

### 2.4 html.ts — hl 全匹配高亮

将 `hl()` 从单次匹配改为全局匹配：

```ts
export function hl(text: string | null | undefined, query?: string): string {
  if (text == null) return "";
  if (!query) return esc(text);
  const lq = query.toLowerCase();
  const lowered = text.toLowerCase();
  if (lowered.length !== text.length) return esc(text); // Unicode 安全降级
  
  let result = "";
  let cursor = 0;
  let matchIdx: number;
  while ((matchIdx = lowered.indexOf(lq, cursor)) !== -1) {
    result += esc(text.substring(cursor, matchIdx));
    result += `<mark>${esc(text.substring(matchIdx, matchIdx + query.length))}</mark>`;
    cursor = matchIdx + query.length;
  }
  result += esc(text.substring(cursor));
  return result;
}
```

**边界处理**：
- 空 query → 纯转义（`if (!query)` 已拦截）
- Unicode 长度变化 → 降级纯转义
- 重叠匹配（query="aa", text="aaa"）→ 非重叠语义（`cursor = matchIdx + query.length`），与 `String.prototype.match` 一致

## 3. 后果（Consequences）

### 正面
- 消除模块级单例的 HMR 残留和测试污染风险
- `hl()` 全匹配提升搜索高亮体验
- 工厂模式使测试可创建隔离实例，无需 `__resetForTest` 钩子
- 各 manager 的 `dispose()` 方法使资源清理显式化

### 负面
- 接口变更：三个文件的公开 API 增加工厂函数
- 默认实例 re-export 仍保留模块级状态——但这是过渡期兼容措施，长期应迁移到实例化模式
- `hl()` 全匹配在长文本 + 高频调用时可能有微量性能差异（但搜索高亮非热路径）

### 风险
- 默认实例的 re-export 仍保留模块级状态——过渡期兼容，长期应迁移到显式实例化
- tooltip 单可见不变量依赖「生产只用默认实例」约定——需在代码审查中把关

## 4. 实施计划

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1 | `tooltip.ts` | 新增 `createTooltipManager()` 工厂，封装单例状态 |
| 2 | `tooltip.ts` | 默认实例 + re-export 保持兼容 + HMR dispose |
| 3 | `focus-restore.ts` | 新增 `createFocusRestoreManager()` 工厂 |
| 4 | `focus-restore.ts` | 默认实例 + re-export 保持兼容 |
| 5 | `input-block-stack.ts` | 新增 `createInputBlockStack()` 工厂 |
| 6 | `input-block-stack.ts` | 默认实例 + re-export 保持兼容 |
| 7 | `html.ts` | `hl()` 改为全匹配循环 |
| 8 | `html.test.ts` | 新增全匹配测试用例 |
| 9 | 验证 | `npx vite build && npm run typecheck && npx vitest` |
| 10 | 提交 | `node scripts/commit-with-check.ts -m "refactor: dom 单例改工厂 + html hl 全匹配"` |

## 5. 数据溯源

- `tooltip.ts`：206 行，4 个模块变量（`st` / `_observer` / `_scrollHandler` / `_scrollRef`）
- `focus-restore.ts`：64 行，`_triggerStack` 模块级数组
- `input-block-stack.ts`：47 行，`_inputBlockStack` 模块级 Map
- `html.ts`：34 行，`hl()` 仅首次匹配
- 测试文件：`tooltip.test.ts` / `focus-restore.test.ts` / `input-block-stack.test.ts` / `html.test.ts`
