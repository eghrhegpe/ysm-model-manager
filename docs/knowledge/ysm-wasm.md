---
kind: ysm-wasm
name: WASM 解析器 ysm-parser
tier: architecture
category: utils
source_files:
  - frontend/src/wasm/
  - internal/app/wasm_decoder.go
  - go/avatar/avatar_decode.go
auto_fields:
  symbols_with_lines:
    - _getGlueCode:3
    - _getGlueCodeMt:3
    - _getWasmBinary:3
    - _getWasmBinaryMt:4
    - classifyWasmError:55
    - collectOutputFiles:102
    - decodeYsmFile:180
    - decodeYsmFileFromMemory:131
    - DecodeYSMFiles:75
    - decodeYsmInWorker:198
    - decodeYsmInWorkerMemfs:237
    - ensureDir:92
    - FS:112
    - FSLike:14
    - initYSMParser:55
    - initYsmParserInWorker:54
    - initYsmParserInWorkerMt:101
    - patchGlueHeapExport:141
    - resolveWasmFactory:154
    - SetNodeJS:44
    - WasmModuleLike:26
    - wipeDir:78
    - Write:66
    - writeHeapBytes:123
    - YsmDecodedFile:8
  quick_groups:
    - 3D 预览与模型追加
  quick_intents:
    - WASM 解析器、YSMParser、ysm 解码
    - 加密模型、wasm 加载、Emscripten
    - MEMFS / node 解码 / callMain
  quick_risk_lines:
    - YSM 前端解码必须走 ysm-wasm 的 WASM 解析器，禁止手写 YSM 字节流解析
  pitfalls:
    - 手写 YSM 字节流解析 → 与 YSMParser WASM 输出不一致；必须经 ysm-wasm
    - wasmBinary 未释放 → 内存泄漏；必须复用 wasm 实例并释放
    - Worker 内静态 import WASM 数据模块 → 另一变体成 1.5MB 死重；必须动态 import
    - vite worker.format 未设 es → iife 强制 inlineDynamicImports，动态 import 构建直接失败
  use_when:
    - WASM
    - YSMParser
    - ysm 解码
    - wasm 加载
    - MEMFS
    - callMain
    - stats.worker
    - 按需加载
    - crossOriginIsolated
    - worker.format
    - pthread
  invariant_anchors:
    - go/avatar/avatar_decode.go|DecodeYSMFiles
    - go/avatar/avatar_decode.go|SetNodeJS
    - internal/app/wasm_decoder.go|decodeYSMViaNodeJS
  perf:
    - cpu-bound
    - single-thread
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - WASM 解析器、YSMParser、ysm 解码
  - 加密模型、wasm 加载、Emscripten
  - MEMFS / node 解码 / callMain
quick_risk_lines:
  - YSM 前端解码必须走 ysm-wasm 的 WASM 解析器，禁止手写 YSM 字节流解析
pitfalls:
  - 手写 YSM 字节流解析 → 与 YSMParser WASM 输出不一致；必须经 ysm-wasm
  - wasmBinary 未释放 → 内存泄漏；必须复用 wasm 实例并释放
  - Worker 内静态 import WASM 数据模块 → 另一变体成 1.5MB 死重；必须动态 import
  - vite worker.format 未设 es → iife 强制 inlineDynamicImports，动态 import 构建直接失败

use_when:
  - WASM
  - YSMParser
  - ysm 解码
  - wasm 加载
  - MEMFS
  - callMain
  - stats.worker
  - 按需加载
  - crossOriginIsolated
  - worker.format
  - pthread
invariant_anchors:
  - go/avatar/avatar_decode.go|DecodeYSMFiles
  - go/avatar/avatar_decode.go|SetNodeJS
  - internal/app/wasm_decoder.go|decodeYSMViaNodeJS
perf:
  - cpu-bound
  - single-thread
status: active
---

# WASM 解析器 ysm-parser

## 概览

YSMParser WASM 的前端胶水层（算法口径与 YSMViewer 一致）：`ysm-parser.ts` 负责加载、初始化与解码调用；`ysm-wasm-data.js` / `ysm-glue-data.js` 是 base64 内嵌的 WASM 二进制与 Emscripten 胶水代码。采用 `Module.wasmBinary` 注入方式加载，规避 WebView2 的 fetch() 限制。**解码能力同一份 C++ 解析器，但存在两条运行时路径**：前端 WebView2（本卡）与 Go 端 Node.js 子进程（`internal/app/wasm_decoder.go`，生产主路径，见下节）。Go 端元数据解析见 [go_ysm_parser](./go-ysm-parser.md)。

## WASM 资产（同一份）

