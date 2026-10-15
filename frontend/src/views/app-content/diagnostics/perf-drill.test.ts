// @vitest-environment happy-dom
// ===== 诊断页：性能面板 — 阶段→加载剖析下钻（锐评 P1 拍板，2026-10-15）=====
// 覆盖：
//  - benchTraceKey：连接键归一化（posix / 剥 ./ 与前导斜杠）
//  - matchBenchTrace：精确 / 尾部匹配 / format 辅判 / 路径段边界 / 空键 / 多候选取最新 / 无匹配
//  - drillBenchToTrace：命中置顶高亮（含不在最近 5 条）、未命中缺席提示行、空 store 提示行+空态
// 语义红线：CLI 基准与前端加载是两次独立观测，下钻只按「同一模型」连接，不做逐阶段假对应。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { benchTraceKey, matchBenchTrace, drillBenchToTrace } from "./perf-drill.ts";
import { recordLoadTrace, clearLoadTraces, type LoadTrace } from "@/preview-3d/infra/load-trace.ts";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

import { escUnknown as esc } from "@/utils/html/html.ts";

function tr(path: string, format = "ysm", ts = 1000): LoadTrace {
  return { ts, format, path, stages: [{ name: "读取", ms: 1, status: "ok" as const }], ok: true };
}

beforeEach(() => {
  clearLoadTraces();
});

describe("benchTraceKey：连接键归一化", () => {
  it("剥掉 ./ 与前导斜杠，统一 posix 分隔", () => {
    expect(benchTraceKey("./ysm/aaa.ysm")).toBe("ysm/aaa.ysm");
    expect(benchTraceKey("/ysm/aaa.ysm")).toBe("ysm/aaa.ysm");
    expect(benchTraceKey("ysm\\aaa.ysm")).toBe("ysm/aaa.ysm");
    expect(benchTraceKey("ysm/aaa.ysm")).toBe("ysm/aaa.ysm");
    expect(benchTraceKey("  ysm/aaa.ysm  ")).toBe("ysm/aaa.ysm");
  });
});

describe("matchBenchTrace：连接键匹配", () => {
  it("精确匹配（两侧碰巧同坐标系）", () => {
    const traces = [tr("./ysm/aaa.ysm"), tr("./mmd/bbb.pmx")];
    expect(matchBenchTrace(traces, "./ysm/aaa.ysm")?.path).toBe("./ysm/aaa.ysm");
    expect(matchBenchTrace(traces, "mmd/bbb.pmx")?.path).toBe("./mmd/bbb.pmx");
  });

  it("尾部匹配：前端 path 带仓库根/url 前缀也命中", () => {
    const traces = [tr("D:/game/repo/ysm/aaa.ysm")];
    expect(matchBenchTrace(traces, "ysm/aaa.ysm")?.path).toBe("D:/game/repo/ysm/aaa.ysm");
  });

  it("format 辅判优先同格式（跨过更新的异格式记录）；不同格式仍回落同路径（不硬约束）", () => {
    // 辅判要跳过**更新的** mmd 记录取 ysm —— 若只按「取最新」会误判为 mmd，
    // 这正是辅判要防的：rtype 判定分叉不该让下钻跳到错误的格式记录。
    const both = [tr("./ysm/aaa.ysm", "ysm", 1000), tr("./ysm/aaa.ysm", "mmd", 2000)];
    expect(matchBenchTrace(both, "ysm/aaa.ysm", "ysm")?.format).toBe("ysm");
    // 没有同格式时回落「同路径」，不因 format 分叉而空手而归
    const onlyMmd = [tr("./ysm/aaa.ysm", "mmd")];
    expect(matchBenchTrace(onlyMmd, "ysm/aaa.ysm", "ysm")?.format).toBe("mmd");
  });

  it("路径段边界：aaa.ysm 不匹配 xaaa.ysm", () => {
    expect(matchBenchTrace([tr("./ysm/xaaa.ysm")], "ysm/aaa.ysm")).toBeUndefined();
  });

  it("空/空白 relPath → 无匹配（不编造连接）", () => {
    expect(matchBenchTrace([tr("./ysm/aaa.ysm")], "")).toBeUndefined();
    expect(matchBenchTrace([tr("./ysm/aaa.ysm")], "   ")).toBeUndefined();
  });

  it("多候选取最新的（最近的加载 = 用户刚做的事）", () => {
    const traces = [tr("./ysm/aaa.ysm", "ysm", 1000), tr("./ysm/aaa.ysm", "ysm", 2000)];
    expect(matchBenchTrace(traces, "ysm/aaa.ysm")?.ts).toBe(2000);
  });

  it("无匹配 → undefined", () => {
    expect(matchBenchTrace([tr("./mmd/bbb.pmx")], "ysm/aaa.ysm")).toBeUndefined();
  });
});

