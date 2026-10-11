---
kind: go-tags
name: 标签系统 go/tags
tier: architecture
category: go
source_files:
  - go/tags/
auto_fields:
  symbols_with_lines:
    - NewStore
    - Store
    - Store.AddTag
    - Store.AllTags
    - Store.GetTags
    - Store.ListByTag
    - Store.PruneKeys
    - Store.RelocateKeys
    - Store.RemoveTag
    - Store.SetTags
use_when:
  - 标签
  - tag
  - 分类
  - tag-editor
perf:
  - io-bound
invariant_anchors:
  - go/tags/tags.go|fsutil.WriteFileAtomic
  - go/tags/tags.go|.corrupt
quick_groups:
  - 文件操作与标签
quick_intents:
  - 打标签 / 标签存储 / 按标签筛选
quick_risk_lines:
  - 标签以文件绝对路径为 key 存 tags.json；写入走 tmp + os.Rename 原子替换，禁止直写
pitfalls:
  - 标签以文件绝对路径为 key——改名/移动/复制后旧 key 会成孤儿（**已修 2026-10-10**：app 层四绑定接线 Store.RelocateKeys 迁移，对齐 web rekey；详见不变量「键迁移」条）
  - tags.json 写入走 tmp + os.Rename 原子替换——直写会导致读取时读到半截数据
  - Store 懒加载——首次 GetTags/SetTags 时才读盘，之前操作不触发 IO
  - SetTags 自动 trim/去重/排序——传入重复标签不会报错而是去重
  - ListByTag 返回路径是排序的——不保证与原始写入顺序一致
  - tags.json 损坏时 Store 会创建 .corrupt 备份并返回空 Store
  - AddTag 已存在则跳过——不会报错也不会计数
status: active
---

# 标签系统 go/tags

## 概览

`go/tags/` 包提供模型标签的线程安全持久化存储，是前端 tag-editor 弹窗的后端。标签存放在配置目录的 `tags.json`，以文件绝对路径为 key、标签列表为 value，与模型文件本身解耦（移动/链接模型不污染文件内容）。

## 核心职责

- `tags.go` — Store 的懒加载、增删改查、按标签反查路径、标签热度统计

## 对外 API / 入口

- `NewStore(configDir string) *Store` — 创建存储（懒加载：首次 Get/Set 时才读盘）
- `(*Store) GetTags(modelPath string) ([]string, error)` — 返回指定路径的标签（已排序的副本；无标签返回空切片）
- `(*Store) SetTags(modelPath string, tags []string) error` — 覆盖写入（自动 trim/去重/排序；空列表删除该条目）并落盘
- `(*Store) AddTag(modelPath, tag string) error` — 追加单个标签（已存在则跳过）
- `(*Store) RemoveTag(modelPath, tag string) error` — 移除单个标签（无变化则不落盘）
- `(*Store) ListByTag(tag string) ([]string, error)` — 反查打了该标签的所有文件路径（排序）
- `(*Store) AllTags() ([]string, error)` — 所有被使用的标签，按使用次数降序、同名按字典序
- `(*Store) RelocateKeys(from, to string, subtree, keepSource bool) (int, error)` — 键迁移（改名/移动/复制后标签跟随）：`subtree=true` 按**分隔符边界**迁整棵子树（`/a/b` 不误伤 `/a/bc`）、`false` 只迁逐字相等的单键；`keepSource=true` 保源（复制语义）、`false` 删旧键（移动/改名语义）；退化输入（空/同路径/无命中）no-op 返回 0。from/to **不做路径归一**——调用方须传与写入同源的绝对路径
- `(*Store) PruneKeys(prefix string, subtree bool) (int, error)` — 键清理（**删除半侧**，2026-10-11 锐评收口）：`subtree=true` 删除 `prefix` 本身及其下全部键（按**分隔符边界**，与 `RelocateKeys` 同律）、`false` 只删精确键；退化输入（空 prefix/无命中）no-op 返回 0（不落盘），NUL 前缀仍受 `checkModelPath` 保护。删除后不清键 → 孤儿键累积 + **同名重建复活旧标签**

## 与其他子系统关系

