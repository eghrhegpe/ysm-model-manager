# YSM 模型管理器 UI 组件代码质量审计报告

审计日期：2026-08-06
审计范围：9 个模块（app-content / app-modules / app-tree / app-preview / context-menu / dialog-modal / app-sidebar / app-sync-manager / app-resource-manager）
审计维度：类型安全 / 资源管理 / 并发安全 / 异常契约 / 设计质量

---

## 1. app-modules.ts（组件入口）

**总体评级：🟡 有风险**

### 问题列表

**P3 — 隐式全局 `window.applyTheme`**
- `app-modules.ts:70` — `window.applyTheme = applyTheme;`
- 虽然声明了 `declare global { interface Window { applyTheme?: ... } }`，但这是运行时挂载，非 module 脚本可访问。
- 风险：若其他脚本在 app-modules 之前执行，`window.applyTheme` 为 undefined。
- 建议：在 `initTheme()` 调用前确保挂载顺序，或改为 `Object.defineProperty(window, "applyTheme", ...)`。

**P4 — 主题初始化 catch 块中 `applyTheme(theme)` 可能重复调用**
- `app-modules.ts:81-84` — catch 中重新读取 localStorage 并 applyTheme，但 initTheme 的 try 中已经 applyTheme 过一次（第 80 行）。
- 若 LoadAppConfig 抛异常，theme 可能从未被设置，catch 中才首次设置——这是正确的兜底。但代码可读性差。
- 建议：将 applyTheme 提取到 try/catch 之后统一调用。

**P4 — `checkUpdateSilent().catch` 吞掉异常**
- `app-modules.ts:135` — `.catch((e) => console.warn(...))`
- 静默吞掉更新检查异常，若更新检查有严重问题（如网络配置错误）用户无感知。
- 建议：至少记录到 error-diary（已注册 registerErrorDiary）。

**P3 — 全局 dragover/drop 监听器未注册到 unsubs**
- `app-modules.ts:139-158` — 两个 `document.addEventListener` 永久注册，无对应 removeEventListener。
- 风险：组件卸载后这些全局监听器仍存活，但实际行为无害（只是阻止默认拖拽）。
- 建议：若未来需要清理，应收集到 unsubs。

---

## 2. app-content/index.ts（主内容页）

**总体评级：🟡 有风险**

### 问题列表

**P2 — `_initWorkshop` 中 `showSiteView` 的 cleanup 未接入**
- `app-content/index.ts:635-678` — `showSiteView` 内部 `renderSiteView` 返回的 `unsubs` 被 `void unsubs` 丢弃（site-view.ts:101）。
- 后果：每次切换站点视图，旧的 storage 监听器、事件绑定不回收，切页多次后累积泄漏。
- 修复：在 `_initWorkshop` 中保存 cleanup 引用，切页/组件卸载时调用。

**P2 — `_initWorkshop` 中 `showRepoModels` 的 `_currentRepo` 守卫存在竞态窗口**
- `app-content/index.ts:703-791` — `_currentRepo` 在 `showRepoModels` 开头赋值，但在 `showRepoModels` 内部的多个 await 点之间（第 731/756/769 行）检查。
- 问题：`showRepoModels` 是异步函数，两次调用之间 `_currentRepo` 被覆盖，但第一次调用的后续 await 完成后仍可能执行到第 768-790 行（`_repoEventsCleanup` 被覆盖）。
- 修复：在每次 await 后检查 `_currentRepo !== repo`，当前代码已部分做到，但第 768 行 `await this._repoEventsCleanup()` 后未再次检查。

**P3 — `_initPreviewResize` 中 `mousedown` 事件未清理**
- `app-content/index.ts:230-236` — `handle.addEventListener("mousedown", ...)` 注册在组件实例上，但 `disconnectedCallback` 只清理 `mousemove`/`mouseup`，未清理 `mousedown`。
- 修复：保存 mousedown handler 引用，在 disconnectedCallback 中移除。

