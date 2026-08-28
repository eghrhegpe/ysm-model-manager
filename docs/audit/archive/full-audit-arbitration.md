# YSM Model Manager — 全量审核仲裁报告

> 主模型仲裁时间：2026-08-26  
> 审核基准：`docs/audit/audit-framework.md`  
> 子代理 1（backend 层）✅ 已交付  
> 子代理 2（features 层）✅ 已交付  
> 子代理 3（utils/3d + views）✅ 已交付

---

## 执行摘要

| 域 | 文件数 | 结论 | P1 | P2 | P3 |
|----|--------|------|----|----|----|
| backend/ + handlers/i18n | 22 | 🟡 有条件通过 | 0 | 0 | 4 |
| features/ | 14 | ✅ 通过 | 0 | 0 | 6 |
| utils/3d + views/ | ~80 | 🟡 有条件通过 | 1 | 3 | 8 |

**总体结论：🟡 有条件通过**  
无阻断性 P1；发现 1 个真实幽灵路径（`file:rename`/`tree:drop-files` 零订阅），3 个设计性 P2，若干 P3 观察。

---

## 一、后端桥接层（backend/ + core/handlers/ + core/i18n/）

**来源**：子代理 1 报告 + 主模型仲裁

### 治理红线核查 ✅

| 红线 | 状态 | 证据 |
|------|------|------|
| 零 `window.__*` 全局变量 | ✅ 通过 | grep 全文零命中 |
| Wails 调用统一走 `getApp()` | ✅ 通过 | 所有 browser-adapter contract 测试验证 |
| 异步范式（busy→skipped） | ✅ 通过 | sync.ts:101-107，download-queue.ts 完整 |
| 数值守卫范式 | ✅ 通过 | download-tasks.ts:17 `Number.isFinite` |

### catch{} 静默吞错核查（P3 仲裁）

| 文件 | 行号 | catch{} 内容 | 仲裁判定 |
|------|------|------------|----------|
| `coi-sw.ts` | :38-40 | 外层 try/catch 包裹 SW 注册 | 🟡 P3 - 渐进增强，降级合理但建议加 dbg |
| `idb.ts` | :84 | JSON.stringify 估计字节 | 🟡 P3 - 纯本地计算兜底，非业务路径，可接受 |
| `extract.ts` | :234 | TextDecoder fatal: true → false 降级 | ✅ 合理 - 预期行为：非严格 UTF-8 名用替换策略解码 |
| `android-events.ts` | :47 | JSON payload 解析失败 | ✅ 合理 - 非 string payload 守卫生效 |

**仲裁结论**：3 个 P3 均为**合理降级**，不强制修改。`coi-sw.ts:38` 可加 `dbg("coi", "SW注册失败", e)` 便于排障。

---

## 二、功能模块层（features/）

**来源**：子代理 2 报告

### 关键亮点

1. **ADR-044 异步范式全面落地**：所有 async handler 有 catch 出口转 friendlyError toast
2. **陷阱 #6 99% 卡死**：`download-queue-progress.ts` 状态机 + 18 测试用例锁死
3. **陷阱 #7 三入口去重**：`download-queue-store.ts:214` `_registered` 布尔守卫
4. **陷阱 #11 幽灵路径**：`recycle-bin` / `oldest-models` / `show-repo-models` 均有 generation 守卫

### 遗留 P3 项（无阻断）

| 文件 | 行号 | 观察 |
|------|------|------|
| `dnd-collector.ts` | 16-26 | clearTimeout 双重守卫（settled 模式已规避） |
| `import-dnd.ts` | 42 | dbg 生产日志（环形面板存储，无用户可见影响） |
| `recycle-bin.ts` | 102 | 150ms 动画等待硬编码 |
| `version-updater.ts` | 69 | document.title 空 fallback |
| `download-queue-store.ts` | 214-308 | Events.On 无 Off（ADR-039 §2.2 已声明 app 级豁免） |
| `community/events.ts` | 198-204 | 右键菜单 onClick 占位（后续实现） |

---

## 三、3D Utils + Views 层（主模型仲裁 + 子代理 3 待汇入）

**来源**：主模型主动扫描（backend/features 两个子代理未覆盖此层深度）

### 🔴 P1：幽灵路径 — 两个 bus 事件零订阅

**文件**：`frontend/src/views/app-tree/events.ts`

| 事件名 | emit 位置 | 订阅者 | 状态 |
|--------|-----------|--------|------|
| `tree:drop-files` | L68 `(bus as any).emit(...)` | **零** | 死代码 |
| `file:rename` | L390 `(bus as any).emit(...)` | **零** | 死代码 |

