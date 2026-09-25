#!/usr/bin/env node
/**
 * 契约测试：css-layer-check.ts 的 TS 插值展开逻辑（2026-09-14 锐评修复的回归锁）。
 *
 * 背景：shadow CSS 以 TS 模板串承载，跨 shadow 共享的 keyframes 收敛为常量后经
 * `${FADE_SLIDE_LEFT}` 注入（sidebar-css.ts 末尾、content-layout.ts:39）。css-layer-check
 * 按源文件文本正则扫 @keyframes，看不见插值 → 曾把「运行时确实生效」的定义判成 4 条
 * 假阳性 ERROR（gate-config hard 项恒红 → CI 无法接线）。修复 = 聚合前展开 import 的
 * 含 @keyframes 常量。本测试锁死展开语义，防止回归成假阳性/误伤两种方向。
 *
 * 锁定的语义：
 *   1. @/ 别名 import + ${IDENT} → 展开为 @keyframes 定义，且不残留占位符
 *   2. 不存在的常量保持原样（不因 tooling 变化制造新假阳性）
 *   3b. 共享样式常量（非 @keyframes，如 dropdownBaseCSS）同样展开——否则其定义对检查 3 静默不可见
 *   8. 检查 6 跨层存在性：在「所有 shadow 域 CSS ∪ document 层 CSS」都无定义 → 报出；已定义 / 已豁免 → 不报
 *   9. 检查 7 死 CSS 反向闸：选择器位提取（不误收 TS 属性访问/注释）、掩码保真（字符串引用不被掩）、
 *      无消费者才报、前缀拼接族**不**自动豁免（只给线索，豁免走显式登记）
 *   4. resolveImportAbs：相对路径解析 / 裸包导入排除（裸包不参与 shadow CSS 组装）
 *   5. readConstLiteral 可读跨行字符串字面量
 *
 * 依赖：node:assert / node:fs / node:path / node:url / scripts/_lib/css-layer-utils.ts
 *（纯函数抽出模块，零顶层副作用——css-layer-check.ts 主体有 process.exit，直接 import 会被杀掉）。
 * 用法：node tests/test_css_layer_check.ts（或经 _lib/contract-tests.ts 统一入口）。
 * 退出码：0 全绿；非 0 断言失败（node:assert 抛错）。
 */
import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dropdownBaseCSS, noAnimationsCSS } from "../frontend/src/utils/dom/css.ts";
import {
  expandStyleInterpolations,
  extractSelectorClasses,
  findDeadCssClasses,
  findStrayCommentClose,
  findUndefinedAnywhereClasses,
  hasMotionDeclaration,
  hasNoAnimationsBridge,
  maskSelectorClasses,
  readConstLiteral,
  resolveImportAbs,
} from "../scripts/_lib/css-layer-utils.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIAG_ABS = path.join(ROOT, "frontend/src/views/app-content/css/content-diag.ts");
const FSL = "${" + "FADE_SLIDE_LEFT" + "}";

// ── 1. @/ 别名 + ${FADE_SLIDE_LEFT} → 展开为 @keyframes ──
{
  const css = `import { FADE_SLIDE_LEFT } from "@/views/css/keyframes.ts";\n.log-row { animation: fadeSlideLeft .25s ease both; }\n${FSL}`;
  const out = expandStyleInterpolations(css, DIAG_ABS);
  assert.ok(out.includes("@keyframes fadeSlideLeft"), "插值应展开为 @keyframes 定义");
  assert.ok(!out.includes(FSL), "展开后不应残留 FSL 占位符");
  console.log("  ✓ @/ 别名 + FSL 占位符 展开为 @keyframes");
}

// ── 2. 不存在的常量保持原样（无假阳性）──
{
  const token = "${" + "FOO_NON_EXISTENT" + "}";
  const css = `import { FOO_NON_EXISTENT } from "@/views/css/keyframes.ts";\n${token}`;
  const out = expandStyleInterpolations(css, DIAG_ABS);
  assert.ok(out.includes(token), "解析不出的常量应保持原样");
  console.log("  ✓ 不存在的常量不展开");
}

