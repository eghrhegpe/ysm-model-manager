// ===== 并发基准（ADR-262 D5）前端契约测试 =====
// 锁三件事：
//  ① 载荷守卫显式校验形状（桥数据禁断言穿透；未测到的东西不许渲染成表）；
//  ② 判决与加速比**一律读 Go 交出的值**——前端不重算阈值（重算 = 阈值维护两份）；
//  ③ 参数按 flag 名提交（Go ParamSpec 的键），非法输入不发给 Go。

import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

import { concParsePayload } from "./perf-concurrent.ts";
import { initPerfPanel } from "./perf.ts";

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** 对齐 Go concurrentBenchJSON（concurrent-bench --format json）的真实载荷 */
const CONC_PAYLOAD = {
  workers: 4,
  // 三旋钮与 max_models **同层**（ADR-262 D3 修订：并发载荷没有 spec 对象，是扁平的）
  target: "repo",
  order: "path",
  max_models: 20,
  model_count: 3,
  models: [{ relPath: "ysm/a/ysm.json", rtype: "ysm", rtype_label: "YSM 模型" }],
  serial: { total_ms: 16.87, per_model_ms: 5.62 },
  parallel: [
    { workers: 2, total_ms: 1.05, speedup: 16.11, verdict: "excellent" },
    { workers: 4, total_ms: 1.09, speedup: 15.45, verdict: "good" },
  ],
  file_read: { file_count: 30, serial_ms: 2.66, parallel_ms: 1.74, speedup: 1.53 },
  // Go 侧中文散文：未 i18n，结构化保留但**不渲染**（英文/日文界面不该出现未翻译中文）
  hints: ["✅ 推荐使用 2 workers，可获得 16.1x 加速"],
  output: "⚡ 并发能力基准测试",
  filesRoot: "C:/models",
};

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <button id="diag-perf-run"></button>
    <input id="diag-perf-model" value="">
    <input id="diag-perf-iter" value="3">
    <select id="diag-perf-mode"><option value="conc">并发基准</option></select>
    <select id="diag-perf-rtype"><option value="">单模型</option><option value="__repo__">全库扁平</option></select>
    <input id="diag-perf-max" value="5">
    <input id="diag-perf-baseline-save" type="checkbox">
    <input id="diag-perf-baseline-compare" type="checkbox">
    <input id="diag-perf-baseline-th" value="50">
    <div id="diag-perf-single"></div>
    <div id="diag-perf-gui-out"></div>
    <button id="diag-perf-conc-run"></button>
    <input id="diag-perf-conc-workers" type="number" value="4">
    <input id="diag-perf-conc-max" type="number" value="20">
    <select id="diag-perf-order"><option value="path">路径升序</option><option value="size">体量降序</option></select>
    <div id="diag-perf-conc-out"></div>
    <div id="diag-perf-hist"></div>
    <div id="diag-load-trace"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

function clickAndFlush(root: ShadowRoot): Promise<void> {
  (root.getElementById("diag-perf-conc-run") as HTMLElement).click();
  return new Promise((r) => setTimeout(r, 10));
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
});

describe("concParsePayload（桥数据形状守卫）", () => {
  it("接受 Go 的真实载荷（含 error 状态：规律六错误分支也带载荷）", () => {
    expect(concParsePayload({ status: "success", data: CONC_PAYLOAD })).not.toBeNull();
    // 判决为「无提升」时 Go 返回 error，但数字是实测的——载荷不得因状态是 error 就丢弃
    expect(concParsePayload({ status: "error", data: CONC_PAYLOAD })).not.toBeNull();
  });

  it("拒绝未测到东西的退化载荷（不许渲染假表）", () => {
    expect(concParsePayload({ status: "success", data: undefined })).toBeNull();
    expect(concParsePayload({ status: "success", data: { parallel: [] } })).toBeNull();
    // 未找到模型时 Go 在 SetResult 之前返回：data 退化为 {output,lines,filesRoot}
    expect(concParsePayload({ status: "error", data: { output: "未找到任何模型" } })).toBeNull();
    // serial 缺 total_ms（半截载荷）同样拒绝
    expect(
      concParsePayload({ status: "success", data: { serial: {}, parallel: [{ workers: 2 }] } }),
    ).toBeNull();
    expect(
      concParsePayload({ status: "success", data: { serial: { total_ms: 1 }, parallel: {} } }),
    ).toBeNull();
    // 非终态状态（pending/running）不是可消费结果
    expect(concParsePayload({ status: "pending", data: CONC_PAYLOAD })).toBeNull();
  });

  it("拒绝档位缺 workers 的载荷（否则界面会打出「并行 ? workers」）", () => {
    const bad = { ...CONC_PAYLOAD, parallel: [{ total_ms: 1, speedup: 2 }] };
    expect(concParsePayload({ status: "success", data: bad })).toBeNull();
  });
});

