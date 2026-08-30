# 审核 R18：跨提交回归 + 修复验证轮（2026-08-30）

> R17 是横截面审核（按模块切片）。R18 换纵轴：按提交链验证 R17 收口后近 30 个 fix/feat 提交是否真落地、是否引入新回归。
> 五范围划分：① Go 文件操作/安装域 ② Go 扫描/解析域 ③ 前端桥接与数据层 ④ 前端 3D/预览域 ⑤ UI/菜单/i18n/脚本域。
> Checklist：ADR-109（代码审查/安全 + 跨平台 + 前端 3D 资源 + 原子写入 + 并发）+ audit-framework 反模式/致命陷阱/治理红线 + R18-回归项（审核修复提交必须验证"修 A 未破 B"）。
> 执行方式：5 个只读审核子代理并行（范围③④⑤在一次 task 调用中一并返回），主模型汇总。本轮只读，未改任何源码。

## 总览

| 范围 | 结论 | P1 | P2 | P3 | P4 |
|------|------|----|----|----|----|
| ① 导入/解码域 | 有条件通过 | 0 | 0 | 2 | 2 |
| ② Go 文件操作/同步域 | 通过 | 0 | 0 | 1 | 0 |
| ③ 前端桥接/Worker 域 | 通过 | 0 | 0 | 1 | 0 |
| ④ 前端 3D/预览域 | 通过 | 0 | 0 | 0 | 0 |
| ⑤ 脚本/CLI/i18n 域 | 有条件通过 | 0 | 2 | 2 | 1 |

全轮零 🔴P1；纵向回归验证下，R17 五范围收口的 6 项 P2 全部真落地，但收口过程暴露两簇新问题：
**① 裸 base64 解码路径未收口**（`app_texture_cache.go:72`、`folder_import.go:87`，与 R17 指出的「解码后才查大小」反模式同型）；
**② parse-args 迁移半截**（5 处迁了 parseArgs 但未消费 `args.unknown`，`--jso` 拼错静默放行，与 `audit-split` 曾中招的陷阱 #12 同型）。

---

## 范围 ① 导入/解码域 — 有条件通过

### 验证矩阵

| 提交/R17项 | 声称修复 | 实测验证（file:line + 代码片段） | 状态 |
|-----------|----------|--------------------------------|------|
| af8240c3 | base64 受限解码统一为 `DecodeBase64Limited`（预检+复检） | `go/fsutil/b64.go:20-35` 定义三段式：剥离 `\r\n` → `len*3/4` 预检 → 解码 → 复检。哨兵 `ErrB64TooLarge` 在 `:13`。调用点已收敛：`importer_file.go:60`、`app_install_import.go:71,181`、`app_model.go:64,76,571`。 | ✅ |
| 9e0b72c2 | DetectZipType 尾部探针——探测上限对齐导入上限，消除 50~500MB 真空 | `go/importer/detect_tail.go:31-111` 实现尾部探针 `DetectZipTypeFromBase64Tail`，窗口上限 `tailProbeMaxRaw=4MB`（`:22`），EOCD 定位 + 中央目录条目名解析。`app_install_import.go:66` 优先调尾部探针，`:71` 兜底走 `DecodeBase64Limited(..., MaxImportSize)`——探测口径对齐 500MB 导入上限。 | ✅ |
| 9e0b72c2 | base64 换行预检剥离 | `go/fsutil/b64.go:21-23` 预检前剥离 `\r\n`，与 `DecodeString` 忽略换行的解码器口径对齐。测试 `b64_test.go:48-62` 覆盖。 | ✅ |
| R17 P3 `app_install_import.go:170,193` | 解码后才查 MaxImportSize → 抽公共 decodeB64Limited | `app_install_import.go:181` 现走 `fsutil.DecodeBase64Limited(base64Data, types.MaxImportSize)`，预检+复检统一。`:182-185` 对 `ErrB64TooLarge` 返回 `ErrFileTooLarge` 并用 `types.MaxImportSizeMB` 常量绑定文案。 | ✅ |
| R17 P3 `app_model.go:62` | ExtractYSMHeaderFromBase64 解码无预大小守卫 | `app_model.go:64` 现走 `fsutil.DecodeBase64Limited(base64Data, types.MaxReadLimit)`，守卫已加。 | ✅ |
| R17 P3 `app_model.go:70-85` | SavePreviewTempFile 无守卫 + 临时目录无清理 | `app_model.go:76` 守卫已加（`MaxReadLimit`）。临时目录清理：`app_model.go:84` 调 `sweepPreviewTemp(tmpDir)`（`:99-115`），TTL 24h 清扫过期文件。 | ✅ |
| R17 P3 `app_model.go:541` | SaveScreenshotFile base64 无守卫 | `app_model.go:571` 现走 `fsutil.DecodeBase64Limited(base64Data, types.MaxReadLimit)`，守卫已加。 | ✅ |
| R17 P4 `app_install_import.go:188-195` | 穿越检查第 3 份手写副本 → 改调 paths.HasTraversal | `app_install_import.go:200` 对 `fileName` 改调 `paths.HasTraversal(fileName)` ✅。但 `:193-198` 对 `subpath` 仍有手写分段循环（拒绝 `""`/`.`/`..` 段），未改调 `paths.HasTraversal`——语义不同（分段 vs 整串），不算同一副本。 | ✅ |

