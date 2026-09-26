// ===== bind-roving.test.ts — Roving Tabindex 列表键盘原语契约测试（ADR-308 D2）=====
// 契约：spec → 键盘操作。单个 keydown 委托挂在 container 上，管理 roving tabindex +
// ARIA 状态位（aria-selected/aria-checked）+ 焦点移动 + onMove/onActivate 回调。
// 结构 role（listbox/option）由消费方模板声明，原语只管「交互状态」——
// 与 tabs-a11y bindTabA11y 同构（spec-driven 声明式原语先例）。

import { afterEach, describe, expect, it, vi } from "vitest";
import { bindRoving, type RovingSpec } from "./bind-roving.ts";

// ---------- 测试工装 ----------
interface Harness {
  host: HTMLElement;
  root: ShadowRoot;
  container: HTMLDivElement;
  items: HTMLDivElement[];
  handle: ReturnType<typeof bindRoving>;
}

function setup(count = 3, spec: Partial<RovingSpec> = {}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  const container = document.createElement("div");
  container.id = "lst";
  container.setAttribute("role", "listbox");
  for (let i = 0; i < count; i++) {
    const item = document.createElement("div");
    item.className = "item";
    item.setAttribute("role", "option");
    item.textContent = `item-${i}`;
    container.appendChild(item);
  }
  root.appendChild(container);
  const handle = bindRoving({
    root,
    container: "#lst",
    itemSelector: ".item",
    preset: "list",
    orientation: "vertical",
    ...spec,
  });
  return { host, root, container, items: Array.from(container.querySelectorAll(".item")), handle };
}

function key(el: Element, keyName: string, init: Omit<KeyboardEventInit, "key"> = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------- 初始布局 ----------
describe("初始 roving 布局", () => {
  it("bind 即建 roving tabindex + ARIA 状态位（active=0，不夺焦点）", () => {
    const h = setup(3);
    expect(h.items[0].tabIndex).toBe(0);
    expect(h.items[1].tabIndex).toBe(-1);
    expect(h.items[2].tabIndex).toBe(-1);
    expect(h.items[0].getAttribute("aria-selected")).toBe("true");
    expect(h.items[1].getAttribute("aria-selected")).toBe("false");
    expect(h.root.activeElement).toBeNull(); // 不主动夺焦（Tab 进入由浏览器自然落点）
  });

  it("initialIndex 指定起点", () => {
    const h = setup(3, { initialIndex: 2 });
    expect(h.items[2].tabIndex).toBe(0);
    expect(h.items[2].getAttribute("aria-selected")).toBe("true");
    expect(h.items[0].tabIndex).toBe(-1);
  });
});

// ---------- 方向键移动（preset list：移动即激活） ----------
describe("ArrowDown/ArrowUp（preset list）", () => {
  it("ArrowDown 移动焦点 + onMove + onActivate（list 移动即激活）", () => {
    const onMove = vi.fn();
    const onActivate = vi.fn();
    const h = setup(3, { onMove, onActivate });
    key(h.items[0], "ArrowDown");
    expect(h.root.activeElement).toBe(h.items[1]);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0]?.[0]).toBe(h.items[1]);
    expect(onMove.mock.calls[0]?.[1]).toBe(1);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]?.[0]).toBe(h.items[1]);
    expect(onActivate.mock.calls[0]?.[1]).toBe(1);
    // roving 跟随 + 状态位迁移
    expect(h.items[1].tabIndex).toBe(0);
    expect(h.items[0].tabIndex).toBe(-1);
    expect(h.items[1].getAttribute("aria-selected")).toBe("true");
    expect(h.items[0].getAttribute("aria-selected")).toBe("false");
  });

  it("端点 clamping（cyclic=false）：末端再 Down 不动、不回调", () => {
    const onMove = vi.fn();
    const h = setup(3, { onMove });
    key(h.items[0], "ArrowDown");
    key(h.items[1], "ArrowDown");
    key(h.items[2], "ArrowDown"); // 末端
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(h.root.activeElement).toBe(h.items[2]);
    expect(h.items[2].tabIndex).toBe(0);
  });

  it("cyclic=true：末端 Down 回绕到 0", () => {
    const h = setup(3, { cyclic: true });
    key(h.items[0], "ArrowDown");
    key(h.items[1], "ArrowDown");
    key(h.items[2], "ArrowDown");
    expect(h.root.activeElement).toBe(h.items[0]);
    expect(h.items[0].getAttribute("aria-selected")).toBe("true");
  });

  it("Home/End 跳端；homeEnd=false 时忽略", () => {
    const h = setup(3);
    key(h.items[0], "End");
    expect(h.root.activeElement).toBe(h.items[2]);
    key(h.items[2], "Home");
    expect(h.root.activeElement).toBe(h.items[0]);

    const h2 = setup(3, { homeEnd: false });
    key(h2.items[0], "End");
    key(h2.items[0], "Home");
    // homeEnd=false：无移动、roving 不迁移（不查 h2.root.activeElement——happy-dom 跨 shadow 树
    // 查询 activeElement 有已知缺陷：focus 在 h 树时经 h.host 链断裂抛 TypeError，roving 状态已足证）
    expect(h2.items[0].tabIndex).toBe(0);
    expect(h2.items[2].tabIndex).toBe(-1);
  });

  it("preventDefault 生效（阻止 .list overflow-y 滚动）", () => {
    const h = setup(3);
    const e = key(h.items[0], "ArrowDown");
    expect(e.defaultPrevented).toBe(true);
  });

  it("修饰键方向键（Ctrl+Arrow）让路给全局快捷键", () => {
    const onMove = vi.fn();
    const h = setup(3, { onMove });
    key(h.items[0], "ArrowDown", { ctrlKey: true });
    expect(onMove).not.toHaveBeenCalled();
    expect(h.root.activeElement).not.toBe(h.items[1]);
  });
});

