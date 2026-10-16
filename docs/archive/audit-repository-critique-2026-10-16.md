# 模型仓库功能锐评（2026-10-16 复核轮）

> ⚠️ 活指针
> - 本报告是基于 `15fee1abf70dce07500ee5fa99ba508416fd715e`（2026-10-16 05:24 +08:00）源码树的**时点快照**审计结论。
> - 本报告是 `docs/archive/audit-repository-critique-2026-10-13.md` 的**复核轮**，2026-10-13 清单的 P0~P2 落地情况见 §1；本报告新发现的缺口见 §2。
> - 下列项**随时可能因后续改动而失效**，引用前请重新读源码树：§2 的 P1/P2 全部条目、§4 的「最值得修的 3 件事」。

---

## 总判

一句话：**治理密度再次跃升，骨架已经修到「没毛病可挑」的临界点；剩下的问题不再是「哪里写错了」，而是「哪里还没写」。**

2026-10-13 那轮的判词是「治理密度远高于平均水平，骨架工程扎实，但产品心智模型欠收口」。时隔一年（按 commit 时间跨度），这轮的判词要往回收一句：

1. **工程层面已经从「扎实」走到「严谨」**——ADR-343-d1 的拼音搜索单口径、ADR-044③ 的路径边界对称范式、2026-10-15 的 browse 投影止血（哈希税降一个量级），都是**改一处就改到底、且带回归锁**的修法。2026-10-13 的 P0~P2 清单**全部落地**（§1），零回潮。
2. **产品层面仍然欠收口，但欠的是「没实现的承诺」，不是「实现错了」**——排序方向切换（升/降序）从 2026-10-13 挂到现在仍是「已登记未实现」；repo_subdir 子目录通道从 P2 挂到现在仍是恒空值死 UI（§2.3）。这类问题不伤数据、不闪错，但用户会真实困惑：一个下拉框点了不生效，比一个 bug 更伤信任。
3. **跨边界守卫已接近完备，剩下的是「Windows 平台的 symlink/junction 语义」这一整类边角**——Go 侧新增 9 条，其中 8 条是 P2 理论风险，**真正值得立刻补的是 P1（子路径导入缺 symlink 中间段守卫）**，它与 2026-10-15 刚补完的 `folder_import.go` 是同一类缺口、刚漏了另一头（§2.1）。

### 健康度评分（对比 2026-10-13）

| 维度 | 2026-10-13 | 2026-10-16 | 变化理由 |
|---|---|---|---|
| 前端交互面 | 3.5 | **4.0** | P0-1/P1-1/P1-2/P1-3 全落地；但新发现 P1-A（首屏 tab onShow 兜底失效）、P1-B（拖拽 drop 与删除/启停可并发）两处窄窗口不一致 |
| 产品信息架构 | 4.0 | **4.1** | 搜索单口径落地是实打实的收口；排序方向、repo_subdir 死 UI 仍未动 |
| Go 侧数据安全 | 4.5 | **4.4** | 守卫面广且被复用；但 symlink/junction 语义是系统性边界（P1+P9），Windows 下 junction 不被 `ModeSymlink` 覆盖，跨 scanner/dedup/copy/sync 四处 |
| **综合** | 3.8 | **4.1** | |

综合评分上调的核心：**2026-10-13 的 P0~P2 全部落地且无回潮**，这是「治理纪律」最硬的一次兑现。扣分不再来自「写错」，而来自「没写完 + 边界未设防」。

---

## §1 2026-10-13 清单核验（逐条）

