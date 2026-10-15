# YSM 模型管理器 · 整合包功能设计锐评报告

> 审查身份：资深产品功能架构评审（聚焦功能集与用户旅程，不重复已处置的代码级缺陷）
> 审查范围：整合包管理的完整用户旅程——导航入口、侧栏列表（`app-sidebar/*`）、同步面板（`app-sync-manager/*`）、批量推拉（`sidebar-push.ts` / `sidebar-pull.ts` / `sync-flow.ts`）、右键菜单（`context-menu/menu-defs.ts` + `pack-ops/instance-ops.ts`）、拖拽导入（`features/dnd/pack-dnd.ts`）、冲突解决（`app-content/diagnostics/conflicts.ts`）、重链接（`app-content/settings/init.ts`）、启动器检测（`app-sidebar/launcher-detect.ts`）、Go 侧状态模型（`go/types/types.go` / `go/instance/*`）
> 行号基准：以 `git` 工作区现行为准（app-sidebar index.ts 371 / events.ts 409 / tpl.ts 318 / sidebar-push.ts 248 / sidebar-pull.ts 165 / sync-flow.ts 145 / loader.ts 159 / launcher-detect.ts 151；app-sync-manager renderer.ts 472 / index.ts 373 / events.ts 216 / tpl.ts 214 / store.ts 162；menu-defs.ts 277 / instance-ops.ts 148；conflicts.ts 372；settings/init.ts 540；nav-items.ts 39；app-content/tpl.ts 557；resource_types.json 493 行 / 15 类型）
> 对照文档：`docs/guide/pack-sync.md`（69 行）
> 说明：本报告为纯设计审查，未修改任何代码、未提交。与 2026-10-16 已处置的 `integration-pack-fe-review.md`（前端同步设计代码缺陷）与 `integration-pack-go-review.md`（Go 架构）在**层级上隔离**——本报告评「功能集与用户旅程」，不重复其 P0-1..P0-4 / P1-2 / P2 各项的结论。

---

## 0. 总览：功能面地图与旅程快照

```
入口  导航侧栏「🎮 整合包管理」  ──  can("ListVersionInstances") 门控，Viewer 整入口隐藏（nav-items.ts:24-39）
列表  app-sidebar：卡片 = 名称 + 三色徽章 + 无模组灰标 + 底栏「完全同步 x/y」+「🎮 未设置」
空态  就地配置：🔍 自动搜索（GetMinecraftPaths）/ 🎮 HMCL·PCL 检测（DetectLauncherInstances）
面板  app-sync-manager：六状态 tab（全部/已同步/待推送/已禁用/可拉取/旧仓库遗留）+ 行级 push/pull
批量  勾选 → 「⬆️ 推送所选 ▾ / ⬇️ 拉取所选 ▾」菜单（全部 + 6 显式 + 9 兜底 = 16 项）
右键  打开文件夹 / 复制清单 / 清空（走回收站）—— 3 项（menu-defs.ts:98-146）
拖拽  pack-dnd：OS 文件拖到卡片 → ImportFileAndPushToInstance / ImportFolderAndPushToInstance
跨页  冲突解决（诊断页 conflicts.ts）、重链接（设置页 set-relink）、启禁手动对齐（仓库树页 app-tree）
```

**六状态语义的三处读数（同一物理事实 → 三套口径）**：

| 层 | 词表 | 维度 | 出处 |
|---|---|---|---|
| Go 侧栏计数 | `InstanceStatus.Status` = complete/missing/extra（missing 已折叠 diverged，ADR-310） | 3 值 + HasMod | `go/types/types.go:305-318`、`go/instance/status_counts.go:111-121` |
| Go 面板树 | `SyncStatus` = synced/missing/optional/disabled/legacy/diverged | 6 值 | `go/types/types.go:415-448`、`go/instance/instance_tree.go` |
| Go 结果桶 | `ResourceSyncResult` = Synced/Missing/Extra/Diverged（⊂Missing） | 4 桶 | `go/types/types.go:362-371` |

