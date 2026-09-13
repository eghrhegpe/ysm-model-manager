#!/usr/bin/env node
/**
 * log-push.ts — 推送门禁日志共享层。
 *
 * 解决 pre-push / doctor --gate 的输出可能被 git 吞掉的问题：
 *   - stdout 直写终端（交互可见）
 *   - 同时追加到 .git/push-log（持久可查）
 *
 * .git/ 目录本身不被 git 跟踪，无需 .gitignore。
 *
 * 用法：
 *   import { logPush } from './_lib/log-push.ts';
 *   logPush('[OK] go build          2.3s  编译通过');
 *   logPush('[FAIL] vitest run        45s   3 测试失败');
 *
 * 依赖：node:fs / node:path
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./scan-files.ts";

const LOG_FILE = path.join(ROOT, ".git", "push-log");

/** --json 模式静默开关（ADR-234）：true 时 logPush 只写 push-log 文件、
 * 不打 stderr——人读文本流让位给结构化 JSON 流，两者在 stdout/stderr 不再互相污染。
 * pre-push-gate 在 JSON 输出完毕后必须复位（长进程复用防护）。 */
let muted = false;
export function setLogPushMuted(v: boolean) {
  muted = v;
}

/**
 * 双写日志：stdout（stderr）+ 追加到 .git/push-log。
 * @param {string} line 日志行（已含 [OK]/[FAIL] 等标记）
 */
export function logPush(line: string) {
  // 1. stderr 写终端（stdout 可能被 git pre-push 钩子吞掉）；--json 模式静默
  if (!muted) process.stderr.write(`${line}\n`);
  // 2. 追加到 .git/push-log（持久化，不被 git 跟踪）
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${line}\n`);
  } catch {
    /* 日志写入失败不阻断门禁 */
  }
}

/** 清空日志文件（供手动重置或发版前清理）。 */
export function clearPushLog() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
    }
  } catch {
    /* 忽略 */
  }
}
