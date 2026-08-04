#!/usr/bin/env node
/**
 * gen-doc-next-steps.mjs — 文档体系「待补地图」生成器（诊断聚合，不修改任何源文件）
 *
 * 设计原则（与联邦「诊断型优先、治疗交给人/AI」一致）：
 *   - 只读取三个检查器的 --json 输出，聚合为一份 AI/人类可读的「哪块城邦失修、该补哪里」清单。
 *   - 不自动改写文档（避免修错比不修更糟）；产出物为只读报告 docs/.doc-next-steps.md。
 *   - 不挂钩子拦截；pre-push 钩子仅负责刷新本地图（exit 0，不打断推送心流）。
 *
 * 精炼目标：每条带精确 `file#line` 直跳锚点，通用修法提到分类头部，条目只留事实，
 *           使文档类 AI 一读即能定位并动手处理对应文档。
 *
 * 数据源（均为本项目既有 --json 检查器）：
 *   - scripts/check-knowledge-drift.mjs  → 知识卡 frontmatter / source_files / 覆盖盲区
 *   - scripts/link-checker.mjs           → markdown 断链（含 position 字符偏移）
 *   - scripts/adr-check.mjs              → ADR 撞号 / 漏登 / 幽灵 / 编号空缺
 *
 * 用法：
 *   node scripts/gen-doc-next-steps.mjs
 *
 * 零依赖：node:fs / node:path / node:url / node:child_process。
 * 退出码：0（无 process.exit 调用）
 * 设计意图：gen-doc-next-steps 工具脚本
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_PATH = path.join(ROOT, 'docs', '.doc-next-steps.md');

// ── 子进程跑检查器，吞掉非零退出（检查器遇错会 exit(1)），只取 stdout ──
function runChecker(script) {
  const p = path.join(__dirname, script);
  if (!fs.existsSync(p)) return { ok: false, raw: `检查器缺失: ${script}` };
  const r = spawnSync(process.execPath, [p, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = (r.stdout || '').trim();
  if (!out) return { ok: false, raw: `无输出（stderr: ${(r.stderr || '').trim().slice(0, 200)}）` };
  try {
    return { ok: true, data: JSON.parse(out) };
  } catch {
    return { ok: false, raw: `JSON 解析失败: ${out.slice(0, 200)}` };
  }
}

// ── 行号解析（带简单缓存，避免重复读同一文件）──
const _fileCache = new Map();
function readFileCached(rel) {
  const fp = path.join(ROOT, rel.replace(/\\/g, '/'));
  if (!_fileCache.has(fp)) {
    _fileCache.set(fp, fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null);
  }
  return _fileCache.get(fp);
}
/** 由字符偏移 position 反推 1-based 行号 + 该行原文（用于断链精确定位）。 */
function locFromPos(rel, position) {
  const text = readFileCached(rel);
  if (text == null) return { line: '?', content: '' };
  const lineNo = text.slice(0, position).split('\n').length;
  const content = text.split('\n')[lineNo - 1] || '';
  return { line: lineNo, content: content.trim() };
}
/** 在文件中找首个包含 sub 的行号（用于知识卡 source_files 条目定位）。 */
function lineOfSubstring(rel, sub) {
  const text = readFileCached(rel);
  if (text == null) return '?';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(sub)) return i + 1;
  }
  return '?';
}
const disp = (rel) => rel.replace(/\\/g, '/');

// ── 分类构建 ──
function section(title, fixHint, items) {
  if (!items.length) return [];
  const L = [`## ${title}`, '', `> 如何修：${fixHint}`, ''];
  L.push(...items);
  L.push('');
  return L;
}

