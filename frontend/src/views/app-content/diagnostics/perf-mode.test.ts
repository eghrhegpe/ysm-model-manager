// @vitest-environment happy-dom
// ===== 诊断页：基准模式接线测试（ADR-278 §2.1 / §2.3 / §2.4 / §2.6）=====
// 覆盖：
//  - 切 conc：单模型那套隐藏、并发那套显示；目标集「单模型」选项被禁用 + 已选中值回落到全库扁平
//  - 切回 single：选项恢复可选（disable 是模式态，不是一次性改动）
//  - 默认 single：非当前模式的 `[data-perf-mode]` 行被加 `.perf-mode-off`，且**不写 inline style**
//    （查看器降级用的是 inline `display:none`，两种机制不能互相覆盖——ADR-278 §2.4）
//  - 公共区（测什么 / 排序）模式无关常驻（ADR-278 §2.7）
//  - 目标集填充（async，会重建 <option>）之后模式态被重放，disabled 不丢
//  - ADR-278 §2.6 语义诚实层：同一个控件跨模式**改义必须当场说明**——迭代/目标集标签随模式改写、
//    每个运行按钮挂本模式「测什么对象」hint、并发回落不再静默改用户的选择
//  - 门禁登记面扫描（大刀护栏）：tpl.ts bench tab 的每个可输入控件必须有归宿，新控件忘登记即红
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "@/bus";
import { BASELINE_CONTROL_IDS, initPerfPanel, perfScopeHint, PERF_RUN_BUTTON_MODE_KEYS, PERF_UNREAD_MODES, PERF_UNREAD_TARGETS } from "./perf.ts";

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
      <option value="conc">批量并发</option>
    </select>
    <select id="diag-perf-rtype" data-testid="diag-perf-rtype">
      <option value="">单模型</option>
      <option value="__repo__">全库扁平</option>
    </select>
    <div class="perf-row">
      <select id="diag-perf-order" data-testid="diag-perf-order">
        <option value="path">路径升序</option>
      </select>
    </div>
    <div class="perf-row" data-perf-mode="single" id="row-single"></div>
    <div class="perf-row" data-perf-mode="single" id="row-iter">
      <label for="diag-perf-iter" id="diag-perf-iter-label">迭代次数</label>
      <input id="diag-perf-iter" value="3">
    </div>
    <div class="perf-row" id="row-target">
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
    <div class="perf-row" id="row-scan">
      <input id="diag-perf-scan-iter" value="3">
    </div>
    <div id="diag-perf-single" data-perf-mode="single"></div>
    <div id="diag-perf-conc-out" data-perf-mode="conc"></div>
    <div id="diag-perf-scan-bench-out"></div>
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
    expect(off(root, "row-iter")).toBe(false); // 迭代行只归 single（scan 已独立成 tab）
    expect(off(root, "row-conc")).toBe(true);
    expect(off(root, "row-scan")).toBe(false); // 无 data-perf-mode：scan 的控件属独立 tab，不随模式显隐
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

  it("模式下拉只剩单模型/并发（ADR-278 §2.7：引擎对照已退出模式轴，不再是第三种模式）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    const modeSel = root.getElementById("diag-perf-mode") as HTMLSelectElement;
    expect([...modeSel.options].map((o) => o.value)).toEqual(["single", "conc"]);
    // 切到 conc：并发行亮、单模型行暗，而**公共区（测什么/排序）不受影响**
    switchMode(root, "conc");
    expect(off(root, "row-conc")).toBe(false);
    expect(off(root, "row-single")).toBe(true);
    expect(off(root, "row-target")).toBe(false); // 公共区：模式无关常驻
    expect(off(root, "row-iter")).toBe(true); // 迭代只归 single
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
  it("迭代标签单模型下显示「跑几次」（原「迭代次数（重复解析次数）」已随改名收口；scan 独立成 tab 后用自己的框）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    expect(iterLabel(root)?.textContent).toContain("跑几次");
    // scan 自己的框在另一个 tab，有自己的标签，不因模式切换而改口（它不再是模式）
    expect(root.getElementById("diag-perf-scan-iter")).not.toBeNull();
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

  it("两个运行按钮各自挂本模式「测什么对象」的 hint（引擎对照已独立成 tab，不在此表）", () => {
    const root = makeRoot("single");
    initPerfPanel(root, esc);
    const run = root.getElementById("diag-perf-run") as HTMLElement;
    const concRun = root.getElementById("diag-perf-conc-run") as HTMLElement;
    expect(run.title).toContain("一个模型");
    expect(concRun.title).toContain("一批模型");
    // scan 按钮的 scope 说明现在写在 tpl 的 scan tab 里（perfScanBenchHint），不靠模式表派生
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
    for (const mode of ["single", "conc"]) { // ADR-278 §2.7：scan 已退出模式轴，不再是模式
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
  it("tpl.ts bench tab 的每个可输入控件都有门禁归宿（行归属或 PERF_UNREAD_MODES，二选一）", () => {
    // happy-dom 下 import.meta.url 是 http://，new URL 不可用；process.cwd() = frontend/（vitest 工作目录）
    const src = readFileSync(resolve(process.cwd(), "src/views/app-content/tpl.ts"), "utf8");
    // 锚定 tab 数组项的 `id: "bench",`（带尾逗号：标签文案不含此字面量，不会误锚）；
    // 终点锁 record tab 声明处——不能用「下一行以 `{` 开头」判界（body 模板串里有 JSON 样例缩进块）。
    // 起点从 body 模板串开头算：行 div 在 `body:` 之前（tab 元数据区），切片内自洽。
    // ⚠️ ADR-278 §2.7：扫描域从 bench tab **扩到含独立 scan tab**（引擎对照退出模式轴后
    // 自成一个 tab）。若只扫 bench，scan 自己的控件会落在闸外——「闸只看得见它被写死的那一类」
    // 的又一次变体：护栏从「覆盖少一格」退成「扫错区间」。
    const bodyOf = (tabId: string, stopAt: string): string => {
      const at = src.indexOf("body:", src.indexOf(`id: "${tabId}",`));
      const s = src.indexOf("`", at) + 1;
      const e = src.indexOf(`id: "${stopAt}",`);
      expect(at, `找不到 tab ${tabId}`).toBeGreaterThan(-1);
      expect(e, `找不到 tab ${tabId} 的终点 ${stopAt}`).toBeGreaterThan(s);
      return src.slice(s, e);
    };
    const seg = bodyOf("bench", "scan") + bodyOf("scan", "record");
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
    // 行归属：控件**所属 perf-row 开标签**的 data-perf-mode 列表（未写 = 所有模式都显示）。
    // 从控件位置向前找最近的 `<div class="perf-row"`——不能拿控件自身所在行判定
    // （tpl 里按钮与输入框同行，如 run+model 合排，data-perf-mode 挂在行 div 上）。
    // 行归属：控件**所属 perf-row 开标签**的 data-perf-mode 列表（未写 = 所有模式都显示）。
    // 不能用「向前最近一个 <div」——嵌套下（row > row-label）会抓到内层 div；
    // 也不能拿控件自身所在行（tpl 里按钮与输入框同行，data-perf-mode 挂在行 div 上）。
    // 做法：取控件前最后一个 perf-row 开标签，再沿 <div/</div> 配平验证它仍开着（嵌套行不误抓）。
    const rowOpenAt = (pos: number): string | null => {
      let cursor = pos;
      for (;;) {
        const i = seg.lastIndexOf('<div class="perf-row"', cursor);
        if (i < 0) return null;
        // 从该开标签到控件位置做深度扫描：回零 = 它已被闭合，继续向前找更早的行
        let depth = 1;
        for (const m of seg.slice(i + 20, pos).matchAll(/<div\b|<\/div>/g)) {
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
    const SHARED_CONTROLS = new Set([
      "diag-perf-rtype", // 测什么：single/conc 共用同一套参数面（Go 同一个 registerPerfTargetFlags）
      "diag-perf-order", // 排序：同上
    ]);
    // scan tab 自己的控件（ADR-278 §2.7）：它不在模式轴上，故不需模式门禁——
    // 但必须**显式登记**，否则本节就变成「没登记的自动放行」，闸就死了。
    const SCAN_TAB_CONTROLS = new Set([
      "diag-perf-scan-iter", // scan-bench 唯一的可输入参数（Go 侧也只有 --iterations）
    ]);
    for (const id of ids) {
      if (id === "diag-perf-mode") continue; // 模式选择器自身：读它才能接线，不适用门禁
      const idx = seg.indexOf(`id="${id}"`);
      const rowOpen = rowOpenAt(idx);
      const hasRowGate = rowOpen !== null && rowOpen.includes("data-perf-mode");
      const hasUnreadGate = id in PERF_UNREAD_MODES || BASELINE_CONTROL_IDS.includes(id);
      const hasSharedGate = SHARED_CONTROLS.has(id) || SCAN_TAB_CONTROLS.has(id);
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
      if (id === "diag-perf-mode") continue;
      const rowOpen = rowOpenAt(seg.indexOf(`id="${id}"`));
      const rowModes = (rowOpen?.match(/data-perf-mode="([^"]*)"/)?.[1] ?? "").split(/\s+/);
      // 公共区控件（无 data-perf-mode）在 single 下当然可见；行隐藏的才跳过
      const visibleInSingle =
        rowOpen === null || rowModes.includes("single") || SHARED_CONTROLS.has(id);
      if (!visibleInSingle) continue; // single 下整行隐藏 → 用户碰不到，不需目标集维归宿
      const accountable =
        READ_IN_SINGLE_MODEL.has(id) ||
        id in PERF_UNREAD_TARGETS ||
        BASELINE_CONTROL_IDS.includes(id) ||
        SCAN_TAB_CONTROLS.has(id); // scan tab 的控件不归 single 管
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
});
