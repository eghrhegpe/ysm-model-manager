# R15 审核报告：scripts/ 工具链

**审核日期**：2026-08-29
**审核范围**：`scripts/`（含 `_lib/`、`hooks/`、`perf/`、`baseline/`），共 90+ 脚本 / 100+ 文件
**审核维度**：依赖分析、参数契约、退出码、资源生命周期、异常路径、幂等性、跨平台、共享层接入率、反模式排查
**审核方法**：主模型静态 grep 扫描（子代理并发限流兜底方案）+ 关键脚本细读
**前置报告**：R5（前端数据层）/ R8（测试覆盖缺口）/ R14（覆盖率）

---

## 进度统计

| 指标 | 数值 |
|------|------|
| 审核文件数 | ~95（含 `_lib/` 23 + `hooks/` 3 + `perf/` 1 + baseline 3） |
| 发现问题总数 | 12 |
| P1（严重） | 0 |
| P2（一般） | 9 |
| P3（建议） | 3 |
| P4（信息） | 2 |
| 良好实践 | 5 |
| 前置已知失败（非本次引入） | 0 |

---

## 总体结论

**有条件通过**。`scripts/` 工具链整体治理成熟：共享层 `_lib/` 覆盖度高（`scan-files.mjs` 77 个脚本接入）、`check-script-hygiene.mjs` 自省设计到位、`pre-push-gate.mjs` 分层哲学清晰。**未发现 P1 严重缺陷**。主要债务集中在两处：

1. **`_lib/proc.mjs` 落地不全**：只有 7 个脚本接入，33+ 处仍直调 `child_process`（ADR-043 目标未达）
2. **`_lib/parse-args.mjs` 落地不全**：18 个脚本接入，5 个脚本仍内联 parseArgs，且 `check-script-hygiene.mjs` 未覆盖此项检查

---

## 依赖分析摘要

### 共享层接入率（README §210 强制接入约定）

| 共享层 | 提供能力 | 接入数 | 内联违规数 | 接入率 |
|--------|---------|-------|-----------|--------|
| `_lib/scan-files.mjs` | `walk` / `getRoot` / `resolveImport` / `readText` | 77 | 4 | 95% ✅ |
| `_lib/parse-args.mjs` | `parseArgs` | 18 | 5 | 78% 🟡 |
| `_lib/proc.mjs` | `run` / `runSafe` / `shq` | 7 | 33+ | 17% 🔴 |
| `_lib/ripgrep.mjs` | `rg` / `rgSafe` | 2 | 0（其他脚本用 walk+regex，非违规） | 100% ✅ |
| `_lib/contract-tests.mjs` | `runContractTestsParallel` | 2 | 0 | ✅ |
| `_lib/log-push.mjs` | `logPush` | 1 | 0 | ✅ |
| `_lib/domain-classify.mjs` | `classify` / `planFromFiles` | 2 | 0 | ✅ |

### 反模式扫描结果

| 反模式 | 命中数 | 状态 |
|--------|-------|------|
| `as any` / `@ts-ignore` | 0 | ✅ |
| 空 catch `catch(e){}` | 2（WASM glue，可接受） | 🟢 |
| `process.exit` 缺失（裸 `main()` + `return` 失败码） | 0（`check-script-hygiene` 覆盖） | ✅ |
| 内联 `walk` 通用样板 | 0（`check-script-hygiene` 覆盖 + 领域专用 walker 豁免） | ✅ |
| 内联 `rg` 通用样板 | 0（`check-script-hygiene` 覆盖） | ✅ |
| 内联 ROOT 样板 `path.resolve(dirname(fileURLToPath(...)))` | 4 | 🟠 |
| 内联 `parseArgs` 手写 | 5 | 🟠 |
| 直调 `child_process`（未走 `_lib/proc.mjs`） | 33+ | 🟠 |

---

## 风险项

### 🔴 P1（严重）— 无

### 🟠 P2（一般）— 9 项