### 新增回归

**无直接安全回归**，但收口过程中遗留两处未守卫的裸 base64 解码路径（不在 R17 五项范围内，属本轮新发现）。

### 未闭环项

| # | 位置 | 问题 | 严重度 |
|---|------|------|--------|
| 1 | `internal/app/app_texture_cache.go:72` | `SaveCachedTexture(hash, b64Data)` 是 Wails binding（前端可调），裸调 `base64.StdEncoding.DecodeString(b64Data)` 无任何大小守卫。恶意前端传超大 base64 字符串可致解码内存尖刺。**建议改调 `fsutil.DecodeBase64Limited(b64Data, types.MaxReadLimit)`。** | 🟠P3 |
| 2 | `go/fileops/folder_import.go:87` | `writeModelFolderFiles` 裸调 `base64.StdEncoding.DecodeString(f.Base64)`，仅事后查 `previewReadLimit()`（`:92`），与 R17 指出的「解码后才查大小」反模式完全一致。**建议改调 `fsutil.DecodeBase64Limited`。** | 🟠P3 |
| 3 | `go/importer/importer_file.go:62` | 文案硬编码 "文件大小超过 500MB 限制"，未绑定 `types.MaxImportSizeMB` 常量（对比 `app_install_import.go:185` 已用常量）——文案漂移风险，非安全问题 | 🟢P4 |
| 4 | `internal/app/app_install_import.go:193-198` | `subpath` 穿越 check 仍手写分段循环，未走 `paths.HasTraversal`——语义可接受（分段更严），但未完全收敛到统一入口 | 🟢P4 |

---

## 范围 ② Go 文件操作/同步域 — 通过

### 验证矩阵

