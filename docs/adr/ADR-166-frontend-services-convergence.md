# ADR-166：前端 services 层收敛：registry 搬迁 / recycle-bin / dedup 会话工厂 / path-cards

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/services/resource-registry.ts; frontend/src/views/app-content/diagnostics/dedup.ts(createDedupSession); frontend/src/views/app-content/settings/path-cards.ts; frontend/src/views/app-content/recycle-bin.ts; docs/knowledge/app_content_diagnostics.md; docs/knowledge/app_content_settings.md; docs/knowledge/resource-registry.md; docs/knowledge/go-dedup.md; ADR-044; ADR-119`

---

## 1. 背景（Context）

四项前端 services 层重构被提为一揽子工作，但诊断发现它们**并非相互独立**，而是以 `registry` 为枢纽的耦合簇：

- `registry.ts → services/resource-registry.ts` 是纯前端 services 层搬迁（零行为变更），但它是 **dedup 会话工厂** 与 **path-cards** 的直接 import 源：
  - `frontend/src/views/app-content/diagnostics/dedup.ts`（`createDedupSession` 会话工厂）读 `utils/resource/registry.ts` + Go 绑定（`docs/knowledge/app_content_diagnostics.md:112`）。
  - `frontend/src/views/app-content/settings/path-cards.ts` 用 `utils/resource/registry`（`docs/knowledge/app_content_settings.md:94`）。
- `recycle-bin` 为前端 UI 收敛：消费 Go `go/recycle` 绑定（`ListRecycleBin`/`RestoreFromRecycle`/`EmptyRecycleBin`，`docs/knowledge/context-menu.md:123`），**不触及 `go/fsutil`/`IsRecycleDir`**；与 `oldest-models.ts` 存在 `useCurrentResourceType` 重复实现（`docs/knowledge/extensibility-index.md:223`）。

既有痛点：`utils/resource/registry.ts` 路径漂移、recycle-bin / path-cards 各自重复 `useCurrentResourceType`、path-cards 主题 `|| "dark"` 非法默认值（`extensibility-index.md:337`）、recycle-bin 高交互路径零 e2e（`frontend_test_audit.md:94`）。

## 2. 决策（Decision）

**合并为单条 ADR 记录决策方向**，按依赖顺序推进（先枢纽后消费者），四项各自可独立验证：

1. **registry 搬迁（枢纽，先行）**：`utils/resource/registry.ts` → `frontend/src/services/resource-registry.ts`；纯重命名 + import 路径更新，零行为变更。所有消费者（dedup.ts / path-cards.ts / app-modules / app-tree / app-sidebar / preview-state / web-common）同步改 import。**触发知识卡锚漂移，须同步卡**（见 §3）。
2. **dedup 会话工厂（🔴 必走 CodeReview）**：重构 `createDedupSession` 闭包（busy/exec 重入守卫 + 去重配置）时，须守住两条红线：
   - 前端红线（`app_content_diagnostics.md:51/82`）：去重**必须经 diagnostics 页发起**，禁止其他页直接调 `doDedup`。
   - Go 契约（`ADR-119` P1）：`FindDuplicateFiles`/`CountDuplicates` 两公开函数共享单一实现、调用方零改动——前端只经绑定消费，**禁止在业务代码手写文件指纹比较**（`go-dedup.md:33`）。
3. **recycle-bin（🟡 自动闸门 + 轻量人审）**：UI 收敛，抽离与 `oldest-models.ts` 重复的 `useCurrentResourceType` 为共享 hook；仅经 `go/recycle` 绑定操作回收站，**不重实现 / 不搬迁 Go `recycle`/`fsutil.IsRecycleDir`**。补 e2e 优先级 P3（`frontend_test_audit.md:94`）。
4. **path-cards（🟡 自动闸门 + 轻量人审）**：跟随 registry 搬迁改 import；顺手修正主题 `|| "dark"` 为 `normalizeTheme` 兜底（`extensibility-index.md:337`），消除非法默认值静默归一。

**审核分级（收敛闭环默认覆盖，深度按性质缩放）**：registry 搬迁以 `typecheck`+`binding-check`+`doctor` 自动闸门为主；dedup 会话工厂必走 CodeReview 独立审查；recycle-bin / path-cards 自动闸门 + 轻量人审（UI 防御范式：代际守卫、focusVisible、trapFocus）。

## 3. 后果（Consequences）

**正面**：`registry` 路径统一到 `services/`；`useCurrentResourceType` 收敛去重；path-cards 主题默认值合法化；回收站 UI 与后端绑定契约清晰、不污染 Go 侧。

**负面**：registry 搬迁跨多文件（import 面放大），须一次性改全避免半截引用；recycle-bin 抽离 `useCurrentResourceType` 引入共享 hook 依赖，需回归 oldest-models 展示。

**已知遗留 / 必同步项**：
- **知识卡锚漂移（ADR-044 策略 C）**：以下卡锚在 registry 搬迁后会红，须同步而非只改码：
  - `docs/knowledge/app_content_diagnostics.md:112`（引用 `utils/resource/registry.ts`）
  - `docs/knowledge/app_content_settings.md:94`（引用 `utils/resource/registry`）
  - `docs/knowledge/resource-registry.md`（classify-routing.md:160，路径更新）
- path-cards 主题修复属 `extensibility-index.md:337` 已知项的一部分，修复后更新该卡状态。
- recycle-bin e2e 缺口（P3）可本轮补或单列，不阻塞搬迁。

## 4. 数据溯源

- registry 消费者实证（grep）：`app_content_diagnostics.md:112`、`app_content_settings.md:94`、`frontend/src/app-modules.boot.test.ts`、`views/app-tree/bus-handlers.ts`、`views/app-sidebar`、`preview-3d/state/preview-state.ts`、`backend/web-common.ts`
- dedup 红线：`docs/knowledge/app_content_diagnostics.md:51/82`；Go 契约 `ADR-119` P1 + `docs/knowledge/go-dedup.md:33`
- recycle-bin 绑定契约：`docs/knowledge/context-menu.md:123`；重复实现 `extensibility-index.md:223`；e2e 缺口 `frontend_test_audit.md:94`
- path-cards 主题漂移：`docs/knowledge/extensibility-index.md:337`、`app_content_settings.md:152`
- 治理基线：`AGENTS.md` 收敛闭环（子代理审核 → CodeReview → pre-commit 自动检测）；`ADR-044` 策略 C 机制锚核对；`ADR-109` 三份 Checklist

<!-- 文件名: frontend-services-convergence.md → 实际文件 ADR-166-frontend-services-convergence.md -->
