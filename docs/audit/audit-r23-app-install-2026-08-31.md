# R23 审核：internal/app/app_install*.go（安装/回收站/实例链路）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）｜状态：⏳ 待修复闭环
> 前置：R19 watcher / R20 avatar / R21 dedup / R22 app_workshop

## 范围与岔开依据

**审核**：`internal/app/app_install*.go` 五文件（1070 行源码）
- `app_install.go`（10 行声明头）+ `app_install_import.go`（335）+ `app_install_instance.go`（653）+ `app_install_link.go`（40）+ `app_install_recycle.go`（261）
- 既有测试 586 行（5 文件 19 测试，1:0.55 测试/源码比——**R 系列迄今最低**，R20 avatar 为 1:1.95）

**岔开**：R 系列（R19-R22）从未覆盖安装链路；近期 50 条提交动线集中在 sync/扫描/Deprecated 标注（c0c15170 30s 缓存、008490c3 深审收口、4751cabc GetSyncScanDirs warning、81490dc8 标注、e5a0eb53 requireMcRoot 提取）——方向与「安装/回收站/实例核心逻辑」岔开。

## 总体结论：有条件通过

1 项 P2 真实缺陷（纵深防御失效）+ 3 项 P3 + 3 项 P4。测试密度 R 系列最低（19 测试覆盖 recycle 守卫/clearCustomDir/ImportAndPush 链路/GetSyncScanDirs 契约），但安装核心（link/recycle 主路径/instance 编排/importModelFileWithSubpath 守卫族）大面积零测试——**P2 正是落在零测试的防御分支上**，与 R19/R20 的「测试未覆盖的契约不一致」共性一致。

## 发现项

### 1 项 P2 必修

| 位置 | 问题 |
|---|---|
| app_install_import.go:321 | **pushRepoPathToInstance 兜底防线失效**：`types.IsYsmEntryJSON(repoPath)` 传的是全路径，而 `IsYsmEntryJSON(baseName)`（go/types/extensions.go:149）做 `EqualFold(TrimSpace(baseName), "ysm.json")` 全等比较 → 全路径恒 false → 根级 ysm.json 的兜底拦截**形同虚设**。同文件 L183（importModelFileWithSubpath）传的是 `filepath.Base(fileName)`，口径不一致。注释明言此防线防「未来其他调用方直推根级文件 → InstallDir(父目录)=仓库根 → 整仓落地灾难」——当前唯一调用方 ImportFileAndPushToInstance 的前置拦截（L249 传 fileName）仍有效，属**纵深防御失效**（第二道门坏了）。修复：改传 `filepath.Base(repoPath)`；补 pushRepoPathToInstance 防御分支测试 |

### 3 项 P3

| 级别 | 位置 | 问题 | 复核结果 |
|---|---|---|---|
| P3-1 | app_install_instance.go 多处 | `GetRepoRoot(rtype)` 错误全被 `_` 丢弃（CountInstanceResources:53 / ClearInstanceResources:111 / SyncResources:357 / GetResourceInstanceStatus:246 / GetSyncScanDirs:532 / importModelFileMMD:150 / importModelFileWithSubpath:174 / RelinkAllInstanceResources:332）——根配置异常时静默返回空目录，行为降级无日志 | **复核不实**：GetRepoRoot（resource_bindings.go:187-214）全部 return `(root, nil)`，**结构上永不返回错误**；空串才是「未配置」信号，各调用方均已 `if filesRoot == "" { continue }` 处理。无错误可吞 |
| P3-2 | app_install_instance.go:124-136 | `countMatchingInDir` 每个类型子目录**重建整个 filesRoot 的 repoFiles map**（N 类型 × 全仓库 WalkAllFiles）——15 类型时全仓库扫 15 遍；整合包页计数冷路径可能卡顿 | **复核不实**：`AllSubDirs` 每类型仅一条目，各类型 `filesRoot` 各不相同（ysm 根 vs mmd 根），本就每根一次遍历；仅重复配置同根时才有冗余，非「N 遍全仓库」 |
| P3-3 | app_install_recycle.go:39-50 | `MoveToRecycleEx` 与 `MoveToRecycle` 不对称：后者对 findRecycleRoot 失败有 ysmRoot 兜底（L21-22），前者直接返回 error（Deprecated 绑定，注释已说明，但行为口径不一致） | **已处理**：补注释说明不对称为有意保留（避免静默降级到错误根目录） |

### 3 项 P4

