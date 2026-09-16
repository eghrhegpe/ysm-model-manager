#!/usr/bin/env node
/**
 * test_token_shift_audit.ts — 设计令牌「位移幻影 / 真行级」审计工具的纯函数契约测试
 * （被测模块：scripts/token-shift-audit.ts）。
 *
 * 锁什么（为什么是这几条）：
 *   本工具存在的唯一理由是「用可复查的数字回答：baseline 键差判据到底误伤多少、漏检多少」。
 *   这些数字一旦算错，ADR 与门禁选型就会被一个错的证据说服——所以**判据本身**必须被测试钉死，
 *   而不是靠「跑一遍看着数字挺合理」：
 *   - 位移幻影（classifyAddedKeys / analyzeFilePair）：父版本同 kind 的违规被上方编辑推着换行号，
 *     必须判成幻影，且**一条 added 键最多算一次**（父侧多条近邻不得把占比吹大）。
 *   - 真新增：父版本任何行都没有同 kind 的违规 → 必须判真新增（否则会低估误伤，把真债洗白）。
 *   - 匹配窗口边界：行差 = 窗口值算幻影（闭区间），窗口值 + 1 算真新增——差一格的语义必须钉住，
 *     否则「--match-window 80」在不同实现下能差出整批数字。
 *   - 空输入：父空（新文件）→ 全真新增；子空 → 全空。零除/NaN 不得出现（占比与倍数直接进报告）。
 *   - 参数解析（resolvePositiveInt）：非数字 / 负数 / 0 / 小数一律回退默认值——这是 CLI 的确定性
 *     入口，语义写在函数注释里，测试只是把它变成可执行的断言。
 *   - 键格式（violationKeys / parseViolationKey）与 `rel:line:kind` **逐字兼容** baseline 键：
 *     两个判据比的必须是同一批键，格式漂移会让对照失去意义。
 *   - 汇总（summarizeCommits）：纯算术，但「两规则都拦时的倍数」只在分母 > 0 的提交上取比值
 *     （纯幻影提交混进来会变成除零），这是刻意的口径，用固定样本锁住。
 *
 * 为什么不测 git 访问层：那部分是 `git log/diff/show` 的直译，正确性由「同一仓库状态下
 *   两次运行结果一致」与真机跑一遍保证；把 git 仓库塞进单测收益低、脆弱（历史会变）。
 *   可测与不可测的分界线就是 analyzeFilePair 的入参（父/子全文 + 新增行号集合）。
 *
 * 运行：node tests/test_token_shift_audit.ts（失败 exit 1；契约 runner 收集）。
 */
import assert from "node:assert/strict";

import {
  analyzeFilePair,
  classifyAddedKeys,
  diffKeys,
  inTokenDomain,
  median,
  parseNameStatus,
  parseViolationKey,
  resolvePositiveInt,
  scanTextPoints,
  summarizeCommits,
  violationKeys,
  type CommitAudit,
} from "../scripts/token-shift-audit.ts";

// ─── 夹具：用字符串造「父/子全文」，不碰 git（这正是 analyzeFilePair 存在的意义）──

/** 第 lineNo 行放 content，其余为空行；行号即 1-based 物理行。 */
function lineAt(lineNo: number, content: string): string {
  const lines = Array.from({ length: lineNo }, () => "");
  lines[lineNo - 1] = content;
  return lines.join("\n");
}

/** 多个「行号 → 内容」拼成一段文本（行号递增即可，中间自动补空行）。 */
function textOf(entries: Array<[number, string]>): string {
  const max = Math.max(...entries.map(([n]) => n));
  const lines = Array.from({ length: max }, () => "");
  for (const [n, c] of entries) lines[n - 1] = c;
  return lines.join("\n");
}

/** 三种违规样例行（判定完全交给 design-tokens.ts，测试只负责造文本）。 */
const FS = "  .a { font-size:13px; }"; // → css-font-size
const RADIUS = "  .b { border-radius:6px; }"; // → css-radius
const REL = "frontend/src/a.ts";

