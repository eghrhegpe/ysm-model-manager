# ADR-153：stats.worker mt WASM 条件加载——静态 import 改动态 import

- **状态**：✅ 已采纳
- **实施状态**：已落地（2026-09-02）
- **日期**：2026-09-02
- **决策人**：AI 代理
- **相关**：`frontend/src/workers/stats.worker.ts`, `frontend/src/wasm/ysm-wasm-data-mt.js`, `frontend/src/wasm/ysm-worker-loader.ts`, ADR-079

---

## 1. 背景（Context）

`stats.worker.ts` 静态 import 了两个 WASM 数据模块：

```typescript
import { _getWasmBinary } from "./ysm-wasm-data.js";      // 1,492 KB
import { _getWasmBinaryMt } from "./ysm-wasm-data-mt.js";  // 1,487 KB ← 浪费
import { _getGlueCode } from "./ysm-glue-data.js";         // 102 KB
import { _getGlueCodeMt } from "./ysm-glue-data-mt.js";    // 120 KB ← 浪费
```

导致 `stats.worker` chunk 达到 **3.1 MB**（桌面/Wails 首屏必下载）。

mt 版本仅在 `crossOriginIsolated === true` 时使用（`stats.worker.ts:108`），非 COOP-COEP 环境（GitHub Pages、普通 WebView2）完全用不到 mt 变体，却白白携带 1.45 MB。

## 2. 决策（Decision）

将 mt 数据模块的静态 import 改为**运行时动态 import**，仅在 `initYsmParserInWorkerMt()` 被调用时才加载。

### 2.1 为什么动态 import 可行

- **Worker 内支持动态 import()**：vite 打包 Worker 为 ES module（`type: "module"`），动态 import 正常返回 Promise。旧注释"Worker 内不支持动态 import"是历史遗留（对应旧 IIFE 打包模式）。
- **时序可控**：`initYsmParserInWorkerMt()` 已是 async，动态 import 的 Promise 用 `await` 衔接，顺序保证。
- **缓存行为不变**：动态 import 返回的模块被浏览器缓存，后续调用不重复下载。

### 2.2 为什么不用条件静态 import

- Vite 不支持 `import(...)` 的条件静态语法
- 条件静态 import 仍需两个模块在编译期可见，无法拆分 chunk
- 动态 import 是唯一能实现 chunk 分离的方案

## 3. 后果（Consequences）

### 正面
- 非 COOP-COEP 环境首包减少 ~1.5 MB（stats.worker chunk 从 3.1 MB → 1.6 MB）
- COOP-COEP 环境首次搜索多一次异步加载（~50-200ms），但 mt 性能增益补偿
- 测试覆盖不变（`initYsmParserInWorkerMt` 仍被 mock）

### 负面
- `ysm-worker-loader.ts` 新增 `loadMtAssets()` 辅助函数
- 测试需 mock `import()` 返回（vitest `vi.mock` 已处理，无需额外工作）
- 若动态 import 失败（网络问题），回退单线程逻辑已有（现有测试已覆盖）

### 不变
- 主线程 WASM 加载路径不受影响（`ysm-parser.ts` 仍用静态 import）
- `stats.worker.ts` 调用方零改动
- 单测覆盖的回调路径（mt 失败 → 单线程回退）行为不变

## 4. 替代方案（Alternatives）

| 方案 | 优点 | 缺点 |
|------|------|------|
| 保留静态 import（现状） | 简单 | 3.1MB chunk，非 COOP-COEP 浪费 |
| 拆分出独立 mt worker | 精确 code-split | 架构复杂，增加维护成本 |
| 动态 import（采用） | 首包减半，COOP-COEP 无损 | 少量代码改动 |

## 5. 参考（References）

- ADR-079：WASM pthread 多线程架构
- `frontend/src/workers/stats.worker.ts:108`：运行时条件判断
- `frontend/vite-wasm-data-stubs.ts`：测试桩插件
