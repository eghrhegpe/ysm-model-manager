#!/usr/bin/env node
/**
 * check-readme-index.ts — scripts/README.md 与磁盘脚本对账（登记处漂移守护）。
 *
 * 背景：scripts/README.md 自称「所有 Node 工具脚本的索引」「治理检查的唯一登记处」，
 * 但 README 与 scripts/ 磁盘之间没有任何机器对账——新增/改名脚本后忘记登记 README
 * 不会被任何门禁拦下（实测 2026-08-31 审计：93 个脚本中 29 个零提及，含
 * commit-with-check / gen-routes / generate-locale-json 等高频货，且 generate-locale-json
 * 已被 pre-commit GEN_CMDS 调用）。check-workflow-refs 守住了 workflow 引用，
 * README 登记处却裸奔。本脚本把「README 必须提及每个脚本」固化为卡点。
 *
 * 判定口径：README 全文（含表格/口令表/正文）中出现脚本文件名（含 .mjs 后缀的
 * basename）即视为已登记；`_lib/` 共享层与测试文件（.test.mjs）豁免。
 *
 * 设计意图：让「唯一登记处」的声明可机检、可自执行，与 check-workflow-refs
 * 形成引用侧 + 登记侧双守护。
 * 依赖：零依赖（node:fs / node:path + _lib/scan-files.ts 的 ROOT）
 *
 * 用法：
 *   node scripts/check-readme-index.ts           # 文本报告
 *   node scripts/check-readme-index.ts --json    # JSON（CI / doctor 消费）
 *
 * 退出码：0 全部登记 / 1 存在零提及脚本（阻断）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.ts';
import { collectScripts } from './_lib/collect-scripts.ts';

const SCRIPTS_DIR = path.join(ROOT, 'scripts');

const JSON_OUT = process.argv.includes('--json');

/** 判定：README 中出现脚本 basename（含 .mjs）即视为已登记。
 *  basename 足够精确（README 表格列出的就是 basename），且能覆盖正文/口令表引用。
 *  纯函数供契约测试复用。 */
export function missingFromReadme(files: string[], readmeText: string) {
  return files.filter((f) => {
    const base = f.includes('/') ? f.slice(f.lastIndexOf('/') + 1) : f;
    return !readmeText.includes(base);
  });
}

/**
 * README 描述过时断言（ADR-158）：守住「唯一登记处」的描述正确性，不止于零提及。
 * 背景：missingFromReadme 只查脚本是否被提及，查不出「提及了但说错了」的漂移——
 * 例如 commit-with-check 已解耦为 _lib/commit-check，README 却仍写「委托 pre-push-gate」。
 * 本表针对发生过漂移的关键脚本登记不可过时的断言；措辞用宽松正向断言（mustInclude）
 * + 针对已删除旧句的负向断言（mustNotInclude），避免未来重构误报。
 */
export interface ReadmeAssertion {
  script: string;
  mustInclude?: string[];
  mustNotInclude?: string[];
  note?: string;
}

export const README_ASSERTIONS: ReadmeAssertion[] = [
  {
    script: 'commit-with-check.ts',
    mustInclude: ['_lib/commit-check'],
    mustNotInclude: ['验证全部委托 pre-push-gate'],
    note: 'ADR-155：commit-with-check 已解耦为独立轻量清单（_lib/commit-check），不再复用 pre-push-gate 重型门禁',
  },
  {
    script: 'contract-tests.ts',
    mustInclude: ['tests 域不再全量'],
    mustNotInclude: ['tests 域仍全量'],
    note: 'ADR-156/157：tests 域已按 CONTRACT_TEST_TARGETS 精确裁剪，不再全量',
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 在 README 中定位含 `…script…` 表格 token 的行（纯函数，供契约测试复用）。 */
export function findReadmeRow(readmeText: string, script: string): string | null {
  const re = new RegExp('`[^`]*' + escapeRegExp(script) + '[^`]*`');
  for (const line of readmeText.split('\n')) {
    if (re.test(line)) return line;
  }
  return null;
}

/** 校验 README 关键脚本描述是否过时（纯函数，供契约测试复用）。返回违规字符串列表。 */
export function assertionViolations(
  readmeText: string,
  assertions: ReadmeAssertion[] = README_ASSERTIONS,
): string[] {
  const out: string[] = [];
  for (const a of assertions) {
    const row = findReadmeRow(readmeText, a.script);
    if (!row) continue; // 零提及由 missingFromReadme 负责
    for (const need of a.mustInclude ?? []) {
      if (!row.includes(need)) out.push(`[README断言] ${a.script} 描述应含「${need}」却未出现（${a.note ?? ''}）`);
    }
    for (const forbid of a.mustNotInclude ?? []) {
      if (row.includes(forbid)) out.push(`[README断言] ${a.script} 描述仍含过时措辞「${forbid}」（${a.note ?? ''}）`);
    }
  }
  return out;
}

function main() {
  const files = collectScripts(); // 含 hooks/（git 钩子辅助脚本同样在 README 有登记表）
  const readme = fs.readFileSync(path.join(SCRIPTS_DIR, 'README.md'), 'utf8');

  const missing = missingFromReadme(files, readme);
  const violations = assertionViolations(readme);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            scripts: files.length,
            registered: files.length - missing.length,
            missing: missing.length,
            assertionViolations: violations.length,
          },
          missing,
          assertionViolations: violations,
        },
        null,
        2,
      ),
    );
    if (missing.length || violations.length) process.exit(1);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' README 索引对账 (check-readme-index)');
  console.log('══════════════════════════════════════');
  console.log(`磁盘脚本 ${files.length} 个，README 已登记 ${files.length - missing.length} 个，零提及 ${missing.length} 个`);
  console.log('──────────────────────────────────────');
  for (const m of missing) console.log(`❌ README 未提及: ${m}`);
  if (!missing.length) console.log('✅ 所有脚本均已登记在 scripts/README.md。');
  for (const v of violations) console.log(`❌ ${v}`);
  if (!violations.length) console.log('✅ README 关键描述均无过时措辞漂移。');
  if (missing.length || violations.length) process.exit(1);
}

main();
