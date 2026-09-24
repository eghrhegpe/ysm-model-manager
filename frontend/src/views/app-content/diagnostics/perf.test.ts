// @vitest-environment happy-dom
// ===== 诊断页：性能面板测试 =====
// 覆盖：
//  - single-bench：7 阶段柱状渲染 / 缺 model 错误 / 命令失败兜底 / 代际守卫丢弃陈旧响应
//  - 加载剖析：甘特图 + 资产清单渲染（通过 facade perf.ts re-export 路由）
// 注：业务逻辑已拆至 perf-cli.ts（CLI 三块）/ perf-trace.ts（加载剖析）；
// 本测试通过 facade initPerfPanel / renderLoadTraceSection 集成验证，保证接口契约不变。
// mock cli-bridge.executeCLI（web 模式在测试环境视为 native，isWebPlatform=false）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { rememberModelPath, __resetLastModelPathForTest } from "@/core/model-path-store.ts";
import { bus } from "@/bus";
import { initPerfPanel, renderLoadTraceSection } from "./perf.ts";
import { recordLoadTrace, clearLoadTraces } from "@/preview-3d/infra/load-trace.ts";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// 对齐 Go singleBenchJSON（single-bench --format json）：前端直接消费结构化载荷，
// 不再反解析中文人类文案（旧夹具的自由文本形态已退役）
const SINGLE_STRUCTURED = {
  model: "./ysm/player.ysm",
  iterations: 3,
  total_ms: 6554.7, // N 次迭代累计墙钟
  per_iteration_ms: 2184.9, // 单次平均（累计 / 迭代次数）
  stages: [
    { name: "① 文件读取", ms: 12.34, status: "slow", bottleneck: false },
    { name: "② JSON 解析", ms: 1993.66, status: "bottleneck", bottleneck: true },
    { name: "③ 数据验证", ms: 0, status: "ok", bottleneck: false },
    { name: "④ 几何数据准备", ms: 45.2, status: "slow", bottleneck: false },
    { name: "⑤ 纹理数据准备", ms: 88.1, status: "warn", bottleneck: false },
    { name: "⑥ IPC 传输模拟", ms: 15.6, status: "slow", bottleneck: false },
    { name: "⑦ 缓存检查", ms: 30, status: "slow", bottleneck: false },
  ],
  bottleneck: "② JSON 解析",
  hints: ["🔴 瓶颈: JSON 解析"],
  format: "YSM",
  size_bytes: 123456,
  // 身份块（ADR-262 D2）：类别判定来自 Go registry，路径限定用 relPath（跨机器可比）
  identity: {
    rtype: "ysm",
    rtype_source: "extension",
    rtype_label: "YSM 模型",
    filesRoot: "/repo",
    relPath: "ysm/player.ysm",
    absPath: "/repo/ysm/player.ysm",
  },
  output: "（--format json 时 Go 打印的 JSON 原文，经 AttachSidecar 注入 data.output）",
};

// 带基准判决的载荷（对齐 go/cli/bench_baseline.go 的 perfBaselineDiff / perfBaselineStageDiff）：
// 覆盖四类阶段判决（regressed / slower / noise / new），并同时带 saved_to 与 diff
// （GUI 勾「记录」+「对比」时 Go 先比后存，两个子块可同时出现）
const SINGLE_STRUCTURED_BASELINE = {
  ...SINGLE_STRUCTURED,
  baseline: {
    saved_to: "/cfg/YSM-Model-Manager/perf-baseline.json",
    diff: {
      path: "/cfg/YSM-Model-Manager/perf-baseline.json",
      threshold_pct: 50,
      noise_floor_ms: 1,
      verdict: "regressed",
      degraded: 1,
      stages: [
        { name: "① 文件读取", base_ms: 10, now_ms: 12.34, delta_pct: 23.4, verdict: "slower" },
        { name: "② JSON 解析", base_ms: 1000, now_ms: 1993.66, delta_pct: 99.4, verdict: "regressed" },
        { name: "③ 数据验证", base_ms: 0.2, now_ms: 0.3, delta_pct: 0, verdict: "noise" },
        { name: "⑧ 新增阶段", base_ms: 0, now_ms: 5, delta_pct: 0, verdict: "new" },
      ],
    },
  },
};

