// @vitest-environment node
// ===== model-cache 不变量补测（锐评 decoder 轮，2026-10-10）=====
// 既有 4 例覆盖「同 key 覆盖不误 evict / FIFO 淘汰 / evict 回调」，但漏了一条真实可达的不变量：
// **同 key 二次 set 时 `_order` 不得重复入队**——否则该 key 在 FIFO 队列里占多席，
// 一轮淘汰只 pop 出一个、`_cache.size` 仍 >= MAX，需要多轮才收敛，且「最早」语义失真。
import { describe, it, expect, vi, afterEach } from "vitest";

type CacheModule = typeof import("./model-cache.ts");

async function freshModule(): Promise<CacheModule> {
  vi.resetModules();
  return import("./model-cache.ts");
}

describe("model-cache — _order 与 _cache 的一致性（同 key 重复 set）", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("同 key 二次 set 不使 _order 膨胀（否则 FIFO 淘汰配额被同一条目吃掉）", async () => {
    const m = await freshModule();
    const onEvict = vi.fn();
    m.cacheSetEvictHandler(onEvict);

    // 同一 key 反复 set 10 次（真实场景：loader 读旧值补 _decodedBy 塞回、
    // 解码后二次 set 同一 key——源码注释自述「本项目存在大量同 key re-set」）
    for (let i = 0; i < 10; i++) m.cacheSet("/same.ysm", { texture: `data:x${i}` });

    // 再塞满超过上限：只有 1 个真实条目是 /same.ysm，其余各占 1 席。
    // 若 _order 被同 key 塞了 10 席，淘汰会反复 pop 到同一个 key
    // → 需要 >1 次淘汰才腾出空间，且被误淘汰的可能是仍应存活的新条目。
    for (let i = 0; i < 50; i++) m.cacheSet(`/p${i}.ysm`, { texture: `data:${i}` });

    // 上限 50：共 51 个不同 key 被写入 → 恰好淘汰 1 条（最早的 /same.ysm）
    expect(onEvict, "51 个不同 key 只应淘汰 1 条").toHaveBeenCalledTimes(1);
    expect(onEvict.mock.calls[0]![0]).toBe("/same.ysm");
    // 最新的 50 条全部在场（若配额被同 key 吃掉，这里会有条目被多淘汰）
    for (let i = 0; i < 49; i++) {
      expect(m.cacheGet(`/p${i}.ysm`), `/p${i}.ysm 不应被误淘汰`).not.toBeNull();
    }
    expect(m.cacheGet("/p49.ysm")).not.toBeNull();
  });

  it("同 key 重复 set 后，该 key 仍是「最早」而非被推到队尾（FIFO 语义按首次插入）", async () => {
    const m = await freshModule();
    const onEvict = vi.fn();
    m.cacheSetEvictHandler(onEvict);

    m.cacheSet("/first.ysm", { texture: "data:a" });
    m.cacheSet("/second.ysm", { texture: "data:b" });
    // 再次 set /first（真实场景：二次 set 同一 key）——若 _order.push 无条件执行，
    // /first 会被推到 /second 之后，淘汰顺序反转。
    m.cacheSet("/first.ysm", { texture: "data:a2" });

    // 灌满到触发淘汰
    for (let i = 0; i < 49; i++) m.cacheSet(`/q${i}.ysm`, { texture: `data:${i}` });

    // 共 51 个不同 key → 淘汰 1 条：按首次插入序应仍是 /first.ysm
    expect(onEvict, "51 个不同 key 只应淘汰 1 条").toHaveBeenCalledTimes(1);
    expect(onEvict.mock.calls[0]![0]).toBe("/first.ysm");
  });
});
