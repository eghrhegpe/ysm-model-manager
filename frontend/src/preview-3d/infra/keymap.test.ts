import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TD_KEYMAP,
  loadTdKeymap,
  TD_KEYMAP_REGISTRY,
} from "./keymap.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("TD_KEYMAP_REGISTRY", () => {
  it("is the ordered source for action ids and default codes", () => {
    const actions = TD_KEYMAP_REGISTRY.map((spec) => spec.action);

    expect(actions).toEqual(["forward", "back", "left", "right", "up", "down"]);
    expect(new Set(actions).size).toBe(actions.length);
    expect(DEFAULT_TD_KEYMAP).toEqual(
      Object.fromEntries(TD_KEYMAP_REGISTRY.map((spec) => [spec.action, spec.defaultCode])),
    );
  });

  it("keeps display grouping and input fallbacks beside each action", () => {
    const byAction = Object.fromEntries(
      TD_KEYMAP_REGISTRY.map((spec) => [spec.action, spec]),
    );

    expect(byAction.forward).toMatchObject({
      defaultCode: "KeyW",
      group: "movement",
      order: 0,
      fallbackCodes: ["ArrowUp", "Numpad8"],
    });
    expect(byAction.up?.fallbackCodes).toEqual([]);
    expect(byAction.down?.fallbackCodes).toEqual([]);
    const fallbackCodes = TD_KEYMAP_REGISTRY.flatMap((spec) => spec.fallbackCodes);
    expect(new Set(fallbackCodes).size).toBe(fallbackCodes.length);
    expect(
      TD_KEYMAP_REGISTRY.every((spec, index) => spec.order === index),
    ).toBe(true);
  });
});

describe("loadTdKeymap registry merge", () => {
  it("fills every registry action and ignores unknown persisted fields", () => {
    localStorage.setItem(
      "td-keymap",
      JSON.stringify({ forward: "KeyE", futureAction: "KeyX" }),
    );

    const result = loadTdKeymap();

    expect(Object.keys(result)).toEqual(TD_KEYMAP_REGISTRY.map((spec) => spec.action));
    expect(result.forward).toBe("KeyE");
    expect(result.back).toBe("KeyS");
  });
});
