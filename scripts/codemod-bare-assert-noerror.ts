/**
 * 机械 codemod：`if err != nil { t.Fatal(err) }` → `testutil.NoError(t, err)`。
 *
 * 背景（ADR-202 刀5 债）：全库约 5000 处裸断言。裸 t.Fatal 失败输出无 diff，
 * 调试往返翻倍；testutil 断言失败输出带前缀。本 codemod 只处理**最规整形态**，
 * 一次清几百处，改完必须 go build + go test 验绿、账本 --update-baseline 收缩。
 *
 * 安全子集（只匹配、且只匹配以下 3 行结构，缺一即跳过）：
 *   <indent>if <err> != nil {
 *   <indent>\t<recv>.Fatal(<err>)
 *   <indent>}
 * - 不含 `if err := f(); err != nil {`（init-statement）：那种形态 err 作用域限于
 *   if，挪到外面会编译错，**故意不匹配**。
 * - 不含 else / else-if：挪出 if 后 else 语义不可等价。
 * - err / recv 必须是纯标识符（`t.Fatal(err)` 这种，不是 `t.Fatalf("...", err)`）。
 *
 * 导入选源（防 test 导入环）：
 * - 默认用 go 侧 `ysm-model-manager/go/internal/testutil`（带 WriteTestFile/MakeZipBytes 等）。
 * - 但 `go/internal/testutil` 依赖 `go/types/registry` 等包；若本文件所在包在
 *   `go list -deps go/internal/testutil` 闭包里，改用**根桥** `ysm-model-manager/internal/testutil`
 *   （自包含，只引 stdlib+go-cmp），否则成 test 导入环（实测踩过）。
 *
 * 用法：
 *   node scripts/codemod-bare-assert-noerror.ts --dry-run   # 只报告：file:line + 所在函数 + before/after
 *   node scripts/codemod-bare-assert-noerror.ts             # 应用：改写文件 + gofmt + 报告统计
 *
 * 依赖：零第三方依赖（仅 node:fs / node:path / node:child_process + go / gofmt 命令）。
 * 退出码：恒 0。情报型清债工具，不承担门禁阻断；gofmt 失败仅 stderr 警告并继续。
 * 设计意图：把「~5000 处裸断言」从手工逐文件清理变成一条可复用口令——只吃**最规整
 *   形态**保证机械正确（其余形态留给后续扩展或手工），应用后 go build + go test 验绿、
 *   账本 --update-baseline 收缩，让债「永远可见」且可批量削减。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MODULE = "ysm-model-manager";
const posix = (p: string) => p.split(path.sep).join("/");

const DRY_RUN = process.argv.includes("--dry-run");

// ---------- 扫描 ----------
const SKIP_DIRS = ["node_modules", "vendor", "upstream", "testdata"];
const TESTUTIL_TREES = [
  "go/internal/testutil/",
  "internal/testutil/",
];
function walk(d: string): string[] {
  const out: string[] = [];
  let e: string[];
  try { e = readdirSync(d, { withFileTypes: true }) as unknown as string[]; } catch { return out; }
  // 使用 fs.Dirent 语义：readdirSync 带 withFileTypes 返回 Dirent 对象
  for (const x of e as unknown as { name: string; isDirectory(): boolean; isFile(): boolean }[]) {
    if (x.isDirectory()) {
      if (SKIP_DIRS.includes(x.name)) continue;
      out.push(...walk(path.join(d, x.name)));
    } else if (x.isFile() && x.name.endsWith("_test.go")) {
      out.push(path.join(d, x.name));
    }
  }
  return out;
}

// ---------- 导入环检测：go/internal/testutil 的模块内依赖闭包 ----------
function computeCyclePkgs(): Set<string> {
  const set = new Set<string>();
  try {
    const out = execFileSync("go", ["list", "-deps", `${MODULE}/go/internal/testutil`], {
      encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      const p = line.trim();
      if (p.startsWith(MODULE + "/") && !p.endsWith("/go/internal/testutil")) set.add(p);
    }
  } catch {
    /* 检测失败则保守：全部用根桥（根桥永远安全） */
  }
  return set;
}

