#!/usr/bin/env node
/**
 * test_design_tokens.ts — 设计令牌守规判定层契约测试（scripts/_lib/design-tokens.ts）。
 *
 * 为什么需要这组测试：check-design-tokens 是「设计规范有没有被执行」的度量闸，它自身
 * 判错的代价是双向的——假阳性会让人不信任闸门（之前 css-layer-check 被 4 条假 ERROR
 * 逼到无法接线），假阴性则让债务继续隐形。故这里把判定语义逐条钉死：
 *
 *   1. parseTokenMap        : 注释剥离 / 多令牌 / 值截断
 *   2. suggestToken         : **值精确相等才建议**（宁可不说，不给错答案）+ 属性域隔离
 *                             （font-size 不许建议 --radius-md，反之亦然）
 *   3. TOKEN_PX_BASELINE    : **与 variables.css 真实文本对账**——表是手写常量，若与
 *                             真实令牌漂移（如 --fs-md 从 13px 改成 14px），本用例报红。
 *                             这是防「表变成第二事实源」的唯一防线。
 *   4. findStyleAttrViolations : 内联字号/圆角/纯内联三态 + CSS 块（非内联）+ 注释豁免
 *                             + 同一 style 不重复刷三条（噪声放大防护）
 *   5. findEmojiIconViolations : 图标位命中 + 纯文案豁免（防误报）
 *
 * 依赖：node:assert / node:fs / node:path / node:url / scripts/_lib/design-tokens.ts
 *（纯函数模块，零顶层副作用——被测脚本主体含 process.exit 不可直接 import）。
 *
 * 用法：node tests/test_design_tokens.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLayoutDocDrift,
  findEmojiIconViolations,
  findLocaleEmojiPrefixViolations,
  findStyleAttrViolations,
  findToastEmojiPrefixViolations,
  findViolationsOnLines,
  fixLineTokens,
  isCommentLine,
  isRealtimeFeedbackTransition,
  parseTokenMap,
  suggestToken,
  TOKEN_PX_BASELINE,
} from "../scripts/_lib/design-tokens.ts";
import { addedLinesFromDiff } from "../scripts/_lib/git-hunks.ts";
import { allIconNames } from "../scripts/_lib/icon-map.ts";
import { walk } from "../scripts/_lib/scan-files.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VARIABLES_CSS = path.join(ROOT, "frontend/css/variables.css");

/**
 * 字号基准的等价像素（单一事实源 = TOKEN_PX_BASELINE）。
 * 本文件里凡「拿当前基准 px 当探针/替身」的字面量一律引用它——调 --fs-base-size 时
 * 只需改 variables.css + 表，不必再逐个改本文件的 13px/11px。
 */
const FS_SM_PX = TOKEN_PX_BASELINE["--fs-sm"];
const FS_MD_PX = TOKEN_PX_BASELINE["--fs-md"];

// ── 1. parseTokenMap：声明解析 ──────────────────────────
{
  const css = [
    ":root {",
    "  --fs-base: calc(var(--fs-base-size) + var(--fs-scale)); /* 12px @ 基准 */",
    "  --radius-md: 6px;   /* 卡片、对话框 */",
    "  /* --fake-token: 99px; 注释里的不算 */",
    "  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.06);",
    "}",
  ].join("\n");
  const map = parseTokenMap(css);
  assert.ok(map.has("--fs-base"), "应解析出 --fs-base");
  assert.ok(map.has("--radius-md"), "应解析出 --radius-md");
  assert.equal(map.get("--radius-md"), "6px", "--radius-md 值应为 6px");
  assert.ok(!map.has("--fake-token"), "注释内的伪令牌不应混入");
  console.log("  ✓ parseTokenMap: 声明解析 + 注释剥离");
}

// ── 2. suggestToken：值精确相等才建议 + 属性域隔离 ───────
{
  // 基准 px 从 TOKEN_PX_BASELINE 派生——基准调整（如 12px→13px）不再让本用例漂红
  const MD_PX = TOKEN_PX_BASELINE["--fs-md"];
  const BASE_PX = TOKEN_PX_BASELINE["--fs-base"];
  const tokens = parseTokenMap(`--fs-md: ${MD_PX}px;\n--fs-base: ${BASE_PX}px;\n--radius-md: 6px;`);

  // 值相等 → 建议（这是脚本最有价值的输出）
  assert.equal(
    suggestToken(MD_PX, "font-size", tokens),
    "--fs-md",
    `${MD_PX}px 字号应建议 --fs-md`,
  );
  assert.equal(
    suggestToken(6, "border-radius", tokens),
    "--radius-md",
    "6px 圆角应建议 --radius-md",
  );
  assert.equal(
    suggestToken(BASE_PX, "font-size", tokens),
    "--fs-base",
    `${BASE_PX}px 字号应建议 --fs-base`,
  );

  // 属性域隔离：字号不该被建议成圆角，反之亦然（防错答）
  assert.equal(suggestToken(6, "font-size", tokens), null, "6px 字号无对应字号令牌 → null");
  assert.equal(
    suggestToken(MD_PX, "border-radius", tokens),
    null,
    `${MD_PX}px 圆角无对应圆角令牌 → null`,
  );

  // 值不等 → null（宁可不说，不给错答案）：该 px 不在本 map 的令牌集合内
  assert.equal(
    suggestToken(MD_PX + 1, "font-size", tokens),
    null,
    `${MD_PX + 1}px 无精确匹配令牌 → null`,
  );
  assert.equal(suggestToken(5, "border-radius", tokens), null, "5px 无精确匹配令牌 → null");

  // 非字号/圆角属性不参与
  assert.equal(suggestToken(6, "padding", tokens), null, "padding 不在建议域内");

  // 令牌表里有、但 variables.css 里不存在 → 不给建议（防表漂移成事实源）
  assert.equal(
    suggestToken(13, "font-size", parseTokenMap("--other: 1px;")),
    null,
    "令牌不在实际 css 中时不建议",
  );
  console.log("  ✓ suggestToken: 精确匹配 + 属性域隔离 + 存在性校验");
}

// ── 3. TOKEN_PX_BASELINE 与 variables.css 真实值对账 ─────
{
  const cssText = fs.readFileSync(VARIABLES_CSS, "utf-8").replace(/\r\n/g, "\n");
  const real = parseTokenMap(cssText);

  // 3a) 表里每个令牌必须真实存在于 variables.css（否则建议会指向不存在的令牌）
  const missing: string[] = [];
  for (const name of Object.keys(TOKEN_PX_BASELINE)) {
    if (!real.has(name)) missing.push(name);
  }
  assert.deepEqual(
    missing,
    [],
    `TOKEN_PX_BASELINE 含 variables.css 中不存在的令牌: ${missing.join(", ")}`,
  );

  // 3b) px 值对账：从 variables.css 的行注释（`/* 13px @ 基准 */`）或字面值取基准 px，
  //     与表中数值比对。注释是我们的权威来源（calc 表达式无法静态求值）。
  const mismatches: string[] = [];
  for (const [name, expected] of Object.entries(TOKEN_PX_BASELINE)) {
    const declLine = cssText.split("\n").find((l) => l.includes(`${name}:`));
    if (!declLine) continue;
    // 优先取 `/* Npx @ 基准 */` 注释；无注释则取纯字面 `Npx`
    const commentPx = /\/\*\s*(\d+(?:\.\d+)?)px/.exec(declLine);
    const literalPx = /:\s*(\d+(?:\.\d+)?)px\s*;/.exec(declLine);
    const actual = commentPx?.[1]
      ? Number(commentPx[1])
      : literalPx?.[1]
        ? Number(literalPx[1])
        : null;
    if (actual === null) continue; // 无 px 线索（纯 calc 无注释）跳过，交由 3a 存在性保证
    if (actual !== expected) mismatches.push(`${name}: 表=${expected}px, css=${actual}px`);
  }
  assert.deepEqual(
    mismatches,
    [],
    `TOKEN_PX_BASELINE 与 variables.css 漂移（请同步 design-tokens.ts）:\n    ${mismatches.join("\n    ")}`,
  );
  console.log(
    `  ✓ TOKEN_PX_BASELINE 与 variables.css 对账通过（${Object.keys(TOKEN_PX_BASELINE).length} 项）`,
  );
}