/**
 * bench 组子 pill 行（ADR-300 §2.2 单点语法）：与 tpl.ts 的 renderSubBar("bench", …) 产出同形——
 * 模式源 = data-active-sub（原 #diag-perf-mode 下拉已从生产 DOM 退役），testid 派生
 * `diag-sub-bench-<id>`。
 */
function benchSubBar(activeSub: string): string {
  const pill = (id: string, label: string): string =>
    `<button class="diag-sub-tab${id === activeSub ? " active" : ""}" data-sub="${id}" data-testid="diag-sub-bench-${id}">${label}</button>`;
  return (
    `<div class="diag-sub-bar" data-sub-bar="bench" data-active-sub="${activeSub}">` +
    `${pill("single", "单模型")}${pill("conc", "批量并发")}${pill("scan", "引擎对照")}</div>`
  );
}

/**
 * 切模式 = 复刻生产链路的 pill 态（ADR-300 §2.2）：bindSubBar 点击翻 .active 类并写
 * data-active-sub，随后经 onSwitch 调 applyPerfModeUI。测试夹具不经 bindSubBar 接线，
 * 这里两步都补；需要重放行门控/禁用时由调用点再补 applyPerfModeUI(root)。
 */
function setBenchMode(root: ShadowRoot, mode: string): void {
  const bar = root.querySelector<HTMLElement>('.diag-sub-bar[data-sub-bar="bench"]');
  if (!bar) throw new Error("夹具缺 bench 子 pill 行（模式源）");
  bar.dataset.activeSub = mode;
  bar
    .querySelectorAll<HTMLElement>(".diag-sub-tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.sub === mode));
}

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <button class="diag-btn" id="diag-perf-run">运行</button>
    <button class="diag-btn" id="diag-trace-refresh">刷新</button>
    ${benchSubBar("single")}
    <input id="diag-perf-model">
    <input id="diag-perf-iter">
    <select id="diag-perf-rtype"><option value="">（单模型，按路径）</option></select>
    <select id="diag-perf-order"><option value="path">路径升序</option><option value="size">体积从大到小</option></select>
    <input id="diag-perf-max" value="5">
    <input id="diag-perf-baseline-save" type="checkbox">
    <input id="diag-perf-baseline-compare" type="checkbox">
    <input id="diag-perf-baseline-th" value="50">
    <div id="diag-perf-single"></div>
    <div id="diag-load-trace"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
  // 跨用例隔离：model-path-store 是模块级共享态，预填逻辑读它——不重置会让上一用例
  // rememberModelPath 的残值泄漏进「缺 model」用例（本文件首个用例即断言空输入不触发 CLI）
  __resetLastModelPathForTest();
});

