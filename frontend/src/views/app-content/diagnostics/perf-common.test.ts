// @vitest-environment node
// ===== perf-common.ts 共享工具层测试 =====
// 覆盖：sectionHeader 纯函数 + 守卫/错误辅助的输入输出契约。
import { describe, it, expect, vi } from "vitest";

// 先 mock bus（bindPerfCopyHandlers 用得到）
vi.mock("@/bus", () => ({
  bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

import { sectionHeader, bindPerfCopyHandlers, getOutBox, setBusy, setErrorMsg, setErrorResp, setErrorCatch, respHasOutput, renderLoadFailure } from "./perf-common.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

describe("sectionHeader", () => {
  it("icon + label → 带 icon 和 label 的 HTML", () => {
    const html = sectionHeader(UI_ICONS.chart, "性能概览");
    expect(html).toContain('<svg class="ws-icon"');
    expect(html).toContain("性能概览");
  });

  it("带 rawText → HTML 包含 rawText（encodeURIComponent 编码）", () => {
    const html = sectionHeader(UI_ICONS.search, "慢查询", "TOP 10");
    expect(html).toContain('<svg class="ws-icon"');
    expect(html).toContain("慢查询");
    expect(html).toContain(encodeURIComponent("TOP 10"));
  });
  // CLI 信封耗时（go/cli/json.go|TimingInfo）：Go 每次调用都发，前端曾声明了却零读取。
  // 它回答一个真实问题——「这一节的结果等了 4.2 秒，是 CLI 慢还是渲染慢」。
  it("给 timingMs → 渲染耗时徽标（整毫秒转人话）", () => {
    const html = sectionHeader(UI_ICONS.chart, "性能概览", undefined, 1234.5678);
    expect(html).toContain("1234.57ms");
    expect(html).not.toContain("—");
  });

  it("timingMs 缺席/为 0 → 不渲染耗时徽标（不印 0.00ms 冒充实测）", () => {
    const absent = sectionHeader(UI_ICONS.chart, "性能概览");
    const zero = sectionHeader(UI_ICONS.chart, "性能概览", undefined, 0);
    for (const html of [absent, zero]) {
      expect(html).not.toContain("ms</span>");
      expect(html).not.toContain("0.00ms");
    }
  });

  it("rawText 与 timingMs 可并存（复制按钮 + 耗时徽标不互斥）", () => {
    const html = sectionHeader(UI_ICONS.search, "慢查询", "TOP 10", 42.5);
    expect(html).toContain(encodeURIComponent("TOP 10"));
    expect(html).toContain("42.50ms");
  });

  it("无 rawText → 不抛错", () => {
    expect(() => sectionHeader(UI_ICONS.settings, "配置")).not.toThrow();
  });

  it("空字符串参数 → 不抛错", () => {
    expect(() => sectionHeader("", "")).not.toThrow();
  });
});

describe("getOutBox", () => {
  it("找不到元素返回 null", () => {
    const root = { getElementById: vi.fn(() => null) } as unknown as ShadowRoot;
    expect(getOutBox(root, "nope")).toBeNull();
  });
});

describe("setBusy / setErrorMsg", () => {
  it("setBusy 注入占位文案", () => {
    const el = { innerHTML: "" } as HTMLElement;
    setBusy(el);
    // ADR-238：占位图标由 emoji 改走 SVG 形态（断言形态而非具体路径）
    expect(el.innerHTML).toContain('<svg class="ws-icon"');
  });

  it("setErrorMsg 注入错误文案（经 esc 转义）", () => {
    const el = { innerHTML: "" } as HTMLElement;
    const esc = vi.fn((s: string) => s.replace(/</g, "&lt;")) as unknown as (s: unknown) => string;
    setErrorMsg(el, "<script>", esc);
    expect(esc).toHaveBeenCalledWith("<script>");
    // ADR-238：图标由 emoji 改走 SVG（随主题变色 + 随字号缩放），断言形态随之更新。
    // 断言「是 SVG 图标」而非某个具体路径，避免图标库改路径时本测试无谓报警。
    expect(el.innerHTML).toContain('<svg class="ws-icon"');
    // 转义契约不变：文案仍须经 esc（注入意图未因换图标而放松）
    expect(el.innerHTML).toContain("&lt;script>");
  });
});

describe("setErrorResp / setErrorCatch", () => {
  it("setErrorResp 取 resp.error.message", () => {
    const el = { innerHTML: "" } as HTMLElement;
    const resp = { status: "error", error: { message: "boom" } } as any;
    setErrorResp(el, resp, (s: unknown) => s as string);
    expect(el.innerHTML).toContain("boom");
  });

  it("setErrorCatch 取 safeErrorMessage", () => {
    const el = { innerHTML: "" } as HTMLElement;
    setErrorCatch(el, new Error("x"), (s: unknown) => s as string);
    expect(el.innerHTML).toContain("x");
  });
});

describe("respHasOutput", () => {
  it("success + output → true", () => {
    expect(respHasOutput({ status: "success", data: { output: "ok" } } as any)).toBe(true);
  });
  it("success + 无 output → false", () => {
    expect(respHasOutput({ status: "success", data: {} } as any)).toBe(false);
  });
  it("error → false", () => {
    expect(respHasOutput({ status: "error" } as any)).toBe(false);
  });
  // 类型谓词必须保证断言出来的类型真的成立：output 非字符串时返回 true 会让消费方
  // 按 string 调 .split() 等即 TypeError（与 cli-bridge 的 `as` 断言同源病）
  it("success + output 非字符串 → false（类型谓词诚实性）", () => {
    expect(respHasOutput({ status: "success", data: { output: 123 } } as any)).toBe(false);
    expect(respHasOutput({ status: "success", data: { output: null } } as any)).toBe(false);
    expect(respHasOutput({ status: "success", data: { output: {} } } as any)).toBe(false);
  });
  it("success + output 空串 → false（空输出与无输出同义）", () => {
    expect(respHasOutput({ status: "success", data: { output: "" } } as any)).toBe(false);
  });
});

describe("bindPerfCopyHandlers", () => {
  it("无对应容器 → 不抛错", () => {
    const root = { getElementById: vi.fn(() => null) } as unknown as ShadowRoot;
    expect(() => bindPerfCopyHandlers(root)).not.toThrow();
  });
});

// ===== renderLoadFailure：载荷不可用时的统一失败渲染（诊断页重复实现审计 C4）=====
// 立因：同一段「命令成功但载荷形状不对 / 命令失败」的三元分支曾在 5 个模块各写一遍
//（perf-single-bench 的 renderBenchFailure、perf-concurrent、perf-scan-bench、perf-gui-flow（已下线）），
// 唯一差异是空载荷文案键。收敛后**判据唯一**：status=success 即契约漂移（比"执行失败"
// 更值得暴露），否则转述 Go 原话。
describe("renderLoadFailure", () => {
  const esc = ((s: string) => s) as unknown as Parameters<typeof renderLoadFailure>[2];
  // node 环境（本文件首行 @vitest-environment node）没有 document：只需 innerHTML 可赋值的桩
  const makeOut = () => ({ innerHTML: "" }) as unknown as HTMLElement;

  it("status=success（命令成功但载荷形状不对）→ 渲染该模块的空载荷文案", () => {
    const out = makeOut();
    renderLoadFailure(out, { status: "success", data: {} } as never, esc, "diagnostics.perfScanBenchEmpty");
    expect(out.innerHTML).toContain("diag-stat-error");
    // 文案键由调用点给：契约测试按源码子串锚定 perfScanBenchEmpty 出现在 perf-scan-bench.ts
    expect(out.innerHTML.length).toBeGreaterThan(0);
  });

  it("status=error → 转述 Go 原话（优先 error.message）", () => {
    const out = makeOut();
    renderLoadFailure(
      out,
      { status: "error", error: { code: "param_error", message: "磁盘已满" } } as never,
      esc,
      "diagnostics.perfFail",
    );
    expect(out.innerHTML).toContain("磁盘已满");
  });

  it("status=error 但 Go 没给 message → 退回通用失败文案（不渲染空横幅）", () => {
    const out = makeOut();
    renderLoadFailure(out, { status: "error" } as never, esc, "diagnostics.perfFail");
    expect(out.innerHTML).toContain("diag-stat-error");
  });
});