// ── 4. findStyleAttrViolations：内联三态 + CSS 块 + 豁免 ──
{
  const tokens = parseTokenMap(
    `--fs-sm: ${FS_SM_PX}px;\n--fs-md: ${FS_MD_PX}px;\n--radius-md: 6px;`,
  );

  // 4a) 内联 font-size → 命中且带建议
  const a = findStyleAttrViolations(
    `  <div class="x" style="padding:4px;font-size:${FS_MD_PX}px">hi</div>`,
    10,
    tokens,
  );
  assert.equal(a.length, 1, "内联字号应只报 1 条（不叠加纯内联）");
  assert.equal(a[0]!.kind, "inline-style-font-size", "种类应为内联字号");
  assert.equal(a[0]!.suggestion, "--fs-md", "应建议 --fs-md");
  assert.equal(a[0]!.line, 10, "行号应回填");

  // 4b) 内联 border-radius → 命中且带建议
  const b = findStyleAttrViolations('style="border-radius:6px"', 3, tokens);
  assert.equal(b.length, 1, "内联圆角应只报 1 条");
  assert.equal(b[0]!.kind, "inline-style-radius", "种类应为内联圆角");
  assert.equal(b[0]!.suggestion, "--radius-md", "应建议 --radius-md");

  // 4c) 同一条 style 同时含字号+圆角 → 各报 1 条
  const c = findStyleAttrViolations(`style="font-size:${FS_MD_PX}px;border-radius:6px"`, 1, tokens);
  assert.equal(c.length, 2, "字号+圆角各 1 条");

  // 4d) 内联颜色硬编码 → inline-style-color
  const d = findStyleAttrViolations('style="color:#ff6b6b"', 5, tokens);
  assert.equal(d.length, 1, "内联硬编码颜色应报 1 条");
  assert.equal(d[0]!.kind, "inline-style-color", "种类应为内联颜色");

  // 4d-2) **CSS 块颜色同口径**：曾只收内联面，导致「同一违规写 CSS 块里就隐形」，
  //       判定随写法位置漂移（探针实测）。此处锁「两边都报」。
  const d2 = findStyleAttrViolations("  .x { color: #ff6b6b; }", 6, tokens);
  assert.equal(d2.length, 1, "CSS 块硬编码颜色也应报（与内联同口径）");
  assert.equal(d2[0]!.kind, "css-color", "种类应为 CSS 块颜色");

  // 4d-3) 中性色（纯黑/纯白/透明变体）豁免——跨主题通用，令牌化收益低，报了是噪声
  assert.deepEqual(
    findStyleAttrViolations("  .mask { background: rgba(0,0,0,0.5); }", 7, tokens),
    [],
    "中性半透明黑（遮罩）不应报",
  );
  assert.deepEqual(
    findStyleAttrViolations("  .b { border-color: #fff; }", 8, tokens),
    [],
    "纯白描边不应报",
  );
  // 但带彩色分量的一律要报（防「中性豁免」被滥用成漏检后门）
  assert.equal(
    findStyleAttrViolations("  .b { border-color: #fefefe; }", 9, tokens).length,
    1,
    "近白但有分量差应报（中性豁免不可滥宽）",
  );

  // 4e) CSS 块（非内联）→ css-font-size
  // 4e) CSS 块（非内联）→ 字号与颜色**各报 1 条**（#888 是中灰，非中性色，
  //     故应被计入；这是颜色口径扩展到 CSS 块后的正确行为）
  const e = findStyleAttrViolations(
    "  .slide-sublabel { color: #888; font-size: 12px; }",
    7,
    tokens,
  );
  assert.equal(e.length, 2, "CSS 块应报字号 + 颜色各 1 条");
  assert.ok(
    e.some((v) => v.kind === "css-font-size"),
    "应含 css 字号违规",
  );
  assert.ok(
    e.some((v) => v.kind === "css-color"),
    "应含 css 颜色违规",
  );

  // 4f) 注释行豁免
  const f = findStyleAttrViolations("  // 示例：font-size: 13px 应改为 var(--fs-md)", 1, tokens);
  assert.deepEqual(f, [], "注释行不应报违规");

  // 4g) 合规写法零命中（**关键回归防护**：AI 评测中最易犯的错是把合规代码判成债）
  const g = findStyleAttrViolations(
    'style="font-size:var(--fs-md);border-radius:var(--radius-md)"',
    1,
    tokens,
  );
  assert.deepEqual(g, [], "已用 token 的写法不应报违规");

  // 4h) 中性内联（布局类，规范未禁止）零命中——**防自造规则**：
  //     UI-Design.md 只在「艺术字体」场景禁内联，并未全仓禁内联 style。
  //     把 style="display:flex" 判成债会让噪声淹没真信号。
  const h = findStyleAttrViolations('style="display:flex;align-items:center;gap:8px"', 1, tokens);
  assert.deepEqual(h, [], "合规布局内联不应报违规（规范未禁全仓内联）");
  console.log("  ✓ findStyleAttrViolations: 内联三态 + CSS 块 + 注释/合规/中性豁免");
}

// ── 5. isCommentLine ───────────────────────────────────
assert.equal(isCommentLine("// x"), true);
assert.equal(isCommentLine("   * x"), true);
assert.equal(isCommentLine("  /* x"), true);
assert.equal(isCommentLine("const x = 1;"), false);
assert.equal(isCommentLine("  <div>hi</div>"), false);
console.log("  ✓ isCommentLine: 三种注释形态");

