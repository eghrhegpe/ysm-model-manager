# frontend 渲染债务收敛（虚拟滚动 + 2D 迁移）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛前端渲染体系的两处「重复实现」坏味道——① 三套虚拟滚动收敛为共享原语一套；② 2D 渲染文件迁出 `preview-3d/` 落回其消费上下文。

**Architecture:** 虚拟滚动已存在下沉好的共享原语 `utils/dom/virtual-scroll.ts`（`calcVisibleRange` + `installScrollSync`），consume 方 `features/community/virtual-list.ts` 已正确持用；真正未迁移的是 `views/app-tree/virtual-scroll.ts` 这份原版拷贝。收敛 = 让 app-tree 改引共享原语、行高常量留在 app-tree、删本地拷贝。2D 三件套（model2d.ts / -draw.ts / -hit-zones.ts）当前 ISSN：`views/app-preview/` 下一子目录随消费方落位，语义去 3d 化。

**Tech Stack:** TS（vite + vitest/happy-dom）；改动全部在前端，不触 Go。

---

## 范围声明（必须先读）

- **本方案只含两块**：虚拟滚动收敛（Part A）、2D 迁移（Part B）。两块相互独立、各自可独立验证独立提交。
- **明确延后、另立方案**（跨层 / 巨型函数，需单独 ADR + 拍板，**不**在本方案内动）：
  - **缓存三通道统一**：`texture-cache.ts`（LRU 引用计数池，pack/ysm 用）vs Go `texture_cache`+KTX2 预编码（mmd 用，走 `HasCachedTextures`）vs GLTF 原生加载（vrm 用）。统一接触 Go 绑定（`internal/app/`）→ 跨层，须 ADR（可参考 ADR-066 模式）。
  - **mmd-adapter.ts 拆芯**（1366 行）：巨型函数外科手术，走 `ts-giant-function-surgery` 单独方案。
- 若有人把上述两项塞进本方案，属于越权，拦下。

---

## 前置事实（查证结论，工程师直接采信）

虚拟滚动实际只有**一份重复**，不是三份全独立：

| 文件 | 角色 |
|---|---|
| `utils/dom/virtual-scroll.ts` | ✅ 共享原语：`calcVisibleRange(scrollEl,totalRows,rowH,topOffset=0)`、`installScrollSync` |
| `features/community/virtual-list.ts` | ✅ 已是共享原语的消费方（第 6 行 import 自 utils/dom） |
| `views/app-tree/virtual-scroll.ts` | ❌ 未迁移的原版拷贝 + 导出 `ROW_H_GRID`/`ROW_H_LIST` |

2D 三件套外部消费者（全仓唯一）：`views/app-preview/zoom.ts`、`views/app-preview/skeleton.ts`（及其测试的 `vi.mock` 路径）。三件套内部 import 全为 `./` 相对路径，迁移后仍有效，无需改写它们内部。

---

## Part A：虚拟滚动收敛（app-tree → 共享原语）

**Files:**
- Modify: `frontend/src/views/app-tree/render.ts`（import L14-19；加两常量）
- Modify: `frontend/src/views/app-tree/index.ts`（L25 import 源改指向 render.ts）
- Delete: `frontend/src/views/app-tree/virtual-scroll.ts`
- Delete: `frontend/src/views/app-tree/virtual-scroll.test.ts`（共享原语已有自己的测试，见 `utils/dom/virtual-scroll.test.ts`）
- （`utils/dom/virtual-scroll.ts` 不动）

- [ ] **Step 1. render.ts：改 import + 收编行高常量**

把 L14-19 的 `import { ROW_H_GRID, ROW_H_LIST, calcVisibleRange, installScrollSync } from "./virtual-scroll.ts";` 替换为：

```ts
import {
  calcVisibleRange,
  installScrollSync,
} from "../../utils/dom/virtual-scroll.ts";

/** 树行高（虚拟滚动定高窗口，grid/list 两档；自 app-tree 原 virtual-scroll.ts 迁入） */
export const ROW_H_GRID = 28;
export const ROW_H_LIST = 24;
```

