# ADR-345：禁用态是一等公民：目录粒度启禁同步与实例侧禁用载体识别

- **状态**：✅ 已采纳
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：目录粒度禁用（YSM/MMD 模型夹、资源包夹）在 toggle 两方向均静默失效，面板又把「实例已禁用」误报成待推送并诱使推送另建同名活跃副本（模型复活 + 残留）
- **相关**：`ADR-038`（D2/D3.7 `.json` 放行与目录级禁用扫描口径）、`ADR-064`（同步对比单点化）、`ADR-344`（dirLevel 单元保层级与去重）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

禁用态有**两种载体**：文件级（`a.pmx` → `a.pmx.disabled`）与**目录级**（模型夹 `X/` → `X.disabled/`；YSM/MMD 的模型夹、资源包夹都只能整夹禁用）。文件级链路可用（实测仓库活跃 + 实例 `.ban` → 启用 1 个），**目录级整条缺失**，且缺失分三段叠加：

1. **仓库侧看不见**：`scanner_scan.go|processScanDirEntry` 对目录名带禁用后缀者 `SkipDir`（ADR-038 D3.7 的刻意选择——目录级禁用模型不得作为活跃条目进模型列表）。`SyncToggleStatus` 的仓库索引正建立在同一个 `scanFn` 上（`sync.go|collectToggleRepoIndex`）→ 仓库里被禁用的夹**在索引里根本不存在**。实测：仓库只有 `X.disabled/` 时索引为空、直接返回「仓库中未找到模型文件」；仓库另有活跃模型时索引非空，但禁用夹无任何条目。
2. **实例侧看不见**：`sync.go|collectToggleFileInfos` 只收文件（`d.IsDir()` 直接 return），且 `registry.IsDisableSuffix(p)` 只看**尾段**——`X.disabled/ysm.json` 的尾段是 `ysm.json`，判不出「它在一个已禁用的夹里」。于是目录载体在两条边都不可见，`planToggleRenames` 走到 `continue`（静默），调用方拿到 `0/0/nil` 报「同步完成」。实测：仓库 `X.disabled/` + 实例 `X/`（应禁用）→ `0/0/nil`，实例仍活跃；仓库 `X/` + 实例 `X.disabled/`（应启用）→ `0/0/nil`，实例仍禁用。**两个方向都静默失效**。
3. **面板把「实例已禁用」误报成「待推送」，诱使推送复活**：单元键 `relKeyDirLevel` 剥掉尾段禁用后缀 → 仓库 `X/` 与实例 `X.disabled/` 同键 → 单元判 Synced。但 `instance.go|appendOneItem` 算实例侧路径是**盲 join**（`filepath.Join(instDir, rel)`，不看载体）→ 该路径不存在 → `buildDirLevelChildren` 拿到空实例侧 → 全部子项 missing → 父夹提升 `diverged`（待推送）→ 用户点推送 → `InstallDirRelLocked` 另建 `customDir/X/`，而 `X.disabled/` 原样残留 = **模型被静默复活 + 实例里出现同一模型的两份副本**（一份活跃一份禁用）。

## 2. 决策（Decision）

### D1 目录粒度启禁同步：真值取**文件系统探测**，不取 scanner 索引

`SyncToggleStatus` 的目录候选与判定不走仓库索引（scanner 看不见禁用目录，无法修），改为：

- **实例侧**（`sync.go|collectToggleFileInfos`）：walk 时把**目录**也作为候选发出（`toggleFileInfo.isDir`）。目录名带禁用后缀者标记 `isCurrentlyBanned=true` 并 `SkipDir`（改名会搬走整棵子树，下钻产生的文件候选路径在改名后立即失效）；其余目录 `isCurrentlyBanned=false`。回收站/relink 备份守卫对目录同样生效（原先只对文件）。
- **判定**（`sync.go|planToggleRenames` 目录分支）：对候选的相对路径 `rel`，用 `fsutil|DisabledTwinForms` 探仓库侧同一路径的活跃/载体**两种目录形态**——**恰好一侧存在**才判 `matched`，据此决定整目录改名方向；两侧并存或都不存在 → 不动（保守，宁可不动作也不猜）。`SyncToggleStatus` 因此把 `filesRoot` 透传给阶段 3。
- 代价：每个实例目录 2 次 `os.Stat`（无仓库 walk、无哈希），外加「索引为空」时一次短路目录名探测（D5）。收益：不依赖任何缓存口径，禁用载体是文件系统事实。