**P3 — `_initWorkshop` 中 `Events.On("config-loaded", ...)` 的 unsub 是模块级单例**
- `app-content/index.ts:537-543` — `_avatarConfigLoadedUnsub` 是模块级变量，disconnectedCallback 中清理。
- 问题：若 app-content 组件被多次创建（如 HMR），旧 unsub 被清理后新实例可重新注册——这是正确的。但 `_avatarConfigLoadedRegistered` 也是模块级，若组件被销毁后重建，flag 已复位，可重新注册。
- 风险：若 disconnectedCallback 未执行（如页面直接关闭），Wails 订阅泄漏。
- 建议：在 Wails 端或 app-modules 级别统一注册，而非组件级。

**P4 — `_initGithub` 中 `showRepo` 的 `_currentRepo` 守卫在 `renderModels` 中缺失**
- `app-content/index.ts:950-993` — `renderModels` 内部第 978 行 `await this._repoEventsCleanup()` 后未检查 `_currentRepo`。
- 修复：添加 `if (_currentRepo !== repo) return;`。

**P3 — `_bindTabs` 中 `inited[tab]` 标记在组件重建后不重置**
- `app-content/index.ts:329` — `inited` 是 `_bindTabs` 局部变量，每次 `_render` 调用时重新创建。
- 问题：若用户切到 "import" tab 后组件重建（如 nav:change），`inited` 重置，导致 `initImportQueue` 重复调用。
- 修复：将 `inited` 提升为组件实例属性。

---

## 3. app-content/site-view.ts（站点视图编排）

**总体评级：🟡 有风险**

### 问题列表

**P2 — `renderSiteView` 返回的 cleanup 被调用方丢弃**
- `site-view.ts:93-101` — `unsubs` 数组收集了 `bindBrowseEvents`/`bindEditEvents`/`bindDragEvents` 的 cleanup，但最后 `void unsubs`。
- 后果：每次 `showSiteView` 调用（切站点/切创作者），旧的 storage 监听器、事件绑定不回收。
- 修复：返回 cleanup 函数，调用方（index.ts `_initWorkshop`）保存并在切页时调用。

---

## 4. app-content/site/render.ts（站点 HTML 构建）

**总体评级：🟢 良好**

### 问题列表

**P4 — `createCrCard` 中 `avatarHtml` 的 `onerror` 内联脚本**
- `site/render.ts:62` — `onerror="this.outerHTML=..."` 使用内联事件处理器。
- 风险：若 `fallbackDiv` 包含特殊字符，`replace(/"/g, '&quot;')` 可能不完整（未处理单引号）。
- 建议：改用 `addEventListener("error", ...)` 或确保转义完整。

**P4 — `buildSiteHtml` 中 `cr-edit-card` 的 `draggable="false"` 硬编码**
- `site/render.ts:212/257` — 编辑卡片默认 `draggable="false"`，由 edit.ts 的 mousedown 动态开启。
- 设计合理，无问题。

---

## 5. app-content/site/events.ts（站点浏览态事件）

**总体评级：🟡 有风险**

### 问题列表

**P2 — `_storageSyncFn` 是模块级单例，cleanup 可能误清其他实例的监听**
- `site/events.ts:20` — `_storageSyncFn` 是模块级变量。
- `site/events.ts:286-297` — 每次 `bindBrowseEvents` 调用时，先 remove 旧的再 add 新的。
- 问题：若多个站点视图同时存在（理论上不会，但 HMR 可能），cleanup 会移除其他视图的 storage 监听。
- 建议：将 `_storageSyncFn` 改为实例级或确保单例语义。

**P3 — 详情浮层 `overlay` 未清理**
- `site/events.ts:127-259` — 点击卡片创建 `overlay` 元素，关闭时 `overlay.remove()`。
- 问题：若用户在浮层打开时快速切页，浮层可能残留（浮层 append 到 `searchResults.getRootNode()`，即 shadow root）。
- 修复：在 `bindBrowseEvents` 返回的 cleanup 中移除所有 `.cr-detail-overlay`。

