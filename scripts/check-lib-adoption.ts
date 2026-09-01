#!/usr/bin/env node
/**
 * check-lib-adoption.ts — _lib 共享层采用率检查（治理杠杆的「采用率闸门」）。
 *
 * 设计意图：scripts/_lib/ 现有 25 个共享模块，但只有 proc.mjs 配了专属采用率
 * 闸门（check-proc-adoption.ts），结果是非直调占比 100% 全收敛；其余 24 个模块
 * 零闸门、纯靠自觉（parse-args 仅 37/95 采用，多脚本仍各自内联 walk/符号提取）。
 * 本脚本把「proc 的成功经验」推广为规则驱动的通用闸门：
 *   规则表（模块 → 手搓特征 / 采用特征）驱动，新增模块只需加一行 RULES。
 * 与相邻脚本的分工（避免重复告警）：
 *   - check-proc-adoption.ts：专管子进程（proc.mjs），本脚本显式跳过该模块；
 *   - check-script-hygiene.ts：管文件头 / 退出码 / --json 契约 / argv 契约，
 *     其共享层口径只认 `^function walk(` 等窄命名（改名 collectScripts 即绕过）；
 *     本脚本按「能力是否被手搓」判定，覆盖 frontmatter / source-graph / to-posix
 *     等 hygiene 完全未触及的模块，且同时给出全模块采用率全景。
 * 依赖：node:fs / node:path / scripts/_lib/scan-files.ts
 *
 * 用法：
 *   node scripts/check-lib-adoption.ts           # 文本报告（采用率全景 + 违规清单）
 *   node scripts/check-lib-adoption.ts --json    # JSON（doctor/CI 消费）
 *   node scripts/check-lib-adoption.ts --strict  # 有违规 → 退出码 1
 *
 * 退出码：默认 0（提示工具，WARN 不阻断）；--strict 且存在违规 → 1。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR, collectScripts } from './_lib/collect-scripts.ts';

const LIB_DIR = path.join(SCRIPTS_DIR, '_lib');

const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

/**
 * 规则表：_lib 模块 → 手搓特征 / 采用特征 / 迁移建议。
 * 判定：命中任一 smell 且未命中 adopted → 违规（有能力却手搓）。
 * proc.mjs 不在此表：由 check-proc-adoption.ts 专管，避免重复告警。
 */
