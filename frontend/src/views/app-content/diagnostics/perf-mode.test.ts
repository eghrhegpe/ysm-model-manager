// @vitest-environment happy-dom
// ===== 诊断页：基准模式接线测试（ADR-278 §2.1 / §2.3 / §2.4 / §2.6）=====
// 覆盖：
//  - 切 conc：单模型那套隐藏、并发那套显示；目标集「单模型」选项被禁用 + 已选中值回落到全库扁平
//  - 切回 single：选项恢复可选（disable 是模式态，不是一次性改动）
//  - 默认 single：非当前模式的 `[data-perf-mode]` 行被加 `.perf-mode-off`，且**不写 inline style**
//    （查看器降级用的是 inline `display:none`，两种机制不能互相覆盖——ADR-278 §2.4）
//  - 引擎对照模式：迭代行可见（single 与 scan 共用同一迭代次数）
//  - 目标集填充（async，会重建 <option>）之后模式态被重放，disabled 不丢
//  - ADR-278 §2.6 语义诚实层：同一个控件跨模式**改义必须当场说明**——迭代/目标集标签随模式改写、
//    每个运行按钮挂本模式「测什么对象」hint、并发回落不再静默改用户的选择
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "@/bus";
import { initPerfPanel, perfScopeHint, PERF_RUN_BUTTON_MODE_KEYS, PERF_UNREAD_MODES } from "./perf.ts";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));
// toast 原语走 bus.emit("toast:show")；本文件锁「并发回落有提示」，mock bus 以免真弹
vi.mock("@/bus", () => ({ bus: { emit: vi.fn(), on: vi.fn() } }));

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
    <div class="perf-row" data-perf-mode="single conc scan">
      <select id="diag-perf-order" data-testid="diag-perf-order">
        <option value="path">路径升序</option>
      </select>
    </div>
    <div class="perf-row" data-perf-mode="single" id="row-single"></div>
    <div class="perf-row" data-perf-mode="single scan" id="row-iter">
      <label for="diag-perf-iter" id="diag-perf-iter-label">迭代次数</label>
      <input id="diag-perf-iter" value="3">
    </div>
    <div class="perf-row" data-perf-mode="single conc" id="row-target">
      <label for="diag-perf-rtype" id="diag-perf-target-label">目标集</label>
    </div>
    <div class="perf-row" data-perf-mode="conc" id="row-conc-inputs">
      <input id="diag-perf-conc-workers" value="4">
      <input id="diag-perf-conc-max" value="20">
    </div>
    <div class="perf-row" data-perf-mode="single" id="row-single-model">
      <input id="diag-perf-model" value="/m/a.ysm">
    </div>
    <div class="perf-row" data-perf-mode="single" id="row-single-max">
      <input id="diag-perf-max" value="5">
    </div>
    <div class="perf-row" data-perf-mode="single" id="row-baseline">
      <input id="diag-perf-baseline-save" type="checkbox">
      <input id="diag-perf-baseline-compare" type="checkbox">
      <input id="diag-perf-baseline-th" value="50">
    </div>
    <button id="diag-perf-run"></button>
    <button id="diag-perf-conc-run"></button>
    <button id="diag-perf-scan-bench"></button>
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
const iterLabel = (root: ShadowRoot): HTMLElement | null =>
  root.getElementById("diag-perf-iter-label");
const targetLabel = (root: ShadowRoot): HTMLElement | null =>
  root.getElementById("diag-perf-target-label");

