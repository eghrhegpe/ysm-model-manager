// @vitest-environment happy-dom
// ===== 扫描引擎对照（ADR-262 D3）前端契约测试 =====
// 锁四件事：
//  ① 诚实红线：`used=false` 的引擎显示「未采集 + 原因」，**不得**吐出 0.00ms（0ms 会被读成
//     「快到测不出」）；未采集的引擎条目数也不上屏（载荷里的 0 是「没扫」不是「扫到 0 条」）；
//  ② 分位数与样本一律用 Go 交出的值（前端不自算、不重排）——两端都实测时两行数值都要在；
//  ③ `parity.comparable=false` 不画 ✅/❌（单侧数据比的是空气）；`skipped>0` 如实说明；
//  ④ 载荷守卫显式校验形状（桥数据禁断言穿透），畸形载荷走提示分支而非未捕获异常。

import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

import { initPerfPanel } from "./perf.ts";
import { scanBenchParsePayload } from "./perf-scan-bench.ts";

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// 引擎块提为具名常量：载荷里的数组按下标取会撞 noUncheckedIndexedAccess（`engines[0]` 可能是
// undefined），断言要么能用常量直接引用、要么就得套断言——常量最直白。
const GO_ENGINE = {
  engine: "go",
  used: true,
  runs_ms: [2.235, 1.725],
  median_ms: 1.725,
  p95_ms: 2.235,
  entries: 5,
  skipped: 0,
};
// rust 未参与：载荷里**没有** median_ms/p95_ms/runs_ms（omitempty），entries 恒 0
const RUST_UNUSED = { engine: "rust", used: false, reason: "unavailable", entries: 0, skipped: 2 };
const RUST_MEASURED = {
  engine: "rust",
  used: true,
  runs_ms: [1.1, 0.9],
  median_ms: 0.9,
  p95_ms: 1.1,
  entries: 5,
  skipped: 0,
};

/** 对齐真 CLI 输出（默认构建：`go run . --cli --files-root tests/fixtures/ysm scan-bench --iterations 2 --format json`） */
const DEFAULT_PAYLOAD = {
  spec: { files_root: "tests/fixtures/ysm", iterations: 2, build_backend: "go" },
  engines: [GO_ENGINE, RUST_UNUSED],
  parity: { comparable: false, match: false },
  output: "🔍 扫描引擎基准（Go / Rust 对照）",
  filesRoot: "tests/fixtures/ysm",
};

/** 两端都实测且条目一致（`-tags rust_backend` 构建才会出现） */
const BOTH_PAYLOAD = {
  spec: { files_root: "tests/fixtures/ysm", iterations: 2, build_backend: "rust" },
  engines: [GO_ENGINE, RUST_MEASURED],
  parity: { comparable: true, match: true },
  output: "🔍 扫描引擎基准（Go / Rust 对照）",
  filesRoot: "tests/fixtures/ysm",
};

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `
    <button id="diag-perf-run"></button>
    <input id="diag-perf-model" value="">
    <input id="diag-perf-iter" value="2">
    <select id="diag-perf-rtype"><option value=""></option></select>
    <input id="diag-perf-max" value="5">
    <input id="diag-perf-baseline-save" type="checkbox">
    <input id="diag-perf-baseline-compare" type="checkbox">
    <input id="diag-perf-baseline-th" value="50">
    <div id="diag-perf-single"></div>
    <div id="diag-perf-gui-out"></div>
    <button id="diag-perf-scan-bench"></button>
    <div id="diag-perf-scan-bench-out"></div>
    <div id="diag-perf-hist"></div>
  `;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

function clickAndFlush(root: ShadowRoot): Promise<void> {
  (root.getElementById("diag-perf-scan-bench") as HTMLElement).click();
  return new Promise((r) => setTimeout(r, 10));
}

function outRoot(root: ShadowRoot): HTMLElement {
  return root.getElementById("diag-perf-scan-bench-out") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatform.mockReturnValue(false);
});

