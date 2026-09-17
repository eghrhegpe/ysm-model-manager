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
    expect(values).toEqual(["", "__all__", "EntityPlayer", "ysm"]);
    expect(select.textContent).toContain("YSM 模型");
  });
});
