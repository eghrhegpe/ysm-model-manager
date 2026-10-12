# ADR-331：3D 错误消息国际化：friendlyError 旁路收窄与 CODE_KEYS 单源

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-12
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：动不变量——消除 utils-errors.md 互斥声明自相矛盾，把前端错误消费从汉字透传旁路收窄到 CODE_KEYS/AppError 单源，跨 Go/前端/i18n 三层、难逆转
- **相关**：ADR-051（错误分类单源）、ADR-045（i18n）、ADR-014 P2（错误信息友好化）；`docs/knowledge/utils-errors.md`；`docs/archive/preview-3d-review-tracker-2026-10-12.md` D1 条

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`friendlyError`（`frontend/src/utils/dom/errors.ts:47`）是前端错误→用户提示的统一入口。它当前含**两处「含汉字直接透传」旁路**：

```ts
// :58（AppError 路径）
if (/[\u4e00-\u9fff]/.test(msg)) return stripPathSegments(msg);
// :64（非 AppError 路径）
if (/[\u4e00-\u9fff]/.test(msg)) return stripPathSegments(msg);
```

逻辑：错误消息命中 CJK 汉字即 `return stripPathSegments(msg)`——**不翻译、不查 Code、不加前缀**，原样上屏。

**病灶一（互斥声明自相矛盾）**：`docs/knowledge/utils-errors.md` 的「不变量」声明「前端只消费结构化字段做 i18n」（ADR-051 完成后的口径），但同一卡「核心职责」又写「含汉字直接透传」。两条互斥——ADR-051 完成后的残留。

**病灶二（3D 路径恒中文）**：3D 读路径错误**无结构化 Code**（`GetModel3DSpec` 的守卫拒绝虽已 AppError 化，但读面失败 `geometryJSON 为空`/`无法解析 schematic`/`无法解析 NBT 结构` 等在切片 A 之前是裸中文 `error`；`ReadFileBytes*` 4 个绑定无 error 通道）→ `extractAppErrorCode` 返回 undefined → 走旁路 → en/ja 界面下 3D 加载失败消息**恒为中文**。

**病灶三（门禁守护缺失）**：`i18n-ui-check` 实测对 `throw new Error("中文")` **零命中**——判据是「含汉字 +（HTML 信号 ∪ value/text/tooltip 赋值头）」，`throw new Error("资源包信息为空")` 既无 HTML 信号又非赋值头，判定层直接跳过。**D1 修完没有任何前端门禁守护**，修完即回潮。

**现状**：`CODE_KEYS` 已覆盖 Go `ErrorCode` 全集 15 个（6 个差集映射到 `error.fileTooLarge/fileEmpty/mkdirFailed/writeFailed/ioError/linkFailed`，仅 UNKNOWN 由 `error.unknown` 兜底），5 处 Go 裸中文 error 改 `AppError{Code, Operation, Reason}`——「构造点 + 映射表」已就位，本 ADR 只决策「旁路收窄」这一动不变量。

## 2. 决策（Decision）

**收窄旁路 + 强化单源**，分三块落地。

### 2.1 旁路收窄（核心，动不变量）

- **已映射 Code 的 Reason**：`CODE_KEYS[code]` 命中即 `return t(key)`（现状已如此），中文 Reason **不再透传**——因为映射本身就是译文。
- **未映射 Code / 非 AppError 的含中文消息**：**不再原样透传**，改走 fallback（`${fb}: ${stripPathSegments(msg)}`）。即删除 `errors.ts:58` 与 `:64` 的汉字透传分支，或收窄为「仅内部白名单 Code 允许透传」。
- 兜底：`UNKNOWN` → `error.unknown`；`err == null` → `error.unknown`；英文消息 → `${fb}: ${msg}`（现状）。

**否决的替代方案**：

- *全量删中文透传 + 一律走 CODE_KEYS*：破坏 Go `Reason` 的语义。`Reason` 是 Go 侧填的用户可读文案（如「目标路径不可达」），前端再翻一遍是冗余且会丢上下文。故保留「Reason 可读」这一通道，只收窄「未映射时透传」这一旁路。
- *只改 3D 构造点不改旁路*：治标。`i18n-ui-check` 对 throw 零命中，旁路不收窄，新引入的裸中文 throw 依然恒中文，修完即回潮。

### 2.2 CODE_KEYS 单源加固

- 维持 `CODE_KEYS` 为唯一映射表（差集已纳入，见 §1 现状）。
- 后续新增 ErrorCode：**Go 侧 `types.go` 定义 + 前端 `CODE_KEYS` 同批补键**，二者原子提交（配套红线 R15「Go 产出码 ∉ 前端映射集即 WARN」已在 `ba6a713df` 立闸）。

### 2.3 消费端治理

