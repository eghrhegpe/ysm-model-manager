# R32 审核：go/avatar + go/rustbridge（两模块并行）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 2 explore 子代理｜状态：⏳ 修复闭环中
> 前置：R26 installer+recycle+download / R27 sync+dedup / R28 cli+litematic / R29 ysm+geometry / R30 updater+importer / R31 threejs+scanner

## 范围与岔开依据

**审核**（两模块并行，single 深度，只读）：

| 模块 | 非测试文件 | 规模 | 前置审核 |
|---|---|---|---|
| avatar | 4 个（avatar_extract.go 495 + avatar.go 198 + avatar_decode.go 192 + avatar_zip.go 114） | 999 行 | 无 R 级系统审核 |
| rustbridge | 9 个（bridge_windows.go 126 + bridge_android.go 107 + bridge_linux.go 104 + bridge_darwin.go 101 + embedded_windows.go 69 + common.go 33 + types.go 17 + types_windows.go 9 + doc.go 3） | 569 行 | 无 R 级系统审核 |

**岔开**：R31 完结 threejs+scanner。avatar 是头像提取/解码/缓存（ZIP+Base64+PNG），rustbridge 是 Go↔Rust FFI 桥接（4 平台）。两包同属「外部数据解码 + 平台桥接」域，一次性过。

## 总体结论：通过（4 项 P2 + 4 项 P3 + 8 项 P4）

两包代码质量分化显著：

- **go/avatar**：安全姿态扎实——`isSafeAvatarPath` 双重 Clean + `..` 段拒绝 + 反斜杠归一化、`ReadLimitedEntry` 限流配对 Close、`WriteFileAtomic` 原子写、`limitedBuffer` 输出护栏均有且对齐项目范式。主要问题集中在**重复逻辑三份复制**（`ReadFileFromZip`/`ReadFileFromContainer`/降级分支各维护一份 LimitReader 防弹）与**死代码**（`ReadFileFromZip` 生产零引用、`extractAvatarFromYSM` L54-57 冗余调用）。`.ysm` 批量缓存同一模型重复 N 次解码的内存/时间放大值得 deep 复审确认是否为性能瓶颈。
- **go/rustbridge**：FFI 内存管理（Rust 分配 → Go 拷贝 → defer free）顺序正确且在所有平台一致；内嵌 DLL 释放用 SHA256 版本化缓存 + 原子 rename，TOCTOU 风险在用户私有 0700 目录下可接受；`parseResponse` 已正确抽取为公共函数避免解码逻辑漂移。主要问题是 P4 的四平台函数体逐字重复（CGO `import "C"` 的特殊性使完全去重困难，但函数体可抽公共），以及 P3 的 FFI 调用无并发序列化保护（需确认 Rust 侧线程安全性）。该包无致命陷阱（`sync.Once` 用法正确、无 goroutine 泄漏、无 defer-in-loop、`unsafe` 使用有 `KeepAlive` 配对），审查通过。**不建议 deep 复审。**

## 发现项汇总

| 模块 | P2 | P3 | P4 | deep 复审 |
|---|---|---|---|---|
| avatar | 2 | 2 | 4 | 是（重复解码 + 三份复制） |
| rustbridge | 2 | 2 | 4 | 否（FFI 正确，无致命陷阱） |
| **合计** | **4** | **4** | **8** | — |

