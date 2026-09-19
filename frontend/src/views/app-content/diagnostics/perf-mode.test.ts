// @vitest-environment happy-dom
// ===== 诊断页：基准模式接线测试（ADR-278 §2.1 / §2.3 / §2.4）=====
// 覆盖：
//  - 默认 single：非当前模式的 `[data-perf-mode]` 行被加 `.perf-mode-off`，且**不写 inline style**
//    （查看器降级用的是 inline `display:none`，两种机制不能互相覆盖——ADR-278 §2.4）
//  - 切 conc：单模型那套隐藏、并发那套显示；目标集「单模型」选项被禁用 + 已选中值回落到全库扁平
//  - 切回 single：选项恢复可选（disable 是模式态，不是一次性改动）
//  - 引擎对照模式：迭代行可见（single 与 scan 共用同一迭代次数）
//  - 目标集填充（async，会重建 <option>）之后模式态被重放，disabled 不丢
import { describe, it, expect, vi, beforeEach } from "vitest";
import { initPerfPanel } from "./perf.ts";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** 夹具对齐 tpl.ts 的 bench tab：模式选择器 + 按模式分行的控件 + 结果容器 */
function makeRoot(mode = "single"): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <select id="diag-perf-mode" data-testid="diag-perf-mode">
      <option value="single">单模型</option>
      <option value="conc">并发</option>
      <option value="scan">引擎对照</option>
    </select>
    <select id="diag-perf-rtype" data-testid="diag-perf-rtype">
      <option value="">单模型</option>
      <option value="__repo__">全库扁平</option>
    </select>
    <select id="diag-perf-order" data-testid="diag-perf-order">
      <option value="path">路径升序</option>
    </select>
    <input id="diag-perf-max" value="5">
    <input id="diag-perf-baseline-save" type="checkbox">
    <input id="diag-perf-baseline-compare" type="checkbox">
    <input id="diag-perf-baseline-th" value="50">
    <div class="perf-row" data-perf-mode="single" id="row-single"></div>
    <div class="perf-row" data-perf-mode="single scan" id="row-iter"></div>
    <div class="perf-row" data-perf-mode="conc" id="row-conc"></div>
    <div class="perf-row" data-perf-mode="scan" id="row-scan"></div>
    <div id="diag-perf-single" data-perf-mode="single"></div>
    <div id="diag-perf-conc-out" data-perf-mode="conc"></div>
    <div id="diag-perf-scan-bench-out" data-perf-mode="scan"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  (el.querySelector("#diag-perf-mode") as HTMLSelectElement).value = mode;
  return el as unknown as ShadowRoot;
}

/** 行是否被模式规则关掉（走 class，而非 inline style） */
const off = (root: ShadowRoot, id: string): boolean =>
  (root.getElementById(id) as HTMLElement).classList.contains("perf-mode-off");

function switchMode(root: ShadowRoot, mode: string): void {
  const sel = root.getElementById("diag-perf-mode") as HTMLSelectElement;
  sel.value = mode;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

const modelOption = (root: ShadowRoot): HTMLOptionElement | undefined =>
  [...(root.getElementById("diag-perf-rtype") as HTMLSelectElement).options].find(
    (o) => o.value === "",
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("基准模式接线（ADR-278）", () => {
  it("默认 single：只显示单模型那一套，且显隐走 class 而非 inline style", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    expect(off(root, "row-single")).toBe(false);
    expect(off(root, "row-iter")).toBe(false); // 「single scan」共用的迭代行
    expect(off(root, "row-conc")).toBe(true);
    expect(off(root, "row-scan")).toBe(true);
    expect(off(root, "diag-perf-conc-out")).toBe(true);
    // 关键：不能写 inline style——查看器降级用 inline display:none，模式接线必须让位
    expect((root.getElementById("row-conc") as HTMLElement).style.display).toBe("");
  });

  it("切 conc：并发那套显示、单模型那套隐藏；「单模型」选项禁用 + 值回落到全库扁平", async () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    await Promise.resolve(); // 目标集填充是 async（重建 <option>），等它落地
    const target = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    expect(target.value).toBe(""); // 初始 = 单模型（与 tpl 静态首项一致）

    switchMode(root, "conc");
    expect(off(root, "row-conc")).toBe(false);
    expect(off(root, "row-single")).toBe(true);
    expect(off(root, "row-iter")).toBe(true); // 迭代次数只归 single / scan
    expect(modelOption(root)?.disabled).toBe(true);
    expect(target.value).toBe("__repo__");
  });

  it("切回 single：单模型选项恢复可选（disable 是模式态，不是永久改动）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    switchMode(root, "conc");
    switchMode(root, "single");
    expect(modelOption(root)?.disabled).toBe(false);
    expect(off(root, "row-single")).toBe(false);
    expect(off(root, "row-conc")).toBe(true);
  });

  it("引擎对照模式：迭代行可见（single / scan 共用同一迭代次数），单模型与并发行隐藏", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    switchMode(root, "scan");
    expect(off(root, "row-scan")).toBe(false);
    expect(off(root, "row-iter")).toBe(false);
    expect(off(root, "row-single")).toBe(true);
    expect(off(root, "row-conc")).toBe(true);
  });

  it("目标集填充重建 <option> 后模式态被重放：并发下「单模型」仍禁用（disabled 不丢）", async () => {
    const root = makeRoot("conc"); // 直接以并发模式初始化（切模式的时序最刁钻的一条路径）
    initPerfPanel(root, esc);
    await Promise.resolve();
    await Promise.resolve();
    expect(modelOption(root)?.disabled).toBe(true);
    expect((root.getElementById("diag-perf-rtype") as HTMLSelectElement).value).toBe("__repo__");
  });
});
