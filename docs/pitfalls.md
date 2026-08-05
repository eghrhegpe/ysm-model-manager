---
title: 致命陷阱手册
description: 项目历史事故浓缩的 16 条避坑教训 — 现象 × 根因 × 规则
---

# 致命陷阱手册（Pitfalls）

> 项目历史事故浓缩的避坑清单，AI 与人类协作必读。**摘要表**常驻 `AGENTS.md` §二，本手册是全量版（含事故背景与处置细节）。
> 事故原始记录见 `docs/archive/bug-chronicle.md`（冻结区，先 grep 再读，禁止全量）；AI 高频犯错区统计用 `node scripts/ai-mistake-tracker.mjs`（反哺本清单）。
> 原 `.github/copilot-instructions.md`「致命陷阱」章节（8 条，引用旧结构已过期）于 2026-08-04 提取归位至本手册并更新至现状。

---

## 1. Go 改后未重建

- **现象**：前端调用没反应，Binding 返回 undefined 或旧行为。
- **规则**：Wails Binding 是编译二进制，改 Go 文件后必须 `wails build` 或 `go build .` + 重启应用。

## 2. 全局事件放错组件

- **现象**：切页后 handler 消失，事件石沉大海。
- **规则**：`sync:download-missing` 等全局 handler 必须放常驻组件 `app-content/index.ts` 的 `_registerGlobalHandlers()`，放 `app-tree` 等页面组件会随页面切换销毁。

## 3. 按钮异步后卡死

- **现象**：操作失败后按钮灰掉/loading 永不结束。
- **规则**：根因是完成事件没走 `finally`。emit 完成事件只放 `finally`，不放 try 末尾——异常路径必须同样触发状态恢复。

## 4. `const` TDZ 静默失败

- **现象**：函数调用无反应，无任何报错。
- **规则**：`const fn = () => {}` 不提升，必须先定义再调用；`async` 函数中 TDZ 抛错会静默消失，排查时优先怀疑定义顺序。

## 5. Go Binding 函数名写错

- **现象**：前端调用返回 undefined。
- **规则**：跨语言调用函数名易错，写前端调用前先 grep `internal/app/` 确认函数名（或跑 `node scripts/binding-check.mjs` 对账）。

## 6. 下载进度 99% 卡死

- **现象**：进度条秒跳 99% 或永久卡 99%。
- **规则**：`Content-Length=-1` → 心跳兜底，最终 `if total <= 0 { total = downloaded }`；大文件锁定 99% 不跳 100%，2s 后转菊花；`stuckGuardReset()` 必须清理 `_stuckTimer`、`_lastPct`、`completeTimer` 全部状态。

## 7. 三入口各自注册

- **现象**：事件重复触发或遗漏。
- **规则**：单击/多选/全选下载都走 `enqueueDownloadTasks()`，只注册一组 Wails EventsOn，禁止各入口分头注册。

## 8. 回收站误删

- **现象**：硬链接/符号链接数据丢失。
- **规则**：符号链接→直接删，硬链接（nlink>1）→直接删，普通文件→移 `.recycle`，跨分区→复制后删；`ensureInDir()` 防路径遍历。

## 9. `public/` 下放 JS

- **现象**：模块加载错乱，改动不生效。
- **规则**：Vite dev 优先加载 `public/` 绕过模块系统。新 JS 放 `frontend/src/`，ESM import → `app-modules.ts` 加注册（治理红线 R6）。

## 10. 回调 API 未 Promise 化

- **现象**：WebView2 DnD 数据读不到。
- **规则**：`dragover` 阶段无法读文件（`getAsFile()`/`webkitGetAsEntry()` 返回 null），只能 `preventDefault()` + 显示遮罩；`drop` 阶段优先 `dataTransfer.items` + `webkitGetAsEntry()`，兜底 `dataTransfer.files`；`entry.file(callback)` → `new Promise(resolve => entry.file(resolve))`；`DataTransferItem` 没有 `.name` 属性（`File` 才有）（治理红线 R3）。

## 11. 3D 坐标变换反复修

- **现象**：「对齐 ysmview cube pivot」连续 5 次 fix；实证 model3d.ts 9 次 fix 全项目第一。
- **规则**：改 model2d/model3d/spec.go 坐标前先 grep `bug-chronicle` + 对齐 ysmview 口径（pivot X 取反、`from.x = origin.x - size.x`）；改完用自由相机近距验证。坐标系问题见 ADR-004。

