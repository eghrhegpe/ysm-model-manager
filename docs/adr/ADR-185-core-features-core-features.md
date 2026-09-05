# ADR-185：core 分层治理——特性文件整体迁移至 features，消除 core⇄features 包级环

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-014（core 类型化）、ADR-021（声明式菜单）、ADR-040（context-menu 拆分）、ADR-101（通用逻辑收敛）

---

## 1. 背景（Context）

2026-09 core 锐评发现：`frontend/src/core` 名为内核，实为杂物抽屉。其中 7 条
**core → features/dialogs 反向依赖**与 features/dialogs → core/i18n 的合法依赖
构成**包级环 core ⇄ features**：

```
core/context-menu-{shared,handlers,file-handlers} ──modal 系弹窗──▶ features/dialogs
core/handlers/{instance-ops,android-events}       ──modalConfirm/closeActiveDialog──▶ features/dialogs/modal
features/dialogs（9 文件）──t()──▶ core/i18n/t.ts ──▶ core/i18n/locale.ts ──▶ bus
```

ESM 文件级侥幸不成环（dialogs 只引 core/i18n，i18n 不引 dialogs），运行时未炸，
但 chunk 划分、knip 死代码检测、独立单测能力均被破坏。

涉及文件的真实身份均为「特性」而非「内核」：
右键菜单族 ×6（含 menu-defs）、整合包操作 instance-ops、Android 平台事件 android-events。

## 2. 决策（Decision）

采用**整体迁移**（方案 A），拒绝依赖注入（B，隐藏环不消除环）与 modal 原语下沉
（C，不彻底）：

1. `core/context-menus.ts`、`menu-defs.ts`、`context-menu-{handlers,file-handlers,dir-handlers,shared}.ts`
   及 `context-menus.test.ts` → `features/context-menu/`
2. `core/handlers/instance-ops.ts` + 测试 → `features/pack-ops/`
3. `core/handlers/android-events.ts` + 测试 → `features/platform/`
4. 跨层复用的通知原语 `toast/toastError/toastEmptyRtype` 下沉 `utils/feedback.ts`
   （消费方：settings/store、app-sidebar/events 等 views 文件）
5. `core/handlers/global.ts` 汇编职责上移 `app-content/index.ts`（唯一消费者）；
   core 仅保留 page-store、sync、i18n 等真内核注册器

迁移后 core 零 features 依赖；分层单向：views → features → core → utils/backend。

## 3. 后果（Consequences）

- **正面**：core 可独立编译与单测；knip/chunk 边界恢复干净；后续新增弹窗类特性不再加剧环。
- **负面**：一次性动 ~12 文件路径，git blame 历史跨目录（`git log --follow` 可追溯）。
- **已知遗留**：core/i18n 的 4625 行 locale 数据与 t/tr 双轨仍未治理（另行任务）。

## 4. 数据溯源

2026-09-05 锐评会话：grep 全量 import 边（7 条反向边 + dialogs 9 文件回引 core/i18n）；
消费者审计：context-menu 族仅 2 个 views 文件复用，global.ts 仅 app-content/index.ts 一处消费。
