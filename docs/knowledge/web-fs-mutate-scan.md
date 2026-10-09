---
kind: web-fs-mutate-scan
name: 网页版文件系统变更与扫描（web-fs 拆分）
tier: leaf
category: core
status: active
source_files:
  - frontend/src/backend/web-fs-mutate.ts
  - frontend/src/backend/web-fs-scan.ts
auto_fields:
  symbols_with_lines:
    - deleteWebModel
    - moveOrCopyWebModel
    - renameWebDir
    - renameWebFile
    - scanAllWebModels
    - scanWebModels
    - searchWebModels
    - typeFromWebDir
use_when:
  - 网页版重命名
  - 网页版删除 / 移动 / 复制
  - scanWebModels
  - searchWebModels 数值过滤
  - IDB rekey
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - renameWebDir / renameWebFile / deleteWebModel / moveOrCopyWebModel
  - rekeyWebModelGroup 两阶段事务与回滚
  - scanWebModels / scanAllWebModels 主文件收敛
  - searchWebModels 数值范围 / Worker 批量统计 / 降级
quick_risk_lines:
  - 网页版变更一律「写 IndexedDB + 按 store 单事务」，重命名/移动/复制禁逐步 idbSet/idbDel（中途崩溃留新旧 key 并存）
pitfalls:
  - rekeyWebModelGroup 两阶段「写全新 key → 删旧 key」，中途失败只回滚本次新建（rollbackWritten 按 store 分桶）——config store 的 ban/tags key 错删到 files store（no-op）即孤儿标记
  - ysm.json 单文件重命名禁改（游戏按目录名识别模型，主文件 rank 降级会让模型从列表消失）——对齐桌面 fileops ADR-038 D3 的守卫
  - 搜索降级契约：Worker 不可用 / 批量统计失败 → 返回「数值 0 + hasError:false」关键词匹配（toolbar-search 经 consumeWebSearchDegraded 提示），外 catch 是边界防御、不让数值过滤搜索 throw
last_verified: 2026-10-09
---

# 网页版文件系统变更与扫描（web-fs 拆分）

## 概览

网页版（浏览器后端）文件系统的两个职责分片，系 ADR-040 职责切分延续自 `web-fs.ts` 拆出（只搬移不改行为；公共 API 由 `web-fs.ts` 门面 re-export，消费方 import 路径不变）：`web-fs-mutate.ts` 是模型组/组内文件的重命名（rekey）、整组删除、整组移动/复制的变更原语（全部「写 IndexedDB + 按 store 单事务」）；`web-fs-scan.ts` 是模型库扫描（IDB `dir:` 前缀 → ModelEntry 列表）、全库递归列表与关键词/数值范围搜索（数值统计走 Web Worker 批量分析）。语义对齐桌面侧 Go `fileops` / `scanner` / `SearchModels`。网页版后端总架构见 [backend-web](./backend-web.md)。

## 核心职责

