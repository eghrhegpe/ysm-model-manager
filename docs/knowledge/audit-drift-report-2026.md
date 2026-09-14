---
kind: audit-drift-report-2026
name: 知识卡 vs 代码 语义审计报告
tier: architecture
category: config
affected: false
status: snapshot
source_files: []
use_when:
  - 知识卡审计
  - 文档-代码脱节审计
---

# 知识卡 vs 代码 语义审计报告

> 审计时间：2026-09-xx  |  审计员：审计子代理  |  方法：frontmatter 解析 + source_files 存在性 + 关键符号 grep + 正文与代码交叉核对
>
> 范围：`docs/knowledge/*.md` 共 186 张，抽查 40 张（按类别覆盖）。**只读**，不修改任何文件。

---

## 一、抽样覆盖

| 类别 | 抽查张数 | 卡名（kind） |
|---|---|---|
| **特殊功能卡** | 9 | `ik_solver`, `ground_surface_spec`, `ground-cap-materialgroup-factories`, `render-federation`, `event-graph-guard`, `source-graph`, `extensibility-index`, `extensibility-index-reconciliation`, `extensibility-round2` |
| **ADR 引用卡** | 1 | `adr173_gui_cli_paramspec` |
| **go-\***（Go 后端） | 12 | `go-cli-search`, `go-conc`, `go-config`, `go-dedup`, `go-fileops`, `go-importer`, `go-installer`, `go-paths`, `go-recycle`, `go-scanner`, `go-sync`, `go-ysm-parser` |
| **utils-\*** | 6 | `utils-array`, `utils-dom`, `utils-errors`, `utils-fmt`, `utils-resource-types`, `utils-summarize` |
| **前端 UI / feature** | 12 | `app-tree`, `app-preview`, `app-sidebar`, `dialog-adv-filter`, `dialog-rename`, `community-feature`, `community-virtual-list`, `context-menu`, `download-tasks`, `recycle-bin`, `search`, `toolbar-search` |
| **附带抽查** | 3 | `event-bus`, `mount3d-584-giant`, `worker-bridge-settleerror-fallback` |
| **合计** | **43** | |

覆盖策略：类别内尽量分散、优先抽 ADR 引用卡与特殊功能卡全查。所有抽查卡的 `source_files` 均已验证真实存在（含目录形式），未发现"文件不存在"级别的脱节。

---

## 二、脱节清单（按严重程度分级）

### 🔴 高（文件不存在或核心功能描述完全错误）

#### 1. `ground-cap-materialgroup-factories.md` — 描述的整个"工厂化"设计已被 ADR-195 取代

- **知识卡路径**：`docs/knowledge/ground-cap-materialgroup-factories.md`
- **脱节类型**：描述与实现完全不符（正文核心机制已不存在）
- **文档声明**（正文 L34）：
  > `ground-capability.ts` 的 `buildGroundMaterialGroup`（`ground-capability.ts|buildGroundMaterialGroup`，超 100 行红线）……已按建议抽 `groundSliderDef`/`groundColorDef`/`groundButtonDef` 工厂，消除重复结构。
  >
  > 对外 API：`buildGroundMaterialGroup(cap: GroundCapability): PreviewControlDef[]` — 包级函数…… 辅助工厂（包级、material group 专用）：`groundSliderDef` / `groundColorDef` / `groundButtonDef`。
- **实际情况**（grep `frontend/src/preview-3d/caps/` 全目录）：
  - `buildGroundMaterialGroup`：**零匹配**
  - `groundSliderDef` / `groundColorDef` / `groundButtonDef`：**零匹配**
  - 实际代码：`ground-capability.ts` 第 15 行 `import { buildGroundNodes } from "./ground-menu.ts";`，第 370 行 `return buildGroundNodes(this);`
  - 真实实现：`frontend/src/preview-3d/caps/ground-menu.ts`（240 行，独立文件），文件头注释明确写 "ADR-195 刀2：cap 直产 PreviewMenuNode[]"
  - `ground-menu.ts` 内部使用 `colorNode` / `sliderNode` / `buttonNode` 等本地工厂函数（非 `ground*Def` 命名）
- **严重程度**：🔴 高 — 卡片 `symbols_with_lines` 只列 `GroundCapability`（该符号确实存在于 ground-capability.ts 中），drift 检查器不报错；但**正文 100% 描述的工厂化设计与源码完全脱节**，AI 若按此卡指导开发会找不到 `buildGroundMaterialGroup` / `groundSliderDef` 等符号。