describe("single-bench 面板", () => {
  it("成功时渲染 7 阶段柱状 + 迭代口径总耗时 + 最慢阶段, 无 model 时提示必填", async () => {
    // —— 缺 model：本地校验拦截，不触发 executeCLI ——
    const emptyRoot = makeRoot();
    initPerfPanel(emptyRoot, esc);
    (emptyRoot.getElementById("diag-perf-run") as HTMLElement).click();
    await Promise.resolve();
    expect(executeCLI).not.toHaveBeenCalled();
    expect((emptyRoot.getElementById("diag-perf-single") as HTMLElement).textContent).toContain("模型");

    // —— 有 model：结构化载荷渲染 ——
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: SINGLE_STRUCTURED,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    // 必须走结构化 JSON 出口：旧实现只发 model/iterations，靠正则解析中文文案
    expect(executeCLI).toHaveBeenCalledWith(
      "single-bench",
      expect.objectContaining({ format: "json" }),
    );
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.textContent).toContain("① 文件读取");
    expect(out.textContent).toContain("② JSON 解析");
    expect(out.textContent).toContain("1993.66ms");
    expect(out.textContent).toContain("0.00ms");
    // 迭代口径：单次平均 + 累计双显（旧 UI 把 3 次累计当成单次「总耗时」）
    expect(out.textContent).toContain("2184.90ms（3 次迭代平均；累计 6554.70ms）");
    expect(out.textContent).toContain("最慢阶段: ② JSON 解析");
    // 身份：类别显示名取自 Go registry，路径限定显示相对路径
    expect(out.textContent).toContain("YSM 模型");
    expect(out.textContent).toContain("ysm/player.ysm");
    expect(out.querySelector(".perf-bar-danger")).toBeTruthy();
  });

  it("命令失败时显示错误占位", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "single-bench",
      // 用**现行** Go 报错文案（旧串「必须指定 --model 参数」已随三旋钮改造退役）：
      // mock 引用退役契约会让测试看着绿、却在对一个 CLI 不再产生的错误做断言。
      error: { code: "param_error", message: "--target model 需要 --model <路径> 指定目标模型" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./x.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.textContent).toContain("需要 --model"); // 展示后端错误 message
  });

  it("结构化载荷缺失（Go 契约漂移）时兜底显示失败占位", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { output: "缺少 stages 的载荷" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./x.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.querySelector(".diag-stat-error")).toBeTruthy();
  });

  it("运行两次后渲染趋势 SVG 折线（历史持久化）", async () => {
    localStorage.clear();
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: SINGLE_STRUCTURED,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    const run = () => {
      (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./y.ysm";
      (root.getElementById("diag-perf-run") as HTMLElement).click();
    };
    run(); await new Promise((r) => setTimeout(r, 10));
    // 仅 1 条历史：无趋势折线（<2 条提示）
    const out1 = root.getElementById("diag-perf-single") as HTMLElement;
    // ⚠️ 不能用 `not.toContain("<svg")` —— ADR-238 后**图标本身也是 SVG**；
    // 也不能用 `<polyline` 判「有折线」——UI_ICONS.clock（总耗时行）路径里含
    // <polyline>（钟摆），与趋势图同名元素撞判据。改用趋势图独有特征
    // `<svg width="560"`（perf-trend 固定画布宽），这才是本测试真正要锁的语义。
    expect(out1.innerHTML).not.toContain('<svg width="560"');
    run(); await new Promise((r) => setTimeout(r, 10));
    // ≥2 条：渲染趋势 SVG 折线
    const out2 = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out2.innerHTML).toContain('<svg width="560"');
  });

  it("阶段状态/配色取自 Go status，不在前端自算阈值", async () => {
    // 150ms 若前端沿用旧的 >100ms 自算阈值会被错标红色；Go 判 ok 就应当是 ok
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: {
        ...SINGLE_STRUCTURED,
        stages: [{ name: "① 文件读取", ms: 150, status: "ok", bottleneck: false }],
        bottleneck: "",
      },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./z.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    const val = out.querySelector(".perf-bar-val") as HTMLElement;
    expect(val.textContent).toContain("✅");
    expect(val.className).not.toContain("perf-bar-danger");
    expect(val.className).not.toContain("perf-bar-warn");
    // 无最慢阶段时不渲染该行
    expect(out.textContent).not.toContain("最慢阶段");
  });

  it("旧载荷无 identity 时回落 format 标签，不崩", async () => {
    // 兼容窗口：identity 是 ADR-262 D2 新增字段，旧版 Go 载荷没有它
    const legacy: Record<string, unknown> = { ...SINGLE_STRUCTURED };
    delete legacy.identity;
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: legacy });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./legacy.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.textContent).toContain("YSM"); // format 回落标签
    expect(out.textContent).toContain("① 文件读取");
    expect(out.querySelector(".diag-stat-error")).toBeNull();
  });

  it("status=failed（阶段失败且 0ms）→ ❌ 红条，不被耗时分级掩盖", async () => {
    // Go 侧「失败优先于耗时分级」（bench_dirform_test.go 同源）在展示层的对应断言：
    // 失败阶段常是 0ms，若前端按 ms 自行分级就会画成绿条 ✅——假绿比红更危险
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: {
        ...SINGLE_STRUCTURED,
        stages: [
          { name: "① 清单读取", ms: 0, status: "failed", bottleneck: false, note: "❌ 失败: EISDIR" },
        ],
        bottleneck: "",
      },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./dir";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    const val = out.querySelector(".perf-bar-val") as HTMLElement;
    expect(val.textContent).toContain("❌");
    expect(val.className).toContain("perf-bar-danger");
  });

  it("阶段带 runtime 归属与样本统计（ADR-262 D2）：n>1 才渲染分布，n=1 不包装成分布", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: {
        ...SINGLE_STRUCTURED,
        stages: [
          // n=3 → 渲染 p95
          { name: "① 文件读取", ms: 10, status: "ok", bottleneck: false, runtime: "go", stats: { n: 3, median_ms: 9, p95_ms: 12 } },
          // n=1 → p95 就是那个唯一样本，渲染它等于把单样本包装成分布
          { name: "② 模型扫描", ms: 20, status: "ok", bottleneck: false, runtime: "rust", stats: { n: 1, median_ms: 20, p95_ms: 20 } },
        ],
        bottleneck: "",
      },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./z.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;

    // 归属徽标逐阶段如实展示（Go / Rust / WASM / Three 不再是黑箱）
    const tags = [...out.querySelectorAll(".perf-rt-tag")].map((e) => e.textContent);
    expect(tags).toEqual(["go", "rust"]);

    // 样本分布只在 n>1 时渲染——单样本不是分布
    const stats = [...out.querySelectorAll(".perf-stats")].map((e) => e.textContent);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toContain("12.00");
    expect(stats[0]).toContain("n=3");
  });
});