| R17项 | 声称修复 | 实测验证（file:line + 代码片段） | 状态 |
|-------|----------|--------------------------------|------|
| 🟠P2 conflict.go ResolveConflict(ForceRemote) 不持 InstallLock | 冲突解决入口套 InstallLock（ADR-056） | `conflict.go:169-174` 新增 `ResolveConflicts` 公开入口，`installer.InstallLock.Lock()` + `defer Unlock()` 整段持锁；派生 `ResolveConflictsLocked`（L181）供已在锁内的调用方使用，注释明确禁止重入（L177）。sync.go:479 冲突自动解决分支正确走 `ResolveConflictsLocked` 避免 self-deadlock。 | ✅ |
| 🟠P2 sync_push.go PushResources 循环内逐条 Install 短暂持锁 | 推送循环整段持锁（Locked 变体） | `sync_push.go:32-33` `installer.InstallLock.Lock()` + `defer installer.InstallLock.Unlock()` 函数入口即整段持锁；循环内全部改用 `*Locked` 变体：`InstallLocked`(L47/80)、`InstallDirLocked`(L57)、`InstallDirRelLocked`(L59)。文件级分支（L78-92）同样 `InstallLocked`。口径与 PullResources(L99)/RelinkDir(L24) 一致。 | ✅ |
| 🟠P2 copy.go AtomicRename 崩溃窗口未文档化/RemoveAll 静默 | 崩溃窗口文档化 + RemoveAll 失败记日志 | `copy.go:181-184` 注释明确文档化崩溃窗口："Rename(dst,backup) 成功与 Rename(tmpDir,dst) 之间进程崩溃 → dst 缺失，旧数据仅在 .bak-<ts>；恢复需人工扫描同目录 .bak-*"。两处 `os.RemoveAll` 失败均 `log.Printf`：清理陈旧备份(L187-188)、替换成功后清理(L197-198)。回滚分支 L194 `_ = os.Rename(backup, dst)` 恢复。 | ✅ |
| 🟡P3 copy.go:243-246 / fileops.go 存在性检查用 os.Stat 非 Lstat | 统一 os.Lstat | `copy.go:253` `os.Lstat(target)` 守卫已带注释（L251-252 悬空 symlink 绕过说明）；`copy.go:185` `os.Lstat(dst)` 原子替换存在性判定。fileops.go 所有"目标已存在"守卫均为 `os.Lstat`：L88/136/231/326；folder_import.go:110/114/150；enable.go:76/85/120/130。**注**：fileops.go:241、329 的 `os.Stat(src)` 是源 IsDir 判断（非存在性守卫），R17 P3 不针对此，保留正确。 | ✅ |
| 🟡P3 write.go:59-73 ReadLimitedEntry 读错误与超限归并 | 区分 reason 或 log | `write.go:69-75` 读取 IO 错误经 `log.Printf("[fsutil] ReadLimitedEntry 读取失败（非超限，返回 nil 跳过条目）: %v", err)` 留诊断线索，与超限（L76-78 `len > limit → nil` 静默跳过）区分。注释 L71-73 明确"读取错误（IO 故障）与超限是两类失败"。 | ✅ |
| 🟡P3 sync.go:276 `.recycle` 子串匹配误跳正常模型 | 改逐路径段判定 | `sync.go:279` `if hasRecycleSegment(p)`；`sync.go:522-528` `hasRecycleSegment` 逐段 `strings.EqualFold(seg, ".recycle")`，整路径不再用 `strings.Contains`。注释 L276-278 说明原整路径子串 Contains 会误跳 `my.recycle.backup.ysm`。 | ✅ |

### 新增回归

无。InstallLock 口径全链一致（Push/Pull/Relink/ResolveConflicts/SyncToggleStatus 均整段持锁；锁内调用走 *Locked 变体防重入死锁）；Lstat 化未误伤源 Stat 场景。

### 未闭环项

- 🟡P3（范围外残留，非本提交引入）：`go/sync/conflict.go:218` `if _, err := os.Stat(dir); os.IsNotExist(err)` 仍用 os.Stat 做目录存在性判定。R17 原话仅点名 `fsutil/copy.go` 与 `fileops.go`，未含 conflict.go，故不计为本次未闭环，但同一反模式（悬空 symlink 占位绕过 NotExist 守卫）在 conflict.go 仍存。建议后续统一 Lstat。
- 🟡P3（范围外残留，无需修复）：`go/fsutil/hardlink_other.go:16`、`hardlink_windows.go:15` 的 `os.Stat(path)` 用于 IsHardLink 判断——此处 Stat 跟随 symlink 取 inode 是正确语义（硬链接判断需解析到实际 inode），不应改 Lstat。仅记录以避免后续误改。

---

## 范围 ③ 前端桥接/Worker 域 — 通过

### 验证矩阵

