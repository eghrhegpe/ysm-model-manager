// @vitest-environment happy-dom
// ===== isDebugEnabled 运行时求值测试 =====
// 验证：默认开启 / ?nodebug=1 关闭 / _debug=0 关闭 / 路由切换即时生效。
// 与 debug.test.ts（node 环境）互补——本文件用 happy-dom 让 window 可用。
import { describe, it, expect, beforeEach } from "vitest";
import { dbg, isDebugEnabled } from "./debug.ts";

beforeEach(() => {
  // 清理 URL 参数和 localStorage，确保测试隔离
  window.location.search = "";
  localStorage.clear();
  // 清理环形缓冲
  window._DBG_RING = [];
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

describe("dbg() 环形缓冲写入", () => {
  it("?nodebug=1 关闭：dbg 不写 ring", () => {
    window.location.search = "?nodebug=1";
    dbg("test", "hello");
    expect(window._DBG_RING.length).toBe(0);
  });

  it("localStorage _debug=0 关闭：dbg 不写 ring", () => {
    localStorage.setItem("_debug", "0");
    dbg("test", "hello");
    expect(window._DBG_RING.length).toBe(0);
  });

  it("正常路径：dbg 写入 ring", () => {
    dbg("my-tag", "value", 42);
    expect(window._DBG_RING.length).toBe(1);
    expect(window._DBG_RING[0].tag).toBe("my-tag");
    expect(window._DBG_RING[0].args).toEqual(["value", "42"]);
  });

  it("超过 200 条时截断（保留最新 200 条）", () => {
    // 写入 210 条
    for (let i = 0; i < 210; i++) {
      dbg("bulk", `item-${i}`);
    }
    expect(window._DBG_RING.length).toBe(200);
    // 保留最新的 200 条（最旧的前 10 条被截断）
    expect(window._DBG_RING[0].args[0]).toBe("item-10");
    expect(window._DBG_RING[199].args[0]).toBe("item-209");
  });
});