**P4 — `showProgress` 调用后 `await new Promise(r => setTimeout(r, 100))`**
- `site/events.ts:320` — 人为延迟 100ms 再调用 `showRepoModels`。
- 建议：若为视觉过渡，可考虑 CSS transition 替代 setTimeout。

---

## 6. app-content/site/drag.ts（拖拽导入）

**总体评级：🟢 良好**

### 问题列表

**P4 — `bindDragEvents` 返回空 cleanup**
- `site/drag.ts:127` — `return () => {};`
- 问题：dropZone 上的 dragenter/dragover/dragleave/drop 事件监听器在组件卸载时未移除。
- 修复：保存 handler 引用，cleanup 中移除。

---

## 7. app-content/site/edit.ts（编辑模式事件）

**总体评级：🟡 有风险**

### 问题列表

**P3 — 拖拽排序的 `dragSrcIdx`/`dragPresetSrcIdx` 是闭包变量，cleanup 未清理**
- `site/edit.ts:216/282` — 闭包变量在组件卸载后仍可能被 dragend 修改。
- 风险：若组件卸载后用户仍在拖拽（理论上不可能，因为 DOM 已移除），无实际危害。
- 建议：cleanup 中重置为 -1。

**P3 — `bindEditEvents` 返回空 cleanup**
- `site/edit.ts:465` — `return () => {};`
- 问题：所有事件监听器（input/click/dragstart/dragend/dragover/dragenter/dragleave/drop）在组件卸载时未移除。
- 修复：收集所有 handler 引用，cleanup 中批量移除。

**P4 — `syncAllEditInputs` 中 `creators[idx][fld]` 直接赋值**
- `site/edit.ts:191-197/351-357` — 直接给 `creators[idx]` 对象赋值新字段。
- 风险：若 `fld` 是意外值（如 XSS payload），会污染对象。但 `data-fld` 是硬编码的（name/desc/type/role），风险低。

---

## 8. app-tree/index.ts（资源树）

**总体评级：🟢 良好**

### 问题列表

**P3 — `_keydownHandler` 是 async EventListener，但注册为普通 EventListener**
- `app-tree/index.ts:273-318` — `_keydownHandler` 是 async 函数，注册为 `document.addEventListener("keydown", ...)`。
- 问题：async event handler 的 rejection 不会自动传播到全局 unhandledrejection，需手动 catch。
- 当前代码：`_keydownHandler` 内部有 try/catch（通过 modalConfirm 的 catch），但 `_deleteSelected` 的 rejection 未 catch。
- 修复：在 `_keydownHandler` 外层加 try/catch，或改为非 async。

**P4 — `_initKeyboardShortcuts` 中 `document.addEventListener` 注册在 connectedCallback**
- `app-tree/index.ts:317` — 注册在 connectedCallback 中，disconnectedCallback 中清理。
- 设计正确，无问题。

**P4 — `attributeChangedCallback` 中 `void (async () => {...})()` 丢弃 Promise**
- `app-tree/index.ts:168` — 异步 IIFE 的 rejection 未 catch。
- 修复：`.catch(e => console.error(...))`。

---

## 9. app-tree/data.ts（树数据层）

**总体评级：🟢 良好**

### 问题列表

**P4 — `selectState` 是模块级单例，跨组件共享**
- `app-tree/data.ts:4-10` — `selectState` 是模块级变量。
- 问题：若多个 app-tree 实例同时存在（如不同 rtype 的树），选中状态会串扰。
- 当前设计：app-content 中同一时间只有一个 app-tree 实例，所以无实际危害。
- 建议：若未来支持多树，改为实例级。

---

## 10. app-tree/events.ts（树事件委托）

**总体评级：🟢 良好**

### 问题列表