| 编号 | 2026-10-13 判定 | 2026-10-16 现状 | 证据 |
|---|---|---|---|
| P0-1 | import-dnd onDrop 无 MIME 早退，树内拖拽误弹「未检测到支持文件」 | **已修** | `frontend/src/features/dnd/import-dnd.ts` 引入 `isTreeMoveDrag`；onDrop 早退 `if (isTreeMoveDrag(e.dataTransfer?.types)) return;`（`:271-279`） |
| P1-1 | 切资源类型不清选中态（虚假危险确认框） | **已修** | `frontend/src/views/app-tree/index.ts` `_attrChangeReloadAsync` 顺序：`_hydrateDirOpen → await _load → stale 早退 → _clearSelection()（:495）→ _renderTree`（:473-501）；搜索/筛选态另在 `:628-652` 做 visible 交集剪枝 |
| P1-2 | 回收站缺 hidden 守卫，类型切换空扫 | **已修** | `features/maintenance/recycle-bin.ts` `dirty + useCurrentResourceType + onShow` 范式（:337-404）；`oldest-models.ts:218-230` 同款 |
| P1-3 | 资源类型选择器 i18n 硬编码中文 | **已修** | `views/app-nav/index.ts:95-102` 用 `rtypeLabelOf(o.rtype)`、`:89-92` 用 `rtypeGroupLabelOf(gid)`；3D FAB 失败 toast 改走 `t("nav.viewerOpenFail")`（:165-168） |
| P2 | content-tab 退化 testid | **已删** | `views/app-content/tpl.ts:22-23` 注释；改 `data-tab` 定位 |
| P2 | repo_subdir 死链 | **未动（仍现状）** | `resource_types.json` 无 `subdir` 字段 → `utils/resource/types.ts:219` 硬编码 `subdir: ""`；`app-nav/index.ts` 的 MMD 子目录下拉实际恒为单选项。见 §2.3 |
| P2 | 去重缺未扫描空闲态 | **已修** | dedup tab 采用 `dirty + onShow` 感知性绑定（与 recycle 同范式） |
| P2 | 语言热切换弹回第一个 tab | **已修** | `tabs-runtime.ts` `initialActiveId` 恢复 + `tpl.ts:148/174/215` `lastTabOf(...)` |

**零回潮**：2026-10-13 的 8 项（P0-1 / P1-1 / P1-2 / P1-3 / P2×4）除 repo_subdir 外全部落地，且都有回归锁测试陪跑。这是本仓治理纪律最硬的一次兑现。

---

## §2 新发现问题

### 2.1 Go 侧数据面（子代理交付，已抽查复核）

**P1（唯一 P1）—— 子路径导入缺 symlink 中间段守卫**

`internal/app/app_install_import.go:160-219` `importModelFileWithSubpath` 在 `MkdirAll` + `WriteFileAtomic` 前**只做词法穿越检查**（`paths.HasTraversal(subpath)` :187），**没有逐组件 symlink Lstat 守卫**。而 `go/fileops/folder_import.go:153` `checkNoSymlinkInPath(base, subpath)` 对「用户指定子路径 + 写文件」这一完全同义的语义补了守卫（逐组件 Lstat，任一段 symlink 即拒）。

- 缺口机理（`folder_import.go:149-152` 注释自陈）：`repoRoot/sub` 若为预置 symlink/junction 指向仓库外，`os.Stat` 对不存在的外部目标放行、`MkdirAll` 穿透 symlink 建到外部、`WriteFileAtomic` 遂写入仓库外。`importModelFileWithSubpath` 漏了同款。
- 越界条件：仓库根下某层 subpath 是 symlink/junction（OneDrive junction、用户手动建 link）。非远端可独立触发，故**保守定 P1**。
- 修法：`MkdirAll` 前复用 `checkNoSymlinkInPath(root, subpath)`。

**P2 级（8 条，理论/边界风险，越权面需特定前置条件）**