- `web-fs-mutate.ts` — 变更原语：
  - `assertValidRenameName`：重命名目标名校验（对齐桌面 `fileops.RenameDir/RenameFile`）——非法字符 `[\\/:*?"<>|]` / 空名 / `.` `..` 路径段拒绝。缺校验的后果：newName 含 `/` 或为空制造坏 key，模型变幽灵（无法删除/再次重命名）；重命名到已存在模型名会静默覆盖 dir key 合并数据（桌面 `os.Rename` 对目标已存在报错，web 必须对齐）
  - `deleteWebModel`：整组删除 = dir + 全部 file + ban/tags 标记；files / config 分属两个 store，各自单事务（IDB 单事务仅限单 store，跨 store 非原子——files 事务提交后 config 事务失败会留孤儿标记，调用方 best-effort 重试清理）
  - `renameWebDir` / `renameWebFile`：目标已存在 / 源缺失校验（对齐桌面 os.Rename 报错语义，拒绝静默 no-op）后复用 `rekeyWebModelGroup` 原语完成整组/单文件 rekey；**ysm.json 单文件重命名禁改**——模型目录清单（游戏按目录名识别模型），改名让主文件 rank 从 2 掉到 0 → 模型从列表消失（对齐 ADR-038 D3，桌面侧 `fileops.RenameFile` 同款守卫）
  - `moveOrCopyWebModel`（Go `MoveModelFile` / `CopyModelFile` 共用的 web 实现）：目标模型名 = 目标文件夹 + 源组名末段（对齐 Go `dst=Join(dstDir, Base(src))`，多段组名父路径随移动丢弃）；自嵌套检查（目标严格位于源内）先于目标已存在检查——两条同时命中时 Go 报的是自嵌套；`newName === name`（目标 == 源自身）不属自嵌套，留在存在性检查里（Go 侧此时报「目标已存在」）
  - `rekeyWebModelGroup` 两阶段事务：阶段一写全部新 key（不删旧），全成功后阶段二才删旧 key（move 时）；中途失败经 `rollbackWritten` 按 store 分桶回滚（files 倒序、config 倒序对号入座——P1-2 修复，否则 config 的 ban/tags key 会被错删到 files store no-op 成孤儿标记）；`collectRekeyOps` 缓存 config key 扫描结果（`cfgKeysCache`）供阶段二复用，避免重复扫 config store
- `web-fs-scan.ts` — 扫描与搜索（只做「读 IDB → 归组/收敛 → ModelEntry/WebSearchResult」，不触碰写入语义——写入归 `web-fs-import.ts` / `web-fs-mutate.ts`）：
  - `scanWebModels`：仓库根 → `scanWebModelGroups`（两次前缀批量操作收敛——`idbGetAll` 全 dir key + `idbGetAllMetadata` 全 file 元数据，总 IDB 事务数 O(1)，内存按组名收敛；非根目录 → `scanWebModelFilesInDir` 递归列该目录主文件，避免批量重命名等消费方拿到全库条目）
  - `buildGroupEntry` 主文件竞争：嵌套 rel（含 `/`，如 tex/face.png）不参与竞争（主文件须在模型组根层，对齐桌面目录模型）；仅 `.ysm` / ysm.json 可作主文件（`mainRank < MAIN_FILE_RANK_TYPE` 的组整组跳过——孤儿 dir key、文件被删也跳过，避免 Path 以 `/` 结尾）；`groupFilesByDir` 组名按长度降序排，首次 startsWith 命中即最长匹配
  - `scanAllWebModels`：全部资源类型递归列主文件（标签聚合 / 子目录映射等全库操作消费）
  - `searchWebModels`（对齐桌面 `app_scan.go|SearchModels`）：关键词匹配 name OR path（可命中目录名/作者路径段）；数值条件（minBones/maxBones/minCubes/maxCubes/minTex/maxTex，`>0` 才参与过滤，`passesNumericFilters` 六条短路 OR 合并）；无数值条件走快路径不做批量解码；数值统计经 `web-stats.ts|batchStatsWebModels` Worker 批量分析（大库后台跑不卡 UI）；Worker 不可用/失败 → 降级关键词匹配（数值 0 + `hasError:false`，`emitWebSearchHit` 保持排除/写入顺序语义：先排除 hasError 条目，再过数值条件，最后映射入结果）

## 对外 API / 入口

- 全部经 `web-fs.ts` 门面 re-export（消费方 import 不变）：`deleteWebModel` / `renameWebDir` / `renameWebFile` / `moveOrCopyWebModel`（对应 Go 绑定 `MoveModelFile` / `CopyModelFile` 的 web 实现侧）、`typeFromWebDir` / `scanWebModels` / `scanAllWebModels` / `searchWebModels`
- 右键菜单「移动到 / 复制到」入口与 ysm.json 禁改守卫见 [context-menu](./context-menu.md)；网页版专属扩展白名单（`GetFsaAuthState` / `SelectLocalRepo`）与绑定契约见 [backend-web](./backend-web.md)

