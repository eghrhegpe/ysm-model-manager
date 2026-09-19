# ADR-269：资源清单单一事实源化：mcmeta 四份手抄收敛 + pack provenance 维度

- **状态**：📝 提议中（Proposed）— 灵感风暴取证确立的方向草案，待人类首席架构师拍板后置 ✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/types/registry/resource.go PackMeta; go/types/config.go PackMetaView; frontend/src/parsers/pack-meta.ts; frontend/src/utils/format/pack-format.ts; go/packs/classify.go openContainerEntries; go/scanner/scanner.go repoIndexEntry/GenerateRepoIndex; go/fsutil/write.go SHA256File; go/download/download.go FileWithChecksum`

---

## 1. 背景（Context）

一次「隔壁 `.dsh` 架构能否借鉴」的灵感风暴，取证后撞出本仓两处真债：

- **债 A（高收益、无条件）**：`pack.mcmeta` 的形状（`pack_format / description / thumbnail / supported_formats / min_format / max_format`）现存于 **4 处手抄**——`go/types/registry/resource.go:578 PackMeta`、`go/types/config.go:112 PackMetaView`（多一 thumbnail）、`frontend/src/parsers/pack-meta.ts:107`（连限额 `:14-16` 都照搬 Go）、`frontend/src/utils/format/pack-format.ts:17`。靠 ADR-070「TS 平移 + 测试锁定」维持，**不是生成物**——四份漂移只靠注释和人肉契约测试兜底。
- **债 B（补空白）**：pack 实例**零 provenance**——全仓 `grep provenance|sourceUrl|installedAt|checksum` 对 pack 实例零命中。识别后的 pack 只有类型级配置元数据（`ResourceType`），无来源 / 版本 / 安装时间 / 文件校验。附带死码：`go/download/download.go:540 FileWithChecksum` 已写好可选 SHA256 校验，注释自认「P2 预留」、生产零调用者。

灵感来自 `.dsh` 的 `dsh-skin/v2.json` 皮肤契约：版本化清单（`skinManifestVersion`）+ `$schema` 校验 + 声明式 `contributes` + 能力协商 `requires.contracts:{apiVersion,kind,optional}` + `provenance.json`（每文件 sha256，25 项精确列举而非全树）。这与本仓 `MenuNode`「菜单即数据」、`settingsOrder`/`getEnvPlacement` 注册表驱动（ADR-268）是同一条哲学的不同投影。

## 2. 决策（Decision）

两条子决策，**可独立分阶段**（D1 不依赖 pack 是否分发第三方，优先）：

- **D1 — mcmeta 形状单一事实源化**：以一份 `resource-manifest` JSON schema 为 mcmeta 形状的 canonical 事实源，采**派生守卫**（对齐 `type-consistency.ts` 范式，fail-closed）对 `Go PackMeta` / `PackMetaView` / `TS parsePackMetaJson` 三层的字段集与归一化行为标记做三方对账，任一漂移即 exit 1 阻断；**而非 schema→code 代码生成**（JSON schema 只表达字段声明，生成不了 `descString` / `FormatRange.UnmarshalJSON` 这类解析行为；引入三方 codegen 又等于在本仓 15 个自研 gen 之外另开一套范式，净收益≈0，反成漂移源）。`PackMetaView` 定义为 `PackMeta + thumbnail` 的视图派生（唯一合法增量）。桌面模式的绑定类型另由既有 Wails `generate:bindings`（Go struct → TS，ADR-143）保证。落地 = `check-resource-manifest.ts` 接 `gate-config` 的 `ALL_STATIC_TOOLS` / `DOC_STATIC_TOOLS`（hard），纳入 `doctor --docs` + pre-push 全量门禁。
- **D2 — 引入 pack provenance 维度**：定义 `FileFingerprint{path,sha256,size}`，挂载到 `ModelEntry`（现仅一标量 `Hash`）/ `PackMetaView`。指纹口径取 `.dsh` 的**清单白名单式**——只签 manifest 点名的文件，非全树哈希。复用现成硬零件：`fsutil.SHA256File`（全仓单一哈希源）+ `packs/classify.go:380 openContainerEntries`（zip/目录两型 pack 的统一条目枚举）。落 `dsh-market.provenance.json` 同构清单（`source/assetVersion/installedAt/files{path:sha256}`）。顺带给 `FileWithChecksum` 一个 verifier 调用者，死码转活。`requires.contracts` 能力协商映射到 `caps/scene-capability.ts:113 getMenuNodes?()` 的可选能力探测——pack 可声明「需 3D-preview，缺则降级」。

**明确不抄的**：`.dsh` 的 janitor 三旋钮（TTL / 字节预算 / LRU）——`texture_cache` 已有 1GiB + 30 天 TTL + mtime 近似 LRU + 限频 + 防重入 + >80% 告警，比 `.dsh` 成熟；剩下的「真 LRU（读命中刷 mtime）」「单键失效」是自有小改，不属本 ADR。

## 3. 后果（Consequences）

- 正面：mcmeta 4→1，消除跨语言手抄漂移；provenance 补齐 pack 完整性空白并激活 download 校验；与 `MenuNode` / `settingsOrder` 范式统一，「清单即数据」一处收敛。
- 负面 / 权衡：per-pack **全树**哈希成本高、且与 `scanner.go:642` >500MB 跳哈希口径打架 → 用「只签清单点名文件」规避（`.dsh` 亦如此）；D1 采派生守卫＝**检测性**保证（漂移可拦、仍需人改，非生成物式结构免疫），且 schema 与 `check-resource-manifest.ts` 内置常量互校为两份，任一处改动须同步，否则守卫自身反成漂移源；若本仓 pack 生态基本本地自建、不分发第三方，D2 的签名/来源价值打折（但 D1 收益不受影响，故 D1 优先）。
- 已知遗留：D2 依赖 D1 的清单先落地才有挂载 schema；`dedup` 仍无 per-pack 视图、`importer` 导入链零哈希——留独立决策，本 ADR 不吞。
- D1 已知遗留：守卫覆盖**形状漂移**，未覆盖 **web 模式对 Go 解析逻辑的镜像重复**（`frontend/src/parsers/pack-meta.ts` 的 `descText` / `formatRangeToPair` 复刻 `go/types` 的 `descString` / `FormatRange.UnmarshalJSON`）。这层是 web/desktop 双实现成本（`ADR-143 §1.3` 同诉），属 ADR-049/070 的解析收敛范畴、非 schema-codegen 可解——另立决策，本 ADR 不吞。

## 4. 数据溯源

- 来源：pack 目录 / zip 条目（`openContainerEntries`）→ 对 manifest 点名文件逐个 `SHA256File`。
- 中间：`resource-manifest` JSON schema（canonical 形状事实源）→ `check-resource-manifest.ts` 派生守卫对账 `Go PackMeta` / `PackMetaView` / `TS parser` 三层（D1，非代码生成）；provenance 清单 `{source, assetVersion, installedAt, files{path→sha256}}`（D2）。
- 结果：pack 实例携带「类型元数据 + 文件级指纹清单」，download 校验器按指纹判完整性、`caps` 按 `requires.contracts` 判能力降级。

<!-- 文件名: resource-manifest-single-source.md → 实际文件 ADR-269-resource-manifest-single-source.md -->