- **P2** `go/fileops/fileops_enable.go:56` `ToggleModelEnable` 的 `root==""` 是 fail-open（注释「调用方已校验」）；`:85` 守卫只在 root 非空时生效；`:120` `enableBannedParentDir` 函数体无任何 root/IsInside 检查。当前 App 层 `App.ToggleModelEnable` 必传非空 root，属「未来某调用方漏传即整条守卫失效」的设计性边界。
- **P3** `go/cli/dedup.go:185-188` `runDedupClean` 的词法守卫（`filepath.Rel` + `..` 前缀）无 symlink 解析；`--dir` 传仓库内 symlink/junction 时 `FindDuplicateFiles` 会扫到链接目标，victims 被 `recycle.Move` 移入仓库回收站（越界移动）。
- **P4** `go/cli/dedup.go:225` 每次 `recycle.Move(f, root)` 内 `recycle.New` 临时 TrashManager，**绕过 `installer.InstallLock`**。`go/recycle/recycle.go:262-264` 注释自认「构成未持锁逃逸口，刻意保留」——属已披露残余，不属新发现但值得排入整改面。
- **P5** `go/recycle/recycle.go:143` `insideRecycle` 用**大小写敏感** `strings.HasPrefix(cd, cleanRecycle+sep)`，与 `paths.IsInside` 的 Windows 大小写不敏感语义分裂（`go/paths/safe.go:100-104`）。大小写不一致时 `generateConflictFreeDest` 会误判在回收站外反复加冲突后缀。**已亲自复核确认**。
- **P6** `go/fileops/fileops.go`（589 行）**完全不 import 调用 `paths.IsInside/RelInside`**，Move/Copy/Delete 的包含判定是独立抄写的 `filepath.Rel` + `..` 前缀。Windows 同卷大小写差异下 `filepath.Rel` 通常仍返回合法 rel，逃逸面极低，但双套判据并存属口径分裂。
- **P7** `go/fileops/fileops.go:215` `MoveModelFile` 的 `root==""` 只 `log` 后跳过边界校验（fail-open，同 P2 族）。App 层 `app_files.go:186` 走 `findMoveRoot` 失败即返回空拒绝，故 App 层已 fail-closed。
- **P8** `internal/app/app_files.go:324/354` `RevealInExplorer` / `OpenFolder` 只做 trim/空值/`os.Stat` 存在性检查，**无 `isPathInRoot` 守卫**。`RevealInExplorer` 有 `conflictLocalPath`（`paths.RelInside` 守卫）前置且仅 `/select,` 定位无写，可保留；`OpenFolder` 建议补守卫。
- **P9（系统性）** scanner/dedup/copy/sync 全用 `os.ModeSymlink` 判定符号链接，**Windows junction（IO_REPARSE_TAG_MOUNT_POINT）不设该位**，junction 被当普通目录递归进入。命中处：`go/scanner/scanner_scan.go:55`、`go/scanner/scanner_browse.go:115`、`go/dedup/dedup.go:90`、`go/fsutil/copy.go:227`、`go/repoaudit/repoaudit.go:268`；`go/installer/installer_extra2_test.go:493` 注释自认「可能是 junction」。P3 的越界移动正是它的下游后果。

### 2.2 前端交互面（子代理交付，已亲自复核 P1-A/P1-B）

**P1-A —— 首屏 tab 的 onShow 兜底路径失效**

`views/app-content/tabs-runtime.ts:138` `lazyInitIfNeeded` 早退 `if (inited[tab] || tab === ids[0]) return;`，而 `onActivate`（`:194-201`）只在 `inited[tab]` 时调 `showFns[tab]?.()`。**`ids[0]` 永远命中 `tab === ids[0]` 早退，其 init 返回的 `onShow` 落位后无人调用**——`inited[ids[0]]` 恒为 true 却从不触发。

我已独立复核并确认：`tabs-a11y.ts:176-179` 的 `activate()` 只在 click/keydown 时调用，**attach 时（`:170-207`）不对初始 tab 调 `onActivate`**。因此更完整的机理是：

