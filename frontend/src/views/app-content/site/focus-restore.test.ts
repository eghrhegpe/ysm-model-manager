// ===== 工坊编辑态焦点恢复测试（focus-restore.ts，锐评 Perf #3）=====
// 病：preset 上移/下移/删除触发整站重渲 → 按钮 DOM 重建 → 连按第二次按键落回 body。
// 锚点用 preset 稳定身份（data-preset-q = ps.q || ps.label）而非 data-idx——
// 上移会让索引漂移（点第 3 项「上移」→ 变成第 2 项 → data-idx 2 变 1）。
import { describe, it, expect, beforeEach } from "vitest";
import { captureEditFocus, restoreEditFocus } from "./focus-restore.ts";

/** 造编辑区 DOM：3 张 preset 卡，每张带 data-preset-q 与三个按钮 */
function mountEditCards(queries = ["A", "B", "C"]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = queries
    .map(
      (q, i) =>
        `<div class="cr-edit-card" data-edit="preset" data-edit-idx="${i}" data-preset-q="${q}">` +
        `<input class="cr-input" value="${q}">` +
        `<button data-idx="${i}" class="cr-btn-icon cr-order-up"></button>` +
        `<button data-idx="${i}" class="cr-btn-icon cr-order-down"></button>` +
        `<button data-idx="${i}" class="cr-btn-icon cr-del-preset"></button>` +
        `</div>`,
    )
    .join("");
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("captureEditFocus", () => {
  it("焦点在编辑区按钮 → 锚点含按钮类 + preset 稳定身份", () => {
    const root = mountEditCards();
    const btn = root.querySelectorAll<HTMLElement>(".cr-order-down")[1];
    btn.focus();
    const a = captureEditFocus(root);
    expect(a).not.toBeNull();
    expect(a?.cls).toBe("cr-order-down");
    expect(a?.q).toBe("B");
  });

  it("焦点不在编辑区按钮（如搜索输入框）→ null（不越界抢焦点）", () => {
    const root = mountEditCards();
    root.querySelector<HTMLElement>(".cr-input")!.focus();
    expect(captureEditFocus(root)).toBeNull();
  });

  it("无焦点元素 → null", () => {
    const root = mountEditCards();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(captureEditFocus(root)).toBeNull();
  });

  it("root 为 null → null（防御）", () => {
    expect(captureEditFocus(null)).toBeNull();
  });
});

describe("restoreEditFocus", () => {
  it("重渲后焦点回到同 preset 的同类按钮（按稳定身份而非旧索引）", () => {
    const root = mountEditCards();
    // 焦点在第 3 张（B? 不，用C）的「上移」按钮
    const up3 = root.querySelectorAll<HTMLElement>(".cr-order-up")[2];
    up3.focus();
    const anchor = captureEditFocus(root);
    expect(anchor?.q).toBe("C");

    // 模拟「上移」后重渲：C 从索引 2 移到 1，且按钮是全新 DOM
    root.innerHTML = "";
    const root2 = mountEditCards(["A", "C", "B"]); // C 移到索引 1
    const ok = restoreEditFocus(root2, anchor);
    expect(ok).toBe(true);
    const focused = root2.querySelectorAll<HTMLElement>(".cr-order-up")[1];
    expect(document.activeElement).toBe(focused);
  });

  it("目标 preset 已不存在（如被删除）→ false，不抛异常", () => {
    const root = mountEditCards();
    const btn = root.querySelectorAll<HTMLElement>(".cr-del-preset")[1];
    btn.focus();
    const anchor = captureEditFocus(root);
    root.innerHTML = "";
    const root2 = mountEditCards(["A", "C"]); // B 被删
    expect(restoreEditFocus(root2, anchor)).toBe(false);
  });

  it("anchor 为 null 或 root 为 null → false（防御）", () => {
    const root = mountEditCards();
    expect(restoreEditFocus(root, null)).toBe(false);
    expect(restoreEditFocus(null, { cls: "cr-order-up", q: "A" })).toBe(false);
  });
});