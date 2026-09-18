// ===== 两族状态行外壳单点（status-row.ts）测试 — 诊断页重复实现审计 C13 =====
// 目的：把「两族外壳逐字复刻现状」钉成断言。两族的 class 名、图标连接（图标 + 一个空格）、
// 转义位置一旦被改动，这里先红——这些是既有消费方的锚点：
//  · conflicts.test.ts:284,452 断言 innerHTML 含 `diag-msg-error`
//  · perf.test.ts:238,306,459,582,605 断言 `.diag-stat-error` 可被 querySelector 命中
//    （该 class 同为本模块 statRowHTML("error", …) 的产物；perf 面板的 errorHTML 因 class
//      列表不含 stat-row 未并入本模块，见 status-row.ts 的说明）
import { describe, expect, it, vi } from "vitest";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { msgRowHTML, statRowHTML } from "./status-row.ts";

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

describe("msgRowHTML（diag-msg 族：padding12 + fs-sm，左对齐）", () => {
  it("无图标：只包外壳 —— 逐字复刻 conflicts.ts / dedup-render.ts 的占位行", () => {
    expect(msgRowHTML("muted", "未找到整合包")).toBe(
      '<div class="stat-row diag-msg diag-msg-muted">未找到整合包</div>',
    );
    expect(msgRowHTML("error", "请先在设置中配置游戏目录")).toBe(
      '<div class="stat-row diag-msg diag-msg-error">请先在设置中配置游戏目录</div>',
    );
  });

  it("有图标：`图标 + 一个空格 + 文案`（该连接只此一处）", () => {
    expect(msgRowHTML("success", "未发现同名冲突", undefined, { icon: UI_ICONS.success })).toBe(
      `<div class="stat-row diag-msg diag-msg-success">${UI_ICONS.success} 未发现同名冲突</div>`,
    );
    expect(msgRowHTML("error", "已发现冲突", undefined, { icon: UI_ICONS.warning })).toBe(
      `<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.warning} 已发现冲突</div>`,
    );
  });

  it("同一 kind 图标由调用点给（error 行既有 error 图标也有 warning 图标）", () => {
    const withErrorIcon = msgRowHTML("error", "M", undefined, { icon: UI_ICONS.error });
    const withWarnIcon = msgRowHTML("error", "M", undefined, { icon: UI_ICONS.warning });
    expect(withErrorIcon).toBe(`<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.error} M</div>`);
    expect(withWarnIcon).toBe(`<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.warning} M</div>`);
    expect(withErrorIcon).not.toBe(withWarnIcon);
  });

  it("warn 变体可用（dedup 执行结果：fail>0 → diag-msg-warn）", () => {
    expect(msgRowHTML("warn", "完成：删 1 失败 2", undefined, { icon: UI_ICONS.success })).toBe(
      `<div class="stat-row diag-msg diag-msg-warn">${UI_ICONS.success} 完成：删 1 失败 2</div>`,
    );
  });

  it("esc 给了才转义；不给则按可信 HTML 直插（现状口径，非本模块新增行为）", () => {
    const spy = vi.fn(esc);
    expect(msgRowHTML("error", "<b>失败</b>", spy, { icon: UI_ICONS.error })).toBe(
      `<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.error} &lt;b&gt;失败&lt;/b&gt;</div>`,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("<b>失败</b>");

    const untouched = vi.fn(esc);
    expect(msgRowHTML("error", "<b>x</b>", undefined, { icon: UI_ICONS.error })).toBe(
      `<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.error} <b>x</b></div>`,
    );
    expect(untouched).not.toHaveBeenCalled();
  });

  it("产物无换行（换行只在源码里，不在 HTML 里）", () => {
    const html = msgRowHTML("error", "x", undefined, { icon: UI_ICONS.error });
    expect(html).not.toContain("\n");
    expect(html).toBe(`<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.error} x</div>`);
  });

  it("conflicts.test.ts:284,452 的锚点：注入后 .diag-msg-error 命中且文案可见", () => {
    const box = document.createElement("div");
    box.innerHTML = msgRowHTML("error", "扫描失败: 同步服务未启动");
    expect(box.innerHTML).toContain("diag-msg-error");
    expect(box.querySelector(".diag-msg-error")).toBeTruthy();
    expect(box.textContent).toContain("同步服务未启动");
  });
});

describe("statRowHTML（diag-stat 族：padding12 + fs-base，居中）", () => {
  it("无图标：逐字复刻 logs.ts / dedup-scan.ts / dedup.ts 的占位行", () => {
    expect(statRowHTML("muted", "正在读取操作日志…")).toBe(
      '<div class="stat-row diag-stat diag-stat-muted">正在读取操作日志…</div>',
    );
    expect(statRowHTML("error", "读取失败")).toBe(
      '<div class="stat-row diag-stat diag-stat-error">读取失败</div>',
    );
  });

  it("有图标：`图标 + 一个空格 + 文案`", () => {
    expect(statRowHTML("muted", "体检扫描中", undefined, { icon: UI_ICONS.refresh })).toBe(
      `<div class="stat-row diag-stat diag-stat-muted">${UI_ICONS.refresh} 体检扫描中</div>`,
    );
    expect(statRowHTML("muted", "去重配置加载失败", undefined, { icon: UI_ICONS.error })).toBe(
      `<div class="stat-row diag-stat diag-stat-muted">${UI_ICONS.error} 去重配置加载失败</div>`,
    );
  });

  it("esc 给了才转义", () => {
    const spy = vi.fn(esc);
    expect(statRowHTML("muted", "<i>x</i>", spy, { icon: UI_ICONS.error })).toBe(
      `<div class="stat-row diag-stat diag-stat-muted">${UI_ICONS.error} &lt;i&gt;x&lt;/i&gt;</div>`,
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("产物无换行，且不带 stat-row 之外的额外类/属性（额外属性站点未并入）", () => {
    const html = statRowHTML("muted", "x", undefined, { icon: UI_ICONS.settings });
    expect(html).not.toContain("\n");
    expect(html).toBe(`<div class="stat-row diag-stat diag-stat-muted">${UI_ICONS.settings} x</div>`);
    expect(html.match(/class="([^"]*)"/)?.[1]).toBe("stat-row diag-stat diag-stat-muted");
  });

  it("perf.test.ts:238,306,459,582,605 的锚点：.diag-stat-error 可被命中，文案可见", () => {
    const box = document.createElement("div");
    box.innerHTML = statRowHTML("error", "退化超过 50%", esc, { icon: UI_ICONS.error });
    expect(box.querySelector(".diag-stat-error")).toBeTruthy();
    expect(box.querySelector(".diag-stat-error")?.textContent).toContain("退化超过 50%");
  });
});
