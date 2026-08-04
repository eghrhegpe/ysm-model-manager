# ADR-028：安装器链接模式原子替换与 relink 回滚保护

- **状态**：✅ 已采纳
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/installer/installer.go, internal/app/app_install.go`

---

## 1. 背景（Context）

安装器（`go/installer` + `internal/app/app_install.go`）的链接落地与 relink 流程存在三个缺陷：

1. **目标已存在即静默跳过**：`linkOrCopy` / `symlinkOrCopy` 对已存在目标直接返回 nil，不校验内容与链接类型。后果：更新模型场景（下载新版本再安装）永远命中旧文件；relink 时若目标是 copy 模式遗留的独立副本，也不会真正建立链接——"假成功"。
2. **relinkDir 先删后建、失败即丢**：`relinkDir` 先 `os.Remove` / `os.RemoveAll` 删除 custom 中的旧文件，再执行 `Install` / `InstallDir`；一旦后者失败（跨分区硬链接、权限不足），目标文件/目录整体缺失，且 `continue` 静默吞错、无日志。
3. **InstallToGlobal 无扩展名校验**：与 `Install` / `InstallWithOverlay` 不一致，任意文件可经 `InstallModelFile` 写入全局 custom 目录。

> 关联：ADR-002 §3.1 点名 `app_install.go`（1,315 行）为最大 Binding 债务；本 ADR 记录其安装路径逻辑的加固决策，逻辑下沉计划不受影响。

## 2. 决策（Decision）

1. **链接落地升级为"确保有效"语义**：`linkOrCopy` / `symlinkOrCopy` 新增 `sameSource` 判定（`os.Lstat` + `os.Stat` + `os.SameFile`）——
   - 目标与源同文件（已是有效硬链接 / 指向源的符号链接）→ 幂等返回；
   - 目标不存在或不同源（旧副本/旧版本）→ 先创建临时链接（`dst + ".link-tmp"` / `".symlink-tmp"`）再 `os.Rename` **原子替换**，替换失败不破坏原文件；
   - 跨分区 / 权限错误经 `linkErr` / `symlinkErr` 分类为可操作提示（建议切换复制模式）。
2. **relinkDir 去"先删后建"**：
   - 文件级：直接调用 `installer.Install`（内部原子替换），失败写 `a.logger`，不再 `os.Remove` 后装；
   - 目录级（ysm.json / .pmx / .pmd）：`os.Rename` 备份旧目录 → `InstallDir` 重建 → 成功清理备份 / **失败回滚恢复原目录**并写日志。
3. **扩展名校验统一**：提取 `isSupportedModelExt`（含 `.ban` 变体处理），`Install` / `InstallWithOverlay` / `InstallToGlobal` 三入口对齐。

## 3. 后果（Consequences）

**正面**：

- 更新模型场景生效：新版本经原子替换落地，旧副本被替换为指向新源的链接；
- relink 任一步失败不丢数据：文件级旧文件保留，目录级备份回滚；
- 错误可见：relinkDir 全部失败路径写导入日志，不再静默吞错；
- 三个安装入口扩展名校验行为一致。

**负面 / 已知遗留**：

- 链接错误分类仍依赖英文错误字符串匹配（`cross-device` / `access`）；Go 系统错误文本为英文、当前可工作，但属脆弱文本匹配，后续宜改用底层 errno（如 `ERROR_NOT_SAME_DEVICE`）；
- `relinkDir` 属 App 层（`internal/app`），依赖 `ScanModelEntries` 等，暂无单测，仅靠 `go/installer` 包单测兜底；
- `internal/app` 尚有 5 个文件未 gofmt（app.go / app_config.go / app_scan.go / bundled_data.go / cli.go），与本次无关，待独立 chore 提交清理。

## 4. 数据溯源

- **来源**：安装器模块审核报告（2026-08-04）——P1 relink 先删后建无回滚 / P2 存在即跳过 / P2 InstallToGlobal 无校验；
- **决策落地**：commit `5c83738`（`fix(installer): 链接模式原子替换与 relink 回滚保护`）；
- **验证**：`go build ./go/... ./internal/app/...` 通过；`go test ./go/installer/` 16/16 PASS（新增 7 个用例：硬链接 SameFile 断言 / symlink / 旧副本原子替换 / 幂等重装 / InstallDir 硬链接与类型过滤 / InstallToGlobal 拒绝非模型扩展名）。

<!-- 文件名: installer-atomic-link-relink.md → 实际文件 ADR-028-installer-atomic-link-relink.md -->
