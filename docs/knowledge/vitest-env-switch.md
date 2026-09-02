---
kind: vitest-env-switch
name: Vitest 环境切换规则
tier: architecture
category: config
source_files:
  - frontend/vitest.config.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - Vitest 环境切换、测试环境
  - node 环境、happy-dom、测试切换
quick_risk_lines:
  - 只有纯逻辑测试（不碰 DOM）才能切 @vitest-environment node，源码顶层副作用必须先治理
pitfalls:
  - DOM 测试切 node 环境 → window/document 报错；必须保持 happy-dom 或治理源码副作用
  - 用 vi.mock 硬扛源码副作用 → 治标不治本；必须先做惰性化守卫/神桶拆分

use_when:
  - vitest
  - 测试环境
  - node 环境
  - happy-dom
  - 测试切换
affected: false
status: active
---

# Vitest 环境切换规则

> 测试文件从 `happy-dom` 切到 `@vitest-environment node` 的判定标准和修复模式。

## 核心原则

`@vitest-environment node` 环境无 `window` / `document` / `localStorage` / `navigator` 等浏览器 API。**只有纯逻辑测试（不碰 DOM）才能切**。

**源码健康优先（2026-08-17 神桶拆分教训）**：测试 import 即炸（`window is not defined` / `HTMLElement is not defined`）通常是**源码顶层副作用**的信号，不是测试的问题——先治理源码（惰性化守卫 / 神桶拆分 / WebComponentBase），别用 `vi.mock` 硬扛。vi.mock 是治标，只该用于外部依赖（Go 桥 / @wailsio/runtime）。

## 判定流程

```
检查测试文件是否使用以下 API：
├── document.body / document.createElement / querySelector
├── innerHTML / attachShadow / adoptedStyleSheets
├── addEventListener / removeEventListener
├── localStorage / sessionStorage
├── new Image() / canvas / getContext
├── window.go / window.wails（Wails 桥接）
├── navigator / location / crossOriginIsolated
└── customElements / extends HTMLElement（Web Component）
     └── 有任一 → 需要 happy-dom（不可切）
         └── 全无 → 可以切 node
```

**注意**：即使测试文件本身不用 DOM，import 的源文件也可能在模块顶层或函数体内访问 `window`。逐一检查 import 链。

**import 链顶层副作用清单（node 下 import 即炸）**：

| 顶层副作用 | 后果 | 长治久安解法 |
|-----------|------|-------------|
| `class X extends HTMLElement` | `ReferenceError: HTMLElement is not defined` | `extends WebComponentBase`（见模式 5） |
| `window.xxx = ...` 挂载 | `window is not defined` | `typeof window !== "undefined"` 守卫 |
| `window\n .matchMedia(...)`（window 换行点号形态） | `window is not defined` | `typeof window !== "undefined"` 包裹整段 |
| 启动 IIFE `(async () => {...})()` | 执行 DOM 操作 | 神桶拆分：纯逻辑拆出独立文件（见模式 6） |
| `customElements.define` | 已有 `typeof customElements` 守卫则不炸 | 保持守卫 |

> ⚠️ **window 换行点号形态（2026-08-17 复扫漏网）**：`window\n  .matchMedia(...)` 这种换行后点号续写的调用，`grep "^window"` 只匹配行首的 `window` 而漏掉——排查顶层副作用时按**语义块**而非行首查（`window.` 出现在行首以外的位置同样算）。app-modules.ts 曾三处此形态裸执行（matchMedia / location.search / document.addEventListener keydown），守卫补齐见 `71091189`。

## 翻车修复模式

### 模式 1：`vi.stubGlobal` 替代 `(globalThis)` 赋值

Node.js 20+ 的 `navigator` / `crossOriginIsolated` / `location` 是 getter-only，直接 `(globalThis)["x"] = y` 抛 TypeError。

```ts
// ❌ 错误
(globalThis as any)["navigator"] = { serviceWorker: { register: vi.fn() } };

// ✅ 正确
vi.stubGlobal("navigator", { serviceWorker: { register: vi.fn() } });
vi.stubGlobal("crossOriginIsolated", false);
vi.stubGlobal("location", { reload: vi.fn() });

// 清理（afterEach）
vi.unstubAllGlobals();
```

### 模式 2：`vi.stubGlobal("document", mockDoc)`

测试文件中 import 的 handler 在运行时调用 `document.createElement` 等 DOM API，但 handler 本身是纯逻辑，不依赖 DOM 渲染结果。

```ts
// 在 describe 顶层或 beforeAll 中
const documentMock = {
  createElement: vi.fn(() => ({
    style: {},
    click: vi.fn(),
    // 按需补齐被调用的属性/方法
  })),
  appendChild: vi.fn(),
  removeChild: vi.fn(),
  execCommand: vi.fn(),
  body: { appendChild: vi.fn(), removeChild: vi.fn() },
  createTextNode: vi.fn(),
};
vi.stubGlobal("document", documentMock);

afterAll(() => { vi.unstubAllGlobals(); });
```