> 兼容性：render.ts 内调用均为 `calcVisibleRange(container, total, rowH)`（L314，三参显式传 rowH，未用 topOffset），共享版签名 `(scrollEl,totalRows,rowH,topOffset=0)` 完全兼容；`installScrollSync(container, cb)` 两版一致。`ROW_H_*` 改为本文件导出，值不变（28/24），**导出以维持 index.ts 消费**。

- [ ] **Step 2. index.ts：行高常量改从 render.ts 取**

L24-25 两行 import 合并：删除 L25 `import { ROW_H_GRID, ROW_H_LIST } from "./virtual-scroll.ts";`，把 `ROW_H_GRID, ROW_H_LIST` 并入 L24 的 render.ts import：

```ts
import {
  renderTree,
  updateStat,
  getRenderMode,
  setRenderMode,
  cleanupVirtualScroll,
  type RenderMode,
  type TreeRow,
  ROW_H_GRID,
  ROW_H_LIST,
} from "./render.ts";
```

（调用处 L424 `const rowH = ... ROW_H_LIST : ROW_H_GRID;` 无需改，仅 import 源变更。）

- [ ] **Step 3. 删本地拷贝及其测试**

```bash
git rm frontend/src/views/app-tree/virtual-scroll.ts frontend/src/views/app-tree/virtual-scroll.test.ts
```

（共享 `utils/dom/virtual-scroll.test.ts` 已覆盖 `calcVisibleRange`/`installScrollSync`，删本地测试不丢覆盖。）

- [ ] **Step 4. 验证**

```bash
cd frontend && npx vite build && npm run typecheck
npx vitest --run src/views/app-tree src/utils/dom/virtual-scroll.test.ts
```

Expected: build 通过、typecheck 0 错误、app-tree 与共享虚拟滚动测试全绿。

- [ ] **Step 5. 提交（路径限定）**

```bash
git add frontend/src/views/app-tree/render.ts frontend/src/views/app-tree/index.ts
git commit -m "refactor: app-tree 虚拟滚动收敛到 utils/dom 共享原语" -- frontend/src/views/app-tree/render.ts frontend/src/views/app-tree/index.ts
# 删除同 commit 一并以 -m 覆盖；或用 node scripts/commit-with-check.mjs -m "..." 
```

> 提示：删除文件已 `git rm` 进暂存；若走 `commit-with-check.mjs` 会按 staged 自动裁剪门禁。

---

## Part B：2D 渲染迁出 preview-3d

**Files:**
- Move `frontend/src/preview-3d/model2d.ts` → `frontend/src/views/app-preview/model2d/model2d.ts`
- Move `frontend/src/preview-3d/model2d-draw.ts` → `frontend/src/views/app-preview/model2d/model2d-draw.ts`
- Move `frontend/src/preview-3d/model2d-hit-zones.ts` → `frontend/src/views/app-preview/model2d/model2d-hit-zones.ts`
- Move `frontend/src/preview-3d/model2d.test.ts` → `frontend/src/views/app-preview/model2d/model2d.test.ts`
- Modify: `frontend/src/views/app-preview/zoom.ts`（L4 import + L10 vi.mock 于 zoom.test.ts）
- Modify: `frontend/src/views/app-preview/skeleton.ts`（L5 import；skeleton.test.ts 的 vi.mock）
- Modify: `frontend/src/views/app-preview/zoom.test.ts`、`frontend/src/views/app-preview/skeleton.test.ts`（vi.mock 路径）

- [ ] **Step 1. 迁移前确认三件套不依赖 preview-3d 内部（只依赖共享 top-level utils）**

```bash
cd frontend && grep -nE "^import|from \"\.\./" src/preview-3d/model2d.ts src/preview-3d/model2d-draw.ts src/preview-3d/model2d-hit-zones.ts src/preview-3d/model2d.test.ts
```

Expected: 唯一非 `./` 相对的是 `from "../utils/animation/animation.ts"`（type-only `BoneTransform`/`Vec3`，落在 **`src/utils/`** 顶层共享工具），其余全在三者相互之间。**不允许**出现任何指向 preview-3d 其它子模块（`./caps/`、`./adapters/`、`./decoder/` 等）的 import；若出现，停下报告，不继续。

- [ ] **Step 2. 移动四文件（保持目录结构）**