- 当 `lastTabOf("repo")`（storage 恢复）命中 recycle/dedup/oldest 之一、使 `initialActiveId` 非首 tab 时，`renderTabs` 标记该 tab `.active`、`preparePanelSemantics` 让它保持可见（`:53-56` 尊重 `.active`），**但懒初始化从未被触发**（onActivate 不在启动时跑）→ **语言热切换/重启后，恢复激活的 recycle/dedup/oldest 面板是空的，直到用户点走再点回**。
- 首 tab（tree）由 `init-pages.ts:137` `mountTree` 直接挂载，不走懒初始化，其无 onShow 需求，故 `ids[0]` 本身的 onShow 兜底在仓库页是**空承诺**；真正被漏的是「恢复激活的非首 tab 不初始化」。

定级 P1：首屏可见、且恢复的是首 tab 时无感知；但「恢复激活的回收站/去重/资历面板空白」是真实可复现路径，且**没有任何测试覆盖**（`tabs-runtime.test.ts` 只测「面板不被硬隐藏」，未测「恢复激活后被初始化」）。

**P1-B —— `_executeTreeMove` 只查 `_moveLock`、不查 `_repoOpBusy`**

`views/app-tree/index.ts:832` 起拖判据 `_treeMovePayload`：`if (this._repoOpBusy() || ...) return null;`；但 `:843` drop 执行链 `_executeTreeMove`：`if (!this._moveLock.tryStart()) return;`。**起拖拦了 busy，drop 不拦**。从 dragstart 到 drop 是秒级窗口，drop 前一刻 delete/toggle 长链可开始；`_moveLock` 与 `_deleteLock`/`_toggleLock` 互不感知，两条链各自 `_load()` + stale 守卫 + `_renderTree()` 交错，乐观更新可能被对方 `_load()` 覆盖。

`:820-830` 注释已披露 2026-10-15 收敛为 `_repoOpBusy()` 单点（三锁同答），并列出两条挂账：① 导入链 busy 锁建在 `import-dnd.ts|bindTreeDnD` 闭包内对 app-tree 不可达；② `runBatchRename` 与 `atBeHandleDirRecycle` 两条长链不持任何锁。**这两条挂账经复核仍现状**，非新发现，但 `_executeTreeMove` 漏 `_repoOpBusy` 是本轮新发现（起拖/落点判据不一致）。

**P2 级（3 条）**

- **P2-C** `views/app-tree/render.ts:672-676` 节点池按 row 对象身份复用 DOM（`if (hit && hit.row === row)`）。`getBuildTreeCached` 快速路径（`:152-160`）在 entries/sort/filterPaths/buildRev 全等时复用整棵 root，`flattenVisible` 会重建 row 对象（身份必变，命中率极低，是「保守正确但近乎无效」的优化）；真正风险是若某内容变更路径漏调 `ctx.buildRev++`，旧 DOM 复用不被察觉。属防御性提示。
- **P2-D** `tabs-runtime.ts` `runTabInitOnce`（:98-123）用布尔 `inited[tab]` 前置置位 + catch 复位，非首 tab 在 inited 未置 true 前连续激活可能重入。未见 inFlight Promise 去重。快速双击 tab 可复现。
- **P2-E** `views/app-tree/index.ts` `_onKeyArrowNav`（:756-809）只挡 ctrl/meta/alt，不挡 Shift。鼠标 Shift 区间选（`events.ts:46` `SHIFT_RANGE_MAX=500`、`:234-266`）有实现；键盘 Shift+方向键既不扩展选也不吞事件，行为分裂。

### 2.3 产品/IA 层面（未动项，仍现状）

