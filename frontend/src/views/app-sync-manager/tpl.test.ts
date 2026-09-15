// ===== tpl.ts 状态元数据表驱动测试（statusIcon/statusColor/actionBtn 单一事实源）=====
import { describe, expect, it } from "vitest";
import {
  STATUS_ICON,
  STATUS_COLOR,
  statusIconOf,
  statusColorOf,
  statusTabHTML,
  actionBtnHTML,
} from "./tpl.ts";

describe("statusIconOf", () => {
  it("六种已知状态各有图标且互不相同", () => {
    const statuses = ["synced", "legacy", "missing", "diverged", "disabled", "optional"];
    const icons = statuses.map(statusIconOf);
    for (const s of statuses) {
      expect(STATUS_ICON[s]).toBeTruthy();
    }
    expect(new Set(icons).size).toBe(statuses.length);
  });

  it("未知状态回退 ·", () => {
    expect(statusIconOf("whatever")).toBe("·");
    expect(statusIconOf("")).toBe("·");
  });

  // ── 迁移回归锁（2026-09，ADR-238/ADR-248）─────────────────────────────
  // 起因：tab 构建器曾在 renderer.ts **内联写死** 6 个状态字形，与 STATUS_ICON 表形成两处来源；
  // 且 emoji 闸的口径只认「标签内容起始处」，看不见模板字面量起始与数据字面量 → 三闸齐哑。
  // 故在**数据层**钉死：值必须是语义名、必须能解析出 SVG。
  it("回归锁：STATUS_ICON 全部是语义名且能解析出 SVG（非字形字面量）", () => {
    const GLYPH_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    for (const [status, name] of Object.entries(STATUS_ICON)) {
      expect(GLYPH_RE.test(name), `${status} 仍是字形字面量：${name}`).toBe(false);
      expect(statusIconOf(status).includes("<svg"), `${status}(${name}) 解析不出 SVG`).toBe(true);
    }
  });

  it("回归锁：statusTabHTML 不再输出行内 style（样式归样式表）", () => {
    const html = statusTabHTML("disabled", "x", 1, false);
    expect(html).not.toContain("style=");
    expect(html).toContain('class="sm-status-tab"');
    expect(statusTabHTML("disabled", "x", 1, true)).toContain('class="sm-status-tab active"');
  });
});

describe("statusColorOf", () => {
  it("六种已知状态均有颜色映射", () => {
    for (const s of ["synced", "legacy", "missing", "diverged", "disabled", "optional"]) {
      expect(STATUS_COLOR[s]).toMatch(/^var\(/);
    }
  });

  it("未知状态与 disabled 同为 muted 回退", () => {
    expect(statusColorOf("unknown")).toBe("var(--muted)");
    expect(statusColorOf("disabled")).toBe("var(--muted)");
  });
});

describe("actionBtnHTML", () => {
  it("missing/diverged 渲染 push 按钮（data-testid=sm-push）", () => {
    for (const s of ["missing", "diverged"]) {
      const html = actionBtnHTML(s);
      expect(html).toContain('data-testid="sm-push"');
      expect(html).toContain('data-action="push"');
      expect(html).toMatch(/>[^<]+<\/button>$/);
    }
  });

  it("optional 渲染 pull 按钮（data-testid=sm-pull）", () => {
    const html = actionBtnHTML("optional");
    expect(html).toContain('data-testid="sm-pull"');
    expect(html).toContain('data-action="pull"');
  });

  it("legacy 渲染 pullHere 按钮（无 testid，弱化样式，字号回落类默认）", () => {
    const html = actionBtnHTML("legacy");
    expect(html).not.toContain("data-testid");
    expect(html).toContain('data-action="pull"');
    expect(html).toMatch(/>[^<]+<\/button>$/);
    expect(html).not.toContain("font-size:"); // 无内联字号覆盖，回落 .sm-item-btn 类默认 --fs-btn-secondary
  });

  it("其余状态无按钮", () => {
    expect(actionBtnHTML("synced")).toBe("");
    expect(actionBtnHTML("disabled")).toBe("");
    expect(actionBtnHTML("unknown")).toBe("");
  });
});
