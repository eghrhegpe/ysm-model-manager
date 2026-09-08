// ===== health-report 测试 =====
// 覆盖：parseHealthReport 运行时校验（score/completeness 结构合法性守卫）
import { describe, expect, it } from "vitest";
import { parseHealthReport, type HealthReport } from "./health-report.ts";

// 合法完整报告骨架（满足 parseHealthReport 校验的最小 + 全字段）
function makeReport(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    timestamp: "2026-01-01T00:00:00Z",
    directory: "/repo",
    score: 85,
    completeness: { checked: 100, valid: 80, invalid: 20, percentage: 80 },
    cache: {
      cache_dir: "/cache",
      cache_files: 10,
      cache_size: 1024,
      hit_rate: 0.9,
    },
    resources: {
      total_files: 50,
      total_size: 2048,
      by_type: { ysm: 30, pmx: 20 },
    },
    dedup: { groups: 2, extra_files: 3, reclaim_bytes: 512 },
    ...overrides,
  };
}

describe("parseHealthReport — 运行时结构校验", () => {
  it("完整合法报告 → 原样返回", () => {
    const raw = makeReport();
    expect(parseHealthReport(raw)).toBe(raw);
  });

  it("raw = null → 返回 null", () => {
    expect(parseHealthReport(null)).toBeNull();
  });

  it("raw = undefined → 返回 null", () => {
    expect(parseHealthReport(undefined as unknown as null)).toBeNull();
  });

  it("completeness 缺失 → 返回 null", () => {
    const raw = makeReport({ completeness: undefined as unknown as HealthReport["completeness"] });
    expect(parseHealthReport(raw)).toBeNull();
  });

  it("score 为非数字（字符串）→ 返回 null", () => {
    const raw = makeReport({ score: "abc" as unknown as number });
    expect(parseHealthReport(raw)).toBeNull();
  });

  it("score 为 null → 返回 null", () => {
    const raw = makeReport({ score: null as unknown as number });
    expect(parseHealthReport(raw)).toBeNull();
  });

  it("percentage 为 NaN → 仍返回 raw（typeof NaN === 'number'，当前实现不拒）", () => {
    const raw = makeReport({
      completeness: { checked: 0, valid: 0, invalid: 0, percentage: NaN },
    });
    expect(parseHealthReport(raw)).toBe(raw);
  });

  it("percentage 为 Infinity → 仍返回 raw（typeof Infinity === 'number'，当前实现不拒）", () => {
    const raw = makeReport({
      completeness: { checked: 0, valid: 0, invalid: 0, percentage: Infinity },
    });
    expect(parseHealthReport(raw)).toBe(raw);
  });

  it("percentage 为字符串 → 返回 null", () => {
    const raw = makeReport({
      completeness: { checked: 0, valid: 0, invalid: 0, percentage: "80" as unknown as number },
    });
    expect(parseHealthReport(raw)).toBeNull();
  });

  it("valid 为非数字 → 返回 null", () => {
    const raw = makeReport({
      completeness: { checked: 0, valid: "80" as unknown as number, invalid: 0, percentage: 80 },
    });
    expect(parseHealthReport(raw)).toBeNull();
  });

  it("invalid 为非数字 → 返回 null", () => {
    const raw = makeReport({
      completeness: { checked: 0, valid: 80, invalid: "20" as unknown as number, percentage: 80 },
    });
    expect(parseHealthReport(raw)).toBeNull();
  });

  it("空对象 {} → 返回 null（score/completeness 均缺失）", () => {
    expect(parseHealthReport({} as HealthReport)).toBeNull();
  });

  it("resources 缺失 → 仍返回 raw（resources 不参与校验）", () => {
    const raw = makeReport({ resources: undefined as unknown as HealthReport["resources"] });
    expect(parseHealthReport(raw)).toBe(raw);
  });

  it("resources 各字段为 0 → 仍返回 raw", () => {
    const raw = makeReport({
      resources: { total_files: 0, total_size: 0, by_type: null },
    });
    expect(parseHealthReport(raw)).toBe(raw);
  });

  it("warnings 缺失 → 仍返回 raw（warnings 不参与校验）", () => {
    const { warnings: _warnings, ...rest } = makeReport();
    expect(parseHealthReport(rest)).toBe(rest);
  });
});