// ── 3. 无 ${ 原样返回（性能守卫）──
{
  const css = ".a { color: red; }";
  const out = expandStyleInterpolations(css, path.join(ROOT, "x.ts"));
  assert.equal(out, css, "无插值应原样返回同一文本");
  console.log("  ✓ 无 ${ 原样返回");
}

// ── 3b. 共享样式常量（非 @keyframes）同样展开：检查 3 判定基线回归锁 ──
// 旧实现只展开含 @keyframes 的常量 → `${dropdownBaseCSS}` / `${btnBaseCSS}` 注入的真
// 生效定义对检查 3 不可见，把 .dd-wrap / .dd-menu 判成「未定义」（2026-09 实测假阳性）。
{
  const token = "${" + "dropdownBaseCSS" + "}";
  const css = `import { dropdownBaseCSS } from "@/utils/dom/css.ts";\n${token}`;
  const out = expandStyleInterpolations(css, DIAG_ABS);
  assert.ok(out.includes(".dd-wrap"), "共享样式常量应展开（否则其定义对检查 3 静默不可见）");
  assert.ok(!out.includes(token), "展开后不应残留占位符");
  assert.ok(dropdownBaseCSS.includes(".dd-wrap"), "锚点常量本体应含 .dd-wrap（防本用例自欺）");
  console.log("  ✓ 非 @keyframes 共享样式常量同样展开");
}

// ── 4. resolveImportAbs：相对路径 / 裸包排除 ──
{
  const fromAbs = path.join(ROOT, "frontend/src/views/app-sidebar/sidebar-css.ts");
  assert.equal(
    resolveImportAbs("./css.ts", fromAbs),
    path.join(ROOT, "frontend/src/views/app-sidebar/css.ts"),
    "相对路径应解析到同目录",
  );
  assert.equal(resolveImportAbs("vue", fromAbs), null, "裸包导入不参与展开");
  console.log("  ✓ resolveImportAbs：相对路径解析 / 裸包排除");
}

// ── 5. readConstLiteral 跨行字面量 ──
{
  const src = 'export const X =\n  "@keyframes a { }";\n';
  assert.equal(readConstLiteral(src, "X"), "@keyframes a { }", "跨行字符串字面量应可读");
  console.log("  ✓ readConstLiteral 跨行字面量");
}

// ── 6. hasMotionDeclaration / hasNoAnimationsBridge（检查 4 判定语义）──
// 6a) 动效识别：animation / transition 三兄弟属性位命中
assert.equal(hasMotionDeclaration(".a { animation: fadeSlideUp .2s }"), true, "animation 应命中");
assert.equal(hasMotionDeclaration(".a{transition:var(--tr-fast)}"), true, "transition 应命中");
assert.equal(
  hasMotionDeclaration(".a { transition-duration: .2s }"),
  true,
  "transition-duration 应命中（漏判会让域跳过桥检查）",
);
assert.equal(hasMotionDeclaration(".a { color: red }"), false, "无动效不应命中");

// 6b) **自定义属性不得误判**：`--btn-transition:` 是令牌声明，不是动效属性
//     （历史噪声源：前缀字符类把前面的 `-` 收下即误报整个域「有动效」）
assert.equal(
  hasMotionDeclaration("--btn-transition: background-color .15s;"),
  false,
  "自定义属性 --btn-transition 不得判为动效",
);

// 6c) 桥识别：共享片段**实体** / 手写通配 → 放行
//     用真实片段而非手打样例断言：片段若被改回逐类登记形态，本用例立刻报红
//     （这是「通配桥」这条不变量唯一的机器锚点）。
assert.equal(
  hasNoAnimationsBridge(noAnimationsCSS),
  true,
  "共享片段 noAnimationsCSS 实体应判为有桥",
);
assert.equal(
  hasNoAnimationsBridge(":host-context(.no-animations) * { animation: none }"),
  true,
  "手写等价通配应放行",
);

// 6d) **逐类登记判「无桥」**（闸门存在的理由：逼出通配形态，杜绝新增动画漏登记）
assert.equal(
  hasNoAnimationsBridge(":host-context(.no-animations) .page { animation: none }"),
  false,
  "逐类登记不算有桥（漂移源，正是要拦的形态）",
);
console.log("  ✓ 检查 4 判定：动效识别（含自定义属性豁免）+ 桥通配/逐类三态");

