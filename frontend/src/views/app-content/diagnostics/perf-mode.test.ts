// @vitest-environment happy-dom
// ===== 诊断页：基准模式接线测试（ADR-278 §2.1 / §2.3 / §2.4 / §2.6 × ADR-300 §2.1/§2.2）=====
// 覆盖：
//  - bench 组三 pill（单模型/批量并发/引擎对照，ADR-300 §2.1）：切 pill 即重放行门控与门禁
//  - 切 conc：单模型那套隐藏、并发那套显示；目标集「单模型」选项被禁用 + 已选中值回落到全库扁平
//  - 切回 single：选项恢复可选（disable 是模式态，不是一次性改动）
//  - 切 scan：公共区（测什么/排序）与两模式行**整体退场**（ADR-300 D1「碰不到 = 诚实」）
//  - 默认 single：非当前模式的 `[data-perf-mode]` 行被加 `.perf-mode-off`，且**不写 inline style**
//    （bindSubBar 子面板显隐用 inline display，两种机制作用对象不重叠——ADR-278 §2.4）
//  - 目标集填充（async，会重建 <option>）之后模式态被重放，disabled 不丢
//  - ADR-278 §2.6 语义诚实层：同一个控件跨模式**改义必须当场说明**——迭代/目标集标签随模式改写、
//    每个运行按钮挂本模式「测什么对象」hint、并发回落不再静默改用户的选择
//  - 门禁登记面扫描（大刀护栏）：tpl.ts bench 组的每个可输入控件必须有归宿，新控件忘登记即红
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "@/bus";
// BASELINE_CONTROL_IDS 现居共享叶 perf-common.ts（2026-09-23 断环迁居）；其余门禁表仍归 perf.ts。
import { BASELINE_CONTROL_IDS } from "./perf-common.ts";
import {
  applyPerfModeUI,
  initPerfPanel,
  perfScopeHint,
  PERF_RUN_BUTTON_MODE_KEYS,
  PERF_UNREAD_MODES,
  PERF_UNREAD_TARGETS,
} from "./perf.ts";

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