### 🟡 中（符号改名、行为描述偏差）

#### 2. `extensibility-index-reconciliation.md` — bus.ts VOID_EVENTS/emit 状态标记过时

- **知识卡路径**：`docs/knowledge/extensibility-index-reconciliation.md`
- **脱节类型**：对账结论已过时
- **文档声明**（L157 附近，Top 10 后 §7.9 附近）：
  > `bus.ts` `VOID_EVENTS` vs `emit` 内手抄 —— **存活**（未见改调 `isVoidEvent(event)`）
- **实际情况**（`frontend/src/bus.ts` L195-196）：
  ```ts
  // 原实现手抄 8 个 void 事件名第二份清单，现复用 isVoidEvent 消除漂移源
  if (args.length === 0 && !isVoidEvent(event)) {
  ```
- **严重程度**：🟡 中 — 对账卡自称"快照"，但作为快照也应有 `last_verified` 与"以 grep 实测为准"提示；此处"存活"结论与 HEAD 事实相悖，会误导后续决策者。

#### 3. `extensibility-index-reconciliation.md` — Top 10 #10 路径定位轻微漂移

- **知识卡路径**：`docs/knowledge/extensibility-index-reconciliation.md`
- **脱节类型**：路径描述与源码位置不符（re-export 层 vs 真实定义）
- **文档声明**（L52）：
  > `/web` 路径正则 5 处 —— **已闭环**：`frontend/src/backend/web-common.ts` 集中导出 `WEB_DIR_RE`/`WEB_NAME_RE`/`isWebPath`/`parseWebPath`/`parseWebDirPath`/`webDirType`
- **实际情况**：`WEB_DIR_RE` 定义在 `frontend/src/utils/base/pure/web-path.ts`（L6），`web-common.ts` 仅通过 `export { ... } from "@/utils/base/pure/web-path.ts"` re-export（L20-25）。`WEB_NAME_RE` 在 web-common.ts 内定义。ADR-217 下沉后真实定义位置已变。
- **严重程度**：🟡 中 — 对账卡的"集中导出点"表述仍成立（web-common.ts 是统一出口），但"定义点"已漂移，未来 grep 定位会走偏。

### 🟢 低（措辞不精确但功能存在 / 字段状态不合规）

#### 4. `extensibility-round2.md` — status 与 affected 字段不匹配

- **知识卡路径**：`docs/knowledge/extensibility-round2.md`
- **脱节类型**：frontmatter 字段状态违规
- **文档声明**：`status: active` + `affected: false`
- **实际情况**：AGENTS.md 明文规定 `affected: false` "应配 `snapshot`" 状态；本卡内容为一次性拓展点探索报告（265 行），非"随源码演进"的 active 卡。同批次 `extensibility-index-reconciliation.md` 与 `worker-bridge-settleerror-fallback.md` 都正确用了 `status: snapshot`。
- **严重程度**：🟢 低 — 字段不合规，drift 检查器会 WARN；功能不受影响。

#### 5. `mount3d-584-giant.md` — last_verified 与正文复核日期不一致

- **知识卡路径**：`docs/knowledge/mount3d-584-giant.md`
- **脱节类型**：frontmatter 与正文时间戳不一致
- **文档声明**：frontmatter `last_verified: 2026-09-03`
- **实际情况**：正文 L53 声明 "2026-09-05 复核（最新实测，取代 9-03/8-27 快照行号）"
- **严重程度**：🟢 低 — 卡片自身已说明复核节优先级，但 frontmatter 未同步更新。

#### 6. `go-paths.md` — 依赖范围描述与实际 import 图有偏差

- **知识卡路径**：`docs/knowledge/go-paths.md`
- **脱节类型**：描述与实现不符（依赖描述已自我修正但仍不够精确）
- **文档声明**（L75-76）：
  > 实际依赖范围：`go/installer`、`go/recycle` 与 `internal/app/resource_bindings.go` 三处引用本包
  > `internal/app` 的 `isPathInRoot`、`go/fileops.CopyModelFile`、`go/download.ResolveSavePath`、`go/importer.sanitizePath` 均各自实现守卫（语义近似但未收敛）
- **实际情况**：卡片本身已自纠（"知识卡旧文「仅两处」已过时"），但 "语义近似但未收敛" 的表述仍不够精确——`go/download/ResolveSavePath` 与 `go/importer.sanitizePath` 的守卫强度不一，是否"近似"需具体比对。
- **严重程度**：🟢 低 — 卡片自身已承认漂移并做了修正，属"活文档"状态。