describe("single-bench 基准入口与判决（ADR-262 D8）", () => {
  /** 补 option 再赋 select.value——makeRoot 只放固定首项，赋不存在的值会静默变空 */
  function setRtype(root: ShadowRoot, value: string): void {
    const select = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    if (![...select.options].some((o) => o.value === value)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    }
    select.value = value;
  }

  async function run(root: ShadowRoot): Promise<HTMLElement> {
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    return root.getElementById("diag-perf-single") as HTMLElement;
  }

  it("只组装勾选的基准参数，路径一律传哨兵 default（路径策略归 Go）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: SINGLE_STRUCTURED });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";

    // 都不勾 → 三个基准键一个都不出现（旧行为不变）
    await run(root);
    expect(executeCLI).toHaveBeenLastCalledWith("single-bench", {
      model: "./ysm/player.ysm",
      iterations: 3,
      format: "json",
    });

    // 勾「记录基准」→ 只加 save-baseline
    (root.getElementById("diag-perf-baseline-save") as HTMLInputElement).checked = true;
    await run(root);
    expect(executeCLI).toHaveBeenLastCalledWith(
      "single-bench",
      expect.objectContaining({ "save-baseline": "default" }),
    );
    expect(executeCLI).not.toHaveBeenLastCalledWith(
      "single-bench",
      expect.objectContaining({ baseline: "default" }),
    );

    // 再勾「对比基准」+ 阈值 25 → baseline/threshold 一并带上（前端不编文件路径）
    (root.getElementById("diag-perf-baseline-compare") as HTMLInputElement).checked = true;
    (root.getElementById("diag-perf-baseline-th") as HTMLInputElement).value = "25";
    await run(root);
    expect(executeCLI).toHaveBeenLastCalledWith(
      "single-bench",
      expect.objectContaining({
        baseline: "default",
        "save-baseline": "default",
        threshold: 25,
      }),
    );
  });

  it("退化（status=error 但载荷有效）→ 结果照常渲染 + 逐阶段判决 + 错误横幅", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "single-bench",
      error: { code: "runtime_error", message: "1 个阶段相对基准退化超过 50%" },
      data: SINGLE_STRUCTURED_BASELINE,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);

    // ① 实测数字不得因「状态是 error」被丢弃（规律六：错误分支也要交结构化数据）
    expect(out.textContent).toContain("① 文件读取");
    expect(out.textContent).toContain("2184.90ms");

    // ② 判决逐阶段可读：哪个阶段、退了多少
    const rows = out.querySelectorAll(".perf-bl-row");
    expect(rows).toHaveLength(4);
    const worst = out.querySelector(".perf-bl-row.perf-bar-danger .perf-bl-name");
    expect(worst?.textContent).toContain("② JSON 解析");
    expect(out.textContent).toContain("+99.4%");
    expect(out.querySelector(".perf-bl-row.perf-bar-warn")).toBeTruthy();

    // ③ noise/new 说原因，不说「0.0%」这个无意义数字
    expect(out.textContent).toContain("噪声区间，不判退化");
    expect(out.textContent).toContain("基准里没有该阶段");
    expect(out.textContent).not.toContain("+0.0%");

    // ④ 整体判决 + 保存去向 + 错误横幅三者同时在
    expect(out.textContent).toContain("1 个阶段退化超过 50%");
    expect(out.textContent).toContain("基准已记录");
    expect(out.querySelector(".diag-stat-error")?.textContent).toContain("退化超过 50%");
  });

  it("未用基准 → 不渲染任何基准元素（缺席即缺席）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: SINGLE_STRUCTURED });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);
    expect(out.querySelector(".perf-bl-rows")).toBeNull();
    expect(out.querySelector(".perf-bl-row")).toBeNull();
  });

  // ── D-7：基准不可用的结构化原因 → 本地化文案（不上屏 Go 中文散文与绝对路径）──
  it("基准不存在（token=missing）→ 横幅说本地化人话，Go 中文细节只进 title", async () => {
    const detail = "未找到基准文件 C:/Users/me/AppData/Roaming/YSM-Model-Manager/perf-baseline.json：请先用 --save-baseline 记录一次基准";
    executeCLI.mockResolvedValue({
      status: "error",
      command: "single-bench",
      error: { code: "runtime_error", message: `运行时错误: ${detail}` },
      data: { ...SINGLE_STRUCTURED, baseline: { error: "missing", detail } },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);

    // ① 正文是本地化句子（测试环境语种为 zh-CN）
    expect(out.textContent).toContain("还没有记录过基准");
    // ② Go 的中文散文不上屏：既含未翻译内容，也泄露本机绝对路径与 CLI 口令
    expect(out.textContent).not.toContain("未找到基准文件");
    expect(out.textContent).not.toContain("C:/Users/me");
    expect(out.textContent).not.toContain("--save-baseline");
    // ③ 但细节没丢：进 title 供追问
    expect(out.querySelector(`[title="${detail}"]`)).toBeTruthy();
    // ④ 结果本体照旧渲染（数字是实测的，不因基准缺失而丢）
    expect(out.querySelector(".perf-bar-row")).toBeTruthy();
  });

  it("基准不存在但本次已记录 → 同一句里带上「已记录」说明（不指引用户重做）", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "single-bench",
      error: { code: "runtime_error", message: "运行时错误: 未找到基准文件 /cfg/perf-baseline.json" },
      data: {
        ...SINGLE_STRUCTURED,
        baseline: { error: "missing", detail: "未找到基准文件 /cfg/perf-baseline.json", saved_to: "/cfg/perf-baseline.json" },
      },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);
    expect(out.textContent).toContain("还没有记录过基准");
    expect(out.textContent).toContain("本次已记录新基准");
    // 记录动作的成果也要回显（「基准已记录」块），否则用户以为没记上
    expect(out.textContent).toContain("基准已记录");
  });

  it("未知 token → 通用兜底句 + title 留原因，不得把中文散文当兜底文案上屏", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "single-bench",
      error: { code: "runtime_error", message: "运行时错误: 未来的新原因" },
      data: { ...SINGLE_STRUCTURED, baseline: { error: "future_reason", detail: "未来的新原因" } },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);
    expect(out.textContent).toContain("基准不可用");
    expect(out.textContent).not.toContain("未来的新原因");
    expect(out.querySelector('[title="未来的新原因"]')).toBeTruthy();
  });

  it("非基准类错误仍转述 Go 原话（前端不臆造原因）", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "single-bench",
      error: { code: "runtime_error", message: "运行时错误: 未找到 CLI 可分析的模型" },
      data: SINGLE_STRUCTURED,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);
    expect(out.textContent).toContain("未找到 CLI 可分析的模型");
  });


  it("只记录基准（无 diff）→ 只回显「基准已记录」，路径进 title 不占正文", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { ...SINGLE_STRUCTURED, baseline: { saved_to: "/cfg/perf-baseline.json" } },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);
    expect(out.textContent).toContain("基准已记录");
    expect(out.textContent).not.toContain("/cfg/perf-baseline.json");
    expect(out.querySelector('[title="/cfg/perf-baseline.json"]')).toBeTruthy();
    expect(out.querySelector(".perf-bl-rows")).toBeNull();
  });

  it("畸形基准载荷（diff.stages 非数组）被守卫拒绝，不冒泡成 TypeError 覆盖结果", async () => {
    // 基准块是嵌套结构，形状校验必须下探——否则渲染期 .map 抛错会被外层 catch 接住，
    // 整块结果（含已拿到的实测数字）被 setErrorCatch 的兜底文案替换。
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: {
        ...SINGLE_STRUCTURED,
        baseline: {
          diff: { path: "/cfg/b.json", threshold_pct: 50, noise_floor_ms: 1, verdict: "ok", degraded: 0, stages: null },
        },
      },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);
    expect(out.querySelector(".diag-stat-error")).toBeTruthy();
    expect(out.querySelector(".perf-bl-row")).toBeNull();
  });

  it("全零空载荷（iterations=0）不得当实测：守卫拒绝", async () => {
    // 诚实红线「空模型数据不得当实测」：stages=[]/total_ms=0/iterations=0 曾是守卫的残留口子
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: {
        model: "./ysm/player.ysm",
        iterations: 0,
        total_ms: 0,
        per_iteration_ms: 0,
        stages: [],
        bottleneck: "",
        format: "YSM",
      },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    const out = await run(root);
    expect(out.querySelector(".diag-stat-error")).toBeTruthy();
  });

  it("矩阵模式禁用基准三件套且不传基准参数（Go 侧明确拒绝，被禁比被吞诚实）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { spec: { target: "all", order: "path", max_models: 5, iterations: 3, analyzed: 0, unsupported: 0, cli_analyzable: true, types: [] }, models: [] },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    // 单模型模式下可用
    expect((root.getElementById("diag-perf-baseline-compare") as HTMLInputElement).disabled).toBe(false);

    setRtype(root, "__all__");
    (root.getElementById("diag-perf-rtype") as HTMLSelectElement).dispatchEvent(new Event("change"));
    for (const id of ["diag-perf-baseline-save", "diag-perf-baseline-compare", "diag-perf-baseline-th"]) {
      expect((root.getElementById(id) as HTMLInputElement).disabled).toBe(true);
    }

    const out = await run(root);
    expect(out.textContent.length).toBeGreaterThan(0);
    expect(executeCLI).toHaveBeenLastCalledWith("single-bench", {
      target: "all",
      order: "path",
      "max-models": 5,
      iterations: 3,
      format: "json",
    });
  });
});