// ── 6. findEmojiIconViolations：图标位命中 + 文案豁免 ────
{
  // 图标位命中（标签内容起始处的 emoji）
  const a = findEmojiIconViolations('<button class="repo-tab">📁 ' + "Tree", 1);
  assert.ok(a.length >= 1, "标签内 emoji 应命中");
  assert.equal(a[0]!.kind, "emoji-icon", "种类应为 emoji-icon");

  // **真实形态回归锁**：本仓 tpl.ts 的 repo-tab 是「emoji + 空格 + 闭合引号 + 加号」，
  // 曾因正则要求「引号后紧跟 emoji」而整类漏报（探针实测发现）。按真实源码形态锁定。
  const real = findEmojiIconViolations(
    `    '<button class="repo-tab active" data-testid="content-tab" data-tab="tree">📁 ' +`,
    1,
  );
  assert.equal(real.length, 1, "真实 repo-tab 形态必须命中（防整类漏报回归）");
  assert.equal(real[0]!.snippet, "📁", "应提取出 emoji 本体");

  // **变体选择符保真**：`♻️`（U+267B U+FE0F）须整体保留，不能截成裸 `♻`
  // （曾因把 FE0F 放进 + 字符类而丢失变体；biome noMisleadingCharacterClass 亦告警）
  const vs = findEmojiIconViolations(`<button class="a">♻️ ' + t("recycle.tab") + "</button>"`, 1);
  assert.equal(vs.length, 1, "VS16 序列应命中");
  assert.equal(vs[0]!.snippet, "♻️", "变体选择符应保留完整字形");

  // 无标签特征的行不参与（防日志文案误报）
  const b = findEmojiIconViolations('const msg = "❌ 加载失败";', 2);
  assert.deepEqual(b, [], "纯文案行（无标签特征）不应命中");

  // 注释行豁免
  const c = findEmojiIconViolations("<div>📁</div> // 注释", 3);
  assert.ok(c.length >= 1, "含标签的行仍应命中（注释混排不豁免整行）");
  const d = findEmojiIconViolations("// <div>📁</div>", 4);
  assert.deepEqual(d, [], "整行注释应豁免");

  // 无 emoji 的合规行零命中
  const e = findEmojiIconViolations('<div class="x">plain text</div>', 5);
  assert.deepEqual(e, [], "无 emoji 不应命中");
  console.log("  ✓ findEmojiIconViolations: 图标位命中（含真实形态/VS16）+ 豁免");
}

// ── 6a. findToastEmojiPrefixViolations：toast 载荷前缀状态 emoji（ADR-267 门禁补盲）──
{
  // toast 字面量里的前缀状态 emoji → 命中并附图标建议
  const t1 = findToastEmojiPrefixViolations('toast("✅ 已保存", 2000, "success")', 1);
  assert.equal(t1.length, 1, "toast 载荷前缀 ✅ 应命中");
  assert.equal(t1[0]!.kind, "toast-emoji-prefix");
  assert.equal(t1[0]!.suggestion, "UI_ICONS.success");
  assert.equal(t1[0]!.line, 1);

  // bus.emit("toast:show", …) 形态的 msg 载荷
  const t2 = findToastEmojiPrefixViolations('bus.emit("toast:show", { msg: "⚠️ 同步失败" })', 2);
  assert.equal(t2.length, 1, "bus.emit toast msg 前缀 ⚠️ 应命中");
  assert.equal(t2[0]!.suggestion, "UI_ICONS.warning");

  // toastError helper
  const t3 = findToastEmojiPrefixViolations('toastError("❌ 统计失败")', 3);
  assert.equal(t3.length, 1, "toastError 载荷前缀 ❌ 应命中");
  assert.equal(t3[0]!.suggestion, "UI_ICONS.error");

  // 动作/内容字形（无 type 图标承托）作为前缀 → 不命中（防误报）
  const t4 = findToastEmojiPrefixViolations('toast("📦 打包完成")', 4);
  assert.deepEqual(t4, [], "内容字形 📦 前缀不应命中");

  // 非 toast 构造行里的字符串 → 完全不参与（防普通字符串误报）
  const t5 = findToastEmojiPrefixViolations('const msg = "❌ 加载失败";', 5);
  assert.deepEqual(t5, [], "非 toast 调点行不应命中");

  // 无前缀（已清理）→ 零命中
  const t6 = findToastEmojiPrefixViolations('toast("已保存", 2000, "success")', 6);
  assert.deepEqual(t6, [], "已清理（无前缀）不应命中");

  // 注释行豁免
  const t7 = findToastEmojiPrefixViolations('// toast("✅ 已保存")', 7);
  assert.deepEqual(t7, [], "注释行应豁免");
  console.log("  ✓ findToastEmojiPrefixViolations: toast 载荷前缀状态 emoji 命中/豁免");
}

// ── 6b. findLocaleEmojiPrefixViolations：locale 值前缀状态 emoji（ADR-267 门禁补盲）──
{
  // ① 叶子值行值首状态 emoji → 命中 + 图标建议
  const l1 = findLocaleEmojiPrefixViolations('  "tree.indexGenerated": "✅ index.json 已生成",', 1);
  assert.equal(l1.length, 1, "locale 值首 ✅ 应命中");
  assert.equal(l1[0]!.kind, "locale-emoji-prefix");
  assert.equal(l1[0]!.suggestion, "UI_ICONS.success");

  // ② 多行值续行首状态 emoji（syncManager.scanDirWide 形态）
  const l2 = findLocaleEmojiPrefixViolations(
    '    "⚠️ {label} 仓库基准目录过大，建议指向子目录",',
    2,
  );
  assert.equal(l2.length, 1, "多行值续行首 ⚠️ 应命中");
  assert.equal(l2[0]!.suggestion, "UI_ICONS.warning");

  // ③ 值内 `/` 子句分隔后的状态 emoji（ctx.moveOkPartial 形态）
  const l3 = findLocaleEmojiPrefixViolations(
    '  "ctx.moveOkPartial": "{ok} 个已移动 / ❌ {fail} 失败",',
    3,
  );
  assert.equal(l3.length, 1, "值内 / 子句后 ❌ 应命中");
  assert.equal(l3[0]!.suggestion, "UI_ICONS.error");

  // 动作/内容字形前缀（保留的按钮/提示图标）→ 不命中
  const l4 = findLocaleEmojiPrefixViolations('  "recycle.deleteOk": "🗑️ 删除",', 4);
  assert.deepEqual(l4, [], "动作图标 🗑️ 前缀不应命中");
  const l5 = findLocaleEmojiPrefixViolations('  "content.noMcDirHint": "💡 如果装了启动器…",', 5);
  assert.deepEqual(l5, [], "提示字形 💡 前缀不应命中");

  // 已清理（无前缀）→ 零命中
  const l6 = findLocaleEmojiPrefixViolations('  "tree.indexGenerated": "index.json 已生成",', 6);
  assert.deepEqual(l6, [], "已清理的 locale 值不应命中");

  // 非 locale 源（普通 TS 字符串，无引号值前缀形态）→ 不命中
  const l7 = findLocaleEmojiPrefixViolations('const s = "❌ 加载失败";', 7);
  assert.deepEqual(l7, [], "非 locale 值行不应命中");

  // 注释行豁免
  const l8 = findLocaleEmojiPrefixViolations('  // "tree.indexGenerated": "✅ 已生成"', 8);
  assert.deepEqual(l8, [], "注释行应豁免");
  console.log("  ✓ findLocaleEmojiPrefixViolations: locale 值前缀状态 emoji 命中/豁免");
}

// ── 6c. findViolationsOnLines：locale 域开关只对 locale 文件生效 ──
{
  const text = '  "tree.indexGenerated": "✅ index.json 已生成",\ntoast("已保存")';
  const hitsLocale = findViolationsOnLines(text, [1, 2], undefined, { locale: true });
  assert.ok(
    hitsLocale.some((v) => v.kind === "locale-emoji-prefix"),
    "locale 域开启时应命中 locale 值前缀",
  );
  const hitsNonLocale = findViolationsOnLines(text, [1, 2], undefined, { locale: false });
  assert.ok(
    !hitsNonLocale.some((v) => v.kind === "locale-emoji-prefix"),
    "locale 域关闭时不命中 locale 值前缀（它在非 locale 文件里可能只是普通字符串）",
  );
  console.log("  ✓ findViolationsOnLines: locale 域按文件开关生效");
}

