// @vitest-environment happy-dom
// ===== 诊断页：性能面板测试 =====
// 覆盖：
//  - single-bench：7 阶段柱状渲染 / 缺 model 错误 / 命令失败兜底 / 代际守卫丢弃陈旧响应
//  - gui-flow：6 阶段状态渲染 / 失败阶段红字提示
//  - perf-log：优化历史卡片渲染
//  - 加载剖析：甘特图 + 资产清单渲染（通过 facade perf.ts re-export 路由）
// 注：业务逻辑已拆至 perf-cli.ts（CLI 三块）/ perf-trace.ts（加载剖析）；
// 本测试通过 facade initPerfPanel / renderLoadTraceSection 集成验证，保证接口契约不变。
// mock cli-bridge.executeCLI（web 模式在测试环境视为 native，isWebPlatform=false）
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// 对齐 Go gui-flow printFlowReport 真实输出
const GUI_OUTPUT = `🎮 GUI 流程模拟器
======================================================================

📊 流程报告
----------------------------------------------------------------------

✅ [1] ① 配置加载 (1.23ms)
   仓库根: /models
   模型根: /models/ysm

✅ [2] ② 模型扫描 (30.00ms)
   发现 10 个模型 (333 models/sec)

❌ [3] ③ 模型分析 (200.50ms)
   分析失败: /models/ysm/player.ysm

⏱️  总耗时: 231.73ms
📈 成功: 2, 失败: 1`;

// 对齐 Go guiFlowStructured（ADR-200 D2）：前端直接消费结构化 stages，不再反解析文案
const GUI_STRUCTURED = {
  stages: [
    { status: "✅", name: "① 配置加载", ms: 1.23, desc: ["仓库根: /models", "模型根: /models/ysm"] },
    { status: "✅", name: "② 模型扫描", ms: 30, desc: ["发现 10 个模型 (333 models/sec)"] },
    { status: "❌", name: "③ 模型分析", ms: 200.5, kind: "measured", desc: ["分析失败: /models/ysm/player.ysm"] },
    // 估算阶段（ADR-262 D2）：⑥ 无渲染管线，ms=0 + estimated_ms>0 + note（假设/公式）
    {
      status: "✅",
      name: "⑥ 渲染预估",
      ms: 0,
      kind: "estimated",
      estimated_ms: 120.5,
      note: "无渲染管线：按骨骼数粗估",
      desc: ["🟢 轻量负载"],
    },
  ],
  total_ms: 231.73,
  estimated_ms: 120.5,
  failed: true,
  output: GUI_OUTPUT, // deprecated（D5）：迁移期保留
};

const PERF_LOG_OUTPUT = `╔══════════════════════════════════════╗
║             优化记录 perf-log        ║
╚══════════════════════════════════════╝

─ 2026-08-19 ─ KTX2 缓存 ─ fd068ac
  问题: 加载时间翻倍
  做法: ReadFileBytesBatchWithMeta 一次 RPC
  效果: 加载 1 次 RPC 替代 N+1 次

─ 2026-08-18 ─ MMD dispose ─ 80679cd7
  问题: 切换模型 GPU 内存泄漏
  做法: disposeMmdMesh 遍历纹理
  效果: 切换 5 个模型不再闪退`;

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <button class="diag-btn" id="diag-perf-run">运行</button>
    <button class="diag-btn" id="diag-perf-gui">体检</button>
    <button class="diag-btn" id="diag-perf-log">历史</button>
    <button class="diag-btn" id="diag-perf-refresh-trace">刷新</button>
    <input id="diag-perf-model">
    <input id="diag-perf-iter">
    <select id="diag-perf-rtype"><option value="">（单模型，按路径）</option></select>
    <input id="diag-perf-max" value="5">
    <input id="diag-perf-baseline-save" type="checkbox">
    <input id="diag-perf-baseline-compare" type="checkbox">
    <input id="diag-perf-baseline-th" value="50">
    <div id="diag-perf-single"></div>
    <div id="diag-perf-gui-out"></div>
    <div id="diag-perf-hist"></div>
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
      error: { code: "param_error", message: "必须指定 --model 参数" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./x.ysm";
    (root.getElementById("diag-perf-run") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-single") as HTMLElement;
    expect(out.textContent).toContain("必须指定"); // 展示后端错误 message
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

  it("矩阵模式禁用基准三件套且不传基准参数（Go 侧明确拒绝，被禁比被吞诚实）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { spec: { rtype: "ysm", all_types: false, max_models: 5, iterations: 3, analyzed: 0, unsupported: 0, cli_analyzable: true, types: [] }, models: [] },
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
      "all-types": true,
      "max-models": 5,
      iterations: 3,
      format: "json",
    });
  });
});

