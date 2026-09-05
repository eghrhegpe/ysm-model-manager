# ADR-187：features/ 目录归位与 modal.ts 拆分收敛

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：
  - 关联代码：`frontend/src/features/`（根目录 18 平铺文件）、`frontend/src/features/dialogs/modal.ts`
  - 前置规则：AGENTS.md「前端/Go 职责归属红线」「3d 菜单只允许 visibleWhen」
  - 反向引用：
    - [ADR-014 P3](../ADR-014-type-driven-state.md)（类型化版 features 落地）
    - [ADR-040](../ADR-040-context-menu-handlers-split.md)（右键菜单 handler 拆分）
    - [ADR-060](../ADR-060-dnd-collector.md)（DnD 收集器立项）
    - [ADR-103](../ADR-103-ui-state-persistence.md)（uiState 持久化收口 SettingsStore）
    - [ADR-109](../ADR-109-audit-framework.md)（前端 3D Checklist）

---

## 1. 背景（Context）

`frontend/src/features/` 在 ADR-014 P3 类型化版落地后形成**"5 子域 + 9 根目录平铺文件"**的半城半郊状态；`dialogs/modal.ts` 演化为含 14 导出、659 行的上帝文件。

具体问题（2026-09-05 锐评实测）：

1. **目录语义失效**：18 文件（9 源码 + 9 测试）平铺在 `features/` 根，5 个子域与"流民"混杂；新功能无归位准则
2. **`modal.ts` 上帝文件**：659 行容纳 prompt/select/confirm/progress/picker 五种对话框 builder + `trapFocus` 焦点陷阱 + 生命周期 + 单例槽位 + 测试后门（`__resetModalStateForTest`）。改一个 picker 要通读全文
3. **`STATE` 模块级单例与 IDENTITY.md 路线分歧**：`download-queue-store.ts:55` 自建模块级单例 + subscribe/notify，未走 PageStore。需明确是有意设计还是临时退路
4. **类型双胞胎**：`dnd-collector.ts CollectedFile` 与 `dnd-shared.ts CollectedEntry` 结构完全相同（`{file, relPath}`），两个名字，重构时漏改一处即静默失配
5. **巨型测试**：`context-menus.test.ts` 1072 行 / 45KB、`download-queue.test.ts` 952 行 / 42KB，体积超过大多数源码

但同时**地基稳固**：`any` 零命中、断言密度 2.8% 弱断言、Go 红线守得住、DnD 分层（collector→shared）干净、ADR 溯源普遍。**整顿而非推倒**。

## 2. 决策（Decision）

### D1 目录归位

```
features/dnd/          ← dnd-shared.ts, dnd-collector.ts, pack-dnd.ts, import-dnd.ts（4 源 + 4 测试）
features/maintenance/  ← oldest-models.ts, recycle-bin.ts, version-updater.ts（3 源 + 3 测试）
features/import/       ← import-executor.ts（1 源 + 1 测试）
features/repo/         ← repo-rtype.ts（1 源 + 1 测试）
```

依据：DnD 三件套（collector → shared → 各 handler）天然成域；运维三件套共享"清理/更新/版本"主题；导入执行器与 DnD 域有边界（执行 vs 收集）；`repo-rtype` 是跨域原语，归独立子域但**单文件不再平铺**。

### D2 modal.ts 拆分

按"对话框类型 + 共享核心"二分：

| 文件 | 内容 |
|------|------|
| `dialogs/modal-core.ts` | `createDialog` / `trapFocus` / 单例槽位 / `__resetModalStateForTest` |
| `dialogs/modal-prompt.ts` | `promptBoxBuilder` + `modalPrompt` + `ModalPromptOptions` |
| `dialogs/modal-select.ts` | `selectBoxBuilder` + `modalSelect` + `ModalSelectOptions` |
| `dialogs/modal-confirm.ts` | `confirmBoxBuilder` + `modalConfirm` + `ModalConfirmOptions` |
| `dialogs/modal-progress.ts` | `progressBoxBuilder` + `modalProgress` + `ModalProgressHandle/Options` + `updateProgressFinite/Unknown/Handler` + `guardProgressClose` + `buildProgressDoms` |
| `dialogs/modal-picker.ts` | `pickerBoxBuilder` + `modalPicker` + `ModalPickerItem/Options/Result` + `collectFooter` + `safeHintColor` + `fmtMB` |

