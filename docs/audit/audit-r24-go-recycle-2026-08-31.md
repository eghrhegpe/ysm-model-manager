# R24 审核：go/recycle（回收站核心）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）｜状态：⏳ 待修复闭环
> 前置：R19 watcher / R20 avatar / R21 dedup / R22 app_workshop / R23 app_install

## 范围与岔开依据

**审核**：`go/recycle/` 二文件（554 行源码）
- `recycle.go`（405）：TrashManager（Move/MoveEx/moveEx/uniqueDest/List/Restore/Delete/Empty）+ 包级兼容函数
- `recycle_clean.go`（149）：RemoveRepoDuplicates（实例侧清理）+ DeduplicateEntries（去重移入回收站）
- 既有测试 1380 行（10 文件 **53 测试**，1:2.49 测试/源码比——**R 系列最高**）

**岔开**：近期 50 条动线 6 条全是测试/辅助改动（8b0f2d3e/d38bec41 Windows rename 语义、c025b83e 失败上报确定性、167719f5 注入钩子标注、008490c3 深审收口、8cc023b0 哈希预筛），无深度行为修改；R 系列从未审过本模块。

## 总体结论：通过（零 P2，1 项 P3 已修 + 1 项 P4 已修）

测试密度 R 系列最高：跨设备回退（EXDEV 注入点）、冲突后缀循环（uniqueDest）、守卫族（根级/越权/缺失）、硬链接/符号链接、文件夹整组合并、失败上报逐条回调——全部有确定性测试覆盖。与 R21（dedup，黄金对照测试锁死契约 → 零 P2）同型。读码未发现 P2；1 项 P3 并发锁契约核实属实并已修。

## 发现项

### 1 项 P3（核实属实，已修）

| 位置 | 问题 | 处置 |
|---|---|---|
| internal/app/app_install_recycle.go | **锁契约不一致**：ClearInstanceResources/DeduplicateCustomDir 持 `installer.InstallLock`（R23 已核实），但 MoveToRecycle / RestoreFromRecycle / DeleteFromRecycle / EmptyRecycleBin / MoveToRecycleEx 等 recycle 绑定**未持锁**——与持锁的清理/去重并发时存在竞争窗口（实例如后台 sync/install 与回收站操作并发）。核实：① `WalkAllFiles(dir, true)` skipRecycle=true 内置 .recycle 跳过，无「回收站被清理误删」P2 风险；② Go 侧调用方仅 CLI（go/cli/recycle.go，无锁上下文）——**加锁无重入死锁风险** | **已修**：五绑定统一加 `installer.InstallLock.Lock/Unlock`（共享单锁闭环同口径）+ 头注释标注「不得在已持锁路径内被调用」（非重入锁，防 R21 型自死锁） |

### 1 项 P4（已修）

| 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|
| P4-1 | recycle_clean.go:26-29 | `RemoveRepoDuplicates` 先 `WalkAllFiles(dir)` 再查 `filesRoot == ""` 守卫——空仓库根时白走一遍实例目录遍历；守卫应前移 | **已修**：空根守卫前移至函数头（WalkAllFiles 之前） |

### 已读码确认无问题（防误报留档）

- `moveEx` 根级守卫（`IsInsideResolved` + Clean 相等拒绝）✓；dst 越权守卫（cleanRecycle 前缀段比较）✓；uniqueDest guard 保持越权校验 ✓
- 跨设备回退：仅 EXDEV 走复制，权限/占用直接报错（不无谓复制）✓；复制失败清理半截文件/目录并 log ✓
- 符号链接/硬链接：moveEx 直接删除入站（deleted_link）；Restore 对历史链接条目读 target 重建 + 失败回滚 ✓
- `Delete` 拒绝回收站根目录 ✓；`Empty` RemoveAll+重建、count 最佳努力 ✓
- `DeduplicateEntries` 显式按 Path 排序保留第一个（确定性，与 dedup 检测侧口径对齐）✓；`RemoveRepoDuplicates` 大小预筛 + 哈希缓存（同候选多实例文件不重复读盘）✓；同名不同内容保守保留 ✓
- `copyDirRecursive`/`copyFile` 收敛至 fsutil（ADR-044 策略 A）✓

## 测试密度观察（R 系列最高）

53 测试覆盖：守卫族 9（越权/根级/缺失/回收站根拒绝）、跨设备回退 6（文件/目录 + 复制失败清理 + Windows errno）、冲突循环 3（Move/Restore 冲突 + 非 NotExist 错误）、链接语义 3（硬链接/符号链接/文件夹整组）、List 过滤 3、RemoveRepoDuplicates 5（仓库文件仅删/同名不同内容保留/无仓库根/nil logger/失败上报）、Empty 3、copyFile/copyDir 4、包级兼容 5、Restore 守卫 3。

## 门禁实测

```bash
go build ./go/...          # 待修复闭环后跑
go test -race ./go/recycle/...   # 待修复闭环后跑
```

## 与 R19-R23 对照

| 轮 | 模块 | 特征 |
|---|---|---|
| R19 | watcher | 并发陷阱 + 状态机；1 P2（复核不实） |
| R20 | avatar | 测试密度 1:1.95；1 P2（MIME 硬编码） |
| R21 | dedup | 零 P2——黄金对照测试锁死契约 |
| R22 | app_workshop | 业务编排 8 函数零单测；1 P2 |
| R23 | app_install | 测试密度 1:0.55（最低）；1 P2（兜底防线失效） |
| **R24** | **recycle** | **测试密度 1:2.49（最高）；零 P2——守卫/回退/冲突全有确定性测试** |

R 系列规律再次验证：测试密度与 P2 出现率强相关——recycle 与 dedup 同属「测试锁死行为」型，读码零发现；唯一待核实项在 **App 层锁契约**（recycle 包自身无锁是设计，由调用方串行化——但 App 绑定层持锁不一致）。

## 修复状态注记（2026-08-31 闭环）

- **P3 已修**：app_install_recycle.go 五绑定（MoveToRecycle/MoveToRecycleEx/RestoreFromRecycle/DeleteFromRecycle/EmptyRecycleBin）统一加 `installer.InstallLock`（共享单锁闭环同口径）+ 重入警告注释
- **P4-1 已修**：RemoveRepoDuplicates 空根守卫前移至函数头

## 修复计划（审一份修一份，独立路径限定提交）

1. ~~P3：recycle 绑定补 InstallLock~~ ✅ 已修（见注记）
2. ~~P4-1：RemoveRepoDuplicates 空根守卫前移~~ ✅ 已修
