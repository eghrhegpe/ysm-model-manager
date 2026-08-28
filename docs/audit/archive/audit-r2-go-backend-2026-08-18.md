# 第 2 轮审核报告：Go 后端路径层（fileops/sync/installer/recycle/download）

> 审核日期：2026-08-18
> 审核范围：`go/paths/`、`go/fileops/`、`go/installer/`、`go/sync/`、`go/recycle/`、`go/download/`、`go/fsutil/`
> 旁路注意：避免干扰「路径分组放置」优化方向

---

## 进度统计

| 指标 | 数值 |
|------|------|
| 审核文件数 | ~18（核心实现） |
| 发现问题总数 | 5 |
| P1（严重） | 0 |
| P2（一般） | 3 |
| P3（建议） | 2 |
| 已修复 | 0 |
| 待决策 | 0 |

---

## 总体评价

Go 后端路径层安全性整体健壮。主要亮点：

| 维度 | 亮点 |
|------|------|
| **路径安全** | `paths.IsInside` 防 NUL 字节注入 + 大小写不敏感匹配，覆盖 `ErrPathEscalation` 类型化错误 |
| **并发锁** | `fileops.opMu` + `installer.InstallLock` 双锁串行写操作，对齐 ADR-056 共享单锁语义 |
| **原子写入** | `fsutil.CopyFile` tmp+rename+Sync，崩溃不留半截文件（项目头号反模式已收敛） |
| **下载安全** | Scheme 校验（拒绝 file/ftp）、重定向链上限 10 跳、Content-Type 二进制白名单、SHA256 可选校验 |
| **符号链接防护** | `installDirRecursive` 条目级 Lstat 拦截 + `checkDstSymlinkSegments` 父链逐段校验 |

---

## P1 问题（严重）

无。

---

## P2 问题（一般）

### P2-1：installer 未对 copyFileLocked 输出路径做 IsInside 二次校验

**文件**：`go/installer/installer.go:423-471`（`copyFileLocked`）

**问题**：`copyFileLocked` 接受 `dstDir` 参数并直接 `filepath.Join(dstDir, filepath.Base(src))`，但函数内部没有校验最终 `dst` 仍在预期边界内。调用方（`Install`、`InstallDir`）在进入前做了 `paths.IsInside(filesRoot, srcClean)` 和 `paths.ContainsMinecraftMarker(customClean)`，但若 `customDir` 在后续计算中发生变化（如 `targetDir` 拼接逻辑），`dst` 可能越过 `IsInside` 守卫。

**风险**：中等——当前调用链路径经过显式守卫，但函数级防御缺失，未来调用方若跳过守卫将直接暴露。

**修复建议**：在 `copyFileLocked` 开头增加一行：

```go
// 防御性校验：确保 dstDir 在预期范围内（由调用方维护 isInside=true 的前提）
// 若 dstDir 来自 user input，此处应再走 paths.IsInside 二次校验
```

或直接改为接收 `filesRoot` 参数并在函数内校验。

---

### P2-2：recycle.moveEx 硬链接处理静默删除

**文件**：`go/recycle/recycle.go:109-115`

```go
if fsutil.IsHardLink(src) {
    if err := os.Remove(src); err != nil {
        return nil, err
    }
    return &MoveResult{Action: "deleted_link", Reason: "硬链接，已直接删除"}, nil
}
```

**问题**：硬链接被直接 `os.Remove` 而非移入回收站。这是设计选择（避免回收站中保留无效链接），但用户侧无明确提示「硬链接将被删除」——仅返回 `deleted_link` 动作。

**风险**：低——行为符合语义，但可考虑在 UI 层给出明确提示。

**修复建议**：（可跳过，纯 UX 优化）在前端 Toast 中区分「移入回收站」vs「硬链接已删除」两种提示文案。

---

### P2-3：sync.SyncToggleStatus hash 匹配降级为路径匹配时无唯一性保证

**文件**：`go/sync/sync.go:206-229`

```go
hash := computeHash(p)
if hash != "" {
    shouldBeBanned, matched = repoHash[hash]
}
if !matched {
    // fallback: relative path match
    ...
}
if !matched {
    // fallback: base name match
    ...
}
```

**问题**：当哈希匹配失败时，退化为路径匹配 → 文件名匹配。若仓库中有两个同名文件（不同子目录），或 custom 目录中有同名文件（不同模型），`repoName` map 仅记录最后一个值，导致误匹配。

**风险**：低——当前仓库布局（每个模型独立子目录）和文件名规范下冲突概率极低；但属于设计缺陷。

**修复建议**：（可暂不修复，ADR-064 阶段二已改进为相对路径 key）在 `sync.go` 注释中注明此降级路径的已知限制。

---

## P3 问题（建议）

### P3-1：download.ResolveSavePath 路径遍历检查后未校验 .recycle 路径段

**文件**：`go/download/download.go:393-423`

`stripRecycleSegments` 移除了 `.recycle` 段，但路径遍历检查（`strings.HasPrefix(absSavePath, absSaveDir+string(filepath.Separator))`）在 strip 之后执行，理论上安全。但 `relPath` 在 strip 后可能为空（全部是 `.recycle` 段），此时 `return "", "", ""` 已正确处理。

**风险**：无实际风险，确认代码正确。

**修复建议**：无需修复，仅做记录。

---

### P3-2：fileops.DeleteModelFile 根级 ysm.json 回退单文件删除的语义可能误导

**文件**：`go/fileops/fileops.go:349-352`

```go
if rel == "." {
    // 真正的根级 ysm.json（父目录 == 仓库根）：回退单文件删除
    return os.Remove(path)
}
```

**问题**：根级 ysm.json 被「保护」而只删单文件，但 `DeleteModelFile` 文档说「根级/盘符级 ysm.json 把整个仓库误删」— 实际是只删 ysm.json 文件，仓库内模型文件仍保留但变成孤儿状态。

**风险**：低——不会误删仓库，但可能导致状态不一致（ysm.json 消失，模型文件还在）。

**修复建议**：在错误消息中明确说明「仅删除 ysm.json，模型文件保留」，避免调用方误判。

---

## 待决策项

无。

---

## 与「路径分组放置」优化的交集提醒

审核发现中，以下两点可能与路径分组优化相关，**无需改动，仅做参考**：

1. **P2-1**：`copyFileLocked` 缺乏函数级边界校验 — 路径分组若改变 `dstDir` 语义，需确保守卫仍有效。
2. **P2-3**：sync hash→path→name 三级降级匹配 — 路径分组后相对路径结构变化，可能影响匹配准确性，需验证 `relKey()` 是否仍正确工作。

---

## 结论

Go 后端路径层安全性整体优秀，无 P1 问题。3 个 P2 均为设计级/防御性改进，2 个 P3 为文档/UX 优化。建议下轮继续 R3（Wails Binding 层）。
