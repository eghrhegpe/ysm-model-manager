// @vitest-environment happy-dom
// ===== infra/overlay-style-bridge —— 样式注入目标桥不变量 =====
// 锁三条契约：
//  ① 幂等注入按 key（同 key 只落一份 <style>，不同 key 互不干扰）；
//  ② 目标切换（head ↔ shadow root ↔ null 兜底）后**同一 key 可重注入**——旗标复位
//     是 ADR-175 M1 的核心：漏复位 = 新 shadow root 拿不到样式（菜单无样式裸奔）；
//  ③ 复位回调观测到的 overlayStyleRoot() 必须已是新目标（回调内取旧目标会把重注入
//     写回旧宿主，同样是静默样式丢失）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Bridge = typeof import("./overlay-style-bridge.ts");

/** 取全新模块实例：桥的状态（_target / _resets / _injectedOnce）是模块级，
 *  同一实例跨用例会互相污染（幂等集合残留 → 后续用例「恰好已注入」假绿）。 */
async function freshBridge(): Promise<Bridge> {
  vi.resetModules();
  return import("./overlay-style-bridge.ts");
}

/** 样式元素的文本（按出现顺序；调用方自决是否 sort 比较） */
function styleTexts(root: ParentNode): string[] {
  return [...root.querySelectorAll("style")].map((s) => s.textContent ?? "");
}

let hosts: HTMLElement[] = [];

function makeShadowRoot(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  return host.attachShadow({ mode: "open" });
}

beforeEach(() => {
  hosts = [];
  document.head.innerHTML = "";
});

afterEach(() => {
  for (const h of hosts) h.remove();
  hosts = [];
  document.head.innerHTML = "";
});

describe("overlay-style-bridge —— 注入目标与幂等", () => {
  it("未设定目标 → 回退 document.head（无 overlay 单例时直调 ensure 的路径不变）", async () => {
    const b = await freshBridge();
    expect(b.overlayStyleRoot()).toBe(document.head);
    b.installOnceStyles("menu", "A");
    expect(styleTexts(document.head)).toEqual(["A"]);
  });

  it("同 key 重复调用只注入一份；同 key 换 CSS 也不再注入（key 是唯一判据）", async () => {
    const b = await freshBridge();
    b.installOnceStyles("cap", "A");
    b.installOnceStyles("cap", "A");
    expect(styleTexts(document.head)).toEqual(["A"]);
    b.installOnceStyles("cap", "B"); // 内容不同、key 相同 → 仍视为已注入
    expect(styleTexts(document.head)).toEqual(["A"]);
  });

  it("不同 key 各自注入，互不吞并（key 作用域为域内标识而非全局单例）", async () => {
    const b = await freshBridge();
    b.installOnceStyles("menu", "M");
    b.installOnceStyles("cap", "C");
    b.installOnceStyles("vbu", "V");
    expect(styleTexts(document.head).sort()).toEqual(["C", "M", "V"]);
  });

  it("目标切到 shadow root → 同 key 重注入到新目标，旧目标元素不迁移也不清理", async () => {
    const b = await freshBridge();
    b.installOnceStyles("menu", "A"); // 先落 head
    const shadow = makeShadowRoot();
    b.setOverlayStyleTarget(shadow);
    expect(b.overlayStyleRoot()).toBe(shadow);
    // 切换动作本身不搬旧元素（新目标此刻为空）
    expect(styleTexts(shadow)).toEqual([]);
    b.installOnceStyles("menu", "A"); // 旗标已复位 → 必须重注入
    expect(styleTexts(shadow)).toEqual(["A"]);
    // head 旧元素留存（不迁移/不清理，避免误删其他会话的注入物）
    expect(styleTexts(document.head)).toEqual(["A"]);
  });

  it("目标切回 null 兜底 → 幂等集合再次复位，head 侧重注入（不因 key 已用过而静默跳过）", async () => {
    const b = await freshBridge();
    const shadow = makeShadowRoot();
    b.setOverlayStyleTarget(shadow);
    b.installOnceStyles("menu", "A");
    expect(styleTexts(shadow)).toEqual(["A"]);

    b.setOverlayStyleTarget(null);
    expect(b.overlayStyleRoot()).toBe(document.head);
    b.installOnceStyles("menu", "A");
    expect(styleTexts(document.head)).toEqual(["A"]);
    expect(styleTexts(shadow)).toEqual(["A"]); // shadow 副本留存
  });

  it("目标切换后同一目标内仍保持幂等（复位 ≠ 关闭去重）", async () => {
    const b = await freshBridge();
    const shadow = makeShadowRoot();
    b.setOverlayStyleTarget(shadow);
    b.installOnceStyles("menu", "A");
    b.installOnceStyles("menu", "A");
    b.installOnceStyles("menu", "A");
    expect(styleTexts(shadow)).toEqual(["A"]);
  });

  it("已注册的复位回调在每次切换时全部调用（含切到 null），且观测到的是**新**目标", async () => {
    const b = await freshBridge();
    const calls: string[] = [];
    let observedRoot: unknown;
    b.onOverlayStyleTargetReset(() => calls.push("r1"));
    b.onOverlayStyleTargetReset(() => {
      calls.push("r2");
      observedRoot = b.overlayStyleRoot();
    });

    const shadow = makeShadowRoot();
    b.setOverlayStyleTarget(shadow);
    expect(calls).toEqual(["r1", "r2"]);
    // 关键：回调执行时 _target 已更新——否则 ensure 重注入会写回旧宿主
    expect(observedRoot).toBe(shadow);

    b.setOverlayStyleTarget(null);
    expect(calls).toEqual(["r1", "r2", "r1", "r2"]);
    expect(observedRoot).toBe(document.head);
  });

  it("CSS 原样落 textContent（不被当 HTML 解析/求值）", async () => {
    const b = await freshBridge();
    const css = ".cs-bar { background: url(a<b.png); }";
    b.installOnceStyles("mdli", css);
    const el = document.head.querySelector("style");
    expect(el?.textContent).toBe(css);
    expect(el?.children.length).toBe(0);
  });
});