describe("scanBenchParsePayload（桥数据形状守卫）", () => {
  it("接受真实载荷（含 error 状态：规律六错误分支也带载荷）", () => {
    expect(scanBenchParsePayload({ status: "success", data: DEFAULT_PAYLOAD })).not.toBeNull();
    expect(scanBenchParsePayload({ status: "error", data: DEFAULT_PAYLOAD })).not.toBeNull();
  });

  it("拒绝畸形载荷：缺 engines / 非数组 / 元素不是对象 / 元素缺 engine|used / 缺 parity", () => {
    expect(scanBenchParsePayload({ status: "success", data: undefined })).toBeNull();
    expect(scanBenchParsePayload({ status: "success", data: {} })).toBeNull();
    // 缺 engines
    expect(
      scanBenchParsePayload({ status: "success", data: { spec: {}, parity: {} } }),
    ).toBeNull();
    // engines 非数组（对象 / 字符串 / 空数组）
    expect(scanBenchParsePayload({ status: "success", data: { engines: {} } })).toBeNull();
    expect(scanBenchParsePayload({ status: "success", data: { engines: "go" } })).toBeNull();
    expect(
      scanBenchParsePayload({ status: "success", data: { engines: [], parity: {} } }),
    ).toBeNull();
    // 元素不是对象 / 缺 engine / used 非布尔
    expect(scanBenchParsePayload({ status: "success", data: { engines: [1] } })).toBeNull();
    expect(scanBenchParsePayload({ status: "success", data: { engines: [null] } })).toBeNull();
    expect(
      scanBenchParsePayload({ status: "success", data: { engines: [{ engine: "go" }] } }),
    ).toBeNull();
    expect(
      scanBenchParsePayload({
        status: "success",
        data: { engines: [{ engine: "go", used: "yes" }] },
      }),
    ).toBeNull();
    // 缺 parity：三选一结论无从判定
    expect(
      scanBenchParsePayload({
        status: "success",
        data: { engines: [{ engine: "go", used: true }] },
      }),
    ).toBeNull();
    // 非终态状态不是可消费结果
    expect(scanBenchParsePayload({ status: "pending", data: DEFAULT_PAYLOAD })).toBeNull();
  });
});

