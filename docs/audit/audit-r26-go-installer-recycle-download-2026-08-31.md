# R26 审核：go/installer + go/recycle + go/download（三模块并行）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 3 explore 子代理｜状态：✅ 修复闭环（4 项 P2 已修 + 1 项误判）
> 前置：R19 watcher / R20 avatar / R21 dedup / R22 app_workshop / R23 app_install / R24 go/recycle / R25 go/installer

## 范围与岔开依据

**审核**（三模块并行，single 深度，只读）：

| 模块 | 文件 | 规模 | 前置审核 |
|---|---|---|---|
| installer | `go/installer/installer.go` | 800 行非测试 | R25（零 P2，P4-1 已注释） |
| recycle | `go/recycle/recycle.go` + `recycle_clean.go` | 554 行非测试 | R24（InstallLock 绑定 + 空根守卫前移） |
| download | `go/download/download.go` | 652 行非测试 | MEMORY：BUG-HTTP 修复链已全落地 |

**岔开**：R25 仅审 installer 单包；R24 仅审 recycle 修复点；download 自 BUG-HTTP 修复链后无系统审核。本轮把三个相邻但未并审的模块一次性过，补 download 的审核空白，并对 installer/recycle 的修复后状态做二次确认。

## 总体结论：通过（5 项 P2 + 7 项 P3 + 7 项 P4）

三模块守卫链路连贯，无未关闭的 P2 阻塞缺陷。残留风险集中在**边界补全**（重定向 off-by-one、退避未封顶、锁键未规范化）与**防御性守卫缺口**（Empty 缺 symlink 解析、moveEx 跨设备回退孤儿副本、moveEx rename 成功路径缺事后校验）两类，均为补丁级修复，不涉及架构调整。

## 发现项汇总

| 模块 | P2 | P3 | P4 | deep 复审 |
|---|---|---|---|---|
| installer | 0 | 1 | 4 | 是（L409/L467 partial-failure 语义） |
| recycle | 3 | 3 | 1 | 是（Empty symlink 守卫、moveEx 孤儿副本） |
| download | 2 | 3 | 2 | 否（残留风险均为边界补全类） |
| **合计** | **5** | **7** | **7** | — |

## installer 发现项

| 级别 | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3 | installer.go:409 / 467 | 子目录单条 entry 失败被计入 `errs`,触发 `callInstallDirRecursiveWithRollback` 的整树 `RemoveAll`,误删已成功落地的兄弟文件(MMD 多 texture 场景可感知) | 区分「致命错误(目录创建/读取失败)」与「条目级软失败」;仅前者触发整树回滚 |
| P4 | installer.go:453 | `cleanAbs(finalDst)` + `ContainsMinecraftMarker` 二次守卫,与 normalize 阶段(L232)重复——拆分后遗留冗余 | 删除或加注释说明是针对 `relInside` 子路径的补校验 |
| P4 | installer.go:185-193 | `InstallDirLocked` / `InstallDirRelLocked` 导出变体在本包内无调用方,死代码嫌疑 | grep sync 包确认引用;无引用则降级未导出或删除 |
| P4 | installer.go:317 | `IsInside` 嵌套守卫与 L227 `sameDir` 守卫分工无注释,拆分后易误读 | 在 L317 注释点明「sameDir 仅防完全相同,L317 防嵌套」 |

**评价**:拆分后守卫链路连贯,唯一值得 deep 复审的是 L409/L467 的 partial-failure 语义。建议下一轮 lint 清理时合并处理 P4。

## recycle 发现项