describe("diag-perf-model 预填最近选中模型路径（ADR-221 消除手输路径劝退）", () => {
  it("有最近模型 + 输入框为空 → initPerfPanel 预填为磁盘绝对路径", () => {
    rememberModelPath("D:\\repo\\ysm\\player.ysm");
    const root = makeRoot();
    initPerfPanel(root, esc);
    expect((root.getElementById("diag-perf-model") as HTMLInputElement).value).toBe(
      "D:\\repo\\ysm\\player.ysm",
    );
  });

  it("无最近模型（null）→ 不预填，输入框保持空", () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    expect((root.getElementById("diag-perf-model") as HTMLInputElement).value).toBe("");
  });

  it("输入框已有用户输入 → 预填绝不覆盖", () => {
    rememberModelPath("D:\\repo\\other.ysm");
    const root = makeRoot();
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./mine.ysm";
    initPerfPanel(root, esc);
    expect((root.getElementById("diag-perf-model") as HTMLInputElement).value).toBe("./mine.ysm");
  });
});

describe("进阶 P2：订阅 model:select 实时带入路径（ADR-221 延伸）", () => {
  it("进入 bench tab 后再点资源树模型 → 单模型模式下空输入框被实时带入", () => {
    __resetLastModelPathForTest();
    const root = makeRoot();
    initPerfPanel(root, esc);
    const inp = root.getElementById("diag-perf-model") as HTMLInputElement;
    expect(inp.value).toBe(""); // 初始无选中
    bus.emit("model:select", { path: "D:\\repo\\ysm\\player.ysm" });
    expect(inp.value).toBe("D:\\repo\\ysm\\player.ysm");
  });

  it("用户已手填路径 → 总线同步绝不覆盖", () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    const inp = root.getElementById("diag-perf-model") as HTMLInputElement;
    inp.value = "./mine.ysm";
    bus.emit("model:select", { path: "D:\\repo\\ysm\\player.ysm" });
    expect(inp.value).toBe("./mine.ysm");
  });

  it("并发 / 引擎对照模式下不带入（无模型路径输入框）", () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    // 模式源 = bench 子 pill 行（ADR-300 §2.2）：bus 回调只经 readActiveBenchMode 读 pill 态，
    // 无行门控可断言，故只翻 pill（不调 applyPerfModeUI）。
    setBenchMode(root, "conc");
    bus.emit("model:select", { path: "D:\\repo\\ysm\\player.ysm" });
    expect((root.getElementById("diag-perf-model") as HTMLInputElement).value).toBe("");
  });

  it("目录载荷（isDir）不带入", () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    bus.emit("model:select", { path: "D:\\repo\\ysm", isDir: true });
    expect((root.getElementById("diag-perf-model") as HTMLInputElement).value).toBe("");
  });
});

