#!/usr/bin/env node
/**
 * check-knowledge-content.ts — 知识卡正文机制声明漂移探针（P1 补网，2026-10-05）。
 *
 * 依赖：零依赖（node:fs / node:path / node:url + _lib/frontmatter / _lib/parse-args / _lib/scan-files）。
 *
 * 设计意图（元失败审计 #4/#5 的真缺口，适用场景）：
 *   - check-knowledge-drift 的 invariant_anchors 是**按卡 opt-in**：只有 frontmatter 里
 *     主动声明了 invariant_anchors 的卡才被 grep 校验机制存在；卡正文散文里随手写的
 *     「`frontend/src/x.ts`（`symbol`）」机制声明**完全无自动校验**——重构把 symbol 改名/
 *     移动后，正文描述静默失效（fail-open），与 invariant_anchors 的 fail-closed 宗旨矛盾。
 *   - checkBodyLineRefs 只查「硬编码行号/行数」（ADR-162 精神），不查机制是否存在。
 *   本脚本补上这块：扫所有卡正文里**显式锚定**的「文件 + 符号」机制声明，grep 源码确认
 *   该符号在所指文件里是「定义形态 / 真实消费」（复用 check-knowledge-drift 的 anchorDefKind
 *   同源判定，避免把 import/re-export/注释提及误判为命中），缺位即 WARN（不阻断，契合仓库
 *   WARN 不阻断哲学——这是漂移提醒而非硬约束，新增机制锚可由 invariant_anchors 升格为 ERROR）。
 *
 * 锚定形态（只认这两种显式写法，避免野正则误报）：
 *   ① 反引号路径 + 括号符号：`frontend/src/foo.ts`（`symbol`）或 `frontend/src/foo.ts`(`symbol`)
 *   ② 反引号路径 + 竖线裸符号：`frontend/src/foo.ts`|symbol   （锚定「文件含该机制」）
 * 跳过：
 *   - frontmatter 块（已由 invariant_anchors 专属校验，不重复）；
 *   - 非源码事实源（.json/.css/.md/生成物 bindings/dist/node_modules）；
 *   - 绝对路径 / 以 `/` 或 `~` 开头 / 含 `..` 逃逸（格式非法，单独 WARN 提示，不误判）；
 *   - ADR 链接 `ADR-NNN`（非源码路径）。
 *
 * 输出契约（与 data-docs-domain.ts 的 requireSummaryField 对接）：
 *   { "_summary": { issues: <number>, warns: <number> }, issues: [...], warns: [...] }
 *   issues = 机制声明失效的「疑似」条目（warn 级，不阻断）。
 *
 * 退出码：恒 0（纯 WARN 探针，不阻断 CI/钩子；fail-open 只提醒，fail-closed 由 invariant_anchors 兜底）。
 *   注：未知参数（trap #12 白名单拦截）仍退非 0——避免 `--jso` 拼错被静默放行写盘。
 *
 * 用法：
 *   node scripts/check-knowledge-content.ts            # 文本报告
 *   node scripts/check-knowledge-content.ts --json     # JSON（doctor --docs 调用）
 *   node scripts/check-knowledge-content.ts --kc-dir <dir>  # 隔离模式（契约测试）
 *
 * 挂载：scripts/_lib/gate-blocks/data-docs-domain.ts 的 runDocsDomain 内追加一行
 *   ctx.record("node scripts/check-knowledge-content.ts --json", true/false, {...})
 *   （仅 warn 级：ok 恒 true，note 汇总失效条数，不阻断 push）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "./_lib/frontmatter.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT, toPosix } from "./_lib/scan-files.ts";

// ── 参数 ──
const ARGS = parseArgs(process.argv.slice(2), {
  bools: ["json"],
  strings: ["kc-dir"],
});
const JSON_OUT = ARGS.json as boolean;
const KC_DIR = ARGS["kc-dir"]
  ? path.resolve(String(ARGS["kc-dir"]))
  : path.join(ROOT, "docs", "knowledge");

// ── 锚定正则（只认显式「反引号路径 + 括号/竖线符号」）──
// 关键约束：路径组必须含 `/`（仓库相对路径形如 `frontend/src/foo.ts`、`go/cli/bar.go`），
// 借此与纯反引号符号（`OpenFolder`）、中文反引号短句（`返回 `、`里的 Molang 字符串编译为 `）
// 区分——那些不含 `/`，一律 skip，不误报。
// ① 反引号路径（必含 /）+ 紧跟可选空白 + 括号反引号符号
//    例：`frontend/src/foo.ts`（`symbol`）
const ANCHOR_PAREN_RE =
  /`([^`]*\/[^`]*?)`\s*[（(]\s*[`']?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)`?]?\s*[）)]/g;
// ② 反引号路径（必含 /）+ 竖线 + 裸符号（锚定「文件含该机制」）
//    例：`frontend/src/foo.ts`|symbol  或  `frontend/src/foo.ts`| `symbol`
const ANCHOR_PIPE_RE =
  /`([^`]*\/[^`]*?)`\s*\|\s*[`']?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)`?/g;

// 非源码事实源 / 生成物（不校验机制存在——它们不是稳定符号源）
const NON_SRC_RE =
  /(^|\/)(bindings|dist|node_modules)(\/|$)|(^|\/)\.|^\.\.|^[A-Za-z]:|^~|^[\\/]/;
const SRC_EXT_RE = /\.(ts|tsx|js|jsx|go|rs|py)$/;

// 语言名 / 非代码符号停表：卡正文常以 `file`（`Go`）指代语言而非代码符号，
// 不应判为「机制锚失效」（避免假红）。
const LANG_STOPLIST = new Set([
  "Go",
  "TypeScript",
  "JavaScript",
  "Rust",
  "Python",
  "WASM",
  "Go语言",
]);

// ── 符号定义形态 / 消费判定（与 check-knowledge-drift.ts anchorDefKind 同源）──
const ANCHOR_DEF_RE =
  /(?:^|[\s\n;{}])(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)\s*\(|class\s+(\w+)\b|(?:const|let|var)\s+(\w+)\s*[:=]|type\s+(\w+)\s*[={]|interface\s+(\w+)\b|enum\s+(\w+)\b)/g;
const ANCHOR_DEF_RE_GO =
  /(?:^|[\s\n;{}])(?:func\s+\([^)]*\)\s+(\w+)\s*\(|func\s+(\w+)\s*\(|type\s+(\w+)\s*(?:struct|interface|\{)|const\s+(\w+)\s*=|var\s+(\w+)\s*=)/g;

/**
 * 判定符号在目标文件里是「定义/消费」（真实命中）还是「仅文本提及」（ref-only，视为失效）。
 * 与 check-knowledge-drift 的 anchorDefKind 语义对齐：有定义形态或真实消费 = 命中。
 * ci=true 时符号匹配大小写不敏感（卡正文常小写指代 UPPERCASE 常量，如 `role`→`ROLE`）。
 */