| 级别 | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2 | recycle.go:354-372 (Empty) | `Empty` 是破坏性最强的操作,却唯一**未对 `recycleDir` 做 `EvalSymlinks` 解析**;若 `.recycle` 被替换为指向外部的 symlink,`RemoveAll` 会删除外部目录树 | 入口对 `recycleDir` 做 `EvalSymlinks`,拒绝越出预期 root 的路径;或复用 `Delete` 的 `IsInsideResolved` 守卫 |
| P2 | recycle.go:164-166 / 176-178 (moveEx 跨设备回退) | copy 成功后 `os.Remove(src)` 失败,错误文案说「副本在 dst,请手动清理」,但**源文件也还在**——误导,且后续重试会堆积更多副本 | 区分两种失败语义:源删除失败时回滚删除已落地副本,或错误中同时披露源路径与副本路径 |
| P2 | recycle.go:150-154 (moveEx rename 成功路径) | rename 成功后未做「dst 仍落在 recycleDir 内」的事后校验,存在文件系统 TOCTOU 面(rename 前父目录被换 symlink) | rename 后对 dst 做 `IsInsideResolved(recycleDir, dst)` 复核,失败则 `os.Rename` 回滚 |
| P3 | recycle_clean.go:117-148 (DeduplicateEntries) | `Move` 失败时 `kept` 仍无条件 +1,返回值 `(removed, kept)` 在部分失败时语义失真——上层无法区分「无重复」与「移动全失败」 | `kept` 仅在组内无失败时累加,或额外返回 `failed int` |
| P3 | recycle_clean.go:25-114 (RemoveRepoDuplicates) | `dir` 参数无任何路径守卫,作为下沉库缺少防御性校验 | 增加 `baseDir` 约束参数,对 `dir` 与每个 `p` 做 `IsInsideResolved` 校验 |
| P3 | recycle.go:285-289 (Restore 符号链接回滚) | 回滚 `os.Symlink(target, src)` 失败被 `_` 静默吞掉,且回滚失败不上报——回收站侧链接永久丢失但调用方只收到「恢复失败」 | 回滚失败时 log,并在最终返回的错误中追加「回收站侧链接回滚失败」 |
| P4 | recycle.go:376-398 (包级兼容函数) | `MoveEx` / `Restore` / `Delete` / `Empty` / `List` 5 个包级函数无任何生产调用方(仅测试间接覆盖),且每次调用 `New(filesRoot)` 新建临时 `TrashManager`,绕过 InstallLock 绑定——正是「未绑定锁的逃逸口」 | 确认前端/Wails binding 是否仍依赖;若已迁移到 `TrashManager` 方法,删除死代码;若仍需保留,标注 `//Deprecated` 并确保调用方持锁 |

**评价**:R24 修复(InstallLock 绑定、空根守卫前移)方向正确且落地彻底。但审查暴露三个修复未触及的实质风险:`Empty` 缺 symlink 解析守卫(破坏性最强操作保护最弱)、moveEx 跨设备回退删源失败时孤儿副本 + 误导性错误文案、moveEx rename 成功路径缺事后校验。包级兼容函数疑似死代码且构成未持锁逃逸口,建议优先确认调用链。

## download 发现项

| 级别 | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2 | download.go:225 | 重定向跳数上限 **off-by-one**:`if len(via) >= 10` 在 Go 语义里 `via` 是「已发起的请求」(不含当前要 follow 的那条);第 10 跳时 `len(via)==9`,`9>=10` 为 false 故放行,真正在 `len(via)==10` 即第 11 跳才拦。注释声明「≥10 拒绝」,实际允许 10 跳 | 改成 `len(via) > 10` 与标准库 `defaultMaxRedirect=10` 对齐,或若要严格 10 跳则 `len(via) >= 10` 但语义注释需澄清 `via` 计数基点 |
| P2 | download.go:419-434 (commitAtomicWrite) | `Sync` 失败时 `Close` 被跳过,临时文件句柄依赖外层 `defer cleanup()` 的 Close 顺序;Windows 上若 Close 失败,后续 `os.Remove` 失败,**`.part-*` 残留** | `commitAtomicWrite` 的 `Sync` 失败分支显式 `af.tmp.Close()` 后再 return |
| P3 | download.go:186 | 指数退避 `backoff << (attempt-1)` 在 attempt 较大时可能溢出或退避过长;`500ms << 9 ≈ 256s`,对默认 `MaxAttempts=3` 无碍,但调用方可设 `MaxAttempts=20` | 退避封顶,如 `min(backoff<<(attempt-1), maxBackoff)`,或限制 MaxAttempts 上界 |
| P3 | download.go:48 / 244 | `fileLocks` 条目按 `savePath`(相对路径键)互斥,但 `ResolveSavePath` 与 `downloadTo` 的 `savePath` 是否经过同一 `filepath.Clean` 规范化未见;若两处传入的 `savePath` 一个带尾 `/` 一个不带,`sync.Map` 键不同,互斥失效 | `prepareDownloadEnv` 内对 `savePath` 做 `filepath.Clean` 后再作为锁键 |
| P3 | download.go:202-207 | `New()` 创建的 Downloader 未设置 `client`,`httpClient()` 每次 `new` 一个 `http.Client`,无 keepalive 复用 | `New()` 时缓存一个 `http.Client`,或 `httpClient()` 懒初始化到 `d.client` |
| P4 | download.go:81 | `HTTPStatusError.Error()` 只输出 `HTTP <code>`,丢失 URL 上下文(调用方日志难以定位是哪个 URL 返回 4xx/5xx) | `Error()` 嵌入 Code 即可(URL 由上层 wrap) |
| P4 | download.go:158 | `isRetryableError` 中 `ErrTruncated` 被判为「可重试」,但 `ErrPartialResponse`、`ErrChecksumMismatch` 不重试——截断重试与校验和不重试的语义不对称需确认是否有意 | 若截断源于 CDN 限流,重试可能反复截断;建议截断重试次数单独封顶 |

