/**
 * survey-emoji-icons.ts — 一次性 emoji / UI_ICONS 摸排脚本（非门禁，仅报告）。
 *
 * 用途：替代「几十次零散 grep」式的手动摸排。一次运行产出全貌：
 *   ① 全仓 emoji 字面量分布（按文件、按字形计数，区分 HTML 图标位 vs 文案）；
 *   ② UI_ICONS 每个语义名的消费点数 + 调用点文件清单；
 *   ③ 映射表收录、但代码里零消费的「孤儿图标」；
 *   ④ locale 文案值里的前缀型状态符号 emoji。
 *
 * 设计原则（ADR-238 同源纪律）：emoji 字符集与「图标位残留」判定**全部复用门禁**
 * `scripts/_lib/design-tokens.ts` 的导出（`GRAPHIC_EMOJI` / `GLYPH_CLUSTER` /
 * `findEmojiIconViolations` / `findLocaleEmojiPrefixViolations`），本文件**不手抄副本**——
 * 否则两份字符集将来必漂移（实测教训：预筛曾因少两段码位漏掉 ⏳ 整类）。
 *
 * 依赖：node:fs / node:path / 复用 scripts/_lib/{icon-map,design-tokens}.ts。
 * 运行：node scripts/_lib/survey-emoji-icons.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findEmojiIconViolations,
  findLocaleEmojiPrefixViolations,
  GLYPH_CLUSTER,
} from "./design-tokens.ts";
import { EMOJI_TO_ICON, suggestIconName } from "./icon-map.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");

const GRAPHIC_RE = new RegExp(GLYPH_CLUSTER, "gu");

// 扫描目录（前端生产源码 + ui-icons 定义 + locale）
const SCAN_DIRS = ["frontend/src", "frontend/src/locales"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function rel(p: string): string {
  return relative(ROOT, p).replace(/\\/g, "/");
}

const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));

// ① emoji 分布
const byFile = new Map<string, number>();
const byGlyph = new Map<string, number>();
// ② HTML 图标位残留（直接复用门禁判定，含 suggestion）
const iconSlotHits: string[] = [];

// ② UI_ICONS 消费
const uiIconUse = new Map<string, Set<string>>(); // name -> set of files
const uiIconRe = /UI_ICONS\.(\w+)/g;

// ④ locale 文案 emoji
const localeEmojiHits: string[] = [];

for (const f of files) {
  const src = readFileSync(f, "utf-8");
  const r = rel(f);
  const lines = src.split("\n");

  // UI_ICONS 消费（含 tpl 里的 `${UI_ICONS.x}` 与裸 UI_ICONS.x）
  for (const m of src.matchAll(uiIconRe)) {
    const name = m[1];
    if (!name) continue;
    const set = uiIconUse.get(name) ?? new Set();
    set.add(r);
    uiIconUse.set(name, set);
  }

  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
    if (!GRAPHIC_RE.test(line)) return;

    // 计数按字形
    GRAPHIC_RE.lastIndex = 0;
    for (const gm of line.matchAll(GRAPHIC_RE)) {
      const g = gm[1] ?? gm[0];
      byGlyph.set(g, (byGlyph.get(g) ?? 0) + 1);
    }
    byFile.set(r, (byFile.get(r) ?? 0) + 1);

    // ② HTML 图标位残留：复用门禁判定（同源、含建议语义名）
    for (const v of findEmojiIconViolations(line, i + 1)) {
      iconSlotHits.push(
        `${r}:${v.line} ${v.snippet}${v.suggestion ? ` → ${v.suggestion}` : " (未收录)"}`,
      );
    }

    // ④ locale 值前缀型状态符号：复用门禁判定（locale 域）
    if (r.startsWith("frontend/src/locales/")) {
      for (const v of findLocaleEmojiPrefixViolations(line, i + 1)) {
        localeEmojiHits.push(`${r}:${v.line} ${v.snippet} → ${v.suggestion}`);
      }
    }
  });
}

// ③ 孤儿图标：映射表收录、但 UI_ICONS.x 零消费
const orphan = [...new Set(Object.values(EMOJI_TO_ICON))].filter((n) => !uiIconUse.has(n));

// ── 打印报告 ──
function hr(t: string) {
  console.log(`\n═══════ ${t} ═══════`);
}

hr("① emoji 字面量按文件分布");
[...byFile.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([f, n]) => {
    console.log(`  ${String(n).padStart(3)}  ${f}`);
  });
console.log(
  `\n  文件数=${byFile.size}  全仓 emoji 字面量总数=${[...byFile.values()].reduce((a, b) => a + b, 0)}`,
);

hr("① emoji 字面量按字形分布");
[...byGlyph.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([g, n]) => {
    console.log(
      `  ${String(n).padStart(3)}  ${g}  → ${suggestIconName(g) ?? "（未收录于 icon-map）"}`,
    );
  });

hr("② HTML 图标位残留 emoji（门禁 findEmojiIconViolations 同源口径）");
if (iconSlotHits.length === 0) console.log("  （无）");
for (const h of iconSlotHits) console.log(`  ${h}`);
console.log(
  `  （注：check-design-tokens --kind emoji-icon 的存量债口径独立记录，本行只呈现实测命中）`,
);

hr("③ 孤儿图标（映射表收录、但 UI_ICONS.x 零消费）");
for (const n of orphan) console.log(`  UI_ICONS.${n}（无调用点）`);
console.log(
  `\n  孤儿数=${orphan.length} / 映射语义名总数=${new Set(Object.values(EMOJI_TO_ICON)).size}`,
);

hr("④ locale 文案值前缀型状态符号 emoji（门禁 findLocaleEmojiPrefixViolations 同源口径）");
if (localeEmojiHits.length === 0) console.log("  （无）");
for (const h of localeEmojiHits) console.log(`  ${h}`);

hr("② UI_ICONS 语义名消费分布（按消费文件数）");
const uiSorted = [...uiIconUse.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`  已消费语义名数=${uiSorted.length}`);
uiSorted.forEach(([n, fs]) => {
  console.log(`  UI_ICONS.${n.padEnd(14)} 文件数=${fs.size}`);
});
