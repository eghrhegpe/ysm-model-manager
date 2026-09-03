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
  - 头像提取、DecodeYSMFiles、ExtractAvatarURI
  - 纯函数 vs Node+WASM 解码分界
quick_risk_lines:
  - 头像提取路径必须按扩展名分发（.ysm → WASM 解码 / .zip/.7z → 归档解压 / .json → 直读），禁止跨扩展名混用
pitfalls:
  - 跨扩展名混用提取逻辑 → 解析失败、抛异常；必须按扩展名分发
  - 测试环境三件套（nodeJSPath / glueCode / wasmBinary）为空 → 静默降级空列表；必须在测试里 mock 三件套

use_when:
  - 改头像提取 / DecodeYSMFiles / ExtractAvatarURI 逻辑或补 avatar 测试时
perf:
  - io-bound
  - single-thread

status: active
---

# Go 头像提取：纯函数 vs Node+WASM 解码分界

## 概览

`go/avatar` 提取作者头像有**两条路**：纯 Go 函数链（零 IO、零 WASM）与 `DecodeYSMFiles`（Node.js + WASM glue 子进程解码 .ysm）。**包头「不依赖 Wails runtime」≠ 无外部运行时依赖**——它只排除 Wails runtime，Node 子进程不受约束。曾因此误判为「纯 Go 解 zip」，实为 `exec.CommandContext` 调 Node 跑 WASM glue（2026-08-27 人工修正）。

## 核心职责

- `DecodeYSMFiles(ysmData)`：三件套 `nodeJSPath / getGlueCode / getWasmBinary` **任一为空即返回 nil**（测试环境三件套为空 → 静默降级空列表，不 panic）；齐备时写 patched glue JS（`YSMParser_patched.js`，补 `updateMemoryViews` 后 `HEAPU8` 透传）+ base64 传参 + Node 脚本 `require("YSMParser")`（`wasmBinary + noInitialRun`）子进程解码 .ysm 为文件列表（path + data[]）。
- `ExtractAvatarURI(modelPath, safeName)`：按扩展名分发——`.ysm`→`extractAvatarFromYSM`、`.zip|.7z`→`extractAvatarFromArchive`、`.json`→`extractAvatarFromJSON`、未知扩展名返回 `""`。

## 对外 API / 入口

| 符号 | 性质 | 说明 |
|------|------|------|
| `DecodeYSMFiles` | WASM 依赖 | 端到端依赖 Node + glue + wasm，单测环境返回 nil |
| `parseYSMJSONAuthors` / `matchAvatarByAuthor` / `extractFallbackAvatarFromDir` / `avatarCandidates` | **纯函数** | 只吃 `[]ysmFile` 结构体，零 IO 零 WASM |
| `ExtractAvatarURI` | 编排 | 纯分发器，无匹配分支返回 `""` |

## 与其他子系统关系

- 纯函数链**不碰 `DecodeYSMFiles`**——测试直接喂 `ysmFile` 切片即可，零 fixture 文件。
- 测试策略（8d82e91c 已落地）：`avatar_extract_test.go` 表驱动覆盖 candidates/parse/match/fallback/路由 5 分支；**.ysm 端到端留集成测试**（WASM 环境脆，如实不测）。
- `avatar_test.go` 已有 `zip.NewWriter` fixture 套路（5 处），archive 分支复用即可。

## 不变量

- 三件套任一为空时 `DecodeYSMFiles` 必须返回 nil（不 panic、不建子进程）。
- 扩展名分发对未知扩展名/空路径返回 `""`。
- 路径安全：avatar 候选强校验（`isSafeAvatarPath` 拒绝 `..` 逃逸），Rel 复查后仍须在模型目录内。

## 相关

- `avatar_extract.go`（编排 + 纯函数）、`avatar_decode.go`（WASM 解码）、`avatar_test.go`（zip fixture）
- ADR-040（avatar.go 文件行数治理拆分）