describe("扫描引擎对照面板（ADR-262 D3）", () => {
  it("提交迭代次数（复用面板控件）+ format=json；未采集的引擎显示原因而非 0.00ms", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "scan-bench", data: DEFAULT_PAYLOAD });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    // 参数键 = Go flag 名；迭代次数取自面板既有控件（值 2），绝不另开第二个迭代输入框
    expect(executeCLI).toHaveBeenLastCalledWith("scan-bench", { iterations: 2, format: "json" });

    const out = outRoot(root);
    const text = out.textContent ?? "";
    // go 侧：实测分位数是 Go 交出的值（前端只 toFixed 展示）
    expect(text).toContain(`${GO_ENGINE.median_ms.toFixed(2)}ms`);
    expect(text).toContain(`${GO_ENGINE.p95_ms.toFixed(2)}ms`);
    expect(text).toContain("实测");
    // rust 侧：未采集 + 原因人话（token unavailable → i18n），不是 0ms
    expect(text).toContain("未采集");
    expect(text).toContain("本构建未启用 rust_backend");
    expect(text).not.toContain("0.00ms");

    const rustRow = out.querySelector('tr[data-engine="rust"]') as HTMLElement | null;
    expect(rustRow).not.toBeNull();
    const rustText = rustRow?.textContent ?? "";
    // 未采集行的三个数值列都是「—」：不得出现任何毫秒数值（含 0.00ms）
    expect(rustText).not.toMatch(/\d+(\.\d+)?ms/);
    // 条目列也不得把载荷里的 0 当「扫到 0 条」上屏
    const rustCells = rustRow?.querySelectorAll("td");
    expect(rustCells?.[1]?.textContent).toBe("—");
    expect(rustCells?.[3]?.textContent).toBe("—");
    // skipped 如实说明（Go 记了「跑了 2 次但一次都没归 rust」，静默丢弃等于假装没发生）
    expect(text).toContain("另有 2 次未计入样本");
  });

  it("两端都实测 + parity.match=true：两行数值都在，一致性给 ✅", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "scan-bench", data: BOTH_PAYLOAD });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const out = outRoot(root);
    const text = out.textContent ?? "";
    expect(text).toContain(`${GO_ENGINE.median_ms.toFixed(2)}ms`);
    expect(text).toContain(`${RUST_MEASURED.median_ms.toFixed(2)}ms`);
    // 两行都必须是「实测」，不得有「未采集」
    expect(out.querySelectorAll("tr[data-engine]")).toHaveLength(2);
    expect(text).not.toContain("未采集");

    const parity = out.querySelector(".perf-sb-parity") as HTMLElement | null;
    expect(parity?.textContent).toContain("条目集合与关键字段逐条一致");
    // 图标走 UI_ICONS SVG（ADR-238）——「给 ✅」在 DOM 上就是 ok 类，而不是 emoji 文本
    expect(parity?.classList.contains("perf-sb-parity-ok")).toBe(true);
  });

  it("parity.comparable=false：只说「无法比对」，不画 ✅/❌", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "scan-bench", data: DEFAULT_PAYLOAD });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const parity = outRoot(root).querySelector(".perf-sb-parity") as HTMLElement | null;
    expect(parity?.textContent).toContain("无法比对");
    // 单侧数据没有「一致性」可言——给 ✅/❌ 就是把空气当结论（此处只允许 warn 类）
    expect(parity?.classList.contains("perf-sb-parity-warn")).toBe(true);
    expect(parity?.classList.contains("perf-sb-parity-ok")).toBe(false);
    expect(parity?.classList.contains("perf-sb-parity-bad")).toBe(false);
  });

  it("parity.comparable=true && match=false：列出 only_go / only_rust / field_diff", async () => {
    const mismatch = {
      ...BOTH_PAYLOAD,
      parity: {
        comparable: true,
        match: false,
        only_go: ["ysm/a.ysm"],
        only_rust: ["ysm/b.ysm"],
        field_diff: ["ysm/c.ysm"],
      },
    };
    executeCLI.mockResolvedValue({ status: "success", command: "scan-bench", data: mismatch });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const out = outRoot(root);
    const parity = out.querySelector(".perf-sb-parity") as HTMLElement | null;
    expect(parity?.textContent).toContain("存在分叉");
    const text = out.textContent ?? "";
    expect(text).toContain("仅 Go 扫到: ysm/a.ysm");
    expect(text).toContain("仅 Rust 扫到: ysm/b.ysm");
    expect(text).toContain("字段不一致: ysm/c.ysm");
  });

  it("实测但有 skipped：照样说明「另有 N 次未计入样本」", async () => {
    const withSkipped = {
      ...BOTH_PAYLOAD,
      engines: [{ ...GO_ENGINE, skipped: 3 }, RUST_MEASURED],
    };
    executeCLI.mockResolvedValue({ status: "success", command: "scan-bench", data: withSkipped });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    expect(outRoot(root).textContent ?? "").toContain("另有 3 次未计入样本");
  });

  it("畸形载荷被守卫拒绝并给出提示，不抛未捕获异常", async () => {
    executeCLI.mockResolvedValue({ status: "success", command: "scan-bench", data: {} });
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);

    const text = outRoot(root).textContent ?? "";
    // 命令成功但形状不对 = 契约漂移，比「执行失败」更值得暴露
    expect(text).toContain("未取得引擎对照结果");
    expect(text).not.toContain("0.00ms");
  });

  it("web 平台不发 CLI（走 toast 提示）", async () => {
    isWebPlatform.mockReturnValue(true);
    const root = makeRoot();
    initPerfPanel(root, esc);
    await clickAndFlush(root);
    expect(executeCLI).not.toHaveBeenCalled();
  });
});
