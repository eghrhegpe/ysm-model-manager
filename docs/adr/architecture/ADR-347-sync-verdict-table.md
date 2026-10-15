# ADR-347：go/sync 同步判定收敛单表（纯函数判定表 + 全信道测试矩阵）

- **状态**：✅ 已采纳
- **日期**：2026-10-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：公共契约变更（fileLevel/dirLevel/Oversize/键碰撞四信道判定入口收单一）+ 难逆转（重构后散落判定删除，回退须 revert）
- **相关**：`ADR-064`（同步对比单点化）、`ADR-269`（内容级判定）、`ADR-340`（Diverged 子集）、`ADR-344`（dirLevel 两层判定）、`go/sync/sync_diff.go`、`go/sync/sync_dirlevel_diff.go`、`docs/knowledge/go-sync.md`（及其三张 leaf 卡）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

「两侧各是什么状态 → 该判什么同步状态（Synced / Missing / Diverged / Extra / Disabled）」的答案目前**散在 4~5 个判定片**里，没有单一入口：

| 判定片 | 位置 | 管的碎片 |
|---|---|---|
| `contentDiffers` | `go/sync/sync_diff.go`（ADR-269 / 340-d2） | 两侧有哈希比哈希 → 单侧无哈希回退比 Size → 同大小判 Synced；同键内容异补 Diverged（Missing 子集） |
| dirLevel 两层判定 | `go/sync/sync_dirlevel_diff.go`（ADR-344 D1/D2） | 文件单元比内容（哈希优先 / Size 兜底 / 任一侧超限保守判 Missing）；目录单元存在性语义（scan 信道产不出折叠指纹，不比内容） |
| Oversize / 折叠指纹 | `DiffEntry.Oversize` + `FoldDigest`（ADR-269 D2′-b/c） | 容器 zip 走折叠指纹；`DiffFolderContents` 逐子文件判定 |
| 键碰撞 | `go/sync/sync_dirlevel_sync.go\|upsertDirLevelUnit`（2026-10-14 P0 fail-loud） | 同键不同 Rel last-write-wins 覆盖事件 → `ResourceSyncResult.Warnings` |

**病根**：每加一条新信道（哈希、折叠指纹、…），都要人肉核对**每个**散落判定片是否同步升级——漏一片即静默判定退化。ADR-344 D1 的实证就是此类 bug 的标本：dirLevel 单元表当初只有 key 存在性判定（无内容字段），「平铺模型改内容恒判 Synced」潜伏到被 2026-10-13 锐评逮住才修。`go-sync` 知识卡十几条不变量，本质上是在用卡片给这张**不存在的判定表**做口述——口述会漏、会脱节（`check-knowledge-drift` 只验符号存在性，看不见正文断言）。

## 2. 决策（Decision）

**D1 单一纯函数判定入口（判定表）**。`go/sync` 新增判定表（落位文件名实施时定，如 `verdict.go`）：输入 = 两侧单元的完整状态结构体（有无哈希、哈希产出的**信道**、Size、是否超限、是否目录单元、是否跨格式同键、同键碰撞事件），输出 = `(状态, 理由字符串)`。理由字符串进诊断信道（日志面板 / 体检 / 未来面板），与 P0 键碰撞 `Warnings` 同族——「假绿」从此**可见可审**。

**D2 所有既有判定片改为判定表消费者**，旧散落判定逻辑删除：
- `contentDiffers` 对外契约（返回 bool，`ResourceDiff` 调用点）不变，内部委托判定表；
- dirLevel `dirLevelDiffEntries` 的内容字段填充与逐文件判定（`DiffFolderContents`）收敛到同一单点；
- 键碰撞判定（`upsertDirLevelUnit` 的覆盖事件记录）保持 collect 层单点不变，其产出的碰撞清单仍是诊断信道（D1 不改变 P0 已落地的 fail-loud 形态）。

