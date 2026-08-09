#!/usr/bin/env node
/**
 * i18n-check.mjs — i18n 国际化检查（key parity/占位符/漏译/语言清单漂移）
 *
 * 移植自联邦项目 MikuMikuAR scripts/i18n-check.mjs（ADR-045 落地配套）。
 * 适配点：语言清单注册处为 locale.ts SUPPORTED_LANGS（对象数组）；REFERENCE_LANGS 含 en/ja。
 *
 * 设计意图：i18n 化后翻译包覆盖不足，缺失 key 静默回退 zh-CN（t.ts 回退链），
 * 无任何报错线索——en/ja 用户会看到中文界面却不自知。本脚本把三类缺口提前暴露：
 * key parity（en/ja vs zh-CN）、占位符一致性（{n} 跨包必须一致）、zh-CN 漏译、
 * SUPPORTED_LANGS 与 locales/ 文件集漂移。warning 模式只报不阻断，--strict 供 CI。
 *
 * 零依赖（仅 node:fs / node:path / node:url + 仓库内 _lib/parse-args.mjs）。
 *
 * 用法：
 *   node scripts/i18n-check.mjs                 # warning 模式（默认，非阻断）
 *   node scripts/i18n-check.mjs --strict        # 缺口存在时非零退出（CI/doctor 门禁用）
 *   node scripts/i18n-check.mjs --json          # JSON 输出（供脚本消费）
 *
 * 退出码：全部通过 → 0；有缺口且 --strict → 1；warning 模式恒 0。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from './_lib/parse-args.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = resolve(__dirname, '..', 'frontend', 'src', 'core', 'i18n', 'locales');
const BASE_LANG = 'zh-CN';
const REFERENCE_LANGS = ['en', 'ja'];

const { strict, json, help, unknown } = parseArgs(process.argv.slice(2), {
  bools: ['strict', 'json'],
  strings: [],
  defaults: {},
});
if (help) {
  const _src = readFileSync(process.argv[1], 'utf-8');
  const _s = _src.indexOf('/**');
  const _e = _src.indexOf('*/', _s);
  console.log(_src.slice(_s, _e + 2).replace(/^ \* ?/gm, '').trim());
  process.exit(0);
}
if (unknown && unknown.length) {
  console.error(`❌ 未知参数: ${unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}
const log = json ? () => {} : console.log.bind(console);

function extractKeys(file) {
  const text = readFileSync(file, 'utf8');
  const keys = new Set();
  const re = /^\s*['"]([^'"]+)['"]\s*:\s*(?!function\b|\()/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

function loadBundle(lang) {
  const file = resolve(LOCALES_DIR, `${lang}.ts`);
  return { lang, file, keys: extractKeys(file) };
}

function extractPlaceholders(file) {
  const text = readFileSync(file, 'utf8');
  const map = new Map(); // key -> Set<string> of placeholder names
  // 捕获值开引号（组2）并用负向前瞻排除对应引号，兼容单/双引号两种源码风格。
  // 移植适配：本项目 locale 用双引号，隔壁 `[^'\\]` 会吞掉 `"` 导致整段误匹配。
  const re = /^\s*['"]([^'"]+)['"]\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const val = m[2];
    const ph = new Set();
    const phRe = /\{(\w+)\}/g;
    let p;
    while ((p = phRe.exec(val)) !== null) ph.add(p[1]);
    if (ph.size > 0) map.set(key, ph);
  }
  return map;
}

const base = loadBundle(BASE_LANG);
const refs = REFERENCE_LANGS.map(loadBundle);

let totalMissing = 0;
const report = [];

for (const ref of refs) {
  const missing = [...base.keys].filter((k) => !ref.keys.has(k)).sort();
  const extra = [...ref.keys].filter((k) => !base.keys.has(k)).sort();
  totalMissing += missing.length;
  const lines = [
    `[${ref.lang}] base=${base.keys.size} bundle=${ref.keys.size} missing=${missing.length} extra=${extra.length}`,
  ];
  if (missing.length) lines.push('  missing: ' + missing.join(', '));
  if (extra.length) lines.push('  extra (not in base): ' + extra.join(', '));
  report.push(lines.join('\n'));
}

log(`i18n parity — base lang: ${BASE_LANG} (${base.keys.size} keys)`);
log(report.join('\n'));

const basePH = extractPlaceholders(resolve(LOCALES_DIR, `${BASE_LANG}.ts`));
let phIssues = 0;
const phReport = [];
for (const ref of refs) {
  const refPH = extractPlaceholders(resolve(LOCALES_DIR, `${ref.lang}.ts`));
  // P2-1（子代理审核）：base/ref 占位符键并集遍历——原代码只迭代 basePH，
  // ref 值「删了 {n}」或「多了 base 没有的 {xxx}」均静默漏检；并集后 refPH 缺
  // key（undefined）→ refSet 空 → missing 全量（抓「占位符被删」），ref 独有键
  // → extra 全量（抓「多余占位符」）。缺 key 本身仍由 parity 阶段报，不重复。
  const allPHKeys = new Set([...basePH.keys(), ...refPH.keys()]);
  for (const key of allPHKeys) {
    if (!ref.keys.has(key)) continue; // 缺 key 已由 parity 报，不在此重复
    const baseSet = basePH.get(key) ?? new Set();
    const refSet = refPH.get(key) ?? new Set();
    const missing = [...baseSet].filter((p) => !refSet.has(p));
    const extra = [...refSet].filter((p) => !baseSet.has(p));
    if (missing.length || extra.length) {
      phIssues++;
      const parts = [];
      if (missing.length) parts.push(`missing {${missing.join('},{')}}`);
      if (extra.length) parts.push(`extra {${extra.join('},{')}}`);
      phReport.push(`  [${ref.lang}] ${key}: ${parts.join('; ')}`);
    }
  }
}
if (phReport.length) {
  log(`\n⚠ ${phIssues} placeholder mismatch(es) across bundles:`);
  log(phReport.join('\n'));
  log('  These cause t() to silently leave {xxx} unreplaced at runtime.');
  if (strict && !json) {
    console.error(`\n[i18n-check] --strict: ${phIssues} placeholder mismatch(es) → CI fails.`);
    process.exit(1);
  }
  log('  (warning mode — non-blocking.)');
} else {
  log('\n✅ All placeholder sets are consistent across bundles.');
}

if (totalMissing > 0) {
  log(`\n⚠ ${totalMissing} key(s) missing across translation bundles.`);
  log('  These silently fall back to zh-CN at runtime (t.ts fallback chain).');
  log('  Fill them in the corresponding frontend/src/core/i18n/locales/*.ts,');
  log('  then this check goes green.');
  if (strict && !json) {
    console.error(`\n[i18n-check] --strict: ${totalMissing} missing key(s) → CI fails.`);
    process.exit(1);
  }
  log('  (warning mode — non-blocking. Flip to --strict after gaps cleared.)');
} else {
  log('\n✅ All translation bundles are key-aligned with the base.');
}

function extractKeyValues(file) {
  const text = readFileSync(file, 'utf8');
  const map = new Map();
  const re = /^\s*['"]([^'"]+)['"]\s*:\s*['"]((?:\\.|[^'\\])*)['"]/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

const zhCNEntries = extractKeyValues(resolve(LOCALES_DIR, `${BASE_LANG}.ts`));
const KNOWN_INTENTIONAL = new Set([
  'lang.en', // 语言自名
  'lang.zh-CN', // 语言自名
  'common.yes', // 通用短词
  'common.no', // 通用短词
  'common.ok', // 通用短词
  'common.cancel', // 通用短词
  'workshop.bilibili', // 品牌名
  'workshop.github', // 品牌名
  'workshop.patreon', // 品牌名
]);
const untranslated = [];
for (const [key, value] of zhCNEntries) {
  if (KNOWN_INTENTIONAL.has(key)) continue;
  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(value) && value.length > 0) {
    untranslated.push({ key, value });
  }
}

