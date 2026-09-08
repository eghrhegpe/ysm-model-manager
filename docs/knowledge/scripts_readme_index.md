---
kind: scripts_readme_index
name: README 登记处对账 check-readme-index.ts
tier: architecture
category: config
source_files:
  - scripts/check-readme-index.ts
auto_fields:
  symbols_with_lines:
    - assertionViolations
    - duplicateRegistrations
    - findReadmeRow
    - ghostReferences
    - missingFromReadme
    - README_ASSERTIONS
    - ReadmeAssertion
use_when:
  - README
  - 脚本索引
  - 登记处
  - check-readme-index
  - 脚本漂移
  - 脚本对账
  - 重复登记
  - 幽灵引用
pitfalls:
  - 新增脚本后忘记在 README.md 登记 → check-readme-index 阻断推送（exit 1）
  - README 只写脚本名前缀（如 `doctor` 而非 `doctor.ts`）→ 前缀匹配不够，必须精确匹配 basename
  - 脚本改名后未同步更新 README → 旧名不匹配，新名未登记，产生漂移
  - 误把 `_lib/` 共享层或测试文件当作需要登记的脚本（它们被排除在外）
  - 删除脚本时简单删行而非移入「已删除」区 → 与磁盘状态不一致导致误报
  - 同一脚本在登记性表格（第一列）出现 ≥2 行 → duplicateRegistrations 报重复登记（check-go-coverage-threshold 曾错放生成器表）
  - 已删脚本名仍在「已删除」区块之外被引用 → ghostReferences 报幽灵引用（event-audit 曾残留于检查类定义与一致性校验表）
quick_groups:
  - 脚本治理与文档一致性
quick_intents:
  - 检查哪些脚本未登记在 README
  - 验证新增脚本是否已正确登记
  - 修复登记漂移（补全缺失的登记）
  - CI/CD 门禁中校验 README 完整性
quick_risk_lines:
  - 新增/改名/删除 scripts/ 下的脚本必须同步更新 scripts/README.md
  - README 是唯一事实源，AGENTS.md 工具口令表只是指针
invariant_anchors:
  - scripts/check-readme-index.ts|missingFromReadme
  - scripts/_lib/collect-scripts.ts|collectScripts
affected: false
perf:
  - single-thread
status: active
---

# README 登记处对账 check-readme-index.ts

## 概览

`scripts/README.md` 自称「所有 Node 工具脚本的索引」「治理检查（check-* 系列；唯一登记处）」，但历史上没有任何机器对账——新增/改名脚本后忘记登记 README 不会被任何门禁拦下。2026-08-31 审计实测：93 个脚本中 **29 个零提及**，包括 `commit-with-check` / `gen-routes` / `generate-locale-json` 等高频货（且 `generate-locale-json` 已被 pre-commit GEN_CMDS 调用却不在索引里）。

`check-readme-index.ts` 把「README 必须提及每个脚本」固化为卡点：零提及 → 阻断。与 `check-workflow-refs`（守 workflow 引用侧）形成**引用侧 + 登记侧**双守护。

## 核心职责

- **对账**：通过 `_lib/collect-scripts.ts` 的 `collectScripts()` 收集 `scripts/` 下 .ts（含 `hooks/` 子目录，排除 `_lib` 共享层与 `.test.ts`；2026-09 起由共享层提供，与 check-proc-adoption / check-script-hygiene 同源），与 `scripts/README.md` 全文比对，脚本 basename（含 `.ts`）未在 README 出现 → 零提及。
- **判定口径**：basename 精确匹配（非前缀）——README 表格列出的就是 basename，且覆盖正文/口令表引用。`doctor.ts` 不会被 `doctor-x.ts` 误判为已登记。
- **登记处自洽（2026-09 锐评三刀 #4 新增）**：除「零提及」外，再查 README 自身漂移——
  - `duplicateRegistrations`：同一脚本 basename 出现在「登记性表格第一列」≥2 行 → 重复登记（只数第一列 `| \`xxx.ts\` | 说明 |`；映射表如治理红线/一致性校验里工具在第二列、正文提及，均不算登记；ps1/sh 同名不同扩展名是不同脚本不误报）。
  - `ghostReferences`：「已删除」区块登记过的脚本名，若在区块之外仍被引用（完整名或词干，如 `event-audit` 命中 `event-audit.mjs`）→ 幽灵引用；区块自身登记行与其「接管者」提及不算幽灵。
