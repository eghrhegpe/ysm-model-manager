// ===== <app-content> 样式组合层（按职责拆分为 6 个域文件）=====
// content-layout   : host 变量 + 通用 keyframes（含本地化 fadeSlide*/breathe-subtle）+ 骨架 + 通用卡片系统
// content-repo     : 仓库/实例/站点骨架 + 资历页 + 热力图 + 通用标签（不含设置页资产）
// content-creator  : 创作者 .cr-* 全族（标签/频道/卡片/详情/编辑）
// content-diag     : 诊断(diag-/perf-/log-/conflict-/scan-) + GitHub .gh-* + 二级菜单 + 队列 + 诊断配置面板(diag-config-/diag-warn)
// content-util     : 回收站/资源管理器/预览/主题选择器/响应式
// content-stg      : 设置页 .stg-* 全族 + .tab-body + .settings-group + .setting-row（从 components.css 回迁 shadow，见 21c01725 / 9942ada3 / 67bbd157）

import { contentCreatorCSS } from "./content-creator.ts";
import { contentDiagCSS } from "./content-diag.ts";
import { contentLayoutCSS } from "./content-layout.ts";
import { contentRepoCSS } from "./content-repo.ts";
import { contentStgCSS } from "./content-stg.ts";
import { contentUtilCSS } from "./content-util.ts";
export const contentCSS: string = [
  contentLayoutCSS,
  contentRepoCSS,
  contentCreatorCSS,
  contentDiagCSS,
  contentUtilCSS,
  contentStgCSS,
].join("\n");
