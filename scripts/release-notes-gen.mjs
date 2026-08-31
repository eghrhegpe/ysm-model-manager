#!/usr/bin/env node
/**
 * 收集 git 数据，供子智能体写发版说明。
 * 由 scripts/release-notes-gen.py 迁移（2026-08-03），逻辑逐点保真。
 * release-notes-gen.mjs — 发布说明生成器
 * 设计意图：发布说明生成器
 * 依赖：node:path / node:url / scripts/_lib/{scan-files,proc}.mjs
 * 用法：
 *   node scripts/release-notes-gen.mjs                 # 默认行为（输出 JSON 数据）
 *   node scripts/release-notes-gen.mjs --check         # 漂移校验：git tag 必须有对应发版说明 md
 * 退出码：--check 发现缺失 → 1；git 查询失败（fail-closed）→ 1；否则 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_lib/scan-files.mjs';
import { run as runProc } from './_lib/proc.ts';

const argv = process.argv.slice(2);
// 未知 flag 白名单拦截（批次4 P2）：`--chck` 拼错会被 includes 静默忽略 → 走进 collect 而非
// --check 门禁（发版说明漂移检查退化假绿）。拼错即退 1。
const UNKNOWN_FLAGS = argv.filter((a) => a.startsWith("--") && !["--check", "--json", "--help", "-h"].includes(a));
if (UNKNOWN_FLAGS.length) {
  console.error(`[release-notes-gen] 未知 flag: ${UNKNOWN_FLAGS.join(", ")}（支持 --check）`);
  process.exit(1);
}
const CHECK = argv.includes("--check");
const RELEASES_DIR = path.join(ROOT, 'docs', 'releases');
/** 豁免 tag：非正式发版（预发布/开源准备等临时标记），不要求发版说明。
 * v1.7.0-open-source-prep.20260617 为开源准备临时 tag，非正式版本（历史遗留）。 */
const EXEMPT_TAGS = new Set(['v1.7.0-open-source-prep.20260617']);


function run(cmd) {
  const r = runProc(cmd[0], cmd.slice(1), { timeout: 30000, cwd: ROOT });
  return r.ok ? r.out.trim() : '';
}

