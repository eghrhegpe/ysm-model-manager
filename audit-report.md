# YSM 用户指南 vs 前端实际功能 审计报告

## 抽样覆盖

共抽查 21 篇指南（占 30 篇的 70%），分布如下：

| 类别 | 抽查篇数 | 抽查文件 |
|------|---------|---------|
| 核心功能类 | 7 | import-model, import-queue, download-queue, tags, batch-rename, model-dedup, recycle-bin, advanced-filter |
| 3D/预览类 | 3 | 3d-preview, blueprint-preview, bone-tools-architecture |
| 同步/维护类 | 4 | pack-sync, backup-migration, repo-health, diagnostics |
| 设置类 | 3 | settings, themes, keyboard-shortcuts |
| 导航/上手类 | 4 | repository, workshop, faq, first-setup |

### 未抽查但重要的指南（建议后续抽查）
- `oldest-models.md` — 仓库元老页（与 repo-health 关联紧密，未独立抽查）
- `update.md` — 版本更新（含自动检查/手动检查/下载逻辑）
- `resource-packs.md` — 资源包管理（与 pack-sync 重叠但未独立抽查）
- `install.md` — 安装说明（与 first-setup 部分重叠）
- `creators.md` — 创作者频道（workshop 关联但未独立抽查）
- `index.md` — 项目入口（导航文档）

---

## 文档与功能脱节清单

### 🔴 D1. 「📥 导入」tab 已移除，但两篇指南仍作为核心入口描述

**指南路径**：
- `docs/guide/import-queue.md`（全文核心）
- `docs/guide/import-model.md`（打开方式第 2 项、FAQ 最后一问）

**脱节类型**：功能不存在

**文档声明**：
- `import-queue.md` 第 11 行：「📥 导入」tab 是批量导入的工作台
- `import-queue.md` 第 15 行：「📚 模型仓库」→「📥 导入」tab（拖入 YSM 文件时程序会自动切到这里）
- `import-queue.md` 第 63 行：切出再切回「📥 导入」tab 或重启程序
- `import-model.md` 第 18 行：导入 tab：仓库页「📥 导入」tab 的拖拽区
- `import-model.md` 第 64 行：通过「📥 导入」tab 拖拽区拖入的文件夹会保留相对子目录

**实际情况**：
- `frontend/src/views/app-content/tpl.ts` 第 24-63 行：repositoryHTML() 只渲染 4 个 tab：`tree`（📁 文件树）、`recycle`（♻️ 回收站）、`dedup`（🔗 去重）、`oldest`（👴 资历最深）。**无 import tab**。
- `frontend/src/features/import/executor.ts` 第 2 行注释明确写：「导入 tab 删除后，拖拽/选择文件直接走本模块全局执行，不依赖任何 UI 挂载」
- `frontend/src/views/app-content/tpl.test.ts` 第 52 行测试注释：「文件树 tab 保留（导入 tab 已从模板中移除）」

**严重程度**：🔴 高 — 文档描述的核心功能完全不存在，用户照做找不到入口。

---

### 🔴 D2. repository.md 声称「五个 tab」，实际只有四个

**指南路径**：`docs/guide/repository.md`

**脱节类型**：描述与实现不符

**文档声明**（第 15 行）：页面顶部有五个 tab：📁 文件树、📥 导入、♻️ 回收站、🔗 去重、👴 资历最深

**实际情况**：见 D1，代码只渲染 4 个 tab（无「📥 导入」）。

**严重程度**：🔴 高 — 与 D1 同一根因。

---

### 🔴 D3. 「骨骼结构」批量导出功能描述存在，但代码完全未实现

**指南路径**：
- `docs/guide/3d-preview.md`（第 40 行、第 46-48 行）
- `docs/guide/repository.md`（第 81 行）

**脱节类型**：功能不存在

**文档声明**：
- `3d-preview.md` 第 40 行：🦴 骨骼面板（含「批量导出全部骨骼」→ `bone-structures-日期.txt`）
- `3d-preview.md` 第 48 行：在文件树中多选模型后，点击「⋮ 更多 ▾ → 骨骼结构」，所有选中模型的骨骼结构会汇总到 `bone-structures-日期.txt`
- `repository.md` 第 81 行：骨骼结构：批量导出整个仓库的骨骼结构报告（`bone-structures-日期.txt`）

