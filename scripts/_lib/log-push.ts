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
  appendPushLog(line);
}

/** 追加到 .git/push-log（logPush 与 logPushVerdict 共用；失败不阻断门禁）。 */
function appendPushLog(line: string) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${line}\n`);
  } catch {
    /* 日志写入失败不阻断门禁 */
  }
}

/**
 * 终态结论通道：无视 muted，始终写 stderr + push-log。
 *
 * 为什么需要它（2026-10-08 静态治理门禁 CI 碎片流复盘）：--json 模式把人读文本流
 * 整体静音（logPush 只落 push-log），是为「stdout 纯 JSON 供机器消费」设计的。但
 * CI 的 Actions 日志面板消费方是**人眼**——静音后 FAIL 明细块（归属→前 ≤4 条错误→
 * 复现）与结论行一个字都看不到，只剩一坨含 raw 的 JSON 碎片流。
 *
 * 两通道本就分离（JSON 走 stdout、文本走 stderr），静音的真实理由只是防 `2>&1`
 * 合并后污染 JSON.parse——而经核实的消费者（doctor --json 透传 stdio 分离、
 * CI `| Out-String` 只捕 stdout）都不合并。故让「终态结论行」走此直通通道：
 * 机器从 stdout 拿结构化 JSON，人从 stderr 拿策展结论，各取所需、互不污染。
 *
 * 用途边界：只给 FAIL 明细块 / 结论行 / SKIP / 修复指引等**终态**行——逐条 OK 明细
 * 仍走 logPush（静音），否则 32 行 OK 会把 stderr 重新灌满、失去策展意义。
 */
export function logPushVerdict(line: string) {
  process.stderr.write(`${line}\n`);
  appendPushLog(line);
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