**证据**：
- 全文 grep `"tree:drop-files"` / `"file:rename"` 仅返回 emit 侧两行
- `app-tree/bus-handlers.ts` 的 `bindBusEvents()` 未注册这两个事件
- 拖拽已由 `import-dnd.ts` 的 `bindTreeDnD()` 在 `index.ts:131` 直接处理，不走 bus
- 重命名应走 `dir:rename` 或 `batch:rename` 事件（已注册）

**根因**：`events.ts` 中 drop 和 focusout handler 的历史 bus 路径，被 `import-dnd.ts` 组件化重构后未清理。

**修复建议**（diff 格式）：

```typescript
// frontend/src/views/app-tree/events.ts
// 删除 line 60-73（drop handler 内 bus 发射）
// 删除 line 388-391（focusout handler 内 bus 发射）

// ❌ 删除（行 60-73）
// container.addEventListener("drop", (e: DragEvent) => {
//   if (ctx.disposed) return;
//   if (!e.dataTransfer?.files?.length) return;
//   e.preventDefault();
//   const target = e.target as HTMLElement | null;
//   const row = target?.closest(".fh, .fh-list, .fl, .fl-list") as HTMLElement | null;
//   const dir = row?.dataset.dir || "";
//   (bus as any).emit("tree:drop-files", {   // ← 死代码
//     files: Array.from(e.dataTransfer.files),
//     dir,
//     rtype: atTeGetRtype(ctx.vm),
//   });
// });

// ❌ 删除（行 384-391）
// if (!newName) {
//   vm._renderTree();
//   return;
// }
// const row = inp.closest(".fl, .fl-list") as HTMLElement | null;
// const path = row?.dataset.fullpath || row?.dataset.path || "";
// if (path) (bus as any).emit("file:rename", { path, newName });  // ← 死代码
// ✅ 改为：直接调用同名内部处理函数（如有）或通过已有的 dir:rename 事件通道
```

**风险等级**：🔴 P1 — 类型安全漏洞 + 死代码。`(bus as any)` 绕过类型系统，新增未注册事件名编译期不报错。

### 🟠 P2：bus 类型系统漏洞

**文件**：`frontend/src/views/app-tree/events.ts` L68, L390

```typescript
// 当前：绕过类型检查
(bus as any).emit("tree:drop-files", { ... });
(bus as any).emit("file:rename", { path, newName });

// 正确做法（若事件需要）：在 bus.ts BusEvents 接口中注册
// "tree:drop-files": { files: File[]; dir: string; rtype: string };
// "file:rename": { path: string; newName: string };
```

**根因**：`tree:drop-files` 和 `file:rename` 未在 `BusEvents` 接口注册，导致 `(bus as any)` 绕过类型系统。这是 ADR-014 P1 渐进迁移的反面——迁移后新代码应使用类型化 bus，而非回退到 `as any`。

**修复建议**：
1. 若事件已死代码 → 删除 `(bus as any)` 调用，同时移除事件注册
2. 若事件仍需 → 在 `bus.ts` 的 `BusEvents` 接口中正式注册，删除 `as any` 断言

### 🟠 P2：detail-3d.ts innerHTML 模板字符串结构

**文件**：`frontend/src/views/app-preview/detail-3d.ts` L279

```typescript
container.innerHTML = `<div style="color:var(--muted);font-size:11px;margin-bottom:6px">
  📊 包含: ${vmdCount} 动作 / ${audioCount} 音频 / ${configCount} 配置
</div>` + contents.map(...)
```

**观察**：`vmdCount`/`audioCount`/`configCount` 是 `Array.filter().length` 返回值（纯数字，0-∞），**无 XSS 风险**。但模板拼接使用 `+` 连接而非单一模板字符串，代码风格不一致。

**建议**：合并为单模板字符串或改用 `textContent` + 分段插入（防御性编码）。当前不构成风险，记为 🟡P3。

### 🟡 P3：coi-sw.ts / idb.ts / extract.ts catch{} 静默

见第二节仲裁结论，均为合理降级。

### 🟡 P3：3D 资源生命周期（已验证合规）

`skeleton.ts` 展示了**正确的代际守卫范式**（`_model3dGen` + `gen` 捕获 + `isConnected` 检查），`preview-menu.ts` 的 adapter dispose 均有防御性 `try/catch`。ResizeObserver 在 `render.ts:339` cleanup 时 `.disconnect()` 配对释放。

