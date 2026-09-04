// @vitest-environment happy-dom
// ===== isEditableTarget 共享判定测试（收编自 dnd-shared / input-and-animation 双轨）=====
import { describe, expect, it } from "vitest";
import { isEditableTarget } from "./editable-target.ts";

function makeEl(tag: string, editable = false): HTMLElement {
  const el = document.createElement(tag);
  if (editable) el.setAttribute("contenteditable", "true");
  return el;
}

describe("isEditableTarget", () => {
  it("INPUT/TEXTAREA/SELECT 均判定为可编辑目标", () => {
    expect(isEditableTarget(makeEl("INPUT"))).toBe(true);
    expect(isEditableTarget(makeEl("TEXTAREA"))).toBe(true);
    expect(isEditableTarget(makeEl("SELECT"))).toBe(true);
  });

  it("contenteditable=true 判定为可编辑", () => {
    expect(isEditableTarget(makeEl("DIV", true))).toBe(true);
  });

  it("普通元素 / null / 非元素目标判定不可编辑", () => {
    expect(isEditableTarget(makeEl("DIV"))).toBe(false);
    expect(isEditableTarget(makeEl("BUTTON"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });

  it("e.target 为 INPUT 时判定可编辑（3D 键位 / drop 守卫的真实调用形态）", () => {
    const ev = new KeyboardEvent("keydown", { key: "f" });
    const input = makeEl("INPUT");
    Object.defineProperty(ev, "target", { value: input });
    expect(isEditableTarget(ev.target)).toBe(true);
    // 事件对象自身不是控件 → 传错对象形态返回 false（调用方应传 e.target）
    expect(isEditableTarget(ev as unknown as EventTarget)).toBe(false);
  });
});