展示端：**面板**六 tab 与 guide 文档六态表自洽（diverged 折叠进 missing 但行级图标/颜色/确认框单独处理）；**侧栏**三色徽章是面板六态的投影子集（无 disabled / 无 legacy / diverged 折进 missing 红）。两处由不同 Go 入口驱动（`GetResourceInstanceStatus` 三值计数 vs `GetInstanceSyncStatus` 六态树），**同一整合包在两个视图给出不同读数是设计事实**。

---

## 1. P0 — 核心旅程断裂 / 状态语义不自洽

### P0-1　「完全同步」判定忽略 disabled / legacy：一个全禁用的整合包在侧栏显示为「完全同步 ✓」

**位置**：`app-sidebar/events.ts:394-409`（`bindFooter`：`instances.filter(ins => (ins.missing||0)+(ins.extra||0)===0).length` 的「完全同步 x/y」统计，:401-403）；徽章渲染 `app-sidebar/tpl.ts:289-318`（`instanceCardHeaderHTML`：synced>0 绿 / missing>0+hasMod 红 / extra>0 橙 / noMod 灰 / allZero 显示 success SVG「完全同步」）；数据层 `app-sidebar/data.ts:15-26`（`SidebarInstance` **已有 `disabled` 字段**（:24）但侧栏展示零消费——仅 loader 状态映射 `status: missing|extra|complete`（:20））。

**问题**：底栏与卡片的「完全同步」判定只认 `missing + extra === 0`，**不感知 disabled（仓库侧 .ban）与 legacy（整合包多出的旧硬链接）**。场景：
1. 整合包内 YSM 资源全部被仓库侧禁用（`.ban`）→ `status_counts.go` 里这些单元进 disabled 桶、不进 missing/extra → 侧栏该包显示「完全同步 ✓」绿标，用户从列表看一切正常，点进面板才发现「已禁用」tab 下全是灰标文件。
2. 整合包多出大量 legacy 旧硬链接（`instance.go:181` nlink>1 → legacy）→ `status_counts.go:119` 把 legacy 并进 **extra 桶** → 侧栏显示橙色「可拉取」，但面板语义是「旧仓库遗留」应清理——**legacy 的「拉取到此仓库」动作被侧栏降格成普通「可拉取」**。

**根因**：侧栏徽章是「3 值 + hasMod」的**投影子集**，disabled 与 legacy 两个维度在投影时被折叠/丢弃；「完全同步」的定义（missing+extra==0）与面板六态里「disabled 不算同步、legacy 需要处理」的语义**脱钩**。

**处置建议**：
1. 「完全同步 x/y」判定改为 `missing==0 && extra==0 && disabled==0`（disabled 计数已由 `GetResourceInstanceStatus` 下发——`InstanceStatus.Disabled` 字段存在，前端 data.ts 有映射位）；徽章新增 disabled 灰标维度（复用面板 `syncManager.status.disabled` i18n，零新增 key）。
2. legacy 与 optional 在侧栏计数时**分桶**（现 `status_counts.go:119` 将两者并进 extra 桶——侧栏拿不到 legacy 独立数；若维持 Go 聚合，则至少把 extra 橙徽章 title 从「可拉取」改为中性的「整合包多出（含旧硬链接遗留）」），避免「旧仓库遗留」被误读成普通可拉回。
3. guide 文档「每张卡片显示绿=已同步、红=待推送、橙=整合包多出」需同步补充 disabled 维度说明。

**影响**：列表层（用户最先看到的一层）对「已禁用」「旧仓库遗留」两类需要动作的状态**零可见性**——状态越重越应上浮到列表，当前恰好相反。

---

### P0-2　diverged（内容分叉）是最高危状态，面板只提供「覆盖式推送」一个动作，无损解决路径跨页断裂

**位置**：`app-sync-manager/events.ts:32-67`（diverged 行 push 前弹 `modalConfirm` danger 确认，`syncManager.divergedWarnTitle/Msg`）；无损解决在 `app-content/diagnostics/conflicts.ts`（`runSyncConflictScan` → `DetectConflicts(rtype, instance)`，conflicts.ts:174-176；resolve → `ResolveConflicts` :302-305；**参数栏 #sync-rtype / #sync-instance 需手动选择**，:94-117）。

