# 契约测试现状查证（任务 #1 交付物）

> 查证日期：2026-09（兄弟 AI 会话额度耗尽，本会话接手）
> 结论基础：逐一通读 `tests/*.ts` 全部 45 个文件头部 + 源码 `scripts/_lib/domain-classify.ts` / `scripts/_lib/contract-tests.ts` / `scripts/pre-push-gate.ts` / `scripts/doctor.ts`

## 一、执行点（runContractTests 全量执行）

| 入口 | 触发 | 契约测试行为 |
|------|------|--------------|
| `pre-push-gate.ts:553` | `plan.contractTests === true` | `runContractTests()` → `runContractTestsParallel()` 全量并行 |
| `doctor --all --dry-run`（默认） | plan 全 true | 全量 45 个 |
| `doctor --docs --dry-run` | `contractTests=false` | 不跑 |
| `doctor --gate` | push 分支（stdin 驱动） | 按变更域 |
| `commit-with-check --files` | `--files <paths>` → `planFromFiles` | 按变更域 |

- 收集器 `collectContractTests()`：`tests/` 下非 `_` 前缀的 `.ts`，现 **45 个**（含 6 个非 `test_` 前缀：`check-knowledge-*.ts`×3、`coverage-suggest-hint.ts`、`go-coverage-hint.ts`、`verify-adr-042.ts`）。
- 历史口径：docs 多处写 "8 个 .mjs"（迁移前）；`fe11e0d3` 完成 `.mjs→.ts` 全量迁移；任务描述 "44" ≈ 迁移后计数差。

## 二、planFromFiles 触发逻辑（粗粒度现状）

`classify(f)`（domain-classify.ts:40）：
- `.go` / `go.mod` / `go.sum` → `go`
- `wails.json` / `frontend/` → `frontend`
- `DATA_FILES`（resource_types/creators/workshop_sites/workshop-github）→ `data`
- `docs/` 或 `.md` → `docs`
- `tests/` 或 `scripts/` → `tests`  ← **关键：契约测试触发只看这个**
- 其他 → `other`

`planFromFiles`：`d === 'tests'` → `contractTests=true`。
**现状缺陷**：go/frontend/data/docs 纯变更 → 契约测试一个都不跑（错失相关契约守护）；scripts/tests 任意变更 → 45 个全跑（不过滤）。

## 三、45 个契约测试的验证域覆盖表（#2 映射表事实来源）

验证域约定：`go` / `frontend` / `data` / `docs` / `scripts`（治理工具/共享层自身）。`mixed` = 跨端契约（任一端变更都应触发）。