**实际情况**：
- `grep -r "bone-struct|骨骼结构|batchExportBones|BoneReport" frontend/src` 无匹配（仅命中 `batchExport` 泛词与单模型 `exportBoneNames`）。
- `views/app-tree/tpl.ts` 第 44 行「⋮ 更多 ▾」下拉菜单实际项：`import-file`、`import-dir`、`open-folder`、`refresh`、`genindex`。**无 `bone-struct` 项**。
- 单模型的「📋 导出骨骼名」按钮确实存在（`views/app-preview/skeleton-render.ts:201-233`），导出 `<模型名>_bones.txt`，与文档描述一致。但**批量导出整个仓库/选中模型的骨骼结构报告**功能不存在。

**严重程度**：🔴 高 — 文档描述的功能完全不存在，用户照做找不到按钮。

---

### 🟡 D4. 「⋮ 更多 ▾」菜单项列表与文档不符

**指南路径**：`docs/guide/repository.md`（第 77-83 行）

**脱节类型**：描述与实现不符

**文档声明**（第 77-83 行）：
> 工具栏「⋮ 更多 ▾」
> - 导入文件 / 📁 导入文件夹
> - ☑️ 全选
> - 骨骼结构：批量导出整个仓库的骨骼结构报告
> - 📂 打开文件夹 / 🔄 刷新
> - 📇 生成索引

**实际情况**（`views/app-tree/tpl.ts:44`）：
- 📄 导入文件
- 📁 导入文件夹
- 📂 打开文件夹
- 🔄 刷新
- 📇 生成索引

**差异**：
1. 文档列出「☑️ 全选」在「⋮ 更多 ▾」菜单内，但代码中「☑️ 全选」是工具栏独立按钮（`sel-all`，`tpl.ts:43`），不在 dropdown 里。
2. 文档列出「骨骼结构」，代码中无此菜单项（见 D3）。

**严重程度**：🟡 中 — 用户可能找不到「全选」在 dropdown 里，或找不到「骨骼结构」。

---

### 🟡 D5. 「生成索引」文档声称同时生成 GitHub Actions 工作流，代码只下载 index.json

**指南路径**：`docs/guide/repository.md`（第 83 行、第 97 行）

**脱节类型**：描述与实现不符

**文档声明**（第 83 行）：📇 生成索引：扫描仓库生成 `index.json`（供创意工坊在线浏览），同时自动生成 GitHub Actions 工作流

**实际情况**（`views/app-tree/toolbar-events.ts:292-332`）：
- 调用 `GenerateRepoIndex(filesRoot)` 获取 JSON 内容
- 仅创建 Blob 下载 `index.json` 文件
- 无任何 GitHub Actions workflow 文件（`.github/workflows/*.yml`）生成逻辑
- `grep -r "GitHub Actions|workflow.yaml|workflow.yml|生成.*workflow|生成.*Actions" frontend/src` 无匹配

**严重程度**：🟡 中 — 用户期望「同时自动生成 GitHub Actions 工作流」，但实际只下载 index.json。

---

### 🟡 D6. import-model.md 描述「全局拖拽单次文件数 50」限制，代码未找到对应常量

**指南路径**：`docs/guide/import-model.md`（第 39 行）

**脱节类型**：参数不存在

**文档声明**（第 39 行）：全局拖拽单次文件数 | 50 | 超出提示「⚠️ 单次导入文件过多（N 个），请分批处理」

**实际情况**：
- `grep -r "单次导入|50.*文件|MAX_BATCH|超过.*50" frontend/src` 无匹配
- `features/dnd/import-dnd.ts` 仅有单文件大小过滤（`MAX_IMPORT_BYTES = 100MB`），无文件数量限制
- 未找到「单次导入文件过多」相关 i18n key

**严重程度**：🟡 中 — 文档描述的数量限制可能已移除或不存在。

---

### 🟢 D7. keyboard-shortcuts.md 中 Delete 键确认框文案与代码一致

**指南路径**：`docs/guide/keyboard-shortcuts.md`（第 22 行）

**脱节类型**：无脱节（验证通过）

**文档声明**：「确定要删除选中的 N 个文件吗？」

**实际情况**：`locales/zh-CN.ts:1485` `tree.batchDeleteConfirm`: "确定要删除选中的 {n} 个文件吗？"；`app-tree/index.ts:493-505` 调用 `modalConfirm` 显示此文案。

**严重程度**：🟢 低 — 文档与实现一致。

---

### 🟢 D8. blueprint-preview.md 分层查看与代码一致

**指南路径**：`docs/guide/blueprint-preview.md`（第 36-37 行）

**脱节类型**：无脱节（验证通过）

