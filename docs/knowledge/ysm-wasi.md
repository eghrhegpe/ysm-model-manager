---
kind: ysm-wasi
name: WASI 解码器 spike（wazero 内存直解，node 桥退役候选）
tier: architecture
category: go
status: active
source_files:
  - go/ysmwasi/ysmwasi.go
  - go/wasispike/main.go
  - upstream/YesSteveModel-Parser/build-wasi.ps1
  - upstream/YesSteveModel-Parser/ysm-wasm-bridge.cpp
  - upstream/YesSteveModel-Parser/YSMParser/parsers/v3/YSMParserV3.cpp
auto_fields:
  symbols_with_lines:
    - Close
    - Decode
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
  - go/ysmwasi/ysmwasi.go|Decode
  - go/ysmwasi/ysmwasi_test.go|TestImportsClosedSet
  - go/wasispike/main.go|run
  - upstream/YesSteveModel-Parser/ysm-wasm-bridge.cpp|ysm_decode_to_memory
  - upstream/YesSteveModel-Parser/YSMParser/parsers/v3/YSMParserV3.cpp|collectToMemory
---

# WASI 解码器（wazero 内存直解，node 桥已退役）

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

## 生产化落地（2026-09-27，ADR-316 已采纳）

1. **生产路径已切换**：新包 `go/ysmwasi`（内嵌 `YSMParser-mem-noeh.wasm` 903KB + wazero 宿主，runtime/编译单例 + 每次解码新 module 独占堆）；`internal/app/wasm_decoder.go` 的 `runYSMDecode`/`decodeYSMViaWASI`/`decodeYSMComponentsViaWASI` 走 wazero；`avatar` 头像提取改消费 `ysm.DecodeYSM` 注入点。
2. **Node 桥已退役**：`go/avatar/avatar_decode.go`（DecodeYSMData/SetNodeJS）、`findNodeJS`、`internal/app/wasm_embed.go` 与根 `embed.go` 的 YSMParser.js/wasm 内嵌注入链全部删除——分发不再拖 Node，Android 首次获得加密模型解码能力。前端预览仍用 frontend 侧 WASM（不受影响）。
3. **护栏对齐旧口径**：输入 200MB 上限、产物总量 200MB 上限、60s 超时（wazero Call 接 context）；产物缓冲格式 `[u32 count][u32 nameLen][u32 dataLen][name][data]*`，`ysm_decode_to_memory(data,size,out_ptr)` 第三参是输出槽（指针的指针）。
4. **错误语义（现状）**：noeh 构建畸形输入 → parser abort → wazero error（可恢复），无 C++ 异常文本；诊断经 `log.Printf("[ysm-wasi]")`，环形日志面板接线待做。wazero EH 成熟后再补错误码体系。
5. **契约测试**：`go/ysmwasi/ysmwasi_test.go` 锁导入闭集（手解 wasm import section：env 4 + wasi 10，上游重编 wasm 引入新导入即红）+ 护栏 + 畸形输入并发；真实样本冒烟 `YSMWASI_TEST_FIXTURE=<.ysm> go test ./go/ysmwasi/ -run TestDecode_RealFixture`（V3 75 产物 1.4s / V2 产物均解出）。
6. `collectToMemory` 是 vendored 副本改动，上游 Parser 版本更新时需重放（或推上游）。

## 2026-09-27 后续三件（已闭环两件半）

1. **环形日志接线（已闭环，靠机制白嫖）**：ADR-289 的 `app.go` `log.SetOutput(MultiWriter(stderr, RuntimeBuffer))` 自动捕获标准库 log——`[ysm-wasi]` 前缀恰在 tag 提取允许集（连字符合规）、「失败」命中 error 级词表，**零新增代码即接通**；回归锁 `TestRunYSMDecode_RingLogWired` 防改回 fmt.Fprintln(stderr) 旁路（avatar 旧桥写法）。
2. **interpreter 基准（已量化，结论严峻）**：同一 V3 样本（1.7MB 输入 75 产物，i7-13700HX）compiler **0.76s** vs interpreter **35.6s = 47×**。Android 无 wazero optimizing compiler（长期不支持），手机 silicon 只会更慢且撞 60s 超时护栏——**ADR-316 D5「Android 首次获得加密解码」技术上成立、体验上不可用**，上线前须产品决策：①Android 回退 metadata-only（放弃加密解码）；②接受慢速单模型解码（需调大超时 + 进度提示）；③等 wazero compiler 支持 android。基准复跑：`YSMWASI_TEST_FIXTURE=<.ysm> go test ./go/ysmwasi/ -bench .`（`ysmwasi_bench_test.go` 双模式）。
3. **推上游（准备包已备）**：`docs/upstream-pr/ysmparser-collecttomemory-pr.md`——collectToMemory 纯增量提案 + V1/V2/V3 实现 + 桥接导出全文 + 提交前待办；结论「越早越好但非依赖项」（vendored 重放仍是主防线）。

