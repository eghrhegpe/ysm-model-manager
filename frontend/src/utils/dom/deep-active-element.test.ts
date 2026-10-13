// ===== 深焦解析单测（deep-active-element.ts）=====
// 核心价值：锁死「shadow 内焦点必须下钻」这条契约——它是本仓三处历史踩坑的共同根因。
// 注意：happy-dom 与浏览器同为 retargeting 语义，故这里断言 document.activeElement
// 停在 host 是**正确口径**（不把它当 bug）。
import { describe, it, expect, afterEach } from "vitest";
import { deepActiveElement, deepActiveElementOf } from "./deep-active-element.ts";

/** 建一个挂在文档上的 shadow host，返回 { host, root } */
function makeHost(id = "h"): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement("div");
  host.id = id;
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  return { host, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("deepActiveElement", () => {
  it("light DOM：与 document.activeElement 等价（不改变原语义）", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    expect(deepActiveElement()).toBe(btn);
  });

  it("shadow 内聚焦：穿透 retargeting 返回内层真实元素（而非 host）——核心回归", () => {
    const { host, root } = makeHost();
    const btn = document.createElement("button");
    root.appendChild(btn);
    btn.focus();

    // 环境口径：document 级看到的仍是 host（这正是各处踩坑的根因）
    expect(document.activeElement).toBe(host);
    // 本模块的职责：给出真实元素
    expect(deepActiveElement()).toBe(btn);
  });

  it("嵌套 shadow：逐层下钻到最内层", () => {
    const { root: outer } = makeHost("outer");
    const innerHost = document.createElement("div");
    outer.appendChild(innerHost);
    const inner = innerHost.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    inner.appendChild(btn);
    btn.focus();

    expect(deepActiveElement()).toBe(btn);
  });

  it("无焦点 → 返回 document.activeElement 原值（无焦点时为 body，DOM 规范如此）", () => {
    expect(deepActiveElement()).toBe(document.activeElement);
  });

  it("显式传 start：按给定起点下钻，不看 document.activeElement", () => {
    const { host, root } = makeHost();
    const btn = document.createElement("button");
    root.appendChild(btn);
    btn.focus();
    // 传宿主作为起点 → 应继续下钻到其 shadow 树内真实焦点（而非停在 host）
    expect(deepActiveElement(host)).toBe(btn);
    // 传一个无 shadow 的元素 → 无可下钻，原样返回
    const plain = document.createElement("div");
    document.body.appendChild(plain);
    expect(deepActiveElement(plain)).toBe(plain);
  });
});

describe("deepActiveElementOf", () => {
  it("命中：返回 items 内当前聚焦项", () => {
    const { root } = makeHost();
    const a = document.createElement("div");
    const b = document.createElement("div");
    a.tabIndex = 0;
    b.tabIndex = 0;
    root.append(a, b);
    b.focus();
    expect(deepActiveElementOf([a, b])).toBe(b);
  });

  it("未命中：焦点在 items 外 → null（对应「恒早退」的那类 bug 的防线）", () => {
    const { root } = makeHost();
    const a = document.createElement("div");
    a.tabIndex = 0;
    root.appendChild(a);
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    expect(deepActiveElementOf([a])).toBeNull();
  });
});