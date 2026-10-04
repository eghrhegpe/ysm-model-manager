# ADR-270-d1：preview-3d 内部分层方向闸 R9（state/infra/decoder/shader-patches 禁运行时引 adapters/caps/menu，基线防回退）

- **状态**：✅ 已采纳
- **日期**：2026-10-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **关联主 ADR**：ADR-270

---

## 背景（一句）

ADR-270 已立法 preview-3d/menu/ 子目录物理分层（check-layering R7），但 preview-3d 其余区（state/infra/decoder/shader-patches 底层 ↔ adapters/caps/menu 上层）无任何方向执法——现行唯一兜底 check-circular 只保「无环」，反向边持续新增不红（2026-10-04 锐评实测：state→caps、infra→adapters/menu、shader-patches→caps 共 7 条反向边，其中 1 条运行时纯债已随 ringLog 直引真身斩掉，余 6 条无闸拦阻）。

## 决策（三行）

1. `scripts/check-layering.ts` 新增 **R9（防回退）**：preview-3d 下层子目录 { state, infra, decoder, shader-patches } 生产文件禁止**运行时** import 上层子目录 { adapters, caps, menu }；`import type` 编译期擦除一律豁免（与仓内「类型引用口径钉死」同族），测试文件经 SCAN_OPTS.skipFile 豁免（infra 测试装配 menu 面板 id 等合法）。
2. 存量 6 条反向运行时边（env-state-schema→caps/ground-surface-spec 〔ADR-249 默认值单一事实源立法边〕、render-host / postproc-cost-probe → adapters/shared-infra + caps/scene-capability-registry、register-built-scene → menu/panels/stats）入 `docs/.layering-baseline.json` 防回退基线（tracked，只减不增，--update 收紧）；新增即红阻断——立法边走基线、真债走「顺手斩」，不做大爆炸。
3. 内核仿 R7 纯函数导出（`p3dSubOf` / `r9EdgeViolates` / `P3D_LOWER_SUBS` / `P3D_UPPER_SUBS`），契约测试 `tests/test_check_layering.ts` 直测非空转（向上判违规、下行/同层/越界放行）；infra 读装配产物边未来可经 ADR-168 注入点先例收敛（本 ADR 不强制，收敛后 `--update` 收紧基线）。

## 后果（一句）

preview-3d 内部方向从此有闸：新能力/新 cap 写码时「底层伸手进装配层」在提交即被拦截，要么走注入点要么立法入基线；回退 = 删 R9 扫描段 + 基线 R9 条目，行为不变。射程刻意收窄（不拦 mesh↔model、screenshot→caps 等同层/邻层既成双向债——扩围另立 R9.x 拍板）。

<!-- 文件名: preview-3d-r9-state-infra-decoder-shader-patches-adapters-caps-menu.md → 实际文件 decisions/ADR-270-d1-preview-3d-r9-state-infra-decoder-shader-patches-adapters-caps-menu.md（ADR-320 decisions 轻量模板） -->