describe("并发基准面板（ADR-262 D5）", () => {
  it("按 flag 名提交参数，并渲染 Go 给的加速比与判决", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "concurrent-bench", data: CONC_PAYLOAD });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    // 参数键 = Go flag 名（ParamSpec 契约）；format 必须 json（结构化出口）
    expect(executeCLI).toHaveBeenLastCalledWith("concurrent-bench", {
      target: "repo",
      order: "path",
      workers: 4,
      "max-models": 20,
      format: "json",
    });

    const out = root.getElementById("diag-perf-conc-out") as HTMLElement;
    const text = out.textContent ?? "";
    // 加速比与耗时是 Go 交出的值（前端只 toFixed 展示）
    expect(text).toContain("16.11x");
    expect(text).toContain("16.87ms");
    // 判决文案由 Go 的 token 映射（excellent→优秀 / good→良好）
    expect(text).toContain("优秀");
    expect(text).toContain("良好");
    expect(text).toContain("实测 3 个模型");
    // 文件读取段（Go 给了才渲染）
    expect(text).toContain("并发文件读取");
    expect(text).toContain("30 个文件");
    // Go 侧中文建议不渲染（未 i18n 的散文不上界面）
    expect(text).not.toContain("推荐使用 2 workers");
  });

  it("Go 未交出的块（file_read）不渲染，不填 0 占位", async () => {
    const noFile = { ...CONC_PAYLOAD, file_read: undefined };
    executeCLI.mockResolvedValue({ status: "success", command: "concurrent-bench", data: noFile });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const text = (root.getElementById("diag-perf-conc-out") as HTMLElement).textContent ?? "";
    expect(text).not.toContain("并发文件读取");
    expect(text).toContain("16.11x"); // 主体结果照常渲染
  });

  it("error 状态但带载荷：数字照显 + 错误横幅（规律六）", async () => {
    executeCLI.mockResolvedValue({
      status: "error",
      command: "concurrent-bench",
      data: { ...CONC_PAYLOAD, parallel: [{ workers: 4, total_ms: 20, speedup: 0.8, verdict: "none" }] },
      error: { message: "并发无明显提升" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const text = (root.getElementById("diag-perf-conc-out") as HTMLElement).textContent ?? "";
    expect(text).toContain("0.80x");
    expect(text).toContain("无提升");
    expect(text).toContain("并发无明显提升");
  });

  it("非法并发度本地拦截，不发给 Go", async () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-conc-workers") as HTMLInputElement).value = "0";
    await clickAndFlush(root);

    expect(executeCLI).not.toHaveBeenCalled();
    const text = (root.getElementById("diag-perf-conc-out") as HTMLElement).textContent ?? "";
    expect(text).toContain("1~256");
  });

  it("目标集与排序走同一套三旋钮（切类型 + 体量降序 → --target rtype + --rtype + --order size）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "concurrent-bench", data: CONC_PAYLOAD });
    const root = makeRoot();
    initPerfPanel(root, esc);
    const target = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    const typeOpt = document.createElement("option");
    typeOpt.value = "ysm";
    target.appendChild(typeOpt);
    target.value = "ysm";
    (root.getElementById("diag-perf-order") as HTMLSelectElement).value = "size";
    await clickAndFlush(root);

    // 目标集归 Go：前端只把 selector / 排序 / 上限如实交出去（rtype 是 target=rtype 的载荷参数）
    expect(executeCLI).toHaveBeenLastCalledWith("concurrent-bench", {
      target: "rtype",
      rtype: "ysm",
      order: "size",
      workers: 4,
      "max-models": 20,
      format: "json",
    });
  });

  it("回显目标集与排序；order=size 时才带体量口径", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "concurrent-bench",
      data: { ...CONC_PAYLOAD, order: "size", size_source: "dir_total" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const text = (root.getElementById("diag-perf-conc-out") as HTMLElement).textContent ?? "";
    expect(text).toContain("目标集 全库扁平");
    expect(text).toContain("排序 体量降序");
    expect(text).toContain("上限 20");
    // 排序依据不可见 = 不可复核：口径 token 与人话一起给
    expect(text).toContain("dir_total");
    expect(text).toContain("目录式按目录内容合计");
  });

  it("target=rtype 时回显类型 id（由 Go 顶层 rtype 给出，不从入选样本反推）", async () => {
    // ADR-262 D3 修订：并发载荷的顶层 rtype 与 single-bench 的 `spec.rtype` 对称，回显的是
    // **用户请求的类型**（Go 事实源），不是从 `models[0].rtype` 反推——反推在空集时推不出来，
    // 且类型判定的事实源只有 Go（registry 单点）。
    executeCLI.mockResolvedValue({
      status: "success",
      command: "concurrent-bench",
      data: { ...CONC_PAYLOAD, target: "rtype", rtype: "ysm" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    const target = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    const typeOpt = document.createElement("option");
    typeOpt.value = "ysm";
    target.appendChild(typeOpt);
    target.value = "ysm";
    await clickAndFlush(root);

    const text = (root.getElementById("diag-perf-conc-out") as HTMLElement).textContent ?? "";
    expect(text).toContain("目标集 ysm 类型");
    expect(text).not.toContain("目标集  类型");
  });

  it("并发载荷缺顶层 rtype 时不得从入选样本反推类型（前端不臆断）", async () => {
    // 反向断言：Go 若没回显请求类型，界面宁可显示原始 token，也不许拿 `models[0].rtype` 充数——
    // 「看起来对了」的标题比空标题更坏，它掩盖了「契约缺字段」这件事。
    executeCLI.mockResolvedValue({
      status: "success",
      command: "concurrent-bench",
      data: { ...CONC_PAYLOAD, target: "rtype" },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const text = (root.getElementById("diag-perf-conc-out") as HTMLElement).textContent ?? "";
    expect(text).not.toContain("目标集 ysm 类型");
  });

  it("web 平台不发 CLI（走 toast 提示）", async () => {
    isWebPlatform.mockReturnValue(true);
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);
    expect(executeCLI).not.toHaveBeenCalled();
  });
});
