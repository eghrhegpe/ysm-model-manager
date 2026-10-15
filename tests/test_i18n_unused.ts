// ===== i18n 未使用键判定层契约测试 =====
// 锁 `_lib/i18n-unused.ts` 的判定语义 + `check-i18n-unused.ts` 的接线。
// 最值钱的一组是「嵌套引号」回归锁——见块 2 的踩坑记录（词法分析用正则 tokenize 的陷阱）。
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDynamicCoverage,
  classifyKeyUsage,
  constructedKeyPrefixes,
  countDynamicKeySites,
  extractDottedTokens,
  groupByPrefix,
  isKeyDynamicallyCovered,
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

// ── 9. 构造式站点前缀覆盖（N6 动态假阳性豁免）──────────────
// 背景：`t(\`preview.capStage.${stage}\`)` 这类构造式查表让真实在用的键
//（preview.capStage.save / .load）不以字面量出现，静态判定误判 dead（i18n 死键
// 13→15 的 2 增量即此，2026-10-11 探明 N6）。constructedKeyPrefixes 提取构造式
// 站点的静态前缀，isKeyDynamicallyCovered 判定键是否落在前缀下——保守豁免，
// 只把「误判死」的活键拉回，不新增死键误判。
{
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 被测对象就是构造式模板串，字面量写法刻意
  const tpl = "stage: t(`preview.capStage.${stage}`)";
  const prefixes = constructedKeyPrefixes(tpl);
  assert.ok(prefixes.has("preview.capStage."), "模板串构造式应抽出静态前缀（含尾点）");
  assert.ok(isKeyDynamicallyCovered("preview.capStage.save", prefixes), "前缀下键应判动态覆盖");
  assert.ok(isKeyDynamicallyCovered("preview.capStage.load", prefixes), "同前缀另一键同样覆盖");
  assert.ok(!isKeyDynamicallyCovered("preview.close3d", prefixes), "前缀外键不得豁免");
  assert.ok(!isKeyDynamicallyCovered("preview.capStage", prefixes), "前缀本体（非其子键）不得豁免");

  // 字符串拼接形态：t("import." + x) → 前缀 import.（引号内须以点结尾）
  const concatPrefixes = constructedKeyPrefixes('x = t("import." + k);');
  assert.ok(concatPrefixes.has("import."), "字符串拼接形态应抽出引号内前缀");
  // 无尾点 = 非键前缀，不抽（t("import") 是完整字面量键，不是构造式）
  assert.equal(constructedKeyPrefixes('t("import")').size, 0, "无尾点不应抽出前缀");

  // 辅助函数构造形态（2026-10-24 pre-push 实测）：键模板不落在 t() 调用点内，而是
  // helper 组装后传入翻译函数（rtypeLabelKeyOf: return `rtype.label.${camelToKey(rtype)}`
  // → rtypeLabelOf 内 tOf(key)）。同属构造式，静态前缀应同样抽出——否则 rtype.label.*
  // 全族被误判 dead（18 键增量即此）。
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 被测对象就是构造式模板串，字面量写法刻意
  const helperPrefixes = constructedKeyPrefixes("return `rtype.label.${camelToKey(rtype)}`;");
  assert.ok(helperPrefixes.has("rtype.label."), "辅助函数内模板串构造应抽出前缀（helper 返回形态）");
  assert.ok(isKeyDynamicallyCovered("rtype.label.sceneModel", helperPrefixes), "前缀下活键应豁免");
  assert.ok(!isKeyDynamicallyCovered("sync.noPacks", helperPrefixes), "前缀外键不得豁免");
  console.log("  ✓ helper 返回模板串形态: 前缀覆盖豁免");

  // 单段头（`preview.${x}`）不得作为独立构造前缀——测试/脚本侧大量单段模板多为非键构造，
  // 宽豁免会把基线真死键误捞成 test-only（2026-10-24 实证：基线 5 键曾因此被误捞）。
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 被测对象就是构造式模板串，字面量写法刻意
  assert.equal(constructedKeyPrefixes("`preview.${x}`").size, 0, "独立模板单段头不得抽出前缀");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 同上
  assert.ok(
    constructedKeyPrefixes("`preview.metric.${m}`").has("preview.metric."),
    "独立模板两段头应抽出前缀",
  );
  console.log("  ✓ 独立模板段数下限: 单段不豁免、两段起豁免");
}

// ── 10. 动态覆盖营救（applyDynamicCoverage）────────────────
{
  // rtype.label.ysm 字面量只出现在测试里（→ test-only），但生产经 rtypeLabelKeyOf
  // 动态构造消费——生产前缀覆盖应把它拉回 used，而非只救 dead 桶。
  const prodPrefixes = constructedKeyPrefixes("return `rtype.label.${camelToKey(r)}`;");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 被测对象就是构造式模板串
  const rows = classifyKeyUsage(
    ["rtype.label.ysm", "preview.close3d"],
    new Set<string>(),
    new Set<string>(["rtype.label.ysm"]),
  );
  const rescued = applyDynamicCoverage(rows, prodPrefixes, new Set<string>());
  assert.equal(rescued[0]?.usage, "used", "test-only 键被生产构造前缀覆盖 → used");
  assert.equal(rescued[1]?.usage, "dead", "未覆盖键保持 dead");
  // 全仓侧覆盖只救 dead → test-only（原语义保持）
  const allPrefixes = new Set<string>(["tree.family."]);
  const deadRow = classifyKeyUsage(["tree.family.leaf"], new Set<string>(), new Set<string>());
  assert.equal(
    applyDynamicCoverage(deadRow, new Set<string>(), allPrefixes)[0]?.usage,
    "test-only",
    "仅全仓前缀覆盖 → test-only（保守降档）",
  );
  console.log("  ✓ applyDynamicCoverage: 生产覆盖→used / 全仓覆盖→test-only");
}

console.log("\n✅ test_i18n_unused.ts 全部通过");
