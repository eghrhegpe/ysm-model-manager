---
kind: go-packs
name: 资源包 mcmeta go/packs
tier: architecture
category: go
source_files:
  - go/packs/mcmeta.go
  - go/packs/
auto_fields:
  symbols_with_lines:
    - ClassContainer
    - ClassifyExt
    - ClassifyResource
    - ClassOther
    - CountZipEntryMatches
    - DetectByEntries
    - DetectResourceType
    - ErrPackMetaNotFound
    - ErrPackMetaTooLarge
    - IsTypeModelFile
    - IsYsmFile
    - MatchYsmEntries
    - MatchZipArchive
    - ReadPackMeta
    - ReadShaderpackLang
    - ReadShaderpackLangParts
  quick_groups:
    - 模型扫描与仓库管理
  quick_intents:
    - 资源包 / 光影包、mcmeta、pack_format
    - 缩略图、类型检测
  quick_risk_lines:
    - 资源包元数据必须走 go/packs 的 mcmeta 解析，前端禁止手写 mcmeta.json 解析
  pitfalls:
    - 前端手写 mcmeta.json 解析 → 与 Go 解析字段不一致、漏检 pack_format；必须交 Go 解析
    - 未限制 LimitReader/maxLangSize → 大语言文件 OOM；必须用 LimitReader 截断
  use_when:
    - 资源包
    - 光影包
    - mcmeta
    - pack_format
    - 包封面缩略图
    - 类型检测
  perf:
    - io-bound
  invariant_anchors:
    - go/packs/mcmeta.go|LimitReader
    - go/packs/mcmeta.go|maxLangSize
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 资源包 / 光影包、mcmeta、pack_format
  - 缩略图、类型检测
quick_risk_lines:
  - 资源包元数据必须走 go/packs 的 mcmeta 解析，前端禁止手写 mcmeta.json 解析
pitfalls:
  - 前端手写 mcmeta.json 解析 → 与 Go 解析字段不一致、漏检 pack_format；必须交 Go 解析
  - 未限制 LimitReader/maxLangSize → 大语言文件 OOM；必须用 LimitReader 截断

use_when:
  - 资源包
  - 光影包
  - mcmeta
  - pack_format
  - 包封面缩略图
  - 类型检测
perf:
  - io-bound
invariant_anchors:
  - go/packs/mcmeta.go|LimitReader
  - go/packs/mcmeta.go|maxLangSize
status: active
---

# 资源包 mcmeta go/packs

## 概览

`go/packs/` 包解析 Minecraft 资源包/光影包的 `pack.mcmeta`（目录或 ZIP 两种形态），提取 pack_format 版本信息与 pack.png 缩略图，并承担「一个文件到底属于哪种资源类型」的内容级检测（YSM / 资源包 / 光影包共用 .zip 扩展名，必须看内容）。

## 核心职责

- `mcmeta.go` — pack.mcmeta 读取与 BOM 清理、pack.png base64 缩略图、按注册表 Detector 做内容检测、光影包 lang 显示名提取

## 对外 API / 入口

- `ReadPackMeta(path string) (*types.PackMeta, string, error)` — 从目录或 .zip 读取 pack.mcmeta，返回解析结果 + pack.png 的 data URI 缩略图；自动去 UTF-8 BOM；找不到 mcmeta 报错
- `DetectResourceType(path string, registry *types.ResourceTypeRegistry) string` — 按扩展名筛候选类型后，用注册表 `detector` 字段做内容判定：`"ysm"`（zip 内含 ysm.json 或 models/）、`"mcmeta"`（zip 内含 pack.mcmeta）、`"shader"`（zip 内含 shaders/）、**`"zipentry"`（ADR-067：裸文件按扩展名直判；`.zip` 容器按 `rt.ZipEntries` 内容指纹匹配 `matchZipArchive`）**，其余按扩展名直接命中
- `ReadShaderpackLang(path string) string` — 从光影包（目录或 zip）读 `lang/en_us.lang`，返回 `{name, entries}` JSON 字符串，name 供前端展示（空时前端用文件名兜底）；**lang 文件设 1MB 上限**（P3 修复：dir 分支 stat 预检 + zip 分支 limit+1 截断探测，超限置空返回空 name——原 `os.ReadFile`/`io.ReadAll` 全量读入，畸形/超大 lang 可拖垮内存）；**统一小写比较**（CodeReview 第六轮：原 `low == "lang/en_US.lang"` 永远不成立，因 `low` 已 `ToLower`，不可能含大写 US）

