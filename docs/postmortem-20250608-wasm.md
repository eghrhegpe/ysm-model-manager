# Postmortem: WASM 内嵌 YSMParser 解码（2026-06-08）

> 历时约 6 小时，横跨 C++ 编译链（Emscripten）、WASM 运行时调试、JS/WebView2 兼容性
> 涉及 8 轮 Debug，从"`Unsupported file version`"到最终成功解码 187 骨 877 方的加密 .ysm

## 目标

将 YSMParser CLI sidecar（1.2 MB exe）替换为前端内嵌 WASM，消除外部二进制依赖。

## 最终结果

| 指标 | 值 |
|------|-----|
| WASM 解码加密 .ysm | ✅ V3 格式，187 骨 877 方（Eanes） |
| WASM 二进制 | 1.1 MB（base64 内嵌约 1.5 MB） |
| 解码耗时 | ~0.00s（缓存命中后毫秒级） |
| 新增文件 | `ysm-wasm-bridge.cpp`（C++ 桥接层） |
| 修改文件 | `ysm-parser.js`, `ysm-wasm-data.js`, `ysm-glue-data.js`, `CMakeLists.txt`, `index.js` |

## Debug 路径

### Round 1: WASM 报 `Unsupported file version`（CLI 却正常）

**症状**: 同一份源码编译的 CLI 能解码 .ysm，WASM 报 `Unsupported file version detected`

**错误猜测**: Emscripten 的 zstd/crypto 库不完整，或编译参数裁剪了代码路径

**查了什么**:
- 读 YSMParser 源码 `parsers/YSMParser.cpp` → 版本检测逻辑是纯字节比较（`readLE24` + `readBE`），无平台依赖
- `readLE<uint32_t>(buf, 3)` 对齐访问问题？不，WASM 支持非对齐读取
- 确认 `__EMSCRIPTEN__` 宏正确设置，`YSM_WASM_TARGET=1`

**真相**: 不是版本检测失败，而是 WASM 根本没读到正确的文件内容！`callMain` 通过 MEMFS 文件 I/O，数据链路：`Go ReadFileBytes → JSON 序列化 → JS 反序列化 → FS.writeFile → WASM ifstream`，此链路**数据已损坏**（base64 编解码问题）。

**尝试但未成功的修复**:
- 加 `-sINVOKE_RUN=0` 防止 `main()` 自动运行
- 改写 `decodeYsmFile` 添加路径清理
- 添加 `-sFORCE_FILESYSTEM=1`

**Lesson**: 当 WASM callMain 行为异常时，不要猜编译参数，**直接绕过文件 I/O**，用内存传入。

---

### Round 2: 新增 WASM bridge — `ysm_decode_from_memory`

**症状**: 改走 `YSMParserFactory::Create(const char* data, size_t size)` 内存解析，但仍然 `Unsupported file version`

**修复**: 新增 `ysm-wasm-bridge.cpp`，暴露两个 C 函数给 JS：

```cpp
EMSCRIPTEN_KEEPALIVE
int ysm_decode_from_memory(const uint8_t* data, size_t size, const char* output_dir) {
  try {
    const char* cdata = (const char*)(data);
    auto parser = YSMParserFactory::Create(cdata, size);
    parser->parse();
    parser->saveToDirectory(output_dir ? output_dir : "/output");
    return 1;
  } catch (const std::exception&) {
    return 0;
  }
}
```

更新 CMakeLists.txt，link 选项增加 `"-sEXPORTED_FUNCTIONS=['_ysm_decode_from_memory',...]"` 和 `"-sEXPORTED_RUNTIME_METHODS=['FS','callMain','ccall','cwrap']"`。

**Lesson**: 任何 WASM 项目都应优先走内存传入数据，避免 MEMFS 文件 I/O 的兼容性问题。

---

### Round 3: `HEAPU8` 未定义（新 Emscripten 闭包变量）

**症状**: `Cannot read properties of undefined (reading 'set')` — `wasmModule.HEAPU8` 是 `undefined`

**根因**: 新 Emscripten（v3.x+）MODULARIZE 模式下，`HEAPU8` 是工厂函数闭包内的 `var`，**不是模块的属性**。

