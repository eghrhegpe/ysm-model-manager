#!/usr/bin/env node
/**
 * commit-temp-index.ts — 临时索引白名单提交核心（并发隔离，ADR-151）。
 *
 * 背景：commit-with-check 旧实现「先 git add 后裸 `git commit -m`」在共享 checkout 的
 * 单例 index 下存在暂存窗口：add→commit 期间并行会话的裸 commit 会打包整个主 index
 * （实证：go/conc 5 文件被并行 fix(hooks) 提交 b4d23b78 卷走）。
 *
 * 机制（用户拍板方案）：
 *   GIT_INDEX_FILE=<gitdir>/index.ymm.<pid>   ← 独立临时索引，与主 index 零竞争
 *     → git read-tree HEAD                    ← 临时索引从 HEAD 构建（非空树起点）
 *     → git add -- <paths>                    ← 白名单路径入临时索引（内容取工作区）
 *     → git commit -m                         ← 无 --only、无 pathspec
 *       —— pre-commit 钩子继承 GIT_INDEX_FILE，其 git add（gen 产物 / gofmt 修复 /
 *          智能 stage 测试，见 .githooks/pre-commit:103/204/160）全部落进临时索引
 *          → 本次提交；主 index 完全不被触碰（并发隔离目标）
 *     → finally 删临时索引                     ← 成功/失败两路径均清理
 *
 * 提交后双条件校验（调用方据此决策，本函数不自动回退）：
 *   a) git show --name-only HEAD ⊆ paths ∪ 生成物/测试白名单 → 越界文件进 outOfScope
 *   b) HEAD^ != HEAD_BEFORE（HEAD_BEFORE 为提交前快照）→ interleaved=true（并发插队通知）
 *
 * 收尾：git reset -q HEAD -- <committed paths> 清主 index（仅当主 index 含这些路径；
 * keepIndex=true 关闭）——避免提交后 git status 仍显示「已暂存」造成误判。
 *
 * 已知取舍：read-tree → add → commit 之间（毫秒级）若并行会话插队，本函数仍基于
 * 旧 HEAD 树提交（父 ref 为插队后的新 HEAD），interleaved 标记让调用方 notice；
 * 不做整体重试（与并行会话竞争有活锁风险，用户拍板 notice-only）。
 *
 * 零依赖（node:fs / node:path + ./proc.ts / ./scan-files.ts）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { run } from './proc.ts';
import { ROOT } from './scan-files.ts';

/** commitWithTempIndex 选项。 */
export interface CommitTempIndexOptions {
  /** 白名单路径（git pathspec，相对 cwd/仓库根；内容一律取工作区）。 */
  paths: string[];
  /** commit message。 */
  message: string;
  /** 仓库根，默认 ROOT。 */
  cwd?: string;
  /** true 则提交后不清主 index（跳过 reset 收尾）。 */
  keepIndex?: boolean;
}

/** commitWithTempIndex 结果。 */
export interface CommitTempIndexResult {
  ok: boolean;
  /** 新提交 SHA（失败时 undefined）。 */
  sha?: string;
  /** 本次提交涉及的文件（git show --name-only HEAD）。 */
  committedFiles: string[];
  /** 越界文件：不在 paths ∪ 生成物/测试白名单内（调用方据此 exit 1）。 */
  outOfScope: string[];
  /** 并发插队标记：HEAD^ != HEAD_BEFORE（调用方据此 notice，不失败）。 */
  interleaved: boolean;
  /** 失败原因（ok=false 时）。 */
  error?: string;
}

/** 生成物/测试白名单判定：pre-commit 钩子合法 stage 的非 paths 产物。
 *  gen 产物落 docs/、frontend/public/locales/、completions/（.githooks/pre-commit 快照目录）；
 *  智能 stage 只收 *.test.* / *.spec.*（.githooks/pre-commit:160 ADR-087）。 */
export function isHookArtifact(f: string): boolean {
  return (
    f.startsWith('docs/') ||
    f.startsWith('frontend/public/locales/') ||
    f.startsWith('completions/') ||
    /\.(test|spec)\.[jt]s$/.test(f)
  );
}

/** git 执行（统一 -c core.quotepath=false，防中文路径八进制转义）。
 *  timeoutMs 可选：commit 等重操作需显式加长（pre-commit 钩子串行 go test 可超 20s，
 *  默认 30s 会掐断，与旧 commit-with-check gitArray 600_000 对齐）。 */
function git(args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) {
  // exactOptionalPropertyTypes：env/timeoutMs 为 undefined 时显式省略，避免把 undefined 塞给可选字段
  const runOpts: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number } = { cwd: opts.cwd };
  if (opts.env) runOpts.env = opts.env;
  if (opts.timeoutMs !== undefined) runOpts.timeout = opts.timeoutMs;
  return run('git', ['-c', 'core.quotepath=false', ...args], runOpts);
}

/**
 * 临时索引白名单提交。见文件头机制说明。
 * 不抛异常：所有失败以 { ok:false, error } 返回；临时索引在 finally 兜底清理。
 */
