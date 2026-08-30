# 审核 R17：按模块 CodeReview 五范围轮（2026-08-30）

> 五范围划分：① Go 文件操作/安装域 ② Go 扫描/解析域 ③ 前端桥接与数据层 ④ 前端 3D/预览域 ⑤ UI/菜单/i18n/脚本域。
> Checklist：ADR-109（代码审查/安全 + 跨平台 + 前端 3D 资源 + 原子写入 + 并发）+ audit-framework 反模式/致命陷阱/治理红线。
> 执行方式：5 个只读审核子代理并行（Go 域因并发上限串行重发），主模型汇总。本轮只读，未改任何源码。

## 总览

| 范围 | 结论 | P1 | P2 | P3 | P4 |
|------|------|----|----|----|----|
| ① Go 文件操作/安装域 | 有条件通过 | 0 | 3 | 4 | 4 |
| ② Go 扫描/解析域 | 有条件通过 | 0 | 0 | 6 | 2 |
| ③ 前端桥接与数据层 | 通过 | 0 | 2 | 4 | 3 |
| ④ 前端 3D/预览域 | 成熟（无阻塞项） | 0 | 0 | 4 | 3 |
| ⑤ UI/菜单/i18n/脚本域 | 整体较高（脚本 CLI 卫生缺口） | 0 | 2 | 4 | 2 |

全轮零 🔴P1；跨域共性主题三条：**锁口径不一致（sync 域）、base64 解码守卫双实现、scripts 参数解析未收敛 parse-args**。

## 域 ① Go 文件操作/安装域 — 有条件通过

亮点：`fsutil/write.go:79-117` WriteFileAtomic 六阶段 sentinel；`download.go:450-495` 下载全链路（SSRF 守卫、等值截断校验、defer 兜底清理）；`recycle.go:275-291` 符号链接恢复分支带回滚；`fileops/folder_import.go:138-160` 逐组件 Lstat 防 symlink 穿透。

| 级别 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟠P2 | go/sync/conflict.go:131-151 | ResolveConflict(ForceRemote) 覆盖实例/全局目录文件全程不持 InstallLock，与并发 Install/Relink 竞态 | 冲突解决入口套 InstallLock（ADR-056 共享单锁纪律） |
| 🟠P2 | go/sync/sync_push.go:73-88 | PushResources 文件级分支循环内逐条 Install 各自短暂持锁，差集陈旧风险；Pull/Relink 均整段持锁，口径不一 | 推送循环整段持锁（Locked 变体） |
| 🟠P2 | go/fsutil/copy.go:181-193 | AtomicRename 分支 rename→rename 之间崩溃窗口 dst 缺失；`_ = RemoveAll(backup)` 静默 | 崩溃窗口文档化/恢复路径扫 .bak-*；RemoveAll 失败记日志 |
| 🟡P3 | installer.go:710-716、sync.go:539-543 | 错误分类英文子串 contains 兜底残留（"access" 误伤面） | 删文本兜底或扩 errno 集合 |
| 🟡P3 | fsutil/copy.go:243-246、fileops.go 多处 | 存在性检查用 os.Stat 非 Lstat，悬空 symlink 占位绕过"已存在"守卫 | 统一 os.Lstat |
| 🟡P3 | fsutil/write.go:59-73 | ReadLimitedEntry 读错误与超限归并同返回 | 区分 reason 或 log |
| 🟡P3 | go/sync/sync.go:276 | `.recycle` 子串匹配整路径，文件名含 .recycle 的正常模型被误跳过 | 改逐路径段判定 |
| 🟢P4 | installer.go:736-786 | 系统目录黑名单枚举 c:/d:/e: 盘符 | filepath.VolumeName 动态拼 |
| 🟢P4 | installer.go:605,643 | 固定 tmp 名崩溃残留 | 唯一名/启动清理 |
| 🟢P4 | sync/conflict.go:140-150 | 固定 .bak 备份名被静默覆盖；未拒 symlink/目录 | 时间戳备份 + Lstat 校验 |
| 🟢P4 | download.go:44-48 | fileLocks 常驻不删（注释已论证） | 接受现状 |

## 域 ② Go 扫描/解析域 — 有条件通过

