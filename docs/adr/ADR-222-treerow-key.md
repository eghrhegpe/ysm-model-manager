# ADR-222：文件行键空间统一：TreeRow.key 取磁盘路径

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-tree/entry-key.ts`（新增，契约净室）、`render.ts`（`flattenVisible` / `TreeRow`）、`row-common.ts`、`events.ts`、`index.ts`、`toolbar-events.ts`；被取代者：无

---

## 1. 背景（Context）

### 1.1 现象

E2E `tree-multiselect.spec.ts` 的「Shift+Click 范围选择」稳定失败（`Expected 2 / Received 1`，`--repeat-each=3` 复现），而同一 helper、同一入口的 `Ctrl+Click` 通过。运行时探针显示：

| 时点 | `selectState.lastKey` | `selectState.keys` |
|---|---|---|
| 普通单击后 | `/e2e/repo/model-a.ysm` | `{/e2e/repo/model-a.ysm}` |
| Shift+Click 后 | `/e2e/repo/model-b.ysm`（已更新） | `{/e2e/repo/model-a.ysm}`（未增长） |

`lastKey` 被更新说明已执行到 Shift 分支内部，`keys` 未增长则说明 `if (startIdx !== -1 && endIdx !== -1)` 判假。

### 1.2 根因：同一实体存在两条路径口径

`loader.ts` 从 Go 扫描结果派生 `TreeEntry` 时，对同一文件产出**两个不同口径**的路径：

| 字段 | 值（e2e mock 实测） | 语义 |
|---|---|---|
| `name` | `model-a.ysm` | 显示名 |
| `path` | `model-a.ysm` | **相对**资源根（已剪掉 `filesRoot` 前缀） |
| `fullPath` | `/e2e/repo/model-a.ysm` | **磁盘完整路径**（Go 下发原值，未剪前缀） |

而两条消费链各取一个：

- **DOM / 选中态**：`row-common.ts` 的 `fp = e.fullPath || e.path` → `data-fullpath` = 磁盘路径；点击处理 `fl.dataset.fullpath || fl.dataset.path` 优先取它 → `selectSingle` / `toggleSelect` 写入 `selectState.keys` **磁盘路径**。
- **行身份**：`render.ts` 的 `flattenVisible` 用树内拼接路径 `${prefix}/${name}`（相对）作为 `TreeRow.key`。

两条链在 `indexOf` / `has` 处相撞 → 静默失配。

### 1.3 受害面（同一根因，非单点）

所有「以 DOM/选中态路径回查行」的逻辑全部失效，且**均不抛错**：

| # | 位置 | 逻辑 | 失效表现 |
|---|---|---|---|
| 1 | `events.ts` Shift 分支 | `allPaths.indexOf(state.lastKey)` | 范围选择完全不生效 |
| 2 | `events.ts` 右键路径 | `selectState.keys.has(r.key)` | 已选多行右键不进入批量分支 |
| 3 | `index.ts` 键盘导航 | `fileRows.findIndex(r => r.key === ss.lastKey)` | `currentIdx` 恒 -1，↑↓ 永远落在首行 |
| 4 | `index.ts` 高亮查询 | `querySelector('[data-fullpath="…"]')` | 传入相对键查不到元素，高亮不更新 |
| 5 | `toolbar-events.ts` 全选 | `keys.every(k => selectState.keys.has(k))` | `allSelected` 恒 false，只增不减，且把相对键**混入** `selectState.keys` |
| 6 | `events.ts` `atTeFindRow` | `rows.findIndex(r => r.key === path)` | 双击重命名找不到行，输入框不出现 |

第 5 项最危险：相对键混入选中集后，`index.ts` 的批量删除会把相对路径当磁盘路径下发——**键空间污染**。

### 1.4 测试为何没拦住

`render.test.ts` 文件头注释明写「文件行 key 用 fullPath」，但正文用例名/断言写的是「用路径段拼接」；且测试 helper `entry()` 默认 `fullPath = path`，二者相等使绝大部分断言无法区分口径。唯一显式传不同值的那条用例（`:154`）断言被写成相对路径，**把 bug 固化成契约**。单元测试另有 5 处以绝对路径注入 `setVsRows`（照契约写的），与生产实现背离 → 假绿。

## 2. 决策（Decision）

### 2.1 文件行键 = 磁盘路径

**唯一正确口径是磁盘完整路径**，理由：`selectState.keys` 的下游消费者（批量删除、批量启禁用、右键批量操作）需要可直接下发给 Go 的磁盘路径；DOM `data-fullpath` 亦已是磁盘路径。口径不一致时应向**已有下游语义**收敛，而非反过来。

因此：`flattenVisible` 产出的 file 行 `key` 改为 `entryKey(entry)`（= `entry.fullPath || entry.path`），与 DOM `data-fullpath`、`selectState.keys` 三者同源。

### 2.2 文件夹行键保持树内路径

folder 行不参与选中、不参与批量操作，其 `key` 仅服务 `dirOpen` 展开态（`dirOpen[fullPath]` 与 `folderRowHTML` 的 `data-dir` 自洽闭环），且改动会破坏已持久化的用户展开状态。文件夹无选中语义，无需磁盘路径。**这是有意的非对称，非遗漏。**

### 2.3 契约单点化：`entry-key.ts` 净室

新增 `frontend/src/views/app-tree/entry-key.ts`，导出 `entryKey(e)`，为键空间契约的单一事实源。`render.ts` 与 `row-common.ts` 一律经它取值，禁止各写 `||` 表达式。

**为何不并入 `loader.ts`**：渲染层必须对 `loader.ts` 保持 **type-only 依赖**——5 个组件测试 `vi.mock("./loader.ts")` 只为替换 `loadEntries`，若渲染层值依赖 loader 会在 mock 下取到 `undefined` 并崩掉整树渲染（实施中已实际触发：`No "entryKey" export is defined on the "./loader.ts" mock`）。`entry-key.ts` 仅 type import，零运行时依赖，不被任何 mock 波及。

## 3. 后果（Consequences）

### 正面

- 6 处受害点（§1.3）一次性归零，且不再依赖「两条链恰好相等」的巧合。
- 键空间契约有单一事实源与显式注释；`TreeRow.key` 的 JSDoc 记录 file/folder 的非对称语义，后续改动者无需考古。
- 渲染层与数据加载层的依赖边界被重新固化为 type-only。

### 负面 / 成本

- `TreeRow.key` 对 file/folder 两种行语义不同（磁盘路径 / 树内路径），是**显式非对称**，需靠注释与 ADR 传递；不引入新字段是为避免"双字段并存反致漂移"。
- `render.test.ts` 三条既有断言随口径修正而更新（其中两条原注释理由「对齐树导航依据」经核查不成立——file 行 key 无任何树导航消费方）。

### 已知遗留

- `buildTree` 的 `filterPaths` 与 `getVsRows` 缓存指纹仍用 `e.path`（相对）作输入指纹；其比较对象亦为 `path` 口径，自洽，未纳入本次统一。若未来 filterPaths 改为接收 DOM 路径，须同步此指纹。

## 4. 数据溯源

| 结论 | 来源 |
|---|---|
| 双口径根因 | E2E 探针实测：`domRows=[{path:"model-a.ysm", fullpath:"/e2e/repo/model-a.ysm"}]`，`keys={"/e2e/repo/model-a.ysm"}` |
| 失败用例与稳定性 | `npx playwright test e2e/tree-multiselect.spec.ts` → `Expected 2 / Received 1`，`--repeat-each=3` 稳定复现 |
| 生产 bug 而非测试专属 | `e2e/mock-data.ts` 的 `Path` 为 `/e2e/repo/…`（Go 下发格式同构）；`loader.ts` 对 `fullPath` 不做前缀裁剪 |
| 受害点 1–6 | 对 `render/events/index/toolbar-events` 的 `.key` 全量消费点 grep 逐条核对（§1.3 表格） |
| 假绿机制 | `render.test.ts:154` 用例名「key 用 fullPath」vs 断言相对路径；`entry()` helper 默认 `fullPath = path`；5 处 `setVsRows` 以绝对键注入 |
| 渲染层 type-only 依赖必要性 | 实施中 `vi.mock("./loader.ts")` 使 `entryKey` 取到 undefined，20 条组件测试批量失败；迁至 `entry-key.ts` 后 197 条全绿 |