describe("gui-flow 面板", () => {
  it("渲染 6 阶段状态，失败阶段标红提示（结构化 stages 消费）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "gui-flow",
      data: GUI_STRUCTURED,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-gui") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-gui-out") as HTMLElement;
    expect(out.textContent).toContain("① 配置加载");
    expect(out.textContent).toContain("② 模型扫描");
    // 失败行存在 → 有红色失败提示
    expect(out.textContent).toContain("③ 模型分析");
    expect(out.querySelector("[class*='perf-gui-fail']")).toBeTruthy();
  });

  it("估算阶段带标记，估算合计单独呈现且不进总耗时（ADR-262 D2）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "gui-flow",
      data: GUI_STRUCTURED,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-gui") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-gui-out") as HTMLElement;
    // ⑥ 估算行：标记 + 实测/估算分开写（0.00ms + 120.50ms）与公式 tooltip
    const estTag = out.querySelector(".perf-gui-est") as HTMLElement;
    expect(estTag).toBeTruthy();
    expect(estTag.getAttribute("title")).toContain("粗估");
    expect(out.textContent).toContain("0.00ms + 120.50ms");
    // 总耗时只含实测；估算单独一行并声明不计入
    expect(out.textContent).toContain("总耗时: 231.73ms");
    expect(out.textContent).toContain("其中估算 120.50ms（不计入总耗时）");
  });

  it("阶段渲染 runtime 归属（ADR-262 D2）：扫描段如实显示 rust，不说想当然的 go", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "gui-flow",
      data: {
        ...GUI_STRUCTURED,
        stages: [
          { status: "✅", name: "② 模型扫描", ms: 30, kind: "measured", desc: ["ok"], runtime: "rust" },
          { status: "✅", name: "⑥ 渲染预估", ms: 0, kind: "estimated", estimated_ms: 120, desc: ["ok"], runtime: "three" },
        ],
      },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-gui") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-gui-out") as HTMLElement;

    const tags = [...out.querySelectorAll(".perf-rt-tag")].map((e) => e.textContent);
    expect(tags).toEqual(["rust", "three"]);
    // 归属徽标与既有估算标记共存（runtime 是叠加信息，不取代 kind 口径）
    expect(out.querySelector(".perf-gui-est")).toBeTruthy();
  });

  it("status=error（阶段失败）时仍渲染结构化阶段明细（规律六）", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "gui-flow",
      error: { code: "runtime_error", message: "有 1 个阶段失败" },
      data: GUI_STRUCTURED,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-gui") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-gui-out") as HTMLElement;
    expect(out.textContent).toContain("③ 模型分析");
    expect(out.querySelector("[class*='perf-gui-fail']")).toBeTruthy();
  });

  it("结果容器与按钮 id 隔离：点击结果区不会触发重跑", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "gui-flow",
      data: GUI_STRUCTURED,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-gui") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(executeCLI).toHaveBeenCalledTimes(1);
    // 点击结果容器本身不应再触发 executeCLI
    (root.getElementById("diag-perf-gui-out") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(executeCLI).toHaveBeenCalledTimes(1);
  });
});

describe("perf-log 面板", () => {
  it("渲染优化历史卡片（日期/领域/commit/明细）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "perf-log",
      data: { output: PERF_LOG_OUTPUT },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-log") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const out = root.getElementById("diag-perf-hist") as HTMLElement;
    expect(out.textContent).toContain("2026-08-19");
    expect(out.textContent).toContain("KTX2 缓存");
    expect(out.textContent).toContain("fd068ac");
    expect(out.textContent).toContain("加载 1 次 RPC 替代 N+1 次");
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
    (root.getElementById("diag-perf-refresh-trace") as HTMLElement).click();
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