## avatar 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | avatar_zip.go:30-48 | `ReadFileFromZip` 的 `defer rc.Close()` 位于 `for` 循环体内——若循环命中多个条目（target 含路径前缀匹配多文件时），已打开的 `rc` 要等**函数返回**才 Close，中间累积 N 个未关闭句柄。虽当前调用方一命中即 `return`，但契约本身脆弱。 | 拆出读取单条目的独立函数让 `defer` 在每轮结束即释放，或循环内显式 `rc.Close()` 后再 `continue`。 |
| P2-2 | avatar_zip.go:19-51 | `ReadFileFromZip` 是死代码——生产路径（`extractAvatarFromContainer`、`ReadFileFromContainer`）已全面切换到 `container.Reader`，全包仅测试引用。残留函数（含其独立的 `io.LimitReader` 防弹逻辑）与 `ReadFileFromContainer` 维护两份几乎相同的读取+限流代码，任一修复不同步。 | 删除 `ReadFileFromZip`，把其测试迁到 `ReadFileFromContainer`。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | avatar_decode.go:75-183 | `DecodeYSMFiles` 把 `ysmData`（可至 50MB）+ `wasmBin` 全量 `base64.EncodeToString` 后 `fmt.Sprintf` 成单脚本字符串——峰值内存 ≈ 原始 3.5×（base64 1.33× + Sprintf 拷贝 1× + JS 解析），50MB 模型下峰值 ~180MB 单次解码，批量 `CacheAvatarsFromModel` 时每个作者重复触发一次 `extractAvatarFromYSM`→`DecodeYSMFiles`，同一 .ysm 被解码 N 次。 | `CacheAvatarsFromModel` 的 `.ysm` 分支改为一次 `DecodeYSMFiles` + 一次遍历缓存所有作者，避免重复解码；或考虑 stdin 传 ysmData 而非内联 base64。 |
| P3-2 | avatar_extract.go:88-106 | `extractFallbackAvatarFromDir` 取 avatar/ 目录**第一张**图片——但 `files []ysmFile` 来自 `DecodeYSMFiles` 遍历 `/output` 的顺序，取决于 WASM FS.readdir 的返回顺序（非确定），多个作者无 authors 字段时可能把同一张图分给不同人，或取到非预期图。 | 降级取首图前按路径排序确定化，或限定只取明确 `avatar/` 根下的图。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | avatar_extract.go:54-57 | 死代码——L43-52 已按 `len(authors)` 二分处理完毕（authors 非空时 L44 已尝试匹配失败，authors 为空时 `matchAvatarByAuthor` 内层 `for au` 不执行恒返回 ""），L54-57 无条件再次 `matchAvatarByAuthor(files, authors, safeName)` 永远不会改变结果。 | 删除 L54-57 及其注释，保留 L43-52 的二分逻辑。 |
| P4-2 | avatar_decode.go:186-192 | `toBytes([]int) []byte` 用 `byte(v)` 静默截断——Node 端 `Array.from(FS.readFile(p))` 把字节值当 number 存入 JSON，正常 0-255 无事；但若 WASM 解码产物含异常值（>255 的 number），`byte(v)` 取低 8 位无任何告警。 | `if v < 0 || v > 255 { return nil / log }` 显式拒绝，或用 `math.Uint8` 语义注释标明截断是有意。 |
| P4-3 | avatar.go:30-36 | `CacheDir` 是包级 `var` 函数，测试通过覆盖它注入临时目录——但运行期 `NewApp()` 也用 `pathMgr` 覆盖它（注释 L28 提及）。这构成「全局可变函数变量 + 并发覆盖」模式：若 `NewApp()` 的覆盖与首个 `ReadCachedAvatar` 调用存在竞态，读到的可能是旧默认值或新值。 | 确认覆盖发生在任何头像读取前（启动期单线程注入），或改为显式传入 `cacheDir` 参数消除全局可变状态。 |
| P4-4 | avatar.go:44-68 | `SafeName` 的 Windows 保留设备名检测按 `.` 与 `_` 分割取首段比对——但 `TrimRight(safe, " .")` 在分割前已执行，`CON.` 经 TrimRight 变 `CON` 再走 `IndexAny` 分割得 `CON` 命中，逻辑正确；然而 `CON .png`（带空格的合法文件名）经 Replacer 不变 → TrimRight 去 `.` → `CON ` → `IndexAny("._")` 无命中 → `base = "CON "`（含尾空格）→ `ToUpper("CON ")` ≠ `"CON"` 漏判。属边界 niche，实际 ysm.json 作者名含 `CON ` 尾空格概率极低。 | TrimRight 后再 TrimSpace 比对，或接受现状加注释说明仅覆盖无空格变体。 |

## rustbridge 发现项

