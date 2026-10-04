# ADR-270-d2：views→preview-3d 入口面白名单闸（R10）：斩 DECODE_SOURCE/keymap 绕行边，存量债入基线

- **状态**：✅ 已采纳（Adopted，2026-10-05；耦合全景 v2 报告列候选刀 A/B/C，用户以「继续」拍板刀 A）
- **日期**：2026-10-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-270

---

## 背景（一句）

R9 五边收敛（ADR-270-d1）后耦合全景 v2 重测判词 7.5/10，首病根转为「穿透性债」：views→preview-3d 30 条边中 ~15 条真债穿透 p3d 内部细节子目录（decoder / mesh / model / texture / screenshot / menu panels）而非装配入口面——展示端耦合面随新增视图模块自由扩张。

## 决策（三行）

1. check-layering 增设 R10（防回退）：views 生产文件运行时 import preview-3d/ 仅许经入口面（adapters/ 装配入口面目录前缀 + infra 值域/公共通道 6 精确文件 + state/preview-state.ts 公开面）；白名单外内部细节穿透入基线（key=from:to，存量 14 条），新增边即阻断；type-only 豁免、测试文件经 skipFile 豁免，射程刻意收窄只治 views→preview-3d。
2. 顺手斩 3 条绕行边：settings/keymap.ts 的 loadTdKeymap 直引 infra/keymap.ts（斩掉经 mesh/model3d.ts 584 行巨型文件再导出面绕行，keymap.test.ts / init.test.ts 两 mock 改靶 infra/keymap.ts 并 importOriginal 展开保全 TD_KEYMAP_REGISTRY 真导出）；DECODE_SOURCE 来源码值域常量自 decoder/utils.ts 迁 infra/load-trace.ts（与 TRACE_FORMAT 家族同族「来源码家族单一事实源」），views tpl.ts / loader.ts 直引入口面，decoder/utils.ts 仅留再导出面。
3. 存量 14 条 YSM 解码链（model-cache / wasm-decode）/ multi-model 菜单节点 / screenshot 引擎债边本轮不斩（需入口面 API 设计，另立战役），全部入基线防回退；未来新格式适配器自动获入口面合法性（adapters/ 前缀白名单）。

## 后果（一句）

分层基线 3 → 17 条（新增 14 条 R10）；新 views 模块穿透 p3d 内部细节即红；回退 = 摘 check-layering.ts R10 段 + 基线还原 3 条（keymap / DECODE_SOURCE 迁移可独立回滚）；代价一天量级，仿 R9 全套（纯核导出供契约测试直测「非空转」）。

<!-- 文件名: views-p3d-r10-entry-whitelist.md → 实际文件 decisions/ADR-270-d2-views-p3d-r10-entry-whitelist.md（ADR-320 decisions 轻量模板） -->