if (untranslated.length > 0) {
  const maxShow = 20;
  const shown = untranslated.slice(0, maxShow);
  log(`\n⚠ ${untranslated.length} 个 zh-CN 条目疑似漏译（值不含中文字符）:`);
  for (const { key, value } of shown) {
    log(`  ${key}: '${value}'`);
  }
  if (untranslated.length > maxShow) {
    log(`  ... 及其他 ${untranslated.length - maxShow} 个条目`);
  }
  log('  这些条目在 zh-CN.ts 中为纯英文，可能是翻译遗漏。');
  if (strict && !json) {
    console.error(`\n[i18n-check] --strict: ${untranslated.length} untranslated entry(s) → CI fails.`);
    process.exit(1);
  }
  log('  (warning mode — non-blocking.)');
} else {
  log('\n✅ zh-CN 基准包无漏译（所有条目均含中文字符）。');
}

const LOCALE_TS_PATH = resolve(__dirname, '..', 'frontend', 'src', 'core', 'i18n', 'locale.ts');
const LOCALE_TS = readFileSync(LOCALE_TS_PATH, 'utf8');
// 语言清单从 t.ts AVAILABLE_LANGS 迁到 locale.ts SUPPORTED_LANGS（对象数组 `{ code, label, key }`）
const langsMatch = LOCALE_TS.match(/SUPPORTED_LANGS\s*=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/);
const availableLangs = langsMatch
  ? [...langsMatch[1].matchAll(/code\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
  : [];
const langFiles = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')) // 排除测试文件 zh-CN.test.ts
  .map((f) => f.replace(/\.ts$/, ''));
const availSet = new Set(availableLangs);
const fileSet = new Set(langFiles);
const inAvailNotFile = availableLangs.filter((l) => !fileSet.has(l));
const inFileNotAvail = langFiles.filter((f) => !availSet.has(f));

if (inAvailNotFile.length || inFileNotAvail.length) {
  log('\n⚠ SUPPORTED_LANGS (locale.ts) 与 locales/*.ts 文件集不一致:');
  if (inAvailNotFile.length) log('  仅声明于 SUPPORTED_LANGS 但无 bundle 文件: ' + inAvailNotFile.join(', '));
  if (inFileNotAvail.length) log('  存在 bundle 文件但未列入 SUPPORTED_LANGS: ' + inFileNotAvail.join(', '));
  log('  请同步 frontend/src/core/i18n/locale.ts 与 frontend/src/core/i18n/locales/。');
  if (strict && !json) {
    console.error('\n[i18n-check] --strict: SUPPORTED_LANGS 与文件集不一致 → CI fails.');
    process.exit(1);
  }
  log('  (warning mode — non-blocking.)');
} else {
  log(`\n✅ SUPPORTED_LANGS (${availableLangs.length}) 与 locales/*.ts 文件集完全一致。`);
}
if (json) {
  const failed =
    totalMissing > 0 ||
    phIssues > 0 ||
    untranslated.length > 0 ||
    inAvailNotFile.length > 0 ||
    inFileNotAvail.length > 0;
  console.log(
    JSON.stringify(
      {
        baseLang: BASE_LANG,
        baseKeys: base.keys.size,
        keyParity: report,
        placeholderMismatches: phReport,
        untranslated,
        langListDrift: { inAvailNotFile, inFileNotAvail },
      },
      null,
      2
    )
  );
  process.exit(failed && strict ? 1 : 0);
}
process.exit(0);