// ---------- 导入源选择（防 test 导入环 + Go internal 可见性） ----------
function importPathFor(relDir: string, cyclePkgs: Set<string>): string {
  const pkgPath = `${MODULE}/${posix(relDir).replace(/\//g, "/")}`;
  // ① go/internal/testutil 是 `go/` 子树的 internal 包：仅 go/ 子树内可 import（Go 可见性规则）。
  //    根 internal/app 等不在 go/ 子树 → 用根桥。
  // ② go/ 子树内但 go/internal/testutil 依赖它（cyclePkgs）→ 也用根桥，否则 test 导入环。
  const underGo = pkgPath.startsWith(`${MODULE}/go/`);
  if (underGo && !cyclePkgs.has(pkgPath)) return `${MODULE}/go/internal/testutil`;
  return `${MODULE}/internal/testutil`;
}

function ensureImport(src: string, imp: string): string {
  const quoted = `"${imp}"`;
  if (src.includes(quoted)) return src;
  const m = src.match(/import \(\s*\n([\s\S]*?)\n\s*\)/);
  if (!m) return src; // 无 import 块：跳过（极罕见）
  const block = m[1]!;
  // 插入到最后一个空行分组的末尾
  const groups = block.split(/\n\s*\n/);
  const last = groups[groups.length - 1]!;
  const newLast = last.replace(/\s*$/, "") + "\n\t" + quoted;
  groups[groups.length - 1] = newLast;
  return src.replace(block, groups.join("\n\n"));
}

// ---------- 单文件匹配 ----------
interface Site {
  file: string;
  line: number;      // if 行（1-based）
  fn: string;
  before: string[];  // 3 行
  after: string;     // 1 行
}

