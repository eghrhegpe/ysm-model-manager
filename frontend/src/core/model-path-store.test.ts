import { afterEach, describe, expect, it } from "vitest";
import { stubConsoleWarn } from "@/test-utils/mock-log.ts";
import {
  __resetLastModelPathForTest,
  getLastModelPath,
  rememberModelPath,
} from "./model-path-store.ts";

describe("model-path-store — 跨视图最近选中模型路径 (ADR-221)", () => {
  afterEach(__resetLastModelPathForTest);

  it("初始态为 null", () => {
    expect(getLastModelPath()).toBeNull();
  });

  it("rememberModelPath 写入后 getLastModelPath 可读回", () => {
    rememberModelPath("/m/狐.ysm");
    expect(getLastModelPath()).toBe("/m/狐.ysm");
  });

  it("rememberModelPath(null) 清空（取消选中）", () => {
    rememberModelPath("/m/狐.ysm");
    rememberModelPath(null);
    expect(getLastModelPath()).toBeNull();
  });

  it("空串拒绝写入：已有值时保持原值 + 告警留痕（清空应传 null）", () => {
    const warn = stubConsoleWarn();
    try {
      rememberModelPath("/m/a.ysm");
      rememberModelPath("");
      // 空串被拒 → 保持原值；且产生告警留痕
      expect(getLastModelPath()).toBe("/m/a.ysm");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("空串拒绝写入：初始态（null）写入空串 → 仍为 null", () => {
    const warn = stubConsoleWarn();
    try {
      rememberModelPath("");
      expect(getLastModelPath()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("再次写入覆盖旧值", () => {
    rememberModelPath("/m/a.pmx");
    rememberModelPath("/m/b.vrm");
    expect(getLastModelPath()).toBe("/m/b.vrm");
  });
});
