// ===== toolbar-menus 声明式菜单渲染测试 =====
// 收敛契约：renderMenuItems 产出的 HTML 结构与原手写工具栏下拉一致
// （data-* 委托属性、data-testid、图标前缀、dividerBefore 分隔线、行为动作），
// 保证 toolbar-events.ts 的委托绑定继续生效。
import { describe, expect, it } from "vitest";
import {
  BATCH_MENU_ITEMS,
  MORE_MENU_ITEMS,
  getToolbarMenu,
  renderMenuItems,
  toolbarMenuTestids,
} from "./toolbar-menus.ts";

describe("toolbar-menus 声明式菜单", () => {
  it("批量菜单两项目：data-batch + 对应 testid + SVG 图标前缀", () => {
    const html = renderMenuItems("batch");
    expect(html).toContain('data-batch="enable-all"');
    expect(html).toContain('data-testid="tree-batch-enable"');
    expect(html).toContain('data-batch="disable-all"');
    expect(html).toContain('data-testid="tree-batch-disable"');
    // SVG 图标（.ws-icon）存在于两个按钮
    expect(html).toContain('class="ws-icon"');
    expect(html.match(/class="ws-icon"/g)).toHaveLength(2);
  });

  it("更多菜单五项：data-more + testid 齐全", () => {
    const html = renderMenuItems("more");
    const expected = [
      ["import-file", "tree-more-import-file"],
      ["import-dir", "tree-more-import-dir"],
      ["open-folder", "tree-more-open-folder"],
      ["refresh", "tree-more-refresh"],
      ["genindex", "tree-more-genindex"],
    ];
    for (const [action, testid] of expected) {
      expect(html).toContain(`data-more="${action}"`);
      expect(html).toContain(`data-testid="${testid}"`);
    }
  });

  it("更多菜单 open-folder 前插分隔线（dividerBefore）", () => {
    const html = renderMenuItems("more");
    const divider = '<div style="border-top:1px solid var(--bd);margin:2px 0"></div>';
    expect(html).toContain(divider);
    // 分隔线位于 import-dir 之后、open-folder 之前
    const divIdx = html.indexOf(divider);
    const afterDirIdx = html.indexOf('data-more="import-dir"');
    const beforeFolderIdx = html.indexOf('data-more="open-folder"');
    expect(afterDirIdx).toBeGreaterThan(-1);
    expect(beforeFolderIdx).toBeGreaterThan(-1);
    expect(divIdx).toBeGreaterThan(afterDirIdx);
    expect(divIdx).toBeLessThan(beforeFolderIdx);
  });

  it("import-file 带 UI_ICONS 图标前缀，其余更多项无图标", () => {
    const importFile = MORE_MENU_ITEMS.find((m) => m.action === "import-file")!;
    expect(importFile.icon).toContain("ws-icon"); // UI_ICONS.file 是 SVG
    const others = MORE_MENU_ITEMS.filter((m) => m.action !== "import-file");
    for (const m of others) expect(m.icon).toBe("");
  });

  it("toolbarMenuTestids 覆盖批量 + 更多全部 testid", () => {
    const ids = toolbarMenuTestids();
    const expected = [
      "tree-batch-enable",
      "tree-batch-disable",
      "tree-more-import-file",
      "tree-more-import-dir",
      "tree-more-open-folder",
      "tree-more-refresh",
      "tree-more-genindex",
    ];
    expect(ids).toEqual(expected);
  });

  it("getToolbarMenu 按 key 返回对应项", () => {
    expect(getToolbarMenu("batch")).toBe(BATCH_MENU_ITEMS);
    expect(getToolbarMenu("more")).toBe(MORE_MENU_ITEMS);
  });

  it("column 对齐：每项目必含 testid 与 action（防新增项漏登记）", () => {
    for (const items of [BATCH_MENU_ITEMS, MORE_MENU_ITEMS]) {
      for (const it of items) {
        expect(it.testid).toMatch(/^tree-/);
        expect(it.action.length).toBeGreaterThan(0);
      }
    }
  });
});