// ── 7. checkLayoutDocDrift：文档数值 vs 代码权威值 ───────
{
  // 7a) 文档内自相矛盾（同一令牌两个值）→ 报漂移
  //     用真实文档的「表头一行 + 值行一行」结构，且含 sidebar 列作干扰项——
  //     按列取值必须只拿 preview 列的 240px，不能把 sidebar 的 300px 也算进来。
  const contradictory = [
    "├────────┬──────────────────┬──────────────┤",
    "│ sidebar│    main content   │   preview    │",
    "│ 300px  │      1fr         │   240px      │",
    "grid-template-columns: var(--sidebar-width, 300px) 1fr var(--preview-width, 200px)",
  ].join("\n");
  const d1 = checkLayoutDocDrift(contradictory, "220px");
  assert.ok(d1.length >= 1, "文档内多值应报漂移");
  assert.ok(d1[0]!.detail.includes("自相矛盾"), "应指出文档内部矛盾");
  assert.ok(
    d1[0]!.docValues.includes("240px") && d1[0]!.docValues.includes("200px"),
    "应同时取到表图的 240px 与 CSS 示例的 200px",
  );
  assert.ok(
    !d1[0]!.docValues.includes("300px"),
    "sidebar 的 300px 是干扰项，按列取值不应误收（防假阳性）",
  );

  // 7b) 文档单值与代码一致 → 无漂移（防误报）
  const consistent = "grid-template-columns: var(--preview-width, 220px)";
  assert.deepEqual(checkLayoutDocDrift(consistent, "220px"), [], "文档与代码一致不应报漂移");

  // 7c) 文档单值与代码不一致 → 报漂移
  const stale = "grid-template-columns: var(--preview-width, 200px)";
  const d3 = checkLayoutDocDrift(stale, "220px");
  assert.equal(d3.length, 1, "文档值与代码不符应报 1 条");
  assert.ok(d3[0]!.detail.includes("200px") && d3[0]!.detail.includes("220px"), "应展示两值");

  // 7d) 文档未提及该令牌 → 不报（由人工确认，避免误报）
  assert.deepEqual(
    checkLayoutDocDrift("# 别的文档\n没有任何布局数值", "220px"),
    [],
    "未提及不应报",
  );

  // 7e) 取不到代码值时（null）不误报「不一致」
  const d5 = checkLayoutDocDrift(stale, null);
  assert.deepEqual(d5, [], "无代码权威值时不应判不一致");
  console.log("  ✓ checkLayoutDocDrift: 矛盾/一致/过时/未提及/无基准 五态");
}

// ── 8. fixLineTokens：机械等价替换（--fix 的判定核心）──
{
  const tokens = parseTokenMap(
    `--fs-md: ${FS_MD_PX}px;\n--fs-sm: ${FS_SM_PX}px;\n--radius-md: 6px;`,
  );

  // 8a) 字号有精确令牌 → 替换为 var()，且记账
  const a = fixLineTokens(`style="font-size:${FS_MD_PX}px"`, tokens);
  assert.equal(a.text, 'style="font-size:var(--fs-md)"', `${FS_MD_PX}px 应替换为 var(--fs-md)`);
  assert.equal(a.edits.length, 1, "应记 1 笔");

  // 8b) 一行多处独立替换
  const b = fixLineTokens(`style="font-size:${FS_MD_PX}px;border-radius:6px"`, tokens);
  assert.equal(
    b.text,
    'style="font-size:var(--fs-md);border-radius:var(--radius-md)"',
    "字号与圆角应各自替换",
  );
  assert.equal(b.edits.length, 2, "应记 2 笔");

  // 8c) **无精确令牌 → 原样保留**（绝不做语义猜测；值等值是替换的前提）
  const c = fixLineTokens('style="font-size:15px"', tokens);
  assert.equal(c.text, 'style="font-size:15px"', "15px 无对应令牌，不得改动");
  assert.equal(c.edits.length, 0, "无改动则无记账");

  // 8d) **var() fallback 内的值不替换**（关键安全边界）：
  //     `var(--x,12px)` 里的 12px 是 fallback，本就是令牌形态，替换会破坏语义。
  const d = fixLineTokens('style="font-size:var(--x,11px)"', tokens);
  assert.equal(d.text, 'style="font-size:var(--x,11px)"', "var() fallback 内不得替换");
  assert.equal(d.edits.length, 0, "var() 内不记账");

  // 8e) 已是令牌的写法不动（幂等：再跑一次不产生新改动）
  const e = fixLineTokens('style="font-size:var(--fs-md)"', tokens);
  assert.equal(e.text, e.text, "已合规写法则保持不变");
  assert.equal(e.edits.length, 0, "合规写法无记账");
  // 幂等性：对 a 的结果再跑一次，应无新增改动
  const again = fixLineTokens(a.text, tokens);
  assert.equal(again.edits.length, 0, "替换结果再跑应无改动（幂等）");

  // 8f) 注释行不动
  const f = fixLineTokens("// font-size: 13px 示例", tokens);
  assert.equal(f.text, "// font-size: 13px 示例", "注释行不得改动");
  assert.equal(f.edits.length, 0, "注释行无记账");

  // 8g) 颜色**有意不自动替换**（语义映射机器判不了，猜测即给错答案）
  const g = fixLineTokens('style="color:#ff6b6b"', tokens);
  assert.equal(g.text, 'style="color:#ff6b6b"', "颜色不得自动替换（需人工判语义令牌）");
  assert.equal(g.edits.length, 0, "颜色无记账");
  console.log("  ✓ fixLineTokens: 替换/多处/无令牌保留/var 安全/幂等/注释/颜色不碰");
}

// ── 9. 扫描范围：`css/` 目录不得被跳过（回归锁）──
{
  // 踩坑记录：walk() 的默认 skipDir 会跳过**任何名为 css 的目录**，而本仓样式常量
  // 恰恰住在 `frontend/src/views/app-content/css/`——沿用默认值导致整目录（8 文件）
  // 漏扫，报告数字系统性偏低、--fix 对该目录完全无效（实测发现：content-creator.ts
  // 的 font-size:12px 明明可映射却未被修）。
  // 此处按 check-design-tokens.ts 的实际配置复现 walk 调用，锁死「css 目录必须被扫到」。
  const CSS_DIR_FILE = path.join(ROOT, "frontend/src/views/app-content/css/content-creator.ts");
  assert.ok(fs.existsSync(CSS_DIR_FILE), "作为回归锚点的文件应存在（路径变更时请同步本测试）");

  const scanned = walk(path.join(ROOT, "frontend/src"), {
    exts: [".ts"],
    skipTest: true,
    skipDir: (n: string) => n.startsWith(".") || n === "node_modules",
  }) as string[];
  const relSet = new Set(scanned.map((p) => p.replace(/\\/g, "/")));
  const hit = [...relSet].some((p) => p.includes("/views/app-content/css/"));
  assert.ok(hit, "扫描必须覆盖 views/app-content/css/（默认 skipDir 会误跳 css 目录）");

  // [范围补齐 2026-09] 文档层 CSS（frontend/css/*.css）加入扫描域回归锁。
  // 此前闸只 walk(frontend/src, exts:[".ts"])，5 个手写样式表从未被扫——实测藏 60 条
  // （components.css 单文件 49）。此处复现 CLI 的第二个 walk 调用并断言覆盖。
  const cssScanned = walk(path.join(ROOT, "frontend/css"), {
    exts: [".css"],
    skipDir: () => false,
  }) as string[];
  const cssNames = new Set(cssScanned.map((p) => path.basename(p)));
  for (const f of [
    "variables.css",
    "layout.css",
    "components.css",
    "dialogs.css",
    "transitions.css",
  ]) {
    assert.ok(cssNames.has(f), `文档层 CSS 必须被扫到：${f}（范围回归锁）`);
  }
  console.log("  ✓ 扫描范围: src 的 css/ 目录 + 文档层 frontend/css/ 均被覆盖");
}