**问题**：
1. **动作面单一且破坏性**：diverged = 「两侧同名文件都改过、内容分叉」——正确产品语义是「提供保留哪一侧的选择」，当前面板行级只有 push（确认框告知「将覆盖整合包侧修改」），**没有「解决冲突」入口**。
2. **无损路径跨页且需重现场景**：真正的冲突解决（保留仓库侧 / 保留实例侧策略）在诊断页，用户要**离开整合包页 → 手动重选同一个 rtype + 同一个整合包 → 扫描 → 解决 → 回整合包页**。整合包面板已经知道 `rtype + instance`（它正在展示这个包），这个上下文却无法传导给冲突解决入口——旅程在「看到分歧」和「解决分歧」之间断线。
3. 批量推送对 diverged **无事前确认**（见 P1-2），覆盖不可逆且批量触发时用户事前无感知。

**根因**：冲突解决能力（DetectConflicts/ResolveConflicts/RevealConflictFile）被设计为独立于整合包页的诊断工具，整合包页只消费其「展示」结果（diverged 状态）而**不消费其「解决」动作**；状态语义最重的一档与动作入口物理分离。

**处置建议**：
1. 面板 diverged 行按钮从「推送」拆为「推送（覆盖）/ 解决冲突」两态：后者直接以面板当前 `rtype + instance` 为上下文调 `DetectConflicts`，在同一面板内嵌冲突清单（复用 conflicts.ts 的 `initSyncConflictPanel` 逻辑，抽成可复用组件），解决后 `bus.emit("stats:refresh")` 回读面板。
2. 若短期不做面板内嵌，至少把诊断页冲突扫描参数的默认值**取自当前整合包上下文**（通过 bus 事件 `package:selected`（`bus.ts:109`，承载 `{name, rtype}`，`init-pages.ts:72` 已订阅）传导 rtype/instance），消除手动重选。
3. 批量推送前（P1-2 关联）先对命中 `Overwrites ⊂ Missing ∪ MissingDirs` 的目标做一次事前计数确认。

**影响**：用户面对「内容分叉」只有两个选项——覆盖（确认框）或绕远路去诊断页。功能设计上，「最需要决策的状态」缺一个「就地决策」入口。

---

### P0-3　批量类型菜单粒度语义塌陷：「MMD」只代表 EntityPlayer 一类，guide 文档列出的「VRC」在注册表中不存在

**位置**：`app-sidebar/tpl.ts:59-79`（`SYNC_TYPE_MENU` 硬编码 6 项：ysm / `RESOURCE_TYPES.MMD` / pack / shader / blueprint / litematic）+ `tpl.ts:135-148`（兜底追加 `ALL_RESOURCE_TYPES` 未配置项 = 9 类）；`utils/resource/types.ts:17-33`（`RESOURCE_TYPES.MMD = "EntityPlayer"`）；`resource_types.json`（15 类型，mmd group 下有 9 个：EntityPlayer/SceneModel/CustomAnim/CustomMorph/StageAnim/mmd-shader/DefaultAnim/DefaultMorph/fbx）；guide `pack-sync.md:43`（「菜单可选类型：📦 全部类型 / 💎 YSM / 🎭 MMD / 🥽 VRC / 🎨 资源包 / ☀️ 光影包 / ⚙️ 蓝图 / 📐 投影」）。

**问题**：
1. **「🎭 MMD」菜单项只推送 EntityPlayer（角色模型）一类**，MMD 组其余 8 类（场景模型/自定义动作/自定义表情/场景动作/MMD 光影/默认动作/默认表情/FBX）要靠「全部类型」或菜单里平铺的兜底项**逐个**选——用户点「MMD」的心理模型是「同步所有 MMD 组资源」，实际只动一个类型，属**菜单粒度语义塌陷**。
2. **guide 文档列「🥽 VRC」，`resource_types.json` 无 vrc 类型**——文档-实现漂移（VRChat 类型疑似已从注册表移除，文档未同步），用户按文档找不到该项。
3. 兜底追加使菜单实际 **16 项平铺无分组**（全部 + 6 + 9），MMD 组 9 类散布，无 group 视觉分组；`fbx`（非 dirLevelSync、isDir:false）也出现在推拉菜单里，但其同步语义与目录级类型不同。