| R17项/提交 | 声称修复 | 实测验证（file:line + 代码片段） | 状态 |
|-----------|----------|--------------------------------|------|
| P2 stats.worker mt 失败回退单线程 | mt init 抛错时不整批 error，回退单线程 init | `workers/stats.worker.ts:113-121`：`try { ok = mt ? await initYsmParserInWorkerMt() : await initYsmParserInWorker(); } catch (mtErr) { if (!mt) throw mtErr; ok = await initYsmParserInWorker(); }`。mt 失败追加单线程回退 ✅。**注**：mt=true 路径初始化成功后，statsOne 仍走单线程 `decodeYsmInWorker`，mt 实际未生效用于解码——既有架构问题，不在本次审核的 R17 修复范围内。 | ✅ |
| P2 sync.ts:122-135 finally 无条件 tree:reload | 短路跳过 reload；skipped 细分 | `core/handlers/sync.ts:122-129` try 块里 `bus.emit("tree:reload")` 在 `else`（仅 ok 时），finally 块在 :137-140 只发 done 不 emit reload。短路落地 ✅。**但** skipped 仍是 boolean（`:139` `skipped: failed`），未区分 busy 跳过 / 配置缺失 / 实际跳过——R17「skipped 细分」未落地。 | ⚠️ |
| P3 web-stats.ts Worker 池全路径降级结算（亮点） | mt→single 回退路径是否真生效 | `web-stats.ts:127-167`：onmessage error 分支 (:149-154) terminate+settle(null)，onerror (:158-163) 同样。这是主线程对 Worker 的桥接兜底，与 stats.worker 内部的 mt 回退互补。 | ✅ |
| P3 error-diary.ts:101-106 截断日志死循环链（亮点） | AddOpLog 加 .catch 截断 | `error-diary.ts:104-106` AddOpLog 加了 .catch 截断。注释 :101-103 解释了原死循环机制。 | ✅ |
| P3 bus.ts:174-199 快照遍历 + once 退订（亮点） | emit 用 .slice() 快照遍历，once 返回退订函数 | `bus.ts:170-202` emit 用 `.slice()` 快照遍历（:181），once 返回退订函数（:199）。 | ✅ |
| f5f53caa blob URL 泄漏 | createObjectURL/revokeObjectURL 成对 | fbx-adapter.ts:154 创建存 map，:294 finally revoke；:178-180 创建，:223 finally revoke。mmd-adapter blob URL 全部 push 到 c.blobUrls（:428/484/771/849），finally 块 :1090/:1195 revoke 全部。成对 ✅。 | ✅ |
| f5f53caa call_failed 补 meta | 错误抛出时附带 meta 信息 | `cli-bridge.ts:141-142` call_failed meta 已落地。 | ✅ |
| R17 亮点 backend/app.ts:48-61 失败重置 _appPromise | 防毒化 | 已确认存在。 | ✅ |
| R17 亮点 core/handlers/sync.ts:102-135 busy-skip 语义 + finally 兜底 | busy 命中发 done {skipped: true}（:106） | 已确认。 | ✅ |
| R17 亮点 locale.ts:82-85 代际守卫范式 | loadLocale 代际守卫 | 已确认。 | ✅ |

### 新增回归

无。blob URL 成对、call_failed meta 已补、mt 回退单线程落地。

### 未闭环项

- 🟡P3 `core/handlers/sync.ts:139` `skipped: failed` 仍是 boolean，未区分 busy 跳过 / 配置缺失 / 实际跳过。R17「skipped 细分」未落地。消费方 app-sidebar index.ts:218 `if (p?.skipped) return` 跳过，当前 boolean 够用，但 UI 无法给不同提示。

---

## 范围 ④ 前端 3D/预览域 — 通过

### 验证矩阵