// ─── 1) 位移幻影：父 :10 → 子 :14，同 kind，窗口 80 内 ─────────
{
  const parent = lineAt(10, FS);
  const cur = lineAt(14, FS);
  // 位移场景的新增行是「上方插入的那几行」，违规行本身没被本次提交改动
  const r = analyzeFilePair({
    rel: REL,
    curText: cur,
    parentText: parent,
    matchWindow: 80,
    addedLines: new Set([1, 2, 3, 4]),
    tokenMap: null,
  });

  assert.equal(r.addedKeys.length, 1, "行位移使键从 :10 变 :14 → 键集差 1 条（baseline 眼中的「新增」）");
  assert.deepEqual(
    r.addedKeys,
    ["frontend/src/a.ts:14:css-font-size"],
    "键格式必须与 baseline 逐字一致（rel:line:kind）",
  );
  assert.equal(r.shift.length, 1, "同 kind 行差 4 ≤ 窗口 80 → 判位移幻影");
  assert.equal(r.real.length, 0, "幻影不得同时计入真新增候选（两桶互斥）");
  assert.equal(r.lineHits, 0, "行级判据：违规行不在本次新增行上 → 不报（真行级规则对位移天然免疫）");

  // 同一条违规若**本身**就是本次新增行，行级判据必须报出来（否则真行级会漏检真债）
  const hit = analyzeFilePair({
    rel: REL,
    curText: cur,
    parentText: parent,
    matchWindow: 80,
    addedLines: new Set([14]),
    tokenMap: null,
  });
  assert.equal(hit.lineHits, 1, "违规行本身被本次提交新增 → 行级判据报 1 条");
  assert.deepEqual(hit.lineHitKeys, ["frontend/src/a.ts:14:css-font-size"]);
}

// ─── 2) 真新增：父版本任何行都没有该 kind ─────────────
{
  const parent = lineAt(3, FS);
  const cur = textOf([
    [3, FS],
    [5, RADIUS], // 父版本无任何 css-radius
  ]);
  const r = analyzeFilePair({
    rel: REL,
    curText: cur,
    parentText: parent,
    matchWindow: 80,
    addedLines: new Set([5]),
    tokenMap: null,
  });

  assert.deepEqual(r.addedKeys, ["frontend/src/a.ts:5:css-radius"], "只有新 kind 那条进 added");
  assert.equal(r.real.length, 1, "父版本无同 kind 违规 → 真新增");
  assert.equal(r.shift.length, 0, "不得因为行号近就判幻影（kind 必须相同）");
  assert.equal(r.lineHits, 1, "该行确为新增行 → 行级判据也命中（两规则都拦）");
}

// ─── 3) 匹配窗口边界：行差 = 窗口值 → 幻影；+1 → 真新增 ─────────
{
  const W = 80;
  const parentPoints = scanTextPoints(lineAt(10, FS), null);
  assert.deepEqual(parentPoints, [{ line: 10, kind: "css-font-size" }], "父侧违规点抽取正确");

  const keyAt = (n: number) => `${REL}:${n}:css-font-size`;

  const atEdge = classifyAddedKeys([keyAt(10 + W)], parentPoints, W);
  assert.equal(atEdge.shift.length, 1, "行差 = 窗口值 → 幻影（≤ 为闭区间）");
  assert.equal(atEdge.real.length, 0);

  const overEdge = classifyAddedKeys([keyAt(10 + W + 1)], parentPoints, W);
  assert.equal(overEdge.shift.length, 0, "行差 = 窗口值 + 1 → 不算幻影");
  assert.equal(overEdge.real.length, 1, "越窗即真新增候选");

  // 端到端复核一遍边界（避免只测了内部函数、集成处少传一个参数）
  const beyond = analyzeFilePair({
    rel: REL,
    curText: lineAt(10 + W + 1, FS),
    parentText: lineAt(10, FS),
    matchWindow: W,
    addedLines: new Set([10 + W + 1]),
    tokenMap: null,
  });
  assert.equal(beyond.real.length, 1, "analyzeFilePair 的窗口语义与 classifyAddedKeys 一致");
  assert.equal(beyond.lineHits, 1);
}

// ─── 4) 同 kind 多近邻：一条 added 只算一次幻影 ─────────
{
  const parent = textOf([
    [100, FS],
    [105, FS],
  ]);
  const cur = lineAt(103, FS);
  const r = analyzeFilePair({
    rel: REL,
    curText: cur,
    parentText: parent,
    matchWindow: 80,
    addedLines: new Set([103]),
    tokenMap: null,
  });

  assert.equal(r.addedKeys.length, 1, "子侧只有一条违规 → added 只有一条");
  assert.equal(r.shift.length, 1, "父侧两条近邻也只算一次幻影（不得重复计数）");
  assert.equal(r.real.length, 0);
  assert.equal(r.shift.length + r.real.length, r.addedKeys.length, "两桶之和恒等于 added（不重不漏）");
}