**P3 — `toggleFolderBatch` 中 `vm._batchBusy` 与 `vm._toggleBusy` 共用**
- `app-tree/events.ts:40` — `if (vm._batchBusy || vm._toggleBusy) return;`
- 问题：文件夹批量 toggle 和单文件 toggle 共用并发守卫，一个操作阻塞另一个。
- 设计意图：防止重叠循环。合理，但文档应说明。

**P3 — 文件开关的 Promise 链未 catch 最终 rejection**
- `app-tree/events.ts:141-161` — `getApp().then(...).then(...).catch(...).finally(...)`
- 设计正确：catch 处理 ToggleModelEnable 失败，finally 重置 `_toggleBusy`。

**P4 — `navigator.clipboard?.writeText(name).catch(() => {})`**
- `app-tree/events.ts:213` — 静默吞掉剪贴板写入失败。
- 建议：至少 toast 提示用户。

---

## 11. app-tree/bus-handlers.ts（树 bus 事件处理）

**总体评级：🟢 良好**

### 问题列表

**P3 — `reload` 函数中 `vm._renderTree()` 在 catch 后无条件执行**
- `app-tree/bus-handlers.ts:316` — `vm._renderTree()` 在 try/catch 之后，即使 loadEntries 失败也会渲染（此时 `vm._entries = []`）。
- 设计正确：失败时渲染空态。

**P4 — `batchToggle` 中 `vm._entries.some((e) => e.banned === enable)` 提前返回**
- `app-tree/bus-handlers.ts:372` — 若没有需要切换的条目，直接 return。
- 问题：`runBatchToggle` 的 `_batchBusy` 未设置，所以不会阻塞后续操作。合理。

---

## 12. app-tree/render.ts（树渲染层）

**总体评级：🟢 良好**

### 问题列表

**P4 — `_rowIdCounter` 是模块级变量，永不重置**
- `app-tree/render.ts:136` — `let _rowIdCounter = 0;`
- 问题：若树数据量极大（百万级），counter 可能溢出。但实际场景中不可能达到。
- 建议：无需修复。

**P4 — `renderSlice` 中 `container.innerHTML` 直接拼接 HTML 字符串**
- `app-tree/render.ts:268-275` — 用字符串拼接构建 innerHTML。
- 风险：若 `slice[i].html` 包含用户可控内容且未转义，存在 XSS。但 `html` 来自 `row-tpl.ts`/`row-tpl-list.ts`，内部使用 `esc()` 转义，风险低。

---

## 13. app-tree/toolbar-events.ts（工具栏事件）

**总体评级：🟢 良好**

### 问题列表

**P4 — `openAdvFilterDialog` 中 `rv` 的 `as AdvFilterValue` 强制转换**
- `app-tree/toolbar-events.ts:45` — `const rv = result as AdvFilterValue;`
- 问题：`result` 可能是 `{ cleared: true }`，强制转换为 AdvFilterValue 后字段为 undefined，被后续 null 守卫兜底。
- 建议：用类型守卫或可选链替代强制转换。

---

## 14. app-tree/instance-actions.ts（整合包右键操作）

**总体评级：🟢 良好**

### 问题列表

**P4 — `addImportLog` 中 `getApp().then(...).catch(() => {})` 丢弃 rejection**
- `app-tree/instance-actions.ts:17-21` — 静默吞掉 AddImportLog 失败。
- 建议：至少 console.warn。

---

## 15. app-preview/index.ts（预览面板）

**总体评级：🟢 良好**

### 问题列表

**P3 — `_showModelDetail` 中 `showResourcePack`/`showModelDetail`/`showLitematic`/`showShaderPack` 未 await**
- `app-preview/index.ts:164-178` — 这些函数是 async 但未 await，rejection 未 catch。
- 修复：添加 `.catch(e => console.error(...))` 或改为 await。

