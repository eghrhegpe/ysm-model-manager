// @vitest-environment node
// ===== 主题卡片契约测试（2026-09 立）=====
//
// 锁定两件事：
//   1) 卡片集合与 THEME_VALID 一致 —— 新增主题必须同步加卡片（防「加主题忘加卡片」）
//   2) 每张三色互异且为合法 hex —— 防手抄笔误
//
// ⚠️ 本测试**不**承诺色点与 variables.css 的主题变量一一对应。
//    实测（2026-09）：色点是历史手调的设计值——只有部分主题的首色恰好等于 --accent
//    （cyber #9575cd / warm #8b4513 / pro #ff8a65 / sakura #d81b60），
//    ocean 的 --accent #9fa8da 落在第 3 位，mint 三色则**均不在**其变量表中。
//    因此色点应理解为「主题外观缩略图」，不是「变量派生值」。
//    若将来决定「色点须反映主题实际配色」，需先确立映射约定（含 :root 与 .theme-cyber
//    共块的基线共享）再改写断言——那是引入新契约，不是发现既有契约。
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
function parseCards(html: string): { theme: string; colors: string[] }[] {
  const cards: { theme: string; colors: string[] }[] = [];
  // 按 .theme-card 切块：每块含 data-theme="xxx" 与其后的三个 background:#hex
  const cardRe = /class="theme-card"\s+data-theme="([^"]+)"([\s\S]*?)(?=class="theme-card"|$)/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const colors = [...m[2].matchAll(/background:\s*(#[0-9a-fA-F]+)/g)].map((c) => c[1]);
    cards.push({ theme: m[1], colors });
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
    expect(cards.every((c) => c.colors.length === 3)).toBe(true);
  });

  it("卡片 data-theme 集合 == THEME_VALID 去掉 system", () => {
    const expected = THEME_VALID.filter((t) => t !== "system").sort();
    const actual = cards.map((c) => c.theme).sort();
    expect(actual).toEqual(expected);
  });

  it("每张卡片三色互异且为合法 hex", () => {
    for (const card of cards) {
      expect(card.colors).toHaveLength(3);
      // 互异：防「复制粘贴忘记改色」
      expect(new Set(card.colors).size).toBe(3);
      // 合法 hex：统一要求 6 位，防简写/笔误
      for (const c of card.colors) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