function main() {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const kd = runChecker('check-knowledge-drift.mjs');
  const lc = runChecker('link-checker.mjs');
  const ac = runChecker('adr-check.mjs');

  const kdErr = kd.ok ? kd.data.errors || [] : [`⚠️ 检查器未正常运行：${kd.raw}`];
  const kdWarn = kd.ok ? kd.data.warns || [] : [];
  const broken = lc.ok ? lc.data.broken_links || [] : [];
  const adrErr = ac.ok ? ac.data.errors || [] : [`⚠️ 检查器未正常运行：${ac.raw}`];
  const adrGaps = ac.ok ? ac.data.gaps || [] : [];

  // ── 知识卡失效条目（source_files 失效带精确行号）──
  const kdItems = kdErr.map((m) => {
    const mm = m.match(/知识卡\s+(\S+\.md)\s+的 source_files 引用不存在:\s*(.+)$/);
    if (mm) {
      const cf = mm[1];
      const src = mm[2].trim();
      const ln = lineOfSubstring(`docs/knowledge/${cf}`, src);
      return `- \`docs/knowledge/${cf}#L${ln}\` → source_files 失效: \`${src}\``;
    }
    const fm = m.match(/知识卡\s+(\S+\.md)\s+(.+)$/);
    const cf = fm ? fm[1] : '（见消息）';
    return `- \`docs/knowledge/${cf}\` → ${m}`;
  });

  // ── 断链条目（带精确行号 + 原文，AI 直跳即改）──
  const linkItems = broken.map((b) => {
    const rel = disp(b.file);
    const { line, content } = locFromPos(b.file, b.position);
    const anchor = b.position != null ? `#L${line}` : '';
    return `- \`${rel}${anchor}\` → 断链 ${content || `[${b.link_text}](${b.raw_path})`}（目标不存在，类型 ${b.type}）`;
  });

  // ── ADR 条目 ──
  const adrItems = adrErr.map((m) => {
    const mm = m.match(/(ADR-\d{3}[^\s:]*|\S+\.md)/);
    const where = mm ? `\`${mm[1]}\`` : '（见消息）';
    return `- ${where} → ${m}`;
  });

  const L = [];
  L.push('# 文档体系 · AI 待补地图');
  L.push('');
  L.push('> 由 `scripts/gen-doc-next-steps.mjs` 自动生成（聚合 check-knowledge-drift / link-checker / adr-check 的 `--json`）。');
  L.push('> 生成时间: ' + ts);
  L.push('> 只读产物，供文档类 AI / 人类定位「哪块城邦失修、该补哪里」。**不修改任何源文件。**');
  L.push('> 每条 `path#Ln` 可在编辑器直跳；分类头部「如何修」为通用动作。');
  L.push('');

  L.push('## 总览');
  L.push('');
  L.push(`- 🔴 阻断级（须修）：知识卡失效 **${kdErr.length}** / 断链 **${broken.length}** / ADR 问题 **${adrErr.length}**`);
  L.push(`- 🟡 提醒级（建议补）：知识卡待补 **${kdWarn.length}** / ADR 编号空缺 **${adrGaps.length}**`);
  L.push('');

  L.push(...section('🔴 知识卡失效（ERROR）',
    '到对应行，修正/删除该 source_files 条目；若文件被移动，更新为正确路径；其余类型按消息补 frontmatter/字段',
    kdItems));

  L.push(...section('🔴 断链（ERROR）',
    '到对应行，修正相对路径或创建缺失的目标文件（锚点 #Lxx 失效时确认目标文件是否改名/移动）',
    linkItems));

  L.push(...section('🔴 ADR 体系问题（ERROR）',
    '走 new-adr.mjs 重新叫号 / 在 docs/adr/README.md 登记表占号或删幽灵行，与磁盘对账',
    adrItems));

  if (adrGaps.length) {
    L.push('## 🟡 ADR 编号空缺（INFO，可占用）');
    L.push('');
    L.push('- ' + adrGaps.map((n) => `ADR-${String(n).padStart(3, '0')}`).join('、') + ' 尚未占用，新建 ADR 时优先占用。');
    L.push('');
  }

  L.push(...section('🟡 知识卡待补（WARN）',
    '为未覆盖的源码文件补建知识卡（new-knowledge-card.mjs）并登记 source_files；其余按消息统一 H1/改指针',
    kdWarn.map((m) => `- ${m}`)));

  // ── AI 下一步建议（最高优先级单条）──
  L.push('## AI 下一步建议');
  L.push('');
  let advice;
  if (kdErr.length) {
    advice = `优先修 ${kdErr.length} 处知识卡失效（frontmatter / source_files 指向），这些会阻断文档契约。`;
  } else if (broken.length) {
    advice = `修 ${broken.length} 条断链（见上方「断链」清单，逐条到 path#Ln 改路径或补目标）。`;
  } else if (adrErr.length) {
    advice = `修 ${adrErr.length} 处 ADR 体系问题（撞号/漏登/幽灵），走 new-adr.mjs 与登记表对账。`;
  } else if (kdWarn.length) {
    advice = `处理 ${kdWarn.length} 条知识卡提醒（覆盖盲区 / H1 不一致 / 手写树），属非阻断建议，可排期补。`;
  } else if (adrGaps.length) {
    advice = `无阻断问题；ADR 编号空缺 ${adrGaps.length} 处可占用，无强制动作。`;
  } else {
    advice = '文档健康度 OK，无待补动作。';
  }
  L.push('> ' + advice);
  L.push('');

  fs.writeFileSync(OUT_PATH, L.join('\n'));

  const totalErr = kdErr.length + broken.length + adrErr.length;
  console.log(`📝 已生成 docs/.doc-next-steps.md`);
  console.log(`   阻断级(须修): ${totalErr} ｜ 提醒级: ${kdWarn.length + adrGaps.length}`);
  console.log(`   AI 建议: ${advice}`);
}

main();
