import { describe, it, expect, vi, beforeEach } from "vitest";
import { initTheme } from "./theme.ts";

const { safeGet, safeSet, getApp, applyTheme } = vi.hoisted(() => ({
  safeGet: vi.fn((_key: string) => ""),
  safeSet: vi.fn((_key: string, _val: string) => {}),
  getApp: vi.fn(),
  applyTheme: vi.fn((_name: string) => {}),
}));

vi.mock("../../../utils/dom/storage.ts", () => ({
  safeGet: (...a: unknown[]) => safeGet(...(a as [string])),
  safeSet: (...a: unknown[]) => safeSet(...(a as [string, string])),
}));

vi.mock("../../../backend/app.ts", () => ({
  getApp: () => getApp(),
}));

vi.mock("../../../theme-core.ts", () => ({
  applyTheme: (...a: unknown[]) => applyTheme(...(a as [string])),
}));

vi.mock("./store.ts", () => ({
  cfg: { filesRoot: "/test", resourcepackRoot: "", mcRoot: "", linkMode: "copy" },
}));

function makeRoot(savedTheme = "cyber", savedAuto = "off") {
  safeGet.mockImplementation((key: string) => {
    if (key === "theme") return savedTheme;
    if (key === "theme-auto") return savedAuto;
    return "";
  });
  const picker = document.createElement("div");
  picker.id = "theme-picker";
  const card1 = document.createElement("div");
  card1.className = "theme-card";
  card1.dataset.theme = "cyber";
  const card2 = document.createElement("div");
  card2.className = "theme-card";
  card2.dataset.theme = "warm";
  picker.append(card1, card2);

  const autoSelect = document.createElement("select");
  autoSelect.id = "theme-auto";
  for (const v of ["off", "system", "time"]) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    autoSelect.appendChild(opt);
  }

  const root = {
    getElementById: (id: string) => {
      if (id === "theme-picker") return picker;
      if (id === "theme-auto") return autoSelect;
      return null;
    },
  } as unknown as ShadowRoot;

  return { root, picker, card1, card2, autoSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  getApp.mockResolvedValue({ SaveAppConfig: vi.fn() });
});

describe("initTheme", () => {
  it("applies saved theme on init (no auto)", () => {
    const { root } = makeRoot("warm");
    initTheme(root);
    expect(applyTheme).toHaveBeenCalledWith("warm");
  });

  it("defaults to cyber when no saved theme", () => {
    const { root } = makeRoot("");
    initTheme(root);
    expect(applyTheme).toHaveBeenCalledWith("cyber");
  });

  it("card click applies theme + saves + disables auto", () => {
    const { root, card2 } = makeRoot("cyber");
    initTheme(root);
    applyTheme.mockClear();
    card2.click();
    expect(applyTheme).toHaveBeenCalledWith("warm");
    expect(safeSet).toHaveBeenCalledWith("theme", "warm");
    expect(safeSet).toHaveBeenCalledWith("theme-auto", "off");
  });

  it("auto=system applies system theme", () => {
    const { root } = makeRoot("cyber", "system");
    initTheme(root);
    expect(applyTheme).toHaveBeenCalledWith("system");
  });

  it("auto=time applies time-based theme (warm or cyber)", () => {
    const { root } = makeRoot("cyber", "time");
    initTheme(root);
    const hour = new Date().getHours();
    const expected = hour >= 6 && hour < 18 ? "warm" : "cyber";
    expect(applyTheme).toHaveBeenCalledWith(expected);
  });

  it("auto select change to system applies system", () => {
    const { root, autoSelect } = makeRoot("cyber", "off");
    initTheme(root);
    applyTheme.mockClear();
    autoSelect.value = "system";
    autoSelect.dispatchEvent(new Event("change"));
    expect(applyTheme).toHaveBeenCalledWith("system");
    expect(safeSet).toHaveBeenCalledWith("theme", "system");
  });

  it("auto select change to time applies time theme", () => {
    const { root, autoSelect } = makeRoot("cyber", "off");
    initTheme(root);
    applyTheme.mockClear();
    autoSelect.value = "time";
    autoSelect.dispatchEvent(new Event("change"));
    const hour = new Date().getHours();
    const expected = hour >= 6 && hour < 18 ? "warm" : "cyber";
    expect(applyTheme).toHaveBeenCalledWith(expected);
  });

  it("no picker element still applies theme", () => {
    const root = {
      getElementById: () => null,
    } as unknown as ShadowRoot;
    safeGet.mockReturnValue("");
    initTheme(root);
    expect(applyTheme).toHaveBeenCalledWith("cyber");
  });
});