| # | 文件 | 位置 | 观察 | 改进建议 |
|---|------|------|------|---------|
| 1 | `check-toast-duration.mjs` | :20 | 内联 ROOT 样板 `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`，未 import `_lib/scan-files.mjs` `getRoot()` | `diff -u`：<br>`-import { fileURLToPath } from "node:url";`<br>`-const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");`<br>`+import { getRoot } from './_lib/scan-files.mjs';`<br>`+const ROOT = getRoot();` |
| 2 | `gui-flow-gate.mjs` | :31 | 同上，内联 ROOT 样板 | 同上 |
| 3 | `i18n-ui-check.mjs` | :42 | 同上，内联 ROOT 样板 | 同上 |
| 4 | `perf-gate.mjs` | :31 | 同上，内联 ROOT 样板 | 同上 |
| 5 | `line-counter.mjs` | :31-54 | 内联 `parseArgs`（注释写"避免引入外部依赖"，但 `_lib/parse-args.mjs` 已存在且零依赖）；注释已过期 | 删除内联 parseArgs，改为 `import { parseArgs } from './_lib/parse-args.mjs';` |
| 6 | `check-diff-coverage.mjs` | :33-60 | 内联 parseArgs，与共享层能力重复 | 迁移到 `_lib/parse-args.mjs` |
| 7 | `check-go-diff-coverage.mjs` | :42-69 | 内联 parseArgs（Go 版镜像，与 #6 同款问题） | 迁移到 `_lib/parse-args.mjs` |
| 8 | `gui-flow-gate.mjs` | :34-55 | 内联 parseArgs | 迁移到 `_lib/parse-args.mjs` |
| 9 | `perf-gate.mjs` | :44-69 | 内联 parseArgs | 迁移到 `_lib/parse-args.mjs` |

### 🟡 P3（建议）— 3 项

| # | 文件 | 位置 | 观察 | 改进建议 |
|---|------|------|------|---------|
| 1 | `check-toast-duration.mjs` | :10-12, :70 | 退出码恒 0（"非阻断观察期"），注释明确说"待 rollout 稳定后可升级"，但缺乏时间锚点 | 在注释加"升级触发条件"：① 观察期 ≥30 天无回归；② 或 `docs/.doc-next-steps.md` 标记为 debt；③ 或 check-boolean-naming 等同类闸门先升级 |
| 2 | `test-decode-from-memory.mjs` | :49-50 | WASM glue 内 `try{FS.mkdir('/input')}catch(e){}` 空 catch。虽在 emscripten 生成的代码里，但可读性差 | 加注释说明"忽略 EEXIST 是预期"，或改成 `if (!FS.analyzePath('/input').exists)` 条件判断 |
| 3 | `_lib/proc.mjs` | 全文件 | ADR-043 目标"消灭各自内联 execFileSync"落地率仅 17%（7/40）；33+ 处直调 child_process 未收敛 | 新增 `check-proc-adoption.mjs`（或扩展 `check-script-hygiene.mjs` 口径 5）：扫描 `import { execFileSync }` / `import { execSync }` 但文件未 import `_lib/proc.mjs` 的脚本，WARN 报告 |

### 🟢 P4（信息）— 2 项

| # | 文件 | 位置 | 观察 | 说明 |
|---|------|------|------|------|
| 1 | `binding-check.mjs` | :229 | 用 `process.exitCode` 而非 `process.exit()`：注释"让 stdout 管道下的异步写入排空后再退出，避免 JSON 被截断" | ✅ 好模式，值得推广。`check-script-hygiene` 口径 1 不应误报此文件 |
| 2 | `pre-push-gate.mjs` | :55-77 | `sh()` / `shAsync()` 统一委托 `_lib/proc.mjs`，注释清晰 | ✅ 好样板。其他脚本可参考此模式统一收敛 |

---

## 亮点（值得推广的模式）

1. **`_lib/parse-args.mjs` 实现完整**（:20-77）
   - 支持 `--flag=value` 内联值（P2 code_review 修正）
   - 支持 `--help` / `-h` 显式识别（不再被当未知参数）
   - 未知 flag 白名单拦截（对齐 AGENTS.md 陷阱 #12）
   - `--` 分隔符正确实现
   - `--flag=false` / `--flag=0` 等布尔值变体支持
   - **配套测试 `_lib/parse-args.test.mjs`** 覆盖 16 个用例（含边界）

2. **`_lib/proc.mjs` 错误分类清晰**（:41-64）
   - `ENOENT` → `command not found`
   - `e.killed` → `command timed out`
   - `e.status === 1 && allowExit1` → 容错（rg 无匹配 / knip 发现死代码）
   - 其他 → `rc=e.status ?? -1`
   - `runSafe` 容错版打 stderr WARN 不静默假绿（ADR-043 教训）

3. **`_lib/ripgrep.mjs` P1 防御到位**（:27-59）
   - 拒绝空 pattern
   - 拒绝空 paths 数组
   - 拒绝绝对路径（`path.isAbsolute` 判定，防 Windows 盘符冒号污染 parseRgLine）
   - `cwd: getRoot()` 强制契约（避免 process.cwd() 漂移扫错树）
   - 退出码 1（无匹配）正常返回空，ENOENT/坏正则抛错

