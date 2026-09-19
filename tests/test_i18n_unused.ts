// ===== i18n 未使用键判定层契约测试 =====
// 锁 `_lib/i18n-unused.ts` 的判定语义 + `check-i18n-unused.ts` 的接线。
// 最值钱的一组是「嵌套引号」回归锁——见块 2 的踩坑记录（词法分析用正则 tokenize 的陷阱）。
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyKeyUsage,
  countDynamicKeySites,
  extractDottedTokens,
  groupByPrefix,
  parseLocaleKeys,
} from "../scripts/_lib/i18n-unused.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── 1. parseLocaleKeys：键解析 ──────────────────────────
{
  const text = [
    "{",
    '  "nav.repository": "仓库",',
    '  "dialog.msg": "含冒号: 的值",',
    '  // "commented.key": "注释里的不算",',
    '  "nested.like.key": "x",',
    "}",
  ].join("\n");
  const keys = parseLocaleKeys(text);
  assert.ok(keys.includes("nav.repository"), "应解析普通键");
  assert.ok(keys.includes("dialog.msg"), "值内含冒号不应干扰键解析");
  assert.ok(keys.includes("nested.like.key"), "多点键应完整解析");
  assert.ok(!keys.includes("commented.key"), "注释里的键不应混入");
  console.log("  ✓ parseLocaleKeys: 键解析 + 值内冒号 + 注释排除");
}

// ── 2. extractDottedTokens：嵌套引号回归锁（核心踩坑）──────
{
  // 踩坑记录（2026-09 实测）：初版按引号交替抽字面量
  //   /"…"|'…'|`…`/g
  // 会**吞掉嵌套引号**——模板串里嵌 t() 是本仓**最主要**的调用形态：
  //     `🗑 ${t("preview.unloadModel")}`
  // 按引号抽会把整段当成**一个**字面量，内层 "preview.unloadModel" 被吃掉 →
  // 真在用的键被判死。实测该 bug 让死键从 174 虚增到 361（抽样 21 个里 12 个实为引用）。
  // 根因：**嵌套结构不能用引号感知的正则 tokenize**。改在原文上抽点分 token，天然免疫。
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 本用例的被测对象**就是**含 ${} 的模板串，字面量写法是刻意的
  const nested = 'unload.textContent = `🗑 ${t("preview.unloadModel")}`;';
  const tokens = extractDottedTokens(nested);
  assert.ok(
    tokens.has("preview.unloadModel"),
    '模板串内嵌 t("key") 的键必须能抽出（嵌套引号回归锁）',
  );

  // 单引号拼接形态（另一主要形态）
  const concat = "'<label>' + t('menu.rename') + '</label>'";
  assert.ok(extractDottedTokens(concat).has("menu.rename"), "单引号拼接内的键应能抽出");

  // 反引号直包形态
  assert.ok(extractDottedTokens("t(`a.b`)").has("a.b"), "反引号直包的键应能抽出");

  // 属性访问形态（labelKey: "x.y"）
  assert.ok(
    extractDottedTokens('labelKey: "preview.roles",').has("preview.roles"),
    "属性值形态应能抽出",
  );

  // 连字符键：lang.zh-CN 类键名含 `-CN` 段，token 字符类若不含 `-` 会截断到
  // lang.zh 把活键误判死（review bb94909f9 P2）
  assert.ok(
    extractDottedTokens('t("lang.zh-CN")').has("lang.zh-CN"),
    "连字符键 lang.zh-CN 应整体抽出（不截断到 lang.zh）",
  );

  // 纯标识符（无点）不应被当成键 token
  assert.ok(!extractDottedTokens("const foo = 1;").has("foo"), "无点标识符不应入集（键必含点）");
  console.log("  ✓ extractDottedTokens: 嵌套引号/单引号/反引号/属性值/连字符键 五种形态均命中");
}

// ── 3. token 精确匹配优于子串（前缀误判回归锁）──────────
{
  // `import.queue` 是 `import.queueFull` 的前缀。子串法会把前者误判为「已用」，
  // 从而**漏报真死键**；token 法按完整点分标识符匹配，不会。
  const corpus = 't("import.queueFull");';
  const prod = extractDottedTokens(corpus);
  const rows = classifyKeyUsage(["import.queue", "import.queueFull"], prod, prod);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.usage]));
  assert.equal(byKey["import.queueFull"], "used", "完整命中应为 used");
  assert.equal(byKey["import.queue"], "dead", "仅作前缀出现的键应判 dead（非子串误判）");
  console.log("  ✓ 前缀误判: import.queue 不因是 import.queueFull 前缀而被判 used");
}

// ── 4. 三级判定 ────────────────────────────────────────
{
  const prod = extractDottedTokens('t("a.used")');
  const all = extractDottedTokens('t("a.used"); // 测试里也用 a.testOnly');
  const rows = classifyKeyUsage(["a.used", "a.testOnly", "a.dead"], prod, all);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.usage]));
  assert.equal(byKey["a.used"], "used", "生产出现 → used");
  assert.equal(byKey["a.testOnly"], "test-only", "仅测试/脚本出现 → test-only");
  assert.equal(byKey["a.dead"], "dead", "全仓不出现 → dead");
  console.log("  ✓ classifyKeyUsage: used / test-only / dead 三级");
}

