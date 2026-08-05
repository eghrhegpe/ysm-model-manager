# ADR-029：YSMParser 解码架构：WASM 内嵌取代 sidecar EXE

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/wasm/ysm-wasm-data.js`（base64 内嵌）、`frontend/src/wasm/ysm-glue-data.js`、`frontend/src/wasm/ysm-parser.js`、`app.go`（`runYSMParserOnFile` Go CLI fallback）、`go/ysm/`（Go 端几何解析）、`docs/architecture.md §4`
- **被收口来源**：`docs/archive/postmortem/postmortem-20250608.md`、`postmortem-20250608-wasm.md`、`postmortem-20250609.md`、`postmortem-20250610.md`、`postmortem-20250611.md`

---

## 1. 背景（Context）

`.ysm` 模型文件需在不依赖外部二进制的前提下，于 WebView2 内解码出骨骼（`models/main.json`）与纹理，供 2D 线框预览与 3D 渲染使用。早期方案为随包分发 **YSMParser.exe sidecar**（~1.2 MB），但存在外部依赖、跨平台困难、`wails3 build -clean` 后丢失需手动恢复等运维包袱。

同期调研发现 YSMParser 为 C++ 项目，可用 Emscripten 编译为 WASM 并经 base64 内嵌前端，消除 sidecar。但 WASM 集成横跨 Emscripten 编译链、WASM 运行时调试、JS/WebView2 兼容性，历史踩坑详见被收口来源（8 轮 Debug：从 `Unsupported file version` 到成功解码 187 骨 877 方的加密 .ysm）。

关键约束：
- YSM 文件格式非单一：
  - **LegacyYSM（旧版）**：`YSGP` 头 + AES 加密二进制（`YesModelUtils.java` 解密后再 JSON）。
  - **OYSM（新版）**：zip 内含无加密 `minecraft:geometry` JSON，直接 `zip.NewReader` 读取。
  - **YSGP V3 变体**：魔数 `YSM`（3 字节，非 V2 的 `YSGP` 4 字节），带 BOM + 文本头部与哈希，路径迥异。
- Wails `[]byte` Binding 返回的是 **base64 字符串**，非原始字节；WebView2 下 `new Uint8Array(string)` 二进制转换行为不确定。

## 2. 决策（Decision）

**采用「WASM 内嵌」作为 .ysm 解码主路径，取代 YSMParser.exe sidecar；保留 Go CLI（YSMParser.exe）作为最终回退；ZIP/7z 走原生 Go 解析。**

### 2.1 解码优先级链（单一事实来源：`ysm-parser.js` 的版本预检 + 分流）

```
detectYsmVersion(path)
  ├─ =3 (YSGP V3, 魔数 YSM) → decodeYsmFile(MEMFS + callMain)        ✅ / 失败 → Go CLI
  ├─ =2 (YSGP V2, 魔数 YSGP) → decodeYsmFileFromMemory(原始字节)
  │       └─ 失败 → stripYsgpTextHeader → rebuild V2 → decodeYsmFileFromMemory
  └─ =0 (普通 ZIP/7z 或 OYSM) → Go 端 parseBedrockFromZip
          └─ 失败 → fallback YSMParser (WASM 或 Go CLI)