亮点：`litematic/nbt.go:65-221` NBT 深度 256 层 + 512MB 物化预算 + 防溢出守卫；`voxel.go:258-284` region 双侧边界 + int16 off-by-one 修正；`geometry/parse.go:109-110` PivotSet 显式零值区分（陷阱 #17 达标）；`watcher.go` 教科书级协程生命周期；`paths/safe.go` 词边界穿越检测统一入口。注册表红线通过（StorageSubDir 全量走 LoadRegistry）。

| 级别 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟠P3 | internal/app/app_model.go:62 | ExtractYSMHeaderFromBase64 解码无预大小守卫 | 预检 `len*3/4 > 上限` |
| 🟠P3 | internal/app/app_model.go:70-85 | SavePreviewTempFile 无守卫 + 临时目录无清理/配额 | 借 texture_cache TTL 淘汰 |
| 🟠P3 | internal/app/app_model.go:541 | SaveScreenshotFile base64 无守卫 | 同上 |
| 🟠P3 | internal/app/app_install_import.go:170,193 | 解码后才查 MaxImportSize，与 importer_file.go:62 预守卫双实现 | 抽公共 decodeB64Limited |
| 🟡P3 | internal/app/app_scan.go:495-536 | isPathInRootOrSelf 纯词法不解析 symlink；paths.IsInsideResolved 已存在未复用 | 只读绑定加解析复核 |
| 🟡P3 | internal/app/app_files.go:65-71 | FindPreviewImage/ExtractPreviewTexture 缺路径守卫，口径不对称 | 补 isPathInRootOrSelf |
| 🟢P4 | internal/app/app_install_import.go:188-195 | 穿越检查第 3 份手写副本 | 改调 paths.HasTraversal |
| 🟢P4 | go/geometry/parse.go:48-54 | clampTexSize 超界折叠为 0（零值哨兵）+ 注释不符 | 真钳制或 texSizeSet 标志 |

## 域 ③ 前端桥接与数据层 — 通过

亮点：`backend/app.ts:48-61` 失败重置 _appPromise 防毒化；`core/handlers/sync.ts:102-135` busy-skip 语义 + finally 兜底；`locale.ts:82-85` 代际守卫范式；`web-stats.ts` Worker 池全路径降级结算；`error-diary.ts:101-106` 截断日志死循环链；`bus.ts:174-199` 快照遍历 + once 退订。治理红线全合规（零 window.__*、getApp 收敛、无幽灵路径、esc/modal 单例）。

| 级别 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟠P2 | workers/stats.worker.ts:108-114 | COI 满足但 pthread 异常时 mt 失败不回退单线程，整批永久降级 | mt 失败追加单线程回退 |
| 🟠P2 | core/handlers/sync.ts:122-135 | finally 无条件 tree:reload：未配置短路也全树重扫；skipped 无细分 | 短路跳过 reload；skipped 细分 |
| 🟡P3 | core/i18n/locale.ts:40-54 | loadLocale 无在途去重，同语言并发多次 fetch | 在途 Promise 复用 |
| 🟡P3 | wasm/ysm-worker-loader.ts:68 | mt 胶水 Blob URL 失败路径不 revoke | catch 中 revoke |
| 🟡P3 | backend/cli-bridge.ts:134-141 | call_failed 返回缺 meta 字段，形状不一致 | 补 meta |
| 🟡P3 | backend/web-stats.ts:144-156 | worker progress 消息无消费方（死协议字段） | 消费或标注 |
| 🟢P4 | sync.ts:42、instance-ops.ts 多处 | 硬编码中文 toast 与 t() 混用 | 收敛进 locale |
| 🟢P4 | ysm-worker-loader.ts:156-159 | `if (!ok)` 死分支 | 删或注释 |
| 🟢P4 | workers/stats-core.ts:63-64 | `|| 0` 违反 ?? 口径 | 统一 ?? |

## 域 ④ 前端 3D/预览域 — 成熟

亮点：`utils/3d/adapters/gen-guard.ts:12-35` 代际守卫统一原语；`mount-preview-core.ts:676-686` setPerFrame 对称维护 + rAF 空停；`switch-preview.ts:398-410` 基线排除内容层增量；schema 注册表 per-scene 显式 key；`texture-cache.ts` 引用计数池；`cleanup-helper.ts`/Reflector/EffectComposer/PMREM/DataTexture 释放面完整；`cube-mesh.ts:75-76` 与 `go/threejs/spec-cube.go` 坐标口径逐行镜像。

