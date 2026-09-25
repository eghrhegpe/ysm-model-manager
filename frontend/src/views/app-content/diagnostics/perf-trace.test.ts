// @vitest-environment happy-dom
// ===== 诊断页：加载剖析面板的「多次记录展示」层（2026-09 展示补全）=====
// 覆盖（每条自带 clearLoadTraces，store 是模块级全局，不依赖同文件其它用例的残留）：
//  - 多条记录 → 全部展开 + 计数行（此前 store 存 50 条但只渲染最后一条，其余无消费者）
//  - 超过 5 条 → 只展开最近 5 条，其余如实报数
//  - 阶段粒度差异 → 1 段（FBX/Litematic 形态）显式说明，4 段不挂说明
//  - GPU 口径差异 → 有采集给数值，没采集显式标「未采集」而非省略（省略 = 让「没测」和「测出 0」同形）
//  - 跨记录统一刻度 → 慢记录的条确实更长（各自归一化会让 10ms 与 1000ms 看起来一样长）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderLoadTraceSection } from "./perf-trace.ts";
import { recordLoadTrace, clearLoadTraces } from "@/preview-3d/infra/load-trace.ts";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

import { escUnknown as esc } from "@/utils/html/html.ts";

function makeRoot(): ShadowRoot {
  const el = document.createElement("div");
  el.innerHTML = `<div id="diag-load-trace" data-testid="diag-load-trace"></div>`;
  (el as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById = (
    id: string,
  ) => el.querySelector(`#${id}`);
  return el as unknown as ShadowRoot;
}

/** 渲染一次并返回容器（调用方保证 store 状态由本用例决定）。 */
function render(): HTMLElement {
  const root = makeRoot();
  renderLoadTraceSection(root, esc);
  return root.getElementById("diag-load-trace") as HTMLElement;
}

const oneStage = (ms: number): { name: string; ms: number; status: "ok" }[] => [
  { name: "读取", ms, status: "ok" },
];

beforeEach(() => {
  clearLoadTraces();
});

describe("加载剖析：多次记录展示", () => {
  it("多条记录 → 全部展开（新的在前）+ 计数行", () => {
    recordLoadTrace({ ts: 1000, format: "ysm", path: "./ysm/aaa.ysm", stages: oneStage(5), ok: true });
    recordLoadTrace({ ts: 2000, format: "mmd", path: "./mmd/bbb.pmx", stages: oneStage(7), ok: true });
    const out = render();
    expect(out.textContent).toContain("aaa.ysm");
    expect(out.textContent).toContain("bbb.pmx");
    expect(out.textContent).toContain("共 2 条记录");
    // 最近的排最前（用户刚做的事先看到）
    expect(out.textContent.indexOf("bbb.pmx")).toBeLessThan(out.textContent.indexOf("aaa.ysm"));
  });

  it("超过 5 条 → 只展开最近 5 条，其余如实报数", () => {
    for (let i = 1; i <= 7; i++) {
      recordLoadTrace({
        ts: i * 1000,
        format: "ysm",
        path: `./ysm/m${i}.ysm`,
        stages: oneStage(i),
        ok: true,
      });
    }
    const out = render();
    expect(out.textContent).toContain("m7.ysm");
    expect(out.textContent).toContain("m3.ysm");
    expect(out.textContent).not.toContain("m2.ysm");
    expect(out.textContent).not.toContain("m1.ysm");
    expect(out.textContent).toContain("还有 2 条更早的记录未显示");
    expect(out.textContent).toContain("共 7 条记录");
  });

  it("阶段粒度如实标注：1 段显式说明，4 段不挂说明", () => {
    recordLoadTrace({
      ts: 1000,
      format: "fbx",
      path: "./fbx/coarse.fbx",
      stages: [{ name: "加载", ms: 30, status: "ok" }],
      ok: true,
    });
    recordLoadTrace({
      ts: 2000,
      format: "ysm",
      path: "./ysm/fine.ysm",
      stages: [
        { name: "读取", ms: 5, status: "ok" },
        { name: "解析", ms: 9, status: "ok" },
        { name: "纹理加载", ms: 11, status: "ok" },
        { name: "build", ms: 13, status: "ok" },
      ],
      ok: true,
    });
    const out = render();
    expect(out.textContent).toContain("1 段");
    expect(out.textContent).toContain("4 段");
    // 粒度说明只挂在 1 段那条上（4 段记录不该被顺带贴标签）
    expect(out.innerHTML.split("该格式只记了 1 段合并耗时").length - 1).toBe(1);
  });

  it("GPU 口径：有采集显示数值，没采集显式标「未采集」", () => {
    recordLoadTrace({
      ts: 1000,
      format: "mmd",
      path: "./mmd/withgpu.pmx",
      stages: oneStage(5),
      gpuMb: 12.4,
      ok: true,
    });
    recordLoadTrace({
      ts: 2000,
      format: "ysm",
      path: "./ysm/nogpu.ysm",
      stages: oneStage(5),
      ok: true,
    });
    const out = render();
    expect(out.textContent).toContain("12.4");
    expect(out.textContent).toContain("未采集");
    // 只有缺 gpuMb 的那条标未采集
    expect(out.innerHTML.split("未采集").length - 1).toBe(1);
  });

  it("跨记录统一刻度：慢记录的条更长（各自归一化会让 10ms 与 1000ms 一样长）", () => {
    recordLoadTrace({ ts: 1000, format: "ysm", path: "./ysm/slow.ysm", stages: oneStage(1000), ok: true });
    recordLoadTrace({ ts: 2000, format: "ysm", path: "./ysm/fast.ysm", stages: oneStage(10), ok: true });
    const html = render().innerHTML;
    // 每张卡片各一条首阶段 rect（x=padL=72, y=4）；新的在前 → [0]=fast(10ms), [1]=slow(1000ms)
    const widths = [...html.matchAll(/<rect x="72" y="4" width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(2);
    expect(widths[0]!).toBeLessThan(widths[1]!);
    expect(widths[1]! / widths[0]!).toBeGreaterThan(50);
  });

  it("空 store → 保留原有空态（不因多记录改造而回归）", () => {
    const out = render();
    expect(out.textContent).toContain("暂无加载记录");
    expect(out.innerHTML).not.toContain("perf-hist-card");
  });
});
