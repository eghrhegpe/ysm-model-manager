// ===== 诊断页：仓库体检（health.ts）测试 =====
// 覆盖：parseHealthReport（合法/非法/后端错误）/ renderHealthReport（分数环/维度/警告/转义）
//      / runHealthAudit（成功渲染 / 后端错误 / 解析失败 / 调用异常 + 重入守卫 + 按钮禁用外观）
//      / initHealthPanel（常驻栏接线 + **体检后按钮仍在**的 ADR-288 §1 dead-end 墓碑）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@/test-utils/index.ts";
import { initHealthPanel, runHealthAudit, renderHealthReport, formatSize } from "./health.ts";
import { type HealthReport, parseHealthReport } from "@/utils/health-report.ts";

const { getApp } = vi.hoisted(() => ({ getApp: vi.fn() }));
vi.mock("@/backend/app.ts", () => ({ getApp }));

import { escUnknown as esc } from "@/utils/html/html.ts";

/** 构造一份合法体检报告（PowerShell 少引号转义，用对象拼接） */
function buildReport(): HealthReport {
  return {
    timestamp: "2026-08-21T00:00:00Z",
    directory: "/repo",
    score: 85,
    completeness: { checked: 10, valid: 9, invalid: 1, percentage: 90 },
    cache: { cache_dir: "/cache", cache_files: 5, cache_size: 1024 },
    resources: { total_files: 12, total_size: 2048, banned: 0, by_type: { model: 10, texture: 2 } },
    dedup: { groups: 1, extra_files: 2, reclaim_bytes: 4096 },
    warnings: ["模型完整性 90.0% 低于 95% 阈值"],
  };
}

beforeEach(() => {
  getApp.mockReset();
});

describe("renderHealthReport — 缓存命中率（Go 真口径）", () => {
  // 命中率展示曾因「全局缓存文件数/本仓库纹理数」的错误口径被整体删除；
  // Go 侧重写为逐纹理内容哈希统计后恢复。以下用例锁定展示的三个诚实性细节。
  it("有命中数据 → 显示「命中率 N%（命中/总数）」", () => {
    const r = buildReport();
    r.cache = {
      cache_dir: "/cache",
      cache_files: 5,
      cache_size: 1024,
      hit_rate: 66.7,
      hits: 2,
      misses: 1,
    };
    const html = renderHealthReport(r, esc);
    expect(html).toContain("命中率 67%（2/3）");
  });

  it("采样统计 → 加「≈」前缀（避免把估计值当全量结论）", () => {
    const r = buildReport();
    r.cache = {
      cache_dir: "/cache",
      cache_files: 5,
      cache_size: 1024,
      hit_rate: 40,
      hits: 400,
      misses: 600,
      cache_sampled: true,
    };
    const html = renderHealthReport(r, esc);
    expect(html).toContain("命中率 ≈40%（400/1000）");
  });

  it("无纹理（hits+misses=0）→ 整段省略（0/0 无意义）", () => {
    const r = buildReport();
    r.cache = { cache_dir: "/cache", cache_files: 5, cache_size: 1024 };
    const html = renderHealthReport(r, esc);
    expect(html).not.toContain("命中率");
  });

  it("探测失败可见（故障 ≠ 未缓存，不让磁盘故障伪装成「没缓存」）", () => {
    const r = buildReport();
    r.cache = {
      cache_dir: "/cache",
      cache_files: 5,
      cache_size: 1024,
      hit_rate: 0,
      hits: 0,
      misses: 3,
      cache_scan_errors: 2,
    };
    const html = renderHealthReport(r, esc);
    expect(html).toContain("探测失败 2");
  });
});

describe("parseHealthReport", () => {
  it("合法 report 且含 score/completeness → 解析成功", () => {
    const r = parseHealthReport(buildReport());
    expect(r).not.toBeNull();
    if (r) {
      expect(r.score).toBe(85);
      expect(r.dedup.groups).toBe(1);
    }
  });

  it("null → null", () => {
    expect(parseHealthReport(null)).toBeNull();
  });

  it("结构不合法（缺 score）→ null", () => {
    const r = parseHealthReport({ timestamp: "x", directory: "/", completeness: { checked: 0, valid: 0, invalid: 0, percentage: 0 } } as never);
    expect(r).toBeNull();
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
    r.directory = "/repo/<b>evil</b>";
    const html = renderHealthReport(r, esc);
    // 夹具已与生产同源（utils/html|escUnknown，5 实体表）：`<` 与 `>` 都必须转义。
    // 此前手写夹具只转 `<`，本断言便跟着写成 `&lt;b>evil`——把夹具的残缺转义表当契约锁住了，
    // 生产实际输出 `&lt;b&gt;`，测试绿而生产未被验证（2026-09 锐评收债实证）。
    expect(html).not.toContain("<b>evil");
    expect(html).toContain("&lt;b&gt;evil&lt;/b&gt;");
  });
});

