// @vitest-environment node
// ===== tabs-shell 契约测试（ADR-259：tab 结构单点产出）=====
//
// 本文件锁定工厂的结构保证——它是「新增 tab 不可能写错结构」的机器证据。
// 与 tpl-structure.test.ts 分工：本文件测**工厂自身**的产出契约；
// tpl-structure.test.ts 测**各页面模板采用工厂后**的成品结构。

import { describe, it, expect } from "vitest";
import { renderTabs, type TabsShell } from "./tabs-shell.ts";

/** 栏 + 面板拼平（仅用于本文件的结构断言；生产由调用方决定落位） */
function flat(shell: TabsShell): string {
  return shell.bar + shell.panels;
}

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
  if (idx < 0) throw new Error(`产出中未找到 ${needle}`);
  const before = html.slice(0, idx);
  const { opens, closes } = divTally(before);
  return opens - closes;
}

const SPEC = {
  prefix: "demo",
  tabs: [
    { id: "alpha", label: "A", body: "AAA" },
    { id: "beta", label: "B", body: "BBB", panelStyle: "overflow-y:auto" },
    { id: "gamma", label: "G", body: "GGG" },
  ],
} as const;

describe("renderTabs 产出契约（ADR-259 §2）", () => {
  it("栏与面板**分产两半**——落位交调用方（仓库页面板嵌 .repo-left，不紧邻栏）", () => {
    const shell = renderTabs(SPEC);
    expect(shell.bar).toMatch(/^<div class="repo-tabs">/);
    expect(shell.bar).not.toContain("tab-body");
    expect(shell.panels).not.toContain("repo-tabs");
    expect(shell.panels).toMatch(/^<div class="tab-body"/);
  });

  it("面板 id 一律 `${prefix}-tab-${id}`——与 bindTabs 运行期查找约定同源", () => {
    const html = flat(renderTabs(SPEC));
    for (const t of SPEC.tabs) {
      expect(html, `缺面板 ${t.id}`).toContain(`id="demo-tab-${t.id}"`);
    }
  });

  it("按钮与面板一一对应，且按钮 data-tab == 面板 id 后段", () => {
    const html = flat(renderTabs(SPEC));
    const tabIds = [...html.matchAll(/<button class="repo-tab[^"]*"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1]);
    const panelIds = [...html.matchAll(/id="demo-tab-([^"]+)"/g)].map((m) => m[1]);
    expect(tabIds).toEqual(["alpha", "beta", "gamma"]);
    expect(panelIds).toEqual(tabIds);
  });

  it("首个面板可见（不写 display）、其余 display:none——与 bindTabs.activate 翻转口径一致", () => {
    const html = flat(renderTabs(SPEC));
    const first = html.slice(html.indexOf('id="demo-tab-alpha"'));
    expect(first.slice(0, first.indexOf(">"))).not.toContain("display");
    expect(html).toContain('id="demo-tab-beta" style="display:none;overflow-y:auto"');
    expect(html).toContain('id="demo-tab-gamma" style="display:none"');
  });

  it("首个按钮带 active、其余不带", () => {
    const html = flat(renderTabs(SPEC));
    expect(html).toContain('<button class="repo-tab active" data-tab="alpha">');
    expect(html).toContain('<button class="repo-tab" data-tab="beta">');
    expect(html).toContain('<button class="repo-tab" data-tab="gamma">');
  });

  it("div 开合配平，且全部面板等深同层（未被彼此吞并）", () => {
    const html = flat(renderTabs(SPEC));
    const { opens, closes } = divTally(html);
    expect(closes).toBe(opens);
    for (const t of SPEC.tabs) {
      expect(depthBefore(html, `<div class="tab-body" id="demo-tab-${t.id}"`)).toBe(0);
    }
  });

  it("差异项全部走声明参数（buttonClass / panelClass / barId / barTestid / panelTestid）", () => {
    const html = flat(
      renderTabs({
        prefix: "x",
        barId: "x-tabs",
        barTestid: "x-tabs-tid",
        buttonClass: "stg-tab",
        panelClass: "diag-panel",
        tabs: [
          { id: "one", label: "1", body: "1", panelTestid: "one-tid" },
          { id: "two", label: "2", body: "2" },
        ],
      }),
    );
    expect(html).toContain('<div class="repo-tabs" id="x-tabs" data-testid="x-tabs-tid">');
    expect(html).toContain('<button class="stg-tab active" data-tab="one">1</button>');
    expect(html).toContain('<button class="stg-tab" data-tab="two">2</button>');
    expect(html).toContain('<div class="tab-body diag-panel" id="x-tab-one" data-testid="one-tid">1</div>');
    expect(html).toContain('<div class="tab-body diag-panel" id="x-tab-two" style="display:none">2</div>');
  });

  it("空 tabs 不产面板，仅产空栏（防御：调用方应保证非空）", () => {
    const shell = renderTabs({ prefix: "e", tabs: [] });
    expect(shell.bar).toBe('<div class="repo-tabs"></div>');
    expect(shell.panels).toBe("");
  });

  // ===== desktopOnly：查看器降级的声明处单点（新增 tab 不再另写远处名单）=====
  it("viewerMode=true → desktopOnly tab 整块不渲染（按钮+面板都缺席，非仅 display:none）", () => {
    const shell = renderTabs({
      prefix: "demo",
      viewerMode: true,
      tabs: [
        { id: "alpha", label: "A", body: "AAA" },
        { id: "beta", label: "B", body: "BBB", desktopOnly: true },
        { id: "gamma", label: "G", body: "GGG" },
      ],
    });
    expect(shell.bar).not.toContain('data-tab="beta"');
    expect(shell.panels).not.toContain('id="demo-tab-beta"');
    // 其余 tab 不受波及
    expect(shell.bar).toContain('data-tab="alpha"');
    expect(shell.bar).toContain('data-tab="gamma"');
  });

  it("viewerMode=true 且首个 tab 是 desktopOnly → 默认激活位让给首个**可见** tab", () => {
    const shell = renderTabs({
      prefix: "demo",
      viewerMode: true,
      tabs: [
        { id: "alpha", label: "A", body: "AAA", desktopOnly: true },
        { id: "beta", label: "B", body: "BBB" },
      ],
    });
    // 旧口径下 alpha 带 active、beta 隐藏——现在 alpha 直接不渲染，beta 成为首位可见
    expect(shell.bar).toContain('<button class="repo-tab active" data-tab="beta">');
    // 首个可见面板不写 display（回落 .tab-body{display:flex}），否则查看器下面板全灰
    expect(shell.panels).toContain('<div class="tab-body" id="demo-tab-beta">');
  });

  it("viewerMode 缺省/false → desktopOnly 照常渲染（桌面模式零行为变化）", () => {
    for (const vm of [undefined, false]) {
      const shell = renderTabs({
        prefix: "demo",
        ...(vm === undefined ? {} : { viewerMode: vm }),
        tabs: [{ id: "alpha", label: "A", body: "AAA", desktopOnly: true }],
      });
      expect(shell.bar).toContain('data-tab="alpha"');
      expect(shell.panels).toContain('id="demo-tab-alpha"');
    }
  });

  // ===== viewerNotice：查看器告知行单点（ADR-300 §2.5）=====
  it("viewerMode + 确有 desktopOnly 被藏 + 传了 viewerNotice → 产出一行，且落位在 tablist 外", () => {
    const shell = renderTabs({
      prefix: "demo",
      viewerMode: true,
      viewerNotice: "仅桌面版可用",
      tabs: [
        { id: "alpha", label: "A", body: "AAA" },
        { id: "beta", label: "B", body: "BBB", desktopOnly: true },
      ],
    });
    expect(shell.notice).toBe('<div class="repo-tabs-notice">仅桌面版可用</div>');
    // ARIA 红线（ADR-258 §2.4）：告知行绝不得混入 .repo-tabs（role=tablist）内部
    expect(shell.bar).not.toContain("repo-tabs-notice");
    expect(shell.bar).not.toContain("仅桌面版可用");
  });

  it("告知行三不产：无隐藏项 / 非 viewer / 未传文案（repo 页等保持零行为变化）", () => {
    const tabsHidden = [
      { id: "a", label: "A", body: "" },
      { id: "b", label: "B", body: "", desktopOnly: true },
    ];
    // ① 没有东西被藏（viewerMode=false）→ 桌面零噪音
    expect(
      renderTabs({ prefix: "p", viewerNotice: "N", tabs: tabsHidden }).notice,
    ).toBe("");
    // ② viewer 但声明里无 desktopOnly → 无缺席可告知
    expect(
      renderTabs({ prefix: "p", viewerMode: true, viewerNotice: "N", tabs: [{ id: "a", label: "A", body: "" }] })
        .notice,
    ).toBe("");
    // ③ 有隐藏但未传文案 → 调用方未选择告知（repo 页现状），不擅自造文案
    expect(renderTabs({ prefix: "p", viewerMode: true, tabs: tabsHidden }).notice).toBe("");
  });
});
