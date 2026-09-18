// @vitest-environment happy-dom
// ===== 诊断页：类型矩阵（ADR-262 D3）前端契约 =====
//
// 锁四件事：
//  1. 分发：类型选择器 → `--rtype` / `--all-types` 参数（前端只提交规格，目标集归 Go）；
//  2. 渲染：类型汇总表 + 逐模型身份行（rtype/relPath/form 来自 Go identity 块）；
//  3. 诚实：`cli_analyzable=false` 的类型显示「未采集」而不是 0.00ms（空模型数据不得当实测）；
//  4. 空态：`models` 为空时给显式空态，不画空表。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { initPerfPanel, populatePerfRtypeOptions } from "./perf.ts";

const { executeCLI, isWebPlatform, loadResourceRegistry } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
  loadResourceRegistry: vi.fn(async () => ({
    ysm: { id: "ysm", name: "YSM 模型", icon: "💎" },
    EntityPlayer: { id: "EntityPlayer", name: "MMD 模型", icon: "🧊" },
  })),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));
vi.mock("@/services/resource-registry.ts", () => ({ loadResourceRegistry }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <button id="diag-perf-run">运行</button>
    <button id="diag-perf-gui">链路</button>
    <button id="diag-perf-log">历史</button>
    <button id="diag-perf-refresh-trace">刷新</button>
    <input id="diag-perf-model">
    <input id="diag-perf-iter" value="2">
    <select id="diag-perf-rtype"><option value="">（单模型，按路径）</option></select>
    <label for="diag-perf-max" id="diag-perf-max-label">每类上限</label>
    <input id="diag-perf-max" value="3">
    <div id="diag-perf-single"></div>
    <div id="diag-perf-gui-out"></div>
    <div id="diag-perf-hist"></div>
    <div id="diag-load-trace"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

/** 对齐 Go perfMatrixSpec/perfTypeSummary + singleBenchJSON（矩阵 models[]） */
const MATRIX_JSON = {
  spec: {
    rtype: "ysm",
    all_types: false,
    max_models: 3,
    iterations: 2,
    analyzed: 1,
    unsupported: 0,
    cli_analyzable: true,
    types: [
      {
        rtype: "ysm",
        rtype_label: "YSM 模型",
        cli_analyzable: true,
        found: 5,
        analyzed: 1,
        unsupported: 0,
        expected_stages: 7,
        stage_mismatch: false,
      },
    ],
  },
  models: [
    {
      model: "/repo/ysm/a/ysm.json",
      identity: {
        rtype: "ysm",
        rtype_label: "YSM 模型",
        rtype_source: "extension",
        form: "dir",
        relPath: "ysm/a/ysm.json",
      },
      per_iteration_ms: 12.5,
      total_ms: 25,
      stages: [{ name: "① 清单读取", ms: 1, status: "ok" }],
    },
  ],
  output: "{}",
};

// 全库前 N 大（ADR-262 D3 第三种目标集）载荷：与矩阵同形 + spec.top_largest/size_source，
// 且每条 models[] 带参与排名的 footprint_bytes（目录式模型的 size_bytes 恒为 0，拿它排不了序）
const TOP_LARGEST_JSON = {
  spec: {
    all_types: false,
    max_models: 0,
    iterations: 2,
    analyzed: 2,
    unsupported: 0,
    cli_analyzable: false,
    top_largest: 3,
    size_source: "dir_total",
    types: [
      {
        rtype: "ysm",
        rtype_label: "YSM 模型",
        cli_analyzable: true,
        found: 5,
        analyzed: 2,
        unsupported: 0,
        expected_stages: 7,
        stage_mismatch: false,
      },
    ],
  },
  models: [
    {
      model: "/repo/ysm/big",
      identity: {
        rtype: "ysm",
        rtype_label: "YSM 模型",
        rtype_source: "location",
        form: "dir",
        relPath: "ysm/big/ysm.json",
      },
      footprint_bytes: 2792158,
      per_iteration_ms: 6.45,
      total_ms: 19.34,
      stages: [{ name: "① 清单读取", ms: 1, status: "ok" }],
    },
    {
      model: "/repo/ysm/small.ysm",
      identity: {
        rtype: "ysm",
        rtype_label: "YSM 模型",
        rtype_source: "extension",
        form: "file",
        relPath: "ysm/small.ysm",
      },
      footprint_bytes: 1024,
      per_iteration_ms: 1.9,
      total_ms: 5.7,
      stages: [{ name: "① 文件读取", ms: 1, status: "ok" }],
    },
  ],
  output: "{}",
};

const UNSUPPORTED_JSON = {
  spec: {
    rtype: "EntityPlayer",
    all_types: false,
    max_models: 3,
    iterations: 1,
    analyzed: 0,
    unsupported: 1,
    cli_analyzable: false,
    types: [
      {
        rtype: "EntityPlayer",
        rtype_label: "MMD 模型",
        cli_analyzable: false,
        found: 1,
        analyzed: 0,
        unsupported: 1,
        expected_stages: 0,
        stage_mismatch: true,
      },
    ],
  },
  models: [
    {
      model: "/repo/mmd/PMX/角色.pmx",
      identity: { rtype: "EntityPlayer", rtype_label: "MMD 模型", form: "file", relPath: "mmd/PMX/角色.pmx" },
      stages: [],
      hints: ["CLI 无解析器"],
    },
  ],
  output: "{}",
};

function setRtype(root: ShadowRoot, value: string): void {
  const select = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
  // makeRoot 只放固定首项：测试里按需补上目标 option，否则 select.value 赋不存在的值会静默变空
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

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
});

describe("类型矩阵 — 分发（规格归前端，目标集归 Go）", () => {
  it("选中某类型 → 发 --rtype + --max-models + --format json", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "ysm");
    await run(root);

    expect(executeCLI).toHaveBeenCalledWith("single-bench", {
      rtype: "ysm",
      "max-models": 3,
      iterations: 2,
      format: "json",
    });
  });

  it("选中「全部类型」→ 发 --all-types（不带 rtype）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "__all__");
    await run(root);

    expect(executeCLI).toHaveBeenCalledWith("single-bench", {
      "all-types": true,
      "max-models": 3,
      iterations: 2,
      format: "json",
    });
  });

  it("未选类型且未填路径 → 提示必填，不调 CLI", async () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    const out = await run(root);

    expect(executeCLI).not.toHaveBeenCalled();
    expect(out.textContent).toContain("模型");
  });
});