## 2026-09-27 Android 决策补充实证：WebView V8 路径是快的（产品决策第④项浮出）

同一样本（双月希瞳 v2.2.ysm，1.7MB V3，i7-13700HX，2026-09-27 实测）三路对照：

| 路径 | 耗时 | 产物 |
|------|------|------|
| wazero compiler（桌面） | 0.76s（bench）/ 1.21s（含冒烟日志） | 53 文件 7515549 bytes |
| wazero interpreter（Android 现状） | **32.8s**（-benchtime 1x 复测，与 35.6s 同量级） | 同上 |
| **Node/WebView V8 JIT**（frontend/public/wasm 同源资产） | **1.1s**（decode 本体；init 8ms） | **逐字节同量 53 文件 7515549 bytes** |

结论：Android WebView 的 V8（Liftoff/TurboFan）解码同一加密模型是**秒级**且产物与 wazero 路径语义一致——「Android 无编译器」是 wazero 的局限，不是 wasm 解码本身的宿命。产品决策因此多出第④项：**Android 走 WebView 桥委托解码**（Go 经 WebView 执行 frontend 同源 YSMParser wasm 拿回产物）。代价：形式上复活一条桥（与 ADR-316 退役桥精神有张力），但零额外分发（WebView 系统自带）；Node 开发机基准脚本可复刻（退役桥 `git show 711e1ae3e^:go/avatar/avatar_decode.go` 的 decode.cjs 逻辑）。⚠️ 知识卡旧记「75 产物」与实测 53 有出入（复测两条路径均 53，以实测为准）。
注：Node V8 数据是 WebView 的**上限估计**——真机 WebView 环境并发渲染会分走资源，on-device 终测仍需另行安排。

## 2026-09-27 P0 spike 通过：Wails 事件通道大 payload 往返实测（桌面 WebView2，ADR-317 数据）

环境：`task dev`（wails3 beta.26）+ `Windows.WindowsOptions.AdditionalBrowserArgs=--remote-debugging-port=9222` 开 CDP，Node 直连 WebSocket 注入 `window._wails.dispatchWailsEvent` 包装器/动态 import `/src/backend/runtime.ts`。spike 代码已还原不落仓（测量方法记录于此，可随时重演）。

**Go→前端 Emit 方向**（payload 字符串带 UnixNano 前缀测单程延迟，1/4/8/16/32MB × 2 轮，全部完整无截断）：

| size | 空闲轮 | 忙碌轮 |
|------|--------|--------|
| 1MB | 17ms | 17ms |
| 4MB | 64ms | 304ms |
| 8MB | 155ms | 525ms |
| 16MB | 257ms | 1272ms |
| 32MB | 485ms | 2613ms |

**前端→Go 绑定方向**（生成绑定 `DetectContainerType` 传大 base64 串，含 JSON 序列化）≈ **160ms/MB**：1MB=176ms / 4MB=689ms / 8MB=1292ms / 16MB=2540ms / 32MB=5240ms。

**预算推演**：真实 V3 样本往返 ≈ 输入 1.7MB→base64 2.3MB（Emit ~50ms）+ 产物 7.5MB→base64 10MB（绑定 ~1.6s）+ V8 解码 1.1s ≈ **3s 端到端**，vs wazero interpreter 33s——**ADR-317 P0 green-light**，桥接方案通道容量与延迟均可行。遗留：binding 方向 160ms/MB 偏贵（JSON 双转换），P1 实现时产物回传可考虑分块或 WASM 侧压（如产物 gzip 后再 base64）。

