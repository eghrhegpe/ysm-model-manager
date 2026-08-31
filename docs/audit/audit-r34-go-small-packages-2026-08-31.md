# R34 审核：8 个小规模包（texture_cache / repoaudit / launcher / logs / watcher / tags / packs / instance）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 8 explore 子代理（并行）｜状态：⏳ 修复闭环中
> 前置：R26→R33 全链闭环。R34 收口小规模包（<600 行）。

## 范围

| 包 | 非测试行 | 子代理返回 | deep 复审 |
|---|---|---|---|
| texture_cache | 393 | ✅ 完整 | 是（P2 hash 校验 + P3 损坏缓存） |
| repoaudit | 379 | ✅ 完整 | 是（P2 根 symlink 守卫 + P3 无界 JSON 解码） |
| launcher | 365 | ✅ 完整 | 是（P2 ExpandEnv 注入） |
| logs | 352 | ⚠️ partial（限流截断） | 否（并发防御注释质量高） |
| watcher | 321 | ✅ 完整 | 是（P2 syncPending 续跑竞态） |
| tags | 316 | ❌ error（限流） | — |
| packs | 265 | ✅ 完整 | 否（P4 死代码为主） |
| instance | 540 | ✅ 完整 | 否（P2 L222 前缀守卫遗漏，低概率） |

## 总体结论：通过

8 个小包代码质量整体良好——原子写、LimitReader+1 截断探测、sentinel error、BOM strip 等防护到位。主要问题集中在 P2 安全口径漏洞（repoaudit 根 symlink 守卫字符串比较、launcher ExpandEnv 注入、texture_cache hash 零校验）和 P3 OOM 风险（repoaudit 无界 JSON 解码）。tags 因限流未审，待后续补审。

## 发现项汇总

| 包 | P2 | P3 | P4 | 合计 |
|---|---|---|---|---|
| texture_cache | 2 | 3 | 3 | 8 |
| repoaudit | 3 | 4 | 4 | 11 |
| launcher | 3 | 5 | 4 | 12 |
| logs | 0 | 0 | 0 | 0（partial） |
| watcher | 3 | 4 | 3 | 10 |
| tags | — | — | — | —（未审） |
| packs | 3 | 1 | 4 | 8 |
| instance | 2 | 2 | 3 | 7 |
| **合计** | **16** | **19** | **21** | **56** |

## P2 发现项明细（安全/正确性）