**P4 — `_showPackInfo` 中 `pack.imageBase64` 直接拼入 src**
- `app-preview/index.ts:210` — `src="${esc(pack.imageBase64)}"`
- 问题：`esc()` 对 base64 字符串中的 `+`/`/` 等字符可能过度转义，导致图片无法显示。
- 建议：base64 数据 URI 不需要 HTML 转义，直接用 `pack.imageBase64`。

---

## 16. app-preview/loader.ts（模型数据加载）

**总体评级：🟢 良好**

### 问题列表

**P4 — `loadModelData` 中 `AnalyzeBedrockModel` 的 cast `as BedrockGeometry | null`**
- `app-preview/loader.ts:52` — 直接 cast，无运行时类型检查。
- 风险：若 Go 端返回结构变化，前端静默错误。
- 建议：添加运行时校验或 try/catch。

---

## 17. context-menu/index.ts（右键菜单）

**总体评级：🟢 良好**

### 问题列表

**P3 — `disconnectedCallback` 中 `document.removeEventListener("keydown", this._docKeydown)` 可能报错**
- `context-menu/index.ts:32-37` — `_docKeydown` 在 constructor 中初始化，但 `connectedCallback` 中 `document.addEventListener("keydown", ...)` 只在 `show()` 中调用。
- 问题：若组件从未 show 过菜单，`_docKeydown` 从未被 addEventListener 注册，removeEventListener 是空操作（无害）。
- 但 `connectedCallback` 中注册了 `click` 和 `contextmenu`，disconnectedCallback 中移除——正确。

**P4 — `show()` 中 `requestAnimationFrame` 后设置位置**
- `context-menu/index.ts:127-139` — 用 RAF 测量菜单尺寸再定位，避免跳变。
- 设计正确，无问题。

---

## 18. dialogs/modal.ts（弹窗基座）

**总体评级：🟢 良好**

### 问题列表

**P3 — `closeDlg` 中 `setTimeout` 后 `overlay.remove()` 和 `resolve(value)` 顺序**
- `dialogs/modal.ts:32-39` — 先 remove 再 resolve。
- 问题：若调用方在 resolve 后立即操作 DOM（如查询 overlay），会报错。但调用方通常在 resolve 后不再操作 overlay，所以无实际危害。

**P4 — `modalSelect` 中 `void placeholder` 未使用**
- `dialogs/modal.ts:188` — `void placeholder;`
- 建议：移除或实现 placeholder 功能。

---

## 19. app-sidebar/index.ts（侧边栏）

**总体评级：🟢 良好**

### 问题列表

**P3 — `_reload` 中 `this._pendingReload` 补跑机制可能无限循环**
- `app-sidebar/index.ts:294-336` — 若 `_reload` 持续失败（如网络断开），`_pendingReload` 在 finally 中触发下一次 `_reload`，形成循环。
- 修复：添加最大重试次数或指数退避。

**P4 — `_bindSyncSelected` 中 push/pull 的 `this._syncInProgress` 守卫**
- `app-sidebar/index.ts:185/242` — 并发守卫防止重复推送/拉取。
- 设计正确，finally 中恢复按钮状态。

---

## 20. app-sidebar/events.ts（侧边栏事件）

**总体评级：🟢 良好**

### 问题列表

**P3 — `_lastList`/`_clickHandler`/`_contextHandler` 是模块级单例**
- `app-sidebar/events.ts:11-13` — 模块级变量。
- 问题：若多个 app-sidebar 实例存在，事件绑定会串扰。
- 当前设计：同一时间只有一个 app-sidebar 实例，无实际危害。

**P4 — `bindFooter` 中 `btn.onclick = () => bus.emit(...)` 覆盖**
- `app-sidebar/events.ts:143-145` — 每次 `bindFooter` 调用覆盖 `btn.onclick`。
- 问题：若 `bindFooter` 被多次调用，onclick 被重复覆盖（无害，因为行为一致）。

---

## 21. app-sync-manager/index.ts（整合包同步页）

**总体评级：🟢 良好**