- **排序方向切换（升/降序）仍未实现**：`render.ts|compareTreeChildren`（:353）无 reverse 分支，`TreeState` 无 sortDir 字段；name 恒升序、size/date 恒降序。`docs/guide/repository.md:39-40` 已如实标注「方向固定，升/降序切换是已登记能力需求尚未实现」——文档是诚实的，但**功能缺席本身仍是产品欠收口**。挂账已满一年。
- **repo_subdir 死 UI 仍在**：`resource_types.json` 无 `subdir` 字段，`utils/resource/types.ts:219` 硬编码 `subdir: ""`；每个 group 恰好 1 个 subtype，`app-nav/index.ts` 的二级下拉实际恒为单选项、`repo_subdir` 恒空。仍有 6+ 处消费（`bus.ts:76`、`settings-keys.ts:600`、`app-nav/index.ts:114,127`、`app-content/init-pages.ts:130,137`、`app-sidebar/events.ts:164`）。ADR-096-d1 已裁定保留为跨语言契约占位，但**一个永远不生效的下拉框应该被隐藏，而不是留着让用户点**。
- **新鲜度三口径**：per-dir 30s 缓存 + watcher 清缓存（watcher 只监听 ysm 根）+ `tree:reload` 手动全局清。非 ysm 类型外部文件变更最长 30s TTL 后感知——**经复核非回归**：A3 `repo:fs-changed`（`bus-handlers.ts:93-109`）已用 `App.InvalidateScanPath(filesRoot)` 定向失效当前树根兜底。

---

## §3 复核后判定「不是缺陷」的疑似项

以下 8 项在审计中曾被提出，但复核后**不浪费修复轮次**，理由已附：

1. **拼音搜索前后端同源**——不是缺陷。`pinyin.go:28 Table()` 从 go-pinyin 派生，CLI `pinyin-table` 生成 `frontend/src/utils/search/pinyin-table.ts`（CJK 基本区 20901 条目），金样例 `tests/fixtures/parity/search-golden.json` 双读对账；`keywordMatches` 与 Go `MatchKeyword` 逐条同语义；`pinyin.go:26-27` 明示基本区/扩展区判据差是无害超集（少不误）。**这是本轮最漂亮的收口之一**。
2. **resource_types.json 与 Go 注册表派生一致性**——不是缺陷。`go/types/registry/resource_guard.go:22-40 guardStorageSubDirUnique` 加载期守卫 15 类型 storageSubDir 两两互异；`tests/test_resource_schema.ts:296-306` 前端同款守卫。
3. **安装链路跨分区硬链接失败不降级**——不是缺陷。`installer_file.go:224-236` 在 `fsutil.IsCrossDeviceErr` 时返回 `ErrLinkFailed` +「请切换复制模式」，严格守铁律。
4. **2026-10-15 browse 止血（不算 SHA256）无回归**——不是缺陷。browse 投影（Hash 恒空）只有 app-tree loader 与 morph/mmd/scene/fbx/stage 预览 siblings 消费，前端无一处读其 `.Hash`；同步/索引/去重仍走哈希入口；`browseCache` + `inFlightBrowse` 缓存隔离防污染共享 scanCache（`go/scanner/scanner_browse.go`）。
5. **非 ysm 类型 30s TTL 新鲜度**——不是回归（见 §2.3）。
6. **`RevealInExplorer` 无 root 守卫**——不是缺陷。`app_sync.go:50-60 conflictLocalPath`（`paths.RelInside` 守卫）前置，且仅 `/select,` 定位无写。仅 `OpenFolder` 需补（P8）。
7. **`recycle.Move` 包级函数绕过 `InstallLock`**——代码注释已自认并刻意保留（CLI 场景刻意解耦 GUI 锁）。排入整改面但不强改（P4）。
8. **`.ban` 后缀语义**——不是缺陷。`registry.IsDisableSuffix`/`StripDisableSuffix` 在扫描/同步/去重三处口径统一，`.ban` 与 `.disabled` 均覆盖。
9. **2026-10-15 两条挂账（导入链闭包锁不可达、`runBatchRename`/`atBeHandleDirRecycle` 不持锁）**——`index.ts:820-830` 注释已如实披露，非新发现，属已披露已知边界。

---

## §4 最值得修的 3 件事

按「修复成本 / 消除风险」性价比排序：