## 与其他子系统关系

- 被 `internal/app/resource_bindings.go` 调用（ReadPackMeta / ReadShaderpackLang / DetectResourceType binding）
- 依赖 `go/types`（PackMeta、ResourceTypeRegistry）
- detector/扩展名定义来自 [resource_registry](./resource-registry.md)，本包不自行维护类型清单
- **检测层容器打开统一走 `zipEntryMatch` 轻量 helper（ADR-067 S5）**：matchZipArchive/isYsmFile/hasMcmeta/hasShaders 四处独立 `zip.OpenReader` 模板收敛为「打开→谓词匹配」单点；`importer.DetectZipType` 走魔数路径（不真打开容器），遍历全注册表 `MatchZipEntry`——S1 给 4 类补 zipEntries 后自动命中，未命中默认 `"ysm"`

## 不变量

- ZIP 内 pack.png 读取上限 10MB（`io.LimitReader` + limit+1 截断探测，超限置空跳过，防损坏缩略图被展示）；目录形态 pack.png 同样 stat 预检 10MB 上限
- `.7z` 无法用 `zip.OpenReader` 打开：YSM 检测直接按扩展名放行，mcmeta/shader 检测返回 false；**zipentry 对 `.7z` 内容检测同样失效**（ADR-067 §3 已知遗留，`.7z` 包裹的 mmd/vrc 靠 ysm 扩展名兜底判 ysm）
- **zip 化资源识别（ADR-067）**：`.zip` 可包裹任意类型（mmd/vrc/蓝图/投影的 `extensions` 已含 `.zip`），检测依赖 `zipEntries` 内容指纹而非扩展名——`detector:"zipentry"` 的类型必须声明 `zipEntries` 且 extensions 含 `.zip/.7z`（契约测试 `test_resource_schema.mjs` 强制），否则容器分支永不执行
- **冲突优先级 = 注册表顺序**（ADR-067 S3）：一个 `.zip` 同时满足多个 zipEntries 时，`DetectResourceType` 按注册表顺序首命中胜出（ysm 的 `ysm.json`/`models/` 根标记天然排前，比 `.pmx` 更具体）
- `supported_formats` 兼容三种 JSON 形态（int / [min,max] 数组 / {min_inclusive,max_inclusive} 对象），由 `types.FormatRange` 承接
- **`.json` 扩展名的 YSM 恒不被 DetectResourceType 识别**（P3 观察：注册表 ysm 声明 `.json` 扩展名，但 `isYsmFile` 对非 `.ysm/.zip/.7z` 恒返回 false——前端以 `""` 兜底走 model detail，功能可用但类型标签错误；二选一修复方向：isYsmFile 加 `.json` 内容判定或从注册表移除 `.json`）

## 相关

- [resource_registry](./resource-registry.md) — detector 与扩展名定义
- [go_types](./go-types.md) — PackMeta / FormatRange
- [wails_bridge](./wails-bridge.md) — 资源包 binding
- **资源包模型读取绑定（`internal/app/resourcepack_models.go`，非 go/packs）**：`ListPackModels`（枚举 block/item 模型路径）/ `ReadPackEntry`（单条目 base64）/ `ListPackModelsDetail`（ADR-131 P3：`models[{path,cubes}] + total`，cubes 数 JSON `elements`，封顶 `packModelDetailCap=200`）——容器枚举统一走 `container.Reader`（ADR-068），网页版镜像见 [backend_web](./backend_web.md)。**实现要点（2026-08-29 审核修复）**：`ListPackModelsDetail` 单次遍历建 `name→entry` map，cubes 解析 O(1) 直取句柄（旧实现每条模型全量重扫 Entries = O(models×entries)）；失败路径返回 `models:[]`（非 `null`，与 docstring 及 web 镜像同构）。
