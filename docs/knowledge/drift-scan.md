---
kind: drift-scan
name: drift-scan（双轨漂移检测）
tier: architecture
category: go
source_files:
  - scripts/drift-scan.ts
use_when:
  - 漂移检测
  - 双轨
  - 重复实现
  - 口径漂移
  - 常量硬编码
  - 错误链断裂
  - 资源泄漏
  - 定时器泄漏
quick_intents:
  - 运行漂移扫描 / 检查口径一致性
  - 查找重复实现（formatSize、copyDir 等）
  - 修复硬编码常量（权限、读取上限、超时）
  - 修复错误链断裂（%v → %w）
  - 排查文件描述符泄漏
  - 排查定时器泄漏
pitfalls:
  - 新增常量/函数后忘记注册 drift-scan 规则 → 漂移漏检；改单一事实源后须同步更新正则或 add 新规则
  - 正则只匹配一种写法（如旧 `INLINE_BAN_STRIP` 只认 `[:len(name)-4]`）→ 变体写法（`[:len(path)-len(".ban")]`）漏扫；写规则时穷举常见变体
  - `FE_HARDCODED_FORMAT` 与 `DUPLICATE_FORMAT_SIZE` 语义重叠 → 前端 vs Go 各扫一轨，合并前需确认跨轨一致性
  - `TIMER_LEAK` filter 排除了 `r/resolve/reject/next/t` 等短变量名 → 若代码中这些名字用作 timer 会变假阴性；命名尽量避开豁免词
  - 脚本无 CI 挂载（情报型）→ 漏检不阻断提交；重要修复应在 commit 后主动跑一次确认归零
status: archived
affected: false
---

# drift-scan（双轨漂移检测）

> 自动检测项目中的核心逻辑多处实现、口径漂移问题。

## 位置

- 脚本：`scripts/drift-scan.ts`
- 扫描范围：`go/` 和 `frontend/src/`

## 背景

项目早期缺乏 ADR 强制约束"核心逻辑只存在一处"。当 GUI 和 CLI 并行开发时，各自实现导致口径漂移。典型案例：

| 问题 | 症状 | 修复 |
|------|------|------|
| `formatSize` 多处实现 | `cli/shared.go`、`repoaudit/repoaudit.go`、`health.ts` 各自实现 | 收敛到 `fsutil.FormatSize` + 前端委托 `formatBytes` |
| `.ban` 后缀剥离 | 8+ 处 `[:len(name)-4]` 硬编码 | 收敛到 `types.StripBanSuffix` |
| 非法字符检测 | 4 处 `strings.ContainsAny(..., `\/:*?"<>|`)` | 收敛到 `fsutil.ContainsIllegalNameChar` |
| 权限常量硬编码 | 多处 `0755`/`0644` | 统一用 `fsutil.DirPerms`/`fsutil.FilePerms` |
| 读取上限硬编码 | 多处 `50 << 20` | 统一用 `types.MaxReadLimit` |

## 使用方法

```bash
# 人类可读输出
node scripts/drift-scan.ts

# JSON 输出（供 CI 集成）
node scripts/drift-scan.ts --json
```

## 检测规则

| ID | 严重度 | 检测内容 | 修复建议 |
|----|--------|---------|---------|
| `INLINE_BAN_STRIP` | error | `[:len(name)-4]` 内联 .ban 剥离 | 用 `types.StripBanSuffix` |
| `HARDCODED_PERMS_DIR` | warn | `os.MkdirAll(..., 0755)` | 用 `fsutil.DirPerms` |
| `HARDCODED_PERMS_FILE` | warn | `os.WriteFile(..., 0644)` | 用 `fsutil.FilePerms` |
| `HARDCODED_READ_LIMIT` | warn | `50 << 20` 硬编码 | 用 `types.MaxReadLimit` |
| `INLINE_ILLEGAL_CHARS` | warn | `strings.ContainsAny(..., `\/:*?"<>|`)` | 用 `fsutil.ContainsIllegalNameChar` |
| `DUPLICATE_FORMAT_SIZE` | warn | `func formatSize(` 独立实现 | 用 `fsutil.FormatSize` |
| `FE_HARDCODED_FORMAT` | warn | 前端独立 `formatSize` 实现 | 委托 `formatBytes` |
| `INLINE_PATH_NORM` | info | `strings.ReplaceAll(..., "\\", "/")` | 考虑 `filepath.ToSlash` |
| `COPY_DIR_REIMPL` | info | `copyDirRecursive` 独立实现 | 评估是否可用 `fsutil.CopyDirRecursive` |