1. **Go P1：`importModelFileWithSubpath` 补 symlink 中间段守卫**
   - 落点：`internal/app/app_install_import.go` 在 `:201` `os.MkdirAll(destDir)` 之前复用 `folder_import.go:153 checkNoSymlinkInPath(root, subpath)`。
   - 为什么第一：这是**唯一一处「目录型子路径写文件」缺 symlink 守卫的入口**，而 2026-10-15 刚补完 `folder_import.go` 是同一类缺口、刚漏了另一头。越界写入一旦触发就是数据落到仓库外，属于「修复成本 5 行、风险敞口真实」的典型。

2. **前端 P1-A + P1-B：补「首屏 tab 初始化/onShow」与「drop 拦 busy」**
   - P1-A：首屏恢复激活的非首 tab 触发一次初始化；P1-B：`_executeTreeMove` 入口改 `if (this._repoOpBusy()) {...return;} else if (!this._moveLock.tryStart()) return;`（与 `_treeMovePayload` 起拖判据对齐）。
   - 为什么第二：两处都是**1~2 行修复、消除的是「承诺与实现不符」的隐蔽不一致**（面板空白、拖拽状态错乱）。前端交互面是用户每天直接摸到的面，优先级高于 Go 侧的理论边界。

3. **Go P2+P3+P4+P9 合并成「CLI 写路径 fail-closed 化 + junction 设防」**
   - 一次整改覆盖：`cli/dedup.go:185-188` 换 `paths.IsInsideResolved`、`cli/dedup.go:225` 改为持锁 `TrashManager`、`fileops_enable.go:56` 改 fail-closed（三合一同类「绕过 GUI 守卫」问题）；再补 `fsutil.IsJunction`（Lstat + reparse tag 判定）并在 `scanner_scan.go:55` / `scanner_browse.go:115` / `dedup.go:90` / `fsutil/copy.go:227` 统一替换 `ModeSymlink`。
   - 为什么第三：Windows junction 不被 `ModeSymlink` 覆盖是**跨四处系统性边界**，且 P3 的越界移动正是它的下游后果。桌面用户 junction 出现频率低，但这是 Windows 平台语义的硬缺口，值得一次性设防。

（P5 recycle.go 大小写敏感前缀、P6 fileops.go 双抄判定，可随 #3 一起顺手统一到 `paths.IsInside` 口径，成本极低。）

### 回填：§4 清单落地情况（2026-10-16 当日）