**根因**：`SYNC_TYPE_MENU` 用「短标签」（MMD）映射到**单个**类型 id，而注册表的「MMD」是一个 **group**（9 个类型）；菜单定义没有 group 维度，也没有从 `resource_types.json` 的 `group` 字段派生菜单项。

**处置建议**：
1. 菜单项改由 `resource_types.json` 的 **group 维度**驱动：MMD 组渲染为「🎭 MMD」子菜单或组标题，默认展开组内全部 9 类，推送「MMD」= 推送组内全部（对齐用户心理模型）；或至少把 `RESOURCE_TYPES.MMD` 的语义从单类型改为组展开器。
2. 同步修正 guide `pack-sync.md` 的 8 类清单（去掉 VRC、按注册表 15 类型重写，注明「MMD = 角色模型」，或按处置建议 1 改为组语义）。
3. fbx 等非 dirLevelSync 类型从批量推拉菜单隐藏（或在菜单里标记「单文件型」），避免用户对「目录级同步」与「单文件推拉」的语义混淆。

**影响**：批量操作是整合包页的核心动作面，菜单语义错误会让用户「推错范围」（少推 8 类）或「找不到项」（VRC）。

---

## 2. P1 — 明显功能体验缺陷

### P1-1　批量推拉无取消、无文件级进度——大整合包是多分钟黑箱占用

**位置**：`features/sync/sync.ts`（`downloadMissing` 批量模式：单次全量扫描 + **逐包逐文件串行安装**，恒 settle、无进度回调——模块头契约「恒 settle 的批量原子操作」）；`sidebar-push.ts:176-202`（按钮进度只有「类型 i/n」）；`sidebar-pull.ts:101-134`（按钮进度只有「包 i/n」）。

**问题**：
1. 大整合包（几百文件）推送期间，用户只看到按钮「类型 2/15」的**类型级**进度，包内文件级进展不可见；无剩余时间预估、**无取消入口**，锁被占（`_syncLock`），期间其他推拉全部拒收。
2. 超时早停（`SYNC_OP_TIMEOUT_MS`，push 侧放弃剩余类型、pull 侧放弃剩余包）虽已如实点名（ADR-340），但对大整合包是「赌 30 秒内跑完」——超时=部分放弃，用户只能重跑或改选范围。
3. 拉取侧与推送侧进度**粒度不对称**：推送按类型循环、拉取按包循环（P1-4 关联），同一「全部类型」菜单两种编排，用户对镜像操作（推/拉）的反馈预期不一致。

**根因**：批量推拉被设计为「恒 settle 的原子操作」，Go 侧 `downloadMissing`/`PullResourceFromInstance` 无进度事件回传（仅返回汇总计数）；前端在原子契约下只能显示外层循环粒度。

**处置建议**：
1. 中期：`downloadMissing` 增加可选 `onProgress` 回调（按文件计数回报），前端按钮/底栏显示「已装 N / 总计 M」；无回调时维持现有类型级进度（向后兼容）。
2. 短期：给批量操作加**取消**能力——`downloadMissing`/`runPull` 传入 `AbortSignal`（或模块级 cancel 令牌），Go 绑定接受取消（`context.Context` 风格或进程内信号），取消后如实汇总「已完成的 N 个 + 被取消的 M 个」。
3. 统一推/拉进度粒度（都按「包 × 类型」二维，或都按文件数），消除镜像操作不对称。

**影响**：整合包页服务于「把 N 个整合包 × M 类资源批量对齐」的核心场景，多分钟黑箱 + 不可取消 + 超时部分放弃，是大包/多包用户最痛的体验断点。

---

### P1-2　批量推送对 diverged（内容分叉）无事前确认——批量覆盖不可逆，行级有确认而批量没有

**位置**：`app-sync-manager/events.ts:44-61`（**行级** diverged push 有 `modalConfirm` danger 确认）；`sidebar-push.ts:176-202`（**批量**推送直接循环 `downloadMissing({instanceNames: selected, rtype: rt})`，无 diverged 预检）；`sidebar-push.ts:108-114`（`overwrites` 仅在**完成后**浮层点名，toast 用 warn 但已是完成态）。