```js
// 胶水代码简化结构
var YSMParserModule = (() => {
  return async function(moduleArg = {}) {
    var Module = moduleArg;
    var HEAPU8;  // ← 闭包内 var，不是 Module 的属性
    
    function updateMemoryViews() {
      HEAPU8 = new Uint8Array(wasmMemory.buffer);
      // 没有 Module["HEAPU8"] = HEAPU8
    }
    
    function createWasm() {
      // ... 实例化 WASM ...
      updateMemoryViews();  // 创建 HEAPU8
    }
    
    return Module;  // Module 上没有 HEAPU8
  };
})();
```

**修复 1**（失败）：在 `initYSMParser` 成功后尝试从 `wasmModule.asm.memory` 获取 → `wasmModule.asm` 也不存在。

**修复 2**（成功）：注入胶水代码前，用字符串替换注入 `Module["HEAPU8"]=HEAPU8`：

```js
// ysm-parser.js
glueCode = glueCode.replace(
  ";updateMemoryViews()",
  ";updateMemoryViews();Module[\"HEAPU8\"]=HEAPU8",
);
```

注意必须用 `";updateMemoryViews()"`（带分号前缀），否则会误改函数定义 `function updateMemoryViews(){` 导致语法错误。

**Lesson**: 闭包内变量无法从外部访问，需要用字符串注入或修改胶水代码输出。

---

### Round 4: `const` 重赋值崩溃

**症状**: `Assignment to constant variable.` — 模块初始化失败

**根因**: `glueCode` 声明为 `const`：

```js
const glueCode = _getGlueCode();  // ← const
glueCode = glueCode.replace(...);  // ← 重赋值报错
```

**修复**: `const` → `let`

**Lesson**: 低级错误，但值得记录——在疯狂调试时容易忽略基础语法。

---

### Round 5: `.replace()` 误改函数定义致语法错误

**症状**: `Failed to execute 'appendChild' on 'Node': Unexpected token ';'` — 注入的脚本语法错误

**根因**: `.replace("updateMemoryViews()", ...)` 匹配了函数定义 `function updateMemoryViews(){` 中的 `updateMemoryViews()` 部分，将其替换为 `function updateMemoryViews();Module["HEAPU8"]=HEAPU8{`，产生非法 JS。

**修复**: 改用 `";updateMemoryViews()"`（带分号前缀）精确匹配调用点。

**Lesson**: 字符串替换必须考虑上下文歧义。minified JS 中同一个字符串可能出现在函数定义和函数调用两个位置。

---

### Round 6: `HEAPU8` 内存扩容后分离

**症状**: 数据写入了 WASM 内存，但诊断显示 `raw_bytes: 00 00 00...`（全部为零）

**根因**: `_malloc(284916)` 触发 `ALLOW_MEMORY_GROWTH`，WASM 内存扩容。旧的 `HEAPU8`（从 `updateMemoryViews()` 获取）指向**旧的已分离的 ArrayBuffer**。`heap.set(data, ptr)` 写入了旧 buffer，WASM 代码读取新 buffer → 全零。

**时序**:
```
1. init → updateMemoryViews() → HEAPU8 = new Uint8Array(wasmMemory.buffer)  // 初始 16MB
2. _malloc(284KB) → wasmMemory 扩容 → 旧 HEAPU8.buffer 分离！
3. heap.set(data, ptr) → 写入旧 buffer → 无效
4. WASM 读 ptr → 新 buffer 全零
```

**修复**: `_getHeap()` 在 `_malloc` 后重新获取 `HEAPU8`，且每次从 `window.Module.HEAPU8` 取最新引用（胶水代码的 patch 在每次 `updateMemoryViews()` 被调用时自动更新 `Module.HEAPU8`）。

```js
function _getHeap() {
  // 每次从 window.Module.HEAPU8 取最新的
  // 内存扩容后 updateMemoryViews 会自动更新它
  const h = window.Module?.HEAPU8;
  if (h) return h;
  if (wasmModule?.HEAPU8) return wasmModule.HEAPU8;
  throw new Error("无法获取 WASM HEAPU8");
}

function _writeHeap(data) {
  const src = data instanceof Uint8Array ? data : new Uint8Array(data);
  const len = src.length;
  const ptr = wasmModule._malloc(len);  // ← 可能扩容
  const heap = _getHeap();              // ← 扩容后重新获取
  heap.set(src, ptr);                   // ← 写入正确 buffer
  return ptr;
}
```

