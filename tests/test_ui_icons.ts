#!/usr/bin/env node
/**
 * test_ui_icons.ts — UI 图标命名体系契约测试（ADR-238）。
 *
 * 锁三件事（任一破了都会让「图标体系」变成第二事实源）：
 *   1. **映射表 ↔ 实现 对拍**：`scripts/_lib/icon-map.ts` 里每个语义名，必须在
 *      `frontend/src/utils/icon/ui-icons.ts` 里有对应 SVG 实现——否则扫描器会建议
 *      一个不存在的图标名（比不建议更糟：AI 会照建议写，然后编译/运行时发现没有）。
 *   2. **反向也对拍**：实现里有、映射表里没有 = 有图标但没人能建议出来（白写），
 *      报 WARN 级不通过，防「悄悄加了图标却接不上扫描器」。
 *   3. **SVG 形态约定**：`class="ws-icon"` + `viewBox="0 0 24 24"`——复用既有
 *      `.ws-icon` 样式（ADR-238 D3）。缺 class 则图标不随主题/字号走，
 *      这正是 emoji 的毛病，等于白换。
 *
 * 为什么这两份文件要分开（而不合成一份）：
 *   映射表在 scripts（零依赖，供扫描器+测试），实现在 frontend（含 `@/` 别名与
 *   浏览器侧依赖）。scripts 侧 import frontend 会踩别名/环境问题。故用**对拍**而非
 *   import 合并——同 `TOKEN_PX_BASELINE` ↔ `variables.css` 的范式。
 *
 * 依赖：node:assert / node:fs / node:path / node:url /
 *       scripts/_lib/icon-map.ts（纯数据）
 * 用法：node tests/test_ui_icons.ts
 * 退出码：0 全绿；非 0 断言失败。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allIconNames, EMOJI_TO_ICON, glyphOfIconName, suggestIconName } from "../scripts/_lib/icon-map.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_ICONS_FILE = path.join(ROOT, "frontend/src/utils/icon/ui-icons.ts");

// ── 1. 语义名查询：纯函数行为 ──────────────────────────
{
  assert.equal(suggestIconName("⚠️"), "warning", "⚠️ 应建议 warning");
  assert.equal(suggestIconName("🔍"), "search", "🔍 应建议 search");
  assert.equal(suggestIconName("🗑️"), "delete", "🗑️ 应建议 delete");
  // 未收录 → null（宁可不建议，也不猜错语义）
  assert.equal(suggestIconName("🦄"), null, "未收录字形应返回 null");
  assert.equal(suggestIconName(""), null, "空串应返回 null");

  // 反向查询：语义名 → 代表字形
  assert.equal(glyphOfIconName("warning"), "⚠️", "warning 反查应得 ⚠️");
  assert.equal(glyphOfIconName("no-such-icon"), null, "未知名反查 null");
  console.log("  ✓ suggestIconName / glyphOfIconName 基本行为");
}

// ── 2. 命名规范：语义名而非外观名（ADR-238 D2）─────────
{
  // 外观词黑名单：这些名字把「实现长相」写进了调用点，换图标即要全局改名
  const APPEARANCE_WORDS = [
    "triangle",
    "circle",
    "square",
    "magnifier",
    "trash",
    "floppy",
    "arrow",
    "emoji",
    "glyph",
    "icon2",
  ];
  const bad: string[] = [];
  for (const name of allIconNames()) {
    for (const w of APPEARANCE_WORDS) {
      if (name.toLowerCase().includes(w)) bad.push(`${name}（含外观词 "${w}"）`);
    }
  }
  assert.deepEqual(bad, [], `语义名不应含外观/实现词（ADR-238 D2）：\n    ${bad.join("\n    ")}`);

  // 命名风格：小驼峰（允许全小写单词）
  const badStyle = allIconNames().filter((n) => !/^[a-z][a-zA-Z0-9]*$/.test(n));
  assert.deepEqual(badStyle, [], `图标名应为小驼峰：${badStyle.join(", ")}`);
  console.log(`  ✓ 命名规范：${allIconNames().length} 个语义名均无语义词污染`);
}

// ── 3. 映射表 ↔ 实现 双向对拍（核心）────────────────────
{
  const src = fs.readFileSync(UI_ICONS_FILE, "utf-8");
  // 提取实现里的键（`  name: svg(` 或 `  name: svg(`；UI_ICONS 对象字面量的顶层键）
  const implBlock = /export const UI_ICONS[^{]*\{([\s\S]*?)\n\}\s*(?:satisfies[^;]*)?;/.exec(src)?.[1] ?? "";
  assert.ok(implBlock.length > 0, "未能从 ui-icons.ts 提取 UI_ICONS 对象体（结构变了请同步本测试）");
  const implNames = new Set<string>();
  for (const m of implBlock.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)) {
    implNames.add(m[1]!);
  }
  assert.ok(implNames.size > 0, "未解析出任何图标名");

  // 3a) 映射表 → 实现：每个建议名都必须真有实现
  const missing = allIconNames().filter((n) => !implNames.has(n));
  assert.deepEqual(
    missing,
    [],
    `映射表建议了不存在的图标名（扫描器会让 AI 写出编译不过的代码）：\n    ${missing.join("\n    ")}`,
  );

  // 3b) 实现 → 映射表：有实现但无字形能建议到它 = 白写（提醒接线，不阻断设计自由）
  const unreachable = [...implNames].filter((n) => !allIconNames().includes(n));
  assert.deepEqual(
    unreachable,
    [],
    `ui-icons.ts 有实现但映射表无字形可建议（加了图标却接不上扫描器）：\n    ${unreachable.join("\n    ")}`,
  );

  console.log(`  ✓ 对拍：映射表 ${allIconNames().length} 名 ↔ 实现 ${implNames.size} 个，双向一致`);
}

// ── 4. SVG 形态约定（复用 .ws-icon，勿新造第二套）──────
{
  const src = fs.readFileSync(UI_ICONS_FILE, "utf-8");
  const implBlock = /export const UI_ICONS[^{]*\{([\s\S]*?)\n\}\s*(?:satisfies[^;]*)?;/.exec(src)?.[1] ?? "";
  // 每个条目都经 svg() 包装 → 应含 class="ws-icon" 与 viewBox="0 0 24 24"
  const wrapper = /function svg\([\s\S]*?\n\}/.exec(src)?.[0] ?? "";
  assert.ok(wrapper.includes('class="ws-icon"'), "svg() 包装器必须带 class=\"ws-icon\"（否则不随主题/字号）");
  assert.ok(wrapper.includes('viewBox="0 0 24 24"'), "svg() 包装器必须带 24×24 viewBox（视觉重量统一）");

  // 条目数应等于实现名数（防解析漏项）
  const entries = [...implBlock.matchAll(/^\s{2}[a-zA-Z][a-zA-Z0-9]*\s*:\s*svg\(/gm)].length;
  const names = new Set([...implBlock.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1]));
  assert.equal(
    entries,
    names.size,
    `每个图标都应经 svg() 包装（条目 ${entries} / 名称 ${names.size}）——直写 <svg> 会绕过统一约定`,
  );
  console.log(`  ✓ SVG 约定：${entries} 个图标全部经 svg() 包装（ws-icon + 24×24）`);
}

// ── 5. 图标尺寸规则覆盖面（防「图标裸奔」回归）──────────────
// 事故复盘（2026-09）：ADR-238 把 emoji 换成 SVG 后，**渲染 UI_ICONS 的 13 个 shadow 根
// 里只有 1 个**（app-content，恰巧是 .ws-icon 规则的定义处）带上了该规则。其余 12 个因为
// CSS 不穿透 shadow 边界，SVG 拿不到 `width:1em` ⇒ 退回 viewBox 默认 24×24 ⇒ 在 12px
// 按钮里显成巨块（.pv-tab 一族首发）。光 DOM 组件（app-sync-manager 等）则因全局
// components.css 当时也没这条规则，同样中招。
//
// 本组断言把这个「覆盖面」钉死：
//   a) 每个渲染 UI_ICONS 的 Shadow DOM 组件，其 CSS 必须含 .ws-icon 规则（经 wsIconCSS
//      插值引入或就地定义）；
//   b) 全局 components.css 必须有一份副本（覆盖光 DOM 组件）。
// 只靠 review 记不住「新增视图要带上它」，必须机器兜底。
{
  const srcRoot = path.join(ROOT, "frontend/src");

  function walkDir(d: string): string[] {
    if (!fs.existsSync(d)) return [];
    return fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walkDir(path.join(d, e.name)) : [path.join(d, e.name)]));
  }

  /** 某组件目录的 CSS 是否**真的**把 .ws-icon 规则带进串里。
   *  ⚠️ 不能只查「文件里出现 wsIconCSS 字样」——import 语句里也有该字样，
   *  删掉插值 `${wsIconCSS}` 后仍会假绿（实测踩过）。必须要求：
   *   (a) 串内直接写了 .ws-icon 规则，或 (b) 串内有 ${wsIconCSS} 插值。 */
  function cssHasWsIcon(dir: string): boolean {
    const abs = path.join(srcRoot, dir);
    const files = walkDir(abs).filter((f) => f.endsWith(".ts"));
    return files.some((f) => {
      let txt = "";
      try {
        txt = fs.readFileSync(f, "utf-8");
      } catch {
        return false;
      }
      if (!/export const \w+CSS(?:\s*:\s*string)?\s*=/.test(txt)) return false;
      // 取 CSS 串本体（从 `export const xCSS =` 起到文件尾；够用且稳）
      const body = txt.slice(txt.indexOf("= `"));
      return /\.ws-icon\s*\{/.test(body) || /\$\{wsIconCSS\}/.test(body);
    });
  }

  const shadowDirs = [
    "views/app-preview",
    "views/app-sidebar",
    "views/app-tree",
    "views/app-nav",
    "views/app-content",
  ];
  const missing = shadowDirs.filter((d) => !cssHasWsIcon(d));
  assert.deepEqual(
    missing,
    [],
    `以下 Shadow DOM 组件渲染 UI_ICONS 却没有 .ws-icon 尺寸规则 → 图标会退回 24×24 巨块；` +
      `请在其组件 CSS 串里插值 \${wsIconCSS}（from "@/utils/dom/css.ts"）：\n    ${missing.join("\n    ")}`,
  );
  console.log(`  ✓ 尺寸规则覆盖：${shadowDirs.length} 个 shadow 组件均带 .ws-icon 规则`);

  // 全局副本（覆盖光 DOM 组件）
  const globalCss = fs.readFileSync(path.join(ROOT, "frontend/css/components.css"), "utf-8");
  assert.ok(
    /\.ws-icon\s*\{[^}]*width:\s*1em/.test(globalCss),
    "全局 css/components.css 必须有 .ws-icon{width:1em...} 副本——光 DOM 组件" +
      "（app-sync-manager / dialog 等）走 document 样式，拿不到 shadow 内的 wsIconCSS",
  );
  console.log("  ✓ 全局副本：css/components.css 含 .ws-icon 规则（覆盖光 DOM 组件）");
}

// ── 6. 映射表自身卫生：无空名、无重复指向 ───────────────
{
  for (const [glyph, name] of Object.entries(EMOJI_TO_ICON)) {
    assert.ok(glyph.length > 0, "映射表不应有空字形键");
    assert.ok(name.length > 0, `字形 ${glyph} 的语义名不应为空`);
  }
  // 同一语义名可由多个字形指向（如 ❌/🚫 都指 blocked），这是允许的；
  // 但反向不能出现「一个字形指两个名」（对象键天然唯一，此处防御性断言）
  const keys = Object.keys(EMOJI_TO_ICON);
  assert.equal(new Set(keys).size, keys.length, "字形键不应重复");
  console.log(`  ✓ 映射表卫生：${keys.length} 条字形映射，无空名/重复键`);
}

console.log("\n✅ test_ui_icons.ts 全部通过");
