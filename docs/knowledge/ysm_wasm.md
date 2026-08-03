---
kind: ysm_wasm
name: WASM 解析器 ysm-parser
tier: architecture
category: utils
source_files:
  - frontend/js/wasm/ysm-parser.ts
  - frontend/js/wasm/ysm-glue-data.js
  - frontend/js/wasm/ysm-wasm-data.js
use_when:
  - WASM
  - YSMParser
  - ysm 解码
  - 加密模型
  - wasm 加载
  - Emscripten
  - MEMFS
---

# WASM 解析器 ysm-parser

## 概览

YSMParser WASM 的前端胶水层（算法口径与 YSMViewer 一致）：`ysm-parser.ts` 负责加载、初始化与解码调用；`ysm-wasm-data.js` / `ysm-glue-data.js` 是 base64 内嵌的 WASM 二进制与 Emscripten 胶水代码。采用 `Module.wasmBinary` 注入方式加载，规避 WebView2 的 fetch() 限制。Go 端兜底解析见 [go_ysm_parser](./go_ysm_parser.md)。

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
- 解码产物（模型 JSON/纹理/动画）流向 preview-cache 与 [animation_system](./animation_system.md) 的 parseBedrockAnimationJSON
- 兜底链路：WASM 不可用时回退 Go 端解析（[go_ysm_parser](./go_ysm_parser.md)）

## 不变量

- **两个 *-data.js 是自动生成的 base64 数据文件（豁免文件），禁止手改**；更新需走生成脚本重新产出
- 已知问题（源码注释明示）：`ysm-glue-data.js` 的 `_getGlueCode` 引用未声明的 `_cachedWasm`（ReferenceError）且返回 ArrayBuffer 而非 string —— WASM 路径实际会静默失败并回退 Go 解析；修复应改生成脚本，不得手改数据文件
- `_malloc` 的指针必须在 finally 中 `_free`；HEAPU8 每次从 `window.Module` 取最新值（内存扩容后旧视图失效）
- WASM 加载状态是模块级单例（wasmModule/loading/waiters），不得挂额外 window 全局

## 相关

- [go_ysm_parser](./go_ysm_parser.md) — Go 端兜底解析
- [app_preview](./app_preview.md) — 预览面板消费方
- [animation_system](./animation_system.md) — 解码出的动画 JSON 解析