describe("类型矩阵 — 渲染", () => {
  it("渲染类型汇总 + 逐模型身份（rtype/relPath/form）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "ysm");
    const out = await run(root);

    expect(out.querySelector(".perf-matrix")).toBeTruthy();
    expect(out.textContent).toContain("YSM 模型");
    expect(out.textContent).toContain("ysm/a/ysm.json"); // identity.relPath
    expect(out.textContent).toContain("dir"); // form 标记
    expect(out.textContent).toContain("12.50ms");
  });

  it("CLI 无解析器的类型显示「未采集」，绝不显示 0.00ms", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: UNSUPPORTED_JSON,
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "EntityPlayer");
    const out = await run(root);

    expect(out.textContent).toContain("未采集");
    expect(out.textContent).not.toContain("0.00ms");
    expect(out.querySelector(".perf-matrix-warn")).toBeTruthy();
  });

  it("models 为空 → 显式空态（不画空表）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { spec: { ...MATRIX_JSON.spec, analyzed: 0, types: [] }, models: [] },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "ysm");
    const out = await run(root);

    expect(out.textContent).toContain("未找到");
    expect(out.querySelector(".perf-matrix")).toBeNull();
  });
});

describe("类型选择器选项来自 registry（前端不写死类型表）", () => {
  it("populatePerfRtypeOptions 生成「全部类型」+ registry 各类型", async () => {
    const root = makeRoot();
    await populatePerfRtypeOptions(root);

    const select = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    // 顺序 = 「单模型」占位 → 两个哨兵（全部类型 / 前 N 大）→ registry 类型（前端不写死类型表）
    expect(values).toEqual(["", "__all__", "__top__", "EntityPlayer", "ysm"]);
    expect(select.textContent).toContain("YSM 模型");
    expect(select.textContent).toContain("全库前 N 大");
  });
});

describe("全库前 N 大（ADR-262 D3 第三种目标集）", () => {
  it("选中「全库前 N 大」→ 只发 --top-largest + iterations + format", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: TOP_LARGEST_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "__top__");
    await run(root);

    // 三种矩阵类目标集在 Go 侧互斥：混入 rtype/all-types/max-models 会被判参数冲突。
    // 故这里锁**精确**参数集（不用 objectContaining）——多带一个键正是要防的回归。
    expect(executeCLI).toHaveBeenCalledWith("single-bench", {
      "top-largest": 3,
      iterations: 2,
      format: "json",
    });
  });

  it("回显 N 与体量口径，并逐条给出参与排名的体量", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: TOP_LARGEST_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "__top__");
    const out = await run(root);

    // 排名依据可见 = 可复核：N、口径 token、口径人话三者都要在
    expect(out.textContent).toContain("全库前 3 大目标集");
    expect(out.textContent).toContain("dir_total");
    expect(out.textContent).toContain("目录式按目录内容合计");
    // 目录式模型的 size_bytes 是 0（identity 口径），排名体量只能来自 footprint_bytes
    expect(out.textContent).toContain("2.7 MB");
    expect(out.textContent).toContain("1.0 KB");
    // 顺序即载荷顺序（Go 已排好名，前端不重排）
    const names = [...out.querySelectorAll(".perf-matrix-model-name")].map((e) => e.textContent);
    expect(names[0]).toContain("ysm/big/ysm.json");
  });

  it("无 footprint_bytes 的载荷不显示体量（其他模式不凭空多一行）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setRtype(root, "ysm");
    const out = await run(root);

    expect(out.textContent).not.toContain("MB");
    expect(out.textContent).not.toContain("KB");
  });
});

// 标签语义随模式切换（2026-09-18 主模型补）：同一个 `#diag-perf-max` 在矩阵模式是「每类上限」、
// 在前 N 大模式是 N。控件复用没问题，但**标签不跟着换就是界面撒谎**——用户看到「每类上限 3」
// 在前 N 大下会理解为「每种类型取 3 个」，而实际是「全库取 3 个」。
describe("条数控件的标签随模式切换", () => {
  it("切到前 N 大 → 标签变「前 N 大」，切回 → 变回「每类上限」", async () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    const label = root.getElementById("diag-perf-max-label") as HTMLElement;
    const select = root.getElementById("diag-perf-rtype") as HTMLSelectElement;

    // 初始（单模型模式）：标签是「每类上限」
    expect(label.textContent).toBe("每类上限");

    // 切到前 N 大 → 派发真实 change（走 perf.ts 的绑定，而不是直调内部函数）
    setRtype(root, "__top__");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(label.textContent).toBe("前 N 大");

    // 切回单模型 → 必须还原，不能留在上一次的文案
    setRtype(root, "");
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(label.textContent).toBe("每类上限");
  });
});
