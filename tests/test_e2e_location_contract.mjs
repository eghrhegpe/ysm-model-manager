#!/usr/bin/env node
/**
 * 契约测试：e2e 定位通道全量守护（ADR-133 阶段 C+）。
 *
 * 目标：e2e spec 不得用脆弱定位通道定位元素（改文案 / 改菜单顺序 / 改 locale 即静默失效）。
 * 稳定钩子是 data-testid（G-1 — ADR-035）；语义定位走 data-page（导航）/ data-action
 * （context-menu）/ data-toast-type（toast 类型）等结构属性。
 *
 * 四条通道（每条均有客观事实源判定，不靠主观）：
 *   ① id    getElementById(x) / querySelector("#x") / locator("#x") → 源码 id→data-testid 索引
 *   ② class querySelector(".x") / locator(".x")                    → 源码 class→data-testid 索引
 *   ③ nth   .nth(N) 字面量数字                                  → 硬编码序号（菜单动态显隐即错位）
 *   ④ text  filter({ hasText: "x" })                             → 命中 i18n locale = 产品文案
 *
 * 判定与门禁：
 *   VIOLATION（① id ③ nth ④ text：已有稳定钩子可用 / 结构性脆弱）→ exit 1
 *   MISSING  （① id：源码有 id 但无 testid 钩子，须先补钩子）      → exit 1
 *   REVIEW   （② class：class 有「模板属性 / CSS 定义 / 运行时赋值」三态，关联同元素
 *             testid 不可靠，易误报）→ 仅报告，不入门禁
 *   EXEMPT   （动态 id / 变量 nth / 非 i18n 文案）→ 误报防线，不判定
 *
 * 注释掩码：扫描前剥离 // 与 /* *\/ 注释（行号 / 偏移守恒），避免「注释里引用旧脆弱写法」
 * 被误判为违规（越写清楚注释越报红）。
 *
 * 本文件由 tests/*.mjs 自动发现机制纳入 doctor / pre-push 门禁（scripts/_lib/contract-tests.mjs）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FE = path.join(ROOT, 'frontend');
const E2E = path.join(FE, 'e2e');
const SRC = path.join(FE, 'src');
const LOCALES = path.join(SRC, 'core/i18n/locales');

const rel = (f) => path.relative(FE, f).replace(/\\/g, '/').replace(/^e2e\//, '');
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

/**
 * 注释掩码：把 // 行注释与 /* *\/ 块注释内容替换为等长空格（换行保留 → 行号与字符偏移守恒）。
 * 状态机跟踪 ' " ` 三种字符串，避免误伤字符串内的 // （如 URL）。转义字符原样保留（长度守恒）。
 */
const maskComments = (src) => {
  let out = '', i = 0, mode = 0; // 0 code | 1 line | 2 block | 3 '..' | 4 ".." | 5 `..`
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (mode === 0) {
      if (c === '/' && c2 === '/') { mode = 1; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { mode = 2; out += '  '; i += 2; continue; }
      if (c === "'") mode = 3; else if (c === '"') mode = 4; else if (c === '`') mode = 5;
      out += c; i++; continue;
    }
    if (mode === 1) { if (c === '\n') { mode = 0; out += c; } else out += ' '; i++; continue; }
    if (mode === 2) {
      if (c === '*' && c2 === '/') { mode = 0; out += '  '; i += 2; continue; }
      out += (c === '\n' ? '\n' : ' '); i++; continue;
    }
    if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
    if (c === (mode === 3 ? "'" : mode === 4 ? '"' : '`')) mode = 0;
    out += c; i++;
  }
  return out;
};
const readMasked = (f) => maskComments(fs.readFileSync(f, 'utf8'));

// ───────── 索引 1：源码 id / class → data-testid ─────────
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); continue; }
    if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};
const srcFiles = walk(SRC);

const idIndex = new Map();    // id -> {testid, file, line}
const clsIndex = new Map();   // class -> {testids:Set, count, file, line}

