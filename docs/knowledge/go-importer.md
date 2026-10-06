---
kind: go-importer
name: 导入策略 go/importer
tier: architecture
category: go
source_files:
  - go/importer/
auto_fields:
  symbols_with_lines:
    - DetectContainerType
    - DetectContainerTypeFromBase64Tail
    - DirectoryCopyImporter
    - DirectoryCopyImporter.Import
    - DirectoryCopyImporter.Type
    - Get
    - Handler
    - ImportFromBase64
    - ImportLogger
    - ImportOptions
    - NewDirectoryCopy
    - NewSimpleCopy
    - Register
    - SimpleCopyImporter
    - SimpleCopyImporter.Import
    - SimpleCopyImporter.Type
    - WriteFileAtomic
quick_groups:
  - 文件操作与标签
quick_intents:
  - 导入、导入策略、导入队列
  - importer、DetectContainerType
  - fsutil.WriteFileAtomic
quick_risk_lines:
  - 导入必须走 go/importer，落地用 fsutil.WriteFileAtomic 原子替换，禁止直写目标文件
pitfalls:
  - 直写目标文件 → 中断留下半文件；必须经 WriteFileAtomic 的 tmp+rename
  - 未走 DetectContainerType → 误判 zip 类型、解压错误；必须先 DetectContainerType 分流

use_when:
  - 导入
  - 策略
  - 导入队列
  - importer
perf:
  - io-bound
invariant_anchors:
  - go/importer/importer_file.go|fsutil.WriteFileAtomic
  - go/importer/importer_file.go|DetectContainerType
status: active
---

# 导入策略 go/importer

## 概览

`go/importer/` 包分两块：`importer.go` 的**按资源类型注册的复制策略表**（`Handler` 接口，供本地路径导入/安装复用），以及 `importer_file.go` 的 **base64 单文件导入核心** `ImportFromBase64`（ADR-003 从 `app_install.go` 下沉，薄壳仅注入 `rootFn` 与 `logger`）。

## 核心职责

- 策略注册表：按 rtype 取复制策略（`Register` / `Get`）
- base64 单文件导入：解码 → 扩展名/路径/大小校验 → 内容类型检测 → 魔数校验 → 写盘
- ZIP 内容类型识别（`DetectContainerType`）
- 目录/文件复制（临时目录 + rename 原子落地，符号链接复制链接本身）

## ImportFromBase64 校验链（顺序即拒绝优先级）