describe("性能面板复制按钮 — 面板重建后仍工作（perfCopyBound 归属修复）", () => {
  it("容器重建（lang:changed clearPanels 语义）后 initPerfPanel 重新绑定复制委托", async () => {
    // mock 剪贴板（happy-dom 无 navigator.clipboard 实现）
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: SINGLE_STRUCTURED,
    });

    // 第一次 init + 运行出结果（含复制按钮）→ 复制生效
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./player.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const copyBtn1 = root.querySelector<HTMLElement>("[data-perf-copy]");
    expect(copyBtn1).toBeTruthy();
    copyBtn1!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledTimes(1);

    // 模拟面板重建：移除 diag-perf-single 容器并重建（clearPanels → panel.remove() 语义）
    const outBox = root.getElementById("diag-perf-single")!;
    const parent = outBox.parentElement!;
    outBox.remove();
    const newBox = document.createElement("div");
    newBox.id = "diag-perf-single";
    parent.appendChild(newBox);
    // lang:changed → _render → initDiagnostics → initPerfPanel 再次调用（同一 root）
    initPerfPanel(root, esc);

    // 再跑一次 → 新容器内出现复制按钮，点击仍应复制
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const copyBtn2 = root.querySelector<HTMLElement>("[data-perf-copy]");
    expect(copyBtn2).toBeTruthy();
    writeText.mockClear();
    copyBtn2!.click();
    await new Promise((r) => setTimeout(r, 0));
    // 修复前：模块级 perfCopyBound=true 阻止重绑 → 新容器复制委托缺失（writeText 0 次）
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe("加载剖析面板", () => {
  it("无 trace → 显示暂无加载记录", async () => {
    const root = makeRoot();
    renderLoadTraceSection(root, esc);
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    expect(out.textContent).toContain("暂无加载记录");
  });

  it("有 trace → 渲染甘特图 + 资产信息", async () => {
    recordLoadTrace({
      ts: Date.now(),
      format: "mmd",
      path: "./ysm/player.ysm",
      stages: [
        { name: "读取", ms: 12, status: "ok" },
        { name: "解析", ms: 1993, status: "ok" },
        { name: "纹理加载", ms: 342, status: "ok" },
        { name: "build", ms: 89, status: "ok" },
      ],
      assets: { files: 12, textures: 8, bones: 142, materials: 23, morphs: 89, animations: 3, pmxWorker: true, ktx2Hits: 5, ktx2Total: 8 },
      textureDetails: [{ path: "body.png", size: "1024x1024" }, { path: "face.png", size: "512x512" }],
      gpuMb: 12.4,
      ok: true,
    });
    const root = makeRoot();
    renderLoadTraceSection(root, esc);
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    expect(out.innerHTML).toContain("<svg");
    expect(out.textContent).toContain("player.ysm");
    expect(out.textContent).toContain("142"); // bones
    expect(out.textContent).toContain("23"); // materials
    expect(out.textContent).toContain("12.4"); // gpuMb
    expect(out.textContent).toContain("KTX2");
    expect(out.innerHTML).toContain("body.png");
  });

  it("刷新按钮 → 调用 renderLoadTraceSection", async () => {
    clearLoadTraces();
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-trace-refresh") as HTMLElement).click();
    await Promise.resolve();
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    expect(out.textContent).toContain("暂无加载记录");
  });

  it("YSM trace（4 段）→ 渲染骨骼/立方体/纹理 + format=YSM", async () => {
    recordLoadTrace({
      ts: Date.now(),
      format: "ysm",
      path: "./ysm/maid.ysm",
      stages: [
        { name: "读取", ms: 5, status: "ok" },
        { name: "解析", ms: 120, status: "ok" },
        { name: "纹理加载", ms: 340, status: "ok" },
        { name: "build", ms: 89, status: "ok" },
      ],
      assets: { files: 1, textures: 4, bones: 96, cubes: 312, materials: 3, animations: 2 },
      ok: true,
    });
    const root = makeRoot();
    renderLoadTraceSection(root, esc);
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    expect(out.innerHTML).toContain("<svg");
    expect(out.textContent).toContain("maid.ysm");
    expect(out.textContent).toContain("YSM"); // format 显示
    expect(out.textContent).toContain("96");  // bones
    expect(out.textContent).toContain("312"); // cubes
    expect(out.textContent).toContain("4");   // textures
    expect(out.textContent).toContain("读取");
    expect(out.textContent).toContain("build");
  });

  it("Litematic trace（1 段）→ 渲染阶段名 + materials", async () => {
    recordLoadTrace({
      ts: Date.now(),
      format: "litematic",
      path: "./blueprints/castle.litematic",
      stages: [{ name: "读取+构建", ms: 230, status: "ok" }],
      assets: { files: 1, textures: 0, materials: 12, animations: 0 },
      ok: true,
    });
    const root = makeRoot();
    renderLoadTraceSection(root, esc);
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    expect(out.innerHTML).toContain("<svg");
    expect(out.textContent).toContain("castle.litematic");
    expect(out.textContent).toContain("LITEMATIC");
    expect(out.textContent).toContain("12"); // materials
  });
});