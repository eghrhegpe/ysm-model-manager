// ===== cap-to-node 桥接层测试（ADR-195 刀1：spec 同构映射）=====
// 验证 MenuControlDef[] → PreviewMenuNode[] 转换：
//   - 简单控件（toggle/slider/select/divider/color）→ 原生节点 kind + control 同构 spec
//   - 复杂控件（button/timeline/histogram/image/preset-thumb）→ controls 通道节点
//   - group → folder 嵌套（连续同组合并、组间断开另起）
//   - visibleWhen 随迁节点层
//   - 往返保真：capControlToNode → nodeControlToCapControl 字段零损失
import { describe, it, expect } from "vitest";
import { capControlToNode, capControlsToNodes, canNodeRepresent } from "./cap-to-node.ts";
import type { MenuControlDef } from "../caps/scene-capability.ts";
import { nodeControlToCapControl } from "./render.ts";

function def(partial: Partial<MenuControlDef> & { id: string; kind: MenuControlDef["kind"] }): MenuControlDef {
  return {
    labelKey: `preview.${partial.id}`,
    fallback: partial.id,
    getValue: () => null,
    setValue: () => {},
    ...partial,
  } as MenuControlDef;
}

describe("canNodeRepresent（原生 vs controls 通道）", () => {
  it("toggle/slider/select/divider/color 原生", () => {
    for (const k of ["toggle", "slider", "select", "divider", "color"] as const) {
      expect(canNodeRepresent(def({ id: `x-${k}`, kind: k })), k).toBe(true);
    }
  });
  it("button/timeline/histogram/image/preset-thumb 走 controls 通道", () => {
    for (const k of ["button", "timeline", "histogram", "image", "preset-thumb"] as const) {
      expect(canNodeRepresent(def({ id: `x-${k}`, kind: k })), k).toBe(false);
    }
  });
});

describe("capControlToNode（原生节点映射）", () => {
  it("slider 带 unit/numeric/onCommit/visibleWhen → 原生 slider 节点 + spec 同构", () => {
    const vw = (_s: Record<string, unknown>): boolean => true;
    const c = def({
      id: "sky-time",
      kind: "slider",
      labelKey: "preview.timeOfDay",
      fallback: "时间",
      group: "preview.skyGroup",
      slider: { min: 0, max: 24, step: 0.5, unit: "h", numeric: true, onCommit: (v) => void v },
      getValue: () => 12,
      setValue: () => {},
      visibleWhen: vw,
    });
    const n = capControlToNode(c);
    expect(n.kind).toBe("slider");
    expect(n.id).toBe("sky-time");
    expect(n.hintKey).toBeUndefined();
    expect(n.visibleWhen).toBe(vw);
    const spec = n.control!;
    expect(spec.min).toBe(0);
    expect(spec.max).toBe(24);
    expect(spec.step).toBe(0.5);
    expect(spec.unit).toBe("h");
    expect(spec.numeric).toBe(true);
    expect(typeof spec.onCommit).toBe("function");
  });

  it("往返保真：capControlToNode → nodeControlToCapControl 字段零损失", () => {
    const c = def({
      id: "fog-density",
      kind: "slider",
      slider: { min: 0.01, max: 1, step: 0.01, unit: "" },
      getValue: () => 0.5,
      setValue: () => {},
    });
    const n = capControlToNode(c);
    const back = nodeControlToCapControl(n as never, {}, undefined as never);
    expect(back.kind).toBe("slider");
    expect(back.slider!.min).toBe(0.01);
    expect(back.slider!.max).toBe(1);
    expect(back.slider!.unit).toBe("");
    expect(back.getValue()).toBe(0.5);
  });

  it("toggle hintKey 透传节点", () => {
    const c = def({
      id: "shadow-enabled",
      kind: "toggle",
      hintKey: "preview.shadowEnabledHint",
      getValue: () => true,
      setValue: () => {},
    });
    const n = capControlToNode(c);
    expect(n.kind).toBe("toggle");
    expect(n.hintKey).toBe("preview.shadowEnabledHint");
  });

  it("color → 原生 color 节点", () => {
    const c = def({
      id: "fog-color",
      kind: "color",
      getValue: () => 0x112233,
      setValue: () => {},
    });
    const n = capControlToNode(c);
    expect(n.kind).toBe("color");
    expect(n.control!.get!(undefined)).toBe(0x112233);
  });

  it("divider → 原生 divider 节点（无 control）", () => {
    const n = capControlToNode(def({ id: "d1", kind: "divider" }));
    expect(n.kind).toBe("divider");
    expect(n.control).toBeUndefined();
  });
});

describe("capControlsToNodes（整组 → folder 嵌套 + controls 通道）", () => {
  it("无 group 简单控件平铺顶层；复杂控件保序平铺", () => {
    const nodes = capControlsToNodes([
      def({ id: "a", kind: "toggle" }),
      def({ id: "tl", kind: "timeline" }),
      def({ id: "b", kind: "slider" }),
      def({ id: "hdr", kind: "button" }),
    ]);
    expect(nodes).toHaveLength(4);
    expect(nodes[0]!.kind).toBe("toggle");
    expect(nodes[1]!.kind).toBe("controls"); // timeline → controls 通道
    expect(nodes[1]!.id).toBe("cap-tl");
    expect(nodes[2]!.kind).toBe("slider");
    expect(nodes[3]!.kind).toBe("controls"); // button → controls 通道（节点 button 行壳不承载 variant）
  });

  it("同 group 连续控件包进一个 folder；组间断开另起 folder", () => {
    const nodes = capControlsToNodes([
      def({ id: "a", kind: "toggle", group: "preview.grp1" }),
      def({ id: "b", kind: "slider", group: "preview.grp1" }),
      def({ id: "c", kind: "toggle" }),
      def({ id: "d", kind: "select", group: "preview.grp2" }),
    ]);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.kind).toBe("folder");
    expect(nodes[0]!.labelKey).toBe("preview.grp1");
    expect(nodes[0]!.children!.map((n) => n.id)).toEqual(["a", "b"]);
    expect(nodes[1]!.kind).toBe("toggle");
    expect(nodes[1]!.id).toBe("c");
    expect(nodes[2]!.kind).toBe("folder");
    expect(nodes[2]!.labelKey).toBe("preview.grp2");
    expect(nodes[2]!.children!.map((n) => n.id)).toEqual(["d"]);
  });

  it("divider 平铺且不归入 folder（断组）", () => {
    const nodes = capControlsToNodes([
      def({ id: "d1", kind: "divider" }),
      def({ id: "a", kind: "toggle", group: "preview.g" }),
    ]);
    expect(nodes[0]!.kind).toBe("divider");
    expect(nodes[1]!.kind).toBe("folder");
  });

  it("空输入 → 空节点数组", () => {
    expect(capControlsToNodes([])).toEqual([]);
  });
});