// ---------- preset 差异 ----------
describe("preset tab：移动不激活，Enter/Space 激活", () => {
  it("ArrowDown 只移动不 onActivate；Enter 激活 + preventDefault", () => {
    const onActivate = vi.fn();
    const h = setup(3, { preset: "tab", onActivate });
    key(h.items[0], "ArrowDown");
    expect(onActivate).not.toHaveBeenCalled();
    expect(h.root.activeElement).toBe(h.items[1]);
    const e = key(h.items[1], "Enter");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]?.[0]).toBe(h.items[1]);
    expect(e.defaultPrevented).toBe(true);
  });

  it("Space 同样激活（e.key 兼容 \"Space\" 写法）", () => {
    const onActivate = vi.fn();
    const h = setup(3, { preset: "tab", onActivate });
    key(h.items[0], "ArrowDown");
    key(h.items[1], " ");
    key(h.items[1], "Space");
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});

describe("preset radio：移动即激活 + aria-checked 状态位", () => {
  it("ArrowDown 迁移 aria-checked 并 onActivate", () => {
    const onActivate = vi.fn();
    const h = setup(3, { preset: "radio", onActivate });
    key(h.items[0], "ArrowDown");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(h.items[1].getAttribute("aria-checked")).toBe("true");
    expect(h.items[0].getAttribute("aria-checked")).toBe("false");
    // radio 不写 aria-selected
    expect(h.items[1].hasAttribute("aria-selected")).toBe(false);
  });
});

// ---------- orientation ----------
describe("orientation", () => {
  it("vertical：ArrowLeft/Right 无效（不移动、roving 不迁移）", () => {
    const onMove = vi.fn();
    const h = setup(3, { orientation: "vertical", onMove });
    key(h.items[0], "ArrowRight");
    key(h.items[0], "ArrowLeft");
    expect(onMove).not.toHaveBeenCalled();
    expect(h.items[0].tabIndex).toBe(0);
    expect(h.items[1].tabIndex).toBe(-1);
  });

  it("horizontal：ArrowRight 前进 / ArrowLeft 后退，Up/Down 无效", () => {
    const h = setup(3, { orientation: "horizontal" });
    key(h.items[0], "ArrowRight");
    expect(h.root.activeElement).toBe(h.items[1]);
    key(h.items[1], "ArrowLeft");
    expect(h.root.activeElement).toBe(h.items[0]);
    key(h.items[0], "ArrowUp");
    expect(h.root.activeElement).toBe(h.items[0]);
  });

  it("both：四向全通（Down/Right=+1，Up/Left=-1）", () => {
    const h = setup(3, { orientation: "both" });
    key(h.items[0], "ArrowDown");
    key(h.items[1], "ArrowRight");
    expect(h.root.activeElement).toBe(h.items[2]);
    key(h.items[2], "ArrowLeft");
    key(h.items[1], "ArrowUp");
    expect(h.root.activeElement).toBe(h.items[0]);
  });
});

