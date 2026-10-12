---
kind: go-avatar-decode
name: Go 头像提取：扩展名分界与纯函数链
tier: leaf
category: go
source_files:
  - go/avatar/avatar_extract_ysm.go
  - go/avatar/avatar_extract.go
  - go/avatar/avatar.go
auto_fields:
  symbols_with_lines:
    - CacheAvatarsFromModel
    - CacheDir
    - ExtractAvatarURI
    - PurgeAvatarCache
    - ReadCachedAvatar
    - SafeName
    - SaveAvatarData
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 头像提取、ysm.DecodeYSM、ExtractAvatarURI
  - 纯函数 vs Node+WASM 解码分界
quick_risk_lines:
  - 头像提取路径必须按扩展名分发（.ysm → WASM 解码 / .zip/.7z → 归档解压 / .json → 直读），禁止跨扩展名混用
  - ADR-316 后 Node+WASM 解码桥已退役：.ysm 解码走 ysm.DecodeYSM 注入点（wazero），禁止新建 Node 子进程桥
  - 本卡 §退役快照 是历史档案，勿按旧文排查现役问题（现役口径见 go-avatar / ysm-wasi）
pitfalls:
  - 跨扩展名混用提取逻辑 → 解析失败、抛异常；必须按扩展名分发
  - 测试喂的必须是现役 `ysm.DecodedFile` 切片——退役 Node 桥的本地 `ysmDecodedFile` 已随桥删除，照旧文建 fixture 会编译不过
  - 按「Node 桥 / 三件套注入」排查现役 .ysm 解码问题必然查不到代码（`DecodeYSMData`/`SetNodeJS` 已随 ADR-316 退役，Go 侧生产代码零命中）
use_when:
  - 改头像提取 / ExtractAvatarURI 逻辑或补 avatar 测试时
  - 排查 .ysm 头像提取失败或全缓存短路异常时
perf:
  - io-bound
  - single-thread

status: active
last_verified: 2026-10-12
---

# Go 头像提取：扩展名分界与纯函数链

## 概览

`go/avatar` 提取作者头像 = **扩展名分界 + 纯函数链**：`.zip|.7z` 归档解压 / `.json` 直读 / `.ysm` 经解码器拿到文件清单后交纯函数匹配作者头像。作者匹配、fallback、路径安全全是**零 IO 零 WASM 纯函数**——测试直接喂结构体切片，零 fixture 文件。

> ⚠️ **.ysm 解码桥已退役（ADR-316，2026-09-27）**：本卡原名「纯函数 vs Node+WASM 解码分界」——那条 Node+WASM 桥（`DecodeYSMData` / `SetNodeJS` / `avatar_decode.go`）已整体删除，Go 侧生产代码零命中。现役口径：`.ysm` 解码走 [`ysm.DecodeYSM`](./go-ysm-parser.md) 注入点（`go/ysm/decode_inject.go`，由 `internal/app/wasm_decoder.go` init 注入：ADR-317 WebView 桥优先 + ADR-316 wazero 内存直解兜底），构建 recipe 与陷阱清单见 [ysm-wasi](./ysm-wasi.md)，包级现状见 [go-avatar](./go-avatar.md)。**§退役快照 是历史档案，勿按旧文排查现役问题。**

## 核心职责

- `ExtractAvatarURI(modelPath, safeName)`：按扩展名分发——`.ysm`→`extractAvatarFromYSM`、`.zip|.7z`→`extractAvatarFromArchive`、`.json`→`extractAvatarFromJSON`、未知扩展名返回 `""`。纯分发器，无匹配分支返回 `""`。
- 纯函数链：`parseYSMJSONAuthors`（解码产物中挑出作者清单 JSON）→ `matchAvatarByAuthor`（作者名匹配头像候选）→ `extractFallbackAvatarFromDir`（无匹配时回退目录内头像）；`avatarCandidates(ref)` 与 `isSafeAvatarPath(ap)` 负责候选枚举与路径逃逸校验。只吃 `[]ysm.DecodedFile` 切片，零 IO 零 WASM。
- **全缓存短路**：`.ysm` 是加密容器，作者名单只能经解码拿到——无法在解码前判断「是否已全缓存」，`cacheYSMavatars` 用**模型级 size+mtime 签名标记**（`<cacheDir>/<SafeName(base)>.done`）短路：单遍处理完落标记，二次调用签名命中直接返回、不再触发解码；模型文件变更签名变 → 重解重写。标记与作者 png 同目录、`.done` 后缀，`PurgeAvatarCache` 一并清空。注意 `withTempCache` 每次 `CacheDir()` 新建 tempdir、跨调用目录不一致，测短路须固定缓存目录。

## 对外 API / 入口