**Lesson**: `ALLOW_MEMORY_GROWTH` + `HEAPU8` 是经典陷阱。牢记：**`_malloc` 之后必须重新获取 HEAPU8**。

---

### Round 7: 数据仍为零——`new Uint8Array(string)` 在 WebView2 中返回空

**症状**: 即使修复了 HEAPU8 分离问题，`_writeHeap` 内的 `new Uint8Array(data)` 仍然产生空数组

**诊断日志**:
```
[_writeHeap] ptr=152328 wrote= verify=00 00 00 00...
```
`wrote=` 为空 — 说明 `Array.from(src.slice(0,8))` 返回了空数组。

**根因**: `data` 是 Wails `[]byte` 返回的**二进制字符串**。`new Uint8Array(string)` 在某些 WebView2 / Chromium 版本中行为不确定——可能返回零长度数组。

**修复**: 改为 `Uint8Array.from(data, c => c.charCodeAt(0))`：
```js
const src = data instanceof Uint8Array ? data
  : typeof data === "string" ? Uint8Array.from(data, c => c.charCodeAt(0))
  : new Uint8Array(data);
```

**Lesson**: 永远不要用 `new Uint8Array(string)` 转换二进制字符串。用 `Uint8Array.from(str, c => c.charCodeAt(0))`。

---

### Round 8: 🎯 终极根因 — `ReadFileBytes` 返回 base64 字符串！

**症状**: WASM 终于读到了数据，但全是 base64 字符 `%7u/WVNHUA0K...`，不是 YSGP 文件头

**双路诊断输出**:
```
[JS bytes[0-15]]: ef bb bf 59 53 47 50 0d 0a...  // JS 侧看似正确
[WASM raw_bytes]: 37 37 75 2f 57 56 4e 48...      // WASM 侧全是 base64
```

**真相**: `ReadFileBytes`（Go `[]byte` Binding）返回的是 **base64 编码的字符串**！JS 侧的诊断代码用了 `atob(bytes)` 解码，所以显示 `ef bb bf...` 看似正确；但 `_writeHeap` 拿原始 base64 字符串直接 `charCodeAt(0)`，第一个字符 `3` 的 ASCII 码（0x33）... 实际上 `src[0]=37` = `%`，是 base64 字符之一。

**修复**: 在 `_decodeYsmViaWasm` 中统一解码：
```js
let bytes = await ReadFileBytes(modelPath);
// Wails []byte 返回 base64 字符串，解码为 Uint8Array
if (typeof bytes === "string") {
  const binaryStr = atob(bytes);
  bytes = Uint8Array.from(binaryStr, c => c.charCodeAt(0));
}
```

**最终验证**:
```
[_writeHeap] src[0]=ef                                            ← 正确的 0xEF
[_writeHeap] verify=ef bb bf 59 53 47 50 0d 0a 0d 0a 2d 2d...    ← BOM + YSGP ✓
[WASM-Diag] utf8Header==0xbfbbef? YES                             ← V3 检测 ✓
[WASM-Diag] magic3==0x50475359? YES                               ← YSGP 魔数 ✓
[WASM-Bridge] Create OK, version=3                                 ← 解析器创建 ✓
[WASM-Bridge] Parse OK                                             ← 解析完成 ✓
[EXPORT] /output/textures/Eanes.png                                ← 纹理导出 ✓
[EXPORT] /output/models/main.json                                  ← 骨骼数据导出 ✓
```

**Lesson**: **永远先检查 `typeof data`！** 花了几小时排查 WASM 内存问题，最终是 JS 数据类型转换错误。

---

## 关键诊断代码

### 1. WASM 侧诊断 bridge（`ysm-wasm-bridge.cpp`）

