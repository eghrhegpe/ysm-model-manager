// @vitest-environment node
// ===== 页面模板结构契约（ADR-259：tab 结构单点产出）=====
//
// 为什么需要本文件：2026-09-17 诊断页因 `diagnosticsHTML()` 漏一个 `</div>`，
// `#diag-tab-log` 把后续 7 个面板吞进自己内部；`bindTabs` 切页时隐藏 `#diag-tab-log`，
// 嵌在里面的面板一并消失 → 切任何 tab 都只剩空 tab 栏。
// 既有 `tpl.test.ts` 用子串断言（`toContain('id="diag-tab-log"')`）——面板 id 字面量
// 即便被错误嵌套也照样在字符串里，**断言恒真、对结构完全失明**。
// 教训与泛化规则见 `skills/pitfalls.md` #20。
//
// 本文件按**结构**验证，三条独立断言缺一不可：
//   ① 每个页面模板 `<div>` 开合配平                     —— 抓「漏闭合」
//   ② 每个 tab 页：面板数 == 按钮数，且 id 与 data-tab 一一对应 —— 抓「错配 / 漏面板」
//   ③ 每个面板都是 `.tab-body` 且全部等深同层（互不嵌套）  —— 抓「兄弟吞并」+ 守住唯一范式
//
// 纯字符串实现（node 环境，与 tpl.test.ts 同）——不依赖 jsdom / DOM 解析器。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/** frontend/src 根（本文件位于 src/views/app-content/） */
const SRC_ROOT = join(fileURLToPath(new URL("../../..", import.meta.url)), "src");
import {
  diagnosticsHTML,
  githubHTML,
  instancesHTML,
  repositoryHTML,
  workshopHTML,
} from "./tpl.ts";
import { settingsHTML } from "./settings/tpl-settings.ts";

/** 全部页面模板（用于 ① 配平） */
const PAGE_TEMPLATES: Array<[string, () => string]> = [
  ["repositoryHTML", repositoryHTML],
  ["instancesHTML", instancesHTML],
  ["diagnosticsHTML", diagnosticsHTML],
  ["githubHTML", githubHTML],
  ["workshopHTML", workshopHTML],
  ["settingsHTML", settingsHTML],
];

/**
 * 走 renderTabs 工厂的 tab 页（用于 ②③）。
 * 三列 = 展示名 / 产物 / 面板 id 前缀。
 * `workshopHTML` **不在列**：其 tab 栏由 `initWorkshopPage` 运行期动态注入
 * （`workshop-tabs.ts`），非静态声明——ADR-259 §2.3 明确排除，硬套契约会制造语义谎。
 */
const TABBED_PAGES: Array<[string, () => string, string]> = [
  ["repositoryHTML", repositoryHTML, "repo"],
  ["instancesHTML", instancesHTML, "ins"],
  ["diagnosticsHTML", diagnosticsHTML, "diag"],
  ["githubHTML", githubHTML, "gh"],
  ["settingsHTML", settingsHTML, "stg"],
];

/** 统计 `<div>` / `</div>`（本仓模板不使用自闭合 `<div/>`） */
function divTally(html: string): { opens: number; closes: number } {
  return {
    opens: (html.match(/<div\b/g) ?? []).length,
    closes: (html.match(/<\/div>/g) ?? []).length,
  };
}

/** needle 出现位置之前（不含该标签自身）的 div 净深度 */
function depthBefore(html: string, needle: string): number {
  const idx = html.indexOf(needle);
  if (idx < 0) throw new Error(`模板中未找到 ${needle}`);
  const { opens, closes } = divTally(html.slice(0, idx));
  return opens - closes;
}

/** 页面里全部 tab 按钮的 data-tab（按出现顺序） */
function buttonTabs(html: string): string[] {
  // 允许 class 与 data-tab 之间存在其它属性（如仓库页四个 tab 共用 data-testid="content-tab"）
  return [...html.matchAll(/<button class="(?:repo-tab|stg-tab)[^"]*"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1] as string);
}

/** 页面里全部面板：{ id 后段, class } */
function panels(html: string, prefix: string): Array<{ tab: string; cls: string }> {
  const re = new RegExp(`<div class="([^"]*)" id="${prefix}-tab-([^"]+)"`, "g");
  return [...html.matchAll(re)].map((m) => ({ cls: m[1] as string, tab: m[2] as string }));
}

describe("页面模板 div 开合平衡（抓漏闭合）", () => {
  for (const [name, build] of PAGE_TEMPLATES) {
    it(`${name} 的 <div> 开合平衡`, () => {
      const { opens, closes } = divTally(build());
      expect(closes, `${name} 存在未闭合的 <div>`).toBe(opens);
    });
  }
});

describe("tab 页：按钮与面板一一对应（抓错配 / 漏面板）", () => {
  for (const [name, build, prefix] of TABBED_PAGES) {
    it(`${name}：面板与按钮同数同名`, () => {
      const html = build();
      const tabs = buttonTabs(html);
      const ps = panels(html, prefix);
      expect(tabs.length, `${name} 未产出 tab 按钮`).toBeGreaterThan(0);
      expect(ps.map((p) => p.tab)).toEqual(tabs);
    });
  }
});

describe("tab 页：面板唯一范式 + 等深同层（抓兄弟吞并 / 范式漂移）", () => {
  for (const [name, build, prefix] of TABBED_PAGES) {
    it(`${name}：每个面板都是 .tab-body，且互不嵌套`, () => {
      const html = build();
      const ps = panels(html, prefix);
      expect(ps.length).toBeGreaterThan(0);

      // ③-a 唯一范式：面板必须是 .tab-body（ADR-259 §2.1）。
      // 这正是否决旧诊断页「.diag-panel 自成一格」的分界线。
      for (const p of ps) {
        expect(p.cls.split(/\s+/), `面板 ${prefix}-tab-${p.tab} 未使用 .tab-body 范式`).toContain("tab-body");
      }

      // ③-b 等深同层：全部面板处在同一 div 深度——嵌套错位会让深度递增
      const depths = ps.map((p) => depthBefore(html, `<div class="${p.cls}" id="${prefix}-tab-${p.tab}"`));
      for (const [i, d] of depths.entries()) {
        expect(d, `面板 ${prefix}-tab-${ps[i]!.tab} 被前一面板吞并（深度 ${d} ≠ ${depths[0]}）`).toBe(depths[0]);
      }
    });
  }
});

describe("bindTabs 契约：不得再有第二份 id 白名单（ADR-259 运行期契约）", () => {
  it("全部 bindTabs 调用点都是三参形态（无 id 数组）", () => {
    // 复盘（2026-09，设置页新增「操作」tab）：`bindTabs` 曾要求手传 `ids` 白名单，
    // 它与模板里的 data-tab 是**第二份手工真值**——漏同步则 `activate` 遍历不到新 tab 的面板，
    // 表现为「按钮在、点了没反应、内容区空白」且不报错。
    // 现从 DOM 派生；本闸防止白名单以任何形式回流。
    const src = readFileSync(join(SRC_ROOT, "views/app-content/init-pages.ts"), "utf8");
    const calls = [...src.matchAll(/bindTabs\(host,[^;]*\)/g)].map((m) => m[0]);
    expect(calls.length, "未匹配到 bindTabs 调用点（路径/正则漂移，闸会空转）").toBeGreaterThanOrEqual(4);
    for (const c of calls) {
      expect(c.includes("["), `调用点仍传数组白名单：${c}`).toBe(false);
    }
  });
});
