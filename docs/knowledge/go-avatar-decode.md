---
kind: go-avatar-decode
name: Go 头像提取：纯函数 vs Node+WASM 解码分界
tier: leaf
category: go
source_files:
  - go/avatar/avatar_decode.go
auto_fields:
  symbols_with_lines:
    - DecodeYSMData
    - FS
    - SetNodeJS
    - Write
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 头像提取、DecodeYSMData、ExtractAvatarURI
  - 纯函数 vs Node+WASM 解码分界
quick_risk_lines:
  - 头像提取路径必须按扩展名分发（.ysm → WASM 解码 / .zip/.7z → 归档解压 / .json → 直读），禁止跨扩展名混用
  - ADR-164 后 DecodeYSMData 是全仓唯一 Node+WASM 解码桥（internal/app wasm_decoder.go 已变薄封装），禁止新建第二份副本
pitfalls:
  - 跨扩展名混用提取逻辑 → 解析失败、抛异常；必须按扩展名分发
  - 测试环境三件套（nodeJSPath / glueCode / wasmBinary）为空 → 静默降级空列表；必须在测试里 mock 三件套
  - DecodeYSMFiles 已退役（ADR-164 后彻底删除，非薄封装）——新代码必须用 DecodeYSMData，grep 旧名仅命中历史 ADR/注释

use_when:
  - 改头像提取 / DecodeYSMData / ExtractAvatarURI 逻辑或补 avatar 测试时
perf:
  - io-bound
  - single-thread

status: active
---

# Go 头像提取：纯函数 vs Node+WASM 解码分界

## 概览

`go/avatar` 提取作者头像有**两条路**：纯 Go 函数链（零 IO、零 WASM）与 `DecodeYSMData`（Node.js + WASM glue 子进程解码 .ysm）。**包头「不依赖 Wails runtime」≠ 无外部运行时依赖**——它只排除 Wails runtime，Node 子进程不受约束。曾因此误判为「纯 Go 解 zip」，实为 `exec.CommandContext` 调 Node 跑 WASM glue（2026-08-27 人工修正）。

**ADR-164（2026-09）落地后**：`DecodeYSMData` 是全仓唯一 Node+WASM 解码桥（`internal/app/wasm_decoder.go` 已删 166 行变薄封装，FILES_JSON 协议 / limitedBuffer / glue 补丁全仓单例化）；旧名 `DecodeYSMFiles`（`[]int` 签名）已**彻底退役**（非薄封装保留），生产代码 grep 零命中，仅历史 ADR 与测试注释残留。

## 核心职责

- `DecodeYSMData(ysmData []byte) []ysmDecodedFile`：三件套 `nodeJSPath / getGlueCode / getWasmBinary` **任一为空即返回 nil**（测试环境三件套为空 → 静默降级空列表，不 panic）；齐备时写 patched glue JS（`YSMParser_patched.js`，补 `updateMemoryViews` 后 `HEAPU8` 透传）+ base64 传参 + Node 脚本 `require("YSMParser")`（`wasmBinary + noInitialRun`）子进程解码 .ysm。返回 `ysmDecodedFile{Path string; Data []byte}`（Path 已剥 `/output/` 前缀，Data 为原始字节——2026-09 base64 直通重构后零中间膨胀）。200MB 输入护栏 + 60s 超时 + 200MB 输出护栏。
- `ExtractAvatarURI(modelPath, safeName)`：按扩展名分发——`.ysm`→`extractAvatarFromYSM`、`.zip|.7z`→`extractAvatarFromArchive`、`.json`→`extractAvatarFromJSON`、未知扩展名返回 `""`。

## 对外 API / 入口

| 符号 | 性质 | 说明 |
|------|------|------|
| `DecodeYSMData` | WASM 依赖 | 全仓唯一 Node+WASM 解码桥；端到端依赖 Node + glue + wasm，单测环境返回 nil；`[]byte` 直通形态 |
| `SetNodeJS` | 注入 | 启动期注入三件套（nodePath / glueFn / wasmFn），运行时只读；重置场景经 mutex 串行化 |
| `parseYSMJSONAuthors` / `matchAvatarByAuthor` / `extractFallbackAvatarFromDir` / `avatarCandidates` | **纯函数** | 只吃 `[]ysmDecodedFile` 结构体，零 IO 零 WASM |
| `ExtractAvatarURI` | 编排 | 纯分发器，无匹配分支返回 `""` |

## 与其他子系统关系

- 纯函数链**不碰 `DecodeYSMData`**——测试直接喂 `ysmDecodedFile` 切片即可，零 fixture 文件。
- 测试策略：`avatar_extract_test.go` 表驱动覆盖 candidates/parse/match/fallback/路由 5 分支；**Node+WASM 端到端走假胶水模块**（`avatar_node_test.go`：替换 require("YSMParser") 为可控 fake，覆盖 Pipeline / CallMainThrow / NoMarker / BadJSON / ExitError / StderrTooLarge 6 分支，无需真实 WASM 环境）。
- `internal/app/wasm_decoder.go` 已变薄封装（调 `avatar.DecodeYSMData`），**禁止在 internal/app 复刻第二份**——ADR-164 全仓单例化的唯一理由就是消灭双胞胎。

## 不变量

- 三件套任一为空时 `DecodeYSMData` 必须返回 nil（不 panic、不建子进程）。
- 扩展名分发对未知扩展名/空路径返回 `""`。
- 路径安全：avatar 候选强校验（`isSafeAvatarPath` 拒绝 `..` 逃逸），Rel 复查后仍须在模型目录内。
- 全仓唯一解码桥：`DecodeYSMData` 是 Node+WASM 解码的**单点**，禁止跨包本地复制（注释互指「同款」是 ADR-164 前的反模式，已清除）。

## 相关

- `avatar_extract.go`（编排 + 纯函数）、`avatar_decode.go`（WASM 解码，ADR-164 统一实现）、`avatar_node_test.go`（假胶水端到端测试）
- `internal/app/wasm_decoder.go`（薄封装，调 `avatar.DecodeYSMData`，禁止复刻）
- ADR-164（wasm_decoder/avatar_decode 双胞胎收敛）、ADR-040（avatar.go 文件行数治理拆分）
