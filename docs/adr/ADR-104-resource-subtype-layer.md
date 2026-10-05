# ADR-104：资源类型子类层（subtypes）统一：大类/小类/防御性检验三层架构

- **状态**：已采纳（Accepted）
- **日期**：2026-08-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-092`（分组路由）、`ADR-094`（MMD 子类型位置路由）、`ADR-095`（打开文件夹 installDir）、`ADR-096`（全局库存储分层）

---

## 1. 背景（Context）

整合包右键「打开文件夹」在 MMD 类别下打开到 `3d-skin/` 根目录，而其他资源类型（resourcepack/shaderpack/ysm 等）精确到各自目录；同步/扫描链路则按位置（`IsMMDSubDir`）精确到 `3d-skin/{EntityPlayer|SceneModel|...}`。排查后发现更深层的结构不对称：

1. **层级不对称**：MMD 是「1 个 rtype（mmd-skin）+ 6+ 用途子目录」（`EntityPlayer`/`SceneModel`/`CustomAnim`/`CustomMorph`/`StageAnim`/`shader`），其他资源是「1 rtype ↔ 1 目录」1:1。前端 `nav-subtype-select` 已按「大类 → 小类」两级导航（mmd 组展开子目录、其他组展开 rtype），**数据模型没有对齐导航**。
2. **ADR-094 否决理由不成立**：ADR-094 以「.pmx 无法区分 EntityPlayer/SceneModel → 不能拆独立 rtype」为由否决子类型独立。但系统本就不是靠扩展名路由子类型——扫描/同步早已位置优先（`IsMMDSubDir` 填充 SubDir、`SyncResourcesDirLevel` 保留层级），扩展名歧义在位置路由下不构成障碍（类比 ADR-095 将 `.json` 弱证据收紧为 `ysm.json` 标志文件）。「扩展名歧义」不是否决拆分的根因，「改动面大且无增量收益」才是。
3. **混合路由**：扫描/同步路径优先、导入扩展名路由（`inferFolderType`）、打开文件夹 rtype 优先（`resolveInstDirTarget`）——同一条资源的三条链路口径不一，正是「打开精确度不一致」与未来数据同步隐患的土壤。

## 2. 决策（Decision）

统一为**三层架构**，全部注册表驱动（`resource_types.json`），消灭 mmd 特判：

1. **大类（group）**：minecraft / minecraft-mod / mmd / vrm / other —— **不映射整合包路径**（现状已成立），纯组织与导航第一级。
2. **小类（subtype）**：资源包、光影包、ysm、蓝图、投影、车万女仆、**MMD 各用途子目录**（EntityPlayer/SceneModel/...）—— **这才是映射整合包路径的单元**。注册表引入 `subtypes[]` 数组（含 `name`/`label`/`installDir`/`scanDir`），mmd-skin 挂 6 子类（各自映射 `3d-skin/{name}`），其他类型无子类（小类 = 自身）。scanner / sync / 打开文件夹 / 导入的 mmd 特判全部改为注册表驱动。
3. **防御性检验**：扩展名/内容指纹检测（`detector`、`FindInstDir` 的 `ysm.json` 标志文件、`resolveTypeSafe` 歧义回退内容检测）作为**位置路由的防御层保留**在整合包侧与 3D 预览侧——路径优先，但绝不删检测（ADR-095 教训：只看弱证据会误伤 config 目录）。

**阶段划分**：
- **阶段 1**：`OpenInstanceFolder` 加 subdir 参数，instance 右键 ctx 透传全局 `repo_subdir`，打开精确到 `3d-skin/{subdir}`——最小修复「打开文件夹不精确」，非 MMD 类型行为不变（`resolveInstDirTargetSubdir` 包装层）。
- **阶段 2**：注册表 `subtypes[]` 数据层 + 特判消解（`IsMMDSubDir`/`MMDSubDirs`/sync mmd 分支/scanner mmd 分支/`resolveInstDirTarget` 候选 C 全改注册表驱动），前端 `MMD_SUBTYPES` 硬编码列表退役、nav 二级 select 全部注册表派生。
- **阶段 3（后续）**：小类独立 rtype 与否由 `subtypes[]` 消费方演进决定，本 ADR 不强推（改动面大、同步/扫描已位置优先，无增量收益前不拆）。

## 3. 后果（Consequences）

**正面**：
- 「大类 → 小类 → 防御检验」三层与前端导航同构，MMD 不再特殊，新资源类型带子目录零特判；
- 打开/同步/扫描/导入四链路统一「位置路由 + rtype/扩展名防御」口径，消除数据不同步土壤；
- 阶段 1 独立可用，不阻塞日常使用。

**负面 / 已知遗留**：
- 阶段 2 改动面：`go/types`（注册表解析 + subtypes 查询）、scanner/sync/instance（特判改注册表）、`internal/app`（打开文件夹）、前端（nav/renderer/types.ts），须 TDD 逐个链路验证；
- 存量仓库 MMD 根目录散放模型需迁移入 `EntityPlayer/`（ADR-094 已列遗留，迁移脚本未实现）；
- 阶段 3 不拆 rtype 的边界：单文件导入（无目录上下文）仍靠扩展名兜底，`ExtBelongsTo` 多归属歧义场景依赖用户选择（导入页 mmd 子目录下拉已有）。

## 4. 数据溯源

- 现象：整合包右键打开 MMD → `3d-skin/` 根；其他类型精确到目录 → `app_scan.go` `resolveInstDirTarget` rtype 优先、无 subdir 入参。
- 根因：`resource_types.json` mmd-skin `installDir: "3d-skin/"`（1 rtype ↔ N 子目录）vs resourcepack `installDir: "resourcepacks/"`（1:1）；`nav-subtype-select` 对 mmd 组展开 `MMD_SUBTYPES`（data-subdir）、其他组展开 rtype（data-rtype）——前端两级、后端数据模型未对齐。
- 否决理由证伪：`scanner.go:275-279`（`IsMMDSubDir` 位置填充 SubDir）、`sync_dirlevel.go`（子目录保留层级）——同步/扫描早已位置优先，扩展名歧义（.pmx/.vmd/.vpd）不参与子类型路由；类比 ADR-095 `.json` 弱证据收紧先例。
- 修复验证：`go build ./go/...` + `internal/app` 测试（`TestResolveInstDirTargetSubdir_*` 4 例）+ 前端 vitest（`context-menus.test.ts` 57 例）+ `npm run typecheck` + `npx vite build`。

<!-- 文件名: resource-subtype-layer.md → 实际文件 ADR-104-resource-subtype-layer.md -->
