#!/usr/bin/env node
/**
 * test_check_doc_markup.ts — 裸标签检查契约测试。
 *
 * 锁 `scripts/check-doc-markup.ts` 的判定规则 `scanText` 与代码区间识别 `inlineCodeRanges`。
 *
 * 期望值来源（非手抄算法）：2026-09-19 用 VitePress 的真实 markdown 渲染器
 * `createMarkdownRenderer(docs/)`（内含其配置好的 markdown-it）逐例实测每种尖括号
 * 形态「被放行为原始 HTML」还是「被转义」，再用真实 `vitepress build` 探针裁决——
 * 探针里的裸标签令构建 exit 1 且报错落在该文件，与 scanText 的判定同域同源。
 *
 * 运行：node tests/test_check_doc_markup.ts
 * 用 assert 实现（不计走测试框架）；失败 exit 1。
 */
import assert from "node:assert/strict";
import { inlineCodeRanges, scanText } from "../scripts/check-doc-markup.ts";

// ─── 1) 危险形态：markdown-it 放行为原始 HTML、非 void、无配对 ──────
// 每条都对应 oracle 实测「放行」+ 真实构建探针裁决（会中断 VitePress 构建）
const DANGEROUS = [
  "文件名 rust_backend_<os>.go 漏了反引号", // 2026-09-18 事故原文
  "裸标签 <os> 单独出现",
  "a <b> c 合法标签且无配对",
  "未闭合 <strong>粗体",
  "<my-component> 带连字符的自定义元素",
];
for (const src of DANGEROUS) {
  const hits = scanText("t.md", src);
  assert.equal(hits.length, 1, `应命中 1 处: ${src} → ${JSON.stringify(hits)}`);
  const first = hits[0];
  assert.ok(first, `应存在命中: ${src}`);
  assert.equal(first.line, 1);
  assert.equal(first.file, "t.md");
}

// ─── 2) 安全形态：oracle 实测「转义」，markdown-it 会把 < 变成 &lt; ──────
const ESCAPED = [
  "Map<url, Texture> 会被转义",
  "Record<CorePanelId, string> 会被转义",
  "<ISO时间> 与 <子模块> 非 ASCII 标签名",
  '- 提交：<commit hash 或 "未提交/阻塞"> 属性非法',
  "<tag/data-testid) 形态不完整",
  "a < b 且 c > d 尖括号后是空格",
];
for (const src of ESCAPED) {
  assert.equal(scanText("t.md", src).length, 0, `不应命中: ${src}`);
}

// ─── 3) 无害形态：放行但 void / 自闭合 / 有配对 ──────
const HARMLESS = [
  '<br> 与 <hr> 与 <img src="x"> 是 void 标签',
  "<MyComponent /> 自闭合",
  "<div>配对了</div>",
];
for (const src of HARMLESS) {
  assert.equal(scanText("t.md", src).length, 0, `不应命中: ${src}`);
}

// ─── 4) 代码上下文豁免：行内代码 / 围栏 / frontmatter ──────
assert.equal(scanText("t.md", "行内代码 `<os>` 已转义").length, 0, "行内代码内的尖括号应豁免");
assert.equal(scanText("t.md", "`` 双反引号 `<os>` `` 也应豁免").length, 0, "多反引号代码跨应豁免");
assert.equal(scanText("t.md", "```\n<os>\n```\n").length, 0, "围栏代码块内的尖括号应豁免");
assert.equal(scanText("t.md", "---\nname: <os>\n---\n\n正文无标签。\n").length, 0, "frontmatter 应豁免");
assert.equal(scanText("t.md", "未闭合反引号 `<os> 之后没有闭合，按普通文本处理\n").length, 1, "未闭合反引号不算代码");

// ─── 5) 回归：行内代码里的 `</os>` 不得充当配对（曾把真命中救成假阴性）──────
// 背景：闭合标签收集若不过代码感知扫描，代码里的 `</os>` 会被当成配对，
// 使正文里的裸 <os> 漏报——探针实测踩过，故钉死在此。
const falseNegative = "危险 <os> 出现。\n\n代码里的 `</os>` 不算配对。\n";
assert.equal(
  scanText("t.md", falseNegative).length,
  1,
  "行内代码内的 </os> 不得充当配对，否则漏报",
);
// 反面：正文里的 </os> 配对成立 → 无命中
assert.equal(
  scanText("t.md", "危险 <os> 出现。\n\n正文 </os> 配对。\n").length,
  0,
  "正文中的配对闭合应成立",
);

// ─── 6) 命中元数据：行号 / 列号 / 标签名 ──────
{
  const hits = scanText("a/b.md", "第一行安全\n第二行 rust_backend_<os>.go 危险\n");
  assert.equal(hits.length, 1);
  const hit = hits[0];
  assert.ok(hit, "应存在命中");
  assert.equal(hit.line, 2);
  assert.equal(hit.tag, "os");
  assert.equal(hit.col, "第二行 rust_backend_<os>.go 危险".indexOf("<") + 1);
  assert.ok(hit.reason.includes("</os>"), "reason 应指明缺配对");
}

// ─── 7) inlineCodeRanges：markdown-it code_inline 口径 ──────
assert.deepEqual(inlineCodeRanges("a `x` b"), [[2, 5]], "单反引号");
assert.deepEqual(inlineCodeRanges("a ``x`` b"), [[2, 7]], "双反引号");
assert.deepEqual(inlineCodeRanges("`` `x` ``"), [[0, 9]], "双反引号包裹单反引号");
assert.deepEqual(inlineCodeRanges("a `x b"), [], "未闭合 → 不构成代码");

console.log("✅ test_check_doc_markup.ts 全部通过（7 组契约断言）");