// 7) 注释完整性：注释体内误写星号+斜杠（块注释闭合符）→ 检出；正常注释 / `//` 行注释 → 不误报
//    真实病因（2026）：content-layout.ts 注释写成“fadeSlide*/breathe-subtle”，注释提前闭合，
//    解析器吞掉紧随的 @keyframes fadeSlideUp → app-content 全 shadow 入场动画静默失效。
assert.ok(
  findStrayCommentClose("/* 引用的 fadeSlide*/breathe-subtle 必须重定义 */\n@keyframes a {}") >= 0,
  "块注释体内误写闭合符应被检出（会吞掉紧随的 @keyframes）",
);
assert.equal(
  findStrayCommentClose("/* 引用的 fadeSlide* 与 breathe-subtle 必须重定义 */\n@keyframes a {}"),
  -1,
  "正常块注释不得误报",
);
assert.equal(
  findStrayCommentClose("// 收口 .dlg-*/.afv-*/.mc-pick-* 于 components.css\nexport const x = 1;"),
  -1,
  "`//` 行注释内的闭合符组合不得误报（不在 CSS 上下文）",
);
// 字符串字面量感知：字面量正文里的 `*` 紧接 `/`（CSS 选择器、glob 等合法内容）不得误报；
// 注释体内破注释仍须检出（字面量与注释体不混淆）
assert.equal(
  findStrayCommentClose('const sel = ".dlg-*/.afv-*";\nexport const x = 1;'),
  -1,
  "字符串字面量正文的 `*/` 不得误报（检查 5 假阳性回归锁）",
);
assert.ok(
  findStrayCommentClose('/* fadeSlide*/body */\nexport const y = "a*/b";') >= 0,
  "注释体内破注释仍须检出（字符串感知不掩盖真缺陷）",
);
console.log("  ✓ 检查 5 判定：注释完整性（破注释检出 + 正常注释/`//`/字符串字面量不误报）");

// 8) 检查 6：跨层存在性——「用到、但全仓任何 CSS 层都没定义」的类
//    病因（2026-09）：检查 3 的判定域是「本域命名空间」，故命名空间在本域不存在的类（错名 /
//    从未实现）结构上落在它的盲区里（实测残余 42 类）。.lt-* 全族即真缺陷——色块空 span 没有
//    尺寸、恒不可见；补本检查后才现形（现已在 app-preview/css.ts 补真规则）。
const crossUsed = new Map<string, Map<string, string>>([
  [
    "app-preview",
    new Map([
      ["lt-color-swatch", "litematic-meta.ts"],
      ["md-row", "detail.ts"],
      ["stage-item", "detail-3d.ts"],
    ]),
  ],
]);
const crossDefined = new Set(["md-row"]); // 定义在本域 CSS 层
const crossExempt = new Set(["stage-item"]); // 合法无规则（全内联承载）
assert.deepEqual(
  findUndefinedAnywhereClasses(crossUsed, crossDefined, crossExempt).map(
    (f) => `${f.domain}:${f.cls}`,
  ),
  ["app-preview:lt-color-swatch"],
  "任何 CSS 层都无定义 → 报出；已定义 / 已豁免 → 不报",
);
assert.deepEqual(
  findUndefinedAnywhereClasses(
    crossUsed,
    crossDefined,
    new Set([...crossExempt, "lt-color-swatch"]),
  ),
  [],
  "豁免集命中即静默（合法无规则类的唯一出口）",
);
console.log("  ✓ 检查 6 判定：跨层存在性（任何 CSS 层都无定义 → 报；已定义/已豁免 → 不报）");

