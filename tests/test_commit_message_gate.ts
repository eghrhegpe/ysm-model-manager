#!/usr/bin/env node
/**
 * test_commit_message_gate.ts — 提交信息减负闸契约测试（ADR-338-d1 刀1）。
 *
 * 覆盖三层（对齐 ADR-323「判定可单测是硬要求」）：
 *   1. 纯判定内核：每条规则的**正例 + 反例成对**（只写反例 = 规则永远命中也算绿）
 *   2. CLI 集成：真临时目录跑真实 node 进程，断言退出码三态（0 采集 / 1 strict 拒 / 2 fail-closed）
 *   3. 钩子静态接线：`.githooks/commit-msg` 含 --file 接线、**不含 --strict**
 *      （刀1 不阻断的物证——先例：tests/test_hooks_concurrency.ts 用 src.includes 断钩子）
 *
 * ⚠️ 钩子接线为何走静态源码断言而非真仓跑钩子：临时 git 仓里 `core.hooksPath` 指到本仓
 *    .githooks 后，钩子内 `$ROOT/scripts/...` 解析到的是**临时仓**根，脚本不存在 →
 *    `|| true` 兜底 exit 0，断言恒真（假绿）。故行为归 CLI 集成、接线归源码断言，两层各司。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluate,
  measureSubjectLen,
  parseCommitMessage,
  renderViolations,
  summarizeReplay,
  SUBJECT_LIMIT,
  TRAILER_KEYS,
} from "../scripts/_lib/commit-blocks/commit-message.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLI = path.join(ROOT, "scripts", "check-commit-message.ts");

const fails: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function rules(raw: string): string[] {
  return evaluate(parseCommitMessage(raw)).map((v) => v.rule);
}
function has(raw: string, rule: string): void {
  const r = rules(raw);
  assert(r.includes(rule), `应命中 ${rule}，实际 ${JSON.stringify(r)}`);
}
function lacks(raw: string, rule: string): void {
  const r = rules(raw);
  assert(!r.includes(rule), `不应命中 ${rule}，实际 ${JSON.stringify(r)}`);
}

console.log("=== 提交信息减负闸契约（ADR-338-d1）===");

// ── 1. 计量口径 ─────────────────────────────────────────
check("measureSubjectLen：CJK 一字一码点", () => {
  assert(measureSubjectLen("锐评创作者界面") === 7, String(measureSubjectLen("锐评创作者界面")));
});
check("measureSubjectLen：emoji 代理对计 1（非 String.length 的 2）", () => {
  const s = "🎯x";
  assert(s.length === 3, `UTF-16 长度应为 3（代理对 2 + x 1），实际 ${s.length}`);
  assert(measureSubjectLen(s) === 2, `码点应为 2，实际 ${measureSubjectLen(s)}`);
});

// ── 2. 解析：三道剥离 ───────────────────────────────────
check("parse：剥离 # 注释行（git commit 也带 status 注释）", () => {
  const p = parseCommitMessage("fix(a): 一句话\n\n正文行\n# 请键入提交信息\n# 未跟踪文件: x.ts\n");
  assert(p.subject === "fix(a): 一句话", p.subject);
  assert(p.bodyLines.length === 1 && p.bodyLines[0] === "正文行", JSON.stringify(p.bodyLines));
});
check("parse：剪贴线以下（--verbose 的 diff）不入正文——否则 diff 里的数字秒中台账腔", () => {
  const p = parseCommitMessage("fix(a): 一句话\n------------------------ >8 ------------------------\n# 请输入提交信息\n+  12/34 单测全绿 typecheck 无错误\n");
  assert(p.bodyLines.length === 0, JSON.stringify(p.bodyLines));
  lacks("fix(a): 一句话\n------------------------ >8 ------------------------\n+  12/34 单测全绿\n", "ledger-verification");
});
check("parse：trailer 段独立识别（与正文隔空行）", () => {
  const p = parseCommitMessage("fix(a): 一句话\n\n一句话正文\n\nVerification: 8358 unit green\nRefs: ADR-338-d1\n");
  assert(p.trailers.length === 2, JSON.stringify(p.trailers.map((t) => t.key)));
  assert(p.bodyLines.join("") === "一句话正文", JSON.stringify(p.bodyLines));
});

// ── 3. hard 规则正反例成对 ──────────────────────────────
check("subject-length：超限命中、达标不命中", () => {
  const long = "fix(a): " + "字".repeat(SUBJECT_LIMIT);
  has(long, "subject-length");
  lacks("fix(a): " + "字".repeat(10), "subject-length");
});
check("subject-prefix：常规前缀通过；无冒号 / 错 type 命中", () => {
  for (const t of ["feat", "fix", "refactor", "docs", "chore", "perf", "test", "ci", "build"]) {
    lacks(`${t}(scope): 描述`, "subject-prefix");
  }
  lacks("fix!: 破坏性描述", "subject-prefix");
  has("随便写点什么没有前缀", "subject-prefix");
  has("hotfix(a): 不在 type 表内", "subject-prefix");
});
check("subject-multi-topic：` + ` ≥2 命中；单个不命中（单主题两要素合法）", () => {
  has("fix(a): 甲 + 乙 + 丙三修", "subject-multi-topic");
  lacks("fix(a): 甲 + 乙（同一不变量的两面）", "subject-multi-topic");
});
check("subject-multi-topic：编号项罗列 ≥2 命中（台账式并联，2026-10-14 补洞）", () => {
  // 实测漏判样本：四个锐评编号用顿号枚举，` + ` 一次不出现
  has("fix(a): 四项修复落地——P0-1 甲、P1-1 乙、P1-2 丙、P1-3 丁", "subject-multi-topic");
  has("fix(a): 两处收口①甲②乙", "subject-multi-topic");
});
check("subject-multi-topic：ADR 引用不误判（假阳性回归锁）", () => {
  // 「落实 ADR-338-d1 与 ADR-339 的裁定」是引用既有决策，不是待办并联
  lacks("fix(a): 落实 ADR-338-d1 与 ADR-339 的裁定", "subject-multi-topic");
  lacks("fix(a): 按 RFC-2119 措辞", "subject-multi-topic");
});
check("subject-multi-topic：中文顿号不误判（单主题并列是正常表达）", () => {
  // 「治满载偶发假红、非掩盖」只有一个主题——按顿号计数会大面积误伤，故判据只认编号项
  lacks("test(a): 补 30s 余量、治满载偶发假红、非掩盖", "subject-multi-topic");
});
check("body-line-length：>120 命中且不重复计数（每提交至多一条）", () => {
  const vs = evaluate(parseCommitMessage("fix(a): 一句话\n\n" + "长".repeat(140) + "\n短行\n"));
  assert(vs.filter((v) => v.rule === "body-line-length").length === 1, JSON.stringify(vs));
});
check("subject-empty：空 message 只报一条且不跑后续规则", () => {
  const vs = evaluate(parseCommitMessage("# 全是注释\n# 第二行\n"));
  assert(vs.length === 1 && vs[0]!.rule === "subject-empty", JSON.stringify(vs));
});

// ── 4. warn 规则：台账腔定位 + 反例 ─────────────────────
check("ledger-verification：报告腔命中；工具名作改动对象不误伤", () => {
  has("fix(a): 一句话\n\n验证：313 单测 + 6 e2e 全绿\n", "ledger-verification");
  has("fix(a): 一句话\n\ntypecheck 无错误\n", "ledger-verification");
  lacks("fix(biome): 修 biome 格式化配置", "ledger-verification");
});
check("ledger-skipvalve：逃生键名入正文命中（应走 Skip-Evidence）", () => {
  has("fix(a): 一句话\n\nYSM_SKIP_DESIGN_TOKENS 放行 gap:8px\n", "ledger-skipvalve");
});
check("ledger-parallel：并发归属入正文命中", () => {
  has("fix(a): 一句话\n\ncontext-menu 三文件属并行会话在途改动\n", "ledger-parallel");
});
check("trailer 白名单：未知键命中、已知键不误伤", () => {
  has("fix(a): 一句话\n\nAssist-Copilot: yes\n", "trailer-unknown-key");
  lacks("fix(a): 一句话\n\nVerification: 8358 unit green\n", "trailer-unknown-key");
  assert(TRAILER_KEYS.includes("Skip-Evidence"), "Skip-Evidence 须在白名单内");
});
check("trailer 内的键名不再被台账规则二次判（Skip-Evidence 天然含 YSM_SKIP_）", () => {
  lacks("fix(a): 一句话\n\nSkip-Evidence: YSM_SKIP_DESIGN_TOKENS 存量位移\n", "ledger-skipvalve");
});

// ── 5. 豁免 ─────────────────────────────────────────────
check("豁免：Merge / Revert / fixup! / squash! / amend! 零违规", () => {
  for (const s of [
    "Merge branch 'main' of github.com:x/y",
    'Revert "feat(a): 某功能"',
    "fixup! fix(a): 上一笔",
    "squash! docs(a): 上一笔",
    "amend! chore(a): 上一笔",
  ]) {
    const p = parseCommitMessage(s + "\n\n12/34 全绿 且极长".repeat(12));
    assert(p.exempt !== null, `应豁免：${s}`);
    assert(evaluate(p).length === 0, `豁免后应零违规：${s}`);
  }
});

// ── 6. 渲染与判定分离 ───────────────────────────────────
check("render：mode 不改变判定结果（两步走「只翻开关」的前提）", () => {
  const raw = "fix(a): 甲 + 乙 + 丙三修\n\n验证：100 单测全绿\n";
  const w = evaluate(parseCommitMessage(raw), { mode: "warn" });
  const h = evaluate(parseCommitMessage(raw), { mode: "hard" });
  assert(JSON.stringify(w) === JSON.stringify(h), "同一 message 在两个 mode 下判定必须全等");
  const lw = renderViolations(w, "warn").join("\n");
  const lh = renderViolations(w, "hard").join("\n");
  assert(lw.includes("不阻断") && lh.includes("不合格"), "头行须按 mode 区分口径");
});

// ── 7. replay 聚合 ──────────────────────────────────────
check("summarizeReplay：分位走显式 subjectLen，豁免行不计合规", () => {
  const s = summarizeReplay([
    { oid: "a", subjectLen: 10, exempt: false, violations: [] },
    { oid: "b", subjectLen: 200, exempt: false, violations: [{ rule: "subject-length", severity: "hard", found: "", hint: "" }] },
    { oid: "c", subjectLen: 80, exempt: true, violations: [] },
  ]);
  assert(s.total === 3 && s.compliant === 1 && s.exempt === 1, JSON.stringify(s));
  assert(s.hardHits === 1 && s.warnHits === 0, JSON.stringify(s));
  assert(s.byRule["subject-length"] === 1, JSON.stringify(s.byRule));
  assert(s.subjectLen.median === 80 && s.subjectLen.max === 200, JSON.stringify(s.subjectLen));
});

// ── 8. CLI 集成（真进程，断退出码三态） ─────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-cmsg-"));
function runCli(args: string[]): { status: number | null; out: string; err: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf-8" });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function writeMsg(name: string, body: string): string {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, body, "utf-8");
  return f;
}
check("CLI：采集期（无 --strict）违规恒 exit 0", () => {
  const f = writeMsg("warn.txt", "fix(a): " + "字".repeat(200) + "\n");
  const r = runCli(["--file", f]);
  assert(r.status === 0, `exit 应为 0，实际 ${r.status}`);
  assert(r.err.includes("subject 超长"), `stderr 应含提示：${r.err}`);
});
check("CLI：--strict 下 hard 违规 exit 1，warn 违规仍 exit 0", () => {
  const hard = writeMsg("hard.txt", "fix(a): " + "字".repeat(200) + "\n");
  assert(runCli(["--file", hard, "--strict"]).status === 1, "hard 违规须被拒");
  const soft = writeMsg("soft.txt", "fix(a): 一句话\n\n验证：100 单测全绿\n");
  assert(runCli(["--file", soft, "--strict"]).status === 0, "仅 warn 命中不得阻断");
});
check("CLI：合规 message 在 --strict 下 exit 0", () => {
  const f = writeMsg("ok.txt", "fix(app-tree): 乐观更新时序修正\n\nVerification: 273 unit green\n");
  const r = runCli(["--file", f, "--strict", "--json"]);
  assert(r.status === 0, `exit 应为 0，实际 ${r.status}\n${r.err}`);
  const j = JSON.parse(r.out) as { _summary: { ok: boolean; blocking: boolean } };
  assert(j._summary.ok === true && j._summary.blocking === false, r.out);
});
check("CLI fail-closed：读不到 message 文件时 --strict 报 exit 2（绝不冒充通过）", () => {
  const missing = path.join(tmp, "nope.txt");
  assert(runCli(["--file", missing, "--strict"]).status === 2, "判不了必须非 0");
});
check("CLI：未知参数 exit 2；--replay 非整数 exit 2", () => {
  assert(runCli(["--bogus"]).status === 2, "未知参数须用法错");
  assert(runCli(["--replay", "abc"]).status === 2, "--replay 须整数");
});
check("CLI：--replay 只读历史出分布表（不写库）", () => {
  const r = runCli(["--replay", "30"]);
  assert(r.status === 0, `replay 应恒 0，实际 ${r.status}`);
  assert(r.err.includes("replay 校准"), `应出校准区块：${r.err.slice(-400)}`);
  assert(r.err.includes("subject 码点"), "应含分位行");
});

// ── 9. 钩子静态接线 ─────────────────────────────────────
check("钩子：.githooks/commit-msg 已接线，且刀1 刻意不带 --strict", () => {
  const src = fs.readFileSync(path.join(ROOT, ".githooks", "commit-msg"), "utf-8");
  assert(src.includes('check-commit-message.ts" --file "$MSG"'), "须以 git 的 $1 作 --file");
  // 去除注释行后检查 --strict——否则注释里的 "--strict" 会误判
  const codeLines = src.split("\n").filter((l) => !l.trimStart().startsWith("#"));
  assert(!codeLines.some((l) => l.includes("--strict")), "刀1 = 采集期：脚本调用不可带 --strict（须先出 replay 数据拍板）");
  assert(src.includes("YSM_SKIP_COMMIT_MSG"), "须有独立逃生键（与其他闸解耦）");
  assert(src.includes("hook-audit.ts"), "逃生须复用留痕通道（ADR-232 D2），不得静默跳过");
  assert(src.includes("|| true"), "采集期须吃掉退出码，绝不卡提交");
});
check("钩子：core.hooksPath 已配置（否则新钩子永不生效）", () => {
  const p = execFileSync("git", ["config", "core.hooksPath"], { cwd: ROOT, encoding: "utf-8" }).trim();
  assert(p === ".githooks", `core.hooksPath=${p}`);
});

// ── 10. 门禁入册（仓内「只减不增型闸一律双挂」不变量） ──
check("gate-config：check-commit-message.ts 已入 ALL 清单（防 --no-verify 单点绕过）", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "_lib", "gate-config.ts"), "utf-8");
  assert(src.includes('tool: "check-commit-message.ts"'), "未双挂＝刀2 未完成（本断言钉入册口径）");
});

console.log("");
if (fails.length) {
  console.log(`FAIL ${fails.length} 项: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("PASS 提交信息减负闸契约全绿");
