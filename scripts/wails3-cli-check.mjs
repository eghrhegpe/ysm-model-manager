#!/usr/bin/env node
/**
 * wails3-cli-check.mjs — Wails v3 CLI 拼写检查（wails 必须带 3）。
 *
 * 设计意图：v2 的 `wails`（不带 3）在 v3 中为 `wails3`。AI/文档从旧资料抄
 * 命令时易写成不带 3 的裸 `wails X`——错 CLI 或漏 -ts 会生成 .js
 * bindings，破坏前端 import 契约（2026-08-05 回归教训，见 architecture.md §绑定模式）。
 * 本脚本守护活跃路径命令拼写，防止 v2→v3 迁移回归。
 *
 * 扫描活跃路径：AGENTS.md / Taskfile.yml / README.md / docs（除 archive /
 * releases / novel）/ cmd / scripts / build/*.yml / frontend/package.json。
 * 命中 `wails (generate|build|dev|bindings|doctor)`（非 wails3）即报错。
 * 豁免（历史事实/创作/刻意对照，非误导源）：
 *   - docs/archive/    历史冻结记录（bug-chronicle 等）
 *   - docs/releases/   版本发布记录（记录当时的真实命令，v2 时代为 wails）
 *   - docs/novel/      创作内容
 *   - docs/adr/ADR-001-wails3-migration.md  v2→v3 迁移对照表（左列刻意写旧命令）
 *
 * 用法：
 *   node scripts/wails3-cli-check.mjs            # 文本报告；违规 → 退出码 1
 *   node scripts/wails3-cli-check.mjs --json     # JSON（CI / 子代理消费）
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 * 退出码：发现违规 → 1；否则 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';

const JSON_OUT = process.argv.includes('--json');

// 裸 wails 命令：wails + 子命令，且 wails 后不是 3（wails3 豁免）
const RE = /\bwails(?!3)\s+(generate|build|dev|bindings|doctor)\b/g;

// 排除目录（相对 ROOT）：历史冻结 / 历史发布记录 / 创作内容 / 生成物
const EXCLUDE_DIRS = new Set([
  'docs/archive', 'docs/releases', 'docs/novel',
  '.task', 'node_modules', '.git', 'dist', 'build/bin', 'build/ysmparser-cache',
]);

// 单文件豁免：ADR-001 v2→v3 迁移对照表（左列刻意写旧命令）
const EXCLUDE_FILES = new Set(['docs/adr/ADR-001-wails3-migration.md']);

/** 递归遍历，跳过排除目录 */
function* walk(dir, rel) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (EXCLUDE_DIRS.has(relPath)) continue;
      yield* walk(full, relPath);
    } else {
      yield { full, relPath };
    }
  }
}

const fileExts = new Set(['.md', '.yml', '.yaml', '.ps1', '.sh', '.mjs', '.json']);
const results = [];
let scanned = 0;

function scanFile(full, relPath) {
  if (EXCLUDE_FILES.has(relPath)) return;
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch {
    return;
  }
  scanned++;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    RE.lastIndex = 0;
    const m = RE.exec(lines[i]);
    if (m) {
      results.push(
        `${relPath}:${i + 1}  「${lines[i].trim().slice(0, 100)}」 → v3 CLI 应写 wails3 ${m[1]}`,
      );
    }
  }
}

// 根级单文件
for (const f of ['AGENTS.md', 'Taskfile.yml', 'README.md']) {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) scanFile(full, f);
}

// 目录递归（docs 除 archive；frontend 仅 package.json 是命令入口）
for (const dir of ['docs', 'cmd', 'scripts', 'build', 'frontend']) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const { full, relPath } of walk(abs, dir)) {
    if (!fileExts.has(path.extname(relPath))) continue;
    if (relPath.startsWith('frontend/') && relPath !== 'frontend/package.json') continue;
    scanFile(full, relPath);
  }
}

if (results.length) {
  if (JSON_OUT) {
    console.log(JSON.stringify({
      _summary: { scanned, violations: results.length },
      violations: results,
    }, null, 2));
  } else {
    console.log(`❌ 发现 ${results.length} 处裸 wails 命令（应写 wails3）:`);
    for (const r of results) console.log(`  ${r}`);
    console.log('\n退出码 1：v3 项目禁止 `wails X`，统一 `wails3 X`。');
  }
  process.exit(1);
}
if (JSON_OUT) {
  console.log(JSON.stringify({ _summary: { scanned, violations: 0 }, violations: [] }, null, 2));
} else {
  console.log(`✅ wails3 CLI 拼写合规（扫描 ${scanned} 个文件，无裸 wails 命令）。`);
}
