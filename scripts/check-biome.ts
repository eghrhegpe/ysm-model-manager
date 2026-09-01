#!/usr/bin/env node
/**
 * check-biome.ts — Biome 委托检查器（2026-08-27 新增，P0 落地）
 *
 * 为何自写包装而非直接调 biome：
 *   - pre-push-gate 的 FRONTEND_STATIC_TOOLS 只认 scripts/*.mjs 脚本名（或 {tool,args}）；
 *   - 门禁固定追加 --json 并以 _summary.ok 判定（pre-push-gate L345），但其伴生契约是
 *     「JSON 解析失败则退回退出码判定」。Biome 2.x 无 --json reporter，故本脚本：
 *       · 吞掉 --json（不转发给 biome，避免非法参数）；
 *       · 跑 `biome check --changed`（文本），靠退出码卡门禁；
 *       · 主动解析 biome 文本的 "Found N errors" 行，向 stdout 吐 _summary 供门禁摘要显示计数。
 *
 * 为何用 Biome（而非 dependency-cruiser）：
 *   - 项目 TypeScript 7.0.2 太新，dependency-cruiser v18 只支持 typescript<7，
 *     实测静默漏检（仅扫 14/638 模块），误绿不可用；
 *   - Biome 用自研 Rust 解析器，不依赖项目 typescript 包，TS 7 语法全解析（已实测 mmd-adapter.ts）。
 *
 * 增量策略（镜像 gofmt 范式，避免对存量未 lint 代码误伤）：
 *   - 默认 / --strict：biome check --changed（仅查相对 main 的变更文件，阻断 lint/format 违规）
 *   - --write：biome check --write --changed（本地/CI 自动修复，非阻断）
 *
 * 边界：biome check --changed 在「0 变更文件」时也退出 1（报 No files were processed），
 *   本脚本据此判定为「无文件可查=通过」，避免把空变更集误判成违规。
 *
 * 用法：
 *   node scripts/check-biome.ts            # 增量阻塞（push 门禁默认）
 *   node scripts/check-biome.ts --strict   # 同上（门禁占位，语义等价）
 *   node scripts/check-biome.ts --write    # 自动修复变更文件（pre-commit 用）
 *   node scripts/check-biome.ts --json     # 门禁注入（输出 _summary JSON）
 *
 * 依赖：frontend/node_modules/.bin/biome（Rust 解析器，不依赖项目 typescript 包）
 *
 * 退出码：0 = 通过 / 无变更文件；1 = 发现 lint/format 违规。
 *
 * 设计意图：给 pre-push 门禁提供 TS7 安全的增量 lint 闸——镜像 gofmt 范式，
 * 只查相对 main 的变更文件，避免对存量未 lint 代码误伤。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getRoot } from './_lib/scan-files.ts';
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const isWin = process.platform === 'win32';
// 复用 pre-push-gate 的跨平台 bin 解析约定（win32 用 .cmd 包装）
// monorepo 化后 biome 被 hoist 到 root node_modules/.bin（npm 10 workspace 安装位置），
// 老结构仍在 frontend/node_modules/.bin——两处都找，兼容两种安装布局。
const binName = isWin ? 'biome.cmd' : 'biome';
const biomeCandidates = [
  path.join(ROOT, 'node_modules', '.bin', binName),
  path.join(ROOT, 'frontend', 'node_modules', '.bin', binName),
];
const biomeBin = biomeCandidates.find((p) => fs.existsSync(p));

if (!biomeBin) {
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({
      _summary: { ok: false, errors: -1, note: 'biome 未安装（node_modules 缺失）——请 npm ci 后重推' },
    }));
  } else {
    console.error('[check-biome] biome 未安装（node_modules 缺失）——请 npm ci 后重推');
  }
  process.exit(1);
}

const args = process.argv.slice(2);
const writeMode = args.includes('--write');
const jsonMode = args.includes('--json');
// --strict 在 push 门禁里语义同默认（--changed 阻塞），此处仅占位保留可读性
// 注意：Biome 2.x 无 --json reporter，故绝不下传 --json 给 biome
const cmd = writeMode ? ['check', '--write', '--changed'] : ['check', '--changed'];

/** 跑 biome，捕获退出码与合并输出（biome 诊断 stdout/stderr 分布不固定）
 * 必须用 shell:true——Windows 上 .cmd 脚本（biome.cmd）无法被直接 spawn
 * （EINVAL），需经 cmd.exe 运行（proc.mjs run 的 shell 透传）；POSIX 上 shell:true 同样安全。 */
function runBiome() {
  const r = run(biomeBin, cmd, {
    cwd: path.join(ROOT, 'frontend'),
    shell: true,
  });
  return r.ok
    ? { status: 0, out: r.out }
    : { status: r.rc > 0 ? r.rc : 1, out: r.out };
}

/** 从 biome 文本输出解析 "Found N errors. / Found N warnings." 概要（Biome 2.x 格式） */
function parseSummary(text: string) {
  const errM = text.match(/Found\s+(\d+)\s+errors?/);
  const warnM = text.match(/Found\s+(\d+)\s+warnings?/);
  return {
    errors: errM ? Number(errM[1]) : -1,
    warnings: warnM ? Number(warnM[1]) : 0,
  };
}

const { status, out } = runBiome();
// 0 变更文件时 biome 退出 1 且报 "No files were processed" → 视为「无文件可查=通过」
const noFiles = /No files were processed|Checked 0 files/.test(out);
const ok = noFiles ? true : status === 0;

if (jsonMode) {
  if (ok) {
    process.stdout.write(JSON.stringify({ _summary: { ok: true, errors: 0, warnings: 0 } }));
  } else {
    const s = parseSummary(out);
    process.stdout.write(JSON.stringify({
      _summary: {
        ok: false,
        errors: s.errors,
        warnings: s.warnings,
        note: s.errors > 0 ? `biome 检出 ${s.errors} 处违规（变更文件）` : 'biome 检出违规（见上方诊断）',
      },
    }));
  }
  process.exit(ok ? 0 : 1);
}

// 人类可读模式：诊断透传（stdio inherit 已在 runBiome 用 pipe，此处补打关键行）
if (noFiles) {
  console.log('[check-biome] 无变更文件需检查 ✅');
} else if (ok) {
  console.log('[check-biome] 变更文件 lint/format 检查通过 ✅');
} else if (writeMode) {
  console.error('[check-biome] 自动修复后仍残留不可自动修复的违规，请手动处理');
} else {
  console.error('[check-biome] 变更文件存在 Biome 违规（已阻断）— 本地跑 `node scripts/check-biome.ts --write` 修复后重推');
}
process.exit(ok ? 0 : 1);
