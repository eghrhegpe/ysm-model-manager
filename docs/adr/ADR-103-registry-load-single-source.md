# ADR-103：注册表加载单源化与僵尸覆盖分支清理

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-058 纯exe内嵌数据, ADR-092 资源类型分组路由, go/types/resource.go, embed.go, internal/app/resource_bindings.go`

---

## 0. 后续变更记录 (2026-08-21 更新)

> **⚠️ 重要**：本 ADR 中关于 `MMDSubDirs()`、`IsSubDirGrouping`、`subDirGrouping` 类型的描述已过时。
> - 这些函数/类型已在后续的架构扁平化中被全部移除。
> - 当前的真实机制是：`EnsureStorageDirs` 遍历**注册表中全部类型**，对每个类型调用其 `instanceDir` 实现来确定需要创建的目录。
> - MMD 的 8 个用途子目录（EntityPlayer/SceneModel/.../shader）现在是 JSON 中**8 个独立的顶级资源类型**，而非 `mmd-skin` 的子类型。
> - 这意味着「MMD 子目录预建」的逻辑已从「硬编码遍历 `MMDSubDirs()`」变为「遍历注册表中 mmd 组所有类型的 `instanceDir`」，完全注册表驱动。

---

## 1. 背景（Context）

`resource_types.json`（仓库根，单一事实来源）是资源类型注册表的权威定义。但**运行态加载长期走一条多源优先级链**，在「纯 exe 嵌入发布」（ADR-058，2026-08 起）之后逐渐腐化：

旧 `go/types/resource.go` 的 `loadRegistryBytes()` 优先级为：
1. `SetRegistryPath` 显式绝对路径（仅测试 / 显式覆盖）；
2. **exe 同级 / 上级目录扫描** `resource_types.json`（旧 zip 部署模型残党）；
3. 编译期嵌入单源 `bundledRegistryJSON`（由根 `embed.go` 注入，等同仓库根 JSON）；
4. 测试回退 `../../resource_types.json`。

问题症结：
- **优先级 2 是僵尸分支**。ADR-058 已决策「不再读取 exe 旁/上级目录，updater 不再覆盖 exe 旁文件」，但 `loadRegistryBytes` 的 exe 旁扫描**从未随部署模型升级而删除**——一份「无写者、无同步、却优先级高于嵌入单源」的影子文件长埋其中。
- **`bin/resource_types.json` 是 stale 快照**：Aug 10 生成、0 个 `group` 字段（旧 schema），被优先级 2 最先命中，静默遮蔽嵌入单源。
- **直接后果**：
  - 用户「主推 6 次 Minecraft / Minecraft-Mod / MMD 分类与路由改动均失败」——改的是仓库根 `resource_types.json`，但运行态永远读 `bin/` 下这份无人维护的旧镜像，`group` 字段恒为空；
  - 保存根路径后 `EnsureStorageDirs` 按 `group=""` 生成单层扁平目录（`ysm`/`resourcepacks`/`mmd`…），而非预期的 `minecraft-mod/ysm` / `minecraft/resourcepacks` / `mmd/EntityPlayer` 两层树；日志铁证：`[storage] EnsureStorageDirs: id=mmd-skin group="" sub="mmd" groupRoot="mmd"`。

## 2. 决策（Decision）

将注册表加载收敛为**单一权威源**，永久掐死静默遮蔽式漂移：

1. **移除 exe 旁目录扫描（僵尸分支）**。`loadRegistryBytes()` 优先级精简为：
   `SetRegistryPath 显式绝对路径（仅测试/显式覆盖）` → **编译期嵌入单源 `bundledRegistryJSON`（唯一权威）** → 测试回退 `../../resource_types.json`。
   嵌入即权威：构建即同步，改 root JSON 重编译即生效，不再有「改了不生效」的影子文件。
2. **删除 stale 快照** `bin/resource_types.json`（本地构建产物，未追踪，删除不入版本库）。
3. **单源化底座（前置 ADR-103 依赖项，已先行落地）**：
   - `go/types` 目录 `//go:embed` 被 Go 工具链整体忽略（环境级限制，已隔离诊断确认），故走**根 `embed.go` 嵌入 root `resource_types.json` + `types.SetBundledRegistryJSON` 注入**的等价单源，删除旧手工副本 `resource_types_embed.go`；
   - `internal/app` 的 `LoadResourceTypes` / `DetectResourceType` / 同步状态加载改为复用 `types.BundledRegistryJSON()` / `types.LoadRegistry()`，避免双嵌；
   - 一致性测试 `resource_types_consistency_test.go` 改为「root JSON ↔ `LoadRegistry()` 双路径结构体逐字段比对」+ `TestMain` 注入测试基线，漂移归零。
