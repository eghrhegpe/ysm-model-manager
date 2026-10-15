// @vitest-environment node
// ===== 页脚进度槽单元测试（2026-10-15 P1-C）=====
// 该模块只与「带 getElementById 的 root」打交道，POJO 替身即可覆盖，无需 DOM 环境。
// 断言策略：业务体在被测门（deferred）处分阶段挂起，逐段读「用户此刻看到什么」——
// 比记录每次 setter 的写入序列更贴语义（写入顺序是实现细节，可见态才是契约）。
import { describe, expect, it } from "vitest";
import { setFooterProgress, withFooterProgress } from "./footer-progress.ts";

/** 进度槽替身：只暴露 hidden / textContent 两个被 setFooterProgress 触碰的字段 */
function probe(): { root: { getElementById: (id: string) => unknown }; el: { hidden: boolean; textContent: string } } {
  const el = { hidden: true, textContent: "" };
  return { root: { getElementById: (id: string) => (id === "ftr-progress" ? el : null) }, el };
}

/** 一次性放行门（测试控制业务体何时继续） */
function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((res) => {
    open = res;
  });
  return { promise, open };
}

const fmt = (done: number, total: number): string => `${done}/${total}`;

describe("setFooterProgress", () => {
  it("传文案 → 写文案并显示", () => {
    const p = probe();
    setFooterProgress(p.root as unknown as ShadowRoot, "⏳ 1/2");
    expect(p.el).toEqual({ hidden: false, textContent: "⏳ 1/2" });
  });

  it("传 null → 清文案并隐藏（不留「隐藏但旧文案」的半态）", () => {
    const p = probe();
    setFooterProgress(p.root as unknown as ShadowRoot, "⏳ 1/2");
    setFooterProgress(p.root as unknown as ShadowRoot, null);
    expect(p.el).toEqual({ hidden: true, textContent: "" });
  });

  it("缺槽 / root 为空 → 静默 no-op（布局未就绪或夹具未铺槽都不该抛）", () => {
    const noSlot = { getElementById: () => null };
    expect(() => setFooterProgress(noSlot as unknown as ShadowRoot, "x")).not.toThrow();
    expect(() => setFooterProgress(null, "x")).not.toThrow();
    expect(() => setFooterProgress(undefined, null)).not.toThrow();
  });
});

describe("withFooterProgress", () => {
  it("total>0 → 起始 0/N 可见 → 每批推进 → 结束清槽（四条出口必清）", async () => {
    const p = probe();
    const g = gate();
    const run = withFooterProgress(p.root as unknown as ShadowRoot, fmt, 20, async (onProgress) => {
      // 起始帧应已由 withFooterProgress 写好
      expect(p.el).toEqual({ hidden: false, textContent: "0/20" });
      onProgress(8, 20);
      await g.promise; // 停在「已推进一批、尚未结束」
      return "done";
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(p.el).toEqual({ hidden: false, textContent: "8/20" }); // 中途可见态
    g.open();
    expect(await run).toBe("done"); // 返回值原样透传
    expect(p.el).toEqual({ hidden: true, textContent: "" }); // 终态清槽
  });

  it("total=0 → 不写起始帧（无意义的 0/0 闪烁窗口），仍清槽", async () => {
    const p = probe();
    await withFooterProgress(
      p.root as unknown as ShadowRoot,
      fmt,
      0,
      async (onProgress) => {
        expect(p.el).toEqual({ hidden: true, textContent: "" }); // 业务体开跑时槽仍是空的
        onProgress(0, 0);
        // 空批次的 0/0 不得落槽（否则会覆盖并行批次的文案）——复核 P2-2 的守卫
        expect(p.el).toEqual({ hidden: true, textContent: "" });
        return 0;
      },
    );
    expect(p.el).toEqual({ hidden: true, textContent: "" });
  });

  it("业务抛错 → 仍清槽，且错误原样冒泡（不吞）", async () => {
    const p = probe();
    await expect(
      withFooterProgress(p.root as unknown as ShadowRoot, fmt, 5, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(p.el).toEqual({ hidden: true, textContent: "" });
  });

  it("root 无该槽 → 全程不抛、业务照常执行（未挂载/夹具无槽的生产形态）", async () => {
    const noSlot = { getElementById: () => null };
    const r = await withFooterProgress(noSlot as unknown as ShadowRoot, fmt, 3, async (onProgress) => {
      onProgress(3, 3);
      return 42;
    });
    expect(r).toBe(42);
  });

  // 计数泄漏回归锁：起始帧的 format() 若在 try 之外抛错，finally 的计数递减会被跳过 →
  // activeBatches 永久 >0 → 进度槽此后永不清（本用例第二次调用即能验出来）。
  it("起始 format 抛错 → 计数不泄漏（后续批次仍能显示并清槽）", async () => {
    const p = probe();
    await expect(
      withFooterProgress(
        p.root as unknown as ShadowRoot,
        () => {
          throw new Error("bad format");
        },
        3,
        async () => "x",
      ),
    ).rejects.toThrow("bad format");

    const r = await withFooterProgress(p.root as unknown as ShadowRoot, fmt, 2, async (op) => {
      op(2, 2);
      return "ok";
    });
    expect(r).toBe("ok");
    expect(p.el).toEqual({ hidden: true, textContent: "" }); // 计数已归零，清槽照常
  });

  // 单槽多写者：删除与启停是两把独立锁（ADR-341），可并发跑两个长批量。先结束的那个  // 若直接清槽，仍在跑的那个进度会在半途被抹掉——故清槽只归最后一个批次。
  it("并发两批次：先结束者不清槽（不抹掉另一个的进度），最后结束者清", async () => {
    const p = probe();
    const gA = gate();
    const gB = gate();
    const a = withFooterProgress(p.root as unknown as ShadowRoot, (d, t) => `A${d}/${t}`, 4, async (op) => {
      await gA.promise;
      op(4, 4);
      return "a";
    });
    await Promise.resolve();
    const b = withFooterProgress(p.root as unknown as ShadowRoot, (d, t) => `B${d}/${t}`, 9, async (op) => {
      op(9, 9);
      await gB.promise;
      return "b";
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(p.el).toEqual({ hidden: false, textContent: "B9/9" });

    gB.open(); // B 先结束：槽不得被清（A 仍在跑）
    expect(await b).toBe("b");
    expect(p.el).toEqual({ hidden: false, textContent: "B9/9" });

    gA.open(); // A 最后结束：此时才清槽
    expect(await a).toBe("a");
    expect(p.el).toEqual({ hidden: true, textContent: "" });
  });
});
