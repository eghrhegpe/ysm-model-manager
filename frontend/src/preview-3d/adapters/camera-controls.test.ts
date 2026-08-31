// @vitest-environment happy-dom
// ===== 通用相机控件测试（camera-controls.ts）=====
// 覆盖：基本渲染 / orbit toggle / speed slider / bridge 接口调用 /
// reset 按钮 / bridge 方法为空时的降级。
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock i18n t（源文件顶层 import，否则 node 路径下 import 链会触发 window 副作用）
vi.mock("../../../core/i18n/t.ts", () => ({
  t: vi.fn((k: string) => k),
}));

// mock storage safeSet —— 验证 onchange/oninput 回调是否写入偏好
vi.mock("../../../utils/dom/storage.ts", () => ({
  safeSet: vi.fn(),
}));

import { buildCameraControls } from "./camera-controls.ts";
import type { CameraControlBridge } from "./camera-controls.ts";
import { safeSet } from "../../utils/dom/storage.ts";

function mkList(): HTMLElement {
  return document.createElement("div");
}

function mkBridge(overrides: Partial<CameraControlBridge> = {}): CameraControlBridge {
  const b: CameraControlBridge = {
    getOrbit: vi.fn(() => true),
    setOrbit: vi.fn(),
    getSpeed: vi.fn(() => 10),
    setSpeed: vi.fn(),
    reset: vi.fn(),
  };
  return Object.assign(b, overrides);
}