/** 夹具对齐 tpl.ts 的 bench 组（ADR-300 §2.2）：子 pill 行是模式源（原下拉退役）+ 按模式分行的控件 + 结果容器 */
function makeRoot(mode = "single"): ShadowRoot {
  const el = document.createElement("div");
  const pill = (id: string): string =>
    `<button class="diag-sub-tab${id === mode ? " active" : ""}" data-sub="${id}" data-testid="diag-sub-bench-${id}">${id}</button>`;
  el.innerHTML = `
    <div class="diag-sub-bar" data-sub-bar="bench" data-active-sub="${mode}">
      ${pill("single")}${pill("conc")}${pill("scan")}
    </div>
    <div class="diag-bar-row" data-perf-mode="single conc" id="row-target">
      <label for="diag-perf-rtype" id="diag-perf-target-label">目标集</label>
      <select id="diag-perf-rtype" data-testid="diag-perf-rtype">
        <option value="">单模型</option>
        <option value="__repo__">全库扁平</option>
      </select>
      <label for="diag-perf-order">排序</label>
      <select id="diag-perf-order" data-testid="diag-perf-order">
        <option value="path">路径升序</option>
      </select>
    </div>
    <div class="diag-bar-row" data-perf-mode="single" id="row-single"></div>
    <div class="diag-bar-row" data-perf-mode="single" id="row-iter">
      <label for="diag-perf-iter" id="diag-perf-iter-label">迭代次数</label>
      <input id="diag-perf-iter" value="3">
    </div>
    <div class="diag-bar-row" data-perf-mode="conc" id="row-conc-inputs">
      <input id="diag-perf-conc-workers" value="4">
      <input id="diag-perf-conc-max" value="20">
    </div>
    <div class="diag-bar-row" data-perf-mode="single" id="row-single-model">
      <input id="diag-perf-model" value="/m/a.ysm">
    </div>
    <div class="diag-bar-row" data-perf-mode="single" id="row-single-max">
      <input id="diag-perf-max" value="5">
    </div>
    <div class="diag-bar-row" data-perf-mode="single" id="row-baseline">
      <input id="diag-perf-baseline-save" type="checkbox">
      <input id="diag-perf-baseline-compare" type="checkbox">
      <input id="diag-perf-baseline-th" value="50">
    </div>
    <button id="diag-perf-run"></button>
    <button id="diag-perf-conc-run"></button>
    <button id="diag-perf-scan-bench"></button>
    <div class="diag-bar-row" data-perf-mode="conc" id="row-conc"></div>
    <div class="diag-bar-row" data-perf-mode="scan" id="row-scan">
      <label for="diag-perf-scan-iter" id="diag-perf-scan-iter-label">迭代次数</label>
      <input id="diag-perf-scan-iter" value="3">
    </div>
    <div id="diag-perf-single" data-perf-mode="single"></div>
    <div id="diag-perf-conc-out" data-perf-mode="conc"></div>
    <div id="diag-perf-scan-bench-out" data-perf-mode="scan"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

/** 行是否被模式规则关掉（走 class，而非 inline style） */
const off = (root: ShadowRoot, id: string): boolean =>
  (root.getElementById(id) as HTMLElement).classList.contains("perf-mode-off");

/**
 * 切模式 = 复刻生产链路（ADR-300 §2.2）：bindSubBar 会翻 active 类 + 写 data-active-sub 再
 * 经 onSwitch 调 applyPerfModeUI。夹具不经 bindSubBar（那是 init.ts 的接线），故这里三步都做。
 */
function switchMode(root: ShadowRoot, mode: string): void {
  const bar = root.querySelector<HTMLElement>('.diag-sub-bar[data-sub-bar="bench"]');
  if (!bar) throw new Error("夹具缺 bench 子 pill 行（模式源）");
  bar.dataset.activeSub = mode;
  bar
    .querySelectorAll<HTMLElement>(".diag-sub-tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.sub === mode));
  applyPerfModeUI(root);
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
    expect(off(root, "row-iter")).toBe(false); // 迭代行归 single
    expect(off(root, "row-target")).toBe(false); // 公共区归 single+conc（ADR-300 §2.1）
    expect(off(root, "row-conc")).toBe(true);
    expect(off(root, "row-scan")).toBe(true); // ADR-300 §2.1：scan 行可见性上轴，single 下退场
    expect(off(root, "diag-perf-conc-out")).toBe(true);
    // 关键：不能写 inline style——bindSubBar 的子面板显隐用 inline display，行门控必须让位
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
    expect(off(root, "row-iter")).toBe(true); // 迭代次数只归 single
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

  it("bench 组三 pill 值域 + scan 激活时公共区整体退场（ADR-300 §2.1 D1 拍板）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    const pills = [
      ...root.querySelectorAll<HTMLElement>('.diag-sub-bar[data-sub-bar="bench"] .diag-sub-tab'),
    ].map((b) => b.dataset.sub);
    // 模式源 = 三 pill（原下拉两 option + 独立 scan tab 的分裂形态收口）
    expect(pills).toEqual(["single", "conc", "scan"]);
    // 切到 conc：并发行亮、单模型行暗，公共区不受影响
    switchMode(root, "conc");
    expect(off(root, "row-conc")).toBe(false);
    expect(off(root, "row-single")).toBe(true);
    expect(off(root, "row-target")).toBe(false); // 公共区归 single+conc 两态
    expect(off(root, "row-iter")).toBe(true); // 迭代只归 single
    // 切到 scan：**公共区随子面板整体退场**（ADR-278 §2.7 内容判据的 pill 形态——
    // scan 的参数面从不碰目标集/排序，碰不到 = 诚实，无需置灰）
    switchMode(root, "scan");
    expect(off(root, "row-target")).toBe(true);
    expect(off(root, "row-single")).toBe(true);
    expect(off(root, "row-conc")).toBe(true);
    expect(off(root, "row-scan")).toBe(false);
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
  it("迭代标签单模型下显示「跑几次」（scan 收进 bench 组后有自己的门控行与标签框）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    expect(iterLabel(root)?.textContent).toContain("跑几次");
    // scan 的迭代框在 scan 门控行内，不随 single/conc 改写 #diag-perf-iter 标签（两框两口径）
    expect(root.getElementById("diag-perf-scan-iter")).not.toBeNull();
    expect(off(root, "row-scan")).toBe(true); // single 下 scan 行（含其迭代框）退场
  });

  it("目标集标签在并发模式改为「测哪些」（并发没有单模型，同控件在 conc 下只剩选样本语义）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    expect(targetLabel(root)?.textContent).toBe("测什么");
    switchMode(root, "conc");
    expect(targetLabel(root)?.textContent).toBe("测哪些");
    switchMode(root, "single");
    expect(targetLabel(root)?.textContent).toBe("测什么");
  });

  it("两个运行按钮各自挂本模式「测什么对象」的 hint（scan 按钮不派生：无共享参数可误读）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    const run = root.getElementById("diag-perf-run") as HTMLElement;
    const concRun = root.getElementById("diag-perf-conc-run") as HTMLElement;
    expect(run.title).toContain("一个模型");
    expect(concRun.title).toContain("一批模型");
    // scan 按钮的 scope 说明写在 bench 组 scan 行里（perfScanBenchHint），不靠模式表派生
    // （ADR-278 §2.7 内容判据随迁：scan 从不读共享控件，无「误读成换个方式测这个模型」的余地）
    expect(Object.keys(PERF_RUN_BUTTON_MODE_KEYS)).toEqual(["diag-perf-run", "diag-perf-conc-run"]);
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
    expect(msgs[0]).toContain("全库最重的几条");
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
    const baselineIds = BASELINE_CONTROL_IDS;
    for (const mode of ["single", "conc", "scan"]) {
      // ADR-300 §2.1：scan 上轴为第三 pill——其下共享区整体退场，本判据对它空转，
      // 但纳入循环防「未来给 scan 加可见共享控件却漏禁」的漂移
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
        // 基准三件套是双维门禁：模式=single **且**目标集=model 才可用（ADR-262 D8 × §2.6 四修，
        // syncPerfBaselineControls 兼并两维、本表管 apply 路径的模式维）。夹具 rtype 默认 ""=单模型，
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

  // ===== 第六维（同日六修）：目标集维不读也是欺骗，且这是**默认路径** =====
  // 五修护栏判据「行归属 ∨ 不读表」把「整行可见」当成合格，漏掉 single+model 默认态：
  // max / order 整行可见（行归属 single 通过护栏），但 singleBenchReadMode 在 target==="model"
  // 时提前 return，两者根本不进载荷。危险在于新手进 tab 就是这一态。
  it("single + 单模型目标（默认态）→ max / order 被禁且 title 说明原因（可见但不被读 = 欺骗）", async () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    await Promise.resolve(); // 等目标集异步填充落地（它会重建 <option> 并重放模式态）
    const rtype = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    rtype.value = ""; // 单模型
    rtype.dispatchEvent(new Event("change"));
    const max = root.getElementById("diag-perf-max") as HTMLInputElement;
    const order = root.getElementById("diag-perf-order") as HTMLSelectElement;
    expect({ max: max.disabled, order: order.disabled }).toEqual({ max: true, order: true });
    // 原因不能只说「禁用」——要告诉用户什么时候才生效
    expect(max.title).toContain("不生效");
  });

  it("single + 非单模型目标（切到全库）→ max / order 解禁（同一控件换目标集即被读）", async () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    await Promise.resolve(); // 等目标集异步填充落地
    const rtype = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    rtype.value = "__repo__";
    rtype.dispatchEvent(new Event("change"));
    const max = root.getElementById("diag-perf-max") as HTMLInputElement;
    const order = root.getElementById("diag-perf-order") as HTMLSelectElement;
    expect({ max: max.disabled, order: order.disabled }).toEqual({ max: false, order: false });
  });

  it("模型路径框与 max/order 方向相反：单模型亮、非单模型灰（反面，防写反——2026-09-20 回归钉）", async () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    await Promise.resolve(); // 等目标集异步填充落地
    const modelEl = root.getElementById("diag-perf-model") as HTMLInputElement;
    // 默认单模型目标集 → 路径框必须可用（上次回归正是把方向写反：单模型被灰）
    expect(modelEl.disabled).toBe(false);
    // 切到全库 → 路径框置灰 + title 说清「单模型才用」
    const rtype = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    rtype.value = "__repo__";
    rtype.dispatchEvent(new Event("change"));
    expect(modelEl.disabled).toBe(true);
    expect(modelEl.title).toContain("单模型");
  });

  it("目标集维不读表 PERF_UNREAD_TARGETS 登记 max / order（与模式维表对称，护栏可校验）", () => {
    // 表存在且语义正确：这两控件在 target=model 下不进载荷（真相源 = perf-single-bench 的提前 return）
    expect(PERF_UNREAD_TARGETS["diag-perf-max"]).toContain("model");
    expect(PERF_UNREAD_TARGETS["diag-perf-order"]).toContain("model");
  });

  it("非 single 下拨目标集选择器不得把基准三件套解禁（双维门禁兼并判定）", () => {
    // 回归钉：syncPerfBaselineControls 也被 rtype change / 选项填充回调独立触发，
    // 若只判目标集维不读当前模式，conc 下动一下选择器就绕过 §2.6 反向半边。
    const root = makeRoot("conc"); // scan 已退出模式轴，用 conc 验「非 single」这一半
    initPerfPanel(root, esc);
    const rtype = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    rtype.value = ""; // 选回「单模型」——目标集维满足，但模式仍是 conc
    rtype.dispatchEvent(new Event("change"));
    for (const id of BASELINE_CONTROL_IDS) {
      expect({ id, disabled: (root.getElementById(id) as HTMLInputElement).disabled }).toEqual({
        id,
        disabled: true,
      });
    }
  });

  // ===== 大刀护栏：控件门禁登记面 = tpl 真实控件集（防「新控件哪边都没归宿」静默漏网）=====
  it("tpl.ts bench 组的每个可输入控件都有门禁归宿（行归属或 PERF_UNREAD_MODES，二选一）", () => {
    // happy-dom 下 import.meta.url 是 http://，new URL 不可用；process.cwd() = frontend/（vitest 工作目录）
    const src = readFileSync(resolve(process.cwd(), "src/views/app-content/tpl.ts"), "utf8");
    // 锚定 tab 数组项的 `id: "bench",`（带尾逗号：标签文案不含此字面量，不会误锚）；
    // 终点锁 audit tab 声明处——不能用「下一行以 `{` 开头」判界（body 模板串里有 JSON 样例缩进块）。
    // ⚠️ ADR-300 §2.1：scan 从独立 tab 退回 bench 组第三 pill、record 退回 logs 组 pill，
    // 故 bench 与 scan 的控件如今**同居一个 body**——扫描域收成 `bench` 起、`audit` 止一段，
    // 不再需要旧的 `bodyOf("bench","scan") + bodyOf("scan","record")` 两段拼接。
    const bodyOf = (tabId: string, stopAt: string): string => {
      const at = src.indexOf("body:", src.indexOf(`id: "${tabId}",`));
      const s = src.indexOf("`", at) + 1;
      const e = src.indexOf(`id: "${stopAt}",`);
      expect(at, `找不到 tab ${tabId}`).toBeGreaterThan(-1);
      expect(e, `找不到 tab ${tabId} 的终点 ${stopAt}`).toBeGreaterThan(s);
      return src.slice(s, e);
    };
    const seg = bodyOf("bench", "audit");
    // 只钉「用户能改值」的控件（input/select）；button/label/output 容器不进门禁账
    const ids = [...seg.matchAll(/<(?:input|select)[^>]*id="(diag-perf-[a-z-]+)"/g)].map(
      (m) => m[1],
    );
    // 真相源抽样：共用旋钮 + 基准三件套必须在扫描结果里（防正则空转假绿）
    for (const mustSee of [
      "diag-perf-rtype",
      "diag-perf-order",
      "diag-perf-iter",
      "diag-perf-model",
      "diag-perf-max",
      "diag-perf-conc-workers",
      "diag-perf-conc-max",
      ...BASELINE_CONTROL_IDS,
    ]) {
      expect(ids, `扫描面丢失 ${mustSee}`).toContain(mustSee);
    }
    // 行归属：控件**所属 diag-bar-row 开标签**的 data-perf-mode 列表（未写 = 所有模式都显示）。
    // 不能用「向前最近一个 <div」——嵌套下（row > row-label）会抓到内层 div；
    // 也不能拿控件自身所在行（tpl 里按钮与输入框同行，data-perf-mode 挂在行 div 上）。
    // 做法：取控件前最后一个行开标签，再沿 <div/</div> 配平验证它仍开着（嵌套行不误抓）。
    // ⚠️ 开标签字面量取常量、切片偏移取 `.length`：类名 2026-09 由 perf-row 泛化为
    // diag-bar-row（ADR-288 D1），旧的硬编码 `i + 20` 会静默错位——长度不再手写。
    const ROW_OPEN = '<div class="diag-bar-row"';
    const rowOpenAt = (pos: number): string | null => {
      let cursor = pos;
      for (;;) {
        const i = seg.lastIndexOf(ROW_OPEN, cursor);
        if (i < 0) return null;
        // 从该开标签到控件位置做深度扫描：回零 = 它已被闭合，继续向前找更早的行
        let depth = 1;
        for (const m of seg.slice(i + ROW_OPEN.length, pos).matchAll(/<div\b|<\/div>/g)) {
          depth += m[0].startsWith("</") ? -1 : 1;
          if (depth === 0) break;
        }
        if (depth > 0) return seg.slice(i, seg.indexOf("\n", i));
        cursor = i - 1;
      }
    };
    // 归宿 = 行归属 ∨ 不读表 ∨ 公共区，三维**至少其一**：
    //  - 行写了 data-perf-mode → 缺席模式下整行隐藏（用户碰不到），诚实；
    //  - 登记进 PERF_UNREAD_MODES/基准名单 → 三模式共用行里「可见但不被读」被置灰；
    //  - 登记进 SHARED_CONTROLS（ADR-278 §2.7 公共区）→ **模式无关常驻**且两种模式都读它
    //    （single/conc 在 Go 侧由同一个 registerPerfTargetFlags 注册），行上**故意不写** data-perf-mode。
    // 三者都没有 = 新控件在某些模式下永远可见、可改、不被读——正是 §2.6 要拒的欺骗，当场红。
    //
    // ⚠️ 为何公共区要单独立名而不能滥用 PERF_UNREAD_MODES：把常驻控件写成「不读它的模式=<空>」
    // 语法上能混进门禁，但那条表回答的是「哪个模式不读它」，回答不了「它为何不随模式显隐」。
    // 名字错了，下一个人就会以为常驻与置灰是同一回事（六修到七修之间出现的正是这类语义混淆）。
    const SHARED_CONTROLS = new Set<string>([
      // ADR-300 §2.1：公共区（测什么/排序）如今落在 `data-perf-mode="single conc"` 行内，
      // 已有行归属门 → 首环 hasRowGate 直接放行，无需再列进本桶（保留空桶只为第二维扫描的
      // visibleInSingle 计算口径清晰：single 可见性现由 rowModes 判定，不再靠此旁路）。
    ]);
    // scan 控件（引擎对照）现为 bench 组第三 pill、在 `data-perf-mode="scan"` 行内 →
    // 首环 hasRowGate 放行、二环因 rowModes 不含 single 跳过，无需 SCAN_TAB_CONTROLS 例外。
    for (const id of ids) {
      const idx = seg.indexOf(`id="${id}"`);
      const rowOpen = rowOpenAt(idx);
      const hasRowGate = rowOpen !== null && rowOpen.includes("data-perf-mode");
      const hasUnreadGate = id in PERF_UNREAD_MODES || BASELINE_CONTROL_IDS.includes(id);
      const hasSharedGate = SHARED_CONTROLS.has(id);
      // 归宿是「或」：行归属 ∨ 不读表 ∨ 公共区，至少其一（都没 = 可见可改不被读，当场红）
      expect(
        hasRowGate || hasUnreadGate || hasSharedGate,
        `${id} 无门禁归宿：既不在带 data-perf-mode 的行内，也不在 PERF_UNREAD_MODES/基准名单/公共区——新增控件忘登记即红`,
      ).toBe(true);
    }

    // ===== 第三维（同日六修）：目标集维也得有归宿 =====
    // 上面那道判据是「行归属 ∨ 不读表」，两者只要其一就放行，而 max / order 恰好"行归属 single"
    // 合格却仍被 singleBenchReadMode 在 target==="model" 下提前 return 跳过——护栏把「可见」误当「被读」。
    // 这里补第二道：**在 single 模式下可见的控件**，要么被 single 的 model 分支真读到（白名单，
    // 真相源 = perf-single-bench 的 read*），要么必须在 PERF_UNREAD_TARGETS / 基准名单登记。
    // 新增一个 single 可见控件时，必须显式回答「单模型目标下读不读它」——不许沉默。
    const READ_IN_SINGLE_MODEL = new Set([
      "diag-perf-rtype", // 目标集选择器自身：决定走哪条分支
      "diag-perf-iter", // singleBenchReadIterations（model 分支也读）
      "diag-perf-model", // model 分支的主角
      "diag-perf-run", // 运行按钮（button 不进门禁账，此处防御性列出）
    ]);
    for (const id of ids) {
      const rowOpen = rowOpenAt(seg.indexOf(`id="${id}"`));
      const rowModes = (rowOpen?.match(/data-perf-mode="([^"]*)"/)?.[1] ?? "").split(/\s+/);
      // scan 下公共区（single conc 行）与两模式行皆隐藏；仅 single 可见者才需目标集维归宿
      const visibleInSingle =
        rowOpen === null || rowModes.includes("single") || SHARED_CONTROLS.has(id);
      if (!visibleInSingle) continue; // single 下整行隐藏 → 用户碰不到，不需目标集维归宿
      const accountable =
        READ_IN_SINGLE_MODEL.has(id) ||
        id in PERF_UNREAD_TARGETS ||
        BASELINE_CONTROL_IDS.includes(id);
      expect(
        accountable,
        `${id} 在 single 下可见，但未声明「单模型目标下读不读它」：不是被 model 分支读到的控件，也不在 PERF_UNREAD_TARGETS/基准名单——六修同款漏判`,
      ).toBe(true);
    }
    // 抽样防正则空转：这两条必须落在「可见 single 且已登记目标集维」上
    expect(Object.keys(PERF_UNREAD_TARGETS)).toContain("diag-perf-max");
    expect(Object.keys(PERF_UNREAD_TARGETS)).toContain("diag-perf-order");

    // 反向闸（上轮锐评 F 的可锁子集）：不读登记表里的每个 id 必须是 tpl 里真实控件。
    // 登记表漂出幽灵 id（控件已删/改名、表忘同步）时，apply 循环 getElementById 拿到 null 静默跳过，
    // 「可见不被读」的欺骗复活而无人知。登记面自审：幽灵项即红。
    for (const id of [...Object.keys(PERF_UNREAD_MODES), ...Object.keys(PERF_UNREAD_TARGETS)]) {
      expect(ids, `不读登记表里的 ${id} 在 tpl 已不存在（幽灵条目，登记面自身漂移）`).toContain(id);
    }
  });

  // ===== S3 对账护栏（ADR-300 §2.7）：pill 值域 ↔ data-perf-mode 门禁值域互为定义域 =====
  it("tpl.ts bench 组：每个门禁值有 pill 承接、每个 pill 有行引用（新子面板未登记即红）", () => {
    // bindSubBar 的 bench 语义 = 点 pill 写 data-active-sub → applyPerfModeUI 按
    // [data-perf-mode] 含当前值与否翻 .perf-mode-off。两个值域必须同源：
    //  - 门禁值无 pill 承接（如 data-perf-mode="quad" 而轴上没有 quad）→ 该行**永不激活**，
    //    静默死行——正是 S3 要拒的「未登记的新子面板」；
    //  - pill 无行引用（如加了 quad pill 却没有任何行挂 quad）→ 点子屏**全场无响应**，
    //    静默空转 pill（点了没反应，用户以为坏了）。
    // 控件级归宿归上一节大刀护栏管；本节的**行级对账**是它在 ADR-300 后的另一半。
    const src = readFileSync(resolve(process.cwd(), "src/views/app-content/tpl.ts"), "utf8");
    const at = src.indexOf("body:", src.indexOf(`id: "bench",`));
    const seg = src.slice(src.indexOf("`", at) + 1, src.indexOf(`id: "audit",`));
    // pill 值域 = bench 组 renderSubBar 声明的 id 集（renderSubBar 调用在 seg 内只此一处：
    // logs/audit 的调用在各自 body，已被锚界排除）
    const pillIds = new Set(
      [...seg.matchAll(/\{\s*id:\s*"([a-z]+)",\s*label:/g)].map((m) => m[1]),
    );
    expect([...pillIds].sort()).toEqual(["conc", "scan", "single"]); // 防空解析假绿
    const gateVals = new Set(
      [...seg.matchAll(/data-perf-mode="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)),
    );
    for (const v of gateVals) {
      expect(pillIds, `门禁值 ${v} 不在 pill 轴上（死行：任何子屏都显不出它）`).toContain(v);
    }
    for (const p of pillIds) {
      expect(gateVals.has(p), `pill ${p} 无任何行引用（空转子屏：点了全场无响应）`).toBe(true);
    }
  });
});