function anchorAlive(content: string, sym: string, ci = false): boolean {
  const targets = ci ? [sym, sym] : [sym];
  const testSym = (s: string): boolean => {
    if (!ci && !content.includes(s)) return false;
    if (ci && content.toLowerCase().indexOf(s.toLowerCase()) < 0) return false;
    const reSrc = sym
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\./g, "\\.");
    const flags = ci ? "i" : "";
    const re = new RegExp(`\\b${reSrc}\\b`, flags);
    // 定义形态
    for (const dr of [ANCHOR_DEF_RE, ANCHOR_DEF_RE_GO]) {
      dr.lastIndex = 0;
      let m = dr.exec(content);
      while (m !== null) {
        if (m.slice(1).some((g) => (ci ? g?.toLowerCase() === s.toLowerCase() : g === s)))
          return true;
        m = dr.exec(content);
      }
    }
    // 真实消费：调用 `X(` / 成员 `X.` / 类型 `: X` / 泛型 `X<` / 索引 `X[` / 实参 `(X)`
    if (
      new RegExp(
        `\\b${reSrc}\\s*\\(|\\b${reSrc}\\s*\\.|\\b${reSrc}\\s*<|:\\s*\\b${reSrc}\\b|\\b${reSrc}\\s*\\[|\\(\\s*\\b${reSrc}\\s*\\)`,
        flags,
      ).test(content)
    ) {
      return true;
    }
    return false;
  };
  return testSym(sym) || (ci ? false : anchorAlive(content, sym, true));
}

interface Hit {
  card: string;
  file: string;
  symbol: string;
  line: number;
  reason: string;
}

/**
 * 从卡正文抽取显式机制锚（`文件`(`符号`) / `文件`|符号），跳过 frontmatter。
 * 纯函数（不查盘），供契约测试直接消费。路径不可锚定（非源码 / 生成物 / 无 /）直接剔除。
 * 返回 { file, symbol, line }[]（line 为 1-based 正文行号）。
 */
export function extractAnchors(text: string): { file: string; symbol: string; line: number }[] {
  // 跳过 frontmatter（已由 invariant_anchors 专属校验）
  const fm = parseFrontmatter(text);
  const body = fm ? text.slice(text.indexOf("---", 3) + 3) : text;
  const lines = body.split("\n");
  const out: { file: string; symbol: string; line: number }[] = [];
  lines.forEach((ln, i) => {
    // ① 括号形态 `path`（`symbol`）
    ANCHOR_PAREN_RE.lastIndex = 0;
    let m = ANCHOR_PAREN_RE.exec(ln);
    while (m !== null) {
      const file = m[1]!.trim();
      const symbol = m[2]!;
      if (isAnchorable(file)) out.push({ file, symbol, line: i + 1 });
      m = ANCHOR_PAREN_RE.exec(ln);
    }
    // ② 竖线形态 `path`|symbol
    ANCHOR_PIPE_RE.lastIndex = 0;
    m = ANCHOR_PIPE_RE.exec(ln);
    while (m !== null) {
      const file = m[1]!.trim();
      const symbol = m[2]!;
      if (isAnchorable(file)) out.push({ file, symbol, line: i + 1 });
      m = ANCHOR_PIPE_RE.exec(ln);
    }
  });
  return out;
}

