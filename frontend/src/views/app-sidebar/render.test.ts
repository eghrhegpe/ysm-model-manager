// ===== sidebar 渲染层测试 =====
// 覆盖：renderVersionCards 空/非空、instanceCardHeaderHTML 各 chips 分支（真实实现——
// mock 用 spy 包装真实 instanceCardHeaderHTML，既记录调用又产出真实 HTML，修复此前
// 「注释声称覆盖 chips 分支、实际整模块被替换」的假覆盖）
import { describe, it, expect, vi, beforeEach } from "vitest";

const { instanceCardHeaderHTMLMock } = vi.hoisted(() => ({ instanceCardHeaderHTMLMock: vi.fn() }));

vi.mock("./tpl.ts", async () => {
  const actual = await vi.importActual<typeof import("./tpl.ts")>("./tpl.ts");
  instanceCardHeaderHTMLMock.mockImplementation(actual.instanceCardHeaderHTML);
  return { ...actual, instanceCardHeaderHTML: instanceCardHeaderHTMLMock };
});

// isolate:false 共享 mock 引用 + shuffle 打乱用例顺序：mock 调用记录跨用例累积
// （「空实例」排到「非空实例」后 → not.toHaveBeenCalled 失真），每用例清一次
beforeEach(() => {
  instanceCardHeaderHTMLMock.mockClear();
});

import { renderVersionCards } from "./render.ts";
import { instanceCardHeaderHTML } from "./tpl.ts";
import type { SidebarInstance } from "./data.ts";

function instance(over: Partial<SidebarInstance>): SidebarInstance {
  return {
    name: "整合包",
    dir: "/mc/instances/x",
    exists: true,
    hasMod: true,
    status: "complete",
    synced: 2,
    missing: 1,
    extra: 0,
    disabled: 0,
    rtype: "ysm",
    variantGroups: null,
    _missingPaths: [],
    _extraPaths: [],
    items: { synced: [] },
    ...over,
  };
}

describe("renderVersionCards", () => {
  it("空实例 → 显示未找到提示，不调用 instanceCardHeaderHTML", () => {
    const container = document.createElement("div");
    renderVersionCards(container, []);
    expect(container.innerHTML).toContain("未找到匹配的整合包");
    expect(instanceCardHeaderHTML).not.toHaveBeenCalled();
  });

  it("非空实例 → 生成 instance-card 卡片，传递全部字段与 idx", () => {
    const container = document.createElement("div");
    renderVersionCards(container, [
      instance({ name: "P1", synced: 3, missing: 2, extra: 1, status: "missing", hasMod: false, rtype: "pack" }),
      instance({ name: "P2" }),
    ]);

    const cards = Array.from(container.querySelectorAll<HTMLElement>(".instance-card"));
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.idx).toBe("0");
    expect(cards[1].dataset.idx).toBe("1");
    expect(cards[0].style.animationDelay).toBe("0ms");
    expect(cards[1].style.animationDelay).toBe("40ms");
    expect(instanceCardHeaderHTML).toHaveBeenNthCalledWith(1, "P1", 3, 2, 1, "missing", 0, false, "pack");
    expect(instanceCardHeaderHTML).toHaveBeenNthCalledWith(2, "P2", 2, 1, 0, "complete", 1, true, "ysm");
  });
});

describe("instanceCardHeaderHTML 徽章 chips（真实实现）", () => {
  it("synced>0 → green 标签；extra>0 → orange 标签", () => {
    const html = instanceCardHeaderHTML("P", 3, 0, 2, "extra");
    expect(html).toContain('<span class="tag green" data-role="synced-count">3</span>');
    expect(html).toContain('<span class="tag orange" data-role="extra-count">2</span>');
  });

  it("missing>0 && hasMod → red 标签", () => {
    const html = instanceCardHeaderHTML("P", 0, 5, 0, "missing", 0, true);
    expect(html).toContain('<span class="tag red" data-role="missing-count">5</span>');
  });

  it("missing>0 && !hasMod → 不显示 red 标签，改显 noMods 灰标签（带 rtype 标签）", () => {
    const html = instanceCardHeaderHTML("P", 0, 5, 0, "missing", 0, false, "ysm");
    expect(html).not.toContain('class="tag red"');
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无YSM</span>');
  });

  it("rtype 无展示配置 → noMods 灰标签回落为 rtype 原始 id", () => {
    const html = instanceCardHeaderHTML("P", 0, 5, 0, "missing", 0, false, "custom-type");
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无custom-type</span>');
  });

  it("MMD 子类型（场景模型）无模组 → 统一显示 无MMD，不显 无场景模型", () => {
    const html = instanceCardHeaderHTML("P", 0, 5, 0, "missing", 0, false, "SceneModel");
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无MMD</span>');
    expect(html).not.toContain("无场景模型");
  });

  it("vrm 虽在 mmd 组但保持独立 VRM 标签", () => {
    const html = instanceCardHeaderHTML("P", 0, 5, 0, "missing", 0, false, "vrm");
    expect(html).toContain('<span class="tag gray" data-role="no-mods">无VRM</span>');
  });

  it("hasMod && 全零 → 显 '0' 标签（带 data-role）", () => {
    const html = instanceCardHeaderHTML("P", 0, 0, 0, "complete");
    expect(html).toContain('<span class="tag" data-role="all-synced">0</span>');
  });

  it("状态计数以 data-role 落 DOM，且 📦 收口为可定位的 .pkg-icon / .instance-card-pkg-count", () => {
    const html = instanceCardHeaderHTML("P", 2, 5, 1, "missing", 0, true);
    expect(html).toContain('data-role="synced-count"');
    expect(html).toContain('data-role="missing-count"');
    expect(html).toContain('data-role="extra-count"');
    // ADR-238：包图标由 emoji 📦 改走 SVG（pkg-icon 容器内是 SVG）
    expect(html).toMatch(/<span class="pkg-icon" aria-hidden="true"><svg class="ws-icon"/);
    expect(html).toContain('<span class="instance-card-pkg-count">');
  });

  it("hasMod && 非全零 → 不显 '0' 标签", () => {
    const html = instanceCardHeaderHTML("P", 1, 0, 0, "complete");
    expect(html).not.toContain('<span class="tag">0</span>');
  });

  it("!hasMod && 全零 → 灰标签优先于 '0' 标签", () => {
    const html = instanceCardHeaderHTML("P", 0, 0, 0, "complete", 0, false);
    expect(html).toContain('<span class="tag gray"');
    expect(html).not.toContain('<span class="tag">0</span>');
    expect(html).not.toContain('class="tag red"');
  });

  it("name 经 esc 转义（防 XSS）", () => {
    const html = instanceCardHeaderHTML('<script>alert(1)</script>', 1, 0, 0, "complete");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("data-idx 透传（卡片展开/安装按钮定位用）", () => {
    const html = instanceCardHeaderHTML("P", 0, 0, 0, "complete", 7);
    expect(html).toContain('data-idx="7"');
  });
});
