---
kind: go-container
name: 统一容器桥接层 go/container
tier: architecture
adr:
  - ADR-068
  - ADR-069
category: go
source_files:
  - go/container/container.go
  - go/container/encoding.go
auto_fields:
  symbols_with_lines:
    - Close
    - Entries
    - Entry
    - Incomplete
    - IsDir
    - Name
    - Open
    - Open7zBytes
    - Open7zPath
    - OpenDir
    - OpenZipBytes
    - OpenZipPath
    - Reader
    - UncompressedSize64
    - ZipMatchesEntries
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 容器解析、container_entries
  - zip 多模型、多 entry
quick_risk_lines:
  - 容器内多模型枚举必须走 go/container，前端禁止手写 zip 内文件枚举
pitfalls:
  - 手写 zip 内枚举 → 与 go/container 判定不一致、多 entry 漏检；必须经 go/container
  - 未处理 7z 格式 → 容器解析失败；必须经 go/container 的格式分流

use_when:
  - 容器
  - 解包
  - zip
  - 7z
  - ContainerReader
  - 归档
  - 压缩包
  - 目录容器
invariant_anchors:
  - go/container/container.go|OpenZipPath
status: active
---

# 统一容器桥接层 go/container

## 概览

`go/container/` 包是统一容器桥接层（ADR-068）：收敛 ysm/geometry/avatar/packs 各自独立的「打开容器→找条目」实现（调研实测 zip.OpenReader 10 处 / zip.NewReader 6 处 / sevenzip 5 处重复）。统一提供 `Entry`/`Reader` 抽象：zip/7z/目录都是「条目列表 + 按名读取」，调用方只写一次内容物解析，解包免费。

## 核心职责

- `container.go` — 容器抽象与打开入口：`Entry`（Name/IsDir/UncompressedSize64/Open）+ `Reader`（Entries/Close/**Incomplete**），zip/7z/目录三种实现，path/bytes 双入口分派；打开失败统一 `container:` 前缀包装

## 对外 API / 入口

- `Open(path) (Reader, error)` — 按扩展名分派：`.zip` → zip、`.7z` → sevenzip、目录 → dir 直读；其他扩展名拒绝
- `OpenZipPath(path)` / `OpenZipBytes(data, size)` — zip 容器的路径/内存双入口（内存版供 avatar/geometry 已持有 `[]byte` 的场景，避免多一次 syscall）
- `Open7zPath(path)` / `Open7zBytes(data, size)` — 7z 容器双入口（`bodgit/sevenzip` 只读库，无 Writer）
- `OpenDir(root)` — 目录容器（`filepath.WalkDir` 收集相对路径条目、正斜杠名），供已解压资源包/光影包分支迁移；根路径不存在直接报错（打开前预检）
- `ZipMatchesEntries(path, match func(string) bool) bool` — 打开 zip 枚举条目名、任一命中 `match` 即 true；非 zip 路径 / 打开失败（含**损坏 zip**）一律返回 false。消费方：`packs.IsTypeModelFile`（ADR-144 下沉）对 `zipentry` 检测器类型做 `.zip` 内含指纹校验（581c3ec8），使同步推送/拉取不再把纯打包物/坏包当模型搬运
- `Entry` 接口方法：`Name()`（正斜杠名）、`IsDir()`、`UncompressedSize64()`（zip/7z 原值；目录版取 FileInfo.Size **绝对值**，防负 Size 直转变天文数字）、`Open() (io.ReadCloser, error)`
- `Reader.Incomplete() bool` — 目录容器遍历遇错（子树权限不足等）时 true，zip/7z 恒 false：打开成功 ≠ 条目全量，遍历中途错误记入首个 `walkErr` 不中断枚举，调用方可选查询提示

## 与其他子系统关系

- **ADR-068 迁移范围**：`geometry/archive.go`（4 个顶层函数共用 `NewContainerReader*` + `collectArchiveFiles`，删除 ParseFrom7z/ParseFromZip 对称外壳 ~294 行）、`avatar/avatar_extract.go` 两处 → `OpenZipBytes` + `ReadFileFromContainer`、`ysm/summary.go`/`parse.go`/`texsize.go`/`ysm.go` 四处 `zip.OpenReader`/`sevenzip` → container 打开
- **保留前置阶段**（不并入）：YSM 加密二进制 → wasm 解密（解密产物 zip 再进 container）；litematic gzip-NBT 是单文件流（非多条目容器），`openGzRoot` 不迁移
- **边界**：本包只做「打开 + 条目枚举 + 条目读取」，不做大小限制（读取时由调用方用 `fsutil.ReadLimitedEntry` / `types.MaxReadLimit` 施加，与现状一致）
- `packs` 检测层走 `zipEntryMatch` 轻量 helper（ADR-067 S5），未重复打开——但 `ReadPackMeta`/`ReadShaderpackLang` 的内容读取可后续迁移（低优先遗留）

## 不变量

- 目录容器条目名统一正斜杠（`filepath.ToSlash`），与 zip/7z 条目名口径一致——调用方按名匹配无需区分来源
- `Close()` 对 bytes 版为 no-op（内存容器无句柄）；path 版必须 defer Close（zip/7z 的 `ReadCloser`）
- 7z 只读库无 Writer，测试仅覆盖坏数据路径（非 7z 魔数 → `sevenzip.NewReader` 报错，不得 panic 或静默返回空容器）
- 不支持格式必须显式报错（`Open` 对非 zip/7z/目录拒绝），不静默降级
- **`Open` 分派前剥离禁用后缀（`.disabled`/`.ban`，大小写不敏感，复用 `types.StripDisableSuffix`——ADR-144 解除 types 依赖本包的循环禁令后删包内内联 `stripDisableSuffix`）**：ToggleEnable 改名后的 `xxx.zip.disabled` 仍按真实容器类型打开（c08c62bc P3 回归——否则指纹核验对禁用容器失效、扫描归类错乱跨 tab 泄漏）；打开路径用原值（磁盘文件就叫 xxx.zip.disabled）。契约锁：`TestOpen_DisableSuffixDispatch`

## 相关

- [go_geometry](./go-geometry.md) / [go_ysm_parser](./go-ysm-parser.md) / [go_avatar](./go-avatar.md) — ADR-068 迁移消费方
- [go_types](./go-types.md) — MaxReadLimit / MaxImportSize 大小约束
- ADR-068（统一容器桥接层）；ADR-069（ysm 作为解密容器参与指纹匹配，消费本包文件树）