### D2 禁用载体的单点谓词：`fsutil|DisabledTwinForms` / `DisabledDirCounterpart` / `DisabledAncestorPath`

`fsutil` 持三个同族谓词（后缀表经 `registry|DisableSuffixes()` 取副本，禁止各包内联拼 `.disabled`/`.ban`）：

- `DisabledTwinForms(path)` — 一次报告两种**目录**形态：活跃是否存在、禁用孪生是否存在。两个布尔**互相独立**——这是复核 P1-1 的教训：把「活跃存在」短路进载体探测，会让「活跃与载体并存」不可见，调用方于是把并存当成「应活跃」，**强制启用用户既有的禁用载体**（探针实证 禁用 0 启用 1）。
- `DisabledDirCounterpart(path)` — 单答案场景（「这个位置当前是不是一个禁用载体」）：活跃存在则 false，**并存也 false**；需要区分并存的调用方必须用 `DisabledTwinForms`。
- `DisabledAncestorPath(root, target)` — 沿 `root→target` 逐段探测，命中即返回「载体 + 剩余段」的**实际路径**。为什么必须上溯祖先（复核 P1-2）：实例把**容器夹**整体禁用（`X.disabled/`，模型夹在其下 `X/sub`）时，只查单元自身路径（`X/sub` 与其孪生）全落空 → 面板判待推送、推送新建活跃副本。这三个谓词都**限定目录**：同名杂散**文件**（恰好叫 `X.disabled`）不构成「整夹被禁用」的意图，按它把活跃夹整夹改名/拒绝推送是数据事故（复核 P2-1）。

### D3 面板认载体：实例侧路径解析走 D2（含祖先），禁用单元不进待推送

`instance.go|appendOneItem` 计算实例侧路径后过 `DisabledAncestorPath(c.instDir, instPath)`：命中则子项 diff 以**载体路径**为基准（内容一致 → 子项 synced，不再全 missing），且该单元标 `SyncStatusDisabled`（⛔）。语义：面板的 ⛔ 从此表示「该单元在实例侧是禁用态」，与 `foldUnit` 的中立规则一致——禁用内容**绝不进待推送/一键安装清单**（否则就是静默复活）。

配套：**dirLevel 单元键逐段去禁用后缀**（`registry|StripDisableSuffixSegments`）。禁用载体可出现在任意祖先层级，只剥尾段会把 `X.disabled/sub/` 与 `x/sub/` 算成两个键 → 同一模型被判「幻影 Missing + Extra」（Extra 还带可拉取按钮，一拉就把 `.disabled` 载体名复制进仓库）。

### D4 推送不得复活：目标侧（含祖先）禁用孪生存在即拒绝

`sync_push.go|installDirUnitLocked` 在落位前用 `DisabledAncestorPath(customDir, dst)` 探测目标链：命中即**拒绝**（`AppError{ErrInvalidPath}`，建议文案为「先在仓库侧触发一次启禁同步把实例侧启用状态同步过来，或手动改名后再推送」——⛔ 行本身没有动作按钮，措辞不得暗示面板可一键启用）。同时把 `PushResources` 的目录分支改为调用同一函数——此前它自带第三份「rel 计算 + basename 回退」判定（ADR-344 D3 已收敛一半），现在落位判定全仓单点。

### D5 空索引不再无条件早退

`collectToggleRepoIndex` 原在「仓库索引为空」时直接报「仓库中未找到模型文件」。scanner 对禁用目录 `SkipDir` → **仓库里只有禁用夹时索引必空**，早退会让禁用方向依旧静默失效（复核 P2-2 探针实证）。现补 `sync.go|hasDisabledDirCarrier`（命中即短路的目录名探测）：只有禁用载体的仓库照常走目录候选，真正空的仓库仍报错。

## 3. 后果（Consequences）

**正面**

- 目录粒度禁用两方向都真正生效（实测预期：禁用方向实例 `X/` → `X.disabled/`；启用方向 `X.disabled/` → `X/`），且返回值不再谎报（真正的动作才计数）。
- 「实例已禁用」不再被面板误报为待推送，一键安装不再另建活跃副本；即使用户走行内推送/拖拽，也在落位前被明确拒绝而不是静默复制一份。
- 落位判定从三份收敛为一份（`installDirUnitLocked`），ADR-344 D3 的「同一判定」承诺才真正兑现。

**负面 / 代价**

