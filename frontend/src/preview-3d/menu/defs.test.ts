// ===== 菜单表 icon 字段契约：必须是语义名，且渲染为 SVG（ADR-238 / ADR-245）=====
//
// 为什么需要这条测试（2026-09 菜单勘察查获的**口径盲区**）：
//   emoji 扫描闸只认「标签内容起始处」（`>😀` / `' + 😀`），而 3D 菜单表的图标是
//   **数据字面量**（`icon: "🧍"`）→ 两者都不是 → 全部逃逸。于是「emoji 债 = 1」
//   与「3D 菜单满屏 emoji 图标」可以同时为真，债在账外。
//
//   既有约定（`utils/icon/resolve.ts` 头部，ADR-238/ADR-245）：**菜单项 icon 字段填「语义名」**
//   （UI_ICONS / ICON_KIT 的 key），由 resolveIcon() 解析为渲染串。工具栏下拉（ADR-239）
//   与右键菜单（ADR-245）已按此迁移，3D 菜单表是最后一块。
//
// 本测试把该约定钉在**数据层**——比逐处渲染断言更早、更集中地拦住回潮。
import { describe, expect, it } from "vitest";
import { isIconName, resolveIcon } from "@/utils/icon/resolve.ts";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS } from "./defs.ts";

/** emoji 与「当图标用的符号字形」（箭头/几何/装饰）——菜单表里都不该再出现 */
const GLYPH_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{FE0F}]/u;

describe("菜单表 icon 字段：语义名契约（ADR-238/ADR-245 单一事实源）", () => {
  const entries = [
    ...PREVIEW_MENU_GROUPS.map((g) => ({ kind: "坞站组", id: g.id, icon: g.icon })),
    ...CORE_MENU_ITEMS.map((n) => ({ kind: "菜单项", id: n.id, icon: n.icon ?? "" })),
  ];

  it("每个 icon 都是已知语义名（isIconName 认得）", () => {
    const bad = entries.filter((e) => !isIconName(e.icon));
    expect(
      bad.map((b) => `${b.kind} ${b.id}: "${b.icon}"`),
      "icon 必须是 UI_ICONS / ICON_KIT 的语义名（未命中 resolveIcon 返回空 → 图标消失）",
    ).toEqual([]);
  });

  it("每个 icon 都渲染为 SVG（而非字形文本）", () => {
    const bad = entries.filter((e) => !resolveIcon(e.icon).includes("<svg"));
    expect(bad.map((b) => `${b.kind} ${b.id}: "${b.icon}"`)).toEqual([]);
  });

  it("回归锁：icon 里不得再出现 emoji / 符号字形", () => {
    const bad = entries.filter((e) => GLYPH_RE.test(e.icon));
    expect(bad.map((b) => `${b.kind} ${b.id}: "${b.icon}"`)).toEqual([]);
  });
});