const RULES = [
  {
    lib: 'scan-files.ts',
    capability: '文件遍历 / 仓库根定位',
    smells: [/^function (?:walk|walkDir|collectFiles|scanDir|collectScripts)\s*\(/m, /^const (?:walk|walkDir)\s*=/m],
    advice: "import { walk, ROOT } from './_lib/scan-files.ts'",
  },
  {
    lib: 'parse-args.ts',
    capability: 'CLI 参数解析（含 unknown 白名单拦截）',
    smells: [/^function (?:parseArgs|parseCli)\s*\(/m, /^const parseArgs\s*=/m],
    advice: "import { parseArgs } from './_lib/parse-args.ts'",
  },
  {
    lib: 'frontmatter.ts',
    capability: 'YAML frontmatter 解析',
    smells: [/^function (?:parseFrontmatter|readFrontmatter|splitFrontmatter|parseMeta)\s*\(/m, /split\(\s*['"]---['"]\s*\)/],
    advice: "import { parseFrontmatter } from './_lib/frontmatter.ts'",
  },
  {
    lib: 'source-graph.ts',
    capability: '源码符号 / 顶层声明提取',
    smells: [/^function (?:getExportedSymbols|getGoExportedSymbols|getJsExportedSymbols|goTopFuncs|tsTopDecls|collectSymbols)\s*\(/m],
    advice: "import { getExportedSymbolsAny, topDeclsAny } from './_lib/source-graph.ts'",
  },
  {
    lib: 'to-posix.ts',
    capability: 'Windows 反斜杠 → 正斜杠归一',
    smells: [/\.replace\(\/\\\\\/g,\s*['"]\/['"]\)/],
    advice: "import { toPosix } from './_lib/to-posix.ts'",
  },
  {
    lib: 'git-ref.ts',
    capability: 'git ref / commit oid 解析',
    smells: [/^function (?:resolveRef|toOid|parseRef|gitRef)\s*\(/m],
    advice: "import { resolveRef } from './_lib/git-ref.ts'",
  },
];

/** 采用特征：脚本 import 了该模块即视为已接入（自动豁免同规则的 smell）。 */
function adoptedRe(lib) {
  return new RegExp(`_lib[\\\\/]${lib.replace('.', '\\.')}`);
}

/** 收集 _lib 共享模块（排除测试）。 */
function collectLibs() {
  if (!fs.existsSync(LIB_DIR)) return [];
  return fs.readdirSync(LIB_DIR)
    .filter((f) => (f.endsWith('.mjs') || f.endsWith('.ts')) && !f.endsWith('.test.mjs') && !f.endsWith('.test.ts'))
    .sort();
}

/** 统计每个 _lib 模块被多少脚本引用（采用率全景）。 */
function adoptionTable(files, texts, libs) {
  return libs.map((lib) => {
    const re = adoptedRe(lib);
    const users = files.filter((f) => re.test(texts.get(f)));
    return { lib, users: users.length, scripts: users };
  });
}

function main() {
  const files = collectScripts();
  const texts = new Map(files.map((f) => [f, fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8')]));
  const libs = collectLibs();

  // 违规：手搓了某模块能覆盖的能力，却未 import 该模块
  const violations: any[] = [];
  for (const rule of RULES) {
    const adopted = adoptedRe(rule.lib);
    for (const f of files) {
      const text = texts.get(f) as string;
      if (adopted.test(text)) continue; // 已接入共享层 → 豁免
      const hit = rule.smells.find((re) => re.test(text));
      if (hit) {
        violations.push({ script: f, lib: rule.lib, capability: rule.capability, advice: rule.advice });
      }
    }
  }

  const table = adoptionTable(files, texts, libs);
  const unused = table.filter((r) => r.users === 0);

  if (JSON_OUT) {
    const ok = STRICT ? violations.length === 0 : true;
    console.log(JSON.stringify({
      _summary: {
        scripts: files.length,
        libs: libs.length,
        violations: violations.length,
        unusedLibs: unused.length,
        ok,
      },
      adoption: table.map(({ lib, users }) => ({ lib, users })),
      violations,
    }, null, 2));
    if (STRICT && violations.length) process.exit(1);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' _lib 共享层采用率检查 (check-lib-adoption)');
  console.log('══════════════════════════════════════');
  console.log(`扫描 ${files.length} 个脚本 × ${libs.length} 个 _lib 模块，违规 ${violations.length} 条`);
  console.log('──────────────────────────────────────');
  if (violations.length) {
    console.log('【有能力未用】手搓了 _lib 已提供的能力，却未 import：');
    for (const v of violations) {
      console.log(`⚠ ${v.script}：手搓「${v.capability}」→ ${v.advice}`);
    }
  } else {
    console.log('✅ 未发现「有能力未用」的脚本。');
  }

  console.log('\n【采用率全景】被引用脚本数 / 脚本总数');
  for (const { lib, users } of table) {
    const bar = users === 0 ? '—' : '█'.repeat(Math.min(20, Math.max(1, Math.round((users / files.length) * 20))));
    console.log(`  ${lib.padEnd(30)} ${String(users).padStart(3)}  ${bar}`);
  }
  if (unused.length) {
    console.log(`\n⚠ 零引用模块 ${unused.length} 个：${unused.map((u) => u.lib).join(', ')}`);
    console.log('  （可能是写得过早的抽象，或已被取代——建议评估归档）');
  }
  console.log('\n（WARN 不阻断；加 --strict 后退出码 1）');
  if (STRICT && violations.length) process.exit(1);
}

main();
