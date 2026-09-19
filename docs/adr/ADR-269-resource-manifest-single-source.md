# ADR-269：资源清单单一事实源化：mcmeta 四份手抄收敛 + pack provenance 维度

- **状态**：🔄 部分采纳 — D1（mcmeta 形状单一事实源）已落地：B1 canonical schema + B2 派生守卫门禁 `check-resource-manifest.ts`；D2（pack provenance）待评估排期（价值取决于第三方 pack 分发场景，人类首席架构师已确认推进方向，具体切片待拍板）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/types/registry/resource.go PackMeta; go/types/config.go PackMetaView; frontend/src/parsers/pack-meta.ts; frontend/src/utils/format/pack-format.ts; go/packs/classify.go openContainerEntries; go/scanner/scanner.go repoIndexEntry/GenerateRepoIndex; go/fsutil/write.go SHA256File; go/download/download.go FileWithChecksum; frontend/src/utils/resource/schema.ts allResourceTypes; frontend/src/services/resource-registry.ts loadResourceRegistry; frontend/src/utils/resource/types.ts; frontend/src/views/app-sync-manager/store.ts dirLevelSync; frontend/src/views/app-preview/index.ts _preloadTypeRegistry`

---

## 1. 背景（Context）

一次「隔壁 `.dsh` 架构能否借鉴」的灵感风暴，取证后撞出本仓三处真债：

- **债 A（高收益、无条件）**：`pack.mcmeta` 的形状（`pack_format / description / thumbnail / supported_formats / min_format / max_format`）现存于 **4 处手抄**——`go/types/registry/resource.go:578 PackMeta`、`go/types/config.go:112 PackMetaView`（多一 thumbnail）、`frontend/src/parsers/pack-meta.ts:107`（连限额 `:14-16` 都照搬 Go）、`frontend/src/utils/format/pack-format.ts:17`。靠 ADR-070「TS 平移 + 测试锁定」维持，**不是生成物**——四份漂移只靠注释和人肉契约测试兜底。
- **债 B（补空白）**：pack 实例**零 provenance**——全仓 `grep provenance|sourceUrl|installedAt|checksum` 对 pack 实例零命中。识别后的 pack 只有类型级配置元数据（`ResourceType`），无来源 / 版本 / 安装时间 / 文件校验。附带死码：`go/download/download.go:540 FileWithChecksum` 已写好可选 SHA256 校验，注释自认「P2 预留」、生产零调用者。
- **债 C（前端旁路收敛）**：同一份 `resource_types.json` 有**两条进入前端的路径**——路径 A（构建期内联·同步）`frontend/src/utils/resource/schema.ts:8` import-assertion 内联，喂 `types.ts`/`extensions.ts` 派生；路径 B（Go RPC·异步）`frontend/src/services/resource-registry.ts:26` 调 `App.LoadResourceTypes()` 缓成 keyed-by-id 注册表（两处顶注自认「两套数据源…数据源保持现状」）。取证：B 的 7 个生产消费方（4 走 `loadResourceRegistry` + 3 绕过它直调 `LoadResourceTypes`）读的字段（`id`/`name`/`icon`/`configField`）**全落在 A 的 14 字段子集内**；12 个 RPC-only 字段中 11 个前端零消费，唯一被读的 `dirLevelSync`（`frontend/src/views/app-sync-manager/store.ts:30`）**读了即弃**、非测试代码里无任何下游。跨路径重复同问 4 处（最强 `frontend/src/views/app-sync-manager/renderer.ts:120` 单表达式内先问 A、`|| curCfg.name` 兜底 RPC）。唯一有实际行为差异的时机面 = `frontend/src/views/app-preview/index.ts:82` 于 `connectedCallback` 内 fire-and-forget 预载 `typeCache` **未 await**，首帧预览可读到空表落 `"📦"`+裸 rtype，而 A 在模块加载期已就绪、无此窗口。另 `frontend/src/backend/web-fs.ts`、`backend/web-common.ts` 各再内联一遍 JSON，破 `schema.ts:45`「整个前端只 import 这一处」。

灵感来自 `.dsh` 的 `dsh-skin/v2.json` 皮肤契约：版本化清单（`skinManifestVersion`）+ `$schema` 校验 + 声明式 `contributes` + 能力协商 `requires.contracts:{apiVersion,kind,optional}` + `provenance.json`（每文件 sha256，25 项精确列举而非全树）。这与本仓 `MenuNode`「菜单即数据」、`settingsOrder`/`getEnvPlacement` 注册表驱动（ADR-268）是同一条哲学的不同投影。

## 2. 决策（Decision）

三条子决策，**可独立分阶段**（D1 已落地；D2 不依赖 pack 是否分发第三方；D3 纯前端、独立于 D1/D2）：

- **D1 — mcmeta 形状单一事实源化**：以一份 `resource-manifest` JSON schema 为 mcmeta 形状的 canonical 事实源，采**派生守卫**（对齐 `type-consistency.ts` 范式，fail-closed）对 `Go PackMeta` / `PackMetaView` / `TS parsePackMetaJson` 三层的字段集与归一化行为标记做三方对账，任一漂移即 exit 1 阻断；**而非 schema→code 代码生成**（JSON schema 只表达字段声明，生成不了 `descString` / `FormatRange.UnmarshalJSON` 这类解析行为；引入三方 codegen 又等于在本仓 15 个自研 gen 之外另开一套范式，净收益≈0，反成漂移源）。`PackMetaView` 定义为 `PackMeta + thumbnail` 的视图派生（唯一合法增量）。桌面模式的绑定类型另由既有 Wails `generate:bindings`（Go struct → TS，ADR-143）保证。落地 = `check-resource-manifest.ts` 接 `gate-config` 的 `ALL_STATIC_TOOLS` / `DOC_STATIC_TOOLS`（hard），纳入 `doctor --docs` + pre-push 全量门禁。
- **D2 — 引入 pack provenance 维度**：定义 `FileFingerprint{path,sha256,size}`，挂载到 `ModelEntry`（现仅一标量 `Hash`）/ `PackMetaView`。指纹口径取 `.dsh` 的**清单白名单式**——只签 manifest 点名的文件，非全树哈希。复用现成硬零件：`fsutil.SHA256File`（全仓单一哈希源）+ `packs/classify.go:380 openContainerEntries`（zip/目录两型 pack 的统一条目枚举）。落 `dsh-market.provenance.json` 同构清单（`source/assetVersion/installedAt/files{path:sha256}`）。顺带给 `FileWithChecksum` 一个 verifier 调用者，死码转活。`requires.contracts` 能力协商映射到 `caps/scene-capability.ts:113 getMenuNodes?()` 的可选能力探测——pack 可声明「需 3D-preview，缺则降级」。
- **D3 — rtype 双数据源收敛为单同步消费**：把路径 B 折进路径 A——7 个 RPC 消费方改读 `schema.ts`/`allResourceTypes` 派生的同步视图，`services/resource-registry.ts` 随之删除或退化为薄适配（若仍需异步入口，也只作 `allResourceTypes` 的 Promise 包装、不再自持一份数据）；`web-fs.ts`/`web-common.ts` 两处重复内联指回 `schema.ts`。收益：灭 `app-preview` 📦 闪烁（改同步即无空表窗口）+ 消 4 处跨路径重复 + 去掉 7 处的 async 加载/空表/重试心智负担，终态「前端仅一处消费 JSON」。**与 D1/D2 独立**（纯前端，不依赖 mcmeta schema）。**明确不走 codegen**（与 D1 同一取向）：路径 B 的存在理由（拿全量 Go 结构）实测约 93% 虚（RPC-only 字段基本零消费），而 `schema.ts:23-38` 的 14 字段是**有意的视图子集**、非全量镜像，受「前端只读不判」红线 + `schema.ts:6-7`「前端一旦消费新字段，再补进这里」契约双重保护，漂移面本已掐住——再叠一层 `$schema`+codegen 属过度设计。

**明确不抄的**：`.dsh` 的 janitor 三旋钮（TTL / 字节预算 / LRU）——`texture_cache` 已有 1GiB + 30 天 TTL + mtime 近似 LRU + 限频 + 防重入 + >80% 告警，比 `.dsh` 成熟；剩下的「真 LRU（读命中刷 mtime）」「单键失效」是自有小改，不属本 ADR。

## 3. 后果（Consequences）

- 正面：mcmeta 4→1，消除跨语言手抄漂移；provenance 补齐 pack 完整性空白并激活 download 校验；D3 让 rtype 前端收敛为**单一同步数据源**，消双路径不一致与首帧图标闪烁；与 `MenuNode` / `settingsOrder` 范式统一，「清单即数据」一处收敛。
- 负面 / 权衡：per-pack **全树**哈希成本高、且与 `scanner.go:642` >500MB 跳哈希口径打架 → 用「只签清单点名文件」规避（`.dsh` 亦如此）；D1 采派生守卫＝**检测性**保证（漂移可拦、仍需人改，非生成物式结构免疫），且 schema 与 `check-resource-manifest.ts` 内置常量互校为两份，任一处改动须同步，否则守卫自身反成漂移源；若本仓 pack 生态基本本地自建、不分发第三方，D2 的签名/来源价值打折（但 D1 收益不受影响，故 D1 优先）；D3 依赖一个前提——未来无前端消费者需要 RPC-only 字段（`hashable`/`detector`/`priority`/`mod` 等），若需要则按 `schema.ts:6-7` 契约补进视图子集即可、非结构性风险。**`dirLevelSync` 已裁决为「删」**：全仓 `.dirLevelSync` 仅 `store.ts:30` 一处写、零处读（`renderer` 只取 `id`/`name`/`icon`，`renderer.ts:119-122`）；「文件夹行 + 展开」实由 Go 每条 `SyncItem.isDir`+`children` 驱动（`GetInstanceSyncStatus` 返回，`store.ts:58-61`），非类型级旗标；测试 `index.test.ts:386` 标题的「dirLevelSync」是旧 renderer 历史误称、新 renderer 已切 `isDir` 契约（其 `:405-406` 注释自证），`_typeConfig` 里的 `dirLevelSync:true` 为惰性入参。故 D3 落地时从 `_typeConfig` 投影（`store.ts:30`）+ 形状声明（`self-type.ts:24`/`index.ts:64`）摘除该字段，不补进 schema 子集，零行为变更（Go 侧真值源 `resource_types.json` 的 `dirLevelSync` 活用于 `go/sync/sync_dirlevel.go`，不受前端删投影影响）。
- 已知遗留：D2 依赖 D1 的清单先落地才有挂载 schema；`dedup` 仍无 per-pack 视图、`importer` 导入链零哈希——留独立决策，本 ADR 不吞。
- D1 已知遗留：守卫覆盖**形状漂移**，未覆盖 **web 模式对 Go 解析逻辑的镜像重复**（`frontend/src/parsers/pack-meta.ts` 的 `descText` / `formatRangeToPair` 复刻 `go/types` 的 `descString` / `FormatRange.UnmarshalJSON`）。这层是 web/desktop 双实现成本（`ADR-143 §1.3` 同诉），属 ADR-049/070 的解析收敛范畴、非 schema-codegen 可解——另立决策，本 ADR 不吞。
- D3 已知遗留：D3 收敛的是**数据进入前端的路径数**，不涉及债 A 那类**跨语言行为孪生**（`utils/resource/types.ts` 的 `matchZipEntryTS`／`resolveTypeByPath` 是 Go `types.MatchZipEntry`／`detectByPathDisambiguation` 的「平移」手工镜像）——那是 ADR-070 行为收敛范畴、非数据源问题，本 ADR 不吞。

## 4. 数据溯源

- 来源：pack 目录 / zip 条目（`openContainerEntries`）→ 对 manifest 点名文件逐个 `SHA256File`。
- 中间：`resource-manifest` JSON schema（canonical 形状事实源）→ `check-resource-manifest.ts` 派生守卫对账 `Go PackMeta` / `PackMetaView` / `TS parser` 三层（D1，非代码生成）；provenance 清单 `{source, assetVersion, installedAt, files{path→sha256}}`（D2）；`resource_types.json` 前端消费统一经 `schema.ts` 单点内联派生（D3，废 Go RPC 旁路）。
- 结果：pack 实例携带「类型元数据 + 文件级指纹清单」，download 校验器按指纹判完整性、`caps` 按 `requires.contracts` 判能力降级；rtype 表在前端只经**一条**同步路径进入、无第二份数据。

<!-- 文件名: resource-manifest-single-source.md → 实际文件 ADR-269-resource-manifest-single-source.md -->
