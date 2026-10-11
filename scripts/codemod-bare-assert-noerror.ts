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
 * - err / recv 必须是纯标识符（`t.Fatal(err)` 这种）。另支持**规整 Fatalf 形态**：
 *   `t.Fatalf("<fmt>", err)`（恰 2 参、fmt 是双引号字面量、尾随单个 %v/%w、err 为唯一变量）
 *   → `testutil.NoError(t, err, "<前缀>")`；fmt 就是 "%v" → 无前缀。fmt 含其它 verb /
 *   含转义引号 / 多 verb 时**跳过不猜**（宁少转不错转）。
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

/** 把 `Fatalf("<fmt>", err)` 的 fmt 机械映射成 testutil 消息。
 *  只认规整形态：fmt 为双引号字面量、**恰一个**尾随 %v/%w、err 是唯一变量参数。
 *  映射失败返回 null（跳过，不猜）——宁少转不错转。 */
function mapFatalfMsg(fmtRaw: string): string | null {
  const body = fmtRaw.slice(1, -1); // 去双引号
  if (/[\\"]/.test(body)) return null; // 含转义引号/反斜杠：fmt 可能是拼接或复杂文本，跳过
  if ((body.match(/%[^vw]/g) || []).length > 0) return null; // 其它 verb（%d/%s/%%…）
  if ((body.match(/%[vw]/g) || []).length !== 1) return null; // 只认单个 %v/%w
  if (/^%[vw]$/.test(body)) return '""'; // fmt 就是 "%v" → 无前缀
  const m = body.match(/^(.*?)\s*:\s*%[vw]$/) || body.match(/^(.*?)\s+%[vw]$/);
  if (!m) return null;
  const prefix = m[1]!;
  if (!prefix || prefix.includes("%")) return null;
  return JSON.stringify(prefix);
}

function findSites(rel: string, src: string): Site[] {
  const lines = src.split("\n");
  const sites: Site[] = [];
  // ---- 形态 A/B：`if X != nil {` 3 行规整块（无 init、块内唯一语句）----
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^([\t ]+)if (\w+) != nil \{$/);
    if (!m) continue;
    const indent = m[1]!;
    const err = m[2]!;
    const body = lines[i + 1];
    const close = lines[i + 2];
    if (!body || !close) continue;
    if (close.trim() !== "}" || close.slice(0, indent.length) !== indent) continue;
    // 形态 A：t.Fatal(err)
    const a = body.match(new RegExp(`^${escapeRe(indent)}\\t(\\w+)\\.Fatal\\(${escapeRe(err)}\\)\\s*$`));
    // 形态 B：t.Fatalf("<fmt>", err)（规整：恰 2 参、fmt 字面量、err 是唯一变量）
    const b = body.match(new RegExp(`^${escapeRe(indent)}\\t(\\w+)\\.Fatalf\\(("(?:[^"\\\\]|\\\\.)*")\\s*,\\s*${escapeRe(err)}\\)\\s*$`));
    let after: string | null = null;
    if (a) {
      const recv = a[1]!;
      if (!tIsConcreteT(lines, i)) continue;
      after = `${indent}testutil.NoError(${recv}, ${err})`;
    } else if (b) {
      const recv = b[1]!;
      const msg = mapFatalfMsg(b[2]!);
      if (msg === null || !tIsConcreteT(lines, i)) continue;
      after = `${indent}testutil.NoError(${recv}, ${err}, ${msg})`;
    } else {
      continue;
    }
    sites.push({
      file: rel,
      line: i + 1,
      fn: enclosingFunc(lines, i),
      before: [lines[i]!, body, close],
      after,
    });
  }
  // ---- 形态 C：`if [init;] X != nil {` 块内（任意深度）独立成行、与头 nil 变量同名
  //      的 t.Fatal(X) / 规整 t.Fatalf(fmt, X)。只换块内行，保留 if 结构——
  //      init-statement / else / 多语句块通吃，语义严格等价。----
  for (let i = 0; i < lines.length; i++) {
    const stripped = stripLine(lines[i]!);
    // 宽松头：`if [任意条件] <var> != nil {`（兼容 init 头 `if err := f(); err != nil {`、
    // 多条件；末尾 `(\w+) != nil` 的变量即被检查对象，块内 Fatal 须与其同名才换）
    const h = stripped.match(/^([\t ]+)if\s+[\s\S]*?(\w+)\s*!=\s*nil\s*\{$/);
    if (!h) continue;
    const indent = h[1]!;
    const nilVar = h[2]!;
    const hasInit = /;\s*\w+\s*!=\s*nil\s*\{$/.test(stripped);
    // 跳过形态 A/B 已覆盖的「无 init + 块内唯一语句」3 行块（防重复）
    if (!hasInit) {
      const b1 = lines[i + 1];
      const c1 = lines[i + 2];
      const singleFatal = b1 && c1 && c1.trim() === "}" && c1.slice(0, indent.length) === indent &&
        new RegExp(`^${escapeRe(indent)}\\t(\\w+)\\.Fatal\\(${escapeRe(nilVar)}\\)\\s*$`).test(b1);
      const singleFatalf = b1 && c1 && c1.trim() === "}" && c1.slice(0, indent.length) === indent &&
        new RegExp(`^${escapeRe(indent)}\\t(\\w+)\\.Fatalf\\("`).test(b1);
      if (singleFatal || singleFatalf) continue;
    }
    // 花括号平衡扫描块内（i+1 起，depth 归 0 为止）
    let depth = 1;
    for (let k = i + 1; k < lines.length; k++) {
      const raw = lines[k]!;
      const f = raw.match(new RegExp(`^(\\s*)(\\w+)\\.Fatal\\(${escapeRe(nilVar)}\\)\\s*$`));
      const ff = raw.match(new RegExp(`^(\\s*)(\\w+)\\.Fatalf\\("((?:[^"\\\\]|\\\\.)*)"\\s*,\\s*${escapeRe(nilVar)}\\)\\s*$`));
      let after: string | null = null;
      if (f) {
        const recv = f[2]!;
        if (tIsConcreteT(lines, k)) after = `${f[1]!}testutil.NoError(${recv}, ${nilVar})`;
      } else if (ff) {
        const recv = ff[2]!;
        const msg = mapFatalfMsg(ff[3]!);
        if (msg !== null && tIsConcreteT(lines, k)) after = `${ff[1]!}testutil.NoError(${recv}, ${nilVar}, ${msg})`;
      }
      if (after !== null) {
        sites.push({
          file: rel,
          line: k + 1,
          fn: enclosingFunc(lines, k),
          before: [raw],
          after,
        });
      }
      depth += (stripLine(raw).match(/{/g) || []).length - (stripLine(raw).match(/}/g) || []).length;
      if (depth <= 0) break;
    }
  }
  return sites;
}

/** 去字符串/注释后的行（供 if 头与花括号判定用） */
function stripLine(line: string): string {
  return line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`[^`]*`/g, "``").replace(/\/\/.*$/, "");
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
    // 校验现场未变（防并发会话改同一文件）；before 长度=站点原始行数（A/B=3 行，C=1 行）
    const n = s.before.length;
    let ok = true;
    for (let k = 0; k < n; k++) if (lines[idx + k] !== s.before[k]) { ok = false; break; }
    if (!ok) continue;
    lines.splice(idx, n, s.after);
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

// ---------- 编译期校验 + 自动还原 ----------
/** 还原单个站点（用回原始 3 行）。现场必须是「已转成的 after 单行」，否则不动（防并发会话改）。 */
function revertSite(rel: string, s: Site): boolean {
  const abs = path.join(ROOT, rel);
  const src = readFileSync(abs, "utf8");
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  // 按内容定位（多站点文件转换后行号漂移，s.line 不可靠）：找 after 单行的首次出现
  const afterTrim = s.after.trim();
  const idx = lines.findIndex((l) => l.trim() === afterTrim);
  if (idx < 0) return false;
  lines.splice(idx, 1, ...s.before);
  writeFileSync(abs, lines.join("\n"), "utf8");
  spawnSync("gofmt", ["-w", abs], { encoding: "utf8" });
  return true;
}

/** 编译期校验 + 自动还原：`if <X> != nil { t.Fatalf(fmt, X) }` 里 X **未必是 error**——
 *  切片 / map / 指针也能 `!= nil`（NoError 只收 error）→ 用 `go test -run=__none__` 编译
 *  全部测试包，把报 "cannot use X as error" 的站点按原样还原。保证工具可复用不出错转。
 *  返回还原处数。 */
function verifyAndRevert(perFile: Map<string, Site[]>): number {
  let reverted = 0;
  // go test 单次运行只报每包前几处错误 → 循环「编译→还原」直到无错或不再进展
  for (let pass = 0; pass < 4; pass++) {
    const r = spawnSync("go", ["test", "-count=1", "-run=__codemod_nonexistent__", "./go/...", "./internal/..."], {
      encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const re = /([\w\\/.-]+\.go):(\d+):\d+: cannot use (\w+).* as error/g;
    let m: RegExpExecArray | null;
    const toRevert: { rel: string; site: Site }[] = [];
    while ((m = re.exec(out))) {
      const file = m[1]!.split(path.sep).join("/");
      const ident = m[3]!;
      const sites = perFile.get(file);
      if (!sites) continue;
      for (const s of sites) {
        if (new RegExp(`,\\s*${escapeRe(ident)}(?:,|\\))`).test(s.after)) toRevert.push({ rel: file, site: s });
      }
    }
    if (toRevert.length === 0) break;
    // 从高行号开始还原，避免行号漂移
    toRevert.sort((a, b) => b.site.line - a.site.line);
    let done = 0;
    for (const { rel, site } of toRevert) if (revertSite(rel, site)) done++;
    reverted += done;
    if (done === 0) break; // 有报错但还原不动 → 放弃，避免死循环
  }
  // 清孤儿 import：全站还原后 testutil import 可能变「imported and not used」
  const r2 = spawnSync("go", ["test", "-count=1", "-run=__codemod_nonexistent__", "./go/...", "./internal/..."], {
    encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  const out2 = `${r2.stdout || ""}${r2.stderr || ""}`;
  const re2 = /([\w\\/.-]+\.go):\d+:\d+: "([^"]+)" imported and not used/g;
  let m2: RegExpExecArray | null;
  const done = new Set<string>();
  while ((m2 = re2.exec(out2))) {
    const rel = m2[1]!.split(path.sep).join("/");
    const imp = m2[2]!;
    if (done.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    let src = readFileSync(abs, "utf8");
    const next = src.split("\n").filter((l) => l.trim() !== `"${imp}"`).join("\n");
    if (next !== src) {
      writeFileSync(abs, next, "utf8");
      spawnSync("gofmt", ["-w", abs], { encoding: "utf8" });
      done.add(rel);
    }
  }
  return reverted;
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
  const reverted = verifyAndRevert(perFile);
  console.log(
    reverted > 0
      ? `\n⚠️ 编译期校验还原 ${reverted} 处非 error 误转（'if X != nil' 但 X 非 error，NoError 不收）`
      : "\n✅ 编译期校验通过：无 'if X != nil' 但 X 非 error 的误转",
  );
  console.log("下一步必须：go build ./... + go test ./... + 账本 --update-baseline");
}