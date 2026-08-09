---
kind: go-packs
name: 资源包 mcmeta go/packs
tier: architecture
category: go
source_files:
  - go/packs/mcmeta.go
  - go/packs/
use_when:
  - 资源包
  - 光影包
  - mcmeta
  - pack_format
  - 缩略图
  - 类型检测
invariant_anchors:
  - go/packs/mcmeta.go|LimitReader
  - go/packs/mcmeta.go|maxLangSize
---

# 资源包 mcmeta go/packs

## 概览

`go/packs/` 包解析 Minecraft 资源包/光影包的 `pack.mcmeta`（目录或 ZIP 两种形态），提取 pack_format 版本信息与 pack.png 缩略图，并承担「一个文件到底属于哪种资源类型」的内容级检测（YSM / 资源包 / 光影包共用 .zip 扩展名，必须看内容）。

## 核心职责

- `mcmeta.go` — pack.mcmeta 读取与 BOM 清理、pack.png base64 缩略图、按注册表 Detector 做内容检测、光影包 lang 显示名提取

## 对外 API / 入口

- `ReadPackMeta(path string) (*types.PackMeta, string, error)` — 从目录或 .zip 读取 pack.mcmeta，返回解析结果 + pack.png 的 data URI 缩略图；自动去 UTF-8 BOM；找不到 mcmeta 报错
- `DetectResourceType(path string, registry *types.ResourceTypeRegistry) string` — 按扩展名筛候选类型后，用注册表 `detector` 字段做内容判定：`"ysm"`（zip 内含 ysm.json 或 models/）、`"mcmeta"`（zip 内含 pack.mcmeta）、`"shader"`（zip 内含 shaders/），其余按扩展名直接命中
- `ReadShaderpackLang(path string) string` — 从光影包（目录或 zip）读 `lang/en_US.lang`，返回 `{name, entries}` JSON 字符串，name 供前端展示（空时前端用文件名兜底）；**lang 文件设 1MB 上限**（P3 修复：dir 分支 stat 预检 + zip 分支 limit+1 截断探测，超限置空返回空 name——原 `os.ReadFile`/`io.ReadAll` 全量读入，畸形/超大 lang 可拖垮内存）

## 与其他子系统关系

- 被 `internal/app/resource_bindings.go` 调用（ReadPackMeta / ReadShaderpackLang / DetectResourceType binding）
- 依赖 `go/types`（PackMeta、ResourceTypeRegistry）
- detector/扩展名定义来自 [resource_registry](./resource-registry.md)，本包不自行维护类型清单

## 不变量

- ZIP 内 pack.png 读取上限 10MB（`io.LimitReader` + limit+1 截断探测，超限置空跳过，防损坏缩略图被展示）；目录形态 pack.png 同样 stat 预检 10MB 上限
- `.7z` 无法用 `zip.OpenReader` 打开：YSM 检测直接按扩展名放行，mcmeta/shader 检测返回 false
- `supported_formats` 兼容三种 JSON 形态（int / [min,max] 数组 / {min_inclusive,max_inclusive} 对象），由 `types.FormatRange` 承接
- **`.json` 扩展名的 YSM 恒不被 DetectResourceType 识别**（P3 观察：注册表 ysm 声明 `.json` 扩展名，但 `isYsmFile` 对非 `.ysm/.zip/.7z` 恒返回 false——前端以 `""` 兜底走 model detail，功能可用但类型标签错误；二选一修复方向：isYsmFile 加 `.json` 内容判定或从注册表移除 `.json`）

## 相关

- [resource_registry](./resource-registry.md) — detector 与扩展名定义
- [go_types](./go-types.md) — PackMeta / FormatRange
- [wails_bridge](./wails-bridge.md) — 资源包 binding