| 文件 | 验证对象 | 验证域 |
|------|----------|--------|
| check-knowledge-drift-affected.ts | 知识卡漂移 --affected 主动防御 | docs |
| check-knowledge-hook.ts | 知识卡钩子（prepare-commit-msg） | docs |
| check-knowledge-perf-tags.ts | 知识卡 perf 标签词表 | docs |
| coverage-suggest-hint.ts | 覆盖率建议钩子 | scripts |
| go-coverage-hint.ts | Go 覆盖率钩子纯函数 | scripts |
| test_alias-resolve.ts | _lib/alias-resolve（ADR-146 闸二） | scripts |
| test_android_bridge_contract.ts | 安卓桥注入时序（platform.ts+MainActivity） | mixed(go/frontend) |
| test_api_break.ts | api-break 跨 ref 破坏性检测 | scripts |
| test_auto_import.ts | auto-import 拆分模块 | scripts |
| test_bus_contract.ts | event-graph 守卫 bus.ts | frontend |
| test_check_ctx_menu_i18n.ts | 右键菜单 i18n key 门禁 | frontend |
| test_check_diff_coverage.ts | check-diff-coverage 纯函数 | scripts |
| test_check_go_diff_coverage_skip.ts | Go diff-coverage 平台豁免 | scripts |
| test_check_go_diff_coverage.ts | check-go-diff-coverage 纯函数 | scripts |
| test_check_layering.ts | 前端分层守护 | frontend |
| test_check_menu_health.ts | 菜单表健康门禁 | frontend |
| test_check_readme_index.ts | README 索引对账 | docs |
| test_cli_completion_parity.ts | CLI 注册表 ↔ shell 补全 | go |
| test_cli_doc_parity.ts | CLI 注册表 ↔ cli-commands.md | go |
| test_cli_gui_flow_contract.ts | Go CLI 输出 ↔ 前端解析正则 | mixed(go/frontend) |
| test_codemod_guards.ts | codemod 守卫 + binding-check | scripts |
| test_collect_scripts_lib.ts | _lib/collect-scripts | scripts |
| test_commit_temp_index.ts | commit-temp-index（ADR-151） | scripts |
| test_config_defaults.ts | AppConfig JSON ↔ Go types | go |
| test_config_syntax.ts | wails.json + go.mod 语法 | mixed(go/frontend) |
| test_creators_schema.ts | creators.json schema | data |
| test_cube_uv_quad_vertex.ts | cube-mesh expandBoxUV ↔ Go | mixed(go/frontend) |
| test_deadcode_attrib.ts | _lib/deadcode-attrib | scripts |
| test_domain_classify.ts | _lib/domain-classify（本层自身） | scripts |
| test_e2e_location_contract.ts | e2e 定位通道（testid） | frontend |
| test_gen_stage.ts | _lib/gen-stage（ADR-152） | scripts |
| test_html_integrity.ts | frontend/index.html 引用 | frontend |
| test_i18n_key_naming.ts | i18n-key-naming（ADR-124） | frontend |
| test_jscpd_pairs.ts | _lib/jscpd-pairs（ADR-144） | scripts |
| test_mock_contract.ts | mock-data ↔ Wails binding | frontend |
| test_private_access_contract.ts | app-tree 私有断言孤儿守卫 | frontend |
| test_redlines_changed_files.ts | check-redlines --files 过滤 | scripts |
| test_resource_schema.ts | resource_types.json schema | data |
| test_rust_bridge_tags.ts | Rust bridge 跨平台 build tag | go |
| test_scripts_json.ts | 治理脚本 --json 契约 | scripts |
| test_scripts_lib.ts | _lib/scan-files | scripts |
| test_sidebar_gen.ts | gen-vitepress-sidebar | docs |
| test_testid_contract.ts | data-testid 消费性校验（ADR-133） | frontend |
| test_workshop_schema.ts | workshop_sites.json schema | data |
| verify-adr-042.ts | ADR-042 四项落地 | docs |

### 分布统计

- **scripts**（治理工具/共享层自身）：20 个
- **frontend**：12 个（+4 个 mixed 含 frontend）
- **go**：5 个（+4 个 mixed 含 go）
- **docs**：6 个
- **data**：3 个
- **mixed(go/frontend)**：4 个（android_bridge / cli_gui_flow / config_syntax / cube_uv）

## 四、#2 设计依据（要点）

1. 映射表落点：`scripts/_lib/contract-tests.ts`（收集器同一文件，单一事实源），导出 `CONTRACT_TEST_DOMAINS`。
2. 触发规则（向 pre-push-gate 与 doctor 共用）：
   - 变更域含 `tests`/`scripts`（改工具自身）→ **全量**（工具改动影响面大，不可裁剪）。
   - 变更域为 go/frontend/data/docs → 跑**验证域交集匹配**的子集（含 mixed 测试——任一端变更都触发）。
   - 兼有多个域 → 各域子集并集。
3. 实现：`runContractTestsParallel(files?: string[])` 接收可选子集；新增 `selectContractTests(plan): string[]` 纯函数（可被 test 锁定）。
4. 不动 `tests/*.ts` 内容（CI 红线：契约测试禁改）；仅新增裁剪逻辑。
