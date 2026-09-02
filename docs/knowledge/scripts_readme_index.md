---
kind: scripts_readme_index
name: README 登记处对账 check-readme-index.mjs
tier: architecture
category: config
source_files:
  - scripts/check-readme-index.ts
use_when:
  - README
  - 脚本索引
  - 登记处
  - 脚本登记
  - check-readme-index
  - 脚本漂移
  - 脚本对账
status: active
---

# README 登记处对账 check-readme-index.mjs

## 概览

`scripts/README.md` 自称「所有 Node 工具脚本的索引」「治理检查（check-* 系列；唯一登记处）」，但历史上没有任何机器对账——新增/改名脚本后忘记登记 README 不会被任何门禁拦下。2026-08-31 审计实测：93 个脚本中 **29 个零提及**，包括 `commit-with-check` / `gen-routes` / `generate-locale-json` 等高频货（且 `generate-locale-json` 已被 pre-commit GEN_CMDS 调用却不在索引里）。

`check-readme-index.mjs` 把「README 必须提及每个脚本」固化为卡点：零提及 → 阻断。与 `check-workflow-refs`（守 workflow 引用侧）形成**引用侧 + 登记侧**双守护。

## 核心职责

- **对账**：通过 `_lib/collect-scripts.ts` 的 `collectScripts()` 收集 `scripts/` 下 .mjs（含 `hooks/` 子目录，排除 `_lib` 共享层与 `.test.mjs`；2026-09 起由共享层提供，与 check-proc-adoption / check-script-hygiene 同源），与 `scripts/README.md` 全文比对，脚本 basename（含 `.mjs`）未在 README 出现 → 零提及。
- **判定口径**：basename 精确匹配（非前缀）——README 表格列出的就是 basename，且覆盖正文/口令表引用。`doctor.mjs` 不会被 `doctor-x.mjs` 误判为已登记。
- **阻断**：存在零提及脚本 → 退出码 1（ERROR 级），默认模式即阻断（与 check-workflow-refs 同款）。
- **`--json` 契约**：输出 `_summary: { scripts, registered, missing }` + `missing` 清单，供 pre-push-gate / doctor / 子代理稳定消费。
- **纯函数**：`missingFromReadme(files, readmeText)` 导出供契约测试复用。

## 对外 API / 入口

```bash
node scripts/check-readme-index.ts           # 文本报告（有零提及 → exit 1）
node scripts/check-readme-index.ts --json    # JSON（CI / doctor 消费）
```

```js
import { missingFromReadme } from './check-readme-index.mjs';
const missing = missingFromReadme(['doctor.mjs', 'gen-routes.mjs'], readmeText);
// → ['gen-routes.mjs']（README 未提及则报缺失）
```

## 与其他子系统关系

- `scripts/README.md`：被对账的登记处本体。**新增脚本后必须登记 README**，否则本 check 阻断。
- `scripts/pre-push-gate.ts`：挂载于 `ALL_STATIC_TOOLS`（--all 全量）+ `DOC_STATIC_TOOLS`（--docs / docs 域 push）两处。
- `scripts/check-workflow-refs.ts`：姊妹闸——它守 `.github/workflows/*.yml` 引用的脚本存在性，本 check 守 README 登记完整性。
- `scripts/check-script-hygiene.ts`：同为脚本体系卫生闸，五口径（退出码 / 共享层内联 / --json 契约 / 文件头 5 字段 / parse-args），不覆盖 README 登记。
- `tests/test_check_readme_index.mjs`：契约测试（6 项：纯函数判定 / hooks 子目录 / 前缀不误判 / 全量 0 缺失 / 拦截路径）。
- `docs/knowledge/scripts_argv.md`：姊妹治理卡——脚本 argv 走 parse-args 的规范；本卡负责登记侧。

## 不变量

- **每个 scripts/*.mjs（含 hooks/）必须在 README 出现**，否则 `check-readme-index.mjs` 退出 1 阻断推送。
- **`_lib/` 与测试豁免**：共享层与 `.test.mjs` 不要求登记（README 明确排除）。
- **登记处是唯一事实源**：AGENTS.md 工具口令表只是指针，脚本索引以 `scripts/README.md` 为准。
- **修复方式**：漏登 → 补 README 表格行（含调用方式 + 说明）；改名/删除 → 同步 README（已删除脚本按惯例移入「已删除」区）。

## 相关

- `scripts/check-readme-index.ts`（本卡 source）
- `scripts/README.md`（被对账的登记处）
- `scripts/pre-push-gate.ts`（门禁挂载）
- `tests/test_check_readme_index.mjs`（契约测试）
- `docs/knowledge/scripts_argv.md`（姊妹治理卡：argv 规范）
