# ADR-351：整合包同步域锐评收口：收集层收口与判定单点化

- **状态**：🔄 部分采纳（D1/D2 已落地 2026-10-16：D1 统一剔除闸 + fail-closed 契约测试，D2 冲突通道并入判定表 + E 区矩阵；实施进度见知识卡 `go-sync` 裁定记录，本 ADR 不记进度）
- **日期**：2026-10-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：锐评实证六 Walk 收集器各自手搓回收站过滤且口径漂移（conflict 通道完全缺失）、verdict 单点化未覆盖冲突通道、扫描侧混合夹双登记由两层下游补偿——三类结构性病跨 go/sync+go/instance 两包，方向性且难逆转
- **相关**：`go/sync/ go/instance/ 知识卡 go-sync.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

2026-10-16 对整合包功能域（go/sync + go/instance + go/packs + go/installer + internal/app 绑定壳 + 前端 sync/pack-ops/视图层，约 11.8k 源码行）做全链锐评（三子代理分域深读 + 主模型逐条复核），判定内核（verdict 判定表、锁纪律、路径纵深防御）与分层纪律（依赖箭头单向、单一事实源收敛）为范本水平，但实证三类**结构性**病灶，均为「修实例不修类」的历史模式的残留：

1. **收集层手工业**：go/sync 六个手写 Walk 收集器各自复制「回收站/relink 备份跳过」SkipDir 谓词，且口径已漂移——`hasRecycleSegment` 与 `fsutil.IsRecycleDir` 两套谓词并存，conflict.go 的 collectFileEntries 完全没有该过滤（同一回收站文件在 toggle 侧被剔除、在冲突检测侧参与哈希比对）。ADR-342 修的正是「漏一处过滤」，但修法是给五个收集器逐个打补丁——下一个收集器还会漏。
2. **判定单点化未竟**：ADR-347 把内容判定收敛为 verdict.go 判定表（五信道显式），但 conflict.go 的「哈希异→冲突/哈希缺→比大小/失败→manual」三分支是与之语义同源的平行实现，fileEntryInfo/DiffEntry/dirLevelUnit 三个字段重叠结构体并存。新增信道（如 Oversize）时冲突通道不会自动跟进。
3. **扫描侧双登记、下游双层补偿**：混合夹（自身直接含平铺模型文件、又含子模型夹）被扫描侧登记两条（容器 + 自身 marker），下游树化层 absorbSelfMarker 吸收影子行（30 行注释 + 两处防御分支）、计数层 dedupeSorted 压重防「同一文件重复安装」——同一数据形状病在两层打补丁，根因未治。

同类次级问题一并记录（本 ADR 一并给出方向）：pushTargets 在计数层（go/instance）重新推导安装目标三路路由、正确性靠注释复述 go/sync 行为；目录参数四套命名（globalDir/filesRoot/repoDir × customDir/targetDir/instDir）跨文件漂移；go/instance `subtype` 参数只进缓存键不进行为（API 签名承诺了它没做的事）。

**为什么不能继续打补丁**：三类病灶的共同根因是「知识散布即漂移」——过滤知识、判定语义、登记规则各自有权威单点（ADR-342/347/310 的方向），但权威只覆盖了当时看得见的通道。每轮锐评修干净「实例」、留下「类」，残留的病恰好都是上一轮审计目光没扫到的形状。回归锁（33 个测试文件钉 go/sync）只能防复发，不能防新增。

## 2. 决策（Decision）

**方向：把「每处自己写一份」的收集/判定/登记知识收口为各自的结构性单点，下游补偿层随根因治愈整体退役。** 按依赖顺序四刀：

1. **D1 Walk 收集器统一框架**（治病灶 1）：go/sync 内建立单一收集框架——统一 SkipDir 谓词（合并 `hasRecycleSegment`/`fsutil.IsRecycleDir` 两套为 fsutil 单点）+ 注入式回调（文件级/目录级收集差异走参数不走复制）；六个现有收集器改为消费框架。验收不变量：**新增收集器生而带回收站过滤**——不再依赖作者记得抄那段 SkipDir。
2. **D2 冲突通道并入判定表**（治病灶 2）：conflict.go 的三分支判定改经 verdict.go 判定表（或其自然延伸——冲突语义 = 判定信道的冲突特化视图），fileEntryInfo 等重叠结构体随迁移合一。验收不变量：新增判定信道时冲突通道自动跟进。
3. **D3 扫描侧修混合夹单登记**（治病灶 3）：在 go/sync 扫描层让混合夹只登记一次（容器身份携带直挂子文件），下游 absorbSelfMarker 与 dedupeSorted 两层补偿整体退役。验收不变量：同一物理文件在 BuildSyncItems 产物中至多出现一次，无任何下游去重。
4. **D4 pushTargets 下沉 + 命名收敛**（治次级问题）：安装目标三路推导（files/dirs/overwrites）下沉 go/sync 单点，go/instance 计数层只消费清单不重推导（注释复述降格为指针）；目录参数命名收敛为 `globalDir`/`instDir` 二元组口径；`subtype` 参数要么进行为要么从 BuildSyncItems 签名摘除（由调用方改写 VersionDir 的隐式约定显式化）。

**明确不做**：
- 不推倒重来——判定内核、锁纪律、分层结构是资产，四刀全是「开墙重走线」不是「拆楼」；
- 不把 16 处 `log.Printf` 迁出标准库 log——查证（2026-10-16）：`app.go` 已 `log.SetOutput(io.MultiWriter(os.Stderr, RuntimeBuffer))` 桥接环形面板，`runtime.go` 明文「捕获标准库 log 输出（watcher/sync 等）」，标准库 log 就是运行时调试日志的指定出口；go/AGENTS.md「日志用统一 logs 包」铁律治的是业务操作日志（ImportLog）与 `fmt.Println` 散打，两者分工不同（本条为锐评处的更正，防止后续按错误处方执行）；
- 前端 self 模式（app-sync-manager 16 字段公有状态包）不在本 ADR 范围——已有更优同仓范式（app-sidebar 私有字段 + 窄接口），作为新组件规约写入知识卡即可，存量重构收益不抵风险。

**一刀一拍板、独立合入**：四刀各自可独立验证与回退，D1 是 D3 的前置（先收口再改登记规则，回归锁全程在位）。

## 3. 后果（Consequences）

**正面**：
- 过滤/判定/登记知识各有结构性单点，「下一个 ADR-342」类事故的类被消灭；
- go/instance 两个补偿层（absorbSelfMarker 30 行注释复杂度、dedupeSorted 及其注释论证）与 pushTargets 注释复述整体退役，净删代码；
- 六收集器 → 一框架，行为面从 33 个测试文件钉住的组合爆炸收敛为框架单点 × 六组注入参数。

**负面 / 成本**：
- D1/D3 动的是全仓同步语义的地基，迁移期回归风险真实存在——必须逐收集器迁移 + 全量回归锁在位（verdict_matrix、sync_multilayer、status_counts 全家）；
- 框架抽象本身有维护成本，若未来出现无法参数化的收集形态，允许框架开洞但须记录理由。

**已知遗留**：
- status_counts pushTargets 的「diverged 展开成内层文件时不逐文件声称覆盖」盲区随 D4 下沉一并治（注入实例侧对应夹路径做真实两侧 diff）；
- go/sync 错误体裁三套并存（哨兵/结构化/字符串拼接）与 sync_push.go 五职责混杂——属包内卫生，不立 ADR，随四刀顺手收敛；
- 侧栏 collectCounts「父+子重复计数」口径差已在 ADR-310 记录在案，维持不修。

## 4. 数据溯源

- 2026-10-16 整合包域锐评（三子代理分域报告 + 主模型 grep 复核）：六处 SkipDir 复制点（sync.go/sync_dirlevel_sync.go/sync_dirlevel_diff.go/sync_resource.go/sync_relink.go 各一处，conflict.go 缺失）；conflict.go 平行判定分支与 verdict.go 判定表对照；absorbSelfMarker（instance_tree.go）与 dedupeSorted（status_counts.go）双层补偿；pushTargets 注释复述 sync_push.go 行为（status_counts.go 自认盲区）。
- 历史实证：ADR-342（回收站过滤漏一处 → 五处补丁）、ADR-347（判定双实现 → 单点化但漏冲突通道）、ADR-310（侧栏/面板双链 → 面板链单一事实源）——三者共同证明「修实例不修类」模式的复发率。
- 规模量化：整合包域源码 11,826 行 / 测试 17,726 行（1.5x）；go/sync 单包测试源码比 2.19x（33:13 文件）；源码内 ADR 引用 244 处。

<!-- 文件名: sync-domain-review-consolidation.md → 实际文件 architecture/ADR-351-sync-domain-review-consolidation.md（ADR-320 architecture 全量模板） -->