**文档声明**：分层查看：沿 Y / X / Z 轴选择「全部」「单层」或指定范围

**实际情况**：`preview-3d/adapters/litematic-adapter.ts:329-359` 分层切片面板含：
- `slice-axis`：分层轴（X/Y/Z 三选）
- `slice-mode`：模式（全部/单层/范围 三选）
- `slice-layer`：单层滑块

**严重程度**：🟢 低 — 文档与实现一致。

---

### 🟢 D9. 高级筛选弹窗与代码一致

**指南路径**：`docs/guide/advanced-filter.md`

**脱节类型**：无脱节（验证通过）

**文档声明**：关键字（最多 100 字符）、骨骼数范围、立方体范围、纹理尺寸范围、标签（30 字符）、已有标签异步提示、🧹 清除全部、取消 (Esc)、🔍 应用 (Enter)

**实际情况**：`features/dialogs/adv-filter.ts:53-105` 弹窗含所有字段、`maxlength=100`（关键字）、`maxlength=30`（标签）、已有标签提示（`AllTags()` 异步加载）、三个按钮（清除/取消/应用）。

**严重程度**：🟢 低 — 文档与实现一致。

---

### 🟢 D10. pack-sync 六状态筛选与代码一致

**指南路径**：`docs/guide/pack-sync.md`（第 27-38 行）

**脱节类型**：无脱节（验证通过）

**文档声明**：六个筛选标签：📊 全部、✅ 已同步、⬇️ 待推送、⛔ 已禁用、📤 可拉取、🔗 旧仓库遗留

**实际情况**：`views/app-sync-manager/renderer.ts:80-87` 六个标签完全对应；`locales/zh-CN.ts:715-720` 六个状态 i18n key 齐全。

**严重程度**：🟢 低 — 文档与实现一致。

---

### 🟢 D11. batch-rename 五个预设与代码一致

**指南路径**：`docs/guide/batch-rename.md`

**脱节类型**：无脱节（验证通过）

**文档声明**：5 个预设：❌ 去除年份、❌ 去除版本 -v2、【】→ [] 括号、📛 拍平为 作者-作品、🔗 空格 → 下划线

**实际情况**：`views/app-tree/tpl-batch-rename.ts:44-48` 五个预设 chip 完全对应，正则规则匹配文档描述。

**严重程度**：🟢 低 — 文档与实现一致。

---

### 🟢 D12. recycle-bin 功能与代码一致

**指南路径**：`docs/guide/recycle-bin.md`

**脱节类型**：无脱节（验证通过）

**文档声明**：♻️ 清空回收站、↩️ 恢复、🗑️ 删除、硬链接/符号链接安全策略、Delete 键硬删除不进回收站

**实际情况**：`locales/zh-CN.ts:436-442` 回收站清空/恢复/删除文案齐全；`features/maintenance/recycle-bin.integration.test.ts` 覆盖完整功能；Delete 键走 `DeleteResourcePack`（硬删除）而非 `MoveToRecycle`。

**严重程度**：🟢 低 — 文档与实现一致。

---

### 🟢 D13. tags 20 字符限制与代码一致

**指南路径**：`docs/guide/tags.md`

**脱节类型**：无脱节（验证通过）

**文档声明**：单个标签最多 20 个字符，输入框硬上限 30 字符

**实际情况**：`features/dialogs/tag-set.ts:12` `MAX_TAG_LENGTH = 20`；`features/dialogs/adv-filter.ts:92` 高级筛选标签输入框 `maxlength="30"`。

**严重程度**：🟢 低 — 文档与实现一致。

---

## 诡异功能 + 诡异实现清单

### 🟡 W1. Delete 键是硬删除，不进回收站

**指南路径**：
- `docs/guide/keyboard-shortcuts.md`（第 22 行）
- `docs/guide/repository.md`（第 69 行）
- `docs/guide/recycle-bin.md`（第 49 行）

**功能描述**：文档在三处警告 Delete 键是硬删除，不进回收站，需右键「♻️ 移入回收站」才有恢复途径。

**代码实现**：
- `views/app-tree/index.ts:467-505` `_onKeyDelete()`：Delete 键调用 `DeleteResourcePack`（硬删除），不经过 `MoveToRecycle`
- 右键菜单走 `ctx.moveToRecycle` 路径

**诡异度评估**：中等。同一「删除」操作有两种完全不同的语义（Delete 键 = 硬删除，右键 = 回收站），且文档需要在三处反复警告用户。这是设计债务——用户教育成本高，容易误删。合理的做法是统一 Delete 键行为（要么都进回收站，要么都硬删除），或至少在 Delete 确认框里明确标注「此操作不可恢复」。