function enclosingFunc(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    const m = lines[i]!.match(/^\s*func\s+([^({]+)/);
    if (m) return m[1]!.trim();
  }
  return "(文件级)";
}

/** 取所在函数签名（含参数类型）。 */
function enclosingSig(lines: string[], idx: number): string {
  for (let i = idx; i >= 0; i--) {
    if (/^\s*func\b/.test(lines[i]!)) {
      let sig = lines[i]!;
      for (let j = i + 1; j < lines.length; j++) {
        sig += " " + lines[j]!.trim();
        if (lines[j]!.trim().endsWith("{")) break;
      }
      return sig;
    }
  }
  return "";
}

/** 安全网：testutil.NoError 只收 *testing.T。
 *  fuzz(*testing.F) / bench(*testing.B) / testing.TB 有 Fatal 但不是 *testing.T，必须跳过。
 *  签名取不到（保守）也跳过。 */
function tIsConcreteT(lines: string[], idx: number): boolean {
  const sig = enclosingSig(lines, idx);
  if (!sig) return false;
  if (/\*testing\.T\b/.test(sig)) {
    // 同一签名里同时出现 TB/F/B（罕见）→ 保守跳过
    if (/testing\.(TB|F|B)\b/.test(sig)) return false;
    return true;
  }
  return false;
}

function findSites(rel: string, src: string): Site[] {
  const lines = src.split("\n");
  const sites: Site[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^([\t ]+)if (\w+) != nil \{$/);
    if (!m) continue;
    const indent = m[1]!;
    const err = m[2]!;
    const body = lines[i + 1];
    const close = lines[i + 2];
    if (!body || !close) continue;
    const bm = body.match(new RegExp(`^${escapeRe(indent)}\\t(\\w+)\\.Fatal\\(${escapeRe(err)}\\)\\s*$`));
    if (!bm) continue;
    if (close.trim() !== "}" || close.slice(0, indent.length) !== indent) continue;
    const recv = bm[1]!;
    // 安全网：非 *testing.T 的 Fatal（fuzz/bench/TB）不能过 testutil.NoError
    if (!tIsConcreteT(lines, i)) continue;
    sites.push({
      file: rel,
      line: i + 1,
      fn: enclosingFunc(lines, i),
      before: [lines[i]!, body, close],
      after: `${indent}testutil.NoError(${recv}, ${err})`,
    });
  }
  return sites;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- 应用：替换 3 行为 1 行 ----------
function applySite(lines: string[], start: number): void {
  lines.splice(start, 3);
}

function applyFile(rel: string, sites: Site[], imp: string): { applied: number } {
  const abs = path.join(ROOT, rel);
  let src = readFileSync(abs, "utf8");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  // 从后往前替换，避免行号漂移
  const byLine = sites.slice().sort((a, b) => b.line - a.line);
  for (const s of byLine) {
    const idx = s.line - 1;
    // 校验现场未变（防并发会话改同一文件）
    if (lines[idx] !== s.before[0] || lines[idx + 1] !== s.before[1] || lines[idx + 2] !== s.before[2]) continue;
    lines[idx] = s.after;
    lines.splice(idx + 1, 2);
  }
  src = lines.join("\n");
  src = ensureImport(src, imp);
  writeFileSync(abs, src, "utf8");
  // gofmt
  const g = spawnSync("gofmt", ["-w", abs], { encoding: "utf8" });
  if (g.status !== 0) {
    process.stderr.write(`⚠️ gofmt 失败 ${rel}: ${g.stderr || ""}\n`);
  }
  return { applied: byLine.length };
}

// ---------- 主流程 ----------
const cyclePkgs = computeCyclePkgs();
const allFiles: string[] = [];
for (const base of ["go", "internal"]) {
  if (!existsSync(path.join(ROOT, base))) continue;
  for (const f of walk(path.join(ROOT, base))) {
    const rel = posix(path.relative(ROOT, f));
    if (TESTUTIL_TREES.some((t) => rel.startsWith(t))) continue;
    allFiles.push(rel);
  }
}

let total = 0;
const perFile = new Map<string, Site[]>();
for (const rel of allFiles) {
  let src: string;
  try { src = readFileSync(path.join(ROOT, rel), "utf8"); } catch { continue; }
  if (!/\btesting\.T\b/.test(src)) continue; // 安全网：文件里得有 testing.T
  const sites = findSites(rel, src);
  if (sites.length === 0) continue;
  perFile.set(rel, sites);
  total += sites.length;
}

console.log("══════════════════════════════════════════════════════");
console.log(`裸断言 codemod（最规整形态 if err != nil { t.Fatal(err) }）`);
console.log(`  匹配文件数: ${perFile.size}   匹配处数: ${total}`);
console.log(`  导入环规避包数（用根桥）: ${cyclePkgs.size}`);
console.log(`  模式: ${DRY_RUN ? "DRY-RUN（只报告）" : "应用"}`);
console.log("══════════════════════════════════════════════════════");

const rows: { file: string; line: number; fn: string; before: string; after: string }[] = [];
for (const [rel, sites] of [...perFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const dir = path.posix.dirname(rel);
  const imp = importPathFor(dir, cyclePkgs);
  if (DRY_RUN) {
    for (const s of sites) rows.push({ file: rel, line: s.line, fn: s.fn, before: s.before.join(" "), after: s.after });
  } else {
    applyFile(rel, sites, imp);
  }
}

// 报告：file:line + 所在函数 + before → after
for (const r of rows.slice(0, 120)) {
  console.log(`\n【${r.file}:${r.line}】 func ${r.fn}`);
  console.log(`   - ${r.before}`);
  console.log(`   + ${r.after}`);
}
if (rows.length > 120) console.log(`\n… 另有 ${rows.length - 120} 处（共 ${rows.length}）`);
console.log(`\n合计可替换: ${total} 处 / ${perFile.size} 文件`);

if (!DRY_RUN) {
  console.log("\n已应用并 gofmt。下一步必须：go build ./... + go test ./... + 账本 --update-baseline");
}