```cpp
EMSCRIPTEN_KEEPALIVE
void ysm_diag_header(const uint8_t* data, size_t size) {
  fprintf(stderr, "[WASM-Diag] size=%zu\n", size);
  if (size < 8) return;
  const char* buf = (const char*)(data);

  fprintf(stderr, "[WASM-Diag] raw_bytes:");
  for (int i = 0; i < 16 && i < (int)size; i++)
    fprintf(stderr, " %02x", (unsigned char)buf[i]);
  fprintf(stderr, "\n");

  uint64_t utf8Header = MemoryUtils::readLE24(buf, 0);
  uint32_t magic3 = MemoryUtils::readLE<uint32_t>(buf, 3);
  uint32_t magic2 = MemoryUtils::readLE<uint32_t>(buf, 0);
  uint32_t crypto2 = MemoryUtils::readBE<uint32_t>(buf, 4);

  fprintf(stderr, "[WASM-Diag] readLE24[0]=0x%06lx magic3=0x%08x "
    "magic2=0x%08x crypto2=0x%08x\n",
    (unsigned long)utf8Header, magic3, magic2, crypto2);
  fprintf(stderr, "[WASM-Diag] utf8Header==0xbfbbef? %s\n",
    utf8Header == 0xbfbbef ? "YES" : "NO");
  fprintf(stderr, "[WASM-Diag] magic3==0x50475359? %s\n",
    magic3 == 0x50475359 ? "YES" : "NO");
}
```

### 2. JS 侧写入验证（`ysm-parser.js`）

```js
function _writeHeap(data) {
  const ptr = wasmModule._malloc(len);
  const heap = _getHeap();
  console.log("[_writeHeap] ptr=" + ptr + " srcLen=" + src.length
    + " src[0]=" + src[0].toString(16));
  heap.set(src, ptr);
  const verify = heap.slice(ptr, ptr + 16);
  const verifyHex = Array.from(verify)
    .map(b => b.toString(16).padStart(2, "0")).join(" ");
  console.log("[_writeHeap] verify=" + verifyHex);
  return ptr;
}
```

### 3. Go 数据源诊断（`index.js`）

```js
// 在 JS 侧检查 ReadFileBytes 的返回值和类型
const bytesArr = typeof bytes === "string"
  ? Array.from(atob(bytes), c => c.charCodeAt(0))
  : Array.from(bytes);
const rawFirstBytes = bytesArr.slice(0, 16)
  .map(b => b.toString(16).padStart(2, "0")).join(" ");
console.log("[YSM] JS bytes[0-15]:", rawFirstBytes);
console.log("[YSM] bytes type:", bytes?.constructor?.name,
  "length:", bytes?.length);
```

## 总结：8 轮 Debug 根因分布

| 轮次 | 根因类型 | 具体问题 | 检测手段 |
|------|----------|----------|----------|
| R1 | 架构设计 | callMain MEMFS I/O 不可靠 | 改为内存解析 |
| R2 | C++ 集成 | 缺少内存解析 bridge | 加 bridge |
| R3 | Emscripten 特性 | HEAPU8 是闭包变量 | 字符串注入 patch |
| R4 | JS 基础 | `const` 重赋值 | `let` |
| R5 | 字符串操作 | `.replace()` 歧义匹配 | 带分号前缀 |
| R6 | WASM 内存管理 | 扩容后 HEAPU8 分离 | malloc 后重取 |
| R7 | WebView2 兼容 | `new Uint8Array(string)` | `Uint8Array.from()` |
| R8 | Wails 序列化 | `[]byte` → base64 字符串 | `atob()` 解码 |

**核心教训**: 跨语言数据传递的每一层（Go→JSON→JS→WASM HEAPU8→C++）都可能改变数据类型，必须每层验证。

## 最终工具链

```
.ysm 文件
  └─ Go: ReadFileBytes() → base64 string
  └─ JS: atob() → Uint8Array
  └─ WASM: _malloc → HEAPU8.set → ccall("ysm_decode_from_memory")
  └─ C++: YSMParserFactory::Create(data, size) → parse → saveToDirectory("/output")
  └─ WASM MEMFS: /output/models/*.json, /output/textures/*.png
  └─ JS: collectOutputFiles(FS, "/output") → [{path, data}]
  └─ parseBedrockGeometryFromJSON() → geometry + texture
  └─ renderModel2D() → Canvas 骨架图
```

## 代码质量改进

- `ysm-parser.js`: 新增 `_getHeap()`（内存安全访问）+ `_writeHeap()`（统一写入）
- `ysm-parser.js`: `detectYsmVersion()` 快速诊断工具函数
- `ysm-parser.js`: `diagYsmHeader()` WASM 侧诊断
- 保留 `decodeYsmFile()`（callMain 回退）兼容旧 WASM 编译
- C++ bridge: `ysm_decode_from_memory()` + `ysm_diag_header()` + `ysm_detect_version()`
- CMakeLists.txt: `-sINVOKE_RUN=0` + `-sEXPORTED_RUNTIME_METHODS` 精确导出
