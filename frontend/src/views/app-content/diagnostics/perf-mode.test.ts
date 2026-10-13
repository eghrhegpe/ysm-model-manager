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
// ADR-278-d1：PERF_UNREAD_MODES / PERF_UNREAD_TARGETS / BASELINE_CONTROL_IDS 三张手工登记表
// 退役——门禁改由 read* 的 collector 读路径派生。本文件护栏随之从「表登记面 == tpl 控件集」
// 改为「apply 产出的 disabled == 读集快照」的等价对账 + 反孤儿（每个控件至少被某状态读到）。
import { concReadIds } from "./perf-concurrent.ts";
import {
  applyPerfModeUI,
  initPerfPanel,
  perfScopeHint,
  PERF_RUN_BUTTON_MODE_KEYS,
} from "./perf.ts";
import { scanBenchReadIds } from "./perf-scan-bench.ts";
import { singleBenchReadIds } from "./perf-single-bench.ts";

/** apply 的门禁枚举面 = 面板内**所有** diag-perf-* 的 input/select（与 perf.ts 同口径：
 *  读点即真相，枚举不依赖 DOM 落位——行内行外、可见隐藏一律对账） */
function visibleControls(root: ShadowRoot): (HTMLInputElement | HTMLSelectElement)[] {
  return [
    ...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input[id^="diag-perf-"], select[id^="diag-perf-"]',
    ),
  ];
}

/** 某模式下 apply 应取用的读集快照（真相源 = read* 的 collector，与 perf.ts 同源） */
function readIdsFor(root: ShadowRoot, mode: string): Set<string> {
  if (mode === "conc") return concReadIds(root);
  if (mode === "scan") return scanBenchReadIds(root);
  return singleBenchReadIds(root);
}

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));
// toast 原语走 bus.emit("toast:show")；本文件锁「并发回落有提示」，mock bus 以免真弹
vi.mock("@/bus", () => ({ bus: { emit: vi.fn(), on: vi.fn() } }));