| 检查 | 失败返回 `types.AppError.Code` |
|------|------|
| 扩展名在 `types.IsSupportedExt` 白名单 | `FILE_TYPE_UNSUPPORTED` |
| `.json` 仅放行 `ysm.json`（ADR-038 D2，与 scanner 对齐） | `FILE_TYPE_UNSUPPORTED` |
| 文件名不含 `..` 与 `\` `/` | `FILENAME_INVALID` |
| base64 可解码 | `DECODE_FAILED` |
| 体积 ≤ 500MB、非空 | `FILE_TOO_LARGE` / `FILE_EMPTY` |
| 目标目录可创建 | `MKDIR_FAILED` |
| 非覆盖模式下目标不存在 | `FILE_EXISTS` |

类型路由：`.zip` 走 `DetectContainerType(data)` 按 ZIP local file header 里的文件名判定（`pack.mcmeta`→resourcepack、`shaders/`→shaderpack、`ysm.json`/`models/`→ysm，默认 ysm）；其余扩展名回退 `types.ExtBelongsTo`。魔数不匹配（ZIP `PK\x03\x04` / 7z `7z¼¯`）**只记 warn 日志仍照常导入**，不阻断。`DetectContainerType` 收集条目名后委托 `packs.DetectByEntries`（ADR-144 下沉，原 `types.DetectByEntries`）。

## 对外 API / 入口

- `Register` / `Get` — 导入策略注册表（`Handler` 接口：`Type() string`、`Import(srcPath, dstDir) error`，nil=成功；2026-09-05 锐评 P0 刀从 string 改 error，打通 ADR-051 结构化链路，调用方可 errors.Is/As 分类）
- `TestAllRegistryTypesHaveHandler` — 契约测试：遍历 resource_types.json 全量 id，断言每种非豁免类型都有 importer.Get(id) != nil（fbx 断链教训的通用化防御）
- `TestHandlerKindMatchesIsDir` — 契约测试：DirectoryCopy↔isDir=true / SimpleCopy↔isDir=false 一致性校验
- `NewSimpleCopy` — 单文件/目录复制策略（`SimpleCopyImporter`）
- `NewDirectoryCopy` — 以文件夹为单位的复制策略（`DirectoryCopyImporter`：EntityPlayer 等目录型类型）
- `ImportFromBase64(fileName, base64Data, ImportOptions{SkipCheck, Overwrite}, rootFn, logger) (destPath, rtype string, err error)` — base64 导入核心（**2026-08-29 返回值扩展**：回传落盘绝对路径与判定类型，「先入仓库再推送」组合链路依赖两者定位产物，类型判定单一事实源仍在本函数）
- `DetectContainerType(data []byte) string` — ZIP 内容类型检测
- `init()` 注册：resourcepack / shaderpack / blueprint / EntityPlayer / SceneModel / CustomAnim / CustomMorph / StageAnim / mmd-shader / DefaultAnim / DefaultMorph / maid-model / ysm / litematic / fbx（fbx 2026-09-05 锐评 P0 刀补注册，原缺 fbx 导致 ImportByType("fbx",...) 必报「未找到导入策略」）

## 与其他子系统关系

- `internal/app/app_install.go`：薄壳转发 `ImportFromBase64`（注入 `a.GetRepoRoot` 与 `App.logger.Add`）与 `DetectContainerType`
- `internal/app/resource_bindings.go`：按 rtype `importer.Get(rtype)` 取策略执行本地路径导入
- `go/types/`：`IsSupportedExt` / `IsYsmEntryJSON` / `ExtBelongsTo` / `AppError`
- 前端调用方见 [import_queue](./import-queue.md)（`import-executor.directImport` → `ImportModelFile`）

## 不变量

- 非覆盖模式下目标已存在必须返回 `FILE_EXISTS`，由前端二次确认后再走覆盖分支
- **`io.Copy` 失败必须清理半截目标文件**（`SimpleCopyImporter` 复制失败时 `Close` + `os.Remove(dstPath)`），不得留下损坏文件误导用户；**base64 路径写盘同样原子化**（P2 修复：`ImportFromBase64` 原 `os.WriteFile` 直写目标，磁盘满/IO 中断留半截文件且非覆盖模式再次导入命中 FILE_EXISTS 死锁——现改临时文件 + `os.Rename` 原子落地，失败删临时文件）
- 复制目录时符号链接复制链接本身（`Readlink` + `Symlink`）而非跟随；`DirectoryCopyImporter.copyDir` 对 `Readlink`/`Symlink` 的错误显式返回，不静默吞掉
- 目录复制先写入 `MkdirTemp` 临时目录再 `os.Rename` 落地，保证原子性（失败 `defer RemoveAll` 清理）
- `sanitizePath` 是防御纵深：上层 `installer.Install` 已用 `paths.IsInside` 严校验，包被独立使用时仍拒绝 `..`
- base64 解码统一走 `fsutil.DecodeBase64Limited`（2026-08-30 审核修复：原「预检 + 解码 + 复检」三段手写在 `ImportFromBase64`，现收敛为 helper，`ErrB64TooLarge` 映射回 `FILE_TOO_LARGE` 文案；app 层 `importModelFileWithSubpath` 同口径）
- **尾部探针 `ok` 与 `id` 是两个正交维度（2026-10 数据级锁定）**：`DetectContainerTypeFromBase64Tail` 的 `ok=true` = 尾部探针**已给出确定答案**（`id` 可以是空串——确为 zip 但无匹配类型，不猜）；`ok=false` = 无法从尾部判定，调用方**必须**回退整包解码。四条降级判据（zip64 字段触顶 / 中央目录超出尾部窗口 / 中央目录解析不完整 / 解析条目数与 EOCD 声明不符）任何一条被误改成 `ok=true` 都会让 50~500MB 合法包的类型判定静默走偏。数据级护栏见 `detect_tail_data_lock_test.go`（手工拼 zip 尾部构造真实 `zip.Writer` 造不出的降级形态）；`decodeBase64TailWindow` 的「长度 < 8」先于「填充 > 2」判定（`A===` 走前者、`AAAAAAAAA===` 才走后者）
- **`DetectContainerTypeFromBase64Tail` 的 `ClassContainer/ClassOther` 分支是构造性死代码**：`packs.DetectByEntries` 只返回 `""` 或注册表里真实存在的 type ID，而 `container`/`other` 不是注册类型（`resource_types.json` 无此 id），故该分支永不进入；它保留作防御，覆盖率为构造性上限而非测试缺口
- **`.7z` 魔数告警分支只能由「扩展名 .7z + 内容实为 zip」触达**：坏 7z 在类型检测阶段即被拦（无特征 → 空 rtype → 报错），走不到魔数校验；故 `warnImportMagicMismatch` 里「类型判定看内容、魔数校验看扩展名」是刻意的双口径，改动前先读 `importer_file_magic_lock_test.go`
- **ImportFromBase64 拆解后的阶段顺序即拒绝优先级（2026-10，gocyclo 25 → ≤20）**：`validateImportFileName`（扩展名 → ysm.json 白名单 → 穿越 → 分隔符）→ `decodeImportPayload`（受限解码 → 非空）→ `resolveImportRtype`（内容检测 → 扩展名反查 → 报错）→ `warnImportMagicMismatch` → 落盘。守卫顺序与 `ImportFromBase64 校验链`一节的表逐行对应，重排即改错误优先级
- **R30 修复链（2026-08-31）**：
  - P2-1 `copyDirContents` symlink 路径穿越防护：`os.Readlink` 拿到 target 后直接 `os.Symlink`，绝对路径或含 `..` 的相对路径会指向仓库外。修复：解析 target 为绝对路径，判定是否在源目录树内，越界则拒绝。
  - code_review P1-2 symlink 基目录修正：相对 target 必须解析为相对于符号链接自身目录（`filepath.Dir(srcPath)`），而非 `src`（`copyDirContents` 的当前递归目录）——OS 也是这样解析的。`filepath.Abs` 错误必须传播（fail-closed），不能 `_` 吞掉（旧实现 fail-open）。
  - **迁移注记（2026-09-04）**：`copyDirContents` 已随锐评 #11 退役删除（死代码，生产路径本就只走 `fsutil.CopyDirRecursive`）；上述 symlink 穿越防护与基目录修正语义由 `fsutil.CopyDirRecursive` 承担（`RejectSymlink=false` 保真复制链接、越界拒绝、错误 fail-closed），覆盖测试已迁至 fsutil 包与 importer 生产路径用例。

## go-run 内嵌工具治理（2026-09-04，锐评 #12 处置）

- `scripts/compare-maid-packs.ts` 已退役删除：该脚本以 `go run` 内嵌执行 `_tools/{listzip,maidparse}.go` 做单女仆 vs 多合一包结构比对，但 `_tools/` 从未入库、脚本自始不可运行。其能力等价物已在库内——`go/container.OpenZipBytes`/`Open7zBytes`（容器条目遍历）+ `go/geometry.ParseFromZip`（archive.go，真实解析入口）。后续研究 maid 包结构请走 Go 单测或主程序 `--cli`，勿再以 `go run <散落 .go>` 形态内嵌脚本。

## 相关

- ADR-003（逻辑下沉）
- [import_queue](./import-queue.md) — 前端导入执行器与导入 tab