| 符号 | 性质 | 说明 |
|------|------|------|
| `ExtractAvatarURI` | 编排 | 扩展名分发，无匹配分支返回 `""` |
| `extractAvatarFromYSM` / `extractAvatarFromArchive` / `extractAvatarFromJSON` | 分支 | 三类容器各一实现，禁止跨扩展名混用 |
| `parseYSMJSONAuthors` / `matchAvatarByAuthor` / `extractFallbackAvatarFromDir` | **纯函数** | 只吃 `[]ysm.DecodedFile`，零 IO 零 WASM |
| `avatarCandidates` / `isSafeAvatarPath` | 校验 | 候选枚举 + `..` 逃逸拒绝 |
| `cacheYSMavatars` | 缓存 | 模型级 size+mtime 签名短路，`.done` 标记 |

## 与其他子系统关系

- 纯函数链**不碰解码器**——测试直接喂 `[]ysm.DecodedFile` 切片即可，零 fixture 文件；`avatar_extract_test.go` 表驱动覆盖 candidates/parse/match/fallback/路由 5 分支。
- `.ysm` 解码由 `internal/app/wasm_decoder.go` 的 `decodeYSMBest` 后端选择器（ADR-317 WebView 桥优先 + ADR-316 wazero 兜底）经 `ysm.SetDecoder` 注入，avatar 只消费注入点结果；**禁止在 avatar 包复刻解码桥**（ADR-164/316 单例化的理由就是消灭双胞胎）。
- 头像提取产物与缓存生命周期归 `texture_cache` 包的 `PurgeAvatarCache`，`.done` 签名标记随之一并清空。

## 不变量

- 扩展名分发对未知扩展名/空路径返回 `""`。
- 路径安全：avatar 候选强校验（`isSafeAvatarPath` 拒绝 `..` 逃逸），Rel 复查后仍须在模型目录内。
- 解码桥单点：`.ysm` 解码统一走 `ysm.DecodeYSM` 注入点，禁止跨包本地复制。
- 全缓存短路标记是**模型级**（按 size+mtime 签名），不是作者级——单作者提取成功后不得落标记。

## §退役快照（ADR-316 前，勿按此排查）

以下内容描述 2026-09-27 前的 Node+WASM 子进程桥，代码已整体删除，仅作 ADR-164 单例化决策的历史证据保留：

- `DecodeYSMData(ysmData []byte) []ysmDecodedFile`：三件套 `nodeJSPath / getGlueCode / getWasmBinary` **任一为空即返回 nil**（测试环境三件套为空 → 静默降级空列表，不 panic）；齐备时写 patched glue JS（`YSMParser_patched.js`，补 `updateMemoryViews` 后 `HEAPU8` 透传）+ base64 传参 + Node 脚本 `require("YSMParser")`（`wasmBinary + noInitialRun`）子进程解码 .ysm。返回本地 `ysmDecodedFile{Path string; Data []byte}`（Path 已剥 `/output/` 前缀，Data 为原始字节——2026-09 base64 直通重构后零中间膨胀）。200MB 输入护栏 + 60s 超时 + 200MB 输出护栏。
- `SetNodeJS`：启动期注入三件套（nodePath / glueFn / wasmFn），运行时只读；重置场景经 mutex 串行化。
- 端到端测试走**假胶水模块**（`avatar_node_test.go`：替换 `require("YSMParser")` 为可控 fake，覆盖 Pipeline / CallMainThrow / NoMarker / BadJSON / ExitError / StderrTooLarge 6 分支，无需真实 WASM 环境）。
- 更早退役：`DecodeYSMFiles`（`[]int` 签名，ADR-164 后彻底删除，非薄封装保留），生产代码 grep 零命中。
- 退役路径清单：`go/avatar/avatar_decode.go`、`findNodeJS`、`internal/app/wasm_embed.go` 与根 `embed.go` 的 YSMParser.js/wasm 内嵌注入链（详见 [ysm-wasi](./ysm-wasi.md)）。

## 相关

- `avatar_extract_ysm.go`（.ysm 分支 + 纯函数链主体）、`avatar_extract.go`（扩展名分发）、`avatar.go`（候选枚举 + 路径安全）
- `internal/app/wasm_decoder.go`（`decodeYSMBest` 后端选择器 + `ysm.SetDecoder` 注入，禁止复刻）
- ADR-164（wasm_decoder/avatar_decode 双胞胎收敛）、ADR-316（Node 桥退役）、ADR-317（WebView 桥优先）、ADR-040（avatar.go 行数治理拆分）
- [go-avatar](./go-avatar.md)、[go-ysm-parser](./go-ysm-parser.md)、[ysm-wasi](./ysm-wasi.md)
