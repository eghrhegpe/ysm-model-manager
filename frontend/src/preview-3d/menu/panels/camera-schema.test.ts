// ===== buildCameraSchema 声明式迁移测试（ADR-193 第一刀：camera renderCustom 退役）=====
// 旧实现：kind:"custom" + renderCustom 拼 DOM（buildCameraControls）——逃生舱通道。
// 新实现：select/slider/button 三声明式节点，control 闭包走 CameraControlBridge。
// 渲染链路级交互测试见 litematic-3d.test.ts「camera 面板」组（真实 SlideMenu 弹层）。
import { describe, expect, it, vi } from "vitest";
import type { CameraControlBridge } from "@/preview-3d/infra/camera-controls.ts";
import { TD_CAM_SPEED, TD_PIXEL_RATIO, TD_ROT_MODE } from "@/preview-3d/infra/settings-schema.ts";
import type { PreviewMenuCtx } from "@/preview-3d/menu/schema/node-types.ts";
import { buildCameraSchema, buildCrossCuttingNodes } from "./settings.ts";

function makeBridge(): CameraControlBridge & { orbit: boolean; speed: number; resets: number } {
  return {
    orbit: true,
    speed: 30,
    resets: 0,
    getOrbit() {
      return this.orbit;
    },
    setOrbit(v) {
      this.orbit = v;
    },
    getSpeed() {
      return this.speed;
    },
    setSpeed(n) {
      this.speed = n;
    },
    reset() {
      this.resets++;
    },
  };
}

function makeCtx(bridge: ReturnType<typeof makeBridge>): PreviewMenuCtx {
  return {
    selfMode: false,
    getCap: () => null,
    getCamBridge: () => bridge,
    getSiblings: () => [],
    getCurrentPath: () => "",
    getViewContainer: (): HTMLElement => document.createElement("div"),
    close: () => {},
    switchTo: () => {},
    toast: () => {},
    closeAllOverlays: () => {},
  };
}

describe("buildCameraSchema（ADR-193 第一刀：声明式三节点）", () => {
  it("产出 select/slider/button 三节点，零 renderCustom（逃生舱通道退役）", () => {
    const nodes = buildCameraSchema(makeCtx(makeBridge()));
    expect(nodes.map((n) => n.kind)).toEqual(["select", "slider", "button"]);
    expect(nodes.every((n) => n.renderCustom === undefined)).toBe(true);
    expect(nodes.map((n) => n.id)).toEqual(["camera-orbit", "camera-speed", "camera-reset"]);
  });

  it("orbit select：get 读桥、set 写桥 + 持久化（键/枚举消费 settings-schema）", () => {
    const bridge = makeBridge();
    const node = buildCameraSchema(makeCtx(bridge))[0]!;
    expect(node.control!.options).toEqual([
      { value: TD_ROT_MODE.orbit, label: "环绕", labelKey: "preview.cameraRotationOrbit" },
      { value: TD_ROT_MODE.free, label: "自身", labelKey: "preview.cameraRotationFree" },
    ]);
    expect(node.control!.get!(undefined)).toBe(TD_ROT_MODE.orbit);
    node.control!.set!(TD_ROT_MODE.free);
    expect(bridge.orbit).toBe(false);
    expect(localStorage.getItem(TD_ROT_MODE.key)).toBe(TD_ROT_MODE.free);
  });

  it("speed slider：min/max/step 消费 settings-schema（ADR-303 收口三份副本），set 写桥 + 持久化", () => {
    const bridge = makeBridge();
    const node = buildCameraSchema(makeCtx(bridge))[1]!;
    expect(node.control!.min).toBe(TD_CAM_SPEED.min);
    expect(node.control!.max).toBe(TD_CAM_SPEED.max);
    expect(node.control!.step).toBe(TD_CAM_SPEED.step);
    expect(node.control!.get!(undefined)).toBe(30);
    node.control!.set!(55);
    expect(bridge.speed).toBe(55);
    expect(localStorage.getItem(TD_CAM_SPEED.key)).toBe("55");
  });

  it("像素比上限 slider：值域消费 settings-schema（与 render-budget clamp 同源）", () => {
    const node = buildCrossCuttingNodes().find((n) => n.id === "settings-pixel-ratio")!;
    expect(node.control!.min).toBe(TD_PIXEL_RATIO.min);
    expect(node.control!.max).toBe(TD_PIXEL_RATIO.max);
    expect(node.control!.step).toBe(TD_PIXEL_RATIO.step);
  });

  it("reset button：action 经桥触发 reset（桥每渲染重取，不捕获过期实例）", () => {
    const bridge = makeBridge();
    const node = buildCameraSchema(makeCtx(bridge))[2]!;
    node.action!({ toast: vi.fn(), closeAllOverlays: vi.fn() });
    expect(bridge.resets).toBe(1);
  });

  it("桥经 ctx.getCamBridge() 惰性重取：换桥后节点读写落新桥（禁构建期捕获）", () => {
    const a = makeBridge();
    const b = makeBridge();
    b.orbit = false;
    let cur = a;
    const ctx = makeCtx(cur as ReturnType<typeof makeBridge>);
    const dyn = { ...ctx, getCamBridge: () => cur };
    const node = buildCameraSchema(dyn)[0]!;
    expect(node.control!.get!(undefined)).toBe(TD_ROT_MODE.orbit);
    cur = b;
    expect(node.control!.get!(undefined)).toBe(TD_ROT_MODE.free);
  });
});
