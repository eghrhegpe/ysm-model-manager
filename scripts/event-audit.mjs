#!/usr/bin/env node
/**
 * 事件注册审计。扫描 EventsOn/bus.on 注册位置是否合规。
 * 由 scripts/event-audit.py 迁移（2026-08-03），逻辑逐点保真。
 */
import fs from 'node:fs';
import { SRC_DIR, walk, relPosix } from './_lib/scan-files.mjs';

// ADR-014 后 index.js 可能迁移为 index.ts，两者都视为合规位置
const CORRECT_FILES = new Set([
  'frontend/js/views/app-content/index.js',
  'frontend/js/views/app-content/index.ts',
]);

function scanEvents() {
  /** 扫描所有 EventsOn 和 bus.on 注册位置。 */
  const issues = [];
  const files = walk(SRC_DIR).sort();
  for (const f of files) {
    const rel = relPosix(f);
    const text = fs.readFileSync(f, 'utf-8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].trim();
      // 检测 EventsOn 注册
      if (stripped.includes('EventsOn(')) {
        let eventName = '';
        const m = stripped.match(/EventsOn\("([^"]+)"/);
        if (m) eventName = m[1];
        const safe = CORRECT_FILES.has(rel);
        if (!safe) {
          issues.push({
            file: rel, line: i + 1, code: stripped.slice(0, 80),
            event: eventName, type: 'EventsOn',
            safe_location: false,
          });
        }
      }
      // 检测 bus.on 注册
      if (/bus\.on\(/.test(stripped)) {
        let eventName = '';
        const m = stripped.match(/bus\.on\("([^"]+)"/);
        if (m) eventName = m[1];
        issues.push({
          file: rel, line: i + 1, code: stripped.slice(0, 80),
          event: eventName, type: 'bus.on',
          safe_location: CORRECT_FILES.has(rel),
        });
      }
    }
  }
  return issues;
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');

const issues = scanEvents();

if (jsonMode) {
  const out = { _summary: { total: issues.length }, issues };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
} else {
  if (!issues.length) {
    process.stdout.write('No issues found\n');
  } else {
    for (const i of issues) {
      const flag = i.safe_location ? 'OK' : 'WARN';
      process.stdout.write(`[${flag}] ${i.file}:${i.line} ${i.type} \`${i.event}\`\n`);
    }
  }
}
