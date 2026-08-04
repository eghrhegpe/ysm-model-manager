# ADR-021：前端声明式菜单自动化测试方案

- **状态**：✅ 已采纳（A/B 层已实施；C 层 E2E 按决策不引入、列为远期）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/core/context-menus.ts` / `frontend/js/views/context-menu.ts` / `frontend/js/bus.ts`（MenuItem）/ `frontend/package.json`（vitest + jsdom）/ `tests/*.mjs`（契约测试）/ ADR-007 / ADR-014

---

## 1. 背景（Context）

### 1.1 现状盘点

| 测试层 | 现状 | 覆盖 |
|--------|------|------|
| `tests/*.mjs` 契约测试（8 个） | ✅ 全过 | JSON schema / 配置 / HTML 引用完整性，纯静态校验，**宪法基石禁止修改** |
| vitest 前端单测（7 文件 / 79 用例） | ✅ 全过 | `utils/*` 纯函数 + `features/community/data.js`，**零组件、零交互、零菜单测试** |
| E2E / UI 自动化 | ❌ 无 | Playwright 等均未引入 |

前端 `package.json` 已配置 `"test": "vitest run"`，且已安装 `vitest ^0.34.6` + `jsdom ^29` —— **单测基础设施早已就位，缺的是测试用例本身**。

### 1.2 菜单系统的声明式结构（可测性前提）

当前菜单链路已是「数据与行为分离」的最佳测试形态：

```
ctx:show ──► context-menus.ts（纯事件映射，产出 MenuItem[] 声明式数据）
               ──► bus.emit("menu:show") ──► <context-menu> 纯渲染 items
```

- `MenuItem`（bus.ts:18）：纯数据接口 `label / divider / icon / danger / onClick`
- `context-menus.ts` 的 `registerContextMenus()`：按 `type`（instance / batch / file / dir）四分支各产出一份 `items` 数组，无 DOM 依赖
- `<context-menu>`（context-menu.ts:88 `show()`）：按 `data-idx` 绑定点击 → `items[idx].onClick()`，点击后 `hide()`

### 1.3 痛点来源

- **ADR-007 已承认**：「菜单项的 `onClick` 难以独立测试（需要 mock dialog + Go binding + toast）」（ADR-007 负面清单）
- **ADR-014 P5** 预留「评估 Vitest」为独立 ADR —— 本 ADR 即该预留的落地
- 菜单回归目前完全依赖人工：新增菜单项 / 改 label / 调 divider 位置，无任何机器防线

---

## 2. 决策（Decision）

**决策**：按「声明式菜单」分层建设前端自动化测试，A/B 层复用现有 vitest + jsdom（零新依赖），C 层（E2E）不引入、列为远期。契约测试 `tests/*.mjs` 一律不动。

### 2.1 A 层：映射 + 组件单测（零新依赖，优先）

| 测试文件 | 测什么 | 断言目标 |
|----------|--------|----------|
| `context-menus.test.ts` | 四类 `ctx:show` → `menu:show` 的 items 载荷 | 条目数 / label / divider 位置 / danger / icon 与声明一致；`getApp()` mock |
| `context-menu.test.ts` | `<context-menu>` 渲染与交互 | `show()` 后 DOM 条目、divider 为 `<hr>`、danger class；点击触发 `onClick` 且 `hide()` |

**A 层约束**：
- 复用现有 `bus.on / bus.emit` 事件机制直接驱动，不经过真实右键
- `wails/app.ts` 的 `getApp()` 用 vitest `vi.mock` 替换
- 组件测试需处理 jsdom 局限：`getBoundingClientRect()` 返回 0（context-menu.ts:119 边界检测）、`requestAnimationFrame` 需 stub
- `customElements.define("context-menu")` 重复 import 会抛错，测试按文件隔离

### 2.2 B 层：声明式规格增强（防漂移，推荐随 A 层一起做）

把 `context-menus.ts` 里硬编码的 items 抽为 `menu-defs.ts` **唯一事实来源**：

- 实现从配置生成 items（替换四分支内联数组）
- 测试**遍历配置**逐条断言行为（点击 → 正确的 `bus.emit` / `getApp` 调用）
- 收益：加菜单项只改配置，测试自动覆盖，实现「按声明式菜单测试」，杜绝测试与实现漂移

### 2.3 C 层：E2E（不引入，列为远期）

- Wails 桌面应用跑在 WebView2，Playwright 直测桌面成本高
- 可行路径：`vite dev` 纯前端模式 + mock Wails bridge 后接 Playwright 真实右键交互
- 收益与成本权衡后**本轮不引入**，留待 A/B 层稳定后评估

---

## 3. 后果（Consequences）

### 正面
- 菜单回归从「人工盘问」升级为「机器防线」，覆盖 ADR-007 承认的测试盲区
- 声明式 items 本身就是测试规格，A 层几乎无额外测试数据成本
- 零新依赖，vitest + jsdom 已就位；与 ADR-014 的 TS 渐进迁移兼容（测试文件可直接用 `.ts`）
- 为 ADR-007 决策「onClick 保留内联」提供回归保障：行为变化会被测试捕获

### 负面 / 成本
- jsdom 环境与真实 WebView2 有差异（布局 / rAF / 事件冒泡细节），A 层只能保证逻辑正确性，不保证视觉
- B 层抽取 `menu-defs.ts` 是一次小重构（替换四分支内联数组），需按 ADR-014 门槛跑 `tsc --noEmit`
- `getApp()` / modal 等外部依赖需逐项 mock，mock 面随菜单项增长

### 已知限制（不修复）
- **契约测试 `tests/*.mjs` 不纳入本方案**：宪法基石，改动一律禁止
- **C 层 E2E 不做**：WebView2 直测成本高，本期范围外

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/js/core/context-menus.ts` | 四类菜单 items 声明（instance/batch/file/dir 四分支） |
| `frontend/js/views/context-menu.ts` | `<context-menu>` 渲染 / 点击绑定（data-idx → onClick → hide） |
| `frontend/js/bus.ts` | `MenuItem` 接口 + `menu:show` / `ctx:show` 事件契约 |
| `frontend/package.json` | vitest ^0.34.6 + jsdom ^29 已安装，`test: vitest run` 已配置 |
| `frontend/js/utils/display.test.js` 等 | 现有 vitest 用例模式（describe/it/expect 直接可用） |
| `docs/adr/ADR-007-context-menu-structure.md` | 负面清单：「onClick 难以独立测试」——本 ADR 的出发点 |
| `docs/adr/ADR-014-typescript-migration.md` | P5「评估 Vitest」预留，本 ADR 承接 |
