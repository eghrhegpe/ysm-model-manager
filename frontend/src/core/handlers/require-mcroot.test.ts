// @vitest-environment node
// ===== requireMcRoot 测试：读配置 + 空守卫 + toast =====
// 覆盖：已配置 mcRoot 返回路径；未配置发 warn toast 并返回 null
// backend/app mock 走 test-setup §5 全局 fail-closed Proxy（mockAppMethods 配置）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import { mockAppMethods } from "../../test-utils/mock-app.ts";

// app mock：共享工厂 + 别名路径（归一写法，详见 test-utils/mock-app.ts 头注）
vi.mock("@/backend/app.ts", async () => {
  const { setupAppMock } = await import("@/test-utils/mock-app.ts");
  return setupAppMock();
});

let cleanups: Array<() => void> = [];

beforeEach(() => {
  cleanups = [];
  vi.clearAllMocks();
});

afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

function spyToasts() {
  const toasts: Array<{ msg: string; type: string; duration?: number }> = [];
  cleanups.push(bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })));
  return toasts;
}

describe("requireMcRoot", () => {
  it("已配置 mcRoot → 返回路径，不发 toast", async () => {
    mockAppMethods({ LoadAppConfig: { mcRoot: "/mc" } });
    const toasts = spyToasts();

    const { requireMcRoot } = await import("./require-mcroot.ts");
    const r = await requireMcRoot();

    expect(r).toBe("/mc");
    expect(toasts.length).toBe(0);
  });

  it("mcRoot 为空 → warn toast「请先配置游戏目录」+ 返回 null", async () => {
    mockAppMethods({ LoadAppConfig: { mcRoot: "" } });
    const toasts = spyToasts();

    const { requireMcRoot } = await import("./require-mcroot.ts");
    const r = await requireMcRoot();

    expect(r).toBeNull();
    expect(toasts).toContainEqual(
      expect.objectContaining({ msg: "请先配置游戏目录", type: "warn", duration: 3000 }),
    );
  });
});
