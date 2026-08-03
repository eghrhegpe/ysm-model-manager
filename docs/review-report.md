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
| 🟡 L1-2 | Governance Rules 依赖系统 `grep`，Windows pwsh 环境全段失效 | 改用 Node 内置实现（与 review.mjs 同口径），消除对外部 grep 的依赖 |
| 🟡 L1-3 | doctor 解析 wails.json 失败但契约测试通过 | 统一走 `test_config_syntax.mjs` 同一解析路径 |

---

## app-preview — 审核结果

**总体结论：有条件通过**（3D/2D 渲染主链路质量良好，守卫模式成熟；但存在死代码链、两处资源泄漏竞态、一处数据竞态）

**审计范围**：`frontend/js/components/app-preview/`（16 文件，约 3900 行）

**亮点：**

- 全窗预览关闭路径有 `closed` 幂等守卫，三层监听全配对 —— [preview-zoom.ts#L66-L74](../frontend/js/components/app-preview/preview-zoom.ts#L66-L74)
- 2D 拖拽 window 监听走模块槽位幂等绑定，注释明确防泄漏意图 —— [preview-skeleton.ts#L11-L14](../frontend/js/components/app-preview/preview-skeleton.ts#L11-L14)、[L186-L203](../frontend/js/components/app-preview/preview-skeleton.ts#L186-L203)
- 并发守卫齐全且走 try/finally：`_saving`（截图，[preview-skeleton.ts#L325-L334](../frontend/js/components/app-preview/preview-skeleton.ts#L325-L334)）、`_loading3D`（防双击，[L258-L261](../frontend/js/components/app-preview/preview-skeleton.ts#L258-L261)）、litematic 3D 按钮 disabled + finally 恢复 —— [preview-litematic-meta.ts#L192-L202](../frontend/js/components/app-preview/preview-litematic-meta.ts#L192-L202)
- `close3D()` 统一三条关闭路径（关闭按钮/ESC/切换纹理），并清理 timer + keyHandler + renderer —— [preview-skeleton.ts#L470-L486](../frontend/js/components/app-preview/preview-skeleton.ts#L470-L486)
- MMD 事件委托用 WeakSet 按 ShadowRoot 实例守卫，组件重建后仍可注册 —— [preview-pack.ts#L207-L217](../frontend/js/components/app-preview/preview-pack.ts#L207-L217)
- 预览缓存 FIFO 淘汰 + evict 回调释放 blob URL，设计完整 —— [preview-cache.ts#L47-L64](../frontend/js/utils/preview-cache.ts#L47-L64)
- 错误路径均有 UI 反馈且 `esc()` 转义到位 —— [preview-skeleton.ts#L776-L781](../frontend/js/components/app-preview/preview-skeleton.ts#L776-L781)

**风险：**

| 级别 | 文件 | 观察 | 建议 |
|------|------|------|------|
| 🔴 极高 P1 | [preview-litematic-3d.ts#L160-L176](../frontend/js/components/app-preview/preview-litematic-3d.ts#L160-L176) | **加载期 ESC 竞态泄漏整个 Three.js 场景**：`escH` 在 try 块前注册，用户在体素数据异步加载期间按 ESC → `closeOverlay()` 移除 overlay 并置 `_voxel3d=null`，但随后 `await fn(path)` 兑现，代码继续构建场景、启动 `requestAnimationFrame` 循环并注册 keydown/keyup/mousemove/mouseup/resize/escHandler 六组监听——全部挂在已被移除的 overlay 与 document/window 上，永久运行直到下次打开 3D（或永不回收） | 引入 `aborted` 标志：`closeOverlay()` 置位；try 块内每次 await 后检查，已中止则就地清理并 return；或把 `escH` 的关闭路径统一改为调用 `fullCleanup` 的占位链 |
| 🟠 高 P2 | [preview-detail.ts#L41-L77](../frontend/js/components/app-preview/preview-detail.ts#L41-L77)、[index.ts#L82-L89](../frontend/js/components/app-preview/index.ts#L82-L89) | **model:select 无过期守卫，慢请求污染新选择**：快速切换模型时，A 的 `showModelDetail` 异步链（`_loadPreviewImage` + `ExtractYsmSummary`）晚于 B 返回时，`getElementById("preview-detail")` 取到的是 B 的面板，A 的摘要卡会覆盖/残留在 B 的界面上；上游 `bus.on("model:select")` 也无去重 | 加 generation counter：`_showModelDetail` 自增序号，异步回写前比对；或参照 `_initGithub` 的 `_currentRepo` 防过期模式（[app-content/index.ts#L820-L834](../frontend/js/components/app-content/index.ts#L820-L834)） |
| 🟠 高 P2 | [index.ts#L36-L113](../frontend/js/components/app-preview/index.ts#L36-L113) + [events.ts](../frontend/js/components/app-preview/events.ts) + [preview-actions.ts](../frontend/js/components/app-preview/preview-actions.ts) + [preview-logs.ts](../frontend/js/components/app-preview/preview-logs.ts) | **stat 模式整条链路为死代码**：全前端仅 app-content/tpl.ts 以 `mode="model"` 挂载唯一实例（整合包详情已改由 `app-sync-manager` 承接，`package:selected` 监听在 [app-content/index.ts#L217-L230](../frontend/js/components/app-content/index.ts#L217-L230)）。`statsHTML` / `bindBusUpdates` / `bindActions` / `registerMmdEvents` / `loadLogsPreview` / `showPackageDetail` / `resetGlobalButtons` 仅被 stat 分支自相引用，`dp-log-footer` 永久 `display:none` | 整段移除 stat 分支（index.ts connectedCallback stat 段 + events.ts + preview-actions.ts + preview-logs.ts + preview-pack.ts 的 showPackageDetail 系 + tpl.ts statsHTML），删除前跑 `node scripts/check-consumers.mjs --strict` 复核孤儿导出 |
| 🟡 中 P3 | [index.ts#L40](../frontend/js/components/app-preview/index.ts#L40)、[L99-L104](../frontend/js/components/app-preview/index.ts#L99-L104) | `_modelCleanup` 声明后**从未赋值**，`_cleanupModelListeners()` 恒为空操作（window 级监听实际靠 preview-skeleton 的模块槽位兜底） | 要么接线（3D overlay 的 close3D 注册进 `_modelCleanup`，组件卸载时兜底关闭），要么删除字段 |
| 🟡 中 P3 | [index.ts#L22-L34](../frontend/js/components/app-preview/index.ts#L22-L34) | **evict 回调不回收头像 blob URL**：preview-wasm.ts 为作者头像 `URL.createObjectURL`（[preview-wasm.ts#L80-L83](../frontend/js/components/app-preview/preview-wasm.ts#L80-L83)）存入 `authors[].avatarUrl` / `avatars`，淘汰回调只释放 `geometry.textures` / `texture`，缓存流转 50 条后头像 blob 持续累积 | evict 回调补扫 `val.authors[].avatarUrl` 与 `val.avatars` 中的 `blob:` 前缀并 revoke |
| 🟡 中 P3 | [preview-skeleton.ts#L270-L281](../frontend/js/components/app-preview/preview-skeleton.ts#L270-L281)、[preview-litematic-3d.ts#L28-L40](../frontend/js/components/app-preview/preview-litematic-3d.ts#L28-L40) 等 | 全屏 overlay 大量内联硬编码色（`#1a1b2e` / `#2a2b3e` / `rgba(…)` 数十处），违 ADR-005「CSS 全走变量」；两处 3D overlay 的 topBar/控件样式近乎逐行重复（jscpd 已报） | overlay 挂在 document.body 可用 `:root` 变量；抽公共 `fullscreen-overlay-css` + 工厂函数消重 |
| 🟡 中 P3 | [preview-skeleton.ts#L297-L301](../frontend/js/components/app-preview/preview-skeleton.ts#L297-L301) | 纹理切换走 `close3D() + _toggle3D()` 迂回重开：先持久化 `_prefer3D=false` 再翻回 true，状态来回写 localStorage，链路脆弱（任一步提前 return 即状态不一致） | 抽 `reopen3D(texIdx)` 直接重建，不经过 toggle 取反 |
| 🟢 低 P4 | [preview-skeleton.ts#L791](../frontend/js/components/app-preview/preview-skeleton.ts#L791) | `_prefer3D` 自动重开 3D 用 `requestAnimationFrame(() => btn3d?.click())`，旧闭包 btn3d 已 detach 仍可触发 → 快速连续选中模型时可能弹出**上一个模型**的 3D overlay | rAF 回调内校验 `btn3d.isConnected`，或改用生成序号防过期 |
| 🟢 低 P4 | [preview-detail.ts#L80](../frontend/js/components/app-preview/preview-detail.ts#L80)、[preview-litematic-meta.ts#L196](../frontend/js/components/app-preview/preview-litematic-meta.ts#L196) | 动态 import 用 `.js` 扩展名（其余全 `.ts`），Vite 兼容但与仓库惯例不一致 | 统一为 `.ts` |
| 🟢 低 P4 | [preview-wasm.ts#L110-L127](../frontend/js/components/app-preview/preview-wasm.ts#L110-L127) | 同文件已有 `devLog`，却残留 3 处裸 `console.log`（生产环境仍输出） | 换 `devLog` 或删除（按约定需先请示） |
| 🟢 低 P4 | [index.ts#L93-L96](../frontend/js/components/app-preview/index.ts#L93-L96) | `disconnectedCallback` 遍历 `_unsubs` 后不清空数组，重连时累积已失效的退订函数（bus 退订幂等故无害） | `forEach` 后 `this._unsubs = []` |
| 🟢 低 P4 | [preview-skeleton.ts#L343-L345](../frontend/js/components/app-preview/preview-skeleton.ts#L343-L345) | 截图失败仅把按钮文字改 ❌，无 toast（违「异常路径必须有 toast 反馈」） | 补 `bus.emit("toast:show", …)` |

**心理模拟记录（4 模型）：**

1. **契约检查**：`PreviewCtx` 接口最小面设计良好；`_decodeYsmViaWasm` / `decodeYsmViaWasm` 双别名冗余（一个给 loader、一个给接口）可合并。
2. **状态机模拟**：3D 连点有 `_loading3D` 拦截 ✅；纹理切换 = 关闭+重开串行，无并发窗口 ✅；但加载期 ESC 打断了状态机（P1）。
3. **异常模拟**：`renderModel3D` 抛错 → catch 渲染错误信息，`_loading3D` 在 try 外复位 ✅；但 DOM 构建段（L266-L529）若抛错 `_loading3D` 永不复位（该段几乎不可能抛错，不单列）。
4. **引用计数**：组件内 `bus.on` 全部进 `_unsubs` ✅；document/window 监听除 P1 竞态外全配对 ✅；`_prevWindowMove/_prevWindowUp` 在组件卸载后残留至下次 loadModel2D（handler 有 `_dragging` 短路，功能无害，闭包滞留 canvas 对象，不单列）。

---

## app-content — 审核结果

（审计进行中）

## import-queue + 下载链 — 审核结果

（待审计）

## 其余组件 → utils/services — 审核结果

（待审计）