// 9) 检查 7：死 CSS 反向闸——「定义了、但全仓无任何消费者」
//    病因（2026-10 锐评）：检查 3/6 只管「用了没定义」一个方向，反方向无闸 → 化石层只增不减
//    （layout.css 整表 400 行零消费者、mc-pick-* 改用 modalPicker 后整族留在原地）。
//    判定基线建立在「选择器位提取 + 消费者语料」两件事上，二者都极易写错（写错的方向不同）：
//      ① 提取过宽 → TS 属性访问 `this.root` 被当成类 → 假 ERROR（用户不再信任闸门）
//      ② 掩码过宽 → 定义源里的 `class="foo"` 也被掩掉 → 真活类被判死 → 假 ERROR
//    故两条都在此钉死。
{
  // ① 提取：只认选择器位（`.` 前是空白/逗号/行首/选择器组合符）
  const src = [
    "export const XCSS = `",
    ".card { color: red }",
    ".card > .body, .body.foot { padding: 0 }",
    "`;",
    "this.root.style.color = 'red';",
    "deps.styleSheets.filter((s) => s != null);",
    "const sel = document.querySelector('.quoted-only');",
    "/* 注释里的 .ghost-not-a-class 不算定义 */",
  ].join("\n");
  const extracted = extractSelectorClasses(src);
  assert.ok(extracted.has("card"), "选择器位 .card 应被收下");
  assert.ok(extracted.has("body"), "逗号后的选择器 .body 应被收下");
  assert.ok(!extracted.has("root"), "TS 属性访问 this.root 不得被当成类（假 ERROR 防线）");
  assert.ok(!extracted.has("filter"), "TS 属性访问 .filter 不得被当成类（假 ERROR 防线）");
  assert.ok(!extracted.has("ghost-not-a-class"), "注释里的类名不得算定义（注释洗白防线）");
  assert.ok(
    !extracted.has("quoted-only"),
    "引号内的选择器是**消费者**（querySelector）不是定义，不得混进定义集",
  );

  // ② 掩码：定义源的选择器位掩掉，字符串引用（class="foo" / querySelector(".foo")）保留
  const masked = maskSelectorClasses(".card { color: red }\nconst h = 'class=\"card\"';");
  assert.ok(!/\.card\s*\{/.test(masked), "选择器位 .card 应被掩掉（定义不能自我证明存活）");
  assert.ok(masked.includes('class="card"'), '字符串里的 class="card" 必须保留（真消费者证据）');

  // ③ 判定：无消费者 → 死；有消费者 / 已豁免 → 静默
  const defs = [{ file: "a.css", classes: new Set(["dead-one", "alive-in-template", "exempted"]) }];
  const corpus = '<div class="alive-in-template"></div>';
  assert.deepEqual(
    findDeadCssClasses(defs, corpus, new Set(["exempted"])).map((f) => f.cls),
    ["dead-one"],
    "定义无消费者 → 报死；模板消费 / 显式豁免 → 静默",
  );
  assert.deepEqual(
    findDeadCssClasses(defs, corpus, new Set(["exempted", "dead-one"])),
    [],
    "豁免集命中即静默（动态拼接族的唯一出口）",
  );

  // ④ 动态拼接线索只作提示，不自动豁免（前缀同族不同名会误伤，实测 sidebar-${verb}-selected）
  // 串接拼出模板串字面量：避免本文件自身被 `noTemplateCurlyInString` 判违规（仓内既有惯例）
  const dynCorpus = "el.classList.add(`ysw-ovl-" + "${" + "kind}`);";
  const dyn = findDeadCssClasses(
    [{ file: "a.ts", classes: new Set(["ysw-ovl-shotitem"]) }],
    dynCorpus,
    new Set(),
  );
  assert.equal(dyn.length, 1, "前缀拼接族**不得**自动豁免（须显式登记理由）");
  assert.equal(dyn[0]?.dynHint, "ysw-ovl-", "应给出拼接前缀线索供人工核实");
  assert.ok(
    !/(?<![\w-])ysw-ovl-shotitem(?![\w-])/.test("ysw-ovl-shotitem-x"),
    "token 边界：不得让 ysw-ovl-shotitem-x 冒充 ysw-ovl-shotitem 的消费者",
  );
  console.log(
    "  ✓ 检查 7 判定：死 CSS 反向闸（选择器位提取 / 掩码保真 / 无消费者才报 / 豁免静默）",
  );
}

console.log("\nOK: css-layer-check 契约（插值展开 + 检查 5/6/7 判定，回归锁 11 条）");