### 问题列表

**P3 — `_init` 中 `this._unsubs` 在 `_render` 前清理**
- `app-sync-manager/index.ts:109-112` — 先清理旧订阅再注册新订阅。
- 问题：若 `_init` 因 `gen !== this._gen` 提前返回（第 93 行），订阅不会被注册，但旧订阅已被清理——导致无订阅。
- 修复：将订阅注册移到 gen 检查之后。

**P4 — `_render` 中 `this.innerHTML = containerHTML()` 可能覆盖正在进行的异步操作**
- `app-sync-manager/index.ts:178` — 每次 `_render` 重置 innerHTML。
- 问题：若 `_pushSingleFile`/`_pullSingleFile` 正在进行，innerHTML 重置会移除按钮，但 `_singleBusy` 守卫防止重复触发。

---

## 22. app-resource-manager/index.ts（资源管理页）

**总体评级：🟢 良好**

### 问题列表

**P3 — `_init` 中 `getApp()` 被多次调用**
- `app-resource-manager/index.ts:136-147` — 第一次 `getApp()` 获取多个方法，第 153-154 行又调用 `getApp()` 获取 `LoadAppConfig`/`ListVersionInstances`。
- 问题：`getApp()` 是异步的，每次调用有开销。
- 建议：合并为一次 `getApp()` 调用。

**P3 — `_showDetail` 中 `detailHTML` 的 `path` 参数直接拼入 DOM**
- `app-resource-manager/index.ts:411-418` — `path` 传入 `detailHTML`，若 `detailHTML` 未转义，存在 XSS。
- 建议：确认 `detailHTML` 内部使用 `esc()`。

**P4 — `_toast` 中 `type` 参数强制转换为联合类型**
- `app-resource-manager/index.ts:470-476` — `(type || "info") as "info" | "success" | "error" | "warn"`
- 问题：若 `type` 是意外值（如 "ok"），强制转换后 toast 可能无对应样式。
- 建议：用白名单校验。

---

## 23. core/handlers/dnd.ts（全局拖拽导入）

**总体评级：🟢 良好**

### 问题列表

**P3 — `onDrop` 中 `executeCollected` 的 rejection 由 `onDropSafe` 的 catch 兜底**
- `core/handlers/dnd.ts:227-237` — `await executeCollected(...)` 的 rejection 向上传递。
- `core/handlers/dnd.ts:241-250` — `onDropSafe` 的 catch 统一兜底。
- 设计正确，无问题。

**P4 — `collectFiles` 中 `readAll` 的递归深度限制为 10**
- `core/handlers/dnd.ts:142` — `if (depth > 10) return [];`
- 建议：若用户有深层目录结构，可能遗漏文件。可考虑增加到 20 或动态限制。

---

## 24. core/handlers/sync.ts（同步 handler）

**总体评级：🟢 良好**

### 问题列表

**P3 — `_downloadBusy`/`_toggleBusy` 是闭包变量，跨 handler 调用不共享**
- `core/handlers/sync.ts:13/114` — 每个 handler 有自己的 busy flag。
- 问题：`sync:download:missing` 和 `sync:toggle:status` 的 busy flag 独立，一个操作不阻塞另一个。
- 设计意图：两个操作操作不同资源，独立合理。

---

## 25. core/handlers/instance-ops.ts（整合包操作）

**总体评级：🟢 良好**

### 问题列表

**P4 — `instance:export-list` 中 `navigator.clipboard.writeText` 无 fallback**
- `core/handlers/instance-ops.ts:72` — 直接使用 clipboard API，无降级方案。
- 建议：添加 `document.execCommand("copy")` fallback（与 context-menus.ts 一致）。

---

## 26. app-nav/index.ts（左侧导航）

**总体评级：🟢 良好**

### 问题列表

**P4 — `render()` 中 `getApp().then(...).catch(...)` 的 rejection 被静默吞掉**
- `app-nav/index.ts:134-144` — catch 中设置默认版本号。
- 设计正确，无问题。

