# ADR-034-d1：创作者频道视图片段单源：抽共用渲染片段而非合并两视图

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-034
- **相关**：`frontend/src/views/app-content/site/render.ts / frontend/src/views/app-content/site/events.ts`

---

## 背景（一句）

ADR-034 方向① 把 `site/` 视图按职责拆成 render / events / edit / drag 四块，但拆的是**文件**、不是**同一视图模型的重复标记**：创作者卡片（`render.ts|createCrCard`，模板字面量）与详情浮层（`events.ts|cmCrBuildDetailHtml`，`+` 字符串接龙）各写一份头像、星标、身份 tag、平台徽章——口径已经漂了（2026-10-13 实证：平台徽章的站点图标只在浮层有、卡片没有，而 `docs/guide/creators.md` 与 CSS 基类 `.cr-platform-badge` 都按"图标+文字"承诺卡片该有）。

## 决策（三行）

1. 抽**片段级**单源渲染器（头像块 / 星标按钮 / 身份 tag chip / 平台徽章）供两视图共同调用，视图层只负责组合与差异（尺寸 class、是否含操作区）。
2. **不合并两个视图**：卡片是网格项、浮层是 `role=dialog` 模态，DOM 结构与 a11y 语义不同；合并等于让二者共享布局耦合，收益不抵代价。
3. 浮层 HTML 一并从 `+` 接龙改模板字面量，与 views 层 `tpl*.ts` / `render.ts` 同口径（「结构在代码、内容经 `esc()`」红线不变）。

## 后果（一句）

片段的展示口径改一处两视图同步，杜绝"修一处漏一处"式漂移；回退方式 = 恢复两处各自拼装（纯前端渲染，无数据格式 / 绑定接口变更）。

<!-- 文件名: creator-view-fragments.md → 实际文件 decisions/ADR-034-d1-creator-view-fragments.md（ADR-320 decisions 轻量模板） -->