describe("initHealthPanel（常驻体检栏）", () => {
  /**
   * 夹具对齐**真实 tpl**（ADR-288 D2）：按钮住栏内，结果区是栏的**兄弟**。
   * 旧实现按钮住在结果容器内，首次体检的整块 innerHTML 会把它抹掉——本夹具 + 下方
   * 「体检后按钮仍在」用例即该 dead-end 的墓碑。
   */
  function makePanel(): { bar: HTMLElement; list: HTMLElement; btn: HTMLButtonElement } {
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="diag-bar" id="diag-health-bar">
        <div class="diag-bar-row"><button id="diag-scan-health">开始体检</button></div>
      </div>
      <div id="diag-health-list"><span class="sentinel">占位</span></div>
    `;
    document.body.appendChild(root);
    return {
      bar: root.querySelector("#diag-health-bar") as HTMLElement,
      list: root.querySelector("#diag-health-list") as HTMLElement,
      btn: root.querySelector("#diag-scan-health") as HTMLButtonElement,
    };
  }

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("栏内按钮点击 → 报告写进结果区", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => buildReport()),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const { bar, list, btn } = makePanel();
    initHealthPanel(bar, list, esc);
    btn.click();
    await waitFor(() => expect(list.innerHTML).toContain("85"));
    expect(list.innerHTML).toContain("健康");
  });

  it("扫描期间按钮禁用（可见反馈），结束后复位", async () => {
    let resolveFn: (v: Record<string, unknown> | null) => void = () => {};
    const auditMock = vi.fn(
      () =>
        new Promise<Record<string, unknown> | null>((res) => {
          resolveFn = res;
        }),
    );
    getApp.mockResolvedValue({
      RepoHealthAudit: auditMock,
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const { bar, list, btn } = makePanel();
    initHealthPanel(bar, list, esc);
    btn.click();
    await vi.waitFor(() => expect(auditMock).toHaveBeenCalled());
    expect(btn.disabled).toBe(true); // 正在跑：禁用而非静默吞点击
    resolveFn({ ...buildReport() });
    await waitFor(() => expect(btn.disabled).toBe(false));
  });

  /** ADR-288 §1 dead-end 墓碑：报告渲染是**结果区**的整块替换，按钮在栏里 ⇒ 必须仍可再体检。
   *  把按钮挪回结果容器，本用例立刻红（旧实现即此形态：体检一次后不可复检，只能重载应用）。 */
  it("体检出报告后按钮仍在栏内且可再次体检", async () => {
    const auditMock = vi.fn(() => buildReport());
    getApp.mockResolvedValue({
      RepoHealthAudit: auditMock,
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const { bar, list, btn } = makePanel();
    initHealthPanel(bar, list, esc);

    btn.click();
    await waitFor(() => expect(list.innerHTML).toContain("85"));

    expect(btn.isConnected).toBe(true);
    expect(bar.contains(btn)).toBe(true);
    btn.click(); // 直接复检
    await waitFor(() => expect(auditMock).toHaveBeenCalledTimes(2));
  });

  it("栏/结果区缺失（查看器模式未渲染该 tab）→ 静默返回", () => {
    initHealthPanel(null, null, esc);
    expect(getApp).not.toHaveBeenCalled();
  });
});

describe("runHealthAudit", () => {
  it("成功：RepoHealthAudit 返回 typed report → 渲染到容器", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => buildReport()),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    await runHealthAudit(list, esc);
    await waitFor(() => expect(list.innerHTML).toContain("85"));
    expect(list.innerHTML).toContain("健康");
    expect(list.innerHTML).toContain("数据源");
  });

  it("后端业务错误（Go error 通道）→ 展示原文案（非'解析失败'）", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => Promise.reject(new Error("路径超出仓库目录"))),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    await runHealthAudit(list, esc);
    await waitFor(() => expect(list.innerHTML).toContain("路径超出仓库目录"));
    expect(list.innerHTML).not.toContain("解析失败");
  });

  it("返回 null → 展示解析失败文案", async () => {
    getApp.mockResolvedValue({
      RepoHealthAudit: vi.fn(() => null),
      GetRepoRoot: vi.fn(async () => "/m"),
    });
    const list = document.createElement("div");
    await runHealthAudit(list, esc);
    await waitFor(() => expect(list.innerHTML).toContain('<svg class="ws-icon"'));
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
    await waitFor(() => expect(list.innerHTML).toContain('<svg class="ws-icon"'));
  });

  it("重入守卫：并发第二次调用直接返回", async () => {
    let resolveFn: (v: Record<string, unknown> | null) => void = () => {};
    const healthAuditMock = vi.fn(
      () =>
        new Promise<Record<string, unknown> | null>((res) => {
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
    // buildReport 现返回 HealthReport（供命中率用例按类型赋值 cache 字段），
    // 此处 mock 的 resolve 形参是 Record<string, unknown>——显式展开一次。
    resolveFn({ ...buildReport() });
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