// ── 10. emoji 命中附带语义图标建议（ADR-238 D4 回归锁）──
{
  // 为什么锁：emoji 债的价值全在「能否机械收敛」。若建议丢失，275 处 UI chrome
  // 又退回「一堆字形」，AI 只能靠猜——本闸就从「可收债清单」退化成「计数器」。
  const hits = findEmojiIconViolations("<div>⚠️ ${msg}</div>", 1);
  assert.equal(hits.length, 1, "⚠️ 应命中 1 处");
  assert.equal(
    hits[0]!.suggestion,
    "UI_ICONS.warning",
    "⚠️ 应建议 UI_ICONS.warning（ADR-238 语义名）",
  );

  // 未收录字形：命中但建议为 null（宁可不建议，不猜错）
  const unmapped = findEmojiIconViolations("<div>🦄 ${msg}</div>", 1);
  assert.equal(unmapped.length, 1, "未收录 emoji 仍应计入债（它确实是不受控图标）");
  assert.equal(unmapped[0]!.suggestion, null, "未收录字形不应瞎给建议");

  // 建议名必须真实存在于图标集（防「建议了不存在的名」——比不建议更糟：
  // AI 会照建议写，然后发现没有这个图标）
  const mapped = hits.map((h) => h.suggestion).filter(Boolean) as string[];
  for (const s of mapped) {
    assert.ok(
      allIconNames().includes(s.replace(/^UI_ICONS\./, "")),
      `建议 ${s} 必须在 icon-map 中有对应语义名`,
    );
  }
  console.log("  ✓ emoji 建议: 附语义图标名（⚠️ → UI_ICONS.warning），未收录给 null");
}

// ── 11. box-shadow / transition 判定（2026-09 补：UI-Design.md §7/§7.1 的漏网面）──
{
  // 为什么补：UI-Design.md §7.1 明文「所有 box-shadow 必须使用 --shadow-*」、
  // §7 明文「所有 transition 时长必须使用 --tr-*」，但判定层原只覆盖
  // font-size/radius/color/emoji 四类——这两条规范长期「有规范无断言」。
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));

  // ① 与令牌同值 → 命中且给建议（含书写形态归一：rgba .25 vs 0.25）
  const eq = findStyleAttrViolations(".x { box-shadow: 0 8px 32px rgba(0,0,0,.25); }", 1, tokens);
  assert.equal(eq.length, 1, "与 --shadow-xl 同值的阴影应命中");
  assert.equal(eq[0]!.kind, "css-shadow", "种类应为 css-shadow");
  assert.equal(eq[0]!.suggestion, "--shadow-xl", "应建议 --shadow-xl");

  // ② 非令牌阴影 → **不报**（核心防噪声口径：这些是设计意图，不是债）
  for (const v of [
    "0 4px 12px rgba(0,0,0,.3)", // 无对应令牌的浮层阴影
    "0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)", // 焦点环
    "0 8px 24px rgba(0,0,0,.5)", // 比 --shadow-xl 更重的浮层
    "var(--shadow-lg)", // 已是令牌形态
    "none",
  ]) {
    const r = findStyleAttrViolations(`.x { box-shadow: ${v}; }`, 1, tokens);
    assert.equal(r.length, 0, `非令牌阴影不应报（防噪声）：${v}`);
  }

  // ③ transition：**除豁免外一律报**（[判定反转 2026-09] 见块 14 的说明）
  const t1 = findStyleAttrViolations(".x { transition: background .12s ease; }", 1, tokens);
  assert.equal(t1[0]?.kind, "css-transition", "0.12s 应命中 css-transition");
  assert.equal(t1[0]?.suggestion, "--tr-fast", ".12s 应建议 --tr-fast（时长+缓动双匹配）");
  // 建议与 --fix 同口径：`transform .25s` 缓动为隐式 ease ≠ --tr-enter 的 ease-out，
  // 给建议会误导（报告说建议、--fix 却不改），故为 null 而仍照报。
  assert.equal(
    findStyleAttrViolations(".x { transition: transform .25s; }", 1, tokens)[0]?.suggestion,
    null,
    ".25s 缓动不匹配 → 不给建议（但报告保留）",
  );
  // 反转后：无令牌对应的硬编码时长**必须报**（这正是反转修掉的盲区）
  assert.equal(
    findStyleAttrViolations(".x { transition: width 0.2s; }", 1, tokens).length,
    1,
    "0.2s 不撞任何令牌，但仍是硬编码时长 → 反转后必须报",
  );

  // ④ 两类归 ERROR 档（与字号/圆角同构：判定条件是「与令牌等价」，无语义猜测空间）。
  //    此处只锁判定层产出非空，CLI 的分档由 check-design-tokens 的 ERROR_KINDS 负责。
  assert.ok(
    findStyleAttrViolations(".x{box-shadow:0 8px 32px rgba(0,0,0,.25);}", 1, tokens).length > 0,
    "压缩写法（无空格）也应命中",
  );
  console.log("  ✓ box-shadow: 同令牌值命中并给建议；非令牌值沉默（防噪声）");
}

// ── 12. 自定义属性名尾撞车回归锁（--fix 曾静默改写令牌定义）──
{
  // 踩坑记录（2026-09 实测触发）：朴素正则 `/font-size\s*:\s*(\d+)px/` 无属性名左边界，
  // 会匹配 `--uih-section-title-font-size: 11px;` 这类**自定义属性定义**。
  // 危害不止于假阳性——`--fix` 会真的把它改写成 `var(--fs-sm)`，而 `--uih-*` 前缀的
  // 存在意义正是「隔离于 ysm 全局主题令牌」（见 components-styles.ts 头注），
  // 改写即破坏隔离 = 自动修复造成的静默语义损坏。实测已在 components-styles.ts 上
  // 真实发生一次，靠人工 diff 复核才发现。
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));

  for (const line of [
    "  --uih-section-title-font-size: 11px;",
    "  --my-font-size: 13px;",
    "  --foo-border-radius: 6px;",
  ]) {
    assert.equal(
      findStyleAttrViolations(line, 1, tokens).length,
      0,
      `自定义属性定义不应被判为违规：${line}`,
    );
    assert.equal(
      fixLineTokens(line, tokens).text,
      line,
      `自定义属性定义不应被 --fix 改写：${line}`,
    );
  }

  // 同行的真属性仍须被抓到（防「一刀切不匹配」的假修复）
  const mixed = `.x { --uih-font-size: 11px; font-size: ${FS_MD_PX}px; }`;
  const hits = findStyleAttrViolations(mixed, 1, tokens);
  assert.equal(hits.length, 1, "同行内真 font-size 应命中，自定义属性不计入");
  assert.equal(hits[0]!.suggestion, "--fs-md", "真属性应仍给正确建议");
  const fixed = fixLineTokens(mixed, tokens).text;
  assert.ok(fixed.includes("--uih-font-size: 11px"), "自定义属性须原样保留");
  assert.ok(fixed.includes("font-size:var(--fs-md)"), "真属性须被令牌化");
  console.log("  ✓ 属性左边界: --x-font-size 不再误判/误改；同行真属性仍命中");
}

