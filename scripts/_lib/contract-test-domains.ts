#!/usr/bin/env node
/**
 * contract-test-domains.ts — 契约测试→敏感验证域映射表（双表拆出之一，ADR-234 D3 _lib 400 行硬红线）。
 * 语义：该测试验证的对象属于哪些域——变更域命中其一即应触发该测试（mixed = 跨端契约，任一端变更都触发）。
 * 域 `scripts` 不在 Domain 词表内（classify 把 tests/ 与 scripts/ 归 'tests' 域）——验证 scripts 工具的测试同样标 tests。
 * 数据来源：docs/contract-tests-audit.md（逐一通读头部人工核定）；执行器 scripts/_lib/contract-tests.ts 经 import 消费。
 */
import type { Domain } from "./domain-classify.ts";

/**
 * 契约测试 → 敏感验证域映射（#2 按域裁剪的事实来源）。
 * 域定义与 domain-classify.ts 的 Domain 一致：go / frontend / data / docs / tests / other。
 * 语义：该测试验证的对象属于哪些域——变更域命中其一即应触发该测试。
 * mixed（数组含多域）表示跨端契约，任一端变更都触发。
 * 数据来源：docs/contract-tests-audit.md（45 个测试逐一通读头部后人工核定）。
 * 说明：域 `scripts` 不在 Domain 词表内（classify 把 tests/ 与 scripts/ 统一归为 'tests'），
 * 因此"验证 scripts 工具自身"的测试同样标 `tests`——工具改动即命中 'tests' → 全量。
 */