- toggle 每目录候选 2 次 stat（原本 0 次）：实例目录树规模下可接受，换来不依赖缓存口径的真值。
- 面板 ⛔ 的语义扩展为「实例侧禁用也算」——与「仓库侧 `.disabled`」同图标同中立规则；前端零改动（`SyncStatus` 值域不变）。

**已知遗留**

- **仓库侧禁用夹仍不进模型列表/搜索**（ADR-038 D3.7 不变）：本 ADR 只让*同步链*看得见载体，不让*展示链*把它当活跃模型。想要「禁用也显示」需另立 ADR（属展示口径，牵动树/搜索/统计）。
- **两条 dirLevel 信道对禁用载体的 raw status 仍不同**：生产链（scan 反推，`BuildSyncItems`）里 scanner 已 `SkipDir` 掉禁用载体，故单元 raw status 是 `missing`；Walk 回退信道因键逐段归一（D3 配套）判 `synced`。**面板显示经 D3 统一为 ⛔**（两条信道都过 `appendOneItem`），故用户可见面一致；但断言 raw status 的测试必须分信道写，别把两者当同一口径。
- 目录载体与活跃目录**同时存在**（`X/` 与 `X.disabled/` 并存）时保守不动作，且面板只会显示其中一个（键同）——残留副本需用户手动清理；本 ADR 只保证「不再新造副本」。
- **⛔ 行没有启用动作**（`frontend` 的 `actionBtnHTML("disabled")` 返回空）：实例侧禁用的单元，用户侧出口是「在仓库树对同一模型切换启禁触发一次同步」或手动改名；`resourcepack`/`shaderpack` 等**非 dirLevelSync** 类型连 toggle 链路都不覆盖（`toggleSyncTargets` 只遍历 dirLevel 类型），只剩手动改名。给 ⛔ 行加「仅实例启用」按钮属产品决策，另立条目。
- `.ban`（历史后缀）在目录级同样兼容，但统一收敛到 `.disabled` 的方向不变（`planToggleRenames` 改名恒用 `registry.DisabledSuffix()`）。

## 4. 数据溯源

| 来源（病灶/观察） | 结论（本 ADR 的哪个决策） |
|------------------|--------------------------|
| 探针 P5：仓库 `X.disabled/ysm.json` 经 `scanner.ScanEntriesWithHit` **零条目** | D1：目录真值不能取 scanner 索引 |
| 探针 P1/P2：两个方向均 `0/0/nil`（仓库只有禁用夹时报「未找到模型文件」） | D1/D5：目录候选缺失 + 空索引早退 |
| 探针 P3：文件级 `a.pmx.ban` → 启用 1 个（正常） | 划定范围：只补目录粒度，不动文件级链路 |
| `sync.go|collectToggleFileInfos` 只收文件 + `IsDisableSuffix` 只看尾段 | D1：实例侧目录候选 + `SkipDir` |
| `sync.go|planToggleRenames` 三处静默 `continue` | D1：目录分支 + 明确的 matched 判据 |
| 复核 P1-1：`DisabledCounterpart` 活跃存在即短路 → 「并存」不可达，实例被强制启用（禁用 0 启用 1） | D2：`DisabledTwinForms` 两布尔独立 |
| 复核 P1-2：容器夹被整体禁用时 `X/sub` 自身孪生不存在 → 面板 diverged + 推送复活（探针实证） | D2/D3/D4：`DisabledAncestorPath` 上溯祖先 |
| 复核 P2-1：仓库侧杂散**文件** `X.disabled` → 活跃模型夹被整夹改名禁用 | D2：谓词限定目录 |
| 复核 P2-2：仓库只有禁用夹 → 空索引早退，禁用方向仍失效 | D5：`hasDisabledDirCarrier` |
| 复核 P3-1：目录候选进阶段 2 → `computeHash(目录)` 恒空串、白付一次 open | D1：目录跳过哈希预计算 |
| 复核 P1-2 的键面：`X.disabled/sub/` 与 `x/sub/` 不同键 → 幻影 Missing+Extra（Extra 可拉取会把载体名复制进仓库） | D3 配套：`StripDisableSuffixSegments` |
| `fsutil|IsRelinkBackupPath`（路径形态谓词收在 fsutil 的先例） | D2：同族谓词 |
| `registry|DisabledSuffix` 私有化先例（2026-09-14 防改写） | D2：`DisableSuffixes()` 返回副本 |

<!-- 文件名: disable-state-first-class.md → 实际文件 architecture/ADR-345-disable-state-first-class.md（ADR-320 architecture 全量模板） -->
