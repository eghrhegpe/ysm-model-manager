// @vitest-environment happy-dom
// ===== isDebugEnabled 运行时求值测试 =====
// 验证：默认开启 / ?nodebug=1 关闭 / _debug=0 关闭 / 路由切换即时生效。
// 与 debug.test.ts（node 环境）互补——本文件用 happy-dom 让 window 可用。
import { describe, it, expect, beforeEach } from "vitest";
import { isDebugEnabled } from "./debug.ts";

beforeEach(() => {
  // 清理 URL 参数和 localStorage，确保测试隔离
  window.location.search = "";
  localStorage.clear();
});

describe("isDebugEnabled 运行时求值", () => {
  it("默认开启（window 存在、无 nodebug、无 _debug=0）", () => {
    expect(isDebugEnabled()).toBe(true);
  });

  it("URL 含 ?nodebug=1 → 关闭", () => {
    window.location.search = "?nodebug=1";
    expect(isDebugEnabled()).toBe(false);
  });

  it("localStorage _debug=0 → 关闭", () => {
    localStorage.setItem("_debug", "0");
    expect(isDebugEnabled()).toBe(false);
  });

  it("路由切换后即时生效（非模块加载期一次性求值）", () => {
    // 默认开启
    expect(isDebugEnabled()).toBe(true);
    // 模拟路由切换：添加 ?nodebug=1
    window.location.search = "?nodebug=1";
    // 立即生效（无需刷新模块）
    expect(isDebugEnabled()).toBe(false);
    // 移除参数后恢复
    window.location.search = "";
    expect(isDebugEnabled()).toBe(true);
  });

  it("localStorage _debug 非 0 值 → 开启", () => {
    localStorage.setItem("_debug", "1");
    expect(isDebugEnabled()).toBe(true);
  });
});
