// ===== tpl.ts 状态元数据表驱动测试（statusIcon/statusColor/actionBtn 单一事实源）=====
import { describe, expect, it } from "vitest";
import {
  STATUS_ICON,
  STATUS_COLOR,
  statusIconOf,
  statusColorOf,
  statusTabHTML,
  actionBtnHTML,
  containerHTML,
  itemHTML,
  loadingHTML,
  syncDirRowHTML,
  type SyncItem,
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

// ── a11y 模板标记（2026 复测补缺）─────────────────────────────────────────
// 语义属性统一由模板层产出（模板生成原则）：渲染层/事件层不再逐元素手写 aria。
// 对照仓内先例：tabs-shell.ts renderSubBar（diag 子切换 radio 行）同款「模板出属性」。
describe("a11y 模板标记", () => {
  it("statusTabHTML: role=radio + aria-checked + roving tabindex（激活 0，其余 -1）", () => {
    expect(statusTabHTML("all", "全部", 3, true)).toContain(
      'role="radio" aria-checked="true" tabindex="0"',
    );
    expect(statusTabHTML("synced", "已同步", 0, false)).toContain(
      'role="radio" aria-checked="false" tabindex="-1"',
    );
  });

  it("containerHTML: 筛选栏 = cur-type 槽位 + radiogroup（aria-label 走 i18n）", () => {
    const html = containerHTML();
    expect(html).toContain('class="sm-cur-type-slot"');
    expect(html).toContain('class="sm-status-radios"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/class="sm-status-radios"[^>]*aria-label="[^"]+"/);
  });

  it("syncDirRowHTML: 箭头为原生 button（aria-expanded + 名称标签），目录图标装饰 aria-hidden", () => {
    const item: SyncItem = {
      path: "/d",
      name: "Models",
      status: "synced",
      type: "ysm",
      size: 0,
      isDir: true,
      children: [],
    };
    const open = syncDirRowHTML("d", item, true, 0, "/d");
    expect(open).toContain('<button class="sm-dir-arrow" aria-expanded="true" aria-label="Models"');
    expect(open).toContain('aria-hidden="true"');
    expect(syncDirRowHTML("d", item, false, 0, "/d")).toContain('aria-expanded="false"');
  });

  it("itemHTML: 状态图标与文件图标均装饰（2 处 aria-hidden）", () => {
    const item: SyncItem = {
      path: "/f.pmx",
      name: "f.pmx",
      status: "missing",
      type: "ysm",
      icon: "💎",
      size: 10,
      isDir: false,
    };
    const html = itemHTML(item, 0);
    expect(html.match(/aria-hidden="true"/g)?.length).toBe(2);
  });

  it("loadingHTML: role=status（屏幕阅读器自动播报加载态）", () => {
    expect(loadingHTML()).toContain('role="status"');
  });
});
