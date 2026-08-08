---
kind: ysm-wasm
name: WASM 解析器 ysm-parser
tier: architecture
category: utils
source_files:
  - frontend/src/wasm/ysm-parser.ts
  - frontend/src/wasm/ysm-glue-data.js
  - frontend/src/wasm/ysm-wasm-data.js
  - internal/app/wasm_decoder.go
  - go/avatar/avatar.go
use_when:
  - WASM
  - YSMParser
  - ysm 解码
  - 加密模型
  - wasm 加载
  - Emscripten
  - MEMFS
  - node 解码
  - callMain
---

# WASM 解析器 ysm-parser

## 概览

YSMParser WASM 的前端胶水层（算法口径与 YSMViewer 一致）：`ysm-parser.ts` 负责加载、初始化与解码调用；`ysm-wasm-data.js` / `ysm-glue-data.js` 是 base64 内嵌的 WASM 二进制与 Emscripten 胶水代码。采用 `Module.wasmBinary` 注入方式加载，规避 WebView2 的 fetch() 限制。**解码能力同一份 C++ 解析器，但存在两条运行时路径**：前端 WebView2（本卡）与 Go 端 Node.js 子进程（`internal/app/wasm_decoder.go`，生产主路径，见下节）。Go 端元数据解析见 [go_ysm_parser](./go-ysm-parser.md)。

## 两份 WASM 资产（导出面不同）

| 资产 | 位置 | 编译时间 | 导出面 | 运行时 |
|------|------|----------|--------|--------|
| 前端版 | `ysm-wasm-data.js` + `ysm-glue-data.js` | 2026-06-08 | `ysm_decode_from_memory` / `_malloc` / `ccall` | WebView2 内存直解 |
| Go 版 | `frontend/public/wasm/YSMParser.{js,wasm}`（`embed.go` → `frontend/dist/wasm/`） | 2026-06-17 | 仅 `_main`（`callMain`） | Node.js 子进程 |

Go 版**未导出 `_malloc`/`ccall`/`ysm_decode_from_memory`**——「内存直解」API 只在 6-08 前端版存在；Go 端一律走 `callMain`（与 CLI exe 相同的 `-i/-o` 参数路径）。两处资产非同一份二进制，更新上游需同步重出。

## Go 端 Node.js + WASM 解码（生产主路径）

发版不打包 exe 时，`.ysm` 解码的唯一路径（`app_model.go` `runYSMParserOnFile`：`FindCLI()` 找不到 exe → `decodeYSMViaNodeJS`）：

1. `findNodeJS()` 在 PATH 找 `node`/`node.exe`（`wasm_decoder.go:25`），无 node 则此路径不可用；
2. 内嵌 glue + wasm 写临时目录，拼 `decode.cjs`：`require(glue)` → `await YSMParser({ wasmBinary, noInitialRun: true })` → `FS.writeFile('/input/model.ysm')` → **`mod.callMain(['-i','/input','-o','/output'])`** → 递归收集 `/output`，打 `FILES_JSON:` 标记；
3. 子进程超时护栏 + `HideWindow`；输出经 `geometry.ParseBedrockGeometry` 合并多骨骼/纹理 base64 → `types.BedrockModel`；
4. **纯 Node 即可解码，不依赖浏览器**（已实测 `upstream/` 下 10 个 .ysm 全部解出骨骼/动画/纹理/头像）。`go/avatar/avatar.go` `DecodeYSMFiles` 同机制复用（头像提取）。

## 核心职责

- WASM 加载与初始化（base64 取二进制 + 间接 eval 执行胶水代码 + 工厂实例化，并发调用去重）
- 内存直解 .ysm（优先路径，无文件 I/O）与 callMain + MEMFS 解码（回退路径）
- WASM 虚拟文件系统管理（/input /output 目录清理与产物收集）

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

- 唯一消费方：`app-preview/preview-wasm.ts`（预览面板 WASM 解码分支，decodeYsmViaWasm）
- 解码产物（模型 JSON/纹理/动画）流向 preview-cache 与 [animation_system](./animation-system.md) 的 parseBedrockAnimationJSON
- 兜底链路：前端 WASM 不可用时回退 Go 端解析（`app_model.go` `AnalyzeBedrockModel`，其内部再走 Node.js + WASM / exe，见上节）

## 不变量

- **两个 *-data.js 是自动生成的 base64 数据文件（豁免文件），禁止手改**；更新需走生成脚本重新产出
- **两份 WASM 资产导出面不同**：6-08 前端版有 `_malloc`/`ccall`/`ysm_decode_from_memory`；6-17 Go 版（`frontend/public/wasm/`）只有 `callMain`。Node.js 子进程路径若改用 6-08 资产可走内存直解，但生产 `wasm_decoder.go` 固定走 `callMain` + MEMFS，不依赖 `_malloc`——**「Node 下 `_malloc` 不可用」≠「Node 下无法解码」**
- **已知问题已修复（审计核实 2026-08-08）**：此前知识卡/注释声称 `ysm-glue-data.js` 的 `_getGlueCode` 引用未声明 `_cachedWasm`（ReferenceError）且返回 ArrayBuffer——**现状数据文件用 `_cachedGlue` 且返回 TextDecoder string**，bug 已不存在，「WASM 路径必静默回退 Go」假设已失效；内存直解路径（`decodeYsmFileFromMemory`）实际可用，需在真实 WebView2 环境做一次端到端回归确认后按正式路径维护
- `_malloc` 的指针必须在 finally 中 `_free`；HEAPU8 每次从 `window.Module` 取最新值（内存扩容后旧视图失效）
- WASM 加载状态是模块级单例（wasmModule/loading/waiters），不得挂额外 window 全局
- **WASM 生命周期管理**（审计发现）：`decodeYsmFile` 回退路径中，MEMFS 输出文件读取后必须 `FS.unlink` 清理（`wipeDir`，已落地）；`decodeYsmFileFromMemory` 内存直解路径的 /output 在下一次调用前清理（P3 观察：成功后未立即 wipe，产物常驻至下次解码）。WASM 为 **app 级常驻单例**（initYSMParser 懒加载后生命周期等同应用，与 ADR-039 §2.2 常驻单例豁免同类），**无销毁场景**——曾提供 `destroyYSMParser()` 但 `_free(0)` 无法真正释放 HEAP，且销毁后重新 init 有加载成本，已移除（2026-08-06，knip 死代码基线）。若未来出现真实长运行内存压力场景，应实现真正的 Emscripten 实例销毁（`Module.destroy`/instance 释放）而非 `_free(0)`。

## 相关

- [go_ysm_parser](./go-ysm-parser.md) — Go 端兜底解析
- [app_preview](./app-preview.md) — 预览面板消费方
- [animation_system](./animation-system.md) — 解码出的动画 JSON 解析