// ── 13. box-shadow 自动修复：值等价 + 幂等 ──────────────
{
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));
  const src = ".x { box-shadow: 0 8px 32px rgba(0,0,0,.25); }";
  const once = fixLineTokens(src, tokens);
  assert.ok(once.text.includes("box-shadow:var(--shadow-xl)"), "应替换为 var(--shadow-xl)");
  assert.equal(once.edits.length, 1, "应记账 1 处");
  // 幂等：再跑一次不应变化（var() 内不重复替换）
  assert.equal(fixLineTokens(once.text, tokens).text, once.text, "--fix 必须幂等");
  // 非令牌阴影不动
  const bespoke = ".x { box-shadow: 0 4px 12px rgba(0,0,0,.3); }";
  assert.equal(fixLineTokens(bespoke, tokens).text, bespoke, "非令牌阴影不得被改写");
  console.log("  ✓ box-shadow --fix: 值等价替换 + 幂等 + 非令牌不碰");
}

// ── 14. transition 精确修复：时长 + 缓动双双一致才动 ────
{
  // 为什么需要（2026-09 踩坑）：transition 是复合值，只看时长就自动替换会**改语义**——
  // `transform .25s ease` 与 `--tr-enter`(0.25s **ease-out**) 时长相同但缓动不同，
  // 替换会把「平滑」偷偷变成「减速」。故 --fix 走 suggestTransitionTokenExact
  // （时长与缓动双闸），报告层则仍用只比时长的 suggestTransitionToken 提示作者。
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));

  // ① 可安全整值替换（时长 + 缓动一致）
  for (const [raw, want] of [
    ["background .12s ease", "var(--tr-fast)"],
    ["opacity .12s ease", "var(--tr-fast)"],
    ["filter .12s ease", "var(--tr-fast)"],
    ["background 0.12s", "var(--tr-fast)"], // 缓动缺省 = CSS 默认 ease
    ["background 0.15s", "var(--tr-normal)"],
    ["all 0.15s ease", "var(--tr-normal)"],
    ["transform .25s ease-out", "var(--tr-enter)"],
  ] as const) {
    const line = `.x { transition: ${raw}; }`;
    const out = fixLineTokens(line, tokens).text;
    assert.ok(out.includes(want), `${raw} 应替换为 ${want}（实际: ${out}）`);
  }

  // ② 必须拒绝的四类（防「自动化造成的语义漂移」，比不修更糟）
  for (const [raw, why] of [
    ["all .25s ease", "缓动 ease ≠ --tr-enter 的 ease-out"],
    ["transform 0.25s ease", "同上"],
    ["background .12s, color .12s", "多属性值整值替换会塌缩成一个属性"],
    ["max-height 0.3s ease, opacity 0.25s ease", "多属性 + 0.3s 无令牌"],
    ["background 0.2s", "0.2s 无对应 --tr-* 令牌"],
    ["width 0.06s linear", "滑块跟手，linear 且无令牌"],
    ["transform .25s cubic-bezier(.34,1.56,.64,1)", "自定义缓动不碰"],
    ["background .12s linear", "linear ≠ ease"],
  ] as const) {
    const line = `.x { transition: ${raw}; }`;
    assert.equal(fixLineTokens(line, tokens).text, line, `不应改写（${why}）：${raw}`);
  }

  // ③ 幂等
  const once = fixLineTokens(".x { transition: background .12s ease; }", tokens).text;
  assert.equal(fixLineTokens(once, tokens).text, once, "transition --fix 必须幂等");
  console.log("  ✓ transition --fix: 时长+缓动双闸；缓动差异/多属性/无令牌一律拒绝");
}

// ── 14b. transition 判定反转 + 三条豁免（2026-09 收口）──────
{
  // 反转动机（实测盲区 11 处声明点）：原口径「时长与某 --tr-* 相等才报」只抓得住
  // 「差一点就对了」的写法，而 `.1s`/`.2s`/`.3s`/`.4s` 这类**不撞任何令牌**的硬编码
  // 时长全部隐形——闸对本该管的「硬编码时长」失明。现改为「除豁免外一律报」。
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));
  const has = (line: string) =>
    findStyleAttrViolations(line, 1, tokens).some((v) => v.kind === "css-transition");

  // ① 反转正面：各类非令牌时长都必须报
  for (const raw of [
    "width 0.2s", // 无对应令牌
    "opacity .1s", // 无对应令牌
    "background 0.3s ease", // 主题类慢速
    "transform .4s ease", // 慢速
    "all .25s ease", // 时长撞 --tr-enter 但缓动不同
  ]) {
    assert.ok(has(`.x { transition: ${raw}; }`), `反转后应报硬编码时长：${raw}`);
  }

  // ② 豁免一：跟手/进度条（几何属性 + linear + <0.1s）
  for (const raw of ["width 0.06s linear", "left 0.06s linear,top 0.06s linear"]) {
    assert.ok(!has(`.x { transition: ${raw}; }`), `跟手类应豁免：${raw}`);
  }
  // 边界：0.1s 不满足「严格 <0.1s」→ 报（这正是进度条取 0.06s 而非 0.1s 的原因）
  assert.ok(has(".x { transition: width 0.1s linear; }"), "0.1s 未严格短于上限 → 应报");
  // 边界：非几何属性即使短+linear 也不豁免（如 opacity）
  assert.ok(has(".x { transition: opacity 0.06s linear; }"), "opacity 非跟手属性 → 应报");

  // ③ 豁免二：自定义缓动（cubic-bezier / steps）——令牌三档无法表达回弹
  for (const raw of [
    "transform .2s cubic-bezier(.34,1.56,.64,1)",
    "transform .25s cubic-bezier(.34,1.56,.64,1)",
    "opacity .3s steps(4, end)",
  ]) {
    assert.ok(!has(`.x { transition: ${raw}; }`), `自定义缓动应豁免：${raw}`);
  }
  // ⚠️ 回归锁：自定义缓动**含顶层逗号**，若用朴素 split(",") 会被切碎导致豁免失效
  // （实测 content-layout 的 .num bump 因此被误报）——必须按顶层逗号切分。
  assert.ok(
    !has(".x { transition:transform .2s cubic-bezier(.34,1.56,.64,1); }"),
    "带内部逗号的 cubic-bezier 必须整段识别为自定义缓动（splitTopLevelCommas 回归锁）",
  );

  // ④ 豁免三：tr-exempt 注释标记（§7「说明为何非它不可」的机器可读出口）
  assert.ok(
    !has(".x { transition: opacity 0.4s; /* tr-exempt: 涟漪需缓慢浮现 */ }"),
    "tr-exempt 标记应豁免该行",
  );
  assert.ok(has(".x { transition: opacity 0.4s; }"), "无标记时同一写法仍应报（防标记失效）");
  // 标记只作用于所在行，不扩散
  assert.ok(
    has(".x { transition: opacity 0.4s; }\n.y { transition: opacity 0.4s; }"),
    "标记不跨行（逐行判定的固有边界）",
  );

  // ⑤ 已令牌化 / 复合值半令牌化：不得误报
  for (const raw of [
    "var(--btn-transition)",
    "background var(--tr-normal), color var(--tr-normal)",
  ]) {
    assert.ok(!has(`.x { transition: ${raw}; }`), `已令牌化不应报：${raw}`);
  }
  // 复合值里只要还有真·硬编码分量，就该报（不能因一半 var() 就整体放过）
  assert.ok(
    has(".x { transition: background .12s ease, color var(--tr-fast); }"),
    "复合值中残留硬编码分量仍应报",
  );

  console.log("  ✓ transition 反转: 非令牌时长全报；跟手/自定义缓动/tr-exempt 三类豁免");
}

