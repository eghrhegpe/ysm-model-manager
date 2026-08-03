---
kind: oldest_models
name: 资历最深模型 oldest-models
tier: leaf
category: feature
source_files:
  - frontend/js/features/oldest-models.ts
use_when:
  - 资历最深
  - 老模型
  - 仓库评分
  - 每日推荐
  - 月度活动
  - 热力图
  - 仓库健康
---

# 资历最深模型 oldest-models

## 概览

`oldest-models.ts` 实现仓库页「资历」tab（diagnostics/oldest 页面）的仪表盘：围绕 `ScanModelEntries` 扫描结果做本地统计，渲染四大板块——仓库评分（健康环）、资历最深 Top4（按 `ModTime` 升序）、月度活动热力图（近 12 个月文件数柱状图）、每日推荐（Fisher-Yates 洗牌随机 3 个）。响应全局资源类型切换重新渲染。

## 核心职责

- `loadOldestModel(container, esc)`：主入口，返回清理函数
- 数据获取：`GetRepoRoot(currentType)` 取当前类型仓库根（未配置显示提示），`ScanModelEntries(repoRoot)` 取条目列表（`{ Name, Size, Path, Ext, Hash, ModTime }`）
- 仓库评分：初始 100 分，`.ban` 占比罚最多 40 分、重复（按 `Hash` 分组）每个多余副本罚 5 分封顶 55 分；≥80 健康（绿）/≥50 亚健康（黄）/其余需要整理（红），conic-gradient 圆环展示
- 资历最深：过滤有 `ModTime` 的条目升序取前 4，展示大小/日期/入库天数
- 月度活动：`buildMonthHeatmap` 统计近 12 个月文件数，归一化柱高与分段配色
- 每日推荐：Fisher-Yates 洗牌取前 3 渲染卡片
- 交互：卡片事件委托（命名函数 `handleContainerClick`，重绑前先 remove），点击 `bus.emit("model:select", { path })`；监听 `repo:rtype-changed` 切换类型后重渲染

## 对外 API / 入口

- 导出：`loadOldestModel(container: HTMLElement, esc: (s: string) => string): Promise<() => void>`
- 监听 bus：`repo:rtype-changed`
- 派发 bus：`model:select`
- getApp() 调用：`ScanModelEntries`、`GetRepoRoot`
- 依赖：`renderDisplayName`（utils/display.ts）、`loadResourceRegistry`（utils/resource-registry.ts，取类型图标）

## 与其他子系统关系

- 由 [app_content](./app_content.md) 的 `_bindTabs` 在 oldest tab 首次激活时懒加载，清理函数收进 `_unsubs`
- 条目扫描后端与去重统计口径相关：[go_types](./go_types.md)（ModelEntry）、[go_dedup](./go_dedup.md)（重复判定同样基于 hash）
- 卡片点击后由 [app_preview](./app_preview.md) 展示模型详情
- 健康度配色/字号全走 CSS 变量（`var(--free)`/`var(--paid)`/`var(--tag-amber)` 等），见 [shared_styles](./shared_styles.md) 与主题系统

## 不变量

- 清理函数必须同时 `removeEventListener("click", handleContainerClick)` 与退订 `repo:rtype-changed`，二者缺一即泄漏
- 重绑点击监听前先移除旧监听（命名函数引用），防止 render 多次执行导致重复绑定
- 所有动态文本过 `esc` 转义、显示名过 `renderDisplayName`；`container` 为空直接返回空清理函数
- 扫描失败/仓库为空/未配置目录均有对应空态文案，不渲染半成品

## 相关

- [app_content](./app_content.md) — tab 懒加载宿主
- [app_preview](./app_preview.md) — 卡片点击后的预览
- [go_dedup](./go_dedup.md) — 重复统计的同源 hash 口径
