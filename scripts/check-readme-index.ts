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

function main() {
  const files = collectScripts(); // 含 hooks/（git 钩子辅助脚本同样在 README 有登记表）
  const readme = fs.readFileSync(path.join(SCRIPTS_DIR, 'README.md'), 'utf8');

  const missing = missingFromReadme(files, readme);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: { scripts: files.length, registered: files.length - missing.length, missing: missing.length },
          missing,
        },
        null,
        2,
      ),
    );
    if (missing.length) process.exit(1);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' README 索引对账 (check-readme-index)');
  console.log('══════════════════════════════════════');
  console.log(`磁盘脚本 ${files.length} 个，README 已登记 ${files.length - missing.length} 个，零提及 ${missing.length} 个`);
  console.log('──────────────────────────────────────');
  for (const m of missing) console.log(`❌ README 未提及: ${m}`);
  if (!missing.length) console.log('✅ 所有脚本均已登记在 scripts/README.md。');
  if (missing.length) process.exit(1);
}

main();
