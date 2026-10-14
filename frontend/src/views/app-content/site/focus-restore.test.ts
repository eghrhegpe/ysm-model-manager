// ===== 工坊编辑态焦点恢复测试（focus-restore.ts，锐评 Perf #3）=====
// 病：preset 上移/下移/删除触发整站重渲 → 按钮 DOM 重建 → 连按第二次按键落回 body。
// 锚点用 preset 稳定身份（data-preset-q = ps.q || ps.label）而非 data-idx——
// 上移会让索引漂移（点第 3 项「上移」→ 变成第 2 项 → data-idx 2 变 1）。
import { describe, it, expect, beforeEach } from "vitest";
import { captureEditFocus, restoreEditFocus } from "./focus-restore.ts";

/** 造编辑区 DOM：每张 preset 卡带 data-preset-q / data-preset-occ 与三个按钮。
 *  occ 按「同 q 出现序号」生成（与 render.ts|buildSitePresetEditCards 口径一致）。 */
function mountEditCards(queries = ["A", "B", "C"]): HTMLElement {
  const root = document.createElement("div");
  const occOf = new Map<string, number>();
  root.innerHTML = queries
    .map((q, i) => {
      const occ = occOf.get(q) ?? 0;
      occOf.set(q, occ + 1);
      return (
        `<div class="cr-edit-card" data-edit="preset" data-edit-idx="${i}" data-preset-q="${q}" data-preset-occ="${occ}">` +
        `<input class="cr-input" value="${q}">` +
        `<button data-idx="${i}" class="cr-btn-icon cr-order-up"></button>` +
        `<button data-idx="${i}" class="cr-btn-icon cr-order-down"></button>` +
        `<button data-idx="${i}" class="cr-btn-icon cr-del-preset"></button>` +
        `</div>`
      );
    })
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

  // 锐评修复（2026-10-14）：q 相同的多个 preset 必须靠 occ 消歧。
  // 病：锚点单靠 `ps.q || ps.label`——而**多个 preset 共享同一 q 是常见配置**
  //（bowroll 站实测「热门日系模型」与「日系模型」可同为 q=MMD），q 重复时身份不唯一，
  // 按 q 恢复焦点会跳到错误行（第 1 个同 q 卡，而非用户操作的那张）。
  it("两个 preset 共享同一 q → 靠 occ 恢复到正确那张（不跳到第一个同 q 卡）", () => {
    // 两张卡 q 都是 MMD，occ 分别为 0 / 1
    const root = mountEditCards(["MMD", "MMD"]);
    expect(root.querySelectorAll("[data-preset-occ]")).toHaveLength(2);
    // 焦点在第 2 张（occ=1）的「上移」按钮
    const second = root.querySelectorAll<HTMLElement>(".cr-order-up")[1];
    second.focus();
    const anchor = captureEditFocus(root);
    expect(anchor?.q).toBe("MMD");
    expect(anchor?.occ).toBe("1");

    // 重渲后（新 DOM）：必须回到 occ=1 那张，而不是 occ=0
    root.innerHTML = "";
    const root2 = mountEditCards(["MMD", "MMD"]);
    expect(restoreEditFocus(root2, anchor)).toBe(true);
    const expected = root2.querySelectorAll<HTMLElement>(".cr-order-up")[1];
    expect(document.activeElement).toBe(expected);
    // 反证：若只看 q，会落到第 1 张（occ=0）——明确断言不是它
    expect(document.activeElement).not.toBe(root2.querySelectorAll<HTMLElement>(".cr-order-up")[0]);
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
    expect(restoreEditFocus(null, { cls: "cr-order-up", q: "A", occ: "0" })).toBe(false);
  });
});