import { escUnknown as esc } from "@/utils/html/html.ts";

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
  // 门禁派生对账（ADR-278-d1，取代原「表驱动期望」）：**每个可见控件**的 disabled 必须严格
  // 等于「该控件是否在当前模式的读集快照里」。读集由 read* 的 collector 现算（真相源 = DOM 现状），
  // apply 也跑同一读路径——本对账锁的是「apply 确实按读集派生、且面覆盖每个可见控件」：
  //  - apply 若漏纳某可见控件（controls 面窄于实际）→ 该控件 disabled 停在旧值、对账红；
  //  - 若某模式的读集与真实 read* 分叉（改 read* 忘同步）→ 快照本身变，对账跟着红。
  it("每模式可见控件的 disabled ≡ 读集快照（可见即可用的唯一判据 = 载荷真读它）", () => {
    for (const mode of ["single", "conc", "scan"]) {
      const root = makeRoot(mode);
      initPerfPanel(root, esc); // initPerfPanel → initPerfMode → apply 已跑过一遍
      const reads = readIdsFor(root, mode); // 现算同一读路径的读集（幂等：纯读零副作用）
      const controls = visibleControls(root);
      expect(controls.length, `mode=${mode} 门禁面对空（夹具/选择器失效，防空转假绿）`).toBeGreaterThan(
        0,
      );
      for (const el of controls) {
        expect(
          el.disabled,
          `mode=${mode} 控件 ${el.id}：disabled=${el.disabled} 应等于 !reads.has(id)=${!reads.has(el.id)}`,
        ).toBe(!reads.has(el.id));
      }
    }
  });

  // 反孤儿（每个 bench 控件至少被某一状态读到）：读路径永不触及的控件 = 无人消费的装饰，
  // 正是 ADR-278 §2.6「可见可改不被读」要拒的——派生化后由「三态读集并集 == 全部可见控件」锁。
  it("每个 bench 控件都被某种状态读到（无人消费的孤儿控件即红）", () => {
    // 三模式 × 关键目标态的读集并集，须覆盖夹具里所有 diag-perf-* 可输入控件
    const union = new Set<string>();
    for (const mode of ["single", "conc", "scan"]) {
      const r = makeRoot(mode);
      initPerfPanel(r, esc);
      for (const id of readIdsFor(r, mode)) union.add(id);
    }
    // single + 非单模型目标：max / order 走另一条读分支，补进并集
    const rRepo = makeRoot("single");
    initPerfPanel(rRepo, esc);
    (rRepo.getElementById("diag-perf-rtype") as HTMLSelectElement).value = "__repo__";
    for (const id of readIdsFor(rRepo, "single")) union.add(id);
    // 并集面 = 夹具所有可见控件（任一模式下）；孤儿 = 任何模式都不读
    const allIds = new Set<string>();
    for (const mode of ["single", "conc", "scan"]) {
      const r = makeRoot(mode);
      initPerfPanel(r, esc);
      for (const el of visibleControls(r)) allIds.add(el.id);
    }
    for (const id of allIds) {
      expect(union, `${id} 是孤儿控件：没有任何状态会读它（可见可改不被读 = 欺骗）`).toContain(id);
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

  // 读集随目标集分叉（ADR-278-d1：取代原「PERF_UNREAD_TARGETS 登记」表断言——真相不再在表里，
  // 在读取路径本身）：single + 单模型目标**根本不读** max / order（singleBenchReadMode 提前
  // return 走 model 分支），换到非单模型即读。若未来有人给 model 分支加读 max 而 UI 语义未变，
  // 此处快照当场可见。
  it("读集随目标集分叉：single+model 不含 max/order，single+repo 含之（表断言退役为读路径断言）", () => {
    const rModel = makeRoot("single");
    initPerfPanel(rModel, esc);
    const readsModel = singleBenchReadIds(rModel); // rtype="" → model 分支
    expect(readsModel.has("diag-perf-max")).toBe(false);
    expect(readsModel.has("diag-perf-order")).toBe(false);
    expect(readsModel.has("diag-perf-model")).toBe(true);
    expect(readsModel.has("diag-perf-baseline-th")).toBe(true); // 基准只在 model 分支被读
    const rRepo = makeRoot("single");
    initPerfPanel(rRepo, esc);
    (rRepo.getElementById("diag-perf-rtype") as HTMLSelectElement).value = "__repo__";
    const readsRepo = singleBenchReadIds(rRepo);
    expect(readsRepo.has("diag-perf-max")).toBe(true);
    expect(readsRepo.has("diag-perf-order")).toBe(true);
    expect(readsRepo.has("diag-perf-model")).toBe(false); // model 框在非单模型分支不被读
    expect(readsRepo.has("diag-perf-baseline-th")).toBe(false); // 双维门禁坍缩进读路径（ADR-262 D8）
  });

  it("非 single 下拨目标集选择器不得把基准三件套解禁（双维门禁坍缩为读集，回归钉保留）", () => {
    // 四修同款回归：conc 下动选择器选回「单模型」——目标集维满足但模式仍是 conc，
    // conc 的读路径（concReadParams）永不触及基准控件 → 派生 disabled 必须保持 true。
    const root = makeRoot("conc"); // scan 已退出模式轴，用 conc 验「非 single」这一半
    initPerfPanel(root, esc);
    const rtype = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    rtype.value = ""; // 选回「单模型」——目标集维满足，但模式仍是 conc
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

  // ===== 夹具 ↔ 真实 tpl 控件集对账（ADR-278-d1：取代原「表登记面 == tpl 控件集」大刀护栏）=====
  // 原护栏拿 PERF_UNREAD_MODES/TARGETS/BASELINE 三表反查 tpl 行归属，表退役后那套机制整体塌缩。
  // 但「运行期对账的控件宇宙必须等于真实控件集」这条不能丢——否则夹具漏放某控件时，上面的
  // disabled≡读集对账会对真实缺失的控件**失明**（假绿）。故留一条最薄的：tpl 真实 input/select
  // 控件集须全部落在夹具 makeRoot 里（夹具是真实面的**超集**即合格；真实面新增控件而夹具未跟上即红）。
  it("tpl.ts bench 真实控件集 ⊆ 夹具控件集（运行期对账的宇宙等于现实，防夹具漏控件致盲）", () => {
    // happy-dom 下 import.meta.url 是 http://，new URL 不可用；process.cwd() = frontend/
    const src = readFileSync(resolve(process.cwd(), "src/views/app-content/tpl.ts"), "utf8");
    const at = src.indexOf("body:", src.indexOf(`id: "bench",`));
    const e = src.indexOf(`id: "audit",`);
    expect(at, '找不到 bench tab body').toBeGreaterThan(-1);
    expect(e, "找不到 audit 终点").toBeGreaterThan(at);
    const seg = src.slice(src.indexOf("`", at) + 1, e);
    // 只取「用户能改值」的控件（input/select），button/label/结果容器不进门禁账（与 apply 枚举面同口径）
    const tplIds = new Set(
      [...seg.matchAll(/<(?:input|select)[^>]*id="(diag-perf-[a-z-]+)"/g)].map((m) => m[1] as string),
    );
    // 抽样防正则空转：共用旋钮 + 基准三件套 + 并发/扫描控件必须在扫描结果里
    for (const mustSee of [
      "diag-perf-rtype",
      "diag-perf-order",
      "diag-perf-iter",
      "diag-perf-model",
      "diag-perf-max",
      "diag-perf-conc-workers",
      "diag-perf-conc-max",
      "diag-perf-baseline-save",
      "diag-perf-baseline-compare",
      "diag-perf-baseline-th",
      "diag-perf-scan-iter",
    ]) {
      expect(tplIds, `扫描面丢失 ${mustSee}（正则空转假绿）`).toContain(mustSee);
    }
    // 夹具宇宙 = 三模式下 makeRoot 出现过的所有 diag-perf-* 可输入控件
    const fixtureIds = new Set<string>();
    for (const mode of ["single", "conc", "scan"]) {
      const r = makeRoot(mode);
      r.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select").forEach((el) => {
        if (el.id.startsWith("diag-perf-")) fixtureIds.add(el.id);
      });
    }
    for (const id of tplIds) {
      expect(
        fixtureIds,
        `真实 tpl 有控件 ${id}，但夹具 makeRoot 未放——运行期对账会对其失明（补进夹具）`,
      ).toContain(id);
    }
  });

  // S3 行级对账（pill 值域 ↔ data-perf-mode 值域）保留：它防的是**布局/子屏接线**问题
  // （死行 / 空转 pill），与控件门禁正交，表退役不影响。见下一条 it。

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
