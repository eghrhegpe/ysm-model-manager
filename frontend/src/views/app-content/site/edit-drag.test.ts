// ===== edit-drag.ts 拖拽排序绑定助手测试（从 edit.ts 双胞胎块去重抽出，2026-09） =====
// 覆盖：pointerdown 激活 / dragstart 状态 / dragenter 方位类 / drop 提交契约 / dragend 清理 / AbortSignal 退订

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindDragSort, type DragStateShell } from "./edit-drag.ts";

let root: HTMLElement;
let ds: DragStateShell;
let sig: AbortController;
let calls: { sync: number; commit: Array<[number, number]>; refresh: number };

function card(idx: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "cr-edit-card";
  el.dataset.editIdx = String(idx);
  el.innerHTML = '<span class="cr-drag-handle"></span>';
  root.appendChild(el);
  return el;
}

function bind(): void {
  bindDragSort({
    root,
    selector: ".cr-edit-card",
    ds,
    srcKey: "srcIdx",
    sig: sig.signal,
    syncInputs: () => void calls.sync++,
    commit: (src, tgt) => {
      calls.commit.push([src, tgt]);
      return true;
    },
    refreshView: () => void calls.refresh++,
  });
}

function fire(el: EventTarget, type: string, init?: DragEventInit): DragEvent {
  const e = new DragEvent(type, init);
  el.dispatchEvent(e);
  return e;
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
  ds = { srcIdx: -1, presetSrcIdx: -1 };
  sig = new AbortController();
  calls = { sync: 0, commit: [], refresh: 0 };
});

afterEach(() => {
  root.remove();
});

describe("bindDragSort", () => {
  it("pointerdown 在拖拽柄上激活卡片 draggable", () => {
    const c0 = card(0);
    bind();
    c0.querySelector(".cr-drag-handle")!.dispatchEvent(new Event("pointerdown"));
    expect(c0.draggable).toBe(true);
  });

  it("dragstart 复位 draggable、记录 srcIdx、加 cr-dragging 类", () => {
    const c0 = card(0);
    bind();
    c0.querySelector(".cr-drag-handle")!.dispatchEvent(new Event("pointerdown"));
    fire(c0, "dragstart");
    expect(c0.draggable).toBe(false);
    expect(ds.srcIdx).toBe(0);
    expect(c0.classList.contains("cr-dragging")).toBe(true);
  });

  it("dragenter：src<tgt 加 cr-drag-before，dragleave 清方位类", () => {
    card(0);
    const c1 = card(1);
    bind();
    ds.srcIdx = 0;
    fire(c1, "dragenter");
    expect(c1.classList.contains("cr-drag-target")).toBe(true);
    expect(c1.classList.contains("cr-drag-before")).toBe(true);
    expect(c1.classList.contains("cr-drag-after")).toBe(false);
    fire(c1, "dragleave");
    expect(c1.classList.contains("cr-drag-target")).toBe(false);
    expect(c1.classList.contains("cr-drag-before")).toBe(false);
  });

  it("drop：src≠tgt 时 syncInputs → commit(src,tgt) → refresh，src 复位", () => {
    card(0);
    const c1 = card(1);
    bind();
    ds.srcIdx = 0;
    fire(c1, "drop");
    expect(calls.sync).toBe(1);
    expect(calls.commit).toEqual([[0, 1]]);
    expect(calls.refresh).toBe(1);
    expect(ds.srcIdx).toBe(-1);
  });

  it("drop：src<0 或同 idx 直接跳过（不 sync 不 commit）", () => {
    bind();
    const c0 = card(0);
    fire(c0, "drop"); // src=-1
    ds.srcIdx = 0;
    fire(c0, "drop"); // 同 idx
    expect(calls.sync).toBe(0);
    expect(calls.commit).toHaveLength(0);
    expect(calls.refresh).toBe(0);
  });

  it("drop：commit 返回 false 时不 refresh 且 src 复位", () => {
    bind();
    card(0);
    const c1 = card(1);
    ds.srcIdx = 0;
    bindDragSort({
      root,
      selector: ".cr-edit-card",
      ds,
      srcKey: "srcIdx",
      sig: sig.signal,
      syncInputs: () => void calls.sync++,
      commit: () => false,
      refreshView: () => void calls.refresh++,
    });
    fire(c1, "drop");
    expect(calls.sync).toBe(1);
    expect(calls.refresh).toBe(0);
    expect(ds.srcIdx).toBe(-1);
  });

  it("dragend：复位 draggable、清 ds、清全部卡片拖拽类", () => {
    const c0 = card(0);
    const c1 = card(1);
    bind();
    c1.classList.add("cr-dragging", "cr-drag-before");
    ds.srcIdx = 1;
    fire(c0, "dragend");
    expect(c0.draggable).toBe(false);
    expect(ds.srcIdx).toBe(-1);
    expect(ds.presetSrcIdx).toBe(-1);
    expect(c1.classList.contains("cr-dragging")).toBe(false);
    expect(c1.classList.contains("cr-drag-before")).toBe(false);
  });

  it("AbortSignal 中止后事件全部失效", () => {
    const c0 = card(0);
    bind();
    sig.abort();
    c0.querySelector(".cr-drag-handle")!.dispatchEvent(new Event("pointerdown"));
    // happy-dom 未实现 HTMLElement.draggable 属性（读取恒 undefined）——「未被激活」只能断言 falsy
    expect(c0.draggable).toBeFalsy();
    fire(c0, "dragstart");
    expect(ds.srcIdx).toBe(-1);
  });

  it("dataTransfer 缺席（happy-dom）不抛错", () => {
    bind();
    const c0 = card(0);
    expect(() => fire(c0, "dragstart")).not.toThrow();
    expect(() => fire(c0, "dragover")).not.toThrow();
  });
});