function scanCard(cf: string, text: string): Hit[] {
  return extractAnchors(text).map((a) => ({
    card: cf,
    file: a.file,
    symbol: a.symbol,
    line: a.line,
    reason: "",
  }));
}

/** 是否可锚定的源码路径（仓库相对 POSIX + 源码扩展名 + 非生成物/逃逸）。 */
function isAnchorable(file: string): boolean {
  if (isAdrLike(file)) return false;
  if (NON_SRC_RE.test(file)) return false;
  if (!SRC_EXT_RE.test(file)) return false;
  return true;
}

/** ADR 链接 / 非文件路径（如 `ADR-146`、`README.md`）。 */
function isAdrLike(file: string): boolean {
  return /^ADR-\d+/i.test(file) || /\.md$/i.test(file);
}

function main() {
  const issues: string[] = [];
  if (!fs.existsSync(KC_DIR)) {
    if (JSON_OUT) {
      console.log(JSON.stringify({ _summary: { issues: 0, warns: 0 }, issues: [], warns: [] }));
    } else {
      console.log("✅ 知识卡目录不存在，跳过正文机制探针。");
    }
    process.exit(0);
    return;
  }
  const files = fs
    .readdirSync(KC_DIR)
    .filter((f) => f.endsWith(".md") && !/^(readme|agents)\.md$/i.test(f));

  let scanned = 0;
  let anchors = 0;
  for (const cf of files) {
    const text = fs.readFileSync(path.join(KC_DIR, cf), "utf8");
    const hits = scanCard(cf, text);
    if (hits.length === 0) continue;
    scanned++;
    anchors += hits.length;
    // 去重：同卡同文件同符号只报一次
    const seen = new Set<string>();
    for (const h of hits) {
      const key = `${h.file}|${h.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (h.reason) {
        issues.push(`知识卡 ${cf} 正文机制锚格式异常: ${h.file} ${h.reason}`);
        continue;
      }
      // 路径解析：卡正文常写「相对源码根」简写（如 `features/...`、`go/...`），
      // 而非仓库根绝对路径。依次回退：仓库根 → frontend/src/ → go/ → frontend/ → scripts/。
      const candidates = [
        h.file,
        path.join("frontend/src", h.file),
        path.join("go", h.file),
        path.join("frontend", h.file),
        path.join("scripts", h.file),
      ];
      const full = candidates
        .map((c) => path.join(ROOT, c))
        .find((p) => fs.existsSync(p));
      if (!full) {
        issues.push(
          `知识卡 ${cf} 正文机制锚失效: 声称 ${h.file} 存在，但磁盘无此文件（机制描述漂移？）`,
        );
        continue;
      }
      // 语言名 / 非代码符号（如 `Go`）：不是代码符号，跳过校验，避免假红。
      if (LANG_STOPLIST.has(h.symbol)) continue;
      const content = fs.readFileSync(full, "utf8");
      if (!anchorAlive(content, h.symbol)) {
        issues.push(
          `知识卡 ${cf} 正文机制锚失效: ${h.file} 不含符号「${h.symbol}」（重构触及锚即漂移——建议同步知识卡正文，或将此锚升格为 invariant_anchors 以获 ERROR 级守护）`,
        );
      }
    }
  }

  const result = {
    _summary: { issues: issues.length, warns: issues.length },
    issues,
    warns: issues,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log("════════════════════════════════════════════");
    console.log(" 知识卡正文机制声明漂移探针 (check-knowledge-content)");
    console.log("════════════════════════════════════════════");
    console.log(`扫描卡: ${scanned} 张含正文机制锚 · 锚点: ${anchors} 个`);
    console.log(`失效/异常: ${issues.length} 条（WARN 级，不阻断）`);
    if (issues.length) {
      for (const it of issues) console.log(`⚠ ${it}`);
    } else {
      console.log("✅ 正文机制声明与源码一致（或无可锚定声明）。");
    }
  }
  // 恒 0：纯 WARN 探针，fail-open 只提醒，不阻断 CI/钩子
  process.exit(0);
}

// 入口守卫（放在模块末尾：所有 const/函数已初始化，避免 TDZ）：
// 未知参数（trap #12 白名单拦截）退非 0，避免 `--jso` 拼错被静默放行；
// --help 退 0 打印用法。仅在 CLI 入口执行（被契约测试 import 不触发全盘扫描）。
const isCli = (() => {
  const arg0 = process.argv[1];
  if (!arg0) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(arg0);
})();
if (isCli) {
  if (ARGS.help) {
    console.log(
      "用法: node scripts/check-knowledge-content.ts [--json] [--kc-dir <dir>] [--help]",
    );
    process.exit(0);
  }
  if (ARGS.unknown.length) {
    console.error(`未知参数: ${ARGS.unknown.join(", ")}（已忽略）`);
    process.exit(2);
  }
  main();
}