| 级别 | 位置 | 问题 | 复核结果 |
|---|---|---|---|
| P4-1 | app_install_instance.go:648 | `HasYSMMod` 用 `strings.Contains(low, "ysm")` 子串匹配过宽（如 mods 目录下 mysmoke.jar 误判为 YSM 模组）——低危，需注释说明或收紧 | **已处理**：补注释说明刻意为宽松匹配（覆盖官方 jar 变体），并标注收紧条件 |
| P4-2 | app_install_import.go:245-263 | `ImportFileAndPushToInstance` 的 ext 判断用 `TrimSpace(fileName)`，但拦截通过后传给 importModelFileWithOptions 的是**未 trim 的 fileName**——尾随空格文件名会落入仓库（destPath 含空格），与前端提示口径不一致 | **已修**：函数头 `fileName = strings.TrimSpace(fileName)`，ext 判断与落盘同口径 |
| P4-3 | app_install_recycle.go:163-178 | `ListRecycleBin` 去重 key 用 `e.Path`（绝对路径）——多根回收站含同名文件时不会去重（Path 带根前缀，seen 恒不命中）；语义与「去重」注释不符 | **复核不实**：seen 按 e.Path 去重正确——重复根配置（两类型根指向同一目录）时同名条目去重生效；跨根同名文件本就是不同文件，不去重才是对的 |

## 修复状态注记（2026-08-31 闭环）

- **P2 已修 + 测试**：`app_install_import.go:321` 改传 `filepath.Base(repoPath)`（与 L183 同口径）；新增 `TestPushRepoPathToInstance_RootLevelYsmJsonBackstop`（pack_test.go，断言 ErrInvalidPath）
- **P3-3 / P4-1 注释说明**、**P4-2 已修**（trim 统一）
- **P3-1 / P3-2 / P4-3 复核不实**（依据见上表）

## 测试密度观察（R 系列最低）

覆盖面：recycle 守卫（根拒绝/custom roots）、ClearCustomDir 语义、Import*AndPush 链路（copy 模式/未知实例/无 mcRoot/文件已存在/裸 ysm.json/根级模型拒绝/缓存失效）、GetSyncScanDirs 结构化告警契约、导入成功缓存失效。

**零测试**：link.go 全部（SetLinkMode/getLinkMode）、recycle 主路径（MoveToRecycle 成功/恢复/删除/清空）、instance 核心编排（Count/Clear/DeduplicateCustomDir/GetInstanceStatus/GetResourceInstanceStatus/RelinkAll/SyncResources/Push/Pull/SyncModelToggleStatus）、importModelFileWithSubpath 守卫族（traversal/json 白名单/空数据/分隔符/MkdirAll）、importModelFileMMD、HasYSMMod、GetInstanceSyncStatus、SyncCustomToRepo、**pushRepoPathToInstance 兜底防线（P2 所在）**。

## 门禁实测

```bash
go build ./go/...          # 待修复闭环后跑
go test -race ./internal/app/   # 待修复闭环后跑
```

## 与 R19-R22 对照

| 轮 | 模块 | 特征 |
|---|---|---|
| R19 | watcher | 并发陷阱 + 状态机；1 P2（syncPending 未清零→复核不实） |
| R20 | avatar | 测试密度最高（1:1.95）；1 P2（缓存 MIME 硬编码） |
| R21 | dedup | 零 P2——黄金对照测试锁死契约 |
| R22 | app_workshop | 业务编排 8 函数零单测（230 行测试 100% 覆盖基础设施）；1 P2 |
| **R23** | **app_install** | **测试密度 R 系列最低（1:0.55）；1 P2 纵深防御失效（守卫分支零测试）** |

三轮共性延续：P2 均落在「测试未覆盖的契约/防御分支」——R23 的 P2（兜底防线全路径比较失效）与 R20 的 P2（MIME 硬编码绕开嗅探）同属「注释声明了防御、代码实际失效」型。测试密度与 P2 出现率强相关：R21 用对照测试锁死契约 → 零 P2；R23 防御分支裸奔 → 藏 P2。

## 修复计划（审一份修一份，独立路径限定提交）

1. P2：pushRepoPathToInstance L321 改传 `filepath.Base(repoPath)` + 补防御分支测试
2. P3-1：GetRepoRoot 错误丢弃处补 log.Printf（对齐 R20/R22 的 MkdirAll 日志化先例）
3. P3-2：countMatchingInDir 仓库侧文件集提为单次构建（函数外缓存或顶层一次遍历）
4. P3-3/P4-1/P4-2/P4-3：按需小修或注释说明
