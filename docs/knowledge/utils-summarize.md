---
kind: utils-summarize
name: 摘要生成 summarize
tier: leaf
category: utils
source_files:
  - frontend/src/utils/format/summarize.ts
use_when:
  - 模型详情
  - 摘要卡片
  - summaryCardHTML
  - 预览卡片
  - 加密模型
  - 作者信息
  - 动画分组
  - 免费付费
invariant_anchors:
  - frontend/src/utils/format/summarize.ts|summaryCardHTML
  - frontend/src/utils/format/summarize.ts|summarizeDecoded
---

# 摘要生成 summarize

## 概览

把 Go 端解析出的模型摘要（YsmSummary）与头部信息（YSMHeader）渲染为预览面板的「模型详情」卡片 HTML。

## 核心职责

- 完整摘要卡片渲染（名称/tips/许可/缩放/动画分组/配置项/链接；**作者/纹理尺寸/资源行已移统计卡或删除**）
- 加密/闭源模型的头部简约卡片（无 summary 仅有 header 时，header-only 作者/作品分行保留）
- 头部无名称时回退文件名解析（parseModelName 补作者/作品/角色，仅 header-only 卡）

## 对外 API / 入口

- 导出类型：`YsmSummary`（name/source/tips/license/authors/stats/preview/animGroups/configMenus/links）、`YSMHeader`（isYsm/name/tips/license/hasFree/isFree/authorName/authorBilibili/authorRole/linkHome/linkUpdate/hash/format/crypto）、`SummaryAuthor`、`SummaryAnimGroup`、`SummaryConfigMenu` — 与 go/ysm + go/types 结构体对齐的轻量类型
- `summaryCardHTML(summary, header, basename?): string` — 主入口：双空 → 空态引导卡（「点击左侧仓库文件查看详情」）；无 summary 且 header.isYsm → 头部简约卡（🔒 加密提示 + 格式/加密版本号）；否则 → 完整卡片（🆓 免费 / 🔒 付费徽章由 hasFree/isFree 驱动）。**方案 A 去重（2026-08-28）**：完整卡片不再渲染作者行（含文件名 `[作者]` 回退）与纹理尺寸行——作者（头像+角色）与纹理由统计卡 `buildStatsCard`（skeleton-render.ts）统一承载并挂详情卡底部 `#preview-stats`，摘要卡保留唯一性，消除信息重复。**资源行删除（2026-08-28）**：「📦 贴图/模型/动画」行整体移除——贴图/模型计数（Go `extractFileStats` 只数 `files.player.*` 清单条目）与统计卡实际文件数（WASM `summarizeDecoded` 数 `textures/` 路径 + `.png`）口径不一致且重叠；动画计数并入动画分组标题（`🎬 ${name}（${items.length}）`，如「其他动画（7）」）。**顶部标题去重（2026-08-28）**：`model-detail-title`（📄 模型详情）两处（header-only 卡 + 完整卡）移除——外层 tab 已表达「📄 详情」层级，卡内不再重复标题；统计卡 `pv-card-title` 的「📊 模型概览」文字同步移除（badge 保留，`ysm-badge` 存在时渲染 `<div class="pv-card-title">${badge}</div>`）
- 内部渲染助手：renderTips（§ 着色）、cleanText（剥离 § 码与控制字符）；**`safeUrl`（2026-08-28 起导出**，供统计卡作者 bilibili 链接复用；仅放行 http/https，javascript:/data: 等替换为 "#"）

## 与其他子系统关系

- 唯一消费方：`app-preview/preview-detail.ts`（预览面板详情区）
- 依赖 `utils/display.ts`（parseModelName 回退）、`utils/mc-format.ts`（renderFormattedText 着色）、`utils/dom/html.ts`（esc）
- 上游数据来自 Go 端模型分析 binding（summary/header），解析链路见 [go_ysm_parser](./go-ysm-parser.md)

## 不变量

- 所有动态文本经 esc() 转义后才进 HTML；所有外链经 safeUrl 过滤（治理红线 UI 安全）
- 动画分组中纯内部标识符（全小写下划线、range/checkbox/radio/slider/toggle）不显示徽章；徽章最多 8 个，超出折叠为「+N」
- 徽章/卡片颜色全走 CSS 变量（--accent / --free / --paid / --surf / --txt / --muted）
- 加密卡 `format`/`crypto` 缺字段渲染用 `?? 0` 归一（P3 修复：原直接插值 → vundefined）；header-only 作者/作品分行渲染（P3 修复：原 p.author 为空时作品被标为作者）；configMenus 全部渲染（P3 注释修正：原注释「只显示前5项」与实现/测试不符）

## 相关

- [app_preview](./app-preview.md) — 预览面板
- [go_ysm_parser](./go-ysm-parser.md) — 摘要数据源
- `frontend/src/utils/format/summarize.test.js` — 单元测试（验证入口）
