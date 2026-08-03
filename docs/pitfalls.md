---
title: 致命陷阱手册
description: 项目历史事故浓缩的 11 条避坑教训 — 现象 × 根因 × 规则
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
- **规则**：`sync:download-missing` 等全局 handler 必须放常驻组件 `app-content/index.js` 的 `_registerGlobalHandlers()`，放 `app-tree` 等页面组件会随页面切换销毁。

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
- **规则**：Vite dev 优先加载 `public/` 绕过模块系统。新 JS 放 `frontend/js/`，ESM import → `app-modules.ts` 加注册（治理红线 R6）。

## 10. 回调 API 未 Promise 化

- **现象**：WebView2 DnD 数据读不到。
- **规则**：`dragover` 阶段无法读文件（`getAsFile()`/`webkitGetAsEntry()` 返回 null），只能 `preventDefault()` + 显示遮罩；`drop` 阶段优先 `dataTransfer.items` + `webkitGetAsEntry()`，兜底 `dataTransfer.files`；`entry.file(callback)` → `new Promise(resolve => entry.file(resolve))`；`DataTransferItem` 没有 `.name` 属性（`File` 才有）（治理红线 R3）。

## 11. 3D 坐标变换反复修

- **现象**：「对齐 ysmview cube pivot」连续 5 次 fix；实证 model3d.js 9 次 fix 全项目第一。
- **规则**：改 model2d/model3d/spec.go 坐标前先 grep `bug-chronicle` + 对齐 ysmview 口径（pivot X 取反、`from.x = origin.x - size.x`）；改完用自由相机近距验证。坐标系问题见 ADR-004。

---

## 维护约定

- 新增陷阱：`ai-mistake-tracker.mjs` 发现连续修复链 / 高频 fix 文件时，提炼后追加本手册 + 同步 `AGENTS.md` §二 摘要表。
- 引用本手册时用编号（如「致命陷阱 #9」），重排顺序须全仓更新引用。
