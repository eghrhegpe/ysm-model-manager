# ADR-065：整合包侧资源类型语义收敛：rtype 分支注册表驱动单点

- **状态**：✅ 已采纳
- **日期**：2026-08-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/archive/extensibility-index.md`、`go/sync/sync_push.go:79`、`go/sync/sync.go:286`、`go/instance/instance.go:41`、`go/sync/sync_relink.go:78`、`go/importer/importer_file.go:71`、`go/ysm/ysm.go:102,135`、ADR-064（同步层对比收敛，互补）

---

## 1. 背景（Context）

### 1.1 资源映射已注册表化，但整合包侧消费仍分散硬编码

`resource_types.json` 已是资源类型的单一事实来源（`hashable`/`dirLevelSync`/`scanInstance`/`installExts`/`detector`/`zipEntries` 等字段，ADR-062 及此前批次已落地），哈希（`ShouldHashExt`←hashable）、安装白名单（`InstallExtsFor`←installExts）、文件夹级同步（`IsDirLevelSync`←dirLevelSync）、扫描（`IsScanInstance`←scanInstance）、检测器（packs `DetectResourceType`←detector）均已收敛为注册表查询。

**但整合包侧仍有 6+ 处对 rtype 的硬编码字面量分支**，与注册表语义各自为政：

| 位置 | 硬编码 | 问题 |
|------|--------|------|
| `go/sync/sync_push.go:79` | `rtype == "ysm" \|\| rtype == "mmd-skin"` | 同一函数 69 行已用 `types.IsDirLevelSync(rtype)`，此处却手写——两套口径，改一处另一处漂移 |
| `go/sync/sync.go:286` | 自造 `isMcmetaDetectorType`（判断 detector=mcmeta） | 注册表明明有 `Detector` 字段，却手写判断逻辑，新增 detector 值须改 Go |
| `go/instance/instance.go:41` | `rtype == "ysm" && strings.HasSuffix(base, ".json")` | ysm.json 特判与 `types.IsYsmEntryJSON`（scanner 同口径）重复实现 |
| `go/sync/sync_relink.go:78` | `baseName == "ysm.json" && rtype == "ysm"` | 又一处 ysm.json 特判，口径可能漂移 |
| `go/importer/importer_file.go:71` | `rtype == "ysm" && ext != ...` | ysm 兜底分支硬编码 |
| `go/ysm/ysm.go:102,135` | rtype 目录映射表 + `rtype == "ysm"` 特判 | 领域专用表可保留，但 ysm 特判应注册表化 |

### 1.2 「修好蓝图 MMD 就识别不出来」的根源

同步层对比收敛（ADR-064，隔壁立项）与 rtype 语义分散相互叠加：修 create-blueprint 的资源包文件夹误识别（sync.go `isPackFolderType`）时，若仅改 sync.go 一处而漏掉 sync_push.go:79 的拉取分支，MMD/YSM 文件夹级复制的判定口径就与扫描不一致——识别与拉取走两套 rtype 语义，表现为「修好一边坏另一边」。

### 1.3 常规轮次约束

硬编码分支散布 5 个包、涉及同步/安装/扫描行为，属跨层收敛，非纯提取；且与隔壁 ADR-064（同步层对比收敛）范围相邻，需独立立项协调边界。

## 2. 决策（Decision）

**整合包侧一切 rtype 语义分支收敛为 types 注册表查询函数**，新增类型只改 `resource_types.json` 一处：

1. **sync_push.go:79** → `types.IsDirLevelSync(rtype)`（与 69 行同口径，消除同函数双标准）。
2. **sync.go `isMcmetaDetectorType`** → `types.RegistryType(rtype).Detector == "mcmeta"`（直接消费注册表字段；同步提供 `types.IsDetector(rtype, det)` 助手）。
3. **instance.go:41 / sync_relink.go:78 / importer_file.go:71 的 ysm.json 特判** → 统一走 `types.IsYsmEntryJSON(base)` + 注册表扩展名（`SupportedExtsForType`），消除三处各自实现。
4. **ysm.go:135 的 `rtype == "ysm"` 特判** → 注册表驱动（`registry.IsYsmEntryJSON` 或 dirLevelSync 语义）；目录映射表（:102）保留为领域专用数据。
5. **审计闸门**：`check-redlines` 增加「禁止 Go 源码出现 `rtype == "..."` / `rt.ID == "..."` 硬编码字面量」扫描（ADR-040 红线同款），新增类型若漏改注册表即被检出。

## 3. 后果（Consequences）

**正面**：
- 「修好蓝图坏 MMD」类漂移从根上消除——识别/同步/拉取/安装全部消费同一注册表语义，改类型只需动 JSON。
- 与 ADR-064（同步层对比收敛）边界清晰：ADR-064 管「扫描源与对比实现单点」，本 ADR 管「rtype 语义分支单点」，二者协同消除同步层漂移。

**负面**：
- 跨 5 包改动，需分阶段落地（先 sync_push/sync.go 两处高危，再三处 ysm.json 特判，最后审计闸门）。
- 审计闸门可能误报领域专用表（ysm.go:102 目录映射），需白名单豁免。

**已知遗留**：
- `go/ysm/ysm.go:102` rtype 目录映射表暂不注册表化（领域专用，价值低，保留）。
- 与 ADR-064 的落地顺序：建议 ADR-064（对比单点）先行，本 ADR 随后，避免同时改 sync.go 冲突。

## 4. 数据溯源

来源：用户反馈「资源文件已映射整合包配置文件，但哈希/扫描/识别逻辑独立折腾，修好蓝图 MMD 识别不出来」+ `docs/archive/extensibility-index.md`（多模块 rtype 硬编码）→ 探索定位 6 处硬编码分支与同函数双标准（sync_push.go:69 vs 79）→ 结果：ADR-065 立项，编码按 §2 分阶段落地（先 sync 两处 → ysm.json 特判三处 → 审计闸门）。

<!-- 文件名: instance-rtype-registry-single-source.md → 实际文件 ADR-065-instance-rtype-registry-single-source.md -->