- **阻断**：存在零提及脚本 → 退出码 1（ERROR 级），默认模式即阻断（与 check-workflow-refs 同款）；重复登记/幽灵引用同样 exit 1。
- **`--json` 契约**：输出 `_summary: { scripts, registered, missing, assertionViolations, duplicates, ghosts, ok }` + `missing` / `duplicates` / `ghosts` 清单，供 pre-push-gate / doctor / 子代理稳定消费。
- **纯函数**：`missingFromReadme(files, readmeText)` / `duplicateRegistrations(readmeText)` / `ghostReferences(readmeText)` / `assertionViolations(readmeText)` 导出供契约测试复用。

## 对外 API / 入口

```bash
node scripts/check-readme-index.ts           # 文本报告（有零提及 → exit 1）
node scripts/check-readme-index.ts --json    # JSON（CI / doctor 消费）
```

```js
import { missingFromReadme } from './check-readme-index.ts';
const missing = missingFromReadme(['doctor.ts', 'gen-routes.ts'], readmeText);
// → ['gen-routes.ts']（README 未提及则报缺失）
```

## 与其他子系统关系

- `scripts/README.md`：被对账的登记处本体。**新增脚本后必须登记 README**，否则本 check 阻断。
- `scripts/pre-push-gate.ts`：挂载于 `ALL_STATIC_TOOLS`（--all 全量）+ `DOC_STATIC_TOOLS`（--docs / docs 域 push）两处。
- `scripts/check-workflow-refs.ts`：姊妹闸——它守 `.github/workflows/*.yml` 引用的脚本存在性，本 check 守 README 登记完整性。
- `scripts/check-script-hygiene.ts`：同为脚本体系卫生闸，五口径（退出码 / 共享层内联 / --json 契约 / 文件头 5 字段 / parse-args），不覆盖 README 登记。
- `tests/test_check_readme_index.ts`：契约测试（覆盖：纯函数判定 / hooks 子目录 / 前缀不误判 / 全量 0 缺失 / 拦截路径 / duplicateRegistrations 同区块重复与跨区块不误报 / ghostReferences 幽灵与接管者不误报 / 全量 0 重复 0 幽灵）。
- `docs/knowledge/scripts_argv.md`：姊妹治理卡——脚本 argv 走 parse-args 的规范；本卡负责登记侧。

## 不变量

- **每个 scripts/*.ts（含 hooks/）必须在 README 出现**，否则 `check-readme-index.ts` 退出 1 阻断推送。
- **`_lib/` 与测试豁免**：共享层与 `.test.ts` 不要求登记（README 明确排除）。
- **登记处是唯一事实源**：AGENTS.md 工具口令表只是指针，脚本索引以 `scripts/README.md` 为准。
- **登记性表格第一列唯一**：同一脚本 basename 不得在登记性表格第一列出现 ≥2 行（映射表/正文豁免）。
- **已删脚本不得幽灵引用**：「已删除」区块登记的脚本名不得在区块外仍被引用（完整名或词干）。
- **修复方式**：漏登 → 补 README 表格行（含调用方式 + 说明）；改名/删除 → 同步 README（已删除脚本按惯例移入「已删除」区）；重复登记 → 删多余行保留唯一登记；幽灵引用 → 改为接管者脚本名。

## 相关

- `scripts/check-readme-index.ts`（本卡 source）
- `scripts/README.md`（被对账的登记处）
- `scripts/pre-push-gate.ts`（门禁挂载）
- `tests/test_check_readme_index.ts`（契约测试）
- `docs/knowledge/scripts_argv.md`（姊妹治理卡：argv 规范）
