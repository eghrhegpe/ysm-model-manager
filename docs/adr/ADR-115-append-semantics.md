# ADR-115：跨类型同台追加必须走 switchExternal 主门路由（➕ 三态行为契约见知识卡）

- **状态**：✅ 已采纳
- **日期**：2026-08-23
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-093 T4-b 多模型同台追加、preview-menu ➕ 按钮`；「➕ 三态行为」契约见 `docs/knowledge/preview-core.md`

---

## 1. 背景（Context）

「➕ 追加」的跨类型语义在提交间反复横跳（`f86129bf` 移除类型守卫 → `933c8839` 恢复守卫 → `14fcb0ac` 走对函数）。根因：`switchToSession`（switch-preview.ts:87）**无类型 dispatch**——keepInScene 追加直接用当前会话 `adapter.build`，跨类型文件（.vrm/.pmx 喂给 ysm/mmd adapter）解析失败必崩。「跨类型能否 keepInScene」决策点反复摇摆，是这条功能线折腾多轮的根因。

## 2. 决策（Decision）

**红线（本 ADR 唯一约束）**：跨类型追加必须走 `switchExternal(p, siblings, { keepInScene: true })` 主门路由（→ `openModel3DFullscreen({ cooperate })` → 有活跃会话时 `switchPreview(path, { keepInScene: true })` 按目标 rtype 路由到对应 opener 同台追加），**禁止把跨类型文件直接喂给当前会话 `adapter.build`**（走错适配器解析失败）。

「➕ 三态行为」契约（同类型候选 → `switchTo` keepInScene / 跨类型候选 → `switchExternal` keepInScene / 行本体点击跨类型 → `switchExternal` 替换）已迁至 `docs/knowledge/preview-core.md`——行为细节不再入 ADR，避免治理膨胀（ADR 只留决策红线）。

## 3. 后果（Consequences）

- **正面**：红线单一明确，行为细节在知识卡随代码演进（`check-knowledge-drift` 把关）
- **负面**：跨类型 ➕ 依赖 switchPreview 主门有对应 rtype 的 opener；未注册类型直接 toast 提示（不回退 YSM opener——YSM opener 无法加载非 YSM 文件，回退只产生误导）
- **已知遗留**：cooperate 追加的按类型解析依赖 opener 注册表完备（ADR-111 收口后类型 tab 从 resource_types.json 派生，opener 注册表与其保持单源）

## 4. 数据溯源

- 链路：preview-menu.ts:1069-1088（➕ 显示与点击分支）→ preview-library.ts:119（switchExternal）→ preview-library.ts:59-61（cooperate → switchPreview keepInScene）→ switch-preview.ts:87（switchToSession，keep=true 跳过移除/dispose、MAX_MODELS=8 拦截）
- 提交记录：`git log -S switchExternal`——f86129bf（移除守卫）→ 933c8839（恢复守卫）→ 14fcb0ac（走对函数）→ 本 ADR 定稿红线

<!-- 文件名: append-semantics.md → 实际文件 ADR-115-append-semantics.md -->