**问题**：行级 diverged 推送有安全闸（确认框），批量「全部类型」推送**绕过**该闸——`downloadMissing` 内部按 `GetResourceInstanceStatus` 的 `Overwrites ⊂ Missing ∪ MissingDirs` 直接覆盖实例侧修改，用户勾选 5 个包 + 全部类型点推送，可能一次性覆盖数十个自己改过的文件，**事前零感知**（事后浮层才看到「覆盖 N 个」）。与「清空走回收站可恢复」相比，**推送覆盖无快照、无撤销**，恢复路径不对称。

**根因**：diverged 确认闸只挂在面板行级事件（`events.ts`），批量路径（`sidebar-push.ts` → `downloadMissing`）没有复用；`DownloadOutcome.overwrites` 是结果字段而非事前预算字段。

**处置建议**：
1. 批量推送前先做**预算**：对 `instanceNames × types` 调 `GetResourceInstanceStatus`（或轻量 `CountInstanceResources`）统计命中 `Overwrites` 的目标数，>0 时弹确认框（复用 `syncManager.divergedWarnTitle` 类文案，报「本次将覆盖 N 个整合包侧已修改文件」）。
2. 或把 diverged 预检下沉到 `downloadMissing`：返回前先算 overwrite 预算，>0 时在结果里带回 `overwritesPending`，由调用方（批量/行级共用）统一决定是否确认——消除「行级有闸、批量无闸」的规则分裂。
3. 长期：给推送覆盖加**可恢复性**（如覆盖前把实例侧副本移入回收站目录，参照 `ClearInstanceResources` 的 `recycle.RemoveRepoDuplicates` 模式），让「覆盖」与「清空」同样可恢复。

**影响**：diverged 确认闸的存在说明产品已认定「覆盖实例侧修改需确认」，批量路径绕过它 = 安全闸覆盖面不全，是「设计意图 vs 实现覆盖」的裂缝。

---

### P1-3　侧栏卡片计数语境（当前全局类型）与批量操作范围（菜单选类型）解耦——「红 3」不代表「推全部会动什么」

**位置**：`app-sidebar/loader.ts`（`loadInstances(rtype)` → `GetResourceInstanceStatus(rtypeActual, ...)`，按**当前全局类型**计数）；`utils/resource/repo-rtype.ts`（`currentRepoType()` = localStorage `repo_rtype`，默认 YSM）；`app-sync-manager/renderer.ts:184-198`（面板类型只读指示 `.sm-cur-type`，「类型选择已全局化到 nav 下拉」）；`sync-flow.ts:35-37`（`resolveTypes`：批量菜单可选任意类型）。

**问题**：
1. 侧栏卡片徽章（红 3 / 橙 2）只反映**当前 nav 类型**的同步差；批量菜单却可对**任意类型**推拉。用户看到「红 3」点「推全部类型」，实际动的是全部 15 类——**可见读数 ≠ 操作范围**，列表层给不了「推全部会动什么」的预览。
2. 类型切换在 **nav 下拉**（全局 repo_rtype），面板顶部只读指示（`.sm-cur-type`）不可点——用户在整合包语境里「想看这个包的 MMD 状态」要绕到 nav 切类型，面板内无就近切换。
3. `repo:rtype-changed` 订阅会触发侧栏/面板重载（`app-sidebar/index.ts`、`app-sync-manager/index.ts`），但卡片选中态（`sb_selectedName_${rtypeKey}`）按 rtype 隔离——切类型后选中记忆随类型隔离，用户可能困惑「刚才勾选的包去哪了」。

**根因**：类型选择是**全局单点**（nav 下拉 + localStorage），而整合包页是**按类型展示**的（卡片计数、面板列表都按类型）；全局类型与页面局部类型语境只有一个单向绑定，批量操作又独立于这个语境——三个概念（全局类型 / 面板类型 / 批量类型范围）并行，用户只有一个全局开关。

**处置建议**：
1. 批量推送/拉取确认前，在菜单或确认步展示「本次范围：N 个整合包 × M 类资源（当前类型 YSM + 你选的类型）」，把操作范围显式化。
2. 面板 `.sm-cur-type` 只读指示改为可点击，就近切到该包的其他类型（就地改 `repo_rtype`），减少 nav 绕行。
3. 文档补充「侧栏徽章按当前所选类型计数」的说明（guide `pack-sync.md` 目前未提，用户看到数字随类型变会以为数据错了）。