// ─── 5) 空输入：新文件 / 清空 / 双空 ─────────
{
  const cur = textOf([
    [2, FS],
    [7, RADIUS],
  ]);

  // 父空 = 新文件：所有违规都是真新增（判据 A 与判据 B 在此必须一致）
  const fresh = analyzeFilePair({
    rel: "frontend/src/new.ts",
    curText: cur,
    parentText: "",
    matchWindow: 80,
    addedLines: new Set([2, 7]),
    tokenMap: null,
  });
  assert.equal(fresh.addedKeys.length, 2, "新文件 → 全部进 added");
  assert.equal(fresh.shift.length, 0, "无父版本 → 不可能有幻影");
  assert.equal(fresh.real.length, 2, "全部判真新增");
  assert.equal(fresh.lineHits, 2, "新文件所有行都是新增行 → 行级判据同样全中");

  // 子空 = 违规被清空：两侧判据都应为零（不是 NaN / 负值）
  const cleaned = analyzeFilePair({
    rel: REL,
    curText: "",
    parentText: cur,
    matchWindow: 80,
    addedLines: new Set(),
    tokenMap: null,
  });
  assert.deepEqual(
    [cleaned.addedKeys.length, cleaned.shift.length, cleaned.real.length, cleaned.lineHits],
    [0, 0, 0, 0],
    "子空 → 全零",
  );

  // 双空：空字符串不得被当成「1 行文本」而产出违规
  const both = analyzeFilePair({
    rel: REL,
    curText: "",
    parentText: "",
    matchWindow: 80,
    addedLines: new Set(),
    tokenMap: null,
  });
  assert.deepEqual([both.curKeys.length, both.addedKeys.length, both.lineHits], [0, 0, 0], "双空 → 全零");
}

// ─── 6) 参数解析：非数字 / 负数 / 0 / 小数 → 回退默认值 ─────────
// 语义（写在 resolvePositiveInt 的注释里）：/^\d+$/ 且 > 0、且安全整数才采纳，其余回退。
{
  const DEF = 120;
  assert.equal(resolvePositiveInt("40", DEF), 40, "正常十进制 → 采纳");
  assert.equal(resolvePositiveInt(40, DEF), 40, "数字形态同样采纳");
  assert.equal(resolvePositiveInt(" 40 ", DEF), 40, "首尾空白容忍");
  assert.equal(resolvePositiveInt(null, DEF), DEF, "未传（null）→ 默认");
  assert.equal(resolvePositiveInt(undefined, DEF), DEF, "undefined → 默认");
  assert.equal(resolvePositiveInt("", DEF), DEF, "空串 → 默认");
  assert.equal(resolvePositiveInt("abc", DEF), DEF, "非数字 → 默认");
  assert.equal(resolvePositiveInt("-5", DEF), DEF, "负数 → 默认（不取绝对值，免得手滑反向）");
  assert.equal(resolvePositiveInt("0", DEF), DEF, "0 → 默认（0 会让样本恒空，不是有意义的输入）");
  assert.equal(resolvePositiveInt("3.5", DEF), DEF, "小数 → 默认（行数/条数都是整数口径）");
  assert.equal(resolvePositiveInt("0x10", DEF), DEF, "十六进制 → 默认（Number() 会收，这里刻意不收）");
  assert.equal(resolvePositiveInt("1e3", DEF), DEF, "科学计数 → 默认（同上）");
  assert.equal(resolvePositiveInt("99999999999999999999", DEF), DEF, "超出安全整数 → 默认");
  assert.equal(resolvePositiveInt("7", DEF), 7, "边界内正常值不受影响");
}