- 被 `internal/app/app_tags.go` 持有（`getTagsStore()` 懒初始化）并经 Wails binding 暴露给前端 `dialogs/tag-editor`
- 被 `internal/app/app_scan.go` 调用：扫描时为每个条目计算 `HasTags` 标记
- 无第三方依赖（纯标准库）

## 不变量

- `sync.RWMutex` 保护：读用 RLock、写用 Lock；`load()` 以 `s.data != nil` 守卫保证只加载一次。**JSON `null` 内容守卫破口已封**（P3 修复：Unmarshal 成功但内容恰为 `null` 时 m 为 nil map → 现补 `if m == nil { m = make(...) }`，防每次 Get/Set 重复整文件读盘）
- **写路径锁归属内聚 `commit` + `load` 双检（2026-09 重构）**：原 `prepareWrite` 返回解锁函数、由调用方 `defer` 到函数结尾，使 `save()` 的 `json.MarshalIndent` 与 `fsutil.WriteFileAtomic`（磁盘 IO）**全程持写锁**，阻塞所有 `GetTags`/`ListByTag`/`AllTags`。现 `Store.commit(mutate func() (bool, error))` 统一临界区：load → 取写锁 → 改内存 → 序列化快照 → **解锁** → `Store.persist` 写盘（锁外）；`mutate` 返回 `changed=false`（AddTag 命中已存在 / RemoveTag 无变化）时跳过落盘，保持「无变化不写盘」语义。`load` 改「RLock 快路径 → 未加载才升写锁二次检查」，已加载后读路径唯一开销是一次 RLock（原先每次读都要取一次写锁）。`prepareWrite` 已删除（职责并入 `commit`）。回归：`TestStore_ConcurrentReadWrite_NoRace` / `TestStore_Commit_NoChangeSkipsPersist` / `TestStore_LoadDoubleCheck_ConcurrentFirstLoad`。
- **落盘串行化 `persistMu`（锐评 2026-10-10 补齐 2026-09 重构的对偶缺口）**：只把写盘移出 `s.mu`，会让「内存快照序」与「落盘序」不同源——两个并发 commit 各自在 `s.mu` 内取快照、再裸竞 `WriteFileAtomic`，**旧快照晚落盘即把新快照整体盖掉**（丢更新：实测多 goroutine 各写一 key，重启后 fresh Store 只读盘，绝大多数 key 消失；Windows 上还叠并发 rename 撞同一 `tags.json` 目标报 Access denied）。现「取快照（`s.mu.RLock`）+ `persist` 落盘」整段收进 `Store.persistMu`：落盘序 = 快照序，且最后落盘者的快照经 RLock 必然含此前全部 mutate——丢更新在结构上不可表达。**锁序恒为 persistMu→s.mu（commit 内），无任何路径持 s.mu 再取 persistMu，不成环**；读路径不碰 persistMu，2026-09「读不被慢 IO 阻塞」的收益保留。回归 `TestStore_ConcurrentCommit_DiskKeepsAllKeys`（N 并发各写不同 key + 多轮重试压满序列化→落盘窗口，从磁盘重开 Store 断言全在）——修复前该测试实测缺 key 转红、修复后 -race -count 3 绿。
- 标签统一 `TrimSpace`，空白标签被丢弃
- **键迁移接线：改名/移动/复制后标签跟随（锐评 2026-10-10，桌面端补齐与 web 同语义）**：标签 key 是绝对路径，文件搬迁后旧键成孤儿——web 端 `web-fs-mutate.ts|rekeyWebModelGroup` 早已 P0 修过（`tags:`/`ban:` 前缀随组 rekey），桌面 Go 曾零迁移、跨端口径分叉。现 `Store.RelocateKeys` + `internal/app/app_files.go|relocateTags` 接线四绑定：`RenameFile`（精确单键）/`RenameDir`（子树）/`MoveModelFile`（子树，删旧键）/`CopyModelFile`（子树，keepSource 保源）成功后迁移。三条红线：① **from/to 由 `fileops.RenameTarget`/`MoveCopyTarget` 算出、与真实搬迁落点同源**（接线不自算路径——`shouldLiftYsmParent` 对根级 ysm.json 的「Move 豁免、Copy 提升」刻意不对称由 plan 忠实复刻，同源测试 `TestMoveCopyTarget_*` 真实跑搬迁再 Lstat(plan.to) 验）；② **跨存储非原子、失败不回滚文件**（文件已落盘，撤文件制造失踪假象；迁移失败记 warn 日志暴露孤儿键，不静默吞错）；③ CLI `move/copy/rename` 经 `ctx.App.*` 转发同一绑定、自动同语义（不留 CLI 分叉）。回归 `app_files_tags_migrate_test.go`（6 例端到端 + 兄弟前缀不误伤 + copy 保源 + 提升整夹），变异（掏空 relocateTags）即点名转红。
- **键清理（删除半侧）接线：删除后标签键不再成孤儿（锐评 2026-10-11 收口）**：`RelocateKeys` 只补了迁移半侧，`RemoveDir`/`DeleteResourcePack` 失效扫描缓存却不清标签键——孤儿键单调累积，且**同名重建会复活旧标签**（删掉「狐狸」再导入一个「狐狸」，上一个的标签静静贴上来）。现 `Store.PruneKeys` + `internal/app/app_files.go|pruneTags` 接线两处删除：`RemoveDir`（子树）、`internal/app/resource_bindings.go|DeleteResourcePack`（目录型双前缀 clean/realClean、文件型双形态 joined/raw，均无命中 no-op）。**机器锁**：`scripts/_lib/write-surface-gate.ts` 的 `SatisfyKind` 增 `rekey`/`prune` 两档（固定 token `a.relocateTags(` / `a.pruneTags(`），新契约 `tests/test_fileops_tag_sync.ts` 从 `go/fileops` 导出面派生写者、三选一归宿，另钉死 helper 内部真接 `getTagsStore().RelocateKeys(`/`PruneKeys(`（外层走 helper 也可能是空转）；已登记 `CONTRACT_TEST_DOMAINS: go,tests`。启禁（`ToggleModelEnable`/`ToggleEnable`）**不 relocate（刻意设计，非债务）**：`internal/app/app_files_toggle_test.go|TestToggleEnable_TagRoundTripPreservesBasePath` 实证——启禁只是给同一基准路径加/摘 `.disabled`，文件身份没变，标签键停在规范路径上、禁用期间 `ListByTag`（Store 侧查询、不查磁盘）仍能查到、启回后原样复原；真去 relocate 反而会把标签搬到 `.disabled` 上、启回时变成新的基准路径孤儿（反向病）。唯一余口已补：**禁用态下删除**会把规范路径键留成孤儿，`DeleteResourcePack` 现补清 `StripDisableSuffix` 后的 base path（文件型精确、目录型子树；`internal/app/app_prune_disabled_test.go` 两例守护）。顺带修掉同函数一处存量 bug：目录分支守卫原本硬编码 `a.ysmRoot()`，非 ysm 根下的目录型资源（如 maid-model 各自根）删除被「路径超出仓库目录」误拒——现改用 `GetRepoRoot(rtype)`，与文件分支同口径。
- `SetTags` 每次写后都落盘（JSON 缩进格式，**tmp + `os.Rename` 原子替换**，rename 失败清理 tmp；`TestSaveLeavesNoTmp` 守护）；`GetTags` 返回副本防外部篡改
- **损坏恢复**：tags.json 解析失败 → 备份 `.corrupt`（保留现场）→ 重建空存储（读路径恢复 + 写路径自我修复，`TestCorruptFileRecovers` 守护）——第 4 批修复，知识卡原卡未记载已补
- P3 观察：`Store.persist` 失败（磁盘满/权限）时内存已变更、磁盘未更新，属「内存优先、落盘尽力」契约（调用方拿到 error 但 GetTags 读到新值，进程崩溃则上次写丢失）；`ListByTag` 空 tag 返回 nil 与 GetTags 的 `[]string{}` 约定不一致（P4）

## 相关

- [wails_bridge](./wails-bridge.md) — 标签 binding 入口
- 前端 `frontend/src/dialogs/tag-editor/` — 标签编辑弹窗