| 级别 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟡P3 | switch-preview.ts:180-193 | dispose 旧 built 后 await 窗口内 rAF 驱动已 dispose 回调（每帧警告日志） | dispose 后立即 setPerFrame(null) |
| 🟡P3 | cleanup-3d.ts:155-160 | 三个 dispose 共用一个 try，前者抛错跳过后者 → 错误路径泄漏 | 独立 try / safeDispose 序列 |
| 🟡P3 | texture-cache.ts:44-50 | release 归零条目永久保留，长会话 GPU 纹理单调增长 | 容量上限/LRU |
| 🟡P3 | preview-library.ts:38-46 | cooperate 跨类型仍复用活跃会话适配器（ADR-093 T4-b 待办无运行时守卫） | routeKey 与 rtype 不一致降级关旧开新 |
| 🟢P4 | model2d.ts:167-175 | hover 闭包随节点存续（可接受） | disconnect 时主动 cleanup（可选） |
| 🟢P4 | preview-library.ts:152 | withPreviewExtras Object.assign 原地改写入参 | 返回新对象 |
| 🟢P4 | cleanup-3d.ts:127-131 | 多处 `catch(_){}` 纯静默 | dbg("cleanup-fail") 留痕 |

## 域 ⑤ UI/菜单/i18n/脚本域 — 整体较高

亮点：`utils/dom/html.ts:4-11` esc 唯一实现；`core/i18n/tr.ts:17` tr 兜底共享助手有测试锁定；菜单即数据（visibleWhen 通用化 + menu-graph 快照可达性分析 + 6 条健康门禁）；modal 单例齐全、全仓无私搭弹窗；`app-content/index.ts:118` 全局 handler 统一聚合；40 个 tests/*.mjs 全部有断言路径。3d 菜单红线合规。

| 级别 | 位置 | 观察 | 建议 |
|------|------|------|------|
| 🟠P2 | scripts/audit-split.mjs:383-387 | 手写 argv.includes 解析，无未知 flag 拦截、无 --help 退 0；拼错 flag 可绕过 redline 分支 | 迁 parse-args，unknown 退 1 |
| 🟠P2 | scripts/event-graph.mjs 等（约 60/79 脚本手写 argv，仅 19 用 parse-args） | 拼错 flag 静默忽略；check-script-hygiene 仅 WARN 未查 unknown 口径 | 分批收敛；纳入 --strict |
| 🟡P3 | utils/3d/adapters/preview-menu/env.ts:41 | 私有 tr 与 core/i18n/tr.ts 双重实现（收敛漏改） | import 共享 tr |
| 🟡P3 | features/community/render.ts:176 | `String(m.size \|\| 0)` 残留（-1 哨兵透传） | 对齐 download-tasks.ts:45 守卫 |
| 🟡P3 | features/oldest-models.ts:70-72 | `\|\| 0` 数值兜底口径不一 | ?? 0 |
| 🟡P3 | scripts/ai-mistake-tracker.mjs:260 等 ~30 个 | 无 process.exit(main())，退出码依赖未捕获 throw | 主流程 process.exit(main()) |
| 🟢P4 | scripts/eg_gen*.mjs 等 | 一次性生成器遗留 | archive/删除 |
| 🟢P4 | scripts/check-menu-health.mjs:45 | --json 无 --help/未知 flag 处理 | 顺手迁 parse-args |

## 建议修复排序（下一轮）

1. **P2 先修**：sync 域两处 InstallLock 口径（①-1、①-2）＋ ResolveConflict；stats.worker mt→单线程回退（③-1）；audit-split 参数卫生（⑤-1）。
2. **一轮小批量收口**：base64 预守卫抽公共 decodeB64Limited（②-4 个点位一并解决）；存有性检查统一 Lstat；scripts 分批迁 parse-args + hygiene --strict。
3. **P3/P4 择机**：texture-cache LRU、cleanup-3d 独立 try、.recycle 逐段判定、tr 双实现清理、硬编码中文 toast 收敛 locale。
