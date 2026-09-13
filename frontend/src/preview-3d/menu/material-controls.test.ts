// ===== material-controls 材质面板测试（[doc:adr-126-p5] 审计 #3：material 声明式化）=====
// 覆盖：materialNodes（组合行节点结构 / 空态 / eye-opacity 闭包经 bridge 下沉）。
// 旧 buildMaterialControls（MMD/VRM 各一份手写 DOM）已删除——节点契约由本文件锁定。

import { describe, it, expect, vi } from "vitest";
import { materialNodes, type MaterialBridgeLike } from "./material-controls.ts";

function makeBridge(overrides: Partial<MaterialBridgeLike> = {}): MaterialBridgeLike {
  return {
    list: () => [
      { index: 0, name: "Body" },
      { index: 1, name: "Face" },
    ],
    getDetail: (i) => ({ visible: i === 0, opacity: i === 0 ? 0.8 : 1 }),
    setVisible: vi.fn(),
    setOpacity: vi.fn(),
    ...overrides,
  };
}

describe("materialNodes（组合行声明式节点）", () => {
  it("每材质一行 material-row（id/labelKey = 材质名），eye/opacity 闭包齐备", () => {
    const nodes = materialNodes(makeBridge());
    expect(nodes.map((n) => n.id)).toEqual(["mat-0", "mat-1"]);
    expect(nodes.every((n) => n.kind === "material-row")).toBe(true);
    expect(nodes[0]).toMatchObject({ labelKey: "Body", fallback: "Body" });
    expect(typeof nodes[0].eye?.get).toBe("function");
    expect(typeof nodes[0].opacity?.get).toBe("function");
  });

  it("空态（list 空）→ 提示 field 节点（对齐旧「（无材质）」行）", () => {
    const nodes = materialNodes(makeBridge({ list: () => [] }));
    expect(nodes).toEqual([
      { id: "mat-empty", kind: "field", labelKey: "preview.noMaterial", fallback: "（无材质）", value: "" },
    ]);
  });

  it("eye 闭包：get 读 bridge 显隐，set 调 setVisible", () => {
    const bridge = makeBridge();
    const nodes = materialNodes(bridge);
    expect(nodes[0].eye?.get()).toBe(true);
    nodes[0].eye?.set(false);
    expect(bridge.setVisible).toHaveBeenCalledWith(0, false);
  });

  it("opacity 闭包：get 返回 0-100 显示值，set 收 0-100 转 0-1 调 setOpacity", () => {
    const bridge = makeBridge();
    const nodes = materialNodes(bridge);
    expect(nodes[0].opacity?.get()).toBe(80); // 0.8 → 80
    nodes[0].opacity?.set(50);
    expect(bridge.setOpacity).toHaveBeenCalledWith(0, 0.5);
  });
});