### 模式 3：mock 顶层模块，阻断 import 链

当 import 链中的模块（如 `capabilities.ts` → `android-bridge.ts` → `window`）在函数体内访问 `window`，且测试不直接调用该函数：

```ts
// capabilities.ts 被 bus-handlers.ts 导入，但 can() 只在运行时调用
vi.mock("../../utils/dom/capabilities.ts", () => ({
  can: vi.fn(() => true),
}));
```

### 模式 4：mock `getApp` 阻断 Wails 桥

`backend/app.ts` 的 `getApp()` 在函数体内访问 `window.go.main.App`。node 下 `window` 不存在，需要在 `app.ts` 层 mock：

```ts
const { getAppMock } = vi.hoisted(() => ({ getAppMock: vi.fn() }));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));

// 测试中设置 mock return 值
getAppMock.mockResolvedValue({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "" }),
  ListVersionInstances: vi.fn(),
  // ...
});
```

**注意**：`vi.mock` factory 会被 hoist 到文件顶部，引用的变量须用 `vi.hoisted()` 包裹，不能直接用 `const` 定义。

## 已切换文件清单

### 第一批（27 个，提交 e834ad55 + 后续）

| 文件 | 切换方式 | 注意事项 |
|------|---------|---------|
| `backend/extract.test.ts` | 直接标注 | 纯逻辑 |
| `backend/nbt-parse.test.ts` | 直接标注 | 纯逻辑 |
| `backend/voxel-parse.test.ts` | 直接标注 | 纯逻辑 |
| `backend/web-stats.test.ts` | 直接标注 | 纯逻辑 |
| `backend/web-store.logs.test.ts` | 直接标注 | 纯逻辑 |
| `backend/coi-sw.test.ts` | 标注 + 模式1 | 隔壁已修 `vi.stubGlobal` |
| `core/handlers/instance-ops.test.ts` | 直接标注 | 纯逻辑 |
| `core/context-menus.test.ts` | 标注 + 模式2 | 隔壁已修 `document` mock |
| `features/dnd-collector.test.ts` | 直接标注 | 纯逻辑 |
| 14 个 `preview-3d/*.test.ts` | 直接标注 | 纯逻辑（骨骼/材质/感知/能力） |
| `preview-3d/adapters/vrm-bone.test.ts` | 直接标注 | 纯逻辑 |
| `views/app-preview/mmd-siblings.test.ts` | 直接标注 | 纯逻辑 |
| `views/app-sidebar/loader.test.ts` | 标注 + 模式4 | mock `getApp` |
| `views/app-tree/bus-handlers.test.ts` | 标注 + 模式3 | mock `capabilities` |

### 第二批（2026-08-17 神桶拆分 + 3 个 window 耦合测试）

| 文件 | 切换方式 | 注意事项 |
|------|---------|---------|
| `app-modules.test.ts` | 神桶拆分 + 直接标注 | **源码侧先拆分**：`normalizeTheme/applyTheme/initTheme` 移至 `theme-core.ts`（无顶层副作用），app-modules.ts 保留装配并 re-export；测试直测 theme-core，删 12 个针对启动 IIFE 的 vi.mock（见模式 6） |
| `backend/app.test.ts` | 标注 + 模式1 | `beforeAll` stubGlobal window（window.go 注入路径）；被测 `backend/app.ts` 顶层无副作用 |
| `utils/dom/android-bridge.test.ts` | 标注 + 模式1 | 同款 stubGlobal（window.wails 判定）；被测源码顶层无副作用 |

**WebComponentBase 治理（源码侧，配套 8 处视图）**：`views/{context-menu,app-toast,app-content,app-nav,app-preview,app-sidebar,app-sync-manager,app-tree}/index.ts` 的 `class X extends HTMLElement` 统一改 `extends WebComponentBase`（`frontend/src/utils/dom/web-component-base.ts`：浏览器=HTMLElement，node=空类，类型恒为 typeof HTMLElement）——node 环境 import 视图不再炸，无需 vi.mock 视图（见模式 5）。`app-resource-manager` 已于 2026-08-24 删除。

### 仍需 happy-dom 的（约 74 个）

所有涉及 DOM 渲染（Web Components / Shadow DOM / querySelector / innerHTML / localStorage 端到端测试）的文件。

## 收益

| 指标 | 改前 | 改后 | 变化 |
|------|------|------|------|
| node 环境文件 | 61 | 88 | +27 |
| happy-dom 文件 | 101 | 74 | -27 |
| vitest 墙钟 | ~19s | ~16s | -3s（-16%） |