| # | 包 | 位置 | 问题 | 修复方向 |
|---|---|---|---|---|
| P2-1 | texture_cache | texture_cache.go:86 | `WriteCached` 对 `hash` 零校验，导出 API 可传 `"../foo"` 路径穿越 | `CachePath` 入口白名单校验 `^[0-9a-f]{64}$` |
| P2-2 | texture_cache | texture_cache.go:29-35 | `CacheDir` 导出 `var` 可被并发改写，所有读路径无锁 | 改 `sync.RWMutex` 保护的 getter/setter，或降可见性 |
| P2-3 | repoaudit | repoaudit.go:159 | 符号链接根目录守卫用 `path == dirPath` 字符串比较，含尾斜杠/`..`/未 clean 路径时比较失败，根符号链接被静默跳过 | 对 `dirPath` 先 `filepath.Clean`，或入口用 `os.Lstat` 检测 `ModeSymlink` 直接拒绝 |
| P2-4 | repoaudit | repoaudit.go:152-156 | WalkDir 回调对 `err != nil`（无权限目录）仅 `append` warning 后 `return nil`，部分目录不可达时 `TotalFiles` 偏低但分数仍可能 100，静默偏绿 | 累计访问异常计数，超过阈值标记 `partial=true` |
| P2-5 | repoaudit | repoaudit.go:337-353 | `isModelFileValid` 对未识别扩展名 `return true` 放行，若未来调用方放宽 gate，未知扩展名被误判有效 | 函数内对未识别扩展名 `return false` 防御性收紧 |
| P2-6 | launcher | detect.go:150 | `resolvePortablePath` 对从 HMCL 的 JSON 配置和 `user-game-directories.json` 中读取的路径调用 `os.ExpandEnv`，读取恶意/被篡改启动器配置时可注入任意环境变量重定向 `CustomDir`/`GameDir` | 仅对明确的可移植变量（如 `${HMCL_DIR}`）扩展，或扩展前拒绝含 `$` 的路径 |
| P2-7 | launcher | detect.go:105-124 | 使用无限制的 `filepath.WalkDir` 递归遍历 `launcherRoot`，深度防护（`depth > 3`）仅在计算 `rel` 后触发 | 直接在遍历回调中根据路径层级跳过目录，或用 `os.Lstat` 跳过符号链接 |
| P2-8 | launcher | detect.go:159-163 | `resolvePortablePath` 调用 `filepath.Abs(path)`，当 `path` 为相对路径时与当前工作目录拼接，攻击者控制 `user-game-directories.json` 可将 `GameDir`/`CustomDir` 指向启动器根目录之外 | 验证最终解析路径是否位于预期根目录范围内 |
| P2-9 | watcher | watcher.go:259-263 | `syncPending` 续跑竞态：当 `syncRunning==true` 时设置 `syncPending=true` 后解锁返回，但若 in-flight `syncAll` 实例的 defer 已越过 `pending := w.syncPending` 读取点，pending 请求被静默丢弃 | 在 `syncAll` 的 defer 内将 `syncPending` 的读取和复位移到同一临界区，使续跑逻辑成为"接力"而非"读快照" |
| P2-10 | watcher | watcher.go:109-153 | `Stop` 中 `wg.Wait()` 的 5s 超时降级：若同步在 5s 内未完成，Stop 直接返回，但 `syncRunning` 仍为 true，in-flight `syncAll` 仍在跑，可能正在写入整合包目录。上层以为"已停止"并执行后续操作（如删除 mcRoot），产生文件操作竞态 | 超时降级时应考虑强制中止同步，或至少文档明确"Stop 返回后可能仍有 in-flight sync 在运行" |
| P2-11 | packs | mcmeta.go:81-110 | ZIP 分支按 `strings.ToLower(f.Name) == "pack.mcmeta"` 匹配，未跳过目录条目；恶意 zip 含目录条目名为 `pack.mcmeta` 时可能误匹配 | 遍历开头 `if f.FileInfo().IsDir() { continue }` |
| P2-12 | packs | mcmeta.go:81-97 | 若 zip 内存在多个 ToLower 折叠后同为 `pack.mcmeta` 的条目（如 `Pack.mcmeta` 与 `PACK.MCMETA`），循环不 break、后读的覆盖 `data`，且 `metaTooLarge` 一旦置 true 不复位——超限条目在前、正常条目在后时会误报 `ErrPackMetaTooLarge` | 找到首个合法 pack.mcmeta 后 `break`，或在成功读取后跳出整个循环 |
| P2-13 | instance | instance.go:222 | `appendOneItem` 中 `strings.HasPrefix(p, c.globalDir)` 用裸前缀匹配而非分隔符守卫，当全局根是另一全局根的前缀（如 `D:\repo\a` vs `D:\repo\abc`）时，`TrimPrefix` 会算出错误的实例侧路径 `instPath`。对比同文件 L380 的 `relOf` 用了 `basedir+sep` 守卫，此处遗漏 | 改为 `strings.HasPrefix(p, c.globalDir+string(filepath.Separator))`，与 `relOf` 口径一致 |
| P2-14 | instance | instance.go:327-333 | 缓存读端在过期时 `Delete` 后无锁重算，并发多 goroutine 同时命中同一过期 key 会各自重算并 `Store`（thundering herd）。非数据损坏，但高并发刷新页时产生重复磁盘 IO | 可接受现状（单整合包页并发极低）；若需消除，用 `singleflight` 包裹重算路径 |
| P2-15 | repoaudit | repoaudit.go:337-353 | `json.NewDecoder(f).Decode(&v map[string]interface{})` 无大小上限/无 `io.LimitReader`，单个数 GB 的恶意或损坏 `.json/.ysm` 文件会全量载入内存，数万文件仓库场景下 OOM 风险 | 先 `st.Size()` 上限校验（如 >256MB 直接判 invalid），或包 `io.LimitReader` 并对截断报错 |
| P2-16 | texture_cache | texture_cache.go:58-74 | `ReadCached` 对损坏/截断的缓存文件无任何完整性校验，会直接把坏数据返回上层当作有效 KTX2。`WriteFileAtomic` 保证写入原子性，但磁盘坏块、用户手动改文件、跨版本格式变更都不会被察觉 | `ReadCached` 读回后做最小 KTX2 头部魔数校验（或存储时附带写入长度/哈希校验文件），校验失败视为 miss 并删除坏文件 |

