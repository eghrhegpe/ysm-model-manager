# R33 审核：go/fileops（最后一包）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 1 explore 子代理｜状态：⏳ 修复闭环中
> 前置：R26→R32 全链闭环。R26 recycle 已覆盖跨设备移动/路径穿越部分场景，本轮审 fileops 核心。

## 范围与岔开依据

**审核**（single 深度，只读）：

| 非测试文件 | 规模 | 职责 |
|---|---|---|
| `fileops.go` | 446 行 | 文件操作主逻辑（复制/移动/删除/重命名） |
| `fileops_preview.go` | 196 行 | 预览图查找 |
| `folder_import.go` | 156 行 | 文件夹导入 |
| `fileops_enable.go` | 152 行 | 模型启用/禁用（.ban/.disabled 后缀） |

**岔开**：R32 完结 avatar+rustbridge。fileops 是文件操作核心，installer/recycle/sync 均依赖。R26 recycle 已部分覆盖，本轮收口。

## 总体结论：通过（0 项 P2 + 4 项 P3 + 3 项 P4）

代码防御纵深扎实——双层 root 守卫（`paths.HasTraversal` + `filepath.Rel`）、symlink 逐段 Lstat（`checkNoSymlinkInPath`）、限流读（`ReadLimitedEntry`）、原子写（`WriteFileAtomic`）、opMu 串行化防 TOCTOU。注释与代码同步度高。P2 已闭合，无新增缺口。

## 发现项汇总

| 级别 | 数量 | deep 复审 |
|---|---|---|
| P2 | 0 | 否 |
| P3 | 4 | 是（#1 半启用态 + #3 symlink 移动不对称为有实质影响项） |
| P4 | 3 | 否 |
| **合计** | **7** | — |

## P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | fileops_enable.go:79-90 | 目录级启用两步 Rename 非原子：先 `Rename(path, fileNew)` 还原文件名，再 `Rename(bannedParent, dirNew)` 还原父目录名；第二步失败时文件名已去后缀但父目录仍禁用，产生「半启用」不一致态。 | 先 Rename 父目录、再（如需）Rename 文件，使父目录还原成为单步决定性操作；或在第二步失败时回滚第一步。 |
| P3-2 | fileops.go:240-249 + 260-267 | `MoveModelFile` 在 `prepareModelDest` 中 `MkdirAll(dstDir)` 创建空目标目录后，若 `renameForMove` 因非 EXDEV 原因失败（源不存在、权限不足等），`dstDir` 空目录残留且无清理；EXDEV 回退中 `copyDirRecursive`/`copyFile` 失败同样不回滚 `prepareModelDest` 已建的 `dstDir`。 | Rename 失败路径补 `os.RemoveAll(dstDir)`（仅在本次新建时），或把 `MkdirAll` 推迟到确认源可 Rename 之后。 |
| P3-3 | fileops.go:249 + 436 | `MoveModelFile` 非 EXDEV 路径直接 `renameForMove(src, dst)`（= `os.Rename`），不检查 src 是否为 symlink；若仓库内混入 symlink 文件，Rename 仅移动链接本身、目标仍指仓库外，仓库内出现逃逸 symlink。`copyFile` 有 Lstat 拒 symlink 守卫，但仅 EXDEV 回退路径会走到。 | `MoveModelFile` 在 Rename 前对 src 补 Lstat symlink 检查（与 `copyFile` 对齐），或显式声明 Move 不处理 symlink 并在入口拒绝。 |
| P3-4 | fileops_preview.go:24-46 + 50-119 | `FindPreviewImage` / `ExtractPreviewTexture` 无 root 归属校验，接受任意路径读取（edge_test 已文档化为 INFO-READ 取舍）。单用户只读预览，风险可控但与写操作的 root 守卫不对称。 | 如需收口，由薄壳在调用前做 `paths.IsInside` 校验；包内可不改（设计取舍）。 |

## P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | fileops_enable.go:403 | 错误文案「拒绝删除仓库外路径」出现在 Toggle 上下文（copy-paste 自 `DeleteModelFile`），语义误导但不影响行为。 | 改为「拒绝操作仓库外路径」。 |
| P4-2 | fileops.go:176-276 | `MoveModelFile`（101 行）— lift 判定、root 守卫、symlink 检查、自嵌套、防覆盖、EXDEV 回退六层逻辑堆叠在同一函数，且 lift 前的 root 守卫用的是提升前 src（文件级），提升后未对新 src（目录级）复检 `relSrc==`.` 边界（当前靠 `CopyModelFile` 口径间接覆盖，但 Move 路径无独立测试锁死该边界）。 | 将 lift 提取为独立小函数返回 `(effectiveSrc, isLifted)`，并在提升后补一次 `relSrc` 校验，降低单函数认知负荷。 |
| P4-3 | fileops.go:83-93 | `opPrologue` 设计良好，但 `MoveModelFile`/`CopyModelFile` 拿到 unlock 后在长达 ~100 行的分支里持有 `opMu`，长写操作（跨设备目录复制数百 MB）期间阻塞所有其他写操作。单用户 GUI 可接受；如后续引入并发导入需评估。 | 无需立即改。如需优化，将长 IO 操作移出 `opMu` 临界区，仅保护元数据操作。 |

## 修复状态注记（2026-08-31 闭环进行中）

| 级别 | 位置 | 状态 |
|---|---|---|
| P3-1 (目录级启用半启用态) | fileops_enable.go:79-90 | ⏳ 待修 |
| P3-2 (MoveModelFile 空目录残留) | fileops.go:240-249 + 260-267 | ⏳ 待修 |
| P3-3 (MoveModelFile symlink 不对称) | fileops.go:249 + 436 | ⏳ 待修 |
| P3-4 (FindPreviewImage 无 root 校验) | fileops_preview.go:24-46 + 50-119 | ⏳ 设计取舍，不修 |
| P4-1~P4-3 | 多处 | ⏳ 待修 |
