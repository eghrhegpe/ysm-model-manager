#!/usr/bin/env node
/**
 * 事件注册审计。扫描 EventsOn/bus.on 注册位置是否合规。
 * 由 scripts/event-audit.py 迁移（2026-08-03），逻辑逐点保真。
 * event-audit.mjs — 事件系统审计
 * 设计意图：事件系统审计
 * 依赖：node:fs / 本地模块
 * 用法：
 *   node scripts/event-audit.mjs                 # 默认行为
 *   node scripts/event-audit.mjs --json # JSON 输出（CI/子代理消费）
 * 退出码：0（无 process.exit 调用）
 */
import fs from 'node:fs';
import { SRC_DIR, walk, relPosix } from './_lib/scan-files.mjs';

// ADR-014 后 index.js 可能迁移为 index.ts，两者都视为合规位置
const CORRECT_FILES = new Set([
  'frontend/src/views/app-content/index.js',
  'frontend/src/views/app-content/index.ts',
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
      // 检测 Events.On / EventsOn 注册（Wails v3 实际 API 是 `Events.On(`，
      // 旧 `EventsOn(` 已废弃——两者都查，防死代码漏检，code_review P1-1）
      if (stripped.includes('Events.On(') || stripped.includes('EventsOn(')) {
        let eventName = '';
        // P3（复核）：与 bus.on 分支对齐——支持双/单引号与模板字符串字面量，
        // 多行/动态名取不到时显式标注 <unparsed>，避免空事件名掩盖提取失败
        const m = stripped.match(/(?:Events\.On|EventsOn)\(["'`]([^"'`]+)["'`]/);
        if (m) eventName = m[1];
        else eventName = '<unparsed>';
        const safe = CORRECT_FILES.has(rel);
        if (!safe) {
          issues.push({
            file: rel, line: i + 1, code: stripped.slice(0, 80),
            event: eventName, type: 'Events.On',
            safe_location: false,
          });
        }
      }
      // 检测 bus.on 注册
      if (/bus\.on\(/.test(stripped)) {
        let eventName = '';
        // P2-1：支持双/单引号与模板字符串字面量；多行/动态名取不到时显式标注
        // `<unparsed>` 而非静默空串，避免空事件名掩盖提取失败
        const m = stripped.match(/bus\.on\(["'`]([^"'`]+)["'`]/);
        if (m) eventName = m[1];
        else eventName = '<unparsed>';
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