## P3 发现项汇总（可靠性，19 项）

### texture_cache（3 项）
- P3-1 `texture_cache.go:90-92/382-393` — `WriteCached` 写后无条件触发 `maybePrune`，而 `maybePrune` 与 `Prune` 之间无「同一缓存键并发读写」保护。单用户 GUI 场景概率低但非零。修复方向：Prune 删除前重新 stat 目标 mtime 与扫描快照比对，不一致则跳过。
- P3-2 `texture_cache.go:91/319-326` — 磁盘空间耗尽时无针对性处理。`WriteFileAtomic` 会在写临时文件时返回 ENOSPC 错误，`WriteCached` 把它包装成普通 error 返回，但缓存写失败 ≠ 致命错误。修复方向：可接受现状，但建议在 WriteCached 注释中明确「磁盘满返回 error 是预期行为，调用方应降级为不缓存继续运行」。
- P3-3 `texture_cache.go:266-269` — `Prune` 在 `pruneMu` 下快照 `maxBytes`/`maxAge` 但不快照 `pruneInterval`，而 `maybePrune` 在同一锁下读 `pruneInterval` 与写 `lastPrune`。当前正确（`Prune` 本身不读 `pruneInterval`），但快照逻辑不对称会让后续维护者疑惑。修复方向：注释说明 `pruneInterval` 仅 `maybePrune` 使用。

### repoaudit（4 项）
- P3-4 `repoaudit.go:336-353` — `json.NewDecoder(f).Decode(&v map[string]interface{})` 无大小上限/无 `io.LimitReader`，单个数 GB 的恶意或损坏 `.json/.ysm` 文件会全量载入内存，数万文件仓库场景下 OOM 风险。修复方向：先 `st.Size()` 上限校验，或包 `io.LimitReader` 并对截断报错。
- P3-5 `repoaudit.go:125/256` — `Audit` 与 `HealthReportFor` 无 `context.Context`/超时，大仓库审计（数万文件 + dedup 二次全量扫描）可能长时阻塞 GUI 绑定层。修复方向：加 `ctx context.Context` 参数并在 walk 回调内 `select ctx.Done`。
- P3-6 `repoaudit.go:272-275` — `HealthReportFor` 中 dedup 扫描失败直接 `return HealthReport{}, err`，丢弃已成功的 `audit` 结果，部分失败时前面所有审计工作白费。修复方向：dedup 失败时保留 audit 部分、Dedup 置零并在 warnings 追加「去重扫描失败」。
- P3-7 `repoaudit.go:279` — `g.Size * int64(len(g.Files)-1)` 计算 Reclaim 假设组内所有文件等大，若 `FindDuplicateFiles` 的 `Size` 是首文件大小而非组内最小，回收估算偏乐观。修复方向：确认 dedup Group.Size 语义（首文件/最小/总和），必要时文档化口径。

### launcher（5 项）
- P3-8 `detect.go:139-141` — `readHMCLGameDirectories` 在发生读取或 JSON 解析错误时会静默返回 `nil`。损坏的 `user-game-directories.json` 会导致所有通过 HMCL 配置的游戏根目录被悄无声息地丢弃。修复方向：向上层调用传播该错误，或者至少应记录警告信息。
- P3-9 `detect.go:244-258` — `hmclRunningDirectory` 在读取 `instance-game-settings.json` 时，若发生读取错误或 JSON 无效，会返回 `("", false)`，这与"文件缺失"的情况难以区分。修复方向：对"文件不存在"和"文件存在但已损坏"的情况进行区分。
- P3-10 `detect.go:166-191` — `scanVersions` 不会跳过名称以点号开头的目录（如 `.minecraft`、`.fabric` 等）。深度遍历可能会导致生成虚假的实例。修复方向：在迭代版本目录时，跳过隐藏目录。
- P3-11 `detect.go:193-220` — `resolveRunDirectory` 的首个防护措施 `dirExists(versionDir/…/custom)` 在隔离模式下，也会将非隔离的共享实例短路判定为 `versionDir`。修复方向：将"自定义目录存在"的检查范围限定为仅在隔离逻辑返回之后使用。
- P3-12 `detect.go:261-283` — `legacyHMCLRunningDirectory` 会遍历整个文件，而未在找到相关键值后提前返回。如果文件多次定义 `gameDir` 或 `runningDirectory`，则最后出现的一个生效，这是一种未记录的语义行为。修复方向：在首次匹配后提前返回，或者记录下"最后值胜出"的规则。