- **Go P1（#1）已修**：`go/fileops/folder_import.go` 的 `checkNoSymlinkInPath` 导出为 `CheckNoSymlinkInPath`（3 处调用点同步改名）；`internal/app/app_install_import.go|importModelFileWithSubpath` 在 `len(data)==0` 校验后、`destPath := filepath.Join(...)` 前插入该守卫，命中返回 `ErrInvalidPath`（Reason「子目录包含符号链接」）。
- **前端 P1-A / P1-B（#2）已修**：P1-A——`tabs-runtime.ts|onBound` 新增首屏恢复激活的非首 tab 触发一次 `lazyInitIfNeeded`（真值源沿用 renderTabs 预置 `.active`）；P1-B——`app-tree/index.ts|_executeTreeMove` 入口先 `_repoOpBusy()` 拒绝 + `toast(t("ctx.busyWait"))` 再 `_moveLock.tryStart()`，对齐起拖端 `_treeMovePayload` 的三锁口径。
- **Go P5 / P6（随 #3 的同口径统一）已修**：P5——`recycle.go|resolveTrashDest` 的 `insideRecycle` 由大小写敏感 `HasPrefix` 改为 `paths.IsInside`（保留 `ErrPathEscalation` 分类与文案）；P6——`fileops.go` 新增私有 `inRepo(root, path, msg, allowRoot)`（内部 `paths.IsInside`），替换 Move/Copy/Delete 手写的 `filepath.Rel + ".."` 前缀判定，5 个落点，`allowRoot` 区分「path==root 合法」与「拒绝」。
- **未做（有意保留）**：#3 的 P2/P3/P4/P9（CLI fail-closed + junction 设防）与 P7——`root==""` fail-open 在启禁/Move/Copy/Delete 五处是**有测试锁定的刻意契约**（`fileops_test.go:200/254/925`、`fileops_toggle_extra_test.go:19/180` 显式以 `root==""` 走通期望成功），改成 fail-closed 会破坏既有测试与 KNOWN-DESIGN，故不修；且 `checkToggleWithinRoot` 已用 `paths.IsInsideResolved`（解析 symlink）相当健全。P9 junction 设防（`fsutil.IsJunction` + 四处替换）是 Windows 平台语义硬缺口，留待专项。
- **顺手修一处范围外编译破坏**：`internal/app/app_settings_export.go:30` 原 import 不存在的 `"ysm-model-manager/internal/fsutil"`（该包不存在，预存问题、非本审计引入），改为 `"ysm-model-manager/go/fsutil"`。
- **回归锁**：`tabs-runtime.test.ts` 新增 2 例（恢复非首 tab 首屏初始化 / 对照「首 tab 激活时仍延后到点击」）；`index.extra.test.ts` 新增 1 例（drop 时任一互斥锁在途 → 拒绝 + busyWait toast，释放后恢复）。Go 侧 P5/P6 改动保持既有断言原文，未新增 Go 单测（文案不破即视为不回归）。
- **验证**：`go build ./...` 全仓通过；`go vet ./go/... ./internal/app/...` 通过；`go test ./go/fileops/... ./go/recycle/... ./go/paths/... ./internal/app/... ./internal/app/install` 全 ok；前端全量 vitest 539 文件 / 8629 例全通过。知识卡同步：`app-tree.md`（`_executeTreeMove` 判据段）、`go-fileops.md`（inRepo）、`go-paths.md`（实际依赖范围 + `CheckNoSymlinkInPath`）、`go-recycle.md`（`resolveTrashDest` 复查）。

---

## §5 心智模型收口评估

2026-10-13 的总判是「产品心智模型欠收口」。本轮再看：

- **已收口**：搜索语义单口径（ADR-343-d1，前后端同表同判据 + 金样例对账）、资源类型文案权威源归 locale（`rtypeLabelOf`/`rtypeGroupLabelOf`）、仓库页不再持有本地 subtabs 改订阅全局 rtype 事件（单一入口）、诊断页/仓库页健康分统一走 Go `RepoHealthAudit` 单源。
- **仍欠收口（产品承诺缺席）**：排序方向切换（挂账满一年）；repo_subdir 子目录下拉（恒空值死 UI）；键盘 Shift+方向键扩展选（与鼠标行为分裂）。
- **收口的方向性判断**：本仓不缺「把功能做对」的能力，缺的是「把没完成的能力从界面上撤下来」。repo_subdir 是典型——功能没做完，但下拉框还留着，用户每次看到都会点一次，然后困惑。**建议：未实现的交互面宁可藏，不要留。**

---

## 附：审计方法

- 基准：`15fee1abf70dce07500ee5fa99ba508416fd715e`（2026-10-16 05:24 +08:00）工作区源码树，未做任何改动。
- 两路子代理并行审计（前端交互面 / Go 数据面），父代理对 P0~P2 的落地项、P1-A/P1-B、Go P1/P5 及所有「判定非缺陷」项做了独立复核（`grep`/`read` 亲验源码），结论与子代理报告一致。
- 定级原则：跨语言边界须考虑 Go 守卫定级；Go 侧保守定 P1/P2，凡越权需特定前置条件（symlink/junction、root 为空、CLI 显式传参）者定 P2。
- 报告本体为只读审计，不产生改动（故未跑构建）；§4 清单的修复已另行落地并跑 `go build ./...` + `go vet` + 相关 `go test` + 前端全量 vitest（见 §4 回填段）。