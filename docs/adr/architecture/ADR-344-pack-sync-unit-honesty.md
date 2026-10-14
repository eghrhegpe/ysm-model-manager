# ADR-344：整合包同步单元级诚实化：dirLevel 内容判定、单条推送保层级、祖先单元去重

- **状态**：✅ 已采纳
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：dirLevel 单元存在性判定让改过内容的模型在面板显示已同步（推了等于没推）；PushSingleResource 拍平层级把嵌套单元落到实例根
- **相关**：`ADR-064`（同步对比单点化）、`ADR-269`（D2′ 内容级判定）、`ADR-310`（单元级计数与推送目标展开）、`ADR-296`（relink/链接模式加固）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

整合包（instance）与仓库（repo）的同步走**两条不同成熟度的信道**：

- **文件级信道**（`SyncResources` → `ResourceDiff`）：自 ADR-064 收单点对比、ADR-269 加内容级判定后，已具备「哈希优先 → 超限诚实化 → Size 兜底 + 目录折叠指纹」的完整口径。
- **文件夹级（dirLevel）信道**（`SyncResourcesDirLevel(Scan)`）：单元表是 `map[string]string`（身份 key → 路径），**只比 key 是否存在**——`instanceDirs[key]` 命中即 `Synced`。

于是产生三处「推了等于没推 / 推错位置」：

1. **平铺模型文件单元永远无法重新推送**（P0）。仓库侧 `B.ysm` 改过内容（甚至 size 也变了），实例侧 `B.ysm` 仍是旧版本，`relKeyDirLevel` 键相同 → 判 `Synced` → 面板不显示待推送、行内无推送按钮，同步永远收敛不了。真值依据：`sync_dirlevel_sync.go|syncResourcesDirLevel` 的 `if _, exists := instanceDirs[key]; exists`。
2. **`PushSingleResource` 拍平层级**（P0）。它对目录/`.pmx`/`ysm.json` 分支调 `Installer.InstallDirLocked(该夹)` → 落位 `customDir/<basename>`；而嵌套单元（`嵌套1/01_taisho_maid`、`vendor/character/modelA`）应当落到 `customDir/嵌套1/01_taisho_maid`。同一条路正是面板行内推送与一键安装 `MissingDirs` 的消费端（`internal/app|PushSingleResourceToInstance`），落错位置 + 跨层同名互踩。
3. **祖先单元与子单元并推**（N5）。容器目录（自身含平铺模型文件 + 子模型夹）在键集里同时登记「容器键 + 容器内平铺文件键 + 子夹键」；`PushResources` 整树安装容器后又逐个安装子单元——同一批文件装两遍（双倍 IO），`count` 也跟着膨胀（计数对用户说谎）。面板链 `instance|pushTargets` 从不整体推容器（只递归子单元），两路口径不一致。

## 2. 决策（Decision）

### D1 dirLevel **文件单元**改内容级判定，复用 ADR-064 单点对比

`syncResourcesDirLevel` 的单元表由 `map[string]string` 升为携带 `Path/Rel/Size/Hash/IsDir` 的单元结构，两侧归集成 `map[string]DiffEntry` 后**委托 `ResourceDiff`**（`contentDiffers`：两侧均有哈希比哈希，否则比 Size），不再手写存在性判定。

- 哈希来源：scan 信道取 `types.ModelEntry.Hash`（scanner 30s 缓存 + 并行哈希，非同步热路径现算，不触 hashlock 红线）；Walk 回退信道无哈希 → `DiffEntry.Hash` 留空 → Size 兜底。与文件级信道**同一契约**（`DiffEntry.Hash` 注释：空=未知，回退 Size）。
- 缓存键补 `hashed: scanFn != nil`：同一 `(root, rtype)` 在 30s TTL 内可能先被「带哈希的 scan 结果」填充、再被「无哈希的 Walk 结果」命中（或反之），两种值的判定强度不同，必须分槽——照抄文件级信道 `resources` 的既有先例（`sync_cache.go|syncDirectoryScanKey.hashed` 注释里那条「互相污染」教训）。
- **跨格式不比内容**：`relKeyDirLevel` 按模型身份剥扩展名/禁用后缀（`B.zip` 与 `B.ysm` 同键），故仅当两侧单元的**原始相对路径（小写、slash）相等**时才比较内容字段；不等则清空内容字段退化为 `Synced`。理由：跨格式比字节**恒不相等**，会造出「点了推送还是红」的永不收敛假阳性（推送落 `B.ysm` 后实例里 `B.zip` 仍在，键与内容都不变），而旧语义「同身份即已同步」是刻意的格式宽容。此规则同时把 `.disabled` 与活跃文件的路径差异挡在内容比较之外，**不抢批 C 对 `.disabled` 语义的裁决**。

### D2 dirLevel **目录单元**保持存在性判定（不由顶层承担内容级）

scan 信道无法产出目录折叠指纹：`types.ModelEntry` 只承载受支持扩展名的模型文件，纹理/`pack.mcmeta` 等子文件根本不在条目里，`FoldDigest` 无从累积；若只在 Walk 信道补指纹，两条信道的结果会劈裂（违反 `sync_dirlevel_scan_test.go|TestSyncResourcesDirLevelScanMatchesWalk` 钉死的「反推与 Walk 等价」契约，该契约正是 dirLevel 走 scan 快路径的前提）。

目录单元的内容分叉由**展开层**承担：`DiffFolderContentsScan` 逐子文件判 missing/diverged，`nestDirLevelTree` 聚合为容器 `diverged`，一键安装按 `pushTargets` 展开成子文件落地。顶层目录单元的 `Synced` 表示「该夹存在」，**不表示夹内每个字节一致**——这条语义边界写进知识卡。