```bash
mkdir -p frontend/src/views/app-preview/model2d
git mv frontend/src/preview-3d/model2d.ts            frontend/src/views/app-preview/model2d/model2d.ts
git mv frontend/src/preview-3d/model2d-draw.ts       frontend/src/views/app-preview/model2d/model2d-draw.ts
git mv frontend/src/preview-3d/model2d-hit-zones.ts  frontend/src/views/app-preview/model2d/model2d-hit-zones.ts
git mv frontend/src/preview-3d/model2d.test.ts       frontend/src/views/app-preview/model2d/model2d.test.ts
```

> 三件套彼此之间为 `./` 相对，同目录移动保持不变；**唯一要改路径**的是指向共享 `src/utils/animation/animation.ts` 的 type-only import——原 `../utils/`（preview-3d 上翻一层）在新位置 `src/views/app-preview/model2d/` 需 `../../../utils/`。

- [ ] **Step 2b. 修正四个移动文件的共享 utils 导入层级**

`model2d.ts` L6、`model2d-draw.ts` L5、`model2d-hit-zones.ts` L4、`model2d.test.ts` L7，均把：

```diff
-import type { ... } from "../utils/animation/animation.ts";
+import type { ... } from "../../../utils/animation/animation.ts";
```

（仅 type-only；`../utils/` → `../../../utils/`，其余符号名与行内不变。）

- [ ] **Step 3. 更新 app-preview 两个消费方 import**

`zoom.ts` L4：

```diff
-import { renderModel2D } from "../../preview-3d/model2d.ts";
+import { renderModel2D } from "./model2d/model2d.ts";
```

`skeleton.ts` L5：

```diff
-import { renderModel2D } from "../../preview-3d/model2d.ts";
+import { renderModel2D } from "./model2d/model2d.ts";
```

（zoom.ts 与 skeleton.ts 均在 `views/app-preview/` 根，`./model2d/model2d.ts` 为正确相对路径。）

- [ ] **Step 4. 更新两个测试的 vi.mock 路径**

`zoom.test.ts` L10：

```diff
-vi.mock("../../preview-3d/model2d.ts", () => ({
+vi.mock("./model2d/model2d.ts", () => ({
```

`skeleton.test.ts` L52：

```diff
-vi.mock("../../preview-3d/model2d.ts", () => ({ renderModel2D }));
+vi.mock("./model2d/model2d.ts", () => ({ renderModel2D }));
```

- [ ] **Step 5. 验证**

```bash
cd frontend && npx vite build && npm run typecheck
npx vitest --run src/views/app-preview src/views/app-preview/model2d
```

Expected: build 通过、typecheck 0 错误、app-preview + model2d 测试全绿。

- [ ] **Step 6. 提交（路径限定）**

```bash
git add frontend/src/views/app-preview/model2d frontend/src/views/app-preview/zoom.ts frontend/src/views/app-preview/skeleton.ts frontend/src/views/app-preview/zoom.test.ts frontend/src/views/app-preview/skeleton.test.ts
git commit -m "refactor: 2D 渲染三件套迁出 preview-3d 落位 views/app-preview/model2d" -- frontend/src/views/app-preview/model2d frontend/src/views/app-preview/zoom.ts frontend/src/views/app-preview/skeleton.ts frontend/src/views/app-preview/zoom.test.ts frontend/src/views/app-preview/skeleton.test.ts
```

---

## Self-Review

- **Spec 覆盖**：虚拟滚动收敛（Part A）覆盖「三套→一套」核心 + 行高常量落位 + 删拷贝；2D 迁移（Part B）覆盖「model2d 迁出 preview-3d」+ 消费路径 + mock 路径。延后项（缓存三通道、mmd 拆芯）已在范围声明明确另立方案，不构成本方案缺口。
- **占位符扫描**：无 TODO/TBD；所有改动步骤均含完整代码/diff/命令与期望输出。
- **类型一致**：`ROW_H_GRID`/`ROW_H_LIST` 在 render.ts 导出、index.ts 由 render.ts 引入、render.ts 内用，值恒 28/24；`calcVisibleRange` 三参调用与共享版签名一致；model2d 相对 import 迁移后保持一致。跨 Part 无共享符号冲突。