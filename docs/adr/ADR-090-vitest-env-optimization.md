# ADR-090：vitest 环境切换与 npm 三件套并行优化

- **状态**：已采纳（Accepted）
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/knowledge/vitest-env-switch.md`

---

## 1. 背景（Context）

项目 vitest 墙钟随测试文件增长膨胀至 ~19s，其中主要开销来自 happy-dom 环境隔离（isolate=true 下每文件 ~1.2s 环境重建）。同时 pre-push 门禁中 npm 三件套（vite build / vitest run / tsc --noEmit）串行执行，累积墙钟 ~4.1s。

## 2. 决策（Decision）

### 2.1 npm 三件套 A∥C 并行

将 `vite build` 与 `tsc --noEmit` 用 `Promise.all` 并行执行（二者无依赖），`vitest run` 保持串行在后独占资源。改动在 `scripts/pre-push-gate.ts` 的前端域。

```
改动前:  vite build → vitest run → tsc --noEmit   串行，~4.1s
改动后:  vite build ─┐
                     ├─ Promise.all 并行 → vitest run  串行，~2.8s
         tsc --noEmit┘
```

### 2.2 纯逻辑测试切 node 环境

对不依赖 DOM API 的测试文件添加 `// @vitest-environment node` 首行标注，跳过 happy-dom 环境重建（~1.2s/文件）。分两批执行：

- **第一批（21 个）**：纯逻辑文件，直接标注，提交 `e834ad55`
- **第二批（6 个）**：需要额外 mock 适配的文件，提交 `b4edb7db`

### 2.3 翻车修复模式

node 下 `window` / `navigator` / `crossOriginIsolated` 等浏览器 API 不可用，采用四种修复模式：

| 模式 | 场景 | 做法 |
|------|------|------|
| `vi.stubGlobal` | getter-only 属性（navigator/location） | 替代 `(globalThis)[]=` 赋值 |
| document mock | handler 体内调 `document.createElement` | `vi.stubGlobal("document", mockDoc)` |
| import 链 mock | import 链模块函数体内访问 `window` | `vi.mock` 该模块 |
| getApp mock | `getApp()` 内部访问 `window.go` | `vi.mock("backend/app.ts")` |

## 3. 后果（Consequences）

### 正面

- vitest 墙钟从 ~19s 降至 ~16s（-16%）
- npm 三件套墙钟从 ~4.1s 降至 ~2.8s（-32%）
- node 环境测试文件从 61 个增至 88 个，happy-dom 文件从 101 个降至 74 个
- 切换规则和修复模式整理为 `docs/knowledge/vitest-env-switch.md`，后续可复用

### 负面

- 部分测试需要额外 mock（`vi.stubGlobal` / `vi.mock`），增加维护成本
- `coi-sw.test.ts` 和 `context-menus.test.ts` 需特殊处理，不能直接标注

### 已知遗留

- 仍有 74 个测试文件需 happy-dom（涉及 DOM 渲染/Web Components/localStorage 端到端）
- 进一步优化可考虑 `isolate: false`，但风险高（测试间状态泄漏）
- 约 10 个 backend 测试文件（browser-adapter / pack-meta / ysm-header）使用 localStorage 做端到端测试，可考虑用 `vi.stubGlobal("localStorage", mockStorage)` 切到 node，但收益有限

## 4. 数据溯源

| 来源 | 数据 | 结论 |
|------|------|------|
| vitest 默认 isolate=true 开销 | 注释 ~1.2s/文件 | happy-dom 环境重建是大头 |
| 全量 vitest 墙钟 | 19.1s → 15.8s → 16.0s | 27 文件切 node 省 ~3s |
| npm 三件套串行墙钟 | 4.1s | build + tsc 可并行 |
| 3D 预览测试占比 | 21/162 文件，10 个 happy-dom | 不是主因 |
| 子代理判断偏差 | 36 个判 canSwitch，实际 27 个可切 | 偏乐观，低估 localStorage/window 限制 |