// ─── 7) 判定域：.ts（排除 test/spec）与 .css ─────────
{
  assert.equal(inTokenDomain("frontend/src/a.ts"), true, "生产 TS 在域内");
  assert.equal(inTokenDomain("frontend/src/views/deep/b.ts"), true, "深层生产 TS 在域内");
  assert.equal(inTokenDomain("frontend/src/a.test.ts"), false, "*.test.ts 不在域内（测试里的样式样本不是产品 UI）");
  assert.equal(inTokenDomain("frontend/src/a.spec.ts"), false, "*.spec.ts 不在域内");
  assert.equal(inTokenDomain("frontend/css/components.css"), true, "文档层 CSS 在域内");
  assert.equal(inTokenDomain("frontend/css/sub/x.css"), true, "CSS 子目录在域内");
  assert.equal(inTokenDomain("frontend/src/a.tsx"), false, "非 .ts 不在域内（与 walk exts 口径一致）");
  assert.equal(inTokenDomain("frontend/src/a.js"), false, "JS 不在域内");
  assert.equal(inTokenDomain("frontend/css/x.scss"), false, "非 .css 不在域内");
  assert.equal(inTokenDomain("go/foo.go"), false, "后端不在域内");
  assert.equal(inTokenDomain("scripts/token-shift-audit.ts"), false, "工具自身不在域内");
  assert.equal(inTokenDomain("frontend/srcx/a.ts"), false, "前缀相似但目录不同 → 不算（防 startsWith 手滑）");
}

// ─── 8) 键格式与集合差 ─────────
{
  const keys = violationKeys(REL, [
    { line: 10, kind: "css-font-size" },
    { line: 12, kind: "emoji-icon" },
  ]);
  assert.deepEqual(
    keys,
    ["frontend/src/a.ts:10:css-font-size", "frontend/src/a.ts:12:emoji-icon"],
    "键 = rel:line:kind（顺序即点序，供逐条复查）",
  );

  const p = parseViolationKey("frontend/src/a.ts:10:css-font-size");
  assert.deepEqual(p, { rel: "frontend/src/a.ts", line: 10, kind: "css-font-size" }, "键可逆解析");
  assert.equal(parseViolationKey("garbage"), null, "无行号/种类的串 → null");
  assert.equal(parseViolationKey("frontend/src/a.ts:x:css-font-size"), null, "行号非数字 → null");
  assert.equal(parseViolationKey("frontend/src/a.ts:10:"), null, "缺 kind → null");
  assert.equal(parseViolationKey(":10:css-radius"), null, "缺 rel → null");
  // 带盘符的路径（Windows 调用方可能传进来）不会被误切：从右往左锚定
  assert.deepEqual(
    parseViolationKey("C:/x/a.ts:3:css-radius")?.rel,
    "C:/x/a.ts",
    "rel 含冒号也不误切（贪婪前缀 + 末两段）",
  );

  assert.deepEqual(diffKeys(["a", "b", "c"], ["b"]), ["a", "c"], "集合差保持 cur 顺序");
  assert.deepEqual(diffKeys(["a", "a", "b"], []), ["a", "b"], "重复键去重");
  assert.deepEqual(diffKeys(["a"], ["a"]), [], "全在父侧 → 空");
  assert.deepEqual(diffKeys([], ["a"]), [], "空输入 → 空");
}

// ─── 9) 逐行扫描：去重、注释行、emoji ─────────
{
  const dup = scanTextPoints(lineAt(1, "  .a { font-size:13px; font-size:14px; }"), null);
  assert.deepEqual(dup, [{ line: 1, kind: "css-font-size" }], "同行同类多处 → 键级去重只留一条");

  const comment = scanTextPoints(lineAt(1, "// font-size:13px;"), null);
  assert.deepEqual(comment, [], "注释行不算违规（继承 design-tokens 的口径）");

  const emoji = scanTextPoints(lineAt(1, `const x = '<div class="a">📁 ' + t("k");`), null);
  assert.equal(emoji.length, 1, "emoji 当图标被计入（与门禁同源判定）");
  assert.equal(emoji[0]?.kind, "emoji-icon");

  const multi = scanTextPoints(
    textOf([
      [1, FS],
      [3, RADIUS],
    ]),
    null,
  );
  assert.deepEqual(
    multi,
    [
      { line: 1, kind: "css-font-size" },
      { line: 3, kind: "css-radius" },
    ],
    "多点按行号升序返回（确定性）",
  );
}