## 12. CLI 未知 flag 被当标题/位置参数

- **现象**：`new-adr.mjs --help` 被当成标题，误占号生成 `ADR-027-help.md`；`new-knowledge-card.mjs --help` 被当成 kind，生成 `help.md` 知识卡（2026-08-04 并行 AI 实证）。
- **规则**：凡有 positional 参数的 CLI（title/kind/file 等），未知 `--flag` 必须显式白名单拦截，**绝不落入位置参数位**——`--help`/`-h` 输出用法退出 0，未知 flag 报错退出 1；主流程统一 `process.exit(main())` 让退出码真实生效（否则 `return 1` 恒为 0）。已修复：`new-adr.mjs`（parseArgs 白名单）、`new-knowledge-card.mjs`（positional 过滤 flag）。

## 13. 幽灵路径：状态被旁路写入

- **现象**：模块级状态被「旁路」写入——绕过 setter/注册表。两类实证（2026-08-04 核心逻辑四模块审核）：
  - `page-store.ts` 的 `setCurrentPage` 零调用方且 emits「完成事件」`nav:changed` 而非「请求事件」——一旦被调用，app-content 渲染链路不触发，「状态变、内容不渲染」；唯一活跃写入是模块级 `bus.on` listener 直接赋值 `_currentPage`。
  - `registry.ts` 注册空转：`loadInstances`/`loadEntries` 注册进服务表但全项目零 `get()` 消费——DI 容器「建好但没通电」。
- **规则**：模块级可变状态的唯一写入点收敛到显式 API（`registerXxx(unsubs)` 的 listener）；setter 禁发「完成事件」绕过请求链路（要驱动导航就 emit `nav:change` 请求语义）；服务名用联合类型收窄（编译期拦截拼错），注册必有消费方（`get()`），`console.warn` 覆盖告警。

## 14. 旁路弹窗：不走 modal.ts 单例槽位

- **现象**：自定义 `dlg-overlay` 弹窗未走 `dialogs/modal.ts` 的 `registerDlg` 单例槽位（实证：`version-updater.ts` 自带 47 行弹窗骨架，2026-08-04 审核发现）——连点两次会双弹窗双执行，且绕过「新弹窗先结算旧弹窗」的防叠加逻辑。
- **规则**：所有弹窗必须走 `dialogs/modal.ts`（`modalConfirm`/`modalPrompt`/`modalSelect` + `registerDlg` 槽位）；复杂布局用 `modalConfirm` 的 `bodyHTML` 选项（调用方负责转义），**禁止自带弹窗骨架**。已修复：`version-updater.ts` 重构复用 `modalConfirm`（review.mjs W6 扫描旁路）。

## 15. esc 重复实现

- **现象**：10+ 文件各自实现 HTML 转义，replace 数量 3-5 个版本并存（实证：`display.ts`/`mc-format.ts` 3-replace 无引号转义、`modal.ts` 4-replace、`context-menu.ts` 5-replace，2026-08-04 收敛）——属性上下文（`data-*`/`src` 插值）缺引号转义 = XSS 面。
- **规则**：HTML 转义统一 import `utils/dom.ts` 的 `esc`（5-replace 含 `"`/`'`），禁止私有实现；组件 `_esc` 只允许做薄委托。已收敛 10 文件（review.mjs R10 扫描私有实现）。

---

## 16. 静默 catch 无 toast

- **现象**：异步操作的 catch 块只 `console.warn` 或空 `catch(() => {})`，用户对失败无感知（实证：`context-menus.ts` open-folder 空 catch、app-tree `events.ts` 单文件 ToggleModelEnable 仅 console.warn，2026-08-04 审核修复）——操作看似没反应，用户重复点击加剧问题。
- **规则**：所有异常路径必须有 toast 反馈（治理红线 3.3）；catch 内至少 `bus.emit("toast:show", { type: "error" })` 告知用户；`console.warn` 只作辅助日志，不能替代用户反馈。

---

## 维护约定

- 新增陷阱：`ai-mistake-tracker.mjs` 发现连续修复链 / 高频 fix 文件时，提炼后追加本手册 + 同步 `AGENTS.md` §二 摘要表。
- 引用本手册时用编号（如「致命陷阱 #9」），重排顺序须全仓更新引用。
