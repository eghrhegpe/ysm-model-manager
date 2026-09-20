#!/usr/bin/env node
/**
 * check-unread-fields.ts — 未读取字段检测（零读取契约字段审计）。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 设计意图：回答「这个结构的消费面到底有哪些字段」——
 * 与 check-orphan-exports.ts 是**互补的两层**，各守一边：
 *   - check-orphan-exports.ts 管**符号**：导出后被全仓零 import / 零自引用的孤儿符号；
 *   - check-unread-fields.ts   管**字段**：符号活得好好的、类型也被人 import，
 *     但它身上的某个字段全仓零读取——「Go 在发、前端声明了、没人读」的死重量。
 * 后者是前者覆盖不到的一层：符号级消费者存在 ≠ 字段级消费者存在。
 *
 * 病灶（本项目实测）：`diagnostics/` 下 `PerfIdentity` 曾被声明两次且形状不同，
 * 于是没有任何一处能回答「这个结构的消费面有哪些字段」，`absPath` / `filesRoot` /
 * `rtype_source` 三个字段遂在盲区里躺了很久。同类还有 `SingleBenchStage.bytes`、
 * `CLIBridge` 封套的 `command` / `timing`。收口后靠本脚本守住回归。
 *
 * 三层判定：
 *   1. 文本解析 `interface X { field: T; field2?: T }`（缩进两空格的成员行，
 *      支持 `?` 可选标记）——不做完整 TS 语法解析，与 check-orphan-exports.ts
 *      同款的零依赖文本解析风格。
 *   2. 统计每个字段名的**全仓读取次数**：属性访问形态 `\.field\b` / `\?\.field\b` /
 *      `\["field"\]`。**刻意不用裸词 `\bfield\b`**——见下方踩坑①。
 *   3. 契约类 interface 白名单（见 CONTRACT_NAME_RE）内的零读取字段才计入报告，
 *      再按紧邻 doc comment 里有无 `@non-ui` 拆成「可疑」与「OK（故意不渲染）」。
 *
 * ⚠️ 两条踩坑教训（本项目实测，改动本脚本前务必先读）：
 *
 *   ① 字段计数**不许**用裸词 `\bfield\b`。
 *      裸词会被**注释里提到的同名字段名**满足，把真·零读取字段洗成「有人读」。
 *      实证：`hints` 在 `perf-matrix-render.ts` 里就有一条注释专门谈它
 *      （"为什么不直接渲染 `hints`"），裸词计数因此恒 ≥1，字段永远不上报。
 *      只认属性访问形态（`.field` / `?.field` / `["field"]`）才追得到真消费者。
 *
 *   ② `@non-ui` 必须**在该字段自己的 doc comment 内**匹配。
 *      **不许**用 `@non-ui[\s\S]{0,400}?FIELD` 这类宽泛窗口——那扇 400 字的窗
 *      会越过注释边界，被**相邻字段**的 `@non-ui` 满足：上一条注释盖着下一条字段，
 *      于是本该可疑的零读取字段被静默豁免，**漏报**。
 *      正解有**两层**，缺一不可：
 *        (a) 逐注释块匹配——注释体用 `(?! END)(?:.|\n)` 形态断言「不得跨注释收尾符」，
 *            注释块与字段名之间只许有空白；
 *        (b) **锚定到本字段的声明行**——只取「doc 注释块 → 本字段声明行」这一小段再匹配，
 *            拿去**全文件** `test()` 是不合格的（同文件另一个字段的 `@non-ui` 照样命中）。
 *      实测：只要漏了 (b)，删掉字段自己的标注后它会被同文件旁人的标注洗白，仍留在豁免名单。
 *      （同文件实测判别力：`bytes` 用宽泛窗口判为「有标注」，逐块+锚定判为「无标注」= 可疑。）
 *
 * `@non-ui` 豁免机制：标注 = 明确声明「非界面消费」——供测试/AI 断言、排错、Go 侧自检；
 * 界面不读是**取舍**而非遗漏。归入 OK 列表、不计入违规、不触发 --strict。
 * 标注的意义是让「Go 发了但没人读」与「故意不读」在源码里**可区分**。
 *
 * 契约类白名单（只报这些）：interface 名匹配 CONTRACT_NAME_RE——
 * Payload / Resp / Response / JSON / Json / Snapshot / Echo / Summary / Info。
 * 理由：其余 interface（第三方格式类型如 `PmxMaterialData`、mock 如 `IdbMock`、
 * 内部 UI 状态）零读取多为合理，全面报告会淹没在噪音里——实测全仓 2707 个字段中
 * 263 个零读取，而契约类只有 14 个。信号/噪音比是白名单存在的全部理由。
 *
 * 排除：`*.test.ts`、`*.d.ts`、任何路径含 `vendor` 的目录（不扫描）。
 *
 * 用法：
 *   node scripts/check-unread-fields.ts            # 文本报告（审计模式，rc=0，供 doctor 调用）
 *   node scripts/check-unread-fields.ts --json     # JSON 输出（CI 用）
 *   node scripts/check-unread-fields.ts --strict   # 有可疑字段 → rc=1
 *
 * 退出码：默认审计模式 rc=0（可疑字段仅报告，不阻断，供 doctor 审计）；
 *         --strict 下可疑字段 > 0 → rc=1。
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "./_lib/parse-args.ts";
import { relPosix, SRC_DIR, walk } from "./_lib/scan-files.ts";

const args = parseArgs(process.argv.slice(2), {
  bools: ["json", "strict"],
});
if (args.unknown.length) console.warn(`忽略未知参数: ${args.unknown.join(", ")}`);
const JSON_OUT = args.json as boolean;
const STRICT = args.strict as boolean;

// ── 契约类白名单 ──────────────────────────────────────

/** 契约类 interface 名后缀：Go 载荷 / 响应 / 快照 / 回显 / 汇总 / 信息块。 */
const CONTRACT_NAME_RE = /(Payload|Resp|Response|JSON|Json|Snapshot|Echo|Summary|Info)$/;