// ── 14c. propValueRe 左边界（自定义属性名尾撞车）──────
{
  // 与块 12（font-size/border-radius）同源的假阳性：`--uih-collapsible-panel-transition:`
  // 这类**自定义属性定义**曾被 propValueRe 无左边界匹配，误当 transition 声明计入违规
  // （实测该假阳性长期挂在基线里）。左边界补上后应沉默。
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));
  assert.equal(
    findStyleAttrViolations(
      "  --uih-collapsible-panel-transition: max-height 0.3s ease, opacity 0.25s ease;",
      1,
      tokens,
    ).length,
    0,
    "自定义属性定义不应被当作 transition 声明",
  );
  // 真声明仍须命中（防「一刀切不匹配」的假修复）
  assert.ok(
    findStyleAttrViolations(".x { transition: opacity .3s; }", 1, tokens).some(
      (v) => v.kind === "css-transition",
    ),
    "真 transition 声明仍应命中",
  );
  console.log("  ✓ 属性左边界: --x-transition 定义不再误判；真声明仍命中");
}

// ── 15. 值提取的 `}` 边界回归锁（闸静默漏报）──────
{
  // 踩坑记录（2026-09 实测）：本仓样式多为**压缩成单行的模板串**
  // （`...;transition:background .12s ease}`），值提取正则的停止符若漏 `}`，
  // 值尾会带上规则块闭合括号 → 精确比对（shadow/transition）**恒不匹配**。
  // 最阴的是不对称：报告层照样命中（只看时长子串），--fix 却不生效——
  // 实测 fab.ts / tooltip.ts / app-preview/css.ts 共 6 处可修项被静默跳过。
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));

  // 压缩单行形态（值紧跟 `}`）
  const minified = ".b{transition:background .12s ease}";
  const outMini = fixLineTokens(minified, tokens).text;
  assert.ok(
    outMini.includes("transition:var(--tr-fast)}"),
    `压缩单行（值尾接 }）应能修复，实际: ${outMini}`,
  );

  const miniShadow = ".b{box-shadow: 0 8px 32px rgba(0,0,0,.25)}";
  assert.ok(
    fixLineTokens(miniShadow, tokens).text.includes("box-shadow:var(--shadow-xl)}"),
    "压缩单行的 box-shadow 同样应能修复",
  );

  // 报告层在两种形态下都应命中（防「只有一种形态能看见」）
  for (const line of [
    ".b{transition:background .12s ease}",
    ".b { transition: background .12s ease; }",
  ]) {
    assert.ok(
      findStyleAttrViolations(line, 1, tokens).some((v) => v.kind === "css-transition"),
      `transition 报告不应依赖结尾形态：${line}`,
    );
  }
  console.log("  ✓ 值提取边界: 压缩单行（值尾接 }）报告与修复均生效");
}

// ── 16. components-styles.ts 形态锁（单行 23KB 字符串 → 模板字面量）──
{
  // 该文件原为「单行字符串字面量 + \n 转义」（MikuMikuAR 迁移脚本产物），
  // 全 CSS 挤在 1 行 23KB：diff 不可读、行号无意义、基线 key 退化（一行塌缩成一个 key）。
  // 2026-09 转为模板字面量。此锁防「哪天重跑迁移脚本又被压回单行」。
  const SRC = path.join(ROOT, "frontend/src/preview-3d/menu/style/components-styles.ts");
  const text = fs.readFileSync(SRC, "utf8");
  assert.ok(
    text.includes("`"),
    "components-styles.ts 应使用模板字面量（形态可读；勿退回 \\n 转义单行）",
  );
  const longest = Math.max(...text.split("\n").map((l) => l.length));
  assert.ok(longest < 2000, `最长行 ${longest} 字符——疑似样式被压回单行（应 <2000）`);
  console.log(`  ✓ components-styles 形态锁: 模板字面量、最长行 ${longest} 字符`);
}

// ── 14. 实时反馈（跟手）过渡不适用令牌（UI-Design.md §7 例外条款）──
{
  // 为什么补：滑块跟手 `.cs-fill { transition: width 0.06s linear }` /
  // `.cs-thumb { transition: left 0.06s linear }` 语义是**跟手**而非缓动。判定层原
  // 按「时长撞令牌」机械匹配，这类会长期挂在基线里当「永远不会修的债」，或更糟——
  // 被人「顺手修好」套上 --tr-fast，让拖拽从跟手退化为迟钝。
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));

  // ① 规则本身：三条准入（跟手属性 + linear + <0.1s）
  for (const v of [
    "width 0.06s linear",
    "left 0.06s linear",
    "height .05s linear",
    "top 60ms linear",
  ]) {
    assert.equal(isRealtimeFeedbackTransition(v), true, `应判为实时反馈：${v}`);
  }
  // 反向：任一条不满足即**不**豁免（防规则过宽变成变相白名单）
  for (const v of [
    "width 0.06s ease", // ② 缓动非 linear → 跟手会滞后于指针
    "width 0.2s linear", // ③ 时长 >= 0.1s → 属常规过渡
    "width 0.12s linear", // ③ 且撞 --tr-fast 时长，更该报
    "opacity 0.06s linear", // ① 非跟手属性（淡入淡出该套令牌）
    "background 0.06s linear", // ① 非跟手属性
  ]) {
    assert.equal(isRealtimeFeedbackTransition(v), false, `不应豁免：${v}`);
  }

  // ② 报告层：豁免生效——跟手过渡不再产出 css-transition
  assert.equal(
    findStyleAttrViolations(".cs-fill { transition: width 0.06s linear; }", 1, tokens).length,
    0,
    "滑块跟手不应报（0.06s 本无对应令牌，正是会被长期挂账的那类）",
  );
  // ③ 对照：同样短、但非跟手语义的过渡**照报**（证明豁免是规则而非全局放水）。
  //    注意建议为 null：`linear` ≠ --tr-fast 的 `ease`，给建议会误导
  //    （报告说建议、--fix 却不改）——建议与 --fix 同走「时长+缓动双匹配」口径。
  const nonRealtime = findStyleAttrViolations(
    ".x { transition: background 0.12s linear; }",
    1,
    tokens,
  );
  assert.equal(nonRealtime.length, 1, "非跟手属性 → 仍应报");
  assert.equal(nonRealtime[0]?.suggestion, null, "缓动不匹配 → 不给安全建议（但报告保留）");
  // ④ 跟手属性但缓动被改成 ease（即「被顺手修坏」的形态）→ 必须报，守住退化
  assert.ok(
    findStyleAttrViolations(".cs-fill { transition: width 0.12s ease; }", 1, tokens).length > 0,
    "跟手属性套了令牌时长/缓动 → 应报（防跟手被静默改成缓动）",
  );
  console.log("  ✓ 实时反馈过渡: 跟手豁免（属性+linear+<0.1s 三条），非跟手仍报");
}

