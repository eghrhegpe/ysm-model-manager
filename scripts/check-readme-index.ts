#!/usr/bin/env node
/**
 * check-readme-index.ts — scripts/README.md 与磁盘脚本对账（登记处漂移守护）。
 *
 * 背景：scripts/README.md 自称「所有 Node 工具脚本的索引」「治理检查的唯一登记处」，
 * 但 README 与 scripts/ 磁盘之间没有任何机器对账——新增/改名脚本后忘记登记 README
 * 不会被任何门禁拦下（实测 2026-08-31 审计：93 个脚本中 29 个零提及，含
 * commit-with-check / gen-routes / generate-locale-json 等高频货，且 generate-locale-json
 * 已被 pre-commit GEN_CMDS 调用）。check-workflow-refs 守住了 workflow 引用，
 * README 登记处却裸奔。本脚本把「README 必须提及每个脚本」固化为卡点。
 *
 * 判定口径：README 全文（含表格/口令表/正文）中出现脚本文件名（含 .mjs 后缀的
 * basename）即视为已登记；`_lib/` 共享层与测试文件（.test.mjs）豁免。
 *
 * 设计意图：让「唯一登记处」的声明可机检、可自执行，与 check-workflow-refs
 * 形成引用侧 + 登记侧双守护。
 * 依赖：零依赖（node:fs / node:path + _lib/scan-files.ts 的 ROOT）
 *
 * 用法：
 *   node scripts/check-readme-index.ts           # 文本报告
 *   node scripts/check-readme-index.ts --json    # JSON（CI / doctor 消费）
 *
 * 退出码：0 全部登记 / 1 存在零提及脚本（阻断）。
 */
import fs from "node:fs";
import path from "node:path";
import { collectScripts } from "./_lib/collect-scripts.ts";
import { ROOT } from "./_lib/scan-files.ts";

const SCRIPTS_DIR = path.join(ROOT, "scripts");

const JSON_OUT = process.argv.includes("--json");

/** 判定：README 中出现脚本 basename（含 .mjs）即视为已登记。
 *  basename 足够精确（README 表格列出的就是 basename），且能覆盖正文/口令表引用。
 *  纯函数供契约测试复用。 */
export function missingFromReadme(files: string[], readmeText: string) {
  return files.filter((f) => {
    const base = f.includes("/") ? f.slice(f.lastIndexOf("/") + 1) : f;
    return !readmeText.includes(base);
  });
}

/**
 * README 描述过时断言（ADR-158）：守住「唯一登记处」的描述正确性，不止于零提及。
 * 背景：missingFromReadme 只查脚本是否被提及，查不出「提及了但说错了」的漂移——
 * 例如 commit-with-check 已解耦为 _lib/commit-check，README 却仍写「委托 pre-push-gate」。
 * 本表针对发生过漂移的关键脚本登记不可过时的断言；措辞用宽松正向断言（mustInclude）
 * + 针对已删除旧句的负向断言（mustNotInclude），避免未来重构误报。
 */
export interface ReadmeAssertion {
  script: string;
  mustInclude?: string[];
  mustNotInclude?: string[];
  note?: string;
}

export const README_ASSERTIONS: ReadmeAssertion[] = [
  {
    script: "commit-with-check.ts",
    mustInclude: ["_lib/commit-check"],
    mustNotInclude: ["验证全部委托 pre-push-gate"],
    note: "ADR-155：commit-with-check 已解耦为独立轻量清单（_lib/commit-check），不再复用 pre-push-gate 重型门禁",
  },
  {
    script: "contract-tests.ts",
    mustInclude: ["tests 域不再全量"],
    mustNotInclude: ["tests 域仍全量"],
    note: "ADR-156/157：tests 域已按 CONTRACT_TEST_TARGETS 精确裁剪，不再全量",
  },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 在 README 中定位含 `…script…` 表格 token 的行（纯函数，供契约测试复用）。 */
export function findReadmeRow(readmeText: string, script: string): string | null {
  const re = new RegExp(`\`[^\`]*${escapeRegExp(script)}[^\`]*\``);
  for (const line of readmeText.split("\n")) {
    if (re.test(line)) return line;
  }
  return null;
}

/** 校验 README 关键脚本描述是否过时（纯函数，供契约测试复用）。返回违规字符串列表。 */
export function assertionViolations(
  readmeText: string,
  assertions: ReadmeAssertion[] = README_ASSERTIONS,
): string[] {
  const out: string[] = [];
  for (const a of assertions) {
    const row = findReadmeRow(readmeText, a.script);
    if (!row) continue; // 零提及由 missingFromReadme 负责
    for (const need of a.mustInclude ?? []) {
      if (!row.includes(need))
        out.push(`[README断言] ${a.script} 描述应含「${need}」却未出现（${a.note ?? ""}）`);
    }
    for (const forbid of a.mustNotInclude ?? []) {
      if (row.includes(forbid))
        out.push(`[README断言] ${a.script} 描述仍含过时措辞「${forbid}」（${a.note ?? ""}）`);
    }
  }
  return out;
}

/** 脚本名正则：反引号包裹的 basename（含 .ts/.mjs/.ps1/.sh；已删除区块还可能有 .py/.bat 历史）。 */
const SCRIPT_NAME_RE = /^`([\w.-]+\.(?:ts|mjs|ps1|sh|py|bat))`$/;

/** 提取表格行第一列的脚本名；非脚本名第一列（表头/映射表第一列）返回 null。 */
function firstColScript(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith("|")) return null;
  const cols = t.split("|");
  if (cols.length < 2) return null;
  const m = cols[1]?.trim().match(SCRIPT_NAME_RE);
  return m ? (m[1] ?? null) : null;
}