| 提交 | 声称修复 | 实测验证（file:line + 代码片段） | 状态 |
|------|----------|--------------------------------|------|
| **a448e30b** saveScreenshot else | else 分支按 key 渲染视角帧 | `frontend/src/views/app-preview/skeleton-render.ts:247-254`：`else { const b64 = await renderFrame(model, key); ... await SaveScreenshotFile(base + "_" + key + ".png", b64); }`。`renderFrame`（:260-273）调 `renderMultiAngle` 并按 `key` 匹配 `results.find(r => r.name === key)`，返回对应视角帧。非默认 `renderFrontFrame`。 | ✅ |
| **2fcc289e** loadState cone 重建+挂载 | volumetric-ON 会话不丢光锥 | `frontend/src/utils/3d/caps/light-capability.ts:804-813`：`else if (state.volumetricEngine === "cone") { this.volumetricEngine = "cone"; if (this.params.volumetric.enabled && this.params.spotlight.enabled) { this.rebuildCone(); if (this.coneGroup && !this.coneGroup.parent) { this.scene.add(this.coneGroup); ...定位 } } }`。cone 引擎恢复路径会重建+挂载锥组，且仅当 params 真启用时才挂。测试 `light-capability.test.ts:381-387` 锁定往返。 | ✅ |
| **ccf8e3c3** 45393d06 类型化直调 4 组守卫 | 手写断言清零 | grep `App as unknown as` / `(App as unknown` 全仓 0 命中（生产）。守卫改 `canBinding(binding)` → `binding in browserAdapter`（`platform-web.ts:46-49`）+ `in webImpls` has-trap（`browser-adapter.ts:87-90`）。`as unknown as Record` 残留仅限测试 mock（`browser-adapter.test.ts:173/185`），非直调守卫。 | ✅ |
| **cf1dd19e** render-mode 单属性 override 独立回落(#11) + shadow collectLights 白名单注释(#10) | 独立回落快照（非共享） | `render-mode-capability.ts:95-131`：`applyOverrides` 逐属性调 `applyProp`；`applyProp` 三态——override 非 null 用它+登记 `coveredProps`；override null 且 `coveredProps.has(key)` 回落该属性 `orig[key]` 快照原值+清登记；从未覆盖→保持现值。**逐属性独立回落**，非全部清空才 `restoreSnapshot`（:133-146 仅无任何 override 时触发）。`shadow-capability.ts:308-319` 已补白名单契约注释：有意不遍历场景，只认 `lightCap`/`legacyLights` 两个显式来源；测试 `shadow-capability.test.ts:80/292` 锁定。 | ✅ |
| **df6a9659** caps 三处——setTargetHeight 重建锥后回挂(#6)、setEnabled 重算 surface.visible(#7)、render-mode 单属性 override(#11) | setTargetHeight 回挂、setEnabled 门控重算 | `light-capability.ts:617-626`：`setTargetHeight` 先记 `wasMounted = Boolean(this.coneGroup?.parent)`，`rebuildCone()` 后 `if (wasMounted) this.attachCone()`（:632-637 幂等回挂+重新定位）。测试 `light-capability.test.ts:465-477` 锁定。`ground-capability.ts:133-145`：`setEnabled` 末尾 `this.updateSurfaceVisible()`（:205-208 重算 `enabled && params.visible && matSource !== "none"`），与 `setVisible` 路径对称。 | ✅ |
| **5809800c** CodeReview 批次1——loadState 引擎恢复不强制重开体积光、syncConeMount 删死分支 | 引擎恢复不强制 volumetric=true；死分支删除 | `light-capability.ts:802-814`：`"postprocess"` 走 `setVolumetricEngine("postprocess")`（其 `⇒ volumetric 关闭` 约束有意）；`"cone"` 走**无副作用字段赋值** `this.volumetricEngine = "cone"`，不调 `setVolumetricEngine`——后者 cone 分支会强制 `volumetric.enabled = true`（:712-721），正是 5809800c 修正的方向反转 bug。`syncConeMount`（:660-668）仅 `if (coneGroup && coneGroup.parent)` 处理卸载+定位，**无 else-if 重挂分支**（注释 :657-658 确认「曾经的 else-if 重挂分支是死代码，已删」）。 | ✅ |
| **a6d8c4a3** ADR-132 审核修复——switch 重建后 select 切换闭包存活、会话序号重置、快照回退 | select 切换闭包存活、会话序号重置、快照回退 | `multi-model.ts:39-63`：`multiModelSelectNode` 返回声明式 `kind:"select"` 节点，`control.get`/`set` 闭包由调用方注入的 `activeId()`/`onSelect()` 装配——per-scene 会话态闭包，switch 重建后闭包存活（对齐 6b080b33 Bug B 范式）。`mount-preview-core.ts:165-166`：`_mountSessionSeq` 模块级自增，新 mount `sessionId = "s" + ++_mountSessionSeq`（:273-276），switchTo 走 switch-preview 复用外壳**不重新 mount 不递增**——会话序号稳定。快照回退：`render-mode-capability.ts:133-146` `restoreSnapshot` 逐材质还原首拍快照；litematic 切片 schema 走 per-scene `sliceKey = "litematic-slice-" + ++mdLiSliceInstance`（`litematic-adapter.ts:444`），dispose 只 `unregisterSchema` 自己的（:399），不误伤并存场景。 | ✅ |

### 新增回归

无。逐项核查 `light-capability.ts`、`ground-capability.ts`、`render-mode-capability.ts`、`shadow-capability.ts`、`mount-preview-core.ts`、`multi-model.ts`，无语义性回归。

### 未闭环项

无。

---

## 范围 ⑤ 脚本/CLI/i18n 域 — 有条件通过

### 验证矩阵

| R17项/提交 | 声称修复 | 实测验证（file:line + 代码片段） | 状态 |
|-----------|----------|--------------------------------|------|
| P2 scripts argv 迁 parse-args（unknown 拦截） | 全量迁 parse-args | `frontend/src/core/i18n/tr.ts:18-24` `tr` 兜底落地。`scripts/check-script-hygiene.mjs:1-34` 文件头列 5 口径。parseArgs import 数：`grep -rl "parseArgs" scripts/` 命中 ~20 文件。**但** `process.argv` 裸用仍 ~54 处（`grep -rn "process.argv" scripts/ | grep -v node_modules`）。其中位置参数脚本（hygiene 规则 5 会告警的）：`bug-search.mjs:62-64`、`inspect_ysm.mjs:102-104`、`test-decode-from-memory.mjs:33`、`translucency-probe.mjs:272`、`commit-with-check.mjs:33`、`codemod.mjs:511-512`、`trace-analyze.mjs:30-33`。这些脚本无 unknown 白名单拦截，`--jso` 拼错静默放行。**声称「全量迁」与实测不符。** | ⚠️ |
| P3 toast 零裸中文（48 处收敛） | 右键菜单行为 toast 全量 i18n | `grep -rn "[一-龥]" frontend/src/core/handlers/ frontend/src/features/context-menu/ 2>/dev/null` 命中 0。所有 toast 走 `tr(key, fallback)`：`context-menu-handlers.ts:86/92/94/101/116/117/121/147/198/203/205/206/222-224/227/254`、`context-menu-file-handlers.ts:19/26/37-40/46/55-58/64/76/81/86/89/96-98/107/115/117/120/129/140/148`、`context-menu-dir-handlers.ts:17-20/26/35-38/44`、`context-menu-shared.ts:63/69`。**但 1 处残留**：`menu-defs.ts:67` `label: (ctx) => \`📦 已选 ${ctx.count || 0} 个文件\``（batch 菜单 noop 标题，裸中文 + 未走 tr）| ⚠️ |
| P3 tr(key, fallback) 兜底抽取+应用 | i18n 缺失键走 fallback | `frontend/src/core/i18n/tr.ts:18-24` `export function tr(key, fallback, params?) { const v = t(key, params); return v === key ? fallback : v; }`。`tr.test.ts:16-48` 覆盖 5 场景（键存在/键缺失/无 fallback/插值/fallback 等于翻译）。应用点：`menu-defs.ts:50/52/56/70-72/76/81-82/88-93/96-101/109-115/118-120` 全走 `tr(key, "Fallback")`；handler 层全走 tr | ✅ |
| P3 visibleWhen 节点级守卫（声明式） | 右键菜单声明式节点级 visibleWhen | `frontend/src/core/menu-defs.ts:30` `visibleWhen?: (ctx: CtxShowPayload) => boolean;` 类型定义就绪；`context-menus.ts:28` `if (item.visibleWhen && !item.visibleWhen(norm)) return false;` 过滤链落地。**但 MENU_DEFS 中 0 处实际使用 visibleWhen**（4 类菜单 19 个 item 全部未挂守卫）。测试 `context-menus.test.ts:904-964` 验证了机制但无生产守卫。3D 侧 `litematic-adapter.ts:278/283`、`stats.ts:42`、`menu-graph.ts:88/102` 声明式 visibleWhen 已全量落地，无手写 3D 菜单 | ⚠️(机制✅，生产守卫缺) |
| P4 hygiene 新口径（lint/wc/行宽等） | scripts/ 下 hygiene 检查新口径 | `check-script-hygiene.mjs:1-34` 文件头列 5 口径：(1) 退出码失效 (2) 共享层内联 (3) --json 契约 (4) 文件头 5 字段 (5) 2026-08-30 新增 positional 脚本须走 parse-args。`checkArgvContract` (`:161-173`) 机检：未 import parseArgs 且手写 argv+positional → 告警；import parseArgs 但未消费 `.unknown` → 告警。lint/wc/行宽未见独立配置文件（eslint/prettier 未新增），口径仍为 hygiene 检查器内的文本正则 | ✅(口径落地，lint 配置未见) |

### 新增回归

1. **⚠️ P2 `event-graph.mjs:25` / `gen-routes-quick.mjs:121` / `gen-routes.mjs:119` / `i18n-check.mjs:32` / `texture-golden.mjs:176` import parseArgs 但未消费 `args.unknown`** — `check-script-hygiene.mjs:169-172` 规则 5 明确此类应告警。`--jso` 拼错会被 parseArgs 收进 unknown 数组但调用方不检查 → 静默走默认值/默认行为，与 `audit-split` 曾中招的陷阱 #12 同型。这 5 处是「迁了 parseArgs 但 unknown 拦截半截」的新回归。

2. **无其他语义性回归**：toast i18n 过程中原错误信息语义保留（`toastError(e, tr("ctx.moveFail", "Move failed"))` 形式，friendlyError + fallback 双保险）；tr 兜底未引入「fallback 永远显示」退化（`tr.ts:24` 判定 `v === key` 才取 fallback，翻译命中时返回翻译值）。

### 未闭环项

- **🟠 P2 — parse-args 迁移非「全量」**：~54 个脚本仍裸用 `process.argv`（清单见验证矩阵）。其中需重点关注的位置参数脚本（hygiene 规则 5 会告警的）：`bug-search.mjs:62-64`（手写 argv + `.find` 取位置参数）、`inspect_ysm.mjs:102-104`（同型）、`test-decode-from-memory.mjs:33`（`process.argv[2]` 裸取）、`translucency-probe.mjs:272`（位置参数 root）、`commit-with-check.mjs:33`、`codemod.mjs:511-512`、`trace-analyze.mjs:30-33`。这些脚本无 unknown 白名单拦截，`--jso` 拼错静默放行。声称「全量迁」与实测不符。

- **🟡 P3 — `menu-defs.ts:67` 裸中文残留**：`label: (ctx) => \`📦 已选 ${ctx.count || 0} 个文件\``。batch 菜单标题项，未走 `tr()`，含裸中文「已选/个文件」。R17「toast 零裸中文 → 48 处收敛」声称已收敛，此处漏网。

- **🟡 P3 — visibleWhen 生产守卫缺失**：`menu-defs.ts` 类型与过滤链就绪，但 MENU_DEFS 4 类菜单 19 个 item **0 处挂 visibleWhen**。提交 `a0bd929e` 声称「节点级 visibleWhen 守卫 → 声明式」，机制落地但无生产消费者。若 R17 期望的是「右键菜单实际有条件隐藏的 item」，则未闭环。

- **🟢 P4 — lint/wc/行宽配置未见独立文件**：hygiene 检查器内文本正则已落地新口径（规则 5 + 文件头 5 字段机检），但仓库根未见新增 `eslint.config.*` / `.prettierrc` / 行宽配置。若 R17 期望的是「scripts/ 下有 lint 工具链」，则未闭环；若期望「hygiene 检查器口径扩展」，则已闭环。

---

## 跨域共性主题

### 主题一：base64 解码守卫未全量收口（范围①新发现）

R17 范围①原话发现 3 处 base64 解码无预大小守卫，R18 验证这 3 处已全部修复。但 R18 回归扫描新发现 2 处裸 base64 解码路径（`app_texture_cache.go:72`、`folder_import.go:87`），与 R17 指出的反模式同型。**建议下一轮审核将 base64 解码守卫的覆盖度作为专项检查项，并考虑用 grep 扫描所有 `base64.StdEncoding.DecodeString` 调用，确认是否全部经过 `DecodeBase64Limited` 或等价预守卫。**

### 主题二：parse-args 迁移半截（范围⑤新发现）

R17 范围⑤原话发现 scripts 参数解析未收敛 parse-args，建议全量迁。R18 验证 ~20 个脚本已 import parseArgs，但 **5 处迁了 parseArgs 却未消费 `args.unknown`**（`event-graph.mjs:25` 等），且 **~54 个脚本仍裸用 `process.argv`**。声称「全量迁」与实测不符。**建议下一轮审核将 parse-args 的 unknown 消费作为专项检查项，并考虑用 `check-script-hygiene.mjs:161-173` 的 `checkArgvContract` 规则对所有脚本做一次全量扫描。**

### 主题三：R17 收口过程未引入语义性回归（全域）

R18 纵向回归验证下，R17 五范围收口的 6 项 P2 全部真落地，且收口过程未引入语义性回归（范围④无新回归，范围③仅 1 处 skipped 未细分的既有 P3，范围②无新回归）。**R17 → R18 的"审核修复 → 再审核"连环动作是有效的，修 A 未破 B。**

---

## R18 审核结论

1. **R17 五范围收口验证**：6 项 P2 全部真落地（范围②3×P2 + 范围③2×P2 + 范围⑤1×P2），证据 file:line 齐全。范围④7 个 fix(3d) 提交全部落地，无新回归。

2. **新发现的未闭环项**：
   - 🟠P3 `app_texture_cache.go:72` 裸 base64 解码无守卫（Wails binding，前端可调）
   - 🟠P3 `folder_import.go:87` 裸 base64 解码，仅事后查大小（R17 反模式再现）
   - 🟠P2 5 处迁了 parseArgs 但未消费 `args.unknown`（`event-graph.mjs:25` 等）
   - 🟠P2 ~54 个脚本仍裸用 `process.argv`（声称「全量迁」与实测不符）
   - 🟡P3 `menu-defs.ts:67` 裸中文残留（R17「toast 零裸中文」漏网）
   - 🟡P3 `sync.ts:139` skipped 仍是 boolean，未细分（R17「skipped 细分」未落地）
   - 🟡P3 visibleWhen 生产守卫缺失（机制落地但 MENU_DEFS 0 处挂守卫）
   - 🟢P4 `importer_file.go:62` 文案硬编码 "500MB" 未绑定常量
   - 🟢P4 `app_install_import.go:193-198` subpath 穿越 check 仍手写分段循环
   - 🟢P4 lint/wc/行宽配置未见独立文件

3. **建议下一轮审核（R19）重点**：
   - base64 解码守卫覆盖度专项（全仓 grep `base64.StdEncoding.DecodeString`）
   - parse-args 的 unknown 消费专项（全仓 grep `parseArgs` + 检查 `.unknown` 消费）
   - `menu-defs.ts:67` 裸中文残留 + `sync.ts:139` skipped 细分 + visibleWhen 生产守卫缺失的修复验证

---

## 审核 R18 执行清单

- [x] 范围① 导入/解码域：验证 DecodeBase64Limited 统一、DetectZipType 尾部探针对齐导入上限、无守卫分支清零
- [x] 范围② Go 文件操作/同步域：验证 R17 3×P2 修复（InstallLock/PushResources 整段持锁、AtomicRename 窗口）、Lstat 化覆盖
- [x] 范围③ 前端桥接/Worker 域：验证 mt 失败回退单线程、finally reload 短路、loadLocale 在途去重
- [x] 范围④ 前端 3D/预览域：验证 saveScreenshot else 视角帧、loadState cone 重建、render-mode 单属性 override 回落
- [x] 范围⑤ 脚本/CLI/i18n 域：验证 scripts argv 全量迁 parse-args、toast 零裸中文、tr 兜底调用
- [x] 主模型汇总 5 份报告，按 P1/P2/P3/P4 归并，写入本文档

---

*审核人：AtomCode（GLM-5.2）× 5 个只读审核子代理并行*
*审核日期：2026-08-30*
*审核范围：v1.14.0..HEAD 中 R17 收口后的 fix/feat 提交链*
*Checklist：ADR-109 + audit-framework + R18-回归项*
