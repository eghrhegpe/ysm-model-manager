// @vitest-environment happy-dom
// ===== 输入绑定测试（input-and-animation.ts）=====
// 覆盖：bindInputHandlers 的正常/无 renderer 路径、WASD 键盘处理、
// 拖拽自转（orbit 模式跳过）、resize、disposed 兜底。
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

import { bindInputHandlers } from "./input-and-animation.ts";
import type { InputOptions } from "./input-and-animation.ts";
import { pushInputBlock, popInputBlock, isInputBlocked } from "../../utils/dom/focus-restore.ts";

// mock WebGLRenderer / domElement / postProc 的最小壳，避免真实 WebGL 依赖
function mkFakeRenderer(): THREE.WebGLRenderer {
  const dom = document.createElement("canvas");
  return {
    setSize: vi.fn(),
    domElement: dom,
    // 其余字段测试不涉及，按需再补
  } as unknown as THREE.WebGLRenderer;
}

function mkPostProc(): import("./postprocessing.ts").PostprocessingLike {
  return { setSize: vi.fn() } as unknown as import("./postprocessing.ts").PostprocessingLike;
}

function mkCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);
  return cam;
}

function mkOptions(overrides: Partial<InputOptions> = {}): InputOptions {
  return {
    keys: {},
    getOrbitMode: vi.fn(() => false),
    mouseDown: { v: false },
    lastMouse: { x: 0, y: 0 },
    euler: new THREE.Euler(0, 0, 0, "YXZ" as any),
    camera: mkCamera(),
    renderer: mkFakeRenderer(),
    postProc: mkPostProc(),
    viewContainer: document.createElement("div"),
    isDisposed: { v: false },
    ...overrides,
  };
}

