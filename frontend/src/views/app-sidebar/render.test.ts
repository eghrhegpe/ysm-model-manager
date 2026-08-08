// ===== sidebar 渲染层测试 =====
// 覆盖：renderVersionCards 空/非空、vcHeaderHTML 各 chips 分支
import { describe, it, expect, vi } from "vitest";

const { vcHeaderHTML } = vi.hoisted(() => ({
  vcHeaderHTML: vi.fn(() => '<div class="vc-header"></div>'),
}));

vi.mock("./tpl.ts", () => ({ vcHeaderHTML }));

import { renderVersionCards } from "./render.ts";
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
  it("空实例 → 显示未找到提示，不调用 vcHeaderHTML", () => {
    const container = document.createElement("div");
    renderVersionCards(container, []);
    expect(container.innerHTML).toContain("未找到匹配的整合包");
    expect(vcHeaderHTML).not.toHaveBeenCalled();
  });

  it("非空实例 → 生成 vc 卡片，传递全部字段与 idx", () => {
    const container = document.createElement("div");
    renderVersionCards(container, [
      instance({ name: "P1", synced: 3, missing: 2, extra: 1, status: "missing", hasMod: false, rtype: "pack" }),
      instance({ name: "P2" }),
    ]);

    const cards = container.querySelectorAll(".vc");
    expect(cards).toHaveLength(2);
    expect(cards[0].dataset.idx).toBe("0");
    expect(cards[1].dataset.idx).toBe("1");
    expect(cards[0].style.animationDelay).toBe("0ms");
    expect(cards[1].style.animationDelay).toBe("40ms");
    expect(vcHeaderHTML).toHaveBeenNthCalledWith(1, "P1", 3, 2, 1, "missing", 0, false, "pack");
    expect(vcHeaderHTML).toHaveBeenNthCalledWith(2, "P2", 2, 1, 0, "complete", 1, true, "ysm");
  });
});
