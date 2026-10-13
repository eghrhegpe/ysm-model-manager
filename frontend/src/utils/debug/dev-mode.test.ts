// @vitest-environment happy-dom
// ===== isDevMode 契约测试 =====
// 锁三件事：① 默认关（与 isDebugEnabled 默认开相反——拿错开关等于门没关）；
// ② `?dev` / `?dev=1` / `_devtools=1` 三个入口各自生效；③ 运行时求值（改 URL 立即生效）。
import { describe, it, expect, beforeEach } from "vitest";
import { isDevMode } from "./dev-mode.ts";

beforeEach(() => {
  window.location.search = "";
  localStorage.clear();
});

describe("isDevMode", () => {
  it("默认关闭（无 ?dev、无 _devtools）——昂贵调试动作不得在生产默认执行", () => {
    expect(isDevMode()).toBe(false);
  });

  it("?dev=1 → 开启", () => {
    window.location.search = "?dev=1";
    expect(isDevMode()).toBe(true);
  });

  it("?dev（无值参数）→ 开启——与 app-modules 原判定 has('dev') 口径一致", () => {
    window.location.search = "?dev";
    expect(isDevMode()).toBe(true);
  });

  it("localStorage _devtools=1 → 开启（隐私模式外持久生效）", () => {
    localStorage.setItem("_devtools", "1");
    expect(isDevMode()).toBe(true);
  });

  it("_devtools 值非 '1' → 不开启（严格等值，防 '0'/'true' 误开）", () => {
    localStorage.setItem("_devtools", "0");
    expect(isDevMode()).toBe(false);
  });

  it("运行时求值：切 URL 即时生效（非模块加载期常量）", () => {
    expect(isDevMode()).toBe(false);
    window.location.search = "?dev=1";
    expect(isDevMode()).toBe(true);
    window.location.search = "";
    expect(isDevMode()).toBe(false);
  });

  it("与 isDebugEnabled 语义相反：后者默认 true，本判据默认 false", async () => {
    const { isDebugEnabled } = await import("./debug.ts");
    expect(isDebugEnabled()).toBe(true);
    expect(isDevMode()).toBe(false);
  });
});