### D3 `PushSingleResource` 目录分支与 `PushResources` 同口径保层级

目录 / `.pmx`/`.pmd` / `ysm.json` 三个分支改用 `paths.RelInside(globalDir, dir)` + `installer.InstallDirRelLocked`；`relErr != nil || rel == "."`（越界/目录根本身是模型夹）时回退 `InstallDirLocked` 的 basename 语义——与 `PushResources` 合流成同一段判定，不另立第三套。

**D3b（同刀修掉的死分支）**：其中 `ysm.json` 分支的判据 `registry.IsYsmEntryJSON(filePath)` 传的是**全路径**，而该函数做的是裸名全等比较 → 恒 false，该分支从未触发：推送一个 `ysm.json` 只落单个 json、同夹纹理全丢（YSM 模型夹 = `ysm.json` + 纹理）。改传 `filepath.Base`，与两处已有同口径调用点对齐（`internal/app|pushRepoPathToInstance` 的根级兜底守注释、`importModelFileWithSubpath`）——那处兜底守本就假定「ysm.json 触发 InstallDir(父目录)」，本修正让假定成真（根级 `ysm.json` 仍被守拦下，不会把整仓推进实例）。**变异证据**：未修 D3b 时 `TestPushSingleResource_YsmJSONKeepsRel` 在「退回 `InstallDirLocked`」的变异下**仍然通过**（假绿，因为走的是单文件 Install 路径）；修后同一变异立即转红——死分支的照妖镜。

### D4 祖先单元不再整体安装（`dropAncestorUnits`）

dirLevel 推送/拉取的单元清单里，若某条目是另一条目的**严格祖先**（其下还有更深单元），则从安装清单剔除。理由：容器键是**键对齐 marker**（`sync_dirlevel_sync.go|collectEntriesWalk` 注释：用于与对侧同名叶子目录对齐键集，防幻影 Missing+Extra），不是模型单元；整体安装容器会与其子单元重复拷贝，并与面板 `pushTargets`「只递归子单元」的口径相反。剔除后容器目录由其子单元的落位自然创建。

## 3. 后果（Consequences）

**正面**

- 面板「已同步」重新变成可信信号：改过内容的平铺模型文件重新出现在待推送列表，行内推送可收敛。
- 嵌套单元落位正确（`customDir/<仓库相对层级>`），跨层同名不再互踩——面板行内推送与 `PushResources` 两条路殊途同归。
- 计数不再膨胀（混合容器 3→2），且与面板链的「按最深单元推」一致。

**负面 / 代价**

- dirLevel 单元表从 `string` 变结构体，三条 collect 通道（Walk / scan 反推 / 缓存读写）与缓存 map 类型同步改动；缓存键新增 `hashed` 维度（缓存条目数略增，语义正确性优先）。
- Walk 回退信道无哈希：仅改内容不改 size 的文件在该信道仍判 `Synced`（生产链始终注入 `scanFn`，故此退化只影响测试/旧调用方）——已与文件级信道同款限制，非新增债务。

**已知遗留**

- **目录单元专有纹理不可见**：非模型子文件在两信道的目录单元判定与展开层（`collectFolderFiles*` 只收模型文件）中都不参与，D2 未改变这一点。文件级信道的 `FoldDigest`（ADR-269 D2′-b）是另一条链，未移植到 dirLevel。
- **容器层散文件不随推**：容器被 D4 剔除后，容器根下既非模型单元、又不属于任何子夹的文件（如 `tex/common.png`）不会被推送；面板 `pushTargets` 现状相同，本 ADR 只是把两路对齐。
- `.disabled` / `.ban` 跨链语义（`relKeyDirLevel` 剥后缀 vs `collectFolderFiles` 保留后缀）仍是批 C 的裁决范围。
- `PushResources`/`PullResources` 无前端消费者（UI 走 `PushSingleResourceToInstance` 与侧栏拉取），修正它们的收益在 CLI/未来调用方与口径统一，不在当前用户可见面。

## 4. 数据溯源

| 来源（病灶/观察） | 结论（本 ADR 的哪个决策） |
|------------------|--------------------------|
| `sync_dirlevel_sync.go|syncResourcesDirLevel` 的 key 存在性判定 | D1：文件单元必须比内容 |
| `sync_resource.go|collectResourceEntries` + `sync_diff.go|contentDiffers` 既有口径 | D1：复用单点对比，不另写 |
| `sync_cache.go|syncDirectoryScanKey.hashed` 注释（互相污染教训） | D1：dirLevel 缓存键补 hashed |
| `sync_dirlevel.go|relKeyDirLevel`（剥扩展名/禁用后缀） | D1：跨格式不比内容 |
| `scanner_scan.go|processScanDirEntry`（只产出受支持扩展名条目） | D2：目录折叠指纹在 scan 信道不可得 |
| `sync_dirlevel_scan_test.go|TestSyncResourcesDirLevelScanMatchesWalk` | D2：不得让两信道劈裂 |
| `instance|pushTargets`（只递归子单元）+ `types|InstanceStatus.MissingDirs` 注释 | D3/D4：单条推送保层级、祖先不整体推 |
| `installer_dir.go|resolveFinalDst`（rel=="." 拒绝） | D3：rel=="." 回退 basename |
| `internal/app|pushRepoPathToInstance` 根级兜底守注释（「原传全路径恒 false 防线失效」） | D3b：IsYsmEntryJSON 须传 Base |
| `sync_push.go|PushResources` 既有 rel 保留分支 | D3：两条路合流 |

<!-- 文件名: dirlevel.md → 实际文件 architecture/ADR-344-dirlevel.md（ADR-320 architecture 全量模板） -->