4. **预建目录补齐（让单源路由在磁盘可见）**：
   - 新增 `App.EnsureStorageDirs()`：遍历注册表所有类型，对每个 `rt` 经 `GetRepoRoot(rt.ID)` 取目标目录（各类型独立路径覆写优先），非空则 `os.MkdirAll`；在 `SaveAppConfig` 的 `rootChanged` 分支（`restartWatcher` 之后）调用，仅改根路径时铺整棵类型树，幂等安全；
   - **`subDirGrouping` 类型铺满全部用途子目录**：MMD（`mmd-skin`）的磁盘结构为 `FilesRoot/mmd/{用途子目录}`，用途子目录由 `go/types` 的 `MMDSubDirs()` 单一事实来源定义（共 8 个：`EntityPlayer` / `SceneModel` / `DefaultAnim` / `CustomAnim` / `StageAnim` / `DefaultMorph` / `CustomMorph` / `shader`）；`EnsureStorageDirs` 对 `IsSubDirGrouping` 类型遍历 `MMDSubDirs()` 铺满，原 `storageSubDir="EntityPlayer"` 仅为默认展示槽非全貌。

## 3. 后果（Consequences）

**正面**：
- 注册表加载仅余一条权威路径，彻底消灭「改 root JSON 不生效」「大类→小类被弹平」「新格式同步卡死」三类历史顽疾；
- 「多源设置」意图（外部覆盖 / updater 热补）在现状下已无合法写者，单源化是针对当前纯 exe 部署模型的**正确收敛**；
- 预建目录使 `FilesRoot` 设置保存后立即生成完整两层类型树（含 MMD 8 用途子目录），体感从「选完路径树不出现」转为「无缝衔接」。

**负面 / 注意**：
- 牺牲了「exe 旁文件覆盖内置注册表」的热更通道——但 ADR-058 已判定该通道在纯 exe 模型下应废弃，本 ADR 只是**补全其未执行的部分**；
- 若未来确有「用户/插件侧覆盖注册表 / 注入新类型」需求，必须**重新引入覆盖通道且遵守三条纪律**：① 覆盖源有明确写者（构建脚本 / 生成器 / updater）；② 带版本戳或 hash，加载时校验新鲜度，陈旧即告警而非静默命中；③ 优先级上嵌入单源兜底、覆盖仅作显式选择，绝不默认遮蔽。

**已知遗留**：
- 存量旧单层目录（`ysm`/`resourcepacks`/`mmd`… 空壳）不会自动迁移，需用户手动清理（联邦安全规则：AI 不代删个人目录文件）；
- 当前运行进程缓存旧注册表，须重启 `wails dev` / 重新 `wails build` 后方生效。

**设计复盘（回应「多源是否败笔」）**：
- 多源**意图合理**（12-factor 配置外置、updater 热补本属先进）；
- 本项目的失败是**执行走形 + 时代化石**：覆盖源无写者 / 无同步 / 却优先级高于权威源，且部署模型切换（zip→纯 exe）时该分支未退役，最终反噬系统；
- 结论：非纯粹败笔，而是「属于旧时代的机制在时代切换时未被清理」。本 ADR 之价值不在否定多源思路，而在拔除一条**既无写者又压在权威源之上的僵尸分支**。

## 4. 数据溯源

- 来源：`go/types/resource.go` `loadRegistryBytes()` 优先级链 → 结果：优先级 2 的 exe 旁扫描为旧部署残党，无生产写者。
- 来源：`internal/app/bundled_data.go:4` 注释「2026-08 起纯 exe 发布：zip 不再附带数据 JSON、updater 不再覆盖 exe 旁文件」→ 结果：优先级 2 在该注释生效时已无存在理由，属未清理僵尸。
- 来源：运行时日志 `[storage] EnsureStorageDirs: id=mmd-skin group="" sub="mmd" groupRoot="mmd"` → 结果：`group` 字段运行态为空，加载源非嵌入单源。
- 来源：`go/types/routing_dump_test.go`（`TestDumpRouting`，编译态）输出 `id=mmd-skin GroupStorageRoot="mmd/EntityPlayer"` → 结果：编译态源码 + root JSON 路由正确两层，与运行态矛盾，锁定「运行态读的是另一份」。
- 来源：`ls bin/resource_types.json`（Aug 10，**0 个 `group` 字段**）vs `resource_types.json`（root，8 个 `group`）→ 结果：`bin/` 那份 stale 快照被优先级 2 最先命中，静默遮蔽嵌入单源。
- 来源：`go/types/extensions.go` `mmdSubdirNames`（8 用途子目录）→ 结果：抽为规范的 `MMDSubDirs()` 单一来源，`EnsureStorageDirs` 据此铺满 MMD 物理树。

<!-- 文件名: registry-load-single-source.md → 实际文件 ADR-103-registry-load-single-source.md -->
