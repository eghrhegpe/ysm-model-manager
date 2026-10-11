#!/usr/bin/env node
/**
 * @file check-stale-test-refs.ts — 注释点名的测试引用存在性对账（陈旧测试守卫引用闸）。
 *
 * 病灶：「注释承诺 > 实现」漂移的镜像形态——生产源码注释声称「守卫 = TestXxx /
 * 见 x.test.ts 机检」，但该测试早已改名或消亡，注释没跟，谎称存在一条并不存在的
 * 机器防线（巡检第 14 轮批量对账实测：go 与 frontend 生产码共 7+ 处假声明，
 * 如 findinst.go 点名 TestFindInstDir_ResourcepackZipKept——真身早已改造成
 * TestFindInstDir_Resourcepack_NoFallback 且测试注释自陈此事）。water.md P3-1
 * 教训同款：给「已锁定/已守卫」写断言前，先查真身是否在场——本脚本把这句话变成闸。
 *
 * 判定：扫生产源文件（frontend/src、go、internal、scripts 的注释行）中的测试引用——
 *   · TS 文件注释里的 `*.test.ts` 文件名 → 全仓 *.test.ts 文件集须含同名（任意目录）；
 *   · Go 文件注释里的 `Test[A-Z]\w*` 符号 → 全仓 *_test.go 的 `func TestX(` 集须含该名。
 *   仅判**注释行**（行首 //、/*、*）——代码字符串字面量（如测试夹具名喂被测函数）不判。
 *   通配/片段形态（basename 以 . _ - 开头，如 `*.parity.test.ts`、`-parity.test.ts`）不判。
 *   行为示例等合法虚构引用用行内豁免：`claim-check:ignore: <理由>`（无理由不豁免，
 *   对齐 check-menu-test-layout 的 layout-assert 语法）。
 *
 * 扫描域不含：*_test.go / *.test.ts 自身（测试间互引属另一域）、docs/**（ADR/归档是
 * 决策时历史快照，元规则不动；知识卡正文由 check-knowledge-drift 负责）、vendor/。
 *
 * 用法：
 *   node scripts/check-stale-test-refs.ts          # 人类报告 + _summary，违规 exit 1
 *   node scripts/check-stale-test-refs.ts --json   # 纯 JSON（_summary 契约，gate/CI 消费）
 *
 * 设计意图：给「注释点名的测试锁必须真实存在」立机器闸——测试改名/删除时若忘了同步
 * 点名它的生产注释，本闸在 doctor / pre-push-gate 报告违规，取代「靠人记得回头改注释」。
 *
 * 退出码：0 = 全通过；1 = 发现陈旧引用；2 = 脚本自身异常（目录缺失等）。
 * 依赖：node:fs / node:path / node:url / _lib/scan-files.ts / _lib/parse-args.ts（零外部依赖）。
 */
import fs from "node:fs";
import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT, relPosix, walk } from "./_lib/scan-files.ts";

const args = parseArgs(process.argv.slice(2), { bools: ["json"] });
if (args.unknown.length > 0) {
  console.error(`[check-stale-test-refs] 未知参数: ${args.unknown.join(", ")}`);
  process.exit(2);
}
const JSON_OUT = args.json === true;

function jsonExit(code: number, payload: Record<string, unknown>): never {
  if (JSON_OUT) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(`_summary:${JSON.stringify(payload._summary ?? payload)}`);
  }
  process.exit(code);
}

export interface StaleRef {
  file: string;
  line: number;
  /** 被点名的测试引用原文（TS basename 或 Go 符号名） */
  ref: string;
  kind: "ts-file" | "go-func";
}

/** 全仓真实测试索引（一次构建，scanText 消费）。 */
export interface TestIndex {
  /** *.test.ts 的 basename 集合 */
  tsFiles: Set<string>;
  /** *_test.go 里 `func TestX(` 的符号名集合 */
  goFuncs: Set<string>;
}

// ── 正则 ──
// TS 引用：路径或裸名，尾缀 .test.ts；捕获不含前导通配符（*.test.ts 整体不匹配——
// 通配段以 * 起始不在字符类内）。
const TS_REF_RE = /([A-Za-z0-9_./\\-]*[A-Za-z0-9_])\.test\.ts/g;
// Go 引用：Test 后接大写段（真测试命名惯例 TestFoo / TestFoo_Bar）。
const GO_REF_RE = /\bTest[A-Z][A-Za-z0-9_]*\b/g;
// 示例名启发式：注释里的 x / a / b / foo / bar / fake-* / test-* / *.foo 这类是文档示例或
// 夹具构造名，非仓内实存测试的点名（仓内真实测试文件/函数无一采用这些名）。
// 依据：本闸抓的是「点名实存后消失」的陈旧引用；示例名自始不指涉实存，不构成假声明。
const EXAMPLE_NAME_RE =
  /^(?:x|y|a|b|c|d|foo|bar|baz|qux|fake[-_]|test[-_]|sample|dummy|placeholder|some|my[-_]?test|_r\d)/i;
// 注释行判据：trim 后以 //、/*、* 起始（行注释 / 块注释首续行）。
const COMMENT_RE = /^(?:\/\/|\/\*|\*)/;
// 行内豁免：claim-check:ignore: <非空理由>
const IGNORE_RE = /claim-check:ignore:\s*\S+/;

