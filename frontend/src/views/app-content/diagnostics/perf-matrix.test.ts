// @vitest-environment happy-dom
// ===== 诊断页：目标集矩阵（ADR-262 D3 修订）前端契约 =====
//
// 锁五件事：
//  1. 分发：目标集选择器 × 排序控件 → `--target` / `--order` / `--max-models`（前端只提交规格，目标集归 Go）；
//  2. 渲染：类型汇总表 + 逐模型身份行（rtype/relPath/form 来自 Go identity 块）；
//  3. 诚实：`cli_analyzable=false` 的类型显示「未采集」而不是 0.00ms（空模型数据不得当实测）；
//  4. 空态：`models` 为空时给显式空态，不画空表；
//  5. 本次要清的账：取样上限的标签在**任何目标集下逐字相同**——单位只进 title 提示，不随模式改义。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { initPerfPanel, populatePerfTargetOptions } from "./perf.ts";

const { executeCLI, isWebPlatform, perfRegistry } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
  // ADR-269 D3④：perf-matrix-render 现同步读 resourceTypesById。以受控两类型子集覆盖该视图
  // （保留本测试「选项来自 registry、前端不写死类型表」的原意——断言随受控子集，而非真 15 类）。
  perfRegistry: {
    ysm: { id: "ysm", name: "YSM 模型", icon: "💎" },
    EntityPlayer: { id: "EntityPlayer", name: "MMD 模型", icon: "🧊" },
  },
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));
vi.mock("@/utils/resource/schema.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/resource/schema.ts")>();
  return { ...actual, resourceTypesById: perfRegistry };
});

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <button id="diag-perf-run">运行</button>
    <button id="diag-perf-gui">链路</button>
    <button id="diag-perf-refresh-trace">刷新</button>
    <input id="diag-perf-model">
    <input id="diag-perf-iter" value="2">
    <select id="diag-perf-rtype"><option value="">（单模型，按路径）</option></select>
    <select id="diag-perf-order">
      <option value="path">路径升序</option>
      <option value="size">体量降序</option>
    </select>
    <label for="diag-perf-max" id="diag-perf-max-label" title="单位随目标集变：某类型 = 该类型 N 条；全部类型 = 每类各 N 条；全库扁平 = 全库 N 条">取样上限</label>
    <input id="diag-perf-max" value="3">
    <div id="diag-perf-single"></div>
    <div id="diag-perf-gui-out"></div>
    <div id="diag-perf-hist"></div>
    <div id="diag-load-trace"></div>
    <select id="diag-perf-alt-target"><option value="__repo__">全库扁平</option></select>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