---

## 三、诡异功能 + 诡异实现清单

### 1. `event-graph-guard.md` — 678 行正则静态分析器替代 AST 解析

- **知识卡路径**：`docs/knowledge/event-graph-guard.md`
- **功能描述**：从 `bus.ts` 的 `BusEvents` 接口提取权威事件清单，扫描全仓 TS/HTML，产出 `docs/event-graph.md`（契约守卫）。
- **代码实现**（`scripts/event-graph.ts`，678 行）：
  - 手写正则 + 偏移法提取 `bus.emit/on/once/off` 调用点
  - **可选链盲区修复**（L41-43）：旧版正则 `.` 无法匹配 `?.`，现改 `\s*\??\.\s*`
  - **跨行调用修复**（L44-48）：`CALL_HEAD_RE` + `extractArgs` 平衡括号取首参
  - **正则字面量引号陷阱修复**（L49-52）："lexer 启发式跳过正则字面量（前导字符判定 + 字符类感知 + 跨行降级）"
  - **实参计数**（L53-54）：平衡括号 + argc 校验
- **诡异度评估**：🟡 中诡异 — 这是"为绕过某限制"的教科书案例：**本可以集成 TypeScript Compiler API（`ts.parseSourceFile`）做 AST 分析**，但选择手写正则解析。文档自己也承认 "lexer 启发式" / "偏移法" / "平衡括号" 三件套是脆弱防线。678 行的字符串级 hack 替代 200 行 AST 代码，是典型的设计债务——每新增一种 JS 语法形态（可选链、跨行、正则字面量）都要打补丁。违反 AGENTS.md "通用化、统一、复用" 准则的"复用"精神（未复用 TypeScript 官方解析器）。

### 2. `worker-bridge-settleerror-fallback.md` — 字符串宽化掩盖穷举性风险

- **知识卡路径**：`docs/knowledge/worker-bridge-settleerror-fallback.md`
- **功能描述**：Worker 桥失败结算按 `WorkerErrorStrategy` 策略（`resolveAllError` / `terminatePool`）分派。
- **代码实现**：`settleError` 开头 `const onWorkerError = opts.onWorkerError ?? "resolveAllError"` 把联合类型**宽化为 `string`**，随后用 `if (onWorkerError === "terminatePool")` + `else if (makeErrorResponse)` 兜底。
- **诡异度评估**：🟢 低诡异 — 卡片自己明确承认："若未来加第三种策略，`settleError` 静默走 `makeErrorResponse` 分支"。这是**"文档承认诡异 + 代码确实诡异"**的典型案例——用 `string` 宽化规避 TypeScript 穷举检查，牺牲编译期安全换实现简洁。建议动作（L72-73）已提出 `assertNever` 或字面量联合修正。

### 3. `extensibility-index.md` / `extensibility-round2.md` — wasm 胶水字符串替换 hack

- **知识卡路径**：`docs/knowledge/extensibility-index.md` §7.1 / `docs/knowledge/extensibility-round2.md`
- **功能描述**：WASM 端 YSM 解析需要访问 `HEAPU8`，通过修改 Emscripten 生成的 `glueCode` 字符串注入导出。
- **代码实现**（`frontend/src/wasm/parser-shared.ts` L141-155，实测确认）：
  ```ts
  const patched = glueCode.replaceAll(
    ";updateMemoryViews()",
    ';updateMemoryViews();Module["HEAPU8"]=HEAPU8',
  );
  if (!patched.includes('Module["HEAPU8"]')) {
    throw new Error("patchGlueHeapExport: 胶水未命中 updateMemoryViews 调用点（Emscripten 胶水版本变更？）");
  }
  ```
- **诡异度评估**：🟡 中诡异 — 字符串替换 Emscripten 生成代码是**极脆弱**的做法：Emscripten 版本升级、`updateMemoryViews` 被改名、缩进变化都会导致 patch 失效。卡片自己用 `replaceAll` + 断言 + 错误提示兜底，但根本问题（依赖生成物内部结构）未解决。违反"通用化"原则——若 Emscripten 支持正规 export 机制应走正规通道。

### 4. `mount3d-584-giant.md` — 527 行闭包编排器 + 无 stage 缝