export const CONTRACT_TEST_DOMAINS: Record<string, Domain[]> = {
  // —— docs ——
  "check-knowledge-drift-affected.ts": ["docs"],
  "check-knowledge-fm-delimiter.ts": ["docs"],
  "check-knowledge-hook.ts": ["docs"],
  "check-knowledge-perf-tags.ts": ["docs"],
  "check-knowledge-body-line-refs.ts": ["docs", "tests"],
  "check-gen-routes-status.ts": ["docs", "tests"], // gen-routes status 闸隔离契约：--kc-dir 模拟冻结/草稿剔除 + --check 自洽
  "check-knowledge-frontmatter-line-refs.ts": ["docs", "tests"], // 5.10 frontmatter 人工字段行号引用 WARN
  "test_adr_status_format.ts": ["docs"], // ADR 状态行格式契约（2026-10-10 A1 前置补充）：读 docs/adr 全量
  "test_adr_lingering_progress.ts": ["docs", "tests"], // ADR ② 进度化石判定 + hard 闸（2026-10-10）
  "check-knowledge-card-references.ts": ["docs", "tests"], // 5.11 卡间引用断链 WARN
  "check-knowledge-anchor-def-kind.ts": ["docs", "tests"],
  "check-knowledge-card-status.ts": ["docs", "tests"],
  "check-knowledge-topkeys.ts": ["docs", "tests"], // P1 顶层键白名单（fail-closed）：schema 外键 ERROR
  "check-knowledge-rename-migration.ts": ["docs", "tests"],
  "check-gen-autogen-stale-cleanup.ts": ["docs", "tests"], // gen-knowledge-autogen：source_files 消失时回收 tests/auto_fields 派生块
  "check-gen-autogen-symbols-cap.ts": ["docs", "tests"], // gen-knowledge-autogen：broad_claim 巨兽卡符号封顶（ADR-338-d2）
  "test_adr_ruling_gate.ts": ["docs", "tests"], // 执行级裁定三问 + add-card-ruling 增量门槛
  "test_commit_message_gate.ts": ["tests"], // ADR-338-d1 刀1：提交信息减负闸（commit-msg 采集期不阻断）
  "check-knowledge-derived-symbol-count.ts": ["docs", "tests"], // 5.14 派生元数据体量护栏（≥100 符号 WARN）
  "check-knowledge-claim-overlap.ts": ["docs", "tests"], // 5.15 跨卡认领重复（≥3 条认领且 0 条独占 WARN）
  "check-knowledge-source-containment.ts": ["docs", "tests"], // 5.16 卡内 source_files 包含冗余（目录吞掉同卡文件条目 WARN）
  "test_check_readme_index.ts": ["docs", "tests"],
  "test_check_stale_test_refs.ts": ["tests", "go", "frontend"], // 陈旧测试引用闸：验 scripts 纯函数 + 全仓生产注释自洽（go/frontend 注释改动即触发）
  "test_check_knowledge_content.ts": ["docs", "tests"], // 知识卡正文机制锚探针（P1 补网）
  // link-checker 扫描域 = git 跟踪 ∩ 可扫（防未跟踪 md 拦住全仓推送）——docs 域变更亦触发
  "test_link_checker_scope.ts": ["docs", "tests"],
  "test_sidebar_gen.ts": ["docs", "tests"],
  "verify-adr-042.ts": ["docs"],
  "test_adr_tiering.ts": ["docs", "tests"], // ADR-320 分级：三区语法 + new-adr 双级 dry-run
  "test_new_knowledge_card.ts": ["docs", "tests"], // new-knowledge-card 模板：kind kebab-case + 无失效占位锚
  "test_commit_version_defense.ts": ["tests"], // ADR-323 阶段 1：pre-commit 版本防御块下沉
  "test_commit_smart_stage.ts": ["tests"], // ADR-323 阶段 2：pre-commit 智能 stage 块下沉
  "test_commit_clean_staged_filter.ts": ["tests"], // ADR-323 阶段 3：未暂存编辑守卫（gofmt/biome 共用）
  "test_commit_staged_domains.ts": ["tests"], // 2026-10-17 pre-commit 变更域裁剪（段序/判据/fail-open/钩子对账）
  // —— data ——
  "test_creators_schema.ts": ["data"],
  "test_resource_schema.ts": ["data"],
  "test_workshop_schema.ts": ["data"],
  // —— go ——
  "test_hash_entry_consumers.ts": ["go"], // 带哈希 seam 调用点分类闸——SCAN_DIRS = internal/app + go/cli（2026-10-16 锐评立项；当日提交漏登记，2026-10-17 补齐）
  "test_cli_completion_parity.ts": ["go"],
  "test_cli_doc_parity.ts": ["go", "docs"],
  "test_config_defaults.ts": ["go"],
  // —— frontend ——
  "test_bus_contract.ts": ["frontend"],
  // check-a11y 覆盖基线守卫（ADR-308 D3）——扫描域为 frontend/src 生产 .ts；
  // 守卫核在 scripts 工具自身（tests 域），同 test_check_menu_test_layout 注记
  "test_check_a11y.ts": ["frontend", "tests"],
  // i18n-ui-check 双通道判据闸（D3 补，2026-10-12）——扫描域为 frontend/src 生产 .ts
  // （判据射程即前端）；守卫核在 scripts 工具自身（tests 域），同 test_check_a11y 注记。
  "test_i18n_ui_check.ts": ["frontend", "tests"],
  // i18n-frozen-t-check 模块级冻结 t() 第五闸（2026-10-13 诊断页锐评 P0 立）——扫描域为
  // frontend/src 生产 .ts 的顶层初始化区（判据射程即前端）；守卫核在 scripts 工具自身
  //（tests 域），同 test_i18n_ui_check 注记。
  "test_i18n_frozen_t_check.ts": ["frontend", "tests"],
  "test_check_ctx_menu_i18n.ts": ["frontend"],
  "test_check_layering.ts": ["frontend"],
  "test_check_menu_health.ts": ["frontend"],
  // ADR-311 菜单测试布局快照闸（check-menu-test-layout）——扫描域为菜单区测试文件，
  // 结论建在前端菜单测试上（frontend 域）；扫描核在 scripts 工具自身（tests 域）
  "test_check_menu_test_layout.ts": ["frontend", "tests"],
  // 2026-10-08 模块级单例卫生闸（check-singleton-hygiene）——扫描域为 frontend/src/preview-3d
  // 生产文件的顶层 let，结论建在前端 3D 域（frontend）；扫描核在 scripts 工具自身（tests 域）
  "test_check_singleton_hygiene.ts": ["frontend", "tests"],
  // 前端 vitest「失败失语」闸（check-vitest-assert-quality，2026-10-25）——扫描域为
  // frontend/src 全部 *.test.ts（结论建在前端测试写法上）；扫描核在 scripts 工具自身（tests 域）
  "test_check_vitest_assert_quality.ts": ["frontend", "tests"],
  // 2026-10-08 Worker 生命周期闸（check-worker-lifecycle，锐评 G2）——扫描域为
  // frontend/src/preview-3d 生产文件的 `new Worker(` 站点，结论建在前端 3D 域（frontend）；
  // 扫描核与基线语义在 scripts/tests 工具侧（tests 域）
  "test_check_worker_lifecycle.ts": ["frontend", "tests"],
  "test_e2e_location_contract.ts": ["frontend"],
  // e2e 浏览器探测（frontend/e2e/browser-path.ts）纯函数核——探测逻辑变更即触发
  "test_e2e_browser_path.ts": ["frontend"],
  "test_html_integrity.ts": ["frontend"],
  // R8 模板闸扫描核（scripts/_lib/innerhtml-hygiene.ts）——纯函数核在 tests 域，
  // 但结论建在前端模板写法上（栅标 frontend 源），故双域。
  "test_innerhtml_hygiene.ts": ["frontend", "tests"],
  "test_i18n_key_naming.ts": ["frontend"],
  // i18n 未使用键：判定层在 scripts（故 tests 域），但结论建在真实语言包键集上
  // （frontend/src/locales/en.ts，故 frontend 域）——改语言包键数应触发本测试。
  "test_i18n_unused.ts": ["frontend", "tests"],
  "test_mock_contract.ts": ["frontend", "go"],
  "test_private_access_contract.ts": ["frontend"],
  // port-align oracle 版本基线断言（P2① 补网）：基线常量在 scripts/port-align.ts（tests 域），
  // 结论建在 TS 坐标端口 cube-mesh/quaternion 的语义上（frontend 域）
  "test_port_align_baseline.ts": ["frontend", "tests"],
  "test_testid_contract.ts": ["frontend"],
  // 验证前端 setup 模块的 vi.hoisted 约束（--coverage 插桩兼容性）
  "test_vitest_coverage_setup.ts": ["frontend", "tests"],
  // —— mixed（跨端契约，任一端变更都触发）——
  "test_android_bridge_contract.ts": ["frontend", "go"],
  "test_apperror_strip.ts": ["go", "frontend"],
  "test_cli_gui_flow_contract.ts": ["go", "frontend"],
  "test_config_syntax.ts": ["go", "frontend"],
  "test_cube_uv_quad_vertex.ts": ["go", "frontend"],
  // —— tests（验证 scripts 工具 / _lib 共享层自身，工具改动 → 全量）——
  "coverage-suggest-hint.ts": ["tests"],
  "go-coverage-hint.ts": ["tests"],
  "bindings-sync-hint.ts": ["tests"],
  "vitest-env-switch.ts": ["tests"],
  "test_alias-resolve.ts": ["tests"],
  // 变更域过滤共享层（--files / --changed）——三个档位扫描器接门禁的增量裁剪唯一实现点
  "test_changed_scope.ts": ["tests"],
  // 变更 diff/内容来源层（ADR-256 行级门禁）——index/range 源 + 提交侧 blob 语义
  "test_diff_source.ts": ["tests"],
  // 行位移幻影率量算（ADR-256 决策依据）——纯分类逻辑
  "test_token_shift_audit.ts": ["tests"],
  // 速查表 pitfalls 列切分（gen-routes-quick.parsePitfall）——产出 docs 产物，docs 域变更亦触发
  "test_gen_routes_quick_pitfall.ts": ["docs", "tests"],
  // 速查表分组封闭词表（gen-routes-quick.render + knowledge-cards.QUICK_GROUPS）——docs 域变更亦触发
  "test_gen_routes_quick_groups.ts": ["docs", "tests"],
  "test_check_path_hygiene.ts": ["frontend", "tests"],
  "test_check_mock_paths.ts": ["frontend", "tests"],
  // 应用配置写唯一实参点（ADR-313）：扫 frontend/src 生产文件的 SaveAppConfig 调点 +
  // import 绑定 + 出口主题字面量——frontend 生产代码变更即须复核
  "test_config_write_single_exit.ts": ["frontend", "tests"],
  // 设置键台账双向对账（锐评 2026-10-15 P1 ②）：扫 frontend/src 全部生产文件的 localStorage
  // 键字面量 + go/types AppConfig 的 json 字段，与 settings-keys.ts 台账两向比对——
  // 新增设置键（前端新增键 / Go 新增配置字段）即须复核，漏登记转红
  "test_settings_key_ledger.ts": ["frontend", "go", "tests"],
  // settings:imported 主题镜像因果链源码锁（二轮锐评 2026-10-17 P2⑧）：锁发射侧
  // settings-backup.ts 的 emit 与消费侧 app-content 订阅回调内的 initTheme 重算——
  // 前端设置导入/生命周期文件变更即须复核
  "test_settings_imported_theme_lock.ts": ["frontend", "tests"],
  // 整合包同步写入口双缓存配对（锐评 2026-10-10）：扫 internal/app 生产文件的
  // ysmsync 写调用点，函数体须配对清 instance+sync 两派生缓存——go 侧同步入口变更即须复核
  "test_sync_write_cache_pairing.ts": ["go", "tests"],
  // 仓库文件写绑定的扫描缓存失效（锐评 2026-10-10 文件操作审计）：扫 internal/app
  // 生产文件的 fileops 写调用点，成功路径须 scanner.Invalidate——go 侧文件绑定变更即须复核
  "test_fileops_write_invalidate.ts": ["go", "tests"],
  // 仓库文件写绑定的标签键跟随+清理（锐评 2026-10-11 收口）：扫 internal/app 生产文件的
  // fileops 写调用点，改名/移动/复制须 relocateTags、删除须 pruneTags——go 侧文件绑定变更即须复核
  "test_fileops_tag_sync.ts": ["go", "tests"],
  // bindings 产物形态 fail-closed 断言（ADR-001 §2）：binding-check 拦「bindings 目录混入
  // .js/.mjs/.cjs」——go 侧绑定面/生成物变更即须复核（绑定面源改动会重跑 generate:bindings）
  "test_binding_check_shape.ts": ["go", "tests"],
  // 随 rtype 联动面板的感知性绑定（2026-10-14 P1b）：扫 frontend/src 生产文件的
  // useCurrentResourceType 调用点，候选面板须含 hidden 守卫 + onShow 句柄（派生 fail-closed，
  // 同 write-surface-gate 范式）——frontend 面板层变更即须复核
  "test_rtype_panel_perceptual_binding.ts": ["frontend", "tests"],
  "test_api_break.ts": ["tests"],
  "test_auto_import.ts": ["tests"],
  // 守卫跨三端：scripts 工具自身 + Go 侧 ADR-047 守卫信号（internal/app）+ 前端黑名单/bindings
  "test_check_android_unavailable.ts": ["tests", "go", "frontend"],
  "test_check_diff_coverage.ts": ["tests"],
  "test_check_go_diff_coverage_skip.ts": ["tests"],
  "test_check_go_diff_coverage.ts": ["tests"],
  "test_diff_coverage_shallow.ts": ["tests"],
  // Go 覆盖率门禁聚合口径（语句加权）——锁「单函数 0% 不拖垮整包」不回归
  "test_check_go_coverage_threshold.ts": ["tests"],
  "test_check_complexity.ts": ["tests"],
  "test_check_type_safety.ts": ["tests"],
  "test_check_params.ts": ["tests"],
  // 改动范围同构同胞提醒探针（P2② 补网）：锁归一化/过滤/阈值三段纯函数核
  "test_check_twin_siblings.ts": ["tests"],
  // 裸标签规则对象是 docs/ markdown → docs 域变更同样触发（同 test_gen_routes_quick_pitfall 口径）
  "test_check_doc_markup.ts": ["docs", "tests"],
  "test_complexity_parity.ts": ["tests", "go"],
  "test_codemod_guards.ts": ["tests"],
  "test_collect_scripts_lib.ts": ["tests"],
  "test_commit_check_gate.ts": ["tests"],
  "test_commit_temp_index.ts": ["tests"],
  "test_contract_domain_select.ts": ["tests"],
  // 契约 runner 的 @/ 别名运行时解析基建（ts-alias-register/resolver + alias-resolve 表 + runner 接线）
  "test_contract_alias_runtime.ts": ["tests"],
  // CI 工作流必须走 contract-tests 统一入口（禁裸跑 tests/*.ts——裸跑缺别名注入）
  // 注：workflow-only 改动归 other 域，byDomain 不含本测试——精确裁剪下 .github/workflows/
  // 哨兵为死键；兜底 = workflow 变更触发 pages workflow 全量跑契约测试（含本守卫）。
  // 勿挂 other：selectContractTests(["other"]) 零触发是既有契约（test_contract_domain_select）。
  "test_workflow_contract_runner.ts": ["tests"],
  // CI 工作流关键顺序不变量（R1-R5，2026-10-08 门禁锐评落地）——文本层静态扫描，
  // 域/触发口径与 test_workflow_contract_runner.ts 完全一致（workflow 变更 → CI pages 全量兜底）。
  "test_workflow_contract_order.ts": ["tests"],
  // docs frontmatter / workflow YAML 完整语法+结构校验（2026-10-08 P0 落地，vendored yaml）——
  // 扫 docs 全部 frontmatter + .github/workflows|actions；docs 或 workflow 任一改动即触发
  "test_knowledge_frontmatter_yaml.ts": ["docs", "tests"],
  // 构建/工具配置（vite.*.config.* / knip.json）声明的入口文件必须存在
  "test_build_entry_refs.ts": ["frontend", "tests"],
  "test_check_boolean_smart.ts": ["tests", "frontend"],
  "test_deadcode_attrib.ts": ["tests"],
  // 基线键派生单源（2026-10-08 技术债审计）：knip duplicates 嵌套数组对 / jscpd toPosix 归一，
  // 空名残渣键回归锁。消费方 = check-deadcode-baseline + _lib/deadcode-keys + knip.json。
  "test_deadcode_keys.ts": ["tests"],
  "test_domain_classify.ts": ["tests"],
  "test_gen_stage.ts": ["tests"],
  "test_machine_diff.ts": ["tests"],
  "test_gate_config.ts": ["tests"],
  "test_gate_ctx.ts": ["tests"],
  "test_gate_iife_correctness.ts": ["tests"],
  "test_gate_parse_output.ts": ["tests"],
  "test_gate_coverage.ts": ["tests"],
  "test_gate_debt.ts": ["tests"],
  // 基线守卫单一实现（锐评第二刀）：假绿第一大类的判据共源 + wiring 反向锚
  "test_baseline_guard.ts": ["tests"],
  // 生成物引用完整性（锐评第三刀）：聚合生成物引用未入库文件 ⇒ 拒收编（并行会话卷带第二道门）
  "test_gen_ref_integrity.ts": ["tests"],
  // 存量债到期报告（ADR-256-d1 收口刀）：呈现层三形态 + CI 接线反向锚
  "test_debt_report.ts": ["tests"],
  // 审计时效判定（锐评第四刀）：审查器降噪内核 + fail-closed 边界
  "test_audit_freshness.ts": ["tests"],
  "test_gate_audit.ts": ["tests"],
  // ADR-232 并发竞态/审计留痕/退化降级三方向的可注入纯逻辑
  "test_hooks_concurrency.ts": ["tests"],
  // ADR-234 D2：15 gen 输出文件两两不相交（并行写盘安全不变量）
  "test_gen_parallel.ts": ["tests"],
  "test_gate_static_tools.ts": ["tests"],
  "test_gate_domains.ts": ["tests"],
  "test_gate_schedule.ts": ["tests"],
  // 工具二进制双根探测（CI 只在 frontend/ 装依赖 ⇒ 单路径硬编码 = 本地绿 CI 红）
  "test_tool_bin.ts": ["tests"],
  // 2026-09-14 锐评修复回归锁：css-layer-check 的 TS 插值展开（keyframes 假阳性根治）
  "test_css_layer_check.ts": ["tests", "frontend"],
  // 设计令牌守规判定层（design-tokens.ts）：违规识别语义 + TOKEN_PX_BASELINE 与
  // variables.css 对账 + UI-Design.md 数值漂移。前端 UI 规范与前端源码变更都应触发。
  "test_design_tokens.ts": ["tests", "frontend"],
  "test_ui_icons.ts": ["tests", "frontend"],
  "test_gate_policy_baseline.ts": ["tests"],
  "test_gate_report.ts": ["tests"],
  "test_gate_sh_invariants.ts": ["tests"],
  "test_jscpd_go_smart.ts": ["tests", "go"],
  "test_jscpd_pairs.ts": ["tests"],
  "test_knowledge_common.ts": ["tests"],
  "test_redlines_changed_files.ts": ["tests"],
  // 基线键构造双向契约（2026-10-15 随「行号漂移误报」根治登记）：漂移不误报 / 真新增不漏放 /
  // 同内容多重集不被去重吞掉——collectViolationKeys 是这两个方向唯一实现点
  "test_redlines_baseline_keys.ts": ["tests"],
  // R15 纯核（redlineCodeGapHits）判别力对账：两侧解析（CODE_KEYS 映射集 / types.go
  // 常量表）任一退化即假绿——独立重导逐行等值锁死（2026-10-12 随 R15 立法登记）
  "test_redlines_code_gap.ts": ["tests"],
  "test_scripts_json.ts": ["tests"],
  "test_scripts_lib.ts": ["tests"],
  "test_orphan_exports_smart.ts": ["tests", "frontend"],
  "test_scan_files_shared.ts": ["tests"],
  "test_git_ref.ts": ["tests"],
  "test_contract_tests.ts": ["tests"],
  "test_ripgrep_contract.ts": ["tests"],
  "test_gate_fallback.ts": ["tests"],
  // 双表一致性守卫（缺陷#2，ADR-234）：锁 CONTRACT_TEST_DOMAINS / CONTRACT_TEST_TARGETS
  // 两表的键集合关系——TARGETS 键必须 ∈ DOMAINS；含 tests 域的测试必须登记 TARGETS。
  "test_contract_tables_consistency.ts": ["tests"],
};