const elemAround = (s, m) => {
  const start = Math.max(0, m.index - 300);
  const before = s.slice(start, m.index);
  const after = s.slice(m.index + m[0].length, m.index + 300);
  const lt = before.lastIndexOf('<');
  const gt = after.indexOf('>');
  return (lt >= 0 ? before.slice(lt) : before) + m[0] + (gt >= 0 ? after.slice(0, gt) : after);
};

for (const f of srcFiles) {
  const s = fs.readFileSync(f, 'utf8');
  const r = rel(f);
  for (const m of s.matchAll(/\bid="([\w-]+)"/g)) {
    const elem = elemAround(s, m);
    const tm = elem.match(/\bdata-testid="([\w-]+)"/);
    const prev = idIndex.get(m[1]);
    if (!prev || (!prev.testid && tm)) idIndex.set(m[1], { testid: tm ? tm[1] : null, file: r, line: lineOf(s, m.index) });
  }
  for (const m of s.matchAll(/\bclass="([^"$]+)"/g)) {
    const elem = elemAround(s, m);
    const tm = elem.match(/\bdata-testid="([\w-]+)"/);
    for (const c of m[1].split(/\s+/).filter(Boolean)) {
      if (!clsIndex.has(c)) clsIndex.set(c, { testids: new Set(), count: 0, file: r, line: lineOf(s, m.index) });
      const rec = clsIndex.get(c);
      rec.count++;
      if (tm) rec.testids.add(tm[1]);
    }
  }
}

// ───────── 索引 2：i18n locale 全部文案值 ─────────
const localeStrings = new Set();
if (fs.existsSync(LOCALES)) {
  for (const f of fs.readdirSync(LOCALES).filter((n) => /\.ts$/.test(n))) {
    const s = fs.readFileSync(path.join(LOCALES, f), 'utf8');
    for (const m of s.matchAll(/:\s*"((?:[^"\\]|\\.)+)"/g)) localeStrings.add(m[1]);
    for (const m of s.matchAll(/:\s*'((?:[^'\\]|\\.)+)'/g)) localeStrings.add(m[1]);
  }
}
const localeList = [...localeStrings];

// ───────── 扫 e2e ─────────
if (!fs.existsSync(E2E)) {
  console.log('⚠️ 无 frontend/e2e 目录，跳过 e2e 定位通道守护');
  process.exit(0);
}
const e2eFiles = fs.readdirSync(E2E).filter((n) => /\.ts$/.test(n)).map((n) => path.join(E2E, n));

const V = [], M = [], EX = [], R = [];

