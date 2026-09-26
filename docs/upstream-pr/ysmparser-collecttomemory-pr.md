# YSMParser 上游 PR 准备包：`collectToMemory()` 内存直出 API

> 2026-09-27 由 ADR-316（wazero 纯 Go 宿主退役 Node 子进程桥）衍生。
> vendored 基线：**0.3.6**（`upstream/YesSteveModel-Parser/version.txt`）。
> 本文件是提交给上游前的准备材料；实际推送需仓库所有者操作（外部动作）。
> （路径注：原拟放 docs/upstream/ 被 .gitignore 的 `upstream/` 模式误伤，故改 upstream-pr/。）

## 提案概述

**新增** `YSMParser` 抽象基类虚函数 `collectToMemory()`——`saveToDirectory()` 的无文件系统孪生：同一套路径整形/文件名清洗逻辑，产物不落盘、按序留在内存：

```cpp
virtual std::vector<std::pair<std::string, std::vector<uint8_t>>> collectToMemory() = 0;
```

**新增** WASM 桥接导出 `ysm_decode_to_memory(data, size, out_ptr)`：产物序列化为单块缓冲 `[u32 count][u32 nameLen][u32 dataLen][name][data]*`，成功把缓冲指针写入 `*out_ptr`（宿主读完后 `free`）返回 1，失败返回 0。

## 动机（写给上游的 rationale）

1. **emscripten `-sSTANDALONE_WASM` 默认 `-sFILESYSTEM=0`**：standalone 构建不导入任何文件 syscall（实测无 `path_open`），`saveToDirectory` 内的 `std::filesystem` 调用必然 abort。想要纯 wasm 宿主（Go wazero / Python / Rust wasmtime 等）消费解析器，内存直出是**必选项不是优化项**。
2. 现有替代路径（MEMFS→stdout JSON→宿主搬运）需要完整 JS 胶水 + Node，纯 Go/宿主环境无法复刻 `invoke_*` 异常垫片，链路重且脆。
3. 改动是**纯增量**：新虚函数 + 新导出，不改任何既有行为（`saveToDirectory` 原样保留）；V3 的 `collectToMemory` 与 `saveToDirectory` 共享同一套 `sanitizeWindowsFilename` + 目录整形，未来上游改动两者需同步——正因如此希望进上游，消除下游 vendored 副本的双倍维护。

## 改动清单（4 文件 + 1 新文件）

### 1. `YSMParser/parsers/YSMParser.hpp`（基类声明）

```cpp
virtual std::vector<std::pair<std::string, std::vector<uint8_t>>> collectToMemory() = 0;
```

### 2. V1（`YSMParserV1.hpp/.cpp`）

```cpp
std::vector<std::pair<std::string, std::vector<uint8_t>>> YSMParserV1::collectToMemory() {
    std::vector<std::pair<std::string, std::vector<uint8_t>>> out;
    for (const auto& [filename, data] : m_resources) {
        out.emplace_back(filename, data);
    }
    return out;
}
```

### 3. V2（`YSMParserV2.hpp/.cpp`）

同 V1 形态（V2 资源容器同为 `m_resources` map）。

### 4. V3（`parsers/v3/YSMParserV3.hpp/.cpp`）

`saveToDirectory` 的无文件系统孪生：同一套路径整形，产物留在内存（完整实现见 vendored 副本 `YSMParserV3.cpp:2824`，约 70 行——复刻 `exportMapped` lambda、`useLegacyRootLayout` 分支、avatar/background 特殊路径，仅把 `saveFile` 落盘换成 `out.emplace_back(PathUtils::path_to_utf8(relativePath), data)`）。

### 5. `ysm-wasm-bridge.cpp`（新导出）

```cpp
EMSCRIPTEN_KEEPALIVE
int ysm_decode_to_memory(const uint8_t* data, size_t size, uint32_t* out_ptr) {
  if (!out_ptr) return 0;
  try {
    auto parser = YSMParserFactory::Create(reinterpret_cast<const char*>(data), size);
    parser->parse();
    auto files = parser->collectToMemory();
    size_t total = 4;
    for (const auto& f : files) total += 8 + f.first.size() + f.second.size();
    uint8_t* buf = static_cast<uint8_t*>(malloc(total));
    if (!buf) return 0;
    uint8_t* w = buf;
    uint32_t count = static_cast<uint32_t>(files.size());
    memcpy(w, &count, 4); w += 4;
    for (const auto& f : files) {
      uint32_t n = static_cast<uint32_t>(f.first.size());
      uint32_t d = static_cast<uint32_t>(f.second.size());
      memcpy(w, &n, 4); w += 4;
      memcpy(w, &d, 4); w += 4;
      memcpy(w, f.first.data(), n); w += n;
      memcpy(w, f.second.data(), d); w += d;
    }
    *out_ptr = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(buf));
    return 1;
  } catch (const std::exception& e) {
    fprintf(stderr, "[WASM-Bridge] decode_to_memory EXCEPTION: %s\n", e.what());
    return 0;
  }
}
```

## 提交前待办

1. 定位上游仓库 / 联系方式（vendored 目录无 .git 元数据，上游来源待 owner 确认）。
2. patch 对上游最新 main 重放（vendored 快照是 0.3.6，若有版本差需先行 rebase）。
3. V1/V2 的 `collectToMemory` 在上游最新版实现核对（m_resources 容器形态是否变化）。
4. PR 附验证证据：12 个真实 .ysm（11×V3 + 1×V2）wazero 内存直解成功、产物与 Node MEMFS 桥同构。

## 时机评估（内部结论）

- **改动性质纯增量、零行为变更** → 上游合并阻力低，值得推。
- **越早越好**：`collectToMemory` 与 `saveToDirectory` 是路径整形双胞胎，上游每改一次 `saveToDirectory`，vendored 副本就要双倍重放；漂移窗口越长，维护成本线性上涨。
- **但不作为依赖项**：上游是否合并不受本仓控制，ADR-316 D4 的 vendored 重放策略仍是主防线；推上游是降本手段，不是架构前提。