## 单一事实来源清单

| 领域 | 单一事实来源 | 消费方 |
|------|-------------|--------|
| 文件大小格式化 | `fsutil.FormatSize` | cli、repoaudit |
| .ban 后缀剥离 | `types.StripBanSuffix` | sync、scanner、ysm、installer |
| 非法字符检测 | `fsutil.ContainsIllegalNameChar` | fileops、folder_import |
| 目录权限 | `fsutil.DirPerms` | 全项目 |
| 文件权限 | `fsutil.FilePerms` | 全项目 |
| 读取上限 | `types.MaxReadLimit` | geometry、ysm、fileops、avatar |
| 资源名归一化 | `types.NormalizeResourceName` | sync、instance |
| 原子复制 | `fsutil.CopyFile` / `fsutil.CopyDirRecursive` | fileops、sync、recycle、importer、installer.CopyFile |
| 仓库审计 | `repoaudit.Audit` / `repoaudit.HealthReportFor` | cli、internal/app |
| 资源分类 | `repoaudit.Classify` | cli/resource.go |

## 历史修复记录

### 第一轮（2026-08-21）

- `formatSize` 收敛：`fsutil.FormatSize` 单一事实来源
- 权限常量统一：`fsutil.DirPerms` / `fsutil.FilePerms`
- `matchZipEntry` 重命名为 `matchAvatarZipEntry`（区分 `types.MatchZipEntry`）

### 第二轮（2026-08-21）

- `.ban` 后缀剥离收敛：`types.StripBanSuffix`
- 非法字符检测提取：`fsutil.ContainsIllegalNameChar`
- avatar 读取上限改用 `types.MaxReadLimit`

### 第三轮（2026-08-21）

- 补充遗漏的权限常量（download、fsutil/copy、tags）
- 补充遗漏的读取上限（avatar_extract）
- 新增 `drift-scan.mjs` 自动检测脚本

### 第四轮（2026-08-25）

- `copyDirRecursive` 收敛：`fsutil.CopyDirRecursive` 新增 `AtomicRename` 选项（tmpDir → rename 原子替换 + 祖先守卫），`importer` 的私有重实现改为委托，消除 `COPY_DIR_REIMPL`
- `copyDir` 同步收敛：`DirectoryCopyImporter` 的 `copyDir` 同改为委托 `fsutil.CopyDirRecursive`，移除 ~80 行重复实现

### 第五轮（2026-08-25）

- 修复 `drift-scan.mjs` 的 `INLINE_BAN_STRIP` 正则盲区：原只匹配 `[:len(name)-4]`，漏了 `[:len(path)-len(".ban")]` 写法
- 收敛 4 处内联 `.ban` 剥离：`fileops_enable.go` ×3、`fileops_preview.go` ×1，改用 `types.StripBanSuffix`

## 最终状态

```
🔍 drift-scan.mjs 扫描结果：
   严重: 0 ✅
   警告: 0 ✅
   提示: 0 ✅
```

## 相关 ADR

- ADR-051：单一事实来源原则
- ADR-064：同步口径收敛
- ADR-044：基础设施工具收敛

## 参考

- [cli_quality_audit](./cli_quality_audit.md) — CLI 质量审计（含双轨问题规律）
- [go-types](./go-types.md) — 类型包（含 ErrorCode 枚举、注册表）
- [go-fsutil](./go-fsutil.md) — 文件系统工具包
