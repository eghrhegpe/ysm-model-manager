// @vitest-environment node
// ===== 主题卡片契约测试（2026-09 立）=====
//
// 锁定两件事：
//   1) 卡片集合与 THEME_VALID 一致 —— 新增主题必须同步加卡片（防「加主题忘加卡片」）
//   2) 每张卡片三色点绑定 --bg/--accent/--bd 三个变量名 —— 防绑错/漏绑（变量名级契约）
//
// ⚠️ 本测试**锁定**色点与主题变量的映射关系（非「无映射」）：
//    每张卡片三色点绑定 --bg / --accent / --bd（全仓 var 使用 72/245/212，
//    对应常态基调 / 选中态强调 / 边框选中态），经 .theme-x 作用域类就地解析。
//    因此色点 = 主题实际三态色，无硬编码 hex；加主题忘加卡片 / 改了映射会立刻红。
import { describe, it, expect, vi } from "vitest";
import { THEME_VALID } from "@/theme-core";
import { settingsHTML } from "./tpl-settings.ts";

vi.mock("@/backend/platform.ts", () => ({
  getAndroidBridge: vi.fn().mockReturnValue(null),
  isViewerMode: vi.fn().mockReturnValue(false),
}));
vi.mock("@/backend/platform-web.ts", () => ({
  isWebPlatform: vi.fn().mockReturnValue(false),
  canBinding: vi.fn().mockReturnValue(true),
}));

/** 从设置页 HTML 中抽出每张主题卡片的 data-theme 与三个色点 */
function parseCards(html: string): { theme: string; vars: string[] }[] {
  const cards: { theme: string; vars: string[] }[] = [];
  // 以 .theme-card + data-theme="x" 联合锚切卡片壳（防页面其他 data-theme 元素混入），
  // 取其首个内层 div（色点容器）里的 var(--xxx)
  const cardRe = /class="theme-card[^"]*"\s+data-theme="([^"]+)"[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const vars = [...m[2].matchAll(/background:\s*var\(--([a-z-]+)\)/g)].map((c) => c[1]);
    cards.push({ theme: m[1], vars });
  }
  return cards;
}

describe("主题卡片契约（THEME_VALID 是唯一事实源）", () => {
  const html = settingsHTML();
  const cards = parseCards(html);

  it("解析器自检：确实抓到卡片且每张三色（防正则静默失效假绿）", () => {
    // 若 tpl-settings.ts 改了卡片 HTML 结构导致正则抓不到，这里先红，
    // 避免下面两条断言因「空集合」而假绿。
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.vars.length === 3)).toBe(true);
  });

  it("卡片 data-theme 集合 == THEME_VALID 去掉 system", () => {
    const expected = THEME_VALID.filter((t) => t !== "system").sort();
    const actual = cards.map((c) => c.theme).sort();
    expect(actual).toEqual(expected);
  });
  it("每张卡片三色点绑定 --bg/--accent/--bd（常态/选中态/边框三态变量，零硬编码）", () => {
    for (const card of cards) {
      expect(card.vars).toHaveLength(3);
      // 三态变量完整且无误：防「绑错变量 / 漏绑」
      expect(new Set(card.vars)).toEqual(new Set(["bg", "accent", "bd"]));
    }
  });
});
