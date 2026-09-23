// ===== 工具栏命令注册表契约测试（ADR-298 D1/D2）=====
// 锁两件事：
//   ① 声明表 ⊥ 行为表双向一致——toolbar-menus 声明的每个 action 都有命令实现，
//      命令表每个键都被某条菜单项声明（漏挂 / 悬空即红；类型层已拦，此处再锁运行期事实）；
//   ② 命令表成员均为函数（防误写成数据表）。
import { describe, expect, it } from "vitest";
import { TOOLBAR_COMMANDS } from "./toolbar-commands.ts";
import { renderDropdown } from "./toolbar-menus.ts";

/** 从 renderDropdown 渲染产物抽取 data-batch / data-more 的 action 取值 */
function declaredActions(): string[] {
  const out: string[] = [];
  for (const key of ["batch", "more"] as const) {
    const html = renderDropdown(key);
    for (const m of html.matchAll(new RegExp(`data-${key}="([^"]+)"`, "g"))) {
      out.push(m[1]!);
    }
  }
  return out;
}

describe("ADR-298 D1 — 命令表 ⊥ 声明表双向一致", () => {
  it("声明侧每个 action 都有命令实现（漏挂即红）", () => {
    const declared = declaredActions();
    expect(declared.length).toBeGreaterThan(0); // 防渲染产物形态变化导致静默空跑
    const implemented = Object.keys(TOOLBAR_COMMANDS);
    expect(declared.filter((a) => !implemented.includes(a))).toEqual([]);
  });

  it("命令表无悬空键（每个命令都被某条菜单项声明）", () => {
    const declared = declaredActions();
    const implemented = Object.keys(TOOLBAR_COMMANDS);
    expect(implemented.filter((a) => !declared.includes(a))).toEqual([]);
  });

  it("命令表成员均为函数（防误写成数据表）", () => {
    const entries = Object.entries(TOOLBAR_COMMANDS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, fn] of entries) expect(typeof fn).toBe("function");
  });
});
