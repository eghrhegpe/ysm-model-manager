---
kind: go-avatar
name: 头像 go/avatar
tier: architecture
category: go
source_files:
  - go/avatar/avatar.go
  - go/avatar/
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 头像、作者、创作者 avatar
  - 头像缓存、缩略图
  - isSafeAvatarPath
quick_risk_lines:
  - 头像提取必须走 go/avatar 的 ExtractAvatarURI，前端禁止手写头像路径拼接
pitfalls:
  - 手写头像路径拼接 → 越权路径穿越、缓存污染；必须经 isSafeAvatarPath 校验
  - 头像缓存不失效 → 换头像后仍显示旧图；必须经缓存失效策略

use_when:
  - 头像
  - 作者
  - 创作者
  - avatar
  - 缓存
  - 缩略图
perf:
  - io-bound
invariant_anchors:
  - go/avatar/avatar.go|isSafeAvatarPath
  - go/avatar/avatar.go|strings.NewReplacer
status: active
---

# 头像 go/avatar

## 概览

`go/avatar/` 包负责创作者头像的提取与缓存：从模型文件（.ysm 二进制 / .zip / 解压目录 .json）的 `metadata.authors[].avatar` 声明中取出头像图片，缓存到**平台配置根 `os.UserConfigDir()/YSM-Model-Manager/creators_cache`**（2026-08-12 由 exe 旁落点收敛，与 `configDir()` 桌面根同口径 ADR-046 P2；平台配置根缺失时 fail-fast 返回空串，不降级写 exe 旁或 CWD），供作者列表展示。不依赖 Wails runtime，可独立测试。

## 核心职责

- `avatar.go` — 缓存读写（data URI）、按作者名从模型包提取头像、批量缓存、.ysm 二进制经 Node.js + YSMParser WASM 子进程解码

## 对外 API / 入口

- `CacheDir` — 函数变量，返回缓存目录（`os.UserConfigDir()/YSM-Model-Manager/creators_cache`），测试可覆盖；平台配置根缺失返回空串 fail-fast，不降级写 exe 旁或 CWD
- `SafeName(name string) string` — 非法文件名字符替换为下划线
- `ReadCachedAvatar(authorName string) (string, error)` — 读缓存返回 data URI；未命中返回空串（非错误）
- `SaveAvatarData(safeName string, data []byte, mime string) string` — 写缓存并返回 data URI
- `ExtractAvatarURI(modelPath, safeName string) string` — 从 .ysm/.zip/.7z/.json 提取指定作者的头像 data URI；无 authors 声明时降级取 avatar/ 目录第一张图（仅 .ysm 分支实现）
- `CacheAvatarsFromJSON(modelPath string)` — 从解压目录的 ysm.json 批量缓存所有作者头像（已有缓存则跳过）
- `CacheAvatarsFromModel(modelPath string)` — 通用批量缓存（.ysm/.zip/.7z/.json 按扩展名分派，无 authors 声明时降级取 avatar/ 目录第一张图）
- `ReadFileFromZip(zr *zip.Reader, target string) []byte` — 按路径后缀从 ZIP 取文件；**ADR-068 迁移**：调用点改 `container.OpenZipBytes` + `ReadFileFromContainer(r container.Reader, target)`（`avatar_zip.go`），zip 专用路径收敛进统一容器桥
- `SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte)` — 注入 Node.js 路径与 WASM 胶水代码/二进制加载器（由 wasm_decoder.go 在启动时调用）
- `DecodeYSMFiles(ysmData []byte)` — 起 Node.js 隐藏子进程执行 YSMParser WASM，把 .ysm 二进制解码为文件列表（path + 字节数组）

## 与其他子系统关系

- 被 `internal/app/app_avatar.go` 调用（GetCachedAvatar / ExtractAuthorAvatar 等 binding）
- 被 `internal/app/wasm_decoder.go` 调用（`SetNodeJS` 注入解码环境）
- 依赖 YSMParser WASM（与 [go_ysm_parser](./go-ysm-parser.md) 同源算法口径）、Node.js 运行时

## 不变量

- 头像路径必须位于 `avatar/` 目录下（`isSafeAvatarPath` 强校验：`path.Clean` 规范化后严格 `avatar/` 前缀 + 拒绝 `..` 段 + 落盘前 `filepath.Rel` 复查），防止读取包内任意文件或逃逸读磁盘任意文件。**裸名归一化仅对纯文件名（不含 `/`）生效**（P3 修复：原实现对任意非 `avatar/` 前缀路径归一化，`avatar/../x` 先被 `path.Clean` 折叠为 `x` 再归一化为 `avatar/x` 放行，而调用方 `filepath.Join(dir, 原始路径)` 实际读到 avatar/ 之外、模型目录内的任意文件）
- `SetNodeJS` 未注入时 `DecodeYSMFiles` 直接返回 nil，不 panic
- 解码临时目录 `MkdirTemp` 用完必 `RemoveAll`；Windows 子进程 `HideWindow` 不弹窗口；Node 子进程带 60s 超时护栏（`exec.CommandContext`），WASM 死循环/卡死不会永久挂起 UI 线程
- 缓存文件名一律经 `SafeName` 清洗（非法字符 + Windows 保留设备名 CON/PRN/AUX/NUL/COM1-9/LPT1-9 + 尾部点/空格），防路径穿越与写缓存失败
- **读回缓存按文件头嗅探 mime**（P3 修复：JPEG 头像以 `.png` 落盘、读回恒硬编码 `data:image/png` → MIME 错误；现 `FFD8FF` 头识别为 `image/jpeg`）
- **P3 已对齐**：降级取 avatar/ 第一张图已由 .ysm/.zip/.7z 三态实现（.json 分支不降级）；`CacheAvatarsFromModel`/`modelAuthorNames` 批量路径已同步补 .7z 分支（R20 审核 P3-4，原仅 `ExtractAvatarURI` 路径支持 .7z）；`ExtractAvatarURI` 由旧 `DecodeOneAvatar(modelPath, cacheDir, safeName)` 重构为 `(modelPath, safeName)`，`cacheDir` 形参已废弃（落盘走全局 `CacheDir()`）
- **R32 修复链（2026-08-31）**：
  - P2-1 `ReadFileFromZip` defer-in-loop：`defer rc.Close()` 位于 for 循环体内，多条目命中时累积未关闭句柄。修复：循环内显式 `rc.Close()`，不依赖 defer。
  - P2-2 `ReadFileFromZip` 死代码：生产路径已全面切换到 `container.Reader`，全包仅测试引用。待后续删除 + 测试迁移。
  - P3-1 `DecodeYSMFiles` 重复解码：批量 `CacheAvatarsFromModel` 时每个作者重复触发一次 `extractAvatarFromYSM`→`DecodeYSMFiles`，同一 .ysm 被解码 N 次。待后续优化（一次解码 + 一次遍历缓存所有作者）。

## 相关

- [go_ysm_parser](./go-ysm-parser.md) — YSM 格式解析（同一 WASM 口径）
- [wails_bridge](./wails-bridge.md) — 头像 binding