**Builder 内私有函数（如 `promptBoxBuilder`）保持内留**——外迁会让 builder 跨文件 ref 噪音大于复用收益；拆分后 builder 内私有函数自然成"该对话框自治的实现细节"。

测试同步拆为 6 个 `modal-*.test.ts`，原 603 行 `modal.test.ts` 收口。

### D3 STATE 单例路线

**固化现状**：下载队列全局唯一为有意设计，写进 ADR 注释。

- `download-queue-store.ts:55` 模块级单例是有意：UI 同一时刻只有一个下载队列面板，多实例语义不存在
- `__resetModalStateForTest` 同类模式保留（单例设计的固有代价）
- **不**引入 PageStore 适配层（避免双栈）
- 写明"如未来需要多实例（如多 panel 模式），优先走 PageStore 适配，不重写单例逻辑"

### D4 CollectedFile 双胞胎

**弃用 `CollectedFile`，统一用 `CollectedEntry`**：

- `dnd-collector.ts` 改 `export interface CollectedEntry`，删除 `CollectedFile`
- `dnd-shared.ts` 删除本地 `CollectedEntry` 定义，改为 `export type { CollectedEntry } from "./dnd-collector.ts"`
- `import-executor.ts:23` re-export 来源指向保持不变（已是 dnd-shared 间接指向）

### D5 巨型测试拆分

按 `describe` 主题切分：

| 源文件 | 行数 | 拆分目标 |
|--------|------|----------|
| `context-menus.test.ts` | 1072 | 3-4 文件，按 menu 类（instance / batch / file / dir）切 |
| `download-queue.test.ts` | 952 | 3 文件，按模块（store / progress / queue）切 |

**例外条款**：若拆分破坏单测独立性（如大量 mock 共享导致外提难），保留原状并在文件头标注「未拆分理由」。

## 3. 后果（Consequences）

### 正面

- 目录语义明确：6 子域（dnd / maintenance / import / repo / community / context-menu / dialogs / pack-ops / platform）各司其职
- `modal.ts` 单一职责，单文件最长预计 ≤ 200 行（picker 最大）
- 类型唯一名字 `CollectedEntry`，IDE 跳转无歧义
- 测试体积可控

### 负面 / 已知遗留

- **18 文件改路径** + 全部 import 修正（机械活，需构建验证）
- **modal.ts 5 处入口迁移**到 6 个 `modal-*.ts`（import 路径批量更新）
- `__resetModalStateForTest` 仍在生产代码（单例固有代价，保留并标注）
- `menu-defs.ts:6` 的 "2026-XX P1 扩展" 占位符**与本 ADR 无关**，不在清理范围
- 批量改名期间 git blame 断裂（接受代价）

### 拒绝项（明确不做的）

- ❌ 不起 re-export 中转站（依赖现代 IDE 符号跳转，强行加 barrel 反而拖慢构建）
- ❌ 不把 `STATE` 改造为 PageStore 适配（避免双栈，单例是有意设计）
- ❌ 不碰 `menu-defs.ts:6` 的 "2026-XX" 占位符（与本 ADR 主题无关）

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/src/features/` `find . -name "*.ts" \| wc -l` | 63 |
| `find . -name "*.ts" \| xargs wc` | 15792 行（源码 7504 / 测试 8288） |
| `grep -rn ": any\|as any" --include="*.ts"` | 0 命中 |
| `grep -rc "expect(" *.test.ts` | 1207 expect / 561 it |
| `grep -rc "toBeTruthy\|not.toThrow"` | 34 处弱断言（2.8%） |
| `wc -l dialogs/modal.ts` | 659 行 / 14 导出 |
| `wc -l context-menu/context-menus.test.ts` | 1072 行 / 45KB |
| `wc -l community/download-queue.test.ts` | 952 行 / 42KB |
| `grep -n "export const STATE" community/download-queue-store.ts` | L55 模块级单例 |
| `grep -rn "window\.go\b" --include="*.ts"` | 0 命中（Go 红线合规） |

---

<!-- 文件名: features-modal-ts.md → 实际文件 ADR-187-features-modal-ts.md -->