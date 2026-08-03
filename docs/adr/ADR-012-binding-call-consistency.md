# ADR-012：Wails Binding 调用路径一致性

- **状态**：已采纳（Accepted，当前不一致，未修复）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/wails/app.js` / `frontend/js/features/import-queue.js` / `frontend/js/core/context-menus.js`

---

## 1. 背景（Context）

前端调用 Go 端 Wails Binding 存在**两条并行路径**：

| 路径 | 代码 | 缓存 | 来源 |
|------|------|------|------|
| **路径 A** | `const App = await getApp()` | ✅ 模块级缓存（`_App`） | `frontend/js/wails/app.js` |
| **路径 B** | `await import("../../bindings/.../app.js")` | ❌ 每次动态 import | 各处内联 |

**`getApp()` 实现**（`wails/app.js`）：

```js
let _App = null;
export const getApp = async () => {
  if (_App) return _App;
  _App = await import("../../bindings/ysm-model-manager/internal/app/app.js");
  return _App;
};
```

设计上缓存有效——首次 import 后 `_App` 永久持有引用，后续调用直接返回。

---

## 2. 现状：两条路径并存

### 2.1 使用 `getApp()` 的文件

| 文件 | 调用次数 | 模式 |
|------|----------|------|
| `import-queue.js` | **11 次** | 混用：有时解构单函数，有时连续调用两次 |
| `oldest-models.js` | 1 次 | 解构 `ScanModelEntries, GetRepoRoot` |
| `tag-editor.js` | 2 次 | 先 `await getApp()` 再解构单方法 |
| `handler-other.js` | 2 次 | 解构多函数 |
| `handler-dnd.js` | 1 次 | 解构 `DetectZipType` |
| `adv-filter.js` | 1 次 | `await getApp()` 后访问 `App.AllTags()` |

### 2.2 直接 `import()` 绕过 `getApp()` 的文件

| 文件 | `import()` 次数 | 说明 |
|------|-----------------|------|
| `core/context-menus.js` | **10 次** | 每个菜单项 `onClick` 内独立 import，完全绕过缓存 |
| `core/handler-sync.js` | 6 次 | 同步 handler 内多处 import |
| `app-content/index.js` | 4 次 | 页面初始化时 import |
| `app-modules.js` | 1 次 | `LoadAppConfig` |
| `utils/debug.js` | 1 次 | 调试工具 |
| `version-updater.js` | 4 次 | 更新流程 |
| `recycle-bin.js` | 2 次 | 回收站操作 |

**总计**：直接 `import()` 约 **28 次**，`getApp()` 约 **18 次**，绕过缓存的调用占了多数。

### 2.3 典型问题代码

```js
// import-queue.js:367-368 — 连续两次 getApp()
const { RenameFile } = await getApp();
const { GetRepoRoot } = await getApp();

// context-menus.js:52 — 直接 import，绕过缓存
getApp().then(App => App.OpenInstanceFolder(path, rtype || "")).catch(() => {});
```

第 367-368 行在功能上无害（`_App` 已缓存，第二次调用直接返回），
但暴露了开发者对缓存机制的不信任，属于"保险式调用"。

---

## 3. 决策（Decision）

**决策**：以 `getApp()` 为唯一入口调用 Go Binding，禁止在业务代码中直接 `import()` 绑定文件。

### 3.1 理由

- **缓存一致性**：`getApp()` 确保 Go 模块只 import 一次，减少启动时 JS 包体积
- **入口统一**：AGENTS.md §四.2 明确规定"统一走 getApp()"，直接 import 是违反治理红线
- **维护性**：如果将来 binding 路径变更（如从 `internal/app/` 移到 `bindings/`），
  只需改 `wails/app.js` 一处，而非追踪 28 处硬编码路径

### 3.2 例外

以下场景允许直接 `import()`：
- 测试文件中的 mock 替换
- `app-modules.js` 中的首次加载（此时 `getApp()` 尚未定义）
- 一次性操作（如 version-updater 的 `DoUpdate` + `RestartApplication`，应用即将重启）

---

## 4. 后果（Consequences）

### 正面
- 修复后 Go 模块 import 次数从 28+ 次降为 1 次（缓存命中）
- binding 路径变更只需改一处
- 消除"保险式调用"（连续 `getApp()` 两次），代码更清晰

### 负面
- 需要全局替换 28 处直接 `import()`，涉及 7 个文件
- 部分 `import()` 出现在异步 `onClick` 中，改为 `getApp()` 后需要验证
  `getApp()` 在菜单渲染前是否已就绪（当前 `_App` 初始为 `null`，首次调用才 import）
- `import-queue.js` 中 `await getApp()` + 直接 `import()` 混用，需要统一

### 已知违规
| 文件 | 违规次数 | 说明 |
|------|----------|------|
| `core/context-menus.js` | 10 | 每个 `onClick` 独立 `import()` |
| `core/handler-sync.js` | 6 | 同步操作多处 `import()` |
| `app-content/index.js` | 4 | 页面操作多处 `import()` |
| `version-updater.js` | 4 | 更新流程多处 `import()` |
| `recycle-bin.js` | 2 | 回收站操作 |

---

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/js/wails/app.js` | `getApp()` 缓存实现 |
| `frontend/js/features/import-queue.js` | `getApp()` 连续调用两次 |
| `frontend/js/core/context-menus.js` | 10 处直接 `import()` |
| AGENTS.md §四.2 | "Wails 调用统一走 getApp()" |