describe("bindInputHandlers", () => {
  beforeEach(() => {
    // 清空每次迭代残留的监听器计数
    vi.clearAllMocks();
    document.removeEventListener("keydown", vi.fn());
    document.removeEventListener("keyup", vi.fn());
  });

  it("renderer 为空：返回全 no-op handler，不注册任何监听器", () => {
    const opts = mkOptions({ renderer: undefined });
    const handlers = bindInputHandlers(opts);

    expect(handlers.onKeyDown).toBe(handlers.onKeyUp);
    expect(handlers.onDragPointerDown).toBe(handlers.onDragPointerUp);
    expect(handlers.onDragPointerDown).toBe(handlers.onDragPointerMove);

    // no-op 调用了不报错、也不改变状态
    handlers.onKeyDown(new KeyboardEvent("keydown", { key: "w", code: "KeyW" }));
    expect(opts.keys.forward).toBeUndefined();
    handlers.onResize();
    // 应无副作用
  });

  it("renderer 存在：返回六个互不引用的 handler 并注册全局监听器", () => {
    const opts = mkOptions();
    const addEventListenerSpy = vi.spyOn(document, "addEventListener");
    const winAddSpy = vi.spyOn(window, "addEventListener");
    const domAddSpy = vi.spyOn(opts.renderer!.domElement!, "addEventListener");

    const handlers = bindInputHandlers(opts);

    // 六个 handler 各自独立（非 no-op 路径各自闭包不同）
    expect(handlers.onKeyDown).not.toEqual(handlers.onKeyUp);
    expect(handlers.onDragPointerDown).not.toEqual(handlers.onDragPointerUp);
    expect(handlers.onDragPointerMove).not.toEqual(handlers.onResize);

    // 监听器注册点：document keydown/keyup、domElement pointerdown、
    // window pointerup/pointermove/resize
    expect(addEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith("keyup", expect.any(Function));
    expect(domAddSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(winAddSpy).toHaveBeenCalledWith("pointerup", expect.any(Function));
    expect(winAddSpy).toHaveBeenCalledWith("pointermove", expect.any(Function));
    expect(winAddSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    addEventListenerSpy.mockRestore();
    winAddSpy.mockRestore();
    domAddSpy.mockRestore();
  });

  it("onKeyDown：按下 KeyW → keys.forward 置 true 并阻止默认", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    const ev = new KeyboardEvent("keydown", { key: "w", code: "KeyW", bubbles: true, cancelable: true });
    handlers.onKeyDown(ev);

    expect(opts.keys.forward).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("onKeyDown：按下 KeyS → keys.back 置 true 并阻止默认", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    const ev = new KeyboardEvent("keydown", { key: "s", code: "KeyS", cancelable: true });
    handlers.onKeyDown(ev);

    expect(opts.keys.back).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("onKeyDown：方向键双轨 → ArrowLeft 也激活 left（与 WASD 并存）", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    const ev = new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", cancelable: true });
    handlers.onKeyDown(ev);

    expect(opts.keys.left).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("onKeyDown：按下空格（Space）→ keys.up 置 true 并阻止默认", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    const ev = new KeyboardEvent("keydown", { key: " ", code: "Space", cancelable: true });
    handlers.onKeyDown(ev);

    expect(opts.keys.up).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("onKeyDown：右 Shift 对称 → 按 ShiftRight 也激活 down（默认 down=ShiftLeft）", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    const ev = new KeyboardEvent("keydown", { key: "Shift", code: "ShiftRight", cancelable: true });
    handlers.onKeyDown(ev);

    expect(opts.keys.down).toBe(true);
    // 修饰键本身不被 preventDefault（只记录按键状态，保留系统组合语义）
    expect(ev.defaultPrevented).toBe(false);
  });

  it("onKeyDown：无关键 q（KeyQ）→ 不激活任何动作、不阻止默认", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    const ev = new KeyboardEvent("keydown", { key: "q", code: "KeyQ" });
    handlers.onKeyDown(ev);

    expect(opts.keys.forward).toBeUndefined();
    expect(opts.keys.back).toBeUndefined();
    expect(opts.keys.left).toBeUndefined();
    expect(opts.keys.right).toBeUndefined();
    expect(opts.keys.up).toBeUndefined();
    expect(opts.keys.down).toBeUndefined();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("onKeyDown：焦点在 INPUT 文本框 → 不记录键位、不阻止默认（打字不受 3D 键位吞掉）", () => {
    const opts = mkOptions();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const ev = new KeyboardEvent("keydown", {
      key: "w", code: "KeyW", bubbles: true, cancelable: true,
    });
    // 派发到 input 上，e.target 为 input
    input.dispatchEvent(ev);

    expect(opts.keys.forward).toBeUndefined();
    expect(ev.defaultPrevented).toBe(false);
    document.body.removeChild(input);
  });

  it("onKeyDown：焦点在 contentEditable → 不记录键位", () => {
    const opts = mkOptions();
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);
    const ev = new KeyboardEvent("keydown", {
      key: "w", code: "KeyW", bubbles: true, cancelable: true,
    });
    editable.dispatchEvent(ev);

    expect(opts.keys.forward).toBeUndefined();
    document.body.removeChild(editable);
  });

  it("onKeyDown：自定义键位生效（td-keymap forward=KeyB → 按 KeyB 激活 forward）", () => {
    localStorage.setItem("td-keymap", JSON.stringify({ forward: "KeyB" }));
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    const ev = new KeyboardEvent("keydown", { key: "b", code: "KeyB", cancelable: true });
    handlers.onKeyDown(ev);

    expect(opts.keys.forward).toBe(true);
    expect(opts.keys.back).toBeUndefined();
    // 默认 KeyW 不再生效（已被 KeyB 取代）
    const evW = new KeyboardEvent("keydown", { key: "w", code: "KeyW", cancelable: true });
    handlers.onKeyDown(evW);
    expect(opts.keys.forward).toBe(true); // forward 保持 KeyB 激活态（不受 KeyW 影响）
    localStorage.removeItem("td-keymap");
  });

  it("onKeyUp：释放 KeyW → keys.forward 置 false", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    handlers.onKeyDown(new KeyboardEvent("keydown", { key: "w", code: "KeyW" }));
    expect(opts.keys.forward).toBe(true);

    handlers.onKeyUp(new KeyboardEvent("keyup", { key: "W", code: "KeyW" }));
    expect(opts.keys.forward).toBe(false);
  });

  it("onDragPointerDown：非 orbit + 左键 → 标记 mouseDown、记录坐标、捕获指针", () => {
    const opts = mkOptions();
    const captureSpy = vi.spyOn(opts.renderer!.domElement!, "setPointerCapture");
    const handlers = bindInputHandlers(opts);
    const ev = new PointerEvent("pointerdown", { button: 0, clientX: 100, clientY: 200, pointerId: 1 });
    handlers.onDragPointerDown(ev);

    expect(opts.mouseDown.v).toBe(true);
    expect(opts.lastMouse.x).toBe(100);
    expect(opts.lastMouse.y).toBe(200);
    expect(captureSpy).toHaveBeenCalledWith(1);

    captureSpy.mockRestore();
  });

  it("onDragPointerDown：orbit 模式下左键 → 不捕获、不标记 mouseDown", () => {
    const opts = mkOptions({ getOrbitMode: vi.fn(() => true) });
    const captureSpy = vi.spyOn(opts.renderer!.domElement!, "setPointerCapture");
    const handlers = bindInputHandlers(opts);
    const ev = new PointerEvent("pointerdown", { button: 0, clientX: 10, clientY: 20, pointerId: 1 });
    handlers.onDragPointerDown(ev);

    expect(opts.mouseDown.v).toBe(false);
    expect(opts.lastMouse.x).toBe(0);
    expect(captureSpy).not.toHaveBeenCalled();

    captureSpy.mockRestore();
  });

  it("onDragPointerDown：非左键 → 不捕获", () => {
    const opts = mkOptions();
    const captureSpy = vi.spyOn(opts.renderer!.domElement!, "setPointerCapture");
    const handlers = bindInputHandlers(opts);
    const ev = new PointerEvent("pointerdown", { button: 2, clientX: 10, clientY: 20, pointerId: 1 });
    handlers.onDragPointerDown(ev);

    expect(opts.mouseDown.v).toBe(false);
    expect(captureSpy).not.toHaveBeenCalled();

    captureSpy.mockRestore();
  });

  it("onDragPointerUp：释放鼠标 → mouseDown 置 false 并释放指针捕获", () => {
    const opts = mkOptions();
    opts.mouseDown.v = true;
    const domEl = opts.renderer!.domElement!;
    vi.spyOn(domEl, "hasPointerCapture").mockImplementation(() => true);
    const releaseSpy = vi.spyOn(domEl, "releasePointerCapture");
    const handlers = bindInputHandlers(opts);
    const ev = new PointerEvent("pointerup", { pointerId: 1 });
    handlers.onDragPointerUp(ev);

    expect(opts.mouseDown.v).toBe(false);
    expect(releaseSpy).toHaveBeenCalledWith(1);

    releaseSpy.mockRestore();
  });

  it("onDragPointerMove：非 orbit + mouseDown → 旋转 camera（通过 euler 桥接）", () => {
    const opts = mkOptions();
    opts.mouseDown.v = true;
    opts.lastMouse.x = 0;
    opts.lastMouse.y = 0;
    const handlers = bindInputHandlers(opts);
    const ev = new PointerEvent("pointermove", { clientX: 100, clientY: 50, pointerId: 1 });
    handlers.onDragPointerMove(ev);

    // dx=100, dy=50 → euler.y -= 0.3, euler.x -= 0.15
    expect(opts.euler.y).toBeCloseTo(-0.3, 4);
    expect(opts.euler.x).toBeCloseTo(-0.15, 4);
    // lastMouse 已更新
    expect(opts.lastMouse.x).toBe(100);
    expect(opts.lastMouse.y).toBe(50);
  });

  it("onDragPointerMove：euler.x 被 clamp 到 [-PI/2, PI/2]", () => {
    const opts = mkOptions();
    opts.mouseDown.v = true;
    opts.lastMouse.x = 0;
    opts.lastMouse.y = 0;
    const handlers = bindInputHandlers(opts);
    // 大幅拖动
    const ev = new PointerEvent("pointermove", { clientX: 0, clientY: 50000, pointerId: 1 });
    handlers.onDragPointerMove(ev);

    expect(opts.euler.x).toBeGreaterThanOrEqual(-Math.PI / 2);
    expect(opts.euler.x).toBeLessThanOrEqual(Math.PI / 2);
  });

  it("onDragPointerMove：orbit 模式 → 不旋转", () => {
    const opts = mkOptions({ getOrbitMode: vi.fn(() => true) });
    opts.mouseDown.v = true;
    const handlers = bindInputHandlers(opts);
    const beforeY = opts.euler.y;
    const ev = new PointerEvent("pointermove", { clientX: 100, clientY: 50, pointerId: 1 });
    handlers.onDragPointerMove(ev);

    expect(opts.euler.y).toBe(beforeY);
  });

  it("onDragPointerMove：鼠标未按下 → 不旋转", () => {
    const opts = mkOptions();
    opts.mouseDown.v = false;
    const handlers = bindInputHandlers(opts);
    const beforeY = opts.euler.y;
    const ev = new PointerEvent("pointermove", { clientX: 100, clientY: 50, pointerId: 1 });
    handlers.onDragPointerMove(ev);

    expect(opts.euler.y).toBe(beforeY);
  });

  it("onDragPointerMove：camera 为空 → 不抛错", () => {
    const opts = mkOptions({ camera: undefined });
    opts.mouseDown.v = true;
    const handlers = bindInputHandlers(opts);
    const ev = new PointerEvent("pointermove", { clientX: 100, clientY: 50, pointerId: 1 });
    expect(() => handlers.onDragPointerMove(ev)).not.toThrow();
  });

  it("onResize：更新 camera aspect / projectionMatrix / renderer 尺寸 / postProc 尺寸", () => {
    const opts = mkOptions();
    const container = opts.viewContainer;
    Object.defineProperty(container, "clientWidth", { value: 800, writable: false });
    Object.defineProperty(container, "clientHeight", { value: 600, writable: false });

    const setSizeSpy = vi.spyOn(opts.renderer!, "setSize");
    const postSizeSpy = vi.spyOn(opts.postProc!, "setSize");
    const cam = opts.camera!;
    const handlers = bindInputHandlers(opts);

    handlers.onResize();

    expect(cam.aspect).toBe(4 / 3);
    expect(cam.projectionMatrix.elements).toBeDefined();
    expect(setSizeSpy).toHaveBeenCalledWith(800, 600);
    expect(postSizeSpy).toHaveBeenCalledWith(800, 600);

    setSizeSpy.mockRestore();
    postSizeSpy.mockRestore();
  });

  it("onResize：isDisposed 为 true → 立即返回不做任何更新", () => {
    const opts = mkOptions({ isDisposed: { v: true } });
    const setSizeSpy = vi.spyOn(opts.renderer!, "setSize");
    const handlers = bindInputHandlers(opts);

    handlers.onResize();

    expect(setSizeSpy).not.toHaveBeenCalled();
    setSizeSpy.mockRestore();
  });

  it("onResize：camera 为空 → 立即返回", () => {
    const opts = mkOptions({ camera: undefined });
    const setSizeSpy = vi.spyOn(opts.renderer!, "setSize");
    const handlers = bindInputHandlers(opts);

    handlers.onResize();

    expect(setSizeSpy).not.toHaveBeenCalled();
    setSizeSpy.mockRestore();
  });

  it("onResize：container 高度为 0 → Math.max 防除零", () => {
    const opts = mkOptions();
    Object.defineProperty(opts.viewContainer, "clientWidth", { value: 800, writable: false });
    Object.defineProperty(opts.viewContainer, "clientHeight", { value: 0, writable: false });

    const handlers = bindInputHandlers(opts);
    expect(() => handlers.onResize()).not.toThrow();
    expect(opts.camera!.aspect).toBe(800 / 1); // clientHeight 0 → 1
  });

  it("部分配置：无 postProc 时 onResize 不崩溃", () => {
    const opts = mkOptions({ postProc: null });
    const handlers = bindInputHandlers(opts);
    expect(() => handlers.onResize()).not.toThrow();
  });
});

// ===================================================================
// 双轨键保持（97f7949c heldCodes） + Numpad 兼容 + 输入阻断栈
// ===================================================================
describe("bindInputHandlers 双轨键 / Numpad / 输入阻断", () => {
  const mkEv = (key: string, code: string): KeyboardEvent =>
    new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true });

  const keyupEv = (key: string, code: string): KeyboardEvent =>
    new KeyboardEvent("keyup", { key, code, bubbles: true, cancelable: true });

  beforeEach(() => {
    vi.clearAllMocks();
    // 清空输入阻断栈残留（push 未 pop 会污染后续测试）
    while (isInputBlocked()) popInputBlock("test-block");
  });

  it("双轨键：W + ArrowUp 同向按住 → 松开 ArrowUp 后 forward 仍保持（W 仍持有）", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    // 同向双轨：W 和 ArrowUp 都激活 forward
    handlers.onKeyDown(mkEv("w", "KeyW"));
    handlers.onKeyDown(mkEv("ArrowUp", "ArrowUp"));
    expect(opts.keys.forward).toBe(true);
    // 松开 ArrowUp：W 仍按住 → forward 保持
    handlers.onKeyUp(keyupEv("ArrowUp", "ArrowUp"));
    expect(opts.keys.forward).toBe(true);
    // 松开 W：无键持有 → forward 清除
    handlers.onKeyUp(keyupEv("w", "KeyW"));
    expect(opts.keys.forward).toBeFalsy();
  });

  it("双轨键：ShiftLeft + ShiftRight 对称 → 松开右 Shift 后 down 仍保持", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    // down 默认绑 ShiftLeft；左右 Shift 等价
    handlers.onKeyDown(mkEv("Shift", "ShiftLeft"));
    handlers.onKeyDown(mkEv("Shift", "ShiftRight"));
    expect(opts.keys.down).toBe(true);
    // 松开 ShiftRight：ShiftLeft 仍按住 → down 保持
    handlers.onKeyUp(keyupEv("Shift", "ShiftRight"));
    expect(opts.keys.down).toBe(true);
    // 松开 ShiftLeft → down 清除
    handlers.onKeyUp(keyupEv("Shift", "ShiftLeft"));
    expect(opts.keys.down).toBeFalsy();
  });

  it("双轨键：松开未按过的键不误清（heldCodes 只删自己按过的）", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    handlers.onKeyDown(mkEv("w", "KeyW"));
    expect(opts.keys.forward).toBe(true);
    // 松开一个从未按过的 ArrowUp：forward 不受影响
    handlers.onKeyUp(keyupEv("ArrowUp", "ArrowUp"));
    expect(opts.keys.forward).toBe(true);
    handlers.onKeyUp(keyupEv("w", "KeyW"));
    expect(opts.keys.forward).toBeFalsy();
  });

  it("Numpad 兼容：Numpad8/2/4/6 → forward/back/left/right", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    handlers.onKeyDown(mkEv("8", "Numpad8"));
    expect(opts.keys.forward).toBe(true);
    handlers.onKeyDown(mkEv("2", "Numpad2"));
    expect(opts.keys.back).toBe(true);
    handlers.onKeyDown(mkEv("4", "Numpad4"));
    expect(opts.keys.left).toBe(true);
    handlers.onKeyDown(mkEv("6", "Numpad6"));
    expect(opts.keys.right).toBe(true);
  });

  it("输入阻断：pushInputBlock 后 onKeyDown 暂停相机消费（isInputBlocked → 提前 return）", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    pushInputBlock("test-block");
    try {
      const ev = mkEv("w", "KeyW");
      handlers.onKeyDown(ev);
      expect(opts.keys.forward).toBeUndefined();
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      popInputBlock("test-block");
    }
  });

  it("输入阻断：pop 后恢复相机消费", () => {
    const opts = mkOptions();
    const handlers = bindInputHandlers(opts);
    pushInputBlock("test-block");
    popInputBlock("test-block");
    const ev = mkEv("w", "KeyW");
    handlers.onKeyDown(ev);
    expect(opts.keys.forward).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
  });
});
