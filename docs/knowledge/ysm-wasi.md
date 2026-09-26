---
kind: ysm-wasi
name: WASI 解码器 spike（wazero 内存直解，node 桥退役候选）
tier: architecture
category: go
status: draft
source_files:
  - go/wasispike/main.go
  - upstream/YesSteveModel-Parser/build-wasi.ps1
  - upstream/YesSteveModel-Parser/ysm-wasm-bridge.cpp
  - upstream/YesSteveModel-Parser/YSMParser/parsers/v3/YSMParserV3.cpp
use_when:
  - WASI / wazero / 内存直解
  - node 子进程退役
  - .ysm 加密解码依赖
pitfalls:
  - emscripten -sSTANDALONE_WASM 默认 -sFILESYSTEM=0 且无 path_open 导入——saveToDirectory/fopen 必然 abort，产物必须内存直出
  - standalone 默认 --no-growable-memory --initial-heap=16MB——大模型 OOM→bad_alloc→std::terminate（unreachable）；必须 -sALLOW_MEMORY_GROWTH=1
  - emscripten -fexceptions 走 JS 垫片（env.invoke_* + __cxa_throw），wazero 原理上无法复刻（宿主不能撕 wasm 调用栈）；必须 -fwasm-exceptions（native EH）或 -fignore-exceptions
  - wazero v1.12 的 native EH 仅支持 exnref 且验证器对复杂 exnref 模块 panic（markLocalInit nil map）——生产化前需 wazero 升级或走 -fignore-exceptions
  - wazero 实例化会自动跑 _start（WASI command 约定），CLI11 空参 throw=trap；必须 WithStartFunctions() 清空 + 手动调 __wasm_call_ctors
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - WASI 解码、wazero、node 退役
quick_risk_lines:
  - 解析器改动（collectToMemory）在本仓 vendored 副本内，上游同步时需重放
invariant_anchors:
  - go/wasispike/main.go|run
  - upstream/YesSteveModel-Parser/ysm-wasm-bridge.cpp|ysm_decode_to_memory
  - upstream/YesSteveModel-Parser/YSMParser/parsers/v3/YSMParserV3.cpp|collectToMemory
---

# WASI 解码器 spike（wazero 内存直解）

## 概览

2026-09-27 最小验证完成：**把 YSMParser 重编成 emscripten standalone（非真 WASI 目标）+ wazero 纯 Go 运行时内存直解，node 子进程桥可整条退役**。12 个真实 .ysm（11×V3 + 1×V2）在 wazero 内全部解出，产物与 Node 桥同构（ysm.json/models/animations/textures/avatar）。

## 验证结论（三条硬事实）

1. **零 JS 依赖成立**：`-sSTANDALONE_WASM -fwasm-exceptions -fignore-exceptions` 构建的 imports 仅 10 个 wasi_snapshot_preview1 + 4 个 env（`__syscall_getdents64`/`__syscall_getcwd`/`__syscall_readlinkat`/`emscripten_notify_memory_growth`），wazero + 4 个 Go 垫片即可宿主，905KB wasm。
2. **内存直出是必选项不是优化项**：emscripten standalone 下 std::filesystem/fopen 没有任何文件 syscall 支撑（微型 fopen 用例实证无 path_open），`saveToDirectory` 必然 abort。已在 vendored Parser 加 `collectToMemory()` 虚函数（saveToDirectory 的无文件系统孪生，V1/V2 出 `m_resources`，V3 复刻路径整形逻辑）+ 桥接导出 `ysm_decode_to_memory(data,size,out_ptr)`，产物序列化 `[u32 count][u32 nameLen][u32 dataLen][name][data]*` 单块缓冲，宿主 `free` 归还。
3. **-fignore-exceptions 在 wazero 可用**：happy path 零 throw（此前 trap 是 OOM 假象），错误路径会变 abort 而非 catch 返回 0——生产化要么等 wazero EH 成熟（v1.12 exnref 验证器 panic，实测），要么接受畸形文件 abort（wazero 有恢复手段）。

## 构建 recipe（复现命令）

```bash
cd upstream/YesSteveModel-Parser
# 需要 emsdk（C:\Users\zhujieling11\emsdk），静态库用 build-wasm/ 下现成产物
em++ -sSTANDALONE_WASM -sSTACK_SIZE=4194304 -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_FUNCTIONS=_ysm_decode_from_memory,_ysm_decode_to_memory,_ysm_detect_version,_malloc,_free,___wasm_call_ctors \
  -sWASM_BIGINT -std=c++20 -fignore-exceptions -O3 -DNDEBUG \
  -o build-wasi/YSMParser-mem-noeh.wasm <源文件7个> <include 路径含 -Iexternal/json -Iexternal/cityhash/src> <build-wasm/*.a>
# 运行验证：go run ./go/wasispike <wasm> <.ysm>
```

关键开关：`-sSTACK_SIZE=4194304`（默认 64KB）+ `-sALLOW_MEMORY_GROWTH=1`（默认 16MB 封顶）——二者缺一即 trap。`___wasm_call_ctors` 三个下划线（emscripten 剥一层前缀）。

## wazero 侧宿主要点（go/wasispike/main.go）

- `WithStartFunctions()` 清空自动启动（否则实例化即跑 `_start`→CLI11 throw=trap），手动调 `__wasm_call_ctors`。
- 4 个 env 垫片：getdents64 返回 0、getcwd 写 "/output"、readlinkat 返回 -22、notify_memory_growth 空实现（签名 `func(ctx, mod, size uint32)`）。
- 内存直出后**连 preopen 文件系统都不需要**——比现 Node 桥（临时目录 + stdout JSON 搬运）干净一个量级。

## 生产化差距（下一步）

1. wazero EH：升级/等待 exnref 支持成熟，或接受 noeh + abort 语义（需环形日志面板捕获 abort 诊断）。
2. `collectToMemory` 是 vendored 副本改动，上游 Parser 版本更新时需重放（或推上游）。
3. 替换 `internal/app/wasm_decoder.go` 的 `decodeYSMViaNodeJS` + Android 分支（`findNodeJS` 恒空）可一并退役——Android 首次获得加密模型解码能力。
4. 内存上限护栏（Go 侧 maxOutput 语义改为 maxHeap/产物总量上限）需重设计。

## 相关

- [ysm-wasm](./ysm-wasm.md) — 现 Node.js + WASM 桥（生产主路径，本卡验证的退役对象）
- [go_ysm_parser](./go-ysm-parser.md) — Go 端元数据兜底
