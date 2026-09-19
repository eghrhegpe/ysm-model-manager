// ===== 图标位扫描：槽内容**只有一个字形** = 用 emoji 当图标（ADR-238 §1.4 收口）=====
//
// 为什么单独有此测试（2026-09）：
//   emoji 闸（`check-design-tokens` 的 findEmojiIconViolations）的口径是「**标签内容起始处**」
//   （`>😀` / `' + 😀`）+ 「同行须有标签特征（class= / <tag / data-testid）」。
//   实测扩展该口径以覆盖「模板串图标前缀 / 整值即字形」会得到 **235 处 / 80 文件**，
//   而抽样显示**绝大多数是合法文本装饰**（toast 文案前缀 `msg: `❌ ${...}``、
//   状态文案 `summary.textContent = `⚠️ ${t(...)}``），语言包里更有 378 条译文本身就是
//   「emoji 开头的文本」——即 ADR-238 §1.4 明确允许的**文本槽装饰**。
//   **结论：图标位 vs 文案前缀不是字符串形状能表达的**（两者长得一样），故闸**不宜扩展**；
//   而结构槽已由 ADR-248 的字段类型（`IconRef`）在编译期守住。
//
//   剩下的**唯一可精确判定**的一类是：**槽的全部内容就是一个字形**——它不可能是文案装饰
//   （没有文字可装饰），只能是图标。实测全仓仅 5 处，已全部迁为 `UI_ICONS` + `innerHTML`。
//   本测试把这条口径钉住，使其不再回潮。
//
// 覆盖边界（有意为之，非遗漏）：
//   - 只认**同行**的 `槽 = "字形"` 赋值；跨行赋值（`el.textContent =` 换行后写字形）扫不到；
//   - 只认 `textContent` / `innerText` / `innerHTML` 三个内容槽；属性槽（如 `title="⛔"`）不在此列
//     （title 是提示文本，不是图标位）；
//   - 变量赋值（如 `applyIcon` 兜底分支的 `el.textContent = icon`）天然不匹配——那是数据图标通道。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// U+2300-23FF（⌚⌛⏰⏳⏸⏹…「杂项技术符号」）补充于 2026-09：`⏳`=U+231B 落在
// 原四段范围之外，导致 `textContent = "⏳"` 类单字形槽**整类逃逸**（实测 5 处）；
// 该段同属 emoji 呈现类字形，纳入后闸才真正覆盖「槽=纯字形」。
const GRAPHIC =
  "[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{2190}-\\u{21FF}\\u{2300}-\\u{23FF}]";
const COMBINING = "[\\u{FE0F}\\u{200D}]";
const GLYPH_ONLY_SLOT = new RegExp(
  `\\.(textContent|innerText|innerHTML)\\s*=\\s*(["'\`])\\s*${GRAPHIC}${COMBINING}*(?:${GRAPHIC}${COMBINING}*)*\\s*\\2`,
  "u",
);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "dist", "coverage", ".git"].includes(e.name)) continue;
      walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(path.relative(SRC, p).split(path.sep).join("/"));
    }
  }
  return out;
}

describe("图标位扫描：槽内容只有一个字形（用 emoji 当图标）", () => {
  it("全仓不存在「槽内容就是一个字形」的写法（应改用 UI_ICONS + innerHTML）", () => {
    const offenders: string[] = [];
    for (const rel of walk(SRC)) {
      fs.readFileSync(path.join(SRC, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
          if (GLYPH_ONLY_SLOT.test(line)) offenders.push(`${rel}:${i + 1}: ${t.slice(0, 90)}`);
        });
    }
    expect(
      offenders,
      "槽里只有一个字形 = 图标位：请改用 UI_ICONS 语义名 + innerHTML（参见 download-queue/roles-views/slide-menu 的既有迁移）",
    ).toEqual([]);
  });
});
