import { describe, it, expect, vi, beforeEach } from "vitest";
import { initKeymap } from "./keymap.ts";

beforeEach(() => {
  vi.clearAllMocks();
  safeGet.mockImplementation((_key: string) => "");
  loadTdKeymap.mockReturnValue({
    forward: "KeyW",
    back: "KeyS",
    left: "KeyA",
    right: "KeyD",
    up: "Space",
    down: "ShiftLeft",
  });
});

const { safeGet, safeSet, safeRemove, busEmit, loadTdKeymap } = vi.hoisted(() => ({
  safeGet: vi.fn((_key: string) => ""),
  safeSet: vi.fn((_key: string, _val: string) => {}),
  safeRemove: vi.fn((_key: string) => {}),
  busEmit: vi.fn(),
  loadTdKeymap: vi.fn(() => ({
    forward: "KeyW",
    back: "KeyS",
    left: "KeyA",
    right: "KeyD",
    up: "Space",
    down: "ShiftLeft",
  })),
}));

vi.mock("../../../utils/dom/storage.ts", () => ({
  safeGet: (...a: unknown[]) => safeGet(...(a as [string])),
  safeSet: (...a: unknown[]) => safeSet(...(a as [string, string])),
  safeRemove: (...a: unknown[]) => safeRemove(...(a as [string])),
}));

vi.mock("../../../bus.ts", () => ({
  bus: { emit: (...a: unknown[]) => busEmit(...a) },
}));

vi.mock("../../../preview-3d/model3d.ts", () => ({
  loadTdKeymap: () => loadTdKeymap(),
}));

function makeRoot() {
  const grid = document.createElement("div");
  grid.id = "td-keymap-grid";
  const resetBtn = document.createElement("button");
  resetBtn.id = "td-keymap-reset";
  const speedInput = document.createElement("input");
  speedInput.id = "td-camspeed";
  speedInput.type = "range";
  const speedVal = document.createElement("span");
  speedVal.id = "td-camspeed-val";
  const rotSelect = document.createElement("select");
  rotSelect.id = "td-rotmode";
  for (const v of ["orbit", "free"]) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    rotSelect.appendChild(opt);
  }

  const root = {
    getElementById: (id: string) => {
      if (id === "td-keymap-grid") return grid;
      if (id === "td-keymap-reset") return resetBtn;
      if (id === "td-camspeed") return speedInput;
      if (id === "td-camspeed-val") return speedVal;
      if (id === "td-rotmode") return rotSelect;
      return null;
    },
  } as unknown as ShadowRoot;

  return { root, grid, resetBtn, speedInput, speedVal, rotSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadTdKeymap.mockReturnValue({
    forward: "KeyW",
    back: "KeyS",
    left: "KeyA",
    right: "KeyD",
    up: "Space",
    down: "ShiftLeft",
  });
});

describe("initKeymap", () => {
  it("renders 6 action rows in grid", () => {
    const { root, grid } = makeRoot();
    initKeymap(root);
    expect(grid.children.length).toBe(6);
  });

  it("displays correct labels for key codes", () => {
    const { root, grid } = makeRoot();
    initKeymap(root);
    const firstBtn = grid.querySelector("button");
    expect(firstBtn?.textContent).toBe("W"); // KeyW → "W"
  });

  it("shows fallback dash for empty key code", () => {
    loadTdKeymap.mockReturnValue({
      forward: "",
      back: "KeyS",
      left: "KeyA",
      right: "KeyD",
      up: "Space",
      down: "ShiftLeft",
    });
    const { root, grid } = makeRoot();
    initKeymap(root);
    const firstBtn = grid.querySelector("button");
    expect(firstBtn?.textContent).toBe("—");
  });

  it("reset button removes td-keymap + re-renders + toasts", () => {
    const { root, resetBtn } = makeRoot();
    initKeymap(root);
    resetBtn.click();
    expect(safeRemove).toHaveBeenCalledWith("td-keymap");
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("恢复默认") }),
    );
  });

  it("speed input saves to storage", () => {
    const { root, speedInput, speedVal } = makeRoot();
    safeGet.mockImplementation((key: string) => {
      if (key === "td-cam-speed") return "30";
      return "";
    });
    initKeymap(root);
    expect(speedInput.value).toBe("30");
    expect(speedVal.textContent).toBe("30");

    speedInput.value = "50";
    speedInput.dispatchEvent(new Event("input"));
    expect(safeSet).toHaveBeenCalledWith("td-cam-speed", "50");
    expect(speedVal.textContent).toBe("50");
  });

  it("rotation mode select saves to storage", () => {
    const { root, rotSelect } = makeRoot();
    safeGet.mockImplementation((key: string) => {
      if (key === "td-rot-mode") return "free";
      return "";
    });
    initKeymap(root);
    expect(rotSelect.value).toBe("free");

    rotSelect.value = "orbit";
    rotSelect.dispatchEvent(new Event("change"));
    expect(safeSet).toHaveBeenCalledWith("td-rot-mode", "orbit");
  });

  it("default rotation mode is orbit when no saved value", () => {
    const { root, rotSelect } = makeRoot();
    initKeymap(root);
    expect(rotSelect.value).toBe("orbit");
  });

  it("renders Digit and Numpad key codes correctly", () => {
    loadTdKeymap.mockReturnValue({
      forward: "Digit1",
      back: "Numpad0",
      left: "KeyA",
      right: "KeyD",
      up: "Space",
      down: "ShiftLeft",
    });
    const { root, grid } = makeRoot();
    initKeymap(root);
    const buttons = grid.querySelectorAll("button");
    expect(buttons[0]?.textContent).toBe("1"); // Digit1
    expect(buttons[1]?.textContent).toBe("Num 0"); // Numpad0
  });

  it("renders special keys with Chinese labels", () => {
    loadTdKeymap.mockReturnValue({
      forward: "Space",
      back: "ShiftLeft",
      left: "ControlLeft",
      right: "ArrowUp",
      up: "Enter",
      down: "Backspace",
    });
    const { root, grid } = makeRoot();
    initKeymap(root);
    const buttons = grid.querySelectorAll("button");
    expect(buttons[0]?.textContent).toBe("空格");
    expect(buttons[1]?.textContent).toBe("Shift");
    expect(buttons[2]?.textContent).toBe("Ctrl");
    expect(buttons[3]?.textContent).toBe("↑");
    expect(buttons[4]?.textContent).toBe("Enter");
    expect(buttons[5]?.textContent).toBe("⌫");
  });
});