**影响**：整合包页的「读数」与「动作范围」错位是理解性困惑的主要来源；批量场景下用户对操作后果的预判能力弱。

---

### P1-4　「🔄 同步状态」手动对齐入口不在整合包页——guide 文档声称的面板按钮不存在

**位置**：`frontend/src/features/sync/sync.ts:380-384`（`SyncModelToggleStatusForType(rtype || "")` 消费方）；`bus.ts:122-124`（`sync:toggle:status` 事件声明）；`app-tree/*`（`bus-handlers.ts:415` / `index.ts:888` / `events.ts:129,557` 全部 emit 点）；guide `pack-sync.md:49`（「也可手动触发：同步面板『🔄 同步状态』按钮对全部整合包做一次状态对齐」）；`app-sync-manager/tpl.ts:124-136`（`containerHTML` 无该按钮）。

**问题**：guide 文档声称整合包面板有「🔄 同步状态」按钮，**实际 `app-sync-manager` 无此按钮**（`sync:toggle:status` 的生产者全在仓库树页 app-tree——树内批量/单文件开关、渲染补齐）。用户在整合包页想手动对齐启禁状态：watcher 自动生效（约 1 秒）通常够用，但**手动触发入口不在本页**，文档指引落空。

**根因**：`sync:toggle:status` 的 UI 入口随仓库树页的启禁操作自然落地（app-tree 是启禁的发生地），整合包页只被动接收 `stats:refresh` 重载；guide 文档描述的「面板按钮」是**从未实现**的设计文档残留。

**处置建议**：
1. 二选一收敛：要么在整合包页补「🔄 同步状态」按钮（emit `sync:toggle:status`，复用 `features/sync` 现有消费链，前端工作量极小——按钮 + `bus.emit`），要么修正 guide 文档改述为「在仓库页切换启禁后自动同步」。
2. 鉴于整合包页是「查看多包状态」的主页，建议**补按钮**：用户在多包视角手动对齐的需求（如一键把全部整合包的 .ban 状态与仓库对齐）天然属于本页。

**影响**：文档-实现漂移，用户按文档操作找不到入口；整合包页缺一个低成本高价值的手动对齐动作。

---

### P1-5　跨平台整页「沉默消失」——整合包入口被整体门控隐藏，无「桌面专属」可见缺席提示

**位置**：`frontend/src/views/app-nav/nav-items.ts:24-39`（`const isViewer = !can("ListVersionInstances")` → `...(isViewer ? [] : [{ id: "instances", ... }])`——Viewer 平台整入口隐藏）；对照：仓库页三 tab 均标 `desktopOnly: true` + `viewerNotice`（`app-content/tpl.ts:214-217` 诊断页有 `viewerNotice: t("diagnostics.viewerDesktopOnlyNotice")`、「网页版从『沉默消失』变『可见缺席』」ADR-300 §2.5）；`app-content/tpl.ts:171-192`（`instancesHTML` 的 tab **未标** `desktopOnly`）。

**问题**：诊断页/仓库页已按 ADR-300 原则把桌面专属功能做成「可见缺席」（tab 仍显示、带 desktopOnly 提示），**整合包页却是旧范式**：`can("ListVersionInstances")` 为假时导航入口整个消失，用户不知道有这个功能、不知道为什么没有。且门控声明在 nav 层（nav-items.ts），`instancesHTML` 的 tab 未标 desktopOnly——**门控位置与声明位置分离**，将来若 nav 门控调整（如 viewer 也显示入口），tab 层不会自动补提示。

**根因**：整合包页的平台门控沿用了最早的 `can()` 整页隐藏模式，未随 ADR-300（2026）「可见缺席」范式迁移；`instancesHTML` 未同步 `desktopOnly` 声明。

**处置建议**：
1. 对齐 ADR-300：nav 门控改为保留入口（或至少在缺失平台显示禁用态入口），页面/tab 补 `desktopOnly: true` + `viewerNotice`（复用仓库页同款文案模式）。
2. 至少把 `instancesHTML` 的 tab 声明补上 `desktopOnly`，与仓库页三 tab 同构，防门控/声明漂移。

