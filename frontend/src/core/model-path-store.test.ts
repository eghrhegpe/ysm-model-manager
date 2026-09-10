import { afterEach, describe, expect, it } from "vitest";
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

  it("再次写入覆盖旧值", () => {
    rememberModelPath("/m/a.pmx");
    rememberModelPath("/m/b.vrm");
    expect(getLastModelPath()).toBe("/m/b.vrm");
  });

  it("__resetLastModelPathForTest 复位（用例隔离兜底）", () => {
    rememberModelPath("/m/a.pmx");
    __resetLastModelPathForTest();
    expect(getLastModelPath()).toBeNull();
  });
});
