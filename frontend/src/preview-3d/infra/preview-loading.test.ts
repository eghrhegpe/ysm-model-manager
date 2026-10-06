// @vitest-environment happy-dom
// ===== infra/preview-loading —— 加载态渲染原语不变量 =====
// 锁四条契约：
//  ① determinate 模式的进度条必须携带**可被外部 querySelector 命中的 id**（barId 契约：
//     默认 ysm-progress / mmd 传 ysm-mmd-progress），否则 onProgress 更新宽度静默落空；
//  ② indeterminate 模式不得带 id（否则外部更新会误命中循环动画条）；
//  ③ 两模式的样式语义不得互换（determinate = 固定宽度 + transition；indeterminate = 动画）；
//  ④ showLoadFailure 的错误文案必须过 esc（错误消息常含路径/引号等，转义缺失即注入面），
//     且 toast 载荷为 error 型 + 长时长。
import { describe, it, expect, afterEach } from "vitest";
import { bus } from "@/bus";
import { zhCN } from "@/locales/zh-CN.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { renderLoadingState, showLoadFailure } from "./preview-loading.ts";

const ZH_LOAD_FAILED = zhCN["preview.loadFailed"] as string;
const ZH_LOADING_MODEL = zhCN["preview.loadingModel"] as string;

function makeEl(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

let els: HTMLElement[] = [];
function el(): HTMLElement {
  const e = makeEl();
  els.push(e);
  return e;
}

afterEach(() => {
  for (const e of els) e.remove();
  els = [];
});

describe("renderLoadingState —— 进度条 DOM 契约", () => {
  it("determinate：默认 barId 命中 #ysm-progress（外部更新宽度的锚点）", () => {
    const host = el();
    renderLoadingState(host, "🥽", "preview.loadingModel", "determinate");
    const bar = host.querySelector("#ysm-progress") as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar?.style.width).toBe("5%");
  });

  it("determinate：自定义 barId 生效，且不残留默认 id（单一更新目标）", () => {
    const host = el();
    renderLoadingState(host, "🧊", "preview.loadingVoxels", "determinate", "ysm-mmd-progress");
    expect(host.querySelector("#ysm-mmd-progress")).not.toBeNull();
    expect(host.querySelector("#ysm-progress")).toBeNull();
  });

  it("indeterminate（默认模式）：不带任何 id，外部更新目标不会误命中", () => {
    const host = el();
    renderLoadingState(host, "🥽", "preview.loadingModel");
    const bar = host.querySelector("#ysm-progress");
    expect(bar).toBeNull();
    // 悬挂的 barId 参数在 indeterminate 下不产生元素
    renderLoadingState(host, "🥽", "preview.loadingModel", "indeterminate", "ysm-mmd-progress");
    expect(host.querySelector("#ysm-mmd-progress")).toBeNull();
  });

  it("两模式样式语义不互换：determinate 有 transition 无 animation；indeterminate 反之", () => {
    const det = el();
    renderLoadingState(det, "🥽", "preview.loadingModel", "determinate");
    const detBar = det.querySelector("#ysm-progress") as HTMLElement;
    expect(detBar.style.transition).toContain("width");
    expect(detBar.style.animation).toBe("");

    const ind = el();
    renderLoadingState(ind, "🥽", "preview.loadingModel");
    // 进度条容器 = 最后一个子元素，其唯一子元素即条本体
    const container = ind.lastElementChild as HTMLElement;
    expect(container.children.length).toBe(1);
    const indBar = container.firstElementChild as HTMLElement;
    expect(indBar.style.animation).toContain("preview-prog");
    expect(indBar.style.transition).toBe("");
  });

  it("图标与本地化标签被渲染（labelKey 经 t() 落用户可见文案）", () => {
    const host = el();
    renderLoadingState(host, "🥽", "preview.loadingModel");
    expect(host.textContent).toContain("🥽");
    expect(host.textContent).toContain(ZH_LOADING_MODEL);
    expect(host.textContent).not.toContain("preview.loadingModel"); // 未漏翻成 key
  });

  it("重复渲染是覆写而非追加（不堆积多层进度条 → 旧条不吃事件/不残留）", () => {
    const host = el();
    renderLoadingState(host, "🥽", "preview.loadingModel", "determinate");
    const before = host.children.length;
    renderLoadingState(host, "🥽", "preview.loadingModel", "determinate");
    expect(host.querySelectorAll("#ysm-progress").length).toBe(1);
    expect(host.children.length).toBe(before); // 不追加
  });
});

describe("showLoadFailure —— 失败态与转义", () => {
  it("错误消息经 esc：HTML 元字符按文本呈现，不生成元素（注入面）", () => {
    const host = el();
    const payload = '<img src=x onerror="alert(1)">';
    showLoadFailure(host, new Error(payload));

    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain(payload); // 原文可见（已转义为实体）
    expect(host.innerHTML).toContain("&lt;img");
    expect(host.textContent).toContain(ZH_LOAD_FAILED);
  });

  it("失败态带 warning 图标占位（用户可辨识的失败视觉）", () => {
    const host = el();
    showLoadFailure(host, new Error("boom"));
    expect(host.children.length).toBeGreaterThanOrEqual(2);
    expect(host.textContent).toContain(ZH_LOAD_FAILED);
  });

  it("toast 载荷：error 型 + 长时长 + 含原始错误消息", () => {
    const host = el();
    const seen: Array<{ msg?: string; duration?: number; type?: string }> = [];
    const off = bus.on("toast:show", (p) => {
      seen.push(p as { msg?: string; duration?: number; type?: string });
    });
    try {
      showLoadFailure(host, new Error("boom"));
    } finally {
      off();
    }
    expect(seen.length).toBe(1);
    expect(seen[0].type).toBe("error");
    expect(seen[0].duration).toBe(TOAST_MS.long);
    expect(seen[0].msg).toContain("boom");
    expect(seen[0].msg).toContain(ZH_LOAD_FAILED); // friendlyError 的 fallback 口径
  });

  it("非 Error 载荷不抛（字符串 / null 退化输入）", () => {
    const host = el();
    expect(() => showLoadFailure(host, "plain failure")).not.toThrow();
    expect(host.textContent).toContain("plain failure");
    expect(() => showLoadFailure(el(), null)).not.toThrow();
    expect(() => showLoadFailure(el(), undefined)).not.toThrow();
  });
});
