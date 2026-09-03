// @vitest-environment node
// ===== 感知层：全局暂停标志 测试（core.ts，#9）=====
import { beforeEach, describe, expect, it } from "vitest";
import { isPerceptionPaused, setPerceptionPaused } from "./core.ts";

describe("感知层全局暂停标志", () => {
  beforeEach(() => setPerceptionPaused(false));

  it("默认未暂停", () => {
    expect(isPerceptionPaused()).toBe(false);
  });

  it("setPerceptionPaused(true) 后暂停", () => {
    setPerceptionPaused(true);
    expect(isPerceptionPaused()).toBe(true);
  });

  it("可复位为未暂停", () => {
    setPerceptionPaused(true);
    setPerceptionPaused(false);
    expect(isPerceptionPaused()).toBe(false);
  });
});
