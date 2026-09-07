// @vitest-environment node
// ===== 平台环境判定测试（ADR-049 Phase 1：Tier 分层路由）=====
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveWebMode, readDeclaredBackend, registerAndroidBackHandler, emitAndroidBack } from "./platform.ts";

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

describe("Android 返回键栈（ADR-203 D2 自 utils/dom/android-bridge 并入）", () => {
  // code_review 6efe049e9 #1/#4（P2/P3）：android-bridge.test.ts 随迁移删除后返回
  // 键栈无直测——平移原四类用例（空栈 false / 栈顶优先 true 短路 / 全触发 false /
  // unregister 注销）恢复回归覆盖。模块级 _androidBackHandlers 无清空出口，
  // afterEach 统一注销本 describe 注册的处理器防跨测试泄漏。
  const unregs: Array<() => void> = [];
  afterEach(() => {
    for (const u of unregs.splice(0)) u();
  });

  it("空栈 emitAndroidBack 返回 false", () => {
    expect(emitAndroidBack()).toBe(false);
  });

  it("栈顶优先：true 短路，下层未触发", () => {
    const calls: string[] = [];
    unregs.push(registerAndroidBackHandler(() => { calls.push("bottom"); return false; }));
    unregs.push(registerAndroidBackHandler(() => { calls.push("top"); return true; }));
    expect(emitAndroidBack()).toBe(true);
    expect(calls).toEqual(["top"]); // 短路：bottom 未触发
  });

  it("全部未消费时按栈顶优先序全触发并返回 false", () => {
    const calls: string[] = [];
    unregs.push(registerAndroidBackHandler(() => { calls.push("a"); return false; }));
    unregs.push(registerAndroidBackHandler(() => { calls.push("b"); return undefined; }));
    expect(emitAndroidBack()).toBe(false);
    expect(calls).toEqual(["b", "a"]); // 后注册先询问
  });

  it("unregister 后不再触发", () => {
    const calls: string[] = [];
    const unreg = registerAndroidBackHandler(() => { calls.push("x"); return true; });
    unreg();
    expect(emitAndroidBack()).toBe(false);
    expect(calls).toEqual([]);
  });
});