前端内嵌（`ysm-wasm-data.js` + `ysm-glue-data.js`）与 `frontend/public/wasm/YSMParser.{js,wasm}`（`embed.go` → `frontend/dist/wasm/`）**是同一份二进制**（sha256 一致，均 2026-08-08 重出，含 `ysm_decode_from_memory` / `_malloc` / `ccall` 与 `_main`）。历史曾分裂为「前端 6-08 有内存直解 / Go 6-17 仅 callMain」两份导出面不同的资产，现已合并统一。Go 端出于历史原因仍走 `callMain` + MEMFS（见下节），虽资产已含 `ysm_decode_from_memory` 但未切换内存直解路径。

## Go 端 Node.js + WASM 解码（生产主路径）

发版不打包 exe 时，`.ysm` 解码的唯一路径（`app_model.go` `runYSMParserOnFile`：`FindCLI()` 找不到 exe → `decodeYSMViaNodeJS`）：

1. `findNodeJS()` 在 PATH 找 `node`/`node.exe`（`wasm_decoder.go` 内 `nodeJSPath` 包级变量），无 node 则此路径不可用；
2. 内嵌 glue + wasm 写临时目录，拼 `decode.cjs`：`require(glue)` → `await YSMParser({ wasmBinary, noInitialRun: true })` → `FS.writeFile('/input/model.ysm')` → **`mod.callMain(['-i','/input','-o','/output'])`** → 递归收集 `/output`，打 `FILES_JSON:` 标记；
3. 子进程 `HideWindow` + **context 超时护栏**（`wasm_decoder.go` `exec.CommandContext` + `ysmNodeDecodeTimeout` 60s，node 卡死超时即弃；`limitedBuffer` 流式截断 stdout/stderr——`ysmDecodeMaxOutput` 200MB 输出上限 + stderr 8MB 封顶，防解压炸弹膨胀父进程内存，`go/avatar/avatar_decode.go` 同源同款）；输出经 `geometry.ParseBedrockGeometry` 合并多骨骼/纹理 base64 → `types.BedrockModel`；
4. **纯 Node 即可解码，不依赖浏览器**（已实测 `upstream/` 下 10 个 .ysm 全部解出骨骼/动画/纹理/头像）。`go/avatar/avatar_decode.go` `DecodeYSMFiles` 同机制复用（头像提取）。

## 核心职责

- WASM 加载与初始化（base64 取二进制 + 间接 eval 执行胶水代码 + 工厂实例化，并发调用去重）
- 内存直解 .ysm（优先路径，无文件 I/O）与 callMain + MEMFS 解码（回退路径）
- WASM 虚拟文件系统管理（/input /output 目录清理与产物收集）

## Worker 侧独立加载器（ADR-153 按需加载）

`frontend/src/wasm/ysm-worker-loader.ts` 是 Worker 内的**独立**加载器——绝不共用主线程 `wasmModule` 单例（Worker 内 WASM 加载必须独立），被 `stats.worker.ts` 独占引用。

**base / mt 双变体互斥**：运行时按 `crossOriginIsolated` 二选一——COI 环境走 pthread 多线程版（mt，需 SharedArrayBuffer），非 COI 走单线程版（base）。二者各约 1.5 MiB，同一环境只用其一。

三条硬约束：

1. **两组数据模块均必须动态 import**（`loadBaseAssets()` / `loadMtAssets()`）。静态 import 会让另一变体成为随 chunk 全量下载的死重，而 `app-modules.ts` 启动 2s 后的 `prefetchStatsWorker()` 会**主动预取**整个 worker chunk。实测：双向懒加载后 `stats.worker` chunk 从 1,606,069 B 降至 11,778 B（−99.3%），COI 环境总下载从 3.07 MiB 降至 1.62 MiB。
2. **vite 的 `worker.format` 必须显式设为 `"es"`**（`vite.config.js` + `vite.web.config.ts` 两份都要）。Vite 默认 `iife`（源码 `config.worker?.format || "iife"`），iife 下 rollup 强制 `inlineDynamicImports` → 动态 import 无法 code-split → 构建报 `IIFE output formats are not supported for code-splitting builds`。此约束由 `frontend/src/wasm/lazy-import-guard.test.ts` 守卫。**改动任一处前先确认另一处未被回退。**
3. **base 数据不可移除**。`resetYsmParserInWorker()` 在 WASM 硬崩溃（fatal / exit）后把单例置 null，此后 `decodeYsmInWorker` / `decodeYsmInWorkerMemfs` 的 `if (!wasmModule)` 分支走**单线程** init 恢复——单线程是 COI 环境下的合法崩溃恢复路径，只能从「常驻」降级为「按需加载」。

守卫测试 `lazy-import-guard.test.ts` 直接对源码做静态断言（不依赖构建产物，build 前即可拦截退化）：loader 内不得出现四个数据模块的静态 import（含 `import "./mod.js"` 副作用形态），且两份 vite 配置的 worker 段须含 `format: "es"`。

## 对外 API / 入口

