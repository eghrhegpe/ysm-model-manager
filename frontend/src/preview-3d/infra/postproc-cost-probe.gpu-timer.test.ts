// @vitest-environment node
// ===== postproc-cost-probe GPU query 生命周期测试（锐评 infra 轮 2026-10-10）=====
//
// 病（本轮发现）：createGpuTimer 的 `poll()` 只在 `QUERY_RESULT_AVAILABLE === true` 时
// `deleteQuery`，而探针收尾的 drain 轮询有 `DRAIN_MAX_FRAMES` 上限。窗口内始终未就绪的
// query（后台标签页 rAF 节流 / 驱动延迟）**既不产出数字、也不被删除**——`inflight` 是闭包
// 局部数组随本次探针被 GC，但它指向的 WebGL query 对象留在 GL 侧成孤儿。探针按设计会被
// 反复跑 ⇒ 逐次累积（每轮最多 MAX_INFLIGHT_QUERIES=8 个）。
//
// 契约（本文件锁死）：**创建数 == 删除数**（每次 begin 成功都必有对应 deleteQuery），
// 无论 query 是否就绪、无论探针是否抛错。
import { describe, expect, it, vi } from "vitest";
import { createGpuTimer } from "./postproc-cost-probe.ts";

/** 假 WebGL2 上下文：只实现计时器用到的 5 个入口，记录创建/删除配对 */
function fakeGl(opts: { everReady?: boolean; disjoint?: boolean } = {}) {
  const created: object[] = [];
  const deleted: object[] = [];
  let nextQuery = 1;
  const gl = {
    createQuery: vi.fn(() => {
      const q = { id: nextQuery++ };
      created.push(q);
      return q;
    }),
    deleteQuery: vi.fn((q: object) => {
      deleted.push(q);
    }),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    getParameter: vi.fn(() => opts.disjoint === true),
    getQueryParameter: vi.fn((_q: object, p: number) => {
      // QUERY_RESULT_AVAILABLE：everReady=false 时恒不就绪（模拟被节流/驱动延迟）
      if (p === 0x8867) return opts.everReady === true;
      return 12_000_000; // QUERY_RESULT：12ms（纳秒）
    }),
    QUERY_RESULT_AVAILABLE: 0x8867,
    QUERY_RESULT: 0x8866,
  };
  return { gl: gl as unknown as WebGL2RenderingContext, created, deleted, raw: gl };
}

const EXT = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };

/** 注入扩展：真实环境靠 getExtension；测试里直接给 gl.getExtension 打桩 */
function withExt(base: ReturnType<typeof fakeGl>) {
  (base.raw as unknown as { getExtension: (n: string) => unknown }).getExtension = () => EXT;
  return base;
}

describe("createGpuTimer — query 创建/删除配对（资源不变量）", () => {
  it("扩展缺席 → available=false，且不创建任何 query", () => {
    const base = fakeGl();
    (base.raw as unknown as { getExtension: () => null }).getExtension = () => null;
    const t = createGpuTimer(base.gl);
    expect(t.available).toBe(false);
    t.begin();
    t.end("composer", true);
    expect(t.poll()).toEqual([]);
    t.dispose();
    expect(base.created.length, "降级路不得创建 query").toBe(0);
  });

  it("正常路径：就绪的 query 被 poll 回收并删除", () => {
    const base = withExt(fakeGl({ everReady: true }));
    const t = createGpuTimer(base.gl);
    t.begin();
    t.end("composer", true);
    const out = t.poll();
    expect(out).toHaveLength(1);
    expect(out[0]!.arm).toBe("composer");
    expect(out[0]!.ms).toBeCloseTo(12, 5);
    t.dispose();
    expect(base.deleted.length, "创建数 == 删除数").toBe(base.created.length);
  });

  it("**永不就绪**的 query：dispose 必须兜底删除（原实现漏此路 ⇒ GL 侧孤儿）", () => {
    const base = withExt(fakeGl({ everReady: false }));
    const t = createGpuTimer(base.gl);
    // 连续 3 帧都没结算（模拟后台节流：rAF 在跑但 GPU 结果迟迟不回）
    for (let i = 0; i < 3; i++) {
      t.begin();
      t.end(i % 2 === 0 ? "composer" : "direct", true);
    }
    expect(t.pending(), "3 个 query 都在飞").toBe(3);
    expect(t.poll(), "未就绪 ⇒ 不产出数字（不伪造）").toEqual([]);

    t.dispose();

    expect(t.pending(), "dispose 后不得残留").toBe(0);
    expect(base.deleted.length, "创建数 == 删除数（未就绪者亦须删除）").toBe(base.created.length);
  });

  it("未 end 的 active query：dispose 也须删除（防中途抛错留下的半个）", () => {
    const base = withExt(fakeGl({ everReady: true }));
    const t = createGpuTimer(base.gl);
    t.begin(); // 只 begin，不 end（模拟渲染段抛错打断）
    expect(base.created.length).toBe(1);

    t.dispose();

    expect(base.deleted.length, "active 亦须删除").toBe(base.created.length);
    expect(t.pending()).toBe(0);
  });

  it("in-flight 上限：超出后不新建 query（上限本身即防堆积，但已建者仍须回收）", () => {
    const base = withExt(fakeGl({ everReady: false }));
    const t = createGpuTimer(base.gl);
    for (let i = 0; i < 20; i++) {
      t.begin();
      t.end("composer", true);
    }
    expect(t.pending(), "上限 8").toBe(8);
    expect(base.created.length, "超出上限不再创建").toBe(8);

    t.dispose();
    expect(base.deleted.length, "8 个全删").toBe(8);
  });

  it("GPU 中断（disjoint）批量丢弃路径：丢弃时也删除（不产出假数字）", () => {
    const base = withExt(fakeGl({ everReady: true, disjoint: true }));
    const t = createGpuTimer(base.gl);
    t.begin();
    t.end("composer", true);
    expect(t.poll(), "中断期结果不可信 ⇒ 整批丢弃").toEqual([]);
    t.dispose();
    expect(base.deleted.length, "丢弃 ≠ 不删").toBe(base.created.length);
  });
});