**D3 全信道测试矩阵 = 语义锁**。矩阵维度：`{两侧哈希: 双有 / 单侧 / 全无} × {超限} × {目录单元} × {跨格式同键} × {嵌套回退}` → 期望状态，每行一个用例。**先对现行实现跑矩阵钉基线（全绿 = 今天语义的快照，含没人说得清的边缘行为）→ 重构 → 矩阵复跑**——重构正确性的证据是矩阵前后全绿，不是「看起来等价」。

**D4 信道强度 = 显式入参**。判定表签名里「哈希是哪条信道产的、是否超限」是**输入字段**而非调用点隐式约定：未来加信道 = 加一个字段 + 矩阵加一行。静默判定退化（D3 之前的假绿形态）在签名层面被结构挡住。

**范围边界（不做什么）**：本 ADR 是纯重构 + 诊断增强——不改变任何判定结果（矩阵锁死）、不新增信道（每条新信道仍单独立项）；`pushTargets` 三路展开（ADR-310 §3，消费端）、目录单元存在性语义（ADR-344 D2）、`.disabled`/`.ban` 跨链语义（批 C 裁决范围）一律不动。

## 3. 后果（Consequences）

**正面**

- `go-sync` 卡群（hub + 三 leaf）的十几条不变量缩成「表的列头 + 矩阵行号」；未来加信道认知成本从「核对 N 处散落判定片」降为 O(1)（签名 + 一行矩阵）。
- 判定理由字符串进诊断信道，为「假绿系统性化（failure receipts）」铺路——体检报告可挂「本次判定用了哪条信道、为何如此判」。
- 矩阵是活的：新信道 / 新维度进矩阵即进回归，替代「卡片口述 + 人肉核对」。

**负面 / 代价**

- 1~2 天工作量，大头在矩阵用例枚举与等价性验证（基线全绿是硬门槛，任何边缘行为脱谱都是矩阵没枚举全）。
- 判定入口是高耦合点：回归面 = 四信道全量（fileLevel / dirLevel / Oversize / 碰撞）+ 面板链 30s 缓存语义不变（缓存值型 `dirLevelCacheValue` 不动）。

**已知遗留**

- 判定表只管「两侧状态怎么判」，不管「判完怎么装」（`pushTargets` 展开是消费端，语义在 ADR-310 §3）。
- 键碰撞 `last-write-wins` 的匹配语义（跨格式同身份归一）不重裁——本 ADR 只把碰撞**记录**归入判定表输入面，覆盖行为维持 P0 裁定的 fail-loud。
- `.disabled`/`.ban` 后缀的跨链语义差异（剥后缀 vs 保留）仍是批 C 的裁决范围，判定表只按现行 `relKeyDirLevel` 口径承接。

**回退**：revert 实施提交区间（旧散落判定代码全在 git 历史，判定表与其等价矩阵一并回退；矩阵文件可保留作回归资产）。

## 4. 数据溯源

| 来源（病灶 / 观察） | 结论（本 ADR 的哪个决策） |
|---|---|
| `go/sync/sync_diff.go\|contentDiffers`（ADR-269 / 340-d2 判定片段） | D1：收进判定表 |
| `go/sync/sync_dirlevel_diff.go\|dirLevelDiffEntries`（ADR-344 D1/D2 两层判定） | D1 输入字段（目录单元 / 超限）+ D2 消费者 |
| `go/sync/sync_dirlevel_sync.go\|upsertDirLevelUnit`（2026-10-14 P0 键碰撞 fail-loud） | D1 碰撞输入面；D2 记录单点不动 |
| ADR-344 D1 实证：dirLevel 单元表无内容字段 → 「平铺模型改内容恒判 Synced」假绿潜伏期 | D4：信道强度显式化，签名挡静默退化 |
| `docs/knowledge/go-sync.md` 卡群十几条不变量（卡片口述判定规则，check-knowledge-drift 看不见正文断言） | D3：矩阵 = 不变量的可执行化（卡改引表列头） |
| 2026-10-13 锐评「模型仓库功能」P3 计划项（P0~P2 已于 2026-10-14/15 落地，P3 待立项） | 本 ADR 整体 |

<!-- 文件名: sync-verdict-table.md → 实际文件 architecture/ADR-347-sync-verdict-table.md（ADR-320 architecture 全量模板） -->
