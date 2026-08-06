#!/usr/bin/env node
/**
 * gen-adr-supersede.mjs — 扫描 docs/adr/ 全部 ADR，输出「取代关系」判定结果。
 *
 *   ① 已登记：旧 ADR 首部状态行明确声明「被 [ADR-NNN] 取代」
 *   ①b 部分推翻：声明带局部限定词（部分/§N/条目 N），只有该章节失效，整篇不归档
 *   ② 漏标告警：某 ADR 正文宣称「取代/废弃了 ADR-NNN」，但被取代方首部状态行未回标
 *   ③ 废弃未指明：状态行含「废弃」但未指明取代者（可能是放弃，不一定是被取代）
 *   ④ 可疑信号：正文提及「废弃/过时/退役/推翻」且同时出现其他 ADR 编号，需人工确认
 *   ⑤ 表格弱宣称：表格行首列为 ADR-NNN、其他列含「本 ADR…(完全)替代/取代/推翻」
 *
 * 用法：
 *   node scripts/gen-adr-supersede.mjs         # 打印取代关系清单（0 = 正常）
 *   node scripts/gen-adr-supersede.mjs --check # 仅 ②（漏标）失败时退出码 1（供 check:docs 用）
 *
 * 零依赖（仅 node:fs / node:path）。
 * 设计意图：ADR 替代关系生成器
 * 退出码：1（失败）
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
import {
  RE_SUPERSEDED_BY,
  RE_CLAIM_A,
  RE_CLAIM_B,
  RE_SELF_DEPRECATED,
  RE_DEPRECATED_WORD,
  RE_NEGATED,
  RE_TABLE_FIRST_COL,
  RE_TABLE_VERB,
  RE_TABLE_NEGATED,
  globalOf,
} from './_lib/supersede-regex.mjs';

const RE_CLAIM_A_G = globalOf(RE_CLAIM_A);
const RE_CLAIM_B_G = globalOf(RE_CLAIM_B);

const ADR_DIR = path.join(ROOT, 'docs', 'adr');
const FLAG_CHECK = process.argv.includes('--check');
const FLAG_QUIET = process.argv.includes('--quiet');

// ── 已知勘误注记白名单（人工核对后登记，非取代关系，不再报 ④） ──
const KNOWN_ERRATA = new Set();

// ── ADR 首部解析（YSM 格式：`- **状态**：xxx`）──────────

function parseAdrHeader(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  let num = null;
  let title = '';
  let status = '';
  let statusLine = -1;

  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const line = lines[i];

    // # ADR-NNN：标题（支持中文冒号）
    const mTitle = line.match(/^#\s+ADR-(\d{3})[：:]\s*(.+)/);
    if (mTitle) {
      num = parseInt(mTitle[1], 10);
      title = mTitle[2].trim();
      continue;
    }

    // - **状态**：xxx（YSM 格式：无序列表 + 中文冒号）
    const mStatus = line.match(/^-\s*\*\*状态\*\*\s*[：:]\s*(.+)/);
    if (mStatus) {
      status = mStatus[1].trim();
      statusLine = i;
      continue;
    }
  }

  if (num === null) return { error: '未找到 ADR 编号' };
  if (!status) return { error: '未找到可解析的状态字段' };
  if (!title) return { error: '未找到 ADR 标题' };

  return { num, title, status, statusLine };
}

// ── 主流程 ─────────────────────────────────────────────

function main() {
  if (!fs.existsSync(ADR_DIR)) {
    console.error('❌ docs/adr/ 目录不存在');
    process.exit(1);
  }

  const files = fs.readdirSync(ADR_DIR)
    .filter((f) => /^ADR-\d{3}-.*\.md$/.test(f))
    .sort();

  const adrList = [];
  const adrNums = new Set();
  const registered = [];
  const partial = [];
  const unmarked = [];
  const unpointed = [];
  const suspicious = [];
  const tableClaims = [];

  // 第一遍：解析全部首部
  for (const file of files) {
    const parsed = parseAdrHeader(path.join(ADR_DIR, file));
    if (parsed && !parsed.error && parsed.num !== null) {
      const { num, title, status, statusLine } = parsed;
      adrList.push({ num, file, title, status, statusLine });
      adrNums.add(num);
    }
  }
  adrList.sort((a, b) => a.num - b.num || a.file.localeCompare(b.file));

  // 第二遍：逐篇判定
  for (const meta of adrList) {
    const num = meta.num;
    const text = fs.readFileSync(path.join(ADR_DIR, meta.file), 'utf8');
    const lines = text.split(/\r?\n/);

    // ① 状态行声明「被 ADR-NNN 取代」
    const mBy = meta.status.match(RE_SUPERSEDED_BY);
    const isPartial = Boolean(mBy) && /部分|局部|§\d|条目\s*\d/.test(meta.status);
    if (mBy && parseInt(mBy[1], 10) !== num) {
      const entry = { old: num, by: parseInt(mBy[1], 10), source: meta.status };
      (isPartial ? partial : registered).push(entry);
    }

    // ③ 状态行自身废弃（⚠️/🗑️ 强调或开头即废弃类词）但未指明取代者
    if (RE_SELF_DEPRECATED.test(meta.status) && !mBy) {
      unpointed.push({ num, source: meta.status });
    }

    // ② / ④ 正文扫描（跳过首部状态行）
    const headerEnd = meta.statusLine >= 0
      ? Math.min(lines.length, meta.statusLine + 1)
      : Math.min(lines.length, 20);
    for (let i = headerEnd; i < lines.length; i++) {
      const line = lines[i];

      // ② 明确宣称结构
      const targets = [];
      for (const m of line.matchAll(RE_CLAIM_A_G)) targets.push(parseInt(m[1], 10));
      for (const m of line.matchAll(RE_CLAIM_B_G)) targets.push(parseInt(m[1], 10));

      const claimedThisLine = [];
      for (const target of targets) {
        if (target !== num && adrNums.has(target)) {
          claimedThisLine.push(target);
          const tMeta = adrList.find((e) => e.num === target);
          const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
          if (!tMarked) {
            unmarked.push({ claimedBy: num, target, line: line.trim().slice(0, 120) });
          }
        }
      }

      // ④ 可疑信号
      const selfMarked = (RE_SUPERSEDED_BY.test(meta.status) && !isPartial)
        || RE_SELF_DEPRECATED.test(meta.status);
      if (claimedThisLine.length === 0 && !selfMarked && RE_DEPRECATED_WORD.test(line) && !RE_NEGATED.test(line)) {
        const others = [...new Set([...line.matchAll(/ADR-(\d+)/g)].map((m) => parseInt(m[1], 10)))]
          .filter((n) => n !== num && adrNums.has(n));
        const anyOtherMarked = others.some((o) => {
          const t = adrList.find((e) => e.num === o);
          return t && (RE_SUPERSEDED_BY.test(t.status) || RE_SELF_DEPRECATED.test(t.status));
        });
        if (!anyOtherMarked) {
          for (const other of others) {
            const tMeta = adrList.find((e) => e.num === other);
            const tMarked = RE_SUPERSEDED_BY.test(tMeta.status) || RE_SELF_DEPRECATED.test(tMeta.status);
            if (!tMarked && !KNOWN_ERRATA.has(`${num}-${other}`)) {
              suspicious.push({ num, target: other, line: line.trim().slice(0, 120) });
            }
          }
        }
      }

      // ⑤ 表格弱宣称
      const mTable = line.match(RE_TABLE_FIRST_COL);
      if (mTable && RE_TABLE_VERB.test(line) && !RE_TABLE_NEGATED.test(line)) {
        const target = parseInt(mTable[1], 10);
        if (target !== num && adrNums.has(target)) {
          const tMeta = adrList.find((e) => e.num === target);
          const numPat = String(num).replace('.', '\\.');
          const alreadyBackMarked = tMeta && new RegExp(`ADR-0*${numPat}(?!\\d)`).test(tMeta.status);
          if (!alreadyBackMarked) {
            tableClaims.push({ num, target, line: line.trim().slice(0, 120) });
          }
        }
      }
    }
  }

  // ── 输出 ──
  if (!FLAG_QUIET) {
    console.log('📄 ADR 取代关系扫描\n');

    console.log(`① 已登记取代（${registered.length}）：`);
    for (const r of registered) {
      console.log(`   ADR-${r.old} → ADR-${r.by}   [状态行: ${r.source.slice(0, 80)}]`);
    }

    console.log(`\n①b 部分推翻/部分取代 — 仅限定章节被推翻，整篇仍有效（${partial.length}）：`);
    for (const p of partial) {
      console.log(`   ADR-${p.old} 部分被 ADR-${p.by} 推翻   [状态行: ${p.source.slice(0, 80)}]`);
    }

    console.log(`\n③ 状态行含废弃/放弃但未指明取代者（${unpointed.length}）：`);
    for (const u of unpointed) {
      console.log(`   ADR-${u.num}   [${u.source.slice(0, 80)}]`);
    }

    console.log(`\n② 漏标告警 — 被正文宣称取代/废弃但首部未回标（${unmarked.length}）：`);
    for (const u of unmarked) {
      console.log(`   ADR-${u.target} 被 ADR-${u.claimedBy} 宣称 [${u.line}]`);
    }

    console.log(`\n④ 可疑信号 — 措辞不规整，对方未标记，需人工确认（${suspicious.length}）：`);
    for (const s of suspicious) {
      console.log(`   ADR-${s.num} 提及 ADR-${s.target} [${s.line}]`);
    }

    console.log(`\n⑤ 表格弱宣称 — 行首 ADR 编号 + 「本 ADR…替代/取代」跨列关系（${tableClaims.length}）：`);
    for (const t of tableClaims) {
      console.log(`   ADR-${t.num} 声称替代 ADR-${t.target} [${t.line}]`);
    }
    console.log(`\n扫描 ${adrList.length} 篇 ADR 完成。`);
  }

  // --check 模式：仅漏标（②）是流程错误 → 退出码 1
  if (FLAG_CHECK && unmarked.length > 0) {
    if (!FLAG_QUIET) {
      console.error(`\n⚠️ 存在 ${unmarked.length} 处漏标（正文宣称取代但首部未回标），请补标首部状态行。`);
    }
    process.exit(1);
  }
}

main();
