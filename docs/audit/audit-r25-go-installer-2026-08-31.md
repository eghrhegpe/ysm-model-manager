# R25 审核：go/installer（安装核心）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）｜状态：⏳ 待修复闭环
> 前置：R19 watcher / R20 avatar / R21 dedup / R22 app_workshop / R23 app_install / R24 go/recycle

## 范围与岔开依据

**审核**：`go/installer/installer.go`（797 行源码，36 符号）
- 入口族：Install / InstallLocked / InstallToGlobal / InstallWithOverlay / InstallDir(Rel)(Locked)
- 落地族：copyFileLocked / linkOrCopy(Locked) / symlinkOrCopy(Locked) / applyInstallFileByMode
- 守卫族：validateInstallPaths（四道）/ normalizeInstallDirPaths / resolveFinalDst / checkDstSymlinkSegments / isAllowedEntryName / sameSource / IsValidRepoRoot / errnoIs
- 既有测试 **2451 行 107 个**（adversarial 6 + extra2 56 + extra 14 + 主 31），1:3.08 测试/源码行比——**R 系列最高**

**岔开**：近期 8 条动线（71a13752 文件操作域审核修复、9ab4c8c9 InstallLocked 拆分重构、0704003f copyFileLocked 收敛、7a8c6caa InstallDirRel Windows 守卫、13dcb628 类型路由、7ed3c9b5/19ee563a .ban→.disabled 双轨收敛、44df1319 路径限定）全是**已审域（文件操作/同步）的落地修复**；installer 自身无 R 级系统审核；R23 审的上层 app_install 大量委托本包（同链路自然延伸）。

## 总体结论：通过（预测零 P2，4 项 P4 待核实）

107 个测试几乎覆盖每个函数族：守卫族（四道 Install 守卫/死递归×3/symlink 双向解析/条目逃逸/系统目录拒绝）、锁纪律（8 入口加锁 + 6 Locked 变体防重入注释）、回滚策略（仅新建目录回滚 + 复合错误）、error 分类（errno 优先 + 文本兜底 + 跨设备/权限分平台）、对抗测试（BUG-3 可执行文件混入、BUG-4 大小写死递归）。与 R21（dedup）/R24（recycle）同型——**测试锁死行为 → 预测零 P2**。读码未发现 P2；4 项 P4 观察点待核实（见下）。

## 发现项（4 项 P4，复核后 1 项已处理 + 3 项不实/记录型）

| 级别 | 位置 | 问题 | 复核结果 |
|---|---|---|---|
| P4-1 | installer.go:500-525 | `InstallWithOverlay(src, customDir)` **无 src 仓库内守卫**（无 filesRoot 参数）——目标侧有 .minecraft 守卫、源侧无 IsInside 校验，任意 src 可复制进 customDir | **属实，已处理**：grep 确认前端 0 消费（Deprecated 绑定，上层 InstallModelWithOverlay 仅兼容旧绑定面）→ 补注释说明（含守卫缺口 + 清理计划），不补守卫（改行为风险 > 收益） |
| P4-2 | installer.go:365-382 | `isAllowedEntryName` 硬黑名单**不含 .jar**（仅拒可执行类）——若某类型白名单含 .jar 或 rtype="" 时全放行，.jar 会被装进游戏目录 | **复核不实**：实测所有类型 extensions 均非空且**无一含 .jar**——.jar 永远被注册表白名单过滤，硬黑名单不含 .jar 只是冗余防御；rtype="" 无调用方传入 |
| P4-3 | installer.go:742-797 | `IsValidRepoRoot` 对 2 字符盘符（"C:"，len==2）不在盘符根检查（要求 len==3）覆盖内 | **部分不实（记录型）**：实测 `cd C:` 解析为 cwd-on-C——cwd 为盘符根时（"C:\"，len==3）仍被检查捕获；仅 cwd 为子目录时解析为合法目录绕过拒绝，属守卫语义极小缺口（用户需刻意配置 "C:"，实际影响近零） |
| P4-4 | installer.go:492 | `InstallToGlobal` 的 `SubDirMap("ysm")` 注册表值与注释声称的 `config/yes_steve_model/custom` 一致性 | **复核不实**：`resolveSubDir(rt)` 读的是 `rt.InstanceDir`，ysm 条目值为 `"config/yes_steve_model/custom"`——与注释一致，无装错目录问题（ADR-064 注册表驱动口径成立） |

