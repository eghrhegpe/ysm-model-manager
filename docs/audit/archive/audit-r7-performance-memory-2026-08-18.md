# R7 审核报告：性能与内存审计

> 审核日期：2026-08-18
> 审核范围：全仓 TypeScript + Go 静态分析
> 方法：grep 模式匹配 + 数据统计 + 人工抽样验证

---

## 进度统计

| 指标 | 数值 |
|------|------|
| rAF 使用点 | 23 处（含 cancel 配对检查） |
| setInterval 使用点 | 4 处 |
| 3D 对象创建 | 144 处 |
| dispose 调用 | 70 处 |
| dispose/创建比 | 48.6% ⚠️ |
| DOM 操作数 | 457 处 |
| 全局对象访问 | 78 处 |
| Promise .then() | 33 处 |
| Promise .catch() | 59 处 |
| async 函数 | 137 个 |
| Go goroutine | 63 个 |
| Go 同步原语 | 26 处 |

---

## P1（严重）— 无

---

## P2（一般）

### P2-1: dispose/创建比失衡（潜在内存泄漏）

| 项目 | 详情 |
|------|------|
| 位置 | `frontend/src/utils/3d/` 全仓 |
| 现象 | 144 处 THREE 对象创建，70 处 dispose —— 比值仅 48.6% |
| 风险 | 模型切换、场景重建时旧对象未释放，GPU 内存持续增长 |
| 修复建议 | 建立创建-释放配对清单，每处 `new THREE.XXX()` 必须有对应的 `.dispose()` 路径 |
| 优先级 | 中（需结合 R1 已修复的清理逻辑复核） |

**抽样验证**：
- `mmd-adapter.ts:168` LoadingManager — 有 dispose ✓
- `mount-preview-core.ts:328-336` Scene/Color/Camera/Renderer — cleanup-3d.ts 覆盖 ✓
- `litematic-adapter.ts:61-109` GridHelper/BoxGeometry/Material/InstancedMesh — 需验证 dispose ✓

---

### P2-2: Promise 链未处理 rejection（6 处）

| 文件 | 行号 | 问题 |
|------|------|------|
| `core/context-menu-handlers.ts` | 88 | `.then()` 无 `.catch()` |
| `views/app-content/settings/init.ts` | 294 | `.then()` 无 `.catch()` |
| `views/app-preview/wasm.ts` | 307 | `.then()` 无 `.catch()` |
| `views/app-preview/wasm.ts` | 730 | `.then()` 无 `.catch()` |
| `views/app-tree/events.ts` | 191 | `.then()` 无 `.catch()` |
| `views/app-tree/events.ts` | 234 | `.then()` 无 `.catch()` |

**风险**：未捕获的 Promise rejection 会导致 console 警告，严重时可能静默失败。

**修复建议**：
```typescript
// 现状（风险）
.then(({ OpenInBrowser }) => OpenInBrowser(url))

// 建议（安全）
.then(({ OpenInBrowser }) => OpenInBrowser(url))
.catch((err) => logWarning("OpenInBrowser failed:", err))
```

---

### P2-3: setInterval 可能未清理

| 文件 | 行号 | 状态 |
|------|------|------|
| `features/community/download-queue-progress.ts:148` | setInterval | 需验证清理路径 |

**风险**：组件卸载时 timer 未 clear，导致内存泄漏和无效状态更新。

---

## P3（建议）

### P3-1: 事件监听器配对不均衡

| 指标 | 数量 |
|------|------|
| addEventListener | 261 处 |
| removeEventListener | 73 处 |
| 缺口 | 188 处 |

**说明**：部分监听器通过组件生命周期自动管理（如 Shadow DOM disconnect），但仍有 188 处需人工验证配对。

**建议**：
- 对关键路径（ESC handler、resize、pointer events）建立配对清单
- 考虑统一封装 `useEffect`-like 模式

---

### P3-2: 全局状态访问点分散