// ─── 10) name-status 解析：rename 双路径 / copy 不算改名 ─────────
{
  const units = parseNameStatus(
    "M\tfrontend/src/a.ts\nA\tfrontend/css/b.css\nR100\tfrontend/src/old.ts\tfrontend/src/new.ts\n",
  );
  assert.deepEqual(
    units,
    [
      { rel: "frontend/src/a.ts", parentRel: "frontend/src/a.ts", status: "M" },
      { rel: "frontend/css/b.css", parentRel: "frontend/css/b.css", status: "A" },
      { rel: "frontend/src/new.ts", parentRel: "frontend/src/old.ts", status: "R100" },
    ],
    "rename 取新旧双路径；其余取同路径",
  );

  assert.deepEqual(parseNameStatus(""), [], "空输出 → 空列表");
  assert.deepEqual(parseNameStatus("\n\n  \n"), [], "空白行不算文件项");
  assert.deepEqual(
    parseNameStatus("R100\tfrontend/src/old.ts"),
    [],
    "残缺 rename 行（缺目标路径）→ 丢弃，不产出半条",
  );
  // copy 的父侧 = 自身（目标的父版本确实不存在）→ 后续 git show 查不到即为空串 = 新文件
  assert.deepEqual(
    parseNameStatus("C75\tfrontend/src/src.ts\tfrontend/src/copy.ts"),
    [{ rel: "frontend/src/copy.ts", parentRel: "frontend/src/copy.ts", status: "C75" }],
    "copy 不把源文件当父版本",
  );
}

// ─── 11) 汇总：阻断计数 / 纯幻影 / 倍数口径 ─────────
{
  const mk = (hash: string, added: number, shift: number, real: number, lineHits: number): CommitAudit => ({
    hash,
    subject: `subj-${hash}`,
    added,
    shift,
    real,
    lineHits,
  });
  const commits: CommitAudit[] = [
    mk("a", 10, 9, 1, 1), // 两规则都拦：倍数 10
    mk("b", 4, 4, 0, 0), // 纯幻影：baseline 独自拦下
    mk("c", 0, 0, 0, 2), // 盲区：行级报 2 条而 baseline 一条都不报（键与父侧重合）
    mk("d", 6, 3, 3, 3), // 两规则都拦：倍数 2
  ];
  const s = summarizeCommits(commits);

  assert.equal(s.commits, 4, "样本提交数");
  assert.equal(s.added, 20, "added 总数");
  assert.equal(s.shift, 16, "幻影总数");
  assert.equal(s.shiftPct, 80, "幻影占比（一位小数）");
  assert.equal(s.real, 4, "真新增候选总数");
  assert.equal(s.lineHits, 6, "行级命中总数");
  assert.equal(s.baselineBlocked, 3, "baseline 阻断数（added>0）");
  assert.equal(s.lineBlocked, 3, "行级阻断数（lineHits>0）");
  assert.equal(s.purePhantom, 1, "纯幻影提交数（added>0 且 lineHits=0）");
  assert.equal(s.bothBlocked, 2, "两规则都拦的提交数（倍数样本）");
  assert.equal(s.medianMultiplier, 6, "倍数中位数 = median(10, 2)");
  assert.equal(s.meanMultiplier, 6, "倍数均值 = mean(10, 2)");

  const empty = summarizeCommits([]);
  assert.deepEqual(
    [empty.commits, empty.added, empty.shift, empty.shiftPct, empty.lineHits],
    [0, 0, 0, 0, 0],
    "空样本 → 全零（占比/倍数不得变 NaN）",
  );
  assert.equal(empty.medianMultiplier, 0, "无样本 → 倍数 0（不是 Infinity/NaN）");
  assert.equal(empty.meanMultiplier, 0, "无样本 → 均值 0");
}

// ─── 12) median：空 / 奇 / 偶 ─────────
{
  assert.equal(median([]), 0, "空 → 0");
  assert.equal(median([5]), 5, "单元素");
  assert.equal(median([3, 1, 2]), 2, "奇数个取中间（先排序）");
  assert.equal(median([4, 1]), 2.5, "偶数个取中间两个均值");
}

console.log(
  "✅ test_token_shift_audit.ts 全部通过（12 组契约断言：位移幻影 / 真新增 / 窗口边界 / 多近邻 / 空输入 / 参数 / 判定域 / 键格式 / 逐行扫描 / name-status / 汇总 / median）",
);