### P2（正确性 / 安全）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | embedded_windows.go:26 | `os.MkdirAll(dir, 0o700)` 只约束目录本身，`os.CreateTemp` 创建的临时文件权限继承 umask（可能 0644），在多用户机器上同一 `cacheRoot` 下其它用户可读该 DLL 路径中间文件。 | `CreateTemp` 后显式 `tmp.Chmod(0o600)`，或用 `os.OpenFile` 指定 `0600`。 |
| P2-2 | embedded_windows.go:18-68 | `materializeDLL` 无任何并发互斥，多个 goroutine 同时触发 `load()` → `sync.Once` 保证只调用一次 `materializeDLL`，但若该函数被直接复用（如未来热重载 DLL 场景），两个 goroutine 会同时 `CreateTemp` → `Rename` 到同一 `dllPath`，后者 `Rename` 成功覆盖前者，前者句柄泄漏。当前路径因 `sync.Once` 串行化而安全，但函数本身非并发安全且无文档说明。 | 给 `materializeDLL` 加 `sync.Mutex` 或在文档注释明确「仅限 `sync.Once` 内调用」。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | bridge_windows.go:24-55 + bridge_android.go:43-71 + bridge_linux.go:44-70 + bridge_darwin.go:41-67 | 四平台 `Scan`/`ScanManifest` 对 FFI 调用无任何并发序列化保护，若 Rust 侧（`ysm_scan_json` / `ysm_scan_manifest`）非线程安全，多 goroutine 并发 `Scan` 会触发 Rust 侧数据竞争或 panic。Windows 的 `load()` 用了 `sync.Once`（仅保护加载），但实际 `scanProc.Call()` 无 mutex。 | 要么在 Rust 侧文档确认 `Send + Sync`，要么在 Go 侧加 `sync.Mutex` 序列化 FFI 调用（性能影响可忽略，扫描本身是重操作）。 |
| P3-2 | bridge_windows.go:103-125 | `load()` 用 `sync.Once`，首次加载失败后 `loadErr` 被永久缓存，后续所有 `Scan` 调用都返回同一错误，无重试机制。若 DLL 加载失败是瞬时（如缓存目录被占用），则进程生命周期内不可恢复。 | 评估是否需要重试——若 DLL 是内嵌的、缓存目录是用户私有的，加载失败基本是永久性的，当前行为可接受；但建议在错误信息中提示「重启应用」。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | bridge_android.go / bridge_linux.go / bridge_darwin.go | 三个文件的 `Scan`、`ScanManifest` 函数体**逐字相同**（CGO extern 声明、`nativeBuffer` 结构体、参数封装、`KeepAlive`、状态检查、free defer、`append` 拷贝），仅在文件头注释和 build tag 上有差异。 | 抽取公共 `scanCGO(root string, registryJSON, manifestJSON []byte, manifest bool)` 函数到 `bridge_cgo_common.go`（build tag: `(linux \|\| darwin \|\| android) && rust_backend`），三平台文件仅保留平台注释 + build tag + `import "C"` 块。 |
| P4-2 | types_windows.go:5-8 | `nativeBuffer` 结构体在 `types_windows.go`、`bridge_android.go:37`、`bridge_darwin.go:35`、`bridge_linux.go:38` 中各定义一次，共 4 份相同定义。build tag 隔离保证了不冲突，但这是「改一处忘改其余」的温床。 | 同上，抽取到公共文件。 |
| P4-3 | bridge_windows.go:57-58 | `ScanManifest` 的注释「清单条目须与 `types.ModelEntry` 字段对齐（Path/Ext/Name/Subdir/Rtype）」描述的是 Rust 侧 manifest JSON 格式约束，但该约束在 Go 侧无任何编译期保证——若 Rust 侧字段重命名，Go 侧不会报错。 | 考虑在 `types.ModelEntry` 上加 JSON tag 显式声明，或添加一个编译期断言测试验证字段顺序。 |
| P4-4 | bridge_windows.go:69-71 | `ScanManifest` 在 `scanManifestProc == nil` 时回退到 `Scan(root, registryJSON)`，静默丢弃 `manifestJSON` 参数。注释说明了「旧 DLL 不含该符号→回退」，但调用方无法区分「manifest 模式成功执行」与「静默回退到 jwalk 模式」。 | 在回退路径 log 一条 `[rustbridge] ScanManifest fallback to jwalk (DLL lacks ysm_scan_manifest)`，或返回一个布尔标志 `manifestUsed bool`。 |

## 修复状态注记（2026-08-31 闭环进行中）

| 级别 | 位置 | 状态 |
|---|---|---|
| avatar P2-1 (ReadFileFromZip defer-in-loop) | avatar_zip.go:30-48 | ⏳ 待修 |
| avatar P2-2 (ReadFileFromZip 死代码) | avatar_zip.go:19-51 | ⏳ 待修 |
| avatar P3-1 (DecodeYSMFiles 重复解码) | avatar_decode.go:75-183 | ⏳ 待修 |
| avatar P3-2 (extractFallbackAvatarFromDir 非确定序) | avatar_extract.go:88-106 | ⏳ 待修 |
| avatar P4-1~P4-4 | 多处 | ⏳ 待修 |
| rustbridge P2-1 (embedded_windows 临时文件权限) | embedded_windows.go:26 | ⏳ 待修 |
| rustbridge P2-2 (materializeDLL 并发安全) | embedded_windows.go:18-68 | ⏳ 待修 |
| rustbridge P3-1~P3-2 | 多处 | ⏳ 待修 |
| rustbridge P4-1~P4-4 | 多处 | ⏳ 待修 |