// ── interface 字段提取 ────────────────────────────────

/**
 * interface 头部行：`export interface X {` / `interface X extends Y {`。
 * 单行形态 `interface X { a: string }` 也从中起头，由成员行正则统一处理。
 */
const INTERFACE_HEAD_RE = /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)[^{]*\{/;

/**
 * 成员行：缩进（≥2 空格或 tab，避开 interface 头自身）+ 字段名 + 可选 `?` + `:`。
 * 只认「两空格缩进」的风格约定（本仓 biome 格式化后的统一形态）。
 */
const MEMBER_RE = /^\s{2,}([A-Za-z_$][\w$]*)(\?)?\s*:/;

/** 成员是否函数/方法签名（`foo(args): T` / `foo: (a) => b`）——排除，字段审计只管数据字段。 */
const METHODISH_RE = /^\s{2,}[A-Za-z_$][\w$]*(\?)?\s*(\([^)]*\)|<[^>]*>)\s*:/;

/**
 * 判定某字段是否带 `@non-ui`（踩坑②的正解：**只认该字段自己的 doc comment**）。
 *
 * 两个陷阱都必须封死，否则都会漏报：
 *   ① 宽泛窗口 `@non-ui[\s\S]{0,400}?FIELD` 会越过注释边界，被**相邻字段**的标注满足；
 *   ② 就算把正则限成单注释块，再拿去**全文件** `test()` 仍不合格——同文件里另一个字段的
 *      `@non-ui` 照样能命中（实测：删掉 `cli_analyzable` 自己的标注后，它被同文件
 *      `hints` 的标注洗白，仍留在豁免名单，漏报）。**必须锚定到本字段的声明行**。
 *
 * 做法：只取「doc 注释块开头 → 字段声明行」这一小段（由 findDocStart 划出，跨度内除
 * 本字段自己的注释外不含别的字段），再在该片段内逐注释块匹配。
 * 片段内注释体用 `(?! \*\/)[\s\S]` 断言不得跨注释收尾符，注释块与字段名间只许空白。
 */
function fieldDocHasNonUi(lines: string[], declIdx: number, field: string): boolean {
  const docStart = findDocStart(lines, declIdx);
  if (docStart === declIdx + 1) return false; // 紧邻无 doc comment → 不可能有标注
  const span = lines.slice(docStart - 1, declIdx + 1).join("\n");
  return new RegExp(
    `/\\*\\*(?:(?!\\*/)[\\s\\S])*@non-ui(?:(?!\\*/)[\\s\\S])*\\*/\\s*${field}\\??:`,
  ).test(span);
}

/**
 * 从文件文本里提取所有 interface 的字段声明（含行号、是否可选、doc 起始行）。
 * 文本解析，不做完整 TS 语法：遇 `{` 起头，遇 `}` 收尾，成员行按缩进识别。
 */
export function extractInterfaceFields(
  text: string,
): Array<{
    iface: string;
    field: string;
    line: number;
    optional: boolean;
    docStart: number;
    declIdx: number;
  }> {
  const out: Array<{
    iface: string;
    field: string;
    line: number;
    optional: boolean;
    docStart: number;
    declIdx: number;
  }> = [];
  const lines = text.split("\n");
  let iface: string | null = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    if (iface === null) {
      const head = ln.match(INTERFACE_HEAD_RE);
      if (!head) continue;
      iface = head[1]!;
      depth = 1;
      continue;
    }
    // 已在 interface 体内：先结算收尾，再认成员行。
    if (/^\s*\}/.test(ln)) {
      depth -= 1;
      if (depth <= 0) iface = null;
      continue;
    }
    depth += (ln.match(/\{/g) || []).length - (ln.match(/\}/g) || []).length;
    if (METHODISH_RE.test(ln)) continue; // 方法签名不是数据字段
    const m = ln.match(MEMBER_RE);
    if (m) {
      const docStart = findDocStart(lines, i);
      out.push({
        iface,
        field: m[1]!,
        line: i + 1,
        optional: m[2] === "?",
        docStart,
        declIdx: i,
      });
    }
  }
  return out;
}

