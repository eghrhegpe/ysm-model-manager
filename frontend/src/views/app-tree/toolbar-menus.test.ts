// ===== toolbar-menus 声明式菜单渲染测试 =====
// 收敛契约：renderDropdown 产出的完整下拉 HTML 与原手写工具栏下拉结构等价
// （触发按钮 id/testid、菜单容器 id、data-* 委托、data-testid、图标、dividerBefore 分隔线），
// 保证 toolbar-events.ts 的委托绑定与既有测试 fixture 继续生效。
import { describe, expect, it } from "vitest";
import { renderDropdown, toolbarMenuTestids } from "./toolbar-menus.ts";

describe("toolbar-menus 声明式菜单（icon 语义名声明式）", () => {
  it("批量下拉：触发按钮 + 两菜单项（data-batch + testid + SVG 图标）", () => {
    const html = renderDropdown("batch");
    // 触发按钮
    expect(html).toContain('id="btn-batch"');
    expect(html).toContain('data-testid="tree-batch"');
    expect(html).toContain('id="menu-batch"');
    // 菜单项 data-batch + testid
    expect(html).toContain('data-batch="enable-all"');
    expect(html).toContain('data-testid="tree-batch-enable"');
    expect(html).toContain('data-batch="disable-all"');
    expect(html).toContain('data-testid="tree-batch-disable"');
    // 图标由语义名解析为 SVG（.ws-icon）——触发按钮 performance + 两菜单项 = 3
    expect(html.match(/class="ws-icon"/g)).toHaveLength(3);
    // 无多余分隔线
    expect(html).not.toContain("border-top:");
  });

  it("更多下拉：触发按钮 + 五菜单项 + dividerBefore 分隔线", () => {
    const html = renderDropdown("more");
    // ADR-238：触发按钮的 ⋮ 语义图标走 SVG，i18n 文案回归纯文本。
    expect(html).not.toContain("⋮");
    expect(html).toContain('id="btn-more"');
    expect(html).toContain('data-testid="tree-more"');
    expect(html).toContain('id="menu-more"');
    const expected: Array<[string, string]> = [
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
    // open-folder（dividerBefore）前有分隔线
    const divider = '<div style="border-top:1px solid var(--bd);margin:2px 0"></div>';
    expect(html).toContain(divider);
    const divIdx = html.indexOf(divider);
    expect(divIdx).toBeGreaterThan(html.indexOf('data-more="import-dir"'));
    expect(divIdx).toBeLessThan(html.indexOf('data-more="open-folder"'));
  });

  it("更多下拉触发按钮 + 全部 5 个菜单项图标均经语义名解析为纯 SVG（无 emoji 残留，ADR-238）", () => {
    const html = renderDropdown("more");
    // 触发按钮 verticalDots + 五个菜单项 SVG 图标（file/folderOpen/folderOpen/refresh/book），无 ⋮/emoji 并排
    expect(html.match(/class="ws-icon"/g)).toHaveLength(6);
    for (const action of ["import-file", "import-dir", "open-folder", "refresh", "genindex"]) {
      const btn = html.slice(
        html.indexOf(`data-more="${action}"`),
        html.indexOf("</button>", html.indexOf(`data-more="${action}"`)),
      );
      expect(btn).toContain('class="ws-icon"');
      // 文案回归纯文本：不出现文件夹/刷新/索引类 emoji
      expect(btn).not.toMatch(/[📁📂🔄📇]/);
    }
  });

  it("toolbarMenuTestids 含触发按钮 + 全部菜单项 testid（保 ADR-133 派生）", () => {
    const ids = toolbarMenuTestids();
    const expected = [
      "tree-batch",
      "tree-batch-enable",
      "tree-batch-disable",
      "tree-more",
      "tree-more-import-file",
      "tree-more-import-dir",
      "tree-more-open-folder",
      "tree-more-refresh",
      "tree-more-genindex",
    ];
    expect(ids).toEqual(expected);
  });

  it("结构等价：渲染 HTML 与 data-* / testid 契约一致（防声明/渲染漂移）", () => {
    const batchHtml = renderDropdown("batch");
    const moreHtml = renderDropdown("more");
    // 每个 data-testid 都对应一个 data-<key>，且按钮是 dd-item
    for (const [key, html] of [
      ["batch", batchHtml],
      ["more", moreHtml],
    ] as const) {
      const testids = [...html.matchAll(/data-testid="(tree-[^"]+)"/g)].map((m) => m[1]);
      const items = [...html.matchAll(/(?:data-batch|data-more)="([^"]+)"/g)].map((m) => m[1]);
      expect(testids.length).toBe(items.length + 1); // +1 = 触发按钮 tree-<key>
      expect(html).toContain(`data-${key}`);
    }
  });
});