// ===== 3D 菜单/导航图标契约（ADR-238 边界 · ADR-248 类型化落地）=====
//
// 历史：本文件曾是「人工清单 + 仓级正则扫描」的执行者——两份清单（已迁文件 / 文本槽豁免
// 带通道标记）加一条递归扫 `icon:` 字形的白名单放行。ADR-248 把这三件事交给**类型**之后，
// 清单与扫描整体退役（它们要守的约束现在编译期即成立）：
//
//   - 结构槽字段类型 `IconSpec = UiIconName | DataGlyph`（`utils/icon/resolve.ts`）：
//     **裸 emoji 字面量两者皆不满足 → tsc 报错**，无需扫描源码；
//   - `UI_ICONS` 收紧为字面量键 → `UiIconName` 让**拼错图标名**也成为编译错误；
//   - 数据图标打 `DataGlyph` 品牌 → 只能经 `typeIconOf()` 等构造函数取得（§1.3 的跨层边界）；
//   - 文本槽不是图标字段：模态的标题装饰参数名为 `titleIcon`（`string`，经 `esc()` 内联）。
//
// 本文件保留**两件类型管不到的事**：
//   ① 运行时渲染契约——语义名必须真能解析出 SVG（防「名字合法但实现缺失」）；
//   ② 表与实现的**对拍**——`scripts/_lib/icon-map.ts` ↔ `ui-icons.ts`（另见 tests/test_ui_icons.ts）。
import { describe, expect, it } from "vitest";
import { resolveIcon } from "@/utils/icon/resolve.ts";
import { CORE_MENU_ITEMS, PREVIEW_MENU_GROUPS } from "./defs.ts";

describe("3D 菜单图标：运行时渲染契约（类型已保证命名合法性，此处保证可解析性）", () => {
  const entries = [
    ...PREVIEW_MENU_GROUPS.map((g) => ({ kind: "坞站组", id: g.id, icon: g.icon })),
    ...CORE_MENU_ITEMS.map((n) => ({ kind: "菜单项", id: n.id, icon: n.icon ?? "" })),
  ];

  it("每个结构槽图标都能解析出 SVG（语义名合法但实现缺失会在渲染时静默无图标）", () => {
    const bad = entries.filter((e) => !resolveIcon(e.icon).includes("<svg"));
    expect(
      bad.map((b) => `${b.kind} ${b.id}: "${b.icon}"`),
      "图标名合法却解析不出 SVG——请检查 UI_ICONS 是否真有该实现",
    ).toEqual([]);
  });

  it("坞站组与 core 菜单项的 icon 均非空（结构槽不该有无图标项）", () => {
    const empty = entries.filter((e) => !e.icon);
    expect(empty.map((e) => `${e.kind} ${e.id}`)).toEqual([]);
  });
});
