#!/usr/bin/env node
/**
 * contract-test-targets.ts — 契约测试→保护源文件映射表（双表拆出之一，ADR-234 D3 _lib 400 行硬红线）。
 * 与 contract-test-domains.ts 互补：前者答「测哪些域」，本表答「测哪些具体文件」。
 * 值语义：精确文件相对路径（改即触发）/ '/' 结尾目录哨兵（改目录下任意文件即触发）/ 缺省=保守保留（命中即跑）。
 * 安全网：changedFiles 未命中任一 tests 域测试 → 执行器回落全量（避免零验证漏检）。
 * 维护：新增 tests 域测试须同步登记本表，否则精确裁剪模式下永不触发（静默漏检）。
 * 数组已压单行（数据表紧凑化，语义零变化）；执行器 scripts/_lib/contract-tests.ts 经 import 消费。
 */

/**
 * 契约测试 → 保护源模块映射（#3 按文件精确裁剪的事实来源，2026-09-02 引入）。
 * 与 CONTRACT_TEST_DOMAINS 互补：后者回答「测哪些域」，本表回答「测哪些具体文件」。
 * 仅在 selectContractTests 收到 changedFiles 时用于 tests 域裁剪（替代原 tests→全量回落）。
 *
 * 值语义：
 *   - 精确文件相对路径（相对仓库根）：改该文件即触发此测试。
 *   - 以 '/' 结尾的目录哨兵：改该目录下任意文件即触发（用于宽敏感测试）。
 *   - 缺省/空数组：保守保留（命中即跑）——不漏检，仅削弱轻量化。
 *
 * 安全网：若 changedFiles 未命中任一 tests 域测试 → selectContractTests 回落全量，
 * 避免「改动未被任何测试覆盖」时静默零验证。
 * 维护：新增 tests 域测试须同步登记本表，否则精确模式下该测试永不触发（静默漏检）。
 */