// indirect 追溯：helper 形参 → 调用点字面量实参（如 getElementById(id) 的 id 来自调用处）
const traceParam = (s, hitLine, argName) => {
  const idx = s.split('\n').slice(0, hitLine).join('\n').length;
  const fnM = [...s.slice(0, idx).matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*:/g)].pop();
  if (!fnM) return { ok: false, reason: '无包裹函数' };
  const fnName = fnM[1];
  const params = fnM[2].split(',').map((p) => p.trim().split(':')[0].trim()).filter(Boolean);
  let outer = argName;
  for (const em of s.matchAll(/page\.evaluate\(\s*(?:async\s*)?\(\s*([A-Za-z_$][\w$]*)(?:\s*:\s*[\w<>|\s]+)?\s*\)\s*=>/g)) {
    if (em[1] !== argName) continue;
    const am = s.slice(em.index, em.index + 1400).match(/\}\s*,\s*([A-Za-z_$][\w$]*)\s*\)/);
    if (am) outer = am[1];
    break;
  }
  const pIdx = params.indexOf(outer);
  if (pIdx < 0) return { ok: false, reason: `${argName}→${outer} 非 ${fnName} 形参` };
  const lits = new Set();
  for (const f of e2eFiles) {
    const t = readMasked(f);
    for (const cm of t.matchAll(new RegExp(`\\b${fnName}\\s*\\(([^)]*)\\)`, 'g'))) {
      const a = cm[1].split(',').map((x) => x.trim())[pIdx];
      if (a && /^(["'`])([\w-]+)\1$/.test(a)) lits.add(a.slice(1, -1));
    }
  }
  return lits.size ? { ok: true, via: `${fnName}(#${pIdx})`, ids: [...lits] } : { ok: false, reason: `${fnName} 形参#${pIdx} 无字面量实参` };
};

for (const f of e2eFiles) {
  const s = readMasked(f); // 注释内容已掩空：只判真实代码
  const r = rel(f);
  const at = (i) => ({ file: r, line: lineOf(s, i) });

  // ── ① id 通道 ──
  const idHits = [];
  for (const m of s.matchAll(/getElementById\(\s*([^)]+?)\s*\)/g)) {
    const a = m[1].trim(), L = lineOf(s, m.index);
    if (/^(["'`])([\w-]+)\1$/.test(a)) idHits.push({ ...at(m.index), ids: [a.slice(1, -1)], via: 'literal', raw: m[0] });
    else if (/^`[^`]*\$\{/.test(a)) EX.push({ ...at(m.index), ch: 'id', raw: m[0].slice(0, 40), why: '模板拼接动态 id（静态不可判定）' });
    else if (/^[A-Za-z_$][\w$]*$/.test(a)) {
      const t = traceParam(s, L, a);
      if (t.ok) idHits.push({ ...at(m.index), ids: t.ids, via: t.via, raw: m[0] });
      else EX.push({ ...at(m.index), ch: 'id', raw: m[0].slice(0, 40), why: `追溯失败：${t.reason}` });
    } else EX.push({ ...at(m.index), ch: 'id', raw: m[0].slice(0, 40), why: '实参形态无法解析' });
  }
  // querySelector("#x") 与 locator("#x") 两种形态都要覆盖——后者曾漏检 3 处。
  for (const m of s.matchAll(/(?:querySelector(?:All)?|locator)\(\s*(["'`])#([\w-]+)\1/g)) idHits.push({ ...at(m.index), ids: [m[2]], via: 'literal', raw: m[0] });
  for (const h of idHits) for (const id of h.ids) {
    const rec = idIndex.get(id);
    if (!rec) { EX.push({ ...h, ch: 'id', raw: `#${id}`, why: '源码无此 id（运行时生成）' }); continue; }
    if (rec.testid) V.push({ ...h, ch: 'id', key: id, rec, fix: `[data-testid="${rec.testid}"]` });
    else M.push({ ...h, ch: 'id', key: id, rec, fix: `补 data-testid="${id}"` });
  }

  // ── ② class 通道（不入硬门禁：形态多样，判定不可靠，仅 REVIEW）──
  for (const m of s.matchAll(/(?:querySelector(?:All)?|locator)\(\s*(["'`])\.([\w-]+)((?:(?!\1).)*)\1/g)) {
    const cls = m[2], extra = m[3] || '';
    const rec = clsIndex.get(cls);
    const tids = rec ? [...rec.testids] : [];
    R.push({
      ...at(m.index), ch: 'class', key: `.${cls}${extra}`, rec,
      fix: !rec ? 'CSS 定义 / 运行时 className 赋值，无模板属性可索引'
        : rec.count > 1 ? `族类 class（源码 ${rec.count} 处）→ 需共享集合 testid`
        : tids.length ? `可用 [data-testid="${tids[0]}"]${extra}` : `补 data-testid`,
    });
  }

  // ── ③ nth 通道 ──
  for (const m of s.matchAll(/\.nth\(\s*([^)]+?)\s*\)/g)) {
    const a = m[1].trim();
    if (/^\d+$/.test(a)) V.push({ ...at(m.index), ch: 'nth', key: `nth(${a})`, fix: '改语义属性定位（如 [data-page="settings"]）' });
    else EX.push({ ...at(m.index), ch: 'nth', raw: `nth(${a})`, why: '变量序号（集合遍历，合理）' });
  }

  // ── ④ text 通道：子串匹配（locale 值可能带前缀），命中值一并输出供人工核对防子串误报 ──
  for (const m of s.matchAll(/hasText:\s*(["'`])((?:[^"'`\\]|\\.)+)\1/g)) {
    const txt = m[2];
    const hit = txt.length >= 3 ? localeList.find((v) => v === txt) ?? localeList.find((v) => v.includes(txt)) : null;
    if (hit) V.push({ ...at(m.index), ch: 'text', key: `"${txt}"`, fix: `改结构/testid 断言 — i18n 原值 "${hit}"` });
    else EX.push({ ...at(m.index), ch: 'text', raw: `"${txt}"`, why: '非 i18n 文案（测试自注入 / mock 数据）' });
  }
}

// ───────── 报告 ─────────
const CH = { id: '① id', class: '② class', nth: '③ nth', text: '④ text' };
const tally = (arr) => Object.entries(arr.reduce((a, x) => ((a[x.ch] = (a[x.ch] || 0) + 1), a), {})).map(([k, v]) => `${CH[k]}=${v}`).join('  ');

console.log('══════════ e2e 定位通道守护（ADR-133 阶段 C+）═════════');
console.log(`e2e ${e2eFiles.length} 文件｜源码 id 索引 ${idIndex.size}｜class 索引 ${clsIndex.size}｜i18n 文案 ${localeStrings.size}`);
console.log(`🔴 VIOLATION ${V.length}   ${tally(V)}   ← 硬门禁`);
console.log(`🟡 MISSING   ${M.length}   ${tally(M)}   ← 硬门禁（须先补钩子）`);
console.log(`🔵 REVIEW    ${R.length}   ${tally(R)}   ← 人工决策，不入门禁`);
console.log(`⚪ EXEMPT    ${EX.length}   ${tally(EX)}`);

for (const [label, bucket] of [
  ['🔴 VIOLATION — 已有稳定钩子可用 / 结构性脆弱', V],
  ['🟡 MISSING — 须先补 data-testid 钩子', M],
]) {
  console.log(`\n${label}`);
  if (!bucket.length) { console.log('  （无）'); continue; }
  const g = new Map();
  for (const x of bucket) {
    const k = `${x.ch}|${x.key}`;
    if (!g.has(k)) g.set(k, { ...x, sites: [] });
    g.get(k).sites.push(`${x.file}:${x.line}`);
  }
  for (const x of [...g.values()].sort((a, b) => a.ch.localeCompare(b.ch))) {
    console.log(`  ${CH[x.ch]} ${x.key} × ${x.sites.length} → ${x.fix}`);
    console.log(`            ${x.sites.join(', ')}${x.rec ? `   [源码 ${x.rec.file}:${x.rec.line}]` : ''}`);
  }
}

if (R.length) {
  console.log('\n🔵 REVIEW — class 通道（形态多样，判定不可靠，仅供人工决策，不入门禁）');
  const g = new Map();
  for (const x of R) {
    const k = `${x.ch}|${x.key}`;
    if (!g.has(k)) g.set(k, { ...x, sites: [] });
    g.get(k).sites.push(`${x.file}:${x.line}`);
  }
  for (const x of g.values()) console.log(`  ${CH[x.ch]} ${x.key} × ${x.sites.length} → ${x.fix}   [${x.sites.join(', ')}]`);
}

if (EX.length) {
  console.log('\n⚪ EXEMPT — 误报防线（不判定）');
  const eg = new Map();
  for (const e of EX) {
    const k = `${e.ch}|${e.why}`;
    if (!eg.has(k)) eg.set(k, { ...e, n: 0, samples: [] });
    const r = eg.get(k); r.n++; if (r.samples.length < 2) r.samples.push(`${e.file}:${e.line} ${e.raw}`);
  }
  for (const e of eg.values()) console.log(`  ${CH[e.ch]} × ${e.n} ${e.why}  例: ${e.samples.join(' | ')}`);
}

// ───────── 门禁 ─────────
const gate = V.length + M.length;
if (gate > 0) {
  console.error(`\n❌ e2e 定位通道门禁失败：① id ③ nth ④ text 共 ${gate} 处违规（VIOLATION+MISSING）。`);
  console.error('   改 e2e 用 data-testid / data-page / data-action / data-toast-type 等稳定钩子，勿用 id / 硬编码 nth / i18n 文案。');
  process.exit(1);
}
console.log('\n✅ e2e 定位通道守护通过：无 id / nth / text 脆弱定位（class 通道仅 REVIEW，不门禁）');
