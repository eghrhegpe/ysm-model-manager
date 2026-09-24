// @vitest-environment happy-dom
// ===== tabs-shell bindSubBar 键盘化测试（ADR-300 §3 遗留接线）=====
//
// 覆盖：renderSubBar 产出的真 bar（role="toolbar"）在 bindSubBar 下的
//   - roving tabindex 初始态
//   - 方向键 ArrowLeft/Right 循环移动 + 激活迁移 + aria-checked 同步
//   - Home/End 焦点跳首/尾（radiogroup 语义：只移焦点不激活）
//   - Enter/Space 由原生 button 触发 click → activate（键盘可达）
//   - 兼容：无 role="toolbar" 的手写夹具 → 不挂键盘增强，仅点击可用

import { describe, it, expect, beforeEach } from "vitest";
import { bindSubBar, renderSubBar } from "./tabs-shell.ts";

/** 组装一个 shadow 根：真 bar（renderSubBar）+ 一个 data-sub-pane 面板 */
function mountBar(group: string, ids: string[], activeId: string): ShadowRoot {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    renderSubBar(group, ids.map((id) => ({ id, label: id })), activeId) +
    `<div data-sub-group="${group}" data-sub-pane="${ids.join(" ")}">pane</div>`;
  document.body.appendChild(host);
  return root;
}

/** 派发键盘 keydown 到 bar（bindSubBar 的监听落在 bar 上） */
function pressKey(root: ShadowRoot, group: string, key: string): void {
  const bar = root.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="${group}"]`)!;
  bar.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/** 读取当前 roving index：返回 tabindex===0 的 pill */
function currentPill(root: ShadowRoot, group: string): string {
  const bar = root.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="${group}"]`)!;
  const zero = [...bar.querySelectorAll<HTMLElement>(".diag-sub-tab")].find(
    (p) => p.tabIndex === 0,
  );
  return zero?.dataset.sub ?? "";
}

