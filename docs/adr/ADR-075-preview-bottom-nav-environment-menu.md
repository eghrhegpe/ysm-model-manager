# ADR-075：3D 预览环境控件收进环境菜单契约

- **状态**：✅ 已采纳
- **被补充**：[ADR-106](./ADR-106-preview-env-menu-drill-visual.md) 在本 ADR 的环境菜单外壳之上，扩展两级下钻、分组折叠、跨 cap 预设联动、4 种可视化控件类型（image/color/timeline/histogram）、水面湿润表面模式、环境亮度直方图
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：`ADR-073、ADR-066`、`frontend/src/preview-3d/adapters/mount-preview-core.ts`、`frontend/src/ui/ui-slide-menu.ts`、`frontend/src/ui/ui-header-toggle.ts`

---

## 1. 背景（Context）

统一预览核心 `mount-preview-core.ts`（ADR-066）的 shared 模式在顶栏（topBar）直接堆入了程序化天空的环境控件：时间-of-day 滑块、云量滑块（ADR-073 L1 #1/#4）。问题：

- 顶栏被「关闭 / 模型切换 / 相机旋转 / 相机速度 / 重置视角 / 时间 / 云量」挤满，用户评之为「塞垃圾」，遮挡且难用。
- 时间滑块标签直接用 `t("preview.timeOfDay")`，i18n 键未入库时 `t()` 返回原始键名（ADR-073 #1 教训），顶栏显示 `preview.timeOfDay:` 原始键。
- 环境类控件本应按「设置 / 菜单」分组，而非散落顶栏。

同期并行工作已落地 `createSlideMenu` 滑出面板（地面开关 `GroundCapability`），注释明确「天空滑块（时间/云量）后续收拢」——即环境菜单是既定落点。

## 2. 决策（Decision）

环境类控件统一收进 **🌍 环境菜单滑出面板**（复用并行工作的 `createSlideMenu` + `ui-slide-menu-styles` 基础设施），顶栏仅保留一个 🌍 环境按钮（`data-testid="env-menu-btn"`）。

- 菜单内含四项：`地面`开关（既有）、`时间`滑块（0–24h，联动太阳方位/高度）、`云量`滑块（0–1，联动天空与 IBL）、`环境光(IBL)`开关（复用 `createHeaderToggle`，对齐地面行）。
- 视觉对齐：菜单项统一 `slide-item` + `slide-label` class，滑块 `accent-color:var(--accent,#7c83ff)`。
- i18n 兜底：菜单内所有标签经 `tr(key, fallback)` 取值，键缺失时回退中文，杜绝原始键名暴露（修复 #1 痛点）。

## 3. 后果（Consequences）

- **正面**：顶栏清爽，环境控件归组；四种模型（YSM/VRM/MMD/Litematic）因共享同一 `ctx.scene` 与环境菜单零改动继承；与既有地面开关同源，维护一致。
- **负面 / 已知遗留**：
  - 环境菜单在 `if(!selfMode)` **之前**构建，此时 `skyCap`/`groundCap` 尚未赋值（仍为 `null`）。直接 `skyCap?.getX()` 取初始值会触发 TS 收窄 `null → never` 报错（`Property 'getX' does not exist on type 'never'`）。**约定口径**：初始值用字面量默认值（时间=9、IBL=true），交互处理器写在 `oninput`/`onChange` **闭包**内用 `skyCap?.`（闭包取声明类型 `SkyCapability | null`，安全）。
  - self 模式（适配器自驱 renderer）下 `skyCap` 永不创建，天空三项为 no-op（与地面行同口径，一致性优先于功能可用性）。
- 三语键 `preview.environment/timeOfDay/cloudCoverage/environmentLight` 已入库（zh-CN/en/ja），`tr` 兜底仅作并发竞争防线。

## 4. 数据溯源

- 来源：用户反馈「为啥往顶栏塞垃圾，扔根菜单吧，设置环境菜单-」+ 截图证明顶栏滑块堆叠与原始键名暴露 → 结果：环境控件重构为 🌍 环境菜单（ADR-075），顶栏滑块移除，i18n 走 `tr` 兜底。
- `SkyCapability` 新增 `isEnvironmentEnabled()` getter（供 IBL 开关读取初始勾选态）。

<!-- 文件名: preview-bottom-nav-environment-menu.md → 实际文件 ADR-075-preview-bottom-nav-environment-menu.md -->