**评价**:download.go 的 BUG-HTTP 修复链落地质量高,Content-Range 拒绝、Content-Type 白名单、原子写 + .part 清理、TruncationError 检测、可选 SHA256 均有对应实现且语义清晰。主要残留风险集中在**重定向跳数 off-by-one(L225,P2)**、**指数退避未封顶(L186,P3)**、**锁键未规范化(L48/L244,P3)**三处,均为边界补全类修复,不涉及架构调整。

## 修复状态注记（2026-08-31 闭环）

| 级别 | 位置 | 状态 |
|---|---|---|
| recycle P2-1 (Empty symlink 守卫) | recycle.go:376-401 | ✅ 已修：入口 Lstat(recycleDir) 检查 symlink，命中拒绝（正常 .recycle 是 MkdirAll 创建的普通目录，不可能是 symlink）。不用 IsInsideResolved：recycleDir 尚不存在时 EvalSymlinks 失败保留原路径，Windows 8.3 短名与长名解析不一致会让 IsInside 误判越权（TestEmpty_RecycleDirNotExist 回归）。新增 TestEmpty_RecycleDirIsSymlinkRejected 覆盖守卫。 |
| recycle P2-2 (moveEx 孤儿副本) | recycle.go:172-205 | ✅ 已修：跨设备回退源删除失败时，回滚删除已落地的副本，恢复 move 语义原子性。回滚成功→状态回到「源还在 + 副本已清理」用户可安全重试；回滚失败→错误同时披露源路径与副本路径。旧文案「副本在 dst，请手动清理」误导（实际源也还在，且重试堆积副本）已替换。 |
| recycle P2-3 (moveEx rename 事后校验) | recycle.go:151-160 | ✅ 已修：rename 成功后对 dst 做 IsInsideResolved(recycleDir, dst) 事后校验，防御文件系统 TOCTOU（rename 前父目录被换 symlink 可能让文件落到回收站之外）。命中时尝试 os.Rename 回滚，回滚失败则报错让上层决策。 |
| download P2-1 (重定向 off-by-one) | download.go:225 | ❌ 误判不修：子代理报告 `len(via) >= 10` 是 off-by-one。核查标准库 `net/http/client.go:834` 就是 `if len(via) >= 10`，与本实现完全一致。Go 语义里 `via` 是「已发起的请求」（含原始请求），`len(via) >= 10` 拒绝第 10 次重定向（第 11 个请求），允许 9 次重定向——与标准库 `defaultMaxRedirect=10` 语义完全对齐。 |
| download P2-2 (Sync 失败 Close 跳过) | download.go:420-426 | ✅ 已修：commitAtomicWrite 的 Sync 失败分支显式 `_ = af.tmp.Close()` 释放句柄后再 return，避免依赖外层 cleanup 的 Close 顺序（Windows 上句柄未释放会导致后续 Remove 失败、.part 残留）。Close 的错误被丢弃——Sync 已失败，Close 失败不影响错误分类。 |
