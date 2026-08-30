// ===== 诊断页：仓库体检（health.ts）测试 =====
// 覆盖：parseHealthReport（合法/非法/后端错误）/ renderHealthReport（分数环/维度/警告/转义）
//      / runHealthAudit（成功渲染 / 后端错误 / 解析失败 / 调用异常 + 重入守卫）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../../test-utils/index.ts";
import { runHealthAudit, renderHealthReport, formatSize } from "./health.ts";
import { parseHealthReport } from "../../../utils/health-report.ts";

const { getApp } = vi.hoisted(() => ({ getApp: vi.fn() }));
vi.mock("../../../backend/app.ts", () => ({ getApp }));

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** 构造一份合法体检报告（PowerShell 少引号转义，用对象拼接） */
function buildReport() {
  return {
    timestamp: "2026-08-21T00:00:00Z",
    directory: "/repo",
    score: 85,
    completeness: { checked: 10, valid: 9, invalid: 1, percentage: 90 },
    cache: { cache_dir: "/cache", cache_files: 5, cache_size: 1024, hit_rate: 50 },
    resources: { total_files: 12, total_size: 2048, by_type: { model: 10, texture: 2 } },
    dedup: { groups: 1, extra_files: 2, reclaim_bytes: 4096 },
    warnings: ["模型完整性 90.0% 低于 95% 阈值"],
  };
}

beforeEach(() => {
  getApp.mockReset();
});

describe("parseHealthReport", () => {
  it("合法 JSON 且含 score/completeness → 解析成功", () => {
    const r = parseHealthReport(JSON.stringify(buildReport()));
    expect(r).not.toBeNull();
    expect(r).not.toBeInstanceOf(Error);
    if (r && !(r instanceof Error)) {
      expect(r.score).toBe(85);
      expect(r.dedup.groups).toBe(1);
    }
  });

  it("非法 JSON → null", () => {
    expect(parseHealthReport("not json")).toBeNull();
  });

  it("后端业务错误 {error: string} → Error 实例（非 null 也非 HealthReport）", () => {
    const err = parseHealthReport(JSON.stringify({ error: "路径超出仓库目录" }));
    expect(err).toBeInstanceOf(Error);
    if (err instanceof Error) {
      expect(err.message).toBe("路径超出仓库目录");
    }
  });
});

describe("renderHealthReport", () => {
  it("渲染分数环 + 各维度 + 警告", () => {
    const html = renderHealthReport(buildReport(), esc);
    expect(html).toContain("85");
    expect(html).toContain("90.0%");
    expect(html).toContain("缓存文件 <b>5</b>");
    expect(html).toContain("有效: 9");
    expect(html).toContain("可回收: 4.0 KB");
    expect(html).toContain("模型完整性 90.0%");
  });

  it("告警文本转义（防注入）", () => {
    const r = buildReport();
    r.warnings = ['<script>alert(1)</script>'];
    const html = renderHealthReport(r, esc);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script");
  });

  it("目录路径转义", () => {
    const r = buildReport();
    r.directory = '/repo/<b>evil</b>';
    const html = renderHealthReport(r, esc);
    expect(html).not.toContain("<b>evil");
    expect(html).toContain("&lt;b>evil");
  });
});

describe("runHealthAudit", () => {
  it("成功：RepoHealthAudit 返回 JSON → 渲染到容器", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => JSON.stringify(buildReport())),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    await runHealthAudit(list, esc);
    await waitFor(() => expect(list.innerHTML).toContain("85"));
    expect(list.innerHTML).toContain("健康");
    expect(list.innerHTML).toContain("数据源");
  });

  it("后端业务错误 {error: string} → 展示原文案（非'解析失败'）", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => JSON.stringify({ error: "路径超出仓库目录" })),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    await runHealthAudit(list, esc);
    await waitFor(() => expect(list.innerHTML).toContain("路径超出仓库目录"));
    expect(list.innerHTML).not.toContain("解析失败");
  });

  it("真解析失败（非法 JSON）→ 展示解析失败文案", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => "not json"),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    await runHealthAudit(list, esc);
    await waitFor(() => expect(list.innerHTML).toContain("❌"));
    expect(list.innerHTML).toContain("解析失败");
    expect(list.innerHTML).not.toContain("路径超出仓库目录");
  });

  it("调用异常 → 展示错误（friendlyError）", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => Promise.reject(new Error("boom"))),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    await runHealthAudit(list, esc);
    await waitFor(() => expect(list.innerHTML).toContain("❌"));
  });

  it("重入守卫：并发第二次调用直接返回", async () => {
    let resolveFn: (v: string) => void = () => {};
    const healthAuditMock = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolveFn = res;
        }),
    );
    getApp.mockResolvedValue({
      RepoHealthAudit: healthAuditMock,
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    const p1 = runHealthAudit(list, esc);
    await runHealthAudit(list, esc); // 第二次应被守卫吞掉
    // 等 RepoHealthAudit mock 首次调用（resolveFn 赋值）后再解析——runHealthAudit
    // 现多一步 GetRepoRoot await，直接 resolveFn 会在 mock 调用前执行（初始空函数）
    await vi.waitFor(() => expect(healthAuditMock).toHaveBeenCalled());
    resolveFn(JSON.stringify(buildReport()));
    await p1;
    await waitFor(() => expect(list.innerHTML).toContain("85"));
  });
});

describe("formatSize（委托 formatBytes，单一事实来源）", () => {
  it("各量级格式化", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
});