`ysm-parser.ts`：
- `initYSMParser(): Promise<boolean>` — 初始化单例：从两个 *-data.js 取 wasmBinary 与胶水代码，patch 胶水（每个 `updateMemoryViews()` 调用后导出 HEAPU8 到 Module，应对内存扩容），设置 `window.Module = { wasmBinary, noInitialRun, ... }` 后间接 eval 执行，再调 `YSMParserModule` 工厂；加载中再次调用会挂入 waiters 队列不重复加载
- `decodeYsmFileFromMemory(bytes: Uint8Array): Promise<YsmDecodedFile[] | null>` — **优先路径**：`_malloc` 写入字节 → `ccall("ysm_decode_from_memory", ...)` 解码到 /output → 收集产物；`finally` 中 `_free` 保证释放；失败返回 null
- `decodeYsmFile(bytes: Uint8Array): Promise<YsmDecodedFile[]>` — 回退路径：写 /input/model.ysm → `callMain(["-i","/input","-o","/output"])` → 收集；ExitStatus 异常按退出码判定
- `YsmDecodedFile` 接口：`{ path, data: Uint8Array }`
- 内部助手（未导出）：_getHeap（从 Module.HEAPU8 取最新堆视图）、_writeHeap、wipeDir、ensureDir、collectOutputFiles

`ysm-wasm-data.js` / `ysm-glue-data.js`：
- `_getWasmBinary()` / `_getGlueCode()` — base64 解码返回内嵌数据

## 与其他子系统关系

- 消费方：`frontend/src/preview-3d/decoder/wasm-decode.ts`（预览面板 WASM 解码分支，decodeYsmViaWasm，ADR-137 归位）、`web-spike/main.ts`（开发联调入口）
- 解码产物（模型 JSON/纹理/动画）流向 preview-cache 与 [animation_system](./animation-system.md) 的 parseBedrockAnimationJSON
- 兜底链路：前端 WASM 不可用时回退 Go 端解析（`app_model.go` `AnalyzeBedrockModel`，其内部再走 Node.js + WASM / exe，见上节）

## 不变量

- **两个 *-data.js 是自动生成的 base64 数据文件（豁免文件），禁止手改**；更新需走生成脚本重新产出
- **WASM 资产为同一份**：前端内嵌与 `frontend/public/wasm/YSMParser.wasm` 同源（2026-08-08 重出，sha256 一致），均导出 `ysm_decode_from_memory` / `_malloc` / `ccall` 与 `_main`。Go 端 `wasm_decoder.go` 出于历史原因固定走 `callMain` + MEMFS，未切换内存直解路径——**「Node 下 `_malloc` 不可用」≠「Node 下无法解码」**（两条路径均可解码）
- **已知问题已修复（审计核实 2026-08-08）**：此前知识卡/注释声称 `ysm-glue-data.js` 的 `_getGlueCode` 引用未声明 `_cachedWasm`（ReferenceError）且返回 ArrayBuffer——**现状数据文件无缓存变量（局部 `const b64`）、返回 TextDecoder string**，bug 已不存在，「WASM 路径必静默回退 Go」假设已失效；内存直解路径（`decodeYsmFileFromMemory`）实际可用，需在真实 WebView2 环境做一次端到端回归确认后按正式路径维护
- `_malloc` 的指针必须在 finally 中 `_free`；HEAPU8 每次从 `window.Module` 取最新值（内存扩容后旧视图失效）
  - **WASM 内存陷阱（历史，2026-08-20 第六轮审核已修复）**：`_malloc` 触发 growMemory 后旧 `HEAPU8` 视图指向已 detached 的 ArrayBuffer——向旧视图写入**不报错但数据丢失**，症状延迟到渲染阶段（解码全乱/模型变形），极难定位。防御：**永远不要在任何可能触发 grow 的调用（如 `_malloc`）之前缓存 HEAPU8**；每次写入都经 `_getHeap()` 取最新视图。相关：ADR-109 代码审查 Checklist（WASM 内存安全部分）。
- WASM 加载状态是模块级单例（wasmModule/loading/waiters），不得挂额外 window 全局
- **WASM 生命周期管理**（审计发现）：`decodeYsmFile` 回退路径中，MEMFS 输出文件读取后必须 `FS.unlink` 清理（`wipeDir`，已落地）；`decodeYsmFileFromMemory` 内存直解路径的 /output 在下一次调用前清理（P3 观察：成功后未立即 wipe，产物常驻至下次解码）。WASM 为 **app 级常驻单例**（initYSMParser 懒加载后生命周期等同应用，与 ADR-039 §2.2 常驻单例豁免同类），**无销毁场景**——曾提供 `destroyYSMParser()` 但 `_free(0)` 无法真正释放 HEAP，且销毁后重新 init 有加载成本，已移除（2026-08-06，knip 死代码基线）。若未来出现真实长运行内存压力场景，应实现真正的 Emscripten 实例销毁（`Module.destroy`/instance 释放）而非 `_free(0)`。

## 相关

- [go_ysm_parser](./go-ysm-parser.md) — Go 端兜底解析
- [app_preview](./app-preview.md) — 预览面板消费方
- [animation_system](./animation-system.md) — 解码出的动画 JSON 解析
