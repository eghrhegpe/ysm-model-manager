# 全面审计修复总账 — 2026-08-04

## 范围

本轮审计覆盖 YSM Model Manager 的 **13 个核心模块**（前端 8 + 后端 5），按 AGENTS.md「审核代码可用性」五步流程（文档地图 → 依赖图谱 → 资源配对 → 心理模拟 → 输出报告）逐一盘问，并对全部发现落地修复。

**审计目标**：并发竞态、资源泄漏、静默吞错、状态机缺陷、文档漂移。

---

## 一、审计模块与结论汇总

| 模块 | 结论 | 主要发现 | 修复 commit |
|------|------|---------|-------------|
| 下载链路 | 有条件通过 | P1 取消后队列哑火 + Content-Length=-1 进度误报 + P2×4 + P3 | `8b500b5` `16a9cc1` `6558e53` `1a69a70` |
| 回收站 | 通过 | P2 清空吞错/链接删除无感知/恢复半文件 + P3×2 | `93c9bbe` |
| 3D 预览 | 有条件通过 | P1 JS 兜底格式不兼容被实际调用 + P2 无 gen 守卫 | `ca8380d` |
| 导入队列 | 通过 | P3 死调用/定时器泄漏/DnDLock abort 兜底 | `547e5c7` |
| 安装链路 | 有条件通过 | P2 CopyFile 半文件残留 + 导出函数绕过锁 | `dcc3bee` |
| 同步链路 | 通过 | P2 toggle 无并发守卫（4 生产者）+ P3×2 | `56f6cda` |
| app-tree | 通过 | P3 假下载计数/硬编码 repoRoot/死监听 | `d7eba46` |
| 更新链路 | 通过 | P3 解压截断静默 + 单测补全 | `b3389d5` |
| app-content | 通过 | P3 定时器切页泄漏 + init 无兜底 | `d64b3a1` |
| app-resource-manager | 有条件通过 | P2 详情面板无 gen 守卫 + P3 列表竞态/串行查询 | `878a828` |
| go/watcher | 通过 | P3 loop 无 panic 兜底（假活）+ 知识卡漂移 | `47da9ad` |
| app_install.go 主体 | 通过 | P3 Push/Pull 失败静默 + 注释漂移 | `240c73b` |
| core 基础设施 | 有条件通过 | P2 push-to-pack 传参错误 + P3 批量无守卫 | `7df8499` |

**合计**：16 commits，P1×4、P2×14、P3×17 修复，无遗留 P1/P2。

---

## 二、高价值修复盘点（🔴 P1 / 🟠 P2）

| # | commit | 模块 | 问题 | 修复 |
|---|--------|------|------|------|
| 1 | `8b500b5` | 下载链路 | `cancelled` 标志置 true 后永不重置——取消一次后队列完成不再发 `queue:status done`，前端永久卡 downloading，后续下载被静默拦截 | `EnqueueDownloads` 锁内复位 cancelled；running 判断并入临界区 |
| 2 | `8b500b5` | 下载链路 | Content-Length=-1 时前端 `pct = 100` → 3s 后误报完成 + tree:reload 刷出半个文件 | `total<=0` 不置 100%，完成判定只信任 file-done/done 事件 |
| 3 | `ca8380d` | 3D 预览 | ADR-004 声称 JS 兜底是死代码，但 loader 实际降级调用格式不兼容的 `buildSpecFromModel` → Go 失败时静默空白 | 删降级调用，Go 失败抛错；`model3d-spec.ts` 及其黄金样本测试保留 |
| 4 | `ca8380d` | 3D 预览 | 3D 加载无 generation 守卫——快速切换模型旧 WebGL renderer 泄漏 | `_model3dGen` 计数器，加载期间关闭立即 cleanup |
| 5 | `dcc3bee` | 安装链路 | `CopyFile` 失败残留半截文件（与下载/回收站同款） | io.Copy 失败 os.Remove；`copyFileLocked`/`linkOrCopyLocked` 拆锁，导出函数包锁防死锁 |
| 6 | `878a828` | resource-manager | `_showDetail` 无 generation 守卫——快速点 A（慢）→ B（快）时 A 覆盖 B 详情 | `_detailGen` 三处比对（坑 #1572 标准配置补全） |
| 7 | `7df8499` | core | `file.push-to-pack` 传 basename 给 `InstallModelTo` → installer.Install 的 IsInside 校验必失败「源文件不在仓库目录内」 | 改传完整路径 + 单测断言同步 |

---

## 三、高频反模式（本轮统计）

| 反模式 | 出现次数 | 代表修复 |
|--------|---------|---------|
| 失败静默吞错（无日志无 toast） | 5 | 回收站 Empty、Push/Pull、`_loadData` |
| generation 守卫缺失（异步回写共享 DOM） | 4 | `_showDetail`、3D 加载、`_loadList` |
| 并发无守卫（连点/多生产者） | 4 | sync:toggle、batch.move/copy、导入/删除 |
| 死代码/死监听（无生产者或未接线） | 3 | `entry:toggle`、JS 兜底、`#sort` 历史 |
| 失败残留半截文件 | 3 | CopyFile、Restore、extractZipFile |
| 文档漂移（知识卡/ADR 与源码不符） | 3 | go_download、go_watcher、注释 |

**教训**：坑史 #1572 明言「generation 是标准配置」，但新代码仍在遗漏——审核异步按钮/详情/列表时把「异步结果回写共享 DOM 是否有代际守卫」列为首查项。

---

## 四、验证结果

- `go build ./...` + `go test ./go/... ./internal/...` 全过（25 包）
- `tests/*.mjs` 契约测试 7 文件全过
- `tsc --noEmit` 零错误
- `vitest run` 30 文件 / 357 用例全过
- `doctor.mjs` 11 项静态分析全过（含 gen-project-map / doc-drift / deadcode 基线）

---

## 相关

- 审核流程依据：AGENTS.md「审核代码可用性」（五维 + 五步 + 心理模拟）
- 决策真相源：`docs/adr/`（ADR-028/031/032/033 为本轮相关决策的既有沉淀）
- 历史坑位：`docs/archive/bug-chronicle.md`（本轮多处修复对齐其教训）