/** 读取激活 pill：aria-checked === true 且带 .active */
function activeSub(root: ShadowRoot, group: string): string {
  const bar = root.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="${group}"]`)!;
  const checked = [...bar.querySelectorAll<HTMLElement>(".diag-sub-tab")].find(
    (p) => p.getAttribute("aria-checked") === "true",
  );
  return checked?.dataset.sub ?? "";
}

const GROUP = "logs";
const IDS = ["op", "runtime", "trace"];

describe("bindSubBar 键盘化（renderSubBar 产出的真 bar）", () => {
  let root: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = "";
    mountBar(GROUP, IDS, "op");
    root = document.body.firstElementChild!.shadowRoot!;
    bindSubBar(root, GROUP);
  });

  it("初始 roving tabindex 落在激活项（op tabindex=0，其余 -1）", () => {
    const bar = root.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="${GROUP}"]`)!;
    const tabs = [...bar.querySelectorAll<HTMLElement>(".diag-sub-tab")];
    expect(tabs.find((p) => p.dataset.sub === "op")!.tabIndex).toBe(0);
    expect(tabs.find((p) => p.dataset.sub === "runtime")!.tabIndex).toBe(-1);
    expect(tabs.find((p) => p.dataset.sub === "trace")!.tabIndex).toBe(-1);
  });

  it("ArrowRight：焦点移到下一项并激活它（radio 语义：移动即选中）", () => {
    const op = root.querySelector<HTMLElement>('.diag-sub-tab[data-sub="op"]')!;
    op.focus();
    pressKey(root, GROUP, "ArrowRight");
    expect(root.activeElement?.getAttribute("data-sub")).toBe("runtime");
    expect(activeSub(root, GROUP)).toBe("runtime");
    expect(currentPill(root, GROUP)).toBe("runtime");
    // aria-checked 同步
    const runtime = root.querySelector<HTMLElement>('.diag-sub-tab[data-sub="runtime"]')!;
    expect(runtime.getAttribute("aria-checked")).toBe("true");
    const opBtn = root.querySelector<HTMLElement>('.diag-sub-tab[data-sub="op"]')!;
    expect(opBtn.getAttribute("aria-checked")).toBe("false");
    // data-active-sub 同步（后进消费者读它）
    const bar = root.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="${GROUP}"]`)!;
    expect(bar.dataset.activeSub).toBe("runtime");
  });

  it("ArrowLeft：焦点移到前一项并激活（循环到末尾）", () => {
    const op = root.querySelector<HTMLElement>('.diag-sub-tab[data-sub="op"]')!;
    op.focus();
    pressKey(root, GROUP, "ArrowLeft");
    expect(root.activeElement?.getAttribute("data-sub")).toBe("trace");
    expect(activeSub(root, GROUP)).toBe("trace");
    expect(currentPill(root, GROUP)).toBe("trace");
  });

  it("ArrowRight 在末尾循环回首位（环状导航）", () => {
    const trace = root.querySelector<HTMLElement>('.diag-sub-tab[data-sub="trace"]')!;
    trace.focus(); // trace 是 tabindex=-1，但 focus() 仍使其成为 activeElement
    pressKey(root, GROUP, "ArrowRight");
    // trace 处于末尾索引 2 → 右移回首位 op（环状）
    expect(root.activeElement?.getAttribute("data-sub")).toBe("op");
    expect(activeSub(root, GROUP)).toBe("op");
    expect(currentPill(root, GROUP)).toBe("op");
  });

  it("Home/End：只移焦点不激活（radiogroup 规范），且 roving 随之迁移", () => {
    const runtime = root.querySelector<HTMLElement>('.diag-sub-tab[data-sub="runtime"]')!;
    runtime.focus();
    expect(activeSub(root, GROUP)).toBe("op"); // 激活未变
    expect(root.activeElement?.getAttribute("data-sub")).toBe("runtime");
    pressKey(root, GROUP, "Home");
    expect(root.activeElement?.getAttribute("data-sub")).toBe("op");
    expect(activeSub(root, GROUP)).toBe("op"); // Home 只移焦点，激活保持 op
    pressKey(root, GROUP, "End");
    expect(root.activeElement?.getAttribute("data-sub")).toBe("trace");
    expect(activeSub(root, GROUP)).toBe("op"); // 仍不激活
  });

  it("方向键触发 onSwitch（激活副作用回调同步触发）", () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    const r2 = host.attachShadow({ mode: "open" });
    r2.innerHTML =
      renderSubBar(GROUP, IDS.map((id) => ({ id, label: id })), "op") +
      `<div data-sub-group="${GROUP}" data-sub-pane="${IDS.join(" ")}">pane</div>`;
    document.body.appendChild(host);
    const calls: string[] = [];
    bindSubBar(r2, GROUP, (id) => calls.push(id));
    const bar = r2.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="${GROUP}"]`)!;
    const op = r2.querySelector<HTMLElement>('.diag-sub-tab[data-sub="op"]')!;
    // 真实聚焦 op → ArrowRight 应从 op 走到 runtime
    op.focus();
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(calls).toEqual(["runtime"]);
  });
});

describe("bindSubBar 兼容性：无 role=toolbar 的手写夹具", () => {
  it("仅点击可用（无键盘委托、无 aria 变更），且既有 DOM 不被改写", () => {
    const host = document.createElement("div");
    const hroot = host.attachShadow({ mode: "open" });
    // 手写夹具（init.test / perf.test 同形）：无 role / 无 aria / 无 tabindex
    hroot.innerHTML = `
      <div class="diag-sub-bar" data-sub-bar="logs" data-active-sub="op">
        <button class="diag-sub-tab active" data-sub="op">操作</button>
        <button class="diag-sub-tab" data-sub="runtime">运行时</button>
      </div>
      <div data-sub-group="logs" data-sub-pane="op runtime">pane</div>`;
    document.body.appendChild(host);
    const xRoot = host.shadowRoot!;

    // 绑定后：不改写既有按钮属性（无 role/aria/tabindex 注入）
    bindSubBar(xRoot, "logs");
    const buttons = [...xRoot.querySelectorAll<HTMLElement>(".diag-sub-tab")];
    buttons.forEach((b) => {
      expect(b.getAttribute("role")).toBeNull();
      expect(b.getAttribute("aria-checked")).toBeNull();
      expect(b.hasAttribute("tabindex")).toBe(false);
    });

    // 点击仍生效（激活迁移到 runtime）
    (xRoot.querySelector<HTMLElement>('.diag-sub-tab[data-sub="runtime"]')!).click();
    expect(xRoot.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="logs"]`)!.dataset.activeSub).toBe(
      "runtime",
    );

    // 无键盘委托：ArrowRight 不应改变 activeElement（bar 无 role=toolbar → 早退）
    const bar = xRoot.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="logs"]`)!;
    const before = document.activeElement;
    bar.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(before);
  });
});