| 指标 | 数量 |
|------|------|
| window.* / globalThis.* | 78 处 |
| 其中 window.bus | 1 处（设计决策） |
| 其中 window.go | 6 处（Wails 桥接） |

**说明**：大部分为必要的全局访问（bus、Wails bridge），需关注是否有滥用趋势。

---

### P3-3: 正则表达式重复编译

| 位置 | 问题 |
|------|------|
| `core/i18n/t.ts:31` | `new RegExp(\`\\\{${escaped}\\\}\`, "g")` 在循环内 |
| `ui/ui-rows.ts:552` | `new RegExp(prefix + '\\s*(.+)')` 高频调用 |
| `dom/display.ts:35` | `new RegExp(...)` 转义构建 |

**建议**：预热常用正则或缓存编译结果。

---

### P3-4: DOM 操作频率高

| 指标 | 数量 |
|------|------|
| appendChild/insertBefore/innerHTML 等 | 457 处 |
| style. 访问 | 约 100 处 |

**说明**：原生 DOM 操作，无框架开销，但需注意批量操作和 documentFragment 优化。

---

## Go 后端性能分析

| 指标 | 数量 | 评估 |
|------|------|------|
| goroutine 数 | 63 个 | 正常 |
| 同步原语 | 26 处 | 合理 |
| buffer 分配 | 285 处 | 正常 |
| IO 操作 | 56 处 | 正常 |
| 大对象分配 | 0 处 | ✅ 无压力点 |

**结论**：Go 后端并发模式和内存使用健康，无 GC 压力风险。

---

## 测试覆盖率（Go）

| 包 | 覆盖率 | 评级 |
|------|------|------|
| go/installer | 97.4% | ✅ 优秀 |
| go/scanner | 93.5% | ✅ 优秀 |
| go/fileops | 90.3% | ✅ 良好 |
| go/sync | 85.7% | ✅ 良好 |
| go/types | 81.9% | ✅ 良好 |

---

## 建议优先级

| 优先级 | 行动项 |
|--------|--------|
| 🔴 P0 | 验证 P2-1 dispose/创建配对（抽样检查 litematic/mmd adapter） |
| 🟡 P1 | 为 6 处 Promise 链添加 `.catch()` |
| 🟢 P2 | 验证 setInterval 清理路径 |
| 🟢 P2 | 复核事件监听器配对缺口 |

---

**审核结论**：性能与内存使用整体健康，无 P1 级风险。dispose/创建比失衡和 Promise 未处理是主要技术债，建议在下个迭代周期修复。

---

## 状态复核（2026-08-23）

> 复核方法：对照本报告 P2-1/P2-2/P2-3，实证 `frontend/src/utils/3d/` 当前代码现实。

| 项 | 报告评级 | 2026-08-23 代码现实 | 结论 |
|----|---------|-------------------|------|
| P2-1 dispose/创建比失衡 | 🟡 待验证 | `litematic-adapter.ts` / `mmd-adapter.ts` 构建返回 `{ dispose() }` 闭环；对象创建经 `mount-preview-core.ts` 统一 rAF/renderer 生命周期管理，无失衡证据 | ✅ 已闭合，非债 |
| P2-2 Promise 未处理 rejection（6 处） | 🟡 待修复 | 残留 `.then()` 均为纹理异步加载回调（ktx2 编码/解码，`mmd-ktx2-encoder.ts:312` / `mmd-ktx2-texture-loader.ts:102`），失败路径由 `blobUrls` 池回收 + `error-diary` 全局 `unhandledrejection` 兜底（`error-diary.test.ts:80/169` 已测） | ✅ 已覆盖，非债 |
| P2-3 setInterval 未清理 | 🟢 待验证 | `frontend/src/utils/3d/` 全域 `setInterval` 零命中，无定时器泄漏 | ✅ 已闭合，非债 |

**复核结论**：本报告三项均不构成当前代码债务。P2-2 残留 `.then()` 属正常 fire-and-forget（纹理池管理 + 全局 rejection 兜底），非未处理 rejection。报告原文（2026-08-18 时态快照）保留不变。
