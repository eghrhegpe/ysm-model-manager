---
kind: go_avatar
name: 头像 go/avatar
tier: architecture
category: go
source_files:
  - go/avatar/avatar.go
  - go/avatar/
use_when:
  - 头像
  - 作者
  - 创作者
  - avatar
  - 缓存
  - 缩略图
---

# 头像 go/avatar

## 概览

`go/avatar/` 包负责创作者头像的提取与缓存：从模型文件（.ysm 二进制 / .zip / 解压目录 .json）的 `metadata.authors[].avatar` 声明中取出头像图片，缓存到 exe 同目录 `creators_cache/`，供作者列表展示。不依赖 Wails runtime，可独立测试。

## 核心职责

- `avatar.go` — 缓存读写（data URI）、按作者名从模型包提取头像、批量缓存、.ysm 二进制经 Node.js + YSMParser WASM 子进程解码

## 对外 API / 入口

- `CacheDir` — 函数变量，返回缓存目录（exe 同级 `creators_cache/`），测试可覆盖
- `SafeName(name string) string` — 非法文件名字符替换为下划线
- `ReadCachedAvatar(authorName string) (string, error)` — 读缓存返回 data URI；未命中返回空串（非错误）
- `SaveAvatarData(safeName string, data []byte, mime string) string` — 写缓存并返回 data URI
- `DecodeOneAvatar(modelPath, cacheDir, safeName string) string` — 从 .ysm/.zip/.json 提取指定作者的头像；无 authors 声明时降级取 avatar/ 目录第一张图
- `CacheAvatarsFromJSON(modelPath string)` — 从解压目录的 ysm.json 批量缓存所有作者头像（已有缓存则跳过）
- `ReadFileFromZip(zr *zip.Reader, target string) []byte` — 按路径后缀从 ZIP 取文件
- `SetNodeJS(nodePath string, glueFn func() string, wasmFn func() []byte)` — 注入 Node.js 路径与 WASM 胶水代码/二进制加载器（由 wasm_decoder.go 在启动时调用）
- `DecodeYSMFiles(ysmData []byte)` — 起 Node.js 隐藏子进程执行 YSMParser WASM，把 .ysm 二进制解码为文件列表（path + 字节数组）

## 与其他子系统关系

- 被 `internal/app/app_avatar.go` 调用（GetCachedAvatar / ExtractAuthorAvatar 等 binding）
- 被 `internal/app/wasm_decoder.go` 调用（`SetNodeJS` 注入解码环境）
- 依赖 YSMParser WASM（与 [go_ysm_parser](./go_ysm_parser.md) 同源算法口径）、Node.js 运行时

## 不变量

- 头像路径必须位于 `avatar/` 目录下（前缀校验），防止读取包内任意文件
- `SetNodeJS` 未注入时 `DecodeYSMFiles` 直接返回 nil，不 panic
- 解码临时目录 `MkdirTemp` 用完必 `RemoveAll`；Windows 子进程 `HideWindow` 不弹窗口
- 缓存文件名一律经 `SafeName` 清洗，防路径穿越

## 相关

- [go_ysm_parser](./go_ysm_parser.md) — YSM 格式解析（同一 WASM 口径）
- [wails_bridge](./wails_bridge.md) — 头像 binding