// ---------- 门控与防御 ----------
describe("when 门控与防御", () => {
  it("when 返回 false 即跳过（让路语义，同 key-router when）", () => {
    const h = setup(3, { when: () => false });
    const onMove = vi.fn();
    key(h.items[0], "ArrowDown");
    expect(onMove).not.toHaveBeenCalled();
    expect(h.root.activeElement).not.toBe(h.items[1]);
  });

  it("可编辑目标（卡内 INPUT）按键不接管", () => {
    const onMove = vi.fn();
    const h = setup(3, { onMove });
    const input = document.createElement("input");
    h.items[0].appendChild(input);
    input.focus();
    key(input, "ArrowDown");
    expect(onMove).not.toHaveBeenCalled();
    expect(h.root.activeElement).toBe(input);
    // roving 未迁移
    expect(h.items[0].tabIndex).toBe(0);
    expect(h.items[1].tabIndex).toBe(-1);
  });

  it("焦点不在任何 item 内（target=container）时以 stateIndex 为基准移动", () => {
    const h = setup(3);
    key(h.items[0], "ArrowDown"); // stateIndex → 1
    key(h.container, "ArrowDown"); // target=container，基准=1 → 2
    expect(h.root.activeElement).toBe(h.items[2]);
  });
});

// ---------- 重渲染存活 ----------
describe("重渲染（innerHTML 换血）", () => {
  it("items 换代后按键仍工作，stateIndex 按位序保持", () => {
    const h = setup(3);
    key(h.items[0], "ArrowDown"); // stateIndex=1
    // 模拟 renderVersionCards：清掉旧卡片
    h.container.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const item = document.createElement("div");
      item.className = "item";
      item.setAttribute("role", "option");
      item.textContent = `new-${i}`;
      h.container.appendChild(item);
    }
    const items = Array.from(h.container.querySelectorAll(".item")) as HTMLDivElement[];
    key(items[1], "ArrowDown"); // 从 1 到 2（位序语义）
    expect(h.root.activeElement).toBe(items[2]);
    expect(items[2].getAttribute("aria-selected")).toBe("true");
  });

  it("列表变短后 stateIndex 越界被 clamp（不崩、不越界回调）", () => {
    const onMove = vi.fn();
    const h = setup(3, { onMove });
    key(h.items[0], "ArrowDown");
    key(h.items[1], "ArrowDown"); // stateIndex=2
    h.container.innerHTML = "";
    for (let i = 0; i < 2; i++) {
      const item = document.createElement("div");
      item.className = "item";
      item.setAttribute("role", "option");
      h.container.appendChild(item);
    }
    const items = Array.from(h.container.querySelectorAll(".item")) as HTMLDivElement[];
    key(items[1], "ArrowDown"); // 已末位（len=2），clamp 不动、无新回调
    expect(onMove).toHaveBeenCalledTimes(2);
    key(items[0], "ArrowDown"); // 0 → 1 正常移动（越界 stateIndex 已被 clamp）
    expect(onMove).toHaveBeenCalledTimes(3);
    expect(onMove.mock.calls[2]?.[0]).toBe(items[1]);
  });
});

// ---------- 句柄 ----------
describe("RovingHandle", () => {
  it("syncIndex 对齐外部选区（restore 高亮）：更新 roving + 状态位，不夺焦", () => {
    const h = setup(3);
    key(h.items[0], "ArrowDown"); // stateIndex=1
    h.handle.syncIndex(2);
    expect(h.items[2].tabIndex).toBe(0);
    expect(h.items[2].getAttribute("aria-selected")).toBe("true");
    expect(h.items[1].getAttribute("aria-selected")).toBe("false");
    // 不夺焦
    expect(h.root.activeElement).not.toBe(h.items[2]);
    // 后续按键从 2 出发
    key(h.items[1], "ArrowDown");
    expect(h.root.activeElement).toBe(h.items[2]);
  });

  it("activate() 程序化激活当前项", () => {
    const onActivate = vi.fn();
    const h = setup(3, { onActivate });
    key(h.items[0], "ArrowDown");
    h.handle.activate();
    expect(onActivate).toHaveBeenCalledTimes(2); // 移动 1 次 + 程序化 1 次
    expect(onActivate.mock.calls[1]?.[0]).toBe(h.items[1]);
  });

  it("dispose 后按键失效（幂等）", () => {
    const h = setup(3);
    h.handle.dispose();
    h.handle.dispose();
    key(h.items[0], "ArrowDown");
    expect(h.root.activeElement).not.toBe(h.items[1]);
  });

  it("无 item 时全防御：按键/syncIndex/activate 均安全 no-op", () => {
    const h = setup(0);
    expect(() => {
      key(h.container, "ArrowDown");
      h.handle.syncIndex(5);
      h.handle.activate();
    }).not.toThrow();
  });

  it("container 选择器解析不到时返回惰性句柄（不抛）", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const handle = bindRoving({ root, container: "#missing", itemSelector: ".x" });
    expect(() => {
      handle.syncIndex(0);
      handle.activate();
      handle.dispose();
    }).not.toThrow();
  });
});