/** 对齐 Go perfMatrixSpec / perfTypeSummary + singleBenchJSON（矩阵 models[]） */
const MATRIX_JSON = {
  spec: {
    target: "rtype",
    order: "path",
    rtype: "ysm",
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

// `--target repo --order size`（= 旧「全库前 N 大」）载荷：与矩阵同形，
// 但 spec.order=size 时带 size_source，且每条 models[] 带参与排名的 footprint_bytes
// （目录式模型的 size_bytes 恒为 0，拿它排不了序）。
const REPO_SIZE_JSON = {
  spec: {
    target: "repo",
    order: "size",
    size_source: "dir_total",
    max_models: 2,
    iterations: 2,
    analyzed: 2,
    unsupported: 0,
    cli_analyzable: false,
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
    target: "rtype",
    order: "path",
    rtype: "EntityPlayer",
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
      identity: {
        rtype: "EntityPlayer",
        rtype_label: "MMD 模型",
        form: "file",
        relPath: "mmd/PMX/角色.pmx",
      },
      stages: [],
      hints: ["CLI 无解析器"],
    },
  ],
  output: "{}",
};

/** DOM id 沿用 `#diag-perf-rtype`（e2e / testid 契约不动）；它现在承载的是 target selector */
function setTarget(root: ShadowRoot, value: string): void {
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

function setOrder(root: ShadowRoot, value: string): void {
  const select = root.getElementById("diag-perf-order") as HTMLSelectElement;
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

describe("目标集分发（选谁 / 怎么排 / 取几条，目标集归 Go）", () => {
  it("选中某类型 → --target rtype + --rtype + --order + --max-models + format json", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setTarget(root, "ysm");
    await run(root);

    // 三旋钮正交：种 selector 各自独立带参，不再用互斥 flag 拼目标集。
    // 锁**精确**键集（不用 objectContaining）——多带一个键正是要防的回归。
    expect(executeCLI).toHaveBeenCalledWith("single-bench", {
      target: "rtype",
      rtype: "ysm",
      order: "path",
      "max-models": 3,
      iterations: 2,
      format: "json",
    });
  });

  it("选中「全部类型」→ --target all（不带 rtype）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setTarget(root, "__all__");
    await run(root);

    expect(executeCLI).toHaveBeenCalledWith("single-bench", {
      target: "all",
      order: "path",
      "max-models": 3,
      iterations: 2,
      format: "json",
    });
  });

  it("选中「全库扁平」+ 体量降序 → --target repo --order size（= 旧 --top-largest N）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: REPO_SIZE_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setTarget(root, "__repo__");
    setOrder(root, "size");
    await run(root);

    expect(executeCLI).toHaveBeenCalledWith("single-bench", {
      target: "repo",
      order: "size",
      "max-models": 3,
      iterations: 2,
      format: "json",
    });
  });

  it("切排序控件会改变提交参数（排序是与「选谁」正交的真实维度）", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setTarget(root, "ysm");
    setOrder(root, "size");
    await run(root);

    const args = executeCLI.mock.calls.at(-1)?.[1] as { order?: string; target?: string };
    expect(args.order).toBe("size");
    expect(args.target).toBe("rtype");
  });

  it("单模型模式绝不带 --max-models（Go 侧显式传上限即报错，不静默吞参）", async () => {
    executeCLI.mockResolvedValue({
      status: "success",
      command: "single-bench",
      data: { model: "./ysm/player.ysm", iterations: 2, total_ms: 1, per_iteration_ms: 0.5, stages: [] },
    });
    const root = makeRoot();
    initPerfPanel(root, esc);
    (root.getElementById("diag-perf-model") as HTMLInputElement).value = "./ysm/player.ysm";
    await run(root);

    // 目标集缺省即 model；上限对单条无意义，故连 target/order 都不提交（Go 的默认值就是 model）
    expect(executeCLI).toHaveBeenCalledWith("single-bench", {
      model: "./ysm/player.ysm",
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
    setTarget(root, "ysm");
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
    setTarget(root, "EntityPlayer");
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
    setTarget(root, "ysm");
    const out = await run(root);

    expect(out.textContent).toContain("未找到");
    expect(out.querySelector(".perf-matrix")).toBeNull();
  });
});

describe("目标集回显与体量徽标（排序依据不可见 = 不可复核）", () => {
  it("回显目标集 / 排序 / 上限，并在 order=size 时给出体量口径人话与逐条体量", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: REPO_SIZE_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setTarget(root, "__repo__");
    setOrder(root, "size");
    const out = await run(root);

    expect(out.textContent).toContain("目标集 全库扁平");
    expect(out.textContent).toContain("排序 体量降序");
    expect(out.textContent).toContain("上限 2");
    expect(out.textContent).toContain("dir_total");
    expect(out.textContent).toContain("目录式按目录内容合计");
    // 目录式模型的 size_bytes 是 0（identity 口径），排名体量只能来自 footprint_bytes
    expect(out.textContent).toContain("2.7 MB");
    expect(out.textContent).toContain("1.0 KB");
    // 顺序即载荷顺序（Go 已排好名，前端不重排）
    const names = [...out.querySelectorAll(".perf-matrix-model-name")].map((e) => e.textContent);
    expect(names[0]).toContain("ysm/big/ysm.json");
  });

  it("order=path 不渲染体量口径，也不凭空多出逐条体量", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "single-bench", data: MATRIX_JSON });
    const root = makeRoot();
    initPerfPanel(root, esc);
    setTarget(root, "ysm");
    const out = await run(root);

    expect(out.textContent).toContain("目标集 ysm 类型");
    expect(out.textContent).toContain("排序 路径升序");
    expect(out.textContent).not.toContain("dir_total");
    expect(out.textContent).not.toContain("MB");
    expect(out.textContent).not.toContain("KB");
  });
});

describe("目标集选择器选项来自 registry（前端不写死类型表）", () => {
  it("populatePerfTargetOptions 生成「单模型」+「全部类型」+「全库扁平」+ registry 各类型", async () => {
    const root = makeRoot();
    await populatePerfTargetOptions(root, "diag-perf-rtype", true);

    const select = root.getElementById("diag-perf-rtype") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    // 顺序 = 「单模型」占位 → 两个哨兵（全部类型 / 全库扁平）→ registry 类型（前端不写死类型表）
    expect(values).toEqual(["", "__all__", "__repo__", "EntityPlayer", "ysm"]);
    expect(select.textContent).toContain("YSM 模型");
    expect(select.textContent).toContain("全库扁平");
  });

  it("includeModel=false 不提供「单模型」项（helper 契约；并发已改用共享选择器，见 ADR-278 §2.2）", async () => {
    const root = makeRoot();
    await populatePerfTargetOptions(root, "diag-perf-alt-target", false);

    const select = root.getElementById("diag-perf-alt-target") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["__all__", "__repo__", "EntityPlayer", "ysm"]);
  });
});

// 本次要清的账（ADR-262 D3 修订）：同一个 `#diag-perf-max` 承载三种目标集的取样上限，
// 但**标签一律叫「取样上限」**——单位随目标集变这件事只进 title 提示。
// 旧实现按模式换标签（`syncPerfCountLabel`）修的是症状：标签改义 = 控件在骗人。
describe("取样上限的标签不随目标集改义", () => {
  it("三种目标集下标签逐字相同，且单位规则只在 title 里", async () => {
    const root = makeRoot();
    initPerfPanel(root, esc);
    const label = root.getElementById("diag-perf-max-label") as HTMLElement;
    const select = root.getElementById("diag-perf-rtype") as HTMLSelectElement;

    expect(label.textContent).toBe("取样上限");

    for (const target of ["__all__", "__repo__", "ysm"]) {
      setTarget(root, target);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(label.textContent).toBe("取样上限");
      expect(label.title).toContain("单位随目标集变");
    }
  });
});
