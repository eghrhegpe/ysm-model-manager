# ADR-123：跨环境降级策略统一

- **状态**：🔄 部分采纳（Partially Accepted）— 诊断已落，三处修复方向已定，实施排期待 Phase 4
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-27
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-049（网页版桥接）、ADR-071（能力门控）、frontend/src/features/community/download-queue-store.ts、frontend/src/features/import-dnd.ts、frontend/src/services/cli-bridge.ts`

---

## 1. 背景（Context）

`ADR-049` 确立了「backend 适配器双实现」路线：`resolveWebMode()` 为权威信号，桌面/Android 走 Wails Go 桥，网页版走 browserAdapter（IndexedDB 模型库 + localStorage）。Phase 3 能力门控收敛了 UI 显示，但**降级执行路径**存在三处各自为政的实现：

| 路径 | 文件 | 降级方式 | 问题 |
|------|------|---------|------|
| 社区下载队列 | `download-queue-store.ts:177` | `<a download>` 逐个触发浏览器保存 | 触发后直接置 `STATE.status="idle"`，完全绕过后端事件流；progress guard 无进度更新，UI 短暂闪烁后消失；无 toast 反馈，用户不知道下载是否成功 |
| 仓库页拖拽导入 | `import-dnd.ts:62` | `resolveWebMode()` 硬分支 → `importWebFilesWithToast` 直写 IndexedDB | 行为正确，但与下载队列语义不一致：导入有 toast + tree:reload + stats:refresh，下载无；两者在 web 模式下应该走同一条 IndexedDB 写入链路，但入口完全分离 |
| CLI 命令白名单 | `cli-bridge.ts:103` | `resolveWebMode()` 硬分支 → 硬编码 `ALLOWED_CLI_COMMANDS` 白名单 | `executeCLI` 返回 `{status:"not_supported"}`，但 UI 列仍显示（table 未隐藏）；`can("ExecuteCLI")` 在 browserAdapter 里恒 true（`ExecuteCLI` 已注册到 `webCliBindings`），导致 UI 门控失效 |

**根因**：三种路径都用了 `resolveWebMode()` 硬分支，没有统一的"web 降级策略层"——状态机、反馈（toast / busy / 刷新）、错误处理互不对齐。用户从桌面切到 web（或反之）时，功能矩阵不透明。

---

## 2. 决策（Decision）

### 2.1 诊断结论（已执行）

三种降级模式的差异已记录，对应修复方向已明确：

| # | 路径 | 现状 | 推荐修复方向 |
|---|------|------|-------------|
| P1 | 社区下载队列 | `<a download>` 直链触发，STATE 立即 idle | 改为 IndexedDB 写入（与 import 对齐），补充 fetch 校验 + toast 反馈；大文件（>50MB）回退 `<a download>` 并提示 |
| P2 | CLI 白名单 | 硬编码白名单，UI 列未隐藏 | `executeCLI` 返回 `not_supported` 时消费方应调 `can("ExecuteCLI")` 门控；或在 `webCliBindings` 里把 `ExecuteCLI` 从 binding 移除（让 `can` 直接 false） |
| P3 | 三路径统一入口 | 各自 import `resolveWebMode()` 硬分支 | 新建 `backend/platform-web.ts`，导出 `resolvePlatformMode(): "desktop"\|"web"\|"android"` + `isWebOnly<T>(fn, fallback)` 辅助函数；所有降级路径收口到 platform-web |

### 2.2 阶段规划

- **Phase 3a（当前）**：诊断 ADR，记录问题与方向，不修改代码（本 ADR）。
- **Phase 3b（待排期）**：实施 P1/P2 修复；P3 视 Phase 3b 后是否仍有散落分支决定是否新建 platform-web。
- **Phase 4（远期）**：若平台差异持续扩大，引入 platform-web 统一层（`resolvePlatformMode` + platform-specific binding fragments）；否则保持现有 browserAdapter + `resolveWebMode()` 双轨。

---

## 3. 后果（Consequences）

- **正面**：
  - 三处降级的已知缺陷被显式记录，后续实施有明确验收标准（P1: IndexedDB + toast；P2: UI 门控；P3: 统一入口可选）。
  - 避免了"修了一处、漏了三处"的修补式治理——本次全量盘点后按优先级顺序推进。
- **负面 / 已知遗留**：
  - P1 未完成：web 模式下下载社区模型仍走 `<a download>`，状态瞬时 idle，无进度反馈，用户体验断裂。
  - P2 未完成：CLI 命令列在 web 模式下可见但不可用，`can("ExecuteCLI")` 门控失效（`webCliBindings` 有 `ExecuteCLI` 实现，proxy `has` 陷阱返回 true）。
  - P3 未完成：`resolveWebMode()` 散落在 12 个文件，无统一降级策略层。
- **后续待办（非本 ADR 实施进度）**：
  - P1：`download-queue-store.ts` web 分支改 IndexedDB 写入（参考 `importWebFiles` 实现）；fetch 校验 URL 可达性（安全约束：仅 http/https）；大文件回退 `<a download>` + toast 提示。
  - P2：从 `webCliBindings` 移除 `ExecuteCLI`（让 `can("ExecuteCLI")` 返回 false），或 UI 消费方加 `!can("ExecuteCLI")` 门控隐藏表格。
  - P3：`backend/platform-web.ts` 抽象 `resolvePlatformMode()` + `isWebOnly<T>()`，12 处 `resolveWebMode()` 逐站替换。

---

## 4. 数据溯源

- `download-queue-store.ts:177` — `<a download>` 降级路径，注释 `// 网页版（ADR-049）`
- `import-dnd.ts:62` — IndexedDB 直写路径，`// 网页版：无本地文件系统`
- `cli-bridge.ts:103` — 硬编码白名单路径，`// 网页版（resolveWebMode）`
- `browser-adapter.ts:41-47` — `webImpls` 装配（含 `webCliBindings`，导致 `can("ExecuteCLI")` 恒 true）
- `platform.ts:28` — `resolveWebMode()` 三 Tier 判定（Tier 0 权威信号）
- 散点：`grep resolveWebMode frontend/src -r --include="*.ts" | grep -v test` 共 12 处
