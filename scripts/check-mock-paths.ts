#!/usr/bin/env node
/**
 * check-mock-paths.ts — ADR-224 mock 路径守卫。
 *
 * vitest 的 `vi.mock("<path>")` 对不存在的模块路径静默不命中（host 视为 auto-mock）。
 * 当模块因重构/rename 被移动后，测试里指向旧路径的 mock 失效——mock 不生效、被测文件
 * 真实 import 链被拉起，测试仍可能通过，但隔离意图悄悄丢失。本守卫把这类静默病灶固化为
 * 静态检查。
 *
 * 规则分级（判定口径见 scripts/_lib/mock-path-resolve.ts，单一事实源）：
 *   M1 内部 spec（@/ #root/ ./ ../）解析失败 → FAIL（唯一 fail-closed，sync 那类病灶）
 *   M2 裸包 deps ∪ node_modules 皆无 → WARN（默认）/ FAIL（--strict）
 *   M3 .js 胶水兜底成功但写法过时（app.js→app.ts）→ INFO（只统计）
 *
 * 豁免通道（E3，没有豁免通道的守卫第一次误报就会被 --no-verify 绕过，故同批落地）：
 *   - 行内 `// mock-path-ignore: <理由>`（同一行）→ 跳过该行所有 mock
 *   - 文件级/规范级集中白名单 `docs/.mock-path-exempt.json`（{ files: [], specs: [] }）
 *     用途：虚拟模块（virtual:*) / 故意 mock 不存在路径以阻断加载的写法
 *
 * 用法：
 *   node scripts/check-mock-paths.ts           # 违规退 1（M2 默认只 WARN 不阻断）
 *   node scripts/check-mock-paths.ts --json    # JSON（CI / pre-push-gate 消费）
 *   node scripts/check-mock-paths.ts --strict  # M2 也升为 FAIL
 *   node scripts/check-mock-paths.ts --update  # 生成/规范豁免白名单文件（若缺失则建空脚手架）
 *
 * 退出码：0（无 FAIL）/ 1（含 M1 或 strict 下 M2）。
 * 依赖：node:fs / node:path / node:url / _lib/scan-files.ts / _lib/mock-path-resolve.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMock } from "./_lib/mock-path-resolve.ts";
import { readText, relPosix, toPosix, walk } from "./_lib/scan-files.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.resolve(REPO_ROOT, "frontend", "src");
const EXEMPT_FILE = path.resolve(REPO_ROOT, "docs", ".mock-path-exempt.json");

const JSON_FLAG = process.argv.includes("--json");
const STRICT_FLAG = process.argv.includes("--strict");
const UPDATE_FLAG = process.argv.includes("--update");

/** 提取一行代码里的 vi.mock / vi.doMock / vi.unmock 说明符（双引号为主，兼容单引号）。 */
const MOCK_CALL_RE = /vi\.(?:mock|doMock|unmock)\(\s*(["'])([^"']+)\1/g;

/** 逐行剥离块注释/行注释（跨行块注释用 inBlock 状态机），返回「有代码部分」。 */
function codeOnly(raw: string, state: { inBlock: boolean }): string {
  let s = raw;
  if (state.inBlock) {
    const end = s.indexOf("*/");
    if (end === -1) return ""; // 本行仍在块注释内
    s = s.slice(end + 2);
    state.inBlock = false;
  }
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  const open = s.indexOf("/*");
  if (open !== -1) {
    state.inBlock = true;
    s = s.slice(0, open);
  }
  s = s.replace(/(^|[^:])\/\/[^\n]*/, "$1");
  return s;
}

/** 装载豁免白名单（fail-soft：文件缺失/损坏 → 空清单）。 */
function loadExempt(): { files: string[]; specs: string[] } {
  try {
    const j = JSON.parse(fs.readFileSync(EXEMPT_FILE, "utf-8"));
    return {
      files: Array.isArray(j.files) ? j.files : [],
      specs: Array.isArray(j.specs) ? j.specs : [],
    };
  } catch {
    return { files: [], specs: [] };
  }
}

/** --update：生成/规范豁免白名单文件（缺失则建空脚手架）。 */
function ensureExemptFile(): void {
  if (!fs.existsSync(EXEMPT_FILE)) {
    const scaffold = {
      _comment:
        "mock 路径守卫豁免登记（ADR-224 E3）。行内豁免用 `// mock-path-ignore: <理由>`，此文件供虚拟模块(virtual:*)与故意 mock 不存在路径以阻断加载的写法登记。请附理由。",
      files: [],
      specs: [],
    };
    fs.writeFileSync(EXEMPT_FILE, `${JSON.stringify(scaffold, null, 2)}\n`, "utf-8");
  } else {
    const exempt = loadExempt();
    fs.writeFileSync(
      EXEMPT_FILE,
      `${JSON.stringify({ files: exempt.files, specs: exempt.specs }, null, 2)}\n`,
      "utf-8",
    );
  }
}

if (UPDATE_FLAG) ensureExemptFile();

interface Finding {
  rule: string;
  file: string;
  line: number;
  spec: string;
  detail: string;
}
const fails: Finding[] = [];
const warns: Finding[] = [];
const infos: Finding[] = [];

const exempt = loadExempt();
const exemptSpecs = new Set(exempt.specs);
const exemptFiles = new Set(exempt.files.map(toPosix));

const files = walk(SRC_ROOT, { rel: true }) as Array<{ abs: string; rel: string }>;

for (const { abs } of files) {
  const rel = toPosix(relPosix(abs)); // frontend/src/... 相对仓库根
  if (exemptFiles.has(rel)) continue; // 文件级豁免
  const raw = readText(abs);
  const state = { inBlock: false };
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const code = codeOnly(line, state); // 先无条件推进块注释状态机（豁免行若先 continue 会让 inBlock 卡死、整文件 mock 漏检）
    if (line.includes("mock-path-ignore:")) continue; // 行内豁免：跳过该行所有 mock
    if (!code.trim()) continue;
    for (const m of code.matchAll(MOCK_CALL_RE)) {
      const spec = m[2];
      if (!spec) continue;
      if (exemptSpecs.has(spec)) continue; // spec 级豁免（virtual:* 等）
      const c = classifyMock(spec, abs);
      if (c.level === "ok") continue;
      const rec: Finding = {
        rule: c.level,
        file: rel,
        line: i + 1,
        spec,
        detail: c.detail,
      };
      if (c.level === "M1") fails.push(rec);
      else if (c.level === "M2") warns.push(rec);
      else infos.push(rec);
    }
  }
}

const m2AsFail = STRICT_FLAG;
const effectiveFails = fails.length + (m2AsFail ? warns.length : 0);
const ok = effectiveFails === 0;

const summary = {
  ok,
  fail: fails.length,
  warn: warns.length,
  info: infos.length,
  strict: STRICT_FLAG,
  m1_fail: fails.length,
  m2_warn_or_strict_fail: warns.length,
  m3_info: infos.length,
  m1_samples: fails.slice(0, 5).map((f) => `${f.file}:${f.line} ← ${f.spec}`),
  m2_samples: warns.slice(0, 5).map((f) => `${f.file}:${f.line} ← ${f.spec}`),
};

if (JSON_FLAG) {
  process.stdout.write(`${JSON.stringify({ _summary: summary, fails, warns, infos }, null, 2)}\n`);
} else {
  process.stdout.write(
    `check-mock-paths: ${ok ? "PASS" : "FAIL"} (fail=${summary.fail} warn=${summary.warn} info=${summary.info})\n`,
  );
  const fmt = (list: Finding[]) =>
    list.map((f) => `  ${f.rule} ${f.file}:${f.line} ← ${f.spec} ${f.detail}`).join("\n");
  if (fails.length) process.stdout.write(`M1 内部 spec 解析失败（FAIL）:\n${fmt(fails)}\n`);
  if (warns.length) {
    const tag = m2AsFail ? "（--strict 已升 FAIL）" : "（默认 WARN）";
    process.stdout.write(`M2 裸包三判据皆无（${tag}）:\n${fmt(warns)}\n`);
  }
  if (infos.length) process.stdout.write(`M3 .js→.ts 兜底（INFO）:\n${fmt(infos)}\n`);
}

process.exit(ok ? 0 : 1);
