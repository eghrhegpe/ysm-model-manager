#!/usr/bin/env node
/**
 * YSM 文件格式诊断（统一版，合并 inspect_ysm v1-v5）。
 * 检测 YSM V3 / YSGP V2 / BOM / 加密 / 内嵌文件名。
 * 由 scripts/inspect_ysm.py 迁移（2026-08-03），逻辑逐点保真。
 * inspect_ysm.mjs — inspect_ysm 工具脚本
 * 设计意图：inspect_ysm 工具脚本
 * 依赖：node:fs / node:path
 * 用法：
 *   node scripts/inspect_ysm.mjs                 # 默认行为
 *   node scripts/inspect_ysm.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：1（失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './_lib/parse-args.ts';

const SEARCH_NAMES = ['main.json', 'arm.json', 'texture.png', 'texture2.png',
  'left_arm.json', 'right_arm.json', 'arrow.json'];

function inspect(filepath) {
  const name = path.basename(filepath);
  const size = fs.statSync(filepath).size;
  const result = { file: name, size, format: 'unknown', has_bom: false,
    has_ysgp: false, has_ysm: false, has_zip: false,
    text_sections: [], binary_offset: 0, embedded_files: [],
    encrypted: false, entropy: 0 };

  const data = fs.readFileSync(filepath).subarray(0, 20000);

  // ZIP check
  if (data[0] === 0x50 && data[1] === 0x4b) { // 'PK'
    result.format = 'zip';
    result.has_zip = true;
    return result;
  }

  // BOM + YSGP
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    result.has_bom = true;
    let offset = 3;
    if (data.subarray(offset, offset + 4).toString('latin1') === 'YSGP') {
      result.format = 'ysgp_v2';
      result.has_ysgp = true;
      offset += 4;

      // Find all === markers (text section separators)
      const eqPositions = [];
      let pos = 0;
      while (true) {
        pos = data.indexOf(Buffer.from('==='), pos);
        if (pos < 0 || pos > 10000) break;
        eqPositions.push(pos);
        pos += 1;
      }

      const sections = [];
      for (const p of eqPositions) {
        let lineStart = data.lastIndexOf(0x0a, p); // '\n'
        if (lineStart < 0) lineStart = 0;
        const line = data.subarray(lineStart, p).toString('utf-8').trim();
        if (line) sections.push(line.slice(0, 80));
      }
      result.text_sections = sections;

      if (eqPositions.length) {
        const lastEq = eqPositions[eqPositions.length - 1];
        const lineEnd = data.indexOf(0x0a, lastEq);
        if (lineEnd > 0) result.binary_offset = lineEnd + 1;
      }
    }
  }

  // Raw magic check
  if (data.subarray(0, 3).toString('latin1') === 'YSM') {
    result.has_ysm = true;
    if (result.format === 'unknown') result.format = 'ysm_v3';
  }

  // Binary analysis
  if (result.binary_offset > 0) {
    const fh = fs.openSync(filepath, 'r');
    const binBuf = Buffer.alloc(500);
    fs.readSync(fh, binBuf, 0, 500, result.binary_offset);
    fs.closeSync(fh);
    const unique = new Set(binBuf.subarray(0, 100)).size;
    result.entropy = unique;
    result.encrypted = unique > 60; // high entropy = likely encrypted
  }

  // Embedded file search
  const full = fs.readFileSync(filepath);
  for (const s of SEARCH_NAMES) {
    const idx = full.indexOf(Buffer.from(s));
    if (idx >= 0) {
      result.embedded_files.push({ name: s, offset: idx });
    }
  }

  return result;
}

const args = parseArgs(process.argv.slice(2), { bools: ['json'] });
if (args.unknown.length) {
  console.error(`❌ 未知参数: ${args.unknown.join(', ')}（--help 查看用法）`);
  process.exit(1);
}
const jsonMode = args.json;
const fileArg = args._[0] ?? null;

if (!fileArg) {
  console.error('Usage: node scripts/inspect_ysm.mjs <path> [--json]');
  process.exit(1);
}

const result = inspect(fileArg);

if (jsonMode) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  const r = result;
  console.log(`=== ${r.file} (${r.size} bytes) ===`);
  console.log(`Format: ${r.format}`);
  console.log(`BOM: ${r.has_bom ? 'yes' : 'no'}`);
  console.log(`YSGP: ${r.has_ysgp ? 'yes' : 'no'}`);
  console.log(`ZIP: ${r.has_zip ? 'yes' : 'no'}`);
  if (r.text_sections.length) {
    console.log(`Text sections (${r.text_sections.length}):`);
    for (const s of r.text_sections) console.log(`  ${s}`);
  }
  if (r.binary_offset) {
    console.log(`Binary at offset: ${r.binary_offset}`);
    console.log(`Encrypted: ${r.encrypted ? 'yes' : 'no'}`);
  }
  if (r.embedded_files.length) {
    console.log(`Embedded files (${r.embedded_files.length}):`);
    for (const ef of r.embedded_files) console.log(`  ${ef.name} @ ${ef.offset}`);
  }
}
