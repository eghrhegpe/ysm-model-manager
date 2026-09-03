// @vitest-environment node
// ===== 平台环境判定测试（ADR-049 Phase 1：Tier 分层路由）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveWebMode, readDeclaredBackend } from "./platform.ts";

const KEY = "__YSM_BACKEND__";
const WEB_KEY = "__YSM_WEB__";

beforeEach(() => {
  vi.stubGlobal(KEY, undefined);
  vi.stubGlobal(WEB_KEY, undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveWebMode — Tier 分层判定", () => {
  it("声明 browser → true（Tier 0 权威）", () => {
    vi.stubGlobal(KEY, "browser");
    expect(resolveWebMode()).toBe(true);
  });

  it("声明 go → false（Tier 0 权威，桌面构建显式声明也走 Wails）", () => {
    vi.stubGlobal(KEY, "go");
    expect(resolveWebMode()).toBe(false);
  });

  it("无声明 + __YSM_WEB__=true → true（Tier 1 旧标记）", () => {
    vi.stubGlobal(WEB_KEY, true);
    expect(resolveWebMode()).toBe(true);
  });

  it("无声明 + 无 web 标记 → false（桌面/Android 走 Wails 原逻辑）", () => {
    expect(resolveWebMode()).toBe(false);
  });

  it("非法声明值（如 'webb'）→ 视为未声明，回落 Tier 1", () => {
    vi.stubGlobal(KEY, "webb");
    expect(readDeclaredBackend()).toBeUndefined();
    expect(resolveWebMode()).toBe(false);
  });
});