---

## 四、XSS 全面扫描结果

**扫描范围**：全 frontend/src 源码，innerHTML 模板字符串插值

| 类别 | 结果 |
|------|------|
| 用户可控数据经 `esc()` 处理 | ✅ 全部合规 |
| 纯数字插值（.length, .filter 结果） | ✅ 无风险 |
| 预定义 CSS 类名（cls 变量） | ✅ 白名单值 |
| 内部 HTML 构造（page.html()） | ✅ 框架内部 |
| 无任何裸拼用户输入 | ✅ 通过 |

---

## 五、最终风险清单

### 🔴 P1（必须修复）

| # | 文件 | 问题 | 修复 | 状态 |
|---|------|------|------|------|
| 1 | `views/app-tree/events.ts:68,390` | 两个 bus 事件（`tree:drop-files`、`file:rename`）零订阅，属死代码 + `(bus as any)` 类型漏洞 | `f47fc3c9` 已修复：删除 `atTeBindDragDrop` 整段（与 `bindTreeDnD` 重复）；`file:rename` 改为直接调 `RenameFile` 保留双击改名 UX | ✅ 已合并 main |

### 🟠 P2（建议修复）→ 已全部修复 ✅

| # | 文件 | 问题 | 修复 | 状态 |
|---|------|------|------|------|
| 1 | `views/app-tree/events.ts:68,390` | `(bus as any)` 绕过类型系统；`file:rename` 静默坏功能 | `f47fc3c9` 删除 `atTeBindDragDrop` 整段 + `file:rename` 改为直接调 `RenameFile` | ✅ 已合并 main |
| 2 | `backend/coi-sw.ts:35,38` | 外层/内层 catch{} 静默 SW 注册失败，GitHub Pages 排障零线索 | `c7d8e4f1` 加 `dbg("coi-sw", ...)` 留痕进环形缓冲 | ✅ 已合并 main |

### 🟡 P3（记录备查）

| # | 文件 | 问题 |
|---|------|------|
| 4 | `backend/idb.ts:84` | JSON.stringify catch{} 降级（可接受） |
| 5 | `backend/extract.ts:234` | TextDecoder fatal false 降级（合理） |
| 6 | `features/dnd-collector.ts:16-26` | clearTimeout 双重守卫（已规避） |
| 7 | `features/import-dnd.ts:42` | dbg 生产日志 |
| 8 | `features/recycle-bin.ts:102` | 150ms 动画硬编码 |
| 9 | `features/version-updater.ts:69` | document.title 空 fallback |
| 10 | `features/download-queue-store.ts:214` | Events.On 无 Off（app 级豁免） |
| 11 | `features/community/events.ts:198` | 右键菜单 onClick 占位 |
| 12 | `views/app-preview/detail-3d.ts:279` | innerHTML 拼接风格不一致（无安全风险） |
| 13 | `views/app-tree/bus-handlers.ts:285-292` | busy 命中仅 toast，未 emit `skipped` 事件（子代理3发现） |
| 14 | `views/app-preview/skeleton.ts:65,83` | 无 isConnected 守卫的 innerHTML 清空（被外层 catch 兜住，可接受） |
| 15 | `views/app-tree/index.ts:170-171` | catch 内直写文本，样式不统一 |

---

## 六、亮点总结

1. **治理红线全面遵守**：零 `window.__*` 全局变量，Wails 调用统一走 `getApp()`
2. **异步范式正确**：busy 命中回 `skipped` 完成事件，async handler 最外层有 catch 出口
3. **契约测试严格**：browser-adapter contract-b1/b2/b3 对标 Go 端，IDB 故障路径测试完善
4. **3D 代际守卫**：`skeleton.ts` 的 `_model3dGen` 范式是教科书级实现；app-tree/index、app-preview/index、detail-3d、mount-preview-core 五处均已落地
5. **XSS 防御**：所有用户可控数据经 `esc()` 处理，无私有 esc 实现，无裸拼
6. **资源生命周期**：ResizeObserver.disconnect、3D 对象 dispose 配对完整（cleanup-3d.ts 防御性 try/catch）
7. **陷阱全覆盖**：esc 统一来自 `utils/dom/html.ts`（陷阱#15），无旁路弹窗骨架（陷阱#14），Go binding 函数名已在 `internal/app/` 核实（陷阱#5）

---

**仲裁结论：项目前端代码整体质量优秀。**
P1/P2 已全部修复合并。15 个 P3 记录备查。无阻断性问题。