/** 纯函数：对单文件文本找陈旧测试引用（index 由调用方注入，测试可喂合成集）。 */
export function scanText(rel: string, text: string, index: TestIndex): StaleRef[] {
  // 测试文件自身互引不在本闸域（与被测对象同包演化，语义不同）
  if (rel.endsWith(".test.ts") || rel.endsWith("_test.go")) return [];
  const isGo = rel.endsWith(".go");
  const isTs = rel.endsWith(".ts");
  if (!isGo && !isTs) return [];
  const out: StaleRef[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!COMMENT_RE.test(line.trimStart())) continue; // 只判注释行（字符串字面量在代码行）
    if (IGNORE_RE.test(line)) continue; // 行内豁免（带理由）
    if (isTs) {
      for (const m of line.matchAll(TS_REF_RE)) {
        const full = m[1] ?? "";
        const base = full.split(/[\\/]/).pop() ?? full;
        // 通配/片段形态（basename 以非字母数字起始，如 `-parity`、`_r6_canary`）不判
        if (!/^[A-Za-z0-9]/.test(base)) continue;
        // 声明文件 .d.ts 的探测行为示例（smart-stage 缺陷文档）与通用示例名不判
        if (base.endsWith(".d") || EXAMPLE_NAME_RE.test(base)) continue;
        if (index.tsFiles.has(`${base}.test.ts`)) continue;
        out.push({ file: rel, line: i + 1, ref: base, kind: "ts-file" });
      }
    } else {
      for (const m of line.matchAll(GO_REF_RE)) {
        const name = m[0];
        if (index.goFuncs.has(name)) continue;
        const start = m.index ?? 0;
        const before = line.charAt(start - 1);
        const after = line.charAt(start + name.length);
        // 数据值示例判据：TestX 被引号紧邻（"TestModel"）或后接 `<`（XML 串 "TestModel</name>"）
        // ——是被测输入的样例字面量，非测试符号点名。
        if (before === '"' || after === '"' || after === "<") continue;
        out.push({ file: rel, line: i + 1, ref: name, kind: "go-func" });
      }
    }
  }
  return out;
}

/** walk 未传 rel 时运行时恒返回 string，签名是联合类型——统一窄化取绝对路径。 */
function walkAbsFiles(dir: string, opts: Parameters<typeof walk>[1]): string[] {
  return walk(dir, opts).map((e) => (typeof e === "string" ? e : e.abs));
}

/** 构建全仓真实测试索引。 */
export function buildIndex(): TestIndex {
  const tsFiles = new Set<string>();
  const goFuncs = new Set<string>();
  for (const abs of walkAbsFiles(path.join(ROOT, "frontend"), {
    exts: [".ts"],
    skipDir: (n) => n.startsWith(".") || n === "node_modules",
  })) {
    if (abs.endsWith(".test.ts")) tsFiles.add(path.basename(abs));
  }
  const testsDir = path.join(ROOT, "tests");
  if (fs.existsSync(testsDir)) {
    for (const abs of walkAbsFiles(testsDir, { exts: [".ts"] })) {
      if (abs.endsWith(".test.ts")) tsFiles.add(path.basename(abs));
    }
  }
  for (const root of ["go", "internal"]) {
    const dir = path.join(ROOT, root);
    if (!fs.existsSync(dir)) continue;
    for (const abs of walkAbsFiles(dir, { exts: [".go"] })) {
      if (!abs.endsWith("_test.go")) continue;
      const content = fs.readFileSync(abs, "utf8");
      for (const m of content.matchAll(/func (Test[A-Z][A-Za-z0-9_]*)\(/g)) {
        goFuncs.add(m[1] ?? "");
      }
    }
  }
  return { tsFiles, goFuncs };
}

/** 全仓扫描：生产源码注释中的测试引用逐一验存在。 */
export function scanAll(index: TestIndex): StaleRef[] {
  const hits: StaleRef[] = [];
  const areas: Array<{ dir: string; exts: string[] }> = [
    { dir: path.join(ROOT, "frontend", "src"), exts: [".ts"] },
    { dir: path.join(ROOT, "scripts"), exts: [".ts"] },
    { dir: path.join(ROOT, "go"), exts: [".go"] },
    { dir: path.join(ROOT, "internal"), exts: [".go"] },
  ];
  for (const area of areas) {
    if (!fs.existsSync(area.dir)) continue;
    for (const abs of walkAbsFiles(area.dir, {
      exts: area.exts,
      skipDir: (n) => n.startsWith(".") || n === "node_modules" || n === "vendor",
    })) {
      const rel = relPosix(path.relative(ROOT, abs));
      // 测试文件互引不在本闸域（它们与被测对象同包演化，且夹具字符串语义不同）
      if (rel.endsWith(".test.ts") || rel.endsWith("_test.go")) continue;
      const content = fs.readFileSync(abs, "utf8");
      hits.push(...scanText(rel, content, index));
    }
  }
  return hits;
}

function main(): void {
  const index = buildIndex();
  const hits = scanAll(index);
  if (!JSON_OUT) {
    console.log(
      `[check-stale-test-refs] 索引：ts 测试文件 ${index.tsFiles.size} / go 测试函数 ${index.goFuncs.size}`,
    );
    if (hits.length > 0) {
      console.log(`[FAIL] 注释点名的测试引用不存在（陈旧/假声明）：${hits.length} 处`);
      for (const h of hits) {
        console.log(`  ${h.file}:${h.line} → ${h.ref}（${h.kind}）`);
      }
      console.log(
        "  → 测试改名/删除后须同步注释指认真身；合法虚构引用（行为示例）加行内豁免：claim-check:ignore: <理由>",
      );
    } else {
      console.log("[OK] 生产注释点名的测试引用全部在场。");
    }
  }
  jsonExit(hits.length === 0 ? 0 : 1, {
    _summary: {
      ok: hits.length === 0,
      errors: hits.length,
      ts_index: index.tsFiles.size,
      go_index: index.goFuncs.size,
    },
    violations: hits,
  });
}

const isDirect =
  process.argv[1] && resolve(process.argv[1] as string) === resolve(fileURLToPath(import.meta.url));
if (isDirect) main();