// ── 18. 预筛关键词与判定种类同步锁（「静默失明」回归）──────
{
  // 踩坑记录（2026-09 实测）：`check-design-tokens.ts` 逐行扫描前有个**快速预筛**——
  // 行内不含任一关键词即 skip，省掉 95%+ 的正则开销。该关键词表是 box-shadow /
  // transition 加入判定层**之前**写的，此后从未补，后果是**整类静默失明**：
  //   `transition: opacity .4s` / `transition: top 0.15s ease` / 单独的 `box-shadow:`
  // 不含任何旧关键词，永远到不了判定函数（实测 `variables.css` 的
  // `.skip-link { transition: top 0.15s ease }` 与 components-styles 的折叠箭头
  // `transform 0.25s ease` 均因此漏报）。
  // 极难察觉的原因：能命中的那些恰好含 color/background（如 `.cr-avatar-ring` 同行有
  // `border-radius:50%`），于是报告看起来「正常工作」。
  //
  // 本锁建立双向对应：判定层能报的每个属性，预筛源码必须列它；且探针只含该词
  // （否则探针靠别的关键词蒙混过关，锁失效）。
  const src = fs.readFileSync(path.join(ROOT, "scripts/check-design-tokens.ts"), "utf8");
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));

  const PROBES: Array<[kw: string, probe: string]> = [
    ["font-size", ".x { font-size: 13px; }"],
    ["border-radius", ".x { border-radius: 6px; }"],
    ["transition", ".x { transition: transform 0.2s; }"],
    ["box-shadow", ".x { box-shadow: 0 8px 32px rgba(0,0,0,.25); }"],
  ];
  const OTHER_KWS = ["style=", "color", "background"];

  for (const [kw, probe] of PROBES) {
    // ① 判定层确实能报这类（否则探针无意义）
    assert.ok(findStyleAttrViolations(probe, 1, tokens).length > 0, `判定层应能报该探针：${probe}`);
    // ② 探针不含其它预筛关键词——确保它只能靠 kw 通过预筛
    for (const other of OTHER_KWS) {
      if (other === kw) continue;
      assert.ok(
        !probe.includes(other),
        `探针 ${probe} 不应含其它预筛关键词 "${other}"（否则本锁被蒙混）`,
      );
    }
    // ③ 预筛源码必须列该关键词
    assert.ok(
      src.includes(`line.includes("${kw}")`),
      `预筛关键词表缺 "${kw}" —— 该类别在预筛即被跳过（静默失明）`,
    );
  }
  console.log("  ✓ 预筛同步锁: 判定层的每个属性类都在预筛关键词表中");
}

// ─── 行级判定（ADR-256）：只对自己动过的行负责 ─────────────────────
// 为何这组是本闸的**红线**：基线文件级判定（键 `file:line:kind`）在 116 提交窗实测中，added 330 条里
// 322 条（97.6%）是行位移幻影、真新增候选仅 8（复现：node scripts/token-shift-audit.ts --window 120）。
// 行级判定（新增行 ∩ 违规行）把两侧同时修掉——下面四组断言就是这条结论的机器化形式。
{
  const tokens = parseTokenMap(fs.readFileSync(VARIABLES_CSS, "utf8"));

  // ① 反幻影红线：纯插入 1 行 → 下文 20 条存量债整体下移，行级必须 0 条
  //    （旧规则会把下移后的行号当成「新增」→ 报 20 条）
  const shiftDiff = "@@ -7,0 +8,1 @@\n+// pure-insert-probe\n";
  const added = addedLinesFromDiff(shiftDiff);
  assert.deepEqual([...added], [8], "纯插入：只有新行算新增行");
  const shifted = [
    ...Array.from({ length: 7 }, (_, i) => `const pad${i} = ${i};`), // 1..7
    "// pure-insert-probe", // 8 ← 新增行（本身无违规）
    ...Array.from({ length: 20 }, () => "  .x { font-size: 13px; }"), // 9..28 ← 存量债
  ].join("\n");
  assert.equal(
    findViolationsOnLines(shifted, added, tokens).length,
    0,
    "位移不是新增：下文 20 条存量债整体下移，行级判定必须 0 条（旧基线规则报 20 条）",
  );
  const allLines = Array.from({ length: shifted.split("\n").length }, (_, i) => i + 1);
  assert.ok(
    findViolationsOnLines(shifted, allLines, tokens).length >= 20,
    "对照组：全文件扫描确实能看到这 20 条（证明 0 条是「只判新增行」而非「判不出来」）",
  );

  // ② 重写 hunk 内的行同样算「动过」：行级不是放水，而是精确
  const rewriteDiff =
    "@@ -10,3 +10,3 @@\n-old1\n-old2\n-old3\n+new1\n+  .y { border-radius: 6px; }\n+new3\n";
  const rw = addedLinesFromDiff(rewriteDiff);
  const rwText = [
    ...Array.from({ length: 9 }, () => "ctx"),
    "new1",
    "  .y { border-radius: 6px; }",
    "new3",
  ].join("\n");
  const rwHits = findViolationsOnLines(rwText, rw, tokens);
  assert.equal(rwHits.length, 1, "重写 hunk 内新写的硬编码圆角应命中（删3加3 → 新行 10/11/12）");
  assert.equal(rwHits[0]!.line, 11, "命中行号必须回填成新文件行号（可直接对 diff 核对）");

  // ③ 键碰撞盲区：同行号同 kind 被替换（旧键设计判「不是新增」）→ 行级必命中
  //    ⚠️ 用色刻意避开「纯通道 hex」（#ff0000 等）：isNeutralColor 的量词实现是
  //    `every(x => x === 0 || x === 255)`（= 每个通道是 0 或 255），而非注释所写的
  //    「三通道全 0 或全 255」——于是 #ff0000/#00ff00/#0000ff/#ffff00 全被当**中性色豁免**
  //    （既有缺陷，另案报告，不在本次改动内）。此处用 #123456（通道非 0/255，正常判定）。
  const sameLineDiff = "@@ -5,1 +5,1 @@\n-old\n+  .z { color: #123456; }\n";
  const sl = addedLinesFromDiff(sameLineDiff);
  const hit3 = findViolationsOnLines(
    [...Array.from({ length: 4 }, () => "ctx"), "  .z { color: #123456; }"].join("\n"),
    sl,
    tokens,
  );
  assert.ok(
    hit3.length > 0,
    "同行替换同类违规 = 新债，行级判定不得因「键相同」漏判（旧规则的机制性盲区）",
  );

  // ④ 越界 / 重复 / 非整数行号：安全忽略，不抛错、不重复计数
  assert.deepEqual(
    findViolationsOnLines("a\nb\n", [1, 1, 2, 0, -3, 99, 1.5], tokens),
    [],
    "越界 / 重复 / 非整数行号一律安全忽略（不得抛错，也不得重复计数）",
  );
  console.log("  ✓ 行级判定锁: 反幻影 / 重写命中 / 键碰撞 / 行号边界");
}

console.log("\n✅ test_design_tokens.ts 全部通过");