function collect() {
  // 1. 最新 tag
  let latestTag = run(['git', 'describe', '--tags', '--abbrev=0']);
  if (!latestTag) {
    latestTag = run(['git', 'rev-list', '--max-parents=0', 'HEAD']);
  }

  // 2. commit 列表
  const rawLog = run(['git', 'log', `${latestTag}..HEAD`, '--oneline', '--no-merges']);
  const commits = [];
  for (const line of rawLog.split('\n')) {
    const clean = line.trim();
    if (!clean) continue;
    const parts = clean.split(' ');
    if (parts.length >= 2) {
      commits.push({ hash: parts[0], message: parts.slice(1).join(' ') });
    }
  }

  // 3. commit 归类
  const categories = { feat: [], fix: [], docs: [], refactor: [], test: [], other: [] };
  for (const c of commits) {
    const m = c.message.match(/^(feat|fix|docs|refactor|test|perf|chore|style)/);
    let key = m ? m[1] : 'other';
    if (key === 'perf') key = 'feat';
    if (key in categories) categories[key].push(c);
    else categories['other'].push(c);
  }

  // 4. diff 统计
  const diffStat = run(['git', 'diff', '--stat', `${latestTag}..HEAD`]);
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of diffStat.split('\n')) {
    let m = line.match(/(\d+) files? changed/);
    if (m) filesChanged = parseInt(m[1], 10);
    m = line.match(/(\d+) insertions?\(\+\)/);
    if (m) insertions = parseInt(m[1], 10);
    m = line.match(/(\d+) deletions?\(-\)/);
    if (m) deletions = parseInt(m[1], 10);
  }

  // 5. 文件列表（按目录分组）
  const changedFiles = [];
  const rawFiles = run(['git', 'diff', '--name-only', `${latestTag}..HEAD`]);
  for (const f of rawFiles.split('\n')) {
    const clean = f.trim();
    if (clean) changedFiles.push(clean);
  }

  // 6. 目录统计
  const dirs = {};
  for (const f of changedFiles) {
    const parts = f.split('/');
    const top = parts.length > 1 ? parts[0] : f;
    dirs[top] = (dirs[top] ?? 0) + 1;
  }

  const output = {
    latest_tag: latestTag,
    commit_count: commits.length,
    categories: Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.map((c) => c.message)])),
    stats: {
      files_changed: filesChanged,
      insertions,
      deletions,
    },
    top_dirs: Object.entries(dirs).sort((a, b) => b[1] - a[1]),
    file_list: changedFiles,
  };

  // 7. 未提交改动
  const rawUncommitted = run(['git', 'status', '--short']);
  const uncommitted = rawUncommitted.split('\n').filter((l) => l.trim());
  if (uncommitted.length) {
    const newFiles = uncommitted.filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
    const modifiedFiles = uncommitted.filter((l) => !l.startsWith('??') && l.slice(0, 2).trim()).map((l) => l.slice(3).trim());
    const deletedFiles = uncommitted.filter((l) => l.startsWith(' D')).map((l) => l.slice(3).trim());
    output.uncommitted = {
      total: uncommitted.length,
      new: newFiles,
      modified: modifiedFiles,
      deleted: deletedFiles,
    };
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

/** --check 漂移校验：git tag 是发版清单单一事实源（docs/releases/index.md 契约），
 * 每个 `vX.Y.Z` tag 必须有对应 `docs/releases/vX.Y.Z.md`（新版本只产出单一 md）。 */
function checkReleaseNotes() {
  let tags;
  // --sort=version:refname：版本序（v1.10.0 正确排在 v1.9.3 之后），前驱计算依赖此序
  const r = runProc('git', ['tag', '--list', 'v*', '--sort=version:refname'], { timeout: 30000, cwd: ROOT });
  if (!r.ok) {
    // ADR-043 fail-closed：git 不可用 = 扫描不完整，拒绝放行（不把空 tag 清单当「无漂移」）
    console.error(`❌ git tag 查询失败（扫描不完整，拒绝放行）: ${r.err || `rc=${r.rc}`}`);
    process.exit(1);
  }
  tags = r.out.split('\n').map((t) => t.trim()).filter(Boolean);

  const missing = tags.filter((t) => {
    if (EXEMPT_TAGS.has(t)) return false; // 预发布/临时 tag 豁免（非正式发版）
    // 兼容历史 compare 双文件模式（index.md：v1.0.2~v1.7.0 早期遗留）——
    // `vX.md` 或 `vX-compare.md` 任一存在即算已覆盖
    return !fs.existsSync(path.join(RELEASES_DIR, `${t}.md`))
      && !fs.existsSync(path.join(RELEASES_DIR, `${t}-compare.md`));
  });
  if (missing.length) {
    console.error(`❌ ${missing.length} 个版本缺发版说明（docs/releases/<tag>.md）——发版契约（docs/releases/index.md）要求每个正式 tag 有说明。`);
    console.error('');
    console.error('  如何修（AI 可执行）：对每个缺失 tag，用下方命令收集数据后参照 docs/releases/v1.8.8.md 模板补写 vX.md，再重跑 --check 验证：');
    // 前驱映射（版本序前一 tag，无则仓库根 commit）：补写命令的区间数据来源
    const prevOf = (t) => {
      const i = tags.indexOf(t);
      return i > 0 ? tags[i - 1] : 'HEAD根commit';
    };
    for (const t of missing) {
      const prev = prevOf(t);
      console.error(`   - ${t}.md`);
      console.error(`       git log --oneline --no-merges "${prev}..${t}"  # 提交清单`);
      console.error(`       git diff --stat "${prev}..${t}"               # 变更范围`);
    }
    console.error('');
    console.error('  补写后提交；重跑 node scripts/release-notes-gen.mjs --check 验证转绿。');
    process.exit(1);
  }
  console.log(`✅ 全部 ${tags.length} 个 git tag 均有发版说明（docs/releases/ 同步）`);
  process.exit(0);
}

if (CHECK) {
  checkReleaseNotes();
} else {
  collect();
}