describe("buildCameraControls", () => {
  let list: HTMLElement;
  let bridge: CameraControlBridge;

  beforeEach(() => {
    list = mkList();
    bridge = mkBridge();
    (safeSet as ReturnType<typeof vi.fn>).mockClear();
  });

  it("基本渲染：生成旋转下拉、速度滑条、速度数值、重置按钮", () => {
    buildCameraControls(list, bridge);

    // 至少 2 个顶层 span（旋转标签 + 速度数值）
    // 注：createIconButton 内部也会产出 span，故只验"存在且文本可辨"
    const spans = list.querySelectorAll(":scope > span");
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const select = list.querySelector("select");
    const slider = list.querySelector("input[type=range]") as HTMLInputElement;
    const button = list.querySelector("button");
    expect(select).not.toBeNull();
    expect(slider).not.toBeNull();
    expect(button).not.toBeNull();

    // 下拉 testid
    expect(select!.dataset.testid).toBe("mmd-rot-mode");
    expect(select!.querySelectorAll("option").length).toBe(2);

    // 滑条区间
    expect(slider.min).toBe("2");
    expect(slider.max).toBe("200");

    // 旋转标签含 i18n key
    expect(spans[0].textContent).toContain("preview.cameraRotation");
  });

  it("初始值：根据 bridge.getOrbit/getSpeed 设置默认值", () => {
    buildCameraControls(list, bridge);
    const select = list.querySelector("select")! as HTMLSelectElement;
    const slider = list.querySelector("input[type=range]")! as HTMLInputElement;

    expect(bridge.getOrbit).toHaveBeenCalledTimes(1);
    expect(select.value).toBe("true");

    expect(bridge.getSpeed).toHaveBeenCalledTimes(2); // 一次赋值给 slider，一次给 span
    expect(slider.value).toBe("10");
    // 顶层 span 顺序：[0] rotLabel [1] spdLabel [2] spdVal
    const spdVal = list.querySelectorAll(":scope > span")[2] as HTMLElement;
    expect(spdVal.textContent).toBe("10");
  });

  it("orbit toggle：改变下拉 → 调用 setOrbit 并写入 td-rot-mode", () => {
    buildCameraControls(list, bridge);
    const select = list.querySelector("select")! as HTMLSelectElement;

    select.value = "false";
    select.dispatchEvent(new Event("change"));

    expect(bridge.setOrbit).toHaveBeenCalledTimes(1);
    expect(bridge.setOrbit).toHaveBeenCalledWith(false);
    expect(safeSet).toHaveBeenCalledWith("td-rot-mode", "free");

    select.value = "true";
    select.dispatchEvent(new Event("change"));

    expect(bridge.setOrbit).toHaveBeenCalledWith(true);
    expect(safeSet).toHaveBeenCalledWith("td-rot-mode", "orbit");
  });

  it("speed slider：拖动 → 调用 setSpeed 并更新数值显示", () => {
    buildCameraControls(list, bridge);
    const slider = list.querySelector("input[type=range]")! as HTMLInputElement;
    const spdVal = list.querySelectorAll(":scope > span")[2] as HTMLElement;

    slider.value = "50";
    slider.dispatchEvent(new Event("input"));

    expect(bridge.setSpeed).toHaveBeenCalledTimes(1);
    expect(bridge.setSpeed).toHaveBeenCalledWith(50);
    expect(spdVal.textContent).toBe("50");
    expect(safeSet).toHaveBeenCalledWith("td-cam-speed", "50");
  });

  it("bridge 接口：getOrbit / setOrbit / getSpeed / setSpeed / reset 均可被调用", () => {
    buildCameraControls(list, bridge);

    // 构造阶段已调用 getOrbit / getSpeed（各 1 次 + 1 次额外给 span）
    expect(bridge.getOrbit).toHaveBeenCalledTimes(1);
    expect(bridge.getSpeed).toHaveBeenCalledTimes(2);

    // 通过 UI 动作验证其余三个写接口被触达
    const select = list.querySelector("select")! as HTMLSelectElement;
    const slider = list.querySelector("input[type=range]")! as HTMLInputElement;
    const resetBtn = list.querySelector("button")!;

    select.value = "false";
    select.dispatchEvent(new Event("change"));
    expect(bridge.setOrbit).toHaveBeenCalledWith(false);

    slider.value = "80";
    slider.dispatchEvent(new Event("input"));
    expect(bridge.setSpeed).toHaveBeenCalledWith(80);

    resetBtn.click();
    expect(bridge.reset).toHaveBeenCalledTimes(1);
  });

  it("reset 按钮：点击调用 bridge.reset", () => {
    buildCameraControls(list, bridge);
    const resetBtn = list.querySelector("button")!;
    expect(resetBtn.textContent).toContain("⟲");

    resetBtn.click();
    expect(bridge.reset).toHaveBeenCalledTimes(1);
  });

  it("入参为空/异常：bridge 方法为空时不抛错（降级）", () => {
    // getOrbit / getSpeed 返回异常值 —— 字符串化后仍合法
    const brittle: CameraControlBridge = {
      getOrbit: vi.fn(() => true),
      setOrbit: undefined as unknown as (v: boolean) => void,
      getSpeed: vi.fn(() => 10),
      setSpeed: undefined as unknown as (v: number) => void,
      reset: undefined as unknown as () => void,
    };
    // 构造阶段应不抛错
    expect(() => buildCameraControls(list, brittle)).not.toThrow();

    const select = list.querySelector("select")! as HTMLSelectElement;
    const slider = list.querySelector("input[type=range]")! as HTMLInputElement;
    const resetBtn = list.querySelector("button")!;

    // 此时点击 UI 会抛 ReferenceError —— 但控件本身渲染完成
    // 这里只验证"渲染阶段不崩溃"，运行时调用空 bridge 的方法属调用方职责
    expect(list.contains(select)).toBe(true);
    expect(list.contains(slider)).toBe(true);
    expect(list.contains(resetBtn)).toBe(true);
  });

  it("getSpeed 返回异常（NaN）：滑条回退到初始值不崩溃", () => {
    const bridgeBad = mkBridge({
      getSpeed: vi.fn(() => NaN),
    });
    // String(NaN) 合法，控件仍可渲染
    expect(() => buildCameraControls(list, bridgeBad)).not.toThrow();
    const slider = list.querySelector("input[type=range]")! as HTMLInputElement;
    // input range 遇到非法 value 会回退到 min
    expect(slider.value).not.toBe("");
  });
});
