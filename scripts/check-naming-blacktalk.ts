#!/usr/bin/env node
/**
 * check-naming-blacktalk.ts — 前端命名黑话防回潮检查器（frontend_naming 章程配套）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。仿 check-boolean-naming.ts 范式。
 *
 * 只做**低误报**检查（高误报类别如任意 2/3 字母前缀、parsed/loaded 惯用局部变量
 * 不扫——那类靠知识卡纪律 + 人工 review，进门禁只会制造噪音）：
 *
 *   1. built 名词家族（ERROR 级候选）：setBuilt / workerBuilt / builtScene /
 *      allBuilt / getBuilt / makeBuilt / built<数字或大写> / <词>Built
 *      —— 内容层「build 返回值统一命名 content，禁 built」红线的可机器判定子集。
 *      PmxBuildResult / buildXxxScene 等 builder 正当命名不在此列（不含上述 token）。
 *
 *   2. 三轴单字母挤一行（WARN 级）：相邻声明 `const w = ...; const h = ...; const l = ...`
 *      （宽/高/长业务量，知识卡 pitfall「w/h/l 三个单字母挤一行只能靠顺序猜」）。
 *
 * 用法：
 *   node scripts/check-naming-blacktalk.ts            # 默认 WARN/ERROR 混合报告，退出码 0
 *   node scripts/check-naming-blacktalk.ts --strict   # ERROR 级（built 家族）>0 → 退出码 1
 *   node scripts/check-naming-blacktalk.ts --json     # JSON（CI 用）
 *
 * 设计意图：built→content 主战役（ADR-161 + frontend_naming 扩大清理）已完成，
 * 本脚本防止「新增代码 reintroduce built 名词」与「三轴单字母挤一行」回潮。
 */
import fs from 'node:fs';
import { SRC_DIR, walk, relPosix } from './_lib/scan-files.ts';

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has('--json');
const STRICT = ARGS.has('--strict');

/** 1. built 名词家族 token（内容层黑话，零容忍）。builder 正当命名（PmxBuildResult/buildXxx）
 *     与「带语义主语的过去分词旗标」（composerBuilt/workerResult 等）不匹配——
 *     黑话本质是「裸 built 无主语作名词」（setBuilt/workerBuilt/builtScene/allBuilt）。
 *     裸 built 赋值/属性访问由 BUILT_NAKED_RE（1b）另行覆盖。 */
const BUILT_NOUN_RE = /\b(?:setBuilt|workerBuilt|builtScene|builtContent|allBuilt|getBuilt|makeBuilt|unloadBuilt|built\d+)\b/g;

/** 1b. 裸 built 使用（非注释）：built 作场景对象变量名（声明/属性访问/比较）。含 built 的
 *     注释历史与 i18n 英文（built-in/not built yet）不在此列——本正则要求词边界后的
 *     赋值/点访问/空值合并/参数语境。 */
const BUILT_NAKED_RE = /\bbuilt\s*(?:=|\?\.|\.(?:dispose|menuItems|update|roots|boneMaps)|\)\s*=>)/g;

/** 2. 三轴单字母相邻声明（宽/高/长）。放宽跨行：允许 \n 与空白。 */
const WHL_TRIPLE_RE = /(?:const|let|var)\s+w\s*=\s*[^;\n]+;\s*(?:const|let|var)\s+h\s*=\s*[^;\n]+;\s*(?:const|let|var)\s+l\s*=\s*[^;\n]+;/g;

const findings: { name: string; loc: string; kind: string; line: string }[] = [];
let scannedCount = 0;

function scanFile(file: string) {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return;
  }
  scannedCount++;
  const lines = text.split(/\r?\n/);
  const rel = relPosix(file);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const loc = `${rel}:${i + 1}`;

    // 1. built 名词家族（跳过注释行——注释里讲历史是允许的，frontend_naming 卡正文即如此）
    if (!/^\s*(\/\/|\*|\/\*)/.test(line)) {
      for (const m of line.matchAll(BUILT_NOUN_RE)) {
        findings.push({ name: m[0], loc, kind: 'builtNoun', line: line.trim().slice(0, 120) });
      }
      // 1b. 裸 built 使用（场景对象语境）
      for (const m of line.matchAll(BUILT_NAKED_RE)) {
        findings.push({ name: `built${m[0].replace(/\s+/g, ' ').replace(/^built/, '')}`, loc, kind: 'builtNoun', line: line.trim().slice(0, 120) });
      }
    }

    // 2. 三轴单字母挤一行（可能跨行——拼接下来的行）
    let window = line;
    for (let j = 1; j <= 3 && i + j < lines.length; j++) window += '\n' + lines[i + j]!;
    for (const m of window.matchAll(WHL_TRIPLE_RE)) {
      findings.push({ name: 'w/h/l', loc, kind: 'whlTriple', line: line.trim().slice(0, 120) });
    }
  }
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(JSON_OUT ? JSON.stringify({ _summary: { scanned: 0, findings: 0 }, findings: [], error: 'frontend/src 不存在' }) : 'frontend/src 目录不存在');
    process.exit(1);
  }
  const files = walk(SRC_DIR, { skipTest: false }); // 测试层同样禁 built 名词（本轮清理目标含测试）
  for (const f of files) scanFile(f as string);

  // 去重：built 家族 token 在同文件多次出现只报首次（防刷屏），不同文件各报
  const uniq = new Map<string, typeof findings[number]>();
  for (const f of findings) {
    const key = f.kind === 'whlTriple' ? `${f.kind}@${f.loc}` : `${f.kind}@${f.name}@${f.loc.split(':')[0]}`;
    if (!uniq.has(key)) uniq.set(key, f);
  }
  const results = [...uniq.values()];
  const builtResults = results.filter((r) => r.kind === 'builtNoun');
  const whlResults = results.filter((r) => r.kind === 'whlTriple');

  if (JSON_OUT) {
    console.log(JSON.stringify({
      _summary: { scanned: scannedCount, findings: results.length, builtNoun: builtResults.length, whlTriple: whlResults.length },
      findings: results, scanned: scannedCount, strict: STRICT,
    }, null, 2));
    process.exit(STRICT && builtResults.length ? 1 : 0);
    return;
  }

  console.log('══════════════════════════════════════');
  console.log(' 命名黑话防回潮检查 (check-naming-blacktalk)');
  console.log('══════════════════════════════════════');
  console.log(`扫描文件 : ${scannedCount}`);
  console.log(`built 名词 : ${builtResults.length}（${STRICT ? 'ERROR 级' : '零容忍候选'}）`);
  console.log(`三轴单字母 : ${whlResults.length}（WARN 级）`);
  console.log('──────────────────────────────────────');

  for (const r of results) {
    if (r.kind === 'builtNoun') {
      console.log(`  ❌ ${r.loc}  「${r.name}」built 名词黑话——build 返回值统一命名 content（frontend_naming 章程）`);
    } else {
      console.log(`  ⚠️ ${r.loc}  w/h/l 三轴单字母挤一行——展开为 width/height/length（可辩护例外：循环下标）`);
    }
  }

  if (STRICT && builtResults.length) {
    console.log('\n退出码 1（--strict 模式：built 名词家族阻断）。');
    process.exit(1);
  }
  console.log(builtResults.length || whlResults.length ? '\n（默认不阻断；--strict 将 built 名词升级为 ERROR）' : '✅ 无 built 名词黑话 + 无三轴单字母挤一行。');
}

main();
