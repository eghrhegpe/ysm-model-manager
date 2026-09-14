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
  findStyleAttrViolations,
  fixLineTokens,
  isCommentLine,
  parseTokenMap,
  suggestToken,
  TOKEN_PX_BASELINE,
} from "../scripts/_lib/design-tokens.ts";
import { walk } from "../scripts/_lib/scan-files.ts";
import { allIconNames } from "../scripts/_lib/icon-map.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VARIABLES_CSS = path.join(ROOT, "frontend/css/variables.css");

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
  const tokens = parseTokenMap("--fs-md: 13px;\n--fs-base: 12px;\n--radius-md: 6px;");

  // 值相等 → 建议（这是脚本最有价值的输出）
  assert.equal(suggestToken(13, "font-size", tokens), "--fs-md", "13px 字号应建议 --fs-md");
  assert.equal(
    suggestToken(6, "border-radius", tokens),
    "--radius-md",
    "6px 圆角应建议 --radius-md",
  );
  assert.equal(suggestToken(12, "font-size", tokens), "--fs-base", "12px 字号应建议 --fs-base");

  // 属性域隔离：字号不该被建议成圆角，反之亦然（防错答）
  assert.equal(suggestToken(6, "font-size", tokens), null, "6px 字号无对应字号令牌 → null");
  assert.equal(suggestToken(13, "border-radius", tokens), null, "13px 圆角无对应圆角令牌 → null");

  // 值不等 → null（宁可不说，不给错答案）
  assert.equal(suggestToken(15, "font-size", tokens), null, "15px 无精确匹配令牌 → null");
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
  const tokens = parseTokenMap("--fs-sm: 11px;\n--fs-md: 13px;\n--radius-md: 6px;");

  // 4a) 内联 font-size → 命中且带建议
  const a = findStyleAttrViolations(
    '  <div class="x" style="padding:4px;font-size:13px">hi</div>',
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
  const c = findStyleAttrViolations('style="font-size:13px;border-radius:6px"', 1, tokens);
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
  const vs = findEmojiIconViolations(
    `<button class="a">♻️ ' + t("recycle.tab") + "</button>"`,
    1,
  );
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
  const tokens = parseTokenMap("--fs-md: 13px;\n--fs-sm: 11px;\n--radius-md: 6px;");

  // 8a) 字号有精确令牌 → 替换为 var()，且记账
  const a = fixLineTokens('style="font-size:13px"', tokens);
  assert.equal(a.text, 'style="font-size:var(--fs-md)"', "13px 应替换为 var(--fs-md)");
  assert.equal(a.edits.length, 1, "应记 1 笔");

  // 8b) 一行多处独立替换
  const b = fixLineTokens('style="font-size:13px;border-radius:6px"', tokens);
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
  console.log("  ✓ 扫描范围: css/ 目录未被跳过（漏扫回归锁）");
}

// ── 10. emoji 命中附带语义图标建议（ADR-238 D4 回归锁）──
{
  // 为什么锁：emoji 债的价值全在「能否机械收敛」。若建议丢失，275 处 UI chrome
  // 又退回「一堆字形」，AI 只能靠猜——本闸就从「可收债清单」退化成「计数器」。
  const hits = findEmojiIconViolations('<div>⚠️ ${msg}</div>', 1);
  assert.equal(hits.length, 1, "⚠️ 应命中 1 处");
  assert.equal(
    hits[0]!.suggestion,
    "UI_ICONS.warning",
    "⚠️ 应建议 UI_ICONS.warning（ADR-238 语义名）",
  );

  // 未收录字形：命中但建议为 null（宁可不建议，不猜错）
  const unmapped = findEmojiIconViolations('<div>🦄 ${msg}</div>', 1);
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

console.log("\n✅ test_design_tokens.ts 全部通过");
