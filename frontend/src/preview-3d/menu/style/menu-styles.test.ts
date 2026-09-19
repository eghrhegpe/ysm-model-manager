// @vitest-environment happy-dom
// ===== menu-styles 共享常量契约（同值多源收敛）=====
// 事故复盘（2026-09-16）：render.ts 的行首 radio / 行尾 badge 挂 `cc-btn cc-btn-ghost`，
// 但 `.cc-btn*` 当时只住在 cap-controls.ts|ensureCapStyles()，而它唯一调用点是
// renderCapControls() —— 角色面板（纯 row，不渲染任何 cap 控件）永远拿不到 ⇒ `<button>`
// 回落 UA 默认样式：不透明白底 rgb(240,240,240) + 2px 黑框 + 直角（实测 box 21×20）。
// 收敛后 MENU_BTN_CSS 为单一事实源，行/控件两条渲染路径各自插值——谁先跑谁注入。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MENU_BTN_CSS } from "./menu-styles.ts";

describe("MENU_BTN_CSS（行内按钮基础样式单源）", () => {
  it("含 cc-btn 三兄弟，且鬼按钮底透明", () => {
    expect(MENU_BTN_CSS).toMatch(/\.cc-btn\s*\{/);
    expect(MENU_BTN_CSS).toMatch(/\.cc-btn-primary\s*\{/);
    expect(MENU_BTN_CSS).toMatch(/\.cc-btn-ghost\s*\{[^}]*background:\s*transparent/);
  });

  // 消费方必须**真的插值**（import 语句里没有 `${`，故本判据没有「只 import 就假绿」的空间）
  for (const consumer of ["../render.ts", "../cap-controls.ts"]) {
    it(`${consumer} 的样式串插值 MENU_BTN_CSS`, () => {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      const src = fs.readFileSync(path.join(dir, consumer), "utf-8");
      expect(src).toContain("${MENU_BTN_CSS}");
    });
  }
});