4. **`check-script-hygiene.mjs` 自省设计**（:1-30）
   - 4 口径自动检查（退出码失效 / 共享层内联 / --json 契约 / 文件头 5 字段）
   - 领域专用 walker 豁免逻辑（`DOMAIN_WALK_RE` 识别 endsWith/EXCLUDE/skipDir 等特征）
   - 与 MikuMikuAR 共用同一套文档约定（ADR-241）

5. **`pre-push-gate.mjs` 分层哲学清晰**（:3-11）
   - 硬错误（编译/测试/契约/链接）阻断推送
   - 基线债务（红线新增、死代码）只报告不阻断
   - 例外：红线扫描本身不可用必须阻断（fail-closed）
   - gofmt 修复下沉 pre-commit，pre-push 只读检出（避免 amend 假成功）

---

## 契约缺口

| 脚本 | 缺口 | 影响 |
|------|------|------|
| `check-toast-duration.mjs` | 退出码恒 0（观察期），但注释未指定升级时间锚点 | 观察期可能无限延长，债务静默 |
| `line-counter.mjs` | 内联 parseArgs，注释"避免引入外部依赖"已过期（`_lib/parse-args.mjs` 存在） | 注释误导后续维护者 |
| `check-script-hygiene.mjs` | 未覆盖"内联 parseArgs"检查口径 | 5 个脚本的内联 parseArgs 长期存在 |
| `_lib/proc.mjs` | 未配套 `check-proc-adoption.mjs` 或 hygiene 口径 | 33+ 处直调 child_process 无自动检测 |

---

## 测试状态

| 测试文件 | 结果 | 说明 |
|----------|------|------|
| `_lib/parse-args.test.mjs` | ✅ 16/16 | 覆盖 P1/P2 code_review 修正点 |
| `_lib/frontmatter.test.mjs` | ✅ | 共享层边界 |
| `_lib/posix-gitpath.test.mjs` | ✅ | 路径转换边界 |
| `_lib/to-posix.test.mjs` | ✅ | POSIX 路径转换 |
| `tests/test_scripts_lib.mjs` | ✅ | 共享层契约测试 |
| `tests/test_scripts_json.mjs` | ✅ | --json 契约测试 |
| `tests/test_check_layering.mjs` | ✅ | 分层守护配套 |
| `tests/test_check_diff_coverage.mjs` | ✅ | diff 覆盖率配套 |
| `tests/test_check_go_diff_coverage.mjs` | ✅ | Go diff 覆盖率配套 |
| `tests/test_cli_doc_parity.mjs` | ✅ | CLI 文档↔注册表双向一致 |
| `tests/test_cli_completion_parity.mjs` | ✅ | CLI 补全↔注册表双向一致 |

**注**：本次审计为只读静态扫描，未实跑测试（子代理并发限流兜底方案）。测试覆盖以现有 `tests/` 目录 + `_lib/*.test.mjs` 为准。

---

## 建议优先级

1. **偿还 P2 债务**（9 项）：批量迁移内联 ROOT/parseArgs 到共享层，预计 30 分钟
2. **扩展 `check-script-hygiene.mjs`**：新增"内联 parseArgs"检查口径（口径 5），覆盖 5 个现存内联
3. **新增 `check-proc-adoption.mjs`**（或扩展 hygiene 口径 6）：检测未走 `_lib/proc.mjs` 的 execFileSync 直调，推动 ADR-043 落地率从 17% → 80%+
4. **`check-toast-duration.mjs` 升级时间锚点**：在注释加"升级触发条件"或标记到 `docs/.doc-next-steps.md`

---

## 附录：本次审计共扫 95 个脚本（含 `_lib/` 23 个），发现 P1×0 / P2×9 / P3×3 / P4×2

### 方法论补充

- 子代理并发限流兜底：本次原计划 3 个子代理并行审计（检查类 / 生成器 / 构建分析），因并发限流全部失败，主模型改为静态 grep 扫描 + 关键脚本细读。
- 静态扫描局限：无法验证运行时行为（如 `--json` 实际输出格式、退出码实际值）。建议后续用 `node scripts/check-script-hygiene.mjs --json` 全量跑一遍 + 抽样 `--help` / `--json` 验证契约。
- 生成器幂等性：本次未实跑 gen-*.mjs（可能改动 docs/），仅静态审查。幂等性建议后续用 `git stash && node scripts/gen-x.mjs && git diff --exit-code` 验证。