describe("drillBenchToTrace：阶段→加载剖析下钻", () => {
  function makeRoot(): ShadowRoot {
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="repo-tabs"><button class="repo-tab" data-tab="bench">bench</button><button class="repo-tab active" data-tab="logs">logs</button></div>
      <div class="diag-sub-bar" data-sub-bar="logs"><button class="diag-sub-tab active" data-sub="op">op</button><button class="diag-sub-tab" data-sub="trace">trace</button></div>
      <div id="diag-load-trace"></div>
    `;
    (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
      id: string,
    ) => el.querySelector(`#${id}`);
    return el as unknown as ShadowRoot;
  }

  it("命中 → 高亮该记录（恰一条描边卡，且无缺席提示）", () => {
    recordLoadTrace({ ts: 1000, format: "ysm", path: "./ysm/aaa.ysm", stages: tr("./x").stages, ok: true });
    recordLoadTrace({ ts: 2000, format: "mmd", path: "./mmd/bbb.pmx", stages: tr("./x").stages, ok: true });
    const root = makeRoot();
    drillBenchToTrace(root, esc, "./ysm/aaa.ysm", "ysm");
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    const focused = out.querySelectorAll(".perf-hist-card--focus");
    expect(focused).toHaveLength(1);
    expect(focused[0]?.textContent).toContain("aaa.ysm");
    expect(out.querySelector("[data-testid='diag-drill-miss']")).toBeNull();
  });

  it("命中记录不在最近 5 条时也置顶呈现（不被展示上限截断吞掉）", () => {
    // 先录 target（数组最前 = 最老），再录 6 条更新 → slice(-5) 后 target 必被排除
    recordLoadTrace({ ts: 1000, format: "ysm", path: "./ysm/target.ysm", stages: tr("./x").stages, ok: true });
    for (let i = 1; i <= 6; i++) {
      recordLoadTrace({ ts: i, format: "ysm", path: `./ysm/n${i}.ysm`, stages: tr("./x").stages, ok: true });
    }
    const root = makeRoot();
    drillBenchToTrace(root, esc, "ysm/target.ysm", "ysm");
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    const idxTarget = out.textContent!.indexOf("target.ysm");
    const idxN5 = out.textContent!.indexOf("n5.ysm");
    // 必须先断言「被渲染」（indexOf 对不存在的串返回 -1，-1 < 任何正数恒真——那是假绿）
    expect(idxTarget).toBeGreaterThanOrEqual(0);
    // 再断言「置顶」：命中记录排在最近的一条之前
    expect(idxTarget).toBeLessThan(idxN5);
    expect(out.querySelector(".perf-hist-card--focus")?.textContent).toContain("target.ysm");
  });

  it("未命中 → 显示缺席提示行（含目标路径），不伪造命中", () => {
    recordLoadTrace({ ts: 1000, format: "mmd", path: "./mmd/bbb.pmx", stages: tr("./x").stages, ok: true });
    const root = makeRoot();
    drillBenchToTrace(root, esc, "./ysm/aaa.ysm", "ysm");
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    const miss = out.querySelector("[data-testid='diag-drill-miss']");
    expect(miss).not.toBeNull();
    expect(miss?.textContent).toContain("ysm/aaa.ysm");
    expect(out.querySelectorAll(".perf-hist-card--focus")).toHaveLength(0);
  });

  it("空 store + 未命中 → 提示行与空态都渲染（缺席事实与无数据并陈）", () => {
    const root = makeRoot();
    drillBenchToTrace(root, esc, "./ysm/aaa.ysm", "ysm");
    const out = root.getElementById("diag-load-trace") as HTMLElement;
    expect(out.querySelector("[data-testid='diag-drill-miss']")).not.toBeNull();
    expect(out.textContent).toContain("暂无加载记录");
  });
});