**测量方法备忘**（复演用）：①Go 侧临时 spike 块放 `ServiceStartup` 的 config-loaded emit 之后（env 门控 + goroutine 延迟发射）；②CDP 开端口须走 `main.go` 的 `application.Options{Windows: {AdditionalBrowserArgs: []string{"--remote-debugging-port=..."}}}`——`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量会被 go-webview2 loader 主动覆盖（env_create.go:169 清空）；③前端事件必经 `window._wails.dispatchWailsEvent`，包装它比 Events.On 订阅可靠（动态 import runtime.ts 会产生模块分身，订阅可能收不到）；④前端→Go 直接动态 import `/bindings/ysm-model-manager/internal/app/app.ts` 调生成函数（vite dev 服务全项目文件）。

**Android 侧 Go→前端 Emit 链路源码确认（2026-09-27，wails beta.26）**：`EventProcessor.Emit` → `frontendEvents` mailbox → `dispatchEventToWindows` → `androidWebviewWindow.execJS`（webview_window_android.go:30）→ JNI `executeJavaScriptOnBridge`（application_android.go:282，`NewStringUTF` 同进程 JNI 传串，**不经过 binder，无 1MB binder 限制**）→ Java `WailsBridge.executeJavaScript` → WebView 内 `window._wails.dispatchWailsEvent`。链路存在且与桌面同构；仓内 Go 侧 Emit 仅 3 处（config-loaded/download:progress/update:progress），Android 查看器模式均不消费——**即 Android 上 Go Emit 大 payload 无生产先例，P2 真机必测**（风险点：evaluateJavascript 携带 MB 级 JS 串的耗时/内存，备选分块）。

## 2026-09-27 ADR-317 P1 落地：桥骨架 + 桌面 E2E 全链路打通

**实现（已提交）**：
- `go/ysmwebview/`：桥请求管理器（纯 Go 零 Wails 依赖，emit 注入；id/channel/超时/就绪态；`-race` 单测 7 例全绿）。协议镜像：Go→前端 Emit `ysm-decode-request` `(id, base64(.ysm))`；前端→Go 绑定 `ResolveYsmDecode(id, gzip(JSON{files[data=base64]})→base64, errMsg)`。
- `internal/app/ysm_webview_bridge.go`：桥单例 + App 绑定方法（`MarkYsmDecodeBridgeReady`/`ResolveYsmDecode`）；`SetApp` 接 emit。
- `internal/app/wasm_decoder.go`：`decodeYSMBest` 后端选择器统一 `ysm.SetDecoder` 与 `runYSMDecode`——桥就绪且 ≤32MB 走桥，否则/失败回退 wazero（桌面主路径/CLI 天然走兜底，零行为漂移）。
- `frontend/src/backend/ysm-decode-bridge.ts`：backend 层 listener，复用 `decodeYsmFileFromMemory`（预览同源 wasm 管线），`CompressionStream` gzip 回传；非 Android no-op（桌面联调逃生阀：`localStorage["ysm-force-decode-bridge"]=1`）；串行队列防 wasm MEMFS 并发。装配点 `app-modules.ts`（error-diary 之后）。
- `main.go`：`YSM_CDP_PORT` 环境变量门控的 WebView2 CDP 开关（`WindowsOptions.AdditionalBrowserArgs`），联调用。
- vitest：payload 组装与 Go 解析镜像测试（gzip 往返 + base64 结构断言）。

**桌面 E2E 实测（dev + CDP）**：`AnalyzeBedrockModel(真实 V3 .ysm)` → Go 走桥（`ysm-decode-request` 拦截确认）→ 前端解码 → gzip 回传 → Go 得 BedrockModel（bones=350），全程 **2062ms**（含 wasm 冷启动 init）。

**E2E 联调排障教训**：①`A=v cmd1 && cmd2` 复合命令的环境变量只作用于 cmd1（本次 dev 启动没拿到 YSM_CDP_PORT 的根因）；②CDP 端口 9222 被僵尸 msedgewebview2 占用 → app 静默 exit(1)（换 9223 立愈；占位现象与"启动即死"难关联，对照实验排查耗时最久）；③"新代码崩溃"勿轻信——先跑旧代码对照实验再定位。

**P2 待办（on-device）**：真机跑 Android 桥解码（V3 样本 + 后台冻结 + 内存峰值）；预期端口/桥参数沿用本卡方法。

## 相关

- [ysm-wasm](./ysm-wasm.md) — 现 Node.js + WASM 桥（生产主路径，本卡验证的退役对象）
- [go_ysm_parser](./go-ysm-parser.md) — Go 端元数据兜底
