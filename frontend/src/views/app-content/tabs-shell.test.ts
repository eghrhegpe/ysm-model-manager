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
});