---

### 🟡 W2. 「📥 导入」tab 被移除但指南未同步更新

**指南路径**：`import-queue.md`、`import-model.md`

**功能描述**：文档将「📥 导入」tab 描述为批量导入的核心工作台，包括拖拽区、命名表单、队列锁、覆盖确认等完整交互流程。

**代码实现**：
- `executor.ts:2` 注释：「导入 tab 删除后，拖拽/选择文件直接走本模块全局执行」
- `tpl.test.ts:52` 注释：「导入 tab 已从模板中移除」
- 导入功能现走全局拖拽 + 文件选择器，无独立 tab

**诡异度评估**：高。这是典型的「代码已重构但文档未跟进」的教育债务。用户照文档操作会找不到 tab，需要重新学习新的导入流程（全局拖拽）。建议更新两篇指南，或将功能恢复。

---

### 🟢 W3. 「☑️ 全选」在工具栏而非 dropdown 菜单

**指南路径**：`repository.md`（第 80 行）

**功能描述**：文档将「☑️ 全选」列为「⋮ 更多 ▾」菜单项。

**代码实现**：`tpl.ts:43` 全选是工具栏独立按钮（`sel-all`），与「⋮ 更多 ▾」按钮并列，不在 dropdown 内。

**诡异度评估**：低。布局差异不影响功能，用户能找到按钮，只是位置与文档描述不同。

---

### 🟢 W4. 生成索引只下载 index.json，不生成 GitHub Actions workflow

**指南路径**：`repository.md`（第 83 行）

**功能描述**：文档声称生成索引会「同时自动生成 GitHub Actions 工作流」。

**代码实现**：`toolbar-events.ts:292-332` 只调用 `GenerateRepoIndex` 获取 JSON 内容并下载，无任何 workflow 文件生成。

**诡异度评估**：低。可能是文档写了「计划中的功能」但代码未实现，或曾经有但被移除了。用户按文档操作只会得到 index.json 下载，不会得到 workflow 文件。

---

## 抽样未覆盖的重要指南

以下指南在本次审计中未独立抽查，但根据代码交叉引用与内容关联性，建议后续优先抽查：

1. **`oldest-models.md`** — 仓库元老页。与 `repo-health.md` 关联紧密（repo-health 实际在 oldest-models tab 内），未独立抽查可能遗漏页面级细节。
2. **`update.md`** — 版本更新。涉及自动检查/手动检查/下载/静默更新等复杂逻辑，与 settings.md 的「检查更新」按钮关联。
3. **`resource-packs.md`** — 资源包管理。与 `pack-sync.md` 有重叠但可能有独立的资源包操作（如 pack.png 预览、材质列表等）。
4. **`install.md`** — 安装说明。与 `first-setup.md` 部分重叠，可能有差异化的安装流程描述。
5. **`creators.md`** — 创作者频道。与 `workshop.md` 关联但未独立抽查，可能有创作者卡片交互细节。
6. **`diagnostics.md`** — 诊断与冲突。与 `model-dedup.md`、`repo-health.md` 有关联（健康度数据源），未独立抽查可能遗漏冲突检测逻辑。

---

## 总结

- **脱节数量**：6 项（🔴 高 3 项，🟡 中 3 项，🟢 低 0 项）
- **诡异项数量**：4 项（🟡 中 2 项，🟢 低 2 项）
- **用户指南整体可信度**：**中**

核心功能类指南中，`import-queue.md` 和 `import-model.md` 因「📥 导入 tab 已移除」存在严重的文档-功能脱节，用户照做会找不到入口。`3d-preview.md` 和 `repository.md` 中的「骨骼结构批量导出」功能完全不存在，属于文档描述了不存在的功能。其余抽查的指南（tags、batch-rename、recycle-bin、advanced-filter、pack-sync、blueprint-preview、keyboard-shortcuts 等）与代码实现基本一致，可信度较高。

**建议优先修复**：
1. 更新 `import-queue.md` 和 `import-model.md`，移除「📥 导入 tab」描述，改为描述全局拖拽流程
2. 更新 `repository.md`，修正 tab 数量、菜单项列表、生成索引功能描述
3. 移除 `3d-preview.md` 和 `repository.md` 中的「骨骼结构批量导出」描述，或实现该功能
4. 考虑统一 Delete 键行为（W1），降低用户教育成本
