# ADR-116：前端 vs Go 职责红线：筛选/类型判定权威层归 Go

- **状态**：✅ 已采纳
- **日期**：2026-08-23
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`AGENTS.md 硬约束 / 前端 vs Go 职责红线 / preview-core.md`

---

## 1. 背景（Context）

近期 git log 热点回归显示：前端在 `frontend/src/utils/3d/adapters/preview-menu.ts` 多轮修复 tab 去重/类型误判/整段重建（`getPreviewableTypeTabs` 去重消除 vrm 重复 tab、`同源 YSM 替换误走 switchExternal`、`resourcepack 标 preview='3d' 纳入 3D 切换面板派生`），而 Go 扫描层 `internal/app/app_scan.go` 仅 2 次改动且逻辑稳定。

根因：AI 未从 `AGENTS.md` 拿到"筛选/类型判定归 Go"的硬指示，在前端手搓本属 Go 的筛选与类型判定逻辑，造成职责上移（前端代劳后端）。这与"禁止直调 window.go"红线精神一致，但原文档未把"前端只消费 Go 已筛数据"写死，留下信息缺口。

## 2. 决策（Decision）

确立**前端 vs Go 职责红线**（已同步写入 `AGENTS.md`「前端 vs Go 职责红线」段），四条不可违反：

1. **类型判定唯一事实源** = `resource_types.json` + Go（`internal/app/`）。tab 列表、preview/3d/resourcepack 归类由 Go 扫描结果 + 该 JSON 派生，前端只读不判。
2. **筛选/去重/聚合归 Go**：前端一律消费 Go 返回的已筛/已归类数据，禁止本地 `filter()` 重筛、手搓去重、重聚合。
3. **跨类型切换只走 `switchExternal`**（同源替换走 `switchTo`），禁整段重建。
4. **禁止直调 `window.go`**：经 Wails 桥消费 Go 数据（既有红线）。

子代理协作框架同步收敛：跨层（TS↔Go）职责改动须主模型拍板，删除"范围是建议不是禁令/不设坎不打回"的放任表述。

## 3. 后果（Consequences）

- **正面**：前端越权代劳后端筛选的回归将失去文档借口；新 AI 一进 `AGENTS.md` 即读到硬红线。
- **正面**：Go 端 `internal/app/` 成为筛选/聚合唯一权威层，与 Wails 桥契约一致。
- **负面**：既有前端手搓筛选逻辑（如 `preview-menu.ts` 内的去重/判定）需逐步回流 Go——属技术债清理，非阻塞。
- **已知遗留**：需后续审计 `frontend/src/utils/3d/adapters/preview-menu.ts` 与 `resource/types.ts`，确认是否存在仍可上移至 Go 的前端筛选/判定代码。

## 4. 数据溯源

来源 → 结果：

- 子代理反向审计 `AGENTS.md`（结合 git log 热点：`preview-menu.ts` 5 次、`app_scan.go` 2 次、`types.ts` 2 次）→ 定位信息缺口 = 缺"前端 vs Go 职责红线"。
- `AGENTS.md` 补「前端 vs Go 职责红线」段 + 扩写 wails-bridge 红线行 + 场景路由表 3D 预览行补来源 + 子代理协作框架收敛跨层拍板。
- 本 ADR-116 占号闭环，状态 ✅ 已采纳。

<!-- 文件名: frontend-go-boundary.md → 实际文件 ADR-116-frontend-go-boundary.md -->
