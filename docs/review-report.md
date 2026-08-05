# 代码审计报告（L2 模块人工审核）

> 审计流程遵循 AGENTS.md 五步法：依赖图谱 → 状态读写追踪 → 资源配对验证 → 心理模拟（4 思维模型）→ 输出报告。
> L1 机器守卫基线由 `node scripts/doctor.mjs` 提供；L3 专项排查按 `bug-search` 驱动，不在本报告范围。

## L1 机器守卫基线（2026-08-03）

| 检查 | 结果 | 备注 |
|------|------|------|
| `go test ./go/...`（直接运行） | ✅ 全部通过 | 15 个包全 ok |
| doctor「Go Test」段 | ⚠️ 报 FAIL | **误报**：直接运行全过，doctor 输出解析需排查（见 L1-1） |
| 契约测试 `tests/*.mjs` | ✅ 8/8 通过 | — |
| 静态分析 7 工具 | ✅ 全过 | doc-drift / adr-health / boolean-naming / circular / consumers / deadcode-baseline / auto-import |
| doctor「Governance Rules」 | ⚠️ 报 FAIL | **环境问题**：doctor 依赖 Unix `grep`，本机 pwsh 无此命令（见 L1-2） |
| doctor「Config Consistency」 | ⚠️ wails.json parse failed | 与 `test_config_syntax.mjs`（通过）矛盾，doctor 解析器疑似缺陷（见 L1-3） |
| 前端 build / typecheck | ⏭️ 跳过 | 本 shell 无 npx；需在标准环境补跑 `cd frontend && npx vite build && npm run typecheck` |

### L1 工具缺陷（反哺 doctor.mjs）

| 级别 | 观察 | 建议 |
|------|------|------|
| 🟡 L1-1 | doctor Go Test 段在直测全过时报 FAIL | 核对 doctor 对 `go test` 输出的判定逻辑（疑似把 `?  pkg [no test files]` 或缓存行误判） |
| 🟡 L1-2 | Governance Rules 依赖系统 `grep`，Windows pwsh 环境全段失效 | 改用 Node 内置实现（与 check-redlines.mjs 同口径），消除对外部 grep 的依赖 |
| 🟡 L1-3 | doctor 解析 wails.json 失败但契约测试通过 | 统一走 `test_config_syntax.mjs` 同一解析路径 |

---

## app-preview — 审核结果

**总体结论：有条件通过**（3D/2D 渲染主链路质量良好，守卫模式成熟；但存在死代码链、两处资源泄漏竞态、一处数据竞态）

**审计范围**：`frontend/src/views/app-preview/`（16 文件，约 3900 行）

**亮点：**

