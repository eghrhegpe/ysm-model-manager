# ADR-137：YSM 解码子系统归位（views/app-preview/decoder → features/preview-3d，第五刀）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-31
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/adr/ADR-129-preview-3d-domain-root.md, docs/adr/ADR-136-screenshot-domain-homecoming.md, frontend/src/views/app-preview/wasm.ts, frontend/src/views/app-preview/geometry.ts, frontend/src/views/app-preview/cache.ts, frontend/src/views/app-preview/parse-ysm-json.ts, frontend/src/views/app-preview/texture-order.ts, frontend/src/views/app-preview/utils.ts`

---

## 1. 背景（Context）

ADR-129 三刀把 3D 预览领域根升格 `features/preview-3d`，ADR-136 第四刀把截图/离屏渲染领域归位。但 **YSM 解码子系统仍错住视图层**——它是 3D 预览的数据上游，却整体挤在 `views/app-preview/`，且是**非自包含的子系统**（宿主文件 + 4 个纯领域兄弟 + utils 领域部分）。

### 1.1 体量倒挂（同 ADR-129 §1.1 的延续）

| 层 | 文件 | 行数 | 语义 |
|----|------|------|------|
| `views/app-preview/wasm.ts` | 1 | 836 | `decodeYsmViaWasm` 主流程（WASM 解码 .ysm → BedrockGeometry + 动画 + 头像 + 动画组/配置） |
| `views/app-preview/geometry.ts` | 1 | 191 | `BedrockGeometry` 类型 + `parseBedrockGeometryFromJSON`（纯函数，文件头自述「无组件依赖」） |
| `views/app-preview/cache.ts` | 1 | 97 | 预览数据 FIFO 缓存 + evict 释放 blob URL（纯领域，模块级 Map，无 DOM） |
| `views/app-preview/parse-ysm-json.ts` | 1 | 153 | `parseYsmJsonDirect`（纯 JSON 格式 ysm.json 直解析，ADR-023 L3 纯函数） |
| `views/app-preview/texture-order.ts` | 1 | 45 | `buildOrderedTexKeys`（纹理序，与 Go `texture_order.go` 严格对称，纯函数） |
| `views/app-preview/utils.ts` | 1 | 156 | **混合**：纯领域 `DecodedYsm` / `stripYsgpTextHeader` / `devLog` + 视图接口 `PreviewRoot`/`YsmDecoder`/`PreviewCtx` + 状态 `getPrefer3D`/`setPrefer3D` |

YSM 解码是**有明确边界的内聚子系统**（输入 .ysm 字节 → 输出结构化解码结果），与视图渲染 / DOM / Go binding 胶水无关，却住在 `views/`——语义误导后来者「这是视图层可随手改的」。

### 1.2 依赖方向（现状 vs 目标）

- 现状：`wasm.ts` import `./geometry.ts` / `./cache.ts` / `./parse-ysm-json.ts` / `./texture-order.ts` / `./utils.ts`（全视图兄弟），且 `stripYsgpTextHeader` 还被 `workers/stats.worker.ts`（视图外 worker）消费——解码子系统在视图层内**藕断丝连**。
- 目标：解码子系统整体迁入 `features/preview-3d/decoder/`，视图层只留渲染编排（loadModelData）与 Go binding 胶水；`utils.ts` 的视图接口部分留视图，领域部分跟解码走。

### 1.3 消费者网络（影响面）

- `decodeYsmViaWasm`：`model3d-loader` / `skeleton-render`（ADR-136 已改注入）/ `index` / `detail` / `loader` / `ysm-3d` / `maid-3d`（全视图层）。
- `BedrockGeometry`：12+ 处 type import（全仓通用类型）。
- `cache`：`detail` / `loader` / `index` / `wasm`。
- `DecodedYsm`：`app-preview.methods.test` / `index` / `parse-ysm-json`。

---

## 2. 决策（Decision）

**把 YSM 解码子系统整体迁入 `features/preview-3d/decoder/`，`utils.ts` 拆分（领域部分跟解码走，视图接口留视图）。** 复用 ADR-072 边界判据：features 不反向 import views；视图壳负责 Go binding 胶水。本刀是归属正名，不改解码逻辑，行为由既有测试守。

### 2.1 迁移方案（对应 ADR-129 §2.4 第五刀候选）

| 项 | 去向 | 理由 |
|----|------|------|
| `wasm.ts` | `features/preview-3d/decoder/wasm-decode.ts` | 解码主流程归位；`../../wasm/ysm-parser.ts`（独立目录非视图层）改 `../../../../wasm/` 引用，无反向依赖 |
| `geometry.ts` | `features/preview-3d/decoder/geometry.ts` | 纯函数层（文件头自述「无组件依赖」），12+ 处消费方改 import |
| `cache.ts` | `features/preview-3d/decoder/cache.ts` | 纯领域缓存，evict 释放 blob URL 逻辑不动 |
| `parse-ysm-json.ts` | `features/preview-3d/decoder/parse-ysm-json.ts` | 纯函数层 |
| `texture-order.ts` | `features/preview-3d/decoder/texture-order.ts` | 纯函数层，与 Go 对称口径不动 |
| `utils.ts` 领域部分 | `features/preview-3d/decoder/`（`DecodedYsm` 类型 / `stripYsgpTextHeader` / `devLog`） | 纯领域，跟解码走 |
| `utils.ts` 视图部分 | **留 `views/app-preview/utils.ts`**（`PreviewRoot` / `YsmDecoder` / `PreviewDebugger` / `PreviewImageLoader` / `PreviewCtx` / `getPrefer3D` / `setPrefer3D`） | 视图接口与状态，属视图层 |

### 2.2 关键约束

- **只改物理位置与依赖方向，不改解码逻辑**：`decodeYsmViaWasm` 主流程 / `parseBedrockGeometryFromJSON` / `buildOrderedTexKeys` / `parseYsmJsonDirect` / cache FIFO 实现原样搬移，仅相对路径加深（`../../` → `../../../`/`../../../../`）。
- **features/preview-3d 维持 0 个 views import（运行时）**：decoder 内只 import features 内部 + utils/backend/wasm 正向；视图层从 decoder import。`stripYsgpTextHeader` 的 worker 消费者（`workers/stats.worker.ts`）改从 decoder import——worker 非视图层，正向。
- **`utils.ts` 不留 re-export 壳**（ADR-129 §3.3 教训：留壳即类型双源）：`DecodedYsm` / `stripYsgpTextHeader` / `devLog` 从视图 utils.ts 删除，消费方改指 decoder；视图接口 `Preview*` 留原文件，不搬。
- **不引入新机制**：复用既有 `DecodedYsm` / `BedrockGeometry` / `CacheValue` 契约与 `decodeYsmViaWasm` 签名，不新增抽象。
- **测试同迁**：`wasm.test.ts` / `geometry.test.ts` / `cache.test.ts` / `parse-ysm-json.test.ts` / `texture-order.test.ts` / `utils.test.ts` 随实现搬到 decoder；视图消费测试（`model3d-loader.test` / `skeleton.test` / `skeleton-render.test` / `detail.test` / `index` 相关）mock 路径同步。

### 2.3 不在本 ADR 范围

- **`loader.ts`（loadModelData 编排）归位 = 第六刀候选**：它编排解码 + 2D/3D 渲染 + Go binding，是「视图壳编排层」，本刀不搬（解码子系统搬完后其 import 改指 decoder 即可）。
- **`model3d-loader.ts` 归位**：它混 Go binding（GetModel3DSpec）+ WASM 兜底 + 平台判定（isViewerMode/isWebPlatform），是加载桥接胶水，留视图层（ADR-072 判据：视图壳负责调 Go binding）。
- **`wasm/` 目录（ysm-parser 等 WASM 胶水）**：已是独立 `src/wasm/` 目录，不在本刀范围。
- **`cacheSetEvictHandler` 注册点**（index.ts evict 注册 blob URL 释放）留视图层，decoder 只提供 cache 模块。

---

## 3. 后果（Consequences）

### 3.1 正面

- **YSM 解码子系统归位**：836 行解码主流程 + 4 个纯领域兄弟 + utils 领域部分整体入住 `features/preview-3d/decoder/`，与 3D 渲染域同根，语义不再误导。
- **依赖方向正**：features/preview-3d 无新增 views 运行时依赖；视图层只留渲染编排 + Go binding 胶水；worker 消费者正向改指 decoder。
- **为后续归位正地基**：`loader.ts` / `model3d-loader.ts` 的 import 改指 decoder 后，第六刀/后续归位影响面更小。

### 3.2 负面 / 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 影响面大（6 文件搬迁 + utils 拆分 + 15+ 处消费方 import + 6 份测试同迁 + 1 处 worker 消费者） | 🟡 | 分步实施（兄弟先行 → wasm 本体 → 视图层改 import → 测试迁移 → 验证提交）；每步 `npx vitest --run` 定向验证 |
| 相对路径加深易漏（`../../` → `../../../`/`../../../../`） | 🟡 | 机械替换 + typecheck 兜底（TS2307 即时拦截）；搬完全量 vitest |
| `utils.ts` 拆分漏改消费方（DecodedYsm/stripYsgpTextHeader 跨 5+ 处） | 🟡 | grep 消费方清单已建立；typecheck 兜底 |
| 知识卡 source_files 锚点漂移（app-preview / model3d / ysm-wasm / ysm-baked / format-ysm-anim-config 等卡） | 🟡 | 同步 knowledge 卡，跑 check-knowledge-drift 验证 |
| 与并行会话并发 | 🟢 | 路径限定提交，只交自己的文件 |

### 3.3 已知遗留

- 第六刀候选：`loader.ts`（loadModelData 编排）归位评估。
- 第七刀候选：`model3d-loader.ts`（Go binding 桥接 + 平台判定）归位评估。
- `views/app-preview/utils.ts` 拆分后仍含 `Preview*` 视图接口（属视图层，不搬）。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `wasm.ts` 通读 | 836 行解码主流程；import 5 个视图兄弟（utils/cache/geometry/parse-ysm-json/texture-order）+ 2 个 `../../` 层工具（safe-error-msg/ysm-anim-config）+ backend + wasm parser |
| `geometry.ts` 文件头 | 「preview 工具函数（纯函数，无组件依赖）」——纯函数层实证 |
| `cache.ts` 通读 | 97 行模块级 Map FIFO 缓存 + evict 释放 blob URL，无 DOM |
| `parse-ysm-json.ts` | 153 行纯函数（文件头自述「从 wasm.ts 抽出」），输入 unknown JSON 输出 DecodedYsm |
| `texture-order.ts` | 45 行纯函数，与 Go `texture_order.go` 对称（改口径必同步两侧） |
| `utils.ts` 通读 | 混合文件：`DecodedYsm`/`stripYsgpTextHeader`/`devLog`（纯领域）+ `PreviewRoot`/`YsmDecoder`/`PreviewCtx`/`getPrefer3D`/`setPrefer3D`（视图接口/状态） |
| `stripYsgpTextHeader` 消费方 grep | wasm.ts + `workers/stats.worker.ts`（视图外 worker）——decoder 迁入后改正向 |
| `decodeYsmViaWasm` 消费方 grep | model3d-loader / skeleton-render（ADR-136 已改注入）/ index / detail / loader / ysm-3d / maid-3d（全视图层） |
| ADR-129 §2.4 | 点名 views/app-preview 领域逻辑归属待定（第四刀候选）；wasm.ts 解码流水线为第五刀候选 |
| ADR-136 §2.3 | `decodeYsmViaWasm` 依赖注入隔离已落地（截图域），本刀搬移不破坏截图域 |

<!-- 文件名: ysm-decoder-homecoming.md → 实际文件 ADR-137-ysm-decoder-homecoming.md -->