/** 并发模式下「单模型」选项被禁用且值回落到全库扁平 → 应有一次 toast 说明 */
const concFallbackToastMsgs = (): string[] =>
  (vi.mocked(bus.emit) as unknown as ReturnType<typeof vi.fn>).mock.calls
    .filter(([evt]) => evt === "toast:show")
    .map(([, payload]) => (payload as { msg?: string })?.msg ?? "");

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

  // ===== ADR-278 §2.6 语义诚实层 =====
  // 同一个控件跨模式改义，界面必须当场说清。三件事各钉一条；断言只锁**语义关键词**
  // （重复解析 / 全库重扫 / 一个模型…），不锁文案拼接形态——文案本体归 locale 三语文件，
  // 改措辞不应红测试（维护成本约束）。
  it("迭代标签随模式改写：single=重复解析 / scan=全库重扫（同一 #diag-perf-iter 两种物理含义）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    expect(iterLabel(root)?.textContent).toContain("重复解析");
    switchMode(root, "scan");
    expect(iterLabel(root)?.textContent).toContain("全库重扫");
    switchMode(root, "single");
    expect(iterLabel(root)?.textContent).toContain("重复解析");
  });

  it("目标集标签在并发模式改为「取样范围」（并发没有单模型，同控件在 conc 下只剩选样本语义）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    expect(targetLabel(root)?.textContent).toBe("目标集");
    switchMode(root, "conc");
    expect(targetLabel(root)?.textContent).toBe("取样范围");
    switchMode(root, "single");
    expect(targetLabel(root)?.textContent).toBe("目标集");
  });

  it("三个运行按钮各自挂本模式「测什么对象」的 hint（防把引擎对照误读为再测一次模型）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    const run = root.getElementById("diag-perf-run") as HTMLElement;
    const concRun = root.getElementById("diag-perf-conc-run") as HTMLElement;
    const scanRun = root.getElementById("diag-perf-scan-bench") as HTMLElement;
    expect(run.title).toContain("一个模型");
    expect(concRun.title).toContain("一批模型");
    expect(scanRun.title).toContain("目录树");
  });

  it("hint 接线表是单点事实源：每个运行按钮 id 都有派生 hint，未知模式不编造机制句", () => {
    // 新增模式忘登记 → 按钮 title 为空（界面退回沉默），这条把它变成可诊断的失败；
    // 同时锁 perfScopeHint 对陌生 mode 只落通用句，不串到 conc/scan 的机制长句上。
    for (const id of Object.keys(PERF_RUN_BUTTON_MODE_KEYS)) {
      expect(PERF_RUN_BUTTON_MODE_KEYS[id]).toBeTruthy();
    }
    expect(perfScopeHint("single")).not.toContain("·");
    expect(perfScopeHint("voxel")).toContain("voxel"); // 未登记模式名回落原样，不抛错不编造
    expect(perfScopeHint("voxel")).not.toContain("·");
  });

  it("并发回落不再静默：从 single 切到 conc 且原选「单模型」→ toast 说明回落到全库扁平", async () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    await Promise.resolve(); // 等目标集填充落地（它会重放模式态，不得多弹一次）
    expect(concFallbackToastMsgs().length).toBe(0); // 初始化不弹
    switchMode(root, "conc");
    const msgs = concFallbackToastMsgs();
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toContain("全库扁平");
    // 重放路径：填充完成后再次 apply()，值已是 __repo__ → 不重复弹
    await Promise.resolve();
    expect(concFallbackToastMsgs().length).toBe(1);
  });

  // ===== ADR-262 D8 的半边账：「被禁用」比「勾了却没生效」诚实——但门禁只管到目标集维度，
  // 没管到模式维度：基准三件套只登记在 single 行（tpl.ts data-perf-mode="single"），scan/conc
  // 下整行被 .perf-mode-off 隐藏（不可交互，诚实）；真正要钉的是反向：**当前模式可见却不被
  // 载荷读取**的控件必须 disabled——基准三件套在 conc/scan 下、并发控件在 single/scan 下。
  it("非 single 模式下可见但载荷不读的控件必已禁用（隐藏的不用禁，可见的可改就必须拒）", () => {
    // 按 data-perf-mode 可见性判定：整行被 .perf-mode-off 隐藏的无需禁（用户碰不到）；
    const baselineIds = [
      "diag-perf-baseline-save",
      "diag-perf-baseline-compare",
      "diag-perf-baseline-th",
    ];
    for (const mode of ["single", "conc", "scan"]) {
      const root = makeRoot(mode);
      initPerfPanel(root, esc);
      const visibleRows = [...root.querySelectorAll<HTMLElement>("[data-perf-mode]")].filter(
        (el) => !el.classList.contains("perf-mode-off"),
      );
      for (const id of [...baselineIds, "diag-perf-conc-workers", "diag-perf-conc-max"]) {
        const el = root.getElementById(id) as HTMLInputElement | null;
        if (!el) continue; // 夹具未放的控件不判（宽容旧 DOM）
        const inVisibleRow = visibleRows.some((row) => row.contains(el));
        if (!inVisibleRow) continue; // 整行已隐藏 → 不可交互，无需禁
        // 基准三件套是双维门禁：模式=single **且**目标集=model 才可用（ADR-262 D8，
        // syncPerfBaselineControls 管目标集维、本表管模式维）。夹具 rtype 默认 ""=单模型，
        // single 下基准就该可用——期望值随「当前选中目标集」算，不写死。
        const isModelTarget =
          (root.getElementById("diag-perf-rtype") as HTMLSelectElement).value === "";
        const live = id.startsWith("diag-perf-baseline-")
          ? mode === "single" && isModelTarget
          : !PERF_UNREAD_MODES[id]?.includes(mode); // 未登记 = 所有模式都读（如迭代框）
        expect({ mode, id, disabled: el.disabled }).toEqual({ mode, id, disabled: !live });
      }
    }
  });

  it("非 single 下拨目标集选择器不得把基准三件套解禁（双维门禁兼并判定）", () => {
    // 回归钉：syncPerfBaselineControls 也被 rtype change / 选项填充回调独立触发，
    // 若只判目标集维不读当前模式，scan/conc 下动一下选择器就绕过 §2.6 反向半边。
    const root = makeRoot("scan");
    initPerfPanel(root, esc);
    const rtype = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    rtype.value = ""; // 选回「单模型」——目标集维满足，但模式仍是 scan
    rtype.dispatchEvent(new Event("change"));
    for (const id of [
      "diag-perf-baseline-save",
      "diag-perf-baseline-compare",
      "diag-perf-baseline-th",
    ]) {
      expect({ id, disabled: (root.getElementById(id) as HTMLInputElement).disabled }).toEqual({
        id,
        disabled: true,
      });
    }
  });
});
