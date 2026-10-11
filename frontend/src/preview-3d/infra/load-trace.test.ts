// @vitest-environment node
// ===== 加载剖析 store 契约（infra 轮点名：环形上限 + 浅拷贝快照语义无独立断言）=====
// recordLoadTrace / getLoadTraces / clearLoadTraces 是各 adapter 诊断面板共用的全局
// store：环形上限 50 与「返回值是快照而非内部数组引用」是真实契约（消费方 perf-trace
// 只读 .length / 索引 / forEach），此前仅靠模块注释自陈，无直测。
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordLoadTrace,
  getLoadTraces,
  clearLoadTraces,
  type LoadTrace,
} from "./load-trace.ts";

function trace(path: string, ts: number): LoadTrace {
  return { ts, format: "ysm", path, stages: [{ name: "s", ms: 1 }], ok: true };
}

beforeEach(() => clearLoadTraces());

describe("load-trace store 契约", () => {
  it("环形上限 50：超出只保留最近 50 条（最旧被挤掉、顺序保持）", () => {
    for (let i = 0; i < 55; i++) recordLoadTrace(trace(`/m${i}.ysm`, i));
    const all = getLoadTraces();
    expect(all).toHaveLength(50);
    expect(all[0]?.path).toBe("/m5.ysm"); // 0..4 被挤掉
    expect(all[49]?.path).toBe("/m54.ysm"); // 最新在末尾
  });

  it("返回数组级快照：调用方 push/splice 不影响内部 store", () => {
    recordLoadTrace(trace("/a.ysm", 1));
    const snap = getLoadTraces();
    snap.push(trace("/fake.ysm", 2));
    snap.splice(0, 1);
    const again = getLoadTraces();
    expect(again).toHaveLength(1);
    expect(again[0]?.path).toBe("/a.ysm");
  });

  it("clearLoadTraces 清空后再录不受影响", () => {
    recordLoadTrace(trace("/a.ysm", 1));
    clearLoadTraces();
    expect(getLoadTraces()).toEqual([]);
    recordLoadTrace(trace("/b.ysm", 2));
    expect(getLoadTraces().map((t) => t.path)).toEqual(["/b.ysm"]);
  });
});