export function commitWithTempIndex(opts: CommitTempIndexOptions): CommitTempIndexResult {
  const cwd = opts.cwd ?? ROOT;
  const paths = opts.paths.filter((p) => p && p.trim() !== '');
  const fail = (error: string): CommitTempIndexResult =>
    ({ ok: false, committedFiles: [], outOfScope: [], interleaved: false, error });

  // gitdir 定位（worktree 场景返回独立 gitdir，临时索引随仓库隔离）
  const gd = git(['rev-parse', '--git-dir'], { cwd });
  if (!gd.ok) return fail(`git rev-parse --git-dir 失败: ${gd.err}`);
  const gitDir = path.resolve(cwd, gd.out.trim());

  // 独立临时索引：与主 index（.git/index）完全隔离，零 lock 竞争
  const tmpIndex = path.join(gitDir, `index.ymm.${process.pid}`);
  const tmpEnv: NodeJS.ProcessEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex };

  try {
    // HEAD_BEFORE：插队检测基准。空仓库（无 HEAD）首提交场景容错为 ''（无父可比，interleaved=false）
    const headBeforeR = git(['rev-parse', 'HEAD'], { cwd });
    const headBefore = headBeforeR.ok ? headBeforeR.out.trim() : '';

    // ① 临时索引从 HEAD 构建（空树起点会误删全部未白名单文件）
    // 无 HEAD（全新仓库首提交）时 read-tree 失败 → 降级：临时索引保持空，git add 建 initial commit
    //（与旧裸 `git commit` 在空仓库建首提交的行为一致，不回归）
    const rt = git(['read-tree', 'HEAD'], { cwd, env: tmpEnv });
    if (!rt.ok) {
      const headChk = git(['rev-parse', '--verify', 'HEAD'], { cwd });
      if (headChk.ok) return fail(`git read-tree HEAD 失败: ${rt.err}`);
      // headChk 失败 = 无 HEAD（空仓库），降级继续
    }

    // ② 白名单路径入临时索引（内容取工作区，不依赖主 index 已暂存）
    const add = git(['add', '--', ...paths], { cwd, env: tmpEnv });
    if (!add.ok) return fail(`git add -- 失败: ${add.err}`);

    // 无变更检查（临时索引视角）：diff --cached 为空 = 白名单无改动
    const staged = git(['diff', '--cached', '--name-only'], { cwd, env: tmpEnv });
    const stagedFiles = staged.ok ? staged.out.split('\n').filter(Boolean) : [];
    if (stagedFiles.length === 0) return fail('无变更可提交（临时索引为空，白名单路径相对 HEAD 无改动）');

    // ③ 提交：无 --only、无 pathspec；钩子继承 GIT_INDEX_FILE，stage 落临时索引 → 进本次提交
    // 10 分钟超时：pre-commit 钩子（gen 串行 + gofmt + 智能 stage + 串行 go test）可远超 30s 默认
    const commit = git(['commit', '-m', opts.message], { cwd, env: tmpEnv, timeoutMs: 600_000 });
    if (!commit.ok) return fail(`git commit 失败（可能 pre-commit 钩子拦截或 message 格式问题）: ${commit.err}`);

    const shaR = git(['rev-parse', 'HEAD'], { cwd });
    const sha = shaR.ok ? shaR.out.trim() : undefined;

    // ④a 提交内容校验：越界文件 = 不在 paths ∪ 白名单
    const show = git(['show', '--name-only', '--format=', 'HEAD'], { cwd });
    const committedFiles = show.ok ? show.out.split('\n').filter(Boolean) : [];
    const pathSet = new Set(paths);
    const outOfScope = committedFiles.filter((f) => !pathSet.has(f) && !isHookArtifact(f));

    // ④b 插队检测：HEAD^ != HEAD_BEFORE（root commit 无父时 HEAD^ 失败 → 不算插队）
    const parentR = git(['rev-parse', 'HEAD^'], { cwd });
    const interleaved = parentR.ok ? parentR.out.trim() !== headBefore : false;

    // ⑤ 收尾：清主 index（仅当主 index 含已提交路径；keepIndex 关闭）——
    //    避免提交后 git status 仍显示「已暂存」（内容已入库，暂存是陈旧态）
    if (!opts.keepIndex && committedFiles.length > 0) {
      const mainStagedR = git(['diff', '--cached', '--name-only'], { cwd }); // 无 tmpEnv → 主 index
      const mainStaged = mainStagedR.ok ? mainStagedR.out.split('\n').filter(Boolean) : [];
      const toReset = committedFiles.filter((f) => mainStaged.includes(f));
      if (toReset.length > 0) {
        git(['reset', '-q', 'HEAD', '--', ...toReset], { cwd });
      }
    }

    // exactOptionalPropertyTypes：sha 可空时显式省略字段（不塞 undefined）
    const result: CommitTempIndexResult = { ok: true, committedFiles, outOfScope, interleaved };
    if (sha !== undefined) result.sha = sha;
    return result;
  } finally {
    // 成功/失败两路径均清理临时索引（含可能的 .lock 残留）
    for (const f of [tmpIndex, `${tmpIndex}.lock`]) {
      try {
        fs.rmSync(f, { force: true });
      } catch { /* 清理失败忽略（下次提交用新 pid 文件名，不冲突） */ }
    }
  }
}