- **知识卡路径**：`docs/knowledge/mount3d-584-giant.md`
- **功能描述**：`mount3D` 统一挂载入口，单例外壳复用 + rAF 管线 + 生命周期。
- **代码实现**：`mount-preview-core.ts` 518 行（文件总量），`mount3D` 本体约 527 行，含 6+ 内嵌闭包（`finishSession` / `closeOverlay` / `fullCleanup` / `unloadSessionModel` / `escH` / `animate`）+ `session` / `switchCtx` / `camBridge` 接口胶水。
- **诡异度评估**：🟡 中诡异 — 卡片自己反复承认"无 stage 缝"、"强行外移 = 15-20 参数 ctx 参数化"、"闭包接线编排器"。这是"文档承认诡异"的典范——明知 500+ 行单函数不可持续，但因重构 ROI 低而保留。违反 AGENTS.md "重构当然好" 准则（但承认重构困难）。

### 5. `extensibility-index.md` §7.9 — bus.ts VOID_EVENTS 手抄双清单（已修复，但文档保留历史痕迹）

- **知识卡路径**：`docs/knowledge/extensibility-index.md`
- **功能描述**：`VOID_EVENTS` 常量定义了 8 个 void 事件，但 `emit` 里又手抄一份。
- **代码实现**：`frontend/src/bus.ts` L138 定义 `VOID_EVENTS`，L148-149 定义 `isVoidEvent()` 复用该清单。
- **诡异度评估**：🟢 已修复 — `emit` 内 L195-196 已改为 `isVoidEvent(event)`，消除双清单。这是**文档承认诡异 → 代码修复 → 文档仍保留历史**的良性闭环（对账卡却误标为"存活"，见脱节清单 #2）。

---

## 四、抽样未覆盖的重要知识卡（建议后续抽查）

- `scene_capability_registry.md` — render-federation 卡的"架构事实迁移"目标，未抽到但被多次引用
- `classify-routing.md` — 拓展点对账 Top 10 #2 的护栏卡
- `mount-preview-module-singleton-race.md` — 已 archived，但 `mount3D` 并发守卫的核心历史卡
- `preview_core.md` — ADR-066 D2 统一外壳核心卡
- `resource-registry.md` — 与 `utils-resource-types.md` 互补的单一事实源卡
- `3d-patterns.md` / `3d-oversize-file-codesplit-feasibility.md` — 3D 渲染架构决策卡
- `backend_web.md` / `backend-idb.md` / `web-fs.md` — 网页版桥接（Rust backend 相关）
- `ysm-wasm.md` / `ysm-anim-pipeline.md` — WASM 解码管线（涉及上面发现的字符串 hack）
- `mount-preview-module-singleton-race.md` — 代际守卫历史

---

## 五、总结

| 指标 | 数值 |
|---|---|
| 抽查张数 | 43 张（覆盖 186 张的 23%） |
| **脱节项** | 6 项（🔴 高 1 / 🟡 中 2 / 🟢 低 3） |
| **诡异功能+诡异实现** | 5 项（🟡 中 3 / 🟢 低 2，其中 1 项已修复） |
| **文件不存在** | 0 项（所有 source_files 均真实存在） |
| **符号不存在** | 0 项（抽查到的 invariant_anchors 符号均可 grep 到） |

### 文档整体可信度：🟢 **中偏高**

- **正面**：43 张抽查卡中 37 张（86%）描述与实现完全一致；所有 `source_files` 真实存在；`invariant_anchors` 符号均可 grep 命中；卡片普遍自带"已知遗留"、"审计备案"、"复核节"等自我修正机制，说明维护者对漂移有清醒认知；`status: superseded` / `archived` / `snapshot` 状态机使用规范。
- **负面**：1 项 🔴 高脱节（`ground-cap-materialgroup-factories.md` 整卡描述的设计已被 ADR-195 取代但 frontmatter `symbols_with_lines` 只列了 1 个幸存符号，drift 检查器无法捕获正文级漂移）；3 项 🟡 中诡异实现（正则解析器 / wasm 字符串 hack / 527 行闭包编排器）反映设计债务；对账卡 `extensibility-index-reconciliation.md` 的"存活"结论已老化 3 周未更新。
- **直觉判断**：文档体系**整体可信、局部有债**。核心架构卡（go-*、utils-*、前端 UI 卡）准确度高；快照型报告卡（对账、拓展点索引）因"一次性快照"属性天然易老化；render-federation / event-bus 等"架构事实迁移至 architecture.md"的 stub 卡是有意设计而非漂移，需审计时区分对待。

---

*报告由审计子代理生成，所有引用均基于 grep / read 实测，未运行 `check-knowledge-drift.ts`（机械校验由钩子负责）。*