```

- **内存解析优先**：WASM 必须走 `YSMParserFactory::Create(data, size)` 内存接口（`ysm_decode_from_memory`），绕过 MEMFS 文件 I/O（早期 `callMain` 因 base64 编码损坏被弃用，修复后 V3 场景重新启用）。
- **Go CLI 回退**：WASM 解码失败（含 WebView2 兼容异常）时，`app.go` 的 `runYSMParserOnFile` 调 YSMParser.exe（已加 `SysProcAttr{HideWindow: true}` 防黑框），保证「永不无预览」。

### 2.2 数据传递契约（每层必须验证类型）

跨语言链路：`Go ReadFileBytes() → base64 string → JS atob() → Uint8Array → WASM _malloc → HEAPU8.set → ccall(ysm_decode_from_memory) → C++ 解析 → MEMFS /output → JS 收集 → parseBedrockGeometryFromJSON`。

强制约定：
- `ReadFileBytes` 返回 base64 字符串，JS 侧一律 `atob()` 解码后再转 `Uint8Array.from(bin, c => c.charCodeAt(0))`（**禁止 `new Uint8Array(string)`**）。
- `_malloc` 之后必须重新获取 `HEAPU8`（WASM `ALLOW_MEMORY_GROWTH` 扩容会使旧 `HEAPU8` 指向分离的 ArrayBuffer）。

### 2.3 内嵌与发布

- WASM 二进制 base64 内嵌于 `ysm-wasm-data.js`（约 1.1 MB / 内嵌约 1.5 MB），经 `Module.wasmBinary` 注入规避 WebView2 `fetch()` 限制。
- `build-release.ps1` 保留 YSMParser.exe 检测与复制（供 Go CLI 回退路径）。
- 首次解码后缓存 `ArrayBuffer` 与胶水代码字符串，消除重复 base64 解码开销。

## 3. 后果（Consequences）

**正面**
- 消除外部 sidecar 依赖，安装包更干净，跨平台可行性提升。
- 解码在主进程内完成，无临时文件、无黑框弹窗，用户体验一致。
- 版本预检 + 分流使 V2/V3/zip 三类来源行为统一，渲染结果可预期。

**负面 / 已知遗留**
- 🔴 **`_getGlueCode` bug（已知，待修）**：内嵌胶水代码的字符串注入 patch（`Module["HEAPU8"]=HEAPU8` 注入、`updateMemoryViews()` 上下文精确匹配）当前未稳定生效，导致实际运行中 WASM 路径部分回退到 Go CLI 解析（性能与日志偏离纯 WASM 路径）。该 bug 直接关联本 ADR 的「内存解析优先」目标，需在后续修复并回归。
- 内嵌 WASM 使 JS 产物膨胀（约 200KB → 1.5MB），首次初始化有 base64 解码 + 编译延迟（已用缓存缓解，仍有首屏冷启动成本）。
- 文本头部变体（含 `<hash>` 标签、V2 含 16 字节二进制 hash 重复）的偏移处理极易出错，解析逻辑需持续守护。

**与其他 ADR 关系**
- 本 ADR 聚焦**解码架构**（WASM vs sidecar、格式分流、回退）；3D 骨骼坐标计算与去重以 **ADR-004（3D 渲染管线）** 的 `threejs.Build()` 为唯一事实来源，二者职责不重叠。
- 解码产出的纹理/几何最终进入 **ADR-026（YSMParser 伦理边界）** 限定的「仅预览」用途。

## 4. 数据溯源

| 来源（postmortem） | 贡献的决策内核 | 落点 |
| --- | --- | --- |
| `postmortem-20250608.md` | sidecar→WASM 方向、双格式（LegacyYSM AES / OYSM zip）支持、YSMParser 输出字段兼容（float `texture_width`、`json.RawMessage` UV、cubes `null→[]`） | §2.1、§2.3 |
| `postmortem-20250608-wasm.md` | 8 轮 Debug 沉淀的工程契约：内存解析优先、HEAPU8 重取、`Uint8Array.from` 转换、`atob()` 解码 base64、胶水代码字符串注入 patch | §2.2、§2.3 |
| `postmortem-20250609.md` | WASM 集成主线、`Module.wasmBinary` 注入、`detectYsmVersion` 预检、`wazero` 自检（`check_wasm.go`/`wasm_diag.go`） | §2.1、§2.3 |
| `postmortem-20250610.md` | 解码性能优化（缓存 ArrayBuffer、胶水缓存、移除必然失败的 callMain 回退）、`HideWindow` 防弹窗 | §2.2、§2.3 |
| `postmortem-20250611.md` | V3（`YSM` 魔数）分支、MEMFS+callMain 在 V3 重新启用、`detectYsmVersion` 有效预检 | §2.1 |

> 原始完整调试过程（逐轮症状/猜测/真相）保留于上述 archive 文件的历史版本（git），本 ADR 仅收口其**决策内核**。
