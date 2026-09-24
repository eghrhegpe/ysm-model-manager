// ===== tabs-a11y 原语契约测试 =====
// 锁定从 bindTabs 剥离出的可访问性半边：ARIA tablist/tab/roving tabindex + 键盘导航 + 点击分派。
// 关键回归点：refresh() 重挂不得叠加旧监听（动态站点 tab 集合每次加载后重建，若不拆旧会双触发）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logWarn = vi.hoisted(() => vi.fn());
vi.mock("@/utils/base/primitives/log.ts", () => ({ logWarn, logError: vi.fn() }));

import { bindTabA11y } from "./tabs-a11y.ts";

function makeRoot(html: string): { root: ShadowRoot; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = html;
  return { root, host };
}

const SHELL = `
  <div class="repo-tabs">
    <button class="repo-tab" data-tab="alpha">A</button>
    <button class="repo-tab" data-tab="beta">B</button>
    <button class="repo-tab" data-tab="gamma">G</button>
  </div>
  <div id="x-tab-alpha">AAA</div>
  <div id="x-tab-beta">BBB</div>
  <div id="x-tab-gamma">GGG</div>`;

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  document.body.replaceChildren();
  logWarn.mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("bindTabA11y — ARIA 语义", () => {
  it("注入 tablist / role=tab / aria-controls / aria-selected / roving tabindex", () => {
    const { root } = makeRoot(SHELL);
    bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: () => {},
    });
    const tabs = [...root.querySelectorAll<HTMLElement>(".repo-tab")];
    expect(root.querySelector(".repo-tabs")?.getAttribute("role")).toBe("tablist");
    expect(tabs.map((b) => b.getAttribute("role"))).toEqual(["tab", "tab", "tab"]);
    expect(tabs.map((b) => b.getAttribute("aria-controls"))).toEqual([
      "x-tab-alpha",
      "x-tab-beta",
      "x-tab-gamma",
    ]);
    // 无 initialTabId：首个可见拿 tabindex=0，其余 -1
    expect(tabs.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(tabs.map((b) => b.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
  });

  it("initialTabId 命中时该按钮为激活项（tabindex=0 / aria-selected=true）", () => {
    const { root } = makeRoot(SHELL);
    bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: () => {},
      initialTabId: "beta",
    });
    const tabs = [...root.querySelectorAll<HTMLElement>(".repo-tab")];
    expect(tabs.map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(tabs.map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });
});

describe("bindTabA11y — 点击与键盘分派到 onActivate", () => {
  it("点击 → onActivate(btn, data-tab)", () => {
    const { root } = makeRoot(SHELL);
    const calls: Array<[string]> = [];
    bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: (_btn, id) => calls.push([id]),
    });
    (root.querySelector('.repo-tab[data-tab="gamma"]') as HTMLElement).click();
    expect(calls).toEqual([["gamma"]]);
  });

  it("ArrowRight 从激活项环绕 → focus 下一个并 onActivate", async () => {
    const { root } = makeRoot(SHELL);
    const calls: string[] = [];
    bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: (_b, id) => calls.push(id),
    });
    const beta = root.querySelector('.repo-tab[data-tab="beta"]') as HTMLElement;
    beta.focus();
    beta.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(root.activeElement).toBe(root.querySelector('.repo-tab[data-tab="gamma"]'));
    expect(calls).toContain("gamma");
  });

  it("End → 末位", () => {
    const { root } = makeRoot(SHELL);
    const calls: string[] = [];
    bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: (_b, id) => calls.push(id),
    });
    const alpha = root.querySelector('.repo-tab[data-tab="alpha"]') as HTMLElement;
    alpha.focus();
    alpha.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(calls).toContain("gamma");
  });
});

describe("bindTabA11y — validate 开关", () => {
  const BROKEN = `
    <div class="repo-tabs">
      <button class="repo-tab" data-tab="a">A</button>
      <button class="repo-tab">无tab</button>
      <button class="repo-tab" data-tab="a">重复A</button>
    </div>`;

  it("validate=true：缺 data-tab 与重复 data-tab 告警并从导航集合剔除", () => {
    const { root } = makeRoot(BROKEN);
    bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: () => {},
      validate: true,
    });
    expect(logWarn.mock.calls.some((c: unknown[]) => c.some((a) => String(a).includes("data-tab")))).toBe(true);
    // 去重后导航集合只剩首个 a：两个 nav 按钮中只有一个拿到 role=tab
    const tabs = [...root.querySelectorAll<HTMLElement>(".repo-tab")];
    expect(tabs.filter((b) => b.getAttribute("role") === "tab")).toHaveLength(1);
  });

  it("validate=false：缺 data-tab 静默跳过（无告警）", () => {
    const { root } = makeRoot(BROKEN);
    bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: () => {},
    });
    expect(logWarn).not.toHaveBeenCalled();
  });
});

describe("bindTabA11y — refresh 重挂不叠加", () => {
  it("重建按钮集合后 refresh，旧监听拆除：点击只触发一次", async () => {
    const { root } = makeRoot(
      '<div class="repo-tabs"><button class="repo-tab" data-tab="a">A</button></div>',
    );
    let count = 0;
    const handle = bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: () => {
        count++;
      },
    });
    (root.querySelector('.repo-tab[data-tab="a"]') as HTMLElement).click();
    expect(count).toBe(1);

    // 模拟异步重建：换一个 data-tab 的按钮集合，再 refresh
    root.innerHTML =
      '<div class="repo-tabs"><button class="repo-tab" data-tab="b">B</button></div>';
    handle.refresh();
    // 旧按钮已随 innerHTML 销毁；新按钮点击应触发 1 次
    (root.querySelector('.repo-tab[data-tab="b"]') as HTMLElement).click();
    expect(count).toBe(2);
  });

  it("refresh 重挂同集合不双触发（旧监听确已移除）", () => {
    const { root } = makeRoot(SHELL);
    const calls: string[] = [];
    const handle = bindTabA11y({
      root,
      tabSelector: ".repo-tab",
      panelId: (id) => `x-tab-${id}`,
      onActivate: (_b, id) => calls.push(id),
    });
    handle.refresh(); // 同一批按钮，若旧监听未拆会叠加成双触发
    (root.querySelector('.repo-tab[data-tab="beta"]') as HTMLElement).click();
    expect(calls.filter((c) => c === "beta")).toHaveLength(1);
  });
});
