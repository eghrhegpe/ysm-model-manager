# ADR-296：链接模式切换重链链路加固（锐评落地）

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡 `go-sync` / `go-installer`（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-22
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-028（先删后建原子替换）、ADR-038 D3.4（IsHardLink 目录排除）、ADR-044③（路径边界对称）、ADR-056（共享安装锁）、ADR-064（dirLevelSync 锚定）；代码 `go/sync/sync_relink.go`、`go/installer/installer.go`、`frontend/src/views/app-content/settings/init.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

对「复制 ↔ 硬链接」模式切换链路（前端 stgBindLinkMode → SetLinkMode → RelinkAllInstanceResources → `go/sync.RelinkDir` → installer LinkOrCopyLocked/sameSource）做锐评，3 路子代理独立核实可行性。关键事实：

1. **【锐评误判，已证伪】** 「hardlink→copy 切换后实例仍是硬链接」不成立：RelinkDir 是 `if !found { continue }`——只有哈希**不匹配**才跳过，匹配条目无条件按当前 linkMode 重跑 Install（copy 走 fsutil.CopyFile 原子 tmp+rename 天然断链）。若线上真观察到残留症状，嫌疑在：linkMode 双写时序（SetLinkMode 同值早退 + SaveAppConfig 五参版）、或 Windows IsHardLink 占用假阴性（见 5）。
2. **【确证】** README「硬链接跨分区自动降级为复制」与代码矛盾：LinkOrCopyLocked 失败只回 AppError（linkErr），绝不回退；用户指南.md 三处同病。
3. **【确证】** `.relink-bak-<ts>` 残留会反哺扫描套娃：Go WalkDir（scanner）与生产 Rust 快路径（`-tags rust_backend`，should_skip_dir_name 只跳 .recycle/.github）都下钻备份目录并填哈希 → 下次 relink 对尸体再 rename→InstallDir→再生新备份。SyncToggleStatus 的 WalkDir 同病（尸体会被 .disabled 改名）。
4. **【确证】** RelinkDir 锁外快照 dstParent、锁内直接 rename 的 TOCTOU 残余风险（源码注释自认）。Windows Sys() 无 inode，但 os.SameFile 比 VolumeSerial+FileIndex 双端可用（installer.sameDir 先例）。锁内重新 scanFn 违反 TestRelinkDir_ScanNotHeldLock 契约，否决。
5. **【新发现】** fsutil.IsHardLink Windows 实现用 CreateFileW(GENERIC_READ, FILE_SHARE_R|W)：文件被游戏进程以无共享方式占用时打开失败 → 静默 false → GetLinkType 把硬链接误判为 LinkCopy（UI「旧仓库遗留」标记失真，非数据缺陷）。
6. **【确证】** SaveAppConfig 五参版不校验 linkMode；SyncLinkMode 零校验直写内存快照。前端 5 个 SaveAppConfig 调用点中 4 个只是原样回写 linkMode，入口 fail-closed 会误伤「只想改 mcRoot/theme」的写入方。
7. **【确证】** sameSource 目录 symlink dst 盲区存在但生产≈不可达（src 侧目录走递归不进 Link；dst 占位 rename 必败有测试钉死），无数据损坏，属 UX 瑕疵。
8. **【体验缺口】** 切模式瞬间全量 SHA256 扫盘重链，无预告、无进度；relinkOneInstance 失败只 logWarn。modalConfirm + instance-ops「统计→带数量确认→取消 return」样板现成。
9. **【低优先】** zip 目录型 relink 不识别（sync_relink.go 注释自认「本轮不做」）。

## 2. 决策（Decision）

### D1 端到端复现钉桩（先行）
新增集成测试：真实 scanner 路径 + os.Link 造硬链接 → RelinkDir("copy") → 断言 SameFile==false、内容保留、repo 侧引用完好；反向 copy→hardlink 断言 SameFile==true；symlink→copy 一条；外加「Hash=="" / .ban 条目任何模式不动」负向钉桩。**目的**：证伪/坐实症状；若证伪，不动 RelinkDir 主流程。

### D2 文档纠偏
README + 用户指南 ×3 处改为「报错提示切换复制模式（不自动降级）」口径；recycle-bin.md 跨分区行补限定语「（回收站移动链路，非安装降级）」防串读；go/AGENTS.md 坑点条订正（回退实际在 recycle.moveEx / fileops.renameForMove，fsutil/crossdevice 只做 errno 分类）。

### D3 relink/toggle 过滤 .relink-bak-*
`go/sync` 包内私有谓词 `isRelinkBackupPath(p)`：逐段小写 Contains ".relink-bak-"（备份名是 `<目录名>.relink-bak-<ts>` 后缀形态，不能照抄 hasRecycleSegment 精确段匹配）。消费侧接入三处：RelinkDir 主循环、repoByHash 构建循环、SyncToggleStatus WalkDir。**不动 scanner 源头**（全仓发现权单点 + Go/Rust 双端同步成本）。补回归测试。

### D4 锁内轻量复验
目录级分支 `os.Rename(dstParent, backup)` 前：锁内 Lstat + 与锁外快照 `os.SameFile` 比对 + IsDir 复验，不一致 skip+logger。快照元数据取于锁外，锁范围语义不变，不违 ScanNotHeldLock。诚实标注残余窗口（同名重建 FileIndex 不变检不出、mtime 噪声不做相等判定）。

### D5 切换确认框 + 进度
change 事件顶部纳入 busy 守卫 → modalConfirm（展示将处理实例数，danger:true）→ 取消回退 select.value + applyHintVisibility，不发 RPC。逐实例完成增量 toast（复用 bus "toast:show"，不引 modalProgress——字节级进度条与离散计数语义不符）。新增 i18n key 三语同步（占位符名一致）。

### D6 linkMode 软校验回落
loadAppConfig：cfg.LinkMode 非法（∉{copy,hardlink,symlink,""}）→ logWarn + 回落 ""再交 SyncLinkMode；SaveAppConfig orDefault 前对传入 linkMode 软校验（非法则忽略该参、保留 oldCfg.LinkMode，不 reject）。避免入口 fail-closed 误伤回写调用点。

### D7 IsHardLink 占用假阴性留观（不立项）
GetLinkType 仅 UI 分类消费（optional/legacy 标记），无资损路径。等 D1 复现结果决定是否升级。

### D8 维持现状项（明示不做）
- sameSource 目录 symlink 早退分支：生产不可达，归「下次触碰 installer.go 顺手加」。
- zip 目录型 relink：维持「本轮不做」注记。
- modeMismatch 强制重链 helper：D1 证伪前提下冗余；不改 RelinkDir 主流程语义。

## 3. 后果（Consequences）

- 正面：文档与代码事实对齐；备份尸体套娃闭环斩断（relink+toggle 两处）；TOCTOU 残余风险收窄为可检子集；切换体验有预告有进度；脏配置不再静默污染内存快照。
- 代价：relink 每目录级条目 +1~2 次锁内 Lstat（微秒级）；count 语义不变（本就统计全部重链条目）；D5 使既有 2 条测试改动。
- 实施顺序：D2 → D3 → D1 → D4 → D5/D6。D3/D4 同文件按序免冲突。
- 验证红线：每笔 `go build ./...` + `go test ./go/sync/ -timeout 5m`；前端 D5 另过 `vite build + typecheck + check-biome --files`；知识卡 go-sync/go-installer 同步。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 3 路可行性核实子代理（P0-A 核心语义 / P0-B+P1 文档+过滤+TOCTOU / P1-B+P2 体验+脏值+盲区） | §1 九条事实分级（确证/证伪/新发现/留观） |
| 主代理复读 sync_relink.go L63-76 仲裁 | 锐评 P0-A 判定误读 continue 方向，方案回炉（→ D1/D8） |
| 子代理实测基线：`go build ./...` + `go test ./go/sync/ ./go/installer/` 绿；NTFS rename 硬链接不污染仓库侧名探针 | D4 采纳轻量方案、Q4 嫌疑排除 |
| build-release.ps1 `-tags rust_backend` + rust-core/src/scan.rs should_skip_dir_name | D3 谓词必须判任一路径段（双端殊途同归下钻备份） |
