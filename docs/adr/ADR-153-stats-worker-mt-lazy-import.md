# ADR-153：stats.worker WASM 资产条件加载——base / mt 双向动态 import

- **状态**：✅ 已采纳
- **日期**：2026-09-02
- **决策人**：AI 代理（联邦协作）
- **相关**：`frontend/src/wasm/ysm-worker-loader.ts`、`frontend/src/workers/stats.worker.ts`、`frontend/vite.config.js`、`frontend/vite.web.config.ts`、ADR-079

> **本 ADR 已修订两次**（8470e47d → 8602b521 → 本次）。修订动机是首版存在两处事实错误，
> 详见 §6 修订记录。阅读时以本文档为准。

---

## 1. 背景（Context）

`stats.worker.ts` 静态 import 了两组 WASM 数据模块，而二者**互斥**——运行时按
`crossOriginIsolated` 二选一（`stats.worker.ts:108`）：

```typescript
import { _getWasmBinary } from "./ysm-wasm-data.js";      // 1,492 KB
import { _getWasmBinaryMt } from "./ysm-wasm-data-mt.js";  // 1,487 KB
import { _getGlueCode } from "./ysm-glue-data.js";         // 102 KB
import { _getGlueCodeMt } from "./ysm-glue-data-mt.js";    // 120 KB
```

结果：`stats.worker` chunk 达到 **3.06 MiB**，而任何单一环境最多只用其中一半。

- 非 COOP-COEP 环境（GitHub Pages、普通 WebView2）：mt 的 1.53 MiB 是死重
- COOP-COEP 环境（Wails 桌面端、网页版 coi-sw）：base 的 1.52 MiB 是死重

雪上加霜的是 `app-modules.ts:102` 在启动 2s 后调用 `prefetchStatsWorker()` **主动预下载**
整个 worker chunk —— 死重不是"用到才下"，而是开页 2 秒后主动去抢首屏带宽。

## 2. 决策（Decision）

**base 与 mt 两组数据模块均改为运行时动态 import**，按 `crossOriginIsolated` 二选一加载。

### 2.1 为什么是双向，而非只改 mt

只把 mt 改为动态 import（首版方案）只能覆盖非 COI 环境，COI 环境下 base 仍是死重。
既然解锁成本（§2.2）对两者是同一个开关，没有理由只做半边。

### 2.2 关键前置：必须显式设置 `worker.format = "es"`

这是本方案**唯一的硬约束**，也是首版构建失败的直接原因。

`new Worker(url, { type: "module" })` 是 Worker 的**创建方式**，与 Worker bundle 的
**输出格式**是两件独立的事。Vite 的默认值是 iife：

```
vite/dist/node/chunks/dep-Dm0c1Wj2.js:49135
  format: config.worker?.format || "iife"
```

iife 格式下 rollup 强制 `inlineDynamicImports: true`（同文件 `:46301`），动态 import 无法
产出独立 chunk，构建直接失败：

```
"IIFE output formats are not supported for code-splitting builds"
```

因此两个 vite 配置都必须显式声明：

```javascript
worker: {
  format: "es",   // ADR-153：worker 内动态 import 需要 ESM 格式
  plugins: () => [wasmDataStubs()],
}
```

**兼容性说明**：这不是新增风险。全仓 Worker 创建**早已全部**使用
`{ type: "module" }`（`web-stats.ts:101/116`、`mmd-ktx2-encoder.ts:144`、
`worker-bridge.ts:170`），module worker 的浏览器门槛（Firefox 114+ / Safari 15+）
在当前代码中就已经存在。iife 塞进 module worker 本就是降级跑法，改为 es 只是让
输出格式与创建方式对齐。

### 2.3 base 不可移除，只能懒加载

`resetYsmParserInWorker()`（`ysm-worker-loader.ts`）在 WASM 硬崩溃（fatal / exit）后把
单例 `wasmModule` 置 null；此后 `decodeYsmInWorker` / `decodeYsmInWorkerMemfs` 的
`if (!wasmModule) await initYsmParserInWorker()` 分支会走**单线程** init 恢复。

即：**单线程是 COI 环境下的合法崩溃恢复路径**。base 数据因此必须从"常驻"降级为
"按需加载"，而不能删除。

### 2.4 与主线程口径对齐

主线程 `ysm-parser.ts:67-68` 早已对 base 数据使用动态 import：

```typescript
const { _getWasmBinary } = await import("./ysm-wasm-data.js");
const { _getGlueCode } = await import("./ysm-glue-data.js");
```

本次改动让 Worker 侧与主线程口径一致，消除了"同一份数据两种加载策略"的不一致。

## 3. 后果（Consequences）

### 3.1 实测数据（`npx vite build` 产物）

