// ===== utils/dom/dropdown.ts — 通用下拉控制器契约测试 =====
// 锁死五件事：click 展开/收起（aria-expanded 翻转）、menu/menuitem ARIA 落位、
// 键盘（展开即焦首项、↑↓循环、Home/End、Esc 关闭+焦点回 trigger）、
// 外点关闭（composedPath 判定，Shadow 内 target 被 retarget 也可）、
// onOpen 每次展开都回调（作者菜单缓存竞态的根治契约）+ 多下拉互斥 + dispose 解绑。
import { describe, expect, it, vi } from "vitest";
import { initDropdown } from "./dropdown.ts";

function makeFixture(): { host: HTMLElement; root: ShadowRoot; $: (id: string) => HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<button id="outside"></button>
<div class="dd-wrap" id="dd1">
  <button id="btn1">触发</button>
  <div class="dd-menu" id="menu1">
    <button class="dd-item">A</button>
    <button class="dd-item">B</button>
    <button class="dd-item">C</button>
  </div>
</div>
<div class="dd-wrap" id="dd2">
  <button id="btn2">触发2</button>
  <div class="dd-menu" id="menu2"><button class="dd-item">X</button></div>
</div>`;
  const $ = (id: string): HTMLElement => root.getElementById(id) as HTMLElement;
  return { host, root, $ };
}

function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

describe("initDropdown — 展开/收起与 ARIA", () => {
  it("trigger click 展开 ⇄ 收起，aria-haspopup/expanded 全程同步", () => {
    const { host, $ } = makeFixture();
    const dispose = initDropdown($("dd1"));
    const trigger = $("btn1") as HTMLButtonElement;
    const menu = $("menu1");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.style.display).toBe("block");
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.style.display).toBe("none");
    dispose();
    host.remove();
  });

  it("展开时落位 role=menu / role=menuitem（动态项每次展开重刷）", () => {
    const { host, $ } = makeFixture();
    const dispose = initDropdown($("dd1"));
    $("btn1").click();
    expect($("menu1").getAttribute("role")).toBe("menu");
    const items = $("menu1").querySelectorAll("button");
    expect(items[0]!.getAttribute("role")).toBe("menuitem");
    expect(items[2]!.getAttribute("role")).toBe("menuitem");
    dispose();
    host.remove();
  });

  it("点击菜单项 → 收起且焦点回 trigger", () => {
    const { host, root, $ } = makeFixture();
    const dispose = initDropdown($("dd1"));
    $("btn1").click();
    ($("menu1").querySelectorAll("button")[1] as HTMLElement).click();
    expect($("btn1").getAttribute("aria-expanded")).toBe("false");
    expect(root.activeElement).toBe($("btn1"));
    dispose();
    host.remove();
  });

  it("外部点击 → 收起；wrap 内部点击不误伤", () => {
    const { host, $ } = makeFixture();
    const dispose = initDropdown($("dd1"));
    $("btn1").click();
    // 菜单容器自身上的点击（非 .dd-item）：既不关闭（外点判定豁免），也无需 role 触发
    $("menu1").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect($("btn1").getAttribute("aria-expanded")).toBe("true");
    $("outside").click();
    expect($("btn1").getAttribute("aria-expanded")).toBe("false");
    dispose();
    host.remove();
  });
});

describe("initDropdown — 键盘契约", () => {
  it("展开即焦首项；↑↓ 循环；Home/End 跳端点；Esc 关闭并回焦", () => {
    const { host, root, $ } = makeFixture();
    const dispose = initDropdown($("dd1"));
    const menu = $("menu1");
    const items = [...menu.querySelectorAll("button")] as HTMLElement[];
    $("btn1").click();
    expect(root.activeElement).toBe(items[0]);
    key(items[0]!, "ArrowDown");
    expect(root.activeElement).toBe(items[1]);
    key(items[1]!, "ArrowDown");
    expect(root.activeElement).toBe(items[2]);
    key(items[2]!, "ArrowDown"); // 末项 ↓ 循环回首
    expect(root.activeElement).toBe(items[0]);
    key(items[0]!, "ArrowUp"); // 首项 ↑ 循环到末
    expect(root.activeElement).toBe(items[2]);
    key(items[2]!, "Home");
    expect(root.activeElement).toBe(items[0]);
    key(items[0]!, "End");
    expect(root.activeElement).toBe(items[2]);
    key(items[2]!, "Escape");
    expect($("btn1").getAttribute("aria-expanded")).toBe("false");
    expect(root.activeElement).toBe($("btn1"));
    dispose();
    host.remove();
  });
});

describe("initDropdown — onOpen / 互斥 / dispose", () => {
  it("onOpen 每次展开都执行一次（作者菜单缓存竞态的根治契约）", () => {
    const { host, $ } = makeFixture();
    const onOpen = vi.fn();
    const dispose = initDropdown($("dd1"), { onOpen });
    $("btn1").click();
    $("btn1").click(); // 收起
    $("btn1").click(); // 再展开
    expect(onOpen).toHaveBeenCalledTimes(2);
    dispose();
    host.remove();
  });

  it("两个下拉互斥：开第二个自动关第一个", () => {
    const { host, $ } = makeFixture();
    const d1 = initDropdown($("dd1"));
    const d2 = initDropdown($("dd2"));
    $("btn1").click();
    $("btn2").click();
    expect($("btn1").getAttribute("aria-expanded")).toBe("false");
    expect($("btn2").getAttribute("aria-expanded")).toBe("true");
    d1();
    d2();
    host.remove();
  });

  it("dispose 后监听全部解绑：trigger 点击不再展开", () => {
    const { host, $ } = makeFixture();
    const dispose = initDropdown($("dd1"));
    dispose();
    $("btn1").click();
    expect($("menu1").style.display).toBe(""); // 从未被控制器打开
    host.remove();
  });

  it("结构缺失（无 trigger 或 .dd-menu）→ 静默 no-op，返回可调用 dispose", () => {
    const host = document.createElement("div");
    const dispose = initDropdown(host);
    expect(typeof dispose).toBe("function");
    dispose();
  });
});

describe("initDropdown — handle.close（程序化收起，2026-09 句柄扩展）", () => {
  it("展开后 close() → display none + aria-expanded false；重复 close 幂等 no-op", () => {
    const { host, $ } = makeFixture();
    const handle = initDropdown($("dd1"));
    $("btn1").click();
    expect($("btn1").getAttribute("aria-expanded")).toBe("true");
    handle.close();
    expect($("btn1").getAttribute("aria-expanded")).toBe("false");
    expect($("menu1").style.display).toBe("none");
    handle.close(); // 已关 → 幂等，不抛不翻转
    expect($("btn1").getAttribute("aria-expanded")).toBe("false");
    handle();
    host.remove();
  });

  it("close 后控制器状态完整可恢复：trigger 点击仍可正常展开", () => {
    const { host, $ } = makeFixture();
    const handle = initDropdown($("dd1"));
    $("btn1").click();
    handle.close();
    $("btn1").click();
    expect($("btn1").getAttribute("aria-expanded")).toBe("true");
    expect($("menu1").style.display).toBe("block");
    handle();
    host.remove();
  });

  it("close 清空互斥槽：关 A 后开 B 不再触发 A 的陈旧 close（多下拉互斥契约不破）", () => {
    const { host, $ } = makeFixture();
    const d1 = initDropdown($("dd1"));
    const d2 = initDropdown($("dd2"));
    $("btn1").click();
    d1.close();
    $("btn2").click();
    expect($("btn2").getAttribute("aria-expanded")).toBe("true");
    expect($("btn1").getAttribute("aria-expanded")).toBe("false");
    d1();
    d2();
    host.remove();
  });

  it("结构缺失 → noop 句柄：close() 可安全调用不抛", () => {
    const host = document.createElement("div");
    const handle = initDropdown(host);
    expect(typeof handle.close).toBe("function");
    handle.close();
    handle();
  });
});