**影响**：Android/网页版用户对整合包功能零可见性；门控与声明分离是将来回归的隐患。

---

## 3. P2 — 一致性 / 文案 / 次要体验

### P2-1　右键「清空此整合包的模型」与真实语义（只删仓库已有）不匹配，危险操作的关键语义藏在 FAQ

**位置**：`context-menu/menu-defs.ts:135-145`（「🗑️ 清空此整合包的模型」，danger）；`pack-ops/instance-ops.ts:93-147`（`CountInstanceResources` → `modalConfirm` → `ClearInstanceResources`）；`internal/app/app_install_instance.go:73-141`（`clearInstanceDir` = `recycle.RemoveRepoDuplicates(dir, filesRoot, ysmRoot)`——**只删仓库已有文件、保留整合包自带资源**）；guide `pack-sync.md:62-63`（FAQ：「只清空『仓库中已存在同名』的文件……整合包独有的文件保留不动」）。

**问题**：菜单项 label「清空此整合包的{type}」（`menu.clearPack`，zh-CN.ts:131）暗示清空全部，实际只清「仓库已有副本」——**部分删除**语义在确认框文案里已有（`inst.clearMessage` 含「未入库的文件保留不动」，zh-CN.ts:1024），但**右键菜单层**（危险动作的第一决策点）无任何范围提示，用户要点了确认框才看到「保留整合包独有」。危险动作的「范围边界」应在菜单 label 就地可见，而不是藏在确认框。

**处置建议**：菜单 label 改为「清空此整合包的{type}（仓库副本，保留包内独有）」或确认框范围说明上浮到菜单（`menu.clearPack` 文案补「保留整合包独有」），使危险操作的范围边界在决策第一点就地可见。

### P2-2　HMCL/PCL 检测「设为 YSM 资源根」隐含仓库根变更，无影响面提示

**位置**：`app-sidebar/launcher-detect.ts:112-150`（`runLauncherDetect`：勾选 `useAsYsmRoot` → `SetResourceRoot(RESOURCE_TYPES.YSM, customDir)`，失败回滚 mcRoot；勾选框文案 `launcher.picker.useAsYsmRoot`）。

**问题**：把启动器实例的 custom 目录**直接设为 YSM 仓库根**（「导入即纳管」，该实例天然全同步）是一步仓库根级变更——原 YSM 仓库根被替换，仓库视角整体改变（文件未动，但仓库指针变了）。UI 只给一行勾选框文案，无「这会改变你的 YSM 仓库位置」影响说明。对不理解仓库根概念的用户，勾选后的「仓库变成整合包目录」是意外。

**处置建议**：勾选框旁补影响提示（如「将 YSM 仓库根设为该整合包的模型目录」），或在 `SetResourceRoot` 前加确认（当前 `saveMcRoot` 已做失败回滚，属实现层防护，设计层缺告知）。

### P2-3　批量菜单 16 项平铺无分组，MMD 组 9 类散布

**位置**：`app-sidebar/tpl.ts:121-150`（`typeMenuItemsHTML`：全部 + 6 显式 + 9 兜底平铺，无 group 分隔）。

**问题**：菜单项顺序 = SYNC_TYPE_MENU 声明序 + 注册表序，MMD 组（EntityPlayer/SceneModel/CustomAnim/CustomMorph/StageAnim/mmd-shader/DefaultAnim/DefaultMorph/fbx）与 minecraft 组（ysm/资源包/光影包/蓝图/投影/车万女仆）**无视觉分组**，16 项长列表里找「场景模型」靠扫。注册表有 `group`/`groupLabel`/`groupIcon` 字段（resource_types.json:11,63,224），菜单未消费。

**处置建议**：`typeMenuItemsHTML` 按 `GROUP_OF`（types.ts:138-140）分组渲染，组标题带 groupIcon + groupLabel（复用注册表字段，零新文案）；与 P0-3 的「MMD 组展开器」方案合并考虑。

### P2-4　面板 legacy 行「拉取到此仓库」与 optional 行「拉取」视觉/语义近似，无 testid 区分

**位置**：`app-sync-manager/tpl.ts:65-82`（`actionBtnHTML`：optional → `sm-pull`（有 testid）、legacy → `pullHere`（muted 边、**无 testid**））。