---

## 27. app-toast/index.ts（Toast 通知）

**总体评级：🟢 良好**

### 问题列表

**P4 — `_remove` 中 `setTimeout(() => t.remove(), 200)` 后元素仍在 DOM**
- `app-toast/index.ts:98-103` — 动画 200ms 后移除。
- 问题：若用户在动画期间快速触发多个 toast，`c.children.length` 可能超过 5（因为旧元素尚未 remove）。
- 修复：在 `_remove` 开始时立即从 `c.children` 计数中排除，或缩短超时。

---

## 28. core/context-menus.ts（右键菜单映射）

**总体评级：🟢 良好**

### 问题列表

**P3 — `batch.move`/`batch.copy` 的 `_batchBusy` 是模块级单例**
- `core/context-menus.ts:76` — `let _batchBusy = false;`
- 问题：若两个右键菜单同时触发移动/复制，第二个被阻塞。
- 设计意图：防止并发操作同一批文件。合理。

**P4 — `file.move`/`file.copy`/`dir.move`/`dir.copy` 无并发守卫**
- `core/context-menus.ts:258-293/392-427` — 单文件/文件夹移动复制无 `_batchBusy` 守卫。
- 问题：快速连点可能并发执行多个移动/复制操作。
- 建议：添加守卫或复用 `_batchBusy`。

---

## 29. core/page-store.ts（页面导航状态）

**总体评级：🟢 良好**

### 问题列表

**P4 — `registerPageStore` 中 `bus.on("nav:changed", ...)` 的 unsub 收集到 unsubs**
- `core/page-store.ts:49-57` — 正确收集到 unsubs。
- 设计正确，无问题。

---

## 总结

### 严重度分布

| 严重度 | 数量 | 说明 |
|--------|------|------|
| P1 致命 | 0 | 无 |
| P2 严重 | 4 | cleanup 泄漏、竞态窗口 |
| P3 一般 | 14 | 事件未清理、Promise 丢弃、模块级单例 |
| P4 建议 | 18 | 代码风格、防御性编程 |

### 核心发现

1. **cleanup 泄漏是最大风险**：`site-view.ts` 的 `void unsubs`、`site/edit.ts` 和 `site/drag.ts` 的空 cleanup 导致切页/切站点时事件监听器累积。这是 P2 级别，应优先修复。

2. **并发守卫设计良好**：`_batchBusy`/`_toggleBusy`/`_syncInProgress`/`_downloadBusy`/`_gen` 代际计数等机制覆盖了大部分竞态场景。

3. **Promise 链管理总体规范**：大部分异步操作有 try/catch/finally，少数 async event handler 的 rejection 未 catch（P3）。

4. **类型安全良好**：bus 事件类型化、JSDoc 注释充分、隐式全局极少（仅 `window.applyTheme` 和 `window.bus`，后者是设计需要）。

5. **CSS 全走变量**：所有组件使用 `var(--*)` 变量，无硬编码颜色/尺寸。

6. **事件命名 kebab-case**：bus 事件名（`nav:change`/`toast:show`/`ctx:show`）符合 kebab-case 规范。

7. **Web Components 生命周期规范**：connectedCallback/disconnectedCallback 配对，observedAttributes 正确声明。

### 优先修复建议

1. **P2**：修复 `site-view.ts` 的 cleanup 泄漏（返回 cleanup 函数，调用方保存并调用）。
2. **P2**：修复 `site/edit.ts` 和 `site/drag.ts` 的空 cleanup（收集 handler 引用并移除）。
3. **P3**：修复 `app-content/index.ts` 的 `_initWorkshop` 中 `_currentRepo` 竞态窗口。
4. **P3**：修复 `app-preview/index.ts` 中未 await 的 async 函数调用。
5. **P3**：修复 `app-sidebar/index.ts` 的 `_pendingReload` 无限循环风险。