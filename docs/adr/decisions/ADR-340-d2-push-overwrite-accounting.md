# ADR-340-d2：批量推送覆盖知情口径：如实计数与点名（覆盖照旧）

- **状态**：✅ 已采纳
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-340（推送链去总线化：请求-响应回归直调）——本条是「直调之下结果如实」的执行切片
- **准入理由**：公共契约变更（`types.InstanceStatus` 新增 `Overwrites`、`types.ResourceSyncResult` 新增 `Diverged`，随绑定下发；且 fileLevel 分叉行的面板状态由 missing 变 diverged）
- **相关**：`go/sync/sync_diff.go`（`ResourceDiff`）、`go/instance/instance.go`（`processOneResourceType`）、`go/instance/status_counts.go`（`pushTargets`）、`frontend/src/features/sync/sync.ts`、`frontend/src/views/app-sidebar/sync-flow.ts`

---

## 背景（一句）

批量推送遇到「实例侧也有该文件、但内容与仓库不同」时**以仓库为准覆盖**——这没错，错的是结果里一个字都不提：`ResourceDiff` 把「内容已变化（待推送更新）」与「仅全局有」一并归进 `Missing`（函数注释自陈），下游于是无法分辨「新建」与「覆盖用户手改」，侧栏推送结束只报一句「推送完成：n 个整合包」，而实例侧的修改已经没了。

## 决策（三行）

1. **把丢掉的那一维补回来，不动归属**：`ResourceDiff` 输出新增 `Diverged`（两侧同键且 `contentDiffers` 为真），它是 `Missing` 的**子集**而非第四桶——旧消费者零影响；`processOneResourceType` 据此把 fileLevel 分叉单元标 `SyncStatusDiverged`（面板链既有语义：继承 missing 的可操作属性，并让 ADR-310「分叉行推送先确认」的安全闸对文件级类型真正生效）。
2. **策略照旧覆盖，只加知情**：`InstanceStatus` 新增 `Overwrites`（`Missing ∪ MissingDirs` 的**子集**，同格路径，前端只做集合命中、不重算归属）；`pushTargets` 只收录「自身即推送目标」的分叉项——叶子文件 diverged、整夹推送的分叉夹。**分叉夹被展开成内层文件时不逐文件声称覆盖**（逐文件归因需要实例侧对应夹路径做真实两侧 diff，见「后果」）。
3. **前端如实计数与点名**：`features/sync|downloadMissing` 返回 `overwrites`（只计**安装成功**的目标——失败的目标没覆盖任何东西），侧栏汇总追加「覆盖了 N 处实例侧已修改内容（前三个名字…等）」并改用 `warn` 级详情 toast（三语键 `sidebar.pushOverwrote`），**绝不落进纯成功文案**。

## 后果（一句）

用户仍得到「推送即覆盖」的确定手感（无行为变化），但不再被蒙在鼓里；将来若要升级为「拒绝覆盖」或「逐条确认」，`Overwrites` 清单就是现成的判据入口，不必重算。**两处留白**：①分叉夹展开成内层文件时无法逐文件归因（宁少报不谎报）——解药是给 `pushTargets` 注入实例侧对应夹路径做真实两侧 diff，那一改会同时改变安装目标清单（属行为变更，须单独拍板）；②单包模式（无 `instanceNames`）目前无生产调用方，其 toast 未接 `overwrites`，将来接线时一并补。回退方式：前端不显示该段即退回旧口径（Go 侧字段纯增量，无数据风险）。
