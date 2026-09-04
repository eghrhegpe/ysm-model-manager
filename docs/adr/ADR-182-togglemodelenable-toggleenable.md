# ADR-182：ToggleModelEnable 合并到 ToggleEnable

- **状态**：🧊 已废弃（deferred）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/app_files.go:337/354`、`frontend/src/views/app-tree/events.ts:70/91/448`、`frontend/src/core/handlers/sync.ts:175`、`go/cli/fileops.go:102`、[go_design_critique](../knowledge/go_design_critique.md)

---

## 1. 背景（Context）

快照锐评点名 `SyncModelToggleStatus vs ToggleModelEnable 双轨命名`，三路锐评核实实际为三轨：

| 函数 | 位置 | 语义 | 桌面 UI 消费 |
|------|------|------|-------------|
| `ToggleModelEnable` | `app_files.go:337` | 单根 ysmRoot，fileops 薄壳 | ❌ 零 |
| `ToggleEnable` | `app_files.go:354` | 多根（FilesRoot+McRoot+ysmRoot+CustomRoots）路径包含判定 | ✅ 3 处 |
| `SyncModelToggleStatus` | `app_install_instance.go:232` | 批量同步实例↔仓库启禁（ysmsync 独立通道） | ✅ 1 处（整合包同步专用） |

桌面 UI 唯一入口是 `ToggleEnable`，`ToggleModelEnable` 仅 CLI / browser-adapter 契约保留。`// Deprecated` 注释已于本轮添加（commit `6d857430`）。

## 2. 决策（Decision）

**标记技术债，暂缓合并**。理由：

1. 合并需改 15+ 处文件（CLI 2 处 + browser-adapter 1 处 + 测试 6+ 处 + 生成物 re-gen），工作量约 1-2 小时
2. Wails 绑定面缩减是破坏性变更（app.ts 减少一个导出），需 ADR 级评估是否值得为"消除双命名"付契约破坏代价
3. 当前 `ToggleModelEnable` 桌面零消费 → 双命名不产生用户可见 bug，仅认知负担
4. 替代方案（已做）：加 `// Deprecated` 注释过渡，binding-check 通过

## 3. 后果（Consequences）

| 正面 | 负面 |
|------|------|
| 不破坏现有 CLI / browser-adapter 契约 | `ToggleModelEnable` 永久保留在 binding 面，未来新开发者可能误用 |
| Deprecated 注释降低认知负担 | — |
| 未来独立 PR 处理时可一次性评估全量影响 | — |

## 4. 数据溯源

- 锐评报告：视角C 2026-09-05 三路串行锐评
- 前端消费面：`frontend/src/views/app-tree/events.ts:70/91/448`（ToggleEnable）/ `core/handlers/sync.ts:175`（SyncModelToggleStatus）
- CLI 消费：`go/cli/fileops.go:102`
- browser-adapter：`frontend/src/backend/web-store.ts:277`
- binding-check：无废弃白名单机制（`scripts/binding-check.ts:32-35`）

---

*ADR 只记决策方向和理由，不记实施进度。实施进度见知识卡 [go_design_critique](../knowledge/go_design_critique.md) 动刀进度。*
