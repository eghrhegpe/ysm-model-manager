// ===== batchAllSettled 纯函数测试（2026-10-13 收口 app-tree 五处 BATCH=8 手抄）=====
// 收口动机：BATCH=8 + Promise.allSettled + ok/fail 统计在 app-tree 内五处逐字复制
// （events.toggleFolderBatch / bus-handlers.runBatchRename·dirRecycle·runBatchToggle /
// index._deleteSelected），失败归因（下标配对 / 原因收集）各写一份、漂移风险随拷贝数
// 增长——pitfalls #25「判据手抄复发」的并发版。本工具收口「分批并发 + 逐项不短路 +
// 失败下标归因」单一实现，调用方只留业务差异（任务构造 / 结果收集）。
import { describe, expect, it, vi } from "vitest";
import { batchAllSettled } from "./batch-all-settled.ts";

describe("batchAllSettled — 分批并发", () => {
  it(" batchSize=8 时每批 ≤8 个并发在途（批间串行，批内并发）", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return i;
    });
    const r = await batchAllSettled(tasks, 8);
    expect(peak).toBeLessThanOrEqual(8);
    expect(r.fulfilled).toHaveLength(20);
  });

  it("任务数小于批大小 → 单批全并发，结果按原顺序", async () => {
    const r = await batchAllSettled(
      [async () => "a", async () => "b", async () => "c"],
      8,
    );
    expect(r.fulfilled.map((f) => f.value)).toEqual(["a", "b", "c"]);
  });

  it("空任务列表 → 零批次直接返回空结果", async () => {
    const r = await batchAllSettled([], 8);
    expect(r.fulfilled).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });

  it("批间严格串行：上一批全部落定才开下一批（防 IPC 洪峰）", async () => {
    const order: string[] = [];
    const tasks = Array.from({ length: 9 }, (_, i) => async () => {
      order.push(`start-${i}`);
      await Promise.resolve();
      order.push(`end-${i}`);
      return i;
    });
    await batchAllSettled(tasks, 8);
    // 第 9 个任务（index 8，第二批首项）必须在第一批全部 end 之后才 start
    const lastEnd0 = order.lastIndexOf("end-7");
    const start8 = order.indexOf("start-8");
    expect(start8).toBeGreaterThan(lastEnd0);
  });
});

describe("batchAllSettled — 逐项不短路 + 失败归因", () => {
  it("部分失败 → fulfilled/rejected 分桶，rejected 带原任务下标与原因", async () => {
    const tasks = [
      async () => 1,
      async () => {
        throw new Error("boom-1");
      },
      async () => 3,
      async () => {
        throw new Error("boom-3");
      },
    ];
    const r = await batchAllSettled(tasks, 2);
    expect(r.fulfilled.map((f) => f.value)).toEqual([1, 3]);
    expect(r.rejected.map((x) => x.index)).toEqual([1, 3]);
    expect(r.rejected.map((x) => String(x.reason))).toContain("Error: boom-1");
  });

  it("全部失败 → 全部入 rejected，下标覆盖 0..n-1", async () => {
    const tasks = [0, 1, 2].map((i) => async () => {
      throw new Error(`fail-${i}`);
    });
    const r = await batchAllSettled(tasks, 8);
    expect(r.fulfilled).toHaveLength(0);
    expect(r.rejected.map((x) => x.index)).toEqual([0, 1, 2]);
  });

  it("下标是原任务列表下标，非批内下标（跨批归因不漂移）", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) =>
      i === 9
        ? async () => {
            throw new Error("tail-fail");
          }
        : async () => i,
    );
    const r = await batchAllSettled(tasks, 8);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].index).toBe(9);
  });
});

describe("batchAllSettled — 缺省与防误用", () => {
  it("batchSize 缺省 8（与 app-tree 五处原值一致）", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 17 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
    });
    await batchAllSettled(tasks);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it("batchSize 非法（≤0）→ 回落 8（防调用方误传 0 死循环）", async () => {
    const fn = vi.fn(async () => 1);
    const r = await batchAllSettled([fn], 0);
    expect(r.fulfilled).toHaveLength(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("结果顺序与任务顺序一致（并发完成序不影响归因）", async () => {
    // 反转完成顺序：index 0 最慢、index 2 最快
    const tasks = [
      async () => {
        await new Promise((r) => setTimeout(r, 20));
        return "slow";
      },
      async () => "mid",
      async () => "fast",
    ];
    const r = await batchAllSettled(tasks, 8);
    expect(r.fulfilled.map((f) => f.value)).toEqual(["slow", "mid", "fast"]);
  });
});
