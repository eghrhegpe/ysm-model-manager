// @vitest-environment happy-dom
// ===== 诊断页：性能面板 — 性能趋势的基线口径（2026-10-15 锐评 P2 拍板「按类型聚合」）=====
// 覆盖：
//  - 按类型过滤：只画该类型历史，不混入其他类型
//  - 该类型不足 2 条：明确提示（不回落全库混合——把其他类型混进来等于画假数据）
//  - 旧记录（无 rtype）不猜进任何类型：不进类型基线，仍留全库混合视图
//  - 无类型上下文（矩阵聚合态回落）：全库混合视图保持现状
//  - 基线标注：区段头写清「哪个类型、几条历史」
import { describe, it, expect, vi, beforeEach } from "vitest";
import { savePerfRecord, renderPerfTrendSection } from "./perf-trend.ts";

const { executeCLI, isWebPlatform } = vi.hoisted(() => ({
  executeCLI: vi.fn(),
  isWebPlatform: vi.fn(() => false),
}));

vi.mock("@/services/cli-bridge.ts", () => ({ executeCLI }));
vi.mock("@/backend/platform-web.ts", () => ({ isWebPlatform }));

import { escUnknown as esc } from "@/utils/html/html.ts";

const S = (name: string, ms: number) => [{ name, ms, status: "ok" as const }];

beforeEach(() => {
  localStorage.clear();
});

describe("性能趋势基线口径（按类型聚合）", () => {
  it("按类型过滤：只画该类型历史，其他类型的阶段名不进入图例", () => {
    savePerfRecord(S("① 文件读取", 10), "ysm");
    savePerfRecord(S("① 文件读取", 20), "ysm");
    savePerfRecord(S("② JSON 解析", 50), "mmd");
    const html = renderPerfTrendSection(esc, "ysm");
    expect(html).toContain("① 文件读取");
    expect(html).not.toContain("② JSON 解析"); // 其他类型被过滤，不混线
    expect(html).toContain("<polyline"); // 确实画了折线（≥2 条）
  });

  it("该类型不足 2 条 → 明确提示，不回落全库混合", () => {
    savePerfRecord(S("① 文件读取", 10), "ysm");
    savePerfRecord(S("② JSON 解析", 50), "mmd");
    savePerfRecord(S("② JSON 解析", 60), "mmd");
    const html = renderPerfTrendSection(esc, "ysm");
    expect(html).toContain("不足 2 条");
    expect(html).toContain("1"); // 现有 1 条
    expect(html).not.toContain("<polyline"); // 未画图——不能把别的类型混进来装成有数据
  });

  it("旧记录（无 rtype）不猜进任何类型：不进类型基线", () => {
    savePerfRecord(S("③ 缓存检查", 30)); // 旧格式，无 rtype
    savePerfRecord(S("① 文件读取", 10), "ysm");
    savePerfRecord(S("① 文件读取", 20), "ysm");
    const html = renderPerfTrendSection(esc, "ysm");
    expect(html).toContain("① 文件读取");
    expect(html).not.toContain("③ 缓存检查"); // 无类型记录被排除在 ysm 基线外
  });

  it("无类型上下文（矩阵聚合态回落）→ 全库混合视图保持现状", () => {
    savePerfRecord(S("① 文件读取", 10), "ysm");
    savePerfRecord(S("② JSON 解析", 50), "mmd");
    const html = renderPerfTrendSection(esc); // 不传 rtype
    // 折线维度 = 最近一次的阶段链（P3-3 判据），故只画 "②"；两条记录 → 折线 2 个点
    expect(html).toContain("② JSON 解析");
    expect(html).not.toContain("① 文件读取");
    const pts = html.match(/<polyline points="([^"]+)"/)?.[1] ?? "";
    expect(pts.split(" ")).toHaveLength(2);
  });

  it("基线标注：区段头写清类型与历史条数", () => {
    savePerfRecord(S("① 文件读取", 10), "ysm");
    savePerfRecord(S("① 文件读取", 20), "ysm");
    const html = renderPerfTrendSection(esc, "ysm");
    expect(html).toContain("当前基线");
    expect(html).toContain("2 条");
  });
});