/** 向上回溯紧邻的 doc 注释块起始行（1-indexed）；无则返回声明行自身。 */
function findDocStart(lines: string[], declIdx: number): number {
  let j = declIdx - 1;
  if (j < 0 || !/^\s*\*\/\s*$/.test(lines[j]!)) return declIdx + 1;
  for (let k = j - 1; k >= 0; k--) {
    if (/^\s*\/\*\*/.test(lines[k]!)) return k + 1;
    if (!/^\s*\*/.test(lines[k]!)) break;
  }
  return declIdx + 1;
}

// ── 字段读取计数 ──────────────────────────────────────

/**
 * 属性访问形态（踩坑①：**不许**退化成裸词 `\bfield\b`，注释里的同名字段名会满足它）：
 *   - `x.field` / `x?.field`
 *   - `x["field"]` / `x['field']`
 * 三种形态都要求前面有属性访问符，才算「真读了这个字段」。
 */
function countFieldReads(field: string, texts: string[]): number {
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:\\?\\.|\\.)${esc}\\b|\\[\\s*["']${esc}["']\\s*\\]`, "g");
  let n = 0;
  for (const t of texts) {
    for (const _ of t.matchAll(re)) n++;
  }
  return n;
}

// ── 主流程 ────────────────────────────────────────────

/** 排除测试 / 类型声明 / vendor 目录。 */
function isExcluded(rel: string): boolean {
  if (/\.test\.ts$/.test(rel) || /\.d\.ts$/.test(rel)) return true;
  return rel.split("/").some((seg) => seg.includes("vendor"));
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.log(
      JSON_OUT ? JSON.stringify({ suspicious: [], error: "frontend/src 不存在" }) : "frontend/src 目录不存在",
    );
    process.exit(1);
  }

  const files = (walk(SRC_DIR) as string[]).filter((f) => !isExcluded(relPosix(f)));

  // 全仓文本一次读入：字段读取计数需跨文件统计（消费方常与声明方不同文件）。
  const texts: string[] = [];
  for (const f of files) {
    texts.push(fs.readFileSync(f, "utf-8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"));
  }

  // ① 收集全部 interface 字段
  const allFields: Array<{
    iface: string;
    field: string;
    file: string;
    line: number;
    optional: boolean;
    lines: string[];
    declIdx: number;
  }> = [];
  for (let i = 0; i < files.length; i++) {
    const text = texts[i]!;
    for (const d of extractInterfaceFields(text)) {
      allFields.push({
        iface: d.iface,
        field: d.field,
        file: relPosix(files[i]!),
        line: d.line,
        optional: d.optional,
        lines: text.split("\n"),
        declIdx: d.declIdx,
      });
    }
  }

  // ② 统计全仓读取次数，挑出零读取字段
  const unread = allFields.filter((d) => countFieldReads(d.field, texts) === 0);

  // ③ 只报契约类 interface（白名单），降低噪音
  const contractUnread = unread.filter((d) => CONTRACT_NAME_RE.test(d.iface));

  // ④ 按紧邻 doc comment 里的 `@non-ui` 拆「可疑 / OK（故意不渲染）」
  const suspicious: typeof contractUnread = [];
  const nonUiOk: typeof contractUnread = [];
  for (const d of contractUnread) {
    // 锚定到**本字段自己的**声明行做 `@non-ui` 判定（踩坑②：全文件匹配会被同文件
    // 其他字段的标注洗白，实测漏报）。
    if (fieldDocHasNonUi(d.lines, d.declIdx, d.field)) nonUiOk.push(d);
    else suspicious.push(d);
  }

  const fail = STRICT && suspicious.length > 0;

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: {
            files: files.length,
            fields: allFields.length,
            unread: unread.length,
            contractUnread: contractUnread.length,
            suspicious: suspicious.length,
            nonUiOk: nonUiOk.length,
          },
          suspicious,
          nonUiOk,
          unread,
          strict: STRICT,
        },
        null,
        2,
      ),
    );
    process.exit(fail ? 1 : 0);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" 未读取字段检测 (check-unread-fields)");
  console.log("══════════════════════════════════════");
  console.log(`模块数     : ${files.length}`);
  console.log(`interface 字段 : ${allFields.length}`);
  console.log(`零读取字段 : ${unread.length}（全类型）`);
  console.log(`契约类零读取 : ${contractUnread.length}（白名单内）`);
  console.log(`可疑       : ${suspicious.length}`);
  console.log(`@non-ui OK : ${nonUiOk.length}（故意不渲染，豁免）`);
  console.log(
    `模式       : ${STRICT ? "STRICT（可疑字段阻断）" : "审计（可疑字段仅报告，加 --strict 阻断）"}`,
  );
  console.log("──────────────────────────────────────");

  if (suspicious.length) {
    console.log("\n【可疑：契约类字段零读取且无 @non-ui】");
    for (const d of suspicious.slice(0, 40)) {
      console.log(`  ⚠ ${d.file}:${d.line}  ${d.iface}.${d.field}${d.optional ? "?" : ""}`);
    }
    if (suspicious.length > 40) console.log(`  … 其余 ${suspicious.length - 40} 条（--json 全量）`);
  }

  if (nonUiOk.length) {
    console.log(`\n【@non-ui 豁免（故意不渲染，${nonUiOk.length} 条，不计入）】`);
    for (const d of nonUiOk) {
      console.log(`  · ${d.iface}.${d.field}  ← ${d.file}:${d.line}`);
    }
  }

  if (fail) {
    console.log(`\n退出码 1（${suspicious.length} 个契约字段零读取且无 @non-ui，--strict 阻断）。`);
    console.log("→ 修复: 删除死字段，或补上消费方，或在紧邻 doc comment 标注 @non-ui 说明为何不读");
    process.exit(1);
  }
  console.log(
    suspicious.length
      ? "\n（审计模式不阻断，--strict 可升级为 ERROR）"
      : "\n✅ 无可疑的未读取契约字段。",
  );
}

// ADR-234：直跑守卫——契约测试 import 本模块时不得触发全量扫描副作用。
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