| 阶段 | stats.worker chunk | COI 总下载 | 非 COI 总下载 |
|------|-------------------|-----------|--------------|
| 原始（静态双载） | 3.06 MiB | 3.06 MiB | 3.06 MiB |
| 路线 B（仅 mt 懒加载） | 1,606,069 B (1.53 MiB) | 3.07 MiB | 1.53 MiB |
| **路线 A（双向懒加载）** | **11,778 B (11.5 KB)** | **1.62 MiB** | **1.61 MiB** |

worker chunk 缩减 **99.3%**；COI 环境（Wails 桌面端主场景）下载量降低 **47%**。

### 3.2 无重复产物

worker chunk 内的 4 个动态 import 指向与主 bundle **完全相同**的文件名：

```
import("./ysm-wasm-data-B8O9TyyH.js")        ← 与主 bundle 共享
import("./ysm-glue-data-VXNY77_m.js")        ← 与主 bundle 共享
import("./ysm-wasm-data-mt-DvFY8BHF.js")
import("./ysm-glue-data-mt-gvlUrpx3.js")
```

st 数据在主线程与 Worker 之间共用同一份 chunk，未产生第二份副本。

### 3.3 正面

- 两种环境下各只下载一组 WASM 资产（约 1.6 MiB），死重归零
- COI 环境（桌面端主场景）首屏预取量减半
- 与主线程加载口径统一

### 3.4 负面

- 首次解析多一次异步 chunk 加载（base 或 mt，约 50–200 ms，缓存后为零）
- 非 COI 环境相比路线 B 多一次 chunk 请求（约 +80 KB 往返开销，换取 COI 环境 −47%）
- 崩溃恢复路径在 COI 环境下会触发 base chunk 的首次下载（此前已内联、无此开销）

### 3.5 不变

- `stats.worker.ts` 调用方零改动（运行时判定逻辑本就完备）
- mt 失败 → 单线程回退的契约不变（`stats.worker.test.ts` 两个用例覆盖，仍全绿）
- `wasmModule` 单例语义、Blob URL 生命周期、崩溃重置链均不变

## 4. 替代方案（Alternatives）

| 方案 | 优点 | 缺点 |
|------|------|------|
| 保留静态 import（原始状态） | 零改动 | 两种环境各背 1.5 MiB 死重，且被 prefetch 主动预取 |
| 仅 mt 改动态 import（首版） | 非 COI 省 50% | COI 环境（桌面端主场景）零收益；半边账 |
| 拆分出独立 mt worker | 精确 code-split | 架构复杂，需双 Worker 编排 |
| **双向动态 import（采用）** | 两环境各只下一组资产 | 需显式设 `worker.format:"es"`；非 COI 多一次请求 |
| 构建期二选一（define 决定打 st 或 mt） | 运行时零开销 | 需产出两套构建产物；崩溃恢复路径失效 |

## 5. 验证方法

```bash
# 构建并核对 worker chunk 体积（核心指标：应 ≈12 KB，而非 1.6 MB）
cd frontend && npx vite build
ls -la dist/assets | grep -iE "stats.worker|ysm-wasm-data|ysm-glue-data"

# 单测 + 类型
npx vitest run src/workers/stats.worker.test.ts
npm run typecheck
```

## 6. 修订记录

| 提交 | 内容 | 问题 |
|------|------|------|
| `8470e47d` | 首版：仅 mt 改动态 import，新增 ADR-153 | 未设 `worker.format:"es"` → iife 不支持 code-splitting → **构建失败**；ADR §2.1 误判旧注释为"历史遗留" |
| `8602b521` | 补 `worker.format:"es"`（两个 vite 配置） | 修复构建；路线 B 达成，但 COI 环境 st 死重未处理 |
| 本次 | 双向懒加载（路线 A）+ 订正 ADR | — |

**订正的两处事实错误**（首版 ADR）：

1. ~~"旧注释'Worker 内不支持动态 import'是历史遗留"~~ —— 错误。旧注释准确描述了 iife
   约束；`8602b521` 必须显式加 `format:"es"` 才能让构建通过，反向证明旧注释成立。
2. ~~"主线程 `ysm-parser.ts` 仍用静态 import"~~ —— 错误。`ysm-parser.ts:67-68` 早已使用
   动态 import（见 §2.4）。

## 7. 参考（References）

- ADR-079：WASM pthread 多线程架构（M3/M4）
- `frontend/src/workers/stats.worker.ts:108`：运行时 `crossOriginIsolated` 判定
- `frontend/src/wasm/ysm-parser.ts:67-68`：主线程动态 import 先例
- `frontend/vite-wasm-data-stubs.ts`：数据文件缺失时的构建期桩
- Vite 源码 `dist/node/chunks/dep-Dm0c1Wj2.js:49135`（worker.format 默认值）与
  `:46301`（iife → inlineDynamicImports）
