// ===== GitHub 仓库链接常量（单一来源）=====
// 防仓库迁移漂移（P3 审核项）：repo/releases/docs 三形态 URL 统一在此定义，
// 消费方 import 而非各自拼接。消费方：app-content 模板
// （views/app-content/tpl.ts、tpl-settings.ts）与设置逻辑（views/app-content/settings/init.ts）。
export const GH_REPO = "https://github.com/eghrhegpe/ysm-model-manager";
export const GH_RELEASES = GH_REPO + "/releases";
export const GH_DOCS = GH_REPO + "/tree/main/docs";