- **12 处 overlay `safeErrorMessage` 用户可见站点改走 `friendlyError`**：`preview-3d/menu/engine/core.ts:372`、`preview-3d/menu/panels/roles-views.ts:155`、`views/app-preview/card-shell.ts:77`、`detail.ts:359`、`litematic-meta.ts:278`、`skeleton.ts:181`、`views/app-sidebar/sync-flow.ts:254/291`、`views/app-sync-manager/index.ts:266`、`features/community/download-queue.ts:333`、`views/app-content/diagnostics/perf-common.ts:159`、`services/cli-bridge.ts:164`。
  - 前提：这些站点非 Worker，可安全 import `friendlyError`（`utils/dom/errors.ts` 有 i18n 依赖，Worker 场景禁引）。
  - Worker 站点（`mmd-pmx-parser.worker.ts`、`mmd-ktx2-worker.ts`、`fbx-parser.worker.ts`、`stats.worker.ts` 等）**维持 `safeErrorMessage`**——这是它的设计场景。
  - 内部诊断（`devLog`/`dbg`/`console.warn`）**不改**——不进用户 UI。
- **`fbx-adapter.ts:120` 保留 Code 结构**：
  ```ts
  (e) => reject(e instanceof Error ? e : new Error(safeErrorMessage(e))),
  ```
  当前把带 `Code` 的 AppError 形态对象压成 `new Error(字符串)`，**`Code` 字段被丢弃**——切片 A 补的 AppError 结构化在此处归零。改为 `reject(e)` 或保留 `{Code, message}` 结构。

### 2.4 内部诊断 20 处中文：不治理，仅台账豁免

`parse-java-model.ts:178/185/230`（parent 循环引用/模型缺失/纹理变量循环引用）、`menu-graph.ts:175`（builder 抛错）、`core.ts:695/698`（重复 id 校验）、`light-capability.ts:205`、`scene-capability-registry.ts:88`、`mmd-ktx2-basis.ts:125` 等约 20 处 `throw new Error(中文)`：

- **不进用户 UI**（被 `health.ts` 捕获渲染为诊断态，`console.error` 为主）。
- 中文给开发者调试更有可读性，翻译反而不利。
- **决策**：不改。`i18n-ui-check` 第三通道对它们报 WARN，用 `// i18n-allow: 内部诊断通道，不进 UI` 台账豁免（同 `pointer-allow` 先例）。

### 2.5 门禁第三通道

`i18n-ui-check` 加第三通道 `THROW_REJECT`：匹配行内 `throw new Error(` / `reject(new Error(` / `throw new Error(t(...))` 前缀。命中且含中文、未包 `t()` 即入候选；带 `// i18n-allow: 内部诊断` 行注豁免。**否则 D1 修完无守护。**

## 3. 后果（Consequences）

**正面**：

- en/ja 界面下 3D 加载失败消息不再泄漏中文——用户可见面 i18n 完整。
- 消除 `utils-errors.md` 互斥声明——不变量声明与实现一致。
- `fbx-adapter.ts` 不再摧毁 AppError 的 `Code` 结构，切片 A 的 D4 修法在此处不归零。
- 门禁第三通道守护「throw/reject 中文」——修完不再回潮。

**负面 / 已知遗留**：

- **语义变化**：原本"未映射 Code 含中文 Reason 原样透传"的场景（如 `IO_ERROR` 的 Go Reason「磁盘未就绪」）不再透传，改走 `error.ioError` 通用译文。**用户看到的文案更通用但丢失 Go 侧的具体描述**——这是「分类优先于原文」的取舍，与 ADR-051 一致。
- **内部诊断 20 处中文仍无门禁守护**（仅台账豁免）——若未来某处诊断串被误接到用户 UI，会静默泄漏中文。属接受的权衡（开发可读性 > 机器洁净度）。
- **范围外**：`ReadFileBytes*` 4 个绑定无 error 通道（四情形全 `return nil`，Code 无从携带）+ `GetModel3DSpec` 空 spec 返回零值 struct 无原因——需 `ReadFileBytesEx` / `GetModel3DSpecDiagnostics` 增量，破坏契约，**不在本 ADR 决策范围**。
- **web 模式**：`web-fs-*` 走 browserAdapter，无 Go AppError，错误经 `web-community.ts:393/471/516` 等已 `t()` 收口——本 ADR 不涉及。

## 4. 数据溯源

- 病灶一（互斥声明）：`docs/knowledge/utils-errors.md:73`「前端只消费结构化字段做 i18n」vs `:52-53`「含汉字直接透传」——实读两处。
- 病灶二（3D 恒中文）：`frontend/src/utils/dom/errors.ts:58/64` 旁路实证 + `GetModel3DSpec` 读面失败无 Code（切片 A 前）——子代理逐条核对 `app_model.go` / `resource_bindings.go`。
- 病灶三（门禁缺失）：`node scripts/i18n-ui-check.ts` 实测扫 622 文件**输出零命中**——`throw new Error("资源包信息为空")` 被判定层 `continue` 跳过。
- 12 处 overlay 站点：`grep -rn safeErrorMessage frontend/src/` 97 处引用，剔除 `devLog`/`dbg`/`console.warn`/Worker 后剩余 12 处用户可见站点。
- 现状：`4accae610`（CODE_KEYS 差集 + Go AppError 化 + 三语补键），见 §1 现状。
- 配套闸：`ba6a713df`（红线 R15 CODE_KEYS 漂移前向闸），见 §2.2。