- 全窗预览关闭路径有 `closed` 幂等守卫，三层监听全配对 —— [preview-zoom.ts#L66-L74](../frontend/src/views/app-preview/zoom.ts#L66-L74)
- 2D 拖拽 window 监听走模块槽位幂等绑定，注释明确防泄漏意图 —— [preview-skeleton.ts#L11-L14](../frontend/src/views/app-preview/skeleton.ts#L11-L14)、[L186-L203](../frontend/src/views/app-preview/skeleton.ts#L186-L203)
- 并发守卫齐全且走 try/finally：`_saving`（截图，[preview-skeleton.ts#L325-L334](../frontend/src/views/app-preview/skeleton.ts#L325-L334)）、`_loading3D`（防双击，[L258-L261](../frontend/src/views/app-preview/skeleton.ts#L258-L261)）、litematic 3D 按钮 disabled + finally 恢复 —— [preview-litematic-meta.ts#L192-L202](../frontend/src/views/app-preview/litematic-meta.ts#L192-L202)
- `close3D()` 统一三条关闭路径（关闭按钮/ESC/切换纹理），并清理 timer + keyHandler + renderer —— [preview-skeleton.ts#L470-L486](../frontend/src/views/app-preview/skeleton.ts#L470-L486)
- MMD 事件委托用 WeakSet 按 ShadowRoot 实例守卫，组件重建后仍可注册 —— `preview-pack.ts#L207-L217`（已随 P2 死代码清理删除）
- 预览缓存 FIFO 淘汰 + evict 回调释放 blob URL，设计完整 —— `preview-cache.ts#L47-L64`
- 错误路径均有 UI 反馈且 `esc()` 转义到位 —— [preview-skeleton.ts#L776-L781](../frontend/src/views/app-preview/skeleton.ts#L776-L781)

**风险：**

| 级别 | 文件 | 观察 | 建议 |
|------|------|------|------|
| 🔴 极高 P1 | [preview-litematic-3d.ts#L160-L176](../frontend/src/views/app-preview/litematic-3d.ts#L160-L176) | **加载期 ESC 竞态泄漏整个 Three.js 场景**：`escH` 在 try 块前注册，用户在体素数据异步加载期间按 ESC → `closeOverlay()` 移除 overlay 并置 `_voxel3d=null`，但随后 `await fn(path)` 兑现，代码继续构建场景、启动 `requestAnimationFrame` 循环并注册 keydown/keyup/mousemove/mouseup/resize/escHandler 六组监听——全部挂在已被移除的 overlay 与 document/window 上，永久运行直到下次打开 3D（或永不回收） | 引入 `aborted` 标志：`closeOverlay()` 置位；try 块内每次 await 后检查，已中止则就地清理并 return；或把 `escH` 的关闭路径统一改为调用 `fullCleanup` 的占位链 |
| 🟠 高 P2 | [preview-detail.ts#L41-L77](../frontend/src/views/app-preview/detail.ts#L41-L77)、[index.ts#L82-L89](../frontend/src/views/app-preview/index.ts#L82-L89) | **model:select 无过期守卫，慢请求污染新选择**：快速切换模型时，A 的 `showModelDetail` 异步链（`_loadPreviewImage` + `ExtractYsmSummary`）晚于 B 返回时，`getElementById("preview-detail")` 取到的是 B 的面板，A 的摘要卡会覆盖/残留在 B 的界面上；上游 `bus.on("model:select")` 也无去重 | 加 generation counter：`_showModelDetail` 自增序号，异步回写前比对；或参照 `_initGithub` 的 `_currentRepo` 防过期模式（[app-content/index.ts#L820-L834](../frontend/src/views/app-content/index.ts#L820-L834)） |
| 🟠 高 P2 | [index.ts#L36-L113](../frontend/src/views/app-preview/index.ts#L36-L113) + `events.ts` + `preview-actions.ts` + `preview-logs.ts`（四文件均已随 P2 死代码清理删除） | **stat 模式整条链路为死代码**：全前端仅 app-content/tpl.ts 以 `mode="model"` 挂载唯一实例（整合包详情已改由 `app-sync-manager` 承接，`package:selected` 监听在 [app-content/index.ts#L217-L230](../frontend/src/views/app-content/index.ts#L217-L230)）。`statsHTML` / `bindBusUpdates` / `bindActions` / `registerMmdEvents` / `loadLogsPreview` / `showPackageDetail` / `resetGlobalButtons` 仅被 stat 分支自相引用，`dp-log-footer` 永久 `display:none` | 整段移除 stat 分支（index.ts connectedCallback stat 段 + events.ts + preview-actions.ts + preview-logs.ts + preview-pack.ts 的 showPackageDetail 系 + tpl.ts statsHTML），删除前跑 `node scripts/check-orphan-exports.mjs --strict` 复核孤儿导出 |
| 🟡 中 P3 | [index.ts#L40](../frontend/src/views/app-preview/index.ts#L40)、[L99-L104](../frontend/src/views/app-preview/index.ts#L99-L104) | `_modelCleanup` 声明后**从未赋值**，`_cleanupModelListeners()` 恒为空操作（window 级监听实际靠 preview-skeleton 的模块槽位兜底） | 要么接线（3D overlay 的 close3D 注册进 `_modelCleanup`，组件卸载时兜底关闭），要么删除字段 |
| 🟡 中 P3 | [index.ts#L22-L34](../frontend/src/views/app-preview/index.ts#L22-L34) | **evict 回调不回收头像 blob URL**：preview-wasm.ts 为作者头像 `URL.createObjectURL`（[preview-wasm.ts#L80-L83](../frontend/src/views/app-preview/wasm.ts#L80-L83)）存入 `authors[].avatarUrl` / `avatars`，淘汰回调只释放 `geometry.textures` / `texture`，缓存流转 50 条后头像 blob 持续累积 | evict 回调补扫 `val.authors[].avatarUrl` 与 `val.avatars` 中的 `blob:` 前缀并 revoke |
| 🟡 中 P3 | [preview-skeleton.ts#L270-L281](../frontend/src/views/app-preview/skeleton.ts#L270-L281)、[preview-litematic-3d.ts#L28-L40](../frontend/src/views/app-preview/litematic-3d.ts#L28-L40) 等 | 全屏 overlay 大量内联硬编码色（`#1a1b2e` / `#2a2b3e` / `rgba(…)` 数十处），违 ADR-005「CSS 全走变量」；两处 3D overlay 的 topBar/控件样式近乎逐行重复（jscpd 已报） | overlay 挂在 document.body 可用 `:root` 变量；抽公共 `fullscreen-overlay-css` + 工厂函数消重 |
| 🟡 中 P3 | [preview-skeleton.ts#L297-L301](../frontend/src/views/app-preview/skeleton.ts#L297-L301) | 纹理切换走 `close3D() + _toggle3D()` 迂回重开：先持久化 `_prefer3D=false` 再翻回 true，状态来回写 localStorage，链路脆弱（任一步提前 return 即状态不一致） | 抽 `reopen3D(texIdx)` 直接重建，不经过 toggle 取反 |
| 🟢 低 P4 | [preview-skeleton.ts#L791](../frontend/src/views/app-preview/skeleton.ts#L791) | `_prefer3D` 自动重开 3D 用 `requestAnimationFrame(() => btn3d?.click())`，旧闭包 btn3d 已 detach 仍可触发 → 快速连续选中模型时可能弹出**上一个模型**的 3D overlay | rAF 回调内校验 `btn3d.isConnected`，或改用生成序号防过期 |
| 🟢 低 P4 | [preview-detail.ts#L80](../frontend/src/views/app-preview/detail.ts#L80)、[preview-litematic-meta.ts#L196](../frontend/src/views/app-preview/litematic-meta.ts#L196) | 动态 import 用 `.js` 扩展名（其余全 `.ts`），Vite 兼容但与仓库惯例不一致 | 统一为 `.ts` |
| 🟢 低 P4 | [preview-wasm.ts#L110-L127](../frontend/src/views/app-preview/wasm.ts#L110-L127) | 同文件已有 `devLog`，却残留 3 处裸 `console.log`（生产环境仍输出） | 换 `devLog` 或删除（按约定需先请示） |
| 🟢 低 P4 | [index.ts#L93-L96](../frontend/src/views/app-preview/index.ts#L93-L96) | `disconnectedCallback` 遍历 `_unsubs` 后不清空数组，重连时累积已失效的退订函数（bus 退订幂等故无害） | `forEach` 后 `this._unsubs = []` |
| 🟢 低 P4 | [preview-skeleton.ts#L343-L345](../frontend/src/views/app-preview/skeleton.ts#L343-L345) | 截图失败仅把按钮文字改 ❌，无 toast（违「异常路径必须有 toast 反馈」） | 补 `bus.emit("toast:show", …)` |

**心理模拟记录（4 模型）：**

1. **契约检查**：`PreviewCtx` 接口最小面设计良好；`_decodeYsmViaWasm` / `decodeYsmViaWasm` 双别名冗余（一个给 loader、一个给接口）可合并。
2. **状态机模拟**：3D 连点有 `_loading3D` 拦截 ✅；纹理切换 = 关闭+重开串行，无并发窗口 ✅；但加载期 ESC 打断了状态机（P1）。
3. **异常模拟**：`renderModel3D` 抛错 → catch 渲染错误信息，`_loading3D` 在 try 外复位 ✅；但 DOM 构建段（L266-L529）若抛错 `_loading3D` 永不复位（该段几乎不可能抛错，不单列）。
4. **引用计数**：组件内 `bus.on` 全部进 `_unsubs` ✅；document/window 监听除 P1 竞态外全配对 ✅；`_prevWindowMove/_prevWindowUp` 在组件卸载后残留至下次 loadModel2D（handler 有 `_dragging` 短路，功能无害，闭包滞留 canvas 对象，不单列）。

---

## app-content — 审核结果

**总体结论：有条件通过**（页面路由与全局事件骨架健全，handler 层 finally 纪律好；但 document 监听器累积泄漏、转义不彻底、两处死注册需与 app-preview 死代码链联动清理）

**审计范围**：`frontend/src/views/app-content/index.ts`（990 行）+ `core/handlers/sync.ts` / `handler-upload.ts` / `handler-other.ts` + `app-content/community/` 4 文件（site-view / settings / diagnostics / core，子代理协审）

**亮点：**

- handler-sync 全部异步链 try/catch/finally，done 事件在 `finally` 中 emit，按钮不会卡死（陷阱 #3 达标）—— [handler-sync.ts#L108](../frontend/src/core/handlers/sync.ts#L108)、[L202](../frontend/src/core/handlers/sync.ts#L202)、[L319](../frontend/src/core/handlers/sync.ts#L319)
- `_initGithub` 用 `_currentRepo` 做异步防过期守卫，是全项目可复制的范本 —— [index.ts#L820-L834](../frontend/src/views/app-content/index.ts#L820-L834)
- 实例清空走 `modalConfirm` 二次确认防呆（handler-other.ts），符合破坏性操作规范
- `_insListenerReg` 幂等注册意图明确，避免 tab 重复绑定 —— [index.ts#L215-L216](../frontend/src/views/app-content/index.ts#L215-L216)

**风险：**

| 级别 | 文件 | 观察 | 建议 |
|------|------|------|------|
| 🟠 高 P2 | [index.ts#L171-L206](../frontend/src/views/app-content/index.ts#L171-L206) | **`_initPreviewResize` 每次 `_render()` 都向 document 追加 2 个匿名监听器（mousemove/mouseup）且永不清理**：`_render()` 用 innerHTML 重建页面（[L149-L152](../frontend/src/views/app-content/index.ts#L149-L152)），旧 handle/preview 元素已 detach，但 document 级监听器持续累积，每个闭包还引用当轮的 `preview`/`handle` → detached DOM 无法 GC；用户在 repository 页与其他页间切换 N 次即泄漏 N 组 | 监听器存入实例字段并在重建前 remove；或沿用 preview-skeleton 的模块槽位幂等绑定模式（`_prevDocMove`/`_prevDocUp`） |
| 🟠 高 P2 | [handler-sync.ts#L40](../frontend/src/core/handlers/sync.ts#L40) | `const rtypeActual = rtype \|\| "ysm"` 硬编码字面量兜底，违 ADR-010 注册表优先（resource_types.json 单一事实来源）；上游漏传 rtype 时静默降级为 ysm 而非报错 | 缺省即抛错/toast（参数契约错误应显式失败），或从 `RESOURCE_TYPES` 常量取值并注释决策 |
| 🟠 高 P2 | [site-view.ts#L101-L126](../frontend/src/views/app-content/site-view.ts#L101-L126) | **community 转义防线不全**：`platformBadges` 拼接自 `cr.type`（注册表数据）未转义即入 innerHTML；且本模块 `esc` 不转义引号（`"` `'`），凡 `data-name="…"` 属性拼接处均可被引号逃逸（creators/workshop 数据为远端 JSON，属系统边界输入） | `esc` 补 `&quot;`/`&#39;` 两条替换（全项目多处同构 esc 一并统一，见 P3）；platformBadges 走 `esc()` |
| 🟡 中 P3 | [index.ts#L979-L984](../frontend/src/views/app-content/index.ts#L979-L984) | `_esc` 重复实现且不转义引号；全项目至少 4 处同构 esc（app-content `_esc`、app-sidebar `escH`、context-menu `_esc`、community 各模块），行为不一致是转义漏洞温床 | 统一收敛到 `utils/display.ts` 导出单一 `esc()`，各处 import 复用 |
| 🟡 中 P3 | [index.ts#L507](../frontend/src/views/app-content/index.ts#L507) | `Events.On("config-loaded")` 靠模块级 flag 防重复注册，但被拦截的后续注册其闭包永远引用**首次**渲染时的 `_root` 上下文；组件若被销毁重建，flag 不会复位 → 新实例收不到事件 | flag 复位移入 `disconnectedCallback`；或改 bus 订阅进 `_unsubs` 随组件清理 |
| 🟡 中 P3 | `handler-upload.ts#L10`、[handler-sync.ts#L212](../frontend/src/core/handlers/sync.ts#L212) | **两处死注册**：`stats:upload` 唯一发射器在 preview-actions.ts（app-preview stat 死代码链）；`mmd:sync-variant-folder` 唯一发射器在 preview-pack.ts `registerMmdEvents`（同属 stat 死代码链，`preview-pack.ts#L242`）——handler 活着但永不触发（handler-upload.ts 整文件、handler-sync mmd 分支均已随 P2 死代码清理删除） | 与 app-preview P2 死代码清理联动：删 stat 链时同步删除这两个 handler（`handler-sync` 的 mmd 分支 + `handler-upload` 整文件视剩余内容） |
| 🟡 中 P3 | [site-view.ts#L668](../frontend/src/views/app-content/site-view.ts#L668) | `window.addEventListener("storage", _storageSyncFn)` 跨窗口同步监听，视图卸载路径未见配对 `removeEventListener`（子代理审计结论），切页后 handler 滞留 window | 卸载/切页清理链补 remove；或模块槽位幂等绑定 |
| 🟡 中 P3 | community/settings.ts、community/diagnostics.ts、community/core.ts（子代理审计） | settings：registry 远端数据渲染未全量转义、detectBtn overlay 无单例守卫（连点叠多层）、多处异步缺 try/catch；diagnostics：执行按钮无 disabled 去重；core：后台自动合并与手动保存互不互斥，并发写同一数据 | settings 渲染统一走 esc + overlay 加 `_detecting` 守卫；diagnostics 执行期间 disabled；core 合并/保存加互斥锁或版本号 |
| 🟢 低 P4 | [index.ts#L53](../frontend/src/views/app-content/index.ts#L53) | `_insListenerReg` 置 true 后不在 `disconnectedCallback` 复位（组件实例级 flag），组件重建后实例页监听永不注册 | `disconnectedCallback` 复位为 false |

**心理模拟记录（4 模型）：**

1. **契约检查**：handler 三件套对 bus 事件的 payload 契约与 bus.ts 类型表一致；但 `rtype` 兜底破坏了调用契约的显式性（P2）。
2. **状态机模拟**：页面切换 `_render()` 全量重建 DOM，状态存 `_current` + PageStore，无残留 ✅；但 `_initPreviewResize` 的监听器不随重建回收（P2）。连点场景：community 保存/检测按钮无守卫（P3）。
3. **异常模拟**：handler-sync 异常全走 toast + finally emit ✅；community settings/diagnostics 部分异步路径静默失败（P3）。
4. **引用计数**：组件内 `bus.on` 进 `_unsubs` ✅；document/window 级监听是主要缺口（resize 监听 ×N、storage 监听）。

## import-queue + 下载链 — 审核结果

**总体结论：有条件通过**（download-queue 是本次审计质量最高的模块，陷阱 #3/#6/#7 全部达标；但 import-queue 覆盖导入路径有 2 处确定逻辑 bug + 1 处静默截断）

**审计范围**：`frontend/src/features/import-queue.ts`（861 行）+ `features/community/download-queue.ts`（664 行）+ `features/community/events.ts`（300 行）

**亮点：**

- **陷阱 #7 满分达标**：Wails `Events.On` 仅在模块级注册一组，`_registered` 守卫防重复；单击/多选/全选三入口统一走 `queue.enqueue` —— [download-queue.ts#L58](../frontend/src/features/community/download-queue.ts#L58)、[L164-L165](../frontend/src/features/community/download-queue.ts#L164-L165)、[events.ts#L161](../frontend/src/features/community/events.ts#L161)、[L288](../frontend/src/features/community/events.ts#L288)
- **陷阱 #6 达标**：`stuckGuardReset()` 一处清全部 timer，`cleanupProgressUI()` 统一恢复按钮——99% 卡死有兜底 —— [download-queue.ts#L296](../frontend/src/features/community/download-queue.ts#L296)、[L310-L312](../frontend/src/features/community/download-queue.ts#L310-L312)
- **陷阱 #3 达标**：所有下载结束路径（成功/失败/取消）都过 `cleanupProgressUI`，按钮不卡死 —— [download-queue.ts#L463](../frontend/src/features/community/download-queue.ts#L463)、[L544-L546](../frontend/src/features/community/download-queue.ts#L544-L546)
- STATE 单一事实来源 + subscribe/notify，`enqueue` 同步置 status 防竞态；`destroy = unsub` 与 events.ts 的 `externalCleanup`（cancel + destroy）完整配对 —— [download-queue.ts#L662](../frontend/src/features/community/download-queue.ts#L662)、[events.ts#L293-L297](../frontend/src/features/community/events.ts#L293-L297)
- `isDownloading()` 并发守卫覆盖三个下载入口 —— [events.ts#L149](../frontend/src/features/community/events.ts#L149)、[L218](../frontend/src/features/community/events.ts#L218)
- 单文件下载 4MB 确认 / 10MB 拒绝的尺寸守卫 —— [events.ts#L259-L277](../frontend/src/features/community/events.ts#L259-L277)
- import-queue 先拿 DnDLock 再清 pending 队列，锁被占用时不丢文件；回调 API 全部 Promise 化且 onerror 分支齐全（陷阱 #10 达标）—— [import-queue.ts#L818-L820](../frontend/src/features/import-queue.ts#L818-L820)、[L554-L602](../frontend/src/features/import-queue.ts#L554-L602)
- `initImportQueue` 返回清理函数，由 app-content `_cleanupImportQueue` 在切页时调用，配对成立 —— [import-queue.ts#L857-L861](../frontend/src/features/import-queue.ts#L857-L861)

**风险：**

| 级别 | 文件 | 观察 | 建议 |
|------|------|------|------|
| 🟠 高 P2 | [import-queue.ts#L446-L462](../frontend/src/features/import-queue.ts#L446-L462) | **覆盖导入用错文件名**：导入用 `finalName`（重命名对话框结果）触发 FILE_EXISTS，但覆盖确认框文案与 `ImportModelFileOverwriteTo(newName, …)` 都用 `newName`（对话框打开前的名字）。用户改过名时：确认框报的名字是错的，覆盖目标也是错的（newName 可能根本不存在），真正冲突的 finalName 原封不动 | 覆盖路径统一用 `finalName`（确认文案与 API 参数同改） |
| 🟠 高 P2 | [import-queue.ts#L456-L496](../frontend/src/features/import-queue.ts#L456-L496) | **覆盖成功路径缺刷新事件**：对比正常导入路径（[L412-L422](../frontend/src/features/import-queue.ts#L412-L422)），覆盖分支不发 `stats:refresh` / `tree:reload`、不失效 `repoFiles` 缓存 → 覆盖导入完成后树视图/统计不更新，队列冲突标记（⚠️）也不消除 | 覆盖成功块补三行：两个 emit + `repoFiles = null; loadRepoFiles()` |
| 🟠 高 P2 | [import-queue.ts#L583-L594](../frontend/src/features/import-queue.ts#L583-L594) | **文件夹拖入 >100 文件静默截断**：`dirReader.readEntries` 单次最多返回 100 条（浏览器 API 契约），当前只调用一次；拖入含 >100 个模型的文件夹时多余文件无声丢失，无任何提示 | 循环调用 `readEntries` 直到返回空数组再 resolve（MDN 标准做法） |
| 🟡 中 P3 | [import-queue.ts#L361](../frontend/src/features/import-queue.ts#L361)、[L734](../frontend/src/features/import-queue.ts#L734) | `dl-import` / `dl-reimport` 按钮无 `_importing` 并发守卫，连点弹出多个重命名对话框（后果取决于 modal 单例行为） | 入口加 `_importing` 标志，finally 复位（同 preview-skeleton `_saving` 模式） |
| 🟡 中 P3 | [import-queue.ts#L113-L121](../frontend/src/features/import-queue.ts#L113-L121) | `showForm` 为临时文件 emit `model:select`——与 app-preview 的 P2（无过期守卫）是同一竞态的上游触发点：快速切换队列文件时旧请求摘要会写进新面板 | 与 app-preview P2 修复合并：preview-detail 加 generation counter 后此处自然安全 |
| 🟡 中 P3 | [events.ts#L198-L199](../frontend/src/features/community/events.ts#L198-L199) | **右键菜单 label 双重转义**：调用侧已 `esc(m.name)`，而 context-menu 组件渲染时再 `_esc(item.label)`（[context-menu.ts#L93](../frontend/src/views/context-menu/index.ts#L93)）→ 文件名含 `&`/`'`/`"` 时菜单显示乱码（`&amp;amp;`） | menu:show 契约传原文、转义职责归组件侧：events.ts 去掉 esc |
| 🟢 低 P4 | [events.ts#L150-L162](../frontend/src/features/community/events.ts#L150-L162) | 批量下载（选中/全选）不做尺寸守卫，与单文件的 4MB/10MB 守卫行为不一致（超大文件入队后由后端拒绝，用户体验割裂） | 批量入口同样过滤 >10MB 并 toast 告知跳过数量 |
| 🟢 低 P4 | [import-queue.ts#L532-L536](../frontend/src/features/import-queue.ts#L532-L536) | `enqueueFile` 去重仅按文件名：文件夹导入时不同子目录的同名文件被误判重复而跳过 | 去重键改为 `relPath \|\| name` |
| 🟢 低 P4 | [import-queue.ts#L478-L480](../frontend/src/features/import-queue.ts#L478-L480) | 覆盖路径重置 `currentFile/currentBase64/currentFileName` 但漏 `currentRelPath`（正常路径 [L439](../frontend/src/features/import-queue.ts#L439) 有重置），下一文件可能继承上一文件的子目录 | 补 `currentRelPath = ""` |
| 🟢 低 P4 | [import-queue.ts#L834](../frontend/src/features/import-queue.ts#L834) | DnDLock 成功分支延迟 1s 释放、onerror 分支立即释放，时序不对称（无功能影响） | 统一释放时机或注释说明 1s 意图 |
| 🟢 低 P4 | [events.ts#L67](../frontend/src/features/community/events.ts#L67) | `onAllDone` 里 200ms `setTimeout` 刷新列表，视图已销毁时定时器仍会跑（操作 detached DOM，无害） | 定时器纳入 destroy 清理或回调内校验 `sr.isConnected` |

**心理模拟记录（4 模型）：**

1. **契约检查**：DownloadTask/RepoEventsContext 接口清晰；但 FILE_EXISTS 覆盖路径内部 `finalName`/`newName` 契约自相矛盾（P2）。
2. **状态机模拟**：下载中三入口全被 `isDownloading()` 拦截 ✅；enqueue 同步置 status 杜绝插队 ✅；但导入按钮连点无拦截（P3）；拖入 >100 文件文件夹 = 静默数据丢失（P2）。
3. **异常模拟**：directImport/导入主流程 catch 全有 toast ✅；覆盖失败有 toast ✅；readEntry 任何异常 resolve 不阻塞批量导入 ✅。
4. **引用计数**：import-queue 唯一 bus 订阅有 unsub 且被 app-content 调用 ✅；download-queue 模块级 Wails 订阅一次注册、destroy 退订 ✅；events.ts 监听全绑在 sr 容器上随视图销毁 ✅。

## 其余组件 → utils/services — 审核结果

**总体结论：有条件通过**（资源配对质量全项目最高的一批——app-toast/context-menu/model3d cleanup/handler-dnd 均为正面样板；但新增 1 个 P1 XSS 面，且 esc 碎片化、弹窗无单例是两大系统性病灶）

**审计范围**：app-tree / app-sidebar / app-nav + app-resource-manager / app-sync-manager + dialogs（modal/rename/batch-rename/tag-editor/adv-filter）+ core（global-handlers/handler-dnd/theme/menu-defs/context-menus/page-store）+ app-toast + context-menu + utils 全部 + services/registry.ts + bus.ts + features（recycle-bin/version-updater/dnd-state），共 33 文件（子代理协审 + 主审抽验）

**亮点：**

- model3d `cleanup()` 是全项目资源释放模板：12 个 listener 逐一 remove、RAF 取消、controls/renderer dispose、geometry/material 遍历释放 —— `model3d.ts#L695-L724`
- app-tree 的 bus 订阅由 `bindBusEvents` 收集 unsub 统一进 `_unsubs`，disconnectedCallback 一次清完 —— [index.ts#L80-L118](../frontend/src/views/app-tree/index.ts#L80-L118)、[L141](../frontend/src/views/app-tree/index.ts#L141)
- app-toast 并发心理模拟通过：最多 5 条堆叠、移除最旧先 clearTimeout、`_remove` 幂等 —— [app-toast.ts#L62-L69](../frontend/src/views/app-toast/index.ts#L62-L69)
- handler-dnd 拖拽边界防呆齐全：目录深度上限 10 / 文件数上限 50 / 大小上限 + DnDLock 拦截 —— [handler-dnd.ts#L141](../frontend/src/core/handlers/dnd.ts#L141)、[L181-L189](../frontend/src/core/handlers/dnd.ts#L181-L189)
- recycle-bin 破坏性操作防呆到位（陷阱 #8）：清空回收站 danger 确认、单项永久删除确认 —— [recycle-bin.ts#L24-L30](../frontend/src/features/recycle-bin.ts#L24-L30)、[L162-L168](../frontend/src/features/recycle-bin.ts#L162-L168)
- batch-rename 的模块槽位 `if (dialogEl) dialogEl.remove()` 是全 dialogs 唯一正确的防叠加实现 —— [batch-rename.ts#L33](../frontend/src/views/dialogs/batch-rename.ts#L33)、[L46](../frontend/src/views/dialogs/batch-rename.ts#L46)
- dialogs 的 ESC/keydown 全部绑在 overlay 元素自身，随 `remove()` 回收，无一处 document 级泄漏

**风险：**

| 级别 | 文件 | 观察 | 建议 |
|------|------|------|------|
| 🔴 极高 P1 | `summarize.ts#L83-L88`、`L118` 等 | **摘要卡 XSS**：私有 `esc` 不转义引号，却被用于 `href="…"`/`title="…"` 属性插值（已实证 L118 `authorBilibili`）；数据源是 .ysm 模型元数据——攻击者可分发恶意模型，`bilibili='…" onclick="…'` 即属性逃逸注入事件属性；且链接无 scheme 校验（`javascript:` 点击即执行） | 改 import `utils/dom.ts` 的完整 esc；链接渲染前校验 `https?:` scheme 白名单 |
| 🔴 极高 P1 | [bus.ts#L151-L157](../frontend/src/bus.ts#L151-L157) | **`once()` 实现错误**：注册的是 `wrapper`，`off` 却找 `fn`（永远找不到）→ once 监听器永不移除、每次 emit 都触发。实证消费者 [app-sidebar/index.ts#L186](../frontend/src/views/app-sidebar/index.ts#L186)：叠加另一问题——`sync:download:done` 类型契约为 `void`，handler emit 不带 payload，而 `onDone` 用 `as never` 强转后要求 `token` 匹配 → **每次推送必然 30s 超时误报"操作超时"**，且每次推送泄漏 N 个僵尸监听器 | 一行修复 `this.off(event, wrapper)`；`sync:download:done` 类型补 `{token?, instanceName?}` 并在 emit 端带上 payload |
| 🟠 高 P2 | [app-tree/index.ts#L272-L273](../frontend/src/views/app-tree/index.ts#L272-L273) | 同一 `_keydownHandler` 同时注册到 `_root` 与 `document`：shadow 内组合键事件 composed 冒泡 → 焦点在工具栏按钮（不被 INPUT 守卫拦截）按 Delete → 确认弹两次、删除执行两次 | 只保留 document 级注册，删 L272 |
| 🟠 高 P2 | [app-tree/bus-handlers.ts#L190-L205](../frontend/src/views/app-tree/bus-handlers.ts#L190-L205) | `dir:recycle` 中 L190 已算出 `absDir`，L204 却 `RemoveDir(dir)` 传**相对路径** → 按进程 CWD 解析，空文件夹删不掉被 `catch {}` 吞掉，理论上还有误删 CWD 相对目录风险 | 改 `await RemoveDir(absDir)` |
| 🟠 高 P2 | app-tree/tpl.ts `#sort` + [index.ts#L50](../frontend/src/views/app-tree/index.ts#L50) | `#sort` 下拉框渲染了但全项目无任何 change 监听（grep 证实），`vm._sort` 初始化后从未写入 → 用户切排序无反应 | 补 change 绑定写 `vm._sort` 后重渲染，或移除控件 |
| 🟠 高 P2 | [modal.ts#L56](../frontend/src/views/dialogs/modal.ts#L56) 等 | **modal 家族无单例**（batch-rename 除外）：modalPrompt/modalSelect/modalConfirm/showRenameDialog/modalTagEditor 每次调用都新建 overlay 叠加；连点无守卫的按钮（实证 import-queue `dl-reimport`）→ 双弹窗叠放、双 Promise 各自结算触发两次业务操作 | modal.ts 加模块级活动弹窗槽位，新开前先结算旧弹窗（长治久安方案，优于逐个调用方打补丁） |
| 🟠 高 P2 | [rename.ts#L7-L12](../frontend/src/views/dialogs/rename.ts#L7-L12) | 本地 `esc` 不转义双引号，却用于 `value="…"` 属性插值 → 文件名含 `"` 可逃逸属性（与 summarize 同类，数据源为本地文件名） | 删本地 esc，import modal.ts/dom.ts 的完整版 |
| 🟠 高 P2 | [batch-rename.ts#L41-L45](../frontend/src/views/dialogs/batch-rename.ts#L41-L45) | 返回的 Promise 在**弹窗打开瞬间** resolve，调用方 `await showBatchRenameDialog(...)` 形同虚设，"应用"后的错误无法被调用方捕获 | Promise 延迟到 `close()` 时结算（内部保留 resolve 引用） |
| 🟠 高 P2 | [app-sync-manager/index.ts#L97-L117](../frontend/src/views/app-sync-manager/index.ts#L97-L117) | `_init` 每次调用追加 `bus.on("stats:refresh")` 进 `_unsubs` 但从不清理上一轮 → `instance` 属性二次变更后同一事件双份 handler，一次刷新双倍 `_loadData`，叠加自触发 emit 放大 | `_init` 开头先清旧 `_unsubs` 再注册 |
| 🟠 高 P2 | [context-menus.ts#L281-L287](../frontend/src/core/context-menus.ts#L281-L287) | `file.copy` 与 `batch.copy` 成功后**均缺 `refreshUI()`**（全部 move 分支都有；初版报告误判 batch.copy 已有，复核更正）→ 复制后树视图不更新，用户以为复制失败 | 两处成功分支均补 `refreshUI()` |
| 🟠 高 P2 | [recycle-bin.ts#L67-L74](../frontend/src/features/recycle-bin.ts#L67-L74)、[L210](../frontend/src/features/recycle-bin.ts#L210) | `_loadingAbort` 是假守卫：AbortController.signal 从未传给任何请求；先完成者的 `finally { _loadingAbort = null }` 清掉后者句柄；快速切资源类型时**慢的旧请求可覆盖新列表** | 用 generation 计数器：渲染前比对序号再写 DOM |
| 🟠 高 P2 | `model3d.ts#L318-L337` | document 级 keydown 对 WASD/方向键/空格 `preventDefault()` 且**无输入框守卫** → 3D 预览挂载期间打开重命名等弹窗无法打字，按 F 误切调试模式 | 先判 `e.target` 是否 INPUT/TEXTAREA/contentEditable（复用 handler-dnd 的 isEditable） |
| 🟡 中 P3 | `theme.ts` 全文件（模块与测试已按本条建议删除） | **生产死模块**：全仓仅 theme.test.js 引用，真实主题逻辑在 app-modules.ts；若误 import，`bindThemeBtn` 因 `#btn-theme` 不存在会陷入每 100ms 一次的无限 setTimeout | 删除模块 + 测试，或让 app-modules 复用（顺带合并 app-modules 重复注册的 `prefers-color-scheme` 监听） |
| 🟡 中 P3 | esc 碎片化（系统性） | 全项目 **14+ 处重复 esc**，行为分三档：完整版（dom.ts/display.ts 私有/context-menu/app-sidebar tpl）、缺单引号（modal.ts/batch-rename）、不转义引号（mc-format/summarize/rename/app-content `_esc`）——P1/P2 多处 XSS 面均源于此 | 收敛到 `utils/dom.ts` 的 `esc` 单点导出，逐文件替换（可 codemod 批量） |
| 🟡 中 P3 | [app-sidebar/index.ts#L175-L201](../frontend/src/views/app-sidebar/index.ts#L175-L201) | 推送流 IIFE 无 try/finally：按钮恢复与 `_syncInProgress` 复位不在 finally 路径，意外 throw → 按钮永久 ⏳ 且推送/拉取全锁死（陷阱 #3 同款） | IIFE 包 try/finally |
| 🟡 中 P3 | [app-tree/bus-handlers.ts#L65](../frontend/src/views/app-tree/bus-handlers.ts#L65) | `SaveAppConfig(dir, "", "", "copy", theme)` 硬编码 linkMode="copy" → 会把用户已保存的硬链接模式冲掉（对比 sidebar events.ts 保留旧值的正确写法） | 先 LoadAppConfig 透传 `cfg.linkMode` |
| 🟡 中 P3 | [app-tree/bus-handlers.ts#L356-L412](../frontend/src/views/app-tree/bus-handlers.ts#L356-L412) | `batchToggle`/`batchToggleAll`/`toggleFolderBatch` 无并发守卫，连点菜单 → 重叠循环二次 Toggle 把状态打回原形但 toast 仍报成功 | vm 加 `_batchBusy` 标志 |
| 🟡 中 P3 | `resource-registry.ts#L29-L31` | 注册表加载失败被缓存为 `{}` 且永不重试 → Go 桥瞬断后整个会话 `getStorageSubDir` 全部降级 | 失败不缓存（保持 null），下次调用重试 |
| 🟡 中 P3 | [app-resource-manager/index.ts#L91-L102](../frontend/src/views/app-resource-manager/index.ts#L91-L102) | `_init` 无 generation 守卫：rtype/instance 属性连变或配置事件并发时，后发先至把旧类型列表写进新 DOM | 入口记 generation，await 返回后校验 |
| 🟡 中 P3 | [context-menus.ts#L167-L171](../frontend/src/core/context-menus.ts#L167-L171)、[L338-L341](../frontend/src/core/context-menus.ts#L338-L341) | `MoveToRecycle` 失败 `catch {}` 静默吞错，违「异常路径必须 toast」红线 | catch 补 toast |
| 🟡 中 P3 | [handler-dnd.ts#L9](../frontend/src/core/handlers/dnd.ts#L9)、[L189-L192](../frontend/src/core/handlers/dnd.ts#L189-L192) | `MAX_FILE_SIZE` 为 100MB，toast 文案却写「超过 10MB」误导用户 | 文案改 100MB 或抽常量复用 |
| 🟡 中 P3 | `debug.ts#L28`、`L86-L97` | `window._DBG_RING` / `window.debugGetSpec`（直接暴露 Go 绑定）常驻 window，调试残留违背「零隐式全局」精神 | `import.meta.env.DEV` 守卫或生产剥离 |
| 🟢 低 P4（择要） | 多处 | app-nav 高亮色硬编码 + 版本降级写死 "v1.0.0"；app-tree render.ts `updateStat` 700ms 定时器未跟踪；app-sidebar `_checkedSet` 跨 rtype 串味、`.sidebar-import-all` 死引用；tag-editor overlay 无 focus（ESC 需先点进弹窗）、保存按钮无 disable；app-toast 缺 `.warn` 样式但 bus 契约含 warn；display.ts 占位符 `%%TOKEN%%` 与真实文件名可碰撞；version-updater 静默检查发请求前 markChecked（断网也耗 6h 配额）；dnd-state `release()` 无持有者校验 | 见各子报告，均为点状小修 |

**心理模拟记录（4 模型）：**

1. **契约检查**：`showBatchRenameDialog` 的 Promise 结算时机与调用方 `await` 预期不符（P2）；`modalSelect` 的 `placeholder` 参数被 `void` 丢弃；`sync:download:done` 类型契约 void 与实际 payload 需求矛盾（P1 链）。
2. **状态机模拟**：连点场景是最大缺口——modal 无单例 × 调用方无守卫 = 双弹窗双执行（P2）；batchToggle 无守卫状态打回（P3）；recycle-bin 恢复按钮无忙碌守卫（P3）。
3. **异常模拟**：app-tree toolbar 4 个分支无 try/catch；sidebar 推送流无 finally；resource-manager 导入按钮无 try/catch——均属陷阱 #3 变体。
4. **引用计数**：app-toast/context-menu/app-nav/handler-dnd 配对满分；缺口在 app-sidebar `_debounceTimer` 不随销毁清理、app-tree `_vsResizeObserver` 不 disconnect、theme.ts 死模块的无限定时器隐患。

---

## 全局风险汇总与闭环建议

### P1（3 项，立即修复 + 补录 bug-chronicle）

| # | 位置 | 一句话 | 修复量 |
|---|------|--------|--------|
| P1-1 | [preview-litematic-3d.ts#L160-L176](../frontend/src/views/app-preview/litematic-3d.ts#L160-L176) | 加载期 ESC 泄漏整个 Three.js 场景 + rAF + 6 组监听 | 加 `aborted` 标志，await 后检查 |
| P1-2 | [bus.ts#L151-L157](../frontend/src/bus.ts#L151-L157) + [app-sidebar/index.ts#L160-L202](../frontend/src/views/app-sidebar/index.ts#L160-L202) | `once` off 错对象 + done 事件无 payload → 推送必然 30s 超时误报 + 僵尸监听器无限累积 | 一行修 once；类型表补 payload 字段并在 emit 端带上 |
| P1-3 | `summarize.ts#L83-L88` | 摘要卡 href/title 属性注入 + 无 URL scheme 校验，恶意 .ysm 可 XSS | 换 dom.ts esc + scheme 白名单 |

### P2（17 项，按模块分批修复）

- **app-preview**：model:select 过期守卫（generation counter）；stat 模式死代码链整段移除（联动 handler-upload/handler-sync 两处死注册）
- **app-content**：`_initPreviewResize` document 监听累积；handler-sync `"ysm"` 字面量违 ADR-010；community esc 引号逃逸
- **import-queue**：覆盖路径 `newName`/`finalName` 错位；覆盖成功缺 `stats:refresh`/`tree:reload`；`readEntries` >100 静默截断
- **app-tree**：Delete 键双触发；`RemoveDir` 相对路径；`#sort` 死控件
- **dialogs**：modal 家族无单例（活动弹窗槽位统一治理）；rename.ts esc 缺引号；batch-rename Promise 开弹即结算
- **其他**：app-sync-manager 订阅累积；context-menus file.copy/batch.copy 缺 refreshUI；recycle-bin 假 abort 守卫；model3d keydown 吞输入框按键

### 系统性治理建议（长治久安，均非推倒重来）

1. **esc 收敛**：14+ 处重复实现收敛到 `utils/dom.ts` 单点（P1-3、rename P2、community P2 同根），可走 codemod.mjs 批量替换
2. **弹窗单例槽位**：modal.ts 加活动弹窗登记，一次修复全项目连点叠加问题（优于逐个按钮加守卫）
3. **防过期守卫模式推广**：app-content `_currentRepo` 是现成范本，preview-detail / resource-manager `_init` / recycle-bin 照抄 generation counter 变体
4. **bus.once 修复后**复查全项目 once 消费者语义（当前仅 sidebar 一处）
5. 死代码联动清理：app-preview stat 链 + core/theme.ts + sidebar 死引用 + app-tree 死 handler，删除前跑 `check-orphan-exports --strict`

### L1 工具反哺（见基线节）

doctor.mjs 三处缺陷（Go Test 误报 / grep 依赖 / wails.json 解析）建议在标准环境复跑确认后修复。

---

*报告生成：2026-08-03 · 审计单元 1-4 全部完成 · 后续单元审计结果追加于本文件*

---

## 审计单元 5：核心逻辑/工具四模块（2026-08-04）

> 范围：`core/page-store.ts` / `services/registry.ts` / `core/handlers/global.ts` + `handler-*.ts` / `core/context-menus.ts` + `context-menu.ts`
> 结论：**全部通过或已落地**——4 个 P2、5 个 P3、7 个 P4 全部闭环（四轮提交：af781d8 → a95b0a9 → 616c635 → 98f3a95）。

### page-store — 审核结果

**总体结论：有条件通过 → 已落地（af781d8）**

**亮点：**
- 幂等守卫 + getter 封装，防回环防重复 emit —— frontend/src/core/page-store.ts#L16
- 事件名「请求 nav:change / 完成 nav:changed」现在时/过去时区分清晰（bus.ts）

**风险（已修）：**

| 级别 | 文件 | 观察 | 修复 |
|------|------|------|------|
| 🟠 P2 | page-store.ts#L15-L19 | `setCurrentPage` 零调用方且语义错误（emits 完成事件），被调用即「状态变、内容不渲染」 | 删除；唯一写入点收敛为 registerPageStore 的 nav:changed listener |
| 🟠 P2 | page-store.ts#L5,L23-L27 | 幽灵路径：唯一活跃写入是模块级 listener 绕过 setter；不读 localStorage 启动期漂移 | 新增 resolveInitialPage() 恢复 + app-nav 复用，消除两处恢复逻辑漂移 |
| 🟡 P3 | page-store.ts#L23 | 模块级 bus.on 无守卫，HMR 累积 | 改走 registerXxx(unsubs) 统一生命周期 |
| 🟢 P4 | page-store.ts#L8 | PageName 宽松 string | 提升为联合类型（bus.ts），拼错编译期拦截 |

### registry — 审核结果

**总体结论：有条件通过 → 已落地（a95b0a9）**

**亮点：**
- 零依赖纯 Map 封装，API 面最小（5 函数），get 异常契约含服务名
- 测试覆盖全生命周期 7 用例（ADR-023 Vitest 门禁）

**风险（已修）：**

| 级别 | 文件 | 观察 | 修复 |
|------|------|------|------|
| 🟠 P2 | app-modules.ts#L11-L12 | 注册空转：loadInstances/loadEntries 注册后全项目零 get() 消费 | 三处消费方改走 `get&lt;typeof loadXxx>("loadXxx")`，DI 价值兑现，替换点收敛到 app-modules.ts 一处 |
| 🟡 P3 | registry.ts#L10-L27 | 服务名自由字符串，拼错运行时才炸 | ServiceName 联合收窄 register/get/has/unregister |
| 🟡 P3 | registry.ts#L21-L23 | 重复注册静默覆盖 | 覆盖时 console.warn 告警 |
| 🟢 P4 | registry.ts#L11 | 注释「app-modules.js」漂移 | 改 app-modules.ts |

### 全局 handler 族 — 审核结果

**总体结论：通过**（陷阱 #2 正确实现范例，无阻断项）

**亮点：**
- handler-dnd.ts#L272-L287 document 监听 4 配 4 清理 + 遮罩 DOM 回收
- handler-sync.ts#L108-L111 finally 里 emit 完成事件（陷阱 #3 正确模式）
- 全局 handler 唯一聚合（global-handlers.ts）+ 唯一挂载（app-content:100）+ disconnectedCallback 全链清理

**风险（已修/观察）：**

| 级别 | 文件 | 观察 | 修复 |
|------|------|------|------|
| 🟢 P4 | handler-dnd.ts#L46 | dropLeaveTimer 未在 unsubs 清理 | 98f3a95：clearTimeout + 置 null |
| 🟢 P4 | handler-sync.ts#L184-L200 | catch 内 await AddImportLog 无二次防护 | 98f3a95：内层 try/catch 包裹 |
| 🟢 P4 | handler-dnd.ts#L114 | onDrop 无顶层 catch | 98f3a95：onDropSafe wrapper 兜底 + toast 反馈 |

### context-menus — 审核结果

**总体结论：通过 → 已落地（616c635）**

**亮点：**
- menu-defs.ts 声明式唯一事实来源（ADR-021 B 层），加菜单项只改声明表，测试遍历断言
- context-menu.ts 组件三资源配对零缺陷 + `_esc()` 全量转义 + 边界检测

**风险（已修）：**

| 级别 | 文件 | 观察 | 修复 |
|------|------|------|------|
| 🟡 P3 | context-menus.ts#L392-L400 | registerContextMenus 无 unsub 收集 + 无守卫，HMR 累积 | 改 registerContextMenus(unsubs) + 聚合进 registerGlobalHandlers（app-modules.ts 移除直接调用） |
| 🟡 P3 | context-menus.ts#L383 | HANDLERS[action] 静默 miss，点击无反应难排查 | 查表 miss console.warn（测试断言零警告） |
| 🟢 P4 | context-menus.ts#L357 | execCommand("copy") 已废弃 API | 保持现状（兼容性好，剪贴板 API 需权限） |

### 闭环验证矩阵（四轮提交后）

| 检查 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 0 错误 |
| `npx vite build` | ✅ 成功 |
| `vitest` 全量 | ✅ 22 文件 / 317 用例全过 |
| `check-circular` | ✅ 0 循环（122 模块）|
| `check-consumers` / `check-deadcode-baseline` | ✅ 无新增 |

**提交记录：** `af781d8`（page-store 幽灵路径+注册统一化）→ `a95b0a9`（registry DI 兑现+ServiceName）→ `616c635`（context-menus 注册统一化+miss 告警）→ `98f3a95`（DnD/同步 P4 清理兜底）

*报告更新：2026-08-04 · 审计单元 5 完成*