## 与其他子系统关系

- 地基：`idb.ts`（`idbTx` / `idbGet` / `idbKeys` / `idbGetAll` / `idbGetAllMetadata`）、`web-common.ts`（`WEB_ROOT` / `isWebPath` / `parseWebDirPath` / `webDirType`）、`web-fs-shared.ts`（`dirKey` / `fileKey` / `mainFileRank` 键规约，[backend-idb](./backend-idb.md)）
- `web-fs-read.ts` 的 `parseWebModelPath` / `listWebModelDirFiles`（多段路径解析与递归列目录）；`web-stats.ts` 的 `batchStatsWebModels`（[model-stats](./model-stats.md)）
- 前端消费面：`app-tree` 右键菜单 / 批量重命名 / 搜索框（[toolbar-search](./toolbar-search.md)）；对齐口径是桌面 Go `go/fileops` / `go/scanner`——web 侧校验语义逐条镜像桌面错误分支（[fe-go-boundary](./fe-go-boundary.md) 的「判定归 Go、前端只读」在本层表现为 web 实现与 Go 行为同构）

## 不变量

- 变更事务口径：整组 rekey 一律经 `rekeyWebModelGroup` 两阶段（写全新 → 删旧）+ 按 store 单事务（`idbTx`）；逐步 `idbSet` / `idbDel`（各开各事务，中途崩溃留新旧 key 并存）是已废弃的旧形态；单文件重命名走单事务「写新 + 删旧」，同名（trim 归一后同 key）直接返回——同 key 自删 = 数据丢失回归
- 读-改-写窗口（`idbKeys` 扫旧 key + 逐个 `idbGet` 读旧值与 `idbTx` 写新值之间无事务包裹）已知残余：当前 web 端单用户操作并发概率低，多 tab 并发时可能残留——源码注释已声明，勿在此层加码锁（无跨 tab 协调设施）
- 搜索降级契约分层：`batchStatsWebModels` 内部吞错整批降级（不向上抛，`web-stats.test.ts` 锁定）；`searchWebModels` 外层 catch 仅为契约外的拒绝路径（worker 构造 / IDB 键枚举异常）兜底——同样降级而非 throw
- `buildGroupEntry` 主文件 rank 口径：`Name` 指向主文件（含扩展名，与桌面 `scanner.go` `Name=filepath.Base(p)` 含扩展名一致——否则 `loader.ts` 的 `name.endsWith(ext)` 过滤恒失败列表为空）；`Ext` 小写化 + 无点号保护（`lastIndexOf=-1` 时 `slice(-1)` 会取到字母尾）
- 扫描确定性输出：条目按 `localeCompare("zh-CN")` 排序（与桌面扫描一致）；`scanWebModels` 根目录返回主文件条目（网页版既有语义），非根目录只列该目录内主文件
- `typeFromWebDir` 缺省回退 `RESOURCE_TYPES.YSM`（无类型段的目录按 ysm 扫）；数值过滤六条条件「>0 才参与」与桌面 `SearchModels` 逐条同序，勿改顺序

## 相关

- [backend-web](./backend-web.md) — 网页版后端架构（`web-fs.ts` 门面、browserAdapter、绑定契约）
- [backend-idb](./backend-idb.md) — IDB 键规约（`dir:` / `file:` / `ban:` / `tags:`）与 `web-fs.ts` 主文件职责
- [model-stats](./model-stats.md) — Worker 批量统计与批级降级契约（null 三态口径）
- [context-menu](./context-menu.md) — 右键菜单移动/复制/重命名入口与 ysm.json 禁改守卫（声明层 visibleWhen）
- [fe-go-boundary](./fe-go-boundary.md) — 前端只读不判 / web 实现与 Go 行为同构的边界口径