**问题**：两个动作都是「拉取」但语义不同（optional=仓库缺此文件可拉回、legacy=旧硬链接遗留需清理归仓），行级样式接近（同 muted 系），无 testid 也无 title 区分——自动化断言与可访问性对 legacy 行弱。功能上可接受（guide 文档已分别解释），属一致性小瑕疵。

**处置建议**：legacy 按钮补 `data-testid="sm-pull-here"`（同步 `VIEW_TESTIDS` 注册表）与 title（`syncManager.status.legacy`），与 optional 行按钮在测试与读屏层面可区分。

### P2-5　allZero 徽章「完全同步 ✓」与「该类型下无任何资源」语义混淆

**位置**：`app-sidebar/tpl.ts:294,311-312`（`allZero = synced===0 && missing===0 && extra===0` → success SVG「完全同步」）。

**问题**：allZero 也可能是「当前类型下整合包内什么都没有」（如 MMD 视角但包内无任何 MMD 资源）——此时显示「完全同步 ✓」把「无内容」标成「同步完成」，误导。hasMod 灰标只覆盖「无 YSM 模组」情况，不覆盖「该类型目录为空」。

**处置建议**：allZero 分支区分「确实有内容且全部同步」（显示 ✓）与「该类型无资源」（显示中性空标或类型名占位）；或至少把 title 从「完全同步」改为「当前类型无差异」。

---

## 4. 处置建议汇总

| 级别 | 项 | 一句话 | 改造量 | 优先级 |
|---|---|---|---|---|
| P0-1 | 「完全同步」忽略 disabled/legacy | 底栏/徽章判定补 disabled 维度 + legacy 分桶 | 前端小 + Go 分桶中 | 高（误导最直接） |
| P0-2 | diverged 只有覆盖动作 | 面板内嵌冲突解决或传导上下文 | 中 | 高（数据安全） |
| P0-3 | 菜单「MMD」语义塌陷 + VRC 漂移 | 菜单按 group 驱动 + 文档同步 | 前端中 + 文档小 | 高 |
| P1-1 | 批量无取消/无文件级进度 | onProgress 回调 + 取消令牌 | 大（Go+前端） | 中 |
| P1-2 | 批量覆盖无事前确认 | overwrite 预算预检 | 中 | 高（与 P0-2 同源） |
| P1-3 | 计数语境与操作范围解耦 | 批量范围显式化 + 面板就地切类型 | 小-中 | 中 |
| P1-4 | 「🔄 同步状态」按钮缺失 | 面板补按钮或文档改述 | 小 | 中 |
| P1-5 | 跨平台沉默消失 | 对齐 ADR-300 可见缺席 | 小 | 低 |
| P2-1..P2-5 | 文案/分组/一致性 | 各小改 | 微小 | 低 |

**优先顺序建议**：P0-1 + P0-2 + P1-2（状态语义与数据安全，先修误导与不可逆覆盖）；P0-3（菜单语义，批量核心动作面）；P1-4 + P1-5（低成本高可见）；P1-1（大包体验，需 Go 协作排期）；P1-3 + P2 各小项随改随清。

## 5. 附：guide 文档（pack-sync.md）与实现的漂移清单

| 文档声明 | 实际实现 | 处置 |
|---|---|---|
| 批量菜单可选「🥽 VRC」 | 注册表无 vrc 类型，菜单 = 全部 + 6 显式 + 9 兜底 | 改文档（或按 P0-3 重做菜单后同步） |
| 菜单「🎭 MMD」 | 只映射 EntityPlayer 单类型，MMD 组其余 8 类需另选 | 改菜单（P0-3） |
| 「同步面板『🔄 同步状态』按钮」 | 面板无此按钮；入口在仓库树页 app-tree | 补按钮或改文档（P1-4） |
| 「每张卡片：绿=已同步 / 红=待推送 / 橙=整合包多出」 | 无 disabled 维度说明；legacy 并进橙徽章 | 补文档（P0-1） |
| 「侧栏徽章按当前类型计数」 | 未说明；用户切换 nav 类型后数字变化易误读 | 补文档（P1-3） |
