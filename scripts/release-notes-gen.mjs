#!/usr/bin/env node
/**
 * 收集 git 数据，供子智能体写发版说明。
 * 由 scripts/release-notes-gen.py 迁移（2026-08-03），逻辑逐点保真。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd) {
  try {
    const stdout = execFileSync(cmd[0], cmd.slice(1), { encoding: 'utf-8', timeout: 30000, cwd: ROOT });
    return stdout.trim();
  } catch { return ''; }
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

collect();
