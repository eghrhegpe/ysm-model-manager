# YSM 模型管理器 — 代码质量审计报告

> 审计日期：2026-08-06
> 审计方式：子代理并行审计 + 人工核对源码
> 审计范围：69 张知识卡对应的全部核心模块
> 修复提交：`4d092d0` / `9ac3acd` / `f8f0063`

---

## 一、审计范围

| 层级 | 覆盖模块 | 知识卡数 |
|------|----------|----------|
| 核心基础设施 | bus / page-store / wails-bridge / global-handlers / error-diary | 5 |
| 全局 Handler | dnd / sync / instance-ops / require-mcroot | 4 |
| UI 组件 | app-content / app-modules / app-tree / app-sidebar / app-sync-manager / app-resource-manager / app-preview / context-menu / modal / batch-rename / tag-editor / app-nav / app-toast | 13 |
| 业务功能 | import-queue / recycle-bin / resource-packs / version-updater / community / import-executor / oldest-models | 7 |
| Go 后端 | scanner / importer / installer / fileops / paths / types / sync / tags / recycle / avatar / dedup / download / instance / updater / watcher / ysm / geometry / litematic / threejs / fsutil / errors / version / packs / logs | 24 |
| Wails Binding | internal/app/*.go（12 个文件） | 1 |
| 工具模块 | display / format / html / summarize / dom / debug / mc-format / animation / export / extensions / types / icon / resource-types | 13 |
| 渲染模块 | model3d / model2d / ysm-wasm / animation-system | 4 |
| 配置 | resource-registry / routes | 2 |
| **合计** | **69 张知识卡** | **69** |

---

## 二、审计方法

1. **子代理并行审计**：按模块分组，每组 5-15 个文件，由独立子代理深入源码审计
2. **人工核对**：每个子代理报告中的 P1/P2 问题，人工读取对应源码文件逐行核对
3. **修复验证**：每轮修复后跑 `go build` + `tsc --noEmit` + `doctor` 全量验证
4. **知识卡对照**：修复后对照知识卡，确认文档是否需要更新

---

## 三、三轮审计结果汇总

### 3.1 问题统计

| 轮次 | P1 | P2 | P3 | 修复文件数 | 改动行数 |
|------|----|----|----|-----------|----------|
| 第一轮 | 0 | 6 | — | 6 | ~80 |
| 第二轮 | 7 | 13 | — | 20 | ~174 |
| 第三轮 | 2 | 11 | 5 | 14 | ~110 |
| **合计** | **9** | **30** | **5** | **40** | **~364** |

### 3.2 P1 问题（9 项，已全部修复）

| # | 文件 | 问题 | 风险 | 修复 |
|---|------|------|------|------|
| 1 | `go/sync/sync.go` | WalkDir 回调中直接 `os.Rename`，遍历树被破坏 | 文件丢失/重复/损坏 | 两阶段：先收集 `[]renameOp`，遍历完成后再批量执行 |
| 2 | `internal/app/app_model.go` | `ReadFileBytes` 无路径校验 | 可读取系统任意文件 | 加 `paths.IsInside(a.ysmRoot(), path)` 守卫 |
| 3 | `internal/app/app_model.go` | `SaveScreenshotFile` 接受任意 filename | 可覆盖系统文件 | 加 `filepath.Clean` + `IsInside` 守卫 |
| 4 | `internal/app/resource_bindings.go` | `DeleteModelDir` 直接 `RemoveAll` | 传入 `C:\Windows\win.ini` 删整个 Windows | 加 `IsInside` 守卫 |
| 5 | `frontend/src/views/app-sync-manager/index.ts` | `_init` 异常路径跳过 `_unsubs` 清理 | handler 翻倍累积，内存泄漏 | `_unsubs` 清理前移到 async 加载之前 |
| 6 | `frontend/src/utils/dom/display.ts` | `renderModelNameWithHighlight` 对 HTML 直接正则替换 | XSS 注入 + DOM 破坏 | 改用 `esc()` 转义 + `textContent` 安全插入 |
| 7 | `frontend/src/utils/format/summarize.ts` | `safeUrl` 不拦截 `javascript:`/`data:` | 恶意链接绕过安全校验 | 显式拦截 `javascript:`/`data:` scheme |
| 8 | `frontend/src/utils/3d/model3d.ts` | `rebuildDebug` 移除旧 `_debugGroup` 时未 dispose | 频繁切换 debug 模式 → 内存泄漏 | 遍历子对象 dispose 几何体/材质/纹理 |
| 9 | `frontend/src/utils/3d/model3d.ts` | `makeTextTexture` 每次创建 `CanvasTexture` 永不释放 | pivot 模式每骨骼一个标签 → 累积泄漏 | 释放旧纹理后再创建新纹理 |

### 3.3 P2 问题（30 项，已全部修复）

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 1 | `go/fileops/fileops.go` | `copyFile` 失败不删半截文件 | 失败时 `os.Remove(dst)` |
| 2 | `frontend/src/core/handlers/dnd.ts` | `getFileFromEntry` 无 timeout 兜底 | 加 5s timeout |
| 3 | `go/scanner/scanner.go` | WalkDir 错误静默丢弃 | 改为 `fmt.Printf` 记录 |
| 4 | `go/importer/importer_file.go` | `..` 检测误杀 `my..file.ysm` | 改为 `../` / `..\\` / 末尾 `..` |
| 5 | `frontend/src/app-modules.ts` | 全局 dragover 阻止事件与 DnD 冲突 | 移除 `stopPropagation()` |
| 6 | `frontend/src/core/handlers/instance-ops.ts` | `ListFileNames` 失败静默忽略 | 加 `console.warn` |
| 7 | `go/tags/tags.go` | `SetTags` save() 在锁外执行 | save() 移入锁内 |
| 8 | `go/tags/tags.go` | `AddTag`/`RemoveTag` TOCTOU 竞态 | 改为锁内原子操作 |
| 9 | `go/recycle/recycle.go` | `Restore` Rename 失败后残留半截文件 | 失败后 `os.Remove(dst)` |
| 10 | `go/installer/installer.go` | `InstallWithOverlay` TOCTOU 静默覆盖 | `copyFileLocked` 内加防覆盖检查 |
| 11 | `go/sync/sync.go` | `SyncToggleStatus` 未持有 `installLock` | 加 `syncLock` 防止与安装并发 |
| 12 | `internal/app/app_download.go` | `EnqueueDownloads` 无 URL 校验 | 仅放行 http/https |
| 13 | `internal/app/app_scan.go` | `ListFileNames`/`CheckFileExists` 无路径校验 | 加 `IsInside` 守卫 |
| 14 | `internal/app/app_files.go` | `CreateDir`/`RenameDir`/`RemoveDir`/`MoveModelFile` 无路径校验 | 加 `IsInside` 守卫 |
| 15 | `internal/app/app_tags.go` | `getTagsStore()` 非原子初始化 | 改为 `sync.Once` |
| 16 | `frontend/src/features/import-queue.ts` | `void routeCollected()` 丢弃 Promise rejection | 加 `.catch()` |
| 17 | `frontend/src/views/app-preview/index.ts` | `model:select` async handler 无 catch | 加 `.catch()` |
| 18 | `frontend/src/views/context-menu/index.ts` | `hide()` 不 remove keydown 监听器 | 加 `removeEventListener` |
| 19 | `frontend/src/utils/dom/html.ts` | `hl()` 双重转义 | 从已转义的 `s` 切分 |
| 20 | `frontend/src/utils/dom/format.ts` | `fmtDate()` 不校验 `ts` 类型 | 加 `Number.isNaN` + `isNaN(d.getTime())` |
| 21 | `frontend/src/wasm/ysm-parser.ts` | WASM 模块单例永不销毁 | 加 `destroyYSMParser()` |
| 22 | `frontend/src/wasm/ysm-parser.ts` | MEMFS 输出文件读取后不删除 | 读取后 `FS.unlink` |
| 23 | `go/updater/update.go` | `Download` 截断检测分支 return 前未 `f.Close()` | 加 `f.Close()` |
| 24 | `go/packs/mcmeta.go` | 目录格式 `pack.mcmeta` 读取错误被吞 | 返回具体错误 |
| 25 | `go/dedup/dedup.go` | `io.Copy` 返回值被忽略 | 读取失败返回空 hash |
| 26 | `go/avatar/avatar.go` | `ReadCachedAvatar` 错误直接返回 `""`/`nil` | 返回具体 error |
| 27 | `frontend/src/features/community/events.ts` | cleanup 未移除 DOM 事件监听器 | 用 `cloneNode` 替换所有绑定元素 |
| 28 | `frontend/src/features/import-executor.ts` | `fileToBase64` 失败时 `resolve("")` | 改为 `reject()` |
| 29 | `frontend/src/views/app-sidebar/index.ts` | `_bindSyncSelected` 每次 connect 重复注册 | connect 前先移除旧 handler |
| 30 | `frontend/src/utils/animation/animate.ts` | `animateNumber` setTimeout 链无 timer ID | 返回取消函数 |

### 3.4 P3 问题（5 项已修复，5 项跳过）

| # | 文件 | 问题 | 处理 |
|---|------|------|------|
| 1 | `frontend/src/utils/3d/model2d.ts` | `canvas.getContext("2d")!` 非空断言 | 加 null 守卫 |
| 2 | `frontend/src/utils/3d/model3d.ts` | `bd.localPosition[0]` 无边界检查 | 加 `?? 0` |
| 3 | `go/download/downloader.go` | `os.MkdirAll` 失败静默返回空字符串 | 加 `log.Printf` |
| 4 | `go/fsutil/walk.go` | WalkDir 回调错误被 `return nil` 吞没 | 加 `log.Printf` |
| 5 | `frontend/src/core/error-diary.ts` | `_unsubError`/`_unsubRejection` unsafe cast | 改为具体 EventListener 类型 |
| — | `frontend/src/views/app-preview/wasm.ts` | 多处 `catch {}` 静默吞异常 | 跳过：可选功能，静默忽略是设计意图 |
| — | `go/instance/instance.go` | `sizeOf` 中 `os.Stat` 失败返回 0 | 跳过：文件不存在时 size=0 是合理行为 |
| — | `go/logs/logs.go` | `os.WriteFile` 失败仅 `log.Printf` | 跳过：日志系统是 best-effort |
| — | `go/dedup/dedup.go` | WalkDir 错误已 log 但继续 | 跳过：继续扫描是设计意图 |
| — | `go/avatar/avatar.go` | `CacheDir` 忽略 `os.Executable()` 错误 | 跳过：失败时回退到相对路径 |

---

## 四、发现的设计模式（建议补充到知识卡）

以下设计模式在审计过程中被识别，建议在对应知识卡中补充文档：

### 4.1 两阶段遍历-执行模式

**涉及文件**：`go/sync/sync.go`
**模式**：在 `filepath.WalkDir` 回调中**不直接执行**会修改遍历树的操作（如 `os.Rename`），而是先收集操作列表，遍历完成后再批量执行。
**原因**：`filepath.WalkDir` 在遍历过程中修改目录结构会导致文件被跳过或重复处理。
**知识卡**：`docs/knowledge/go-sync.md`

### 4.2 Wails Binding 路径守卫模式

**涉及文件**：`internal/app/app_model.go`、`internal/app/resource_bindings.go`、`internal/app/app_scan.go`、`internal/app/app_files.go`
**模式**：所有 Wails Binding 暴露的文件操作方法，在操作前统一加 `paths.IsInside(a.ysmRoot(), path)` 守卫，限制操作范围在 `FilesRoot` 内。
**原因**：Wails Binding 是前端可直接调用的 API，无路径校验会导致任意文件读写。
**知识卡**：`docs/knowledge/wails-bindings.md`

### 4.3 Three.js 资源 dispose 模式

**涉及文件**：`frontend/src/utils/3d/model3d.ts`
**模式**：移除 Three.js 对象时，必须遍历其子对象并调用 `geometry?.dispose()`、`material?.dispose()`、`texture?.dispose()`，否则 GPU 内存不会释放。
**原因**：Three.js 的 `Object3D.remove()` 只从场景图移除引用，不释放底层 WebGL 资源。
**知识卡**：`docs/knowledge/model3d.md`

### 4.4 WASM 生命周期管理

**涉及文件**：`frontend/src/wasm/ysm-parser.ts`
**模式**：WASM 模块初始化后应提供 `destroyYSMParser()` 销毁函数，并在 MEMFS 输出文件读取后立即 `FS.unlink` 清理。
**原因**：WASM 的 HEAP 内存不会自动回收，MEMFS 文件会持续占用虚拟内存。
**知识卡**：`docs/knowledge/ysm-wasm.md`

### 4.5 事件监听器清理模式

**涉及文件**：`frontend/src/features/community/events.ts`、`frontend/src/views/context-menu/index.ts`
**模式**：组件/视图销毁时，必须移除所有 `addEventListener` 注册的监听器。对于大量监听器，可用 `cloneNode(false)` 替换绑定元素来一次性解除所有事件绑定。
**原因**：悬空监听器会导致内存泄漏和已卸载 DOM 的操作异常。
**知识卡**：`docs/knowledge/community-feature.md`、`docs/knowledge/context-menu.md`

### 4.6 原子文件替换模式

**涉及文件**：`go/installer/installer.go`、`go/fileops/fileops.go`
**模式**：写入文件时先写入 `.tmp` 临时文件，成功后 `os.Rename` 原子替换目标文件；失败时删除临时文件，不破坏原文件。
**原因**：直接写入目标文件在写入中途崩溃会导致半截文件残留。
**知识卡**：`docs/knowledge/go-installer.md`、`docs/knowledge/go-fileops.md`

### 4.7 TOCTOU 缩小模式

**涉及文件**：`go/installer/installer.go`
**模式**：文件存在性检查（`os.Stat`）和写入操作（`os.WriteFile`/`os.Rename`）应在**同一函数内**完成，缩小时间窗口。
**原因**：检查与写入之间的时间窗口内，并发操作可能改变文件状态。
**知识卡**：`docs/knowledge/go-installer.md`

### 4.8 类型安全事件处理器模式

**涉及文件**：`frontend/src/core/error-diary.ts`
**模式**：存储 `EventListener` 时使用具体类型（`EventListener`）而非 `unknown as () => void`，避免 `removeEventListener` 时类型不匹配。
**原因**：`removeEventListener` 要求传入的函数与 `addEventListener` 时传入的函数是**同一个引用**，类型转换会破坏引用相等性。
**知识卡**：`docs/knowledge/global-handlers.md`

---

## 五、修复提交记录

| 提交 | 内容 | 文件数 |
|------|------|--------|
| `4d092d0` | 第一轮：fileops 半截文件、dnd timeout、scanner 错误记录、importer 文件名误杀、全局事件冲突、instance-ops 日志 | 6 |
| `9ac3acd` | 第二轮：sync 两阶段 Rename、Wails 路径守卫、tags 锁、recycle 清理、XSS 修复、async catch、type guards | 20 |
| `f8f0063` | 第三轮：model3d dispose、WASM 清理、updater 句柄、community cleanup、sidebar handler、animateNumber cancel、import-executor reject、debug ring、mc-format 空行、modal Escape |