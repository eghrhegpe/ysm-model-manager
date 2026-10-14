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
- **判定**（`sync.go|planToggleRenames` 目录分支）：对候选的相对路径 `rel`，探测仓库侧 `repoRoot/rel`（活跃形态）与 `repoRoot/rel+后缀`（载体形态，`.disabled` 优先、`.ban` 兼容）——**恰好一侧存在**才判 `matched`，据此决定整目录改名方向；两侧都存在或都不存在 → 不动（保守，宁可不动作也不猜）。`SyncToggleStatus` 因此把 `filesRoot` 透传给阶段 3。
- 代价：每个实例目录 2 次 `os.Stat`（无仓库 walk、无哈希）。收益：不依赖任何缓存口径，禁用载体是文件系统事实。

### D2 实例侧禁用载体的单点识别：`fsutil|DisabledCounterpart`

新增 `fsutil.DisabledCounterpart(path) (string, bool)`：`path` 本身不存在、而 `path+.disabled`/`path+.ban` 存在时返回后者。与 `fsutil|IsRelinkBackupPath` 同族——把「路径 → 孪生形态」的判定收在 `fsutil`，`go/instance` 与 `go/sync` 共用，禁止各自内联拼后缀（后缀表归 `registry`，无环：`registry` 不依赖 `fsutil`）。

### D3 面板认载体：实例侧路径解析走 D2，禁用单元不进待推送

`instance.go|appendOneItem` 计算实例侧路径后过一遍 `DisabledCounterpart`：命中则子项 diff 以**载体路径**为基准（内容一致 → 子项 synced，不再全 missing），且该单元标 `SyncStatusDisabled`（⛔）。语义：面板的 ⛔ 从此表示「该单元在实例侧是禁用态」，与 `foldUnit` 的中立规则一致——禁用内容**绝不进待推送/一键安装清单**（否则就是静默复活）。

### D4 推送不得复活：目标侧禁用孪生存在即拒绝

`sync_push.go|installDirUnitLocked` 在落位前检查目标 `customDir/<rel>`：目标不存在而其禁用孪生存在时**拒绝**（`AppError{ErrInvalidPath}`，文案指向「先在仓库侧启用以便同步禁用态，或手动改名后重推」）。同时把 `PushResources` 的目录分支改为调用同一函数——此前它自带第三份「rel 计算 + basename 回退」判定（ADR-344 D3 已收敛一半），现在落位判定全仓单点。

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
- 目录载体与活跃目录**同时存在**（`X/` 与 `X.disabled/` 并存）时保守不动作，且面板只会显示其中一个（键同）——残留副本需用户手动清理；本 ADR 只保证「不再新造副本」。
- `.ban`（历史后缀）在目录级同样兼容，但统一收敛到 `.disabled` 的方向不变（`planToggleRenames` 改名恒用 `registry.DisabledSuffix()`）。

## 4. 数据溯源

| 来源（病灶/观察） | 结论（本 ADR 的哪个决策） |
|------------------|--------------------------|
| 探针 P5：仓库 `X.disabled/ysm.json` 经 `scanner.ScanEntriesWithHit` **零条目** | D1：目录真值不能取 scanner 索引 |
| 探针 P1/P2：两个方向均 `0/0/nil`（仓库只有禁用夹时报「未找到模型文件」） | D1：目录候选缺失是根因 |
| 探针 P3：文件级 `a.pmx.ban` → 启用 1 个（正常） | 划定范围：只补目录粒度，不动文件级链路 |
| `sync.go|collectToggleFileInfos` 只收文件 + `IsDisableSuffix` 只看尾段 | D1：实例侧目录候选 + `SkipDir` |
| `sync.go|planToggleRenames` 三处静默 `continue` | D1：目录分支 + 明确的 matched 判据 |
| `instance.go|appendOneItem` 盲 join `instDir/<rel>` | D3：走 `fsutil|DisabledCounterpart` |
| `instance.go|buildDirLevelChildren` 空实例侧 → 全 missing → 父夹升 diverged | D3：子项以载体为基准 diff |
| `sync_push.go|installDirUnitLocked` + `PushResources` 目录分支两份落位判定 | D4：单点 + 目标禁用孪生拒绝 |
| `fsutil|IsRelinkBackupPath`（路径形态谓词收在 fsutil 的先例） | D2：DisabledCounterpart 同族 |

<!-- 文件名: disable-state-first-class.md → 实际文件 architecture/ADR-345-disable-state-first-class.md（ADR-320 architecture 全量模板） -->