/** 脚本名 → 词干（去扩展名），用于幽灵引用的宽松匹配（event-audit.mjs 命中 event-audit 裸词）。 */
function stemOf(name: string): string {
  return name.replace(/\.(?:ts|mjs|ps1|sh|py|bat)$/, "");
}

/**
 * 重复登记检测（纯函数，供契约测试复用）：同一脚本 basename 出现在
 * 「登记性表格第一列」≥2 行 → 重复登记。
 * 口径：只数第一列（`| \`xxx.ts\` | 说明 |`），映射表（红线→工具，工具在第二列）
 * 与正文提及不算登记；ps1/sh 同名不同扩展名是不同脚本不误报。
 */
export function duplicateRegistrations(readmeText: string): string[] {
  const count = new Map<string, number>();
  for (const line of readmeText.split("\n")) {
    const name = firstColScript(line);
    if (name) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return [...count.entries()].filter(([, c]) => c > 1).map(([n]) => n);
}

/**
 * 幽灵引用检测（纯函数，供契约测试复用）：「已删除」区块登记过的脚本名，
 * 若在已删除区块之外仍被引用（完整名或词干）→ 幽灵引用。
 * 口径：已删除区块自身登记行 + 其「接管者」提及（如 event-graph.ts）不算幽灵；
 * 只在区块外搜索，避免把删除记录本身误报。
 */
export function ghostReferences(readmeText: string): string[] {
  const lines = readmeText.split("\n");
  // 定位 ### 区块边界
  const sections: Array<{ title: string; start: number }> = [];
  lines.forEach((l, i) => {
    const t = l.trim();
    if (/^###\s/.test(t)) sections.push({ title: t, start: i });
  });
  // 已删除区块范围 + 区块内第一列脚本名集合
  const deleted = new Set<string>();
  const ranges: Array<[number, number]> = [];
  for (let k = 0; k < sections.length; k++) {
    const s = sections[k]!;
    if (!s.title.startsWith("### 已删除")) continue;
    const end = k + 1 < sections.length ? sections[k + 1]!.start : lines.length;
    ranges.push([s.start, end]);
    for (let i = s.start + 1; i < end; i++) {
      const name = firstColScript(lines[i]!);
      if (name) deleted.add(name);
    }
  }
  if (!deleted.size) return [];
  // 在已删除区块之外搜索：完整名 或 词干（裸词引用也命中）
  const ghosts: string[] = [];
  for (const name of deleted) {
    const patterns = [name, stemOf(name)];
    let found = false;
    for (let i = 0; i < lines.length && !found; i++) {
      if (ranges.some(([a, b]) => i >= a && i < b)) continue;
      const line = lines[i]!;
      if (patterns.some((p) => line.includes(p))) found = true;
    }
    if (found) ghosts.push(name);
  }
  return ghosts;
}

function main() {
  const files = collectScripts({ includeNonTs: true }); // 含 hooks/ + scripts/ 下 .sh/.ps1（构建/发布脚本同样要登记）
  const readme = fs.readFileSync(path.join(SCRIPTS_DIR, "README.md"), "utf8");

  const missing = missingFromReadme(files, readme);
  const violations = assertionViolations(readme);
  const duplicates = duplicateRegistrations(readme);
  const ghosts = ghostReferences(readme);
  const clean =
    missing.length === 0 &&
    violations.length === 0 &&
    duplicates.length === 0 &&
    ghosts.length === 0;

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            scripts: files.length,
            registered: files.length - missing.length,
            missing: missing.length,
            assertionViolations: violations.length,
            duplicates: duplicates.length,
            ghosts: ghosts.length,
            ok: clean,
          },
          missing,
          assertionViolations: violations,
          duplicates,
          ghosts,
        },
        null,
        2,
      ),
    );
    if (!clean) process.exit(1);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" README 索引对账 (check-readme-index)");
  console.log("══════════════════════════════════════");
  console.log(
    `磁盘脚本 ${files.length} 个，README 已登记 ${files.length - missing.length} 个，零提及 ${missing.length} 个`,
  );
  console.log("──────────────────────────────────────");
  for (const m of missing) console.log(`❌ README 未提及: ${m}`);
  if (!missing.length) console.log("✅ 所有脚本均已登记在 scripts/README.md。");
  for (const v of violations) console.log(`❌ ${v}`);
  if (!violations.length) console.log("✅ README 关键描述均无过时措辞漂移。");
  for (const d of duplicates) console.log(`❌ README 重复登记: ${d}`);
  if (!duplicates.length) console.log("✅ README 登记性表格无重复登记。");
  for (const g of ghosts) console.log(`❌ README 幽灵引用（已删脚本仍被引用）: ${g}`);
  if (!ghosts.length) console.log("✅ README 无幽灵引用。");
  if (!clean) process.exit(1);
}

main();
