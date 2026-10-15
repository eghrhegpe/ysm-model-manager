// @vitest-environment happy-dom
// ===== 诊断页：基准面板参数密度测试（2026-10-15 锐评改进 P0）=====
// 覆盖：默认简版 / 点击展开收起的双向翻转 / 收起时勾选归零（不可见不生效）/
//       持久化跨会话 / 特性缺席不介入（越权护栏）。
// ⚠️ 每条均按「变异即红」设计：删对应实现行必让对应用例转红（同仓反向验证口径）。
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyPerfDensity,
  initPerfDensity,
  PERF_DENSITY_KEY,
  readPerfDensity,
} from "./perf-density.ts";

/** 与 tpl.ts 诊断页 bench 组同形的最小夹具：密度开关 + 进阶档基准组 + 两个勾选 */
function makeRoot(withToggle = true): ShadowRoot {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <button id="diag-perf-density" data-testid="diag-perf-density" type="button" aria-pressed="false">
      ⚙ <span data-perf-density-label>基准对比选项</span>
    </button>
    <div class="diag-param-group" data-perf-density="advanced">
      <input id="diag-perf-baseline-save" type="checkbox">
      <input id="diag-perf-baseline-compare" type="checkbox">
      <input id="diag-perf-baseline-th" type="number" value="50">
    </div>
    <div data-perf-density="advanced"><input id="diag-perf-iter" type="number"></div>
  `;
  if (!withToggle) {
    root.getElementById("diag-perf-density")?.remove();
  }
  return root;
}

beforeEach(() => {
  // 持久化起点必须干净：上一用例写入的 advanced 会让下一用例的默认态断言误判
  // （同 dedup 配置持久化的既有教训「⚠️ 测试需 localStorage.clear() 起点干净」）
  localStorage.clear();
});

describe("readPerfDensity", () => {
  it("默认简版（无持久化值）", () => {
    expect(readPerfDensity()).toBe("simple");
  });
  it("只认 advanced 为正，野生值回落简版", () => {
    localStorage.setItem(PERF_DENSITY_KEY, "advanced");
    expect(readPerfDensity()).toBe("advanced");
    localStorage.setItem(PERF_DENSITY_KEY, "whatever");
    expect(readPerfDensity()).toBe("simple");
  });
});

describe("applyPerfDensity", () => {
  it("简版 = 进阶档加 perf-density-off，aria-pressed=false", () => {
    const root = makeRoot();
    applyPerfDensity(root, "simple");
    for (const el of root.querySelectorAll<HTMLElement>('[data-perf-density="advanced"]')) {
      expect(el.classList.contains("perf-density-off")).toBe(true);
    }
    expect(root.getElementById("diag-perf-density")?.getAttribute("aria-pressed")).toBe("false");
  });
  it("进阶 = 收起态解除，aria-pressed=true", () => {
    const root = makeRoot();
    applyPerfDensity(root, "simple");
    applyPerfDensity(root, "advanced");
    for (const el of root.querySelectorAll<HTMLElement>('[data-perf-density="advanced"]')) {
      expect(el.classList.contains("perf-density-off")).toBe(false);
    }
    expect(root.getElementById("diag-perf-density")?.getAttribute("aria-pressed")).toBe("true");
  });
  it("收起时勾选归零——不可见的参数不得参与下一次命令（变异点：删归零循环即红）", () => {
    const root = makeRoot();
    const save = root.getElementById("diag-perf-baseline-save") as HTMLInputElement;
    const cmp = root.getElementById("diag-perf-baseline-compare") as HTMLInputElement;
    save.checked = true;
    cmp.checked = true;
    applyPerfDensity(root, "simple");
    expect(save.checked).toBe(false);
    expect(cmp.checked).toBe(false);
  });
  it("进阶态不归零勾选（展开就是给用户用的）", () => {
    const root = makeRoot();
    const save = root.getElementById("diag-perf-baseline-save") as HTMLInputElement;
    save.checked = true;
    applyPerfDensity(root, "advanced");
    expect(save.checked).toBe(true);
  });
  it("特性缺席（无密度开关）→ 整体不介入，勾选保持原样（越权护栏）", () => {
    const root = makeRoot(false);
    const save = root.getElementById("diag-perf-baseline-save") as HTMLInputElement;
    save.checked = true;
    applyPerfDensity(root, "simple");
    expect(save.checked).toBe(true);
    // 进阶档容器也未被翻 class——没有开关就没有收起这件事
    const group = root.querySelector<HTMLElement>('[data-perf-density="advanced"]');
    expect(group?.classList.contains("perf-density-off")).toBe(false);
  });
  it("按钮缺席时不得抛错（旧夹具宽容口径）", () => {
    const root = makeRoot(false);
    expect(() => applyPerfDensity(root, "advanced")).not.toThrow();
    expect(() => initPerfDensity(root)).not.toThrow();
  });
});

describe("initPerfDensity", () => {
  it("装配即按持久化态渲染：advanced 持久化 → 面板重建后仍是进阶档", () => {
    localStorage.setItem(PERF_DENSITY_KEY, "advanced");
    const root = makeRoot();
    const state = initPerfDensity(root);
    expect(state).toBe("advanced");
    const group = root.querySelector<HTMLElement>('[data-perf-density="advanced"]');
    expect(group?.classList.contains("perf-density-off")).toBe(false);
  });
  it("点击翻转态并持久化（重启不丢）", () => {
    const root = makeRoot();
    initPerfDensity(root);
    root.getElementById("diag-perf-density")?.click();
    expect(localStorage.getItem(PERF_DENSITY_KEY)).toBe("advanced");
    expect(readPerfDensity()).toBe("advanced");
    // 新会话（新 root）读到持久化的进阶态
    const root2 = makeRoot();
    expect(initPerfDensity(root2)).toBe("advanced");
  });
  it("再点一次回落简版且勾选归零", () => {
    const root = makeRoot();
    initPerfDensity(root);
    root.getElementById("diag-perf-density")?.click(); // → advanced
    const cmp = root.getElementById("diag-perf-baseline-compare") as HTMLInputElement;
    cmp.checked = true;
    root.getElementById("diag-perf-density")?.click(); // → simple
    expect(localStorage.getItem(PERF_DENSITY_KEY)).toBe("simple");
    expect(cmp.checked).toBe(false);
  });
  it("重复 init 同一 root 不叠加监听：两次装配后一次点击只翻转一次", () => {
    const root = makeRoot();
    initPerfDensity(root);
    initPerfDensity(root); // 若监听叠加，本次点击会被两个 handler 翻转两次 = 回到原态
    root.getElementById("diag-perf-density")?.click();
    expect(readPerfDensity()).toBe("advanced");
  });
});