// ── 5. 动态查表点计数（置信度标注）──────────────────────
{
  // `t(<变量>)` 要被数出来；`t("字面量")` 不算
  const txt = 't(x)\nt("literal.key")\n';
  const dyn = countDynamicKeySites(txt);
  assert.equal(dyn.dynamicT, 1, 't(x) 应计 1；t("literal.key") 不计');
  // 带参变量形态同样计入（t(err, {...}) 也是动态查表）
  assert.equal(countDynamicKeySites("t(err, { n: 1 })").dynamicT, 1, "带参变量也应计入");
  // t( x ) 带空白形态计入（首字符类若含 \s 会与前置 \s* 矛盾而漏计，review bb94909f9 P2）
  assert.equal(countDynamicKeySites("t( x )\n").dynamicT, 1, "t( x ) 带空白应计入");
  // 空参 t() 不计（无效查表，非动态键点）
  assert.equal(countDynamicKeySites("t()\n").dynamicT, 0, "t() 空参不应计入");

  // 键构造式（模板串 / 拼接里以 `前缀.` 起头）是 dead 判定的唯一真风险源，必须数出来
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 被测对象就是键构造式模板串，字面量写法刻意
  const tplConstructed = "t(`import.${x}`)";
  assert.equal(
    countDynamicKeySites(tplConstructed).constructed,
    1,
    "模板串构造键应计入 constructed",
  );
  assert.equal(
    countDynamicKeySites('t("import." + x)').constructed,
    1,
    "字符串拼接构造键应计入 constructed",
  );
  assert.equal(countDynamicKeySites('t("import.plain")').constructed, 0, "字面量键不应计入构造");
  console.log("  ✓ countDynamicKeySites: 动态/构造点计数（置信度标注依据）");
}

// ── 6. 前缀归组 ────────────────────────────────────────
{
  const g = groupByPrefix(["a.b", "a.c", "d.e"]);
  assert.deepEqual(g[0], { prefix: "a", count: 2 }, "应按数量降序且归组正确");
  assert.deepEqual(g[1], { prefix: "d", count: 1 }, "次组正确");
  console.log("  ✓ groupByPrefix: 前缀归组降序");
}

// ── 7. 真实语言包对账（存在性 + 三包对齐）────────────────
{
  // 三个路径显式列出（不用数组下标）——避开 noNonNullAssertion，也让路径一目了然。
  const LOCALE_EN = path.join(ROOT, "frontend/src/locales/en.ts");
  const LOCALE_ZH = path.join(ROOT, "frontend/src/locales/zh-CN.ts");
  const LOCALE_JA = path.join(ROOT, "frontend/src/locales/ja.ts");
  const countOf = (f: string): number => {
    assert.ok(fs.existsSync(f), `语言包应存在：${f}`);
    return parseLocaleKeys(fs.readFileSync(f, "utf8")).length;
  };
  const nEn = countOf(LOCALE_EN);
  const nZh = countOf(LOCALE_ZH);
  const nJa = countOf(LOCALE_JA);
  assert.ok(nEn > 1000, `en 包键数应 >1000（实测 ${nEn}）`);
  assert.equal(nZh, nEn, "zh-CN 与 en 键数应一致（一致性由 locales-consistency 守）");
  assert.equal(nJa, nEn, "ja 与 en 键数应一致");
  console.log(`  ✓ 真实语言包: 三包各 ${nEn} 键且数量对齐`);
}

// ── 8. 语料必须覆盖生产消费方（漏扫回归锁）──────────────
{
  // 与 check-i18n-unused.ts 的实际配置一致的「生产语料」定义；断言其中确有几个
  // 已知在用的键，防「语料配置写错导致全判死」这类静默失效。
  const src = path.join(ROOT, "frontend/src");
  const FILES = [
    "preview-3d/menu/panels/roles-views.ts",
    "views/app-nav/index.ts",
    "core/i18n/t.ts",
  ];
  let corpus = "";
  for (const rel of FILES) {
    const f = path.join(src, rel);
    assert.ok(fs.existsSync(f), `生产语料锚点文件应存在：${rel}（路径变更时同步本测试）`);
    corpus += fs.readFileSync(f, "utf8");
  }
  const tokens = extractDottedTokens(corpus);
  assert.ok(tokens.size > 20, `锚点文件应抽出足量 token（实测 ${tokens.size}）`);
  assert.ok(tokens.has("preview.unloadModel"), "roles-views.ts 的 preview.unloadModel 应被抽出");
  console.log(`  ✓ 生产语料覆盖: 锚点文件抽出 ${tokens.size} token，含已知在用键`);
}

console.log("\n✅ test_i18n_unused.ts 全部通过");
