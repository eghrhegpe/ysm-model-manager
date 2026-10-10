// @vitest-environment node
// ===== worker-bridge 锐评补测（infra 轮，2026-10-10）=====
// 既有 worker-bridge.test.ts 覆盖：工厂内部接线、resolve/reject 模式语义、超时、崩溃重建。
// 本文件专测**迭代中修改集合**这类易漏的结算正确性——terminatePool / clearPending /
// handleWorkerError 都是「for (const [id] of pending) settleError(id,…)」形态，
// 而 settleError 内部 pending.delete(id)：在 Map 迭代中删除**当前**键是安全的，
// 但若实现改为先收集再删、或嵌套触发，就可能漏结算。这些契约无人钉死。
import { describe, it, expect } from "vitest";
import { createWorkerBridge, type WorkerBridge } from "./worker-bridge.ts";

/** 假 worker：记录 postMessage，不自动响应（模拟在途） */
function fakeWorker(): Worker & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    postMessage: (m: unknown) => sent.push(m),
    terminate: () => {},
    set onmessage(_v: unknown) {},
    set onerror(_v: unknown) {},
  } as unknown as Worker & { sent: unknown[] };
}

type Resp = { id: number; ok: boolean; error?: string };
type Ok = Resp;

function makeBridge(workers: Worker[], over: Record<string, unknown> = {}): WorkerBridge<
  { id: number; bytes: ArrayBuffer },
  Resp,
  Ok
> {
  return createWorkerBridge<{ id: number; bytes: ArrayBuffer }, Resp, Ok>({
    workers,
    getId: (r) => r.id,
    timeoutMs: 10_000,
    timeoutMsg: "超时",
    settle: (r, { resolve }) => resolve(r),
    onWorkerError: "resolveAllError",
    makeErrorResponse: (id, msg) => ({ id, ok: false, error: msg }),
    ...over,
  });
}

describe("worker-bridge — 在途结算的完整性与幂等", () => {
  it("terminatePool 结算**全部**在途（迭代中删除不得漏项）", async () => {
    const w = fakeWorker();
    const bridge = makeBridge([w]);
    const ps = Array.from({ length: 5 }, () =>
      bridge.request({ bytes: new ArrayBuffer(4) }),
    );
    // 5 条在途，terminatePool 应逐条结算为 ok:false
    bridge.terminatePool();
    const results = await Promise.all(ps);
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.ok, "每条在途都必须被结算（漏项 = Promise 永久挂起）").toBe(false);
    }
  });

  it("clearPending 清空全部在途且不重复结算（幂等）", async () => {
    const w = fakeWorker();
    const bridge = makeBridge([w]);
    const ps = Array.from({ length: 3 }, () => bridge.request({ bytes: new ArrayBuffer(4) }));
    bridge.clearPending();
    bridge.clearPending(); // 二次调用：pending 已空，不得抛错/重复
    const results = await Promise.all(ps);
    expect(results).toHaveLength(3);
    for (const r of results) expect(r.ok).toBe(false);
  });

  it("先到的响应胜出：同一 id 重复 handleMessage 不二次结算", async () => {
    const w = fakeWorker();
    const bridge = makeBridge([w]);
    const p = bridge.request({ bytes: new ArrayBuffer(4) });
    const id = (w.sent[0] as { id: number }).id;
    const okResp: Resp = { id, ok: true };
    bridge.handleMessage(okResp);
    // 重复投递同一 id（网络/池重建竞态）——pending 已删，应被静默忽略
    bridge.handleMessage({ id, ok: false, error: "重复" });
    const r = await p;
    expect(r.ok, "首次结算结果不得被后到的重复响应翻转").toBe(true);
  });

  it("未知 id 的响应被静默忽略（不误结算他项）", async () => {
    const w = fakeWorker();
    const bridge = makeBridge([w]);
    const p = bridge.request({ bytes: new ArrayBuffer(4) });
    const id = (w.sent[0] as { id: number }).id;
    bridge.handleMessage({ id: id + 999, ok: true }); // 幽灵 id
    bridge.handleMessage({ id, ok: false, error: "真响应" });
    const r = await p;
    expect(r.error).toBe("真响应");
  });
});
