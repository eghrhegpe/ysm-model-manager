import { describe, expect, it } from "vitest";
import { qs, qsa } from "./qsa.ts";

describe("qsa/qs — 类型安全 DOM 查询助手", () => {
  const setup = (): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = `
      <input data-idx="0" value="a" />
      <input data-idx="1" value="b" />
      <select data-idx="2"></select>
      <span class="plain"></span>
    `;
    document.body.appendChild(root);
    return root;
  };

  it("qsa 泛型返回强类型数组，可直接访问 dataset/value 免断言", () => {
    const root = setup();
    const inputs = qsa<HTMLInputElement>(root, "input[data-idx]");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("a");
    expect(inputs.map((i) => i.dataset.idx)).toEqual(["0", "1"]);
  });

  it("qsa 默认泛型为 HTMLElement", () => {
    const root = setup();
    const all = qsa(root, "[data-idx]");
    expect(all).toHaveLength(3);
    expect(all[0].tagName).toBe("INPUT");
  });

  it("qsa 无命中返回空数组", () => {
    const root = setup();
    expect(qsa(root, ".nonexistent")).toEqual([]);
  });

  it("qs 命中返回元素，未命中返回 null", () => {
    const root = setup();
    const sel = qs<HTMLSelectElement>(root, "select[data-idx]");
    expect(sel?.tagName).toBe("SELECT");
    expect(qs(root, ".nonexistent")).toBeNull();
  });
});