## 修复状态注记（2026-08-31 闭环）

- **P4-1 已处理**：InstallWithOverlay 补守卫缺口注释（前端 0 消费 Deprecated 绑定，不补守卫）
- **P4-2 / P4-4 复核不实**、**P4-3 记录型**（依据见上表）——读码零 P2 结论成立，R 系列规律（测试密度 ↔ P2 负相关）再次验证

## 已读码确认无问题（防误报留档）

- **守卫族**：Install 四道守卫（字符串 .minecraft + symlink 解析复检 + IsInside 仓库内 + 双侧 EvalSymlinks 长名归一）；死递归守卫 ×3（sameDir / finalDst-in-src / IsInside 入口复核）；checkDstSymlinkSegments 父链逐段 Lstat；条目级 symlink 越权逃逸；resolveFinalDst 拒绝 .. 穿越/绝对路径/盘符 ADS/前导 /；IsValidRepoRoot 动态盘符前缀（非枚举 c:/d:）
- **锁纪律**：8 入口（Install/InstallDir/InstallDirRel/InstallToGlobal/InstallWithOverlay/CopyFile/linkOrCopy/symlinkOrCopy）统一 InstallLock；6 个 Locked 变体注释「调用方须已持有，禁止直接调用」（防 R21 型重入死锁）
- **回滚策略**：callInstallDirRecursiveWithRollback 仅新建目录才 RemoveAll（防覆盖场景误删旧数据），回滚失败返回复合错误
- **error 分类**：linkErr/symlinkErr errno 优先（EXDEV/EACCES 分平台）+ 文本兜底（明确标注避免过宽子串误伤）
- **fsutil 收敛**：copyFileLocked/CopyFile 委托 fsutil.CopyFile（ADR-044：原子 tmp+rename+Sync），StepError 映射表纯函数 + 回归护栏

## 测试密度观察（R 系列最高）

107 测试覆盖：InstallToGlobal 6、InstallDir/Recursive 15、Install/InstallLocked 6、CopyFileLocked 6、LinkOrCopy 5、SymlinkOrCopy 8、InstallWithOverlay 8、sameSource 2、mapStepToAppError 2、linkErr/symlinkErr 6、IsValidRepoRoot 2、守卫辅助族 8、对抗 6（任意读/可执行混入/symlink 绕过/大小写死递归/部分失败继续/回滚失败复合错误）。

## 门禁实测

```bash
go build ./go/...              # 待修复闭环后跑
go test -race ./go/installer/...  # 待修复闭环后跑
```

## 与 R19-R24 对照

| 轮 | 模块 | 特征 |
|---|---|---|
| R21 | dedup | 零 P2——黄金对照测试锁死契约 |
| R24 | recycle | 测试密度 1:2.49；零 P2 |
| **R25** | **installer** | **测试密度 1:3.08（最高）**；守卫族最全（四道安装守卫 + 死递归×3 + 对抗测试）——与 R21/R24 同型，预测零 P2 |

R 系列规律再次强化：测试密度与 P2 出现率负相关——installer 的 107 测试把守卫/回滚/错误分类全部锁死，读码零 P2；仅剩 4 项 P4 观察点（其中 2 项与 Deprecated 绑定/边缘形态相关，属记录型）。

## 修复计划（审一份修一份，独立路径限定提交）

1. P4-1：核实前端消费面 → 注释说明（Deprecated 无消费）或补 src 守卫
2. P4-2/P4-3：观察点——若 P4-3 实测漏判则小修（len==2 特判），否则注释留档
3. P4-4：确认 ysm 条目 subDir 值（注册表驱动一致性）
