import { describe, it, expect, vi, beforeEach } from "vitest";
import { TD_KEYMAP_REGISTRY } from "@/preview-3d/infra/keymap.ts";
import { cleanupKeymap, initKeymap } from "./keymap.ts";

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

vi.mock("@/utils/base/primitives/storage.ts", () => ({
  safeGet: (...a: unknown[]) => safeGet(...(a as [string])),
  safeSet: (...a: unknown[]) => safeSet(...(a as [string, string])),
  safeRemove: (...a: unknown[]) => safeRemove(...(a as [string])),
}));

vi.mock("@/bus", () => ({
  bus: { emit: (...a: unknown[]) => busEmit(...a) },
}));

vi.mock("@/preview-3d/mesh/model3d.ts", () => ({
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
  it("renders one row for every registry action", () => {
    const { root, grid } = makeRoot();
    initKeymap(root);
    expect(grid.children.length).toBe(TD_KEYMAP_REGISTRY.length);
    expect([...grid.children].map((row) => (row as HTMLElement).dataset.keymapAction)).toEqual(
      TD_KEYMAP_REGISTRY.map((spec) => spec.action),
    );
  });

  it("renders one compact row per binding instead of nested cards", () => {
    const { root, grid } = makeRoot();
    initKeymap(root);
    const rows = [...grid.querySelectorAll(".stg-keybind-row")];
    expect(rows).toHaveLength(6);
    expect(grid.querySelector(".stg-card")).toBeNull();
    expect(rows[0]?.querySelector(".label")?.textContent).toBe("前移");
    expect(rows[0]?.querySelector("button")?.textContent).toBe("W");
  });

  it("displays correct labels for key codes", () => {
    const { root, grid } = makeRoot();
    initKeymap(root);
    const firstBtn = grid.querySelector("button");
    expect(firstBtn?.textContent).toBe("W"); // KeyW → "W"
  });

  it("exposes the action, current key, and shortcut metadata", () => {
    const { root, grid } = makeRoot();
    initKeymap(root);
    const firstBtn = grid.querySelector("button");
    expect(firstBtn?.getAttribute("type")).toBe("button");
    expect(firstBtn?.getAttribute("aria-label")).toContain("前移");
    expect(firstBtn?.getAttribute("aria-label")).toContain("快捷键");
    expect(firstBtn?.getAttribute("aria-label")).toContain("W");
    expect(firstBtn?.getAttribute("aria-label")).not.toContain("点击后可重绑");
    expect(firstBtn?.getAttribute("aria-keyshortcuts")).toBe("W");
    expect(firstBtn?.getAttribute("aria-describedby")).toBe("td-keymap-hint");
  });

  it("announces capture state and Escape restores the binding", () => {
    const { root, grid } = makeRoot();
    initKeymap(root);
    const firstBtn = grid.querySelector("button") as HTMLButtonElement;
    firstBtn.click();
    expect(firstBtn.textContent).toContain("按键");
    expect(firstBtn.getAttribute("aria-label")).toContain("前移");
    expect(firstBtn.getAttribute("aria-label")).toContain("等待按键");
    expect(firstBtn.getAttribute("aria-label")).toContain("Esc");
    expect(firstBtn.hasAttribute("aria-keyshortcuts")).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    expect(grid.querySelector("button")?.textContent).toBe("W");
    cleanupKeymap();
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