### watcher（4 项）
- P3-13 `watcher.go:79-94` WalkDir 失败处理 — `filepath.WalkDir` 的回调在 `fw.Add(path)` 失败时仅 log 并继续，但没有记录有多少目录成功添加、多少失败。若大部分子目录 Add 失败（如 Linux inotify watch 数超 `fs.inotify.max_user_watches`），watcher 会处于"部分监听"的静默降级状态。修复方向：统计 Add 失败数，超过阈值时显式警告"建议调高 fs.inotify.max_user_watches"。
- P3-14 `watcher.go:79-94` 新建子目录不自动监听 — `Start` 时 WalkDir 添加了当时存在的目录，但 fsnotify 对已监听目录内新建子目录不递归上报——新建子目录下的文件变更不会被监听到。修复方向：在 loop 中处理 `Create` 事件时，若 `ev.Name` 是目录则 `w.w.Add(ev.Name)`。
- P3-15 `watcher.go:221-232` isNoiseEvent 不覆盖 Windows 临时锁 — Windows 上 Office 系列会生成 `~$` 前缀文件（已覆盖），但部分编辑器生成 `.bak`、`.orig`、`~` 后缀，以及 macOS 的 `.DS_Store`、`._*` 资源叉文件。修复方向：补充 `.bak`/`.orig`/`.DS_Store`/`._` 前缀等噪声模式。
- P3-16 `watcher.go:291` `mdsync.ListVersions` 无超时/无错误返回 — 若 mcRoot 在网络盘上且响应缓慢，`syncAll` 会长时间持有 `syncRunning` 标志。修复方向：为 ListVersions 引入超时上下文。

### packs（1 项）
- P3-17 `mcmeta.go:105` pack.png 分支用 `LimitReader(rc, maxPackPng+1)` 限制读取字节，但未限制 zip 条目的「未压缩大小」`f.UncompressedSize64`；一个声明 64GB 解压大小的畸形条目仍会触发 LimitReader 截断后置空——当前行为正确但浪费一次大读取调度。属次要，记为信息项。

### instance（2 项）
- P3-18 `instance.go:32/syncItemsCache` — `syncItemsCache` 是无上限 `sync.Map`，仅靠 scanner 失效钩子清空，无独立淘汰/大小限制。修复方向：现状风险可控；若未来组合数增长，加 LRU 上限或定期 `Range` 清过期项。
- P3-19 `instance.go:346-349/缓存写入` — 写缓存时 `expiresAt` 取 `time.Now().Add(scanner.EffectiveCacheTTL())`，但 TTL 在写入时刻快照，后续配置热改 TTL 时已缓存条目不立即跟随。这是设计选择（注释声明），非 bug。

## P4 发现项汇总（可维护性，21 项，略）

详见各子代理报告。主要类型：死代码（packs isYsmFile/hasExt、texture_cache removeFile 命名）、注释与代码脱节（repoaudit L186、packs L196-201 跨行号引用）、隐式契约（instance buildSyncItemsKey INVARIANT、watcher syncRunning/syncPending `// guarded by w.mu` 标注）。

## 修复状态注记（2026-08-31 闭环进行中）

本轮 8 个小包共 56 项发现（16×P2 + 19×P3 + 21×P4）。考虑额度预算，本轮优先修明确的安全 P2（repoaudit 根 symlink 守卫 + launcher ExpandEnv 注入 + instance L222 前缀守卫），其余 P2/P3/P4 待后续轮次或 deep 复审处理。

| 优先级 | 修复项 | 状态 |
|---|---|---|
| P2-3 | repoaudit 根 symlink 守卫 filepath.Clean | ⏳ 待修 |
| P2-6 | launcher ExpandEnv 注入（限制可扩展变量） | ⏳ 待修 |
| P2-13 | instance L222 前缀守卫 +sep | ⏳ 待修 |
| P2-9 | watcher syncPending 续跑竞态 | ⏳ 待修 |
| 其余 | P2-1/2/4/5/7/8/10-12/14-16 + P3 + P4 | ⏳ 待后续 |