export const CONTRACT_TEST_TARGETS: Record<string, string[]> = {
  // —— 精确：test_scripts_json 仅对 11 个 --json 脚本敏感；test_codemod_guards 仅 codemod.ts ——
  "test_scripts_json.ts": ["scripts/check-redlines.ts", "scripts/check-circular.ts", "scripts/check-orphan-exports.ts", "scripts/check-boolean-naming.ts", "scripts/check-adr-health.ts", "scripts/check-knowledge-drift.ts", "scripts/check-doc-drift.ts", "scripts/comment-checker.ts", "scripts/type-consistency.ts", "scripts/link-checker.ts", "scripts/adr-check.ts"],
  "test_codemod_guards.ts": ["scripts/codemod.ts"],
  // 陈旧测试引用闸：本体 + 全仓生产注释（go/frontend 任一注释改动都可能引入/消灭陈旧点名）。
  "test_check_stale_test_refs.ts": ["scripts/check-stale-test-refs.ts", "scripts/_lib/gate-config.ts", "go/", "frontend/src/"],
  // ADR 状态行格式契约（2026-10-10 A1 前置补充）：ADR 头部解析两库 + docs/adr 全目录任一
  // 改动都须触发（目录形态 docs/adr/ 由 targetsHit 前缀展开）。
  "test_adr_status_format.ts": ["scripts/_lib/frontmatter.ts", "scripts/_lib/adr-status-categories.ts", "docs/adr/"],
  // ADR ② 进度化石判定 + hard 闸契约：check-adr-health 改动或 docs/adr 内容变动都须触发。
  "test_adr_lingering_progress.ts": ["scripts/check-adr-health.ts", "docs/adr/"],
  // G2 Worker 生命周期闸的契约测试（2026-10-08 补登记）：验证 scripts/check-worker-lifecycle.ts
  // 的扫描域 fail-loud（空域 exit 2）、`new Worker(` 站点终止出口判定、基线只减不增与豁免语法。
  // 为何必须登记（test_contract_tables_consistency 断言）：其 DOMAINS 标了 `tests`
  // （它自身也验证工具行为，改 tests/ 即须触发），按该测试的规则「含 tests 域者必须显式登记
  // TARGETS」——否则精确裁剪模式下「改了该脚本却不跑这条契约测试」会静默漏检。
  "test_check_worker_lifecycle.ts": ["scripts/check-worker-lifecycle.ts", "tests/test_check_worker_lifecycle.ts"],
  // 扫描 frontend/src 下全部 *.setup.ts（防 vi.hoisted 与 --coverage 插桩冲突）；
  // 锚点断言 context-menus.setup.ts 的 mocks 形态——两者任一改动都须触发本测试。
  "test_vitest_coverage_setup.ts": ["frontend/src/features/context-menu/context-menus.setup.ts", "tests/test_vitest_coverage_setup.ts"],
  // 跨端契约（ADR-207 D2）：Go AppError 文案 × 前端净化正则，共享 fixture 双端钉
  "test_apperror_strip.ts": ["go/types/types.go", "go/types/apperror_test.go", "frontend/src/utils/base/pure/apperror-text.ts", "tests/fixtures/apperror-sample.json"],
  // —— 精确：仅改对应源文件才触发 ——
  "coverage-suggest-hint.ts": ["scripts/hooks/coverage-suggest-hint.ts", "scripts/test-coverage-report.ts", "scripts/hooks/knowledge-affected-hint.ts"],
  "go-coverage-hint.ts": ["scripts/hooks/go-coverage-hint.ts"],
  "bindings-sync-hint.ts": ["scripts/hooks/bindings-sync-hint.ts"],
  "test_binding_check_shape.ts": ["scripts/binding-check.ts"],
  "vitest-env-switch.ts": ["scripts/perf/vitest-env-switch.ts"],
  "test_alias-resolve.ts": ["scripts/_lib/alias-resolve.ts", "scripts/_lib/scan-files.ts"],
  // R8 模板闸扫描核：仅改纯函数核（或本测试自身）才需重跑
  "test_innerhtml_hygiene.ts": ["scripts/_lib/innerhtml-hygiene.ts", "tests/test_innerhtml_hygiene.ts"],
  "test_changed_scope.ts": ["scripts/_lib/changed-scope.ts"],
  "test_diff_source.ts": ["scripts/_lib/diff-source.ts", "scripts/_lib/git-hunks.ts"],
  "test_token_shift_audit.ts": ["scripts/token-shift-audit.ts", "scripts/_lib/design-tokens.ts", "scripts/_lib/token-types.ts", "scripts/_lib/token-tables.ts", "scripts/_lib/token-suggest.ts", "scripts/_lib/token-transition.ts", "scripts/_lib/token-glyph.ts", "scripts/_lib/token-style.ts", "scripts/_lib/token-fix.ts", "scripts/_lib/token-emoji.ts"],
  "test_gen_routes_quick_pitfall.ts": ["scripts/gen-routes-quick.ts"],
  "check-gen-routes-status.ts": ["scripts/gen-routes.ts", "scripts/_lib/knowledge-cards.ts"],
  "check-knowledge-frontmatter-line-refs.ts": ["scripts/check-knowledge-drift.ts"],
  "check-knowledge-card-references.ts": ["scripts/check-knowledge-drift.ts", "scripts/_lib/knowledge-cards.ts"],
  "test_gen_routes_quick_groups.ts": ["scripts/gen-routes-quick.ts", "scripts/_lib/knowledge-cards.ts"],
  "test_link_checker_scope.ts": ["scripts/link-checker.ts", "scripts/_lib/scan-files.ts"],
  "test_check_path_hygiene.ts": ["scripts/check-path-hygiene.ts", "scripts/_lib/alias-resolve.ts", "scripts/_lib/scan-files.ts", "frontend/tsconfig.json", "frontend/vite.config.js"],
  "test_check_mock_paths.ts": ["scripts/check-mock-paths.ts", "scripts/_lib/mock-path-resolve.ts", "scripts/_lib/alias-resolve.ts", "scripts/_lib/scan-files.ts", "frontend/tsconfig.json", "frontend/package.json", "docs/.mock-path-exempt.json"],
  // 应用配置写唯一实参点（ADR-313）：出口文件即不变量本体，改它须触发本锁
  "test_config_write_single_exit.ts": ["frontend/src/views/config-write.ts"],
  // 设置键台账对账：台账本体（不变量本体）+ Go 配置字段定义（磁盘轨对账对象）是
  // 判定集的锚；frontend/src 生产文件是扫描面（目录哨兵），任一新增键即命中
  "test_settings_key_ledger.ts": ["frontend/src/settings-keys.ts", "go/types/config.go", "frontend/src/"],
  // settings:imported 主题镜像因果链：发射侧出口（emit 唯一点）+ 消费侧订阅文件
  // （回调体内 initTheme 重算）是判定集的锚
  "test_settings_imported_theme_lock.ts": ["frontend/src/views/app-content/settings/settings-backup.ts", "frontend/src/views/app-content/index.ts"],
  // 整合包同步写入口双缓存配对：internal/app 全部生产文件都是扫描对象（目录哨兵），
  // 写入口本体 app_sync.go / app_install_instance.go / app_install_import.go 变更必触发
  // 派生 fail-closed 闸：internal/app 生产文件全量在扫（目录哨兵）+ 被监视包导出面
  // 即候选写面（其增删直接改判定集）+ 派生引擎本体
  "test_sync_write_cache_pairing.ts": ["internal/app/", "go/instance/", "go/sync/", "go/installer/", "go/importer/", "scripts/_lib/write-surface-gate.ts", "tests/test_sync_write_cache_pairing.ts"],
  // 仓库文件写绑定扫描缓存失效：internal/app 生产文件全量在扫（目录哨兵），
  // 薄壳本体 app_files.go 变更必触发
  "test_fileops_write_invalidate.ts": ["internal/app/", "go/fileops/", "scripts/_lib/write-surface-gate.ts", "tests/test_fileops_write_invalidate.ts"],
  // 标签键跟随+清理：internal/app 生产文件全量在扫（目录哨兵）+ 被监视包导出面 + 派生引擎本体
  "test_fileops_tag_sync.ts": ["internal/app/", "go/tags/", "go/fileops/", "scripts/_lib/write-surface-gate.ts", "tests/test_fileops_tag_sync.ts"],
  // 随 rtype 联动面板的感知性绑定（2026-10-14 P1b）：frontend/src 全量在扫（目录哨兵）
  // + hook 定义文件（API 面变更 = 候选面重算）+ 派生引擎本体 + 测试自身
  "test_rtype_panel_perceptual_binding.ts": ["frontend/src/", "frontend/src/features/repo/repo-rtype.ts", "scripts/_lib/rtype-panel-gate.ts", "tests/test_rtype_panel_perceptual_binding.ts"],
  "test_api_break.ts": ["scripts/api-break.ts"],
  "test_auto_import.ts": ["scripts/auto-import-lexer.ts", "scripts/auto-import-symbols.ts", "scripts/auto-import-detect.ts"],
  // 守卫事实源：脚本自身 + 前端黑名单/测试副本/bindings + internal/app/ 目录哨兵（T1 文件差集 / T2 守卫扫描源）
  "test_check_android_unavailable.ts": ["scripts/check-android-unavailable.ts", "frontend/src/backend/platform-web.ts", "frontend/src/backend/platform-web.test.ts", "frontend/bindings/ysm-model-manager/internal/app/app.ts", "internal/app/"],
  "test_check_diff_coverage.ts": ["scripts/check-diff-coverage.ts"],
  "test_check_go_diff_coverage.ts": ["scripts/check-go-diff-coverage.ts"],
  "test_check_go_coverage_threshold.ts": ["scripts/check-go-coverage-threshold.ts"],
  "test_check_go_diff_coverage_skip.ts": ["scripts/check-go-diff-coverage.ts"],
  // 浅克隆兜底守卫：盯 _lib/diff-coverage-core 的「直推 main 兜底」（HEAD~1 不可达不得升为 null）
  "test_diff_coverage_shallow.ts": ["scripts/_lib/diff-coverage-core.ts", "scripts/check-go-diff-coverage.ts"],
  "test_check_complexity.ts": ["scripts/check-complexity.ts"],
  "test_check_type_safety.ts": ["scripts/check-type-safety.ts"],
  "test_check_knowledge_content.ts": ["scripts/check-knowledge-content.ts"],
  // port-align oracle 版本基线断言（P2①）：核 = checkOracleBaseline/ORACLE_BASELINE（在 port-align.ts 内）
  "test_port_align_baseline.ts": ["scripts/port-align.ts"],
  // 孪生同胞提醒探针（P2② 补网）：核 = normalizeLine/extractShapes/matchShapes 纯函数（在 check-twin-siblings.ts 内）；
  // 挂点 scripts/_lib/commit-check.ts 第 4 步亦登记（挂载改动重验同胞语义）
  "test_check_twin_siblings.ts": ["scripts/check-twin-siblings.ts", "tests/test_check_twin_siblings.ts", "scripts/_lib/commit-check.ts"],
  "test_check_params.ts": ["scripts/check-params.ts"],
  // ADR-311 菜单测试布局闸：扫菜单区测试文件的布局快照形态 + 基线对账（只减不增）
  "test_check_menu_test_layout.ts": ["scripts/check-menu-test-layout.ts", "docs/.menu-test-layout-baseline.json", "tests/test_check_menu_test_layout.ts"],
  // preview-3d 模块级单例卫生闸：扫生产文件顶层 let + 基线对账（只减不增）
  "test_check_singleton_hygiene.ts": ["scripts/check-singleton-hygiene.ts", "docs/.singleton-hygiene-baseline.json", "tests/test_check_singleton_hygiene.ts"],
  // 前端 vitest「失败失语」闸：扫 frontend/src 全部 *.test.ts 的复合布尔无消息断言 + 基线对账（只减不增）
  "test_check_vitest_assert_quality.ts": ["scripts/check-vitest-assert-quality.ts", "docs/.vitest-assert-quality-baseline.json", "tests/test_check_vitest_assert_quality.ts"],
  // 裸标签规则锁死：判定口径来自 VitePress 真实 markdown-it 逐例实测，改脚本即须复验
  "test_check_doc_markup.ts": ["scripts/check-doc-markup.ts"],
  "test_complexity_parity.ts": ["scripts/check-complexity.ts", "go/ccheck/", "tests/parity/"],
  "test_collect_scripts_lib.ts": ["scripts/_lib/collect-scripts.ts"],
  "test_commit_check_gate.ts": ["scripts/_lib/commit-check.ts", "scripts/commit-with-check.ts"],
  "test_commit_temp_index.ts": ["scripts/_lib/commit-temp-index.ts", "scripts/commit-with-check.ts", "scripts/_lib/commit-check.ts"],
  "test_contract_domain_select.ts": ["scripts/_lib/contract-tests.ts"],
  "test_contract_alias_runtime.ts": ["scripts/_lib/contract-tests.ts", "scripts/_lib/ts-alias-register.ts", "scripts/_lib/ts-alias-resolver.ts", "scripts/_lib/alias-resolve.ts"],
  // 扫描 .github/workflows/*.yml（防 CI 手写裸跑循环绕过统一入口缺别名注入）；
  // 锚点 = 统一入口自身 + 本测试——三者任一改动都须触发本测试。
  "test_workflow_contract_runner.ts": [".github/workflows/", "scripts/contract-tests.ts", "tests/test_workflow_contract_runner.ts"],
  // 扫描 .github/workflows/*.yml 的顺序不变量（R1-R5）；锚点 = workflow 目录 + 本测试自身。
  "test_workflow_contract_order.ts": [".github/workflows/", "tests/test_workflow_contract_order.ts"],
  // 完整 YAML 校验（vendored yaml）：锚点 = vendor 目录 + docs（frontmatter 面）+ workflow 目录
  "test_knowledge_frontmatter_yaml.ts": ["scripts/_lib/vendor/yaml/", ".github/workflows/", ".github/actions/", "docs/", "tests/test_knowledge_frontmatter_yaml.ts"],
  // 扫描 frontend/ 下构建/工具配置的入口声明（vite.*.config.* 的 rollupOptions.input +
  // knip.json 的 entry）；改任一配置或本测试都须触发。
  "test_build_entry_refs.ts": ["frontend/vite.config.js", "frontend/vite.web.config.ts", "frontend/vite.e2e.config.ts", "frontend/knip.json", "tests/test_build_entry_refs.ts"],
  "test_deadcode_attrib.ts": ["scripts/_lib/deadcode-attrib.ts"],
  // 基线键派生单源 + 其生产消费方 + 过滤配置（三者任一改动都重验键形态）：
  // deadcode-keys 是键派生真身；check-deadcode-baseline 接线 jscpd --ignore 与调用；
  // knip.json 的 ignoreIssues/Binaries/Dependencies 决定 knip 发现集（键来源面）。
  "test_deadcode_keys.ts": ["scripts/_lib/deadcode-keys.ts", "scripts/check-deadcode-baseline.ts", "frontend/knip.json"],
  "test_domain_classify.ts": ["scripts/_lib/domain-classify.ts"],
  "test_gen_stage.ts": ["scripts/_lib/gen-stage.ts"],
  // 生成物引用完整性（2026-10-09 锐评第三刀）：判据本体 + gen-stage CLI 的接线反向锚。
  // 目的是让「聚合生成物引用未入库文件」这类并行会话卷带无法悄悄回流。
  "test_gen_ref_integrity.ts": ["scripts/_lib/gen-ref-integrity.ts", "scripts/_lib/gen-stage.ts"],
  // 存量债到期报告（ADR-256-d1 收口刀）：呈现本体 + CI 步骤接线反向锚（改 test.yml 必须重验）
  "test_debt_report.ts": ["scripts/debt-report.ts", ".github/workflows/test.yml", "scripts/_lib/gate-config.ts", "scripts/_lib/gate-debt.ts"],
  // 审计时效判定（2026-10-09 锐评第四刀）：内核三分类 + CLI fail-closed 退出码语义
  "test_audit_freshness.ts": ["scripts/audit-freshness.ts"],
  // ADR-232 三方向可注入纯逻辑（gen-staged-pair / hook-audit / audit-degraded）
  "test_hooks_concurrency.ts": ["scripts/_lib/gen-staged-pair.ts", "scripts/_lib/hook-audit.ts", "scripts/_lib/audit-degraded.ts", "scripts/gate-audit-reconcile.ts", ".githooks/pre-commit", ".githooks/post-commit"],
  // ADR-234 D2：守护 15 gen 输出互斥 + 并行写盘契约（改 pre-commit gen 段须本测试同步）
  "test_gen_parallel.ts": [".githooks/pre-commit", "scripts/_lib/gen-cmds.ts"],
  "test_machine_diff.ts": ["scripts/_lib/machine-diff.ts", "scripts/_lib/gen-stage.ts"],
  "test_jscpd_pairs.ts": ["scripts/_lib/jscpd-pairs.ts"],
  "test_knowledge_common.ts": ["scripts/_lib/knowledge-common.ts", "scripts/check-knowledge-drift.ts", "scripts/check-doc-drift.ts"],
  "check-knowledge-body-line-refs.ts": ["scripts/check-knowledge-drift.ts", "docs/knowledge/AGENTS.md"],
  "check-knowledge-anchor-def-kind.ts": ["scripts/check-knowledge-drift.ts", "docs/knowledge/AGENTS.md"],
  "check-knowledge-card-status.ts": ["scripts/check-knowledge-drift.ts", "scripts/_lib/knowledge-cards.ts", "docs/knowledge/AGENTS.md"],
  "check-knowledge-topkeys.ts": ["scripts/check-knowledge-drift.ts", "scripts/_lib/knowledge-cards.ts", "docs/knowledge/AGENTS.md"],
  "check-knowledge-rename-migration.ts": ["scripts/check-knowledge-drift.ts"],
  "check-gen-autogen-stale-cleanup.ts": ["scripts/gen-knowledge-autogen.ts"],
  "check-gen-autogen-symbols-cap.ts": ["scripts/gen-knowledge-autogen.ts"],
  "test_adr_ruling_gate.ts": ["scripts/_lib/adr-tier-gate.ts", "scripts/add-card-ruling.ts"],
  "test_commit_message_gate.ts": ["scripts/_lib/commit-blocks/commit-message.ts"],
  "check-knowledge-derived-symbol-count.ts": ["scripts/check-knowledge-drift.ts"],
  "check-knowledge-claim-overlap.ts": ["scripts/check-knowledge-drift.ts"],
  "check-knowledge-source-containment.ts": ["scripts/check-knowledge-drift.ts"],
  "test_redlines_changed_files.ts": ["scripts/check-redlines.ts"],
  "test_redlines_baseline_keys.ts": ["scripts/check-redlines.ts"],
  "test_redlines_code_gap.ts": ["scripts/check-redlines.ts"],
  "test_scripts_lib.ts": ["scripts/_lib/scan-files.ts", "scripts/_lib/to-posix.ts", "scripts/_lib/ripgrep.ts", "scripts/_lib/rg-line.ts"],
  // —— 混合域（docs+tests）及补全的纯 tests 域测试 ——
  "test_gate_iife_correctness.ts": ["scripts/pre-push-gate.ts"],
  // 2026-10-25 拆分：清单拆成四文件（gate-config.ts 留 ALL + 汇总，其余按域分家）。
  // targets 必须覆盖全部四个文件——否则改 gate-config-frontend.ts 不触发本测试，
  // 「清单单一事实源」的守卫就只守了四分之一。
  "test_gate_config.ts": [
    "scripts/_lib/gate-config.ts",
    "scripts/_lib/gate-config-docs.ts",
    "scripts/_lib/gate-config-go.ts",
    "scripts/_lib/gate-config-frontend.ts",
    "scripts/_lib/gate-tool-types.ts",
  ],
  // 存量债到期制（ADR-256-d1）：判据内核在 gate-debt，元数据在 gate-config（类型强制
  // reason/reviewBy），可见性出口在 gate-coverage（尾行阻断构成）——三者任一处回退即红。
  "test_gate_debt.ts": ["scripts/_lib/gate-debt.ts", "scripts/_lib/gate-config.ts", "scripts/_lib/gate-config-frontend.ts", "scripts/_lib/gate-config-go.ts", "scripts/_lib/gate-config-docs.ts", "scripts/_lib/gate-tool-types.ts", "scripts/_lib/gate-coverage.ts"],
  // gate-ctx 是 record()/blocked/exec 助手的唯一实现；其归属标签断言同时消费
  // gate-report.formatFailSummary（record → results → 标签的端到端链路），故两者都列。
  "test_gate_ctx.ts": ["scripts/_lib/gate-ctx.ts", "scripts/_lib/gate-report.ts", "scripts/pre-push-gate.ts"],
  "test_gate_parse_output.ts": ["scripts/_lib/gate-parse.ts", "scripts/pre-push-gate.ts"],
  // 覆盖口径（锐评 P2 固定尾行数据源）：锁 gate-coverage 的动态枚举/覆盖互斥性/尾行形状。
  // 目标文件含 pre-push-gate.ts（尾行接线点）——清单改名导致覆盖失真时此测试先红。
  "test_gate_coverage.ts": ["scripts/_lib/gate-coverage.ts", "scripts/pre-push-gate.ts"],
  // 审计留痕（锐评 P1）：锁 gate-audit 追加语义/行格式/fail-open；含 pre-push-gate.ts
  // （审计接线点）——绕过审计若静默失效，此测试先红。
  "test_gate_audit.ts": ["scripts/_lib/gate-audit.ts", "scripts/pre-push-gate.ts"],
  // 基线守卫单一实现（2026-10-09 锐评第二刀）：判据本体 + 两个消费门禁的 wiring 反向锚。
  // 任一消费方重新内联一份判据（第二份实现）即红——这正是 2026-10-08 那对假绿守卫的成因。
  "test_baseline_guard.ts": ["scripts/_lib/baseline-guard.ts", "scripts/check-diff-coverage.ts", "scripts/check-go-diff-coverage.ts"],
  // ADR-206 阶段 2：静态工具执行器搬入 gate-blocks/static-tools.ts。该测试同时锁
  // pre-push-gate 的调度调用点（runTools(ctx, ...) 形参顺序）与 gate-ctx 的 record 语义。
  "test_gate_static_tools.ts": ["scripts/_lib/gate-blocks/static-tools.ts", "scripts/_lib/gate-ctx.ts", "scripts/pre-push-gate.ts"],
  "test_gate_report.ts": ["scripts/_lib/gate-report.ts", "scripts/pre-push-gate.ts"],
  // sh/shAsync 调用点安全不变式（2026-09-13 锐评 P1 #4）：把 gate-ctx 注释里的「禁入
  // 用户可控输入」落成可执行契约——扫描全部 gate 源码的 ctx.sh/shAsync 实参（禁入清单
  // + 动态命令冻结清单）。受保护面 = 全部 gate-blocks + 调度器。
  "test_gate_sh_invariants.ts": ["scripts/_lib/gate-ctx.ts", "scripts/pre-push-gate.ts", "scripts/_lib/gate-blocks/go-domain.ts", "scripts/_lib/gate-blocks/frontend-domain.ts", "scripts/_lib/gate-blocks/schedule.ts", "scripts/_lib/gate-blocks/static-tools.ts", "scripts/_lib/gate-blocks/data-docs-domain.ts", "scripts/_lib/gate-blocks/redlines.ts"],
  // ADR-206 阶段 3-4：数据/文档/ADR/索引守护 + 红线执行器迁入 gate-blocks/*。
  // 该测试锁调度调用顺序（runDataDomain → runDocsDomain → runRedlines → …）
  // 与 redlines 的 --files 数组式传参（防 shell 拼接注入回归）。
  "test_gate_domains.ts": ["scripts/_lib/gate-blocks/data-docs-domain.ts", "scripts/_lib/gate-blocks/redlines.ts", "scripts/pre-push-gate.ts"],
  // ADR-206 阶段 5：契约测试 / 静态工具补挂 / scripts typecheck 调度迁入 schedule.ts。
  // 该测试锁 tsc 三态 rc（0/1/2-TS18003）+ tsc 缺失如实阻断 + 自守卫语义。
  "test_gate_schedule.ts": ["scripts/_lib/gate-blocks/schedule.ts", "scripts/pre-push-gate.ts"],
  // 工具二进制双根探测的唯一事实源：两个消费方（schedule 的 tsc / deadcode 的 knip+jscpd）
  // 任一改动都要重验探测语义。
  "test_tool_bin.ts": ["scripts/_lib/tool-bin.ts", "scripts/_lib/gate-blocks/schedule.ts", "scripts/check-deadcode-baseline.ts"],
  "test_css_layer_check.ts": ["scripts/css-layer-check.ts"],
  "test_check_a11y.ts": ["scripts/check-a11y.ts"],
  // i18n-ui-check 双通道判据闸（D3 补）：判据内核（scanSourceText）、main 守卫、flag 白名单
  // 三者任一退化即红——尤其 main 守卫被摘回顶层时 import 会崩测试进程，此测试先撞。
  "test_i18n_ui_check.ts": ["scripts/i18n-ui-check.ts"],
  // i18n-frozen-t-check 第五闸：契约测试直 import 判据内核 scanSourceText（正反例判别力），
  // 并 execFileSync 跑 CLI 验 --strict/--json 接线——判据或 CLI 任一退化即红。
  "test_i18n_frozen_t_check.ts": ["scripts/i18n-frozen-t-check.ts"],
  // i18n 未使用键：判定层（点分 token 抽取 + 三级判定）与 CLI 接线同属敏感源；
  // 三包键数对账（test 块 7 读 zh-CN/ja 断言 nZh===nEn、nJa===nEn），故三包全列——
  // 仅改 zh-CN.ts/ja.ts 也须触发（review bb94909f9 P3-7）。
  "test_i18n_unused.ts": ["scripts/_lib/i18n-unused.ts", "scripts/check-i18n-unused.ts", "frontend/src/locales/en.ts", "frontend/src/locales/zh-CN.ts", "frontend/src/locales/ja.ts"],
  // 判定层是纯函数模块，契约测试直接 import 它；令牌基准表与 variables.css 对账，
  // 故两者都列为敏感源（任一改动都应触发本测试）。
  // 2026-10-25 拆分后：判定层已分散到 token-*.ts 八文件（design-tokens.ts 只做入口透出），
  // 任一子模块改动都会改变判定行为，故全部列为敏感源（漏一个 = 改它不跑本测试）。
  "test_design_tokens.ts": [
    "scripts/_lib/design-tokens.ts",
    "scripts/_lib/token-types.ts",
    "scripts/_lib/token-tables.ts",
    "scripts/_lib/token-suggest.ts",
    "scripts/_lib/token-transition.ts",
    "scripts/_lib/token-glyph.ts",
    "scripts/_lib/token-style.ts",
    "scripts/_lib/token-fix.ts",
    "scripts/_lib/token-emoji.ts",
    "scripts/_lib/icon-map.ts",
    "scripts/check-design-tokens.ts",
    "frontend/css/variables.css",
    "docs/UI-Design.md",
  ],
  // ADR-238：映射表（scripts）↔ 图标实现（frontend）对拍，两份都在敏感源。
  "test_ui_icons.ts": ["scripts/_lib/icon-map.ts", "frontend/src/utils/icon/ui-icons.ts", "docs/adr/ADR-238-ui.md"],
  "test_check_readme_index.ts": ["scripts/check-readme-index.ts"],
  "test_sidebar_gen.ts": ["scripts/gen-vitepress-sidebar.ts"],
  "test_new_knowledge_card.ts": ["scripts/new-knowledge-card.ts", "scripts/check-knowledge-drift.ts", "scripts/gen-knowledge-index.ts"],
  "test_commit_version_defense.ts": ["scripts/_lib/commit-blocks/version-defense.ts"],
  "test_commit_smart_stage.ts": ["scripts/_lib/commit-blocks/smart-stage.ts"],
  "test_commit_clean_staged_filter.ts": ["scripts/_lib/commit-blocks/clean-staged-filter.ts"],
  "test_commit_staged_domains.ts": ["scripts/_lib/commit-blocks/staged-domains.ts", ".githooks/pre-commit", "scripts/_lib/domain-classify.ts"],
  "test_adr_tiering.ts": ["scripts/_lib/adr-files.ts", "scripts/_lib/frontmatter.ts", "scripts/new-adr.ts", "scripts/adr-check.ts", "scripts/check-adr-health.ts", "scripts/check-doc-drift.ts", "scripts/gen-adr-supersede.ts", "scripts/gen-docs-index.ts", "scripts/gen-vitepress-sidebar.ts"],
  "test_check_boolean_smart.ts": ["scripts/check-boolean-naming.ts"],
  // §6 断言锚点已随 ADR-206 阶段 1 迁到 gate-ctx.ts（record 真身），故列入目标。
  "test_gate_policy_baseline.ts": ["scripts/_lib/gate-config.ts", "scripts/_lib/gate-config-frontend.ts", "scripts/_lib/gate-config-go.ts", "scripts/_lib/gate-tool-types.ts", "scripts/_lib/gate-ctx.ts", "scripts/pre-push-gate.ts"],
  // 含 baseline 账本：第 8 组断言「baseline 不得残留 tmp/ 幻影对」——--update 若漏了
  // --ignore 就会把幻影写进账本，故改账本必须触发这条测试。
  "test_jscpd_go_smart.ts": [
    "scripts/_lib/jscpd-pairs.ts",
    "scripts/jscpd-go.ts",
    "scripts/baseline/jscpd-go-baseline.json",
  ],
  "test_orphan_exports_smart.ts": ["scripts/check-orphan-exports.ts"],
  "test_scan_files_shared.ts": ["scripts/_lib/scan-files.ts"],
  "test_git_ref.ts": ["scripts/_lib/git-ref.ts"],
  "test_contract_tests.ts": ["scripts/_lib/contract-tests.ts"],
  "test_ripgrep_contract.ts": ["scripts/_lib/ripgrep.ts"],
  "test_gate_fallback.ts": ["scripts/_lib/gate-resolve.ts"],
  // 双表一致性守卫本身：锁两张表的键集合关系——改任一表结构即触发（防「加测试漏登记另一张表」）。
  "test_contract_tables_consistency.ts": ["scripts/_lib/contract-test-domains.ts", "scripts/_lib/contract-test-targets.ts", "scripts/_lib/contract-tests.ts"],
};
